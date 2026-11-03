import { useEffect, useId, useMemo, useRef, useState } from 'react'
import sam2Experiment from './data/experiments/top_left_sam2_polygons.json'
import { polygonCandidates as holds } from './data/polygons'
import { emitSessionEvent, onSessionEvent } from './sessionEvents.ts'
import { DRAFT_RECOVERY_KEY, readRecoveryDraft, storeRecoveryDraft } from './draftRecovery.ts'
import { initializeAuth, accountDetails, accessToken, signIn, signOut, authConfigured } from './auth'
import Profile from './Profile'
import Community from './Community'
import { profileRequest, type UserProfile } from './profile'
import { createApiProblemStore, createLocalProblemStore, readLocalProblems, ProblemStoreError, STORAGE_KEY } from './problemStore'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { HoldRole, Problem, ProblemHold, PolygonHoldCandidate, Point } from './types'

const wallImage = `${import.meta.env.BASE_URL}wall/stoneham-spraywall-canonical.jpg`
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''
const browserStorage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
}
const validHoldIds = new Set(holds.map((hold) => hold.id))
const problemStore = apiBaseUrl
  ? createApiProblemStore(apiBaseUrl, fetch, accessToken)
  : createLocalProblemStore(browserStorage, validHoldIds)
const importKey = STORAGE_KEY + ':imported:' + apiBaseUrl
function pendingLocalProblems() {
  const local = readLocalProblems(browserStorage, validHoldIds)
  try {
    const imported = JSON.parse(browserStorage.getItem(importKey) || '{}')
    return local.filter((problem) => !imported[problem.id])
  } catch { return local }
}
const WALL_WIDTH = 1536
const WALL_HEIGHT = WALL_WIDTH * 5514 / 7292
const sam2Holds: PolygonHoldCandidate[] = sam2Experiment.holds.map((hold) => ({
  id: hold.id, kind: 'hold', center: [hold.center[0], hold.center[1]],
  polygon: hold.polygon.map(([x, y]): Point => [x, y]),
}))
const holdRoles: HoldRole[] = ['start', 'finish', 'hold', 'foot-only']
const grades = ['VB', 'V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10+']

function roleLabel(role: HoldRole) {
  if (role === 'start') return 'START'
  if (role === 'finish') return 'FINISH'
  if (role === 'foot-only') return 'FOOT-ONLY'
  return 'HOLD'
}

function roleClass(role: HoldRole) {
  return `role-${role}`
}

function toWallPoint(point: Point): Point {
  return [point[0] * WALL_WIDTH, point[1] * WALL_HEIGHT]
}

function polygonPoints(hold: PolygonHoldCandidate) {
  return hold.polygon.map(([x, y]) => `${x * WALL_WIDTH},${y * WALL_HEIGHT}`).join(' ')
}

function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false
  const [x, y] = point
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const intersects = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

function polygonArea(hold: PolygonHoldCandidate) {
  let sum = 0
  for (let i = 0, j = hold.polygon.length - 1; i < hold.polygon.length; j = i++) {
    const [xi, yi] = hold.polygon[i]
    const [xj, yj] = hold.polygon[j]
    sum += (xj + xi) * (yj - yi)
  }
  return Math.abs(sum / 2)
}

function nearestHold(point: Point) {
  const nx = point[0] / WALL_WIDTH
  const ny = point[1] / WALL_HEIGHT
  const containing = holds
    .filter((hold) => pointInPolygon([nx, ny], hold.polygon))
    .sort((a, b) => polygonArea(a) - polygonArea(b))
  if (containing.length > 0) return containing[0]

  return holds
    .map((hold) => ({
      hold,
      distance: Math.hypot(hold.center[0] * WALL_WIDTH - point[0], hold.center[1] * WALL_HEIGHT - point[1]),
    }))
    .filter(({ distance }) => distance <= 18)
    .sort((a, b) => a.distance - b.distance)[0]?.hold
}

function WallViewer({
  mode,
  draft,
  activeProblem,
  onHoldTap,
  debugPolygons,
  showPolygonLabels,
  showCropFocus,
  highlightedHoldId,
}: {
  mode: 'browse' | 'set'
  draft: ProblemHold[]
  activeProblem: Problem | null
  onHoldTap: (id: string) => void
  debugPolygons: PolygonHoldCandidate[]
  showPolygonLabels: boolean
  showCropFocus: boolean
  highlightedHoldId: string | null
}) {
  const selectionGradientId = useId()
  const routeMaskId = useId()
  const [motionAllowed, setMotionAllowed] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setMotionAllowed(!preference.matches)
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])
  const viewportRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ scale: 0.35, x: 0, y: 0 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const tap = useRef<{ id: number; x: number; y: number; holdId?: string; moved: boolean } | null>(null)

  const shownHolds = mode === 'set' ? draft : activeProblem?.holds ?? []
  const shownMap = useMemo(() => new Map(shownHolds.map((h) => [h.holdId, h.role])), [shownHolds])
  const selectedHolds = useMemo(() => holds.filter((hold) => shownMap.has(hold.id)), [shownMap])
  const routeHolds = mode === 'browse' ? selectedHolds : []

  const fit = () => {
    const viewport = viewportRef.current
    if (!viewport) return
    const scale = Math.min(viewport.clientWidth / WALL_WIDTH, viewport.clientHeight / WALL_HEIGHT)
    setView({
      scale,
      x: (viewport.clientWidth - WALL_WIDTH * scale) / 2,
      y: (viewport.clientHeight - WALL_HEIGHT * scale) / 2,
    })
  }

  useEffect(() => {
    fit()
    const preventScroll = (event: WheelEvent) => event.preventDefault()
    const viewport = viewportRef.current
    viewport?.addEventListener('wheel', preventScroll, { passive: false })
    const handler = () => fit()
    window.addEventListener('resize', handler)
    const observer = new ResizeObserver(handler)
    if (viewport) observer.observe(viewport)
    return () => {
      window.removeEventListener('resize', handler)
      observer.disconnect()
      viewport?.removeEventListener('wheel', preventScroll)
    }
  }, [])

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    setView((v) => {
      const nextScale = Math.max(0.12, Math.min(4.5, v.scale * factor))
      const wx = (px - v.x) / v.scale
      const wy = (py - v.y) / v.scale
      return { scale: nextScale, x: px - wx * nextScale, y: py - wy * nextScale }
    })
  }

  const focusCrop = () => {
    const viewport = viewportRef.current
    if (!viewport) return
    setView({ scale: Math.min(viewport.clientWidth / (WALL_WIDTH / 3), viewport.clientHeight / (WALL_HEIGHT / 3)), x: 0, y: 0 })
  }

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const candidate = tap.current
    pointers.current.delete(e.pointerId)
    if (!cancelled && candidate?.id === e.pointerId && !candidate.moved &&
        Math.hypot(e.clientX - candidate.x, e.clientY - candidate.y) <= 6 &&
        candidate.holdId && mode === 'set') onHoldTap(candidate.holdId)
    if (candidate?.id === e.pointerId || cancelled) tap.current = null
  }

  return (
    <div
      className="wall-viewport"
      ref={viewportRef}
      onWheel={(e) => zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0012))}
      onPointerDown={(e) => {
        if ((e.target as Element).closest('button') || e.button !== 0) return
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (pointers.current.size === 1) {
          const rect = e.currentTarget.getBoundingClientRect()
          const wallPoint: Point = [
            (e.clientX - rect.left - view.x) / view.scale,
            (e.clientY - rect.top - view.y) / view.scale,
          ]
          const hold = mode === 'set' ? nearestHold(wallPoint) : undefined
          tap.current = { id: e.pointerId, x: e.clientX, y: e.clientY, holdId: hold?.id, moved: false }
        } else if (tap.current) tap.current.moved = true
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const previous = pointers.current.get(e.pointerId)
        if (!previous) return
        const before = [...pointers.current.values()]
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (tap.current && Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) > 6) {
          tap.current.moved = true
        }
        const after = [...pointers.current.values()]
        if (before.length === 1) {
          setView((v) => ({ ...v, x: v.x + e.clientX - previous.x, y: v.y + e.clientY - previous.y }))
        } else {
          const midpoint = (points: typeof before) => ({
            x: (points[0].x + points[1].x) / 2,
            y: (points[0].y + points[1].y) / 2,
          })
          const oldMid = midpoint(before)
          const newMid = midpoint(after)
          const distance = (points: typeof before) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
          const oldDistance = distance(before)
          const rect = e.currentTarget.getBoundingClientRect()
          setView((v) => {
            const scale = Math.max(0.12, Math.min(4.5, v.scale * (oldDistance > 0 ? distance(after) / oldDistance : 1)))
            return {
              scale,
              x: newMid.x - rect.left - (oldMid.x - rect.left - v.x) * scale / v.scale,
              y: newMid.y - rect.top - (oldMid.y - rect.top - v.y) * scale / v.scale,
            }
          })
        }
      }}
      onPointerUp={(e) => endPointer(e)}
      onPointerCancel={(e) => endPointer(e, true)}
      onLostPointerCapture={(e) => endPointer(e, true)}
    >
      <div
        className="wall-stage"
        style={{ width: WALL_WIDTH, height: WALL_HEIGHT, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <img src={wallImage} className="wall-image" alt="Stoneham spray wall" draggable={false} />
        <svg className="wall-overlay" viewBox={`0 0 ${WALL_WIDTH} ${WALL_HEIGHT}`}>
          <defs>
            {selectedHolds.length > 0 && <mask id={routeMaskId} className={`selection-outside-mask ${mode === 'browse' ? 'route-focus-mask' : ''}`} maskUnits="userSpaceOnUse"
              maskContentUnits="userSpaceOnUse" x={0} y={0} width={WALL_WIDTH} height={WALL_HEIGHT} style={{ maskType: 'luminance' }}>
              <rect width={WALL_WIDTH} height={WALL_HEIGHT} fill="white" />
              {selectedHolds.map((hold) => <polygon key={hold.id} points={polygonPoints(hold)} fill="black" />)}
            </mask>}
            <linearGradient id={selectionGradientId} x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
              <stop offset="0%" stopColor="#33d6ff" />
              <stop offset="20%" stopColor="#a580ff" />
              <stop offset="40%" stopColor="#ff6eac" />
              <stop offset="60%" stopColor="#ffc857" />
              <stop offset="80%" stopColor="#d7ff65" />
              <stop offset="100%" stopColor="#33d6ff" />
              {motionAllowed && mode === 'set' && highlightedHoldId && shownMap.has(highlightedHoldId) && <animateTransform attributeName="gradientTransform" type="rotate" from="0 .5 .5" to="360 .5 .5" dur="3s" repeatCount="indefinite" />}
            </linearGradient>
          </defs>
          <g className="debug-polygons" aria-hidden="true">
            {debugPolygons.map((hold, index) => {
              const [cx, cy] = toWallPoint(hold.center)
              return (
                <g key={hold.id}>
                  <polygon className="debug-polygon" points={polygonPoints(hold)}
                    style={{ fill: `hsl(${index * 137.508 % 360} 85% 60% / 0.18)`, stroke: `hsl(${index * 137.508 % 360} 85% 65%)` }} />
                  {showPolygonLabels && <text className="debug-polygon-label" x={cx} y={cy} fontSize={12 / view.scale}>{hold.id}</text>}
                </g>
              )
            })}
          </g>
          {routeHolds.length > 0 && <rect className="route-gray-layer" width={WALL_WIDTH} height={WALL_HEIGHT}
            fill="#686d67" fillOpacity={0.72} mask={`url(#${routeMaskId})`} aria-hidden="true" />}
          {selectedHolds.length > 0 && <g className="selection-effects" mask={`url(#${routeMaskId})`}>
            {selectedHolds.map((hold) => {
              const role = shownMap.get(hold.id)!
              const isCurrent = mode === 'set' && highlightedHoldId === hold.id
              return (
                <g key={hold.id}>
                  {!isCurrent && <polygon className={`selected-glow ${roleClass(role)}`} points={polygonPoints(hold)} aria-hidden="true" />}
                  <polygon className={`selected-hold ${roleClass(role)} ${isCurrent ? 'is-current' : ''}`} points={polygonPoints(hold)} />
                  {isCurrent && <polygon className="selected-rainbow" points={polygonPoints(hold)} pathLength={100}
                    stroke={`url(#${selectionGradientId})`} aria-hidden="true" />}
                </g>
              )
            })}
          </g>}
          {mode === 'set' && holds.map((hold) => <polygon key={hold.id}
            className={`hold-hit-polygon ${shownMap.has(hold.id) ? 'is-selected' : ''}`} points={polygonPoints(hold)} data-hold-id={hold.id} />)}
        </svg>
      </div>
      <button className="fit-button" onPointerUp={(e) => { e.stopPropagation(); fit() }} onClick={fit} aria-label="Fit wall" title="Fit wall"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6" /></svg></button>
      {showCropFocus && <button className="crop-focus-button" onPointerUp={(e) => { e.stopPropagation(); focusCrop() }} onClick={focusCrop}>Focus top-left crop</button>}
      {mode === 'set' && <div className="tap-hint">Tap holds · drag to pan · pinch to zoom</div>}
    </div>
  )
}

function App() {
  const [identity, setIdentity] = useState<{ userId: string; isAdmin: boolean } | null>(null)
  const [profile, setProfile] = useState<UserProfile>({ displayName: '', bio: '' })
  const [email, setEmail] = useState('')
  const [showProfile, setShowProfile] = useState(false)
  const [routesOpen, setRoutesOpen] = useState(false)
  const routesDialog = useRef<HTMLDialogElement>(null)
  const accountMenu = useRef<HTMLDetailsElement>(null)
  const closeAccount = () => { if (accountMenu.current) accountMenu.current.open = false }
  useEffect(() => {
    const outside = (event: globalThis.PointerEvent) => {
      if (!accountMenu.current?.contains(event.target as Node)) closeAccount()
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeAccount() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [])
  const [profileNotice, setProfileNotice] = useState('')
  const [authError, setAuthError] = useState('')
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const draftUserId = useRef<string | null>(null)
  const canWrite = !problemStore.shared || Boolean(identity)
  const [mode, setMode] = useState<'browse' | 'set'>('browse')
  const [problems, setProblems] = useState<Problem[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [loadingMore, setLoadingMore] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ProblemHold[]>([])
  const [highlightedHoldId, setHighlightedHoldId] = useState<string | null>(null)
  const [currentRole, setCurrentRole] = useState<HoldRole>('hold')
  const [name, setName] = useState('')
  const [grade, setGrade] = useState('V4')
  const [setter, setSetter] = useState('')
  const [storageError, setStorageError] = useState('')
  const [listError, setListError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Problem | null>(null)
  const [conflict, setConflict] = useState(false)
  const [localProblems, setLocalProblems] = useState(pendingLocalProblems)
  const [importMessage, setImportMessage] = useState('')
  const mutation = useRef(false)
  const listSequence = useRef(0)
  const selectionSequence = useRef(0)
  const [showAllPolygons, setShowAllPolygons] = useState(false)
  const [showPolygonLabels, setShowPolygonLabels] = useState(false)
  const [debugDataset, setDebugDataset] = useState<'current' | 'sam2'>('current')
  const experimentHolds = sam2Holds
  const debugHolds = debugDataset === 'current' ? holds : experimentHolds

  useEffect(() => {
    const dialog = routesDialog.current
    if (!dialog) return
    if (routesOpen && mode === 'browse' && !showProfile) dialog.showModal()
    else dialog.close()
  }, [routesOpen, mode, showProfile])

  const activeProblem = problems.find((p) => p.id === activeId) ?? null

  const clearRecovery = () => { try { window.sessionStorage.removeItem(DRAFT_RECOVERY_KEY) } catch { /* Browser storage can be unavailable. */ } }
  const signInWithRecovery = async () => {
    try {
      if (mode === 'set' && draftUserId.current) storeRecoveryDraft(window.sessionStorage, {
        userId: draftUserId.current, name, grade, setter, draft, editing,
      })
      await signIn()
    } catch (e) { setAuthError(e instanceof Error ? e.message : 'Could not preserve your draft and sign in. Please retry.') }
  }

  useEffect(() => {
    let live = true
    let sequence = 0
    const loadIdentity = async () => {
      const request = ++sequence
      const current = () => live && request === sequence
      try {
        await initializeAuth()
        const token = await accessToken()
        if (!current()) return
        if (!token) { setIdentity(null); return }
        const response = await fetch(apiBaseUrl + '/v1/me', { headers: { authorization: 'Bearer ' + token } })
        if (response.status === 401) { emitSessionEvent('expired'); return }
        if (!response.ok) throw new Error('Could not verify your login. Please sign in again.')
        const value = await response.json()
        const details = await accountDetails()
        if (!current()) return
        let nextProfile: UserProfile = { displayName: details.displayName, bio: '' }
        let warning = ''
        try {
          const saved = await profileRequest(apiBaseUrl, token)
          nextProfile = { ...saved, displayName: saved.displayName || details.displayName }
        } catch { warning = 'Could not load your profile. Refresh to retry.' }
        if (!current()) return
        setEmail(details.email); setProfile(nextProfile); setIdentity(value)
        setNeedsSignIn(false); setAuthError(warning)
        const recovery = readRecoveryDraft(window.sessionStorage, value.userId, validHoldIds)
        if (recovery) {
          draftUserId.current = value.userId
          setDraft(recovery.draft); setName(recovery.name); setGrade(recovery.grade); setSetter(recovery.setter)
          setEditing(recovery.editing); setMode('set'); setConflict(false)
          setProfileNotice('Draft restored. You can save it now.')
        }
        clearRecovery()
      } catch (e) { if (current()) setAuthError(e instanceof Error ? e.message : 'Login failed.') }
    }
    const unsubscribe = onSessionEvent((event) => {
      if (!live) return
      if (event === 'loaded') { void loadIdentity(); return }
      sequence++
      setIdentity(null)
      if (event === 'expired') {
        setNeedsSignIn(true)
        setAuthError('Your session expired. Sign in again to continue; your route draft is kept.')
      } else { setNeedsSignIn(false); setShowProfile(false) }
    })
    void loadIdentity()
    return () => { live = false; sequence++; unsubscribe() }
  }, [])


  const refreshProblems = async () => {
    const sequence = ++listSequence.current
    setLoading(true)
    setLoadingMore(false)
    setListError('')
    try {
      const page = await problemStore.list()
      if (sequence === listSequence.current) { setProblems(page.items); setNextCursor(page.nextCursor) }
    } catch (error) {
      if (sequence === listSequence.current) setListError(error instanceof Error ? error.message : 'Could not load problems.')
    } finally {
      if (sequence === listSequence.current) setLoading(false)
    }
  }
  useEffect(() => {
    void refreshProblems()
    return () => { listSequence.current++; selectionSequence.current++ }
  }, [])

  const moreInFlight = useRef<number | null>(null)
  const loadMoreProblems = async () => {
    if (!nextCursor || moreInFlight.current === listSequence.current || loading) return
    const sequence = listSequence.current
    moreInFlight.current = sequence
    setLoadingMore(true); setListError('')
    try {
      const page = await problemStore.list(nextCursor)
      if (sequence === listSequence.current) {
        setProblems((previous) => {
          const ids = new Set(previous.map((p) => p.id))
          return [...previous, ...page.items.filter((p) => { if (ids.has(p.id)) return false; ids.add(p.id); return true })]
        })
        setNextCursor(page.nextCursor)
      }
    } catch (e) {
      if (sequence === listSequence.current) setListError(e instanceof Error ? e.message : 'Could not load more routes.')
    } finally {
      if (moreInFlight.current === sequence) moreInFlight.current = null
      if (sequence === listSequence.current) setLoadingMore(false)
    }
  }

  const openProblem = async (problem: Problem, edit = false) => {
    const sequence = ++selectionSequence.current
    setOpeningId(problem.id)
    setListError('')
    try {
      const fresh = await problemStore.get(problem.id)
      if (sequence !== selectionSequence.current) return
      setProblems((prev) => prev.map((item) => item.id === fresh.id ? fresh : item))
      setActiveId(fresh.id)
      setRoutesOpen(false)
      if (edit) {
        draftUserId.current = identity?.userId ?? null
        setEditing(fresh)
        setDraft(fresh.holds)
        setName(fresh.name)
        setGrade(fresh.grade)
        setSetter(fresh.setter)
        setHighlightedHoldId(null)
        setStorageError('')
        setConflict(false)
        setMode('set')
      }
    } catch (error) {
      if (sequence === selectionSequence.current) setListError(error instanceof Error ? error.message : 'Could not open problem.')
    } finally {
      if (sequence === selectionSequence.current) setOpeningId(null)
    }
  }

  const startSetting = () => {
    if (!canWrite) { void signInWithRecovery(); return }
    draftUserId.current = identity?.userId ?? null
    clearRecovery()
    setShowProfile(false)
    closeAccount()
    setRoutesOpen(false)
    selectionSequence.current++
    setOpeningId(null)
    setEditing(null)
    setConflict(false)
    setDraft([])
    setHighlightedHoldId(null)
    setStorageError('')
    setCurrentRole('hold')
    setName('')
    setGrade('V4')
    setSetter(profile.displayName || '')
    setMode('set')
  }

  const tapHold = (holdId: string) => {
    if (mutation.current) return
    const existing = draft.find((h) => h.holdId === holdId)
    if (existing?.role === currentRole) {
      setDraft((prev) => prev.filter((h) => h.holdId !== holdId))
      setHighlightedHoldId((previous) => previous === holdId ? null : previous)
    } else {
      setDraft((prev) => existing
        ? prev.map((h) => h.holdId === holdId ? { holdId, role: currentRole } : h)
        : [...prev, { holdId, role: currentRole }])
      setHighlightedHoldId(holdId)
    }
  }

  const validDraft = Boolean(name.trim()) && draft.length >= 2 &&
    draft.some((hold) => hold.role === 'start') && draft.some((hold) => hold.role === 'finish')

  const saveProblem = async () => {
    if (!validDraft || mutation.current || conflict || !canWrite) return
    mutation.current = true
    setBusy(true)
    setStorageError('')
    listSequence.current++
    setLoading(false)
    setLoadingMore(false)
    const input = { name: name.trim(), grade, setter: setter.trim() || 'Anonymous', holds: draft, ...(editing?.notes !== undefined ? { notes: editing.notes } : {}) }
    try {
      const problem = editing ? await problemStore.update(editing, input) : await problemStore.create(input)
      setProblems((prev) => [problem, ...prev.filter((p) => p.id !== problem.id)])
      clearRecovery()
      setActiveId(problem.id)
      setHighlightedHoldId(null)
      setEditing(null)
      setMode('browse')
    } catch (error) {
      if (error instanceof ProblemStoreError && error.status === 409) {
        setConflict(true)
        setStorageError('Someone else updated this problem. Your draft is preserved. Save it as a new problem, or cancel and reopen the latest version.')
      } else setStorageError(error instanceof Error ? error.message : 'Could not save problem. Your draft is still here.')
    } finally { mutation.current = false; setBusy(false) }
  }

  const importLocal = async () => {
    if (mutation.current) return
    mutation.current = true
    setBusy(true)
    setImportMessage('')
    let imported = 0
    const skipped: string[] = []
    try {
      const mapping = JSON.parse(browserStorage.getItem(importKey) || '{}')
      // Check that migration progress can be persisted before creating remote records.
      browserStorage.setItem(importKey, JSON.stringify(mapping))
      for (const problem of localProblems) {
        if (mapping[problem.id]) continue
        if (!problem.holds.some((h) => h.role === 'start') || !problem.holds.some((h) => h.role === 'finish')) {
          skipped.push(problem.name)
          continue
        }
        const { name, grade, setter, holds, notes } = problem
        const saved = await problemStore.create({ name, grade, setter, holds, notes })
        mapping[problem.id] = saved.id
        browserStorage.setItem(importKey, JSON.stringify(mapping))
        imported++
      }
      setImportMessage(imported + ' imported.' + (skipped.length ? ' Still local (need a Start and Finish): ' + skipped.join(', ') : ' Local originals are kept.'))
    } catch (error) {
      setImportMessage(imported + ' imported. ' + (error instanceof Error ? error.message : 'Import stopped.'))
    } finally {
      setLocalProblems(pendingLocalProblems())
      await refreshProblems()
      mutation.current = false
      setBusy(false)
    }
  }

  return (
    <main className={`app-shell ${mode === 'set' ? 'is-setting' : activeProblem ? 'has-active-route' : ''}`}>
      <header className="topbar">
        <div>
          <div className="eyebrow">STONEHAM</div>
          <h1>Spray Wall</h1>
        </div>
        {identity && <details className="account-menu" ref={accountMenu}>
          <summary aria-label="Account menu" title="Account menu">{(profile.displayName || 'U').slice(0, 1).toUpperCase()}</summary>
          <div className="account-popover">
            <strong>{profile.displayName || 'Your account'}</strong>
            <button className="ghost small" disabled={busy} onClick={(e) => { e.currentTarget.closest('details')?.removeAttribute('open'); setRoutesOpen(false); setShowProfile(true); setProfileNotice('') }}>Profile{profile.displayName ? ' · ' + profile.displayName : ''}</button>
            <button className="ghost small" disabled={busy} onClick={() => { clearRecovery(); void signOut().catch((e) => setAuthError(e.message)) }}>Sign out</button>
            {identity.isAdmin && <><span className="muted">Gym administrator</span>
      <details className="polygon-debug-panel">
        <summary>Polygon debug</summary>
        <div className="polygon-debug-controls">
          <label><input type="checkbox" checked={showAllPolygons} onChange={(e) => setShowAllPolygons(e.target.checked)} />Show all polygons</label>
          <label><input type="checkbox" checked={showPolygonLabels} disabled={!showAllPolygons} onChange={(e) => setShowPolygonLabels(e.target.checked)} />Show polygon labels</label>
          <label>Debug dataset
            <select aria-label="Debug dataset" value={debugDataset} onChange={(e) => setDebugDataset(e.target.value as 'current' | 'sam2')}>
              <option value="current">Current candidates ({holds.length})</option>
              <option value="sam2">SAM2 top-left ({experimentHolds.length})</option>
            </select>
          </label>
          <p>{debugHolds.length} polygons · Overlay only. Route setting continues to use current candidates.</p>
        </div>
      </details>
            </>}
          </div>
        </details>}
      </header>
      {!showProfile && <nav className="home-actions" aria-label="Wall actions">
        {mode === 'browse' ? <>
          <button className="primary" disabled={busy || (problemStore.shared && !identity && !authConfigured)} onClick={startSetting}>{problemStore.shared && !identity ? (needsSignIn ? 'Sign in again' : 'Login to set') : '＋ Set'}</button>
          <button className="primary" aria-haspopup="dialog" aria-expanded={routesOpen} aria-controls="routes-drawer" onClick={() => setRoutesOpen(true)}>Explore routes <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10" /></svg></button>
        </> : <button className="ghost small" disabled={busy} onClick={() => { clearRecovery(); setMode('browse'); setHighlightedHoldId(null) }}>Cancel</button>}
        {mode === 'set' && problemStore.shared && !identity && <button className="primary small" disabled={!authConfigured} onClick={() => void signInWithRecovery()}>{needsSignIn ? 'Sign in again' : 'Login to set'}</button>}
      </nav>}
      {authError && <p role="alert" className="error-message auth-notice">{authError}</p>}
      {profileNotice && <p className="profile-notice" role="status">{profileNotice}</p>}
      {showProfile && (identity || needsSignIn) ? <Profile baseUrl={apiBaseUrl} initial={profile} email={email}
        onClose={() => setShowProfile(false)} onOpenSend={async (id) => {
          const problem = await problemStore.get(id)
          setProblems((previous) => [problem, ...previous.filter((p) => p.id !== id)])
          setActiveId(id); setMode('browse'); setShowProfile(false)
        }} onSave={(saved) => { setProfile(saved); setProfileNotice('Profile saved.'); setShowProfile(false) }} /> : <>
      <section className="wall-card">
        <WallViewer mode={mode} draft={draft} activeProblem={activeProblem} onHoldTap={tapHold}
          debugPolygons={identity?.isAdmin && showAllPolygons ? debugHolds : []} showPolygonLabels={Boolean(identity?.isAdmin && showPolygonLabels)} showCropFocus={Boolean(identity?.isAdmin && showAllPolygons) && debugDataset === 'sam2'} highlightedHoldId={highlightedHoldId} />
      </section>

      {mode === 'set' ? (
        <section className="editor-sheet">
          <fieldset className="editor-fields" aria-label="Problem editor" disabled={busy}>
          <div className="role-row" role="group" aria-label="Hold role">
            {holdRoles.map((role) => (
              <button
                key={role}
                type="button"
                aria-pressed={currentRole === role}
                className={`role-button ${roleClass(role)} ${currentRole === role ? 'active' : ''}`}
                onClick={() => setCurrentRole(role)}
              >
                {roleLabel(role)}
              </button>
            ))}
            <span className="selection-count" aria-live="polite">{draft.length} selected</span>
          </div>
          <div className="form-grid">
            <label>
              Problem name
              <input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Technical Butt" />
            </label>
            <label>
              Grade
              <select value={grade} onChange={(e) => setGrade(e.target.value)}>
                {grades.map((g) => <option key={g}>{g}</option>)}
              </select>
            </label>
            <label>
              Setter
              <input maxLength={80} value={setter} onChange={(e) => setSetter(e.target.value)} />
            </label>
          </div>
          {!validDraft && <p className="muted">Add a name, at least one Start and one Finish.</p>}
          {storageError && <p className="error-message" role="alert">{storageError}</p>}
          {conflict && <button className="ghost" onClick={() => { setEditing(null); setConflict(false); setStorageError(''); setName((previous) => previous.slice(0, 112) + ' (copy)') }}>Keep draft as new problem</button>}
          <div className="editor-actions">
            <button className="ghost" onClick={() => { setDraft([]); setHighlightedHoldId(null) }}>Clear</button>
            <button className="primary" disabled={!validDraft || busy || conflict || !canWrite} onClick={() => void saveProblem()}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save problem'}</button>
          </div>
          </fieldset>
        </section>
      ) : (
        <>
        {activeProblem && <section className="active-route" aria-label="Selected route">
          <div className="active-route-heading">
            <div><span className="muted">{activeProblem.grade} · {activeProblem.setter}</span><h2>{activeProblem.name}</h2></div>
            <button className="ghost small" aria-label="Clear selected route" onClick={() => setActiveId(null)}>✕</button>
          </div>
            {activeProblem && (!problemStore.shared || identity?.isAdmin || (identity && activeProblem.ownerId === identity.userId)) && <button className="ghost small" disabled={busy || openingId !== null} onClick={() => void openProblem(activeProblem, true)}>Edit problem</button>}
          {problemStore.shared && <a className="route-activity-link" href="#route-activity">Send · Rate · Comments <span aria-hidden="true">↓</span></a>}
          {problemStore.shared && activeProblem && <Community key={activeProblem.id} baseUrl={apiBaseUrl} problemId={activeProblem.id} name={activeProblem.name} userId={identity?.userId} />}
        </section>}
        <dialog id="routes-drawer" className="routes-drawer" ref={routesDialog} aria-labelledby="routes-title"
          onCancel={() => setRoutesOpen(false)}
          onClick={(e) => { if (e.target === e.currentTarget) { const rect = e.currentTarget.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) setRoutesOpen(false) } }}>
        <section className="problem-sheet">
          <div className="drawer-heading"><h2 id="routes-title">Explore routes</h2><button className="ghost small" aria-label="Close routes" onClick={() => setRoutesOpen(false)}>✕</button></div>
          <div className="section-heading">
            <div>
              <div className="eyebrow">{problemStore.shared ? 'SHARED WALL' : 'LOCAL MODE'}</div>
              <span className="muted">Choose a problem to see it on the wall</span>
            </div>
            <span className="muted">{problems.length} {problemStore.shared ? (nextCursor ? 'routes loaded' : 'shared problems') : 'saved on this device'}</span>
          </div>

          <div className="problem-tools">
            <button className="ghost small" disabled={busy || loading} onClick={() => void refreshProblems()}>{loading ? 'Loading…' : 'Refresh'}</button>

          </div>

          {listError && <p className="error-message" role="alert">{listError}</p>}
          {openingId && <p role="status" className="muted">Opening problem…</p>}
          {problemStore.shared && localProblems.length > 0 && <div className="local-import">
            <p>{localProblems.length} local problems remain on this device.</p>
            <button className="ghost small" disabled={busy || loading || !canWrite} onClick={() => void importLocal()}>{busy ? 'Importing…' : 'Import local problems'}</button>
          </div>}
          {importMessage && <p role="status">{importMessage}</p>}
          {loading && problems.length === 0 ? <p role="status">Loading problems…</p> : problems.length === 0 && listError ? null : problems.length === 0 ? (
            <button className="empty-state" disabled={busy} onClick={startSetting}>
              <span className="empty-plus">＋</span>
              <strong>Set the first problem</strong>
              <span>{problemStore.shared ? 'Tap holds on the wall and share your problem.' : 'Tap holds directly on the wall. Saved on this device.'}</span>
            </button>
          ) : (
            <div className="problem-list">
              {problems.map((problem) => (
                <button
                  key={problem.id}
                  className={`problem-card ${activeId === problem.id ? 'active' : ''}`}
                  disabled={busy}
                  onClick={() => void openProblem(problem)}
                >
                  <span className="grade-chip">{problem.grade}</span>
                  <span className="problem-copy">
                    <strong>{problem.name}</strong>
                    <small>{problem.setter} · {problem.holds.length} holds</small>
                  </span>
                  <span className="chevron">›</span>
                </button>
              ))}
            </div>
          )}
          {nextCursor && <button className="ghost load-more" disabled={busy || loading || loadingMore} onClick={() => void loadMoreProblems()}>{loadingMore ? 'Loading more…' : 'Load more routes'}</button>}
        </section>
        </dialog>
        </>
      )}
      </>}
    </main>
  )
}

export default App
