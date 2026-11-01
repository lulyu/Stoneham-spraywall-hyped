export const GRADES = ['VB', 'V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10+'] as const
export const HOLD_ROLES = ['start', 'hand', 'finish'] as const

export type Grade = typeof GRADES[number]
export type HoldRole = typeof HOLD_ROLES[number]

export type ProblemHold = {
  holdId: string
  role: HoldRole
}

export type Problem = {
  id: string
  gymId: string
  wallId: string
  wallVersionId: string
  name: string
  grade: Grade
  setter: string
  notes?: string
  holds: ProblemHold[]
  createdAt: string
  updatedAt: string
  revision: number
  createdBy?: string
}

export type CreateProblemInput = Pick<Problem, 'name' | 'grade' | 'setter' | 'notes' | 'holds'>
export type UpdateProblemInput = Partial<CreateProblemInput> & { revision?: number }

export type ProblemItem = Problem & {
  pk: string
  sk: 'META'
  gsi1pk: string
  gsi1sk: string
  entityType: 'problem'
}
