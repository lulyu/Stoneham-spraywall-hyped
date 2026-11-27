# November 27 wall candidate — assistant review

This is an **unpublished v10 candidate** prepared from the user's three November 27
original photographs. The current production wall remains v9; no production
catalog, route compatibility flags, or activity records were changed.

The full process follows [the wall-update runbook](../../docs/wall-update-runbook.md).
All review decisions are attributed to **Codex (assistant visual review)** with
`reviewerKind: "assistant"`; these are not human approvals or physical inspection.

## Result

See [summary.json](summary.json), [geometry-qa.json](geometry-qa.json), and the
[read-only comparison viewer](review.html). Cyan outlines retain IDs; yellow
outlines have fresh IDs. The viewer also exposes removed old positions and
individual changed-hold browsing.

The candidate has **858 active holds: 819 retained v9 IDs and 39 fresh IDs**, with
**33 old positions removed** and **zero pending**. The 39 fresh IDs comprise 29
accepted supplemental masks and 10 changed-pose holds. Replacements, moves, and
clearly changed orientations do not inherit route compatibility automatically.
Slight projection changes on unchanged small footholds are contour refinements.

A black hold that moved into the vicinity of a removed red hold initially appeared
in both the moved-hold and new-location lists. Final duplicate QA caught this;
`nov27-R19` is a rejected duplicate trial, and only the moved hold's fresh ID is
accepted. The rejected QA result is retained as `rejected-first-pass-geometry-qa.json`.
Raw proposals are not silently removed to make the model appear correct.

## Image and provenance

- Canvas: **7292 × 5514**, registered directly to published v9.
- Exact image SHA-256: `ab074cd9e5d0b20c9e6ecb7bf77a005f845c216623197e23ce9d3ab9300165af`.
- Approximately **97.91% new-photo coverage**. Unobserved edge fill comes from v9
  and remains coverage/source index zero; every accepted hold has 100% new coverage.
- SIFT/MAGSAC registration and bounded residual corrections use stationary
  background features, excluding inherited holds and suspect changes. Held-out
  residual checks are recorded per source in `composition-manifest.json`.
- Whole-hold seam guards and continuous kickboard source regions avoid mixing
  different photographs through a hold. The kickboard policy is preventative;
  its historical failure description does not claim this run's first image was
  already observed to clip footholds.
- Source IDs, byte counts, native dimensions, and hashes are in
  `originals-manifest.json`. Unmodified camera files remain in the local update
  workspace; the archive retains their identities and derived comparison evidence.

[Clean preview](comparisons/preview.jpg) · [aligned GIF](comparisons/previous-vs-new.gif) ·
[final overlay](confirmed-overlay.jpg). Four enlarged bottom-strip GIFs are also
included in `comparisons/`.

## Segmentation and review

All **852 published v9 holds** were prompted using SAM2.1 Small from a **20% linear
polygon inset** on this exact image. The contraction changes the positive prompt
region only, never the final contour. Raw inference records retain all prompts,
failures, scores, coverage, associations, software versions, checkpoint hash,
device, seed, threads, and runtime.

Nine overlapping old/new sectors and difference-ranked crops were inspected for
identity, changes, and gaps. Thirty supplemental locations were independently
prompted. All 30 also received local crop trials; those trials were compared with
the original masks, rather than assumed better. Eleven supplemental outlines and
two moved white holds received explicit visual boundary corrections. Crop-space
vertices, native crop bounds, normalized polygons, and reasons are preserved.

Forty-one inherited locations received local trials. Six accepted local masks
separate the two small holds on black volumes, improve two other outlines, and
recover two moved black holds. Most local trials included more shadow than the
original result and were rejected. The two failed white-hold masks were replaced
by the separately recorded visual corrections. No-mask is never itself evidence
of removal, and confidence is never itself evidence of identity.

The final checkpoint is `review-progress.json`. `assistant-decisions.json` stores
the actual review actions and identity reasoning. The immutable baseline and raw
model proposals remain separate from replay-derived `confirmed-geometry.json`.
All nine final sector overlays are retained for a missing-hold and boundary pass.

## Reproduce and continue

Run `node reviews/2026-11-v10-assistant-reviewed/validate.mjs` from the repository
root. It verifies archive hashes, the published reference, session/image/model
bindings, every review action through replay, extracted geometry, counts, fresh
IDs, and assistant attribution. Geometry QA additionally checks new-photo
coverage and near-identical polygon duplicates.

`pipeline/` preserves this run's scripts. They contain this run's paths, regions,
photo order, and manual decisions; inspect and parameterize them for another photo
set. They are not a one-command pipeline for arbitrary inputs.

An editable ZIP is retained in the local update workspace. Extract it and import
the matching folder and `review-progress.json` into the annotation editor to
continue review. Browser edits remain in IndexedDB until exported; the SAM2 server
does not store a reviewer's completed decisions.

## Publication handoff

`route-impact.json` is a read-only assessment of the public route listing, not an
administrative migration sweep. Publishing requires the separate
[wall-publication workflow](../../docs/wall-publication.md), scanning every stored
route and pagination cursor. Preserve route IDs, authors, content, ratings,
comments, sends, and Upgrade lineage. Do not create V2/V3 copies automatically.
