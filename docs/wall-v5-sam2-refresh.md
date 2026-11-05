# Candidate wall v5 and inherited-prompt SAM2 refresh

Branch: `feat/wall-v5-sam2-refresh`. Candidate version: **2026-11-v5**.
The active backend/catalog and production defaults remain **2026-10-v4**.
This is a versioned candidate asset plus an offline model experiment, not a
WallVersion promotion or accepted hold export.

## Versioned image

`public/wall/versions/2026-11-v5/` contains:

- `wall.jpg`: 7292×5514 registered four-photo composite, with original-reference
  pixels filling only no-observation gaps. This is a presentation candidate.
- `coverage.png`: actual new-photo observations; reference-filled pixels stay zero.
- `source-index.png`: original per-pixel photograph provenance (0=no observation).
- `uncertainty.png`: source seam, overlap QA and no-observation flags.
- `manifest.json`: candidate version, exact file hashes, original scan identity,
  reference image/map identity and QA failures.

The source photographs delivered in chat were 960×1280. Full-canvas output does
not recover missing detail. Observed coverage is 92.0973%; 7.9027% uses old reference
pixels only for display. The original overlap QA remains needs-review: one pair
exceeds its 10px p95 threshold and another lacks shared match support. See the
four-photo scan's original report in the local artifacts directory.

The version manifest does not appear in `backend/walls.json` because it has no
human-accepted hold catalog. Old routes must continue resolving their v4 assets.
The source scan and new filled candidate have distinct image hashes; previous
scan approvals/checkpoints cannot silently become approvals for this image.

## Reproduce the experiment

Set up the pinned CPU environment/checkpoint from
[sam2-top-left-experiment.md](sam2-top-left-experiment.md). CUDA is checked first;
the recorded experiment uses CPU and **SAM2.1 Small**. No checkpoint is committed.

```sh
SAM2_BUILD_CUDA=0 /tmp/stoneham-sam2-refresh/bin/python \
  -m tools.wall_rescan.sam2_refresh \
  --version-manifest public/wall/versions/2026-11-v5/manifest.json \
  --old-holds src/data/polygons/holds.json \
  --checkpoint /tmp/stoneham-sam2-models/sam2.1_hiera_small.pt \
  --output artifacts/wall-rescans/wall-v5-sam2-refresh-rerun
```

Use a new output directory. Inputs and checkpoint hashes are checked, including
exact candidate image, coverage, uncertainty and old geometry bytes. The script
never writes production/source paths as its run output. Missing dependencies or
checkpoint errors fail with a setup reference instead of pretend segmentation.

### Prompt and selection policy

1. Load all 677 accepted v4 outlines as **unreviewed inherited hints**. Only old
   positions with at least 99% actual new-photo coverage are eligible for inference.
2. Group eligible hints into 3×3 overlapping tiles; expand each tile to contain
   the inherited bounding boxes and context. Encode each tile once.
3. Use a distance-transform interior point (more reliable than an outside concave
   centroid) plus an old-geometry bounding box with margin to prompt SAM2.
4. Inspect the three masks; keep the component containing the seed. Reject low
   scores (<0.75), tiny masks, tile-edge truncation, extreme area ratios and masks
   crossing observation gaps. Exported polygon coverage is checked again after
   simplifying to at most 16 vertices.
5. Rank remaining alternatives using model score, old-mask IoU and area-ratio
   stability. Store model score, old-mask IoU, area ratio, full-frame center drift,
   coverage fraction and overlap uncertainty. These are review evidence, not
   proof that a physical hold stayed unchanged.
6. Deduplicate model proposals **against other proposals only**, preserving all
   associated old IDs. Old/unreviewed outlines are never an exclusion mask: a
   replacement at the same position must survive. Shared proposals are flagged
   for possible merging or duplicate prompts.

New proposal IDs are deterministic but provisional, separate from accepted old
identities. No model result marks an entry verified, removes an old hold, creates
an accepted catalog or migrates routes. No usable mask is not proof of removal.

### Outputs and use

- `sam2-refresh.json`: all original entries plus provisional model proposals,
  hashes, prompts, associations, evidence and recommendations. Always
  `publishable: false`, with zero accepted holds.
- `report.json`: execution/device/model/parameter/count summary.
- `old-vs-sam2-overlay.jpg`: cyan old outlines and orange proposed contours.
- `sam2-proposals-overlay.jpg`: proposed contours on the new candidate image.
- `progress.json`: partial diagnostic progress, not a resumable approval file.

The committed candidate dataset is copied to
`src/data/experiments/wall-v5-sam2-refresh.json` after a successful run. It is
intentionally not a normal accepted `holds` array or a browser review checkpoint.
The current unified editor does not import this model-proposal format yet;
inspect its overlays/JSON, then manually review corrections. Integrating these
proposals as selectable drafts in the editor is a separate incremental change.

This first pass does not search new locations away from old hints. A later grid /
color-seed pass must search observed regions without excluding unreviewed old
outlines, preserving replacement proposals for human review. Lighting, protruding
hold parallax, registration uncertainty, pale holds and model merges remain
limitations; use original-resolution capture files before final fine labeling.

## Checks

```sh
.venv-rescan/bin/python -m unittest discover -s tests/wall_rescan -v
npm test
npm run build
```

Helper tests do not require torch or a downloaded checkpoint. They cover fallback
coverage, interior points, mask filtering/normalized geometry, retained overlapping
replacement suggestions, dedup associations, provisional recommendations and
hash-bound v5 assets while v4 remains active. Actual model execution is recorded
separately in the run report and is not claimed by those helper tests.
