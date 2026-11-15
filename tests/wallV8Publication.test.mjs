import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {validateHold} from '../src/wallReview.ts'
const read=p=>JSON.parse(readFileSync(p))
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex')
const archive='reviews/2026-11-v8-reviewed/'
const holds=read('src/data/walls/2026-11-v8/holds.json')
const decisions=read('reviews/2026-11-v8-publication/identity-resolutions.json')
test('v8 publication changes exactly two confirmed identities, preserving every reviewed contour and raw checkpoint',()=>{
 const source=read(archive+'confirmed-geometry.json')
 const mapping=new Map(decisions.resolutions.map(r=>[r.oldHoldId,r.newHoldId]))
 assert.equal(mapping.size,2)
 assert.equal(sha(archive+'review-progress-r812.json'),decisions.sourceCheckpointSha256)
 assert.deepEqual(holds,source.holds.map(h=>({...h,id:mapping.get(h.id)??h.id})))
 holds.forEach(validateHold)
 const ids=new Set(holds.map(h=>h.id));assert.equal(ids.size,801)
 for(const [oldId,newId] of mapping){assert(!ids.has(oldId));assert(ids.has(newId))}
 const old=read('src/data/walls/2026-11-v7/holds.json'),previous=new Set(old.map(h=>h.id))
 assert.equal(holds.filter(h=>previous.has(h.id)).length,787)
 assert.equal(old.filter(h=>!ids.has(h.id)).length,10)
 assert.equal(holds.filter(h=>!previous.has(h.id)).length,14)
 const manifest=read('src/data/walls/2026-11-v8/manifest.json')
 assert.equal(manifest.imageSha256,sha('public/'+manifest.image))
 assert.equal(manifest.imageSha256,sha(archive+'wall.jpg'))
 assert.match(readFileSync('src/wallVersions.ts','utf8'),/DEFAULT_WALL_VERSION = '2026-11-v8'/)
 const walls=read('backend/walls.json');assert.deepEqual(walls.filter(w=>w.active).map(w=>w.wallVersionId),[manifest.wallVersionId])
 assert(walls.some(w=>w.wallVersionId==='2026-11-v7'));assert(walls.some(w=>w.wallVersionId==='2026-10-v4'))
})
