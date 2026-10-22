// Optional, version-pinned adapter preparation. Never writes to the installed host.
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { resolve, dirname, relative, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createTooltipAdapter, TOOLTIP_STATUS_KEY } from "../../src/pendant-tooltip.js";

export const PENDANT_VERSION = "0.41.0";
export const ORIGINAL_SHA256 = "88c02dc6b1474e83fb5b8762ef1f26ae2d07abe04145b1b04f0ba519039bc38c";
export const HOST_EXTENSION_SHA256 = "8c449489dfba9f04fb8e96c2f09640b7ddf69900f6ca0e88ca1a4389b43714d6";
const hash = value => createHash("sha256").update(value).digest("hex");
function replaceOnce(source, before, after) {
  const index = source.indexOf(before);
  if (index < 0 || source.indexOf(before, index + before.length) >= 0) throw new Error("Pendant adapter anchor is absent or ambiguous.");
  return source.slice(0, index) + after + source.slice(index + before.length);
}
export function patchWebview(source) {
  if (hash(source) !== ORIGINAL_SHA256) throw new Error("Unsupported Pendant webview hash; refusing to patch.");
  const modelStart = source.indexOf("renderModelTooltipFor(e){"), modelEnd = source.indexOf("prepareModelTooltipFor(e){", modelStart);
  const originalModel = source.slice(modelStart, modelEnd);
  let model = replaceOnce(originalModel, "return s$(xn(this.options.getModels(),e.provider,e.modelId),",
    "let __wbModel=xn(this.options.getModels(),e.provider,e.modelId);let __wbBase=s$(__wbModel,");
  model = replaceOnce(model, ",n.error)}", ",n.error);return __piWorkbuddyTooltip.append(__wbBase,this.__piWorkbuddyEntries??[],{provider:e.provider,sessionId:this.options.getState().sessionId,modelAvailable:!!__wbModel},Date.now())}");
  let output = replaceOnce(source, originalModel, model);
  const statusStart = source.indexOf("setExtensionStatus(e){"), statusEnd = source.indexOf("setExtensionStatusSurface(e){", statusStart);
  const originalStatus = source.slice(statusStart, statusEnd);
  let status = replaceOnce(originalStatus, "setExtensionStatus(e){this.extensionStatus.entries=e.map(",
    "setExtensionStatus(e){this.__piWorkbuddyEntries=e.filter(n=>n.key===" + JSON.stringify(TOOLTIP_STATUS_KEY) +
    ");this.extensionStatus.entries=e.filter(n=>n.key!==" + JSON.stringify(TOOLTIP_STATUS_KEY) + ").map(");
  status = replaceOnce(status, "this.ui.footerTooltipController.refresh(this.options.extensionStatusButton,t)}",
    "this.ui.footerTooltipController.refresh(this.options.extensionStatusButton,t);this.ui.footerTooltipController.refreshActive()}");
  output = replaceOnce(output, originalStatus, status);
  // This is a module-local helper; no global account cache, network API, or credentials enter the webview.
  return "// pi-workbuddy optional Pendant tooltip adapter v1\nconst __piWorkbuddyTooltip=(" + createTooltipAdapter.toString() + ")();\n" + output;
}
export function patchHostExtension(source) {
  if (hash(source) !== HOST_EXTENSION_SHA256) throw new Error("Unsupported Pendant broker hash; refusing to patch.");
  const start = source.indexOf("broadcastExtensionStatus(){"), end = source.indexOf("waitForSidebarWebviewReady(", start);
  const original = source.slice(start, end);
  // A hidden status surface must not drop the private tooltip transport. Other entries stay hidden.
  const replacement = "broadcastExtensionStatus(){let visible=this.extensionStatusSurface===\"panel\"||this.extensionStatusSurface===\"both\";let targets=[...this.view?[{source:\"sidebar\"}]:[],...[...this.editorSurfaces.values()].map(n=>({source:\"editor\",surfaceId:n.id}))];for(let target of targets){let entries=this.extensionUiHost.getStatusSnapshot(B(target));if(!visible)entries=entries.filter(entry=>entry.key===" + JSON.stringify(TOOLTIP_STATUS_KEY) + ");this.postMessage({type:\"extension_status\",entries},target)}}";
  let output = replaceOnce(source, original, replacement);
  // Never expose the encoded transport in VS Code's separate status bar either.
  output = replaceOnce(output, "refreshStatusBar(){let e=this.getStatusSnapshot(),n=e.flatMap(",
    "refreshStatusBar(){let e=this.getStatusSnapshot().filter(entry=>entry.key!==" + JSON.stringify(TOOLTIP_STATUS_KEY) + "),n=e.flatMap(");
  return output;
}
function within(child, parent) {
  const path = relative(parent, child);
  return path === "" || !path.startsWith("..") && !isAbsolute(path);
}
export function prepareAdapter(sourceDirectory, outputDirectory) {
  const sourceRoot = realpathSync(sourceDirectory);
  const parent = realpathSync(dirname(resolve(outputDirectory)));
  const output = join(parent, resolve(outputDirectory).split(/[\\/]/).at(-1));
  if (within(output, sourceRoot)) throw new Error("Output must not be inside the installed Pendant directory.");
  const pkg = JSON.parse(readFileSync(join(sourceRoot, "package.json"), "utf8"));
  if (pkg.publisher !== "cdervis" || pkg.name !== "vscode-pi" || pkg.version !== PENDANT_VERSION) {
    throw new Error("Only cdervis.vscode-pi 0.41.0 is supported by this experimental adapter.");
  }
  const original = readFileSync(join(sourceRoot, "dist", "webview.js"));
  const brokerOriginal = readFileSync(join(sourceRoot, "dist", "extension.js"));
  const patched = patchWebview(original.toString("utf8"));
  const brokerPatched = patchHostExtension(brokerOriginal.toString("utf8"));
  for (const [source, esm] of [[patched, true], [brokerPatched, false]]) {
    const checked = spawnSync(process.execPath, [...(esm ? ["--input-type=module"] : []), "--check"], { input: source, encoding: "utf8", timeout: 15000 });
    if (checked.error || checked.status !== 0) throw new Error("Prepared adapter failed syntax validation; nothing was written.");
  }
  const manifest = { adapter: "pi-workbuddy-tooltip-v2", hostVersion: pkg.version, originalSha256: hash(original),
    preparedSha256: hash(patched), target: "dist/webview.js", brokerOriginalSha256: hash(brokerOriginal),
    brokerPreparedSha256: hash(brokerPatched), brokerTarget: "dist/extension.js", applied: false };
  mkdirSync(output); // Fail if output already exists; never overwrite a previous artifact.
  writeFileSync(join(output, "webview.js"), patched, { flag: "wx" });
  writeFileSync(join(output, "extension.js"), brokerPatched, { flag: "wx" });
  writeFileSync(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error("Usage: node integrations/pendant/prepare.mjs PENDANT_DIRECTORY NEW_OUTPUT_DIRECTORY");
    const manifest = prepareAdapter(process.argv[2], process.argv[3]);
    console.log(JSON.stringify(manifest, null, 2));
    console.log("Prepared only. Installed Pendant files have NOT been changed.");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
