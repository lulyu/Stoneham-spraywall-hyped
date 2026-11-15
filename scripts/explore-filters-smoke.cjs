const assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const old=require('../src/data/polygons/holds.json'),fresh=require('../src/data/walls/2026-11-v7/holds.json')
const ids=new Set(fresh.map(hold=>hold.id)),shared=old.filter(hold=>ids.has(hold.id)),missing=old.find(hold=>!ids.has(hold.id))
const api='https://kurd8a9bz9.execute-api.us-east-1.amazonaws.com',app=process.env.APP_URL||'http://localhost:5194'
;(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.BROWSER_PROXY?{server:process.env.BROWSER_PROXY}:undefined});try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
 if(process.env.BROWSER_FETCH_PROXY==='1')await context.route('https://**/*',async route=>{try{await route.fulfill({response:await route.fetch()})}catch{await route.abort('failed').catch(()=>{})}})
 await context.addInitScript(()=>sessionStorage.setItem('oidc.user:https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fvraMpcpi:537q15f8r1ppgtpucjoa5pad1r',JSON.stringify({access_token:'filter-test',token_type:'Bearer',scope:'openid email profile stoneham-api/write',profile:{sub:'alice',name:'Alice'},expires_at:Math.floor(Date.now()/1000)+3600})))
 const records=['V10+','V2','V3','VB','V2','V1','V0'].map((grade,index)=>({id:'r'+index,name:'Route '+index,grade,setter:'Alice',ownerId:'alice',revision:1,commentCount:0,wallVersionId:'2026-10-v4',createdAt:'2026-11-'+String(14-index).padStart(2,'0'),holds:[{holdId:shared[0].id,role:'start'},{holdId:shared[1].id,role:'finish'},...(index===4?[{holdId:missing.id,role:'foot-only'}]:[])]}))
 const ratings=[{ratingAverage:4,ratingCount:2},{ratingAverage:4,ratingCount:5},{ratingAverage:5,ratingCount:1},{ratingAverage:null,ratingCount:0},{ratingAverage:2,ratingCount:3},{ratingAverage:3,ratingCount:1},{ratingAverage:null,ratingCount:0}]
 let failPage=true,failRating=true,listCalls=0,ratingCalls=0,peak=0,inFlight=0,posts=0
 await context.route(api+'/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,send=(status,json)=>route.fulfill({status,json})
  if(path==='/v1/me')return send(200,{userId:'alice',isAdmin:false})
  if(path==='/v1/me/profile')return send(200,{displayName:'Alice',bio:''})
  if(path==='/v1/gyms/stoneham-crg/walls/spray-wall-1/problems'){
   listCalls++;const start=Number(url.searchParams.get('cursor')||0)
   if(start===3&&failPage){failPage=false;return send(503,{error:'Temporary list failure'})}
   return send(200,{items:records.slice(start,start+3),...(start+3<records.length?{nextCursor:String(start+3)}:{})})
  }
  const match=path.match(/^\/v1\/problems\/r(\d)(?:\/(.*))?$/);assert(match,'Unexpected fixture API '+path)
  const index=Number(match[1]),action=match[2]
  if(!action)return send(200,records[index])
  if(action==='community'){
   ratingCalls++;inFlight++;peak=Math.max(peak,inFlight);await new Promise(resolve=>setTimeout(resolve,20));inFlight--
   if(index===2&&failRating){failRating=false;return send(503,{error:'Temporary rating failure'})}
   return send(200,{...ratings[index],commentCount:0,comments:[]})
  }
  if(action==='creator-profile')return send(200,{displayName:'Alice',bio:''})
  if(action==='my-activity')return send(200,{sent:false,rating:null,commentIds:[]})
  if(action==='rating'){
   assert.equal(request.method(),'PATCH');posts++;ratings[index]={ratingAverage:5,ratingCount:6}
   return send(200,{...ratings[index],commentCount:0,comments:[]})
  }
  throw Error('Unexpected fixture action '+action)
 })
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message))
 const drawer=page.getByRole('dialog',{name:'Explore routes',exact:true}),cards=drawer.locator('.problem-card')
 const names=()=>cards.locator('.problem-title strong').allTextContents()
 const expectNames=async expected=>{await page.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('.routes-drawer .problem-card .problem-title strong')].map(element=>element.textContent))===JSON.stringify(expected),expected);assert.deepEqual(await names(),expected)}
 await page.goto(app);await page.getByLabel('Account menu',{exact:true}).waitFor();await page.getByRole('button',{name:'Explore routes',exact:true}).click();await cards.nth(2).waitFor()
 const filters=drawer.getByRole('button',{name:'Filters',exact:true}),panel=drawer.getByRole('group',{name:'Filter and sort routes',exact:true});assert.equal(await filters.getAttribute('aria-expanded'),'false');assert(!await panel.isVisible());
 require('node:fs').mkdirSync('artifacts',{recursive:true});await drawer.evaluate(element=>Promise.all(element.getAnimations().map(animation=>animation.finished)));await page.screenshot({path:'artifacts/explore-filters-collapsed-mobile.png'});
 await filters.click();await panel.waitFor();assert.equal(await filters.getAttribute('aria-expanded'),'true');
 const initialListCalls=listCalls;assert(initialListCalls>=1&&initialListCalls<=2);await drawer.getByRole('button',{name:'Retry ratings',exact:true}).waitFor();await cards.first().getByRole('img',{name:'4.0 out of 5 stars, 2 ratings',exact:true}).waitFor();assert.equal(await cards.count(),3);await drawer.getByRole('button',{name:'Retry ratings',exact:true}).click();await cards.nth(2).getByRole('img',{name:'5.0 out of 5 stars, 1 rating',exact:true}).waitFor();assert(!await drawer.getByLabel('Valid only',{exact:true}).isChecked())
 await drawer.getByLabel('Grade',{exact:true}).selectOption('V2');await drawer.getByText('Temporary list failure',{exact:true}).waitFor();await expectNames(['Route 1'])
 await drawer.getByRole('button',{name:'Load more routes',exact:true}).click();await expectNames(['Route 1','Route 4']);assert.equal(listCalls,initialListCalls+3)
 await drawer.getByLabel('Valid only',{exact:true}).check();await expectNames(['Route 1']);await filters.click();assert(!await panel.isVisible());assert(await filters.evaluate(element=>element.classList.contains('has-filters')));await expectNames(['Route 1']);await cards.click();await page.getByRole('heading',{name:'Route 1',level:2,exact:true}).waitFor()
 await page.goBack();await drawer.waitFor();assert(!await panel.isVisible());await filters.click();assert.equal(await drawer.getByLabel('Grade',{exact:true}).inputValue(),'V2');assert(await drawer.getByLabel('Valid only',{exact:true}).isChecked());await expectNames(['Route 1'])
 await drawer.getByLabel('Grade',{exact:true}).selectOption('V9');await drawer.getByText('No routes match these filters. Try another grade or turn off Valid only.',{exact:true}).waitFor()
 await drawer.getByRole('button',{name:'Reset filters',exact:true}).click();await expectNames(records.map(record=>record.name));assert.equal(await drawer.locator('.problem-card.outdated').count(),1)
 await drawer.getByLabel('Sort by',{exact:true}).selectOption('grade-asc');await expectNames(['Route 3','Route 6','Route 5','Route 1','Route 4','Route 2','Route 0'])
 await drawer.getByLabel('Sort by',{exact:true}).selectOption('grade-desc');await expectNames(['Route 0','Route 2','Route 1','Route 4','Route 5','Route 6','Route 3'])
 await drawer.getByLabel('Sort by',{exact:true}).selectOption('stars-desc');assert.equal(await cards.count(),7)
 const beforeRetry=ratingCalls;await expectNames(['Route 2','Route 1','Route 0','Route 5','Route 4','Route 3','Route 6']);assert.equal(ratingCalls,beforeRetry);assert(peak<=4)
 await drawer.getByLabel('Sort by',{exact:true}).selectOption('stars-asc');await expectNames(['Route 4','Route 5','Route 1','Route 0','Route 2','Route 3','Route 6']);assert.equal(ratingCalls,beforeRetry)
 await drawer.getByLabel('Sort by',{exact:true}).selectOption('stars-desc');await drawer.getByLabel('Valid only',{exact:true}).check();await expectNames(['Route 2','Route 1','Route 0','Route 5','Route 3','Route 6'])
 for(const width of [320,390,980]){await page.setViewportSize({width,height:844});assert(await drawer.evaluate(element=>element.scrollWidth<=element.clientWidth));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))}
 await page.setViewportSize({width:390,height:844});require('node:fs').mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/explore-filters-mobile.png'})
 await cards.filter({has:page.getByText('Route 0',{exact:true})}).click();await page.getByRole('heading',{name:'Route 0',level:2,exact:true}).waitFor()
 await page.getByRole('group',{name:'Rate this route',exact:true}).getByRole('button',{name:'Rate 5 out of 5',exact:true}).click();await page.getByText('5.0/5 · 6 ratings',{exact:true}).waitFor();assert.equal(posts,1)
 await page.goBack();await drawer.waitFor();await expectNames(['Route 0','Route 2','Route 1','Route 5','Route 3','Route 6']);await cards.first().getByRole('img',{name:'5.0 out of 5 stars, 6 ratings',exact:true}).waitFor()
 await drawer.getByRole('button',{name:'Refresh',exact:true}).click();await expectNames(['Route 0','Route 2','Route 1','Route 5','Route 3','Route 6']);await page.waitForFunction(()=>!document.querySelector('.routes-drawer .load-more'));assert(listCalls>=initialListCalls+6)
 assert.deepEqual(errors,[])
 console.log('PASS: collapsed icon button/panel, active filters retained while hidden, grade/valid filters, numeric grade sorting, global pagination and retry, star averages/ties/unrated, bounded rating reads/failure retry/cache, Back retains filters, confirmed rating updates, refresh and mobile layout. All writes mocked.')
 }finally{for(const context of browser.contexts())await context.unrouteAll({behavior:'ignoreErrors'});await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1})
