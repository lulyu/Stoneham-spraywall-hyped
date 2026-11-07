import type { Problem } from './model'
import { latestWall, wallVersionsFor } from './walls'

export function compatibility(problem:Problem):Problem {
  const latest=latestWall(problem.gymId,problem.wallId)
  const missing=[...new Set(problem.holds.filter(hold=>!latest.holdIds.has(hold.holdId)).map(hold=>hold.holdId))]
  return {...problem,
    supportedWallVersionIds:wallVersionsFor(problem.gymId,problem.wallId)
      .filter(wall=>problem.holds.every(hold=>wall.holdIds.has(hold.holdId))).map(wall=>wall.wallVersionId),
    outdated:missing.length>0,compatibilityWallVersionId:latest.wallVersionId,missingHoldIds:missing}
}

export function upgradeName(base:string,number:number) {
  const suffix=' V'+number
  return base.slice(0,120-suffix.length)+suffix
}
