# v8 publication

The user confirmed that the two numbered locations in the
[comparison](../2026-11-v8-reviewed/identity-checks.jpg) are physical replacements
and requested new IDs and production publication.

- `sam2-auto-0240` → `replacement-v8-0240` (mint-green → textured purple).
- `scan-3d03fe67-21c0-4ff4-af5c-31e25b77e011` → `replacement-v8-3d03fe67` (purple → orange).

The [raw r812 review](../2026-11-v8-reviewed/README.md) remains byte-for-byte
unchanged, and its replay-derived snapshot still describes the original export.
Only the two IDs differ in `src/data/walls/2026-11-v8/holds.json`; all reviewed
centers and polygons are retained exactly. `identity-resolutions.json` records
lineage separately. Do not reuse either old ID on v8.

v8 contains 801 holds: 787 retained IDs, 10 retired IDs, and 14 new IDs versus v7.
The exact reviewed image is registered at `public/wall/versions/2026-11-v8/wall.jpg`.
v4 and v7 remain available for historical routes and wall history.

Publication uses the established CloudFormation backend update, paginated
compatibility dry-run/apply, and frontend release sequence. The migration adds
v8 support only when every route hold ID survives; replaced IDs are missing,
including foot-only roles. Route content and activity stay attached to the original
route IDs. See [wall-publication.md](../../docs/wall-publication.md).

Validation: archived 812-revision replay; exact source/image hash and two-ID-only
geometry comparison; frontend/backend tests, type checks and production builds;
replacement-specific migration tests; mobile current/historical-wall checks.
The production result is recorded separately after deployment verification.
