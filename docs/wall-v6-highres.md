# Original-resolution wall mosaic

Candidate version: **2026-11-v6-highres**. This replaces the compressed inputs
for a new candidate, without changing active production v4, the prior v5 image,
accepted geometry or any saved review decisions.

## Original photos and image quality

The four JPEGs were downloaded from the user-provided Google Drive folder through
the connected Drive integration. Each is **6144 × 8192**, about 50.3 MP; sizes are
18.1–21.4 MB. Filenames, Drive file IDs, byte counts and exact SHA-256 hashes are
recorded in the candidate manifest and
`artifacts/wall-rescans/drive-highres-20261106-audit/source-downloads.json`.
Raw originals stay under ignored `private-inputs/drive-highres-20261106/raw/`.
No Drive sharing settings were changed and no download bearer URLs are committed.

The previous candidate used 960 × 1280 delivered photos. The originals provide
6.4 times as many source pixels along each dimension. Registration matches use
3000px working images, but composition warps the full original RGB photos directly
into the 7292 × 5514 reference frame. No source thumbnail is enlarged to form the
new image; no generative sharpening or synthesized texture is used.

The side-by-side [native-pixel detail comparison](../artifacts/wall-rescans/drive-highres-20261106-audit/detail-comparison.jpg)
shows the same reference crop on the previous v5 JPEG and new lossless candidate.
It is a visual quality comparison, not a hold-identity or geometry-accuracy test.

## Result and limits

- All four sources passed the existing registration checks; none were rejected.
- Actual observation coverage is **92.2487%** of the reference canvas. All 677
  inherited entries remain unreviewed; 651 have at least 99% observation coverage.
- At the user's request, the missing **7.7513%** is filled from the original v1
  canonical image for display. Coverage and source index stay zero there.
  The lossless pre-JPEG composite was checked pixel-for-pixel: observed new-photo
  pixels are unchanged and only missing pixels receive old-reference values.
  Reference fill is not evidence of current holds or a removal decision.
- Four source-overlap checks passed. The 175533/175541 pair has p95 disagreement
  **11.252px**, above the 10px check. The 175524/175541 pair has only three shared
  correspondences and remains unverified. Uncertainty flags and the QA preview
  retain this evidence. Clearer texture does not remove parallax/alignment risk.
- There are no unresolved old-hold regions split across multiple selected sources.
- SAM2 suggestions are refreshed against this exact reference-filled high-resolution
  image; reference-only or partially observed locations are skipped. No new-position
  detection, accepted catalog or route migration is performed. The new review
  session is separate; prior approvals cannot transfer silently.

The runner exits **2** because coverage and overlap gates still require review.
The image is a successfully generated candidate, not a publication-ready wall.

## Files

`public/wall/versions/2026-11-v6-highres/` contains the full-resolution `wall.jpg`,
actual `coverage.png`, per-pixel `source-index.png`, `uncertainty.png`, and a
hash-bound manifest with exact source provenance. The reference-filled JPEG is about 12 MB.
The full local run also retains the approximately 51 MB lossless
`artifacts/wall-rescans/drive-highres-20261106/wall_registered.png`, full transform
diagnostics, original review queue and inherited prelabels. These intermediates
are ignored; compact inspection evidence is tracked in the audit directory.
The optional lossless `wall_reference_filled.png` retains the exact presentation
composite before JPEG compression. The original black-gap PNG is preserved.
`reference-filled-preview.jpg` shows the final full-wall presentation image.

## Reproduce

Use the pinned environment from `tools/wall_rescan/requirements.txt`, retrieve the
exact four Drive originals, and arrange:

```text
private-inputs/drive-highres-20261106/
  scan.json
  raw/IMG20261105175524.jpg
  raw/IMG20261105175533.jpg
  raw/IMG20261105175541.jpg
  raw/IMG20261105175549.jpg
```

Copy the tracked audit `scan.json` to that input directory, verify source hashes,
then run with a new output folder:

```sh
python -m tools.wall_rescan.mosaic \
  --manifest private-inputs/drive-highres-20261106/scan.json \
  --output artifacts/wall-rescans/drive-highres-rerun
```

Recorded run used the existing pipeline at commit
`b16eae6b039425825d465704ec569831bb4a29c1`, OpenCV 4.11 and the existing
CPU Python environment. No pipeline code was changed. Validation decoded and
verified all original JPEGs, checked output/map dimensions and exact archived
file hashes, and inspected the whole mosaic and native-pixel detail crop.
