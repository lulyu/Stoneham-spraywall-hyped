# Polygon hold candidates

This directory contains an **experimental** polygon-native detection pass generated from Lu's manually adjusted 7292×5514 canonical wall image.

The two sample JSON files are experimental; the app now uses the complete packed dataset described below. Candidate IDs are not stable across detector changes. The existing circular dataset was generated from an earlier image, so do not treat matching numeric IDs as identity matches.

The intended v1 canonical representation is:

```ts
{
  id: string,
  center: [number, number],       // normalized [0, 1]
  polygon: [number, number][],    // normalized [0, 1], max 16 vertices
  kind: 'hold' | 'macro' | 'volume'
}
```

The automatic detector is only a bootstrap. Final hold geometry should be corrected in the wall-editor UI before the dataset becomes canonical.

## Rebuild the active dataset

The app uses `auto-v1-packed.ts` (526 candidates). Regenerate it from the exact
canonical image instead of copying encoded data through chat or truncated output:

```bash
# Requires Python with opencv-python-headless and numpy.
python3 tools/detect_holds.py public/wall/stoneham-spraywall-canonical.jpg /tmp/holds.json
python3 tools/pack_holds.py /tmp/holds.json src/data/polygons/auto-v1-packed.ts
npm run build
```

The build validates Base64 encoding, record boundaries, polygon sizes, and candidate
count before bundling. The mobile smoke script checks browser startup and the
active polygon overlays against the production preview as well as the dev server.
IDs are assigned in detector order; review saved-problem compatibility whenever
changing detection parameters or candidate ordering.
