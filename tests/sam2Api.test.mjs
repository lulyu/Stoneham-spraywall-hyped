import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sam2Request,Sam2RequestError} from '../src/sam2Api.ts'
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}})

test('prediction payload and valid status errors keep their original contract',async()=>{
 const input={points:[{point:[.2,.3],label:1}],box:null},original=structuredClone(input)
 const result=await sam2Request('/api/sam2/predict',input,async(url,options)=>{
  assert.equal(url,'/api/sam2/predict');assert.equal(options.method,'POST')
  assert.deepEqual(JSON.parse(options.body),original);assert(options.signal)
  return json({candidates:[],elapsed_seconds:.1})
 })
 assert.deepEqual(input,original);assert.deepEqual(result.candidates,[])
 assert.equal((await sam2Request('/status',undefined,async()=>json({state:'error',error:'Review-only mode'}))).state,'error')
})
test('nested platform errors show the actual message, never object coercion',async()=>{
 await assert.rejects(sam2Request('/predict',{},async()=>json({error:{code:'MODEL_FAILED',message:'Could not process the selected region.'}},500)),e=>{
  assert(e instanceof Sam2RequestError);assert.equal(e.status,500);assert.equal(e.code,'MODEL_FAILED')
  assert.match(e.message,/selected region/);assert(!e.message.includes('[object Object]'));return true
 })
})
test('expired/stopped Sandbox is recognized in structured JSON and the actual plaintext 410',async()=>{
 for(const response of [json({error:{code:'SANDBOX_STOPPED',message:'stopped'}},410),new Response('This sandbox was stopped\nSANDBOX_STOPPED',{status:410,headers:{'x-vercel-error':'SANDBOX_STOPPED'}})]){
  await assert.rejects(sam2Request('/predict',{},async()=>response),e=>{
   assert.equal(e.code,'SANDBOX_STOPPED');assert.match(e.message,/temporary SAM2 server has stopped/)
   assert.match(e.message,/points and draft are preserved/);return true
  })
 }
})
test('Python auth/busy errors stay readable and non-JSON gateway failures are bounded',async()=>{
 for(const [response,expected] of [[json({error:'Another prediction is running.'},409),/Another prediction/],[json({error:'Open the private access link.'},401),/private access link/],[new Response('<html>Gateway error</html>',{status:502}),/HTTP 502/]]){
  await assert.rejects(sam2Request('/predict',{},async()=>response),e=>{assert.match(e.message,expected);assert(!e.message.includes('<html>'));return true})
 }
})
test('network and timeout failures explain retry without changing the caller input',async()=>{
 for(const name of ['TypeError','TimeoutError']){
  await assert.rejects(sam2Request('/predict',{},async()=>{const e=new Error('Transport detail');e.name=name;throw e}),e=>{
   assert.equal(e.status,0);assert.equal(e.code,name==='TimeoutError'?'TIMEOUT':'NETWORK_ERROR')
   assert.match(e.message,/preserved/);return true
  })
 }
 await assert.rejects(sam2Request('/status',undefined,async()=>new Response('not JSON')),/invalid response/)
})
