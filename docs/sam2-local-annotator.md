# Local SAM2-assisted hold annotator

> The current editor supports the full wall, existing-data edits and automatic
> suggestions. See [the full-wall upgrade](sam2-full-wall-annotator.md). The
> crop-only description below records the first version; the current default
> storage path is `artifacts/full-wall-annotations/holds.json`.

The tool serves a built React page and a Python SAM2 service from one origin.
Only the top-left 2431 × 1838 crop is encoded. SAM2.1 Small is loaded once and the
image features are reused across positive points, negative points and box prompts.
It checks CUDA first and uses CPU when CUDA is unavailable. No production hold
dataset, route storage, or Vercel production deployment is modified.

## Run on a computer

Install the Python environment and official checkpoint using
[sam2-top-left-experiment.md](sam2-top-left-experiment.md), then:

```bash
npm ci
npm run build
/tmp/stoneham-sam2/bin/python tools/sam2_annotation_server.py \
  --checkpoint /tmp/stoneham-sam2-models/sam2.1_hiera_small.pt
```

Open `http://127.0.0.1:8787/?annotate=1`. The page shows initialization progress
and model-load errors. Wait for “SAM2.1 Small ready”. The Python standard library
serves both the frontend and API; no extra API framework is required. The same
Vite app without `?annotate=1` remains the original wall app. Running this page on
a static Vercel deployment alone will show an unavailable-service message.

## Annotate

- **＋ Hold:** tap inside the hold; additional positive points refine the target.
- **− Exclude:** tap unwanted regions to exclude them from the next prediction.
- **Box:** drag a rectangle, or tap two opposite corners (useful on a phone).
- **Pan**, pinch, **Zoom in/out**, and **Fit crop** control the view.
- **Generate mask:** request real SAM2 predictions. Changing prompts clears the
  previous preview, preventing accidentally accepting an outdated outline.
- **Outline candidate:** inspect up to three predictions; scores are model
  estimates rather than proof of a correct hold boundary.
- **Accept hold:** save the selected simplified polygon. **New hold / Clear**
  discards the current unsaved prompt set. **Undo prompt** removes the last point,
  or the box when there are no points; clear then redraw for more complex changes.
- Choose an accepted hold in **Saved hold** to delete it. **Export JSON** downloads
  a copy of the accepted dataset to your device.

Green outlines are the preview; blue outlines are accepted holds. Coordinates in
requests, stored output and exports are normalized against the full 7292 × 5514
wall, not the crop. Polygons have at most 16 vertices, with independent
`manual-*` IDs and kind `hold`. Classification, holes, vertex editing, importing
accepted polygons into route setting and full-wall inference are not included.

## Persistence and access

Accepted polygons are atomically saved to `artifacts/manual-annotations/holds.json`
by default; change this with `--storage`. Refreshing the browser reloads them from
the server. Unsaved prompts are temporary. An export contains `holds`, `wallId`,
image dimensions, crop bounds and source. It does not replace any repo dataset.

For another device on the same trusted LAN, bind `--host 0.0.0.0` and open the
computer's LAN address. The normal localhost version has no login. For a temporary
HTTPS preview, supply `--access-key-file /path/to/key` containing a random key of
at least 32 characters. Enter via `/auth?key=...`; it establishes an HttpOnly,
Secure, SameSite cookie and redirects to the annotator. All pages, images and API
routes require that cookie. The key is not logged by the Python server and must
not be committed. The optional keyed mode expects HTTPS.

The hosted phone trial uses the **Vercel Sandbox** named
`stoneham-sam2-annotator`, attached to the existing Stoneham project. It is a
separate CPU VM, not a Vercel Functions deployment or promotion of the website.
Its port 8787 has a private-key HTTPS entry link delivered in chat. The session
is limited to 45 minutes and the sandbox is persistent: on stop its filesystem
is snapshotted. A resumed session needs the server process restarted and may have
a new port URL. Export accepted holds before leaving; snapshot retention is not a
substitute for keeping your own JSON backup. Resume through the connected Sandbox
API or CLI and restart the same server with the existing storage and key file.

The current cloud trial uses `/vercel/stoneham` for the app,
`/vercel/sam2-venv/bin/python` for Python, `/vercel/models/sam2.1_hiera_small.pt`
for weights and `/vercel/stoneham/access-key` for the private key. No secret values
are stored in this document or the repository. Only one inference runs at a time;
a concurrent request gets a retryable 409 rather than corrupting predictor state.

## Validation

```bash
npm run build
python3 -m py_compile tools/sam2_annotation_server.py
# With a running server, Playwright and Chromium available:
APP_URL=http://127.0.0.1:8787 node scripts/annotator-smoke.cjs
```

For an external Playwright installation set `PLAYWRIGHT_MODULE_PATH`; for system
Chromium set `CHROMIUM_PATH`. To test a keyed HTTPS preview, set
`ANNOTATOR_KEY_FILE` to its local private key file. The test checks actual model
predictions from positive/negative/box prompts, contour limits, accept, persisted
reload, download, delete, bounds validation and cross-origin POST rejection. It
creates and deletes its own test annotation, preserving any existing user work.
