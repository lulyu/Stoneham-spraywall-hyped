import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const holds = JSON.parse(readFileSync(process.argv[2] || new URL('../src/data/polygons/holds.json', import.meta.url), 'utf8'))
assert(Array.isArray(holds), 'Canonical hold dataset must be a JSON array')
assert.equal(holds.length, 677, 'Unexpected canonical hold count; review the accepted export')
const ids = new Set()
const point = value => {
  assert(Array.isArray(value) && value.length === 2, 'Each point needs two coordinates')
  assert(value.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1), 'Coordinates must be finite full-wall normalized values')
}
for (const hold of holds) {
  assert(typeof hold.id === 'string' && hold.id.length > 0 && !ids.has(hold.id), 'Hold IDs must be unique and nonempty')
  ids.add(hold.id)
  assert(['hold', 'macro', 'volume'].includes(hold.kind), 'Invalid hold kind')
  point(hold.center)
  assert(Array.isArray(hold.polygon) && hold.polygon.length >= 3 && hold.polygon.length <= 16, 'Polygons need 3–16 vertices')
  hold.polygon.forEach(point)
}
console.log(`Validated ${holds.length} canonical, user-confirmed polygons`)
