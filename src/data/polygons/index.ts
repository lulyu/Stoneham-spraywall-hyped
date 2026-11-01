import p0 from './holds-poly-0.json'
import p1 from './holds-poly-1.json'
import type { PolygonHoldCandidate } from '../../types'

export const polygonCandidates = [...p0, ...p1] as PolygonHoldCandidate[]

export const polygonById = new Map(
  polygonCandidates.map((hold) => [hold.id, hold] as const),
)
