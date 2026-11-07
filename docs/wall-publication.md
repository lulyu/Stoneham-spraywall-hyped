# Wall publication, route compatibility and Upgrade

The current physical wall is `2026-11-v7`. The homepage uses its reviewed image
and 797 polygons. Explore lists all routes for the wall, including outdated ones.
The footer's Browse wall history links retain access to earlier wall images.

## Publication gate

1. Archive and replay-validate the human review; register the immutable image,
   hold map and version in the frontend and backend catalogs.
2. Mark exactly one backend wall version active and set the frontend current
   version to the same ID. Build/test both applications and deploy the backend.
3. Run the publication sweep in dry-run mode, then apply it:

   ```sh
   node backend/scripts/publish-wall.mjs \
     --function stoneham-spraywall-prod-api --version 2026-11-v7 --dry-run
   node backend/scripts/publish-wall.mjs \
     --function stoneham-spraywall-prod-api --version 2026-11-v7
   ```

   The operator uses the normal AWS SDK credential chain and needs IAM permission
   to invoke this API Lambda. The CLI invokes the administrator handler through
   IAM, not by sending an unsigned admin claim over HTTP. The HTTP publication
   endpoint requires API Gateway's verified JWT plus the gym administrator group.
4. Stop publication if any page fails or reports unresolved concurrent edits.
   Rerun the sweep to resume/converge; it is idempotent. Only after it completes
   should the frontend be deployed to production.
5. Verify the all-routes API, existing route IDs/content, anonymous write rejection,
   latest-wall display, historical viewing and Upgrade behavior.

The sweep scans every page of the existing DynamoDB table, filtering route META
records for this gym/wall. Empty filtered pages still advance the scan cursor.
It checks every hold ID, including Start, Finish and foot-only holds. A route
supports a version exactly when all its hold IDs occur in that version's map.
Compatible routes include the new ID in `supportedWallVersionIds`; other routes
have `outdated: true` and `missingHoldIds`. `compatibilityWallVersionId` identifies
the current version used for the check. No geometric remapping is needed.

The sweep preserves route IDs, creator, name, grade, setter, notes, hold roles,
creation time and content update time. It increments the optimistic revision
when compatibility metadata changes and records `compatibilityCheckedAt`.
Concurrent edits use conditional transactions and retry against the latest
record, rather than replacing content from a stale scan. Subsequent creates and
edits compute compatibility automatically, including writes during the sweep.

## Storage and queries

The route's original `wallVersionId` remains its creation version. Its META item
stays at `PROBLEM#id / META`. Transactions save that item together with:

- `PROBLEM#id / LIST`: wall-wide directory pointer, indexed under
  `GYM#gym#WALL#wall#ALL` for the all-routes endpoint.
- `PROBLEM#id / COMPAT#version`: compatibility pointers for supported versions
  other than the creation version. The original META item retains its old
  version index, so no route data is duplicated.

Directory/compatibility queries hydrate the canonical META record. Old pointers
can remain after an edit, but the reader checks current compatibility before
including them in a version-specific list. The all-routes list includes all
routes. Cursors are bound to the requested wall/version and pointer type.
Ratings, comments and sends continue referencing the same route ID.

## Viewing and Upgrade

Valid routes display on the current wall. Outdated cards are gray and clickable;
opening them selects the most recent retained wall map that contains all of their
holds. A dark red `Route only available on old version wall` message appears
immediately below the route name.

Only the original creator may use Upgrade; administrator status alone does not
grant this right. Upgrade loads a new draft on the current wall with surviving
hold IDs and roles, grade, setter and notes. The UI identifies how many holds were
left out. Missing Start/Finish holds must be repaired before saving.

Saving calls `POST /v1/problems/{sourceId}/upgrade` with `sourceRevision`. The
backend verifies ownership and source revision, validates the edited holds on the
current wall, and creates a new ID with `upgradedFromId`, `upgradeRootId`,
`upgradeBaseName` and `upgradeNumber`. It never patches the source route or copies
its activity records. Canceling the draft writes nothing.

An `UPGRADE_COUNTER` item under the root route reserves V2/V3/V4 numbers in the
same transaction as the new route. Concurrent default-name upgrades retry with
the next number. The user can customize the proposed name. Default names are
bounded to the route-name limit. A changed source or failed transaction leaves
the draft available for retry, with no partially created route.

Local-only mode combines the preserved per-version browser route stores, derives
the same compatibility and provides Upgrade copies on that device. Sign-in
recovery retains Upgrade provenance and checks the original account.

## Verification and permissions

Backend tests cover paginated scans, dry-run, idempotency, foot-only removals,
concurrent edits, all/version queries, author-only Upgrade, V2/V3 numbering,
source/activity preservation, and missing Start/Finish validation. The mobile
browser test `scripts/wall-lifecycle-smoke.cjs` covers the complete UI with
isolated authenticated API fixtures and makes no production route writes.

The existing execution role adds table-scoped Scan and ConditionCheckItem access;
it has no route deletion permission. IAM Policy Autopilot was used to check the
SDK operations; its generic transaction policy also suggests unused operations
and broad resources, which are not applied. Reproduce the analysis with:

```sh
DISABLE_IAM_POLICY_AUTOPILOT_TELEMETRY=true uvx iam-policy-autopilot@latest generate-policies \
  /workspace/Stoneham-spraywall-project/backend/src/db.ts \
  /workspace/Stoneham-spraywall-project/backend/src/community.ts \
  --region us-east-1 --account 010257981603 --service-hints dynamodb --pretty
```

CloudFormation lint/schema validation, JWT route configuration checks, backend
type checks, frontend builds and frontend/backend tests gate the release.
