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
      case 'QueryCommand': return input.Select==='COUNT'?{Count:0}:{ Items: item ? [item] : [] }
      case 'TransactWriteCommand': {
        const primary=input.TransactItems.find(action=>action.Put?.Item?.sk==='META').Put
        writes.push(primary)
        if(conflict||(primary.ExpressionAttributeValues&&primary.ExpressionAttributeValues[':revision']!==item.revision))throw Object.assign(new Error('conflict'),{name:'ConditionalCheckFailedException'})
        item=primary.Item;return {}
      }
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
  requestContext: { authorizer: { jwt: { claims: { sub: 'owner' } } }, requestId: 'test', http: { method, path: url } },
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
    ownerId: 'owner', revision: 2, pk: 'PROBLEM#example', sk: 'META',
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

test('CORS preflight succeeds without accessing problem data', async () => {
  assert.equal((await request('OPTIONS', path)).statusCode, 204)
  assert.equal((await request('OPTIONS', base)).statusCode, 204)
  assert.equal(writes.length, 0)
})

test('anonymous writes fail, DELETE is unavailable, legacy records are not claimable', async () => {
  const anonymous = (method, body) => handler({ rawPath: path, body: JSON.stringify(body),
    requestContext: { requestId: 'anonymous', http: { method, path } } })
  assert.equal((await anonymous('PATCH', { revision: 2, name: 'Attack' })).statusCode, 401)
  assert.equal((await request('DELETE', path)).statusCode, 405)
  delete item.ownerId
  assert.equal((await request('PATCH', path, { revision: 2, name: 'Claim' })).statusCode, 403)
  assert.equal(writes.length, 0)
})
test('another user cannot edit; administrator can maintain unowned routes', async () => {
  item.ownerId = 'another-user'
  assert.equal((await request('PATCH', path, { revision: 2, name: 'Attack' })).statusCode, 403)
  delete item.ownerId
  const result = await handler({ rawPath: path, body: JSON.stringify({ revision: 2, name: 'Admin edit', ownerId: 'stolen' }),
    requestContext: { requestId: 'admin', http: { method: 'PATCH', path },
      authorizer: { jwt: { claims: { sub: 'admin-user', 'cognito:groups': '["admins"]' } } } } })
  assert.equal(result.statusCode, 200)
  assert.equal(item.ownerId, undefined)
})
test('body and header role claims cannot authenticate a caller', async () => {
  const result = await handler({ rawPath: base,
    headers: { authorization: 'Bearer forged', 'x-user-id': 'owner', 'x-role': 'admins' },
    body: JSON.stringify({ name: 'Forged', ownerId: 'owner', isAdmin: true }),
    requestContext: { requestId: 'attack', http: { method: 'POST', path: base } } })
  assert.equal(result.statusCode, 401)
  assert.equal(writes.length, 0)
})
test('creator is assigned server-side, never from submitted ownership', async () => {
  const created = await request('POST', base, {
    name: 'New', setter: 'Tester', grade: 'V1', holds: item.holds, ownerId: 'victim',
  })
  assert.equal(created.statusCode, 201)
  assert.equal(body(created).ownerId, 'owner')
})

test('reviewed candidate validates its own hold map and writes a separate wall partition',async()=>{
  const candidate=require('../../src/data/walls/2026-11-v7/holds.json')
  const input={name:'Candidate route',grade:'V2',setter:'Tester',holds:[{holdId:candidate[0].id,role:'start'},{holdId:candidate[1].id,role:'finish'}]}
  const created=await request('POST',base.replace('2026-10-v4','2026-11-v7'),input)
  assert.equal(created.statusCode,201)
  assert.equal(body(created).wallVersionId,'2026-11-v7')
  assert(writes[0].Item.gsi1pk.endsWith('#VERSION#2026-11-v7'))
  const candidateOnly=candidate.find(h=>!holds.some(old=>old.id===h.id))
  const invalid=await request('POST',base,{...input,holds:[{holdId:candidateOnly.id,role:'start'},{holdId:holds[0].id,role:'finish'}]})
  assert.equal(invalid.statusCode,400)
  assert.equal(writes.length,1)
})
