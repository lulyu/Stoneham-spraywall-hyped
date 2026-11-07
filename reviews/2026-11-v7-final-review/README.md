# Prepared v7 final-review session

This is identity evidence for a separate final review, not completed approvals.
The matching image experiment is `public/wall/versions/2026-11-v7-seam-trial/`.
The 797 starting outlines come unchanged from the completed v6 snapshot at
`reviews/2026-11-v6-highres/confirmed-geometry.json`.

`manifest.json` binds both image identities, the reference outline bytes,
the source checkpoint, candidate manifest and observation masks.
`report.json` records zero accepted outlines. All 797 entries begin pending.
The completed v6 checkpoint and its 26 removals remain unchanged.

Recreate the full bundle from the repository root:

```sh
python -m tools.wall_rescan.recheck_review --output /tmp/stoneham-final-review
python tools/sam2_annotation_server.py \
  --rescan-session /tmp/stoneham-final-review \
  --checkpoint /path/to/sam2.1_hiera_small.pt --host 127.0.0.1 --port 8787
```

Build the frontend first with `npm run build`. Then open
`http://127.0.0.1:8787/?annotate=1&review=1` and choose Open local server scan.
The supplied reference files are hash checked; production image/map files are
not changed. Export progress after the last check to save the new review.
