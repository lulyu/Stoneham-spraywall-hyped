# Route comment counts

Explore shows a comment icon and total beside a route's name only when its count
is positive. Zero or unavailable totals do not show a badge. The count has an
accessible singular/plural label and stays beside wrapping names on small screens.

Route list and detail responses include a derived `commentCount`. Community
responses and successful comment create/edit/delete replies include the current
total too. The UI updates the existing route list from those confirmed replies;
failed requests do not optimistically change a badge. Refresh reloads totals,
including comments from other users.

The backend counts live `COMMENT#` records on the table's primary partition,
using consistent `Select: COUNT` queries and following every pagination key.
Deleted records are excluded, including pages containing only tombstones. Totals
are independent of the 20-comment display page and of the eventually consistent
comment-list index. List enrichment runs at most eight count queries concurrently.
When server totals are present, the browser makes no per-card community requests.
For older deployments without totals, badges load independently through all public
comment pages, deduplicating IDs with at most four requests in flight. A failed
count leaves its badge unavailable without blocking route browsing. Confirmed
legacy add/delete replies adjust the known total once, including retries. Counts
from the legacy comment index are eventually consistent; Refresh reloads them.
This compatibility path lets the frontend ship independently of the backend.
Counts are derived reads, so
there are no stored counters, migration/backfill, or extra IAM actions.

Backend regressions cover counts beyond a display page, empty filtered pages,
soft deletion, duplicate create/delete retries, edits, and unchanged route META.
`scripts/comment-counts-smoke.cjs` verifies badges, zero hiding, comment pagination,
failure/retry behavior, immediate list updates and 320–980px layouts with isolated
API fixtures in both server-total and LEGACY_COMMENT_API=1 modes. It does not
write production data.
