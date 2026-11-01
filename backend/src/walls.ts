import { wallCatalog } from './generated/wallCatalog'

type GeneratedWall = typeof wallCatalog[number]

export type WallVersion = Omit<GeneratedWall, 'holdIds'> & { holdIds: ReadonlySet<string> }

const walls: WallVersion[] = wallCatalog.map((wall) => ({
  ...wall,
  holdIds: new Set<string>(wall.holdIds),
}))

export function getWallVersion(gymId: string, wallId: string, wallVersionId: string): WallVersion | undefined {
  return walls.find((wall) =>
    wall.gymId === gymId && wall.wallId === wallId && wall.wallVersionId === wallVersionId,
  )
}

export function requireWallVersion(gymId: string, wallId: string, wallVersionId: string): WallVersion {
  const wall = getWallVersion(gymId, wallId, wallVersionId)
  if (!wall) throw new ApiError(404, 'Unknown gym, wall, or wall version')
  return wall
}

export class ApiError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}
