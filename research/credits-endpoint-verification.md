# Read-only WorkBuddy credit endpoint verification

> This records the initial aggregate-only verification. A subsequent
> [per-resource detail review](credit-package-details.md) verified the paid/free
> package read routes and supplied expiry fields without inventing dates.

## Scope and outcome

The operator explicitly authorized verification of WorkBuddy credit endpoints
using the existing Pi login, without chat. Two known read-oriented routes were
called successfully. No inference, reward claim, purchase, subscription change,
token refresh, or credential-store write was performed.

This is direct authenticated endpoint evidence, separate from the earlier static
[model-tooltip investigation](model-tooltip-findings.md). It establishes that the
existing Pi WorkBuddy credential can read these routes for the tested account.
It does not establish availability for every account/enterprise configuration.

## Verified calls

| Method | Path on the trusted WorkBuddy origin | Result |
| --- | --- | --- |
| POST | `/billing/meter/get-user-resource-summary` | HTTP 200, JSON envelope `code: 0`, resource summary returned |
| GET | `/console/accounts` | HTTP 200, JSON envelope `code: 0`, an account matched the stored WorkBuddy user ID |

The POST body was exactly `{}`. Requests used the provider's existing
`accountHeaders()` and version-aware User-Agent, JSON content type, and JSON
accept header. No browser cookies, desktop credentials, or alternate origins
were used. Redirects were not followed; none occurred. Each request had a
15-second deadline and a bounded response reader.

The initial exact observed routes worked; no guessed `/v2` alternatives,
enterprise endpoint, or paid/free package-detail queries were needed.

## Confirmed response shape

The successful summary includes:

- `Packages`, an array;
- each inspected package's numeric `CycleTotalCapacity`, `CycleRemainCapacity`,
  and `CycleUsedCapacity` values;
- string `SubscriptionPackageCode` and `SubscriptionPackageName` fields;
- boolean `IsPaidUser`.

Summing the three capacity fields separately yields account total, remaining,
and used credits using the same field semantics as the inspected WorkBuddy
`parseResourceSummary` / `sumSummaryCapacity` helpers. These are credits, not
USD, tokens, independent per-model balances, or ChatGPT-style five-hour windows.
Missing/malformed numbers must remain unknown rather than silently becoming
zero. A zero total must not produce a fabricated remaining percentage.

The profile response contained a matching account, but the probe did not establish
a recognized plan label or expiry timestamp. Therefore no Free/Pro/Team label,
renewal date, or expiry value should be inferred from this result. In particular,
`IsPaidUser: false` alone is not a verified human-readable subscription label.
Further display fields can be reviewed separately if needed.

## Privacy and authorization boundaries

Credential access used Pi's `ReadOnlyAuthStorage.read('workbuddy')`, not
`models.getAuth()` or a refresh operation. The stored credential was unexpired.
Only WorkBuddy's stored record was requested. Account IDs were compared in memory
and were not printed. Access/refresh tokens, account identity/contact fields,
login URLs, response headers, and raw response bodies were never logged or saved.

Only sanitized status/schema information and aggregate credit metrics were
retained locally in `research/credits-verification-evidence.json`. That file is
ignored by Git. Actual balances, package counts, plan codes, and private account
details are deliberately omitted from these publishable notes.

Context7 documentation `/earendil-works/pi/v1.3.0` was checked for credential-store
read versus OAuth refresh/write behavior. The installed read-only storage API and
existing native client were used directly; no provider/runtime behavior changed.

## Implementation follow-up

1. **Implemented for 0.2.4:** `src/native-credits.js` provides the personal-account
   reader and normalization, backed by `createNativeClient().credits()`. It uses
   the verified route, a default 60-second/8-scope in-memory cache, bounded and
   deduplicated requests, independent subscriber cancellation, explicit offline
   behavior, safe errors, and stale-result markers. Invalid numeric fields remain
   null. Authentication/business denials discard cached balances. No balances or
   credentials enter the persistent model catalog, and no UI is added yet.
2. Expose the data through a supported WorkBuddy status/widget/command surface,
   or a generic provider-details contract in Pendant for native model-hover rows.
3. Keep plan, refresh, and package-expiry details absent/unknown until their exact
   response fields and semantics are established. Do not invoke any account-
   mutating endpoint to populate a display.

The original endpoint verification did not modify runtime code or installed
packages. The subsequent operator-approved implementation prepares version 0.2.4
and adds **31 synthetic-response tests**; the complete suite passes **137 tests**,
including existing Pi/Pendant integrations. No live endpoint was called again
while implementing/testing the reader. No installed package or Pendant bundle was
modified, and no commit, push, or npm publication was performed for this follow-up.
