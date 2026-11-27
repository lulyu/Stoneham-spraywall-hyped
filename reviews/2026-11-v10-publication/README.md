# v10 publication

The user authorized publication of the completed review on 2026-11-27.

## Accepted geometry

- 862 active holds: 820 retained v9 identities, 42 new identities, 32 removed.
- Canonical map: `src/data/walls/2026-11-v10/holds.json`, exactly equal to
  `../2026-11-v10-reviewed/publication-geometry.json`.
- Image: 7292 × 5514; SHA-256
  `ab074cd9e5d0b20c9e6ecb7bf77a005f845c216623197e23ce9d3ab9300165af`.
- The original human checkpoint remains unchanged (revision 871, history 901).
  The canonical reconciled checkpoint is revision 874, history 904. Three
  additional actions explicitly attributed to Codex restore the unchanged
  striped blue hold to its v9 ID, using the human-reviewed polygon exactly.
  See the archived identity reconciliation and replay validator for evidence.
- Earlier assistant review actions retain their original attribution.

## Backend and migration

CloudFormation updated the API code using the previous template and parameters
except ArtifactKey. The reviewed change set replaces no resources and changes
no database or IAM configuration. The deployed ZIP hash matches Lambda's
CodeSha256. See [deployment-migration.json](deployment-migration.json).

The complete three-page sweep processed 15 route records: 12 compatible with
v10 and 3 outdated. A second dry run converged with zero changes and no conflicts.
This updates compatibility metadata; it does not create duplicate Upgrade routes.

Complete consistent-read before/after snapshots verified unchanged route IDs,
content, owners, hold roles, timestamps and Upgrade lineage. All 37 protected
rating/comment/send/summary/profile/Upgrade-counter rows remained identical.
Private raw database snapshots are excluded from Git. See
[data-verification.json](data-verification.json).

## Verification

- Final human and reconciled checkpoints replay successfully; zero pending.
- Frontend: all 16 test files pass; production build passes.
- Backend: typecheck, production build and all 9 test files pass.
- Exact registered map, image, session and checkpoint hash assertions pass.
- Mobile browser lifecycle passes: v10 default, valid/outdated routes, historical
  warning, author-only Upgrade, mapped surviving holds, V2/V3, source preservation,
  missing Start validation, history links and widths 320/390/980.
- Public API smoke passes; anonymous/forged writes are rejected and no test
  records are created in production.

## Frontend production

PR #40 merged as `cbcb33d0eb4edee8b52aa8f0b4d768a2b643c056`.
Vercel production deployment `dpl_2wyYr5KQ7rpZHm2SGZBpz7BpVAUf` is READY.
The live site serves the exact accepted image hash and defaults to v10.
Read-only browser checks verified a current route on v10, an outdated route on
its retained v7 wall with the historical warning, one loaded activity panel,
selected-hold overlays and responsive layout at 320/390/980 pixels. No page
errors, duplicate-key warnings, failed requests or production writes occurred.
Both main-branch CI checks pass. See
[frontend-verification.json](frontend-verification.json).

Site: https://stoneham-spraywall-project.vercel.app/

