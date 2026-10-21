import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import workbuddy from "../src/bridge-extension.js";
import { discoverModels, literalApiKey, modelDefinitions, readConfig } from "../src/bridge.js";

async function server(t, handler) {
  const srv = createServer(handler);
  await new Promise(resolve => srv.listen(0, "127.0.0.1", resolve));
  t.after(() => { srv.closeAllConnections(); srv.close(); });
  return "http://127.0.0.1:" + srv.address().port + "/v1";
}

test("configuration validates URL, limits, IDs and credential literals", () => {
  const config = readConfig({});
  assert.equal(config.baseUrl, "http://127.0.0.1:8787/v1");
  assert.deepEqual(config.fallbackIds, ["auto"]);
  assert.equal(literalApiKey("$TOKEN"), "$$TOKEN");
  assert.equal(literalApiKey("!secret$"), "$!secret$$");
  assert.throws(() => readConfig({ WORKBUDDY_BASE_URL: "file:///tmp" }));
  assert.throws(() => readConfig({ WORKBUDDY_BASE_URL: "https://user:secret@example.com" }));
  assert.throws(() => readConfig({ WORKBUDDY_TIMEOUT_MS: "NaN" }));
  assert.throws(() => readConfig({ WORKBUDDY_CONTEXT_WINDOW: "1" }));
  assert.deepEqual(readConfig({ WORKBUDDY_MODELS: "a, b,a" }).fallbackIds, ["a", "b"]);
  assert.equal(modelDefinitions(["x"], config)[0].reasoning, false);
});

test("discovery sends auth and deduplicates valid IDs", async t => {
  const url = await server(t, (req, res) => {
    assert.equal(req.url, "/v1/models");
    assert.equal(req.headers.authorization, "Bearer secret");
    res.end(JSON.stringify({ data: [{ id: "a" }, { id: "a" }, { id: "b" }, {}, { id: 3 }] }));
  });
  const config = readConfig({ WORKBUDDY_BASE_URL: url + "/", WORKBUDDY_API_KEY: "secret" });
  assert.deepEqual(await discoverModels(config), ["a", "b"]);
});

test("HTTP failures do not expose upstream secrets", async t => {
  const url = await server(t, (_req, res) => { res.writeHead(401); res.end("SECRET_TOKEN"); });
  await assert.rejects(discoverModels(readConfig({ WORKBUDDY_BASE_URL: url })), error =>
    error.message.includes("401") && !error.message.includes("SECRET_TOKEN"));
});

for (const [name, payload] of [["invalid JSON", "oops"], ["bad shape", "{}"], ["empty catalog", '{"data":[]}']]) {
  test(name, async t => {
    const url = await server(t, (_req, res) => res.end(payload));
    await assert.rejects(discoverModels(readConfig({ WORKBUDDY_BASE_URL: url })));
  });
}

test("timeout and cancellation terminate discovery", async t => {
  const url = await server(t, () => {});
  const config = readConfig({ WORKBUDDY_BASE_URL: url, WORKBUDDY_TIMEOUT_MS: "30" });
  await assert.rejects(discoverModels(config));
  await assert.rejects(discoverModels(config, AbortSignal.abort()));
});

test("extension registers fallback offline, refreshes, and retains catalog on failure", async t => {
  let offline = true;
  const url = await server(t, (_req, res) => {
    if (offline) { res.writeHead(503); res.end(); }
    else res.end('{"data":[{"id":"live-model"}]}');
  });
  const previous = process.env.WORKBUDDY_BASE_URL;
  process.env.WORKBUDDY_BASE_URL = url;
  t.after(() => {
    if (previous === undefined) delete process.env.WORKBUDDY_BASE_URL;
    else process.env.WORKBUDDY_BASE_URL = previous;
  });
  const registrations = [];
  const commands = {};
  const notices = [];
  await workbuddy({
    registerProvider: (id, config) => registrations.push({ id, config }),
    registerCommand: (id, command) => { commands[id] = command; },
  });
  assert.equal(registrations[0].id, "workbuddy-bridge");
  assert.equal(registrations[0].config.api, "openai-completions");
  assert.equal(registrations[0].config.models[0].id, "auto");
  const ctx = { ui: { notify: (...args) => notices.push(args) } };
  offline = false;
  await commands.workbuddy.handler("status", ctx);
  assert.equal(registrations.length, 1);
  await commands.workbuddy.handler("refresh", ctx);
  assert.equal(registrations.at(-1).config.models[0].id, "live-model");
  offline = true;
  await commands.workbuddy.handler("refresh", ctx);
  assert.equal(registrations.length, 2);
  assert.equal(notices.at(-1)[1], "warning");
});
