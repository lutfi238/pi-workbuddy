# Optional native Pendant tooltip integration

> Follow-up: the operator subsequently approved a backed-up local deployment.
> The adapter and 0.2.4 package preview are now installed on that machine, without
> restarting VS Code. See [the local installation record](pendant-tooltip-local-installation.md).
> The preparation-only statements below describe the initial implementation step.
> A subsequent screenshot exposed the hidden-status broker gate missed by v1.
> [Adapter v2](pendant-tooltip-transport-fix.md) fixes that transport path and is
> installed locally with both original host files backed up.

## Scope and state

The operator selected preparation of native model-hover integration after the
personal-account credit reader was implemented. This work adds an opt-in relay,
a shared bounded payload/row formatter, and a version-pinned host-adapter
preparation tool. It does not overwrite installed Pendant files.

The prepared adapter uses the **existing native model-hover grid**, not a new
widget and not an OpenAI-shaped usage response. Default installations remain
unchanged. Native Pi currently has no established generic hover-row provider
hook in the inspected host, so the bridge is explicitly optional/experimental.

## Route

`Pi resolved WorkBuddy auth -> private credit reader -> standard setStatus ->
Pendant scoped extension-status message -> optional native grid adapter`

- `src/native-tooltip-controller.js` resolves current credentials using
  `ctx.modelRegistry.getApiKeyAndHeaders()`; no direct auth.json access is added.
  Normal Pi auth resolution may refresh expiring OAuth tokens under Pi's lock.
- Credits are requested only after explicit opt-in or the opt-in environment flag.
  Session/model/run events use the reader's cache. Hovering does not invoke
  inference or cause an additional network loop.
- `src/pendant-tooltip.js` validates/whitelists the transport and formats credit
  rows. It is self-contained so exactly the same code can run in the prepared
  host module. Unknown fields, credentials, user IDs, and raw errors are excluded.
- The reserved `workbuddy.credits.v1` status entry is consumed by the adapter,
  not shown as an opaque ordinary status badge. Other extensions' statuses remain.
- Native model title/provider/context/reasoning/input rows are preserved; appended
  rows show remaining, used/total, package count, update time, optional actual plan
  name, and stale state. No expiry/percentage/5-hour/weekly/USD values are invented.

The formatter requires the exact active session ID, WorkBuddy provider, and a
model present in the host's available model list. Duplicate, malformed, oversized,
foreign-session, or unavailable-model inputs do not append balances. There is no
frontend global account cache. A provider/session change observed by the
controller invalidates pending publication; disabled/shutdown relays clear the
private reader. Account changes must reach Pi's lifecycle or explicit refresh;
this is not a separate account-monitoring daemon.

The standard status transport remains inside Pi/Pendant's existing extension
trust boundary; it is not cryptographic proof against a malicious installed
extension using the same key. Do not enable the relay in an unmodified host that
might display its encoded status text. An allowlisted
`pendant.extensionStatus.keys` configuration must include the reserved key.

## Host adapter boundary

Target: `cdervis.vscode-pi` 0.41.0, original `dist/webview.js` SHA-256
`88c02dc6b1474e83fb5b8762ef1f26ae2d07abe04145b1b04f0ba519039bc38c`.
The artifact identity matches the earlier tooltip analysis (parent REA Evidence
`ev_7b829ef6267cb5ee1a9a6ee20e94c480a62f5b11a6ccdb97c11c4a88ee9668a9`).
This follow-up used ordinary byte/text checks and isolated SDK/renderer execution,
not a new full REA analysis or an execution of the live VS Code UI. REA MCP tools
were not advertised in this session; no registration/settings repair was made.

`integrations/pendant/prepare.mjs` verifies package identity/version and the exact
original hash, changes two reviewed native controller methods, embeds the shared
formatter module-locally, checks ESM syntax, and writes only a separate new output
directory. It refuses duplicate/unsupported input and output inside the source
host installation. The manifest explicitly says `applied: false`.

The changes consume the reserved status entry in `setExtensionStatus` and append
rows in `renderModelTooltipFor`. Status updates refresh the active tooltip. The
worker's auth/protocol/WASM machinery and the existing subscription/OpenRouter
usage routes are not changed.

The installed webview hash was checked again after preparation/tests and remained
identical. Generated copies are ignored by Git and excluded from the npm file
list. No vendor bundle is redistributed by this project. No local apply utility
is included; applying with an original backup/hash check and visible testing is
a separate approval/deployment step. Host updates require re-review rather than
bypassing the version/hash guard.

## Validation

The complete suite passes **159 tests**, including the optional installed Pi AI
and Pendant SDK/artifact checks. Syntax checks, offline CLI smoke, and npm tarball
inspection pass. The tarball includes the preparation utility and guide, but no
generated vendor bundle or private evidence.

Unit tests cover numeric/unknown values, safe payload serialization, session and
provider boundaries, unavailable models, stale age, cancellation, default-off and
RPC-only behavior, malformed auth, late completions, and reader deduplication.

Integration tests use the actual shipped SDK's auth and status APIs with synthetic
credentials and a fake credit reader. The patched native renderer methods and
original grid builder are evaluated in an isolated VM with UI/translation stubs;
this verifies appended WorkBuddy rows, unchanged non-WorkBuddy output, private
transport filtering, session isolation, model-availability hiding, and refresh
notifications. Adapter preparation also passes JavaScript syntax validation and
leaves the installed artifact unchanged.

These tests are not a browser screenshot, an applied-host launch, or evidence
that all host integrity/CSP/update behaviors accept a local modification. The
visible hover still requires testing after an approved reversible deployment.
No live billing/inference endpoint was called for this implementation. No installed
npm package, VS Code extension bundle, global settings, or account was modified.
