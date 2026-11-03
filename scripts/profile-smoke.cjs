const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const holds = require('../src/data/polygons/holds.json')
const api = 'https://kurd8a9bz9.execute-api.us-east-1.amazonaws.com'
;(async () => {
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.BROWSER_PROXY?{server:process.env.BROWSER_PROXY}:undefined})
 try {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
  await context.addInitScript(()=>{
   sessionStorage.setItem('oidc.user:https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fvraMpcpi:537q15f8r1ppgtpucjoa5pad1r',JSON.stringify({
    access_token:'mock-profile-token',token_type:'Bearer',scope:'openid email profile stoneham-api/write',
    profile:{sub:'alice',name:'Google Name',email:'alice@example.com'},expires_at:Math.floor(Date.now()/1000)+3600
   }))
  })
  let profile={displayName:'',bio:''}, records=[], fail=false
  await context.route(api+'/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname,method=req.method()
   const send=(status,body)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)})
   if(path==='/v1/me/sends')return send(200,{items:[]})
   if(path.endsWith('/community'))return send(200,{ratingAverage:null,ratingCount:0,comments:[]})
   if(path.endsWith('/my-activity'))return send(200,{sent:false,rating:null})
   if(path==='/v1/me')return send(200,{userId:'alice',isAdmin:false})
   if(path==='/v1/me/profile'){
    assert.equal(req.headers().authorization,'Bearer mock-profile-token')
    if(method==='PATCH'){
     if(fail)return send(503,{error:'Temporary profile failure'})
     profile=req.postDataJSON()
    }
    return send(200,profile)
   }
   if(method==='POST'){
    const record={...req.postDataJSON(),id:'route-'+records.length,ownerId:'alice',createdAt:'2026-11-02',revision:1}
    records.unshift(record);return send(201,record)
   }
   if(path.endsWith('/problems'))return send(200,{items:records})
   return send(200,records.find(r=>path.endsWith('/'+r.id)))
  })
  const page=await context.newPage();page.setDefaultTimeout(15000)
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(process.env.APP_URL||'http://localhost:5176')
  await page.getByRole('button',{name:'Profile · Google Name',exact:true}).click()
  await page.getByLabel('Display name',{exact:true}).fill('Slab wizard')
  await page.getByLabel('Short bio',{exact:true}).fill('Learning delicate footwork.')
  await page.getByRole('button',{name:'Save profile',exact:true}).click()
  await page.getByText('Profile saved.',{exact:true}).waitFor()
  await page.reload()
  await page.getByRole('button',{name:'Profile · Slab wizard',exact:true}).waitFor()
  await page.getByRole('button',{name:'＋ Set',exact:true}).click()
  assert.equal(await page.getByLabel('Setter',{exact:true}).inputValue(),'Slab wizard')
  await page.getByLabel('Setter',{exact:true}).fill('Guest setter')
  await page.getByRole('group',{name:'Hold role'}).getByRole('button',{name:'START',exact:true}).tap()
  await page.locator('.hold-hit-polygon').nth(0).tap()
  await page.getByRole('group',{name:'Hold role'}).getByRole('button',{name:'FINISH',exact:true}).tap()
  await page.locator('.hold-hit-polygon').nth(1).tap()
  await page.getByLabel('Problem name').fill('Profile route')
  await page.getByRole('button',{name:'Save problem',exact:true}).click()
  await page.locator('.problem-card').getByText('Profile route',{exact:true}).waitFor()
  assert.equal(records[0].setter,'Guest setter')
  await page.getByRole('button',{name:'Profile · Slab wizard',exact:true}).click()
  await page.getByLabel('Display name',{exact:true}).fill('New name')
  await page.getByLabel('Short bio',{exact:true}).fill('')
  fail=true
  await page.getByRole('button',{name:'Save profile',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'Temporary profile failure'}).waitFor()
  assert.equal(await page.getByLabel('Display name',{exact:true}).inputValue(),'New name')
  fail=false
  await page.getByRole('button',{name:'Save profile',exact:true}).click()
  await page.getByRole('button',{name:'Edit problem',exact:true}).click()
  assert.equal(await page.getByLabel('Setter',{exact:true}).inputValue(),'Guest setter')
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  await page.getByRole('button',{name:'＋ Set',exact:true}).click()
  assert.equal(await page.getByLabel('Setter',{exact:true}).inputValue(),'New name')
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  await page.getByRole('button',{name:'Profile · New name',exact:true}).click()
  assert.equal(await page.getByLabel('Short bio',{exact:true}).inputValue(),'')
  for(const width of [320,390,680,980]){
   await page.setViewportSize({width,height:844})
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width)
  }
  assert.deepEqual(errors,[])
  console.log('PASS: profile save/reload, Google-name fallback, editable setter default, existing setter preserved, failed save retains draft, bio clearing and 320–980px layout')
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
