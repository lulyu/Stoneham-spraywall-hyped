# Repeatable wall re-scan, registration, and annotation transfer

Status: **design proposal only**. This branch currently contains this document only; the proposed `tools/wall_rescan/` pipeline and rescan review mode have not been implemented. Existing SAM2 tools are integration points, not an implementation of this proposal. No production wall, routes, DynamoDB records, or deployment should change as part of this document.

## Problem and goals

The Stoneham spray wall has changed since the current canonical photo and hold annotations were produced. Roughly 80% of holds seem unchanged, and roughly 20% differ. Repeating the original one-off photo mosaic and then labeling everything again would waste the accepted ground truth.

The goal is a reproducible offline pipeline that takes fresh overlapping photographs and produces an updated wall image **registered to the existing canonical coordinate system**, along with inherited hold prelabels, registration evidence, and an explicit human-review queue. The editor should let a person correct changed holds with the existing SAM2-assisted workflow, without relabeling the unchanged majority.

The critical distinction is **re-register**, not merely **re-stitch**:

    New raw photos
      -> feature registration against old reference
      -> verified transforms in old canonical coordinates
      -> best-source mosaic at exactly the old dimensions
      -> transfer old hold polygons as unverified prelabels
      -> flag changes, run SAM2-assisted corrections
      -> human review and versioned export
      -> separately deploy a new WallVersion

Out of scope for the first implementation: automated production wall switching, silently updating old routes, rewriting old hold IDs, live mobile inference, and generalized support for arbitrary multi-camera 3D reconstruction.

## Current repository integration points (verified on main)

- Canonical reference image: public/wall/stoneham-spraywall-canonical.jpg, **7292 x 5514**.
- Current accepted map: src/data/polygons/holds.json, **677 user-confirmed polygons**, containing id, kind, center, polygon. Coordinates are normalized to the full image.
- Frontend hold loader: src/data/polygons/index.ts. Accepted IDs must be preserved when editing the same version.
- SAM2 annotation tools: tools/sam2_annotation_server.py, tools/sam2_seed_full_wall.py; workflow documented in docs/sam2-full-wall-annotator.md. Reuse these rather than building a second segmentation editor.
- Current backend catalog: backend/walls.json; backend/scripts/generate-wall-catalog.mjs validates IDs and compiles each version's accepted hold source.
- Current backend identifiers: gymId=stoneham-crg, wallId=spray-wall-1, wallVersionId=2026-10-v4. Existing problems belong to this version and must continue to do so.
- Existing tooling has detection and segmentation scripts but **no checked-in repeatable stitching/registration pipeline**. The earlier best-source mosaic was assembled in an ad hoc session.

Keep the existing production image, hold map, frontend defaults, and backend catalog untouched until the final promotion phase.

## 1. Coordinate system and invariants

The old canonical 7292 x 5514 image defines reference frame R. Its normalized hold point (u, v) maps to native pixels (7292*u, 5514*v). A new canonical wall image should use the **same dimensions, orientation, crop, and coordinate origin**. Do not generate a newly cropped panorama and treat its pixel coordinates as equivalent.

For each new source photograph i, estimate a transform H_i that maps **source photo pixels -> reference pixels**; record the precise source and destination image sizes, EXIF orientation correction, any lens undistortion, transform convention, and inverse transform. All final polygons remain normalized against R.

A single homography is only valid for approximately planar surfaces. The spray wall may have multiple angled panels, protruding volumes, and parallax. Begin with a global per-photo homography and visualize residuals spatially. If different wall facets have systematic residuals, split into panel ROIs with piecewise homographies or a documented constrained local warp. Do **not** force one H onto incompatible planes, or hide poor alignment with aggressive blending.

The image frame is stable across re-scans; the **wall version is not**. Every route stays linked to its original version unless a user explicitly creates or approves a migrated route. No new image can silently reinterpret an existing route.

## 2. Capture protocol

A reusable capture checklist is part of the tool, not an afterthought:

1. Photograph the full wall with overlapping shots (target approximately 40-60% overlap), including at least two neighboring images for hard-to-see edges. Use multiple distances if needed for detail.
2. Include stable structures where possible: panel boundaries, bolt-hole patterns, permanent corners or paint texture. Holds may have changed; never assume a hold is a permanent registration landmark.
3. Keep focus, exposure, white balance, and lens/zoom as consistent as practical. Avoid people covering holds, motion blur, strong reflections, and extreme oblique shots.
4. Retain originals and EXIF; do not pass them through messaging-app resizing before registration. Record capture date, camera model, and any major wall geometry changes.
5. Take an overview photo spanning much of the wall even if closeups provide most final pixels. It helps place ambiguous closeups.

Input should be a directory of photos plus optional manual anchor correspondences. The pipeline should run deterministically from a manifest; filenames alone must never encode geometric assumptions.

## 3. Registration pipeline

### 3.1 Preprocess and coarse match

- Read EXIF orientation, rotate consistently, optionally undistort with calibrated lens parameters. Record each preprocessing transform.
- Compute low/medium-resolution reference features and photo features. Start with OpenCV SIFT + descriptor ratio test and mutual matching; try AKAZE as a fallback, not as an unconditional second pass.
- For closeups, avoid assuming a feature match against an undifferentiated 40 MP reference will always work. Use multi-scale reference tiles or a coarse-overview retrieval pass to identify candidate ROIs.
- Prefer stable wall/panel features for alignment; optionally mask known changed-hold regions after the initial pass. The expected 80% unchanged holds are useful inliers but changed holds must be robustly rejected.
- Estimate source-to-reference H via RANSAC/USAC_MAGSAC when available. Save matched points and the inlier mask, not just the final matrix.

### 3.2 Validate geometry before accepting an image

For every photo, compute and save at least:

- number of tentative matches, inliers, inlier ratio;
- median and high-percentile reprojection error in **reference full-resolution pixels**, with the measurement scale specified;
- spatial distribution of inliers (not just a cluster in one tiny corner);
- warped footprint/coverage polygon and overlap with prior registered photos;
- scale, skew, perspective, foldover/degeneracy checks;
- qualitative residual overlay of static features and panel seams.

Low-confidence registration must be marked **needs-manual-alignment** and excluded from the mosaic by default. Provide a manual 4-8 point correspondence path (photo pixel <-> reference pixel), and rerun robust fit/refinement. A configuration file should preserve these edits for reproducibility.

### 3.3 Refine and handle non-planarity

After coarse registration, optionally refine locally using static wall texture, edges, and/or image alignment on reliable overlap regions. Do not use a whole-image pixel objective without masking moved holds and handling illumination differences: it can pull a good transform toward a newly moved object. Keep local refinements bounded and record any displacement field.

If systematic panel-specific error remains, model multiple fixed wall facets; record a facet mask/transform for each region. Distorted or protruding volumes may not agree perfectly with the panel plane. Expose those regions as uncertain to the annotation editor rather than claiming pixel-perfect alignment.

## 4. Registered best-source mosaic

Output canvas: **7292 x 5514 in frame R**.

Warp all approved source photographs and their validity masks into R; do this at full output resolution after fitting transforms at lower resolution.

Prefer a best-source composite to broad alpha blending, because crisp hold edges matter more than hiding every photographic seam. Score candidates by resolution at output scale, local sharpness, distance from source image borders, view distortion, exposure/occlusion quality, and registration confidence. Choose a source by tile/region with spatial smoothing or seam optimization to avoid salt-and-pepper changes. Use illumination normalization and, if needed, narrow seam feathering **without mixing distinct hold boundaries**.

Generate a **coverage mask** and a **source-index map**. Uncovered areas must be visibly flagged; do not silently paste old pixels and present the result as a fully new photo. Optionally generate an explicitly labeled old-image fallback composite for convenience, but never treat fallback pixels as new observations in change detection.

Persist photo-by-photo transforms and a debug preview showing boundaries and contribution of each source.

## 5. Prelabel transfer and change candidates

The simplest and most valuable initial result is to copy old normalized polygons into the registered frame **without modifying them**, recording that they are inherited, unverified suggestions.

For each inherited hold, calculate an evidence score using multiple signals:

- patch alignment on stable surroundings; center/outline agreement;
- appearance change after local exposure/color normalization;
- segmented new object shape from existing SAM2 tooling prompted by old center and optional box;
- centroid drift, area ratio, polygon IoU, occlusion, and local image coverage.

**Neither raw RGB difference nor SAM2 confidence alone is a reliable removed/unchanged classifier.** New lighting and image seams can mimic changes. Similarly, SAM2 might segment a background patch or adjacent hold. Treat automated statuses as review recommendations, not ground truth.

In a second pass, search observed regions for new holds using the existing candidate/grid prompting and SAM2 pipeline. An inherited outline is not proof that its region is already occupied by a valid annotation. A replacement hold may occupy almost exactly the removed hold's old outline.

Only current-scan, human-verified `verified-unchanged` or `verified-refined` holds may act as exclusion masks for already-accounted-for holds. Overlap with `inherited-unreviewed`, `likely-unchanged`, `needs-review`, or `removed` entries must **not** discard a new candidate. Keep that candidate and associate it with the old entry as a possible replacement, move, split, or merge for review. Deduplicate proposals against each other while retaining their evidence and possible old-hold associations. Produce a user-visible queue of likely missing, moved, split/merged, changed, or newly added holds.

Integration warning: `tools/sam2_seed_full_wall.py` currently defaults `--groundtruth` to the accepted old map and discards proposals with high overlap against that map. Rescan mode must replace this unconditional old-ground-truth filter with the reviewed-region policy above. Do not pass all inherited polygons as new-scan ground truth. The script's image and seed sources must also be supplied from the rescan session, rather than its current hardcoded production paths.

Use provisional review statuses such as:

- inherited-unreviewed: geometry copied, not yet confirmed;
- likely-unchanged: strong automated evidence, still provisional;
- needs-review: uncertain alignment, appearance, mask, or overlap;
- removed: explicitly confirmed absent by a human;
- verified-unchanged / verified-refined: human-approved;
- new: human-approved new hold;
- dismissed: a human-rejected automatic candidate, with a reason such as noise or duplicate; this is not a substitute for explicitly confirming an inherited hold as removed.

Do not assign a confident removed label purely from a low model score or an uncovered pixel region.

## 6. Hold identity, annotation export, and route safety

The logical hold identity key is **(gymId, wallId, wallVersionId, holdId)**. A copied hold ID in a new version is permitted only if the same hold at effectively the same place is verified to persist; it represents continuity, not a global uniqueness guarantee.

- Keep an unchanged old ID when human review confirms the same hold in the same location. Minor contour refinements may preserve that ID.
- When a hold was removed, do not include it in the accepted new-version hold map. Record a tombstone/removed status in separate review metadata.
- A new or moved/replaced hold gets a new ID, even if it occupies nearly the same image position. Never recycle a removed ID for a replacement.
- Keep a separate correspondence map (new version ID, old hold ID, new hold ID if any, relation, evidence, reviewer) to explain lineage. The canonical holds.json remains the simple current shape of id/kind/center/polygon.
- Do not automatically rewrite old routes. Existing routes for 2026-10-v4 continue to render against that old version. In a future explicit migration feature, only propose a clone when all required holds have verified mappings; otherwise mark the suggested clone needs-review.
- Never switch backend/walls.json active-version status or frontend image/hold imports as part of an unreviewed experiment. Publishing requires an explicit promotion step that keeps v4 assets resolvable.

Note: the current frontend hardcodes the image and current problem collection path; multi-version browsing and deep links need coordinated frontend/backend changes before release. Do not merely replace public/wall/stoneham-spraywall-canonical.jpg in place.

## 7. Proposed tools and stable artifacts

Suggested package layout (names are proposals; avoid duplicate SAM2 implementation):

    tools/wall_rescan/
      register.py                # photo -> old reference transforms + QA
      compose.py                 # approved transforms -> best-source mosaic
      transfer_prelabels.py      # old polygons + new image -> proposals/lineage
      evaluate.py                # metrics, overlays, report
      run.py                     # reproducible orchestrator
    docs/wall-rescan-registration.md
    tests/wall_rescan/

Suggested inputs:

    private-inputs/<scan-id>/raw/*.jpg
    private-inputs/<scan-id>/anchors.json           # optional manual points
    private-inputs/<scan-id>/scan.json              # scan metadata

Keep raw scans outside git by default. Existing source files remain:
    public/wall/stoneham-spraywall-canonical.jpg
    src/data/polygons/holds.json

Suggested invocation from repo root:

    python -m tools.wall_rescan.run \
      --reference-image public/wall/stoneham-spraywall-canonical.jpg \
      --reference-holds src/data/polygons/holds.json \
      --photos private-inputs/2026-11-rescan/raw \
      --reference-version 2026-10-v4 \
      --candidate-version 2026-11-v1 \
      --output artifacts/wall-rescans/2026-11-v1

The output directory should be disposable/reproducible and never overwrite old canonical assets:

    artifacts/wall-rescans/2026-11-v1/
      manifest.json              # source paths/hashes, code/tool versions, params
      registration.json          # photo sizes, transforms, inliers, quality
      photo-overlays/            # per-photo alignment debug
      coverage.png               # observed vs unobserved
      source-index.png           # pixel/tile provenance
      wall_registered.jpg        # new image, aligned to old frame
      wall_registered_preview.jpg
      old-new-overlay.jpg
      diff-heatmap.png
      holds_prelabels.json       # same geometry contract as accepted holds
      review_queue.json          # status/scores, no silent acceptance
      lineage.json               # old-to-new ID links, tombstones
      report.json                # coverage, registration summary, QA failures

Record SHA-256 hashes for source images and reference holds, OpenCV/Python versions, model/checkpoint hash when SAM2 is used, preprocessing and crop settings, model prompts/thresholds, exact source contribution, and software commit. Pin Python dependencies in a dedicated requirements/lockfile once implemented. Large raw images/intermediates should not be committed accidentally.

Example review_queue entry (illustrative only):

    {
      "oldHoldId": "manual-3602a0e8bfba",
      "candidateHoldId": "manual-3602a0e8bfba",
      "status": "needs-review",
      "reasonCodes": ["appearance-changed", "mask-iou-low"],
      "registrationConfidence": 0.94,
      "maskIou": 0.56,
      "observed": true
    }

Scores are evidence, not calibrated probabilities unless measured. No production mutation should occur when these JSON files are generated.

### 7.1 Scan/session identity is enforced, not merely logged

Every annotation working copy, prelabel import, review history, and export must reference one immutable session manifest. Required identity fields are:

- `scanId`, `gymId`, `wallId`, `referenceVersion`, and `candidateVersion`;
- the reference image and reference hold-map SHA-256 hashes;
- `registeredImageSha256` for the exact new image being annotated;
- the reference coordinate-frame definition, including image dimensions and orientation.

Working copies additionally carry a monotonically increasing `reviewRevision` for optimistic concurrency checks; this mutable revision is separate from the immutable scan identity.

The manifest identifies the image bytes, not just a filename or the common 7292 x 5514 dimensions. The editor must use an explicitly configured candidate image, session manifest, and scan-specific working-storage path. It must not silently retain the existing annotator's hardcoded production image, default seed, or default working file.

Opening a working copy and every import/save/export must validate its session identity. Reject mismatched or missing identity fields in rescan mode, even when dimensions and hold IDs happen to match. Replacing the candidate image or changing the registered mosaic creates a new image identity and invalidates prior review approval for that image. An explicit transfer may create a new session with inherited-unreviewed entries; it may not silently carry forward verified statuses. Importing a legacy geometry-only file likewise requires an explicit source/session assignment and produces unreviewed suggestions, never accepted holds.

Store geometry, review decisions, and lineage atomically under the same `reviewRevision`, or use a single authoritative review file from which the other artifacts are derived. A stale save must be rejected rather than overwriting another tab's decisions. Record the exact session and review revision used by an export, so geometry cannot be paired with a different scan's review queue.

## 8. Review UX

Extend the **existing** SAM2 local annotator instead of making a new production route-setting mode immediately. Proposed editor features:

- Old/new image slider or blink comparison in identical coordinates;
- inherited outlines, with verified/uncertain/removed/new state colors and a count-by-state panel;
- registration error/coverage overlay and photo-source provenance when something looks misaligned;
- focus next uncertain hold, accept unchanged, refine with positive/negative points or box, mark removed, create new;
- retain the original hold ID for verified unchanged/refined holds; allocate IDs for new/moved holds;
- persistent working copy with autosave or explicit save, conflict protection, export of accepted new-version JSON and review history;
- clear distinction between **candidate** data and **published** wall version.

Color and role choices should be consistent with existing annotator conventions. Review progress must survive restart. Never overwrite old ground truth. New version should have its own immutable accepted export.

### 8.1 Explicit approval and export gate

The current annotator cannot be reused unchanged for rescan review: imported holds enter its accepted collection, `clean_hold`/`clean_dataset` discard additional review fields, and the UI offers `Accept all >=0.95`. Rescan mode needs a separate suggestion/review representation and a server-side approval/export gate before inherited data is loaded into it.

- Keep inherited polygons as suggestions. An import, model score, or geometry edit alone cannot mark them accepted. Persist review status, reviewer, decision time, reason, and session identity without stripping them during normalization.
- Only `verified-unchanged`, `verified-refined`, and human-approved `new` entries may appear in the accepted geometry export. `removed` and `dismissed` entries remain in review history/lineage but are excluded from accepted holds. All provisional states are excluded as well.
- Disable score-based `Accept all >=0.95` in rescan mode. A bulk human confirmation may be supported only as an explicit review action over identified entries, recording the reviewer and decisions; a threshold alone cannot approve them.
- Enforce these rules on the server/exporter, not only through colors or hidden buttons. Normalize the four geometry fields only after resolving approval from the authoritative review state.
- An accepted-subset export for inspection must report pending counts and `publishable: false` while any required review entries are unresolved. Publishing a final WallVersion requires completed review plus the coverage/registration QA gates. Bind that publication check to the exact exported image/hold hashes, session identity, and review revision.

This keeps the accepted `holds.json` geometry contract simple while making its approval evidence mandatory and independently inspectable.

## 9. Rollout plan, acceptance criteria, and tests

### Phase A — Registration proof on a small region (first PR)

Use several overlapping new photos of the top-left 1/3 x 1/3 area and the same ROI of the old reference. Fit and visualize H in reference coordinates; produce per-photo inlier diagnostics, an aligned crop, old polygon overlay, coverage mask, and reproducible command. Do **not** call this a full-wall solution before visually assessing multiple panels and changed holds.

Acceptance: an operator can rerun the same inputs and get equivalent geometry/artifacts; low-confidence photos are flagged; old polygon outlines land correctly on a representative manual sample of **unchanged** holds. Track full-reference-pixel alignment residuals on independent anchors and report median/p95 rather than claiming a threshold not yet validated.

### Phase B — Full-wall source mosaic (second PR)

Support all photos, holes, source-quality selection, manual anchors, registration confidence, panel-specific fallback if needed, and a complete QA report. Fail visibly on missing coverage or misalignment. Compare the generated image with the old canonical at the same dimensions.

### Phase C — Prelabels and review queue (third PR)

Copy old polygons; add conservative change suggestions, SAM2 local refinement, ID lineage and a persistent review workflow. Include synthetic tests for intentionally removed/added holds and lighting-only changes. No bulk automatic promotion.

### Phase D — Version publication (separate, explicit PR)

Archive the new accepted wall image and map under a versioned path; register the new version in backend/walls.json and its generated catalog; change frontend routing/image selection to support multiple versions and historical deep links; deploy backend and frontend together with smoke tests. Confirm old routes remain viewable under 2026-10-v4. Back up existing production data before a version switch. This phase is **not** authorized by simply running the rescan tool.

Regression/tests for the pipeline:

- Known synthetic homography and inverse coordinate round-trip, including non-square image scaling and EXIF rotation;
- reject low-inlier, clustered-inlier, degenerate, and inconsistent panel transforms;
- ensure source masks, no-data regions, and source-index map are correct and do not disguise reference-image fallback as new data;
- deterministic output metadata with fixed inputs and parameters;
- 1:1 old polygon coordinates and IDs in the initial prelabels, valid normalized coordinates, no duplicate IDs;
- removed/new/replaced examples cannot silently remap old hold IDs; old route/version records remain untouched;
- illumination-only changes do not automatically delete annotations; no claim that changed regions were perfectly detected;
- reject a working copy/import/export from another scan or image hash even when image dimensions and hold IDs match; changing image bytes invalidates approval;
- round-trip review status, reviewer, lineage, and revision through restart/save; reject stale revisions and prevent mixing geometry and decisions from different revisions;
- exporting inherited-unreviewed, likely-unchanged, or high-score-only proposals cannot turn them into accepted holds; unresolved review keeps the export non-publishable;
- a removed old hold replaced by a new hold at the same location retains the replacement candidate despite overlap, requires a new ID, and preserves the old ID's removed lineage;
- integration smoke test with a small real photo subset and human-inspected overlay.

## Open questions for the first experiment

1. Is the wall effectively one plane in the field of view, or are there multiple angled sections requiring separate registration models?
2. Which static landmarks remain visible across scans? Would a future small set of fixed fiducials/AprilTags (with gym permission) improve re-scans?
3. Do we have a few new photos covering the upper-left area, plus one overview? They are the only missing data for a real visual benchmark.
4. How should we present removed holds in historical routes versus proposed clones? Recommended default: historical routes stay immutable and clearly tied to their wall version.

## Implementation guardrails

- Prefer OpenCV/SIFT + robust geometry first; SAM2 belongs primarily in label correction/change proposals, not in the registration critical path.
- Test locally/offline; never require AWS to build a mosaic.
- Capture errors and manual overrides in files, not undocumented hand edits.
- Do not change deployed canonical assets, backend version metadata, Cognito, comments/sends, or existing route records while building Phases A–C.
- Make quality inspectable; a confident-looking but misregistered mosaic is worse than an honest failed run.
