# WorkBuddy model-hover details: feasibility

> Follow-up: the operator subsequently authorized a read-only account probe.
> Existing Pi bearer authentication successfully read the credit-summary and
> profile routes. See [credits-endpoint-verification.md](credits-endpoint-verification.md).
> Statements below about unverified endpoint access describe the initial static
> investigation; the Pendant tooltip limitation is unchanged.

## Result

A WorkBuddy-specific account/details display is feasible, but the current
`pi-workbuddy` provider cannot independently add arbitrary rows to Pendant
0.41.0's native model-hover tooltip. The tooltip is rendered by the host.

Two separate integrations are required for the exact requested experience:

1. Fetch and normalize real WorkBuddy account/credit information.
2. Add a supported generic provider-details contract and renderer in Pendant,
   or contribute that host feature upstream. The current fixed subscription
   contract does not represent WorkBuddy credits honestly.

No provider behavior, package version, installed extension, or host bundle was
changed. No account/credit endpoint was called, no personal balance was read,
and no chat/inference request was sent. Only shipped application code and public
WorkBuddy documentation were inspected.

## Pendant observations

Selected installed target: `cdervis.vscode-pi-0.41.0`.

Ordinary source inspection, corroborated by inert REA artifact analysis:

- `dist/webview.js`, function `s$`, decoded UTF-16 offset 1,273,462: constructs
  the model-hover grid. Generic rows come from provider/name, context, reasoning,
  input modality, and nonzero USD input/output rates.
- Subscription rows are explicitly rendered from `fiveHour`, `weekly`,
  `availableResetCount`, and `resetCreditExpirations`. They are gated by the
  `isSubscriptionUsageProvider` predicate delegated to the host core.
- A separate branch handles OpenRouter credit balance/usage and checks the
  provider ID against `openrouter`.
- `dist/extension.js`, function `RD`, around offset 887,422: sends a host-owned
  `provider_usage_get` request and forwards a `chatgpt_usage` message to the webview.
  This is separate from registering a native Pi provider.
- Its result validator `mL` accepts fixed subscription fields: required
  `planType`, `email`, `fetchedAt`, optional `fiveHour`, `weekly`,
  `availableResetCount`, `resetCreditExpirations`. There is no arbitrary row array
  in this inspected contract.
- The worker's existing usage coordinator (`qd`, around offset 554,000) derives
  request plans/parsers through its host core and uses host auth. Adding an
  undocumented `getUsage` property to our provider is not an established way to
  extend that coordinator or the native tooltip.

The provider predicate/request-plan internals delegate to `core.wasm`; this
investigation did not decompile those internals or establish the complete
supported-provider list. The fixed renderer/result schema is sufficient to
establish the absence of a WorkBuddy-specific credit-row path in the inspected
JavaScript route. This is a bounded conclusion, not a claim that all future
Pendant versions lack extensibility.

Context7 references: `/earendil-works/pi/v1.3.0`, provider/auth and RPC extension UI
documentation. `setStatus` and text `setWidget` are public alternatives, subject
to host support. `setFooter` is terminal-only/no-op in ordinary RPC mode; it is
not a portable replacement for Pendant's webview model tooltip.

Do not rename the provider to `openai-codex` or `openrouter` to activate their UI.
Do not put WorkBuddy credit counts into five-hour/weekly fields or USD pricing.
Those workarounds misrepresent semantics and can route auth incorrectly.

## WorkBuddy observations

Selected target: the installed WorkBuddy AI 5.8.4 shipped account implementation
and renderer panels. The desktop account data model includes:

| Candidate display | Observed source field / behavior |
| --- | --- |
| Plan | `editionType`, normalized `plan`, subscription package name/code |
| Remaining credits | `creditsLeft`, summed `CycleRemainCapacity` |
| Total credits | `creditsTotal`, summed `CycleTotalCapacity` |
| Used credits | summed `CycleUsedCapacity`; do not invent a percentage without a valid denominator |
| Unlimited enterprise allocation | explicit unlimited flag / `limit_num === -1`, not a negative balance |
| Subscription expiry | profile `expireAt` |
| Refresh/renewal date | account-panel `refreshAt`, if supplied |
| Credit-package detail | package code, remaining, total, package-specific expiry/refresh fields |
| Model consumption multiplier | catalog `credits`; distinct from account balance and USD token prices |

`main/account.js` contains `parseResourceSummary` at UTF-16 offset 376,090
and `sumSummaryCapacity` at 378,303. `CloudAccountRepo.billing` and the desktop
override normalize personal and enterprise responses. The resource-summary
structure includes `Packages`, `CycleTotalCapacity`, `CycleRemainCapacity`,
`CycleUsedCapacity`, `SubscriptionPackageCode`, `SubscriptionPackageName`, and
`IsPaidUser`.

Observed read-oriented request candidates in the shipped account implementation:

- `GET /console/accounts` for profile/account selection.
- `POST <resourcePrefix>/billing/meter/get-user-resource-summary` with `{}` for
  personal credit summary.
- `POST <billingPrefix>/billing/meter/get-enterprise-user-usage` with `{}` and an
  enterprise header for enterprise allocation.
- Separate paid/free resource-package queries provide package-level detail.

These are **relative strings in the inspected app**, not validated public API
URLs. The desktop billing prefix is `/v2`; its resource prefix is inherited as
empty. Context HTTP routing/base URL and compatibility with Pi's existing
WorkBuddy bearer credential have not been established for these calls. The
current native client has no implementation for them.

The panels distinguish monthly quota, credit-package groups, expiry, and refresh
information. Do not assume ChatGPT-like five-hour/weekly windows or display a
single global reset date where multiple WorkBuddy packages expire separately.
Do not trigger check-in, purchase, renewal cancellation, or other account-mutating
operations as part of fetching usage.

Public documentation corroborates the account-credit concept, not private values
or undocumented API compatibility:

- https://www.workbuddy.ai/docs/workbuddy/usage
- https://www.workbuddy.ai/docs/workbuddy/credits
- https://www.workbuddy.ai/docs/workbuddy/pricing

## Proposed UX (not implemented)

Keep the existing model header/capability rows and add WorkBuddy-specific rows
only when backed by a verified response, for example:

- Plan.
- Credits remaining and used/total, or an explicit unlimited allocation.
- Subscription expiry.
- Next refresh and nearest credit-package expiry, clearly distinguished.
- Model credit multiplier, only when the catalog supplies it.
- Last successful update / stale-data indicator.

These are labels, not fabricated sample account values. Hide unavailable fields
or show an explicit unknown state, rather than substituting zero/100%.

A clean host integration would accept bounded provider/model-specific details,
use text-only rows rather than HTML, cache briefly, refresh through an explicit
read-only path, cancel stale requests, isolate accounts, and keep credentials
inside Pi's auth flow. Hovering repeatedly must not trigger chat requests or
unbounded billing polling. Shared account balance must not be presented as an
independent per-model allowance.

Without a Pendant change, implement a WorkBuddy status/widget or `/workbuddy usage`
as an alternative surface. It must be described as an alternative, not as an
implementation of the native model-hover experience. Any local patch to installed
Pendant files would be fragile across updates and is not included in this work.

## Evidence and limits

Raw source snapshots/provenance and complete REA records are local and ignored by
Git; authored findings can be published. Snapshots preserve shipped bytes.

| Scope | Parent REA Evidence | Parsed scope / limitations |
| --- | --- | --- |
| Pendant webview + extension | `ev_7b829ef6267cb5ee1a9a6ee20e94c480a62f5b11a6ccdb97c11c4a88ee9668a9` | 2 files, 3,167,607 text bytes, 822,372 AST nodes, zero parse failures; application/semantic coverage partial, semantic unknown retention capped at 40,000 |
| WorkBuddy account module | `ev_a2418bbcb5c814df44851202fb58ee56260dead923538d0df827790ce1738e7d` | 1 file, 440,875 bytes, 112,840 AST nodes, zero parse failures; partial coverage, semantic unknown retention capped at 20,000 |
| WorkBuddy account/usage panels | `ev_80581166299c9889f416f1c8ef45160ad73772908a77977869f09574276e59da` | 3 files, 46,683 bytes, 12,274 AST nodes, zero parse failures; application coverage partial, semantic coverage unknown, 2,570 retained semantic unknowns |

Corresponding summary Evidence:

- `ev_da32092f66fcba8422d72a928339e451f7ad5bd034885bf750aef629d6f05f0e`
- `ev_9bd1317596620a557f9f388cebcac408cb146c5d25a7271edfee099cf6d32f69`
- `ev_8911ff98a6506e08dba0bacfe68dfa3dcec55e2b9cbc35f9d9a17e44dd90099c`

Worker details reuse the unchanged artifact from the earlier Pendant investigation
(Evidence `ev_97bd0133bb0b966969782264b49379ea1db680bbe7416e1cb724292ebae7a556`).
Static analysis did not execute any bundle or prove current account responses.
No private quota endpoint probe, native model-hover integration test, or host UI
modification has been performed. Those are separate next steps requiring approval.
