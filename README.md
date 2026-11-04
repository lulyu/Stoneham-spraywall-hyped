# Hyped@Stoneham CRG Spray Wall

A small, mobile-first spray-wall route-setting app for the Stoneham wall.

## MVP

The first version intentionally keeps everything local so we can validate the climbing interaction before building infrastructure:

- real wall image with pan / zoom
- 677 user-confirmed hold polygons overlaid on the wall
- tap holds to create a problem
- mark holds as **start**, **finish**, **hold**, or **foot-only**
- add problem name, V-grade, and setter
- save problems in browser `localStorage`
- browse saved problems and highlight their holds

## Run locally

```bash
npm ci
npm run dev
```

Then open the Vite URL on desktop or mobile.

## Current data caveat

The hold map was bootstrapped automatically from wall photos. It is useful enough to prototype the UX, but it is **not ground truth**: some pale / tiny holds are missing and a few neighboring holds may be merged or misplaced.

The next high-value feature is a tiny hold-map correction UI so the canonical wall map can be fixed by clicking rather than by tuning computer-vision thresholds.

## Likely next milestones

1. Clean / rectify the canonical high-resolution wall image.
2. Add hold-map correction: add, move, resize, and delete holds.
3. Improve problem browsing / filtering and project tracking.
4. Replace local storage with a small API backed by AWS Lambda + DynamoDB.
5. Add lightweight identity/auth only after the core interaction is useful.

The goal is deliberately not to build a full Stōkt clone. It is to build the smallest version that feels great on this one wall.

## Validation and wall image

Use Node.js 24 for development/CI and `npm ci` for the locked dependency versions.
`npm run build` checks TypeScript and creates the production bundle.

The full-resolution canonical image is served from
`public/wall/stoneham-spraywall-canonical.jpg` (7292 × 5514), with its original
aspect ratio preserved. The legacy embedded image was corrupt and is removed.
The app uses the 677 accepted polygons in `src/data/polygons/holds.json`. Old
automatic production maps have been removed. Experimental suggestions remain
separate; see `src/data/polygons/README.md` for IDs and storage compatibility.

Local phone testing over plain HTTP is supported, including browsers without
`crypto.randomUUID`. Storage failures leave the problem draft open and show an
error instead of claiming that the problem was saved.

A repeatable touch regression script is included at `scripts/mobile-smoke.cjs`.
With Playwright available and the dev server running, run
`node scripts/mobile-smoke.cjs`. Set `PLAYWRIGHT_MODULE_PATH` if Playwright is
installed outside this project and `CHROMIUM_PATH` to use system Chromium.
It uses isolated browser storage, tests touch pan/pinch/selection, save/reload,
small-screen layout and storage failures, and writes a screenshot to `artifacts/`.

## SAM2 crop experiment and polygon debug view

A separate SAM2.1 Small experiment segments only the top-left third of the image
in each dimension. Open **Polygon debug → Show all polygons** to compare current
candidates with **SAM2 top-left**, optionally show labels and focus the crop.
This changes the overlay only; route setting retains its current dataset.
See [experiment setup, results and limitations](docs/sam2-top-left-experiment.md).

## Manual SAM2 annotator

A separate local Python service now supports positive/negative points, box prompts,
mask previews, acceptance, deletion and JSON export. It reuses the crop embedding
and runs on CPU when CUDA is unavailable. See [local annotator setup and phone
preview notes](docs/sam2-local-annotator.md). Accepted holds stay separate from the
route-setting dataset.

### Full-wall annotation upgrade

The editor now covers the full wall with cached regional SAM2 inference. Your
43-hold top-left ground truth loads automatically into a separate working copy.
349 automatic suggestions can be reviewed, optionally accepted in a high-score
batch, and refined. Existing JSON can be imported and edited while preserving IDs.
See [full-wall workflow, data provenance and tests](docs/sam2-full-wall-annotator.md).

The canonical production hold map is now the accepted 677-hold v4 export.

## Backend infrastructure

The shared-data backend is deployed from `backend/` and `infra/`: a
TypeScript Lambda behind API Gateway HTTP API with a single on-demand DynamoDB
table. The data model separates gym, wall, wall version, and problem so wall resets
and future gyms are additive. See [`docs/infra.md`](docs/infra.md) for the schema,
API, build, and CloudFormation deployment workflow.

## Hold roles and selection styling

Route setting supports Start, Finish, Hold and Foot-only. Only the most recently selected or reassigned hold in setting mode uses a
thicker border with a rotating rainbow gradient and flowing highlight. Other
selected holds and saved-route viewing use solid role colors: Start cyan, Finish
dark red, Hold lime and Foot-only purple.
Reduced-motion preferences keep a static rainbow outline. Existing locally saved
`hand` roles are read as `hold` without changing IDs or the storage key.

Run `node scripts/hold-roles-smoke.cjs` against the local production preview to
check the four roles, legacy migration, persistence, animations and mobile layout.
The usual Playwright environment variables apply.

Confirmed selections use a gently pulsing glow behind their solid role-colored
outline; the latest setting selection keeps its rainbow highlight. In route view,
a gray wall overlay has cutouts for the current route's holds so those holds retain
the original photo colors. The overlay is absent while setting or before choosing
a route, and follows the image during pan/zoom. Reduced-motion preferences keep
static halos. The hold-role browser test covers pulse, mask holes and route switching.

Selection effects are now masked to the outside of confirmed hold polygons. Hold
interiors have no fill or center marker, so the original wall photo stays visible;
solid borders, rainbow accents and pulsing light remain outside the shape. The
browser test compares interior screenshot pixels with the unmodified wall view.

## Shared backend integration

Production uses `VITE_API_BASE_URL` to load, create and edit shared problems on the
Stoneham AWS API. Leave it empty for the existing local-only mode (see
`.env.example`). Vercel scopes this public URL to Production; previews stay local
unless explicitly configured for another backend. No AWS keys belong in Vite.

The wall is `stoneham-crg / spray-wall-1 / 2026-10-v4`. The API assigns IDs,
timestamps and revisions. Browsing and editing fetch the latest problem; updates
send that fetched revision. A 409 keeps the draft and offers to save it as a new
problem. Connection failures also preserve the draft; there is no silent fallback
to a local save when shared mode is configured. Use Refresh to reload the list.

Old device-local routes remain untouched. **Import local problems** copies them
to the shared wall only when clicked, normalizes legacy `hand` to `hold`, and
records completed imports per API URL on that device so a reload/retry skips
completed routes. Routes without a Start and Finish remain local and are reported.
Import progress uses browser storage; clearing that storage also clears the
import history. The route list loads 50 at a time and offers Load more routes. Filtering/search remain deferred.

Validation:
- `npm test`: store persistence, legacy compatibility, API payloads/revisions,
  conflict handling and network failure behavior (Node.js 24).
- `npm run build`: canonical data validation, TypeScript and production bundle.
- `node scripts/frontend-api-smoke.cjs`: local mobile browser integration with
  deterministic mocked API, import/retry, conflict and layout scenarios. Run a
  dev server on 5174 with `VITE_API_BASE_URL` pointing at the production URL and
  `VITE_COGNITO_AUTHORITY` / `VITE_COGNITO_CLIENT_ID` from `production.json`.
  Requests and the authenticated browser session are mocked; production data is
  not modified.
- The existing `scripts/hold-roles-smoke.cjs` continues to cover local-only
  persistence, four roles, rainbow effects, outer-only glow and route masking.

## Cognito authentication branch

See [authentication permissions and rollout](docs/auth.md). The layer is deployed;
real user login verification and initial administrator assignment remain pending.

## Profile and Setter defaults

Signed-in users can edit their own Profile: a display name (1–60 characters) and
optional short bio (up to 160 characters). Initially, the Google display name is
used until a custom profile is saved. Email is shown only on the user's own page,
from their login session; it is not copied into public route records.

GET/PATCH `/v1/me/profile` requires a Cognito access token. Profile records use
`USER#<verified-sub> / PROFILE` in DynamoDB, without route-list GSI attributes.
Only displayName and bio can be updated; user IDs, ownership and roles are never
taken from the request body.

Creating a new problem prefills Setter from the current display name. Setter
remains editable, existing route setters are preserved, and renaming a profile
does not rewrite old routes or change ownership. Profile save failures keep the
form available for retry. Bio can be cleared.

Validation: backend profile regression tests plus
`scripts/profile-smoke.cjs` (authenticated session/API mocks on local dev port
5176 with the deployed Cognito public configuration) exercise save/reload,
manual Setter overrides, existing Setter retention, retry and mobile layout.

## Route sends, enjoyment ratings and comments

Choose a saved shared route to see its activity panel. Public visitors can read
the average enjoyment rating and comments. Signed-in users can:
- Log one send per route; retries return the original send date instead of duplicates.
- Rate enjoyment from 1 to 5 and update their own rating.
- Post a plain-text comment (1–1000 characters). The server reads the author's
  saved Profile display name, falling back to "Climber"; no email is published.
- Edit or delete their own comments. Editing preserves the original author/date
  and shows an Edited marker; deletion requires confirmation. Failed requests keep
  the edit draft or confirmation available for retry.

Profile includes **Your sends**, newest first, with route name/grade/setter as
recorded at send time. Clicking a log fetches the original route directly, even
if it is outside the current route list's first page. History and comments have
20-item pages and Load more controls. Their GSI lists are eventually consistent;
Refresh sends reloads recent history. Rating totals are computed from per-user
rows, so updating a rating never adds another vote.

Authenticated endpoints:
- GET /v1/me/sends
- GET /v1/problems/:id/my-activity
- POST /v1/problems/:id/sends
- PATCH /v1/problems/:id/rating (`score`: integer 1–5)
- POST /v1/problems/:id/comments (`text`, optional UUID-v4 `requestId`)
- PATCH /v1/problems/:id/comments/:commentId (`text`, 1–1000 characters)
- DELETE /v1/problems/:id/comments/:commentId (comment author only)

Public endpoint: GET /v1/problems/:id/community. Paginated reads accept the
returned `cursor`; the server validates it against the selected route/user.

Data uses the existing DynamoDB table: send rows under USER#sub, rating/comment
rows under PROBLEM#id, and separate GSI partitions for send history/comments.
Identity always comes from the verified Cognito token. Comment request IDs make
network retries idempotent. No route metadata or revision is changed by activity.
The private my-activity response includes the caller's `commentIds`; public
comments expose no account identifiers. Ownership checks use the JWT subject and
are repeated in conditional DynamoDB writes. Admin status does not grant comment
editing rights. Deletion removes the text, author and GSI membership, retaining a
small tombstone so a delayed POST retry cannot recreate the comment. As with all
GSI activity lists, another browser may briefly see a stale comment after a change.
Ownership lookup queries all comments on the selected route; a separate ownership
index may be useful if individual routes accumulate very large comment histories.
This version has no send removal, repeated ascent counting or moderation UI.
Existing comments already contain server-assigned ownership; no migration is needed.
Route deletion remains disabled; the new DELETE endpoint only affects comments.

Validation: backend community tests cover auth, identity isolation, send/comment
retry safety, rating replacement/aggregation, cursor isolation and pagination.
`scripts/community-smoke.cjs` uses isolated authenticated session/API fixtures on
dev port 5178 (configure the deployed API URL and Cognito public identifiers) to
exercise mobile flows, failure retry, literal comment rendering, profile history
and anonymous read-only behavior, plus author-only comment editing/deletion,
cancellation, reload persistence and failed-write retry. Optional APP_URL/BROWSER_PROXY can target the
deployed frontend with those isolated fixtures.

## Continuous integration and recovery

CI runs on pull requests, branch pushes and manual dispatch, using Node.js 24,
read-only repository permissions and pinned checkout/setup-node action SHAs.
**Frontend checks** runs npm ci, tests and build. **Backend checks** independently
runs npm ci, tests, typecheck and build. Both dependency trees have committed
package-lock.json files; use npm ci (or npm ci --prefix backend), including for
Lambda deployment builds.

Configure both job names as required checks for main when the repository's plan
and administrator permissions allow it. The connected integration currently
receives 403 for branch protection, and GitHub reports that private-repository
rules require Pro (or a public repository). CI can run without those settings,
but cannot prevent a permitted operator from merging a failed PR until rules are
enabled. No paid plan or repository visibility changes were made.

Route pages return items and optional nextCursor. Load more appends pages without
duplicates or losing already loaded routes on a failed request. Refresh resets
pagination. Cursors are validated against the current wall version.

Expired tokens get a single shared silent-renew attempt. Silent-renew failure or
API 401 updates the UI to Sign in again and disables authenticated route saves.
Reauthentication stores the current route draft in sessionStorage and restores
it after login to the same Cognito subject, preserving the original editing
revision for conflict checks. Recovery expires after 24 hours; switching accounts
does not expose another account's draft. Explicit Cancel, successful save and
sign-out clear the recovery copy. Profile/comment API 401s also invalidate the
displayed login state.

## Public profile cards

The selected route retains its grade and editable setter credit, and adds
`∆ added by <display name>` for its authenticated creator. Click that name or a
linked comment author to open a small read-only display-name/bio dialog. Empty
bios say No bio yet; failed reads can be retried. Names and bios render as text.

These public reads resolve the identity from stored route/comment attribution:
- GET /v1/problems/:id/creator-profile
- GET /v1/problems/:id/comments/:commentId/author-profile

They return only `displayName` and `bio`, with no email, user subject, or admin
fields. There is no public user directory. Comment responses include a boolean
`hasAuthorProfile`, without publishing their account IDs. Deleted comments return
404 for their author-profile link. Legacy routes without an owner and comments
without recorded authors remain unlinked; setter text is never used to infer an
account. A missing saved name falls back to Climber (or the comment attribution).
Public cards load the latest saved profile; existing setter credit is unchanged.

Validation: `scripts/public-profile-smoke.cjs` exercises creator/comment cards,
setters different from creators, privacy-safe plain text, empty bios, retry,
focus return, Escape/backdrop dismissal, legacy data and 320–980px layout, using
isolated API fixtures. Backend tests check projection and attribution.
