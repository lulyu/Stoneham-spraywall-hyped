# November 27 v10 — completed human review

Lu completed the manual review of the v10 candidate. The uploaded
`review-progress _7_.json` is preserved byte-for-byte as `review-progress.json`.
Its SHA-256 is `18b0e41de52819ca5731888f1cc2699dafb02087821f4de3bd7d6b89dd9b4e0e`.

The original human checkpoint contains **862 active holds**, **zero pending**: 819
published v9 IDs retained, 43 provisional fresh IDs, and 33 old positions removed. Lu added four missed
holds and refined six existing outlines without changing their IDs. The original
858 assistant-reviewed holds remain active.

All 891 assistant history records are unchanged. Lu's 10 additional actions bring
the checkpoint to revision 871 and 901 history records. These human-format events
retain their original optional `reviewerKind` fields; the export is not rewritten
to add attribution. The final geometry is extracted only after full replay against
the immutable session and baseline in
[the assistant review archive](../2026-11-v10-assistant-reviewed/README.md).

## Identity reconciliation

The unchanged striped blue hold below the replaced blue/green hold was mistakenly
removed during assistant review. Lu restored its correct outline as
`scan-02808c24-d928-46b5-9966-49eb0d67debb`. Its published v9 polygon clearly
belongs to this same distinct hold: see [old/new evidence](blue-id-lineage.jpg).

The original human export and its extracted geometry remain unchanged. A separate
assistant-attributed checkpoint, `identity-reconciled-progress.json`, resets and
refines the old entry `new-v9-a6cbb66522e512` using Lu's exact outline, then dismisses
the duplicate provisional ID. All three additional decisions are replayable and
attributed to Codex, never to Lu. No boundary was altered.

The corrected publication candidate therefore has **862 holds, 820 retained v9
IDs, 42 fresh IDs, 32 old positions removed, and zero pending**, at revision 874.
Use `publication-geometry.json` and its reconciled checkpoint for a later release.
The updated comparison viewer uses these corrected IDs. The editable ZIP includes
both the canonical checkpoint and the untouched human original under separate names.

## Evidence and validation

- [Summary](summary.json) lists additions, corrections, retained IDs, and hashes.
- [Human changes](human-changes.jpg) shows the four additions and six refinements;
  [final overlay](publication-overlay.jpg) shows the complete accepted candidate.
- [Geometry QA](geometry-qa.json) checks uniqueness, near-identical polygons, and
  actual new-photo coverage. Every final polygon has 100% new-photo coverage.
- [Read-only comparison](review.html) uses the exact same image and v9 reference.
  The branch's `/wall/candidates/2026-11-v10/index.html` now shows this human-reviewed
  result. The earlier assistant snapshot is unchanged and remains inspectable.
- [Editable package metadata](package.json) records the local recovery ZIP. Its
  checkpoint was checked against the original uploaded bytes.

Run `node reviews/2026-11-v10-reviewed/validate.mjs` from the repository root. The
validator checks the original export hash, source/session/image/model bindings,
full action replay, unchanged assistant history, human continuation, extracted
geometry, expected counts, and QA. Shared source files are referenced by path and
hash instead of duplicating the earlier archive.

## Publication status

**Archived, not published.** Production remains v9. No default wall, published map,
backend catalog, route records, or activity was changed by this archival step.
Use the completed human export plus the explicit identity reconciliation for any
subsequent v10 publication, following
[wall publication](../../docs/wall-publication.md). Re-scan every stored route and
pagination cursor at publication; retain route content, authors, ratings, comments,
sends, and Upgrade lineage. Do not create automatic V2/V3 copies.
