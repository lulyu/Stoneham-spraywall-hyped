import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {initializeReview,validateProgress,confirmed,validateHold} from '../../src/wallReview.ts'
import {validateProposals} from '../../src/wallProposals.ts'
const dir=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(dir,'../..'),read=p=>JSON.parse(fs.readFileSync(p)),hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const archive=read(dir+'/archive-manifest.json'),summary=read(dir+'/summary.json')
for(const [name,record] of Object.entries(archive.assets)){assert.equal(hash(path.join(dir,name)),record.sha256,name);assert.equal(fs.statSync(path.join(dir,name)).size,record.bytes,name)}
for(const record of [archive.referenceImage,archive.referenceHolds])assert.equal(hash(path.join(repo,record.path)),record.sha256,record.path)
const original=read(path.join(repo,archive.referenceHolds.path)),oldIds=new Set(original.map(h=>h.id))
const baseline=initializeReview(read(dir+'/baseline/manifest.json'),read(dir+'/baseline/holds_prelabels.json'),read(dir+'/baseline/review_queue.json'),original)
const raw=read(dir+'/baseline/sam2-proposals.json'),model=validateProposals(raw,baseline),reviewed=validateProgress(read(dir+'/'+summary.checkpoint),baseline),active=reviewed.entries.filter(confirmed),geometry=read(dir+'/confirmed-geometry.json'),qa=read(dir+'/geometry-qa.json')
assert.equal(hash(dir+'/'+summary.checkpoint),summary.checkpointSha256)
assert.equal(geometry.checkpointSha256,summary.checkpointSha256)
assert.equal(hash(dir+'/wall.jpg'),reviewed.session.registeredImageSha256)
assert.equal(hash(dir+'/baseline/sam2-proposals.json'),reviewed.session.proposalsSha256)
assert.equal(hash(dir+'/candidate-manifest.json'),reviewed.session.candidateManifestSha256)
assert.equal(active.length,858);assert.equal(reviewed.reviewRevision,861);assert.equal(reviewed.history.length,891)
assert.equal(reviewed.entries.filter(e=>e.status==='inherited-unreviewed').length,0)
assert.equal(active.filter(e=>e.status==='new').length,39)
assert.equal(new Set(active.map(e=>e.hold.id)).size,858)
assert.equal(active.filter(e=>oldIds.has(e.hold.id)).length,819)
assert.equal(original.filter(h=>!active.some(e=>e.hold.id===h.id)).length,33)
assert(reviewed.history.every(e=>e.reviewerKind==='assistant'&&e.reviewer==='Codex (assistant visual review)'))
assert.deepEqual(active.map(e=>validateHold(e.hold)),geometry.holds)
assert.equal(model.proposals.length,875)
assert.equal(model.proposals.filter(p=>p.newLocation).length,30)
assert.equal(summary.publishable,false);assert.equal(geometry.publishable,false);assert.equal(summary.pendingCount,0)
assert.equal(qa.minimumNewPhotoCoverage,1);assert.equal(qa.holdsBelow99PercentCoverage,0);assert.deepEqual(qa.nearIdenticalPolygons,[])
for(const [name,sha] of Object.entries(raw.metadata.provenance))assert.equal(hash(dir+'/inference/'+name),sha,name)
console.log('Validated v10: 861 review actions / 891 history records; 858 holds, 819 retained IDs, 39 fresh IDs, 33 old positions removed, zero pending. Candidate remains unpublished.')
