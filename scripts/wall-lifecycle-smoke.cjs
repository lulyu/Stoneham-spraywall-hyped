const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const fs=require('node:fs'),assert=require('node:assert/strict')
const old=require('../src/data/polygons/holds.json'),fresh=require('../src/data/walls/2026-11-v7/holds.json')
const ids=new Set(fresh.map(h=>h.id)),shared=old.filter(h=>ids.has(h.id)),missing=old.find(h=>!ids.has(h.id))
const api='https://kurd8a9bz9.execute-api.us-east-1.amazonaws.com'
const app=process.env.APP_URL||'http://127.0.0.1:5181'
async function main(){
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.BROWSER_PROXY?{server:process.env.BROWSER_PROXY}:undefined})
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
  if(process.env.BROWSER_FETCH_PROXY==='1')await context.route('https://**/*',async route=>{try{await route.fulfill({response:await route.fetch()})}catch{await route.abort('failed').catch(()=>{})}})
  await context.addInitScript(()=>sessionStorage.setItem('oidc.user:https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fvraMpcpi:537q15f8r1ppgtpucjoa5pad1r',JSON.stringify({access_token:'lifecycle-test-token',token_type:'Bearer',scope:'openid email profile stoneham-api/write',profile:{sub:'alice',name:'Alice'},expires_at:Math.floor(Date.now()/1000)+3600})))
  const pair=[{holdId:shared[0].id,role:'start'},{holdId:shared[1].id,role:'finish'}]
  const make=(id,name,holds,ownerId='alice')=>({id,name,holds,ownerId,grade:'V4',setter:'Alice',createdAt:'2026-01-01',revision:2,wallVersionId:'2026-10-v4'})
  const records=[make('valid','Valid original',pair),make('old','Outdated original',[...pair,{holdId:missing.id,role:'foot-only'}]),make('no-start','Missing start',[{holdId:missing.id,role:'start'},{holdId:shared[1].id,role:'finish'}]),make('other','Other creator',[...pair,{holdId:missing.id,role:'hold'}],'bob')]
  const original=JSON.stringify(records[1]),writes=[],gets=[];let number=1
  await context.route(api+'/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname,method=req.method()
   const send=(status,json)=>route.fulfill({status,json})
   if(path==='/v1/me')return send(200,{userId:'alice',isAdmin:false})
   if(path==='/v1/me/profile')return send(200,{displayName:'Alice',bio:''})
   if(path.endsWith('/creator-profile'))return send(200,{displayName:'Alice',bio:''})
   if(path.endsWith('/community'))return send(200,{ratingAverage:null,ratingCount:0,comments:[]})
   if(path.endsWith('/my-activity'))return send(200,{sent:false,rating:null,commentIds:[]})
   if(path==='/v1/gyms/stoneham-crg/walls/spray-wall-1/problems')return send(200,{items:records})
   const match=path.match(/^\/v1\/problems\/([^/]+)(\/upgrade)?$/)
   if(!match)throw Error('Unexpected '+path)
   const source=records.find(r=>r.id===match[1]);assert(source)
   if(!match[2]){if(method!=='GET')throw Error('Upgrade must not PATCH the original');return send(200,source)}
   assert.equal(req.headers().authorization,'Bearer lifecycle-test-token')
   if(method==='GET') {gets.push(source.id);return send(200,{sourceId:source.id,sourceRevision:source.revision,targetWallVersionId:'2026-11-v7',name:source.name+' V'+(number+1),grade:source.grade,setter:source.setter,holds:source.holds.filter(h=>ids.has(h.holdId)),removedHoldIds:source.holds.filter(h=>!ids.has(h.holdId)).map(h=>h.holdId)})}
   const body=req.postDataJSON();writes.push({path,body});number++
   const created={...source,...body,id:'upgrade-'+number,name:source.name+' V'+number,wallVersionId:'2026-11-v7',upgradedFromId:source.id,revision:1}
   records.push(created);return send(201,created)
  })
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
  const imageIs=async value=>{await page.waitForFunction(value=>document.querySelector('.wall-image')?.src.endsWith(value),value)}
  const explore=async()=>{await page.getByRole('button',{name:'Explore routes',exact:true}).click();await page.locator('.problem-card').first().waitFor()}
  const open=async name=>{await explore();await page.locator('.problem-card').filter({has:page.getByText(name,{exact:true})}).click();await page.getByRole('heading',{name,exact:true,level:2}).waitFor()}
  await page.goto(app);await page.getByRole('button',{name:'＋ Set',exact:true}).waitFor()
  assert.equal(await page.getByRole('combobox',{name:'Wall version',exact:true}).count(),0)
  await imageIs('/wall/versions/2026-11-v7-seam-trial/wall.jpg')
  await explore();assert.equal(await page.locator('.problem-card').count(),4);assert.equal(await page.locator('.problem-card.outdated').count(),3)
  assert(!await page.locator('.problem-card.outdated').first().isDisabled())
  await page.locator('.problem-card').filter({hasText:'Valid original'}).click()
  await page.getByRole('heading',{name:'Valid original',exact:true,level:2}).waitFor();await imageIs('/wall/versions/2026-11-v7-seam-trial/wall.jpg')
  assert.equal(await page.getByText('Route only available on old version wall',{exact:true}).count(),0)
  await open('Other creator');await imageIs('/wall/stoneham-spraywall-canonical.jpg');assert.equal(await page.getByRole('button',{name:'Upgrade',exact:true}).count(),0)
  await open('Outdated original');await imageIs('/wall/stoneham-spraywall-canonical.jpg')
  assert.equal(await page.locator('.selected-hold').count(),3)
  const warning=page.getByText('Route only available on old version wall',{exact:true});assert(await warning.isVisible())
  assert((await warning.boundingBox()).y>=(await page.getByRole('heading',{name:'Outdated original',exact:true,level:2}).boundingBox()).y)
  fs.mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/outdated-route-mobile.png',fullPage:true})
  await page.getByRole('button',{name:'Upgrade',exact:true}).click();await page.getByRole('button',{name:'Save upgraded route',exact:true}).waitFor()
  await imageIs('/wall/versions/2026-11-v7-seam-trial/wall.jpg')
  assert.equal(await page.getByLabel('Problem name',{exact:true}).inputValue(),'Outdated original V2')
  assert.equal(await page.locator('.hold-hit-polygon.is-selected').count(),2)
  assert.equal(await page.locator('.hold-hit-polygon[data-hold-id="'+missing.id+'"]').count(),0)
  await page.getByRole('button',{name:'Save upgraded route',exact:true}).click();await page.getByRole('heading',{name:'Outdated original V2',exact:true,level:2}).waitFor()
  assert.equal(writes.length,1);assert.deepEqual(writes[0].body.holds,pair);assert.equal(writes[0].body.sourceRevision,2);assert.equal(writes[0].body.automaticName,true)
  assert.equal(JSON.stringify(records[1]),original);assert.equal(await warning.count(),0)
  await open('Outdated original');await page.getByRole('button',{name:'Upgrade',exact:true}).click();assert.equal(await page.getByLabel('Problem name',{exact:true}).inputValue(),'Outdated original V3')
  await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(writes.length,1)
  await open('Missing start');await page.getByRole('button',{name:'Upgrade',exact:true}).click();assert(await page.getByRole('button',{name:'Save upgraded route',exact:true}).isDisabled())
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  await page.getByText('Browse wall history',{exact:true}).click();await page.getByRole('link',{name:'Original wall · v4',exact:true}).click()
  await page.waitForURL(/wallVersion=2026-10-v4/);await imageIs('/wall/stoneham-spraywall-canonical.jpg')
  await page.getByRole('link',{name:'Back to current wall',exact:true}).click();await page.waitForURL(url=>!url.searchParams.has('wallVersion'))
  await imageIs('/wall/versions/2026-11-v7-seam-trial/wall.jpg')
  for(const width of [320,390,980]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))}
  assert.deepEqual(errors,[])
  console.log('PASS: latest wall default, all routes, clickable gray outdated cards, old-wall warning, author-only Upgrade, mapped seed, V2/V3, source untouched, missing Start validation, history links and mobile layout.')
 }finally{for(const c of browser.contexts())await c.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
