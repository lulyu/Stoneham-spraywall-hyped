const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const holds = require('../src/data/polygons/holds.json')

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    page.setDefaultTimeout(10000)
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(process.env.APP_URL || 'http://127.0.0.1:4174')
    await page.evaluate(ids => localStorage.setItem('stoneham-spraywall:problems:v3', JSON.stringify([{
      id: 'legacy-test', name: 'Legacy hand route', setter: 'Tester', grade: 'V1', createdAt: '2026-11-01T00:00:00Z',
      holds: [{ holdId: ids[0], role: 'hand' }, { holdId: ids[1], role: 'finish' }],
    }])), [holds[0].id, holds[1].id])
    await page.reload()
    await page.getByText('Legacy hand route', { exact: true }).click()
    assert.equal(await page.locator('.selected-hold.role-hold').count(), 1)
    assert.equal(await page.locator('.selected-hold.role-hand').count(), 0)
    await page.getByRole('button', { name: '＋ Set', exact: true }).tap()
    const roles = page.getByRole('group', { name: 'Hold role' })
    assert.deepEqual(await roles.getByRole('button').allTextContents(), ['START', 'FINISH', 'HOLD', 'FOOT-ONLY'])
    assert.equal(await roles.getByRole('button', { name: 'HOLD', exact: true }).getAttribute('aria-pressed'), 'true')
    for (const [index, role] of ['START', 'FINISH', 'HOLD', 'FOOT-ONLY'].entries()) {
      await roles.getByRole('button', { name: role, exact: true }).tap()
      await page.locator('.hold-hit-polygon').nth(index).tap()
      await page.getByText(`${index + 1} selected`, { exact: true }).waitFor()
    }
    for (const role of ['start', 'finish', 'hold', 'foot-only']) assert.equal(await page.locator(`.selected-hold.role-${role}`).count(), 1)
    assert.equal(await page.locator('.selected-rainbow').count(), 4)
    assert.equal(await page.locator('linearGradient animateTransform').count(), 1)
    assert(Number.parseFloat(await page.locator('.selected-hold').first().evaluate(e => getComputedStyle(e).strokeWidth)) >= 10)
    const before = await page.locator('.selected-rainbow').first().evaluate(e => getComputedStyle(e).strokeDashoffset)
    await page.waitForFunction(previous => getComputedStyle(document.querySelector('.selected-rainbow')).strokeDashoffset !== previous, before)
    const gradientBefore = await page.locator('linearGradient').evaluate(g => g.gradientTransform.animVal.getItem(0).matrix.a)
    await page.waitForFunction(previous => document.querySelector('linearGradient').gradientTransform.animVal.getItem(0).matrix.a !== previous, gradientBefore)
    // Changing an existing hold role does not duplicate it; tapping the same role removes it.
    await roles.getByRole('button', { name: 'HOLD', exact: true }).tap()
    await page.locator('.hold-hit-polygon').nth(0).tap()
    assert.equal(await page.locator('.selected-hold.role-hold').count(), 2)
    await page.locator('.hold-hit-polygon').nth(0).tap()
    await page.getByText('3 selected', { exact: true }).waitFor()
    await roles.getByRole('button', { name: 'START', exact: true }).tap()
    await page.locator('.hold-hit-polygon').nth(0).tap()
    await page.getByText('4 selected', { exact: true }).waitFor()
    for (const width of [320, 390, 680]) {
      await page.setViewportSize({ width, height: 844 })
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      for (const button of await roles.getByRole('button').all()) {
        const bounds = await button.boundingBox()
        assert(bounds.width > 0 && bounds.height >= 44)
      }
    }
    await page.setViewportSize({ width: 390, height: 844 })
    fs.mkdirSync('artifacts', { recursive: true })
    await page.screenshot({ path: 'artifacts/hold-roles-rainbow-mobile.png', fullPage: true })
    await page.getByLabel('Problem name').fill('Four-role route')
    await page.getByRole('button', { name: 'Save problem', exact: true }).click()
    await page.getByText('Four-role route', { exact: true }).waitFor()
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('stoneham-spraywall:problems:v3')))
    assert.deepEqual(stored[0].holds.map(h => h.role).sort(), ['finish', 'foot-only', 'hold', 'start'])
    assert.equal(stored.find(p => p.id === 'legacy-test').holds[0].role, 'hold')
    await page.reload()
    await page.getByText('Four-role route', { exact: true }).click()
    assert.equal(await page.locator('.selected-hold.role-foot-only').count(), 1)
    // Respect reduced motion and react to preference changes without a reload.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForFunction(() => !document.querySelector('linearGradient animateTransform'))
    assert.equal(await page.locator('.selected-rainbow').first().evaluate(e => getComputedStyle(e).animationName), 'none')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.waitForFunction(() => !!document.querySelector('linearGradient animateTransform'))
    assert.deepEqual(errors, [])
    console.log('PASS: four roles, foot-only persistence, legacy hand migration, reassignment/toggle, thicker rainbow motion, reduced-motion fallback and 320px touch layout')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
