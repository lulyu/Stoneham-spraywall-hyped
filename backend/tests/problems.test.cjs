const assert = require('node:assert/strict')
const { test, beforeEach } = require('node:test')
const sdk = require('@aws-sdk/lib-dynamodb')
const holds = require('../../src/data/polygons/holds.json')

process.env.DYNAMODB_TABLE = 'test-only'
let item
let writes
let conflict
sdk.DynamoDBDocumentClient.from = () => ({
  send: async (command) => {
    const input = command.input
    switch (command.constructor.name) {
      case 'GetCommand': return { Item: item }
      case 'QueryCommand': return { Items: item ? [item] : [] }
      case 'PutCommand':
        writes.push(input)
        if (conflict || (input.ExpressionAttributeValues &&
          input.ExpressionAttributeValues[':revision'] !== item.revision)) {
          throw Object.assign(new Error('conflict'), { name: 'ConditionalCheckFailedException' })
        }
        item = input.Item
        return {}
      default: throw new Error('Unexpected database command')
    }
  },
})
const { handler } = require('../dist/test-handler.cjs')
const base = '/v1/gyms/stoneham-crg/walls/spray-wall-1/versions/2026-10-v4/problems'
const path = '/v1/problems/example'
const request = (method, url, body) => handler({
  rawPath: url,
  body: body === undefined ? undefined : JSON.stringify(body),
  isBase64Encoded: false,
  requestContext: { requestId: 'test', http: { method, path: url } },
})
const body = (response) => JSON.parse(response.body)
const roleHolds = (roles) => roles.map((role, index) => ({ holdId: holds[index].id, role }))

beforeEach(() => {
  writes = []
  conflict = false
  item = {
    id: 'example', gymId: 'stoneham-crg', wallId: 'spray-wall-1',
    wallVersionId: '2026-10-v4', name: 'Latest name', grade: 'V1', setter: 'Tester',
    holds: roleHolds(['start', 'finish', 'hold', 'foot-only']),
    createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:01:00Z',
    revision: 2, pk: 'PROBLEM#example', sk: 'META',
    gsi1pk: 'wall', gsi1sk: 'example', entityType: 'problem',
  }
})

test('create and update accept all four current roles', async () => {
  const input = { name: 'Route', grade: 'V1', setter: 'Tester', holds: item.holds }
  const created = await request('POST', base, input)
  assert.equal(created.statusCode, 201)
  assert.deepEqual(body(created).holds, input.holds)
  const updated = await request('PATCH', path, { holds: input.holds, revision: 1 })
  assert.equal(updated.statusCode, 200)
  assert.deepEqual(body(updated).holds, input.holds)
})

test('legacy hand input and stored records normalize to hold', async () => {
  const legacy = roleHolds(['start', 'finish', 'hand'])
  item.holds = legacy
  assert.equal(body(await request('GET', path)).holds[2].role, 'hold')
  assert.equal(body(await request('GET', base)).items[0].holds[2].role, 'hold')
  const result = await request('POST', base, { name: 'Legacy', grade: 'V1', setter: 'Tester', holds: legacy })
  assert.equal(result.statusCode, 201)
  assert.equal(body(result).holds[2].role, 'hold')
  assert.equal(item.holds[2].role, 'hold')
})

test('unknown roles remain invalid', async () => {
  const result = await request('PATCH', path, { revision: 2, holds: roleHolds(['start', 'finish', 'feet']) })
  assert.equal(result.statusCode, 400)
  assert.equal(writes.length, 0)
})

test('missing or invalid revisions cannot write', async () => {
  for (const revision of [undefined, null, 0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1]) {
    const result = await request('PATCH', path, { name: 'Stale edit', revision })
    assert.equal(result.statusCode, 400)
    assert.match(body(result).error, /revision/)
  }
  assert.equal(writes.length, 0)
  assert.equal(item.name, 'Latest name')
})

test('stale revision returns conflict without writing', async () => {
  const result = await request('PATCH', path, { name: 'Stale edit', revision: 1 })
  assert.equal(result.statusCode, 409)
  assert.equal(writes.length, 0)
  assert.equal(item.revision, 2)
})

test('matching revision increments once and retains conditional write', async () => {
  const result = await request('PATCH', path, { name: 'Updated', revision: 2 })
  assert.equal(result.statusCode, 200)
  assert.equal(body(result).revision, 3)
  assert.equal(item.name, 'Updated')
  assert.equal(writes[0].ConditionExpression, 'revision = :revision')
  assert.deepEqual(writes[0].ExpressionAttributeValues, { ':revision': 2 })
})

test('concurrent write conflict returns 409 without overwriting', async () => {
  conflict = true
  const result = await request('PATCH', path, { name: 'Concurrent edit', revision: 2 })
  assert.equal(result.statusCode, 409)
  assert.equal(item.name, 'Latest name')
  assert.equal(item.revision, 2)
})

test('revision alone is not an update', async () => {
  assert.equal((await request('PATCH', path, { revision: 2 })).statusCode, 400)
  assert.equal(writes.length, 0)
})
