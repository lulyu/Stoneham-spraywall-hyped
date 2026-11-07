# Completed v7 review and main-site candidate

The user's final export is preserved byte-for-byte as
`review-progress-r805.json`. SHA-256:
`f0e9bd4a9c0d58b6460e64e0a05dc0eae35948bcde0e67cd7b0b4569f20052c7`.
It replay-validates against the immutable onsite SAM2 review baseline:
797 confirmed/refined holds, 805 history events/revisions, zero pending entries.
The reviewed JPEG hash is
`6fb57bee42af9b5b51283d79502968466cf7d25eaf0f5a6a64b3c92c22e4e72b`.

At the user's request, the derived hold map is registered as the reviewed
candidate **2026-11-v7** at `src/data/walls/2026-11-v7/`. The trial image's
original filename is retained so its bytes and existing provenance remain
unchanged. The source checkpoint still truthfully records `publishable: false`;
the user's subsequent instruction authorizes publishing the derived candidate
on the main site. Its reviewed geometry is not a model-only export.

The production gym ID is `stoneham-crg`, wall `spray-wall-1`. The original
review-session gym label `stoneham` remains untouched in the checkpoint.
The main site's wall selector exposes v4 and the reviewed candidate. V4 remains
the default and active backend version. Both versions have separate API route
partitions, local route keys, import tracking, reauthentication draft keys and
share links. Cross-version shared routes reopen their own wall before display.
Old routes are not silently displayed on the candidate even if hold IDs overlap.

Cross-wall route migration is **not implemented**. Existing device-to-cloud
imports only copy routes within their wall version. A later migration needs an
explicit old-to-new hold correspondence, removed/replaced/ambiguous handling,
and reviewed route copies with source provenance. Neither old routes nor their
activity histories are changed by adding this candidate.

Verification covers final checkpoint replay, exact image binding, separate local
and API stores, rejected cross-version updates, backend candidate-only hold
validation, mobile switching and candidate route save/reload. The backend code
release only registers the candidate; no data migration or schema change is
performed.
