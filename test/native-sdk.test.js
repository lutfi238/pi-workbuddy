import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkbuddyProvider } from "../src/native-provider.js";
import { registerNativeLifecycle } from "../src/native-lifecycle.js";

// Optional integration against Pendant's actual shipped SDK, using synthetic auth and mock catalogs only.
const bundle = process.env.PI_SDK_TEST_PATH;
const sdkTest = (name, fn) => test(name, { skip: !bundle && "Set PI_SDK_TEST_PATH to Pendant's pi-sdk.cjs" }, fn);
function setup() {
  const sdk = createRequire(import.meta.url)(bundle);
  const host = sdk["@earendil-works/pi-coding-agent"]();
  const { AuthStorage } = sdk["@earendil-works/pi-coding-agent/dist/core/auth-storage.js"]();
  const credentials = AuthStorage.inMemory({ workbuddy: { type: "oauth", origin: "https://www.workbuddy.ai",
    access: "SYNTHETIC_ACCESS", refresh: "SYNTHETIC_REFRESH", expires: Date.now() + 3600000, userId: "mock-user" } });
  let calls = 0;
  const api = { stream() { throw new Error("Inference prohibited"); }, streamSimple() { throw new Error("Inference prohibited"); } };
  const makeProvider = () => createWorkbuddyProvider({ api, client: { async catalog() { calls++; return { models: [
    { id: "default-model", name: "Default", maxInputTokens: 176000 },
    { id: "deepseek-v4.1-flash", supportsToolCall: true },
    { id: "deepseek-v4.1-flash-sg", supportsToolCall: true },
  ] }; } } });
  const entries = new Map();
  const modelsStore = { async read(id) { return structuredClone(entries.get(id)); },
    async write(id, entry) { entries.set(id, structuredClone(entry)); }, async delete(id) { entries.delete(id); } };
  const makeRuntime = () => host.ModelRuntime.create({ credentials, modelsStore, modelsPath: null, allowModelNetwork: false });
  return { host, makeProvider, makeRuntime, entries, get calls() { return calls; } };
}

sdkTest("Pendant SDK: provider re-registration and fresh runtimes retain offline catalogs", async () => {
  const s = setup();
  const runtime = await s.makeRuntime();
  runtime.registerNativeProvider(s.makeProvider());
  assert.equal((await runtime.refresh({ providers: ["workbuddy"], allowNetwork: true, force: true })).errors.size, 0);
  assert.equal(s.calls, 1);
  for (const nextRuntime of [runtime, await s.makeRuntime()]) {
    const provider = s.makeProvider(); nextRuntime.registerNativeProvider(provider);
    assert.equal((await nextRuntime.refresh({ providers: ["workbuddy"], allowNetwork: false })).errors.size, 0);
    assert.equal(provider.getCatalogStatus().source, "cache");
    assert.deepEqual(nextRuntime.getModels().filter(model => model.provider === "workbuddy").map(model => model.id),
      ["default-model", "deepseek-v4.1-flash"]);
  }
  assert.equal(s.calls, 1, "offline restoration must not call a catalog or chat endpoint");
  assert.doesNotMatch(JSON.stringify([...s.entries.values()]), /SYNTHETIC_ACCESS|SYNTHETIC_REFRESH|mock-user/);
});

sdkTest("Pendant SDK: actual session_start replaces the active fallback and restores a saved SG selection", async () => {
  for (const resume of [false, true]) {
    const s = setup(); const dir = mkdtempSync(join(tmpdir(), "pi-workbuddy-pendant-test-"));
    let session;
    try {
      const runtime = await s.makeRuntime();
      const sessionManager = s.host.SessionManager.inMemory(dir);
      if (resume) {
        sessionManager.appendModelChange("workbuddy", "deepseek-v4.1-flash-sg");
        sessionManager.appendMessage({ role: "user", content: "Synthetic resume fixture; no inference.", timestamp: Date.now() });
      }
      const services = await s.host.createAgentSessionServices({ cwd: dir, agentDir: dir, modelRuntime: runtime,
        settingsManager: s.host.SettingsManager.inMemory({ defaultProvider: "workbuddy", defaultModel: "default-model" }),
        resourceLoaderOptions: { noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
          extensionFactories: [pi => { const provider = s.makeProvider(); pi.registerProvider(provider); registerNativeLifecycle(pi, provider); }] },
      });
      assert.deepEqual(services.diagnostics, []);
      ({ session } = await s.host.createAgentSessionFromServices({ services, sessionManager, noTools: "all" }));
      assert.equal(session.model.name, "WorkBuddy Default (fallback)");
      assert.equal(s.calls, 0);
      await session.bindExtensions({ mode: "rpc" });
      assert.equal(s.calls, 1);
      assert.equal(session.model.id, resume ? "deepseek-v4.1-flash" : "default-model");
      assert.notEqual(session.model.name, "WorkBuddy Default (fallback)");
      assert.equal(session.model.contextWindow, resume ? 1048576 : 176000);
      const available = new s.host.ModelRegistry(runtime).getAvailable().filter(model => model.provider === "workbuddy");
      assert.deepEqual(available.map(model => model.id), ["default-model", "deepseek-v4.1-flash"]);
    } finally { session?.dispose(); rmSync(dir, { recursive: true, force: true }); }
  }
});
