import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

const base = process.argv[2]?.replace(/\/$/, '')
if (!base || !URL.canParse(base)) throw new Error('Usage: node scripts/smoke-api.mjs https://API_ENDPOINT')
const holds = JSON.parse(await readFile(new URL('../../src/data/polygons/holds.json', import.meta.url)))
const collection = '/v1/gyms/stoneham-crg/walls/spray-wall-1/versions/2026-10-v4/problems'
const roles = ['start', 'finish', 'hold', 'foot-only']
async function request(method, path, payload) {
  const response = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : undefined }
}

let id
try {
  assert.equal((await request('GET', '/health')).status, 200)
  const preflight = await fetch(base + collection, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://stoneham-spraywall-project.vercel.app',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
    signal: AbortSignal.timeout(20000),
  })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://stoneham-spraywall-project.vercel.app')
  const created = await request('POST', collection, {
    name: 'Deployment smoke test (temporary)', setter: 'Deployment verification', grade: 'V1',
    holds: roles.map((role, index) => ({ holdId: holds[index].id, role })),
  })
  assert.equal(created.status, 201, JSON.stringify(created))
  id = created.body.id
  assert.ok(id)
  assert.deepEqual(created.body.holds.map((hold) => hold.role), roles)
  assert.equal(created.body.revision, 1)
  const path = '/v1/problems/' + encodeURIComponent(id)
  assert.equal((await request('GET', path)).body.id, id)
  assert.equal((await request('PATCH', path, { name: 'Missing revision' })).status, 400)
  const updated = await request('PATCH', path, { name: 'Updated smoke test', revision: 1 })
  assert.equal(updated.status, 200, JSON.stringify(updated))
  assert.equal(updated.body.revision, 2)
  assert.equal((await request('PATCH', path, { name: 'Stale overwrite', revision: 1 })).status, 409)
  assert.equal((await request('GET', path)).body.name, 'Updated smoke test')
  let listed = false
  for (let attempt = 0; attempt < 6; attempt++) {
    const listing = await request('GET', collection)
    assert.equal(listing.status, 200)
    listed = listing.body.items.some((problem) => problem.id === id)
    if (listed) break
    await delay(500)
  }
  assert.ok(listed, 'Created route must appear in the wall listing')
  console.log('PASS: health, CORS preflight, four roles, create/read/list/update, missing revision 400, stale revision 409')
} finally {
  if (id) {
    const path = '/v1/problems/' + encodeURIComponent(id)
    assert.equal((await request('DELETE', path)).status, 204)
    assert.equal((await request('GET', path)).status, 404)
    console.log('PASS: temporary route deleted and confirmed absent')
  }
}
