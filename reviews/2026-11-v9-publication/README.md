# v9 publication

The user accepted the assistant-reviewed v9 candidate and requested publication.
The immutable [review archive](../2026-11-v9-assistant-reviewed/README.md) remains
unchanged. All 852 published hold geometries are taken directly from its
replay-validated snapshot: 801 retained v8 IDs and 51 new IDs, with no identity
changes during publication. Reviewer attribution remains `assistant`.

The exact image is registered at `public/wall/versions/2026-11-v9/wall.jpg`.
v4, v7, and v8 remain available for historical routes and wall history.

## Release status

**Backend deployed and route migration complete; frontend release awaits PR #39
merge.** CloudFormation reached `UPDATE_COMPLETE`; only Lambda code and its API
integration were updated, with no resource replacements. The deployed Lambda
checksum matches the tested ZIP.

The migration scanned all pages: 11 route records, 10 compatible with v9, and one
already historical route. A separate three-page dry-run converged with zero
changes and no conflicts. Before/after consistent-read snapshots verified that
all route content, roles, owners, timestamps, and Upgrade lineage were retained,
and all 19 activity rows were byte-equivalent after normalized comparison.

See [backend-result.json](backend-result.json), [data-verification.json](data-verification.json),
and the dry-run/migration/convergence records for the evidence.

The sweep adds v9 to `supportedWallVersionIds` when every route hold survives,
including foot-only holds. It preserves route IDs, content, owners, ratings,
comments, sends, and Upgrade lineage; it does not create V2/V3 route copies.
Routes already missing holds remain historical. Publication must scan all pages,
not only the public route list. Preserve dry-run/apply/convergence results and
production verification here when the release completes.

## Preparation verification

See [validation.json](validation.json) for the completed review replay, 16 frontend
test files, 9 backend test files, 45 rescan tests, builds/typecheck, and mobile
lifecycle/Upgrade checks. [prepared-artifact.json](prepared-artifact.json) identifies
the built Lambda ZIP and checksum. It is prepared locally, not uploaded.

The earlier connection failure was resolved before any AWS mutations. The
backend used the existing CloudFormation template with previous parameters,
changing only the immutable code artifact key. Frontend deployment and its
production verification are recorded separately when the release completes.
