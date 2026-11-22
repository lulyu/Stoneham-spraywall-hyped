import { polygonCandidates } from './data/polygons'
import reviewedHolds from './data/walls/2026-11-v7/holds.json'
import previous from './data/walls/2026-11-v7/manifest.json'
import v8Holds from './data/walls/2026-11-v8/holds.json'
import v8 from './data/walls/2026-11-v8/manifest.json'
import currentHolds from './data/walls/2026-11-v9/holds.json'
import current from './data/walls/2026-11-v9/manifest.json'
import type { PolygonHoldCandidate } from './types'

export const LEGACY_WALL_VERSION = '2026-10-v4'
export const DEFAULT_WALL_VERSION = '2026-11-v9'
export const wallVersions = [
  {id:LEGACY_WALL_VERSION,label:'Original wall · v4',image:'wall/stoneham-spraywall-canonical.jpg',holds:polygonCandidates,candidate:false},
  {id:previous.wallVersionId,label:'Historical wall · v7',image:previous.image,holds:reviewedHolds as PolygonHoldCandidate[],candidate:false},
  {id:v8.wallVersionId,label:'Previous wall · v8',image:v8.image,holds:v8Holds as PolygonHoldCandidate[],candidate:false},
  {id:current.wallVersionId,label:'Current wall · v9',image:current.image,holds:currentHolds as PolygonHoldCandidate[],candidate:false},
]
export function findWallVersion(id:string) { return wallVersions.find(wall=>wall.id===id) }
export function wallVersionUrl(href:string,id:string,routeId?:string) {
  if(!findWallVersion(id))throw new Error('This route belongs to an unavailable wall version.')
  const url=new URL(href)
  if(id===DEFAULT_WALL_VERSION)url.searchParams.delete('wallVersion')
  else url.searchParams.set('wallVersion',id)
  if(routeId)url.searchParams.set('route',routeId)
  else url.searchParams.delete('route')
  url.hash=''
  return url
}
