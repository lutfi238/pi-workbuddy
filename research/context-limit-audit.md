# Context and output token limit audit

> Historical audit of the initial conservative policy. The operator subsequently
> selected a maximum-capability policy, confirmed by screenshots of WorkBuddy's
> 1M context and low/high/max DeepSeek controls. The projection rules and 300K
> DeepSeek result below are superseded by [capability-policy.md](capability-policy.md).
> The source observations and distinction between Pi's context/output budgets remain useful.

## Scope and result

Audited the mapping from WorkBuddy catalog metadata into Pi's `contextWindow` and `maxTokens`, plus output-request handling. Authenticated catalog checks were authorized by the operator. No live chat or inference requests were made; credentials were consumed only through Pi's auth storage and were never printed or copied into project files.

One currently advertised model had an inflated context budget:

| Model | Previous Pi context | Corrected Pi context | Output ceiling |
|---|---:|---:|---:|
| `default-model` | 200,000 | **176,000** | 24,000 |

A second authenticated catalog-only comparison covered **28 projected models**. The other 27 retained their existing context/output values. This is a metadata comparison, not an end-to-end test at the model limits.

## Evidence

### WorkBuddy's context-budget helper

Shipped CLI artifact: `cli/dist/codebuddy-lite-wb.mjs`, SHA-256 `7d51bb147e224a2772ffca521958d0b05740af1195469564b60a88f05f8f93cf`.

Decoded UTF-16 range `[7262604,7263264)` contains:

- `isPositiveSafeInteger`;
- `normalizeSupportedContextWindows`;
- `resolveEffectiveContextBudget`.

The helper validates supported lengths, excludes lengths above `maxInputTokens`, and chooses a supported default or the smallest supported budget. Without multiple supported choices it falls back to `maxInputTokens`. It does **not** use `maxAllowedSize` in that decision. This bounded observation does not establish the units or purpose of `maxAllowedSize` everywhere else in the application.

Ordinary source evidence: `research/context-limit-source.json`. An inert function-declaration snapshot was also analyzed with REA:

- Evidence ID: `ev_0f800fe6cc8a6235550270f42087eb5d4ef4c9c0037e6e7c283ac0d5c1565daa`.
- File: `research/context-limit-evidence.json`.
- One file, 661 text bytes including an added trailing newline, 141 AST nodes, zero parse failures.
- Semantic relationship coverage is **unknown**. No target code was executed. This is not full-application or server-side evidence.

### Authenticated catalog metadata

The account catalog reported these conflicting fields for `default-model`:

```json
{
  "id": "default-model",
  "maxInputTokens": 176000,
  "maxAllowedSize": 200000,
  "maxOutputTokens": 24000
}
```

The old mapping preferred `maxAllowedSize`, causing the 200K context value. The corrected mapping does not treat this ambiguous field as a token limit.

Other representative effective budgets remained unchanged:

| Model | Effective context | Output ceiling |
|---|---:|---:|
| `deepseek-v4.1-flash` | 300,000 | 128,000 |
| `hy3` | 192,000 | 64,000 |
| `gpt-6-astra` | 400,000 | 128,000 |
| `gpt-6.1-sol` | 272,000 | 128,000 |
| `glm-5.3` | 1,000,000 | 48,000 |

These are catalog-derived budgets, not proof of model identity, account entitlement, or exact server-side capacity.

### Pi behavior

Documentation was checked through Context7 library `/earendil-works/pi/v1.3.0`. Pi documents compaction relative to `contextWindow - reserveTokens`, with a default 16,384-token compaction reserve.

The installed Pi AI 1.3.0 source was also inspected directly:

- `api/simple-options.js`: `clampMaxTokensToContext` reduces output using `contextWindow - estimateContextTokens(context).tokens - 4096`.
- `buildBaseOptions` uses that clamp for `streamSimple`.
- `utils/estimate.js`: estimates use reported usage where applicable and estimate trailing messages otherwise.

The **4,096-token request safety margin** and **16,384-token default compaction reserve** are separate mechanisms. They must not be confused with the model's maximum output limit.

## Initial projection policy (superseded)

Implemented in `src/native-limits.js`:

1. Accept only positive safe integers for token limits.
2. Normalize and deduplicate `contextWindow.supportedLengths`, excluding choices above a valid `maxInputTokens`.
3. If supported choices remain, use `defaultLength` only when it is one of them; otherwise use the smallest supported choice.
4. Without supported choices but with `maxInputTokens`, use that input value, conservatively honoring a smaller standalone default. An oversized default cannot increase it.
5. Without a corroborated budget, use 32,768 or a smaller valid standalone default. Do not infer a large budget from `maxAllowedSize`.
6. Set `maxTokens` from a valid `maxOutputTokens`, or 4,096, capped at the effective context budget.
7. Never add output tokens to `maxInputTokens` to manufacture a larger context window.

Pi has one context budget rather than separate input and combined-context limits in this mapping. Using WorkBuddy's effective input/context budget as an upper bound is conservative; this audit does not establish a separate larger combined window from `maxAllowedSize`.

The conservative treatment of a single supported choice or a smaller standalone default is intentionally stricter than the inspected helper's multiple-choice branch. It avoids expanding the budget when optional metadata is incomplete.

## Output-request protections

Both native `stream` and `streamSimple` entry points now:

- Reject invalid explicit output caps and cap valid requests at the model/output context ceilings.
- Prevent `samplingParams.max_tokens` and `max_completion_tokens` from increasing that cap or overwriting Pi's normal simple-stream context clamp.
- Preserve lower requested limits.
- Apply a final cap after the caller's payload hook, including hooks that mutate the payload in place.
- Preserve other caller payload replacements and instrumentation callbacks.
- Normalize the output field to WorkBuddy's inspected `max_tokens` wire format.

For normal Pi `streamSimple` requests, the built-in remaining-context estimate still lowers the actual output cap further. A host integration test supplies 28K previously reported tokens in a 32,768-token context, asks for excessive output through options, sampling, and a payload hook, and verifies the resulting request retains Pi's reduced budget and safety margin.

This is not an exact tokenizer or a universal input-size validator. Full API `stream` callers still own input/remaining-context budgeting; both routes enforce the declared output ceiling. Large payload replacements, tool schemas, images, or tokenizer differences can still require server overflow handling and compaction. No live near-limit inference was performed.

## Validation and remaining work

Added table-driven tests for conflicting metadata, invalid defaults, unsupported lengths, invalid numeric values, absent metadata, input/output separation, explicit caps, sampling overrides, and payload-hook mutation. The full suite, including optional host tests, passes **56 tests**.

No global Pi settings or user compaction settings were changed. The previous automatic-discovery documentation/test changes remain in the working tree. Nothing from this audit has been committed or pushed yet.
