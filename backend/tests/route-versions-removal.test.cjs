const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict')
const sdk=require('@aws-sdk/lib-dynamodb'),{Memory,key}=require('./helpers/memory.cjs')
const old=require('../../src/data/walls/2026-11-v7/holds.json'),fresh=require('../../src/data/walls/2026-11-v10/holds.json')
const ids=new Set(fresh.map(h=>h.id)),shared=old.filter(h=>ids.has(h.id)).slice(0,2),missing=old.find(h=>!ids.has(h.id))
process.env.DYNAMODB_TABLE='route-versions-removal-test'
let memory
sdk.DynamoDBDocumentClient.from=()=>({send:command=>memory.send(command)})
const {handler}=require('../dist/test-handler.cjs')
const body=r=>JSON.parse(r.body)
const request=(method,path,input,user='alice',admin=false,queryStringParameters)=>handler({rawPath:path,body:input===undefined?undefined:JSON.stringify(input),queryStringParameters,requestContext:{requestId:'versions-removal',http:{method,path},...(user?{authorizer:{jwt:{claims:{sub:user,...(admin?{'cognito:groups':'["admins"]'}:{})}}}}:{})}})
const pair=[{holdId:shared[0].id,role:'start'},{holdId:shared[1].id,role:'finish'}]
const seed=(id='root',extra={})=>{
 const route={pk:'PROBLEM#'+id,sk:'META',entityType:'problem',id,name:'Original',grade:'V3',setter:'Alice',ownerId:'alice',gymId:'stoneham-crg',wallId:'spray-wall-1',wallVersionId:'2026-11-v7',holds:[...pair,{holdId:missing.id,role:'foot-only'}],revision:1,createdAt:'2026-11-01',updatedAt:'2026-11-01',...extra}
 memory.put(route);memory.put({pk:route.pk,sk:'LIST',problemId:id,gsi1pk:'GYM#stoneham-crg#WALL#spray-wall-1#ALL',gsi1sk:'PROBLEM#'+route.createdAt+'#'+id})
 memory.put({pk:route.pk,sk:'COMMUNITY_SUMMARY',entityType:'community-summary',version:1,revision:1,commentCount:0,ratingCount:0,ratingTotal:0})
 return route
}
const familyIndex=route=>memory.put({pk:route.pk,sk:'FAMILY',problemId:route.id,gsi1pk:'GYM#stoneham-crg#WALL#spray-wall-1#FAMILY#'+(route.upgradeRootId??route.id),gsi1sk:'VERSION#'+String(route.upgradeNumber??1).padStart(16,'0')+'#'+route.createdAt+'#'+route.id,entityType:'problem-listing'})
beforeEach(()=>{memory=new Memory();seed()})
async function migrate(){let cursor,total=0;do{const r=await request('POST','/v1/admin/gyms/stoneham-crg/walls/spray-wall-1/versions/2026-11-v10/publish',{...(cursor?{cursor}:{}),dryRun:false},'admin',true);assert.equal(r.statusCode,200,r.body);const page=body(r);total+=page.processed;cursor=page.nextCursor}while(cursor);return total}
test('existing compatibility sweep backfills version indexes without changing canonical route content or activity',async()=>{
 const read=body(await request('GET','/v1/problems/root',undefined,null)),raw=memory.get('PROBLEM#root','META')
 for(const field of ['supportedWallVersionIds','outdated','compatibilityWallVersionId','missingHoldIds'])raw[field]=read[field]
 const before=structuredClone(raw)
 memory.put({pk:'PROBLEM#root',sk:'RATING#alice',entityType:'rating',score:5})
 memory.put({pk:'PROBLEM#root',sk:'COMMENT#1',entityType:'comment',text:'Keep',userId:'alice'})
 assert.equal(await migrate(),1)
 for(const field of Object.keys(before))assert.deepEqual(memory.get('PROBLEM#root','META')[field],before[field],field)
 assert(memory.get('PROBLEM#root','FAMILY'));assert.equal(memory.get('PROBLEM#root','RATING#alice').score,5)
 assert.equal(memory.get('PROBLEM#root','COMMENT#1').text,'Keep')
 const versions=await request('GET','/v1/problems/root/versions',undefined,null)
 assert.equal(versions.statusCode,200);assert.deepEqual(body(versions).items.map(r=>r.id),['root'])
})
test('Upgrade writes family history atomically and unrelated equal names stay separate',async()=>{
 familyIndex(memory.get('PROBLEM#root','META'))
 const draft=body(await request('GET','/v1/problems/root/upgrade'))
 const saved=await request('POST','/v1/problems/root/upgrade',{...draft,automaticName:true})
 assert.equal(saved.statusCode,201,saved.body)
 const v2=body(saved),pointer=memory.get('PROBLEM#'+v2.id,'FAMILY')
 assert(pointer.gsi1pk.endsWith('#FAMILY#root'));assert(pointer.gsi1sk.startsWith('VERSION#0000000000000002#'))
 familyIndex(seed('same-name',{name:v2.name,holds:pair,wallVersionId:'2026-11-v8'}))
 assert.deepEqual(body(await request('GET','/v1/problems/'+v2.id+'/versions',undefined,null)).items.map(r=>r.id),[v2.id,'root'])
 assert.deepEqual(body(await request('GET','/v1/problems/same-name/versions',undefined,null)).items.map(r=>r.id),['same-name'])
})
test('history uses bounded numeric ordering and scoped cursors across pages, excluding hidden or mismatched canonical records',async()=>{
 familyIndex(memory.get('PROBLEM#root','META'))
 for(let n=2;n<=32;n++)familyIndex(seed('v'+n,{upgradeRootId:'root',upgradeNumber:n,name:'Renamed '+n,createdAt:'2026-11-02'}))
 const foreign=seed('foreign');memory.put({pk:foreign.pk,sk:'FAMILY',problemId:'foreign',gsi1pk:'GYM#stoneham-crg#WALL#spray-wall-1#FAMILY#root',gsi1sk:'VERSION#9999999999999999#foreign'})
 memory.get('PROBLEM#v31','META').hidden=true
 memory.calls=[]
 const first=body(await request('GET','/v1/problems/v32/versions',undefined,null));assert(first.nextCursor)
 assert.equal(first.items[0].id,'v32');assert(!first.items.some(r=>r.id==='v31'||r.id==='foreign'))
 assert.equal((await request('GET','/v1/problems/foreign/versions',undefined,null,false,{cursor:first.nextCursor})).statusCode,400)
 const second=body(await request('GET','/v1/problems/v32/versions',undefined,null,false,{cursor:first.nextCursor}))
 const all=[...first.items,...second.items];assert.equal(all.length,31);assert.equal(new Set(all.map(r=>r.id)).size,31)
 assert(all.findIndex(r=>r.id==='v10')<all.findIndex(r=>r.id==='v2'))
 assert(memory.calls.filter(c=>c.kind==='QueryCommand').every(c=>c.input.Limit===20))
})
test('creator removal is idempotent, prevents direct reads and edits, retains source records and does not remove sibling versions',async()=>{
 familyIndex(memory.get('PROBLEM#root','META'))
 const child=seed('v2',{upgradeRootId:'root',upgradeNumber:2,wallVersionId:'2026-11-v8',holds:pair});familyIndex(child)
 memory.put({pk:'PROBLEM#v2',sk:'COMMENT#saved',entityType:'comment',text:'Keep this review',userId:'bob'})
 memory.put({pk:'PROBLEM#v2',sk:'RATING#bob',entityType:'rating',score:5})
 Object.assign(memory.get('PROBLEM#v2','COMMUNITY_SUMMARY'),{commentCount:1,ratingCount:1,ratingTotal:5})
 assert.equal((await request('DELETE','/v1/problems/v2',{revision:1})).statusCode,200)
 assert.equal((await request('DELETE','/v1/problems/v2',{revision:1})).statusCode,200)
 for(const path of ['/v1/problems/v2','/v1/problems/v2/community','/v1/problems/v2/versions'])assert.equal((await request('GET',path,undefined,null)).statusCode,404)
 assert.equal((await request('PATCH','/v1/problems/v2',{revision:2,name:'Revive'})).statusCode,404)
 assert.equal(memory.get('PROBLEM#v2','META').name,child.name);assert.deepEqual(memory.get('PROBLEM#v2','META').holds,child.holds)
 assert.equal(memory.get('PROBLEM#v2','COMMENT#saved').text,'Keep this review');assert.equal(memory.get('PROBLEM#v2','RATING#bob').score,5)
 assert.equal(memory.get('PROBLEM#v2','COMMUNITY_SUMMARY').commentCount,1)
 assert.deepEqual(body(await request('GET','/v1/problems/root/versions',undefined,null)).items.map(r=>r.id),['root'])
 assert.deepEqual(body(await request('GET','/v1/gyms/stoneham-crg/walls/spray-wall-1/problems',undefined,null)).items.map(r=>r.id),['root'])
 assert.equal([...memory.rows.values()].filter(r=>r.entityType==='moderation-audit').length,1)
})
test('only the creator or an admin may remove, including outdated and unowned routes; banned accounts cannot remove',async()=>{
 assert.equal((await request('DELETE','/v1/problems/root',{revision:1},null)).statusCode,401)
 assert.equal((await request('DELETE','/v1/problems/root',{revision:1},'bob')).statusCode,403)
 assert.equal((await request('DELETE','/v1/problems/root',{revision:1,ownerId:'alice',isAdmin:true},'bob')).statusCode,403)
 assert.equal((await request('DELETE','/v1/problems/root',{revision:1},'admin',true)).statusCode,200)
 seed('unowned',{ownerId:undefined})
 assert.equal((await request('DELETE','/v1/problems/unowned',{revision:1})).statusCode,403)
 assert.equal((await request('DELETE','/v1/problems/unowned',{revision:1},'admin',true)).statusCode,200)
 seed('banned');memory.put({pk:'USER#alice',sk:'ACCESS',banned:true})
 assert.equal((await request('DELETE','/v1/problems/banned',{revision:1})).statusCode,403)
})
test('stale or racing removals cannot hide a newly edited version, and admins can restore a removed route',async()=>{
 assert.equal((await request('DELETE','/v1/problems/root',{revision:0})).statusCode,400)
 assert.equal((await request('DELETE','/v1/problems/root',{revision:3})).statusCode,409)
 const intercept=p=>{if(p.TransactItems.some(a=>a.Put?.Item.sk==='META')){const row=memory.get('PROBLEM#root','META');row.name='Concurrent edit';row.revision++}else memory.beforeTransaction=intercept}
 memory.beforeTransaction=intercept
 assert.equal((await request('DELETE','/v1/problems/root',{revision:1})).statusCode,409)
 assert(!memory.get('PROBLEM#root','META').hidden);assert.equal(memory.get('PROBLEM#root','META').name,'Concurrent edit')
 assert.equal((await request('DELETE','/v1/problems/root',{revision:2})).statusCode,200)
 assert.equal((await request('PATCH','/v1/admin/problems/root/visibility',{hidden:false,reason:'Restore creator removal'},'admin',true)).statusCode,200)
 assert.equal(body(await request('GET','/v1/problems/root',undefined,null)).name,'Concurrent edit')
 assert.equal((await request('PATCH','/v1/problems/root',{revision:2,name:'Stale edit'})).statusCode,409)
})
test('removing the original keeps the Upgrade root and monotonic version counter usable',async()=>{
 familyIndex(memory.get('PROBLEM#root','META'))
 const child=seed('v2',{upgradeRootId:'root',upgradedFromId:'root',upgradeNumber:2,upgradeBaseName:'Original'});familyIndex(child)
 memory.put({pk:'PROBLEM#root',sk:'UPGRADE_COUNTER',number:2,entityType:'upgrade-counter'})
 assert.equal((await request('DELETE','/v1/problems/root',{revision:1})).statusCode,200)
 const draft=body(await request('GET','/v1/problems/v2/upgrade'));assert.equal(draft.name,'Original V3')
 const saved=await request('POST','/v1/problems/v2/upgrade',{...draft,automaticName:true})
 assert.equal(saved.statusCode,201,saved.body);assert.equal(body(saved).upgradeNumber,3);assert.equal(body(saved).upgradeRootId,'root')
 assert.equal(memory.get('PROBLEM#root','UPGRADE_COUNTER').number,3)
})

test('local wall storage keeps version history and never reuses a removed Upgrade number',async()=>{
 const {buildSync}=require('esbuild'),path=require('node:path')
 const compiled=buildSync({entryPoints:[path.resolve(__dirname,'../../src/localWallStore.ts')],bundle:true,format:'cjs',platform:'node',write:false}).outputFiles[0].text
 const module={exports:{}};new Function('module','exports',compiled)(module,module.exports)
 const {createLocalWallStore,localWallKey}=module.exports,rows=new Map()
 const storage={getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value)}
 const root={id:'local-root',name:'Local route',grade:'V3',setter:'Me',holds:[...pair,{holdId:missing.id,role:'foot-only'}],createdAt:'2026-11-01',revision:1,wallVersionId:'2026-11-v7'}
 storage.setItem(localWallKey('2026-11-v7'),JSON.stringify([root]))
 const store=createLocalWallStore(storage),draft=await store.getUpgradeDraft(root.id),v2=await store.upgrade(draft,draft,true)
 assert.equal(v2.upgradeNumber,2)
 await store.remove(v2);assert.deepEqual((await store.list()).items.map(p=>p.id),[root.id])
 const next=await store.getUpgradeDraft(root.id),v3=await store.upgrade(next,next,true)
 assert.equal(v3.upgradeNumber,3)
 assert.deepEqual((await store.listVersions(v3.id)).items.map(p=>p.id),[v3.id,root.id])
 await store.remove(root);assert.equal((await store.listVersions(v3.id)).items.length,1)
 assert(JSON.parse(storage.getItem(localWallKey('2026-11-v10'))).some(p=>p.id===v2.id&&p.hidden))
})
