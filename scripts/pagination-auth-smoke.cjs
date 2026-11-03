const assert=require('node:assert/strict')
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const holds=require('../src/data/polygons/holds.json')
const api='https://kurd8a9bz9.execute-api.us-east-1.amazonaws.com'
const authority='https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fvraMpcpi'
const domain='https://stoneham-spraywall-prod-010257981603.auth.us-east-1.amazoncognito.com'
const app=process.env.APP_URL||'http://localhost:5178'
;(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.BROWSER_PROXY?{server:process.env.BROWSER_PROXY}:undefined})
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
  await context.addInitScript(()=>{
   const user=localStorage.getItem('test-user')||'alice'
   const expired=localStorage.getItem('expired-token')==='yes'
   sessionStorage.setItem('oidc.user:https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fvraMpcpi:537q15f8r1ppgtpucjoa5pad1r',JSON.stringify({
    access_token:'token-'+user,refresh_token:'mock-refresh',token_type:'Bearer',scope:'openid email profile stoneham-api/write',
    profile:{sub:user,name:user},expires_at:Math.floor(Date.now()/1000)+(expired?-10:3600),
   }))
  })
  await context.route(authority+'/.well-known/openid-configuration',r=>r.fulfill({json:{
   issuer:authority,authorization_endpoint:domain+'/oauth2/authorize',token_endpoint:domain+'/oauth2/token',jwks_uri:authority+'/.well-known/jwks.json',
  }}))
  let renewals=0
  await context.route(domain+'/oauth2/token',r=>{renewals++;return r.fulfill({status:400,json:{error:'invalid_grant'}})})
  await context.route(domain+'/oauth2/authorize**',r=>{
   const url=new URL(r.request().url())
   assert.equal(url.searchParams.get('code_challenge_method'),'S256')
   assert(url.searchParams.get('state'))
   return r.fulfill({contentType:'text/html',body:'<p>Mock Google login</p>'})
  })
  const records=Array.from({length:125},(_,i)=>({id:'p'+i,name:'Route '+i,grade:'V1',setter:'Tester',ownerId:'alice',revision:1,createdAt:'2026-11-03',holds:[]}))
  let failPage=true,firstSave=true,saved,releaseOld
  let deferPage=false,pageRequests=0
  await context.route(api+'/**',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname
   const send=(status,body)=>route.fulfill({status,json:body})
   const user=req.headers().authorization?.replace('Bearer token-','')||'anonymous'
   if(path==='/v1/me')return send(200,{userId:user,isAdmin:false})
   if(path==='/v1/me/profile')return send(200,{displayName:user,bio:''})
   if(path.endsWith('/versions/2026-10-v4/problems')&&req.method()==='GET'){
    const cursor=url.searchParams.get('cursor')
    if(!cursor)return send(200,{items:records.slice(0,50),nextCursor:'page2'})
    pageRequests++
    if(deferPage){deferPage=false;await new Promise(resolve=>{releaseOld=resolve});return send(200,{items:[{...records[50],name:'STALE PAGE'}]})}
    if(failPage){failPage=false;return send(503,{error:'Page failed; retry'})}
    if(cursor==='page2')return send(200,{items:[{...records[0],name:'Stale duplicate'},...records.slice(50,100)],nextCursor:'page3'})
    return send(200,{items:records.slice(100)})
   }
   if(req.method()==='POST'){
    if(firstSave){firstSave=false;return send(401,{error:'expired'})}
    saved={...req.postDataJSON(),id:'saved',ownerId:user,revision:1,createdAt:'2026-11-03'}
    return send(201,saved)
   }
   if(path.endsWith('/community'))return send(200,{ratingAverage:null,ratingCount:0,comments:[]})
   if(path.endsWith('/my-activity'))return send(200,{sent:false,rating:null})
   if(path==='/v1/me/sends')return send(200,{items:[]})
   return send(200,records.find(r=>path.endsWith('/'+r.id)))
  })
  const page=await context.newPage();page.setDefaultTimeout(15000)
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(app)
  await page.getByRole('button',{name:'Profile · alice',exact:true}).waitFor()
  assert.equal(await page.locator('.problem-card').count(),50)
  await page.getByRole('button',{name:'Load more routes',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'Page failed'}).waitFor()
  assert.equal(await page.locator('.problem-card').count(),50)
  await page.getByRole('button',{name:'Load more routes',exact:true}).click()
  await page.locator('.problem-card').getByText('Route 99',{exact:true}).waitFor()
  assert.equal(await page.locator('.problem-card').count(),100)
  assert.equal(await page.getByText('Stale duplicate',{exact:true}).count(),0)
  await page.getByRole('button',{name:'Load more routes',exact:true}).click()
  await page.locator('.problem-card').getByText('Route 124',{exact:true}).waitFor()
  assert.equal(await page.locator('.problem-card').count(),125)
  assert.equal(await page.getByRole('button',{name:'Load more routes',exact:true}).count(),0)
  await page.getByRole('button',{name:'Refresh',exact:true}).click()
  await page.getByRole('button',{name:'Load more routes',exact:true}).waitFor()
  assert.equal(await page.locator('.problem-card').count(),50)
  deferPage=true
  await page.getByRole('button',{name:'Load more routes',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.load-more')?.textContent==='Loading more…')
  await page.getByRole('button',{name:'Refresh',exact:true}).click()
  await page.getByRole('button',{name:'Refresh',exact:true}).waitFor()
  while(!releaseOld)await new Promise(r=>setTimeout(r,10))
  releaseOld()
  await page.waitForTimeout(100)
  assert.equal(await page.getByText('STALE PAGE',{exact:true}).count(),0)
  assert.equal(await page.locator('.problem-card').count(),50)

  await page.getByRole('button',{name:'＋ Set',exact:true}).click()
  await page.getByRole('group',{name:'Hold role'}).getByRole('button',{name:'START',exact:true}).tap()
  await page.locator('.hold-hit-polygon').nth(0).tap()
  await page.getByRole('group',{name:'Hold role'}).getByRole('button',{name:'FINISH',exact:true}).tap()
  await page.locator('.hold-hit-polygon').nth(1).tap()
  await page.getByLabel('Problem name').fill('Reauth draft')
  await page.getByLabel('Setter',{exact:true}).fill('Guest setter')
  await page.getByRole('button',{name:'Save problem',exact:true}).click()
  await page.getByRole('button',{name:'Sign in again',exact:true}).waitFor()
  assert.equal(await page.getByText('Signed in',{exact:true}).count(),0)
  assert.equal(await page.getByLabel('Problem name').inputValue(),'Reauth draft')
  assert.equal(await page.locator('.selected-hold').count(),2)
  assert(await page.getByRole('button',{name:'Save problem',exact:true}).isDisabled())
  await page.getByRole('button',{name:'Sign in again',exact:true}).click()
  await page.waitForURL(url=>url.hostname===new URL(domain).hostname)
  await page.goto(app)
  await page.getByLabel('Problem name').waitFor()
  assert.equal(await page.getByLabel('Problem name').inputValue(),'Reauth draft')
  assert.equal(await page.getByLabel('Setter',{exact:true}).inputValue(),'Guest setter')
  assert.equal(await page.locator('.selected-hold').count(),2)
  await page.getByRole('button',{name:'Save problem',exact:true}).click()
  await page.locator('.problem-card').getByText('Reauth draft',{exact:true}).waitFor()
  assert.equal(saved.setter,'Guest setter');assert.equal(saved.holds.length,2)

  await page.evaluate(()=>localStorage.setItem('expired-token','yes'))
  await page.reload()
  await page.getByRole('button',{name:'Sign in again',exact:true}).waitFor()
  assert(renewals>0)
  assert.equal(await page.getByText('Signed in',{exact:true}).count(),0)
  assert.deepEqual(errors,[])
  console.log('PASS: 125-route pagination, failed-page retry, duplicate/stale suppression, refresh race, 401 login-state recovery, PKCE reauth draft restore and silent-renew failure')
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
