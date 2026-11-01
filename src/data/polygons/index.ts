import data from './holds.json'
import type { Point, PolygonHoldCandidate } from '../../types'

// Canonical, user-confirmed geometry. Preserve these IDs when editing holds.
export const polygonCandidates: PolygonHoldCandidate[] = data.map((hold) => ({
  id: hold.id,
  kind: hold.kind as PolygonHoldCandidate['kind'],
  center: [hold.center[0], hold.center[1]],
  polygon: hold.polygon.map(([x, y]): Point => [x, y]),
}))
export const polygonById = new Map(polygonCandidates.map((hold) => [hold.id, hold]))
