const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright')
const fs=require('node:fs'),assert=require('node:assert/strict')
const base=process.env.APP_URL||'http://127.0.0.1:8793'
const legacyText=fs.readFileSync(process.env.LEGACY_CHECKPOINT||'/tmp/stoneham-quota-legacy.json','utf8')
const legacy=JSON.parse(legacyText),key='stoneham-wall-review-v1:'+legacy.session.sessionId

async function main(){
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.BROWSER_PROXY?{server:process.env.BROWSER_PROXY}:undefined})
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  if(process.env.BROWSER_FETCH_PROXY==='1')await context.route('https://**/*',async route=>route.fulfill({response:await route.fetch()}))
  if(process.env.AUTH_KEY_FILE)await page.goto(base+'/auth?key='+encodeURIComponent(fs.readFileSync(process.env.AUTH_KEY_FILE,'utf8').trim()))
  await page.goto(base+'/?annotate=1&review=1')
  const filled=await page.evaluate(({key,legacyText})=>{
   localStorage.setItem(key,legacyText)
   let filler='',quota=false
   for(let i=0;i<1000;i++)try{filler+='x'.repeat(16384);localStorage.setItem('quota-test-filler',filler)}catch(e){quota=e.name==='QuotaExceededError';break}
   return {quota,fillerLength:localStorage.getItem('quota-test-filler').length}
  },{key,legacyText})
  assert(filled.quota,'Test must reproduce localStorage quota exhaustion')
  const open=async target=>{await target.getByRole('button',{name:'Open local server scan',exact:true}).click();await target.getByRole('heading',{name:'Review & annotate',exact:true}).waitFor({timeout:90000})}
  const state=()=>page.evaluate(key=>new Promise((resolve,reject)=>{
   const r=indexedDB.open('stoneham-wall-reviews',1)
   r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,q=db.transaction('checkpoints').objectStore('checkpoints').get(key);q.onsuccess=()=>{db.close();resolve(q.result.review)};q.onerror=()=>{db.close();reject(q.error)}}
  }),key)
  await open(page)
  assert.equal((await state()).reviewRevision,legacy.reviewRevision)
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),legacyText,'Legacy checkpoint stays byte-for-byte intact')
  const bulk=page.getByRole('button',{name:/^Confirm eligible SAM2 outlines/})
  assert(!await bulk.isDisabled());await bulk.click()
  await page.waitForFunction(()=>document.querySelector('.review-badge')?.textContent?.match(/revision ([2-9]|[1-9]\d+)/),{},{timeout:120000})
  const batch=await state();assert(batch.reviewRevision>legacy.reviewRevision)
  assert.equal(await page.evaluate(()=>localStorage.getItem('quota-test-filler').length),filled.fillerLength)
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),legacyText)
  await page.reload();await open(page);assert.equal((await state()).reviewRevision,batch.reviewRevision)
  await page.getByRole('button',{name:'Next pending hold',exact:true}).click()
  await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;window.restoreReviewPut=()=>{IDBObjectStore.prototype.put=original};IDBObjectStore.prototype.put=function(...args){if(this.name==='checkpoints')throw new DOMException('Injected storage quota failure','QuotaExceededError');return original.apply(this,args)}})
  await page.getByRole('button',{name:'Confirm',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'Injected storage quota failure'}).waitFor()
  assert.equal((await state()).reviewRevision,batch.reviewRevision,'Failed IDB transaction cannot advance persistent progress')
  await page.evaluate(()=>window.restoreReviewPut())
  await page.getByRole('button',{name:'Confirm',exact:true}).click()
  await page.waitForFunction(rev=>document.querySelector('.review-badge')?.textContent?.endsWith('revision '+rev),batch.reviewRevision+1)
  const saved=await state();assert.equal(saved.reviewRevision,batch.reviewRevision+1)
  const second=await context.newPage();await second.goto(base+'/?annotate=1&review=1');await open(second)
  await page.getByRole('button',{name:'Next pending hold',exact:true}).click();await page.getByRole('button',{name:'Confirm',exact:true}).click()
  await page.waitForFunction(rev=>document.querySelector('.review-badge')?.textContent?.endsWith('revision '+rev),saved.reviewRevision+1)
  await second.getByRole('button',{name:'Next pending hold',exact:true}).click();await second.getByRole('button',{name:'Confirm',exact:true}).click()
  await second.getByRole('alert').filter({hasText:'Another tab changed this scan'}).waitFor()
  assert.equal((await state()).reviewRevision,saved.reviewRevision+1)
  await page.getByText('Session, reviewer & backups',{exact:true}).click()
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export progress',exact:true}).click()
  const file=await download;await file.saveAs('/tmp/stoneham-quota-export.json')
  assert.equal(JSON.parse(fs.readFileSync('/tmp/stoneham-quota-export.json')).reviewRevision,saved.reviewRevision+1)
  assert.deepEqual(errors,[])
  console.log('PASS: real localStorage quota, lossless legacy migration, batch save/reload/export via IndexedDB, failed transaction rollback/retry, stale-tab protection; legacy data and filler unchanged.')
 }finally{await browser.close()}
}
main().catch(e=>{console.error(String(e.stack||e).replace(/([?&]key=)[A-Za-z0-9_-]+/g,'$1[redacted]'));process.exitCode=1})
