import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initializeReview, applyReview, validateProgress, saveReview, reviewKey, validateHold, sameSession, resumeReview } from '../src/wallReview.ts'
const session={sessionId:'a'.repeat(64),scanId:'scan',gymId:'gym',wallId:'wall',referenceVersion:'old',candidateVersion:'new',referenceImageSha256:'b'.repeat(64),referenceHoldsSha256:'c'.repeat(64),registeredImageSha256:'d'.repeat(64),coordinateFrame:{size:[7292,5514],orientation:'EXIF-prepared canonical reference'}}
const hold={id:'old-hold',kind:'hold',center:[.2,.2],polygon:[[.1,.1],[.3,.1],[.3,.3],[.1,.3]]}
function baseline(fraction=1) {
 return initializeReview({session,publishable:false},{session,publishable:false,holds:fraction?[hold]:[]},
 {session,publishable:false,reviewRevision:0,entries:[{oldHoldId:hold.id,candidateHoldId:hold.id,status:'inherited-unreviewed',observed:fraction>0,coverage_fraction:fraction,reasonCodes:['baseline-no-change-classification']}]},[hold])
}
const time='2026-11-05T00:00:00Z'
const decide=(state,action)=>applyReview(state,action,'Lu',time)
const memory=()=>{const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)}}
test('loading never approves geometry; even high model scores leave all inherited entries pending',()=>{
 const state=baseline();assert.equal(state.entries[0].status,'inherited-unreviewed');assert.equal(state.publishable,false)
 assert.deepEqual(validateProgress(state,state),state)
 const forged=structuredClone(state);forged.entries[0].status='verified-unchanged'
 assert.throws(()=>validateProgress(forged,state),/history/)
 assert.throws(()=>initializeReview({session,publishable:false},{holds:[hold]}, {}, [hold]))
})
test('session checks bind exact image bytes and versions, not dimensions or sessionId alone',()=>{
 for(const patch of [{registeredImageSha256:'e'.repeat(64)},{candidateVersion:'different'},{referenceHoldsSha256:'f'.repeat(64)}]){
  assert.throws(()=>sameSession(session,{...session,...patch}),/identity/)
  assert.throws(()=>validateProgress({...baseline(),session:{...session,...patch}},baseline()),/identity/)
 }
})
test('human decisions persist with reviewer, geometry, lineage and one revision',()=>{
 let state=decide(baseline(),{type:'confirm',id:hold.id})
 assert.equal(state.entries[0].status,'verified-unchanged');assert.equal(state.reviewRevision,1);assert.equal(state.entries[0].reviewer,'Lu')
 state=decide(state,{type:'refine',id:hold.id,hold:{...hold,polygon:[[.12,.1],[.3,.1],[.3,.3],[.1,.3]]}})
 assert.equal(state.entries[0].status,'verified-refined');assert.equal(state.entries[0].hold.id,hold.id)
 assert.deepEqual(validateProgress(JSON.parse(JSON.stringify(state)),baseline()),state)
 state=decide(state,{type:'reset',id:hold.id});assert.equal(state.entries[0].status,'inherited-unreviewed');assert.deepEqual(state.entries[0].hold,hold)
 assert.deepEqual(validateProgress(state,baseline()),state)
})
test('overlapping replacement survives; old identity is removed and new ID is mandatory',()=>{
 assert.throws(()=>decide(baseline(),{type:'add',hold,replaces:hold.id}),/fresh ID/)
 const state=decide(baseline(),{type:'add',hold:{...hold,id:'replacement'},replaces:hold.id})
 assert.equal(state.reviewRevision,1);assert.equal(state.history.length,2)
 assert.equal(state.entries[0].status,'removed');assert.equal(state.entries[1].status,'new');assert.equal(state.entries[1].oldHoldId,hold.id)
 assert.deepEqual(validateProgress(state,baseline()),state)
 assert.throws(()=>decide(state,{type:'reset',id:hold.id}),/replacement first/)
 let reset=decide(state,{type:'reset',id:'replacement'});reset=decide(reset,{type:'reset',id:hold.id})
 assert.equal(reset.entries[1].status,'dismissed');assert.equal(reset.entries[0].status,'inherited-unreviewed')
 assert.deepEqual(validateProgress(reset,baseline()),reset)
})
test('coverage gaps cannot become unchanged/refined/removed decisions',()=>{
 for(const fraction of [0,.5,.98]) {
  for(const type of ['confirm','remove','refine'])assert.throws(()=>decide(baseline(fraction),{type,id:hold.id,hold}),/coverage/)
 }
 assert.equal(baseline(0).entries.length,1)
 assert.throws(()=>applyReview(baseline(),{type:'confirm',id:hold.id},''),/reviewer name/)
})
test('stale tab, disappeared storage and quota failures never report a successful save',()=>{
 const storage=memory(),base=baseline(),next=decide(base,{type:'confirm',id:hold.id})
 saveReview(storage,base,base);saveReview(storage,base,next)
 assert.throws(()=>saveReview(storage,base,decide(base,{type:'remove',id:hold.id})),/Another tab/)
 assert.equal(JSON.parse(storage.getItem(reviewKey(session))).reviewRevision,1)
 assert.throws(()=>saveReview(memory(),next,next),/disappeared/)
 assert.throws(()=>saveReview({getItem:()=>null,setItem:()=>{throw new Error('quota')}},base,next),/quota/)
})
test('checkpoint replay rejects changed snapshots, omitted replacement and tampered revisions',()=>{
 const state=decide(baseline(),{type:'confirm',id:hold.id})
 for(const mutate of [s=>{s.reviewRevision++},s=>{s.history[0].before=null},s=>{s.entries[0].hold.center=[0,0]},s=>{s.history[0].reviewer=''}]) {
  const changed=structuredClone(state);mutate(changed);assert.throws(()=>validateProgress(changed,baseline()))
 }
 const replaced=decide(baseline(),{type:'add',hold:{...hold,id:'new'},replaces:hold.id});replaced.history.pop()
 assert.throws(()=>validateProgress(replaced,baseline()),/atomic/)
})
test('invalid and crossing manual polygons are rejected before a decision',()=>{
 assert.throws(()=>validateHold({...hold,polygon:[[.1,.1],[.3,.3],[.1,.3],[.3,.1]]}))
 assert.throws(()=>validateHold({...hold,polygon:[[0,0],[1,1],[0,0]]}))
 assert.throws(()=>validateHold({...hold,center:[NaN,.5]}))
})
test('the actual Phase B fixture opens all 677 holds without promoting any',()=>{
 const root='artifacts/wall-rescans/mosaic-fixture-v1/'
 // Audit summary is checked in; full-sized artifacts need not be in CI.
 const manifest=JSON.parse(readFileSync(root+'manifest-summary.json'))
 const holds=JSON.parse(readFileSync('src/data/polygons/holds.json'))
 const queue={session:manifest.session,publishable:false,reviewRevision:0,entries:holds.map(h=>({oldHoldId:h.id,candidateHoldId:h.id,status:'inherited-unreviewed',observed:true,coverage_fraction:1,reasonCodes:['baseline-no-change-classification']}))}
 const state=initializeReview(manifest,{session:manifest.session,publishable:false,holds},queue,holds)
 assert.equal(state.entries.length,677);assert(state.entries.every(e=>e.status==='inherited-unreviewed'))
})

test('resuming must extend existing history, rather than silently overwrite a fork',()=>{
 const base=baseline(),confirmed=decide(base,{type:'confirm',id:hold.id}),removed=decide(base,{type:'remove',id:hold.id})
 assert.throws(()=>resumeReview(removed,confirmed,base),/conflicts/)
 assert.throws(()=>resumeReview(base,confirmed,base),/older/)
 assert.deepEqual(resumeReview(confirmed,base,base),confirmed)
})

test('a replacement cannot be reused as an inherited identity, including on checkpoint replay',()=>{
 const base=baseline(),replaced=decide(base,{type:'add',hold:{...hold,id:'new-hold'},replaces:hold.id})
 assert.throws(()=>decide(replaced,{type:'add',hold:{...hold,id:'newer-hold'},replaces:'new-hold'}),/inherited/)
 const dismissed=decide(replaced,{type:'reset',id:'new-hold'})
 assert.throws(()=>decide(dismissed,{type:'add',hold:{...hold,id:'newer-hold'},replaces:'new-hold'}),/inherited/)
 assert.deepEqual(validateProgress(replaced,base),replaced)
})
