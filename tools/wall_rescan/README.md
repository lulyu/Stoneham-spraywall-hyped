# Single-photo wall registration baseline (Phase A)

Registers one photograph into an existing wall image's coordinate system on CPU.
Uses SIFT + mutual/ratio matching and robust homography; no SAM2 model is needed.
It generates observation masks and unreviewed copies of intersecting old polygons.
It never changes production assets, route records or accepted annotations.

## Setup and run

From the repository root (Python 3.10+; baseline run uses Python 3.12):

```sh
python -m venv .venv-rescan
.venv-rescan/bin/pip install -r tools/wall_rescan/requirements.txt
.venv-rescan/bin/python -m tools.wall_rescan.run \
  --photo private-inputs/baseline-20261031/raw/IMG20261031152837.jpg \
  --scan-id baseline-20261031 \
  --reference-version 2026-10-v4 \
  --candidate-version baseline-20261031 \
  --output artifacts/wall-rescans/baseline-20261031-rerun
```

Place the user-supplied photo at the input path above; it is not committed.
`private-inputs/` is ignored. The default reference image and hold map are the
existing canonical assets; override `--reference-image`/`--reference-holds` for
another reference or a synthetic test. Reference pixels are the EXIF-prepared
reference image; hold coordinates remain normalized to its entire dimensions.

An output directory must be new or empty. A per-run lock prevents concurrent
writes. Nonempty outputs and inputs nested inside the output are rejected.
Output paths under source/production directories are rejected, including through
symlinks. Preserve the old output and choose a new directory for reruns.
Missing dependencies, bad images, insufficient features, clustered matches and
bad geometry fail clearly. Failed registration writes a non-publishable report
(and diagnostics when fitting reached that stage), not a registered wall image.

`--seed 0`, single-threaded OpenCV, pinned dependencies, source hashes and code
hashes make runs repeatable in the same environment. `manifest.json` records the
commit, whether the tool/test source is dirty, dependency versions, preprocessing,
input paths/hashes, parameters and immutable session identity. Other platforms
may have small floating-point differences; validation should compare geometry,
not promise bit-for-bit equivalence across all machines.

## Artifacts

- `registration.json`: transform/inverse, EXIF and resize matrices, source footprint,
  every match, fit/hold-out flags and full-reference-pixel residuals.
- `wall_registered.jpg`: full-reference-sized source warp; black outside new coverage.
- `coverage.png`: authoritative mask, 255 observed / 0 unobserved; source-edge
  interpolation support is excluded. `source-index.png`: 1 source / 0 no observation.
- `aligned-crop.jpg`, `reference-vs-registered.jpg`, `prelabels-overlay.jpg`:
  inspection crops; cyan outlines are unchanged old polygons, not new detections.
- `placement-preview.jpg`: source location on a dim old wall, diagnostic only.
- `old-new-overlay.jpg`: 50/50 comparison, diagnostic only; its old pixels are not
  counted as new observations. `residuals-10x.jpg`: arrows amplified 10x, blue fit
  inliers and yellow consistent held-out matches.
- `holds_prelabels.json`: exact old IDs/geometry for polygons intersecting coverage,
  with session identity and an explicit unreviewed/non-publishable dataset role.
- `review_queue.json`: all old holds, coverage fractions, all inherited-unreviewed.
  Uncovered and partially covered holds are never automatically marked removed.
- `lineage.json`: unverified continuity proposals. `report.json`: scope and QA.

No accepted export is produced. Do **not** load the prelabels into the old
annotator as accepted data; its import behavior predates the rescan workflow.
The file carries the actual backend wallId, which the legacy importer rejects;
it cannot be directly imported there as accepted data. A rescan-aware review
editor, approval persistence/export gate, changed/new hold
classification, multi-source mosaic and WallVersion publication are later phases.
`new_hold_count`/`removed_hold_count` are null because change classification has
not run, not evidence that the image contains no changes.

## QA and independent checks

Twenty percent of descriptor matches are held out **before fitting**. The fit uses
only the other 80%; the tool does not then refit on held-out matches. Reports show
both all held-out residuals (including wrong correspondences) and the subset
within the configured threshold, with its count/fraction. The consistent subset
is a threshold-conditioned consistency statistic, not independent accuracy.
Fit residuals and held-out descriptor matches cannot substitute for human-picked
independent wall landmarks. Same-source baseline performance is optimistic.

Current experimental gates: >=20 fit inliers, >=35% fit inliers, source inlier
convex hull >=5% of the photo, fit p95 within `--max-error-px` (default 8 full
reference pixels), >=4 and >=50% held-out matches consistent. Also reject a
singular/mirrored/folded footprint, a projective horizon crossing the image,
local scale outside 0.01–100 or anisotropy >20. These are conservative engineering
sanity checks, not calibrated Stoneham change-detection thresholds. A failed gate
requires manual alignment; it is excluded from the registered output.

Optional `--alignment-anchors anchors.json` fits a manual global homography.
Use at least four well-spread source/reference pixel pairs (4–8 is practical).
Optional `--validation-anchors checks.json` reports independent landmark residuals
and fails QA when p95 exceeds `--max-error-px`. Check anchors must be different
from manual fit anchors. Both use EXIF-prepared native pixel coordinates:

```json
{
  "source_size": [960, 1280],
  "reference_size": [7292, 5514],
  "source_points": [[10, 10], [900, 10], [900, 1200], [10, 1200]],
  "reference_points": [[100, 200], [2700, 200], [2700, 3700], [100, 3700]]
}
```

Those coordinates are schema examples, not measured correspondences. No lens
undistortion or local/panel warp is performed; no-data regions stay explicit.

## Tests

```sh
.venv-rescan/bin/python -m unittest discover -s tests/wall_rescan -v
```

Covers known transforms with outliers, inverse/non-square resize round trips,
all eight EXIF orientations, clustered/degenerate/horizon/anisotropy rejection,
unchanged ID/geometry transfer, partial/no coverage, repeatable real SIFT fitting
on synthetic texture, existing-output protection, input immutability and a blank
image failure. The supplied real photo is a separate inspected baseline; small
QA previews and its report/manifest/matches are committed, raw/intermediate files
are not.

## Multi-photo candidate mosaics (Phase B)

Use `python -m tools.wall_rescan.mosaic --manifest scan.json --output NEW_DIR`.
See [MOSAIC.md](MOSAIC.md) for source selection, masks/facets, seam protection,
coverage/alignment QA, fixture generation and explicit failure states. Phase C
change detection and interactive review/approval remain unimplemented.
