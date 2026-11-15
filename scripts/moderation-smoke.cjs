const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const assert=require('node:assert/strict'),fs=require('node:fs')
const api='https://kurd8a9bz9.execute-api.us-east-1.amazonaws.com',base=process.env.APP_URL||'http://127.0.0.1:5181'
;(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']})
 try{
  for(const isAdmin of [true,false]){
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
   await context.addInitScript(()=>sessionStorage.setItem('oidc.user:https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fvraMpcpi:537q15f8r1ppgtpucjoa5pad1r',JSON.stringify({access_token:'moderation-fixture',token_type:'Bearer',scope:'openid email profile stoneham-api/write',profile:{sub:'moderator',name:'Moderator'},expires_at:Math.floor(Date.now()/1000)+3600})))
   const writes=[],reads=[];let hidden=false,banned=false,commentHidden=false,fail=false
   await context.route(api+'/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method()
    const send=(status,json)=>route.fulfill({status,json})
    if(path==='/v1/me')return send(200,{userId:'moderator',isAdmin})
    if(path==='/v1/me/profile')return send(200,{displayName:'Moderator',bio:''})
    if(path==='/v1/me/problems'||path==='/v1/me/sends'||path.endsWith('/problems'))return send(200,{items:[]})
    if(path==='/v1/admin/moderation'){
     assert(isAdmin);assert.equal(request.headers().authorization,'Bearer moderation-fixture');reads.push(url.searchParams.get('kind'))
     const kind=url.searchParams.get('kind')
     if(kind==='routes')return send(200,url.searchParams.has('cursor')?{items:[{id:'spam',name:'Spam route',userId:'rando',hidden}]}:{items:[],nextCursor:'empty-page'})
     if(kind==='comments')return send(200,{items:[{id:'comment',problemId:'spam',text:'Suspicious comment',author:'Rando',userId:'rando',hidden:commentHidden}]})
     return send(200,{items:[{userId:'rando',banned,reason:'Spam'}]})
    }
    if(path.startsWith('/v1/admin/')&&method==='PATCH'){
     assert(isAdmin);assert.equal(request.headers().authorization,'Bearer moderation-fixture')
     const body=request.postDataJSON();assert(body.reason.trim());writes.push({path,body})
     if(fail){fail=false;return send(503,{error:'Temporary failure'})}
     if(path.endsWith('/access'))banned=body.banned
     else if(path.includes('/comments/'))commentHidden=body.hidden
     else hidden=body.hidden
     return send(200,{hidden,banned})
    }
    throw Error('Unexpected fixture request: '+method+' '+path)
   })
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base)
   await page.getByLabel('Account menu',{exact:true}).click();await page.getByRole('button',{name:'Profile · Moderator',exact:true}).click()
   const panel=page.getByRole('region',{name:'Admin moderation',exact:true})
   if(!isAdmin){assert.equal(await panel.count(),0);assert.equal(reads.length,0);await context.close();continue}
   await panel.getByRole('button',{name:'Admin moderation',exact:true}).click()
   await panel.getByRole('button',{name:'Load more moderation',exact:true}).click();await panel.getByText('Spam route',{exact:true}).waitFor()
   await panel.getByRole('button',{name:'Hide',exact:true}).click();assert(await panel.getByRole('button',{name:'Confirm moderation',exact:true}).isDisabled())
   await panel.getByLabel('Reason',{exact:true}).fill('Spam posting');fail=true
   await panel.getByRole('button',{name:'Confirm moderation',exact:true}).click();await panel.getByText('Temporary failure',{exact:true}).waitFor();assert.equal(await panel.getByLabel('Reason',{exact:true}).inputValue(),'Spam posting')
   await panel.getByRole('button',{name:'Confirm moderation',exact:true}).click();await panel.getByText('Saved: Hide: Spam route',{exact:true}).waitFor();assert(hidden)
   await panel.getByRole('button',{name:'Load more moderation',exact:true}).click();await panel.getByRole('button',{name:'Restore',exact:true}).click();await panel.getByLabel('Reason',{exact:true}).fill('Appeal accepted');await panel.getByRole('button',{name:'Confirm moderation',exact:true}).click();await panel.getByText('Saved: Restore: Spam route',{exact:true}).waitFor();assert(!hidden)
   await panel.getByLabel('Content',{exact:true}).selectOption('comments');await panel.getByText('Suspicious comment',{exact:true}).waitFor()
   await panel.getByRole('button',{name:'Hide',exact:true}).click();await panel.getByLabel('Reason',{exact:true}).fill('Spam comment');await panel.getByRole('button',{name:'Confirm moderation',exact:true}).click();await panel.getByRole('button',{name:'Restore',exact:true}).waitFor();assert(commentHidden)
   await panel.getByRole('button',{name:'Suspend account',exact:true}).click();await panel.getByLabel('Reason',{exact:true}).fill('Repeated spam');await panel.getByRole('button',{name:'Confirm moderation',exact:true}).click();await panel.getByText('Saved: Suspend account: rando',{exact:true}).waitFor();assert(banned)
   await panel.getByLabel('Content',{exact:true}).selectOption('users');await panel.getByRole('button',{name:'Unban account',exact:true}).click();await panel.getByLabel('Reason',{exact:true}).fill('Resolved');await panel.getByRole('button',{name:'Confirm moderation',exact:true}).click();await panel.getByText('Allowed',{exact:true}).waitFor();assert(!banned)
   for(const width of [320,390,980]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))}
   fs.mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/admin-moderation-mobile.png',fullPage:true})
   assert.equal(writes.length,6);assert.deepEqual(errors,[]);await context.close()
  }
  console.log('PASS mobile moderation: administrator-only panel, empty-page pagination, reason confirmation, failure retry, hide/restore routes and comments, suspend/unban, narrow layouts, no production writes.')
 }finally{for(const c of browser.contexts())await c.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
