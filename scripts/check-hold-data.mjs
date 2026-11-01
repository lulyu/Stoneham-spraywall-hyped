import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const source = readFileSync(process.argv[2] || new URL('../src/data/polygons/auto-v1-packed.ts', import.meta.url), 'utf8')
const packed = source.match(/const PACKED = '([^']*)'/)?.[1]
assert(packed, 'Missing packed hold dataset')
assert.match(packed, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, 'Invalid or truncated Base64 hold data')
const data = Buffer.from(packed, 'base64')
let count = 0
for (let offset = 0; offset < data.length; count++) {
  assert(offset + 6 <= data.length, 'Truncated hold header')
  assert(data[offset] <= 2, 'Invalid hold kind')
  const vertices = data[offset + 1]
  assert(vertices >= 3 && vertices <= 16, 'Invalid polygon vertex count')
  offset += 6 + vertices * 4
  assert(offset <= data.length, 'Truncated polygon coordinates')
}
assert.equal(count, 526, 'Unexpected canonical candidate count; review regenerated geometry')
console.log(`Validated ${count} packed polygon candidates`)
