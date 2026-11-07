import { polygonCandidates } from './data/polygons'
import reviewedHolds from './data/walls/2026-11-v7/holds.json'
import candidate from './data/walls/2026-11-v7/manifest.json'
import type { PolygonHoldCandidate } from './types'

export const DEFAULT_WALL_VERSION = '2026-10-v4'
export const wallVersions = [
  {id:DEFAULT_WALL_VERSION,label:'Original wall · v4',image:'wall/stoneham-spraywall-canonical.jpg',holds:polygonCandidates,candidate:false},
  {id:candidate.wallVersionId,label:'New wall · reviewed candidate',image:candidate.image,holds:reviewedHolds as PolygonHoldCandidate[],candidate:true},
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
