import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkbuddyError, describeFailure } from "../src/native-errors.js";
import { createNativeClient, ORIGIN } from "../src/native-client.js";
import { projectModels } from "../src/native-models.js";
import { createWorkbuddyProvider, registerNativeCommands } from "../src/native-provider.js";

const credential = () => ({ type: "oauth", origin: ORIGIN, access: "SYNTHETIC_ACCESS", refresh: "SYNTHETIC_REFRESH",
  expires: Date.now() + 3600000, userId: "mock-user" });

test("diagnostics unwrap causes but never echo arbitrary upstream error text or fields", () => {
  const inner = new WorkbuddyError("http", "SECRET_TOKEN", {
    status: 403, businessCode: 12003, url: "https://secret.example/?token=SECRET_TOKEN", body: "PRIVATE_BODY",
  });
  const message = describeFailure(new Error("WRAPPER_SECRET", { cause: inner }));
  assert.match(message, /\[http\].*HTTP 403.*business code 12003/);
  assert.doesNotMatch(message, /SECRET|PRIVATE|secret\.example/);
  assert.match(describeFailure(new Error("PRIVATE_BODY")), /\[unknown\]/);
  assert.doesNotMatch(describeFailure(new Error("PRIVATE_BODY")), /PRIVATE_BODY/);
  const cycle = new Error("SECRET"); cycle.cause = cycle;
  assert.match(describeFailure(cycle), /\[unknown\]/);
});

test("catalog failures distinguish empty, malformed, and filtered catalogs safely", () => {
  for (const [input, code] of [[{}, "catalog-shape"], [{ models: [] }, "catalog-empty"],
    [{ models: [{ id: "remote", url: "https://secret.example/?key=SECRET" }, { id: "disabled", disabled: true }] }, "catalog-filtered"],
    [{ models: [{ id: "deepseek-v4.1-flash-sg" }] }, "catalog-filtered"]]) {
    assert.throws(() => projectModels(input), error => {
      assert.equal(error.diagnosticCode, code);
      const text = describeFailure(error);
      assert.doesNotMatch(text, /secret\.example|SECRET/);
      if (code === "catalog-filtered" && input.models.length === 1) {
        assert.match(text, /excluded=1/);
      } else if (code === "catalog-filtered") {
        assert.match(text, /total=2/);
        assert.match(text, /endpoint=1/);
        assert.match(text, /disabled=1/);
      }
      return true;
    });
  }
});

test("credential validation is not incorrectly reported as a network failure", async () => {
  let requests = 0;
  const client = createNativeClient({ fetch: async () => { requests++; throw new Error("should not run"); } });
  await assert.rejects(client.catalog({ ...credential(), domain: "untrusted.example" }), error => {
    assert.match(describeFailure(error), /\[account-domain\]/); return true;
  });
  assert.equal(requests, 0);
});

test("native server rejection retains HTTP and business code without raw body", async () => {
  const client = createNativeClient({ fetch: async () => new Response('{"code":11212,"msg":"PRIVATE_RESPONSE"}', { status: 403 }) });
  await assert.rejects(client.catalog(credential()), error => {
    const text = describeFailure(error);
    assert.match(text, /HTTP 403/);
    assert.match(text, /11212/);
    assert.doesNotMatch(text, /PRIVATE_RESPONSE/); return true;
  });
});

test("provider reports fallback failure and clears it only after an accepted publication", async () => {
  let good = false;
  const provider = createWorkbuddyProvider({ api: { stream() {}, streamSimple() {} }, client: {
    async catalog() { return { models: good ? [{ id: "remote" }] : [] }; },
  } });
  const context = { credential: credential(), allowNetwork: true, signal: new AbortController().signal,
    publish: async ({ update }) => { update(); return true; } };
  await assert.rejects(provider.refreshModels(context));
  assert.equal(provider.getModels()[0].id, "default-model");
  assert.equal(provider.getCatalogStatus().source, "fallback");
  assert.match(provider.getCatalogStatus().lastError, /catalog-empty/);
  good = true;
  await provider.refreshModels(context);
  assert.equal(provider.getCatalogStatus().source, "remote");
  assert.equal(provider.getCatalogStatus().lastError, undefined);
});

test("refresh command exposes sanitized reasons; doctor is local and reports active model", async () => {
  let command, networkRefreshes = 0;
  const notices = [];
  const provider = createWorkbuddyProvider({ api: { stream() {}, streamSimple() {} } });
  registerNativeCommands({ registerCommand(_name, config) { command = config; } }, provider);
  const ctx = {
    model: { provider: "openai-codex", id: "current-model" },
    modelRegistry: { hasConfiguredAuth: () => true, refresh: async () => {
      networkRefreshes++;
      return { aborted: false, errors: new Map([["workbuddy", new Error("WRAPPER_SECRET", {
        cause: new WorkbuddyError("http", "PRIVATE_RESPONSE", { status: 401, businessCode: 11212 }),
      })]]) };
    } }, ui: { notify: (...args) => notices.push(args) },
  };
  await command.handler("refresh", ctx);
  assert.match(notices[0][0], /HTTP 401.*11212/);
  assert.doesNotMatch(notices[0][0], /SECRET|PRIVATE/);
  await command.handler("doctor", ctx);
  assert.equal(networkRefreshes, 1);
  assert.match(notices[1][0], /catalog=fallback/);
  assert.match(notices[1][0], /Active model: openai-codex\/current-model/);
  assert.match(notices[1][0], /No chat request sent/);
});
