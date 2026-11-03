type SessionUser = { expired?: boolean; access_token: string }
type SessionManager = {
  getUser(): Promise<SessionUser | null>
  signinSilent(): Promise<SessionUser | null>
}
export function createSessionAccess(manager: SessionManager | null, expired: () => void) {
  let invalidated = false
  let renewing: Promise<SessionUser | null> | undefined
  return {
    invalidate() { invalidated = true },
    acceptUser() { invalidated = false },
    async token(): Promise<string | undefined> {
      if (!manager) return undefined
      let user: SessionUser | null
      try { user = await manager.getUser() }
      catch { invalidated = true; expired(); return undefined }
      if (user && !user.expired && !invalidated) return user.access_token
      if (!user && !invalidated) return undefined
      renewing ??= manager.signinSilent().catch(() => null).finally(() => { renewing = undefined })
      const fresh = await renewing
      if (fresh && !fresh.expired) { invalidated = false; return fresh.access_token }
      invalidated = true
      expired()
      return undefined
    },
  }
}
