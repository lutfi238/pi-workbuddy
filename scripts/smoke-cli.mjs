// Offline smoke test with a disposable Pi profile and synthetic credentials only.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const cli = process.argv[2];
if (!cli) throw new Error("Usage: node scripts/smoke-cli.mjs PATH_TO_PI/dist/bundle/cli.js");
const entry = fileURLToPath(new URL("../extensions/workbuddy.js", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "pi-workbuddy-smoke-"));
try {
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ workbuddy: {
    type: "oauth", origin: "https://www.workbuddy.ai", access: "SYNTHETIC_ACCESS",
    refresh: "SYNTHETIC_REFRESH", expires: Date.now() + 3600000, userId: "mock-user",
  } }));
  const result = spawnSync(process.execPath, [cli, "--offline", "--no-extensions", "--no-mcp",
    "--no-context-files", "--no-skills", "-e", entry, "--list-models", "workbuddy"], {
    cwd: dir, env: { ...process.env, WORKBUDDY_MODE: "native", WORKBUDDY_GZIP: "1", PI_CODING_AGENT_DIR: dir },
    encoding: "utf8", timeout: 30000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || !result.stdout.includes("default-model")) {
    throw new Error("Pi extension did not register a usable native model. " + result.stdout + result.stderr);
  }
  console.log(result.stdout.trim());
  console.log("Offline CLI smoke passed; temporary synthetic credentials removed.");
} finally { rmSync(dir, { recursive: true, force: true }); }
