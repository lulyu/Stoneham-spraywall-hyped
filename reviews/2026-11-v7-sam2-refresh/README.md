# SAM2 refresh on the selected v7 image

The user reported that the previously reviewed v6 outlines drifted on the new
seam-selected image and requested fresh SAM2 masks for every hold. This run
uses all **797** active geometries from the completed v6 backup as prompts on
the exact v7 JPEG. It does not reuse old-image segmentation results or approval
flags. The prior v6 checkpoint and the v7 geometry-only recheck remain separate.

`reference-holds.json` preserves the 797 starting outlines exactly.
`candidate.json` binds the v7 JPEG, actual observation/uncertainty masks,
reviewed v6 comparison image, source session and reference geometry by SHA-256.
The new proposals are stored in
`src/data/experiments/wall-v7-sam2-refresh.json`.

The local reference run prompted all 797 holds in 234.50 seconds, generated
797 usable masks and deduplicated them to 795 unique proposals. All 795 pass
the editor's polygon validator. Two proposals each associate with two starting
hold IDs; these four entries require inspection for a possible merged mask.
No result is automatically confirmed. Twenty-six prompts have partial or zero
new-photo coverage, with their actual coverage evidence retained.

## Live preview and exact onsite backup

Automatic approval review rejected uploading the new private proposal JSON to
Vercel. A safer path sent only generic program source and recomputed SAM2 inside
the already-authorized Sandbox, on the image and 797 outlines already present
there. That run prompted all 797 holds in 252.10 seconds on two CPU threads,
again generating 797 usable masks and 795 valid unique proposals with zero
geometry-validation rejections. It has its own candidate/session identity.

`onsite-sam2-proposals.json` and `onsite-session-manifest.json` are the exact
files downloaded back from the running review API after that computation.
`onsite-run-summary.json` records their identity, hash and run counts. These are
the live editor's proposals; the portable candidate and model dataset above
record the separate local reference run. The two runs can differ in geometry
or scores, and their approval sessions are not interchangeable.

The preview was restarted with the onsite review folder and a fresh temporary
runtime. Mobile browser checks passed for 797 inherited entries, 795 model
suggestions, instant Next without another inference request, Confirm,
remove/replace, persistence after reload, and the existing five quick buttons.
Test storage was isolated. The prior review folders and browser checkpoints
remain separate. Fresh inference is available on the matching SAM2 server.
`onsite-review-mobile.png` records the tested interface. Frontend tests and
42 offline rescan tests passed.

The user requested every hold, including edge regions. The explicit
`--include-partial` option prompts partial/reference-filled regions too, keeping
their measured observation fractions. These remain manual-review suggestions;
the bulk-confirm filter still excludes incomplete coverage. The default runner
behavior for other experiments continues to require at least 99% coverage.

## Reproduce

From the repository root with the pinned SAM2.1 Small environment:

```sh
python -m tools.wall_rescan.sam2_refresh \
  --version-manifest reviews/2026-11-v7-sam2-refresh/candidate.json \
  --old-holds reviews/2026-11-v7-sam2-refresh/reference-holds.json \
  --checkpoint /path/to/sam2.1_hiera_small.pt \
  --output artifacts/wall-rescans/v7-sam2-refresh-rerun \
  --include-partial --threads 4
node scripts/validate-sam2-refresh.mjs \
  artifacts/wall-rescans/v7-sam2-refresh-rerun/sam2-refresh.json \
  /tmp/v7-sam2-validated.json /tmp/v7-geometry-validation.json
python -m tools.wall_rescan.candidate_review \
  --manifest reviews/2026-11-v7-sam2-refresh/candidate.json \
  --proposals /tmp/v7-sam2-validated.json \
  --old-holds reviews/2026-11-v7-sam2-refresh/reference-holds.json \
  --reference public/wall/versions/2026-11-v6-highres/wall.jpg \
  --output artifacts/wall-rescans/v7-sam2-review-rerun
```

The geometry validation step rejects invalid simplified contours using the
editor's actual validator. Rejected associations remain pending for manual work;
raw inference evidence is retained separately. A new hash-bound session prevents
silently carrying approvals from either previous review session. In the editor,
Next pending hold loads the newly computed suggestion, and explicit confirmation
is still required. Where no valid suggestion is available, the saved outline
remains editable and live SAM2 can be rerun with corrected points/a box.

The new server uses the existing v7 JPEG/reference bytes already in the Sandbox;
only the small new review metadata and proposals need uploading. The server keeps
the prior review folders, uses the existing private access configuration in
place, and never writes the production wall catalog.
