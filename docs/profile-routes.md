# My routes on the profile page

The signed-in profile shows My routes above send history. It initially loads the
newest five routes created by that account. Load more appends the next five and
disappears after the last page. Empty and failed requests have distinct states;
retrying a failed page retains previously loaded routes. Opening a route returns
to the wall and uses the normal current/historical wall selection.

`GET /v1/me/problems?cursor=...` requires the verified JWT. The user ID comes only
from its subject, never from a submitted owner/Setter value. Its opaque cursor
is bound to that user's partition. Replies hydrate current canonical route
records, including outdated status, and recheck ownership.

Route transactions add an `OWNER` directory pointer at `PROBLEM#id / OWNER`,
indexed by `USER#ownerId#ROUTES` and `PROBLEM#createdAt#id` on the existing `gsi1`.
Descending queries use a page size of five. New routes, edits and Upgrade copies
write this pointer atomically with the route. No table/index or IAM expansion is
needed. Routes are attributed by creator ID, independently of editable Setter.

Before deploying the frontend, deploy the backend and rerun the idempotent wall
publication sweep described in [wall-publication.md](wall-publication.md).
That sweep also rebuilds directory pointers for existing routes, preserving IDs,
roles, content and content timestamps. Missing creator IDs on legacy routes are
not assigned to a guessed account. This creates pointers only for known owners.

Backend tests cover 5/5/2 pagination, newest-first ordering, missing login,
cross-account cursors, live ownership checks, and creation indexing. The mobile
fixture `scripts/my-routes-smoke.cjs` covers twelve routes, failure/retry paths,
account isolation, current/old-wall navigation, empty accounts and responsive
layout without production writes.
