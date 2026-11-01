# AWS connector deployment

CloudFormation is the deployment and maintenance entry point for the production
backend. The initial deployment used the connected AWS API; the commands below
provide the equivalent workflow with AWS CLI credentials.

The deployed endpoint is https://kurd8a9bz9.execute-api.us-east-1.amazonaws.com
(health: `/health`). See `production.json` for the deployed source commit,
artifact location, code hash and stack names.

Templates:
- `artifacts.json`: private encrypted, versioned S3 deployment bucket, retained
  on deletion; old noncurrent artifact versions expire after 30 days.
- `backend.json`: HTTP API, Lambda Node.js 24 (256 MB, 10-second timeout),
  least-privilege execution role, on-demand DynamoDB with GSI and PITR,
  and 14-day Lambda logs. The database is retained on deletion/replacement.

Production CORS defaults to the existing Vercel production origin. Authentication
remains outside this MVP. The frontend uses this API when `VITE_API_BASE_URL` is
configured; without that variable it uses localStorage.

## Rebuild and update

With AWS CLI credentials for the deployment account, from the repository root:

```bash
npm run typecheck --prefix backend
npm test --prefix backend
npm run build --prefix backend
```

The Lambda ZIP must contain `index.js` at its root. Package it with:

```bash
(cd backend/dist && zip /tmp/stoneham-backend-root.zip index.js)
```

Read the artifact bucket name from the artifact stack output, upload using a
new immutable key (for example `backend/<git-sha>.zip`), and update the backend
stack with that bucket/key:

```bash
aws cloudformation describe-stacks --stack-name stoneham-spraywall-artifacts --region us-east-1
aws s3 cp /tmp/stoneham-backend-root.zip s3://BUCKET/backend/GIT_SHA.zip --region us-east-1
aws cloudformation deploy --stack-name stoneham-spraywall-prod --region us-east-1 \
  --template-file infra/cloudformation/backend.json --capabilities CAPABILITY_IAM \
  --parameter-overrides ArtifactBucket=BUCKET ArtifactKey=backend/GIT_SHA.zip
aws cloudformation describe-stacks --stack-name stoneham-spraywall-prod --region us-east-1
```

Validate templates with `cfn-lint -t infra/cloudformation/artifacts.json infra/cloudformation/backend.json -r us-east-1`.
The initial deployment also used CloudFormation change sets and their
`DescribeEvents` pre-deployment validation; cfn-guard was not installed/run.

## Small-scale cost estimate

Estimate for us-east-1, excluding taxes, credits/free tiers, Vercel hosting and
unrelated account resources. This is a workload estimate, not a billing cap.

- 100 users × 10 sessions/week × 52/12 = about 4,333 sessions/month.
- 20 API requests/session = about 86,667 requests/month.
- HTTP API at $1/million: about $0.087/month.
- Lambda x86 at 256 MB and average 200 ms: about $0.090/month including
  $0.20/million invocation charges, before any free tier.
- Illustrative DynamoDB load: 90% reads averaging 10 read request units,
  10% writes averaging 4 write units per item and two copies (table + GSI).
  At $0.125/million read units and $0.625/million write units: about $0.141/month.

These request costs total roughly $0.32/month. Storage, PITR, logs, deployment
artifacts and network transfer are additional; $1–3/month is a reasonable early
planning allowance if data volumes remain small. Large polygon payloads, bigger
lists, more API calls per session, long Lambda runtimes or unexpected traffic
increase this. The canonical wall image stays on Vercel, not this API.

Pricing references:
- https://aws.amazon.com/api-gateway/pricing/
- https://aws.amazon.com/lambda/pricing/
- https://aws.amazon.com/dynamodb/pricing/on-demand/

## Live API verification

Run the smoke test against the stack's `ApiUrl` output:

```bash
node backend/scripts/smoke-api.mjs https://API_ENDPOINT
```

This creates one temporary route and deletes it in a `finally` block. It checks
CORS preflight, health, all four hold roles, CRUD/list, required revision and stale
revision rejection. In a proxy-managed Node.js 24 environment, prepend
`NODE_USE_ENV_PROXY=1` so fetch uses the environment's HTTP proxy.

The initial live test found that the API's default route forwarded OPTIONS to
Lambda, which returned 405. The handler now returns 204 for OPTIONS; API Gateway
applies the configured CORS headers.
