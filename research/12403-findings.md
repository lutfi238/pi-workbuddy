# HTTP 400 / 12403 — client version header

## User-reported failure

Pi 1.3.0 completed WorkBuddy login and saved credentials, but authenticated model discovery returned HTTP 400, business code 12403. Pi kept the fallback model; the active provider remained OpenAI Codex.

## Documentation lookup

Context7 was consulted first:

- `/websites/codebuddy_cn_workbuddy`: no matching documentation for 12403 or the international `/v3/config` contract.
- `/hanhan666666/codebuddy2openai`: third-party, China-oriented converter snippets enumerate a User-Agent header, but its `codebuddy2openai/2.0` example does not establish compatibility with this international request path. It is not an authoritative explanation of 12403.

Additional third-party corroboration was found through web search:

- https://github.com/Zhengyuuuui/workbuddy2api
- https://github.com/taikaikaikai-pixel/dsh-codebuddy-plugin/blob/main/AGENTS.md

These report version-parsing/User-Agent errors. The conclusions below are based on local shipped-code inspection plus bounded live **catalog-only** probes, not reliance on those reports alone.

## Shipped-code evidence

`app.asar!main/dev-env-override.js`, decoded UTF-16 character range `[625589,626447)`, contains `UserAgentHttpInterceptor`.

The interceptor assembles product/application and platform version tokens, retains an existing caller UA, and appends an optional client extension marker. Our native provider had omitted this version-aware UA on JSON requests, and Pi's SDK supplied a generic Pi UA for chat.

Retained ordinary source evidence: `research/user-agent-source.json`.

REA CLI analysis of the inert 858-character class-assignment fragment (one added trailing newline):

- `research/user-agent-evidence.json`
- ID `ev_cc86698f43377c1ea7268f2d455c96fcf66a1a6073079a64a0c6774de738573c`
- One file parsed, 859 text bytes, 203 AST nodes, zero parse failures.
- Semantic relationship coverage is **unknown**; external bindings are unresolved. This snapshot is not the whole app and REA did not observe execution.

The inspected installation version is 5.8.4. The fragment supplies the UA assembly behavior, not proof of a fixed minimum server version or successful inference.

## Live probes — no real credentials and no chat

All probes were GET requests to `https://www.workbuddy.ai/v3/config`, with redirects rejected and bounded timeouts. No desktop or Pi credential store was read. No browser actions, refresh-token requests, inference requests, or chat prompts were performed.

Results:

| Authentication metadata | User-Agent | HTTP / business code |
|---|---|---|
| None | Node default | 200 / 0 |
| Synthetic invalid token, no user ID | Node default | 200 / 0 |
| Synthetic invalid token and `mock-user` ID | Node default | **400 / 12403** |
| Same synthetic account metadata | `CLI/unknown CodeBuddy/5.8.4 pi-extension-workbuddy-ai/0.2.0` | 200 / 0 |
| Same synthetic account metadata | `CLI/unknown WorkBuddy/5.8.4 pi-extension-workbuddy-ai/0.2.0` | 200 / 0 |

The reproduced error message was exactly:

```text
check ua, get coding copilot version error
```

This establishes that this failure can be caused by missing/unrecognized UA version tokens once user metadata is supplied. The endpoint can also return a public/general catalog without valid credentials: **HTTP 200 here does not establish valid authentication or account-specific model entitlement**.

After applying the patch, a final probe through the actual native client and model projector, still using only synthetic invalid credentials, accepted **28 models**. That is a general catalog result, not proof that those models are callable by the user's account.

## Patch v0.2.1

- Added `src/client-identity.js` with a shared compatibility UA:
  `CLI/unknown WorkBuddy/5.8.4 pi-extension-workbuddy-ai/0.2.1`.
- `WorkBuddy/5.8.4` declares the inspected protocol compatibility baseline; the UA also retains our explicit extension identity. It does not assert that Pi is the official desktop application.
- Applied the same UA to JSON login/refresh/discovery requests, native request auth headers, and the final guarded chat fetch. Existing browser/auth credentials and endpoint restrictions were not changed.
- Added an allowlisted explanation for error 12403 without exposing arbitrary server messages.
- Added five regression tests for version consistency, header propagation, simulated 12403 rejection, SDK-UA replacement, and safe diagnostics.

Validation: 37 tests passed, including host integration with synthetic data; syntax checks, offline CLI smoke, and npm tarball inspection passed. No live account inference was tested.

## Remaining user verification

Reload the extension, refresh the catalog, and inspect local status. Do not ask the user to login again solely for 12403. If another error appears, diagnose that specific error without relaxing origin/credential restrictions. Ask for explicit consent before sending any quota-consuming chat.
