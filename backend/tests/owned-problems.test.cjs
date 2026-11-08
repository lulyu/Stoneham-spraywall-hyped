const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict')
const sdk=require('@aws-sdk/lib-dynamodb'),holds=require('../../src/data/polygons/holds.json')
process.env.DYNAMODB_TABLE='owned-problems-test'
let rows,queries
const key=item=>item.pk+'|'+item.sk
sdk.DynamoDBDocumentClient.from=()=>({send:async command=>{
 const p=command.input
 if(command.constructor.name==='GetCommand')return {Item:rows.get(key(p.Key))}
 if(command.constructor.name==='QueryCommand'){
  queries.push(p)
  const sorted=[...rows.values()].filter(row=>row.gsi1pk===p.ExpressionAttributeValues[':pk']).sort((a,b)=>b.gsi1sk.localeCompare(a.gsi1sk))
  const start=p.ExclusiveStartKey?sorted.findIndex(row=>key(row)===key(p.ExclusiveStartKey))+1:0
  const items=sorted.slice(start,start+p.Limit),last=items.at(-1)
  return {Items:items,...(start+items.length<sorted.length?{LastEvaluatedKey:{pk:last.pk,sk:last.sk,gsi1pk:last.gsi1pk,gsi1sk:last.gsi1sk}}:{})}
 }
 if(command.constructor.name==='TransactWriteCommand'){
  for(const action of p.TransactItems)if(action.Put)rows.set(key(action.Put.Item),structuredClone(action.Put.Item))
  return {}
 }
 throw Error('Unexpected '+command.constructor.name)
}})
const {handler}=require('../dist/test-handler.cjs')
const request=(user='alice',queryStringParameters,method='GET',path='/v1/me/problems',body)=>handler({rawPath:path,queryStringParameters,body:body&&JSON.stringify(body),requestContext:{requestId:'owned',http:{method,path},...(user?{authorizer:{jwt:{claims:{sub:user}}}}:{})}})
const data=response=>JSON.parse(response.body)
const seed=(id,ownerId,createdAt)=>{
 const row={id,ownerId,createdAt,name:id,grade:'V3',setter:'Someone else',holds:[{holdId:holds[0].id,role:'start'},{holdId:holds[1].id,role:'finish'}],revision:1,gymId:'stoneham-crg',wallId:'spray-wall-1',wallVersionId:'2026-10-v4',pk:'PROBLEM#'+id,sk:'META',entityType:'problem'}
 rows.set(key(row),row)
 const pointer={pk:row.pk,sk:'OWNER',problemId:id,gsi1pk:'USER#'+ownerId+'#ROUTES',gsi1sk:'PROBLEM#'+createdAt+'#'+id}
 rows.set(key(pointer),pointer)
}
beforeEach(()=>{rows=new Map();queries=[];for(let i=1;i<=12;i++)seed('alice-'+String(i).padStart(2,'0'),'alice','2026-10-'+String(i).padStart(2,'0')+'T12:00:00Z');seed('bob-route','bob','2026-12-01T00:00:00Z')})
test('five newest creator-owned routes per page, then five, then two without duplicates',async()=>{
 const pages=[];let cursor
 do{
  const response=await request('alice',cursor?{cursor}:undefined);assert.equal(response.statusCode,200)
  const page=data(response);pages.push(page.items);cursor=page.nextCursor
 }while(cursor)
 assert.deepEqual(pages.map(page=>page.length),[5,5,2])
 assert.deepEqual(pages.flat().map(route=>route.id),Array.from({length:12},(_,index)=>'alice-'+String(12-index).padStart(2,'0')))
 assert(queries.every(query=>query.Limit===5&&query.ScanIndexForward===false))
 assert(pages.flat().every(route=>route.ownerId==='alice'&&route.setter==='Someone else'))
})
test('requires login, isolates accounts, and rejects another creator cursor',async()=>{
 assert.equal((await request(null)).statusCode,401);assert.equal(queries.length,0)
 const alice=data(await request('alice'))
 assert.equal((await request('bob',{cursor:alice.nextCursor})).statusCode,400)
 assert.deepEqual(data(await request('bob',{userId:'alice'})).items.map(route=>route.id),['bob-route'])
 assert.deepEqual(data(await request('new-user')).items,[])
 assert.equal((await request('alice',{cursor:'invalid'})).statusCode,400)
 assert.equal((await request('alice',undefined,'POST')).statusCode,405)
})
test('hydrates current route details and never leaks stale pointers to a different owner',async()=>{
 rows.get('PROBLEM#alice-12|META').name='Renamed route'
 rows.get('PROBLEM#alice-11|META').ownerId='bob'
 const page=data(await request())
 assert.equal(page.items[0].name,'Renamed route')
 assert(!page.items.some(route=>route.id==='alice-11'))
})
test('new route writes immediately include the creator index in the same transaction',async()=>{
 const response=await request('alice',undefined,'POST','/v1/gyms/stoneham-crg/walls/spray-wall-1/versions/2026-10-v4/problems',{name:'New route',grade:'V3',setter:'Guest setter',holds:[{holdId:holds[0].id,role:'start'},{holdId:holds[1].id,role:'finish'}]})
 assert.equal(response.statusCode,201)
 const route=data(response),pointer=rows.get('PROBLEM#'+route.id+'|OWNER')
 assert.equal(pointer.gsi1pk,'USER#alice#ROUTES')
 assert.equal(pointer.problemId,route.id)
 assert.equal(data(await request()).items[0].id,route.id)
})
