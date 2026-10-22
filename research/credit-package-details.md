# Per-resource credit details and expiry

## Motivation and read-only verification

The operator supplied WorkBuddy account screenshots showing base credits and
separate bonus grants with different expiration dates, and requested these details
instead of an aggregate-only tooltip. The earlier summary parser intentionally
projected only aggregate capacities; its group count is not an individual-grant
count when several grants share a product code.

The reviewed WorkBuddy 5.8.4 account implementation exposes two read-only POST
routes on the trusted origin:

- `/billing/meter/get-user-resource-paid-packages`
- `/billing/meter/get-user-resource-free-packages`

Authenticated verification returned HTTP 200 / business code 0 for both. The paid
response was empty for the tested account, so populated paid-resource behavior is
covered by inspected shared parser semantics and synthetic tests, not a live paid
subscription. Populated free/base/bonus records confirmed the precise cycle
capacity fields, resource IDs for deduplication, numeric Unix-millisecond
`DeductionEndTime`, and offset-less `CycleEndTime` strings. `OnlyValidPeriod: true`
was independently accepted by the free route.

Verification used Pi `ReadOnlyAuthStorage` with an already-unexpired personal
credential. It did not refresh tokens, use browser cookies, claim rewards, purchase,
change renewal, invoke inference, or write the credential store. Raw responses,
identities, order/resource IDs, actual balances, and actual expiry dates were not
logged or retained. Ignored local evidence contains only schema/format/status
checks. The final normalized live projection was complete: per-resource capacity
sums matched all three aggregate summary metrics, each resource had a supplied
expiry, and its whitelisted relay payload stayed inside the transport limit.

## Implementation

`src/native-credit-packages.js` partitions summary product codes using reviewed
public product definitions. Unknown future product codes are queried on both
read routes rather than silently excluded. Pagination is bounded to ten pages of
200 per route; total retained resources are capped at 2000. Missing/malformed
pages, deadlines, coverage gaps and truncation remain explicitly partial or
unavailable. Earlier successful pages survive a later page failure. Resource IDs
only deduplicate in memory; grants are never merged by product code.

The native client retains the existing summary request and adds the relevant
detail requests under a shared detail deadline. The free query includes the
reviewed local-day slice range for daily resources. The private reader caches
immutable normalized resource metrics together with the summary and original
read timestamp. Deduplication, account scope, cancellation, offline behavior and
last-subscriber protection are retained. Failed detail reads do not repaint old
resource data as fresh; valid fresh aggregates remain available as a fallback.

Only a reviewed kind (`base`, `daily`, `bonus`, `topup`, `other`), total/remaining/
used credits and expiry cross into the webview. No resource/account/order IDs,
raw product names, tokens, headers or upstream error text are relayed. Numeric
expiry is milliseconds, not guessed seconds. Offset-less expiry text is preserved
as server time. Ordinary `CycleEndTime` is not substituted as expiration, except
for the documented daily resource whose expiry uses that cycle boundary. Missing
dates remain unknown; no `Never`/unlimited/renewal claim is inferred.

## Native hover presentation

The account remaining-credit summary remains a quick overview. With usable
details, individual base/bonus/top-up rows show `remaining / total left` followed
by that resource's expiry instead of redundant aggregate used/total/group-count
rows. Each current remaining balance reuses the existing native OpenAI health
color thresholds. Expiry dates stay neutral. Stale balances retain stale labeling
and no current-health color. Numeric instants display in the browser's local
zone; offset-less values are explicitly labeled `Expires (server time)`.

The bounded hover previews four resources: base/daily first, then earliest known
absolute expiry. Further loaded resources have an explicit omitted count; partial
reads also have their own warning. Full unbounded package-table UI is not added.
The existing native model metadata, title, hint and other providers are preserved.
The additive package fields retain the existing session-scoped status key/schema.
No host broker change is required beyond the already-installed v2 transport fix.

## Validation and local deployment

**195 tests pass**, with no skipped fixture-enabled tests. Coverage includes
same-product distinct grants, future products, pagination, partial reads, privacy,
unknown dates/numbers, date units/timezones, immutable caches, offline/cancelled
reads, native SDK relay serialization, the embedded prepared formatter, and the
actual patched native renderer. Syntax checks and offline CLI smoke pass.

The updated 0.2.4 local preview contains 22 public package files; generated vendor
bundles, private evidence and account data are excluded. The renderer and local
package were installed after hash/inventory checks and additional private backups.
The v2 broker is unchanged. The recovery receipt now verifies the latest renderer
and package while retaining both original stock host bundles and original 0.2.3.
The standalone rollback read-only check passes; rollback was not applied.

Current local renderer SHA-256:
`494d7f6f8303cecc9cb6465d4e2fc1729688a82b8f0dd84553672c1fe02de200`

No settings, trust records, dependency metadata, npm publication, commit or push
was changed during implementation. VS Code was not reloaded automatically.

## Operator-confirmed visible result

After manually reloading and enabling the relay, the operator supplied a screenshot
confirming the native WorkBuddy hover displays the plan, account remaining-credit
summary, separate base and bonus grants, individual expiry dates, native balance
colors, and update time. This is visible local confirmation for Pendant 0.41.0,
separate from the synthetic tests and read-only endpoint verification. No screenshot,
actual balance, actual expiry date, or account identity is included in this report.
Future host versions still require their own compatibility and visual checks.
