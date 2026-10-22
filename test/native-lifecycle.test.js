import assert from "node:assert/strict";
import { test } from "node:test";
import { registerNativeLifecycle, recoverSelectedModel } from "../src/native-lifecycle.js";
import { fallbackModels, projectModels } from "../src/native-models.js";

function setup(selected = fallbackModels()[0]) {
  let start, calls = 0, options, target;
  const notifications = [];
  const catalog = projectModels({ models: [{ id: "default-model", name: "Default", maxInputTokens: 176000 }, { id: "deepseek-v4.1-flash" }] });
  const provider = { getModels: () => catalog };
  const pi = { on(name, handler) { assert.equal(name, "session_start"); start = handler; }, async setModel(model) { target = model; return true; } };
  const ctx = { model: selected, isIdle: () => true, ui: { notify: message => notifications.push(message) },
    modelRegistry: { hasConfiguredAuth: () => true, async refresh(value) { calls++; options = value; return { aborted: false, errors: new Map() }; } } };
  registerNativeLifecycle(pi, provider);
  return { pi, provider, ctx, start: () => start({ reason: "startup" }, ctx), get calls() { return calls; },
    get options() { return options; }, get target() { return target; }, notifications };
}

test("session startup refreshes the provider and replaces stale fallback metadata", async () => {
  const s = setup();
  await s.start();
  assert.equal(s.calls, 1);
  assert.deepEqual(s.options.providers, ["workbuddy"]);
  assert.equal(s.options.force, true);
  assert.equal(s.target.name, "Default");
  assert.equal(s.target.contextWindow, 176000);
});

test("a saved SG model selects its exact non-SG counterpart without inference", async () => {
  const s = setup({ provider: "workbuddy", id: "deepseek-v4.1-flash-sg", name: "Old SG" });
  await s.start();
  assert.equal(s.target.id, "deepseek-v4.1-flash");
});

test("startup never overrides another provider, a changed selection, or a running turn", async () => {
  for (const kind of ["other", "changed", "running", "unchanged", "missing-counterpart"]) {
    const s = setup();
    if (kind === "other") s.ctx.model = { provider: "other", id: "chosen" };
    if (kind === "running") s.ctx.isIdle = () => false;
    if (kind === "unchanged") s.ctx.model = s.provider.getModels()[0];
    if (kind === "missing-counterpart") s.ctx.model = { provider: "workbuddy", id: "deepseek-unknown-sg" };
    if (kind === "changed") s.ctx.modelRegistry.refresh = async () => {
      s.ctx.model = { provider: "other", id: "new-choice" };
      return { aborted: false, errors: new Map() };
    };
    await s.start();
    assert.equal(s.target, undefined, kind);
  }
});

test("offline startup requests no network; unauthenticated startup does not refresh", async () => {
  const original = process.env.PI_OFFLINE;
  process.env.PI_OFFLINE = "1";
  try {
    const s = setup(); await s.start();
    assert.equal(s.options.allowNetwork, false);
  } finally {
    if (original === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = original;
  }
  const s = setup(); s.ctx.modelRegistry.hasConfiguredAuth = () => false;
  await s.start(); assert.equal(s.calls, 0); assert.equal(s.target, undefined);
});

test("a cached catalog can repair a fallback label even when online refresh fails", async () => {
  const s = setup();
  s.ctx.modelRegistry.refresh = async () => ({ aborted: false, errors: new Map([["workbuddy", new Error("SECRET")]]) });
  await s.start();
  assert.equal(s.target.name, "Default");
  assert.doesNotMatch(s.notifications.join(" "), /SECRET/);
});

test("startup cancellation and failures are bounded and do not throw into the host", async () => {
  const s = setup();
  s.ctx.modelRegistry.refresh = async () => ({ aborted: true, errors: new Map() });
  await s.start(); assert.equal(s.target, undefined);
  s.ctx.modelRegistry.refresh = async () => { throw new Error("SECRET"); };
  await s.start(); assert.equal(s.target, undefined);
  assert.doesNotMatch(s.notifications.join(" "), /SECRET/);
});

test("manual recovery reports an unavailable selection without modifying unrelated models", async () => {
  const s = setup();
  s.pi.setModel = async () => false;
  await recoverSelectedModel(s.pi, s.provider, s.ctx);
  assert.match(s.notifications[0], /select an available model/);
});

test("resume recovery uses the latest model choice, not an older SG history record", async () => {
  for (const last of ["deepseek-v4.1-flash-sg", "deepseek-v4.1-flash", "default-model"]) {
    const s = setup();
    s.ctx.sessionManager = { getBranch: () => [
      { type: "model_change", provider: "workbuddy", modelId: "deepseek-v4.1-flash-sg" },
      { type: "model_change", provider: "workbuddy", modelId: last },
    ] };
    await s.start();
    assert.equal(s.target.id, last === "default-model" ? last : "deepseek-v4.1-flash");
  }
});

test("manual catalog refresh also repairs the active bootstrap metadata", async () => {
  const { registerNativeCommands } = await import("../src/native-provider.js");
  const s = setup(); let command;
  s.pi.registerCommand = (_name, config) => { command = config.handler; };
  registerNativeCommands(s.pi, s.provider);
  await command("refresh", s.ctx);
  assert.equal(s.target.name, "Default");
  assert.match(s.notifications.at(-1), /catalog refreshed/);
});
