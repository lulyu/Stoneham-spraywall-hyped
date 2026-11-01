# Stoneham Spray Wall

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
npm install
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

Use Node.js 22.12+ (or 24) and `npm ci` for the locked dependency versions.
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

## Backend infrastructure (infra-mvp-backend branch)

The first shared-data backend is scaffolded under `backend/` and `infra/`: a
TypeScript Lambda behind API Gateway HTTP API with a single on-demand DynamoDB
table. The data model separates gym, wall, wall version, and problem so wall resets
and future gyms are additive. See [`docs/infra.md`](docs/infra.md) for the schema,
API, build, and Terraform workflow.
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
