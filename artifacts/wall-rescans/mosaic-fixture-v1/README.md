# Phase B inspection evidence

This is an **offline fixture baseline**, not a fresh scan and not a published
WallVersion. The candidate remains `publishable: false`. Source implementation:
`2e1c25856e2966d422ea4d0f067f65fe68597120` (clean pipeline source at generation).
Session: `da7ba6b5dbcc09c6c521454c803c69b70bb59f5af43ff4a8f772005279de08fc`.

## Inputs and results

- Six overlapping JPEG crops of the existing canonical image, one blurred/brighter
  duplicate, one blank rejection sample, and the user's original-session partial
  photo. These do not simulate actual changed holds or new camera viewpoints.
- 8 sources passed registration QA; the blank image was rejected.
- Canvas: 7292 × 5514. Observed coverage: 99.937830916% of the whole reference;
  remaining pixels are explicit no-data, never filled from the old wall image.
- All 677 inherited old outlines have at least 99% observation coverage. All remain
  `inherited-unreviewed`; **0 accepted holds**, no change classification.
- No failed overlap checks or unresolved split protected regions in this fixture.
- Independent synthetic-transform probes: 175 points across 7 derived sources;
  median 0.4613px, p95 0.5085px, maximum 0.5392px in full-reference pixels.
  These measure known crop transforms, not independent real-scene accuracy.
  The user's partial photo has no known ground-truth transform and is excluded.

## Inspection files

- [Mosaic preview](mosaic-preview.jpg): the selected candidate source pixels.
- [Source map](source-index-preview.png): source identity with legend; no RGB blending.
- [QA overlay](qa-overlay.jpg): missing areas (magenta), source seams (yellow),
  alignment/split risks (red). These colors are **not detected hold changes**.
- [Prelabels](prelabels-overlay.jpg): old geometry shown for human inspection.
- [Report](report.json), [compact manifest](manifest-summary.json) and
  [fixture validation](fixture-validation.json): metrics and audit information.

Raw inputs, full-resolution outputs, masks and the full correspondence manifest
are intentionally excluded from Git. See
[the reproducible fixture commands](../../../tools/wall_rescan/MOSAIC.md#reproducible-development-fixture).
The raw user photo must be supplied to reproduce this exact mixed-input session;
the generated-only fixture can run without it as a distinct session.

## Verification and limits

24 Python tests passed, including Phase A regression, masks, source selection,
provenance, rejection, overlap disagreement, protected regions and output safety.
Two complete runs in the pinned CPU environment produced byte-identical registered
PNG, source-index, coverage/count, uncertainty, prelabels, review queue, lineage,
report and full manifest (10 files). Byte equality is environment-specific; hashes
and dependency versions are recorded for audit.

The canonical production image and hold map remain byte-identical to `main`.
This stage does not implement SAM2 change proposals, reviewer decisions, publication
or route migration. New captures still need independent landmark checks and
inspection for parallax, lighting differences and local deformation.
