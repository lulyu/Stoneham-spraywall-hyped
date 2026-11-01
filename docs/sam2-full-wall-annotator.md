# Full-wall SAM2 annotator, ground truth and auto suggestions

The annotator now displays the entire 7292 × 5514 canonical wall. The original
43 user annotations are preloaded as accepted holds. They can be selected, refined
with SAM2, deleted from the working copy, and re-imported. No production route
setting dataset or deployment is changed.

## Ground truth

`src/data/groundtruth/top_left_manual_v1.json` is the **byte-for-byte original**
user export: 43 fully visible holds in `[0,0,2431,1838]`. The accompanying metadata
records its SHA-256 and the annotation policy: partially visible boundary holds
were not annotated. Treat this region as the labeled evaluation region, and do
not count cropped-off holds as missed ground-truth objects.

The server seeds a new working file from this JSON only when that working file
does not exist. Edits and deletes affect `artifacts/full-wall-annotations/holds.json`,
not the immutable ground-truth file. An edit preserves the original ID. Saving
checks the original hold snapshot and returns 409 if another tab has changed it.
New approved data should be exported and versioned separately as future ground
truth rather than overwriting v1 automatically.

## Start

Use the same pinned Python environment and checkpoint as the earlier crop
experiment, then:

```bash
npm ci
npm run build
/tmp/stoneham-sam2/bin/python tools/sam2_annotation_server.py \
  --checkpoint /tmp/stoneham-sam2-models/sam2.1_hiera_small.pt
```

Open `http://127.0.0.1:8787/?annotate=1`. Existing working files are preserved;
`--seed path.json` selects an initialization file and `--storage path.json`
selects the separate working file. The original crop-only working file is also
preserved and is never silently copied over this new full-wall workspace.

## Full-wall inference without losing small-hold detail

The image is not simply shrunk into one full-wall SAM2 embedding. A prompt selects
one of nine overlapping regions, with 160 pixels of overlap margin. The region
expands when necessary to include all positive/negative prompts and the box.
Its image embedding is cached; the two most recently used regions share one model.
This bounds memory on the 4 GB phone-trial sandbox. A new region takes longer to
encode than a repeated prediction in a cached region. CUDA is checked first;
the recorded run and phone trial use CPU.

All request, preview, saved and exported coordinates are normalized to the full
wall. ROI offsets are restored before returning polygons, which remain ≤16
vertices. The real bottom-right inference test checks this offset mapping.

## Auto pre-labels

`src/data/experiments/full_wall_sam2_suggestions.json` contains **349 unreviewed
suggestions**. The run used SAM2.1 Small, CPU, 955 point prompts across nine
160-pixel-overlapping tiles; it took about 195 seconds. Each tile combines existing
candidate centers with a sparse 6×6 grid. It applies the earlier score, area,
foreground and border filters, then deduplicates overlapping polygons. Minimum
model score is 0.88. Ground-truth overlaps are suppressed separately.

Reproduce with:

```bash
/tmp/stoneham-sam2/bin/python tools/sam2_seed_full_wall.py \
  --checkpoint /tmp/stoneham-sam2-models/sam2.1_hiera_small.pt
```

The output metadata records hashes, device, prompts, tile settings and counts.
`artifacts/sam2-full-wall-suggestions.jpg` shows accepted GT in blue and suggestions
in orange. These results have useful outlines but still include holes, parts of
holds, shadows and merged objects; model confidence is not a correctness guarantee.
No precision/recall claim is made without a proper ground-truth matching protocol.

## Phone workflow

- **Blue** = accepted/imported; **orange** = automatic suggestion; **green** = preview.
- **Select** lets you tap a blue hold to edit it or an orange shape to review it.
  The Saved hold dropdown plus **Edit selected** provides another selection path.
- Selecting a hold focuses the view and initializes a bounding box and its current
  outline. Add **＋ Hold** or **− Exclude** points, adjust the **Box**, then
  **Generate mask** and **Save changes**. Clear cancels an edit; IDs are preserved.
- **Review next suggestion** focuses the next unreviewed proposal. **Accept hold**
  adds it to the working dataset; **Skip this suggestion** persists its dismissal.
- **Accept all ≥0.95** explicitly approves the currently pending high-score
  suggestions in a batch (260 in the initial state). This is optional and may
  accept errors; inspect and edit afterward. It does not alter the v1 GT file.
- **Import existing annotations** merges a JSON export by ID. Identical IDs are
  idempotent. Differing geometry returns a conflict unless **Replace matching IDs
  on import** is enabled. Imports check the wall, dimensions, IDs and coordinates
  before writing; they do not delete unrelated saved holds.
- **Export JSON** downloads the working dataset. Existing route-setting problems
  and production hold IDs remain independent of this editor.

The temporary private HTTPS trial still runs in the separate persistent
`stoneham-sam2-annotator` Sandbox. Existing crop work was retained in the original
storage path; a new full-wall working file was seeded from the supplied 43-hold
JSON. Resuming the sandbox renews its 45-minute session, then the server must be
restarted. Keep JSON exports as your own backup.

## Validation

```bash
python3 scripts/test_annotation_data.py
npm run build
APP_URL=http://localhost:8787 node scripts/full-wall-annotator-smoke.cjs
```

The full mutating browser test expects a fresh 43-hold working dataset. Use a
separate `--storage` path for it. `DISPOSABLE_TEST_STORAGE=1` also exercises bulk
acceptance and leaves the disposable data changed. `READ_ONLY_REMOTE=1` tests
initial phone access, exact GT preservation and real bottom-right inference without
changing saved data. Playwright setup variables are documented in the local
annotator note. Tests cover original-ID edits, stale-write rejection, idempotent
import, bad input, persistent skip, coordinate bounds and mobile layout.
