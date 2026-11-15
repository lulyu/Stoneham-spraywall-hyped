const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright'),assert=require('node:assert/strict'),fs=require('node:fs')
const fresh=require('../src/data/walls/2026-11-v8/holds.json'),old=require('../src/data/walls/2026-11-v7/holds.json')
const ids=new Set(fresh.map(h=>h.id)),shared=old.filter(h=>ids.has(h.id)).slice(0,2),missing=old.find(h=>!ids.has(h.id))
const api='https://kurd8a9bz9.execute-api.us-east-1.amazonaws.com',app=process.env.APP_URL||'http://127.0.0.1:5181'
;(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']})
 try{
  for(const role of ['owner','other','admin','anonymous','unowned-anonymous']){
   const user=role==='owner'?'alice':role==='admin'?'moderator':role==='other'?'bob':null
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
   if(process.env.BROWSER_FETCH_PROXY==='1')await context.route('https://**/*',async route=>{const response=await fetch(route.request().url());const headers=Object.fromEntries(response.headers);for(const k of ['content-encoding','content-length','transfer-encoding','connection'])delete headers[k];await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())})})
   if(user)await context.addInitScript(user=>sessionStorage.setItem('oidc.user:https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fvraMpcpi:537q15f8r1ppgtpucjoa5pad1r',JSON.stringify({access_token:'versions-fixture',token_type:'Bearer',scope:'openid email profile stoneham-api/write',profile:{sub:user,name:user},expires_at:Math.floor(Date.now()/1000)+3600})),user)
   const pair=[{holdId:shared[0].id,role:'start'},{holdId:shared[1].id,role:'finish'}]
   const make=(id,name,extra={})=>({id,name,ownerId:'alice',grade:'V5',setter:'Alice',revision:1,createdAt:'2026-11-14',wallVersionId:'2026-11-v8',holds:pair,...extra})
   const root=make('root','Original route',{grade:'V2',outdated:true,wallVersionId:'2026-11-v7',createdAt:'2026-11-01',holds:[...pair,{holdId:missing.id,role:'foot-only'}]}),v2=make('v2','Original route V2',{upgradeRootId:'root',upgradedFromId:'root',upgradeNumber:2}),other=make('other','Unrelated route'),unowned=make('unowned','Unowned route',{ownerId:undefined})
   let removed=false,failRemove=true,failVersions=true;const deletes=[],versionReads=[]
   await context.route(api+'/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method(),send=(status,json)=>route.fulfill({status,json})
    if(path==='/v1/me')return send(200,{userId:user,isAdmin:role==='admin'})
    if(path==='/v1/me/profile')return send(200,{displayName:user||'',bio:''})
    if(path==='/v1/me/problems'||path==='/v1/me/sends')return send(200,{items:[]})
    if(path==='/v1/gyms/stoneham-crg/walls/spray-wall-1/problems')return send(200,removed?{items:[other,root]}:url.searchParams.has('cursor')?{items:[root]}:{items:[v2,other],nextCursor:'older-page'})
    const match=path.match(/^\/v1\/problems\/([^/]+)(?:\/(.+))?$/);assert(match,'Unexpected '+path)
    const [,id,action]=match,record=[root,v2,other,unowned].find(r=>r.id===id);assert(record)
    if(id==='v2'&&removed)return send(404,{error:'problem not found'})
    if(!action&&method==='DELETE'){
     assert(role==='owner'||role==='admin');assert.equal(req.headers().authorization,'Bearer versions-fixture');assert.deepEqual(req.postDataJSON(),{revision:1});deletes.push(id)
     if(failRemove){failRemove=false;return send(503,{error:'Removal failed; retry'})}
     removed=true;return send(200,{id,removed:true})
    }
    if(!action)return send(200,record)
    if(action==='versions'){
     versionReads.push(id)
     if(failVersions){failVersions=false;return send(503,{error:'Versions unavailable; retry'})}
     return send(200,url.searchParams.has('cursor')?{items:removed?[root]:[root]}:{items:removed?[root]:[v2],nextCursor:removed?undefined:'older-versions'})
    }
    if(action==='community')return send(200,{ratingAverage:id==='root'?4:5,ratingCount:1,commentCount:0,comments:[]})
    if(action==='my-activity')return send(200,{sent:false,rating:null,commentIds:[]})
    if(action==='creator-profile')return send(200,{displayName:'Alice',bio:''})
    throw Error('Unexpected action '+action)
   })
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000)
   await page.goto(role==='unowned-anonymous'?app+'/?route=unowned':app)
   if(role==='unowned-anonymous'){await page.getByRole('heading',{name:'Unowned route',exact:true,level:2}).waitFor();assert.equal(await page.getByRole('button',{name:'Remove',exact:true}).count(),0);await context.close();continue}
   await page.getByRole('button',{name:'Explore routes',exact:true}).click();await page.locator('.problem-card').first().waitFor();assert.equal(await page.locator('.problem-card').count(),2)
   await page.getByRole('button',{name:'Load more routes',exact:true}).click();await page.getByRole('button',{name:'Load more routes',exact:true}).waitFor({state:'hidden'});assert.equal(await page.locator('.problem-card').count(),2)
   assert.equal(await page.locator('.problem-card').filter({has:page.getByText('Original route',{exact:true})}).count(),0)
   await page.locator('.problem-card').filter({hasText:'Original route V2'}).click();await page.getByRole('heading',{name:v2.name,exact:true,level:2}).waitFor()
   if(role==='other'||role==='anonymous'){assert.equal(await page.getByRole('button',{name:'Remove',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Edit problem',exact:true}).count(),0);await context.close();continue}
   assert(await page.getByRole('button',{name:'Edit problem',exact:true}).isVisible());assert(await page.getByRole('button',{name:'Remove',exact:true}).isVisible())
   if(role==='admin'){await page.getByRole('button',{name:'Remove',exact:true}).click();await page.getByRole('button',{name:'Cancel remove',exact:true}).click();assert.equal(deletes.length,0);await context.close();continue}
   const versions=page.locator('.route-versions');await versions.locator('summary').click();await page.getByRole('alert').filter({hasText:'Versions unavailable; retry'}).waitFor();await page.getByRole('button',{name:'Retry versions',exact:true}).click();await page.getByRole('button',{name:'More versions',exact:true}).click()
   await versions.getByRole('button',{name:'V1 · Original route · Old wall',exact:true}).click();await page.getByRole('heading',{name:'Original route',exact:true,level:2}).waitFor();assert(await page.getByText('Route only available on old version wall',{exact:true}).isVisible())
   await page.waitForFunction(()=>document.querySelector('.wall-image')?.src.endsWith('/wall/versions/2026-11-v7-seam-trial/wall.jpg'))
   assert.equal(await page.getByRole('button',{name:'Edit problem',exact:true}).count(),0);assert(await page.getByRole('button',{name:'Remove',exact:true}).isVisible())
   await versions.locator('summary').click();await versions.getByRole('button',{name:'V2 · Original route V2',exact:true}).click();await page.getByRole('heading',{name:v2.name,exact:true,level:2}).waitFor()
   await page.getByRole('button',{name:'Remove',exact:true}).click();await page.getByRole('button',{name:'Cancel remove',exact:true}).click();assert.equal(deletes.length,0)
   await page.getByRole('button',{name:'Remove',exact:true}).click();await page.getByRole('button',{name:'Confirm remove',exact:true}).click();await page.getByText('Removal failed; retry',{exact:true}).waitFor();assert(!removed)
   await page.getByRole('button',{name:'Confirm remove',exact:true}).click();await page.getByRole('dialog',{name:'Explore routes',exact:true}).waitFor();assert(removed);assert.equal(deletes.length,2)
   await page.locator('.problem-card').filter({has:page.getByText('Original route',{exact:true})}).waitFor();assert.equal(await page.locator('.problem-card').count(),2)
   await page.goBack();await page.getByRole('heading',{name:'Original route',exact:true,level:2}).waitFor();await page.goBack();await page.getByRole('dialog',{name:'Explore routes',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:v2.name,exact:true,level:2}).count(),0)
   for(const width of [320,390,980]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))}
   fs.mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/route-versions-removal-mobile.png',fullPage:true});assert.deepEqual(errors,[])
   await context.close()
  }
  console.log('PASS mobile route families: latest-only lists across pages, historical wall/version navigation, permission gating, cancel and failure retry, per-version removal, fallback to older version, browser Back protection and 320–980px layouts; isolated fixtures only.')
 }finally{for(const c of browser.contexts())await c.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
