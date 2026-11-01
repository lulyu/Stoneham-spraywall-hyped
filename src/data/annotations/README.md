# Saved annotation checkpoints

`full_wall_manual_v2.json` is the user's original full-wall export, preserved
byte-for-byte. It contains 642 accepted holds and 12 dismissed suggestions,
exported at `2026-11-01T04:23:17Z`. This is a work-in-progress checkpoint, not a
claim that all holds have been annotated. The earlier 43-hold top-left ground
truth remains unchanged under `src/data/groundtruth`.

SHA-256: `67e85109ac44ebc47e83369bb77cb169abac948cb97b09fb7b9b425d9c3d85cb`.

Load it through the editor's JSON import or initialize a new working file with:

```bash
python tools/sam2_annotation_server.py --checkpoint /path/to/sam2.1_hiera_small.pt \
  --seed src/data/annotations/full_wall_manual_v2.json --storage /path/to/new-work.json
```

Generate the remaining-holds coverage visualization (Pillow, NumPy, OpenCV;
no model inference or model checkpoint needed):

```bash
python tools/preview_unmarked_holds.py
```

The full-resolution preview is `artifacts/stoneham-unmarked-holds-preview.jpg`
(7292 × 5514). Each accepted polygon is filled with the median of nearby unmasked,
bright, low-chroma wall pixels. The binary polygon union is also saved as
`artifacts/stoneham-annotated-holds-mask.png`; the preview's metadata records input
hashes and count. Unmasked pixels are verified unchanged before JPEG encoding.

Visible objects outside those polygons are candidates for further annotation.
Thin colored rims or shadows can remain when a polygon stops short of an object's
edge; they do not necessarily indicate a completely unannotated hold. The preview
is a polygon-coverage visualization, not an automatic count of remaining holds.

## v3 checkpoint

`full_wall_manual_v3.json` preserves the next user export verbatim: 676 holds,
including 34 new IDs relative to v2, exported at `2026-11-01T04:32:55Z`.
SHA-256: `97d0d9305f1f894922a32559c5c11815cb075970535db7865bd4f395b4d5c399`.

Its full-resolution coverage preview is
`artifacts/stoneham-unmarked-holds-v3-preview.jpg`, with a separate v3 mask and
metadata file. Prior snapshots and their visualization masks remain unchanged.

```bash
python tools/preview_unmarked_holds.py \
  --annotations "$PWD/src/data/annotations/full_wall_manual_v3.json" \
  --output "$PWD/artifacts/stoneham-unmarked-holds-v3-preview.jpg"
```

## v4 checkpoint

`full_wall_manual_v4.json` is the original 677-hold user export from
`2026-11-01T04:36:54Z`, including one additional hold relative to v3. The user
considers this the completed pass; the coverage view can still be used to inspect
for omissions. It is preserved verbatim, SHA-256:
`0be8468fbc2b40b924062024fd09da753882726ddfe7ce2e589ea4cc7f5a068d`.
