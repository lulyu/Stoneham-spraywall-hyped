# Community guardrails

The API enforces these fixed-window limits per verified account (including admin
accounts). They count attempted writes, including retries and invalid bodies;
rejected quota transactions do not partially consume other windows. Limits live
in `backend/src/guardrails.ts` and can be adjusted in a reviewed deployment.

| Operation | Limit |
| --- | --- |
| All writes combined | 60/minute |
| Create route or save Upgrade, combined | 5/minute and 30/UTC day |
| New comments | 5/minute and 100/UTC day |
| Ratings | 30/minute |
| Edits and comment deletion | 30/minute |
| Profile changes | 10/minute |
| Sends | 60/minute |
| Admin operations | 30/minute |

Conditional DynamoDB transactions share quota state across Lambda instances.
`429` responses include a `Retry-After` header and `retryAfter` seconds in JSON.
Expired quota buckets are ignored automatically by their window identity; table
TTL removes the records later. There is no process-memory fallback. A database
failure rejects the write. Anonymous/invalid-token writes remain unauthorized.
These limits do not stop multiple-account abuse or cap cloud charges.

## Stored community totals

Each route has a `COMMUNITY_SUMMARY` record with visible comment count, rating
count, rating total and an optimistic revision. Comment creation, author deletion,
moderator hide/restore and rating replacement update the record in the same
transaction as their source record. Duplicate creates/deletes/hide requests do
not change the total twice. Edits do not change counts. A conflict rereads state
and retries, or returns `409`; it never overwrites a stale summary.

Public reads fetch one summary rather than walking all comments or ratings.
Comments still paginate 20 at a time. Each GSI page is hydrated from the base table
so a stale index cannot expose hidden/deleted text. Author controls query ownership
only for the displayed page's (at most 20) comment IDs; `/my-activity` never walks
other users' comments. The frontend includes those IDs on initial and later pages.

## Admin moderation

Open **Profile → Admin moderation** as an administrator. Choose Routes, Comments
or Account restrictions. Hide/Restore and Suspend/Unban require a reason and an
explicit confirmation. All endpoints independently check API Gateway's verified
JWT and administrator group; hiding the controls is not authorization.

Hidden routes disappear from public/owned lists and return `404` on direct and
community links. Hidden comments and author cards are omitted from public reads;
restoring preserves their text, author and original creation time. Author-deleted
comments cannot be restored. Hidden content cannot be revived by a normal edit.
Suspension prevents subsequent API writes with existing tokens; it does not log
out the user or automatically hide their previous content. In-flight requests
that passed the check before suspension may finish. Self-suspension is rejected.

Moderation updates and append-only audit entries commit together. Audit entries
record actor, target, decision, reason and time. Nothing is physically deleted by
moderation, and application IAM still has no `DeleteItem` permission. Admin lists
scan bounded pages of 50 table items, including empty filtered pages; Load more
continues those pages. Cursors are bound to the selected kind. Access records and
audits are never exposed through public APIs.

Endpoints:

- `GET /v1/admin/moderation?kind=routes|comments|users[&cursor=…]`
- `PATCH /v1/admin/users/{userId}/access` with `{banned, reason}`
- `PATCH /v1/admin/problems/{id}/visibility` with `{hidden, reason}`
- `PATCH /v1/admin/problems/{id}/comments/{commentId}/visibility` with `{hidden, reason}`

## Initial rollout and recovery

1. Save the current route list and each route's community totals as a baseline.
2. Validate/build/test both applications and update the existing backend stack.
   The change set must retain the database and user pool. It adds quota TTL,
   JWT-protected admin routes and `Retry-After` CORS exposure.
3. Wait at least the old Lambda's maximum invocation duration (currently 10 seconds)
   after the code update completes. Existing routes without summaries return `503`
   for count-dependent reads and community writes during this brief bootstrap;
   they are never silently presented with zero totals. New route creation includes
   an empty summary in its creation transaction. Do not roll back to an old writer
   after initialization without pausing writes and rebuilding summaries.
4. Backfill once through the IAM-authorized administrator handler:

   ```sh
   node backend/scripts/backfill-community.mjs \
     --function stoneham-spraywall-prod-api --table stoneham-spraywall-prod --dry-run
   node backend/scripts/backfill-community.mjs \
     --function stoneham-spraywall-prod-api --table stoneham-spraywall-prod
   ```

   The dry-run only discovers missing summaries. Apply reads old records and
   conditionally initializes missing summaries; rerunning never overwrites a ready
   summary or modifies original routes/comments/ratings. The administrator-only
   `/v1/admin/community/backfill` endpoint handles one route per call. An exceptionally
   large legacy route (>100 query pages) stops for offline handling rather than
   running an unbounded request. Quota errors are retried after their wait period.
5. Compare all public totals and original route content against the baseline,
   verify anonymous and non-admin rejection, then release the frontend.
6. Verify moderation with isolated temporary fixtures and remove only those
   fixtures, preserving real user content. Check current wall/history behavior too.

Tests cover concurrent limits, account isolation, UTC resets, Upgrade sharing the
creation allowance, rating changes, duplicate comments, stale GSI entries,
hide/delete races, restoration, existing-token bans, administrator permissions,
bounded read work with 1,000 historical ratings/comments, and non-destructive
backfill. `scripts/moderation-smoke.cjs` verifies the mobile UI with isolated API
fixtures and makes no production writes.
