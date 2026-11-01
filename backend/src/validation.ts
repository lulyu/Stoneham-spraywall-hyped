import { GRADES, HOLD_ROLES, type CreateProblemInput, type ProblemHold, type UpdateProblemInput } from './model'
import { ApiError, type WallVersion } from './walls'

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cleanString(value: unknown, field: string, maxLength: number, required = true): string | undefined {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string') throw new ApiError(400, `${field} must be a string`)
  const cleaned = value.trim()
  if (required && cleaned.length === 0) throw new ApiError(400, `${field} is required`)
  if (cleaned.length > maxLength) throw new ApiError(400, `${field} must be ${maxLength} characters or fewer`)
  return cleaned
}

function parseHolds(value: unknown, wall: WallVersion): ProblemHold[] {
  if (!Array.isArray(value) || value.length < 2) throw new ApiError(400, 'holds must contain at least two holds')
  if (value.length > 100) throw new ApiError(400, 'holds may contain at most 100 holds')

  const seen = new Set<string>()
  const holds = value.map((entry, index): ProblemHold => {
    if (!isObject(entry)) throw new ApiError(400, `holds[${index}] must be an object`)
    if (typeof entry.holdId !== 'string' || !wall.holdIds.has(entry.holdId)) {
      throw new ApiError(400, `holds[${index}].holdId is not valid for this wall version`)
    }
    if (seen.has(entry.holdId)) throw new ApiError(400, `duplicate holdId: ${entry.holdId}`)
    seen.add(entry.holdId)
    const role = entry.role === 'hand' ? 'hold' : entry.role
    if (typeof role !== 'string' || !HOLD_ROLES.includes(role as ProblemHold['role'])) {
      throw new ApiError(400, `holds[${index}].role must be start, finish, hold, or foot-only`)
    }
    return { holdId: entry.holdId, role: role as ProblemHold['role'] }
  })

  if (!holds.some((hold) => hold.role === 'start')) throw new ApiError(400, 'problem must have at least one start hold')
  if (!holds.some((hold) => hold.role === 'finish')) throw new ApiError(400, 'problem must have at least one finish hold')
  return holds
}

export function parseCreateProblem(value: unknown, wall: WallVersion): CreateProblemInput {
  if (!isObject(value)) throw new ApiError(400, 'request body must be a JSON object')
  if (typeof value.grade !== 'string' || !GRADES.includes(value.grade as CreateProblemInput['grade'])) {
    throw new ApiError(400, `grade must be one of: ${GRADES.join(', ')}`)
  }

  const notes = cleanString(value.notes, 'notes', 2000, false)
  return {
    name: cleanString(value.name, 'name', 120)!,
    grade: value.grade as CreateProblemInput['grade'],
    setter: cleanString(value.setter, 'setter', 80)!,
    ...(notes ? { notes } : {}),
    holds: parseHolds(value.holds, wall),
  }
}

export function parseUpdateProblem(value: unknown, wall: WallVersion): UpdateProblemInput {
  if (!isObject(value)) throw new ApiError(400, 'request body must be a JSON object')
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) {
    throw new ApiError(400, 'revision is required and must be a positive safe integer')
  }
  const update: UpdateProblemInput = { revision: value.revision as number }

  if ('name' in value) update.name = cleanString(value.name, 'name', 120)!
  if ('setter' in value) update.setter = cleanString(value.setter, 'setter', 80)!
  if ('notes' in value) update.notes = cleanString(value.notes, 'notes', 2000, false) ?? ''
  if ('grade' in value) {
    if (typeof value.grade !== 'string' || !GRADES.includes(value.grade as CreateProblemInput['grade'])) {
      throw new ApiError(400, `grade must be one of: ${GRADES.join(', ')}`)
    }
    update.grade = value.grade as CreateProblemInput['grade']
  }
  if ('holds' in value) update.holds = parseHolds(value.holds, wall)

  if (Object.keys(update).every((key) => key === 'revision')) throw new ApiError(400, 'no supported fields to update')
  return update
}
