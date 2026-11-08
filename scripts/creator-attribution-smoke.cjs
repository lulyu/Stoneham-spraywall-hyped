const assert = require('node:assert/strict')
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const app = process.env.APP_URL || 'https://stoneham-spraywall-project.vercel.app'
const api = 'https://kurd8a9bz9.execute-api.us-east-1.amazonaws.com'

// Public reads only; profile reads may initialize the creator's missing name.
;(async () => {
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.BROWSER_PROXY?{server:process.env.BROWSER_PROXY}:undefined})
  try {
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
    if (process.env.BROWSER_FETCH_PROXY === '1') await context.route('https://**/*', async route => {
      try {
        assert(['GET','OPTIONS'].includes(route.request().method()),'Verification must make public reads only')
        await route.fulfill({response:await route.fetch()})
      } catch { await route.abort('failed').catch(()=>{}) }
    })
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(app)
    const profiles = await page.evaluate(async api => {
      const records = []; let cursor
      do {
        const response = await fetch(api+'/v1/gyms/stoneham-crg/walls/spray-wall-1/problems'+(cursor?'?cursor='+encodeURIComponent(cursor):''))
        if (!response.ok) throw Error('Route list unavailable')
        const page = await response.json(); records.push(...page.items); cursor=page.nextCursor
      } while (cursor)
      const owned = records.filter(record=>record.ownerId), results = []
      for (const route of owned) {
        const response = await fetch(api+'/v1/problems/'+encodeURIComponent(route.id)+'/creator-profile')
        if (!response.ok) throw Error('Creator profile unavailable')
        results.push({id:route.id,profile:await response.json()})
      }
      return results
    },api)
    assert(profiles.length>0,'Expected existing creator-owned routes')
    for (const {profile} of profiles) {
      assert(profile.displayName && profile.displayName !== 'Climber','Existing creator still has the generic fallback')
      assert.deepEqual(Object.keys(profile).sort(),['bio','displayName'])
    }
    const first=profiles[0],url=new URL(app);url.searchParams.set('route',first.id)
    await page.goto(url.href)
    const author=page.locator('.added-by .profile-link')
    await page.waitForFunction(name=>document.querySelector('.added-by .profile-link')?.textContent===name,first.profile.displayName)
    await author.click()
    const dialog=page.getByRole('dialog',{name:first.profile.displayName,exact:true})
    await dialog.waitFor();await dialog.getByText(first.profile.bio || 'No bio yet.',{exact:true}).waitFor()
    assert.deepEqual(errors,[])
    console.log('PASS: '+profiles.length+' real creator profiles expose names and public fields only; mobile author link and profile dialog match the API. No route writes.')
  } finally {
    for (const context of browser.contexts()) await context.unrouteAll({behavior:'ignoreErrors'})
    await browser.close()
  }
})().catch(error=>{console.error(error);process.exitCode=1})
