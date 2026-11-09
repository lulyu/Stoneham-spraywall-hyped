# Hyped@Stoneham CRG Spray Wall

A mobile-first route-setting app for the Stoneham CRG spray wall.

**[Open the app](https://stoneham-spraywall-project.vercel.app/)**

## Features

- Pan and pinch to zoom on the real wall photo; tap holds to set a route with
  **Start**, **Finish**, **Hold**, and **Foot-only** roles.
- Sign in with Google to save shared routes, edit your routes, and log sends,
  enjoyment ratings, and comments. Browsing does not require sign-in.
- Explore all routes on the latest wall. Outdated routes remain clickable and
  open on a compatible historical wall, with an old-wall notice.
- Upgrade your outdated route into a new draft with the surviving holds and a
  suggested V2/V3 name. Saving creates a new route; the original and its activity
  stay intact.
- Edit your profile and browse **My routes**, newest first: five initially, then
  **Load more**. Creator attribution uses the account identity; the editable
  Setter credit can name someone else.
- View public creator profiles and your own send history. Use **Browse wall
  history** at the bottom of the page to see earlier wall versions.

## Current wall and updates

The current wall is **2026-11-v7**, with **797 human-reviewed holds** and a
7292 × 5514 image. The original **2026-10-v4** wall retains its 677-hold map for
historical routes. The app opens the current physical wall by default.

A publication checks every hold used by each existing route, including starts,
finishes, and foot-only holds. If all IDs still exist, the route gains the new
wall ID in `supportedWallVersionIds`. Otherwise, it is marked `outdated` and
remains available on an older wall. Compatible routes keep their IDs and activity.

Wall preparation is a maintainer workflow: compose/register photos, generate
SAM2 suggestions, review the outlines, archive the completed review, deploy the
versioned catalog, and run the compatibility sweep before releasing the frontend.
See [wall publication and Upgrade](docs/wall-publication.md) and
[the v7 image/review workflow](docs/wall-v7-seam-trial.md).

## Permissions

| Action | Who can do it |
| --- | --- |
| Browse routes, wall history, ratings, comments, and public profiles | Anyone |
| Create routes, manage a profile, log sends, rate, and comment | Signed-in users |
| Edit a route | Its creator or a gym administrator |
| Edit or delete a comment | Its author |
| Upgrade an outdated route into a new route | Its original creator; admin status alone does not grant this |
| Run the wall publication/compatibility HTTP endpoint | A signed-in member of the Cognito `admins` group |
| Deploy wall images, catalogs, or application code | Maintainers with the relevant GitHub and AWS/Vercel permissions |

The publication endpoint enforces administrator membership **on the backend**;
ordinary authenticated users receive 403. Administrator membership is assigned
through Cognito administration, never through an editable profile field. The
publication CLI instead requires AWS IAM permission to invoke the backend Lambda.
Publishing here runs the compatibility sweep for an already deployed wall
version; it is not an online image-upload or deployment dashboard.

**The annotation/review tools have separate access control.** Their browser UI is
not gated by the app's Cognito admin role. Imported scans and review checkpoints
are local working data, and exporting them does not publish a wall. The Python
SAM2 service supports an optional shared access key; use that protection for a
temporary HTTPS review session. An unkeyed server has no authentication and
should stay local. See [review server setup](docs/wall-v5-review-server.md) and
[authentication details](docs/auth.md).

## Run locally

Use **Node.js 24** and the committed lockfiles.

```sh
npm ci
npm run dev
```

Open the Vite URL. Without backend configuration, routes are saved on that device
in browser storage, using the current wall map.

For shared mode, copy the environment template:

```sh
cp .env.example .env.local
```

Set `VITE_API_BASE_URL`, `VITE_COGNITO_AUTHORITY`, and `VITE_COGNITO_CLIENT_ID` for
your backend, then restart Vite. These are public client settings. AWS credentials,
Google OAuth client secrets, access tokens, and temporary reviewer keys do not
belong in frontend environment variables or committed files.

## Checks

Frontend:

```sh
npm test
npm run build
```

Backend:

```sh
npm ci --prefix backend
npm test --prefix backend
npm run typecheck --prefix backend
npm run build --prefix backend
```

Offline wall-registration tests use Python 3.12:

```sh
python -m venv .venv-rescan
. .venv-rescan/bin/activate
python -m pip install -r tools/wall_rescan/requirements.txt
python -m unittest discover -s tests/wall_rescan -v
```

CI runs frontend and backend checks on pushes and pull requests; wall-rescan
changes also run the offline Python suite. SAM2 inference requires the separate
model setup described in the annotation documentation.

Browser regression scripts live in `scripts/`. For example,
`scripts/my-routes-smoke.cjs` covers profile pagination, retries, account isolation,
and historical-route navigation with isolated authenticated API fixtures. Use
`APP_URL` for a configured frontend, `PLAYWRIGHT_MODULE_PATH` when Playwright is
installed elsewhere, and `CHROMIUM_PATH` for a system Chromium executable.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/` | React/TypeScript app, route viewer, profiles, and review editor |
| `src/data/walls/2026-11-v7/` | Current reviewed hold map and publication manifest |
| `src/data/polygons/holds.json` | Original v4 hold map retained for history |
| `public/wall/versions/` | Versioned wall images and provenance |
| `backend/` | TypeScript API Lambda and build-time wall catalog |
| `infra/cloudformation/` | API Gateway, Lambda, DynamoDB, and Cognito infrastructure |
| `tools/wall_rescan/` | Photo registration, stitching, SAM2 proposals, and review bundles |
| `reviews/` | Archived review checkpoints and confirmed geometry |

Production uses **React + Vite on Vercel**, **API Gateway + Lambda + DynamoDB**,
and **Cognito with Google sign-in**. Shared writes validate ownership and hold
IDs on the backend. Revision checks protect against concurrent route edits;
failed saves preserve the draft. Review checkpoints use IndexedDB with explicit
exports for backup.

## Contributing and further reading

Fork the repository and open a pull request. Include the relevant checks and, for
UI changes, a mobile screenshot or browser verification. Wall-data changes should
include their provenance and review evidence; keep stable hold IDs for unchanged
physical holds. Experimental SAM2 suggestions are not accepted geometry.

- [Profile route list and pagination](docs/profile-routes.md)
- [Authentication, creator names, and permissions](docs/auth.md)
- [Wall publication, route compatibility, and Upgrade](docs/wall-publication.md)
- [Review progress storage and recovery](docs/review-storage.md)
- [Full-wall SAM2 annotation](docs/sam2-full-wall-annotator.md)
- [Backend architecture](docs/infra.md) and [deployment](infra/cloudformation/README.md)
