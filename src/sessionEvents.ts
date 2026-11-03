export type SessionEvent = 'expired' | 'loaded' | 'signedout'
const listeners = new Set<(event: SessionEvent) => void>()
export function emitSessionEvent(event: SessionEvent) {
  for (const listener of listeners) listener(event)
}
export function onSessionEvent(listener: (event: SessionEvent) => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
