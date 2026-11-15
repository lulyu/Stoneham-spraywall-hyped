const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright'),assert=require('node:assert/strict')
const api='https://kurd8a9bz9.execute-api.us-east-1.amazonaws.com',app=process.env.APP_URL||'http://127.0.0.1:5181'
;(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']})
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
  await context.addInitScript(()=>sessionStorage.setItem('oidc.user:https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fvraMpcpi:537q15f8r1ppgtpucjoa5pad1r',JSON.stringify({access_token:'family-profile',token_type:'Bearer',scope:'openid email profile stoneham-api/write',profile:{sub:'alice',name:'Alice'},expires_at:Math.floor(Date.now()/1000)+3600})))
  const make=(id,extra={})=>({id,name:id,grade:'V3',setter:'Alice',holds:[],createdAt:'2026-11-15',ownerId:'alice',revision:1,...extra})
  const versions=Array.from({length:10},(_,i)=>make('Family V'+(10-i),{upgradeRootId:'root',upgradeNumber:10-i})),other=Array.from({length:7},(_,i)=>make('Other '+i)),records=[...versions,...other]
  let pages=0;const cursors=[]
  await context.route(api+'/**',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname;assert.equal(req.method(),'GET')
   const send=json=>route.fulfill({status:200,json})
   if(path==='/v1/me')return send({userId:'alice',isAdmin:false})
   if(path==='/v1/me/profile')return send({displayName:'Alice',bio:''})
   if(path==='/v1/me/sends')return send({items:[]})
   if(path==='/v1/me/problems'){pages++;cursors.push(url.searchParams.get('cursor')??'0');const start=Number(url.searchParams.get('cursor')??0);return send({items:records.slice(start,start+5),...(start+5<records.length?{nextCursor:String(start+5)}:{})})}
   if(path.endsWith('/problems'))return send({items:[]})
   throw Error('Unexpected '+path)
  })
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(app)
  await page.getByLabel('Account menu',{exact:true}).click();await page.getByRole('button',{name:'Profile · Alice',exact:true}).click()
  const list=page.getByRole('region',{name:'My routes',exact:true});await list.locator('.problem-card').nth(4).waitFor()
  assert.equal(await list.locator('.problem-card').count(),5);assert.deepEqual([...new Set(cursors)],['0','5','10']);assert(pages<=4)
  assert.deepEqual(await list.locator('.problem-copy strong').allTextContents(),['Family V10','Other 0','Other 1','Other 2','Other 3'])
  await list.getByRole('button',{name:'Load more',exact:true}).click();await list.locator('.problem-card').nth(7).waitFor()
  assert.equal(await list.locator('.problem-card').count(),8);assert.deepEqual([...new Set(cursors)],['0','5','10','15']);assert(pages<=5);assert.equal(await list.getByRole('button',{name:'Load more',exact:true}).count(),0)
  assert.deepEqual(errors,[]);console.log('PASS grouped profile: fills exactly five families across version-only pages, keeps latest V10, retains over-fetched families, then Load more shows the remaining groups without duplicates. No writes.')
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
