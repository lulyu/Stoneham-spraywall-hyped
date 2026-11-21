import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {initializeReview,validateProgress,confirmed} from '../../src/wallReview.ts'
import {validateProposals} from '../../src/wallProposals.ts'
const directory=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(directory,'../..')
const read=p=>JSON.parse(fs.readFileSync(p)),hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const archive=read(directory+'/archive-manifest.json'),summary=read(directory+'/summary.json')
for(const [name,record] of Object.entries(archive.assets))assert.equal(hash(path.join(directory,name)),record.sha256,name)
for(const record of [archive.referenceImage,archive.referenceHolds])assert.equal(hash(path.join(repo,record.path)),record.sha256,record.path)
const original=read(path.join(repo,archive.referenceHolds.path))
const baseline=initializeReview(read(directory+'/baseline/manifest.json'),read(directory+'/baseline/holds_prelabels.json'),read(directory+'/baseline/review_queue.json'),original)
const raw=read(directory+'/baseline/sam2-proposals.json'),model=validateProposals(raw,baseline)
const reviewed=validateProgress(read(directory+'/'+summary.checkpoint),baseline),active=reviewed.entries.filter(confirmed),geometry=read(directory+'/confirmed-geometry.json')
assert.equal(hash(directory+'/'+summary.checkpoint),summary.checkpointSha256)
assert.equal(geometry.checkpointSha256,summary.checkpointSha256)
assert.equal(hash(directory+'/wall.jpg'),reviewed.session.registeredImageSha256)
assert.equal(hash(directory+'/baseline/sam2-proposals.json'),reviewed.session.proposalsSha256)
assert.equal(hash(directory+'/candidate-manifest.json'),reviewed.session.candidateManifestSha256)
assert.equal(active.length,852);assert.equal(reviewed.reviewRevision,854)
assert.equal(reviewed.entries.filter(e=>e.status==='inherited-unreviewed').length,0)
assert.equal(active.filter(e=>e.status==='new').length,51)
assert.equal(new Set(active.map(e=>e.hold.id)).size,852)
assert(original.every(h=>active.some(e=>e.hold.id===h.id)))
assert(reviewed.history.every(e=>e.reviewerKind==='assistant'&&e.reviewer==='Codex (assistant visual review)'))
assert.deepEqual(active.map(e=>e.hold),geometry.holds)
assert.equal(summary.newLocationDecisions.length,51)
assert(summary.newLocationDecisions.every(d=>d.resolved&&reviewed.entries.some(e=>e.hold.id===d.reviewHoldId&&e.status==='new')))
assert.equal(model.proposals.length,852)
assert.equal(model.proposals.filter(p=>p.newLocation).length,51)
assert.equal(summary.publishable,false);assert.equal(geometry.publishable,false)
assert.equal(summary.pendingCount,0);assert.equal(summary.retainedOldIds,801)
assert.equal(summary.geometryQA.minimumNewPhotoCoverage,1)
assert.deepEqual(summary.geometryQA.nearIdenticalPolygons,[])
for(const [file,sha] of Object.entries(raw.metadata.provenance))assert.equal(hash(directory+'/inference/'+file),sha,file)
console.log(`Validated ${reviewed.reviewRevision} assistant revisions, ${active.length} active holds, 801 retained IDs, 51 additions, zero pending. Candidate remains unpublished.`)
