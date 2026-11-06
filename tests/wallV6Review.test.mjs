import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { initializeReview, sameSession } from '../src/wallReview.ts'
import { validateProposals, bulkProposalActions } from '../src/wallProposals.ts'

test('high-resolution reference-filled candidate has its own valid, unapproved suggestions',()=>{
 const path='public/wall/versions/2026-11-v6-highres/manifest.json'
 const m=JSON.parse(readFileSync(path)),raw=JSON.parse(readFileSync('src/data/experiments/wall-v6-highres-sam2-refresh.json'))
 const holds=JSON.parse(readFileSync('src/data/polygons/holds.json'))
 const session={...m.sourceSession,candidateVersion:m.wallVersionId,registeredImageSha256:m.imageSha256,
  sourceSessionId:m.sourceSession.sessionId,coverageSha256:m.coverageSha256,uncertaintySha256:m.uncertaintySha256,
  referenceFilledFraction:m.referenceFilledFraction,candidateManifestSha256:createHash('sha256').update(readFileSync(path)).digest('hex')}
 const entries=raw.entries.map(e=>({oldHoldId:e.oldHoldId,candidateHoldId:e.oldHoldId,status:'inherited-unreviewed',
  observed:e.observationFraction>0,coverage_fraction:e.observationFraction,reasonCodes:[]}))
 const base=initializeReview({session,publishable:false},{session,publishable:false,holds},
  {session,publishable:false,reviewRevision:0,entries},holds)
 const model=validateProposals(raw,base)
 assert.equal(base.entries.length,677);assert.equal(model.proposals.length,640)
 assert(base.entries.every(e=>e.status==='inherited-unreviewed'));assert.equal(base.reviewRevision,0)
 assert.equal(raw.metadata.acceptedHoldCount,0);assert(m.referenceFilledFraction>0)
 assert(raw.entries.filter(e=>e.observationFraction<.99).every(e=>e.proposalId===null))
 const actions=bulkProposalActions(base,model,.95);assert(actions.length>0)
 assert(actions.every(a=>base.entries.find(e=>e.hold.id===a.id).coverageFraction>=.99))
 const v5=JSON.parse(readFileSync('public/wall/versions/2026-11-v5/manifest.json'))
 assert.throws(()=>sameSession(session,v5.sourceSession),/identity/)
 assert.notEqual(m.imageSha256,v5.imageSha256)
})
