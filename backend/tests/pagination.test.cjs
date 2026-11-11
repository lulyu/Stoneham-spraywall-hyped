const assert = require('node:assert/strict')
const { test } = require('node:test')
const sdk = require('@aws-sdk/lib-dynamodb')
process.env.DYNAMODB_TABLE = 'pagination-test'
const partition = 'GYM#stoneham-crg#WALL#spray-wall-1#VERSION#2026-10-v4'
const rows = Array.from({length:125}, (_,i) => ({
 gymId:'stoneham-crg',wallId:'spray-wall-1',wallVersionId:'2026-10-v4', id:'p'+i, name:'Route '+i, grade:'V1', setter:'Tester', holds:[], revision:1,
 pk:'PROBLEM#p'+i, sk:'META', gsi1pk:partition, gsi1sk:'PROBLEM#'+String(i).padStart(4,'0'),
 entityType:'problem',
}))
let queries = 0
sdk.DynamoDBDocumentClient.from = () => ({ send: async command => {
 const p = command.input
 assert.equal(command.constructor.name,'QueryCommand')
 if(p.Select==='COUNT')return {Count:0}
 queries++
 const start = p.ExclusiveStartKey ? rows.findIndex(r => r.pk===p.ExclusiveStartKey.pk)+1 : 0
 const items = rows.slice(start,start+p.Limit), last = items.at(-1)
 return {Items:items,...(start+items.length<rows.length?{LastEvaluatedKey:{pk:last.pk,sk:last.sk,gsi1pk:last.gsi1pk,gsi1sk:last.gsi1sk}}:{})}
}})
const {handler}=require('../dist/test-handler.cjs')
const path='/v1/gyms/stoneham-crg/walls/spray-wall-1/versions/2026-10-v4/problems'
const read=cursor=>handler({rawPath:path,queryStringParameters:cursor?{cursor}:undefined,requestContext:{requestId:'page',http:{method:'GET',path}}})
test('all 125 routes can be browsed across three pages, including beyond 100',async()=>{
 let cursor, items=[]
 do {
  const response=await read(cursor)
  assert.equal(response.statusCode,200)
  const page=JSON.parse(response.body)
  items.push(...page.items)
  cursor=page.nextCursor
 }while(cursor)
 assert.equal(items.length,125)
 assert.equal(new Set(items.map(r=>r.id)).size,125)
 assert.equal(queries,3)
 assert(items.every(r=>!('pk' in r)&&!('gsi1pk' in r)))
})
test('malformed and cross-wall cursors are rejected before querying',async()=>{
 const before=queries
 for(const cursor of ['not-json',Buffer.from(JSON.stringify({pk:'PROBLEM#x',sk:'META',gsi1pk:'OTHER_WALL',gsi1sk:'PROBLEM#x'})).toString('base64url')]){
  assert.equal((await read(cursor)).statusCode,400)
 }
 assert.equal(queries,before)
})
