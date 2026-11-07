# Actual v5 SAM2 refresh run

Candidate: `2026-11-v5`, reference: `2026-10-v4`. Model: SAM2.1 Small;
**CUDA unavailable, CPU**, four torch threads. Actual runtime **352.82s**.
Implementation at `b0198916129e7a8f8c582aafe6f1c768ca31ae8b`; the report binds
script, checkpoint, input image/map/mask and version-manifest hashes.

- 677 inherited entries retained; 651 with >=99% new-photo coverage were prompted.
- 26 skipped: 22 unobserved, 4 partly observed. Reference-filled corners were not
  treated as new observations.
- 641 eligible masks before deduplication, **639 unique proposals**. Ten prompted
  entries lacked an eligible mask. That is not proof of removal.
- Per-old-entry recommendations: 311 possible-unchanged, 154 suggested-refinement,
  170 alignment-needs-review, 2 possible-change-or-prompt-error, 4 associated with
  shared proposals (possible merge / duplicate prompts), plus the 36 skipped or
  no-mask entries. These are not accuracy measurements or human decisions.
- Every inherited entry remains unreviewed; every proposal remains needs-review;
  zero accepted holds. No new locations were searched in this first pass.

[Old vs SAM2 overlay](old-vs-sam2-overlay.jpg): cyan=old contours, orange=SAM2
proposals on the new photo. [Proposal-only overlay](sam2-proposals-overlay.jpg)
shows the orange contours without the old outlines. Visual inspection shows useful
edge corrections including large protruding holds, but small holds, neighboring
mask merges, contour details and registration uncertainty still need human review.

The complete model output is committed at
[`src/data/experiments/wall-v5-sam2-refresh.json`](../../../src/data/experiments/wall-v5-sam2-refresh.json).
It is not accepted geometry or a review checkpoint and is not yet imported by the
online editor. Usage/limitations:
[docs/wall-v5-sam2-refresh.md](../../../docs/wall-v5-sam2-refresh.md).

The active production catalog still points at v4. The versioned v5 presentation
image is separate; old reference-filled pixels remain zero in its observation mask.
