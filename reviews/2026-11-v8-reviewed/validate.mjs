import fs from 'node:fs'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {initializeReview,validateProgress,confirmed} from '../../src/wallReview.ts'
import {validateProposals} from '../../src/wallProposals.ts'
const directory=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(directory,'../..')
const read=p=>JSON.parse(fs.readFileSync(p)),hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const archive=read(directory+'/archive-manifest.json'),summary=read(directory+'/summary.json')
for(const [name,record] of Object.entries(archive.assets))assert.equal(hash(path.join(directory,name)),record.sha256,name)
for(const record of archive.baselineFiles)assert.equal(hash(directory+'/baseline/'+record.name),record.sha256,record.name)
for(const reference of [archive.referenceImage,archive.referenceHolds])assert.equal(hash(path.join(repo,reference.path)),reference.sha256,reference.path)
const baseline=initializeReview(read(directory+'/baseline/manifest.json'),read(directory+'/baseline/holds_prelabels.json'),read(directory+'/baseline/review_queue.json'),read(path.join(repo,archive.referenceHolds.path)))
const model=validateProposals(read(directory+'/baseline/sam2-proposals.json'),baseline)
const reviewed=validateProgress(read(directory+'/'+summary.checkpoint),baseline)
const active=reviewed.entries.filter(confirmed)
assert.equal(hash(directory+'/'+summary.checkpoint),summary.checkpointSha256)
assert.equal(hash(directory+'/wall.jpg'),reviewed.session.registeredImageSha256)
assert.equal(hash(directory+'/baseline/sam2-proposals.json'),reviewed.session.proposalsSha256)
assert.equal(hash(directory+'/candidate-manifest.json'),reviewed.session.candidateManifestSha256)
assert.equal(active.length,summary.confirmedHoldCount)
assert.equal(reviewed.entries.filter(e=>e.status==='inherited-unreviewed').length,0)
assert.deepEqual(active.map(e=>e.hold),read(directory+'/confirmed-geometry.json').holds)
assert(summary.newLocationDecisions.every(d=>d.resolved&&reviewed.entries.some(e=>e.hold.id===d.reviewHoldId&&e.status==='new')))
assert.equal(model.proposals.filter(p=>p.newLocation).length,summary.newLocationDecisions.length)
assert.equal(summary.publishable,false)
console.log(`Validated ${reviewed.reviewRevision} revisions; ${active.length} active holds; zero pending. Candidate remains unpublished.`)
