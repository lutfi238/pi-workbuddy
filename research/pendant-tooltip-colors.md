# WorkBuddy credit tooltip colors

The operator confirmed that the v2 native tooltip is visible and requested
color emphasis based on the existing OpenAI tooltip.

## Presentation policy

Only **Credits remaining** receives a health tone when its snapshot is current:

- `good` (native green): at least 50% remaining.
- `warning` (native yellow): at least 15%, below 50% remaining.
- `danger` (native red): below 15%, including an explicitly known zero balance.

These are the exact UI thresholds observed in Pendant's original `aq()` OpenAI
remaining-quota formatter, not newly asserted WorkBuddy billing limits. An internal
ratio chooses a tone; no percentage/allowance row or USD conversion is added.
The existing host theme classes are reused, with no custom CSS/RGB values.

Missing/inconsistent totals do not produce an invented health percentage.
Unknown values remain neutral. Stale snapshots or clock rollback do not receive
current-health coloring; the separate stale marker remains a warning. Loading
stays neutral and unavailable uses a warning. Model metadata, plan, used/total,
package count, and update time stay neutral. In particular, credit packages are
not mislabeled as banked resets.

## Validation and deployment

**175 tests pass**, including boundaries 50/15/zero, unknown/stale/inconsistent
values, unchanged neutral rows, and comparison with the actual original native
OpenAI tone function. Syntax checks, offline CLI smoke, and rollback validation
pass. No live account endpoint or inference was called by the update scripts.

The formatter and prepared webview were updated in the backed-up local 0.2.4
preview. The broker remains unchanged at its v2 hash. Original stock backups
remain intact; the previous preview/renderer and receipt were also retained.
The recovery receipt was updated, and its read-only check still validates both
host bundles and the package.

New local webview SHA-256:
`6aac6b0fedc5c8077209cc176eb4bbbc6c3da08deb2a856e7cee66f4aad8afe0`

VS Code was not restarted automatically. Visible color confirmation requires
reloading the webview/window; a full window reload also requires re-enabling the
opt-in relay. No settings, credentials, npm dependency metadata, commit, push,
or npm publication was changed by this appearance update.
