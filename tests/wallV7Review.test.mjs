import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { initializeReview } from '../src/wallReview.ts'
import { validateProposals, bulkProposalActions } from '../src/wallProposals.ts'

test('v7 SAM2 refresh prompts all 797 saved holds and keeps image-specific results unapproved',()=>{
  const read=path=>JSON.parse(readFileSync(path)),sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
  const path='reviews/2026-11-v7-sam2-refresh/candidate.json',m=read(path)
  const raw=read('src/data/experiments/wall-v7-sam2-refresh.json')
  const holds=read('reviews/2026-11-v7-sam2-refresh/reference-holds.json')
  const snapshot=read('reviews/2026-11-v6-highres/confirmed-geometry.json')
  assert.deepEqual(holds,snapshot.holds)
  assert.equal(raw.metadata.promptCount,797);assert.equal(raw.metadata.oldHoldCount,797)
  assert.equal(raw.metadata.includePartialObservationPrompts,true)
  assert.equal(raw.metadata.acceptedHoldCount,0)
  assert.notEqual(m.imageSha256,snapshot.imageSha256)
  const session={...m.sourceSession,candidateVersion:m.wallVersionId,registeredImageSha256:m.imageSha256,
    sourceSessionId:m.sourceSession.sessionId,candidateManifestSha256:sha(path),
    coverageSha256:m.coverageSha256,uncertaintySha256:m.uncertaintySha256,referenceHoldsSha256:m.referenceHoldsSha256}
  const entries=raw.entries.map(e=>({oldHoldId:e.oldHoldId,candidateHoldId:e.oldHoldId,status:'inherited-unreviewed',
    observed:e.observationFraction>0,coverage_fraction:e.observationFraction,reasonCodes:[]}))
  const baseline=initializeReview({session,publishable:false},{session,publishable:false,holds},
    {session,publishable:false,reviewRevision:0,entries},holds)
  const model=validateProposals(raw,baseline)
  assert(model.proposals.length>0)
  assert(baseline.entries.every(e=>e.status==='inherited-unreviewed'))
  const partial=raw.entries.filter(e=>e.observationFraction<.99)
  assert(partial.length>0);assert(partial.every(e=>e.prompt))
  for(const action of bulkProposalActions(baseline,model,.92))
    assert(baseline.entries.find(e=>e.hold.id===action.id).coverageFraction>=.99)
})

test('the exact onsite proposals match the live review session and saved source outlines',()=>{
  const path='reviews/2026-11-v7-sam2-refresh/'
  const raw=JSON.parse(readFileSync(path+'onsite-sam2-proposals.json'))
  const manifest=JSON.parse(readFileSync(path+'onsite-session-manifest.json'))
  const holds=JSON.parse(readFileSync(path+'reference-holds.json'))
  const session=manifest.session
  assert.equal(createHash('sha256').update(readFileSync(path+'onsite-sam2-proposals.json')).digest('hex'),session.proposalsSha256)
  assert.equal(createHash('sha256').update(readFileSync(path+'reference-holds.json')).digest('hex'),session.referenceHoldsSha256)
  const entries=raw.entries.map(e=>({oldHoldId:e.oldHoldId,candidateHoldId:e.oldHoldId,status:'inherited-unreviewed',
    observed:e.observationFraction>0,coverage_fraction:e.observationFraction,reasonCodes:[]}))
  const baseline=initializeReview(manifest,{session,publishable:false,holds},{session,publishable:false,reviewRevision:0,entries},holds)
  const model=validateProposals(raw,baseline)
  assert.equal(raw.metadata.promptCount,797);assert.equal(model.proposals.length,795)
  assert.equal(model.proposals.filter(p=>p.oldHoldIds.length>1).length,2)
  assert.equal(baseline.reviewRevision,0)
})
