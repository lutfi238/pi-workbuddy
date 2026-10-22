# Optional Pendant model-tooltip adapter (experimental)

This integration prepares **WorkBuddy credit rows in Pendant's existing native
model-hover grid**, without disguising credits as OpenAI five-hour/weekly limits.
It is not an official Pendant API or an upstream-supported integration.

## Important boundary

- The Pi extension alone cannot add arbitrary model-hover rows in Pendant 0.41.0.
- Adapter v2 prepares modified **copies** of the webview and host status-broker bundles. Preparation
  never overwrites the installed host and does not imply that the visible UI has
  changed. Installing that copy is a separate, explicitly approved step.
- It supports only `cdervis.vscode-pi` **0.41.0** with the exact inspected original
  webview SHA-256:
  `88c02dc6b1474e83fb5b8762ef1f26ae2d07abe04145b1b04f0ba519039bc38c`.
  Its original `dist/extension.js` must also match
  `8c449489dfba9f04fb8e96c2f09640b7ddf69900f6ca0e88ca1a4389b43714d6`.
- Other versions, changed hashes, duplicate patching, and an output path inside
  the host installation are rejected. Updates require a new review, not disabling
  the checks. Generated vendor bundles are excluded from Git and npm publication.

## Architecture

1. The opt-in WorkBuddy controller resolves credentials through Pi's existing
   `modelRegistry.getApiKeyAndHeaders()` flow, then calls the private in-memory
   credit reader. Pi may refresh expired OAuth credentials through its normal
   auth lock; the controller does not read `auth.json` or manage tokens itself.
2. Only a whitelisted credit snapshot and session ID cross Pi's standard
   `setStatus` transport under the reserved key `workbuddy.credits.v1`.
   Credentials, user IDs, emails, and raw errors are never serialized.
3. The host broker forwards the reserved entry even when the ordinary extension-
   status surface is off (Pendant's default). Other entries retain their existing
   display policy. It does not enable a panel/status bar or change user settings.
   The reserved entry is excluded from the separate VS Code status-bar badge.
4. The webview consumes the reserved entry instead of showing encoded text in the
   ordinary extension-status badge/panel.
5. Its renderer appends rows only for an available WorkBuddy model in the exact
   matching active session. Non-WorkBuddy tooltips keep their original rows.
   Session mismatch, missing model/auth availability, duplicate entries, and
   malformed/oversized payloads hide the credit rows rather than guessing.
6. Status changes refresh an already-open tooltip. No global frontend balance
   cache, new worker request kind, local HTTP server, or credential-bearing
   webview request is introduced.

The controller is **disabled by default**. Normal CLI behavior remains unchanged.
It refreshes on session start, model selection, and completed agent runs only
while explicitly enabled and on a WorkBuddy model. The reader's 60-second cache
and request deduplication apply. There is no hover-triggered network request or
idle polling; old snapshots are explicitly marked `Cached / stale`. Use the
refresh command when a newer balance is needed without sending a chat.

Observed provider/session changes cancel outdated publication. Moving away from
WorkBuddy, disabling the relay, or shutting down clears its private reader. The
host hides balances for models no longer present in its available-model list.
Account changes must reach the normal Pi auth/session lifecycle or be followed
by an explicit refresh; this is not a separate account-monitoring service.

## Prepare, without applying

From the repository (the output directory must not already exist):

```powershell
node integrations/pendant/prepare.mjs `
  "C:/Users/YOUR_USER/.vscode/extensions/cdervis.vscode-pi-0.41.0" `
  "integrations/pendant/generated"
```

The command validates the version/hash and generated JavaScript syntax, then
writes only:

- `generated/webview.js`: the optional prepared renderer copy.
- `generated/extension.js`: the optional prepared broker copy.
- `generated/manifest.json`: original/prepared hashes for both and `applied: false`.

If the output already exists, preserve/review it or choose a different new
output directory. Do not use preparation to overwrite an installed bundle.

The preparation utility is included in the npm package at
`integrations/pendant/prepare.mjs`; paths in the command above assume a repository
checkout. It requires only Node.js and the supplied installed host directory.

## Before any installation

Review the manifest and diff. Prefer testing in a disposable VS Code profile.
Applying v2 requires explicit backups of the original `dist/webview.js` and
`dist/extension.js`, original-hash checks, and reversible replacements of both. This
utility deliberately has **no apply command**. No installed Pendant file has
been modified by implementing or preparing this integration.

A local modification is not guaranteed to survive extension updates and may
interact with host integrity/CSP behavior that isolated tests cannot prove.
Keep the backup and restore the original before upgrading or troubleshooting
unrelated host problems. Do not publish modified vendor bundles as this project.

## After an approved adapter installation

Load the updated `pi-workbuddy` extension, then in the patched Pendant session:

```text
/workbuddy-tooltip on
/workbuddy-tooltip refresh
/workbuddy-tooltip status
/workbuddy-tooltip off
```

The command is a Pi extension command, not a chat prompt. It sends only a
bounded read-only credit requests when enabled (summary and relevant detail pages); it never invokes inference. Do not enable
it in an unmodified host: an ordinary status surface might display the encoded
transport rather than a native tooltip. It refuses the normal TUI mode.

For persistent opt-in **after installing the adapter**, launch the host process
with `WORKBUDDY_PENDANT_TOOLTIP=1`. The `.env.example` is documentation only; it is
not automatically loaded. If `pendant.extensionStatus.keys` is configured as an
allowlist, include `workbuddy.credits.v1`; the integration does not bypass that
user-controlled filter.

## Displayed fields

The native model header, provider, context, reasoning and input rows remain.
Additional credit rows use only verified data:

- Plan name, if supplied by the credit summary (no guessed Free/Pro label).
- Credits remaining.
- Separate base/daily/bonus/top-up grants, each with `remaining / total left`.
- Each grant's supplied expiry; never substitute an ordinary renewal/reset date.
- A maximum of four preview grants (base/daily first, then earliest known expiry),
  with an explicit count of further loaded grants. Partial detail reads are labeled.
- Aggregate used/total and summary-group count only when details are unavailable.
- Last successful update.
- Explicit cached/stale indicator when applicable.

`Credits remaining` and each grant's remaining balance reuse Pendant's native OpenAI semantic tones: green at
50% or more remaining, yellow from 15% to below 50%, and red below 15% (including
an explicitly known zero). A positive balance with an unknown/inconsistent total
stays neutral; stale balances are not shown as current healthy/depleted quota.
The percentage only selects a tone, not a new displayed allowance. Other rows
stay neutral; package count is not a banked-reset count. Absolute expiry timestamps
render in the browser's local timezone. Offset-less dates remain unchanged under
`Expires (server time)`; unknown dates show `Unknown`, not `Never`. The stale marker and
unavailable state use the host's warning tone. No custom RGB/CSS palette is added.

Missing numbers show `Unknown`, not zero. Loading/unavailable replaces the
credit values. No expiry, renewal time, percentage, or USD conversion is invented.
The balance belongs to the account, not independently to each model. Only the
verified personal-account route is currently supported.

## Validation and remaining verification

If the installed host is already adapted, keep its original backup as the test
fixture instead of weakening the original-hash check:

```powershell
$env:PI_PENDANT_FIXTURE_PATH = "C:/path/to/backup/pendant-original"
# This fixture contains original package.json, dist/webview.js and dist/extension.js.
# PI_SDK_TEST_PATH still points to the real installed dist/pi-sdk.cjs.
npm test
```

Tests cover payload redaction and bounds, account/session cancellation, Pi's
actual bundled SDK auth/status APIs with synthetic credentials, and the patched
native renderer methods extracted from the exact shipped bundle. Preparation
also checks that the original file is unchanged and the output parses as ESM.
These are not a browser screenshot or a test of an applied VS Code installation.
The operator separately confirmed the native hover, colors, per-grant balances
and expiry dates visually in the local 0.41.0 deployment. New deployments or host
versions still need their own visible hover check.
In particular, the regression suite now checks the default `off` status surface;
renderer-only v1 omitted that broker gate and could not receive the payload.
Use **Developer: Reload Window** after installing v2, not only Pi `/reload`.

For upstream support, the preferable long-term change is a documented generic
provider-details API with text rows and session/account scoping. The current
version-pinned adapter is an explicit compatibility bridge, not a claim that
Pendant already implements that public API.
