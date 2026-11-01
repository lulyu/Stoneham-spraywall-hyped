import type { Problem, ProblemHold } from './types'

export const STORAGE_KEY = 'stoneham-spraywall:problems:v3'
export type ProblemInput = Pick<Problem, 'name' | 'grade' | 'setter' | 'notes' | 'holds'>
export interface ProblemStore {
  shared: boolean
  list(): Promise<Problem[]>
  get(id: string): Promise<Problem>
  create(input: ProblemInput): Promise<Problem>
  update(existing: Problem, input: ProblemInput): Promise<Problem>
}
export class ProblemStoreError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

export function readLocalProblems(storage: Pick<Storage, 'getItem'>, validIds: Set<string>): Problem[] {
  try {
    const raw: unknown = JSON.parse(storage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((p): p is Problem => p && typeof p === 'object' &&
      typeof p.id === 'string' && typeof p.name === 'string' &&
      typeof p.grade === 'string' && typeof p.setter === 'string' &&
      typeof p.createdAt === 'string' && Array.isArray(p.holds) &&
      p.holds.every((h: ProblemHold) => h && typeof h === 'object' &&
        validIds.has(h.holdId) && ['start', 'finish', 'hold', 'foot-only', 'hand'].includes(h.role)),
    ).map((p) => ({ ...p, holds: p.holds.map((h) => ({
      ...h, role: (h.role as string) === 'hand' ? 'hold' : h.role,
    })) }))
  } catch { return [] }
}

export function createLocalProblemStore(storage: Pick<Storage, 'getItem' | 'setItem'>, validIds: Set<string>): ProblemStore {
  const list = () => readLocalProblems(storage, validIds)
  const persist = (items: Problem[]) => {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(items)) }
    catch { throw new Error('Could not save on this device. Free storage or enable browser storage, then try again.') }
  }
  return {
    shared: false,
    async list() { return list() },
    async get(id) {
      const p = list().find((p) => p.id === id)
      if (!p) throw new ProblemStoreError(404, 'This problem no longer exists.')
      return p
    },
    async create(input) {
      const p: Problem = { ...input, id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'problem-' + Date.now() + '-' + Math.random().toString(36).slice(2), createdAt: new Date().toISOString(), revision: 1 }
      persist([p, ...list()])
      return p
    },
    async update(existing, input) {
      const items = list()
      const latest = items.find((p) => p.id === existing.id)
      if (!latest) throw new ProblemStoreError(404, 'This problem no longer exists.')
      if ((latest.revision ?? 1) !== (existing.revision ?? 1)) throw new ProblemStoreError(409, 'This problem changed.')
      const p = { ...latest, ...input, revision: (latest.revision ?? 1) + 1, updatedAt: new Date().toISOString() }
      persist(items.map((item) => item.id === p.id ? p : item))
      return p
    },
  }
}

export function createApiProblemStore(baseUrl: string, fetcher: typeof fetch = fetch, token: () => Promise<string | undefined> = async () => undefined): ProblemStore {
  const base = baseUrl.replace(/\/+$/, '')
  const collection = '/v1/gyms/stoneham-crg/walls/spray-wall-1/versions/2026-10-v4/problems'
  async function request<T>(method: string, path: string, payload?: unknown): Promise<T> {
    const bearer = await token()
    let response: Response
    try {
      response = await fetcher(base + path, {
        method, headers: { ...(payload === undefined ? {} : { 'content-type': 'application/json' }), ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      })
    } catch {
      throw new Error('Could not reach the shared wall. Check your connection and try again. Your draft is still here.')
    }
    const data = await response.json().catch(() => null)
    if (response.status === 401) throw new ProblemStoreError(401, 'Sign in to save or edit. Your draft is still here.')
    if (!response.ok) throw new ProblemStoreError(response.status, data?.error || 'The shared wall request failed. Please try again.')
    if (!data || typeof data !== 'object') throw new Error('The shared wall returned an invalid response.')
    return data as T
  }
  return {
    shared: true,
    async list() { return (await request<{ items: Problem[] }>('GET', collection)).items },
    get(id) { return request('GET', '/v1/problems/' + encodeURIComponent(id)) },
    create(input) { return request('POST', collection, input) },
    async update(existing, input) {
      if (!Number.isSafeInteger(existing.revision) || existing.revision! < 1) {
        throw new Error('Reload this problem before editing; its revision is missing.')
      }
      return request('PATCH', '/v1/problems/' + encodeURIComponent(existing.id), { ...input, revision: existing.revision })
    },
  }
}
