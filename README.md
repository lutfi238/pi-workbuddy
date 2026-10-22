# pi-workbuddy

A **WorkBuddy AI** provider for [Pi](https://pi.dev), with browser-based account login and direct model access—**no separate bridge required**.

> **Experimental and unofficial.** Built from static inspection of WorkBuddy AI 5.8.4. A user has successfully completed browser login and a basic live conversation with `deepseek-v4.1-flash`. Tool calling, image input, and long-running token refresh have not yet been verified against the live service. Automated tests use synthetic credentials and responses, including Pi's built-in streaming implementation.

## Getting started

Requires Node.js ≥22.19 and Pi with native provider support. Tested with Pi CLI **1.3.0** and Pendant 0.41.0's bundled Pi SDK **1.2.0**.

Install the published npm package:

```sh
pi install npm:pi-workbuddy
```

Or install directly from GitHub:

```sh
pi install git:github.com/lutfi238/pi-workbuddy
```

Then start `pi`. For local development, run `pi -e ./extensions/workbuddy.js` from the repository instead. Use only one installation source to avoid loading the provider twice.

Inside Pi:

1. Run `/login` and select **WorkBuddy AI**.
2. Complete the login yourself in the browser using the URL displayed by Pi.
3. Run `/model`; Pi refreshes model catalogs in the background. Wait for the refresh to finish, then select a model from the `workbuddy` provider.
4. If you need to force discovery or diagnose a failure, run `/workbuddy refresh`.
5. Send a prompt. Chat requests consume your WorkBuddy account quota.

Press Escape to cancel login. Polling is limited to five minutes. You do not need to share a password or token with the agent, extract desktop credentials, install a bridge, or open a local callback port.

For an optional persistent installation from a local checkout:

```sh
pi install .
```

Use `/reload` after updating a loaded extension. To sign out, run `/logout` and select WorkBuddy. This removes Pi's local credentials; it does not revoke every server-side account session or sign out the desktop application.

### Commands

| Command | Behavior |
|---|---|
| `/login` → WorkBuddy AI | Browser login with credentials stored by Pi |
| `/logout` → WorkBuddy AI | Remove Pi's local WorkBuddy credentials |
| `/workbuddy status` or `/workbuddy doctor` | Show local configuration, catalog source, active model, and the last sanitized catalog error; no network requests |
| `/workbuddy refresh` | Fetch the authenticated catalog, refreshing the token if needed |
| `/model` | Refresh model catalogs in the background and select a model |

Before discovery or cache restoration, the provider includes fallback metadata for `default-model`. Models are not available until authentication is configured. Successful catalogs are persisted through **Pi's model store** as projected public metadata, scoped by a hash of the account origin/user/domain/tenant (never access or refresh tokens). Cached models are revalidated on restoration, including removal of DeepSeek `-sg` variants. A failed refresh retains the last known catalog. The extension factory itself makes no network requests.

### Automatic model discovery

There is no hardcoded allowlist of WorkBuddy model IDs. The provider fetches `/v3/config` with the signed-in account and projects compatible model entries into Pi. In Pi 1.3.0, opening `/model` refreshes provider catalogs in the background and updates the picker when discovery finishes. Pi also refreshes catalogs after login; `/workbuddy refresh` is the explicit manual override.

A newly advertised model can therefore appear without changing the extension or adding its ID manually. The model must pass the existing compatibility and security filters: disabled models, models explicitly lacking tool support, and custom endpoints/protocols/API keys are excluded. Starting with 0.2.2, DeepSeek variants ending in `-sg` are intentionally excluded, including after catalog refresh; the regular DeepSeek models remain available. Catalog visibility does not guarantee that your account can run every listed model.

A `session_start` hook refreshes only WorkBuddy using the registry's default network policy and honors `PI_OFFLINE` (also set by Pi CLI `--offline`). This covers embedded hosts that re-register a provider but do not refetch an already-seen provider ID. Offline provider refreshes can restore a matching cached catalog without network access.

This is refresh-based discovery, not a realtime push subscription or continuous idle polling. Reopen `/model` to check for additions during a long session. Extension updates may still be necessary if WorkBuddy changes its API, authentication, metadata schema, or wire protocol.

### Pendant / VS Code stays on WorkBuddy Default (fallback)

Version **0.2.3** restores cached catalogs after provider re-registration and refreshes WorkBuddy at session startup. It also replaces an active bootstrap fallback with fresh metadata for the same ID. For resumed sessions, it reads only the latest model-change record; a removed DeepSeek `-sg` selection is restored to its exact non-SG counterpart if available. It does not change another provider, overwrite a newer observed selection, edit global defaults, or send a chat request. `/workbuddy refresh` also repairs stale active-model metadata.

After the 0.2.3 release is published, update the package used by the host and reload the session. Restarting an old installed copy will not pick up repository changes. `/workbuddy doctor` reports the loaded extension version and `catalog=fallback`, `cache`, or `remote`; share only this sanitized diagnostic, never credentials. A genuine network/authentication error with no usable cache still requires resolving the error; no fabricated catalog is substituted.

### Package published, but absent from gallery search

The [direct package page](https://pi.dev/packages/pi-workbuddy) can work before the searchable gallery includes the package. npm publication and Pi gallery discovery are separate. Confirm the public npm version and the `pi-package` keyword before assuming a publishing failure. See the [reported npm-search discovery issue](https://github.com/earendil-works/pi/issues/7885). Do not repeatedly publish identical releases just to try to trigger gallery indexing.

### Login succeeds, but discovery fails or Codex remains selected

The message `Logged in ... Credentials saved` means Pi completed the login. The browser may still open the original WorkBuddy application through a server-provided redirect; this does not invalidate Pi's successful login. Signing in does not automatically change the active model.

To diagnose discovery without sending a chat request:

```text
/reload
/workbuddy refresh
/workbuddy doctor
```

Refresh failures report safe categories such as `[http]` (HTTP status and business code), `[invalid-json]`, `[catalog-shape]`, `[catalog-empty]`, or `[catalog-filtered]` (counts by filter reason). Server messages and response bodies, model URLs, and tokens are not displayed. Do not sign in again or weaken endpoint restrictions before identifying the failure.

**HTTP 400 / 12403:** catalog probes with synthetic account metadata reproduced this error when the server could not parse the client version from the User-Agent. Version 0.2.1 adds the compatibility header `CLI/unknown WorkBuddy/5.8.4 pi-workbuddy/0.2.1` to discovery, token refresh, and chat transport. The WorkBuddy marker identifies the inspected protocol compatibility baseline; the extension still declares its own identity. Destination-origin restrictions remain unchanged, and no desktop credentials are used. Public catalog discovery alone does not prove account-specific model access. See the [12403 investigation](research/12403-findings.md).

To select the provider, run `/model` and search for `workbuddy`; selecting a model does not send a prompt. When troubleshooting with an agent, obtain explicit approval before sending quota-consuming inference requests. Never share `auth.json`, tokens, or login URLs.

## Implementation

- **Login:** a server-issued browser URL followed by polling `/v2/plugin/auth/token`. The UI uses Pi's native authentication mechanism; this is not a claim of an official public WorkBuddy OAuth integration.
- **Token refresh:** `/v2/plugin/auth/token/refresh`, with credential storage and refresh locking managed by Pi.
- **Catalog:** `GET https://www.workbuddy.ai/v3/config`.
- **Chat:** `POST https://www.workbuddy.ai/v2/chat/completions`.
- **Transport:** gzip requests, SSE framing and UTF-8 normalization, repeated or missing tool-call ID handling, usage tails, and cancellation.
- **Message conversion and streaming:** delegated to Pi's built-in OpenAI Chat Completions implementation. Payload, response, and provider-event hooks are forwarded.
- **Metadata:** live catalog metadata is supplemented with reviewed official vendor specifications for 23 named models. Context/output use the largest documented or advertised values, not smaller catalog defaults. Image support and reasoning efforts are additive. Routing aliases and newly discovered IDs remain catalog-driven; the reference table is not an allowlist. Disabled models, models without tool support, and custom model URLs, protocols, or API keys are excluded.
- **Pricing:** model prices are set to zero because USD token rates are unknown—**this does not mean usage is free**. WorkBuddy's `usage.credit` field is not included in Pi's cost accounting; token usage is still processed.

### Context and output budgets

The default policy is **documented maximum capabilities**, not a conservative gateway-default policy. Context uses the largest positive safe integer among the catalog's input limit, configured context default, supported context lengths, and reviewed vendor context reference. Output similarly uses the larger catalog/vendor maximum, bounded by the shared context budget. Smaller catalog defaults do not reduce these maxima, and a larger live value is never reduced by an older vendor reference.

For example, DeepSeek V4.1 Flash now advertises **1,048,576 context tokens**, **393,216 maximum output tokens**, image input, and **low/high/max** thinking. It no longer stays at the catalog's 300K default. Named preview variants use their base-model references optimistically; identical gateway deployments are not guaranteed. DeepSeek `-sg` variants are not offered. Four routing aliases retain their own live metadata instead of inheriting an invented vendor identity.

Image support is enabled when either WorkBuddy or the reviewed vendor reference advertises it, even if gateway metadata disables multimodal input. Supported reasoning efforts combine both sources. Known mandatory-thinking models cannot turn thinking off; Kimi K2.6 uses a thinking toggle rather than an unsupported vendor `reasoning_effort` parameter. Pi exposes text/image input, not every vendor-native audio, video, or hosted-tool feature.

Fallbacks of 32,768 context / 4,096 output apply **only when neither source supplies the corresponding usable limit**. `maxAllowedSize` remains excluded because its units are unverified. Output is never added to input to invent a larger context. Rounded vendor notation such as 1M or 256K is normalized decimally where no exact integer is published; exact documented integers are used when available. Kimi completion ceilings share context with input; they are not independent additional output capacity. Grok's unspecified finite output cap and Kimi K2.8's unpublished output maximum retain the catalog value.

Smaller explicit output requests remain supported; sampling and payload hooks cannot exceed the resulting model maximum or bypass Pi's remaining-context adjustment. Normal Pi `streamSimple` requests additionally fit output to estimated remaining context, including Pi 1.3.0's 4,096-token safety margin. This is distinct from the default 16,384-token compaction reserve. Full API `stream` callers still own input/remaining-context budgeting.

**Optimistic does not mean live-verified:** vendor API limits/features may differ from WorkBuddy routing, account access, or gateway protocol support. OpenAI's native GPT-6 tool/endpoint restrictions, for example, do not establish whether WorkBuddy translates its own chat endpoint. Models are not disabled preemptively for this uncertainty. Actual errors should drive targeted compatibility fixes, rather than blanket reductions. There is no automatic downgrade, retry with another model, or quota-consuming capability probe.

See the current [capability policy](research/capability-policy.md), [vendor references](research/vendor-capability-comparison.md), and historical [context-limit audit](research/context-limit-audit.md). No global Pi compaction settings are changed by the extension.

### Native configuration

```powershell
# Default mode:
$env:WORKBUDDY_MODE = "native"

# Only when testing plain-JSON transport compatibility:
$env:WORKBUDDY_GZIP = "0"
pi -e ./extensions/workbuddy.js
```

Gzip is enabled by default. Bridge URLs and API keys are not used in native mode. The native origin cannot be changed through environment variables; an official endpoint change requires code review and testing.

The `.env.example` file is a reference only: Pi and this extension do **not** automatically load `.env` files. Set variables in the shell or process that starts Pi.

## Security and limitations

- Pi stores credentials in its agent profile (`auth.json`), not in the project. Protect that file; never commit or share it.
- The extension does not read the desktop application's credentials, databases, cookies, or sessions.
- Authentication, discovery, and chat requests target only the HTTPS origin `www.workbuddy.ai`; HTTP redirects are rejected. Recognized production WorkBuddy/CodeBuddy account domains are used only as header values, not destination URLs.
- Browser login URLs must use recognized production WorkBuddy/CodeBuddy origins. Login URLs can contain sensitive state; do not share them or screenshots containing them.
- Remote configuration cannot import prompts, tools, commands, credentials, or model URLs into this extension. Discovery does not send a list of repositories.
- `X-Private-Data: true` is a conservative privacy default, **not a guarantee** of the server's retention policy.
- Errors are sanitized. The extension does not log tokens or upstream error bodies. Pi's debugging features and other extensions remain within Pi's trust boundary.
- Catalog entries do not prove that a model is available to your account. Reasoning and image capabilities are not fully verified live; opaque `extra_fields` and model-specific behavior may require additional adapters.
- This version targets the inspected international production service, not the China edition, custom enterprise SSO, staging deployments, or arbitrary hosts.
- The service may reject third-party clients, change its protocol, or impose usage terms. This extension does not bypass authentication, account permissions, or quota limits.
- If login fails, do not paste tokens as a workaround. Record only the sanitized HTTP/business code and investigate compatibility.

## Legacy bridge mode (optional)

The original bridge integration is still available, but it does **not** provide native account login:

```powershell
$env:WORKBUDDY_MODE = "bridge"
$env:WORKBUDDY_BASE_URL = "http://127.0.0.1:8787/v1"
# Set this if the bridge validates a local API key:
$env:WORKBUDDY_API_KEY = "your-local-bridge-key"
pi -e ./extensions/workbuddy.js
```

The bridge uses a separate provider ID, `workbuddy-bridge`, so native account credentials are not reused as a bridge API key. The default placeholder, `workbuddy-local`, is suitable only for bridges that do not validate API keys.

Third-party bridges identified during research:

- [workbuddy-connect-api](https://github.com/modersetech/workbuddy-connect-api), default port 8787.
- [workbuddy-bridge](https://github.com/hanhan1223/workbuddy-bridge), default port 8799.

Review their security and upstream instructions before use. The extension does not install or launch either bridge automatically.

Additional bridge variables:

| Variable | Default | Purpose |
|---|---|---|
| `WORKBUDDY_MODELS` | `auto` | Comma-separated fallback model IDs |
| `WORKBUDDY_CONTEXT_WINDOW` | `32768` | Assumed context limit |
| `WORKBUDDY_MAX_TOKENS` | `4096` | Assumed output limit |
| `WORKBUDDY_TIMEOUT_MS` | `3000` | Discovery timeout in milliseconds |

## Development and tests

There are no runtime dependencies beyond the packages provided by Pi. Host packages are declared as peers, not bundled or installed again by the project.

```sh
npm test
npm run check
npm pack --dry-run
```

Host integration tests are optional and skipped unless `PI_AI_TEST_PATH` is set. To use an existing Pi installation, point it to the `pi-ai/dist` directory:

```powershell
$env:PI_AI_TEST_PATH = "C:/path/to/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist"
npm test
node scripts/smoke-cli.mjs "C:/path/to/pi-coding-agent/dist/bundle/cli.js"
```

To additionally test against an installed Pendant bundle (no live credentials or inference):

```powershell
$env:PI_SDK_TEST_PATH = "C:/path/to/pendant/dist/pi-sdk.cjs"
npm test
```

Pendant integration tests instantiate its actual `ModelRuntime`, resource services, session manager, and `session_start` bindings. They cover provider re-registration, offline cache restoration in a fresh runtime, startup fallback repair, and migration of a saved DeepSeek SG selection. Cache tests cover account isolation, secret/endpoint stripping, malformed entries, failed refreshes, and generation rejection.

Host tests cover coordinated login, storage and refresh, tool-call/result round trips, reasoning, Unicode, usage tails, instrumentation, empty and truncated streams, errors, and cancellation. The CLI smoke test uses an offline temporary profile with synthetic credentials and removes it afterward. **None of these automated tests sends a prompt to the live WorkBuddy service.**

Local investigation notes:
[authentication](research/workbuddy-auth-findings.md) ·
[chat protocol](research/workbuddy-protocol-findings.md) ·
[error 12403](research/12403-findings.md) ·
[context-limit audit](research/context-limit-audit.md) ·
[Pendant recovery and gallery findings](research/pendant-recovery-findings.md).

These notes are not included in the npm tarball. Raw third-party snapshots and generated evidence remain local and are excluded from Git; they are preserved verbatim rather than translated so their provenance and hashes remain valid. The authored documentation, code comments, user-facing messages, and test fixtures use English. Emoji in test fixtures intentionally exercise Unicode streaming.

Pi CLI setup instructions were checked against Context7 library `/earendil-works/pi/v1.3.0`.

## License

The extension code is licensed under MIT. Third-party application snapshots and generated evidence are not part of the distributed package.
