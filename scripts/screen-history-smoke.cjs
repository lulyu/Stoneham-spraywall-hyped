const assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const fresh=require('../src/data/walls/2026-11-v7/holds.json'),old=require('../src/data/polygons/holds.json')
const ids=new Set(fresh.map(hold=>hold.id)),shared=old.filter(hold=>ids.has(hold.id)),removed=old.find(hold=>!ids.has(hold.id))
const api='https://kurd8a9bz9.execute-api.us-east-1.amazonaws.com',app=process.env.APP_URL||'http://localhost:5194'
;(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.BROWSER_PROXY?{server:process.env.BROWSER_PROXY}:undefined})
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
  if(process.env.BROWSER_FETCH_PROXY==='1')await context.route('https://**/*',async route=>{try{await route.fulfill({response:await route.fetch()})}catch{await route.abort('failed').catch(()=>{})}})
  await context.addInitScript(()=>{
   const sub=localStorage.getItem('navigation-test-user')||'alice'
   sessionStorage.setItem('oidc.user:https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fvraMpcpi:537q15f8r1ppgtpucjoa5pad1r',JSON.stringify({access_token:'navigation-'+sub,token_type:'Bearer',scope:'openid email profile stoneham-api/write',profile:{sub,name:sub},expires_at:Math.floor(Date.now()/1000)+3600}))
  })
  const records=Array.from({length:60},(_,index)=>({id:'r'+index,name:'Route '+index,grade:'V3',setter:'Guest',ownerId:'alice',createdAt:'2026-11-01',revision:1,commentCount:0,wallVersionId:'2026-10-v4',holds:[{holdId:shared[0].id,role:'start'},{holdId:shared[1].id,role:'finish'},...(index===45?[{holdId:removed.id,role:'foot-only'}]:[])]}))
  let delayedRoute=null,releaseRoute,delayedSave=false,releaseSave,writes=0
  await context.route('https://before-app.example/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Previous website</h1>'}))
  await context.route(api+'/**',async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname,user=request.headers().authorization?.replace('Bearer navigation-','')
   const send=(status,json)=>route.fulfill({status,json})
   if(path==='/v1/me')return send(200,{userId:user,isAdmin:false})
   if(path==='/v1/me/profile')return send(200,{displayName:user,bio:''})
   if(path==='/v1/me/sends')return send(200,{items:[]})
   if(path==='/v1/me/problems'){
    const start=Number(url.searchParams.get('cursor')||0),own=user==='alice'?records.slice(0,12):[]
    return send(200,{items:own.slice(start,start+5),...(start+5<own.length?{nextCursor:String(start+5)}:{})})
   }
   if(path.endsWith('/creator-profile'))return send(200,{displayName:'alice',bio:''})
   if(path.endsWith('/community'))return send(200,{ratingAverage:null,ratingCount:0,commentCount:0,comments:[]})
   if(path.endsWith('/my-activity'))return send(200,{sent:false,rating:null,commentIds:[]})
   if(path.endsWith('/upgrade')){
    const source=records.find(record=>path.includes('/'+record.id+'/'))
    return send(200,{sourceId:source.id,sourceRevision:1,targetWallVersionId:'2026-11-v7',name:source.name+' V2',grade:'V3',setter:'Guest',holds:source.holds.filter(hold=>ids.has(hold.holdId)),removedHoldIds:[removed.id]})
   }
   if(path.endsWith('/problems')){
    if(request.method()==='POST'){
     writes++;const record={...request.postDataJSON(),id:'saved-'+writes,ownerId:user,createdAt:'2026-11-14',revision:1,wallVersionId:'2026-11-v7'}
     records.push(record)
     if(delayedSave)await new Promise(resolve=>{releaseSave=resolve})
     return send(201,record)
    }
    const start=Number(url.searchParams.get('cursor')||0)
    return send(200,{items:records.slice(start,start+30),...(start+30<records.length?{nextCursor:String(start+30)}:{})})
   }
   const record=records.find(record=>path.endsWith('/'+record.id))
   if(record&&request.method()==='PATCH'){Object.assign(record,request.postDataJSON(),{revision:record.revision+1});return send(200,record)}
   if(record?.id===delayedRoute)await new Promise(resolve=>{releaseRoute=resolve})
   return send(record?200:404,record||{error:'Missing route'})
  })
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
  const drawer=page.getByRole('dialog',{name:'Explore routes',exact:true}),profile=page.getByRole('region',{name:'Your profile',exact:true})
  const expectHome=async()=>{await page.waitForFunction(()=>history.state?.stonehamScreenV1?.screen==='home');assert.equal(new URL(page.url()).searchParams.get('route'),null);assert(!await drawer.isVisible());assert(!await profile.isVisible());assert.equal(await page.getByRole('region',{name:'Selected route',exact:true}).count(),0);assert.equal(await page.getByRole('group',{name:'Problem editor',exact:true}).count(),0)}
  const expectRoute=async name=>page.getByRole('heading',{name,exact:true,level:2}).waitFor()
  const explore=async()=>{await page.getByRole('button',{name:'Explore routes',exact:true}).click();await drawer.locator('.problem-card').first().waitFor()}
  const openProfile=async()=>{await page.getByLabel('Account menu',{exact:true}).click();await page.getByRole('button',{name:/^Profile · /}).click();await profile.waitFor()}
  const home=async()=>{await (await drawer.isVisible()?drawer:page.locator('.topbar')).getByRole('link',{name:'Home',exact:true}).click();await expectHome()}
  const selectHold=async(hold,role)=>{
   await page.getByRole('group',{name:'Hold role',exact:true}).getByRole('button',{name:role,exact:true}).click()
   const box=await page.locator('.wall-stage').boundingBox();await page.touchscreen.tap(box.x+box.width*hold.center[0],box.y+box.height*hold.center[1])
  }
  await page.goto('https://before-app.example/');await page.goto(app);await page.getByLabel('Account menu',{exact:true}).waitFor();await expectHome()
  await explore();await drawer.getByRole('button',{name:'Load more routes',exact:true}).click();await drawer.locator('.problem-card').nth(59).waitFor()
  const route45=drawer.locator('.problem-card').filter({has:page.getByText('Route 45',{exact:true})})
  await route45.scrollIntoViewIfNeeded();const scroll=await drawer.evaluate(element=>element.scrollTop)
  await route45.click();await expectRoute('Route 45');await page.getByText('Route only available on old version wall',{exact:true}).waitFor()
  await page.goBack();await drawer.waitFor();assert.equal(await drawer.locator('.problem-card').count(),60);assert(Math.abs(await drawer.evaluate(element=>element.scrollTop)-scroll)<5, JSON.stringify({before:scroll,after:await drawer.evaluate(element=>element.scrollTop)}))
  await page.goForward();await expectRoute('Route 45')
  await page.getByRole('button',{name:'Upgrade',exact:true}).click();await page.getByRole('button',{name:'Save upgraded route',exact:true}).waitFor()
  await page.goBack();await expectRoute('Route 45');await page.goForward();assert.equal(await page.getByLabel('Problem name',{exact:true}).inputValue(),'Route 45 V2')
  await home();await page.goForward();await drawer.waitFor();await home()
  await explore();await page.keyboard.press('Escape');await expectHome();await page.goForward();await drawer.waitFor();await drawer.getByRole('button',{name:'Close routes',exact:true}).click();await expectHome()
  await openProfile();await profile.getByLabel('Display name',{exact:true}).fill('Unsaved nickname')
  const mine=profile.getByRole('region',{name:'My routes',exact:true});await mine.locator('.problem-card').nth(4).waitFor();await mine.getByRole('button',{name:'Load more',exact:true}).click();await mine.locator('.problem-card').nth(9).waitFor()
  await mine.locator('.problem-card').filter({has:page.getByText('Route 8',{exact:true})}).click();await expectRoute('Route 8')
  await page.goBack();await profile.waitFor();assert.equal(await mine.locator('.problem-card').count(),10);assert.equal(await profile.getByLabel('Display name',{exact:true}).inputValue(),'Unsaved nickname')
  await profile.getByRole('button',{name:'Back to wall',exact:true}).click();await expectHome()
  await page.getByRole('button',{name:'＋ Set',exact:true}).click();await page.getByLabel('Problem name',{exact:true}).fill('Kept draft')
  await selectHold(fresh[0],'START');await selectHold(fresh[50],'FINISH');assert(await page.getByRole('button',{name:'Save problem',exact:true}).isEnabled())
  await page.goBack();await expectHome();await page.goForward();assert.equal(await page.getByLabel('Problem name',{exact:true}).inputValue(),'Kept draft');assert.equal(await page.locator('.hold-hit-polygon.is-selected').count(),2)
  assert(!await page.evaluate(()=>JSON.stringify(history.state).includes('Kept draft')))
  await openProfile();await page.goBack();assert.equal(await page.getByLabel('Problem name',{exact:true}).inputValue(),'Kept draft')
  await page.getByRole('button',{name:'Save problem',exact:true}).click();await expectRoute('Kept draft');assert.equal(writes,1)
  await page.goBack();await expectHome();await page.goForward();await expectRoute('Kept draft');assert.equal(await page.getByRole('group',{name:'Problem editor',exact:true}).count(),0)
  await page.getByRole('button',{name:'Edit problem',exact:true}).click();await page.getByLabel('Problem name',{exact:true}).fill('Updated draft')
  await page.getByRole('button',{name:'Save changes',exact:true}).click();await expectRoute('Updated draft');await page.goBack();await expectRoute('Updated draft');await home()
  await explore();delayedRoute='r0';await drawer.locator('.problem-card').filter({has:page.getByText('Route 0',{exact:true})}).click()
  await page.getByText('Opening problem…',{exact:true}).waitFor();await page.goBack();await expectHome();releaseRoute();delayedRoute=null
  await page.waitForTimeout(80);await expectHome()
  await page.getByRole('button',{name:'＋ Set',exact:true}).click();await page.getByLabel('Problem name',{exact:true}).fill('Background save')
  await selectHold(fresh[0],'START');await selectHold(fresh[50],'FINISH');delayedSave=true
  await page.getByRole('button',{name:'Save problem',exact:true}).click();await page.getByRole('button',{name:'Saving…',exact:true}).waitFor()
  await page.goBack();await expectHome();releaseSave();delayedSave=false
  await page.getByRole('button',{name:'＋ Set',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.home-actions button')?.disabled)
  await expectHome();await page.goForward();await expectRoute('Background save');assert.equal(writes,2);await home()
  await page.goBack();await page.getByRole('heading',{name:'Previous website',exact:true}).waitFor()
  const direct=await context.newPage();await direct.goto(app+'?route=r2');await direct.getByRole('heading',{name:'Route 2',exact:true,level:2}).waitFor()
  await direct.reload();await direct.getByRole('heading',{name:'Route 2',exact:true,level:2}).waitFor();await direct.goBack()
  await direct.waitForFunction(()=>history.state?.stonehamScreenV1?.screen==='home');assert.equal(new URL(direct.url()).pathname,new URL(app).pathname)
  assert.deepEqual(errors,[])
  console.log('PASS: browser Back/Forward, Explore pagination/scroll, old-wall route and Upgrade, preserved Profile and editor drafts, saved/background-save history, canceled stale requests, deep-link/reload Home, clickable Hyped and normal exit from Home. All writes isolated.')
 }finally{for(const context of browser.contexts())await context.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
