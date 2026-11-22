# Wall photo updates, SAM2 annotation, and review runbook

This guide documents Stoneham's actual wall-update process so future updates can
use the same evidence, decisions, and artifacts, and another maintainer can take
over. See [the workflow overview](wall-update-workflow.md) for a shorter checklist
and [wall publication](wall-publication.md) for release and route compatibility.

**Original photos → verify the reference → register and stitch → compare old/new
images → rerun SAM2 for every inherited hold → find additions → review identity
and outlines → check for omissions → replay, validate, and archive → publish.**

The November 21, 2026 preparation started from **v8 / 801 holds** and produced a
**v9 / 852-hold** assistant-reviewed candidate. Publication status is recorded
separately in the [v9 publication record](../reviews/2026-11-v9-publication/README.md).
Recheck the active version before each update; example dates, counts, and
parameters here describe that preparation run, not automatically current state.

Quick links: [tools and directories](#2-environment-directories-and-tool-boundaries) ·
[registration](#4-register-each-photo-before-composing-the-wall) ·
[composition and seams](#5-compose-the-image-manage-seams-and-fill-edges) ·
[SAM2 refresh](#7-rerun-sam2-for-every-inherited-hold-with-a-20-inset) ·
[new holds](#8-find-and-prompt-new-holds) · [review rules](#9-review-identity-before-outlines) ·
[review UI and progress](#10-record-human-or-assistant-review) ·
[validation and archiving](#11-check-for-omissions-validate-and-archive) ·
[troubleshooting](#13-troubleshooting).

## 1. Distinguish the artifacts

| Artifact | Purpose | Ready for production? |
| --- | --- | --- |
| Original photos | Observe the physical wall; retain full resolution and EXIF | No |
| Registered candidate image | Coordinate frame for the next annotation pass | No |
| Previously published hold map | Position hints and inherited IDs | Its review status does not transfer to this update |
| SAM2 proposals | Unreviewed outlines, scores, and associations | No |
| Review checkpoint | Individual decisions and history bound to this exact image | Validate before extracting candidate geometry |
| Reviewed geometry | Holds extracted from a replay-validated checkpoint | Still requires publication |
| Published image, map, and catalog | Versions used by the website and route compatibility | Yes |

**Outline, physical identity, and publication status are separate decisions.**
An unchanged hold may need a new projected outline while keeping its ID. A
different hold at the same position needs a new ID even if SAM2 scores it highly.
Exporting review progress does not publish a wall.

## 2. Environment, directories, and tool boundaries

### 2.1 Required environment

Image processing uses Python, OpenCV, NumPy, Pillow, and SciPy. SAM2 requires a
Python environment with PyTorch and the official SAM2 package. Follow the
[SAM2 setup and checkpoint verification instructions](sam2-top-left-experiment.md#reproduce-python-312-tested).

The current batch runner uses **SAM2.1 Small**:

- Configuration: `configs/sam2.1/sam2.1_hiera_s.yaml`.
- Checkpoint: `sam2.1_hiera_small.pt`.
- Checkpoint SHA-256: `6d1aa6f30de5c92224f8172114de081d104bbd23dd9dc5c58996f0cad5dc4d38`.
- CPU inference is supported. Record the actual device, thread count, software
  versions, random seed, and elapsed time.
- Review replay requires a Node environment that can run this project's
  TypeScript directly.

### 2.2 Working directory

Keep preparation outside production directories. Use a separate directory for
each update, for example:

```text
wall-update-YYYY-MM-DD/
  originals/                  # Unmodified camera files
  originals-manifest.json     # Names, byte counts, dimensions, SHA-256
  reference.jpg               # Currently published image
  reference-holds.json        # Matching published hold map
  registration/               # Matches, homographies, residuals, correction fields
  image-r1/                   # Initial composition, coverage, source index
  image-r2/                   # Separate revision if needed
  comparisons/                # GIFs, sector comparisons, suspect crops
  sam2-inherited/             # Raw proposals for all inherited holds
  sam2-new/                   # New-location prompts and raw proposals
  review-bundle/              # Immutable baseline for this review session
  reviewed/                   # Checkpoint, extracted geometry, summary, QA
```

Do not overwrite images, baselines, or checkpoints already in use by a reviewer.
If the image or input evidence changes, create a new candidate and session;
approvals from the previous session cannot simply transfer.

### 2.3 Reusable tools versus run-specific scripts

| Stage | Entry point | Current status |
| --- | --- | --- |
| Feature matching, composition, and outline helpers | `tools/wall_rescan/` | Reusable modules; inspect each entry point's arguments |
| Refresh all inherited holds with SAM2 | `python -m tools.wall_rescan.sam2_refresh` | Parameterized CLI |
| Prepare an immutable review baseline | `python -m tools.wall_rescan.candidate_review` | Parameterized CLI |
| Human review and interactive SAM2 | `tools/sam2_annotation_server.py` and the existing review UI | Reusable |
| Record and replay decisions | `src/wallReview.ts`, `src/wallProposals.ts` | Reusable APIs |
| v9 registration, composition, addition search, local reruns, corrections, and archive | [v9 pipeline/](../reviews/2026-11-v9-assistant-reviewed/pipeline/) | Run-specific scripts with dates, absolute paths, regions, and photo counts |

**There is no one-command pipeline from an arbitrary Drive folder to a published
wall yet.** The v9 scripts preserve the actual algorithms and execution record.
Copy them into a new workspace and check all paths, reference versions, photo
counts, excluded regions, and output names before reuse. Some also depend on
intermediate files in the original working directory. Do not execute them in
filename order or process another photo set without updating their constants.

## 3. Download originals and verify the reference

1. List the user-supplied folder and check file counts, names, types, and sizes
   before downloading original files. Do not substitute chat thumbnails, Drive
   preview screenshots, or browser-compressed copies.
2. Record each original's SHA-256, byte count, native dimensions, and source
   identity. Leave the original file unchanged.
3. Resolve the active wall from `src/wallVersions.ts` and its version manifest;
   also check the backend catalog. Verify that the image actually served by the
   website matches the local reference hash when preparation begins.
4. Copy that version's **published** image and hold map. Record their version,
   hashes, dimensions, and hold count. If publication corrected hold IDs, use the
   published derivative map rather than the earlier raw review export.
5. Assign a new candidate version and scan ID, retaining the relationship to the
   reference version and source photos.

For example, v8 publication assigned fresh IDs to two replacement holds. The v9
reference is therefore `src/data/walls/2026-11-v8/holds.json`, not the original v8
checkpoint before those publication corrections.

Apply `ImageOps.exif_transpose` when loading a working copy, then convert to RGB.
Feature matching, warping, and prompt coordinates must use the same orientation.
Retain the original file and EXIF separately.

The current canonical canvas is **7292 × 5514**, with the origin at the top left.
Hold polygons use normalized `[0,1]` coordinates: `x = u × width`,
`y = v × height`. Cropping, resizing, or changing orientation requires matching
coordinate transforms; visual similarity alone does not make old polygons fit.

## 4. Register each photo before composing the wall

### 4.1 Global registration

Register every new photo directly to the previous accepted image, rather than
only aligning adjacent new photos. This limits drift along a stitching chain.
See the v9 [register_compare.py](../reviews/2026-11-v9-assistant-reviewed/pipeline/register_compare.py).

Example parameters from this run:

- SIFT matching at a maximum working dimension of 2600, with up to 30000 features.
- `matches` uses a Lowe ratio of 0.75 and mutual matching; v9 selected FLANN.
- Estimate the photo-to-reference homography with
  `cv2.findHomography(..., cv2.USAC_MAGSAC, 18, maxIters=10000, confidence=.999)`.
  The threshold of 18 is in this run's native canvas pixels.
- Save source/reference correspondences, inlier flags, homography, and individual
  photo coverage masks.
- Report inlier count, median/P95 residual in native pixels, and frame coverage.

Parameters are starting points, not acceptance criteria. Inspect whether inliers
span the visible wall: good matches in one small patch do not validate the rest.
If matching fails or alignment is poor, first check orientation, sharpness,
overlap, and the reference. Use verified static landmarks or recapture photos
when necessary, rather than hiding an error with a looser threshold.

### 4.2 Bounded local correction

The wall plane, protruding holds, and inclined kickboard are not coplanar. A
single homography cannot remove all parallax. After global registration, a smooth,
bounded residual correction can use **verified stationary wall features**.

The v9 [build_candidate.py](../reviews/2026-11-v9-assistant-reviewed/pipeline/build_candidate.py)
uses this procedure:

1. Exclude old hold polygons and their neighborhoods from fitting, together with
   suspect changed regions.
2. Use a fixed random split of roughly 80% fitting and 20% check correspondences.
3. Interpolate a residual field on a 731 × 553 grid, smooth it, and cap displacement
   at **12 native pixels**.
4. Compare median and P95 residuals on held-out correspondences before and after
   correction. Enable it only when the script's conditions pass; otherwise use a
   zero local field.
5. Save the field, homography, fit/check counts, error statistics, and enablement
   decision for final inverse sampling.

These held-out checks still use image correspondences, not independently surveyed
landmarks. **Never fit deformation to a moved hold and pull its real change back
to the old position.** If later review discovers an unknown change in a fitting
region, reassess whether it influenced the correction.

## 5. Compose the image, manage seams, and fill edges

### 5.1 Choose coherent photo sources for whole holds

The v9 run selected seams on an approximately 1800-pixel-wide working image, then
rendered the native canvas from original photos:

- Use graph-cut color/gradient seams to select a source photo for each pixel.
- Evaluate source quality using distance from the photo edge, local sharpness,
  and registration residual.
- Protect entire holds or adjacent hold groups, aiming to take the outline and a
  small surrounding margin from one photo.
- Prefer one fully covering photo for known changed regions too.
- Match exposure only on stable regions, with bounded RGB gains. The v9 example
  limited gains to 0.85–1.18.
- Inverse-sample originals with the saved homographies and local fields. Prefer
  encoding the final JPEG after geometry and source selection are settled,
  avoiding repeated scaling and lossy re-encoding.

Do not average misaligned hold outlines together. That can create double edges
that do not exist on the wall, which SAM2 may then interpret as a hold, shadow,
or partial object.

### 5.2 Inspect the kickboard separately

The initial v9 composition sometimes took pixels inside an old polygon from photo
A and pixels outside it from photo B. Foothold parallax exceeded the protected
margin, clipping a hold into pieces or a narrow sliver. This is an image defect;
a polygon edit cannot make that composition valid.

The correction used contiguous single-photo regions across the bottom, placing
seams in blank gaps between footholds. For those three photos, the settings were
`y >= 0.925` with boundaries at `x = 0.35 / 0.68`.
**Those values are specific to this capture; choose them again for the next run.**
See [kickboard-seam-fix.jpg](../reviews/2026-11-v9-assistant-reviewed/evidence/kickboard-seam-fix.jpg).

Inspect the wall fold, bottom footholds, protruding volumes, and photo boundaries
each time. If the composition changes, bind the revised evidence to a new
candidate/session and rerun the annotation process; do not inherit old approvals.

### 5.3 Keep evidence of reference-filled edges

Unobserved blank edges may be visually filled from the previous image, provided
the following evidence is retained:

| File | Meaning |
| --- | --- |
| `wall.jpg` | Exact candidate image, without annotation lines |
| `coverage.png` | Pixels sampled from new photos; reference fill is zero |
| `source-index.png` | New-photo source number; zero identifies reference fill |
| `uncertainty.png` | Seam, cross-source, missing-coverage, and other run-specific flags |
| Composition manifest and alignment files | Source hashes, matrices, local fields, selection policy, and coverage statistics |

Reference fill must not be relabeled as a fresh observation. Whole-image coverage
does not replace per-hold coverage. The v9 image has approximately 98.72% new
coverage, while every reviewed hold polygon has 100% new coverage. If a hold lies
in a gap, retain the uncertainty and recapture or document the observation limit;
the gap is not evidence of removal.

## 6. Generate comparisons and freeze the candidate

Provide at least a clear preview, a whole-wall toggle GIF, and enlarged comparisons
of changed regions and the bottom strip. Keep identical framing, scale, and crop.
Use **one shared palette** for both GIF frames to reduce color flicker. The v9 run
used an approximately 2000-pixel preview, an 1800-pixel whole-wall GIF, and nine
overlapping old/new sectors.

Check large alignment errors, clipped holds, ghosting, local blur, exposure jumps,
and the reference-fill boundary. Fix image defects before final annotation.

Once the image is stable, create a `stoneham-wall-candidate-v1` manifest. See the
[v9 candidate manifest](../reviews/2026-11-v9-assistant-reviewed/candidate-manifest.json)
and [prepare_sam2_candidate_r2.py](../reviews/2026-11-v9-assistant-reviewed/pipeline/prepare_sam2_candidate_r2.py).
It binds candidate/reference versions, coordinate frame, source photos, reference
image/map hashes, candidate image/mask hashes, and source session. Initial status
is `candidate-needs-review`, with `publishable: false`.

Seam and coverage flags are evidence, not error messages to delete. The v9 generator
uses bit 1 for seams, bit 8 for an inherited outline crossing photo sources, and
bit 16 for unobserved pixels; other tools may use additional bits. Interpret them
according to the actual producer and consumer, rather than treating this example
as a universal binary risk mask.

## 7. Rerun SAM2 for every inherited hold with a 20% inset

Use **every hold in the previously published map** as an unreviewed hint, including
footholds, small holds, large holds, and volumes. An apparently unchanged hold
still needs checking because its projected outline can change with the camera.

Run the reusable CLI below with the SAM2 Python environment, replacing paths with
this update's actual inputs:

```sh
python -m tools.wall_rescan.sam2_refresh \
  --version-manifest /path/to/candidate-manifest.json \
  --old-holds /path/to/published-reference-holds.json \
  --checkpoint /path/to/sam2.1_hiera_small.pt \
  --prompt-inset .2 \
  --threads 2 \
  --output /path/to/new-empty-inherited-output
```

A 20% inset means **0.8 linear scale**, not a 20% area reduction or a contracted
final outline. `inset_prompt_for` does the following:

1. Rasterize the old polygon and choose a safe scaling center. If a concave
   polygon's centroid lies outside it, use an interior point instead.
2. Scale by 0.8 and intersect with the original mask to keep concave shapes safe.
3. Sample up to five interior positive points from the contracted region, rather
   than relying solely on a geometric center that might lie in a bolt hole.
4. Retain a box based on the original extent with modest padding and image context.
5. Let SAM2 expand to the actual visible edge; do not clip its final mask to the
   contracted prompt region.

The batch runner caches embeddings for a 3 × 3 grid with overlapping context.
For each inherited ID, retain prompts, proposal associations, model score,
old/new IoU, area ratio, center drift, observation coverage, uncertainty evidence,
and failures. Deduplicate proposals without hiding associations where one mask
was produced for multiple inherited IDs.

By default, the runner prompts only inherited regions with at least 99% coverage.
Use `--include-partial` explicitly if partial regions also need draft proposals.
It does not change coverage, prove absence, or approve anything. At completion,
reconcile inherited count, actual prompt count, failures, and deduplication
associations rather than reporting only the number of usable masks.

## 8. Find and prompt new holds

Old-polygon prompts refresh inherited positions; **they do not search the entire
wall for additions**. Inspect gaps between old outlines, edges, sparse footholds,
small holds on volumes, and other new locations separately.

### 8.1 Difference triage

The v9 run used two supporting searches:

- **Rank changes at inherited holds:** compare old hold cores with multiple aligned
  photos, tolerate small shifts with local template matching, and rank combined
  Lab color difference and correlation to prioritize visual checks.
- **Search for new color outside inherited outlines:** exclude old polygons and
  their neighborhoods, compare old/new Lab chroma and new-image saturation, then
  apply morphological closing and connected-component analysis to produce numbered
  comparison crops.

The second search used thresholds such as chroma difference >12 and saturation
>45 on a 3600-pixel-wide image. These are search parameters to adjust for exposure,
quality, and color, not proof that a hold exists. See
[score_holds.py](../reviews/2026-11-v9-assistant-reviewed/pipeline/score_holds.py)
and [find_new_holds.py](../reviews/2026-11-v9-assistant-reviewed/pipeline/find_new_holds.py).

Chalk, shadows, lighting, and viewpoint affect differences. White, black, or
similarly colored additions may be missed. **A low rank does not prove an unchanged
hold, and little color residual does not prove there are no additions.** Still
inspect all nine sectors and the gaps.

### 8.2 Convert candidates into independent prompts

Review each old/new crop and classify it as an addition, an inherited appearance
change, a fixture/shadow, or unresolved. One connected component can contain several
holds: v9 had an orange component that needed three independent prompts. Conversely,
several residual components on one hold must not become several additions.

For each confirmed new location, create a provisional hint with its own ID,
center, coarse polygon/box, and evidence reference, then run SAM2 separately.
Use a proposal ID initially and create a fresh candidate hold ID when review
confirms it. Never borrow a nearby old ID for convenience.

## 9. Review identity before outlines

### 9.1 Physical identity rules

| Observation | Identity and action |
| --- | --- |
| Same hold in the same position; only projection/outline changed | Keep the ID and refine the outline |
| Same hold and the inherited outline is still accurate on this image | Confirm unchanged |
| Sufficient new-photo evidence shows the old hold was removed | Remove the inherited ID |
| A different hold occupies the same position | Replace: remove the old identity and add a fresh ID |
| A hold moved to another position | Usually remove the old position and assign a fresh ID at the new position; record the decision |
| A hold was added to a previously empty position | Add a fresh ID |
| Coverage, visibility, or identity is insufficient | Keep pending and obtain evidence |

Compare shape, color, texture, holes, bolt position, orientation, and neighboring
holds. Similar centers, matching colors, or a score of 0.97 do not establish
identity. IDs directly determine old-route compatibility; a nearby replacement
must not silently inherit that compatibility.

### 9.2 Outline checks

Compare old, new, and overlay views. Inspect whether:

- The mask includes wall, cast shadow, a neighboring hold, or an external bolt.
- It captures only the bolt hole or one face, missing the rest of the hold.
- A small mounted hold was segmented as its entire supporting volume.
- Two holds share one mask, or one hold appears as duplicate entries.
- Thin, concave, white, edge, and bottom holds have accurate outlines and positions.
- A bad outline comes from a clipped composition; if so, repair the image first.

Score, IoU, area ratio, and drift help order inspection. Low IoU may reflect
kickboard parallax rather than replacement; high IoU does not prove physical
identity either.

### 9.3 Local reruns and explicit outline corrections

If a whole-wall tile makes a small hold too small for inference, rerun on a native
crop with surrounding context. Put positive points inside the visible body and
negative points on incorrectly included neighbors or wall. Adjust the box and
inspect the result. The v9 run tried local crops on the order of 420–440 pixels;
choose dimensions according to the hold and required context.

Two recurring mistakes need attention: points sampled inside a coarse rectangular
hint may actually lie on background, and a brightness/color heuristic may mistake
a white hold for a dark object and select only its bolt hole. Check both points
and boxes against the actual photo.

**A local rerun is not necessarily better.** Some v9 addition reruns included more
shadow or adjacent geometry. Those trials remain evidence rather than blindly
replacing the original proposals. The assistant explicitly corrected polygons
for 11 additions and two kickboard holds. Preserve crop bounds, crop-space
vertices, normalized vertices, and the reason for each correction. Current geometry
validation requires 3–16 normalized vertices with no self-intersection; never
export debug-thumbnail coordinates as final geometry.

## 10. Record human or assistant review

### 10.1 Prepare an immutable baseline

Combine the selected raw proposals into a file matching the candidate manifest,
retaining each run's provenance, then prepare the baseline with the reusable CLI.
The example below is for a user-requested assistant review. For human review,
omit `--reviewer-kind assistant`; the default is human.

```sh
python -m tools.wall_rescan.candidate_review \
  --manifest /path/to/candidate-manifest.json \
  --proposals /path/to/final-sam2-proposals.json \
  --old-holds /path/to/published-reference-holds.json \
  --reference /path/to/reference.jpg \
  --reviewer-kind assistant \
  --output /path/to/new-empty-review-bundle
```

The tool validates hashes and associations and creates a new review session,
pending queue, inherited geometry, and model suggestions. **Preparing a bundle
approves no holds.** Keep the baseline immutable and record decisions separately
in the checkpoint.

### 10.2 Human review UI

From the repository root, build the frontend and start the same-origin service
with the SAM2 Python environment:

```sh
npm ci
npm run build
python tools/sam2_annotation_server.py \
  --rescan-session /path/to/review-bundle \
  --checkpoint /path/to/sam2.1_hiera_small.pt \
  --port 8790
```

Open `http://127.0.0.1:8790/?review=1` and choose **Open local server scan**.
For cached suggestions and manual editing only, replace `--checkpoint ...` with
`--review-only`. See [review server setup](wall-v5-review-server.md) for access keys
and renewal of a temporary HTTPS service. Do not expose an unauthenticated
inference service publicly or commit access links or keys.

The five common actions below the image are **Next pending hold / Confirm /
Mark removed / Mark replaced / Generate mask**. Next loads a saved suggestion
without approval. Generating a mask does not save a decision. Inspect comparison
modes, then return to the new-image editing mode to record decisions.

Bulk confirmation is an explicit action for eligible inherited proposals. Current
checks require sufficient coverage, unique association, no relevant uncertainty,
and an eligible recommendation. Review additions and known changes individually;
a score threshold alone is insufficient. Individual confirmation can explicitly
record partial coverage, while bulk confirmation still requires at least 99%.
Removal/replacement also have coverage requirements. None of these actions changes
measured coverage evidence.

### 10.3 Assistant attribution

Use assistant attribution when the user explicitly delegates review. Never present
model output as human approval. First perform the photo, identity, and outline
checks above, then record actions through the actual review API, for example:

```ts
const next = applyReview(
  current,
  { type: 'refine', id: oldId, hold: correctedHold },
  'Codex (assistant visual review)',
  new Date().toISOString(),
  'assistant',
)
validateProgress(next, baseline)
```

`applyReview` lives in `src/wallReview.ts`. Use `add` for additions and `add` with
`replaces` for replacements to retain atomic history and identity lineage. Do not
just edit JSON status flags or mechanically confirm every entry instead of
inspecting evidence. Actions retain reviewer, reviewer kind, time, before/after
state, and revision; unresolved cases stay pending.

Historical human checkpoints remain compatible. A human can continue an assistant
checkpoint in an editor supporting this attribution, retaining earlier assistant
history. See the [v9 review archive](../reviews/2026-11-v9-assistant-reviewed/README.md)
for the actual calls and decision records.

### 10.4 Progress storage and recovery

**Human review decisions currently live in browser IndexedDB, not on the
Python/SAM2 server.** localStorage is a legacy migration source, not primary
storage. The earlier `QuotaExceededError` was a browser storage quota failure,
not evidence of a Vercel free-plan limit.

Export progress regularly through **Session, reviewer & backups → Export progress**.
Changing device, browser, or temporary hostname may require importing the export.
Keeping the same origin and exact bundle/session helps recovery; it does not make
progress transfer automatically across origins. Service expiration affects page
or inference availability. The server does not store those decisions and cannot
recover an unexported browser checkpoint.

When renewing a server, restore the exact image and baseline, import the matching
checkpoint, and verify session/image hashes. Do not mistake the original pending
queue or isolated browser-test decisions for the user's completed review.

## 11. Check for omissions, validate, and archive

### 11.1 Final whole-wall pass

Sweep overlapping sectors again, inspecting every outline and the spaces between
them, especially the bottom and edges. Review an additions-only view, and inspect
each removal or replacement separately.

At minimum, check:

- Pending entries, unresolved identities, and decisions for all new locations.
- Active count, unique IDs, retained/removed old IDs, and fresh IDs.
- Normalized bounds, 3–16 vertices, self-intersections, area, and unusual center or
  area changes.
- Duplicate physical holds, merged masks, and actual new-photo coverage of every
  final polygon.
- Intentional containment: a small hold mounted on a volume can overlap its
  supporting volume's outline. Containment alone is not a duplicate.
- Exact image/baseline/proposal identity for all review decisions.

### 11.2 Replay decisions rather than trusting status flags

Initialize from the immutable baseline with `initializeReview`, validate model
associations with `validateProposals`, and replay decisions with `validateProgress`.
Extract active geometry from `verified-unchanged`, `verified-refined`, and `new`
entries. Compare it exactly with `confirmed-geometry.json`, and verify the
checkpoint's SHA-256 from its original bytes.

The actual v9 archive validation command is:

```sh
node reviews/2026-11-v9-assistant-reviewed/validate.mjs
```

This is a **v9-specific validator**: it also checks this run's expected counts and
reviewer. Reuse the validation logic for future versions with their own expected
counts and sources; do not change historical v9 records to validate a different
candidate.

### 11.3 Archive contents

Archive the exact image, candidate/composition manifests, coverage/uncertainty/
source-index masks, alignment data, source hashes, immutable baseline, raw model
trials, final checkpoint, replay-derived geometry, individual corrections,
summary, geometry QA, comparison evidence, and validator together. Record file
hashes and byte counts in an archive manifest. Preserve the user's original export
without rewriting it. Commit temporary image/run outputs to versioned candidate
directories once the selected result is established.

A reviewer name attributes history; it does not replace session/image validation
or publication permissions. Extracted candidates remain `publishable: false`
until the separate publication process is completed.

### 11.4 Editable bundles and read-only previews

- **Editable review bundle:** original manifest, prelabels, queue, report, exact
  `wall_registered.jpg`, coverage/uncertainty, proposals, reference image/map, and
  `review-progress.json` for recovery. Extract and import it into the matching
  editor version.
- **Read-only preview:** old/new images, final outlines, additions-only filtering,
  and per-hold browsing. It needs no SAM2 server and writes nothing to the database.
  The v9 example is `/wall/candidates/2026-11-v9/index.html`.

For a protected Vercel preview, use existing authorization to generate a temporary
share link rather than disabling project protection. Link expiration and archive
loss are different issues; retain the archive and offline export independently.
Check image loading, toggles, polygon counts, filtering, per-hold focus, fit-to-wall,
and JavaScript errors on mobile and desktop. Also verify that an editable bundle
contains the exact files matching its checkpoint.

## 12. Publication handoff and route impact

After review, report the candidate image, comparisons, total count, retained/new/
removed/replaced counts, unresolved cases, coverage limits, validation results,
and archive location. Continue with [wall publication](wall-publication.md) when
requested by the user. The inspection commands in this runbook do not publish to
production.

Compatibility requires **every route hold ID to survive**, including Start,
Finish, and foot-only holds. A new image does not mean the database has been
updated. A read-only impact check is useful, but a public route list may omit
records; it cannot replace scanning every database page during publication.

Publication registers immutable image/map assets, coordinates frontend/backend
catalogs, deploys the backend, runs the dry-run and actual compatibility sweep,
and then releases the frontend and verifies historical viewing and Upgrade.
Compatible routes gain `supportedWallVersionIds`; incompatible routes become
Outdated. Preserve route IDs, authors, content, roles, comments, ratings, sends,
and historical wall images/maps.

## 13. Troubleshooting

| Symptom | Check first | Response |
| --- | --- | --- |
| Double outline, clipped hold, or thin sliver | Photo parallax, seams, undersized inherited-outline protection | Change source selection/seams, especially on the kickboard; do not only edit the polygon |
| All holds are offset | EXIF, canvas, reference version, crop/scale transforms | Correct the coordinate chain and regenerate the candidate |
| High-scoring mask includes a neighbor or whole volume | Small-object resolution, background positive points, shared proposal | Use a local crop, negatives, separate prompts, or explicit polygon correction |
| White hold reduced to its bolt hole | Prompt location and color/brightness heuristic | Place positives on the body, inspect all faces, or draw the outline |
| No usable mask | Prompt drift, thresholds, coverage, resolution | Keep pending and inspect; this is not removal evidence |
| Large residual despite an apparently unchanged hold | Chalk, exposure, shadow, viewpoint | Compare multiple originals, texture, and holes before changing identity |
| Addition search misses white/black holds | Limits of color-difference triage | Sweep all sectors visually and add independent hints |
| A recognizable hold has insufficient coverage | Actual observed region and action-specific coverage rules | Record an explicit individual decision and limit; do not falsify coverage or bulk-approve removals |
| QuotaExceededError | Browser storage and legacy localStorage version | Export a backup and use the IndexedDB implementation; do not infer a Vercel plan limit |
| Expired Sandbox or SAM2 HTTP 410 | Inference service and hostname status | Restore the same bundle, check connection/import progress, and preserve review history |
| Reusing approvals after an image edit | Changed image/session evidence | Create a new session; old geometry is only an unreviewed hint |

## 14. The v9 example and reuse order

See the [v9 README](../reviews/2026-11-v9-assistant-reviewed/README.md) for the actual
artifacts: three originals, 801 inherited prompts, 51 additions, 854 assistant
revisions, 852 active holds, zero pending, and 100% new-photo coverage for final
polygons. This describes the preparation archive; see the separate publication record for release status.

Read the scripts in **dependency order**:

| Stage | v9 implementation or artifact |
| --- | --- |
| Global registration | `pipeline/register_compare.py` |
| Inherited appearance differences | `pipeline/score_holds.py` |
| Local correction, source selection, native rendering | `pipeline/build_candidate.py` |
| Kickboard seam revision | `pipeline/fix_kickboard.py` |
| Candidate evidence and session manifest | `pipeline/prepare_sam2_candidate_r2.py` |
| Full inherited SAM2 refresh | Shared CLI `tools.wall_rescan.sam2_refresh`; raw output under `inference/` |
| Addition search and separate SAM2 | `pipeline/find_new_holds.py`, `pipeline/run_new_sam2_r2.py`, `new-location-hints.json` |
| Local trials, missing masks, and mounted small holds | `pipeline/refine_new_*.py`, `pipeline/fix_inherited_*.py` |
| Explicit visual outline corrections | `assistant-boundary-corrections.json`, `assistant-foot-corrections.json` |
| Assemble actions and record review history | `pipeline/assemble_final_model.py`, `pipeline/record_assistant_review.mjs` |
| Coverage/duplicate QA and archive | `pipeline/archive_candidate.py`, `geometry-qa.json`, `archive-manifest.json` |
| Read-only viewer and editable package | `pipeline/make_candidate_viewer.py`, `pipeline/package_review.py` |
| Replay and hash validation | `validate.mjs` |

Do not reuse v9's manual vertices, region boundaries, or identity decisions as
future defaults. Reuse the method: **traceable coordinates and sources, separate
model suggestions and review decisions, explicit physical identity checks, and
an evidence chain another maintainer can replay to the final result.**
