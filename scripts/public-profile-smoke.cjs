const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const holds = require('../src/data/polygons/holds.json')
const api = 'https://kurd8a9bz9.execute-api.us-east-1.amazonaws.com'
;(async () => {
 const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'], proxy: process.env.BROWSER_PROXY ? { server: process.env.BROWSER_PROXY } : undefined })
 try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const records=['owned','legacy'].map(id => ({id,name:id==='owned'?'Preach it':'Old route',grade:'V6',setter:'Mu',...(id==='owned'?{ownerId:'creator-account'}:{}),createdAt:'2026-11-04',holds:[{holdId:holds[0].id,role:'start'},{holdId:holds[1].id,role:'finish'}]}))
  const bio='Loves climbing.\n<img src=x onerror="throw 1">'
  let failAuthor=true,emptyBio=false
  await context.route(api+'/**',route=>{
   const path=new URL(route.request().url()).pathname
   const send=(status,body)=>route.fulfill({status,json:body})
   if(path.endsWith('/creator-profile')){
    assert.equal(route.request().headers().authorization,undefined)
    return send(200,{displayName:'Lu',bio:emptyBio?'':bio})
   }
   if(path.endsWith('/author-profile')){
    assert.equal(route.request().headers().authorization,undefined)
    if(failAuthor){failAuthor=false;return send(503,{error:'Temporary failure'})}
    return send(200,{displayName:'Bob',bio:'Learning footwork.'})
   }
   if(path.endsWith('/community'))return send(200,{ratingAverage:null,ratingCount:0,comments:[{id:'c1',author:'Bob',hasAuthorProfile:true,text:'Great route',createdAt:'2026-11-04'},{id:'c2',author:'Old comment author',text:'Legacy comment',createdAt:'2026-11-04'}]})
   if(path.endsWith('/problems'))return send(200,{items:records})
   const record=records.find(r=>path.endsWith('/'+r.id))
   return record?send(200,record):send(404,{error:'Not found'})
  })
  const page=await context.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(process.env.APP_URL||'http://localhost:5182')
  await page.getByRole('button',{name:'Explore routes'}).click()
  await page.locator('.problem-card').filter({hasText:'Preach it'}).click()
  const creator=page.getByRole('button',{name:'View profile: Lu',exact:true})
  await creator.waitFor()
  assert((await page.locator('.route-attribution').textContent()).includes('V6 · Mu'))
  assert((await page.locator('.route-attribution').textContent()).includes('added by Lu'))
  await creator.click()
  const dialog=page.getByRole('dialog',{name:'Lu',exact:true})
  await dialog.getByText(bio,{exact:true}).waitFor()
  assert.equal(await dialog.locator('img').count(),0)
  await dialog.getByRole('button',{name:'Close profile',exact:true}).click()
  assert.equal(await creator.evaluate(el=>el===document.activeElement),true)
  await creator.click()
  await page.keyboard.press('Escape')
  await dialog.waitFor({state:'hidden'})
  await creator.click()
  await page.mouse.click(5,50)
  await dialog.waitFor({state:'hidden'})
  const commenter=page.getByRole('button',{name:'View profile: Bob',exact:true})
  await commenter.click()
  const bob=page.getByRole('dialog',{name:'Bob',exact:true})
  await bob.getByRole('alert').waitFor()
  await bob.getByRole('button',{name:'Retry profile',exact:true}).click()
  await bob.getByText('Learning footwork.',{exact:true}).waitFor()
  await bob.getByRole('button',{name:'Close profile',exact:true}).click()
  assert.equal(await page.getByRole('button',{name:'View profile: Old comment author',exact:true}).count(),0)
  emptyBio=true
  await creator.click()
  await dialog.getByText('No bio yet.',{exact:true}).waitFor()
  for(const width of [320,390,680,980]){
   await page.setViewportSize({width,height:844})
   const box=await dialog.boundingBox()
   assert(box.x>=0&&box.x+box.width<=width,'dialog overflow '+width)
  }
  await dialog.getByRole('button',{name:'Close profile',exact:true}).click()
  await page.getByRole('button',{name:'Explore routes'}).click()
  await page.locator('.problem-card').filter({hasText:'Old route'}).click()
  await page.getByRole('region',{name:'Selected route',exact:true}).getByRole('heading',{level:2,name:'Old route'}).waitFor()
  assert.equal(await page.locator('.added-by').count(),0)
  assert.deepEqual(errors,[])
  console.log('PASS: actual creator differs from setter, public creator/comment bio dialogs, no-bio fallback, literal text, focus/Escape/backdrop, failed-load retry, legacy attribution and 320–980px layouts')
 } finally { await browser.close() }
})().catch(e=>{console.error(e);process.exitCode=1})
