# Standard wall-update workflow

This is the user's preferred workflow for future wall-photo updates:

**Original photos → stitch and register to the previous wall → new image and
aligned comparisons → SAM2 from contracted old polygons → supplement new holds
→ human review and missing-hold check → export and archive → publish when requested.**

Use the latest accepted wall as the reference each time. Do not restart from the
original v4 map or reuse an earlier candidate's approvals. A completed review in
a browser is not yet an archived or published wall version.

## 1. Ground and preserve the inputs

Download the original photos, retaining EXIF and full resolution. Resolve the
active website image and accepted hold map; verify their hashes, dimensions and
version. Save the originals, reference image/map, source identities and parameters
separately from production files. Give each new image candidate its own identity.

## 2. Compose in the previous wall's coordinate frame

Correct EXIF orientation and register each photograph to the previous accepted
wall. Keep the same canvas, crop and coordinate origin (currently 7292 × 5514).
Check feature support and residuals across the wall, not just a small matching
patch. Bounded local alignment may use verified static regions; exclude known
changed holds so their real movement is not warped away.

Choose coherent photograph regions for seams and keep hold silhouettes in one
source where possible. Avoid blending misaligned holds into doubled edges. Retain
per-pixel source index, actual new-photo coverage and alignment/seam evidence.
If unobserved blank edges are filled from the previous wall, keep source index 0
and coverage 0 there; those pixels are not new observations.

## 3. Deliver the image and comparisons

Provide the clean native image, a smaller preview, and a whole-wall toggle GIF
against the previous accepted image. Use identical framing and a common palette
to reduce apparent movement and color flicker. Include enlarged toggle views of
changed areas and the bottom foothold strip. Report uncertain alignment, edge
fallback, and clear changes separately. Check which existing routes reference
confirmed changed positions as a read-only impact assessment.

## 4. Refresh every inherited outline with SAM2

Use all previous accepted polygons as **unreviewed hints** on the new image.
Contract the starting polygon by **20% of its linear size** (scale 0.8), intersect
it with the original shape for concave-polygon safety, and sample interior
positive points. Keep surrounding image context so SAM2 can expand to the true
edge. The 20% contraction is for prompting only; never shrink or clip the final
model contour to that region.

The current runner supports this with `--prompt-inset .2`:

```sh
python -m tools.wall_rescan.sam2_refresh \
  --version-manifest /path/to/candidate-manifest.json \
  --old-holds /path/to/previous-accepted-holds.json \
  --checkpoint /path/to/sam2.1_hiera_small.pt \
  --prompt-inset .2 --output /path/to/new-empty-output
```

Bind outputs to the exact image, masks, reference holds, model and prompt policy.
Record model score, overlap/area changes, drift and unsuccessful prompts. Dedup
model suggestions while retaining their old associations; no result is proof of
removal, and a high score is not proof of continued hold identity.

## 5. Supplement new and changed positions

Inspect the whole wall, including sparse footholds, edges and spaces between old
polygons. Prompt new locations separately and expose them as individual review
suggestions, without assigning them an old accepted ID. Preserve old IDs for
verified unchanged positions and ordinary same-hold contour corrections. Moved
or replaced positions need an explicit identity decision and usually new IDs;
otherwise the route-compatibility sweep could retain an invalid route.

Flag known changes for individual review and exclude them from bulk confirmation,
even when SAM2's mask score is high. Check duplicate/merged prompts and no-mask
cases rather than treating them as accepted results.

## 6. Human review and missing-hold check

Open the matching image-bound review bundle in the existing annotation tool.
Next pending hold loads its saved SAM2 suggestion. Keep Next, Confirm, Mark
removed, Mark replaced and Generate mask easy to reach. Reviewer-triggered
score-threshold bulk confirmation can help with eligible ordinary refinements;
new locations and known changes remain individual decisions.

Compare old/new/overlay views, correct outlines, record removals/replacements and
review supplemental locations. Finish with a whole-wall check for missed or
duplicate holds, small footholds, seam artifacts, and incorrect identities. All
suggestions remain drafts until explicit reviewer decisions.

### Progress storage and server renewal

**This implementation stores decisions in the reviewer's browser, in IndexedDB.**
The Python server serves the image/bundle and runs SAM2; it does not receive the
review checkpoint. A server's original queue or proposals must never be mistaken
for the user's completed annotations. localStorage is only a legacy migration
source, not the main checkpoint store.

During review, export progress periodically. When renewing a temporary server,
restore the exact image/bundle/session and the same browser origin whenever
possible, so the original browser can recover its local checkpoint. A new URL or
browser may require importing an exported checkpoint. Never reset a reviewer to
the original pending queue or use an isolated browser test's checkpoint as theirs.

At completion, use **Session, reviewer & backups → Export progress**, then provide
the resulting JSON to the maintainer/assistant. Unless there is a separately
verified server-backup feature, completion cannot be retrieved from SAM2's server.
Keep the browser data and final export until the archive is verified.

## 7. Archive the completed review

Validate the final exported checkpoint against the exact baseline/session/image
and replay its decision history. Check remaining pending entries, new-location
decisions, active hold count, duplicates, normalized geometry and ID lineage.
Preserve the original checkpoint bytes and hash. Archive the accepted geometry,
review summary, exact image, manifest, model proposals and provenance together.
Only this validated final export can become the next update's accepted reference.

## 8. Publish and migrate routes when requested

Follow [wall publication](wall-publication.md): register the immutable wall/map,
validate and deploy its catalog, dry-run and apply the compatibility sweep, then
release the frontend. Routes whose complete hold-ID set survives gain the new
`supportedWallVersionIds` entry; others become Outdated. Preserve route IDs,
authors, content and activity. Retain historical images/maps and verify current
wall display, old-route viewing and Upgrade behavior.

## Recorded first use

The November 14 candidate run is documented in
[the v8 prelabel summary](../reviews/2026-11-v8-inset-prelabels/README.md):
797 inherited prompts, 792 total suggestions including five new-location drafts,
20% inset prompting, zero transferred approvals. That summary describes the
prelabel run; it is not evidence that the final human review has been archived.

The user's completed v8 export is now archived separately in
[2026-11-v8-reviewed](../reviews/2026-11-v8-reviewed/README.md): 801 active holds,
eight removals and zero pending entries. Its two remaining identity checks are
recorded for publication; the raw review and accepted geometry are preserved
without silently changing the reviewer's IDs.
