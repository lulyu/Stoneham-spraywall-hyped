const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright'),assert=require('node:assert/strict')
const holds=require('../src/data/walls/2026-11-v8/holds.json')
const api='https://kurd8a9bz9.execute-api.us-east-1.amazonaws.com',app=process.env.APP_URL||'http://127.0.0.1:5181'
;(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']})
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
  if(process.env.BROWSER_FETCH_PROXY==='1')await context.route('https://**/*',async route=>{const r=await fetch(route.request().url()),headers=Object.fromEntries(r.headers);for(const k of ['content-encoding','content-length','transfer-encoding','connection'])delete headers[k];await route.fulfill({status:r.status,headers,body:Buffer.from(await r.arrayBuffer())})})
  await context.addInitScript(()=>sessionStorage.setItem('oidc.user:https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fvraMpcpi:537q15f8r1ppgtpucjoa5pad1r',JSON.stringify({access_token:'activity-reconciliation-fixture',token_type:'Bearer',scope:'openid email profile stoneham-api/write',profile:{sub:'alice',name:'Alice'},expires_at:Math.floor(Date.now()/1000)+3600})))
  const record={id:'activity-fixture',name:'Activity reconciliation',grade:'V3',setter:'Alice',ownerId:'alice',wallVersionId:'2026-11-v8',createdAt:'2026-11-15',revision:1,commentCount:0,holds:[{holdId:holds[0].id,role:'start'},{holdId:holds[1].id,role:'finish'}]}
  let score=null,communityReads=0,activityReads=0
  await context.route(api+'/**',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname,send=(status,json)=>route.fulfill({status,json})
   if(path==='/v1/me')return send(200,{userId:'alice',isAdmin:false})
   if(path==='/v1/me/profile')return send(200,{displayName:'Alice',bio:''})
   if(path==='/v1/me/sends'||path==='/v1/me/problems')return send(200,{items:[]})
   if(path==='/v1/gyms/stoneham-crg/walls/spray-wall-1/problems')return send(200,{items:[record]})
   if(path==='/v1/problems/'+record.id)return send(200,record)
   if(path.endsWith('/creator-profile'))return send(200,{displayName:'Alice',bio:''})
   if(path.endsWith('/community')){communityReads++;return send(200,{ratingAverage:score,ratingCount:score===null?0:1,commentCount:0,comments:[]})}
   if(path.endsWith('/my-activity')){activityReads++;return send(200,{sent:false,rating:score,commentIds:[]})}
   if(path.endsWith('/rating')){score=req.postDataJSON().score;return send(200,{score})}
   if(path.endsWith('/versions'))return send(200,{items:[record]})
   throw Error('Unexpected request '+req.method()+' '+path)
  })
  const page=await context.newPage(),errors=[],warnings=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/same key|unique.*key/i.test(m.text()))warnings.push(m.text())})
  // A direct link starts without Explore's rating cache. Loading its activity
  // therefore causes a parent update, exposing collisions between sibling keys.
  await page.goto(app+'/?route='+record.id)
  await page.getByRole('heading',{name:record.name,exact:true,level:2}).waitFor()
  await page.getByRole('button',{name:'Rate 5 out of 5',exact:true}).first().waitFor()
  assert.equal(await page.getByRole('region',{name:'Route activity',exact:true}).count(),1)
  const panel=page.getByRole('region',{name:'Route activity',exact:true})
  await panel.getByText('Loading route activity…',{exact:true}).waitFor({state:'hidden'})
  for(const value of [5,2,4,1]){
   await panel.getByRole('button',{name:'Rate '+value+' out of 5',exact:true}).click()
   await panel.getByText(value.toFixed(1)+'/5 · 1 ratings',{exact:true}).waitFor()
   assert.equal(await page.locator('#route-activity').count(),1)
   assert.equal(await page.locator('.community-panel').count(),1)
   assert.equal(await page.locator('.route-versions').count(),1)
  }
  await page.locator('.route-versions summary').click();await page.getByText('No other versions available.',{exact:true}).waitFor()
  assert.equal(await page.locator('#route-activity').count(),1)
  assert.equal(await page.getByLabel('Your comment',{exact:true}).count(),1)
  assert.equal(await page.getByText('Loading route activity…',{exact:true}).count(),0)
  assert(communityReads<=8,'Activity should not continually remount: '+communityReads);assert(activityReads<=2,'Ownership should not reload after ratings: '+activityReads)
  assert.deepEqual(errors,[]);assert.deepEqual(warnings,[])
  console.log('PASS: direct-link activity loads once, stays a single panel through four parent rating updates and version-history expansion, no duplicate keys/IDs, no stuck loading or repeated ownership requests. Isolated fixtures only.')
 }finally{for(const c of browser.contexts())await c.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
