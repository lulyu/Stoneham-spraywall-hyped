const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const base=process.env.APP_URL||'http://127.0.0.1:5179'
async function main(){
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.BROWSER_PROXY?{server:process.env.BROWSER_PROXY}:undefined})
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[]
  if(process.env.BROWSER_FETCH_PROXY==='1')await context.route('https://**/*',async route=>route.fulfill({response:await route.fetch()}))
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(base)
  assert.equal(await page.getByRole('combobox',{name:'Wall version',exact:true}).inputValue(),'2026-10-v4')
  const oldHolds=JSON.parse(fs.readFileSync('src/data/polygons/holds.json'))
  const old={id:'legacy-wall-route',name:'Original route',grade:'V2',setter:'Test',createdAt:new Date().toISOString(),holds:[{holdId:oldHolds[0].id,role:'start'},{holdId:oldHolds[1].id,role:'finish'}]}
  await page.evaluate(old=>localStorage.setItem('stoneham-spraywall:problems:v3',JSON.stringify([old])),old)
  await page.getByRole('combobox',{name:'Wall version',exact:true}).selectOption('2026-11-v7')
  await page.waitForURL(/wallVersion=2026-11-v7/)
  await page.locator('.wall-image').evaluate(async img=>{await img.decode();if(!img.src.endsWith('/wall/versions/2026-11-v7-seam-trial/wall.jpg'))throw Error('Wrong candidate image')})
  await page.getByRole('button',{name:'Explore routes',exact:true}).click()
  assert.equal(await page.getByText('Original route',{exact:true}).count(),0)
  await page.keyboard.press('Escape')
  if(process.env.READ_ONLY==='1'){
   assert(await page.getByRole('button',{name:'Login to set',exact:true}).isVisible())
  }else{
   await page.getByRole('button',{name:'＋ Set',exact:true}).click()
   assert.equal(await page.locator('.hold-hit-polygon').count(),797)
   assert(await page.getByRole('combobox',{name:'Wall version',exact:true}).isDisabled())
   await page.getByRole('button',{name:'START',exact:true}).tap();await page.locator('.hold-hit-polygon').nth(0).tap()
   await page.getByRole('button',{name:'FINISH',exact:true}).tap();await page.locator('.hold-hit-polygon').nth(1).tap()
   await page.getByLabel('Problem name').fill('Candidate route')
   await page.getByRole('button',{name:'Save problem',exact:true}).click()
   await page.getByRole('heading',{name:'Candidate route',exact:true}).waitFor()
   assert.equal(await page.locator('.selected-hold').count(),2)
   const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('stoneham-spraywall:problems:v3:wall:2026-11-v7')))
   assert.equal(saved[0].wallVersionId,'2026-11-v7')
   assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('stoneham-spraywall:problems:v3'))),[old])
   await page.reload();await page.getByRole('heading',{name:'Candidate route',exact:true}).waitFor()
   assert.equal(await page.locator('.selected-hold').count(),2)
  }
  for(const width of [320,390,980]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))}
  await page.setViewportSize({width:390,height:844});fs.mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/reviewed-candidate-mobile.png',fullPage:true})
  await page.getByRole('combobox',{name:'Wall version',exact:true}).selectOption('2026-10-v4')
  await page.waitForURL(url=>!url.searchParams.has('wallVersion'))
  await page.getByRole('button',{name:'Explore routes',exact:true}).click()
  if(process.env.READ_ONLY!=='1')await page.getByText('Original route',{exact:true}).waitFor()
  assert.deepEqual(errors,[])
  console.log('PASS: version switch, reviewed v7 image, separate route lists/storage, preserved v4 routes, candidate save/reload, 797 polygons and mobile layout.')
 }finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
