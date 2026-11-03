import { accessToken } from './auth'
export type Comment = { id: string; text: string; author: string; createdAt: string }
export type CommunityData = { ratingAverage: number | null; ratingCount: number; comments: Comment[]; nextCursor?: string }
export type MyActivity = { sent: boolean; sentAt?: string; rating: number | null }
export type SendLog = { problemId: string; name: string; grade: string; setter: string; sentAt: string }
export async function communityRequest<T>(base: string, path: string, method = 'GET', payload?: unknown, privateRequest = false): Promise<T> {
  const token = privateRequest ? await accessToken() : undefined
  if (privateRequest && !token) throw new Error('Please sign in to log a send, rate or comment. Your draft is kept.')
  let response: Response
  try {
    response = await fetch(base.replace(/\/$/, '') + path, {
      method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
      body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(20000),
    })
  } catch { throw new Error('Could not connect. Please retry; your draft is kept.') }
  const data = await response.json()
  if (!response.ok) throw new Error(response.status === 401 ? 'Your session expired. Please sign in again.' : data.error || 'Request failed. Please retry.')
  return data
}
