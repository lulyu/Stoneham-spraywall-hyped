const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const holds = require('../src/data/polygons/holds.json')
const api = 'https://kurd8a9bz9.execute-api.us-east-1.amazonaws.com'
;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] })
  try {
    for (const role of ['guest', 'member', 'admin']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
      if (role !== 'guest') await context.addInitScript(() => sessionStorage.setItem('oidc.user:https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fvraMpcpi:537q15f8r1ppgtpucjoa5pad1r', JSON.stringify({
        access_token: 'navigation-test', token_type: 'Bearer', scope: 'openid email profile',
        profile: { sub: 'alice', name: 'Alice' }, expires_at: Math.floor(Date.now() / 1000) + 3600,
      })))
      const record = { id: 'p1', name: 'Navigation route', grade: 'V3', setter: 'Alice', ownerId: 'alice', revision: 1, createdAt: '2026-11-03', holds: [{ holdId: holds[0].id, role: 'start' }, { holdId: holds[1].id, role: 'finish' }] }
      await context.route(api + '/**', route => {
        const path = new URL(route.request().url()).pathname
        let body
        if (path === '/v1/me') body = { userId: 'alice', isAdmin: role === 'admin' }
        else if (path === '/v1/me/profile') body = { displayName: 'Alice', bio: '' }
        else if (path === '/v1/me/sends') body = { items: [] }
        else if (path.endsWith('/community')) body = { ratingAverage: null, ratingCount: 0, comments: [] }
        else if (path.endsWith('/my-activity')) body = { sent: false, rating: null }
        else if (path.endsWith('/p1')) body = record
        else body = { items: [record] }
        return route.fulfill({ json: body })
      })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', e => errors.push(e.message))
      await page.goto(process.env.APP_URL || 'http://localhost:5182')
      if (role === 'guest') await page.getByRole('button', { name: 'Login to set', exact: true }).waitFor()
      else await page.getByLabel('Account menu', { exact: true }).waitFor()
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.equal(await page.locator('.active-route').count(), 0)
      await page.getByRole('button', { name: 'Explore routes' }).click()
      const dialog = page.getByRole('dialog', { name: 'Explore routes' })
      await dialog.waitFor()
      await page.getByRole('button', { name: 'Close routes' }).click()
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(await page.getByRole('button', { name: 'Explore routes' }).evaluate(el => el === document.activeElement), true)
      await page.getByRole('button', { name: 'Explore routes' }).click()
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      await page.getByRole('button', { name: 'Explore routes' }).click()
      await page.mouse.click(5, 400)
      await dialog.waitFor({ state: 'hidden' })
      await page.getByRole('button', { name: 'Explore routes' }).click()
      await dialog.locator('.problem-card').click()
      await dialog.waitFor({ state: 'hidden' })
      await page.getByRole('region', { name: 'Selected route', exact: true }).waitFor()
      assert.equal(await page.locator('.route-gray-layer').count(), 1)
      const activity = page.getByRole('region', { name: 'Route activity', exact: true })
      await activity.getByRole('heading', { name: 'Navigation route', exact: true }).waitFor()
      const activityBox = await activity.boundingBox()
      assert(activityBox.y < 844, 'route activity must begin within the mobile viewport')
      await page.getByRole('link', { name: 'Send · Rate · Comments' }).click()
      await activity.getByRole('heading', { name: 'Comments', exact: true }).waitFor()
      if (role !== 'guest') {
        await activity.getByRole('button', { name: 'Log send', exact: true }).waitFor()
        await activity.getByRole('group', { name: 'Rate this route' }).waitFor()
      }
      await page.screenshot({ path: 'artifacts/wall-route-activity-' + role + '.png' })
      await page.getByRole('button', { name: 'Fit wall', exact: true }).click()
      if (role !== 'guest') {
        await page.getByLabel('Account menu', { exact: true }).click()
        assert.equal(await page.getByText('Polygon debug', { exact: true }).count(), role === 'admin' ? 1 : 0)
        if (role === 'admin') {
          await page.getByText('Polygon debug', { exact: true }).click()
          await page.getByLabel('Show all polygons', { exact: true }).check()
          assert.equal(await page.locator('.debug-polygon').count(), 677)
        }
        await page.getByRole('button', { name: 'Profile · Alice', exact: true }).click()
        await page.getByRole('region', { name: 'Your sends' }).waitFor()
        // Return to the wall before entering the route editor.
        await page.getByRole('button', { name: 'Back to wall', exact: true }).click()
        await page.getByRole('button', { name: '＋ Set', exact: true }).click()
        await page.getByRole('group', { name: 'Hold role' }).waitFor()
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      } else assert.equal(await page.getByText('Polygon debug', { exact: true }).count(), 0)
      for (const width of [320, 390, 680, 980]) {
        await page.setViewportSize({ width, height: 844 })
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow ' + width)
      }
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('button', { name: 'Clear selected route', exact: true }).click()
      if (role === 'guest') {
        await page.screenshot({ path: 'artifacts/wall-home-mobile.png' })
        await page.getByRole('button', { name: 'Explore routes' }).click()
        await page.locator('.routes-drawer').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)))
        await page.screenshot({ path: 'artifacts/wall-routes-mobile.png' })
      }
      assert.deepEqual(errors, [])
      await context.close()
    }
    console.log('PASS: guest/member/admin navigation, drawer focus/Escape/backdrop, route selection, profile, editor, admin-only polygons and 320–980px layout')
  } finally { await browser.close() }
})().catch(e => { console.error(e); process.exitCode = 1 })
