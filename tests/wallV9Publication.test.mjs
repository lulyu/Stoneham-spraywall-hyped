import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {validateHold} from '../src/wallReview.ts'
const read=path=>JSON.parse(readFileSync(path)),sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
test('v9 publication uses exact assistant-reviewed geometry and retains every published v8 identity',()=>{
 const archive='reviews/2026-11-v9-assistant-reviewed/',snapshot=read(archive+'confirmed-geometry.json'),summary=read(archive+'summary.json')
 const holds=read('src/data/walls/2026-11-v9/holds.json'),previous=read('src/data/walls/2026-11-v8/holds.json'),manifest=read('src/data/walls/2026-11-v9/manifest.json')
 assert.deepEqual(holds,snapshot.holds);holds.forEach(validateHold)
 const ids=new Set(holds.map(h=>h.id)),oldIds=new Set(previous.map(h=>h.id))
 assert.equal(ids.size,852);assert(previous.every(h=>ids.has(h.id)));assert.equal(holds.filter(h=>!oldIds.has(h.id)).length,51)
 assert.equal(manifest.reviewerKind,'assistant');assert.equal(manifest.reviewRevision,854);assert.equal(summary.pendingCount,0)
 assert.equal(manifest.checkpointSha256,sha(archive+summary.checkpoint));assert.equal(manifest.imageSha256,sha(archive+'wall.jpg'))
 assert.equal(manifest.imageSha256,sha('public/'+manifest.image));assert.equal(manifest.sourceSessionId,snapshot.session.sessionId)
 const catalog=read('backend/walls.json');assert.deepEqual(catalog.filter(w=>w.active).map(w=>w.wallVersionId),['2026-11-v9'])
 for(const version of ['2026-10-v4','2026-11-v7','2026-11-v8'])assert(catalog.some(w=>w.wallVersionId===version&&!w.active))
 assert.match(readFileSync('src/wallVersions.ts','utf8'),/DEFAULT_WALL_VERSION = '2026-11-v9'/)
})
