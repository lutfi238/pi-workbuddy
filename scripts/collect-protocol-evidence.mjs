// Collect bounded, inert source excerpts from the supplied WorkBuddy installation.
// Only shipped program files are read. Never reads profile/auth storage or executes app code.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const [installation, destination = 'research/protocol-source-evidence.json'] = process.argv.slice(2);
if (!installation) throw new Error('Usage: node scripts/collect-protocol-evidence.mjs INSTALLATION [OUTPUT]');
const root = resolve(installation);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const asarPath = join(root, 'resources/app.asar');
const cliPath = join(root, 'resources/app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs');
const sdkPath = join(root, 'resources/app.asar.unpacked/cli/dist/lazy-lite-wb/4354.f4e1e1f7.mjs');
const productPath = join(root, 'resources/app.asar.unpacked/cli/product.json');
const sources = {};
for (const [name, path] of Object.entries({ cli: cliPath, sdk: sdkPath, product: productPath })) {
  const bytes = readFileSync(path);
  sources[name] = { path, sha256: sha256(bytes), bytes: bytes.length, text: bytes.toString('utf8') };
}
const inspector = fileURLToPath(new URL('./inspect-workbuddy.mjs', import.meta.url));
let coordinator = execFileSync(process.execPath, [inspector, asarPath, 'main/workbuddy-auth-product-coordinator.js'], { encoding: 'utf8' });
// inspect-workbuddy adds exactly one newline via console.log.
coordinator = coordinator.slice(0, -1);
sources.coordinator = { path: asarPath + '!main/workbuddy-auth-product-coordinator.js', sha256: sha256(Buffer.from(coordinator)), bytes: Buffer.byteLength(coordinator), text: coordinator };
const requests = [
  ['cli', 'client-base-url', 'resolveModelBaseURL(t){', 1800],
  ['cli', 'request-adapter', 'axiosToFetchAdapter(){', 3500],
  ['cli', 'sse-fields', 'parseSSEChunk(t,i=!1){', 2400],
  ['cli', 'repeated-tool-ids', 'normalizeStreamingToolCallIds(t,i){', 1200],
  ['cli', 'request-normalization', 'let M4=class{', 2600],
  ['cli', 'gzip', 'let M8=class{', 1900],
  ['cli', 'auth-interceptor', 'i.AuthenticationHttpInterceptor=void 0;', 2300],
  ['cli', 'product-header', 't.headers[S.PRODUCT]||(t.headers[S.PRODUCT]=', 350],
  ['cli', 'header-names', 'i.TRACE_ID_HEADER="X-Trace-ID"', 1350],
  ['cli', 'catalog-manager', 'async fetchFromRemoteOnce(t,i,n,s=5e3,c){', 2400],
  ['cli', 'catalog-default-route', 'A="/v3/config",R=["deploymentType"]', 650],
  ['coordinator', 'desktop-catalog', 'async fetchRemoteProductOverlayObserved(e,t){', 3500],
  ['sdk', 'completion-sdk-post', 'class Completions extends APIResource', 1100],
  ['sdk', 'stream-conversion', 'async function*convertChatCompletionsStreamToResponses', 5100],
  ['sdk', 'tool-history-conversion', 'function itemsToMessages(e){', 4100],
  ['sdk', 'request-body', 'async #E(e,t,s){let r,n=[];', 2100],
];
const excerpts = requests.map(([source, id, anchor, length]) => {
  const text = sources[source].text;
  const start = text.indexOf(anchor);
  if (start < 0 || text.indexOf(anchor, start + 1) >= 0) throw new Error('Missing/ambiguous anchor: ' + id);
  return { id, source, characterRange: [start, Math.min(start + length, text.length)], anchor, text: text.slice(start, start + length) };
});
const product = JSON.parse(sources.product.text);
const modelKeys = ['id', 'name', 'maxInputTokens', 'maxOutputTokens', 'maxAllowedSize', 'supportsReasoning', 'onlyReasoning', 'supportsToolCall', 'supportsImages', 'contextWindow', 'reasoning', 'temperature', 'top_p', 'url', 'useCustomProtocol', 'disabled'];
const result = {
  kind: 'ordinary-static-source-inspection',
  note: 'Not a REA Evidence record. Character ranges are UTF-16 offsets in decoded text, not byte offsets. No target code executed or HTTP request made.',
  installation: root,
  asar: { path: asarPath, sha256: sha256(readFileSync(asarPath)) },
  sources: Object.fromEntries(Object.entries(sources).map(([key, { text, ...metadata }]) => [key, metadata])),
  shippedDefaults: {
    endpoint: product.endpoint, authentication: product.authentication,
    deploymentType: product.deploymentType, requestBodyGzip: product.productFeatures?.RequestBodyGzip,
    availableModels: product.availableModels,
    models: product.models.map(model => Object.fromEntries(modelKeys.filter(key => key in model).map(key => [key, model[key]]))),
    cliAgentModels: product.agents?.find(agent => agent.name === 'cli')?.models,
  },
  excerpts,
};
mkdirSync(resolve(destination, '..'), { recursive: true });
writeFileSync(destination, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output: destination, excerpts: excerpts.length, models: result.shippedDefaults.models.length }));
