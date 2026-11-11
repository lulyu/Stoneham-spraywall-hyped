export type HoldKind = 'hold_guess' | 'macro_hold_guess' | 'volume_guess' | 'hold' | 'macro' | 'volume'
export type HoldRole = 'start' | 'finish' | 'hold' | 'foot-only'
export type Point = [number, number]

export type Hold = {
  id: string
  /** Normalized center coordinates in [0, 1]. */
  x: number
  y: number
  /** Legacy circular hit radius, normalized by wall width. */
  radius: number
  kind: HoldKind
  /** Optional normalized hold outline. Auto-generated polygons are capped at 16 vertices. */
  polygon?: Point[]
}

export type PolygonHoldCandidate = {
  id: string
  center: Point
  polygon: Point[]
  kind: 'hold' | 'macro' | 'volume'
}

export type ProblemHold = {
  holdId: string
  role: HoldRole
}

export type Problem = {
  id: string
  wallVersionId?: string
  gymId?: string
  wallId?: string
  supportedWallVersionIds?: string[]
  outdated?: boolean
  compatibilityWallVersionId?: string
  missingHoldIds?: string[]
  upgradedFromId?: string
  upgradeRootId?: string
  upgradeBaseName?: string
  upgradeNumber?: number
  name: string
  grade: string
  setter: string
  notes?: string
  holds: ProblemHold[]
  createdAt: string
  updatedAt?: string
  revision?: number
  ownerId?: string
  commentCount?: number
}
