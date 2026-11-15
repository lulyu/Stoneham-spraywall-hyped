# Completed v8 human review archive

The user's final export is preserved byte-for-byte as `review-progress-r812.json`.
SHA-256: `5a7c70721cca771a94e38d2f586280790c9bd06224b3ae6e26bb83647dc42abc`.

It was replay-validated against the exact v8 baseline, image, reference map,
coverage, uncertainty and SAM2 proposal identities. The review has
**801 active confirmed holds, 8 removed holds and zero pending entries**:
789 inherited outlines were refined and 12 new holds were added. All 812 revisions
and 814 history events are retained; no prior candidate's approvals were reused.

`confirmed-geometry.json` is derived directly from confirmed review entries, with
789 retained old IDs, 8 retired IDs and 12 new IDs. All five supplemental model
locations correspond to confirmed new geometry (the reviewer used their own new
IDs rather than the model's provisional IDs). Their geometric matches are in the
summary; IDs were not changed to force a match.

`wall.jpg` is the exact reviewed 7292 × 5514 image, SHA-256
`be434e5ca6c33b9c8f126fbf6950eb8fb1e8df00ff3130eda47ff2da6b98f1f1`. `coverage.png`, `uncertainty.png`, `source-index.png`,
`candidate-manifest.json` and `composition-manifest.json` preserve image evidence.
`baseline/` keeps the immutable original pending queue and model proposals.
The previous v7 reference image/map remain in their existing versioned repository
locations, recorded in `archive-manifest.json`. Raw photos and temporary server
access credentials are not part of this archive.

## Publication checks remain open

Two positions that the image comparison identified as changed were refined with
old IDs in this export:

- `sam2-auto-0240`: the former mint-green position now occupied by a purple hold.
- `scan-3d03fe67-21c0-4ff4-af5c-31e25b77e011`: the former purple position now occupied by an orange hold.

The raw checkpoint and derived geometry are intentionally unchanged. Review these
identity decisions before publishing/migrating routes, since retaining an ID can
make a route appear compatible. Details and duplicate-screening results are in
`geometry-qa.json`. This backup is **unpublished** and does not change the active
v7 wall, catalogs or route records.

## Verify

With Node.js 24, from the repository root:

```sh
node reviews/2026-11-v8-reviewed/validate.mjs
```

This checks hashes, replays the complete decision history, compares the derived
geometry, and confirms zero pending entries. `confirmed-overlay.jpg` visualizes
the final reviewed outlines. The separate standard workflow is documented in
[wall-update-workflow.md](../../docs/wall-update-workflow.md).
