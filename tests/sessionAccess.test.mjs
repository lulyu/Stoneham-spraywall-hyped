import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSessionAccess } from '../src/sessionAccess.ts'
import { storeRecoveryDraft, readRecoveryDraft } from '../src/draftRecovery.ts'
import { onSessionEvent } from '../src/sessionEvents.ts'
import { createApiProblemStore } from '../src/problemStore.ts'

test('valid tokens skip renewal and expired parallel calls share one renewal', async () => {
  let current = { access_token: 'valid', expired: false }, calls = 0
  let resolve
  const pending = new Promise(r => { resolve = r })
  const manager = { getUser: async () => current, signinSilent: async () => { calls++; return pending } }
  const access = createSessionAccess(manager, () => assert.fail('must not expire'))
  assert.equal(await access.token(), 'valid')
  current = { access_token: 'old', expired: true }
  const a = access.token(), b = access.token()
  await new Promise(r => setImmediate(r))
  assert.equal(calls, 1)
  resolve({ access_token: 'fresh', expired: false })
  assert.deepEqual(await Promise.all([a,b]), ['fresh','fresh'])
})
test('failed renewal reports expiry instead of presenting an authenticated session', async () => {
  let expired = 0
  const access = createSessionAccess({ getUser: async () => ({ access_token:'old', expired:true }), signinSilent: async () => { throw new Error('offline') } }, () => expired++)
  assert.equal(await access.token(), undefined)
  assert.equal(expired, 1)
})
test('401 invalidates an otherwise unexpired token and a renewed session can recover', async () => {
  let calls = 0
  const access = createSessionAccess({ getUser: async () => ({ access_token:'rejected',expired:false }), signinSilent: async () => { calls++; return { access_token:'renewed',expired:false } } }, () => assert.fail())
  access.invalidate()
  assert.equal(await access.token(), 'renewed')
  assert.equal(calls, 1)
})
test('signed-out users never launch silent login; blocked storage fails safely', async () => {
  const access = createSessionAccess({ getUser: async () => null, signinSilent: async () => assert.fail() }, () => assert.fail())
  assert.equal(await access.token(), undefined)
  let notified = false
  const blocked = createSessionAccess({ getUser: async () => { throw new Error('blocked') }, signinSilent: async () => assert.fail() }, () => { notified = true })
  assert.equal(await blocked.token(), undefined)
  assert(notified)
})
test('API 401 broadcasts session expiry', async () => {
  const events = []
  const off = onSessionEvent(e => events.push(e))
  try {
    const store = createApiProblemStore('https://example.test', async () => Response.json({}, {status:401}))
    await assert.rejects(store.create({name:'Draft'}), e => e.status===401)
    assert.deepEqual(events,['expired'])
  } finally { off() }
})
test('reauth draft recovery binds to the account and preserves the original edit revision', () => {
  let raw = null
  const storage = { getItem: () => raw, setItem: (_key,value) => { raw=value } }
  const draft = { userId:'alice', name:'Work in progress',grade:'V4',setter:'Guest setter',draft:[{holdId:'a',role:'start'}],editing:{id:'route',revision:2} }
  storeRecoveryDraft(storage,draft)
  assert.deepEqual(readRecoveryDraft(storage,'alice',new Set(['a'])),draft)
  assert.equal(readRecoveryDraft(storage,'bob',new Set(['a'])),null)
  assert.equal(readRecoveryDraft(storage,'alice',new Set(['different'])),null)
  raw = JSON.stringify({...JSON.parse(raw),storedAt:Date.now()-86400001})
  assert.equal(readRecoveryDraft(storage,'alice',new Set(['a'])),null)
  raw = '{invalid'
  assert.equal(readRecoveryDraft(storage,'alice',new Set(['a'])),null)
})
