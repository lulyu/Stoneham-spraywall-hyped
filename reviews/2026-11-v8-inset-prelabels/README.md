# v8 draft prelabels, 20% inset prompts

The November 14 photo candidate uses v7's 7292 × 5514 frame. All 797 accepted
v7 outlines were prompted on the new image with SAM2.1 Small (CPU). Their
polygons were contracted to 80% linear scale, intersected with the original
outline for concave-shape safety, then sampled for up to five interior positive
points. The original extent box supplies context so the final mask can grow to
the true edge. The final polygons are model results, not contracted outlines.

The inherited pass produced 787 unique proposals; eight prompts had no eligible
mask and four prompts shared two proposals. Five separately prompted new locations
produced five more proposals: three bottom footholds and the relocated green and
beige holds. There are 792 proposals total, with **zero accepted holds**. The ten
known changed positions are explicitly excluded from inherited bulk confirmation.
At score 0.92, 693 inherited suggestions meet the existing bulk-confirm rules;
these still require an explicit reviewer action. New locations require individual
review and new IDs. All old IDs remain reference associations until reviewed.

The portable review bundle, image, full proposal JSON, overlays, run reports and
prompt evidence are retained under the workspace comparison folder. Large draft
assets, original photos, model weights, temporary access links and credentials
are not committed here. `summary.json` records the exact image/proposal/session
identity. These are prelabels; the active wall catalog and route database are not
updated by generating or opening them.

## Reproduce

Use the pinned SAM2 environment from `docs/sam2-top-left-experiment.md`:

```sh
python -m tools.wall_rescan.sam2_refresh \
  --version-manifest /path/to/sam2-candidate-manifest.json \
  --old-holds src/data/walls/2026-11-v7/holds.json \
  --checkpoint /path/to/sam2.1_hiera_small.pt \
  --prompt-inset .2 --threads 3 --output /path/to/empty-output
```

The archived supplemental run separately prompts the new/relocated positions,
flags known changes, then binds its combined proposals to a fresh review bundle.
Native photo capture, no-observation fill, and source seams remain recorded as
image evidence; every inherited polygon is fully covered by fresh observations.
No prior review approvals are transferred to the v8 image.
