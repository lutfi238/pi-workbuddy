# Vendor capability references

## Scope and confidence

This is a documentation research snapshot covering the 28 model IDs discovered
from WorkBuddy. Following operator approval, reviewed specifications now inform
`src/native-capabilities.js` under the [maximum-capability policy](capability-policy.md).
No inference requests were sent. The matrix below distinguishes vendor claims
from gateway behavior; it is not a live capacity or entitlement test.

Official vendor documentation describes the vendor API, not necessarily the
WorkBuddy deployment, gateway, model snapshot, account entitlement, or adapter.
Matching names alone do not establish that two deployments are identical.
Vendor aliases and preview models can change without a WorkBuddy ID changing.

The DeepSeek, GLM-5.3, and Gemini-3.8-Flash pages were additionally checked through
Context7 (`/websites/api-docs_deepseek`, `/websites/z_ai`, and
`/websites/ai_google_dev_gemini-api`). Other entries use official pages returned
by web research. This is not an archived copy of those pages. Recheck the linked
sources before implementing machine-readable overrides.

Notation is preserved: rounded `1M`, `128K`, and similar values are not silently
converted to exact token counts. Context, maximum input, maximum output, and
configured defaults are separate fields. Never add independently advertised
input and output limits to infer a total context window.

## Model reference inventory

`Not reviewed` means the initial research did not independently establish the field;
it must not be interpreted as false. Follow-up reviews for the implemented policy
are recorded in the policy document and supersede those initial unknowns. All capability claims below concern the
vendor API only. Image support does not establish native video/audio support
in Pi or the WorkBuddy adapter.

| WorkBuddy ID | Vendor context / input | Vendor max output | Vendor image input | Reasoning / tool calls | Sources and caveats |
| --- | --- | --- | --- | --- | --- |
| `balanced-model` | Unknown | Unknown | Unknown | Unknown | WorkBuddy routing alias; do not guess the underlying vendor model. |
| `default-model` | Unknown | Unknown | Unknown | Unknown | WorkBuddy routing alias; retain gateway-derived conservative budgets. |
| `fast-model` | Unknown | Unknown | Unknown | Unknown | WorkBuddy routing alias. |
| `primary-model` | Unknown | Unknown | Unknown | Unknown | WorkBuddy routing alias. |
| `deepseek-v4.1-flash` | 1M | 384K | Yes | Both supported | [DeepSeek](https://api-docs.deepseek.com/quick_start/pricing); vendor API ID is `deepseek-flash`, currently documented as V4.1 Flash. Same WorkBuddy snapshot is not established. |
| `deepseek-v4.1-flash-sg` | Not independently established | Not independently established | Not independently established | Not independently established | Regional WorkBuddy suffix; do not assume identical routing, limits, or features to the unsuffixed model. |
| `gemini-3.5-flash` | 1,048,576 input | 65,536 | Yes | Both supported | [Google](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash); vendor page marks this ID deprecated and redirected to 3.6 Flash. This does not establish WorkBuddy routing. |
| `gemini-3.8-flash` | 1,048,576 input | 65,536 | Yes | Both supported | [Google](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash); also advertises video/audio/PDF inputs on its native API, not automatically on this extension. |
| `glm-5.2` | 1M | 128K | No; text-only | Both supported | [Z.AI](https://docs.z.ai/guides/llm/glm-5.2). |
| `glm-5.3` | 1M | 128K | No; text-only | Both supported; reasoning mandatory | [Z.AI](https://docs.z.ai/guides/llm/glm-5.3); disabling reasoning is unsupported. |
| `glm-5.3-flash` | 1M | 128K | Yes | Both supported; reasoning mandatory | [Z.AI](https://docs.z.ai/guides/llm/glm-5.3-flash); redirects to the vision-model documentation. Do not copy GLM-5.3 text-only capabilities to Flash. |
| `gpt-5.4` | 1,050,000 | 128,000 | Not reviewed | Not reviewed | [OpenAI](https://developers.openai.com/api/docs/models/gpt-5.4). |
| `gpt-5.5` | 1,050,000 | 128,000 | Not reviewed | Not reviewed | [OpenAI](https://developers.openai.com/api/docs/models/gpt-5.5). |
| `gpt-5.6-luna` | 1,050,000 | 128,000 | Yes | Both supported | [OpenAI](https://developers.openai.com/api/docs/models/gpt-5.6-luna); reasoning can be set to `none`. |
| `gpt-5.6-sol` | 1,050,000 | 128,000 | Not reviewed | Not reviewed | [OpenAI](https://developers.openai.com/api/docs/models/gpt-5.6-sol). |
| `gpt-5.6-terra` | 1,050,000 | 128,000 | Yes | Both supported | [OpenAI](https://developers.openai.com/api/docs/models/gpt-5.6-terra); reasoning can be set to `none`. |
| `gpt-6-astra` | 1,050,000 | 128,000 | Not reviewed | Not reviewed | [OpenAI](https://developers.openai.com/api/docs/models/gpt-6-astra). |
| `gpt-6-luna` | 1,050,000 | 128,000 | Not reviewed | Not reviewed | [OpenAI](https://developers.openai.com/api/docs/models/gpt-6-luna). |
| `gpt-6-sol` | 1,050,000 | 128,000 | Not reviewed | Not reviewed | [OpenAI](https://developers.openai.com/api/docs/models/gpt-6-sol). |
| `gpt-6.1-sol` | 1,050,000 | 128,000 | Not reviewed | Not reviewed | [OpenAI](https://developers.openai.com/api/docs/models/gpt-6.1-sol). |
| `grok-4.7` | 500,000 | No finite text-output cap stated | Yes | Both supported; reasoning mandatory | [xAI](https://docs.x.ai/developers/grok-4-7); do not convert its wording into unlimited request/output budgets. Context and gateway limits still apply. |
| `hy3` | 256K context; 192K input | 128K | Not listed | Both supported | [Tencent model list](https://intl.cloud.tencent.com/ko/document/product/1300/78934), [API guide](https://intl.cloud.tencent.com/ind/document/product/1300/80695). Not listed is not a verified rejection of image input. |
| `hy4-preview` | 1M context; 960K input | 64K | Not listed | Both supported | Same Tencent sources as Hy3; preview deployment identity requires confirmation. |
| `kimi-k2.6` | 256K | Not established | Yes | Both supported | [Kimi](https://platform.kimi.ai/docs/guide/kimi-k2-6-quickstart); 32,768 is a documented default, not a confirmed maximum. |
| `kimi-k2.8-preview` | 1,048,576 for referenced Kimi Code deployment | Not established | Not reviewed | Not reviewed | [Kimi Code](https://www.kimi.com/code/docs/en/third-party-tools/opencode.html); referenced API ID is `kimi-for-coding`, not the WorkBuddy ID. Treat mapping as unresolved. |
| `kimi-k3` | 1M | Not established as an independent output budget | Yes | Both supported; reasoning mandatory | [Kimi](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart); accepts `max_completion_tokens` up to 1,048,576, but an accepted parameter ceiling is not a guarantee of that much output alongside input. |
| `minimax-m3.1-flash` | 1M | 524,288 | Yes | Both supported; reasoning mandatory | [MiniMax models](https://platform.minimax.io/docs/guides/models-intro), [API](https://platform.minimax.io/docs/api-reference/text-anthropic-api); vendor ID is `MiniMax-M3.1-Flash`. Recommended output budget 131,072 differs from maximum. |
| `step-5-preview` | 1M | 64K in model specification | Yes | Both supported | [StepFun](https://platform.stepfun.ai/docs/en/guides/models/step-5-preview); the same page's unbounded/default `max_tokens` language conflicts with the explicit model-spec output cap. Do not infer unlimited output. |

## Differences from the audited WorkBuddy projection

These examples illustrate why vendor limits must not silently replace gateway
configuration. They do not constitute live tests of server-enforced ceilings.

| WorkBuddy ID | Audited WorkBuddy context budget | Audited WorkBuddy output budget | Vendor reference |
| --- | ---: | ---: | --- |
| `deepseek-v4.1-flash` | 300,000 | 128,000 | 1M context / 384K maximum output |
| `glm-5.3` | 1,000,000 | 48,000 | 1M context / 128K maximum output |
| `gpt-6.1-sol` | 272,000 | 128,000 | 1,050,000 context / 128,000 maximum output |
| `hy3` | 192,000 | 64,000 | 256K context, 192K max input / 128K maximum output |

## Initial conservative integration proposal (not adopted)

The operator explicitly chose maximum documented capabilities instead. These
initial proposals are retained for research history, not as current runtime rules.
See [capability-policy.md](capability-policy.md) for the implemented behavior.

1. Continue discovering IDs dynamically from WorkBuddy. A vendor reference table
   must never become a model-ID allowlist or cause unknown models to disappear.
2. Keep vendor claims separate from gateway-advertised and actually tested
   capabilities. Record the source URL, vendor ID, deployment-mapping confidence,
   review time, field semantics, and any conflicts.
3. Keep explicit valid WorkBuddy limits authoritative for ordinary requests.
   Vendor documentation may be useful when metadata is absent, but only for
   reviewed exact mappings, compatible semantics, and a conservative policy.
   Never silently replace an explicit smaller gateway limit with a vendor maximum.
4. Do not enable image input, vendor-native tools, or reasoning request parameters
   solely because a vendor supports them. The Pi conversion and WorkBuddy gateway
   must support the feature as well. An adapter may also provide capabilities not
   exposed directly by the underlying model, such as image preprocessing.
5. Do not propagate features by family prefix. In particular, GLM-5.3 and
   GLM-5.3-Flash have different documented modalities. Regional and routing aliases
   need separate evidence.
6. Preserve unknowns and documentation inconsistencies instead of inventing
   booleans or numerical maxima. Inference-based verification requires explicit
   approval because it can consume account quota.
