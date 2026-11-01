import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { metadata, holds } = JSON.parse(readFileSync(new URL('../src/data/experiments/top_left_sam2_polygons.json', import.meta.url)))
assert.equal(metadata.status, 'success')
assert.equal(holds.length, metadata.polygon_count)
assert(holds.length > 0)
assert.deepEqual(metadata.image_size, [7292, 5514])
assert.deepEqual(metadata.crop_box, [0, 0, 2431, 1838])
const ids = new Set()
for (const hold of holds) {
  assert(!ids.has(hold.id)); ids.add(hold.id)
  assert.match(hold.id, /^sam2-tl-\d+$/)
  assert.equal(hold.kind, 'hold')
  assert(hold.polygon.length >= 3 && hold.polygon.length <= 16)
  assert(hold.score >= metadata.min_score)
  for (const point of [hold.center, ...hold.polygon]) {
    assert.equal(point.length, 2)
    assert(point.every(Number.isFinite))
    assert(point[0] >= 0 && point[0] <= 2431 / 7292 + 1e-7)
    assert(point[1] >= 0 && point[1] <= 1838 / 5514 + 1e-7)
  }
}
console.log(`Validated ${holds.length} experiment polygons in full-wall coordinates (≤16 vertices)`)
