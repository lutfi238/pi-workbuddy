# WorkBuddy AI 5.8.4 — direct model protocol

> Historical inspection notes. The subsequent v0.2.0 implementation now provides native login/refresh/discovery/direct chat; only synthetic mock and Pi-host tests have been run. Statements below about unimplemented features describe the investigation stage, not the current code. See `../README.md`.

## Result and boundary

**Static inspection found a plausible direct-provider path: browser login → bearer token → OpenAI Chat Completions at `/v2/chat/completions`.** No separate local bridge appears necessary for that design. This is an implementation hypothesis, **not** a successful login/inference test or confirmation of third-party client support.

Scope: shipped files under `C:/Users/<user>/AppData/Local/Programs/WorkBuddyAI/resources` (username redacted for publication). No user profile, saved auth/session, logs, or credential databases read. No application code executed, HTTP requests made, browser opened, or prompts sent.

The extension itself is unchanged: it still implements the original local-bridge MVP.

## Source identity and reproducibility

- Installation version: **5.8.4**, from ASAR package manifest in the earlier auth inspection.
- `app.asar` SHA-256: `026a1d0805a2366d06390cef52e157a7277543cdd27dd308e6b1acb47ffffdc1`.
- CLI `cli/dist/codebuddy-lite-wb.mjs` SHA-256: `7d51bb147e224a2772ffca521958d0b05740af1195469564b60a88f05f8f93cf`.
- SDK lazy chunk `cli/dist/lazy-lite-wb/4354.f4e1e1f7.mjs` SHA-256: `b4248ce4c4ec43d56bdbe973110ca107fc6193b51d8f453549f0cae190f41c92`.
- Bounded original-source excerpts, ranges, hashes, and projected model metadata: `research/protocol-source-evidence.json`.
- Reproduce those excerpts without executing target code:

```sh
node scripts/collect-protocol-evidence.mjs 'C:/Users/<user>/AppData/Local/Programs/WorkBuddyAI'
```

Excerpt IDs below refer to that JSON. Ranges are UTF-16 character offsets in decoded source, **not** ASAR byte offsets. These are ordinary static source observations, not REA-generated semantic claims.

## 1. Chat endpoint — answered statically

Observed chain:

1. CLI `getModel()` resolves model metadata and calls `createClient()`.
2. `buildOpenAIClientOptions()` installs a custom Axios/fetch adapter on an OpenAI SDK client.
3. `resolveModelBaseURL()` defaults to `${productEndpoint}/v2`.
4. SDK `Completions.create()` performs POST `/chat/completions`.
5. Product defaults set `endpoint: https://www.workbuddy.ai`.

**Inferred default URL:** `POST https://www.workbuddy.ai/v2/chat/completions`.

Sources: `client-base-url` (CLI 3707349), `completion-sdk-post` (SDK 55996); `getModel` and client creation directly follow/precede the base-URL excerpt in the CLI.

Exceptions in the code: model-specific `url`, explicit base-URL environment override, deployment/environment configuration, custom protocol, and origin failover. Consequently the default URL is not evidence of the endpoint selected by the currently running app.

## 2. Request body — answered statically

SDK `OpenAIChatCompletionsModel` constructs:

```json
{
  "model": "<catalog-model-id>",
  "messages": [{ "role": "user", "content": "<prompt>" }],
  "stream": true,
  "stream_options": { "include_usage": true }
}
```

Optional fields observed in the same constructor:

- `tools`: OpenAI `{ type: "function", function: { name, description, parameters, strict } }`.
- `tool_choice`: `auto`, `required`, `none`, or a named function object.
- `parallel_tool_calls` when explicitly configured.
- `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `max_tokens`.
- `reasoning_effort` from model reasoning settings; `reasoning_summary: "auto"` can be injected by the adapter.
- `response_format`, `store`, `prompt_cache_retention`, provider-specific fields.

Source: `request-body` (SDK 176253); CLI `injectReasoningSummaryIfNeeded` near 3671000.

This is a representative synthetic body, not a captured real request. It intentionally contains no application system prompt, real message, or credential.

### Request processing details

- Assistant function arguments are JSON **strings**, not nested raw objects.
- Tool-result messages use `role: "tool"`, matching `tool_call_id`, and text `content`.
- SDK input conversion preserves assistant reasoning as `reasoning`, and propagates some `extra_fields` metadata. Some model/tool continuations may require those fields; do not discard them indiscriminately.
- The app removes empty user/assistant content where inappropriate, invalid tool calls and orphaned results, and a trailing assistant without tool calls.
- Images are normalized to OpenAI `image_url` parts. Metadata support does not prove that every account/model accepts them.

Sources: `tool-history-conversion` (SDK 169575), `request-normalization` (CLI 3729642).

### Gzip

The shipped product enables `RequestBodyGzip: true`. `GzipRequestProcessor` runs late (priority 9999) and gzip-compresses POST bodies when the feature/environment permits, adding `Content-Encoding: gzip`. It skips custom base URLs and model-specific URL overrides.

Source: `gzip` (CLI 3739649), `shippedDefaults.requestBodyGzip` in source evidence.

**Unknown:** whether the server requires gzip or also accepts plain JSON. A native provider should support gzip or explicitly validate uncompressed transport; static code does not establish server acceptance.

## 3. Authentication and request headers — partially answered

Observed headers in interceptors/adapter, **not a proven minimum required by the server**:

| Header | Source/value behavior |
|---|---|
| `Authorization` | `Bearer <accessToken>` from current session or explicit request auth |
| `X-User-Id` | Authenticated `account.uid` |
| `X-Domain` | `auth.domain` when present; auth methods otherwise derive authority from product endpoint |
| `X-Enterprise-Id`, `X-Tenant-Id` | Only when the authenticated account has an enterprise ID |
| `X-Department-Info` | When account metadata supplies it |
| `X-Product` | Deployment type, shipped default `SaaS` |
| `X-Requested-With` | Framework client default `XMLHttpRequest`; explicitly used by desktop config fetch |
| `X-Conversation-ID` | Session ID |
| `X-Conversation-Request-ID` | Conversation/turn request ID |
| `X-Conversation-Message-ID`, `X-Request-ID` | Per-model-request message ID |
| `X-Agent-Intent` | Current mode; adapter fallback `craft` |
| `X-Agent-Purpose`, `X-Agent-Type` | Agent context |
| `X-IDE-Type`, `X-IDE-Name`, `X-IDE-Version` | Client info, which can be overridden by session telemetry metadata |
| `X-Private-Data` | `true`/`false` derived from model-optimization setting; not an auth credential |
| `Content-Type`, `Accept` | JSON request / SSE negotiation as appropriate |

Additional trace headers (`traceparent`, B3 family) and optional root/parent/compaction metadata exist. They have not been shown to be authentication requirements.

Sources: `request-adapter` (CLI 3683139), `auth-interceptor` (7075231), `product-header` (8643871), `header-names` (8459004). `getCustomHeaders` immediately before the adapter provides the privacy setting.

The API-key route also sets `X-API-Key`, but that is separate from account bearer login. **Do not put a refresh token into `Authorization` or `X-API-Key`.**

No request-signing requirement was established by this bounded inspection. This does **not** prove the absence of device/client policy or additional interceptors.

## 4. Model catalog — answered statically, live availability unknown

Default route: **GET `https://www.workbuddy.ai/v3/config`**.

- Desktop coordinator explicitly uses authenticated GET with `Authorization`, `X-Product`, and `X-Requested-With`; shared interceptors can add user/domain/enterprise metadata.
- Config fetch reads `HTTP_JSON.data` as the configuration object (Axios `response.data.data`), not `{ data: [{ id }] }` like `/v1/models`.
- Relevant members include `models`, `agents[].models`, product features and policy. Some responses/models are merged with shipped defaults by ID.
- Remote endpoint overrides are removed by product providers; arbitrary config data must not become an unrestricted token destination.
- Empty/failed configuration does not replace last-good catalog state.
- The app can send repository URLs as optional `repos` query params in one config-fetch path. A Pi implementation should **not** send repository metadata for basic discovery.

Sources: `desktop-catalog` (coordinator 40288), `catalog-manager` (CLI 8615449), `catalog-default-route` (8621324).

The shipped catalog has **30 model entries**, including `default-model`, `hy3`, `hy4-preview`, and `deepseek-v4.1-flash`. These are artifact identifiers, **not proof of access, model identity, or current service availability**. Do not advertise the original bridge fallback `auto` as a verified native model ID.

Metadata fields useful for Pi mapping:

- `id`, `name`, `disabled`;
- `maxInputTokens`, `maxOutputTokens`, `maxAllowedSize`;
- `supportsToolCall`, `supportsImages`, `supportsReasoning`, `onlyReasoning`;
- `contextWindow.defaultLength` / `supportedLengths`;
- `reasoning.defaultEffort`, `supportedEfforts`, `canDisableThinking`;
- sampling defaults and potential per-model URL/protocol overrides.

Examples observed: `hy3` is marked reasoning-only with low/high efforts; `deepseek-v4.1-flash` has a default context length smaller than its advertised maximum. Blindly mapping all models to 1M context or allowing thinking off would be incorrect. Prices/credit multipliers are not a verified USD token tariff.

## 5. Streaming, tools, and usage — answered statically

Protocol in inspected parser: **SSE** `data: <JSON>` with `[DONE]` handling.

Observed JSON fields:

- `choices[].delta.content` for text;
- `choices[].delta.reasoning_content` or `.reasoning` for thinking;
- `choices[].delta.tool_calls[]` for function calls;
- `choices[].finish_reason`;
- `usage.prompt_tokens`, `completion_tokens`, `total_tokens`;
- `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens`;
- WorkBuddy-specific `usage.credit` (not interchangeable with tokens or USD).

Tool calls accumulate fragmented `function.arguments` and `function.name` by index, using IDs to recover missing indexes in the SDK converter. There is a normalization pass for repeated tool IDs and a narrow correction of arguments starting with `{}{`. These are **observed client workarounds**, not evidence that every response contains those defects.

Usage can arrive after `finish_reason`, in a tail chunk with no content choices. Do not end parsing at the first finish reason and lose final accounting. Stream cancellation destroys the upstream request/stream; no general remote cancellation endpoint for hosted models was established.

Sources: `sse-fields` (CLI 3665564), `repeated-tool-ids` (3667431), `stream-conversion` (SDK 163637); stream lifecycle handling directly inspected in CLI 3688000–3707000.

## 6. Recommended native-provider implementation

Design choices, not already implemented:

1. Browser-login/polling and refresh as recorded in `workbuddy-auth-findings.md`, stored via Pi's auth mechanism. Do not import the desktop's existing credentials.
2. Cache token plus required account/domain metadata. Bind native WorkBuddy credentials to explicitly trusted HTTPS origins; reject cross-origin redirects and unreviewed model URL overrides.
3. Discover `/v3/config` after login, validate/project only model capabilities, and keep a last-good catalog. Do not import remote tools, prompts, commands, or repository metadata behavior.
4. Reuse Pi's OpenAI conversion/stream implementation where its API supports the required transport and request hooks. If gzip or SSE normalization cannot be represented there, add a narrowly scoped transport adapter rather than copying the full agent/SDK.
5. Preserve reasoning/tool-call continuity; ensure chunk-boundary-safe SSE/UTF-8 handling and final usage accounting.
6. Prefer accurately identified Pi client metadata over impersonating an unrelated client. Whether the service permits third-party clients remains unresolved.
7. Mock-test login pending/cancel/timeout, refresh, config discovery, text, split tool arguments, tool results, reasoning, usage tails, malformed/error streams, abort, and origin rejection before live testing.
8. Only then let the user complete browser login and perform a minimal explicit live chat/tool test. It may consume account quota.

## 7. REA evidence and limits

Previous full-ASAR integrity/time-budget limitations still apply; see the auth report. They were not bypassed for code execution.

For this pass, a new **bounded extracted snapshot** was analyzed using installed REA CLI 6.7.0:

- `main/workbuddy-auth-product-coordinator.js`;
- `main/env-product-provider.js`.

Evidence: `research/protocol-evidence.json`, ID
`ev_6576f291b21e9123344247c21bce203cdd6c2e499008ddbb2fcc08b32fe24d36`.

Snapshot root SHA-256: `5c225b726aaa15bd4d7adb40ad3afcb83b4a048c896056581117a55434936103`.

REA reports 2 parsed JS files, 58,884 text bytes, 13,971 visited AST nodes, 0 parse failures. **Semantic relationship coverage is partial/truncated**, including unknown-retention capacity limits. Dependencies outside these two files are unresolved; the extracted snapshot is not the full app. Extraction adds one trailing newline, so snapshot hashes differ from original packed members.

This REA record does not cover the CLI/SDK chat parser. Those findings are separately retained as ordinary source inspection in `protocol-source-evidence.json`. No static evidence establishes successful runtime requests.

## Checklist

| Question | Status |
|---|---|
| Default chat URL and request protocol | Answered statically |
| Config/catalog URL and projection | Answered statically |
| Streaming/tool/usage field mapping | Answered statically |
| Header construction | Observed; server-required minimum unknown |
| Gzip behavior | Observed; plain-JSON server acceptance unknown |
| Browser login + refresh | Static contract from earlier pass; untested |
| Current account model access / third-party permission | Unknown |
| End-to-end Pi integration | Not implemented/tested |
