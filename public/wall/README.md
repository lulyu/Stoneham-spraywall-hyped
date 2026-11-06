# Canonical wall asset

The app's v1 canonical wall image is Lu's manually adjusted, rectified composite:

- filename: `stoneham-spraywall-canonical.jpg`
- dimensions: **7292 × 5514**
- coordinate convention: normalized image coordinates (`x / 7292`, `y / 5514`)

The binary JPG is intentionally not base64-embedded in source. The original full-resolution file is stored at:

```text
public/wall/stoneham-spraywall-canonical.jpg
```

All future hold geometry should be authored against this exact image so wall resets can be versioned cleanly.

## Versioned candidates

`versions/2026-11-v5/` stores the new registered, reference-filled candidate plus
actual coverage/provenance masks. It is not active or approved; the v4 canonical
path above stays unchanged. See [the experiment](../../docs/wall-v5-sam2-refresh.md).

`versions/2026-11-v6-highres/` contains the original-resolution four-photo candidate,
with v1 reference pixels filling only unobserved edge gaps. Coverage/provenance
remain unchanged; it is not active or approved. See [high-resolution scan notes](../../docs/wall-v6-highres.md).
