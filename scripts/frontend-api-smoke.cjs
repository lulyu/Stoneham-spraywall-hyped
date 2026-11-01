const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const holds = require('../src/data/polygons/holds.json')
const api = 'https://kurd8a9bz9.execute-api.us-east-1.amazonaws.com'
const roles = ['start', 'finish', 'hold', 'foot-only']
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    let records = [], offline = false, conflict = false, listFailure = false
    await context.route(api + '/**', async route => {
      const request = route.request(), method = request.method()
      const path = new URL(request.url()).pathname
      if (offline && method === 'POST') return route.abort('failed')
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': '*' }
      const send = (status, body) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) })
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
      if (method === 'GET' && path.endsWith('/problems')) return send(listFailure ? 500 : 200, listFailure ? { error: 'Temporarily unavailable' } : { items: records })
      if (method === 'POST') {
        await delay(200)
        const record = { ...request.postDataJSON(), id: 'remote-' + (records.length + 1), createdAt: new Date().toISOString(), revision: 1 }
        records.unshift(record)
        return send(201, record)
      }
      const id = path.split('/').at(-1)
      const record = records.find(r => r.id === id)
      if (method === 'GET') return send(record ? 200 : 404, record || { error: 'Not found' })
      if (method === 'PATCH') {
        if (conflict) return send(409, { error: 'Changed by another editor' })
        const patch = request.postDataJSON()
        assert.equal(patch.revision, record.revision)
        Object.assign(record, patch, { revision: record.revision + 1 })
        return send(200, record)
      }
      throw new Error('Unexpected API request: ' + method + ' ' + path)
    })
    await page.addInitScript(({ holds }) => {
      if (localStorage.getItem('seeded')) return
      localStorage.setItem('seeded', 'yes')
      localStorage.setItem('stoneham-spraywall:problems:v3', JSON.stringify([{
        id: 'local-old', name: 'Local original', grade: 'V1', setter: 'Tester', createdAt: '2026-11-01',
        holds: ['start', 'finish', 'hand'].map((role, i) => ({ holdId: holds[i].id, role }))
      }]))
    }, { holds })
    await page.goto(process.env.APP_URL || 'http://localhost:5174')
    await page.getByText('SHARED WALL', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Import local problems', exact: true }).click()
    await page.getByText('Local original', { exact: true }).waitFor()
    assert.equal(records.length, 1)
    assert.equal(records[0].holds[2].role, 'hold')
    assert.equal(await page.getByRole('button', { name: 'Import local problems', exact: true }).count(), 0)
    await page.reload()
    await page.getByText('Local original', { exact: true }).waitFor()
    assert.equal(records.length, 1)
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('stoneham-spraywall:problems:v3'))[0].id), 'local-old')

    await page.getByRole('button', { name: '＋ Set', exact: true }).click()
    const group = page.getByRole('group', { name: 'Hold role' })
    for (const [i, role] of ['START', 'FINISH', 'HOLD', 'FOOT-ONLY'].entries()) {
      await group.getByRole('button', { name: role, exact: true }).tap()
      await page.locator('.hold-hit-polygon').nth(i).tap()
    }
    await page.getByLabel('Problem name').fill('Shared mobile route')
    await page.getByRole('button', { name: 'Save problem', exact: true }).click()
    await page.getByText('Shared mobile route', { exact: true }).waitFor()
    assert.deepEqual(records[0].holds.map(h => h.role), roles)
    assert.equal(await page.locator('.selected-hold').count(), 4)
    await page.reload()
    await page.getByText('Shared mobile route', { exact: true }).click()
    await page.getByRole('button', { name: 'Edit problem', exact: true }).click()
    await page.getByLabel('Problem name').fill('Edited shared route')
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page.getByText('Edited shared route', { exact: true }).waitFor()
    assert.equal(records[0].revision, 2)

    await page.getByRole('button', { name: 'Edit problem', exact: true }).click()
    await page.getByLabel('Problem name').fill('Preserved conflicting draft')
    conflict = true
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Someone else updated' }).waitFor()
    assert.equal(await page.getByLabel('Problem name').inputValue(), 'Preserved conflicting draft')
    assert.equal(await page.locator('.selected-hold').count(), 4)
    await page.getByRole('button', { name: 'Keep draft as new problem', exact: true }).click()
    conflict = false
    offline = true
    await page.getByRole('button', { name: 'Save problem', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Could not reach' }).waitFor()
    assert.equal(await page.locator('.selected-hold').count(), 4)
    offline = false
    await page.getByRole('button', { name: 'Save problem', exact: true }).click()
    await page.getByText('Preserved conflicting draft (copy)', { exact: true }).waitFor()
    assert.equal(records.length, 3)

    listFailure = true
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Temporarily unavailable' }).waitFor()
    assert.equal(await page.locator('.problem-card').count(), 3)
    listFailure = false
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor()
    for (const width of [320, 390, 680, 980]) {
      await page.setViewportSize({ width, height: 844 })
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow at ' + width)
    }
    const second = await context.newPage()
    await second.goto(process.env.APP_URL || 'http://localhost:5174')
    await second.getByText('Edited shared route', { exact: true }).waitFor()
    assert.deepEqual(errors, [])
    console.log('PASS: mobile four-role save, API reload/read/edit, revision conflict, draft retention on network error, retry, local import without repeat, list recovery, second page and 320–980px layout')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
