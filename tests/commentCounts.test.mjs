import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fetchCommentCount, withMissingCommentCounts} from '../src/commentCounts.ts'
const base='https://example.com'
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}})
test('uses a server total independently of displayed comments',async()=>{
 let calls=0
 const count=await fetchCommentCount(base,'route',async()=>{calls++;return response({commentCount:37,comments:[{id:'one'}],nextCursor:'more'})})
 assert.equal(count,37);assert.equal(calls,1)
})
test('legacy pages count every distinct live comment, including after empty pages',async()=>{
 const requested=[]
 const first={comments:Array.from({length:20},(_,i)=>({id:String(i)})),nextCursor:'next'}
 const count=await fetchCommentCount(base,'route',async(url,options)=>{
  requested.push(String(url));assert(!options.headers)
  return requested.length===1?response({comments:[],nextCursor:'last'}):response({comments:[{id:'19'},{id:'20'},{id:'21'},{id:'22'},{id:'deleted',deleted:true}]})
 },first)
 assert.equal(count,23);assert.equal(requested.length,2)
 assert(requested[0].endsWith('cursor=next'));assert(requested[1].endsWith('cursor=last'))
})
test('existing totals skip requests; missing totals fill without changing original routes',async()=>{
 const original=[{id:'known',commentCount:4},{id:'empty'},{id:'thread'}],requests=[]
 const result=await withMissingCommentCounts(base,original,async url=>{
  requests.push(String(url));return response({comments:String(url).includes('/thread/')?[{id:'one'}]:[]})
 })
 assert.deepEqual(result,[{id:'known',commentCount:4},{id:'empty',commentCount:0},{id:'thread',commentCount:1}])
 assert.deepEqual(original,[{id:'known',commentCount:4},{id:'empty'},{id:'thread'}]);assert.equal(requests.length,2)
})
test('failed or malformed counts leave badges unavailable without failing route browsing',async()=>{
 for(const body of [null,{}, {comments:[{}]}, {comments:[],nextCursor:42}]){
  assert.deepEqual(await withMissingCommentCounts(base,[{id:'route'}],async()=>response(body)),[{id:'route'}])
 }
 assert.deepEqual(await withMissingCommentCounts(base,[{id:'route'}],async()=>new Response('failed',{status:503})),[{id:'route'}])
 await assert.rejects(fetchCommentCount(base,'route',async()=>response({comments:[],nextCursor:'repeat'})),/cursor/)
})
test('bounds legacy requests while preserving route order',async()=>{
 let active=0,peak=0
 const routes=Array.from({length:12},(_,i)=>({id:String(i)}))
 const result=await withMissingCommentCounts(base,routes,async()=>{
  active++;peak=Math.max(active,peak);await new Promise(resolve=>setTimeout(resolve,2));active--;return response({comments:[]})
 })
 assert(peak<=4);assert.deepEqual(result.map(route=>route.id),routes.map(route=>route.id));assert(result.every(route=>route.commentCount===0))
})
