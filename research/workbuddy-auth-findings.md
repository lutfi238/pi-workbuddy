# WorkBuddy AI: local authentication inspection

> Historical inspection notes. Subsequent implementation v0.2.0 adds native Pi login/refresh and direct chat, verified with synthetic mocks and the Pi host only. Live WorkBuddy behavior remains unverified. See `../README.md` for the current implementation status.

## Scope

Read-only static inspection of the operator-supplied installation:
`C:/Users/<user>/AppData/Local/Programs/WorkBuddyAI` (username redacted for publication).

No application code executed, browser opened, auth request made, credential store read, or installation modified.

## Identity

- ASAR package manifest: `@genie/workbuddy-desktop`, version **5.8.4**, main `main/index.js`, homepage `https://www.workbuddy.ai`.
- ASAR SHA-256: `026a1d0805a2366d06390cef52e157a7277543cdd27dd308e6b1acb47ffffdc1`.
- Shipped `resources/app.asar.unpacked/cli/product.json`, lines 11–57:
  - endpoint `https://www.workbuddy.ai`;
  - auth id `workbuddy-desktop-ai`, type `cli-external-link`;
  - prefix `/plugin`, platform `workbuddy-ai`;
  - bearer Authorization and `X-User-Id`.

These are shipped defaults, not proof of the current runtime configuration.

## Authentication contract observed in code

Source: packed `main/dev-env-override.js`, UTF-16 character offset **1402502** starts `ExternalLinkAuthenticationProvider=class`. Offsets are character offsets in decoded JS, not ASAR byte positions.

Static methods:
1. `fetchAuthState`: POST `/v2${prefixPath}/auth/state?platform=${platform}`, JSON `{}`. Reads response `data.data`, including `authUrl` and `state`.
2. `openAuthUrl`: opens server-provided auth URL; appends optional version/journey/device parameters.
3. `loopGetToken`: GET `/v2${prefixPath}/auth/token?state=${state}`. Reads token from response `data`; code 11217 means pending.
4. `loopGetAccount`: GET `/v2${prefixPath}/login/account?state=${state}` with bearer access token. Code 12151 means pending.
5. `getAccountSnapshot`: GET `/v2${prefixPath}/accounts`.
6. `refreshSession`: POST `/v2${prefixPath}/auth/token/refresh`, JSON `{}`, headers `X-Refresh-Token`, `X-Auth-Refresh-Source: plugin`, domain headers.
7. `calculateExpiresAt`: expiry from `expiresIn` seconds if `expiresAt` absent.
8. Poll interval 1000 ms; total pending timeout 300000 ms (constants near offset 1402284).
9. Domain header constant `X-Domain` (offset 1289269).

CLI bundle `cli/dist/codebuddy-lite-wb.mjs`, near offset 3424165:
environment auth provider subclasses `ExternalLinkAuthenticationProvider` and supports `cli-external-link`. This links the product auth type to the base provider above.

**Inference:** with shipped defaults, initial URL is
`https://www.workbuddy.ai/v2/plugin/auth/state?platform=workbuddy-ai`.
This appears to be server-issued browser login plus token polling, not evidence of a public OAuth authorization-code/PKCE registration for third-party apps.

## Feasible Pi design (not implemented yet)

Pi's provider login callback can present the auth URL and poll until credentials arrive, then return credentials for Pi's auth storage. Refresh can map the observed refresh route.

A native `/login → WorkBuddy` UX therefore appears feasible without a separately running bridge. This is not yet confirmed to work against the service. Do not expose a successful login entry that still routes inference through the old local bridge.

The present extension is still the bridge MVP. Login, refresh, and direct inference have **not** been implemented.

## Unknowns / remaining work

- Extra auth-state header providers and product overrides used by this desktop build.
- Live acceptance of state initiation/polling from Pi; browser/platform constraints.
- Exact token response shape and expiry behavior in a real login.
- Direct inference URL, protocol, request headers, model catalog, tool-call and stream conversion: subsequently traced statically in [workbuddy-protocol-findings.md](workbuddy-protocol-findings.md). Live behavior remains unverified.
- WorkBuddy's third-party client authorization/terms.
- Runtime/end-to-end verification; do not copy the desktop's stored account token as a substitute.

## REA evidence and limitations

REA 6.7.0 MCP was not connected; CLI used without changing MCP configuration.

Full ASAR analysis initially rejected an integrity mismatch for unpacked
`cli/bin/native/win32-x64/job-object.node`. Native files can change during signing, but the cause is **unknown** here. A record-and-continue static-only attempt timed out while sealing the application graph; no complete full-application Evidence was obtained. No native binary was executed and no integrity check was bypassed for execution.

A smaller extracted snapshot (`package.json` and `main/register-auth-host-capabilities.js`) was analyzed successfully:
`research/snapshot-evidence.json`,
Evidence ID `ev_44c3fa2cbb18aea6e2f90ea1c886c5703c38993a8557a058ba3f74dbb9c5063b`.
This Evidence covers only those two files, **not** the authentication contract. The contract above is separately labeled ordinary shell/source inspection, reproducible with `scripts/inspect-workbuddy.mjs`.

Snapshot extraction prints source with an added trailing newline. The snapshot digest is not the original ASAR digest. The ASAR reader never imports or executes extracted code.
