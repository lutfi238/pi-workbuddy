# Pendant fallback recovery and package-gallery discovery

## Questions and status

1. **npm publication:** answered. The public registry reports `pi-workbuddy`
   latest **0.2.2**, with the `pi-package` keyword and the extension manifest.
2. **Gallery search:** discrepancy confirmed, upstream cause only partially
   established. The direct page returns HTTP 200 and shows 0.2.2, while the
   `workbuddy` filtered catalog does not include `pi-workbuddy`. This is not
   evidence that the npm release is still staged.
3. **Persistent fallback in Pendant:** reproduced and fixed in isolated tests
   against the actual installed SDK bundle. Real VS Code UI behavior after
   deployment remains to be retested by the operator.
4. **Previous SG selection:** tested with a synthetic resumed session containing
   a saved SG model-change record. It recovers to the exact non-SG model.

No live WorkBuddy inference requests were sent. WorkBuddy runtime probes used
synthetic credentials, fake catalog responses, isolated temporary directories,
and no enabled tools. No user chat history was read for these tests. Resource
settings were inspected only for package/extension source names; the installed
public package was 0.2.2. No credentials or sensitive login URLs were logged.

## Package discovery observations

Read-only checks against the public endpoints:

- `https://registry.npmjs.org/pi-workbuddy`: HTTP 200, latest 0.2.2, published
  versions 0.2.1/0.2.2, `keywords` includes `pi-package`, and
  `pi.extensions` contains `./extensions/workbuddy.js`.
- `https://pi.dev/packages/pi-workbuddy`: HTTP 200, matching package title and
  version present.
- `https://pi.dev/packages?name=workbuddy&sort=recent`: HTTP 200, the resulting
  HTML does not contain `pi-workbuddy`.
- `https://registry.npmjs.org/-/v1/search?text=keywords:pi-package%20pi-workbuddy&size=20`:
  HTTP 200, 12,510 total results, but the target is not in the first 20 returned
  names. This bounded query does not prove absence from the complete npm index.

External reports describe missing gallery entries despite successful direct
package pages and valid metadata:

- https://github.com/earendil-works/pi/issues/7885
- https://github.com/earendil-works/pi/issues/7987

A collaborator's account of scheduled npm keyword-search/pagination problems is
consistent with the observation, but this investigation did not inspect Pi's
production index, logs, or database. Do not claim an exact cause or guaranteed
indexing delay. Republishing solely to force discovery is not a demonstrated fix.

## Shipped-host evidence

Selected target: the operator's installed Pendant / VS Code Pi extension 0.41.0.
Its `dist/pi-sdk.cjs` exports Pi coding-agent **1.2.0**; the separately installed
CLI is **1.3.0**. The difference alone does not establish a defect. The observed
provider refresh behavior below does.

REA statically analyzed an unchanged copy of `dist/pi-sdk-worker.cjs`:

- Worker SHA-256: `0a2cd445cfa08c5fc75618b2fae5a5732a73d4ff3c19f41f71ae9323c0402c00`.
- Parent Evidence: `ev_97bd0133bb0b966969782264b49379ea1db680bbe7416e1cb724292ebae7a556`.
- Summary Evidence: `ev_685cd1e469df40a905482c6351f0d1a70724a8b277e4bb3a69c2463d7bd565b9`.
- One file, 756,315 bytes, 196,020 AST nodes, zero parse failures.
- Application/semantic coverage is **partial**. Semantic unknown retention
  reached 20,000, with additional omitted occurrences. Static graph analysis did
  not execute the worker or establish complete dynamic call relationships.
- Raw evidence, provenance, and the unchanged snapshot remain local and ignored
  by Git. The missing MCP registration was not repaired; the installed REA CLI
  6.7.0 was used. An initial file-target attempt was rejected because this CLI
  accepts a directory/ASAR; the successful analysis used the snapshot directory.

Ordinary text inspection of the same worker found the catalog watcher near
UTF-16 offset 370,200 and service creation near 439,900. Its registration wrapper
tracks provider IDs in `seenProviders`. A newly seen ID triggers catalog refresh;
re-registering an already-seen ID schedules an offline refresh. Resource/session
creation can register a newly constructed provider into a shared ModelRuntime.
These are bounded static observations, not a claim that every UI path uses them.

## Reproduced failure before the fix

Using the actual SDK's `ModelRuntime` with synthetic auth and a mock catalog:

1. Register a newly constructed WorkBuddy provider.
2. Refresh with network allowed (the mocked catalog, not a live endpoint).
3. The list contains regular DeepSeek and excludes SG, as expected.
4. Register another WorkBuddy provider instance with the same ID.
5. Refresh with `allowNetwork: false`.
6. The provider returns only `default-model` named **WorkBuddy Default (fallback)**.

The earlier provider initialized every instance with fallback data, persisted no
catalog, and ignored `context.stored`. Thus an offline re-registration could
never restore the prior list. A stale active model object also retained the
fallback label/budget even after the list was refreshed.

A second reproduction used actual SDK resource services, an in-memory session
manager, and real `session_start` binding. Before binding, the active model was
the fallback; after the implemented hook it became the freshly projected model.
No mock implementation of the SDK's model runtime or extension event machinery
was substituted in these session tests.

## Implemented fix in 0.2.3

- Persist **projected metadata only** through Pi's model-store publication API.
  Do not persist raw service config, headers, API keys, auth tokens, remote
  instructions, or private prompts.
- Store a provider-owned cache validator in the entry's `etag` field. It is a
  SHA-256 account-origin/user/domain/tenant fingerprint and is **never** sent as
  an HTTP ETag. Access/refresh tokens are not inputs. Cache reuse requires a
  matching account validator; logout/account changes clear the active in-memory
  catalog rather than reusing another account's list.
- Restore a whitelisted model projection before considering network access.
  Revalidate trusted endpoint/API/provider fields, numeric metadata, and the
  existing SG filter. Malformed, oversized, foreign-account, or obsolete SG-only
  caches must not block an online recovery attempt.
- Use generation-checked `context.publish` for restoration and persistence.
  A rejected stale restoration cannot change provider state or start a fetch.
- Refresh WorkBuddy on `session_start`, inheriting the registry's network policy
  and explicitly honoring `PI_OFFLINE`. No network is done by the extension
  factory, and no idle timer or automatic chat probe is added.
- After refresh, rebind stale active fallback metadata. For a bootstrap fallback
  on resume, inspect only the latest model-change record, not an earlier choice.
  If that last choice is DeepSeek SG, choose its exact available non-SG counterpart.
  Do not override another provider, a newer observed selection, or an active turn.
  Global default settings are not rewritten.
- `/workbuddy refresh` also repairs stale active metadata; `/workbuddy doctor`
  includes the loaded version and catalog source (`fallback`, `cache`, `remote`).

An external embedding's separate offline flag is not exposed in ExtensionContext;
the hook can honor the registry's policy and `PI_OFFLINE`, not inspect private
host settings. Missing auth/network and absent caches can still produce a genuine
fallback. The fix is not a promise to fabricate models or bypass entitlement.

## Validation

**106 tests pass**, including CLI Pi AI 1.3.0 integration and the actual Pendant
0.41.0 / Pi SDK 1.2.0 integration. New tests cover:

- shared-runtime provider re-registration and cache restoration in a fresh runtime;
- actual resource-loader registration, session creation, and session-start binding;
- real active fallback replacement and synthetic saved-SG session recovery;
- account/domain/tenant scoping and token-rotation independence;
- stripping unsafe cache fields/endpoints and retaining current capability rules;
- malformed caches, failed online refresh, generation rejection, and logout;
- startup cancellation, observed model-selection changes, other providers, and
  active-turn protection.

No installed npm package, user session file, global default, or VS Code extension
artifact was modified by this investigation. Deploying the new version and
retesting the visible Pendant picker remain separate release steps.
