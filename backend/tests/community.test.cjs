const assert=require('node:assert/strict')
const {test,beforeEach}=require('node:test')
const sdk=require('@aws-sdk/lib-dynamodb')
const holds=require('../../src/data/polygons/holds.json')
process.env.DYNAMODB_TABLE='community-test'
let rows, pageCalls
const key=r=>r.pk+'|'+r.sk
sdk.DynamoDBDocumentClient.from=()=>Object.setPrototypeOf({send:async command=>{
 const p=command.input,kind=command.constructor.name
 if(kind==='GetCommand')return {Item:rows.get(key(p.Key))}
 if(kind==='PutCommand'){
  if(p.ConditionExpression&&rows.has(key(p.Item)))throw Object.assign(new Error(),{name:'ConditionalCheckFailedException'})
  rows.set(key(p.Item),p.Item);return {}
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
  const all=[...rows.values()].filter(r=>r.pk===pk&&r.sk.startsWith('RATING#')).sort((a,b)=>a.sk.localeCompare(b.sk))
  const start=p.ExclusiveStartKey?all.findIndex(r=>r.sk===p.ExclusiveStartKey.sk)+1:0
  const selected=all.slice(start,start+1),last=selected.at(-1)
  return {Items:selected,...(start+1<all.length?{LastEvaluatedKey:{pk:last.pk,sk:last.sk}}:{})}
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
 rows=new Map();pageCalls=0
 const problem={pk:'PROBLEM#p1',sk:'META',id:'p1',name:'Route one',grade:'V4',setter:'Original setter',gymId:'stoneham-crg',wallId:'spray-wall-1',wallVersionId:'2026-10-v4',holds:[{holdId:holds[0].id,role:'start'},{holdId:holds[1].id,role:'finish'}],createdAt:'2026-11-03',updatedAt:'2026-11-03',revision:1}
 rows.set(key(problem),problem)
 rows.set('USER#alice|PROFILE',{pk:'USER#alice',sk:'PROFILE',displayName:'Alice',bio:'Private bio'})
})
test('all writes and private reads reject anonymous callers',async()=>{
 for(const [method,path,body] of [['POST','sends'],['PATCH','rating',{score:4}],['POST','comments',{text:'Hi'}],['GET','my-activity'],['GET','/v1/me/sends']]){
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
