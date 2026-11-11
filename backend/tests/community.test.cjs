const assert=require('node:assert/strict')
const {test,beforeEach}=require('node:test')
const sdk=require('@aws-sdk/lib-dynamodb')
const holds=require('../../src/data/polygons/holds.json')
process.env.DYNAMODB_TABLE='community-test'
let rows, pageCalls, beforeUpdate
const key=r=>r.pk+'|'+r.sk
sdk.DynamoDBDocumentClient.from=()=>Object.setPrototypeOf({send:async command=>{
 const p=command.input,kind=command.constructor.name
 if(kind==='GetCommand')return {Item:rows.get(key(p.Key))}
 if(kind==='PutCommand'){
  if(p.ConditionExpression&&rows.has(key(p.Item)))throw Object.assign(new Error(),{name:'ConditionalCheckFailedException'})
  rows.set(key(p.Item),p.Item);return {}
 }
 if(kind==='UpdateCommand'){
  assert.equal(p.ConditionExpression,'userId = :user AND attribute_not_exists(deleted)')
  const existing=rows.get(key(p.Key))
  if(beforeUpdate){const action=beforeUpdate;beforeUpdate=null;action(existing)}
  if(!existing||existing.userId!==p.ExpressionAttributeValues[':user']||existing.deleted)
   throw Object.assign(new Error(),{name:'ConditionalCheckFailedException'})
  if(p.ExpressionAttributeValues[':deleted']){
   existing.deleted=true
   for(const field of ['text','author','gsi1pk','gsi1sk'])delete existing[field]
  }else{existing.text=p.ExpressionAttributeValues[':text'];existing.updatedAt=p.ExpressionAttributeValues[':now']}
  return {Attributes:{...existing}}
 }
 if(kind==='QueryCommand'){
  pageCalls++
  const pk=p.ExpressionAttributeValues[':pk']
  if(p.IndexName){
   const matches=[...rows.values()].filter(r=>r.gsi1pk===pk).sort((a,b)=>b.gsi1sk.localeCompare(a.gsi1sk))
   const start=p.ExclusiveStartKey?matches.findIndex(r=>r.sk===p.ExclusiveStartKey.sk)+1:0
   const items=matches.slice(start,start+p.Limit),last=items.at(-1)
   return {Items:items,...(start+items.length<matches.length?{LastEvaluatedKey:{pk:last.pk,sk:last.sk,gsi1pk:last.gsi1pk,gsi1sk:last.gsi1sk}}:{})}
  }
  // Return one rating per page to exercise the real paginator across pages.
  const all=[...rows.values()].filter(r=>r.pk===pk&&r.sk.startsWith(p.ExpressionAttributeValues[':prefix'])).sort((a,b)=>a.sk.localeCompare(b.sk))
  const start=p.ExclusiveStartKey?all.findIndex(r=>r.sk===p.ExclusiveStartKey.sk)+1:0
  const selected=all.slice(start,start+1),last=selected.at(-1)
  if(p.Select==='COUNT')return {Count:selected.filter(row=>!row.deleted).length,...(start+1<all.length?{LastEvaluatedKey:{pk:last.pk,sk:last.sk}}:{})}
  const visible=p.FilterExpression?selected.filter(r=>r.userId===p.ExpressionAttributeValues[':user']&&!r.deleted):selected
  return {Items:visible,...(start+1<all.length?{LastEvaluatedKey:{pk:last.pk,sk:last.sk}}:{})}
 }
 throw new Error('Unexpected '+kind)
}},sdk.DynamoDBDocumentClient.prototype)
const {handler}=require('../dist/test-handler.cjs')
const request=(method,action,body,user='alice',cursor)=>handler({
 rawPath:action.startsWith('/v1/')?action:'/v1/problems/p1/'+action,body:JSON.stringify(body),
 queryStringParameters:cursor?{cursor}:undefined,
 requestContext:{requestId:'test',http:{method,path:''},...(user?{authorizer:{jwt:{claims:{sub:user}}}}:{})}
})
const data=r=>JSON.parse(r.body)
beforeEach(()=>{
 rows=new Map();pageCalls=0;beforeUpdate=null
 const problem={pk:'PROBLEM#p1',sk:'META',id:'p1',name:'Route one',grade:'V4',setter:'Original setter',gymId:'stoneham-crg',wallId:'spray-wall-1',wallVersionId:'2026-10-v4',holds:[{holdId:holds[0].id,role:'start'},{holdId:holds[1].id,role:'finish'}],createdAt:'2026-11-03',updatedAt:'2026-11-03',revision:1}
 rows.set(key(problem),problem)
 rows.set('USER#alice|PROFILE',{pk:'USER#alice',sk:'PROFILE',displayName:'Alice',bio:'Private bio'})
})
test('all writes and private reads reject anonymous callers',async()=>{
 for(const [method,path,body] of [['POST','sends'],['PATCH','rating',{score:4}],['POST','comments',{text:'Hi'}],['PATCH','comments/c1',{text:'Edit'}],['DELETE','comments/c1'],['GET','my-activity'],['GET','/v1/me/sends']]){
  assert.equal((await request(method,path,body,null)).statusCode,401)
 }
 assert.equal((await request('GET','community',undefined,null)).statusCode,200)
})
test('send retries are idempotent and user histories stay isolated',async()=>{
 const a=data(await request('POST','sends',{userId:'bob'}))
 const b=data(await request('POST','sends'))
 assert.deepEqual(a,b)
 assert.equal(data(await request('GET','my-activity')).sent,true)
 assert.equal(data(await request('GET','my-activity',undefined,'bob')).sent,false)
 assert.equal(data(await request('GET','/v1/me/sends')).items.length,1)
 assert.equal(data(await request('GET','/v1/me/sends',undefined,'bob')).items.length,0)
 assert(!('userId' in a))
})
test('ratings update one per user and aggregate every paginator page',async()=>{
 await request('PATCH','rating',{score:5})
 await request('PATCH','rating',{score:3})
 await request('PATCH','rating',{score:5},'bob')
 const summary=data(await request('GET','community',undefined,null))
 assert.equal(summary.ratingCount,2)
 assert.equal(summary.ratingAverage,4)
 assert.equal(data(await request('GET','my-activity')).rating,3)
 assert(pageCalls>=3)
 for(const score of [0,6,1.5,'5',null]){
  assert.equal((await request('PATCH','rating',{score})).statusCode,400)
 }
 assert.equal((await request('PATCH','rating',{score:4,userId:'bob'})).statusCode,400)
})
test('comments use server profile attribution, enforce limits and deduplicate retries',async()=>{
 const requestId='00000000-0000-4000-8000-000000000001'
 const a=await request('POST','comments',{text:' Nice movement ',requestId})
 assert.equal(a.statusCode,200)
 assert.equal(data(a).author,'Alice')
 assert.equal(data(a).text,'Nice movement')
 assert(!('userId' in data(a)))
 assert.deepEqual(data(await request('POST','comments',{text:'Nice movement',requestId})),data(a))
 assert.equal((await request('POST','comments',{text:'Hijack',requestId},'bob')).statusCode,409)
 const summary=data(await request('GET','community',undefined,null))
 assert.equal(summary.comments.length,1)
 for(const body of [{text:''},{text:'x'.repeat(1001)},{text:'Hi',author:'Admin'},{text:'Hi',requestId:'invalid'}]){
  assert.equal((await request('POST','comments',body)).statusCode,400)
 }
})
test('history and comments paginate and reject cross-user/cross-route cursors',async()=>{
 for(let i=0;i<21;i++){
  const id='p'+(i+2)
  rows.set('USER#alice|SEND#'+id,{pk:'USER#alice',sk:'SEND#'+id,entityType:'send',userId:'alice',problemId:id,name:id,grade:'V1',setter:'Tester',sentAt:'2026-11-03',gsi1pk:'USER#alice#SENDS',gsi1sk:'2026-11-03#'+id})
 }
 const first=data(await request('GET','/v1/me/sends'))
 assert.equal(first.items.length,20);assert(first.nextCursor)
 const next=data(await request('GET','/v1/me/sends',undefined,'alice',first.nextCursor))
 assert.equal(next.items.length,1)
 assert.equal((await request('GET','/v1/me/sends',undefined,'bob',first.nextCursor)).statusCode,400)
 assert.equal((await request('GET','community',undefined,null,first.nextCursor)).statusCode,400)
 assert.equal((await request('GET','community',undefined,null,'not-json')).statusCode,400)
})
test('nonexistent routes cannot receive social data',async()=>{
 assert.equal((await request('POST','/v1/problems/missing/sends')).statusCode,404)
 assert.equal((await request('POST','/v1/problems/missing/comments',{text:'Hi'})).statusCode,404)
})
test('comment pagination returns subsequent comments without exposing account identifiers',async()=>{
 for(let i=0;i<21;i++){
  const id=String(i).padStart(2,'0')
  const row={pk:'PROBLEM#p1',sk:'COMMENT#'+id,id,text:'Comment '+id,author:'Climber',createdAt:'2026-11-03',userId:'private-user',gsi1pk:'PROBLEM#p1#COMMENTS',gsi1sk:'2026-11-03#'+id}
  rows.set(key(row),row)
 }
 const first=data(await request('GET','community',undefined,null))
 assert.equal(first.comments.length,20);assert(first.nextCursor)
 assert(first.comments.every(c=>!('userId' in c)&&!('pk' in c)))
 const second=data(await request('GET','community',undefined,null,first.nextCursor))
 assert.equal(second.comments.length,1)
 assert(!second.nextCursor)
})

test('only the comment author can edit or delete; attribution and creation order stay intact',async()=>{
 const original=data(await request('POST','comments',{text:'Original'}))
 const path='comments/'+original.id
 assert.equal((await request('PATCH',path,{text:'Stolen'},'bob')).statusCode,403)
 assert.equal((await request('DELETE',path,undefined,'bob')).statusCode,403)
 const edited=await request('PATCH',path,{text:' Revised '})
 assert.equal(edited.statusCode,200)
 assert.equal(data(edited).text,'Revised')
 assert.equal(data(edited).createdAt,original.createdAt)
 assert.equal(data(edited).author,'Alice')
 assert(data(edited).updatedAt)
 assert.deepEqual(data(await request('GET','my-activity')).commentIds,[original.id])
 assert.deepEqual(data(await request('GET','my-activity',undefined,'bob')).commentIds,[])
 assert.equal((await request('PATCH','/v1/problems/p2/'+path,{text:'Wrong route'})).statusCode,404)
 for(const body of [{text:''},{text:'x'.repeat(1001)},{text:'Hi',userId:'bob'},{text:'Hi',createdAt:'fake'},null,[]])
  assert.equal((await request('PATCH',path,body)).statusCode,400)
 assert.equal((await request('PATCH','comments/missing',{text:'Hi'})).statusCode,404)
 assert.equal((await request('DELETE',path)).statusCode,200)
 assert.equal((await request('DELETE',path)).statusCode,200)
 assert.equal((await request('PATCH',path,{text:'Resurrect'})).statusCode,404)
 assert.equal(data(await request('GET','community',undefined,null)).comments.length,0)
 assert.deepEqual(data(await request('GET','my-activity')).commentIds,[])
 const tombstone=rows.get('PROBLEM#p1|COMMENT#'+original.id)
 assert(tombstone.deleted);assert(!tombstone.text);assert(!tombstone.gsi1pk)
 // A delayed create retry cannot bring a deleted comment back.
 assert.equal((await request('POST','comments',{text:'Original',requestId:original.id})).statusCode,410)
})
test('concurrent deletes block edits atomically and delete retries remain successful',async()=>{
 const original=data(await request('POST','comments',{text:'Original'}))
 const path='comments/'+original.id
 beforeUpdate=row=>{row.deleted=true}
 assert.equal((await request('PATCH',path,{text:'Late edit'})).statusCode,409)
 assert.equal(rows.get('PROBLEM#p1|COMMENT#'+original.id).text,'Original')
 const second=data(await request('POST','comments',{text:'Another'}))
 beforeUpdate=row=>{row.deleted=true}
 assert.equal((await request('DELETE','comments/'+second.id)).statusCode,200)
})
test('ownership lookup paginates through comments from other users',async()=>{
 for(let i=0;i<5;i++)await request('POST','comments',{text:'Comment '+i},i%2?'bob':'alice')
 assert.equal(data(await request('GET','my-activity')).commentIds.length,3)
 assert.equal(data(await request('GET','my-activity',undefined,'bob')).commentIds.length,2)
})

test('public profile cards identify the actual creator and comment author without private fields',async()=>{
 const problem=rows.get('PROBLEM#p1|META')
 problem.ownerId='alice';problem.setter='Guest setter'
 Object.assign(rows.get('USER#alice|PROFILE'),{email:'private@example.com',isAdmin:true,groups:['admins']})
 let profile=await request('GET','creator-profile',undefined,null)
 assert.equal(profile.statusCode,200)
 assert.deepEqual(data(profile),{displayName:'Alice',bio:'Private bio'})
 const comment=data(await request('POST','comments',{text:'Nice'}))
 assert.equal(comment.hasAuthorProfile,true)
 assert(!('userId' in comment))
 rows.get('USER#alice|PROFILE').displayName='New name'
 profile=await request('GET','comments/'+comment.id+'/author-profile',undefined,null)
 assert.equal(profile.statusCode,200)
 assert.deepEqual(data(profile),{displayName:'New name',bio:'Private bio'})
 assert.equal((await request('PATCH','creator-profile',{bio:'Hacked'},null)).statusCode,405)
 assert.equal((await request('PATCH','comments/'+comment.id+'/author-profile',{bio:'Hacked'},null)).statusCode,405)
 assert.equal((await request('GET','comments/missing/author-profile',undefined,null)).statusCode,404)
 await request('DELETE','comments/'+comment.id)
 assert.equal((await request('GET','comments/'+comment.id+'/author-profile',undefined,null)).statusCode,404)
 delete problem.ownerId
 assert.equal((await request('GET','creator-profile',undefined,null)).statusCode,404)
})
test('public cards handle empty profiles and never infer users from setter names',async()=>{
 const problem=rows.get('PROBLEM#p1|META')
 problem.ownerId='bob';problem.setter='Alice'
 assert.deepEqual(data(await request('GET','creator-profile',undefined,null)),{displayName:'Climber',bio:''})
 const comment=data(await request('POST','comments',{text:'Hi'},'bob'))
 assert.deepEqual(data(await request('GET','comments/'+comment.id+'/author-profile',undefined,null)),{displayName:'Climber',bio:''})
 assert.equal((await request('GET','/v1/problems/missing/creator-profile',undefined,null)).statusCode,404)
})

test('route comment totals include every page, exclude deleted rows, and track writes without storing counters',async()=>{
 const original=structuredClone(rows.get('PROBLEM#p1|META'))
 rows.set('PROBLEM#p1|LIST',{pk:'PROBLEM#p1',sk:'LIST',problemId:'p1',gsi1pk:'GYM#stoneham-crg#WALL#spray-wall-1#ALL',gsi1sk:'PROBLEM#2026-11-03#p1'})
 for(let i=0;i<25;i++){
  const id=String(i).padStart(2,'0'),deleted=i<2
  const row={pk:'PROBLEM#p1',sk:'COMMENT#'+id,id,text:'Comment '+id,author:'Alice',userId:'alice',createdAt:'2026-11-03',...(deleted?{deleted:true}:{gsi1pk:'PROBLEM#p1#COMMENTS',gsi1sk:'2026-11-03#'+id})}
  rows.set(key(row),row)
 }
 const first=data(await request('GET','community',undefined,null))
 assert.equal(first.comments.length,20);assert.equal(first.commentCount,23);assert(first.nextCursor)
 const second=data(await request('GET','community',undefined,null,first.nextCursor))
 assert.equal(second.comments.length,3);assert.equal(second.commentCount,23)
 const list=()=>request('GET','/v1/gyms/stoneham-crg/walls/spray-wall-1/problems',undefined,null)
 assert.equal(data(await list()).items[0].commentCount,23)
 assert.equal(data(await request('GET','/v1/problems/p1',undefined,null)).commentCount,23)
 assert.equal(data(await request('DELETE','comments/24')).commentCount,22)
 assert.equal(data(await request('DELETE','comments/24')).commentCount,22)
 assert.equal(data(await list()).items[0].commentCount,22)
 const input={text:'New comment',requestId:'00000000-0000-4000-8000-000000000099'}
 assert.equal(data(await request('POST','comments',input)).commentCount,23)
 assert.equal(data(await request('POST','comments',input)).commentCount,23)
 assert.equal(data(await request('PATCH','comments/23',{text:'Edited comment'})).commentCount,23)
 assert.equal(data(await list()).items[0].commentCount,23)
 assert.deepEqual(rows.get('PROBLEM#p1|META'),original)
})
