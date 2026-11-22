# v9 publication

The user accepted the assistant-reviewed v9 candidate and requested publication.
The immutable [review archive](../2026-11-v9-assistant-reviewed/README.md) remains
unchanged. All 852 published hold geometries are taken directly from its
replay-validated snapshot: 801 retained v8 IDs and 51 new IDs, with no identity
changes during publication. Reviewer attribution remains `assistant`.

The exact image is registered at `public/wall/versions/2026-11-v9/wall.jpg`.
v4, v7, and v8 remain available for historical routes and wall history.

## Release status

**Prepared and locally verified; blocked on AWS connector availability. Production
deployment and route migration have not run.**
The version catalogs in this branch target v9. Do not merge the frontend release
until the backend has been deployed and the paginated compatibility sweep has
completed without unresolved conflicts. This file records preparation, not proof
that the live site or database has changed.

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

The AWS connector returned no usable response for read-only checks, including a
runtime check that makes no AWS API calls. The execution runtime was replaced. No
AWS mutation was submitted; restore the connection before deployment. Keep PR #39
unmerged until the backend deployment, migration, and convergence checks pass.
