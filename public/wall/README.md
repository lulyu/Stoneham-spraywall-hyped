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
