# Tooltip adapter v2: hidden status-surface regression

## Report and root cause

The operator enabled `/workbuddy-tooltip on`, but the visible native tooltip
continued to show only model metadata. The first adapter implementation patched
the webview renderer but missed a host-side transport gate.

The shipped Pendant 0.41.0 manifest defaults `pendant.extensionStatus.surface`
to `off`. Its original `broadcastExtensionStatus()` returns immediately unless
the surface is `panel` or `both`. Therefore Pi's successfully published status
could be held inside the host without ever reaching the patched webview.

A regression test reproduces the original drop using the exact shipped broker
method with surface `off`; it produces zero frames even with the reserved
WorkBuddy entry present. The earlier tests covered SDK publication and webview
rendering separately, not this intermediate broker method. Their success was not
evidence of end-to-end visible UI behavior.

## Fix

Adapter v2 additionally patches the exact inspected `dist/extension.js`:

- Always send owner-scoped extension-status snapshots to the existing sidebar/
  editor targets. With `off` or `statusBar`, send only `workbuddy.credits.v1`,
  including an empty snapshot when that entry is cleared.
- With `panel` or `both`, retain the previous full status payload behavior.
- Exclude the reserved transport from VS Code's separate status-bar text/tooltip.
- Keep the user's status-key filter and all other status visibility unchanged.
  No user setting is modified or force-enabled.

The webview adapter remains unchanged. No new worker protocol kind, credential
transport, polling, inference, or billing endpoint was added. The relay's local
`status` command now reports `payload=waiting/loading/ready/unavailable/disabled`
without reading credits or exposing account identity, tokens, or balances.
A `ready` relay state is not a renderer acknowledgement.

## Artifact identities and deployment

Original host broker SHA-256:
`8c449489dfba9f04fb8e96c2f09640b7ddf69900f6ca0e88ca1a4389b43714d6`

Prepared/installed v2 broker SHA-256:
`0a2d83f89fd7ac721d5377a610d39259f666c69c6c05fb3744facc28e9aca703`

The webview remains the previous prepared artifact:
`e1bd4fc0a7757fa9f560a5699d4345b40c2602f11a3a2425ace37cb2959e2fd9`.

The original broker was backed up alongside the original webview in the existing
private backup fixture. The previous local preview package and receipt were also
preserved before updating the local 0.2.4 preview. The receipt now lists both host
files. The standalone recovery utility validates and restores both originals plus
the original 0.2.3 package; its read-only check passes. No recovery was applied.

The preparation utility now checks hashes and syntax for both bundles. Original
artifact tests continue using `PI_PENDANT_FIXTURE_PATH`; no original-hash guard
was weakened. This repair uses bounded ordinary text inspection and isolated
native method execution; it does not claim a new complete static-analysis graph.

## Validation and remaining visual check

**162 tests pass**, including new regressions for all four status-surface modes,
owner targets, clearing, hidden transport in VS Code's status bar, and local
relay-state diagnostics. Tests use synthetic statuses/credentials. Syntax checks,
offline CLI smoke, and package file-list inspection pass.

The v2 broker and updated local package were installed with verified backups.
The repair scripts did not invoke live billing/inference endpoints, alter auth,
change Pi/VS Code settings, or publish to npm. The agent did not restart its own
VS Code host. **Developer: Reload Window** is required to load the new host broker;
Pi `/reload` alone is insufficient. Visible native-hover confirmation remains
pending after that reload and `/workbuddy-tooltip on`.
