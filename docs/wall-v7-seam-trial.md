# Seam selection experiment after completed v6 review

The completed review is backed up at
[`reviews/2026-11-v6-highres`](../reviews/2026-11-v6-highres/README.md):
797 active confirmed hold geometries, 26 removed entries, zero pending entries.
The original exported checkpoint and the reviewed v6 JPEG are preserved exactly.

## Image result

The separate candidate lives in
[`public/wall/versions/2026-11-v7-seam-trial`](../public/wall/versions/2026-11-v7-seam-trial/).
View the [full-resolution image](../public/wall/versions/2026-11-v7-seam-trial/wall.jpg),
[whole-wall preview](../public/wall/versions/2026-11-v7-seam-trial/preview.jpg), or
[native-pixel before/after crops](../public/wall/versions/2026-11-v7-seam-trial/detail-comparison.jpg).

The previous compositor assigned protected source islands around individual old
hold outlines. Parallax means their edges and shadows do not coincide between
photographs; switching sources around those islands produced a doubled border.
The black hold reported by the user is visible in the first comparison row.

This experiment uses OpenCV's `COST_COLOR_GRAD` graph-cut seam finder at a 2400px
working width to select more continuous photograph regions. It then samples the
full original photos directly into the same 7292 × 5514 coordinate frame. Each
observed output pixel comes from one source with the existing exposure gains;
there is no RGB blending or generated texture. The four registration transforms
and source hashes are recorded in `recipe.json`.

The reported black-hold crop now has no internal source seam, and its doubled
border is visibly reduced. Across the canvas, the measured seam band decreases
from 210,314 to 57,397 pixels (72.7%). Within 24px of reviewed hold polygons,
it decreases from 159,753 to 47,036 pixels (70.6%). These are seam-placement
measurements using a 5 × 5 neighborhood, not geometry-accuracy measurements.

Actual new-photo coverage remains exactly the same: 92.2487%. Missing areas use
the same v1 display fallback, with source index and observation coverage zero.
At native photograph boundaries 2,082 pixels fall back to the original valid
source selection. Coverage and source masks remain authoritative. Existing
non-seam uncertainty bits are retained and the seam bit is recomputed.

## Limits and review identity

Changing seam placement does not correct global alignment errors or parallax.
Some seams, exposure changes and projection shifts can remain. The candidate is
an image experiment with `publishable: false`; it is not selected by the
production catalog. A separate final-review session is described below. Completed v6 approvals
remain bound to the original v6 JPEG hash. Reusing those outlines on this new
image would require checking affected geometry against the new projection.

`manifest.json` hashes every delivered asset. `report.json` retains source-session
identity, coverage, seam counts and limitations. The lossless observed-only render
is retained locally under ignored `artifacts/wall-rescans/v7-seam-trial/`.

## Reproduce

From the repository root, install `tools/wall_rescan/requirements.txt`, retrieve
the same four original photos into `private-inputs/drive-highres-20261106/raw/`,
and run:

```sh
python -m tools.wall_rescan.seam_trial \
  --output artifacts/wall-rescans/v7-seam-rerun
```

The runner reads the committed transform recipe and v6 masks, checks original
photo/reference/image hashes, and refuses to reuse an existing output directory.
It does not need to rerun feature registration or SAM2. Run with the recorded
OpenCV 4.11 environment for the same graph-cut implementation.

## Final review using the completed outlines

After the user selected this image for a final review, a distinct unapproved
bundle was prepared with:

```sh
python -m tools.wall_rescan.recheck_review \
  --output artifacts/wall-rescans/v7-final-review-session
```

It includes the 797 completed v6 outlines unchanged as starting geometry,
the reviewed v6 JPEG for comparison, and the new JPEG/masks. All 797 entries
start pending, with revision zero and no imported approval history. The 26
previous removals stay recorded in the original v6 checkpoint and are not
reintroduced as active holds. The session binds the source checkpoint,
geometry snapshot, candidate manifest, references and evidence by SHA-256.
Compact identity evidence is tracked under `reviews/2026-11-v7-final-review/`.

The editor/server now accept optional `reference-holds.json` and `reference.jpg`
inside a review bundle, checking their session hashes instead of requiring the
production reference. Existing bundles still use the original app reference.
This keeps the production catalog unchanged while allowing subsequent review
rounds to start from the user's completed work. For this final-review purpose,
automatic SAM2 inference starts off so Next shows the saved outline. Generate
mask and opt-in auto-run remain available on the matching SAM2 server.

Validation passed: frontend tests/build, 40 offline rescan tests, and a mobile
browser check against the local SAM2 server. The browser verified exact saved
geometry, all entries pending, no automatic inference, confirmation, reload,
checkpoint export, rejection of the v6 checkpoint against v7, and live SAM2
inference without silently saving a decision. Test storage was isolated.

The new image is uploaded to GitHub. After the user's explicit authorization,
the final-review bundle was uploaded to the existing named Vercel Sandbox
`stoneham-v5-review` and served from an isolated `stoneham-v7-final-live` directory.
The same mobile-browser checks passed against the remote authenticated URL,
including exact image identity, 797 saved outlines, confirm/reload/export and
live SAM2 inference. A new private access key was generated for this review;
keys and authenticated links are not stored in the repository. The original
v6 files and checkpoint remain intact. Sandbox runtime is temporary; exported
review checkpoints remain the durable backup.
