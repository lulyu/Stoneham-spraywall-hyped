import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApiProblemStore, createLocalProblemStore, readLocalProblems, STORAGE_KEY } from '../src/problemStore.ts'

const input = { name: 'Route', grade: 'V1', setter: 'Tester', holds: [{ holdId: 'a', role: 'start' }, { holdId: 'b', role: 'finish' }] }
const memory = () => {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}
test('local routes remain persistent and stale local edits are rejected', async () => {
  const storage = memory()
  const store = createLocalProblemStore(storage, new Set(['a', 'b']))
  const first = await store.create(input)
  assert.equal((await store.list())[0].id, first.id)
  const next = await store.update(first, { ...input, name: 'New' })
  assert.equal(next.revision, 2)
  await assert.rejects(store.update(first, input), (e) => e.status === 409)
  assert.equal((await store.get(first.id)).name, 'New')
})
test('legacy hand records normalize without erasing local originals', () => {
  const storage = memory()
  storage.setItem(STORAGE_KEY, JSON.stringify([{ ...input, id: 'old', createdAt: 'date', holds: [{ holdId: 'a', role: 'hand' }] }, null]))
  assert.equal(readLocalProblems(storage, new Set(['a']))[0].holds[0].role, 'hold')
  assert.match(storage.getItem(STORAGE_KEY), /hand/)
})
test('unavailable browser storage is safe to read and reported on save', async () => {
  const storage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  const store = createLocalProblemStore(storage, new Set(['a', 'b']))
  assert.deepEqual(await store.list(), [])
  await assert.rejects(store.create(input), /Could not save on this device/)
})
test('API uses exact collection and server IDs; updates send the fetched revision', async () => {
  const calls = []
  const server = { ...input, id: 'server-id', revision: 7, createdAt: 'date' }
  const store = createApiProblemStore('https://example.test/', async (url, options) => {
    calls.push({ url, ...options })
    return Response.json(url.endsWith('/problems') && options.method === 'GET' ? { items: [server] } : server)
  })
  assert.equal((await store.list())[0].id, 'server-id')
  assert.equal((await store.create(input)).id, 'server-id')
  await store.update(server, input)
  assert.match(calls[0].url, /2026-10-v4\/problems$/)
  assert.equal(calls[2].method, 'PATCH')
  assert.equal(JSON.parse(calls[2].body).revision, 7)
  assert.equal(JSON.parse(calls[1].body).id, undefined)
})
test('API conflict retains status and missing revisions never issue requests', async () => {
  let requests = 0
  const store = createApiProblemStore('https://example.test', async () => {
    requests++
    return Response.json({ error: 'changed' }, { status: 409 })
  })
  await assert.rejects(store.update({ ...input, id: 'id', revision: 1 }, input), (e) => e.status === 409)
  await assert.rejects(store.update({ ...input, id: 'id' }, input), /revision is missing/)
  assert.equal(requests, 1)
})
test('network failure never silently saves locally', async () => {
  const store = createApiProblemStore('https://example.test', async () => { throw new TypeError('offline') })
  await assert.rejects(store.create(input), /Your draft is still here/)
})
test('authenticated writes send the access token and unauthorized responses retain status', async () => {
  let seen
  const store = createApiProblemStore('https://example.test', async (_url, options) => {
    seen = options.headers.authorization
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }, async () => 'verified-access-token')
  await assert.rejects(store.create(input), e => e.status === 401 && /draft/.test(e.message))
  assert.equal(seen, 'Bearer verified-access-token')
})
