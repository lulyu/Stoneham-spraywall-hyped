# Phase B: multi-photo candidate mosaic

CPU-only offline processing in the existing canonical frame. Sources are
registered with the same Phase A geometry/QA, then selected per region by
registration confidence, resolution, view distortion, local sharpness, distance
from source borders/occlusions and clipping/exposure quality. A cached reference
SIFT extraction and deterministic FLANN matching make larger batches practical.
`matcher: "bf"` retains exhaustive matching when needed.

No RGB blending is used in the candidate. Each observed output pixel takes one
warped source's pixel, with optional recorded per-channel exposure gains. The
lossless PNG and 16-bit source-index map retain exact selection provenance.
No-data pixels stay black with index 0; the old reference is used only for
alignment, bounded exposure normalization and explicitly labeled diagnostics.

## Manifest and command

Use the pinned dependencies from requirements.txt, then:

```sh
.venv-rescan/bin/python -m tools.wall_rescan.mosaic \
  --manifest private-inputs/new-scan/scan.json \
  --output artifacts/wall-rescans/new-scan
```

Input paths are relative to the input manifest. Example (names are illustrative):

```json
{
  "scanId": "new-scan",
  "referenceVersion": "2026-10-v4",
  "candidateVersion": "new-scan-candidate",
  "referenceImage": "../../public/wall/stoneham-spraywall-canonical.jpg",
  "referenceHolds": "../../src/data/polygons/holds.json",
  "inputKind": "real-captures",
  "settings": {
    "max_side": 2400,
    "features": 18000,
    "matcher": "flann",
    "max_error_px": 8,
    "max_overlap_error_px": 10,
    "min_coverage": 0.995,
    "cell": 32,
    "guard_pixels": 8,
    "normalize_exposure": true,
    "seed": 0
  },
  "sources": [
    {"id": "overview", "image": "raw/overview.jpg"},
    {"id": "upper-left", "image": "raw/upper-left.jpg", "valid_mask": "masks/upper-left.png"},
    {"id": "panel-right", "image": "raw/right.jpg", "source_roi": [100, 100, 1500, 1800], "alignment_anchors": "anchors/right.json"},
    {"id": "occluded", "image": "raw/occluded.jpg", "enabled": false}
  ]
}
```

`inputKind` must be `real-captures`, `reference-derived-fixtures` or
`mixed-fixture-baseline`. It is included in reports and preview watermarks.
An optional `required_roi: [left, top, right, bottom]` defines the region whose
coverage is required; it defaults to the entire reference. This does not fill
outside pixels or change the canonical coordinate system.

A `valid_mask` is a grayscale image with the full **EXIF-prepared source** size:
white >=128 is usable, black is occluded/excluded. It limits feature extraction,
observation coverage and scoring. `source_roi` is an integer bounding box in that
same full prepared photograph. It can split a photograph into several explicit
facet entries, each with its own fit/validation anchors and mask. This is manual
piecewise-planar configuration, not automatic 3D reconstruction. Anchor files use
the Phase A format, with source coordinates and source_size relative to the
cropped ROI. The raw-full-source -> reference transform is recorded too. Anchors
inside masked regions are rejected.

`priority` (0.25–4, default 1) may express an operator's source preference but
cannot bypass registration QA. Unknown settings, duplicate IDs and invalid flags
are rejected. At most 64 source entries are supported. Nonempty outputs, inputs
inside outputs, source/production output paths and input mutation during a run
are rejected. Identity binds the input manifest, all referenced source/mask/anchor
content hashes, reference image/map, dimensions, versions and registered-image
hash; an identical-sized different image is a different session.

## Source selection and seam protection

1. Register each enabled source; reject failed geometry/coverage individually and
   save per-source diagnostics. All-rejected runs fail without creating a mosaic.
2. Score at a coarse grid (`cell`, default 32 native reference pixels), then use
   three neighbour-agreement passes for coherent selection. Invalid cells cannot
   win through smoothing. Full-resolution valid-pixel fallback handles boundaries
   missed by the scoring grid.
3. Protect old polygon cores plus an 8px margin, where feasible, with a single
   covering source. Truly touching cores form one group. Nearby but separate
   cores keep separate groups: their buffers are partitioned by nearest core,
   rather than merging a dense chain of holds into one enormous region.
4. If no source covers a protected group and the group spans several selected
   sources, mark it uncertain and fail the review-readiness check. Old contours
   here are only seam-protection hints, not verified occupancy masks for new-hold
   detection. New/changed holds outside them are not protected by this heuristic.
5. Save seam bands for future inspection; never hide a bad fit with feathering.

Exposure normalization uses robust RGB medians on valid old-outline-free wall
background at the scoring scale; gains are clamped to 0.85–1.18 and recorded.
It can be disabled. It is a photographic heuristic, not a calibrated physical
color measurement or a change classifier.

## Outputs and failure states

- `wall_registered.png`: lossless full-reference-sized selected source pixels;
  `wall_registered.jpg`: convenience copy; `mosaic-preview.jpg`: labeled preview.
- `source-index.png`: uint16, index 0=no observation, other codes resolve through
  manifest.json; `source-index-preview.png`: color map with legend.
- `coverage.png`: any valid observation; `coverage-count.png`: contributing valid
  observation count, even when a source was not chosen for the final pixel.
- `uncertainty.png`: bit flags: 1 source seam band, 2 insufficient shared overlap
  evidence, 4 registration disagreement, 8 split old-hold group, 16 no observation.
- `qa-overlay.jpg`: magenta missing, yellow source seams, red alignment/split risk.
  These are **not detected hold changes**.
- `sources/NNN-registration.json` and `NNN-coverage.png`: diagnostics for each source;
  rejected source IDs are retained in the manifest, never used in source-index.
- `holds_prelabels.json`, `review_queue.json`, `lineage.json`: exact old geometry,
  all inherited-unreviewed. Coverage and uncertainty are evidence only. The old
  annotator rejects the real wallId rather than silently accepting these labels.
- `manifest.json`, `report.json`: hashes, code versions, settings, decisions,
  exposure gains, per-source contributions, overlap and hold-seam QA.

Every output is `publishable: false`; no accepted hold export is produced.
Exit 0 means ready for human review, not published or human-approved. Exit 2
means a candidate was produced but requires attention: required coverage is below
the threshold, a protected group splits, or an overlap is not verified. Exit 1
means an invalid input/fatal failure or no usable sources. Holes and failed
alignments stay visible even when useful sources remain.

Overlap QA compares projections of shared reference SIFT correspondences from
fit inliers / consistent hold-out matches. At least 12 shared points are required;
p95 must be <=10 full reference pixels by default. Four coarse scoring cells of
mutual coverage trigger this check. Manual-only overlap may remain unverified;
inspect it or supply enough measured evidence, not a fabricated approval flag.
These checks cannot detect every local parallax or unmatched hold deformation.
An insufficiently supported overlap remains review-required. Future real-scan
validation needs independent landmarks and panel-specific checks.

## Reproducible development fixture

The available user photo covers only part of the original wall. For end-to-end
full-wall exercise, generate six overlapping crops of the old reference, a
blurred/brighter duplicate and a deliberately blank rejection sample; optionally
include the user photo. Raw/derived inputs stay under ignored private-inputs/.

```sh
.venv-rescan/bin/python -m tools.wall_rescan.make_mosaic_fixture \
  --output private-inputs/mosaic-fixture-v1 \
  --extra-photo private-inputs/baseline-20261031/raw/IMG20261031152837.jpg
.venv-rescan/bin/python -m tools.wall_rescan.mosaic \
  --manifest private-inputs/mosaic-fixture-v1/scan.json \
  --output artifacts/wall-rescans/mosaic-fixture-v1-rerun
.venv-rescan/bin/python -m tools.wall_rescan.evaluate_fixture \
  --truth private-inputs/mosaic-fixture-v1/fixture-truth.json \
  --result artifacts/wall-rescans/mosaic-fixture-v1-rerun
```

The evaluator binds reference/source hashes and uses known synthetic crop
transforms on probe points independent of the fitted SIFT pairs. Its accuracy
numbers describe those derived fixtures only. The real user photo is excluded
from that geometry-truth score. This is not evidence of performance on a new
wall or changed holds. Use a new output directory for each run.

Tests run through the existing Wall rescan CI job:

```sh
.venv-rescan/bin/python -m unittest discover -s tests/wall_rescan -v
```

They cover Phase A regression, single-source provenance, blur preference, holes,
masks in registration, raw/ROI frame transforms, nearby hold buffers, unresolved
hold splits, overlap disagreement, rejected/all-bad sources, input validation,
repeatability and output safety. This implementation remains offline: no route,
production image/hold map, active WallVersion or backend catalog is changed.
