import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {initializeReview,validateProgress,confirmed,validateHold} from '../../src/wallReview.ts'
import {validateProposals} from '../../src/wallProposals.ts'
const dir=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(dir,'../..'),read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const archive=read(dir+'/archive-manifest.json'),summary=read(dir+'/summary.json')
for(const [file,record] of Object.entries(archive.assets)){assert.equal(sha(path.join(dir,file)),record.sha256,file);assert.equal(fs.statSync(path.join(dir,file)).size,record.bytes,file)}
for(const record of archive.sourceFiles)assert.equal(sha(path.join(repo,record.path)),record.sha256,record.path)
const source=path.join(repo,archive.assistantArchive),original=read(source+'/review-progress.json'),reference=read(repo+'/src/data/walls/2026-11-v9/holds.json'),baseline=initializeReview(read(source+'/baseline/manifest.json'),read(source+'/baseline/holds_prelabels.json'),read(source+'/baseline/review_queue.json'),reference)
validateProposals(read(source+'/baseline/sam2-proposals.json'),baseline)
const raw=read(dir+'/review-progress.json'),final=validateProgress(raw,baseline),active=final.entries.filter(confirmed),geometry=read(dir+'/confirmed-geometry.json'),qa=read(dir+'/geometry-qa.json')
assert.equal(sha(dir+'/review-progress.json'),'18b0e41de52819ca5731888f1cc2699dafb02087821f4de3bd7d6b89dd9b4e0e')
assert.equal(sha(dir+'/review-progress.json'),geometry.checkpointSha256);assert.equal(geometry.checkpointSha256,summary.checkpointSha256)
assert.deepEqual(final.session,original.session);assert.deepEqual(final.history.slice(0,891),original.history)
assert(final.history.slice(891).every(e=>e.reviewer==='Lu'&&e.reviewerKind!=='assistant'))
assert.equal(final.reviewRevision,871);assert.equal(final.history.length,901);assert.equal(active.length,862)
assert.equal(final.entries.filter(e=>e.status==='inherited-unreviewed').length,0);assert.equal(new Set(active.map(e=>e.hold.id)).size,862)
const ids=new Set(active.map(e=>e.hold.id)),oldIds=new Set(reference.map(h=>h.id))
assert.equal(active.filter(e=>oldIds.has(e.hold.id)).length,819);assert.equal(active.filter(e=>!oldIds.has(e.hold.id)).length,43)
assert(original.entries.filter(confirmed).every(e=>ids.has(e.hold.id)));assert.equal(summary.humanAddedIds.length,4);assert.equal(summary.humanRefinedIds.length,6);assert.equal(summary.humanRemovedIds.length,0)
assert.deepEqual(active.map(e=>validateHold(e.hold)),geometry.holds);assert.equal(sha(source+'/wall.jpg'),final.session.registeredImageSha256)
assert.equal(sha(source+'/baseline/sam2-proposals.json'),final.session.proposalsSha256);assert.equal(sha(source+'/candidate-manifest.json'),final.session.candidateManifestSha256)
assert.equal(qa.holdCount,862);assert.equal(qa.minimumNewPhotoCoverage,1);assert.deepEqual(qa.nearIdenticalPolygons,[])
assert.equal(summary.publishable,false);assert.equal(geometry.publishable,false)
const reconciled=validateProgress(read(dir+'/identity-reconciled-progress.json'),baseline),ready=reconciled.entries.filter(confirmed),publication=read(dir+'/publication-geometry.json'),identity=read(dir+'/identity-reconciliation.json')
assert.deepEqual(reconciled.history.slice(0,901),raw.history)
assert(reconciled.history.slice(901).every(e=>e.reviewerKind==='assistant'&&e.reviewer==='Codex (identity reconciliation)'))
assert.equal(reconciled.reviewRevision,874);assert.equal(reconciled.history.length,904);assert.equal(ready.length,862)
assert.equal(ready.filter(e=>oldIds.has(e.hold.id)).length,820);assert.equal(ready.filter(e=>!oldIds.has(e.hold.id)).length,42)
assert.equal(reconciled.entries.filter(e=>e.status==='inherited-unreviewed').length,0)
assert.equal(sha(dir+'/identity-reconciled-progress.json'),publication.checkpointSha256)
assert.equal(sha(dir+'/review-progress.json'),publication.sourceHumanCheckpointSha256)
assert.deepEqual(ready.map(e=>validateHold(e.hold)),publication.holds)
assert.deepEqual(publication.holds.find(h=>h.id===identity.restoredV9Id),{...geometry.holds.find(h=>h.id===identity.fromHumanAddedId),id:identity.restoredV9Id})
assert(!ready.some(e=>e.hold.id===identity.fromHumanAddedId));assert.equal(new Set(ready.map(e=>e.hold.id)).size,862)
console.log('Validated untouched human export (871/901) and attributed identity reconciliation (874/904): 862 holds, 820 retained v9 IDs, 42 fresh IDs, zero pending. Candidate remains unpublished.')
