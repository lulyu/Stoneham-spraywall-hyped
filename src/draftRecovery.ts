import type { Problem, ProblemHold } from './types'
export const DRAFT_RECOVERY_KEY = 'stoneham-spraywall:reauth-draft:v1'
export type RecoveryDraft = { userId: string; name: string; grade: string; setter: string; draft: ProblemHold[]; editing: Problem | null }
export function storeRecoveryDraft(storage: Pick<Storage, 'setItem'>, draft: RecoveryDraft, key=DRAFT_RECOVERY_KEY) {
  storage.setItem(key, JSON.stringify({ ...draft, storedAt: Date.now() }))
}
export function readRecoveryDraft(storage: Pick<Storage, 'getItem'>, userId: string, validIds: Set<string>, key=DRAFT_RECOVERY_KEY): RecoveryDraft | null {
  try {
    const value = JSON.parse(storage.getItem(key) || 'null')
    if (!value || value.userId !== userId || !Number.isFinite(value.storedAt) ||
      Date.now() - value.storedAt > 86400000 || value.storedAt > Date.now() + 60000 ||
      typeof value.name !== 'string' || value.name.length > 120 ||
      typeof value.setter !== 'string' || value.setter.length > 80 ||
      !['VB','V0','V1','V2','V3','V4','V5','V6','V7','V8','V9','V10+'].includes(value.grade) ||
      !Array.isArray(value.draft) || value.draft.length > 100 ||
      !value.draft.every((h: ProblemHold) => h && validIds.has(h.holdId) && ['start','finish','hold','foot-only'].includes(h.role))) return null
    const editing = value.editing
    if (editing !== null && (!editing || typeof editing.id !== 'string' || !Number.isSafeInteger(editing.revision) || editing.revision < 1)) return null
    return { userId, name: value.name, grade: value.grade, setter: value.setter, draft: value.draft, editing }
  } catch { return null }
}
