const assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const holds=require('../src/data/walls/2026-11-v7/holds.json'),api='https://kurd8a9bz9.execute-api.us-east-1.amazonaws.com'
const legacy=process.env.LEGACY_COMMENT_API==='1'
;(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.BROWSER_PROXY?{server:process.env.BROWSER_PROXY}:undefined})
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
  if(process.env.BROWSER_FETCH_PROXY==='1')await context.route('https://**/*',async route=>{try{await route.fulfill({response:await route.fetch()})}catch{await route.abort('failed').catch(()=>{})}})
  await context.addInitScript(()=>sessionStorage.setItem('oidc.user:https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fvraMpcpi:537q15f8r1ppgtpucjoa5pad1r',JSON.stringify({access_token:'comments-test-token',token_type:'Bearer',scope:'openid email profile stoneham-api/write',profile:{sub:'alice',name:'Alice'},expires_at:Math.floor(Date.now()/1000)+3600})))
  const records=[{id:'many',name:'G.E.R.D',commentCount:23},{id:'empty',name:'No discussion yet',commentCount:0},{id:'long',name:'A very long route name that wraps on a small phone screen',commentCount:legacy?3:1013}].map(record=>({...record,grade:'V6',setter:'Guest setter',ownerId:'alice',revision:1,createdAt:'2026-11-01',wallVersionId:'2026-11-v7',holds:[{holdId:holds[0].id,role:'start'},{holdId:holds[1].id,role:'finish'}]}))
  const comments=Array.from({length:23},(_,index)=>({id:'c'+index,author:'Bob',text:'Comment '+index,createdAt:'2026-11-01'}))
  let own=[],failPost=true,failDelete=true,postIds=[],listRequests=0,communityRequests=0
  await context.route(api+'/**',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method()
   const omitCount=value=>{const {commentCount,...rest}=value;return rest}
   const send=(status,json)=>route.fulfill({status,json:legacy?(Array.isArray(json.items)?{...json,items:json.items.map(omitCount)}:omitCount(json)):json})
   if(path==='/v1/me')return send(200,{userId:'alice',isAdmin:false})
   if(path==='/v1/me/profile')return send(200,{displayName:'Alice',bio:''})
   if(path.endsWith('/creator-profile')||path.endsWith('/author-profile'))return send(200,{displayName:'Alice',bio:''})
   if(path==='/v1/gyms/stoneham-crg/walls/spray-wall-1/problems'){listRequests++;return send(200,{items:records})}
   const match=path.match(/^\/v1\/problems\/([^/]+)(?:\/(.*))?$/);assert(match,'Unexpected API path')
   const record=records.find(record=>record.id===match[1]),action=match[2];assert(record)
   if(!action)return send(200,record)
   if(action==='community'){
    communityRequests++
    const rows=record.id==='many'?comments:record.id==='long'?comments.slice(0,3):own,older=url.searchParams.has('cursor')
    return send(200,{ratingAverage:null,ratingCount:0,commentCount:record.commentCount,comments:older?rows.slice(20):rows.slice(0,20),...(!older&&rows.length>20?{nextCursor:'older'}:{})})
   }
   assert.equal(req.headers().authorization,'Bearer comments-test-token')
   if(action==='my-activity')return send(200,{sent:false,rating:null,commentIds:record.id==='empty'?own.map(comment=>comment.id):[]})
   if(action==='comments'){
    const body=req.postDataJSON();postIds.push(body.requestId)
    let added=own.find(comment=>comment.id===body.requestId)
    if(!added){added={id:body.requestId,text:body.text,author:'Alice',createdAt:'2026-11-01'};own.push(added);record.commentCount=own.length}
    if(failPost){failPost=false;return route.abort('failed')}
    return send(200,{...added,commentCount:record.commentCount})
   }
   if(action.startsWith('comments/')){
    const id=action.split('/')[1],comment=own.find(comment=>comment.id===id)
    if(method==='PATCH'){Object.assign(comment,{text:req.postDataJSON().text,updatedAt:'2026-11-02'});return send(200,{...comment,commentCount:record.commentCount})}
    if(failDelete){failDelete=false;return send(503,{error:'Delete failed; retry'})}
    own=own.filter(comment=>comment.id!==id);record.commentCount=own.length
    return send(200,{deleted:true,commentCount:record.commentCount})
   }
   throw Error('Unexpected action '+action)
  })
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
  const drawer=page.getByRole('dialog',{name:'Explore routes',exact:true}),activity=page.getByRole('region',{name:'Route activity'})
  const explore=async()=>{await page.getByRole('button',{name:'Explore routes',exact:true}).click();await drawer.locator('.problem-card').first().waitFor()}
  const card=name=>drawer.locator('.problem-card').filter({has:page.getByText(name,{exact:true})})
  await page.goto(process.env.APP_URL||'http://localhost:5191');await page.getByLabel('Account menu',{exact:true}).waitFor();await explore()
  await card('G.E.R.D').getByRole('img',{name:'23 comments',exact:true}).waitFor()
  assert.equal(await card('No discussion yet').locator('.route-comment-count').count(),0)
  await card(records[2].name).getByRole('img',{name:(legacy?'3':'1013')+' comments',exact:true}).waitFor()
  if(!legacy)assert.equal(communityRequests,0,'Server totals should not fetch activity per route')
  const loadedListRequests=listRequests
  await drawer.evaluate(element=>Promise.all(element.getAnimations().map(animation=>animation.finished)))
  for(const width of [320,390,980]){await page.setViewportSize({width,height:844});assert(await drawer.evaluate(element=>element.scrollWidth<=element.clientWidth));const title=card(records[2].name);assert(await title.locator('.route-comment-count').isVisible())}
  await page.setViewportSize({width:390,height:844})
  require('node:fs').mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/route-comment-counts-mobile.png'})
  await card('G.E.R.D').click();await activity.locator('.comments-list article').nth(19).waitFor();assert.equal(await activity.locator('.comments-list article').count(),20)
  await activity.getByRole('button',{name:'More comments',exact:true}).click();await activity.locator('.comments-list article').nth(22).waitFor()
  await explore();await card('G.E.R.D').getByRole('img',{name:'23 comments',exact:true}).waitFor()
  await card('No discussion yet').click();await activity.getByText('No comments yet.',{exact:true}).waitFor()
  await activity.getByLabel('Your comment',{exact:true}).fill('Nice route')
  await activity.getByRole('button',{name:'Post comment',exact:true}).click();await activity.getByRole('alert').filter({hasText:'Could not connect'}).waitFor()
  await activity.getByRole('button',{name:'Post comment',exact:true}).click();await activity.getByText('Nice route',{exact:true}).waitFor();assert.equal(postIds.length,2);assert.equal(postIds[0],postIds[1])
  await explore();await card('No discussion yet').getByRole('img',{name:'1 comment',exact:true}).waitFor();assert.equal(listRequests,loadedListRequests,'Confirmed comments should update the existing route list')
  await drawer.getByRole('button',{name:'Close routes',exact:true}).click()
  await activity.getByRole('button',{name:'Edit comment',exact:true}).click();await activity.getByLabel('Edit your comment',{exact:true}).fill('Revised comment')
  await activity.getByRole('button',{name:'Save comment',exact:true}).click();await activity.getByText('Revised comment',{exact:true}).waitFor()
  await activity.getByRole('button',{name:'Delete comment',exact:true}).click();await activity.getByRole('button',{name:'Confirm delete',exact:true}).click();await activity.getByRole('alert').filter({hasText:'Delete failed; retry'}).waitFor()
  await explore();await card('No discussion yet').getByRole('img',{name:'1 comment',exact:true}).waitFor();await drawer.getByRole('button',{name:'Close routes',exact:true}).click()
  await activity.getByRole('button',{name:'Confirm delete',exact:true}).click();await activity.getByText('No comments yet.',{exact:true}).waitFor()
  await explore();assert.equal(await card('No discussion yet').locator('.route-comment-count').count(),0);await card('G.E.R.D').getByRole('img',{name:'23 comments',exact:true}).waitFor()
  assert.equal(listRequests,loadedListRequests);assert.deepEqual(errors,[])
  console.log('PASS: comment badges show total counts, hide zero, fit long mobile titles, survive comment pagination, and update after add/edit/delete with failure/retry safety. Server-total and legacy-page compatibility; no production writes.')
 }finally{for(const context of browser.contexts())await context.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
