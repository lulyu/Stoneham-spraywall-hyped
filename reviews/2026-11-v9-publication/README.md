# v9 publication

The user accepted the assistant-reviewed v9 candidate and requested publication.
The immutable [review archive](../2026-11-v9-assistant-reviewed/README.md) remains
unchanged. All 852 published hold geometries are taken directly from its
replay-validated snapshot: 801 retained v8 IDs and 51 new IDs, with no identity
changes during publication. Reviewer attribution remains `assistant`.

The exact image is registered at `public/wall/versions/2026-11-v9/wall.jpg`.
v4, v7, and v8 remain available for historical routes and wall history.

## Release status

**Published and verified on November 22, 2026.** [PR #39](https://github.com/lulyu/Stoneham-spraywall-hyped/pull/39)
was merged, and the [production site](https://stoneham-spraywall-project.vercel.app/)
now defaults to v9. CloudFormation reached `UPDATE_COMPLETE`; only Lambda code and its API
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
Routes already missing holds remain historical. The publication sweep covered all
pages, including records not exposed by the public listing.

## Preparation verification

See [validation.json](validation.json) for the completed review replay, 16 frontend
test files, 9 backend test files, 45 rescan tests, builds/typecheck, and mobile
lifecycle/Upgrade checks. [prepared-artifact.json](prepared-artifact.json) identifies
the uploaded and deployed Lambda ZIP and checksum.

The earlier connection failure was resolved before any AWS mutations. The
backend used the existing CloudFormation template with previous parameters,
changing only the immutable code artifact key. Frontend deployment `dpl_Gt8uCGLxdzi4kEHVTvHikvqGnFQy` reached `READY`
on merge commit `a38b6dfb735120b1362b64862a68473a60c2c273`.

[Production browser verification](production-ui-verification.json) used live
public API responses and production assets without writing records. It verified
the exact published image hash, the default v9 wall, selected route polygons,
a single loaded activity panel with existing comments, and historical routes
with the old-wall warning and v7 image. Layout checks passed at 320, 390, and
980 pixels, with no page errors, duplicate-key warnings, or failed requests.
The adjacent screenshots record the mobile home, current route, and old route.
