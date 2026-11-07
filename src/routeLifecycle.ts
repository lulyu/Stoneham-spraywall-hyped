import { wallVersions, DEFAULT_WALL_VERSION, LEGACY_WALL_VERSION, findWallVersion } from './wallVersions'
import type { Problem } from './types'

export const latestWall=findWallVersion(DEFAULT_WALL_VERSION)!
const wallIds=new Map(wallVersions.map(wall=>[wall.id,new Set(wall.holds.map(hold=>hold.id))]))
export function routeFits(problem:Pick<Problem,'holds'>,wall:typeof latestWall) {
  const ids=wallIds.get(wall.id)!
  return problem.holds.every(hold=>ids.has(hold.holdId))
}
export function routeCompatibility(problem:Problem):Problem {
  const ids=wallIds.get(latestWall.id)!
  return {...problem,supportedWallVersionIds:wallVersions.filter(wall=>routeFits(problem,wall)).map(wall=>wall.id),
    outdated:!routeFits(problem,latestWall),compatibilityWallVersionId:latestWall.id,
    missingHoldIds:problem.holds.filter(hold=>!ids.has(hold.holdId)).map(hold=>hold.holdId)}
}
export function displayWall(problem:Problem,preferred=latestWall) {
  return routeFits(problem,preferred)?preferred:[...wallVersions].reverse().find(wall=>routeFits(problem,wall))??findWallVersion(problem.wallVersionId??LEGACY_WALL_VERSION)??latestWall
}
export function nextUpgradeName(base:string,number:number) {
  const suffix=' V'+number
  return base.slice(0,120-suffix.length)+suffix
}
