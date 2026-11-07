import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {validateHold} from '../src/wallReview.ts'

test('published latest wall is exactly the completed human review and retains the historical wall',()=>{
  const read=path=>JSON.parse(readFileSync(path)),sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
  const dir='reviews/2026-11-v7-completed/',manifest=read('src/data/walls/2026-11-v7/manifest.json')
  const checkpoint=read(dir+'review-progress-r805.json'),snapshot=read(dir+'confirmed-geometry.json')
  const holds=read('src/data/walls/2026-11-v7/holds.json'),catalog=read('backend/walls.json')
  assert.equal(manifest.status,'published');assert.equal(manifest.wallVersionId,'2026-11-v7')
  assert.equal(manifest.checkpointSha256,sha(dir+'review-progress-r805.json'))
  assert.equal(manifest.imageSha256,sha('public/'+manifest.image))
  assert.equal(checkpoint.session.registeredImageSha256,manifest.imageSha256)
  assert.equal(checkpoint.reviewRevision,805);assert.equal(checkpoint.entries.length,797)
  assert(checkpoint.entries.every(e=>e.status==='verified-refined'))
  assert.deepEqual(holds,snapshot.holds)
  assert.deepEqual(holds,checkpoint.entries.map(e=>e.hold))
  holds.forEach(validateHold);assert.equal(new Set(holds.map(h=>h.id)).size,797)
  assert.deepEqual(catalog.filter(wall=>wall.active).map(wall=>wall.wallVersionId),['2026-11-v7'])
  assert.equal(catalog.find(wall=>wall.wallVersionId==='2026-11-v7').holdSource,'src/data/walls/2026-11-v7/holds.json')
  assert.equal(manifest.routeMigration,'hold-id-compatibility')
})
