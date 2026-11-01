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
