# User-labeled ground truth

`top_left_manual_v1.json` is the original user-uploaded export, preserved verbatim.
It contains 43 fully visible holds in the top-left 2431×1838 region of the
7292×5514 canonical image. Partially visible boundary holds were deliberately
excluded. Coordinates are normalized to the full wall.

The sidecar metadata records the source hash and region policy. Editor changes
belong in a separate working file and future reviewed versions; do not rewrite
this reference when starting a new annotation session. Automatic proposals are
kept under `src/data/experiments` and are not ground truth.
