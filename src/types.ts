export type HoldKind = 'hold_guess' | 'macro_hold_guess' | 'volume_guess'
export type HoldRole = 'start' | 'hand' | 'finish'

export type Hold = {
  id: string
  x: number
  y: number
  radius: number
  kind: HoldKind
}

export type ProblemHold = {
  holdId: string
  role: HoldRole
}

export type Problem = {
  id: string
  name: string
  grade: string
  setter: string
  notes?: string
  holds: ProblemHold[]
  createdAt: string
}
