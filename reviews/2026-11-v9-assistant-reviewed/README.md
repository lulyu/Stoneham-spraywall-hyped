# November 21 wall candidate — assistant review

This **unpublished v9 candidate** uses the three November 21 photographs supplied
by the user. The user explicitly requested that Codex try performing the review.
All 854 recorded decisions are attributed to **Codex (assistant visual review)**,
with `reviewerKind: "assistant"`; none are represented as the user's manual approvals.
The production wall remains v8 and no route migration has been applied.

- **852 active holds:** all **801 published v8 IDs retained**, **51 additions with fresh IDs**.
- **Zero pending**, no confirmed removals or replacements in the supplied photos.
- Exact canvas: **7292 × 5514**. Image SHA-256:
  `3b74b1d9a016255072d6641823a84076d7574e14591da7f59da06d08ad6a586b`.
- New photographs cover **98.72%** of the canvas. The remaining **1.28%** is explicit
  old edge fill (coverage/source index zero); **all 852 hold polygons have 100%
  new-photo coverage**.
- The public route-list snapshot contained 11 records: 10 are compatible with this
  candidate, and one already historical route remains historical. There are no
  newly incompatible routes in this snapshot. The actual publication must rescan
  all stored routes, including records outside this public list.

## View the result

[Open the interactive review](review.html), or view the
[new image](comparisons/preview.jpg), [aligned GIF](comparisons/previous-vs-new.gif)
and [accepted candidate overlay](confirmed-overlay.jpg).
Cyan outlines retain old IDs; yellow outlines are new locations. The standalone
preview is also served at `/wall/candidates/2026-11-v9/index.html` on this branch's
Vercel preview deployment. It does not write to the database.

## Review and corrections

Every inherited hold was prompted with SAM2.1 Small from a **20% linear inset**
of its published v8 polygon. All 801 inherited prompts were run on this exact
candidate. Physical identity was checked separately from model confidence using
nine overlapping old/new sectors and difference-ranked crops; the gaps and
bottom footholds were also inspected for additions or omissions.

The assistant identified 51 new physical holds and prompted them separately.
A color-difference component containing three orange holds was split into three
independent prompts. Wall fixtures, outline parallax and chalk residuals were
explicitly dismissed in `new-component-review.json`.

The first composition clipped several kickboard holds because different photos
were selected inside and outside an old silhouette. The final image uses
contiguous single-photo kickboard segments with seams in blank gaps. The rejected
first composition's clipping is shown in `evidence/kickboard-seam-fix.jpg`.

SAM2 initially merged two small holds mounted on black volumes into their parent
volumes and produced no usable masks for five kickboard holds. Thirteen inherited
locations were re-prompted with local crops. Their separate identities were
retained. New-location local re-prompt trials did not consistently improve the
outlines, so they are retained as evidence rather than blindly adopted.
**Eleven new outlines and two kickboard outlines were visually corrected by the
assistant**, with explicit polygon vertices and evidence crops recorded in the
correction files. All raw model suggestions remain unchanged.

This is an assistant's visual assessment of photographs, not an on-wall inspection.
The decision log is editable: a later human decision retains the earlier assistant
attribution in history. Publication is a separate step.

## Archive and verification

`baseline/` contains the immutable image-bound, pending review session and model
suggestions. `review-progress-r854.json` is the completed assistant checkpoint;
`confirmed-geometry.json` is its replay-derived snapshot, still non-publishable.
The exact image, coverage/source masks, alignment fields, source hashes, raw
inference, correction decisions and comparison evidence are retained alongside it.
Original camera files stay in the input workspace/Drive; their hashes and sizes
are preserved in `originals-manifest.json`.

From the repository root (Node with native TypeScript support):

```sh
node reviews/2026-11-v9-assistant-reviewed/validate.mjs
```

The validator checks asset hashes, immutable v8 references, exact model/session
bindings, history replay, assistant attribution, active geometry, retained IDs,
new-location decisions and non-publishable status. Geometric QA separately checked
new-photo coverage and near-identical polygons. Nested volume/hold containment is
intentional and is not treated as a duplicate.

To resume in the existing annotation editor, use the exported
`v9-assistant-reviewed.zip` bundle, containing the original baseline and
`review-progress.json`, with this branch's updated reviewer-attribution support.
The independent preview is read-only and does not require a SAM2 server.
