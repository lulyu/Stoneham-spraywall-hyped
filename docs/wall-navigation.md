# Wall-first navigation

The landing screen shows the wall and two lime actions: **Login to set** (or
**＋ Set** when signed in) and **Explore routes**. Explore opens a modal drawer
from the right. Choosing a route closes it and highlights that route on the wall;
its send, rating, comment and edit controls remain below the wall. Refresh,
pagination, load failures and local-route import stay inside the drawer.

The circular account menu contains Profile and Sign out. Polygon debug is inside
that menu for verified administrators only; losing admin identity also removes
its overlays. This visibility rule does not change backend authorization.
Fit wall is a translucent, labeled resize icon at the top right of the viewport.

The drawer uses native dialog focus containment, Escape dismissal, backdrop
click dismissal and focus restoration. Its entrance animation respects reduced
motion. While setting a route, the wall keeps its shorter editor layout; an
expired session exposes Sign in again without losing the draft.

## Verification

Run `npm ci`, `npm test` and `npm run build`. With a shared-mode development server
configured using the existing public API/Cognito settings, run:

```sh
APP_URL=http://localhost:5182 node scripts/wall-navigation-smoke.cjs
```

Requires Playwright and Chromium; `PLAYWRIGHT_MODULE_PATH` and `CHROMIUM_PATH`
can select existing installations. This check mocks API and login identities
(guest/member/admin) rather than writing production records. It covers drawer
open/close, Escape, backdrop, focus return, route selection, account/profile,
editor entry, admin-only polygon overlays and widths from 320 to 980 px. It
writes `artifacts/wall-home-mobile.png` and `artifacts/wall-routes-mobile.png`.
The profile, frontend API, community and pagination/auth smoke checks use the
new navigation too.

## Route sharing

Shared routes have a copy-link icon beside Edit problem, replacing the activity
jump link. It copies `/?route=<id>` and announces Link copied. If clipboard access
is unavailable or denied, a selectable Route link field provides manual copying.
The public link fetches its route directly by ID, including routes outside page
one; a late list load or refresh does not clear the selection. Invalid or failed
links show a visible error with retry/dismiss controls. Selecting or clearing a
route keeps the query parameter in sync. Login carries that route ID through
OIDC user state, so the callback can return to it without including OAuth tokens
in a shared URL. Local-only routes are not shareable across devices.

`scripts/route-share-smoke.cjs` verifies the copy and manual-copy flows, a fresh
anonymous deep link, a route outside page one, late list/refresh responses, and
missing/failed-link handling with isolated API fixtures.
