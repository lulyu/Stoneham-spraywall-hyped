// Run against npm run dev. Requires Playwright and a Chromium installation.
require('node:fs').mkdirSync('artifacts', { recursive: true });
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
 const page=await context.newPage();page.setDefaultTimeout(5000); const errors=[]; page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173');await page.locator('.wall-image').evaluate(async img=>{await img.decode();if(img.naturalWidth!==7292||img.naturalHeight!==5514)throw new Error('Canonical image dimensions mismatch')});await page.getByRole('button',{name:'＋ Set',exact:true}).tap();
 const hold=page.locator('.hold-hit-polygon').nth(0);const box=await hold.boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;
 await page.touchscreen.tap(x,y);await page.getByText('1 selected',{exact:true}).waitFor();
 const transform=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));return page.locator('.wall-stage').evaluate(e=>e.style.transform)};
 const initial=await transform();const cdp=await context.newCDPSession(page);
 const touch=async(type,points)=>{await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:1,radiusY:1}))});};
 await touch('touchStart',[[1,x,y]]);await touch('touchMove',[[1,x+40,y+20]]);await touch('touchEnd',[]);
 assert.notEqual(await transform(),initial);assert.equal(await page.locator('.selection-count').textContent(),'1 selected');
 await page.getByRole('button',{name:'Fit wall',exact:true}).tap();await page.waitForFunction(t=>document.querySelector('.wall-stage').style.transform===t,initial);assert.equal(await transform(),initial);
 await touch('touchStart',[[1,130,250],[2,230,250]]);await touch('touchMove',[[1,100,250],[2,260,250]]);await touch('touchEnd',[]);
 assert.notEqual(await transform(),initial);assert.equal(await page.locator('.selection-count').textContent(),'1 selected');
 await page.getByRole('button',{name:'Fit wall',exact:true}).tap();
 await page.getByRole('button',{name:'FINISH',exact:true}).tap();await page.locator('.hold-hit-polygon').nth(1).tap();await page.getByText('2 selected',{exact:true}).waitFor();
 await page.evaluate(()=>Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true}));await page.getByLabel('Problem name').fill('Mobile smoke test');await page.getByRole('button',{name:'Save problem',exact:true}).tap();await page.getByText('Mobile smoke test',{exact:true}).waitFor();assert.equal(await page.locator('.selected-hold').count(),2);
 await page.reload();await page.getByText('Mobile smoke test',{exact:true}).click();assert.equal(await page.locator('.selected-hold').count(),2);
 await page.screenshot({path:'artifacts/mobile-saved.png',fullPage:true});
 for(const width of [320,390,680,980]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width}`)}
 await page.evaluate(()=>localStorage.setItem('stoneham-spraywall:problems:v3','{"bad":true}'));await page.reload();await page.getByRole('button',{name:'＋ Set',exact:true}).waitFor();
 await page.evaluate(()=>localStorage.setItem('stoneham-spraywall:problems:v3','[null,{"id":"bad","holds":[null]}]'));await page.reload();await page.getByRole('button',{name:'＋ Set',exact:true}).waitFor();
 await page.getByRole('button',{name:'＋ Set',exact:true}).click();await page.locator('.hold-hit-polygon').nth(0).click();await page.locator('.hold-hit-polygon').nth(1).click();await page.getByLabel('Problem name').fill('Storage failure');
 await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('Full','QuotaExceededError')}});await page.getByRole('button',{name:'Save problem',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.locator('.selection-count').textContent(),'2 selected');
 assert.deepEqual(errors,[]);console.log('PASS: mobile tap, drag from hold, pinch, fit, save, reload/browse, 320–980px overflow, corrupt storage, quota failure; no browser errors.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
