const assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const old=require('../src/data/polygons/holds.json'),fresh=require('../src/data/walls/2026-11-v7/holds.json')
const ids=new Set(fresh.map(hold=>hold.id)),shared=old.filter(hold=>ids.has(hold.id)),missing=old.find(hold=>!ids.has(hold.id))
const api='https://kurd8a9bz9.execute-api.us-east-1.amazonaws.com',app=process.env.APP_URL||'http://localhost:5188'
;(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.BROWSER_PROXY?{server:process.env.BROWSER_PROXY}:undefined})
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
  if(process.env.BROWSER_FETCH_PROXY==='1')await context.route('https://**/*',async route=>{try{await route.fulfill({response:await route.fetch()})}catch{await route.abort('failed').catch(()=>{})}})
  await context.addInitScript(()=>{
   const sub=localStorage.getItem('test-account')||'alice'
   sessionStorage.setItem('oidc.user:https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fvraMpcpi:537q15f8r1ppgtpucjoa5pad1r',JSON.stringify({access_token:'test-'+sub,token_type:'Bearer',scope:'openid email profile stoneham-api/write',profile:{sub,name:sub},expires_at:Math.floor(Date.now()/1000)+3600}))
  })
  const records=Array.from({length:12},(_,index)=>{
   const number=12-index,outdated=number===11
   return {id:'own-'+number,name:'Own route '+String(number).padStart(2,'0'),grade:'V3',setter:'Guest setter',ownerId:'alice',createdAt:'2026-10-'+String(number).padStart(2,'0')+'T12:00:00Z',revision:1,wallVersionId:'2026-10-v4',outdated,holds:[{holdId:shared[0].id,role:'start'},{holdId:shared[1].id,role:'finish'},...(outdated?[{holdId:missing.id,role:'foot-only'}]:[])]}
  })
  let failInitial=true,failMore=true,moreRequests=0
  await context.route(api+'/**',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname,user=req.headers().authorization?.replace('Bearer test-','')
   assert.equal(req.method(),'GET','This fixture must never write routes')
   const send=(status,json)=>route.fulfill({status,json})
   if(path==='/v1/me')return send(200,{userId:user,isAdmin:false})
   if(path==='/v1/me/profile')return send(200,{displayName:user,bio:''})
   if(path==='/v1/me/sends')return send(200,{items:[]})
   if(path==='/v1/me/problems'){
    assert(['alice','bob'].includes(user))
    if(user==='bob')return send(200,{items:[]})
    if(failInitial)return send(503,{error:'Temporary route list failure'})
    const offset=Number(url.searchParams.get('cursor')||0)
    if(offset){moreRequests++;if(failMore){failMore=false;return send(503,{error:'Temporary page failure'})}}
    return send(200,{items:records.slice(offset,offset+5),...(offset+5<records.length?{nextCursor:String(offset+5)}:{})})
   }
   if(path.endsWith('/creator-profile'))return send(200,{displayName:'alice',bio:''})
   if(path.endsWith('/community'))return send(200,{ratingAverage:null,ratingCount:0,comments:[]})
   if(path.endsWith('/my-activity'))return send(200,{sent:false,rating:null})
   if(path.endsWith('/problems'))return send(200,{items:records})
   const record=records.find(record=>path.endsWith('/'+record.id))
   return send(record?200:404,record||{error:'Not found'})
  })
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
  const openProfile=async(user='alice')=>{await page.getByLabel('Account menu',{exact:true}).click();await page.getByRole('button',{name:'Profile · '+user,exact:true}).click();await page.getByRole('region',{name:'My routes',exact:true}).waitFor()}
  const list=page.getByRole('region',{name:'My routes',exact:true})
  await page.goto(app);await openProfile()
  await list.getByText('Temporary route list failure',{exact:true}).waitFor()
  failInitial=false;await list.getByRole('button',{name:'Retry routes'}).click();await list.locator('.problem-card').nth(4).waitFor()
  assert.equal(await list.locator('.problem-card').count(),5)
  assert.deepEqual(await list.locator('.problem-copy strong').allTextContents(),records.slice(0,5).map(record=>record.name))
  await list.getByRole('button',{name:'Load more',exact:true}).click();await list.getByText('Temporary page failure',{exact:true}).waitFor()
  assert.equal(await list.locator('.problem-card').count(),5)
  await list.getByRole('button',{name:'Load more',exact:true}).click();await list.locator('.problem-card').nth(9).waitFor()
  assert.equal(moreRequests,2)
  await list.getByRole('button',{name:'Load more',exact:true}).click();await list.locator('.problem-card').nth(11).waitFor()
  assert.equal(await list.locator('.problem-card').count(),12);assert.equal(await list.getByRole('button',{name:'Load more',exact:true}).count(),0)
  for(const width of [320,390,980]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))}
  await list.locator('.problem-card').filter({has:page.getByText('Own route 06',{exact:true})}).click()
  await page.getByRole('heading',{name:'Own route 06',exact:true,level:2}).waitFor();await page.waitForFunction(()=>document.querySelector('.wall-image')?.src.endsWith('/wall/versions/2026-11-v7-seam-trial/wall.jpg'))
  await openProfile();await list.locator('.problem-card').nth(4).waitFor();assert.equal(await list.locator('.problem-card').count(),5)
  await list.locator('.problem-card.outdated').click();await page.getByText('Route only available on old version wall',{exact:true}).waitFor()
  await page.waitForFunction(()=>document.querySelector('.wall-image')?.src.endsWith('/wall/stoneham-spraywall-canonical.jpg'))
  await page.evaluate(()=>localStorage.setItem('test-account','bob'));await page.reload();await openProfile('bob')
  await list.getByText("You haven't set any routes yet.",{exact:true}).waitFor();assert.equal(await list.locator('.problem-card').count(),0)
  assert.deepEqual(errors,[])
  console.log('PASS: newest 5, Load more through 12, initial/page failure retries, retained rows, current/old-wall navigation, reopen resets to 5, empty account, account isolation and mobile layouts. No route writes.')
 }finally{for(const context of browser.contexts())await context.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
