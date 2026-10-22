# Approved local Pendant tooltip installation

> This records the initial deployment. Later local updates added the
> [v2 broker transport fix](pendant-tooltip-transport-fix.md) and
> [native color emphasis](pendant-tooltip-colors.md), followed by
> [per-resource details and expiry](credit-package-details.md). The private recovery receipt
> contains the current hashes; original stock backups remain unchanged.

## Installed state

The operator explicitly approved installing the prepared adapter with backups.
The following local-only changes were made:

- Pendant `cdervis.vscode-pi` **0.41.0**: replace only `dist/webview.js` with the
  previously prepared and syntax-checked adapter copy.
- Pi's installed `pi-workbuddy` **0.2.3**: replace its package directory with a
  curated **0.2.4 local preview**, so the opt-in credit relay exists after reload.
  Only the 21 public files from npm's dry-run package inventory were staged.

The complete original package was retained, not deleted. The original host
webview and package metadata were also preserved as an original test fixture.
Pi settings, auth files, trust approvals, npm registry, and npm dependency metadata
were not edited. This is a local preview overlay, not an npm publication or a
change to the configured package source. A later Pi/npm update may replace it.

## Backup and verification

A private receipt and recovery instructions are stored below the operator's
Pi agent profile:

`backups/workbuddy-tooltip-<timestamp>/`

The local ignored `integrations/pendant/generated/deployment.json` points to the
exact receipt and original fixture. Absolute user paths are deliberately not
included in these publishable notes.

Original host SHA-256:
`88c02dc6b1474e83fb5b8762ef1f26ae2d07abe04145b1b04f0ba519039bc38c`

Installed adapter SHA-256:
`e1bd4fc0a7757fa9f560a5699d4345b40c2602f11a3a2425ace37cb2959e2fd9`

The original package's file hashes and all preview-file hashes are in the private
receipt. Installation verified both sets and rechecked the host hash before
replacement. File/folder swaps were staged, with failure recovery in the installer.
The installed renderer exactly equals a newly generated patch of the backed-up
original; the hash guard was not disabled.

The backup includes a standalone `rollback.mjs`. Its default/`--check` mode only
verifies backups/current files. `--apply` restores both the original renderer and
the original package while retaining the backups and removed preview. It refuses
unknown changes made after deployment rather than overwriting a later user/vendor
update. Only its syntax and read-only verification mode were run; rollback was
not applied, so the local preview remains installed.

## Tests and visible verification boundary

**159 tests pass**, including the actual installed SDK and patched-renderer
method tests. After deployment, adapter tests use the original backup through
`PI_PENDANT_FIXTURE_PATH`; `PI_SDK_TEST_PATH` still uses the real installed SDK.
The original-hash assertions remain strict. Syntax checks and offline CLI smoke
also pass. Data is synthetic; no chat or new private credit request was sent.

VS Code was **not reloaded automatically**, because doing so could interrupt the
operator's active agent session. The existing webview may therefore still run its
previous in-memory code. Visible native-hover confirmation remains pending:

1. Save work and run **Developer: Reload Window** in VS Code.
2. Review any legitimate extension trust prompt yourself; no trust was forged.
3. Open Pendant, select WorkBuddy, and run `/workbuddy-tooltip on`.
4. Hover over the model name and inspect the actual credit rows.

The enable command initiates the approved read-only credit path, not inference.
The relay remains disabled by default until enabled. No environment/settings
change was made to force opt-in. If the UI fails after reload, the private backup
README contains the standalone recovery command for use from a terminal.

No commit, push, npm publish, or automatic host restart was performed in this
installation step.
