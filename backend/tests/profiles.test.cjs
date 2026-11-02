const assert = require('node:assert/strict')
const { test, beforeEach } = require('node:test')
const sdk = require('@aws-sdk/lib-dynamodb')
process.env.DYNAMODB_TABLE = 'profile-test'
let rows, calls
sdk.DynamoDBDocumentClient.from = () => ({ send: async command => {
 const p = command.input; calls.push(p)
 const key = p.Key.pk
 if (command.constructor.name === 'GetCommand') return { Item: rows.get(key) }
 if (command.constructor.name === 'UpdateCommand') {
  const row = { ...(rows.get(key) || {}), ...p.Key }
  for (const field of ['displayName','bio','entity','updated']) {
   if (p.ExpressionAttributeValues[':'+field] !== undefined) row[p.ExpressionAttributeNames['#'+field]] = p.ExpressionAttributeValues[':'+field]
  }
  rows.set(key,row); return {Attributes:row}
 }
 throw new Error('Unexpected command')
}})
const {handler}=require('../dist/test-handler.cjs')
const request=(method,body,user='alice')=>handler({
 rawPath:'/v1/me/profile',body:JSON.stringify(body),
 requestContext:{requestId:'profile',http:{method,path:'/v1/me/profile'},
 ...(user?{authorizer:{jwt:{claims:{sub:user}}}}:{})}
})
const data=r=>JSON.parse(r.body)
beforeEach(()=>{rows=new Map();calls=[]})
test('anonymous profile reads and writes are rejected',async()=>{
 assert.equal((await request('GET',undefined,null)).statusCode,401)
 assert.equal((await request('PATCH',{displayName:'Attack'},null)).statusCode,401)
 assert.equal(calls.length,0)
})
test('new profile is blank and saves trimmed values under authenticated subject',async()=>{
 assert.deepEqual(data(await request('GET')),{displayName:'',bio:''})
 const result=await request('PATCH',{displayName:' Alice ',bio:' Loves slabs '})
 assert.equal(result.statusCode,200)
 assert.deepEqual(data(result),{displayName:'Alice',bio:'Loves slabs'})
 assert.equal(calls.at(-1).Key.pk,'USER#alice')
 assert(!rows.get('USER#alice').gsi1pk)
 assert(!('pk' in data(result)))
 assert.deepEqual(data(await request('GET')),{displayName:'Alice',bio:'Loves slabs'})
 assert.equal(calls.at(-1).ConsistentRead,true)
})
test('users are isolated and partial updates preserve other profile fields',async()=>{
 await request('PATCH',{displayName:'Alice',bio:'Slabs'})
 await request('PATCH',{bio:''})
 assert.deepEqual(data(await request('GET')),{displayName:'Alice',bio:''})
 assert.deepEqual(data(await request('GET',undefined,'bob')),{displayName:'',bio:''})
})
test('privilege and identity fields cannot be updated, invalid fields never write',async()=>{
 for(const payload of [{ownerId:'bob'},{userId:'bob'},{isAdmin:true},{email:'other@example.com'},{displayName:''},{displayName:'a'.repeat(61)},{bio:'x'.repeat(161)},{bio:null},{}]) {
  assert.equal((await request('PATCH',payload)).statusCode,400,JSON.stringify(payload))
 }
 assert.equal(calls.length,0)
})
