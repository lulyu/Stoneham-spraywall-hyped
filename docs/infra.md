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
DELETE /v1/problems/{problemId}
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

Authentication is deliberately not part of this first backend. Do not put an API
secret in the Vite app. When identity becomes useful, API Gateway can gain a JWT
authorizer (for example Cognito) without changing problem IDs or table keys.

## Build the Lambda bundle

From the repository root:

```bash
cd backend
npm install
npm run typecheck
npm test
npm run build
```

`npm run build` regenerates `src/generated/wallCatalog.ts` from the canonical hold
files, then bundles the Lambda into `backend/dist/index.js` with esbuild.

## Provision dev

Terraform workspaces keep dev and prod state separate. Do not apply from the
`default` workspace; the configuration rejects it.

```bash
cd infra
terraform init
terraform workspace new dev       # first time only
# or: terraform workspace select dev
terraform fmt -check
terraform validate
terraform plan  -var-file=env/dev.tfvars
terraform apply -var-file=env/dev.tfvars
```

Then:

```bash
curl "$(terraform output -raw api_url)/health"
```

Expected response:

```json
{"ok":true,"service":"stoneham-spraywall-api"}
```

The dev API currently allows browser requests from any origin because it is an
anonymous, non-sensitive prototype. Production tfvars restrict browser CORS to the
stable Vercel domain. CORS is not used as authentication.

## Production

A separate `prod` Terraform workspace and `env/prod.tfvars` are provided, with
DynamoDB point-in-time recovery enabled. Before treating production data as
important, move Terraform state to a remote backend (S3 with locking/versioning or
Terraform Cloud) instead of relying on local state.

## Frontend integration next

The current React app remains localStorage-backed on this branch. The next step is
to introduce a small `ProblemStore` interface with two implementations:

- `LocalProblemStore` for offline/local UI work
- `ApiProblemStore` when `VITE_API_BASE_URL` is configured

That keeps UI development independent from AWS and makes Vercel Preview -> dev API
and Vercel Production -> prod API wiring straightforward.
