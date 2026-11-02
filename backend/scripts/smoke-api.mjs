import assert from 'node:assert/strict'

const base = process.argv[2]?.replace(/\/$/, '')
if (!base || !URL.canParse(base)) throw new Error('Usage: node scripts/smoke-api.mjs https://API_ENDPOINT')
const collection = '/v1/gyms/stoneham-crg/walls/spray-wall-1/versions/2026-10-v4/problems'
const nonexistent = '/v1/problems/security-smoke-' + crypto.randomUUID()
async function request(method, path, payload, extraHeaders = {}) {
  const response = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...extraHeaders },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  })
  return response.status
}
// Invalid bodies and a unique nonexistent ID avoid altering real records even
// if authorization regresses. This smoke test never supplies user credentials.
assert.equal(await request('GET', '/health'), 200)
assert.equal(await request('GET', collection), 200)
assert.equal(await request('GET', '/v1/me'), 401)
for (const method of ['GET', 'PATCH']) {
  assert.equal(await request(method, '/v1/me/profile', method === 'PATCH' ? {} : undefined), 401)
}
assert.equal(await request('POST', collection, {}), 401)
assert.equal(await request('POST', collection, {}, { authorization: 'Bearer forged' }), 401)
assert.equal(await request('PATCH', nonexistent, {}), 401)
assert.equal(await request('DELETE', nonexistent), 405)
const preflight = await fetch(base + collection, {
  method: 'OPTIONS',
  headers: {
    origin: 'https://stoneham-spraywall-project.vercel.app',
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'content-type,authorization',
  },
  signal: AbortSignal.timeout(20000),
})
assert.equal(preflight.status, 204)
assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://stoneham-spraywall-project.vercel.app')
console.log('PASS: public reads, anonymous/forged write rejection, private profiles, disabled DELETE and CORS; no records created')
