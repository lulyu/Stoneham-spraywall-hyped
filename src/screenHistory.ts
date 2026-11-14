export type Screen = 'home' | 'explore' | 'route' | 'profile' | 'editor'
export type ScreenView = { screen: Screen; routeId?: string }
export type ScreenEntry = ScreenView & { id: string; root: string; depth: number }
const key = 'stonehamScreenV1'
const screens: Screen[] = ['home', 'explore', 'route', 'profile', 'editor']

export function readScreenEntry(state: unknown): ScreenEntry | null {
  if (!state || typeof state !== 'object') return null
  const entry = (state as Record<string, unknown>)[key] as ScreenEntry | undefined
  if (!entry || !screens.includes(entry.screen) || typeof entry.id !== 'string' || typeof entry.root !== 'string' ||
    !Number.isSafeInteger(entry.depth) || entry.depth < 0 || entry.depth > 10000 ||
    (entry.routeId !== undefined && (typeof entry.routeId !== 'string' || !entry.routeId || entry.routeId.length > 200)) ||
    (entry.screen === 'route' && !entry.routeId)) return null
  return entry
}

/** History contains screen IDs only. Drafts and route snapshots stay in this tab's memory. */
export function createScreenHistory<T>({ history, url, capture, restore, listen }: {
  history: Pick<History, 'state' | 'pushState' | 'replaceState' | 'back' | 'go'>
  url: () => URL
  capture: () => T
  restore: (entry: ScreenEntry, snapshot?: T) => void
  listen: (listener: (state: unknown) => void) => () => void
}) {
  const snapshots = new Map<string, T>()
  const id = () => crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2)
  let current: ScreenEntry
  const remember = (snapshot = capture()) => {
    if (current) snapshots.set(current.id, snapshot)
    if (snapshots.size > 100) snapshots.delete(snapshots.keys().next().value!)
  }
  const write = (entry: ScreenEntry, replace: boolean) => {
    const address = url()
    if (entry.routeId) address.searchParams.set('route', entry.routeId)
    else address.searchParams.delete('route')
    address.hash = ''
    const state = { ...(history.state && typeof history.state === 'object' ? history.state : {}), [key]: entry }
    if (replace) history.replaceState(state, '', address)
    else history.pushState(state, '', address)
    current = entry
  }
  const previous = readScreenEntry(history.state)
  if (previous) current = previous
  else {
    const routeId = url().searchParams.get('route')
    const root = id()
    write({screen: 'home', id: root, root, depth: 0}, true)
    // A directly opened shared route still has an in-app Home to return to.
    if (routeId && routeId.length <= 200) write({screen: 'route', routeId, id: id(), root, depth: 1}, false)
  }
  const unlisten = listen(state => {
    const entry = readScreenEntry(state)
    if (!entry) return
    remember()
    current = entry
    restore(entry, snapshots.get(entry.id))
  })
  return {
    get current() { return current },
    restore() { restore(current, snapshots.get(current.id)) },
    push(view: ScreenView, snapshot?: T) {
      if (current.screen === view.screen && current.routeId === view.routeId) return
      remember(snapshot)
      write({...view, id: id(), root: current.root, depth: current.depth + 1}, false)
    },
    replace(view: ScreenView) {
      remember()
      write({...view, id: id(), root: current.root, depth: current.depth}, true)
    },
    back() {
      remember()
      if (current.depth > 0) history.back()
      else { write({screen: 'home', id: id(), root: current.root, depth: 0}, true); restore(current) }
    },
    home() {
      remember()
      if (current.depth > 0) history.go(-current.depth)
      else { write({screen: 'home', id: id(), root: current.root, depth: 0}, true); restore(current) }
    },
    dispose: unlisten,
  }
}
