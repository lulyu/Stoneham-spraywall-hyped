const assert=require('node:assert/strict')
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const holds=require('../src/data/polygons/holds.json')
const api='https://kurd8a9bz9.execute-api.us-east-1.amazonaws.com'

async function openRoutes(page) {
  if (await page.locator('.account-menu[open]').count()) await page.getByLabel('Account menu', { exact: true }).click()
  if (!await page.getByRole('dialog', { name: 'Explore routes' }).isVisible())
    await page.getByRole('button', { name: 'Explore routes' }).click()
}
async function closeRoutes(page) {
  await page.getByText('Opening problem…', { exact: true }).waitFor({ state: 'hidden' })
  if (await page.getByRole('dialog', { name: 'Explore routes' }).isVisible())
    await page.getByRole('button', { name: 'Close routes' }).click()
}
async function openAccount(page) {
  await closeRoutes(page)
  const menu = page.locator('.account-menu')
  await menu.waitFor()
  if (await menu.getAttribute('open') === null) await page.getByLabel('Account menu', { exact: true }).click()
}
;(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.BROWSER_PROXY?{server:process.env.BROWSER_PROXY}:undefined})
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
  await context.addInitScript(()=>sessionStorage.setItem('oidc.user:https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fvraMpcpi:537q15f8r1ppgtpucjoa5pad1r',JSON.stringify({
   access_token:'community-test-token',token_type:'Bearer',scope:'openid email profile stoneham-api/write',
   profile:{sub:'alice',name:'Alice',email:'alice@example.com'},expires_at:Math.floor(Date.now()/1000)+3600
  })))
  const records=['p1','p2','p3'].map((id,i)=>({id,name:['Route one','Route two','Older route'][i],grade:'V4',setter:'Setter',ownerId:'alice',revision:1,createdAt:'2026-11-03',holds:[{holdId:holds[0].id,role:'start'},{holdId:holds[1].id,role:'finish'}]}))
  const sends=new Map(),ratings=new Map(),comments=new Map()
  let failSend=true,failComment=true,failEdit=true,failDelete=true,sendAttempts=0,commentAttempts=0
  const mock=async route=>{
   const req=route.request(),method=req.method(),url=new URL(req.url()),path=url.pathname
   const send=(status,body)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)})
   if(path.endsWith('/creator-profile')||path.endsWith('/author-profile'))return send(200,{displayName:'Alice',bio:'Enjoys slabs.'})
   if(path==='/v1/me')return send(200,{userId:'alice',isAdmin:false})
   if(path==='/v1/me/profile')return send(200,{displayName:'Alice',bio:''})
   if(path==='/v1/me/sends'){
    assert.equal(req.headers().authorization,'Bearer community-test-token')
    return send(200,{items:[...sends.values()]})
   }
   if(path.endsWith('/versions/2026-10-v4/problems'))return send(200,{items:records.slice(0,2)})
   const match=path.match(/\/problems\/(p\d)(?:\/(.+))?$/)
   if(!match)throw new Error('Unexpected path '+path)
   const [,id,action]=match
   if(!action)return send(200,records.find(r=>r.id===id))
   if(action==='community')return send(200,{ratingAverage:ratings.get(id)||null,ratingCount:ratings.has(id)?1:0,comments:comments.get(id)||[]})
   assert.equal(req.headers().authorization,'Bearer community-test-token')
   if(action==='my-activity')return send(200,{sent:sends.has(id),sentAt:sends.get(id)?.sentAt,rating:ratings.get(id)||null,commentIds:(comments.get(id)||[]).filter(c=>c.author==='Alice').map(c=>c.id)})
   if(action==='sends'){
    sendAttempts++
    if(!sends.has(id))sends.set(id,{problemId:id,...records.find(r=>r.id===id),sentAt:'2026-11-03T12:00:00Z'})
    if(failSend){failSend=false;return route.abort('failed')}
    return send(200,sends.get(id))
   }
   if(action==='rating'){ratings.set(id,req.postDataJSON().score);return send(200,{score:ratings.get(id)})}
   if(action.startsWith('comments/')){
    const commentId=action.slice('comments/'.length),list=comments.get(id)||[],existing=list.find(c=>c.id===commentId)
    if(method==='PATCH'){
     if(failEdit){failEdit=false;return send(503,{error:'Edit failed; retry'})}
     Object.assign(existing,{text:req.postDataJSON().text,updatedAt:'2026-11-03T12:02:00Z'})
     return send(200,existing)
    }
    if(method==='DELETE'){
     if(failDelete){failDelete=false;return send(503,{error:'Delete failed; retry'})}
     comments.set(id,list.filter(c=>c.id!==commentId));return send(200,{deleted:true})
    }
   }
   if(action==='comments'){
    commentAttempts++
    const body=req.postDataJSON(),list=comments.get(id)||[]
    let saved=list.find(c=>c.id===body.requestId)
    if(!saved){saved={id:body.requestId,text:body.text,author:'Alice',createdAt:'2026-11-03T12:01:00Z'};comments.set(id,[saved,...list])}
    if(failComment){failComment=false;return route.abort('failed')}
    return send(200,saved)
   }
   throw new Error('Unexpected action '+action)
  }
  await context.route(api+'/**',mock)
  const page=await context.newPage();page.setDefaultTimeout(15000)
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(process.env.APP_URL||'http://localhost:5178')
  await openAccount(page)
  await page.getByRole('button',{name:'Profile · Alice',exact:true}).waitFor()
  await openRoutes(page)
  await page.locator('.problem-card').filter({hasText:'Route one'}).click()
  const panel=page.getByRole('region',{name:'Route activity'})
  await panel.getByRole('button',{name:'Log send',exact:true}).click()
  await panel.getByRole('alert').filter({hasText:'Could not connect'}).waitFor()
  await panel.getByRole('button',{name:'Log send',exact:true}).click()
  await panel.getByRole('button',{name:'Send logged',exact:true}).waitFor()
  assert(await panel.getByRole('button',{name:'Send logged',exact:true}).isDisabled())
  assert.equal(sends.size,1);assert.equal(sendAttempts,2)
  assert.equal(await panel.locator('.rating-star.is-filled').count(),0)
  assert.equal(await panel.locator('.rating-stars svg path[fill="none"]').count(),5)
  await panel.getByRole('button',{name:'Rate 4 out of 5',exact:true}).click()
  await panel.getByText('4.0/5 · 1 ratings',{exact:true}).waitFor()
  assert.equal(await panel.locator('.rating-star.is-filled').count(),4)
  assert.equal(await panel.locator('.rating-stars svg path[fill="none"]').count(),1)
  await panel.getByRole('button',{name:'Rate 5 out of 5',exact:true}).click()
  await panel.getByText('5.0/5 · 1 ratings',{exact:true}).waitFor()
  assert.equal(await panel.locator('.rating-star.is-filled').count(),5)
  await panel.getByRole('button',{name:'Rate 2 out of 5',exact:true}).click()
  await panel.getByText('2.0/5 · 1 ratings',{exact:true}).waitFor()
  assert.equal(await panel.locator('.rating-star.is-filled').count(),2)
  await panel.getByRole('button',{name:'Rate 5 out of 5',exact:true}).click()
  await panel.getByText('5.0/5 · 1 ratings',{exact:true}).waitFor()
  const text='Great footwork! <img src=x onerror="throw 1">'
  await panel.getByLabel('Your comment',{exact:true}).fill(text)
  await panel.getByRole('button',{name:'Post comment',exact:true}).click()
  await panel.getByRole('alert').filter({hasText:'Could not connect'}).waitFor()
  assert.equal(await panel.getByLabel('Your comment',{exact:true}).inputValue(),text)
  await panel.getByRole('button',{name:'Post comment',exact:true}).click()
  await panel.getByText(text,{exact:true}).waitFor()
  assert.equal(comments.get('p1').length,1);assert.equal(commentAttempts,2)
  assert.equal(await panel.locator('article img').count(),0)
  await page.reload()
  await openRoutes(page)
  await page.locator('.problem-card').filter({hasText:'Route one'}).click()
  await panel.getByRole('button',{name:'Send logged',exact:true}).waitFor()
  assert.equal(await panel.getByRole('button',{name:'Rate 5 out of 5'}).getAttribute('aria-pressed'),'true')
  const own=panel.locator('article').filter({hasText:text})
  await own.getByRole('button',{name:'Edit comment',exact:true}).click()
  await own.getByLabel('Edit your comment',{exact:true}).fill('Cancelled edit')
  await panel.getByRole('button',{name:'Cancel edit',exact:true}).click()
  await own.getByText(text,{exact:true}).waitFor()
  await own.getByRole('button',{name:'Edit comment',exact:true}).click()
  await panel.getByLabel('Edit your comment',{exact:true}).fill('Updated footwork advice')
  await panel.getByRole('button',{name:'Save comment',exact:true}).click()
  await panel.getByRole('alert').filter({hasText:'Edit failed'}).waitFor()
  assert.equal(await panel.getByLabel('Edit your comment',{exact:true}).inputValue(),'Updated footwork advice')
  await panel.getByRole('button',{name:'Save comment',exact:true}).click()
  const revised=panel.locator('article').filter({hasText:'Updated footwork advice'})
  await revised.getByText('· Edited',{exact:true}).waitFor()
  await page.reload()
  await openRoutes(page)
  await page.locator('.problem-card').filter({hasText:'Route one'}).click()
  await revised.getByRole('button',{name:'Delete comment',exact:true}).click()
  await revised.getByRole('button',{name:'Keep comment',exact:true}).click()
  assert.equal(comments.get('p1').length,1)
  await revised.getByRole('button',{name:'Delete comment',exact:true}).click()
  await revised.getByRole('button',{name:'Confirm delete',exact:true}).click()
  await panel.getByRole('alert').filter({hasText:'Delete failed'}).waitFor()
  await revised.getByRole('button',{name:'Confirm delete',exact:true}).click()
  await revised.waitFor({state:'detached'})
  assert.equal(comments.get('p1').length,0)
  comments.set('p1',[{id:'bob-comment',text:'Another climber comment',author:'Bob',createdAt:'2026-11-03'}])
  await page.reload()
  await openRoutes(page)
  await page.locator('.problem-card').filter({hasText:'Route one'}).click()
  await panel.getByText('Another climber comment',{exact:true}).waitFor()
  assert.equal(await panel.getByRole('button',{name:'Edit comment',exact:true}).count(),0)
  assert.equal(await panel.getByRole('button',{name:'Delete comment',exact:true}).count(),0)
  await openRoutes(page)
  await page.locator('.problem-card').filter({hasText:'Route two'}).click()
  await panel.getByRole('button',{name:'Log send',exact:true}).waitFor()
  assert.equal(await panel.getByText(text,{exact:true}).count(),0)
  sends.set('p3',{problemId:'p3',...records[2],sentAt:'2026-10-30T00:00:00Z'})
  await openAccount(page)
  await page.getByRole('button',{name:'Profile · Alice',exact:true}).click()
  const history=page.getByRole('region',{name:'Your sends'})
  await history.getByRole('button').filter({hasText:'Route one'}).waitFor()
  await history.getByRole('button').filter({hasText:'Older route'}).click()
  await panel.getByRole('heading',{name:'Older route',exact:true}).waitFor()
  for(const width of [320,390,680,980]){
   await page.setViewportSize({width,height:844})
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width)
  }
  const anon=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
  await anon.route(api+'/**',mock)
  const guest=await anon.newPage()
  await guest.goto(process.env.APP_URL||'http://localhost:5178')
  await openRoutes(guest)
  await guest.locator('.problem-card').filter({hasText:'Route one'}).click()
  const guestPanel=guest.getByRole('region',{name:'Route activity'})
  await guestPanel.getByRole('button',{name:'Sign in to log a send, rate or comment',exact:true}).waitFor()
  assert.equal(await guestPanel.getByRole('button',{name:'Log send',exact:true}).count(),0)
  await guestPanel.getByText('Another climber comment',{exact:true}).waitFor()
  assert.equal(await guestPanel.getByRole('button',{name:'Edit comment',exact:true}).count(),0)
  assert.equal(await guestPanel.getByRole('button',{name:'Delete comment',exact:true}).count(),0)
  assert.deepEqual(errors,[])
  console.log('PASS: logged-in send/rating/comment persistence, idempotent network retries, literal comment rendering, route isolation, profile send history/deep-open, anonymous read-only, own-comment edit/delete/cancel/reload/failure retries, other-author isolation and 320–980px layout')
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
