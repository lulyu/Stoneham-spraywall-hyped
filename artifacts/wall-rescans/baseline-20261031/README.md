# IMG20261031152837 same-source baseline

CPU run of the Phase A single-photo runner. Input: the user-provided 960 x 1280
partial photo from the original wall session; SHA-256:
`4bff5890eaa326895b1e5d2af9c5922927ff22394cdd0aa029d123a6b43cd43c`.
Raw input is not committed. See tools/wall_rescan/README.md for setup and rerun.

The source maps onto the upper-left part of the 7292 x 5514 reference, covering
24.8816% of reference pixels. It intersects 178 old holds: 157 >=99% observed and
21 partially observed. All transferred polygons retain their exact original IDs
and normalized coordinates, and all remain inherited-unreviewed. There are no
accepted holds and no change classifier; removed/new counts are unknown.

| Evidence (full reference pixels) | Result |
| --- | --- |
| Fit inliers / fit matches | 990 / 1176 |
| Fit inlier residual median / p95 | 1.335 / 6.206 px |
| Held-out descriptor matches, all | 293 |
| Held-out all-match median / p95 | 1.790 / 56.948 px |
| Held-out matches within the 8 px threshold | 233 / 293 (79.52%) |
| Consistent held-out subset median / p95 | 1.364 / 5.685 px |
| Independent manually measured validation anchors | Not supplied |

The conditional subset error is not an independent accuracy claim. All-match
errors retain wrong correspondences and/or local alignment failures; the largest
is about 5770 px. Global alignment looks close on the inspected overlay, but this
is not pixel-perfect registration or evidence that every hold is unchanged. The
source is upsampled into the reference frame; it does not add high-resolution
information. New camera positions, lighting, changed holds, panel parallax and
multi-source seams still need independent evaluation.

Checked in: report/manifest/full match diagnostics and three inspection previews.
Other files from the runner (full-resolution warp, masks, prelabels, review queue,
lineage, crop and residual previews) remain reproducible local intermediates.
The code commit recorded in the manifest is the exact implementation used for
this run; tool/test sources were clean. A second real-photo run reproduced the
registration, masks, registered image, prelabels, queue and report byte-for-byte.
Both canonical production files were checked against main and remained identical.

The unreviewed export carries the actual backend wallId, so the legacy annotator
rejects it instead of silently treating its polygons as accepted.
