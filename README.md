# Stoneham Spray Wall

A small, mobile-first spray-wall route-setting app for the Stoneham wall.

## MVP

The first version intentionally keeps everything local so we can validate the climbing interaction before building infrastructure:

- real wall image with pan / zoom
- 469 first-pass hold candidates overlaid on the wall
- tap holds to create a problem
- mark holds as **start**, **hand**, or **finish**
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
The current circular hold map comes from an earlier photo; its alignment against
this canonical image still needs manual correction. Experimental polygon
candidates remain separate, as documented in `src/data/polygons/README.md`.

Local phone testing over plain HTTP is supported, including browsers without
`crypto.randomUUID`. Storage failures leave the problem draft open and show an
error instead of claiming that the problem was saved.

A repeatable touch regression script is included at `scripts/mobile-smoke.cjs`.
With Playwright available and the dev server running, run
`node scripts/mobile-smoke.cjs`. Set `PLAYWRIGHT_MODULE_PATH` if Playwright is
installed outside this project and `CHROMIUM_PATH` to use system Chromium.
It uses isolated browser storage, tests touch pan/pinch/selection, save/reload,
small-screen layout and storage failures, and writes a screenshot to `artifacts/`.
