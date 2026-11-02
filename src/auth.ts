import { UserManager, WebStorageStateStore } from 'oidc-client-ts'
const authority = import.meta.env.VITE_COGNITO_AUTHORITY
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID
export const authConfigured = Boolean(authority && clientId)
const manager = authConfigured ? new UserManager({
  authority: authority!, client_id: clientId!, redirect_uri: window.location.origin + '/',
  post_logout_redirect_uri: window.location.origin + '/', response_type: 'code',
  scope: 'openid email profile stoneham-api/write',
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  automaticSilentRenew: true,
}) : null
let initialization: Promise<void> | undefined
async function completeLogin() {
  if (!manager) return
  const params = new URLSearchParams(window.location.search)
  if (params.has('code') || params.has('error')) {
    try { await manager.signinRedirectCallback() }
    finally { window.history.replaceState({}, '', window.location.pathname) }
  }
}
export async function accessToken() {
  const user = await manager?.getUser()
  return user && !user.expired ? user.access_token : undefined
}
export async function signIn() {
  if (!manager) throw new Error('Login has not been configured yet.')
  await manager.signinRedirect({ extraQueryParams: { identity_provider: 'Google' } })
}
export async function signOut() {
  if (!manager) return
  const metadata = await manager.metadataService.getMetadata()
  if (!metadata.authorization_endpoint) throw new Error('Login service metadata is incomplete.')
  const logout = new URL('/logout', metadata.authorization_endpoint)
  logout.searchParams.set('client_id', clientId!)
  logout.searchParams.set('logout_uri', window.location.origin + '/')
  await manager.removeUser()
  window.location.assign(logout.toString())
}

export function initializeAuth() { return initialization ??= completeLogin() }

export async function accountDetails() {
  const user = await manager?.getUser()
  return {
    displayName: typeof user?.profile.name === 'string' ? user.profile.name.slice(0, 60) : '',
    email: typeof user?.profile.email === 'string' ? user.profile.email : '',
  }
}
