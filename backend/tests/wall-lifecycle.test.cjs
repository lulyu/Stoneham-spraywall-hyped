const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict')
const sdk=require('@aws-sdk/lib-dynamodb'),old=require('../../src/data/polygons/holds.json'),fresh=require('../../src/data/walls/2026-11-v7/holds.json')
const current=new Set(fresh.map(h=>h.id)),shared=old.filter(h=>current.has(h.id)),missing=old.find(h=>!current.has(h.id))
process.env.DYNAMODB_TABLE='lifecycle-test'
let rows,transactions,scanCalls,injectConflict
const key=p=>p.pk+'|'+p.sk
sdk.DynamoDBDocumentClient.from=()=>({send:async command=>{
 const p=command.input,kind=command.constructor.name
 if(kind==='GetCommand')return {Item:rows.get(key(p.Key))}
 if(kind==='ScanCommand') {
  scanCalls++
  const all=[...rows.values()].sort((a,b)=>key(a).localeCompare(key(b)))
  const start=p.ExclusiveStartKey?all.findIndex(r=>key(r)===key(p.ExclusiveStartKey))+1:0
  const scanned=all.slice(start,start+2),last=scanned.at(-1)
  return {Items:scanned.filter(r=>r.entityType==='problem'&&r.gymId===p.ExpressionAttributeValues[':gym']&&r.wallId===p.ExpressionAttributeValues[':wall']),ScannedCount:scanned.length,...(start+2<all.length?{LastEvaluatedKey:{pk:last.pk,sk:last.sk}}:{})}
 }
 if(kind==='QueryCommand') {
  const all=[...rows.values()].filter(r=>r.gsi1pk===p.ExpressionAttributeValues[':pk']).sort((a,b)=>b.gsi1sk.localeCompare(a.gsi1sk))
  const start=p.ExclusiveStartKey?all.findIndex(r=>key(r)===key(p.ExclusiveStartKey))+1:0
  const items=all.slice(start,start+p.Limit),last=items.at(-1)
  return {Items:items,...(start+items.length<all.length?{LastEvaluatedKey:{pk:last.pk,sk:last.sk,gsi1pk:last.gsi1pk,gsi1sk:last.gsi1sk}}:{})}
 }
 if(kind==='TransactWriteCommand') {
  if(injectConflict){const action=injectConflict;injectConflict=null;action()}
  const reasons=p.TransactItems.map(action=>{
   const operation=action.Put??action.ConditionCheck,existing=rows.get(key(operation.Item??operation.Key)),condition=operation.ConditionExpression,v=operation.ExpressionAttributeValues??{}
   let pass=true
   if(condition==='attribute_not_exists(pk)')pass=!existing
   else if(condition==='revision = :revision')pass=existing?.revision===v[':revision']
   else if(condition==='attribute_exists(pk) AND attribute_not_exists(revision)')pass=Boolean(existing)&&existing.revision===undefined
   else if(condition==='revision = :revision AND ownerId = :owner')pass=existing?.revision===v[':revision']&&existing?.ownerId===v[':owner']
   else if(condition==='#number = :previous')pass=existing?.number===v[':previous']
   return {Code:pass?'None':'ConditionalCheckFailed'}
  })
  if(reasons.some(r=>r.Code!=='None'))throw Object.assign(new Error('ConditionalCheckFailed'),{name:'TransactionCanceledException',CancellationReasons:reasons})
  for(const action of p.TransactItems)if(action.Put)rows.set(key(action.Put.Item),structuredClone(action.Put.Item))
  transactions++;return {}
 }
 throw Error('Unexpected '+kind)
}})
const {handler}=require('../dist/test-handler.cjs')
const path='/v1/admin/gyms/stoneham-crg/walls/spray-wall-1/versions/2026-11-v7/publish'
const request=(method,path,body,user='alice',admin=false)=>handler({rawPath:path,body:body===undefined?undefined:JSON.stringify(body),requestContext:{requestId:'test',http:{method,path},...(user?{authorizer:{jwt:{claims:{sub:user,...(admin?{'cognito:groups':'["admins"]'}:{})}}}}:{})}})
const json=r=>JSON.parse(r.body)
const seed=(id,holds)=>({id,pk:'PROBLEM#'+id,sk:'META',entityType:'problem',gymId:'stoneham-crg',wallId:'spray-wall-1',wallVersionId:'2026-10-v4',name:'Original',grade:'V3',setter:'Alice',ownerId:'alice',revision:1,createdAt:'2026-01-01',updatedAt:'2026-01-01',holds,gsi1pk:'GYM#stoneham-crg#WALL#spray-wall-1#VERSION#2026-10-v4',gsi1sk:'PROBLEM#2026-01-01#'+id})
const validHolds=[{holdId:shared[0].id,role:'start'},{holdId:shared[1].id,role:'finish'}]
beforeEach(()=>{
 rows=new Map();transactions=0;scanCalls=0;injectConflict=null
 for(const p of [seed('valid',validHolds),seed('outdated',[...validHolds,{holdId:missing.id,role:'foot-only'}])])rows.set(key(p),p)
 rows.set('USER#alice|PROFILE',{pk:'USER#alice',sk:'PROFILE',entityType:'profile',bio:'Keep'})
 rows.set('PROBLEM#outdated|COMMENT#1',{pk:'PROBLEM#outdated',sk:'COMMENT#1',entityType:'comment',text:'Keep history'})
})
async function migrate(dryRun=false){let cursor,total=0;do{const r=await request('POST',path,{cursor,dryRun},'admin',true);assert.equal(r.statusCode,200);const page=json(r);assert.deepEqual(page.conflicts,[]);total+=page.processed;cursor=page.nextCursor}while(cursor);return total}
test('publish scans every page, includes foot-only holds, and preserves route identity/activity',async()=>{
 const comment=structuredClone(rows.get('PROBLEM#outdated|COMMENT#1'))
 assert.equal(await migrate(),2);assert(scanCalls>1)
 const valid=rows.get('PROBLEM#valid|META'),outdated=rows.get('PROBLEM#outdated|META')
 assert.deepEqual(valid.supportedWallVersionIds,['2026-10-v4','2026-11-v7']);assert.equal(valid.outdated,false)
 assert.deepEqual(outdated.supportedWallVersionIds,['2026-10-v4']);assert.equal(outdated.outdated,true)
 assert.deepEqual(outdated.missingHoldIds,[missing.id]);assert.deepEqual(outdated.holds,[...validHolds,{holdId:missing.id,role:'foot-only'}])
 assert.deepEqual(rows.get('PROBLEM#outdated|COMMENT#1'),comment)
 assert.equal(rows.get('PROBLEM#valid|OWNER').gsi1pk,'USER#alice#ROUTES')
 assert.equal(rows.get('PROBLEM#outdated|OWNER').gsi1pk,'USER#alice#ROUTES')
 const all=json(await request('GET','/v1/gyms/stoneham-crg/walls/spray-wall-1/problems')).items
 assert.deepEqual(new Set(all.map(p=>p.id)),new Set(['valid','outdated']))
 const latest=json(await request('GET','/v1/gyms/stoneham-crg/walls/spray-wall-1/versions/2026-11-v7/problems')).items
 assert.deepEqual(latest.map(p=>p.id),['valid'])
 const revision=valid.revision;await migrate();assert.equal(rows.get('PROBLEM#valid|META').revision,revision)
})
test('dry-run has no writes; ordinary users and anonymous requests cannot publish',async()=>{
 const before=structuredClone([...rows]);assert.equal(await migrate(true),2);assert.equal(transactions,0);assert.deepEqual([...rows],before)
 assert.equal((await request('POST',path,{},null)).statusCode,401)
 assert.equal((await request('POST',path,{},'alice')).statusCode,403)
})
test('migration retries concurrent content edits without overwriting them',async()=>{
 injectConflict=()=>{const row=rows.get('PROBLEM#outdated|META');row.name='Concurrent edit';row.revision++}
 await migrate();assert.equal(rows.get('PROBLEM#outdated|META').name,'Concurrent edit')
})
test('Upgrade is author-only, seeds surviving holds, creates V2/V3 with new IDs, and never edits the source',async()=>{
 await migrate();const original=structuredClone(rows.get('PROBLEM#outdated|META'))
 const url='/v1/problems/outdated/upgrade'
 assert.equal((await request('GET',url,undefined,null)).statusCode,401)
 assert.equal((await request('GET',url,undefined,'admin',true)).statusCode,403)
 assert.equal((await request('GET','/v1/problems/valid/upgrade')).statusCode,409)
 const draft=json(await request('GET',url));assert.equal(draft.name,'Original V2');assert.deepEqual(draft.holds,validHolds)
 assert.deepEqual(draft.removedHoldIds,[missing.id])
 const input={...draft,automaticName:true}
 const one=await request('POST',url,input);assert.equal(one.statusCode,201)
 const two=await request('POST',url,input);assert.equal(two.statusCode,201)
 assert.equal(json(one).name,'Original V2');assert.equal(json(two).name,'Original V3')
 assert.notEqual(json(one).id,json(two).id);assert.notEqual(json(one).id,original.id)
 assert.equal(json(one).wallVersionId,'2026-11-v7');assert.equal(json(one).upgradedFromId,original.id)
 assert.equal(rows.get('PROBLEM#'+json(one).id+'|OWNER').gsi1pk,'USER#alice#ROUTES')
 assert.deepEqual(rows.get('PROBLEM#outdated|META'),original)
 assert.equal(rows.get('PROBLEM#outdated|COMMENT#1').text,'Keep history')
})
test('missing Start/Finish and stale sources fail before creating an upgraded route',async()=>{
 await migrate();const url='/v1/problems/outdated/upgrade',draft=json(await request('GET',url)),before=transactions
 assert.equal((await request('POST',url,{...draft,holds:[{holdId:shared[0].id,role:'hold'},{holdId:shared[1].id,role:'finish'}]})).statusCode,400)
 assert.equal((await request('POST',url,{...draft,sourceRevision:0})).statusCode,409)
 assert.equal(transactions,before)
})
