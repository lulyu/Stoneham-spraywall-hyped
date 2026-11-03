# MVP backend infrastructure

This branch introduces the first shared-data backend for the spray-wall app while
keeping the frontend deploy on Vercel.

## Architecture

```text
Vercel (React/Vite)
        |
        | HTTPS
        v
API Gateway HTTP API
        |
        v
Lambda (TypeScript, Node.js 24)
        |
        v
DynamoDB (single table, on-demand)
```

There is intentionally no VPC, NAT Gateway, ALB, ECS, RDS, or cache. The Lambda
uses AWS's public DynamoDB endpoint and API Gateway handles the public HTTP edge.

## Domain model

The API treats gym, wall, wall version, and problem as separate identities:

```text
Gym -> Wall -> WallVersion -> Problem
```

The initial registered wall version is:

- gym: `stoneham-crg`
- wall: `spray-wall-1`
- version: `2026-10-v4`

A reset creates a new wall version rather than mutating old routes. Adding another
wall or gym is therefore additive rather than a data migration.

`backend/walls.json` is the build-time wall catalog. The backend build reads the
canonical hold JSON for each registered wall version and generates a compact set
of valid hold IDs. Problem writes are rejected if a hold ID does not belong to the
requested wall version.

## DynamoDB key shape

Problems own their partition so future child resources can live beside them:

```text
pk = PROBLEM#<problemId>
sk = META
```

The problem metadata row also contains:

```text
gsi1pk = GYM#<gymId>#WALL#<wallId>#VERSION#<wallVersionId>
gsi1sk = PROBLEM#<createdAt>#<problemId>
```

`gsi1` provides newest-first problem listing for a wall version. Future resources
can use the same problem partition without changing the table shape, for example:

```text
sk = COMMENT#<createdAt>#<commentId>
sk = SEND#<createdAt>#<sendId>
sk = ATTEMPT#<createdAt>#<attemptId>
```

## API

```text
GET    /health
GET    /v1/gyms/{gymId}/walls/{wallId}/versions/{wallVersionId}/problems
POST   /v1/gyms/{gymId}/walls/{wallId}/versions/{wallVersionId}/problems
GET    /v1/problems/{problemId}
PATCH  /v1/problems/{problemId}
GET    /v1/me (authenticated identity)
```

Problem creation validates the wall version, grade, hold IDs, duplicate holds,
and requires at least one start and one finish. IDs and timestamps are generated
server-side. Hold roles are `start`, `finish`, `hold`, and `foot-only`.
Legacy `hand` roles are accepted and normalized to `hold` on input and when
reading existing records; responses use the current role names.

Every PATCH must include the positive integer `revision` from the last fetched
problem, for example `{"name":"Updated route","revision":2}`. Missing or invalid
revisions return 400. Stale revisions and concurrent write conflicts return 409;
reload the problem before retrying. Successful updates increment the revision.
The conditional DynamoDB write also protects against edits between read and write.

The auth branch adds Cognito access-token authorization and ownership checks.
See [auth permissions and rollout](auth.md). Anonymous reads remain public,
writes require login, and DELETE is removed. This layer is deployed; initial
real-user login verification and administrator assignment are pending.

## Build the Lambda bundle

From the repository root:

```bash
cd backend
npm ci
npm run typecheck
npm test
npm run build
```

`npm run build` regenerates `src/generated/wallCatalog.ts` from the canonical hold
files, then bundles the Lambda into `backend/dist/index.js` with esbuild.

## Deployment and maintenance

CloudFormation manages the deployed production backend in `us-east-1`.
See [deployment templates and runbook](../infra/cloudformation/README.md) for
building the Lambda package, uploading it to the private artifact bucket, and
updating the stack. Deployment records are in
[`production.json`](../infra/cloudformation/production.json).

- `stoneham-spraywall-artifacts`: private deployment package storage.
- `stoneham-spraywall-prod`: HTTP API, Lambda, IAM role, logs and DynamoDB.
- DynamoDB uses on-demand billing and has point-in-time recovery enabled.
- CloudFormation retains the database and artifact bucket on deletion/replacement.

Check the deployed API:

```bash
curl https://kurd8a9bz9.execute-api.us-east-1.amazonaws.com/health
```

Expected response:

```json
{"ok":true,"service":"stoneham-spraywall-api"}
```

Production CORS permits the stable Vercel origin. CORS is not authentication.
Vercel previews remain local-only unless explicitly configured for a separate API.

## Frontend integration

The React app selects an async `ProblemStore` using the public
`VITE_API_BASE_URL` build variable. With a URL it lists, reads, creates and edits
shared routes; without one it uses localStorage. Updates require the revision
from the last read, and conflicts retain the user's draft. Production on Vercel
uses the deployed AWS API. Previews remain local-only by default.

Local device routes can be imported explicitly without removing the originals.
See the root README for migration behavior and regression test commands.
