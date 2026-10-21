# pi-extension-workbuddy-ai

A **WorkBuddy AI** provider for [Pi](https://pi.dev), with browser-based account login and direct model access—**no separate bridge required**.

> **Experimental and unofficial.** Built from static inspection of WorkBuddy AI 5.8.4. A user has successfully completed browser login and a basic live conversation with `deepseek-v4.1-flash`. Tool calling, image input, and long-running token refresh have not yet been verified against the live service. Automated tests use synthetic credentials and responses, including Pi's built-in streaming implementation.

## Getting started

Requires Node.js ≥22.19 and Pi with native provider support. Tested with Pi CLI **1.3.0**.

From this directory:

```sh
pi -e ./extensions/workbuddy.js
```

Inside Pi:

1. Run `/login` and select **WorkBuddy AI**.
2. Complete the login yourself in the browser using the URL displayed by Pi.
3. After signing in, run `/workbuddy refresh`.
4. Run `/model` and select a model from the `workbuddy` provider.
5. Send a prompt. Chat requests consume your WorkBuddy account quota.

Press Escape to cancel login. Polling is limited to five minutes. You do not need to share a password or token with the agent, extract desktop credentials, install a bridge, or open a local callback port.

For an optional persistent installation:

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
| `/model` | Select a model after signing in |

Before discovery, the provider includes conservative fallback metadata for `default-model`. Models are not listed as available until authentication is configured. If discovery fails, the last known catalog is retained **in memory**; it is not persisted across restarts. Pi may invoke discovery during its refresh lifecycle, but the extension factory does not make network requests when loaded.

### Login succeeds, but discovery fails or Codex remains selected

The message `Logged in ... Credentials saved` means Pi completed the login. The browser may still open the original WorkBuddy application through a server-provided redirect; this does not invalidate Pi's successful login. Signing in does not automatically change the active model.

To diagnose discovery without sending a chat request:

```text
/reload
/workbuddy refresh
/workbuddy doctor
```

Refresh failures report safe categories such as `[http]` (HTTP status and business code), `[invalid-json]`, `[catalog-shape]`, `[catalog-empty]`, or `[catalog-filtered]` (counts by filter reason). Server messages and response bodies, model URLs, and tokens are not displayed. Do not sign in again or weaken endpoint restrictions before identifying the failure.

**HTTP 400 / 12403:** catalog probes with synthetic account metadata reproduced this error when the server could not parse the client version from the User-Agent. Version 0.2.1 adds the compatibility header `CLI/unknown WorkBuddy/5.8.4 pi-extension-workbuddy-ai/0.2.1` to discovery, token refresh, and chat transport. The WorkBuddy marker identifies the inspected protocol compatibility baseline; the extension still declares its own identity. Destination-origin restrictions remain unchanged, and no desktop credentials are used. Public catalog discovery alone does not prove account-specific model access. See the [12403 investigation](research/12403-findings.md).

To select the provider, run `/model` and search for `workbuddy`; selecting a model does not send a prompt. When troubleshooting with an agent, obtain explicit approval before sending quota-consuming inference requests. Never share `auth.json`, tokens, or login URLs.

## Implementation

- **Login:** a server-issued browser URL followed by polling `/v2/plugin/auth/token`. The UI uses Pi's native authentication mechanism; this is not a claim of an official public WorkBuddy OAuth integration.
- **Token refresh:** `/v2/plugin/auth/token/refresh`, with credential storage and refresh locking managed by Pi.
- **Catalog:** `GET https://www.workbuddy.ai/v3/config`.
- **Chat:** `POST https://www.workbuddy.ai/v2/chat/completions`.
- **Transport:** gzip requests, SSE framing and UTF-8 normalization, repeated or missing tool-call ID handling, usage tails, and cancellation.
- **Message conversion and streaming:** delegated to Pi's built-in OpenAI Chat Completions implementation. Payload, response, and provider-event hooks are forwarded.
- **Metadata:** context and output limits, reasoning efforts, image input, and sampling settings are projected from the catalog. Disabled models, models without tool support, and custom model URLs, protocols, or API keys are excluded.
- **Pricing:** model prices are set to zero because USD token rates are unknown—**this does not mean usage is free**. WorkBuddy's `usage.credit` field is not included in Pi's cost accounting; token usage is still processed.

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

Host tests cover coordinated login, storage and refresh, tool-call/result round trips, reasoning, Unicode, usage tails, instrumentation, empty and truncated streams, errors, and cancellation. The CLI smoke test uses an offline temporary profile with synthetic credentials and removes it afterward. **None of these automated tests sends a prompt to the live WorkBuddy service.**

Local investigation notes:
[authentication](research/workbuddy-auth-findings.md) ·
[chat protocol](research/workbuddy-protocol-findings.md) ·
[error 12403](research/12403-findings.md).

These notes are not included in the npm tarball. Raw third-party snapshots and generated evidence remain local and are excluded from Git; they are preserved verbatim rather than translated so their provenance and hashes remain valid. The authored documentation, code comments, user-facing messages, and test fixtures use English. Emoji in test fixtures intentionally exercise Unicode streaming.

Pi CLI setup instructions were checked against Context7 library `/earendil-works/pi/v1.3.0`.

## License

The extension code is licensed under MIT. Third-party application snapshots and generated evidence are not part of the distributed package.
