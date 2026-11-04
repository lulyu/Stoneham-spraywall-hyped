const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const holds = require('../src/data/polygons/holds.json')
const api = 'https://kurd8a9bz9.execute-api.us-east-1.amazonaws.com'
const app = process.env.APP_URL || 'http://localhost:5182'
;(async () => {
 const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'], proxy: process.env.BROWSER_PROXY ? { server: process.env.BROWSER_PROXY } : undefined })
 try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => {
   if (window.denyCopy) throw new Error('Clipboard blocked')
   window.copiedRouteLink = text
  } } }))
  const record = id => ({ id, name: id === 'older' ? 'Older shared route' : 'Newest route', grade: 'V4', setter: 'Tester', createdAt: '2026-11-04', holds: [{ holdId: holds[0].id, role: 'start' }, { holdId: holds[1].id, role: 'finish' }] })
  let failOlder = false, releaseList, delayList = false, olderRequests = 0
  await context.route(api + '/**', async route => {
   const path = new URL(route.request().url()).pathname
   if (path.endsWith('/versions/2026-10-v4/problems')) {
    if (delayList) { delayList = false; await new Promise(resolve => { releaseList = resolve }) }
    return route.fulfill({ json: { items: [record('new')] } })
   }
   if (path.endsWith('/community')) return route.fulfill({ json: { ratingAverage: null, ratingCount: 0, comments: [] } })
   if (path.endsWith('/older')) {
    olderRequests++
    return failOlder ? route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }) : route.fulfill({ json: record('older') })
   }
   if (path.endsWith('/new')) return route.fulfill({ json: record('new') })
   return route.fulfill({ status: 404, json: { error: 'This route does not exist.' } })
  })
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(app)
  await page.getByRole('button', { name: 'Explore routes' }).click()
  await page.locator('.problem-card').click()
  await page.evaluate(() => history.replaceState({}, '', '?route=new&tracking=ignore#route-activity'))
  await page.getByRole('button', { name: 'Copy route link', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Link copied' }).waitFor()
  const copied = await page.evaluate(() => window.copiedRouteLink)
  assert.equal(new URL(copied).search, '?route=new')
  assert.equal(new URL(copied).hash, '')
  const direct = await context.newPage()
  await direct.goto(copied)
  await direct.getByRole('region', { name: 'Selected route', exact: true }).getByRole('heading', { name: 'Newest route', level: 2 }).waitFor()
  assert.equal(await direct.locator('.route-gray-layer').count(), 1)
  // The shared route is outside the first list page; a late list response must not clear it.
  delayList = true
  await direct.goto(app + '/?route=older')
  const selection = direct.getByRole('region', { name: 'Selected route', exact: true })
  await selection.getByRole('heading', { name: 'Older shared route', exact: true, level: 2 }).waitFor()
  while (!releaseList) await new Promise(resolve => setTimeout(resolve, 10))
  releaseList()
  await direct.getByRole('button', { name: 'Explore routes' }).click()
  await direct.getByRole('button', { name: 'Refresh', exact: true }).click()
  await direct.getByRole('button', { name: 'Refresh', exact: true }).waitFor()
  await direct.getByRole('button', { name: 'Close routes', exact: true }).click()
  await selection.getByRole('heading', { name: 'Older shared route', exact: true, level: 2 }).waitFor()
  await direct.evaluate(() => { window.denyCopy = true })
  await direct.getByRole('button', { name: 'Copy route link', exact: true }).click()
  assert.equal(new URL(await direct.getByLabel('Route link', { exact: true }).inputValue()).search, '?route=older')
  await direct.getByRole('button', { name: 'Clear selected route', exact: true }).click()
  assert.equal(new URL(direct.url()).searchParams.has('route'), false)
  assert.equal(await direct.getByLabel('Route link', { exact: true }).count(), 0)
  await direct.goto(app + '/?route=missing')
  await direct.getByRole('alert').filter({ hasText: 'This route does not exist.' }).waitFor()
  await direct.getByRole('button', { name: 'Dismiss', exact: true }).click()
  assert.equal(new URL(direct.url()).searchParams.has('route'), false)
  failOlder = true
  await direct.goto(app + '/?route=older')
  await direct.getByRole('alert').filter({ hasText: 'Temporarily unavailable' }).waitFor()
  failOlder = false
  await direct.getByRole('button', { name: 'Retry shared route', exact: true }).click()
  await selection.getByRole('heading', { name: 'Older shared route', exact: true, level: 2 }).waitFor()
  assert(olderRequests >= 3)
  const authority='https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fvraMpcpi'
  const domain='https://stoneham-spraywall-prod-010257981603.auth.us-east-1.amazoncognito.com'
  await context.route(authority+'/.well-known/openid-configuration', route => route.fulfill({ json: {
    issuer:authority, authorization_endpoint:domain+'/oauth2/authorize', token_endpoint:domain+'/oauth2/token', jwks_uri:authority+'/.well-known/jwks.json',
  } }))
  await context.route(domain+'/oauth2/authorize**', route => route.fulfill({ contentType:'text/html', body:'<p>Mock Google sign in</p>' }))
  await direct.getByRole('button', { name: 'Login to set', exact: true }).click()
  await direct.waitForURL(url => url.hostname === new URL(domain).hostname)
  // OIDC stores caller state on the app origin before redirecting.
  await page.goto(app)
  const stateId=new URL(direct.url()).searchParams.get('state')
  // OIDC state uses localStorage by default; return to the app origin to inspect it.
  await direct.goto(app)
  const loginState=await direct.evaluate(id => JSON.parse(localStorage.getItem('oidc.'+id)), stateId)
  assert.equal(loginState.data.routeId,'older')
  assert.deepEqual(errors, [])
  console.log('PASS: clipboard copy, fresh anonymous deep link, route outside page one, late list/refresh preservation, denied clipboard fallback, missing route and failed-link retry')
 } finally { await browser.close() }
})().catch(e => { console.error(e); process.exitCode = 1 })
