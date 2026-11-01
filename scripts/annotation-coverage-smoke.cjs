const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const dataset = require('../src/data/annotations/full_wall_manual_v4.json')
async function main() {
  const base = process.env.APP_URL || 'http://127.0.0.1:8788'
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'], proxy: base.startsWith('https:') && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined })
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const page = await context.newPage(); page.setDefaultTimeout(30000)
    const errors = []; const writes = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()) })
    // Use the exact supplied snapshot without replacing any live server storage.
    await page.route('**/api/sam2/annotations', route => route.fulfill({ json: dataset }))
    const suggestionsLoaded = page.waitForResponse(response => response.url().endsWith('/api/sam2/suggestions') && response.ok())
    if (process.env.ANNOTATOR_KEY_FILE) await page.goto(`${base}/auth?key=${encodeURIComponent(fs.readFileSync(process.env.ANNOTATOR_KEY_FILE, 'utf8').trim())}`)
    else await page.goto(`${base}/?annotate=1`)
    await page.getByText(/SAM2.1 Small ready/).waitFor({ timeout: 60000 })
    await page.getByRole('heading', { name: 'Accepted holds (677)', exact: true }).waitFor()
    await (await suggestionsLoaded).finished()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.locator('.annotation-covered').count(), 0)
    const suggestionsBefore = await page.locator('.annotation-suggestion').count()
    await page.getByRole('button', { name: 'Cover confirmed holds', exact: true }).click()
    await page.getByText(/677 confirmed holds covered/).waitFor()
    assert.equal(await page.locator('.annotation-covered').count(), 677)
    assert.equal(await page.locator('.annotation-suggestion').count(), 0)
    const neutral = await page.locator('.annotation-covered').evaluateAll(polygons => polygons.every(polygon => {
      const values = getComputedStyle(polygon).fill.match(/\d+/g).map(Number)
      return Math.max(...values) - Math.min(...values) < 36 && getComputedStyle(polygon).stroke === 'none'
    }))
    assert(neutral)
    await page.locator('.annotation-viewport').scrollIntoViewIfNeeded()
    fs.mkdirSync('artifacts', { recursive: true })
    await page.screenshot({ path: 'artifacts/annotation-coverage-mobile.png' })
    await page.getByRole('button', { name: 'Show original holds', exact: true }).click()
    assert.equal(await page.locator('.annotation-covered').count(), 0)
    assert.equal(await page.locator('.annotation-suggestion').count(), suggestionsBefore)
    assert.deepEqual(writes, [])
    assert.deepEqual(errors, [])
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    console.log('PASS: 677-hold wall-color cover, neutral fills, original restore, suggestion restore, no saved-data writes, phone layout')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
