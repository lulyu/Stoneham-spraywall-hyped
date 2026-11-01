# SAM2 top-left experiment

This experiment runs SAM2.1 Small on only the top-left third of the canonical
image in each dimension, about one ninth of its area. It does not replace the
current route-setting dataset. Coordinates are normalized by the **full wall**
(7292 × 5514), not by the crop.

## Recorded result

- Model: official SAM2.1 Small; config `configs/sam2.1/sam2.1_hiera_s.yaml`.
- `torch.cuda.is_available()` returned false: CPU, four threads, PyTorch 2.5.1+cpu.
- Crop: `[0, 0, 2431, 1838]` in full-wall pixels.
- Prompts: 29 existing candidate centers plus 36 sparse grid points.
- Output: **25 polygons**, 3–16 vertices each, with separate `sam2-tl-*` IDs.
- Exact source/checkpoint hashes, elapsed time and thresholds are recorded in the
  dataset metadata and `artifacts/sam2-top-left-run.json`.

Larger holds have useful outlines in qualitative inspection. This is not an
accuracy benchmark: there is no labeled ground truth. Small and pale holds are
missed; shadows, neighboring objects and parts of volumes can become masks.
Cropped-off objects are rejected. All objects have kind `hold`; classification
was not tested. Sparse prompts and aggressive filtering favor precision over recall.

## Reproduce (Python 3.12 tested)

```bash
python3 -m venv /tmp/stoneham-sam2
source /tmp/stoneham-sam2/bin/activate
python -m pip install 'torch==2.5.1' 'torchvision==0.20.1' --index-url https://download.pytorch.org/whl/cpu
SAM2_BUILD_CUDA=0 python -m pip install --no-build-isolation -r tools/sam2-cpu-requirements.txt
mkdir -p /tmp/stoneham-sam2-models
curl -fL https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt -o /tmp/stoneham-sam2-models/sam2.1_hiera_small.pt
python tools/sam2_experiment_top_left.py --checkpoint /tmp/stoneham-sam2-models/sam2.1_hiera_small.pt
```

The model is about 176 MiB; weights and virtual environments are not committed.
Expected checkpoint SHA-256:
`6d1aa6f30de5c92224f8172114de081d104bbd23dd9dc5c58996f0cad5dc4d38`.
SAM2 source is pinned to `2b90b9f5ceec907a1c18123530e92e794ad901a4`.

For CUDA, install compatible CUDA PyTorch/torchvision instead of the CPU lock,
then the same pinned SAM2 source and OpenCV. Default `--device auto` checks CUDA
first and otherwise chooses CPU. `--device cpu` forces CPU; `--device cuda` fails
clearly if unavailable. CUDA extensions and mixed precision are not required.
Missing dependencies, missing weights, incompatible model setup and empty filtered
results return a nonzero exit, explanatory message and failed run report. They do
not write pretend polygons or overwrite an existing successful dataset. After a
failed run, older successful artifacts may still exist: check the run report.

## Pipeline

1. Crop the original JPEG and encode only the crop once with SAM2.
2. Decode existing candidate centers. Add a deterministic 6 × 6 grid, skipping
   points within 35 pixels of an existing prompt.
3. Request three masks per positive point and keep the component containing it.
4. Reject scores below 0.7, areas below 150 pixels or above 12% of crop area,
   crop-edge objects and obvious bright low-saturation wall patches. The foreground
   heuristic requires 35% of mask pixels to have HSV saturation >45 or value <130;
   this also discards some pale holds.
5. Keep the highest-score eligible mask per prompt. Deduplicate by IoU >0.65 or
   intersection / smaller area >0.85, preferring higher-confidence masks.
6. Simplify external contours to ≤16 vertices and normalize to the full wall.

Explore thresholds with `--grid`, `--min-score`, `--min-area`,
`--max-area-fraction` and `--min-foreground`. GPU/package changes can change results.

## Outputs and inspection

- `src/data/experiments/top_left_sam2_polygons.json`: metadata and `holds` array.
- `artifacts/sam2-top-left-crop.jpg`: source crop at original resolution.
- `artifacts/sam2-top-left-overlay.jpg`: all retained polygons.
- `artifacts/sam2-top-left-overlay-labeled.jpg`: polygons and IDs.
- `artifacts/sam2-top-left-run.json`: device, status, hashes and timing.
- `artifacts/sam2-top-left-ui-debug.png`: browser validation screenshot.

Run `npm run dev`, open **Polygon debug**, enable **Show all polygons**, and
choose **Current candidates** or **SAM2 top-left** in **Debug dataset**. Optional
**Show polygon labels** adds IDs. **Focus top-left crop** zooms the experimental
region. Colored transparent fills and thin outlines expose overlaps.

Debug defaults to off and ignores pointer events. The selector changes overlays
only: setting, saving and browsing retain current candidate IDs and storage key.
SAM2 IDs never enter saved routes. Main candidate data is unchanged.

## Validation

```bash
npm run build
node scripts/check-sam2-experiment.mjs
npm run preview -- --port 4173
# Another terminal, with Playwright and Chromium installed:
APP_URL=http://localhost:4173 node scripts/mobile-smoke.cjs
APP_URL=http://localhost:4173 node scripts/polygon-debug-smoke.cjs
```

Set `PLAYWRIGHT_MODULE_PATH` or `CHROMIUM_PATH` for external installations.
The JSON check validates full-wall coordinate bounds, IDs, scores, metadata count
and vertex cap. Browser checks cover debug toggles, labels, crop focus, mobile
layout and saving a route with the SAM2 overlay enabled.
