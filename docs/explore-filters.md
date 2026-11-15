# Explore filters and sorting

Explore defaults to all routes, newest first. The filter icon beside Refresh
opens a panel containing all filter and sort controls; fresh Explore visits start
with it collapsed. The icon highlights when filters or a non-default sort are
active. Collapsing the panel preserves those selections. Grade selects an exact grade;
Valid only hides outdated routes on the latest physical wall. Reset filters
restores all grades, all routes, and newest first. Grade sorting is numeric,
including VB and V10+, with unknown grades last. Both grade and star sorting
support either direction.

Stars use the existing public Enjoyment average, with rating count as a tie-break
and newest as the final tie-break. Unrated and unavailable summaries stay last in
both directions. Every Explore card shows a compact star and average at the right,
regardless of the selected sort, with vote counts in its accessible label and
hover text. Empty stars distinguish unrated, loading, and unavailable summaries.
Rating summaries load when Explore opens, including default newest browsing. Public summaries load with at most four requests in
flight and are cached for the tab. A failure leaves the route visible and exposes
Retry ratings. Confirmed ratings from route activity update the cache and order;
Refresh clears the cache and reloads routes and summaries.

Any active filter or non-default sort automatically follows all route-list pages,
so results include routes beyond the initially loaded page. A loading message
identifies partial results during this fetch. A list failure preserves loaded
routes and allows retry with Load more routes. Unchanged cursors stop with an
error rather than looping. Default browsing retains manual pagination.

Browser Back/Forward preserves the Explore query alongside the existing list and
scroll snapshots. No database migration, API change, or private rating read is
required; sorting consumes the existing GET community summary.

Verification: `npm test`, `npm run build`, and
`APP_URL=http://localhost:5194 node scripts/explore-filters-smoke.cjs` (Playwright
and Chromium required). The mobile fixture covers cross-page filtering and retry,
combined validity/grade, empty results, numeric grade sorting, rating ties and
unrated routes, summary failures/retry/cache, Back navigation, confirmed rating
updates, refresh, and narrow-screen layout. All writes are mocked.
