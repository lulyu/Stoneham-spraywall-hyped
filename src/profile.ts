export type UserProfile = { displayName: string; bio: string }
export async function profileRequest(base: string, token: string | undefined, profile?: UserProfile): Promise<UserProfile> {
  if (!token) throw new Error('Please sign in again to access your profile.')
  const response = await fetch(base.replace(/\/$/, '') + '/v1/me/profile', {
    method: profile ? 'PATCH' : 'GET',
    headers: { authorization: 'Bearer ' + token, ...(profile ? { 'content-type': 'application/json' } : {}) },
    body: profile ? JSON.stringify(profile) : undefined,
    signal: AbortSignal.timeout(20000),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Could not save profile. Please try again.')
  return data
}
