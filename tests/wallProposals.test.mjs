import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { initializeReview, applyReview } from '../src/wallReview.ts'
import { validateProposals } from '../src/wallProposals.ts'
const json=p=>JSON.parse(readFileSync(p))
const manifestPath='public/wall/versions/2026-11-v5/manifest.json'
const manifest=json(manifestPath),raw=json('src/data/experiments/wall-v5-sam2-refresh.json'),holds=json('src/data/polygons/holds.json')
const session={...manifest.sourceSession,sourceSessionId:manifest.sourceSession.sessionId,candidateVersion:manifest.wallVersionId,
 registeredImageSha256:manifest.imageSha256,coverageSha256:manifest.coverageSha256,uncertaintySha256:manifest.uncertaintySha256,
 candidateManifestSha256:createHash('sha256').update(readFileSync(manifestPath)).digest('hex')}
const base=initializeReview({session,publishable:false},{session,publishable:false,holds},
 {session,publishable:false,reviewRevision:0,entries:holds.map(h=>({oldHoldId:h.id,candidateHoldId:h.id,status:'inherited-unreviewed',observed:true,coverage_fraction:1,reasonCodes:[]}))},holds)
test('real v5 suggestions load as drafts; confirmation retains inherited ID and requires a human action',()=>{
 const result=validateProposals(raw,base)
 assert.equal(result.proposals.length,639)
 assert.equal(base.reviewRevision,0);assert(base.entries.every(e=>e.status==='inherited-unreviewed'))
 const p=result.proposals[0],id=p.oldHoldIds[0]
 const next=applyReview(base,{type:'refine',id,hold:{...p,id}},'Reviewer')
 assert.equal(next.entries.find(e=>e.hold.id===id).status,'verified-refined')
 assert.equal(next.entries.length,677);assert.equal(next.publishable,false)
 assert(!next.entries.some(e=>e.hold.id===p.id))
 assert(result.proposals.some(p=>p.oldHoldIds.length>1),'shared masks retain all old associations')
})
test('wrong candidate, changed geometry, unknown associations and duplicate proposal IDs are rejected',()=>{
 for(const mutate of [
  x=>{x.metadata.hashes.image='f'.repeat(64)},x=>{x.metadata.hashes.coverage='f'.repeat(64)},
  x=>{x.metadata.versionManifestSha256='f'.repeat(64)},x=>{x.entries[0].oldGeometry.center=[0,0]},
  x=>{x.proposals[0].oldHoldIds=['unknown']},x=>{x.proposals.push(x.proposals[0])},
  x=>{x.proposals[0].id=holds[0].id},x=>{x.entries[0].status='verified-unchanged'},
  x=>{x.entries.pop()},x=>{x.proposals[0].evidence.modelScore=2}
 ]){const changed=structuredClone(raw);mutate(changed);assert.throws(()=>validateProposals(changed,base))}
})

test('bulk confirmation respects threshold, ambiguity, coverage, risk and existing decisions',async()=>{
 const {bulkProposalActions}=await import('../src/wallProposals.ts')
 const {validateProgress}=await import('../src/wallReview.ts')
 const model=validateProposals(raw,base),actions=bulkProposalActions(base,model,.95)
 assert(actions.length>0 && actions.length<639)
 assert.equal(bulkProposalActions(base,model,1).length,0)
 assert.throws(()=>bulkProposalActions(base,model,NaN))
 const first=actions[0],proposal=model.proposals.find(p=>p.oldHoldIds.includes(first.id))
 for(const mutate of [
  m=>{m.proposals.find(p=>p.id===proposal.id).score=.94},
  m=>{m.proposals.find(p=>p.id===proposal.id).uncertaintyFraction=.01},
  m=>{m.proposals.find(p=>p.id===proposal.id).observedFraction=.98},
  m=>{m.proposals.find(p=>p.id===proposal.id).oldHoldIds.push(holds.find(h=>h.id!==first.id).id)},
  m=>{m.recommendations[first.id]='alignment-needs-review'},
  m=>{m.proposals.push({...proposal,id:'duplicate-proposal'})}
 ]){const changed=structuredClone(model);mutate(changed);assert(!bulkProposalActions(base,changed,.95).some(a=>a.id===first.id))}
 const gap=structuredClone(base);gap.entries.find(e=>e.hold.id===first.id).coverageFraction=.98
 assert(!bulkProposalActions(gap,model,.95).some(a=>a.id===first.id))
 let next=base
 for(const action of actions)next=applyReview(next,action,'Bulk reviewer')
 assert.equal(next.reviewRevision,actions.length);assert.equal(next.entries.length,677)
 assert.equal(bulkProposalActions(next,model,.95).length,0)
 assert.deepEqual(validateProgress(next,base),next)
 assert.equal(base.reviewRevision,0)
 console.log(`Bulk fixture: ${actions.length} eligible at 0.95; ${JSON.stringify(next).length} checkpoint bytes`)
})
