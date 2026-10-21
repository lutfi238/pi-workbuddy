# Maximum-capability policy

## Operator decision

Use the fullest documented/advertised per-model capabilities rather than
preemptively selecting smaller gateway defaults. Adjust compatibility in response
to actual usage errors instead of blanket restrictions. Operator screenshots
confirm that WorkBuddy itself offers DeepSeek V4.1 Flash a 300K/1M context choice
and low/high/max thinking. This replaces the initial conservative projection in
[context-limit-audit.md](context-limit-audit.md).

## Implemented behavior

- `src/native-capabilities.js` contains reviewed public vendor references for all
  **24 named models** in the checked catalog. The four routing aliases use live
  metadata; their vendor identities are not guessed.
- Context is the largest valid positive safe integer from vendor context, catalog
  input, context default, and supported context choices. Supported context choices
  are not discarded just because a separate input field is smaller.
- Output is the larger valid catalog/vendor output value, bounded by the resulting
  shared context. Smaller defaults do not override maxima. Input and output are
  never added to manufacture a total window.
- Image support is additive: either source can enable it. A catalog-only image
  capability is retained even when the underlying vendor model is text-only;
  gateway preprocessing is possible. A vendor image capability is exposed even
  when gateway metadata marks multimodal disabled. This is intentionally optimistic.
- Reasoning capability and effort lists are additive. Known mandatory-thinking
  models retain no-off semantics. Kimi K2.6 uses Pi's thinking-toggle serialization
  without inventing native support for `reasoning_effort`, unless the gateway
  explicitly advertises effort controls.
- Unknown future IDs remain discoverable immediately. The vendor registry is not
  an ID allowlist and does not trigger browser scraping or vendor API requests.
- Missing values alone fall back to 32,768 context / 4,096 output. Unverified
  `maxAllowedSize` units are not silently assumed to be tokens.
- Existing trusted-endpoint, authentication, credential, disabled-model, and
  tool-capable-model protections remain unchanged. Maximum capabilities do not
  bypass account permissions or quota.
- Smaller explicit output budgets are honored. The declared maximum and Pi's
  remaining-context adjustment still apply; the policy removes artificial
  smaller-default ceilings, not shared-context arithmetic or integer validation.
- No automatic downgrade, model substitution, or live inference probe is introduced.

## Numeric conventions and mapping assumptions

Exact documented integers take precedence when available. DeepSeek's vendor
[Codex integration](https://api-docs.deepseek.com/quick_start/agent_integrations/codex)
uses 1,048,576 context, and its
[chat API](https://api-docs.deepseek.com/api/create-chat-completion) specifies
393,216 maximum output. WorkBuddy's screenshot and catalog call its own larger
choice 1M/1,000,000. The implemented optimistic vendor-reference value is
1,048,576, **not a live-verified WorkBuddy capacity claim**.

Where a source publishes only rounded notation such as 1M or 256K, the registry
uses decimal normalization (1,000,000 / 256,000). These are operational reference
budgets, not claims that the source published an exact integer. A larger exact
live value wins. Future evidence can correct individual values without globally
shrinking other models.

The regional DeepSeek `-sg` entry uses the named base model's specifications.
Kimi K2.8 Preview uses Kimi Code's named-model reference even though that API calls
it `kimi-for-coding`. Both mappings are optimistic assumptions, not independently
verified deployment identity.

Kimi K2.6's output ceiling shares its 262,144-token context with the prompt. Kimi
K3's 1,048,576 figure is the accepted completion-parameter ceiling, not additional
independent output room. Pi `streamSimple` fits actual output to remaining context;
full API `stream` callers still own input budgeting. Grok's wording about no text
output limit is not converted to infinity; its numeric output budget stays
catalog-derived. Kimi K2.8 has no reviewed finite vendor output maximum, so its
catalog output value remains in use.

## Follow-up documentation reviews

In addition to the initial [reference inventory](vendor-capability-comparison.md):

- All nine OpenAI named models have documented image input and reasoning. GPT-5.4
  and GPT-5.5 expose low/medium/high/xhigh, without max. GPT-5.6 variants and the
  reviewed GPT-6 variants also expose max. GPT-6 Astra and GPT-6.1 Sol require
  reasoning. The individual official URLs are stored with each registry entry.
- OpenAI's [GPT-6 guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra)
  describes endpoint-specific native tool restrictions. This extension continues
  using WorkBuddy's own chat endpoint; it does not assume whether WorkBuddy
  translates upstream endpoints, and does not preemptively remove these models.
- [GLM reasoning documentation](https://docs.z.ai/guides/capabilities/thinking)
  establishes GLM-5.2's accepted effort strings and GLM-5.3-Flash's standard-API
  low/high/max controls. Mandatory reasoning is distinct from effort support.
- [Gemini thinking documentation](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
  and [3.5 changes](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5)
  distinguish 3.5's minimal/low/medium/high from 3.8's low/medium/high.
- [Kimi model parameters](https://platform.kimi.ai/docs/api/models-overview)
  and [troubleshooting](https://www.kimi.ai/help/kimi-api/api-troubleshooting)
  establish K2.6's context-dependent completion ceiling and lack of native
  `reasoning_effort` support. Its 32,768 default is not a maximum.
- [Kimi Code model configuration](https://www.kimi.com/code/docs/en/kimi-code/models)
  supplies the named K2.8 Preview context and low/high/max controls. Unpublished
  fields are not fabricated.

No vendor-native audio/video, web-search, code-execution, Responses API, or
structured-output feature is claimed to be implemented just because the upstream
model supports it. Pi text/image inputs and existing function-tool conversion are
the supported path here. WorkBuddy may reject any optimistic projection; catalog
visibility and mock tests do not prove account entitlement or live gateway support.

## Authenticated catalog-only verification

The saved account was accessed only through Pi AuthStorage/createModels, with
inference entry points disabled in the check. The refresh found **28 models**.
Only projected public model IDs and metadata were printed. No tokens, login URLs,
raw response bodies, or credentials were logged or copied into the repository.

| ID | Projected context | Projected max output |
| --- | ---: | ---: |
| `default-model` | 176,000 | 24,000 |
| `fast-model` | 200,000 | 32,000 |
| `balanced-model` | 256,000 | 32,000 |
| `primary-model` | 272,000 | 72,000 |
| `deepseek-v4.1-flash` | 1,048,576 | 393,216 |
| `deepseek-v4.1-flash-sg` | 1,048,576 | 393,216 |
| `hy4-preview` | 1,000,000 | 64,000 |
| `hy3` | 256,000 | 128,000 |
| `kimi-k2.8-preview` | 1,048,576 | 32,000 |
| `gpt-5.6-sol` | 1,050,000 | 128,000 |
| `gpt-5.6-terra` | 1,050,000 | 128,000 |
| `gpt-5.6-luna` | 1,050,000 | 128,000 |
| `gpt-5.5` | 1,050,000 | 128,000 |
| `gpt-5.4` | 1,050,000 | 128,000 |
| `gemini-3.5-flash` | 1,048,576 | 65,536 |
| `gpt-6-astra` | 1,050,000 | 128,000 |
| `glm-5.3-flash` | 1,000,000 | 131,072 |
| `glm-5.3` | 1,000,000 | 131,072 |
| `glm-5.2` | 1,000,000 | 131,072 |
| `minimax-m3.1-flash` | 1,000,000 | 524,288 |
| `kimi-k3` | 1,048,576 | 1,048,576 |
| `kimi-k2.6` | 262,144 | 262,144 |
| `grok-4.7` | 500,000 | 128,000 |
| `gpt-6-sol` | 1,050,000 | 128,000 |
| `gemini-3.8-flash` | 1,048,576 | 65,536 |
| `gpt-6-luna` | 1,050,000 | 128,000 |
| `gpt-6.1-sol` | 1,050,000 | 128,000 |
| `step-5-preview` | 1,000,000 | 64,000 |

All 28 currently project text/image input based on the union of gateway/vendor
advertisements. This is not evidence that every image request will succeed.

## Tests

The suite passes **87 tests**, including installed Pi 1.3.0 host integration.
New coverage exercises all 24 vendor profiles, all four live routing aliases,
future IDs, additive image/effort capabilities, malformed metadata, largest-context
selection, shared-context output arithmetic, and oversized supported-length lists.
Mock host tests verify DeepSeek image data URLs, tool schemas, low/high/max effort,
and full declared output survive serialization, plus Kimi K2.6 thinking-toggle
serialization. They send no real chat requests and consume no inference quota.
