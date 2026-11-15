const {test,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict')
const sdk=require('@aws-sdk/lib-dynamodb'),{Memory,key}=require('./helpers/memory.cjs')
const holds=require('../../src/data/walls/2026-11-v8/holds.json')
process.env.DYNAMODB_TABLE='guardrails-test'
let memory,clock;const originalNow=Date.now
sdk.DynamoDBDocumentClient.from=()=>({send:command=>memory.send(command)})
const {handler}=require('../dist/test-handler.cjs')
const createPath='/v1/gyms/stoneham-crg/walls/spray-wall-1/versions/2026-11-v8/problems'
const input={name:'Test',grade:'V2',setter:'Alice',holds:[{holdId:holds[0].id,role:'start'},{holdId:holds[1].id,role:'finish'}]}
const data=r=>JSON.parse(r.body)
const request=(method,path,body,user='alice',admin=false,queryStringParameters)=>handler({rawPath:path,body:body===undefined?undefined:JSON.stringify(body),queryStringParameters,requestContext:{requestId:'guardrail-test',http:{method,path},...(user?{authorizer:{jwt:{claims:{sub:user,...(admin?{'cognito:groups':'["admins"]'}:{})}}}}:{})}})
const summary=()=>memory.get('PROBLEM#p1','COMMUNITY_SUMMARY')
const community=()=>request('GET','/v1/problems/p1/community',undefined,null)
const admin=(path,body)=>request('PATCH','/v1/admin/'+path,body,'moderator',true)
const comment=(id='00000000-0000-4000-8000-000000000001',user='alice')=>request('POST','/v1/problems/p1/comments',{text:'Keep me',requestId:id},user)
beforeEach(()=>{
 memory=new Memory();clock=Date.UTC(2026,10,15,12);Date.now=()=>clock
 memory.put({pk:'PROBLEM#p1',sk:'META',entityType:'problem',id:'p1',gymId:'stoneham-crg',wallId:'spray-wall-1',wallVersionId:'2026-11-v8',ownerId:'alice',...input,revision:1,createdAt:'2026-11-01',updatedAt:'2026-11-01'})
 memory.put({pk:'PROBLEM#p1',sk:'LIST',problemId:'p1',gsi1pk:'GYM#stoneham-crg#WALL#spray-wall-1#ALL',gsi1sk:'PROBLEM#2026-11-01#p1'})
 memory.put({pk:'PROBLEM#p1',sk:'COMMUNITY_SUMMARY',entityType:'community-summary',version:1,revision:1,commentCount:0,ratingCount:0,ratingTotal:0})
 memory.put({pk:'USER#alice',sk:'PROFILE',displayName:'Alice',bio:''})
})
afterEach(()=>{Date.now=originalNow})
test('concurrent create requests share durable quotas and rejected transactions do not partially consume windows',async()=>{
 const results=await Promise.all(Array.from({length:12},()=>request('POST',createPath,input)))
 assert.equal(results.filter(r=>r.statusCode===201).length,5)
 assert(results.filter(r=>r.statusCode!==201).every(r=>r.statusCode===429&&Number(r.headers['retry-after'])>0))
 const minute=Math.floor(clock/1000/60)
 assert.equal(memory.get('QUOTA#alice','write#60#'+minute).count,5)
 const other=await request('POST',createPath,input,'bob');assert.equal(other.statusCode,201)
 clock+=61000;assert.equal((await request('POST',createPath,input)).statusCode,201)
 const routes=[...memory.rows.values()].filter(r=>r.entityType==='problem')
 for(const route of routes)assert(memory.get(route.pk,'COMMUNITY_SUMMARY'))
})
test('daily create allowance cannot be evaded by resetting minute windows or using Upgrade',async()=>{
 for(let i=0;i<30;i++){
  if(i%5===0)clock+=61000
  assert.equal((await request('POST',createPath,input)).statusCode,201)
 }
 clock+=61000
 const denied=await request('POST',createPath,input);assert.equal(denied.statusCode,429);assert(data(denied).retryAfter>60)
 memory.get('PROBLEM#p1','META').outdated=true
 const upgrade=await request('POST','/v1/problems/p1/upgrade',{})
 assert.equal(upgrade.statusCode,429)
 clock=Date.UTC(2026,10,16);assert.equal((await request('POST',createPath,input)).statusCode,201)
})
test('comment minute allowance and profile limits apply to invalid requests as well',async()=>{
 for(let i=0;i<5;i++)assert.equal((await request('POST','/v1/problems/p1/comments',{text:''})).statusCode,400)
 assert.equal((await comment()).statusCode,429)
 for(let i=0;i<10;i++)assert.equal((await request('PATCH','/v1/me/profile',{isAdmin:true},'bob')).statusCode,400)
 assert.equal((await request('PATCH','/v1/me/profile',{isAdmin:true},'bob')).statusCode,429)
})
test('rating replacements and competing same-account writes update count and sum atomically',async()=>{
 const responses=await Promise.all(Array.from({length:5},(_,i)=>request('PATCH','/v1/problems/p1/rating',{score:i+1},'u'+i)))
 assert(responses.every(r=>r.statusCode===200));assert.equal(summary().ratingCount,5);assert.equal(summary().ratingTotal,15)
 const updates=await Promise.all(Array.from({length:5},()=>request('PATCH','/v1/problems/p1/rating',{score:5},'u0')))
 assert(updates.every(r=>r.statusCode===200));assert.equal(summary().ratingCount,5);assert.equal(summary().ratingTotal,19)
 assert.equal(data(await community()).ratingAverage,3.8)
})
test('parallel comment retries create one record and increment its summary only once',async()=>{
 const results=await Promise.all([comment(),comment(),comment()]);assert(results.every(r=>r.statusCode===200))
 assert.equal(summary().commentCount,1);assert.equal(data(await community()).comments.length,1)
 assert.equal((await comment(undefined,'bob')).statusCode,409)
})
test('hide/restore is reversible and idempotent, stale indexes cannot reveal hidden comments',async()=>{
 const added=data(await comment()),path='problems/p1/comments/'+added.id+'/visibility'
 memory.staleIndex=[...memory.rows.values()].map(r=>structuredClone(r))
 assert.equal((await admin(path,{hidden:true,reason:'Spam'})).statusCode,200)
 assert.equal((await admin(path,{hidden:true,reason:'Retry'})).statusCode,200)
 assert.equal(summary().commentCount,0);assert.equal(data(await community()).comments.length,0)
 assert.equal(memory.get('PROBLEM#p1','COMMENT#'+added.id).text,'Keep me')
 assert.equal((await request('PATCH','/v1/problems/p1/comments/'+added.id,{text:'Resurrect'})).statusCode,403)
 assert.equal((await request('GET','/v1/problems/p1/comments/'+added.id+'/author-profile',undefined,null)).statusCode,404)
 assert.equal((await admin(path,{hidden:false,reason:'False positive'})).statusCode,200)
 assert.equal(summary().commentCount,1);assert.equal(data(await community()).comments[0].text,'Keep me')
 const audits=[...memory.rows.values()].filter(r=>r.entityType==='moderation-audit')
 assert.equal(audits.length,2);assert(audits.every(a=>a.actor==='moderator'&&a.reason))
})
test('simultaneous hiding and deleting cannot double-decrement counts or restore a user-deleted comment',async()=>{
 const added=data(await comment()),url='/v1/problems/p1/comments/'+added.id
 const result=await Promise.all([admin('problems/p1/comments/'+added.id+'/visibility',{hidden:true,reason:'Spam'}),request('DELETE',url)])
 assert(result.every(r=>[200,404].includes(r.statusCode)))
 assert.equal(summary().commentCount,0)
 assert.equal((await request('DELETE',url)).statusCode,200)
 assert.equal((await admin('problems/p1/comments/'+added.id+'/visibility',{hidden:false,reason:'Restore'})).statusCode,404)
 assert.equal((await comment()).statusCode,410)
})
test('route hiding blocks direct links, lists, creator edits and activity; restoring keeps route identity and content',async()=>{
 const before=structuredClone(memory.get('PROBLEM#p1','META'))
 assert.equal((await admin('problems/p1/visibility',{hidden:true,reason:'Spam route'})).statusCode,200)
 assert.equal((await request('GET','/v1/problems/p1',undefined,null)).statusCode,404)
 assert.equal(data(await request('GET','/v1/gyms/stoneham-crg/walls/spray-wall-1/problems',undefined,null)).items.length,0)
 assert.equal((await request('PATCH','/v1/problems/p1',{revision:1,name:'Revive'})).statusCode,404)
 assert.equal((await request('PATCH','/v1/problems/p1/rating',{score:5})).statusCode,404)
 assert.equal((await admin('problems/p1/visibility',{hidden:false,reason:'Restored'})).statusCode,200)
 const after=data(await request('GET','/v1/problems/p1',undefined,null))
 for(const field of ['id','name','holds','ownerId','createdAt','updatedAt'])assert.deepEqual(after[field],before[field])
 assert(after.revision>before.revision)
 assert.equal((await request('PATCH','/v1/problems/p1',{revision:1,name:'Stale'})).statusCode,409)
})
test('suspension stops all writes even for an existing verified JWT; reads and unbanning remain available',async()=>{
 assert.equal((await admin('users/alice/access',{banned:true,reason:'Spam account'})).statusCode,200)
 for(const [method,path,body] of [['POST',createPath,input],['PATCH','/v1/me/profile',{bio:'Hi'}],['PATCH','/v1/problems/p1/rating',{score:4}],['POST','/v1/problems/p1/sends'],['POST','/v1/problems/p1/comments',{text:'Hi'}],['PATCH','/v1/problems/p1',{revision:1,name:'Hi'}],['DELETE','/v1/problems/p1/comments/missing']])assert.equal((await request(method,path,body)).statusCode,403,path)
 assert.equal((await request('GET','/v1/problems/p1',undefined,null)).statusCode,200)
 assert.equal((await admin('users/alice/access',{banned:false,reason:'Appeal accepted'})).statusCode,200)
 assert.equal((await request('PATCH','/v1/problems/p1/rating',{score:4})).statusCode,200)
})
test('ordinary users and anonymous callers cannot moderate or backfill; self-ban and blank reasons are rejected',async()=>{
 for(const user of ['alice',null]){
  assert.equal((await request('GET','/v1/admin/moderation',undefined,user)).statusCode,user?403:401)
  assert.equal((await request('PATCH','/v1/admin/users/bob/access',{banned:true,reason:'No'},user)).statusCode,user?403:401)
  assert.equal((await request('POST','/v1/admin/community/backfill',{problemId:'p1'},user)).statusCode,user?403:401)
 }
 assert.equal((await admin('users/moderator/access',{banned:true,reason:'Oops'})).statusCode,400)
 assert.equal((await admin('problems/p1/visibility',{hidden:true,reason:''})).statusCode,400)
 assert.equal([...memory.rows.values()].filter(r=>r.entityType==='moderation-audit').length,0)
})
test('public summary reads and comment-ownership checks stay bounded as historic activity grows',async()=>{
 for(let i=0;i<1000;i++){
  memory.put({pk:'PROBLEM#p1',sk:'RATING#r'+i,entityType:'rating',score:5})
  memory.put({pk:'PROBLEM#p1',sk:'COMMENT#c'+i,entityType:'comment',id:'c'+i,userId:'alice',text:'Many',createdAt:'2026-11-01',gsi1pk:'PROBLEM#p1#COMMENTS',gsi1sk:'2026-11-01#'+String(i).padStart(4,'0')})
 }
 Object.assign(summary(),{commentCount:1000,ratingCount:1000,ratingTotal:5000});memory.calls=[]
 const result=data(await community());assert.equal(result.ratingCount,1000);assert.equal(result.commentCount,1000);assert.equal(result.comments.length,20)
 const queries=memory.calls.filter(c=>c.kind==='QueryCommand');assert.equal(queries.length,1);assert.equal(queries[0].input.Limit,20)
 memory.calls=[]
 const mine=data(await request('GET','/v1/problems/p1/my-activity',undefined,'alice',false,{commentIds:'c1,c2,c3'}));assert.equal(mine.commentIds.length,3)
 assert.equal(memory.calls.filter(c=>c.kind==='QueryCommand').length,0);assert(memory.calls.length<=6)
 assert.equal((await request('GET','/v1/problems/p1/my-activity',undefined,'alice',false,{commentIds:Array.from({length:21},(_,i)=>'c'+i).join(',')})).statusCode,400)
})
test('one-time backfill preserves old records, excludes hidden/deleted comments, and never overwrites live counters',async()=>{
 memory.rows.delete('PROBLEM#p1|COMMUNITY_SUMMARY')
 memory.put({pk:'PROBLEM#p1',sk:'RATING#alice',entityType:'rating',score:4})
 memory.put({pk:'PROBLEM#p1',sk:'COMMENT#old',entityType:'comment',id:'old',userId:'alice',text:'Old'})
 memory.put({pk:'PROBLEM#p1',sk:'COMMENT#hidden',entityType:'comment',hidden:true})
 memory.put({pk:'PROBLEM#p1',sk:'COMMENT#deleted',entityType:'comment',deleted:true})
 const old=[...memory.rows.values()].map(r=>structuredClone(r))
 assert.equal((await request('PATCH','/v1/problems/p1/rating',{score:5})).statusCode,503)
 assert.equal((await community()).statusCode,503)
 const backfill=()=>request('POST','/v1/admin/community/backfill',{problemId:'p1'},'moderator',true)
 const init=await backfill();assert.equal(init.statusCode,200);assert.equal(data(init).initialized,true)
 for(const r of old)assert.deepEqual(memory.rows.get(key(r)),r)
 assert.equal(summary().ratingTotal,4);assert.equal(summary().commentCount,1)
 assert.equal((await comment()).statusCode,200);assert.equal(summary().commentCount,2)
 assert.equal(data(await backfill()).initialized,false);assert.equal(summary().commentCount,2)
})
test('admin moderation listing advances empty scan pages and binds cursors to their content kind',async()=>{
 for(let i=0;i<55;i++)memory.put({pk:'AAA#'+i,sk:'QUOTA',count:1})
 const first=await request('GET','/v1/admin/moderation',undefined,'moderator',true,{kind:'routes'});assert.equal(first.statusCode,200)
 const page=data(first);assert.equal(page.items.length,0);assert(page.nextCursor)
 assert.equal((await request('GET','/v1/admin/moderation',undefined,'moderator',true,{kind:'users',cursor:page.nextCursor})).statusCode,400)
 const second=data(await request('GET','/v1/admin/moderation',undefined,'moderator',true,{kind:'routes',cursor:page.nextCursor}));assert.equal(second.items.length,1)
})

test('comment daily allowance is independent of minute resets and starts again at UTC midnight',async()=>{
 for(let i=0;i<100;i++){
  if(i%5===0)clock+=61000
  assert.equal((await comment('00000000-0000-4000-8000-'+String(i).padStart(12,'0'))).statusCode,200)
 }
 clock+=61000;assert.equal((await comment('00000000-0000-4000-8000-999999999999')).statusCode,429)
 clock=Date.UTC(2026,10,16)
 assert.equal((await comment('00000000-0000-4000-8000-999999999999')).statusCode,200)
 assert.equal(summary().commentCount,101)
})
test('a legacy writer deleting a comment without a revision cannot be undone by a racing edit',async()=>{
 const added=data(await comment()),row=memory.get('PROBLEM#p1','COMMENT#'+added.id);delete row.revision
 const intercept=p=>{if(p.TransactItems.some(a=>a.Put?.Item.entityType==='comment'))row.deleted=true;else memory.beforeTransaction=intercept}
 memory.beforeTransaction=intercept
 assert.equal((await request('PATCH','/v1/problems/p1/comments/'+added.id,{text:'Late edit'})).statusCode,409)
 assert.equal(row.deleted,true);assert.equal(row.text,'Keep me')
})
