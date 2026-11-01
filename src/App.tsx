import { useEffect, useId, useMemo, useRef, useState } from 'react'
import sam2Experiment from './data/experiments/top_left_sam2_polygons.json'
import { polygonCandidates as holds } from './data/polygons'
import { initializeAuth, accessToken, signIn, signOut, authConfigured } from './auth'
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
    return () => {
      window.removeEventListener('resize', handler)
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
      <button className="fit-button" onPointerUp={(e) => { e.stopPropagation(); fit() }} onClick={fit}>Fit wall</button>
      {showCropFocus && <button className="crop-focus-button" onPointerUp={(e) => { e.stopPropagation(); focusCrop() }} onClick={focusCrop}>Focus top-left crop</button>}
      {mode === 'set' && <div className="tap-hint">Tap holds · drag to pan · pinch to zoom</div>}
    </div>
  )
}

function App() {
  const [identity, setIdentity] = useState<{ userId: string; isAdmin: boolean } | null>(null)
  const [authError, setAuthError] = useState('')
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        await initializeAuth()
        const token = await accessToken()
        if (!token) return
        const response = await fetch(apiBaseUrl + '/v1/me', { headers: { authorization: 'Bearer ' + token } })
        if (!response.ok) throw new Error('Could not verify your login. Please sign in again.')
        const value = await response.json()
        if (live) setIdentity(value)
      } catch (error) { if (live) setAuthError(error instanceof Error ? error.message : 'Login failed.') }
    })()
    return () => { live = false }
  }, [])
  const canWrite = !problemStore.shared || Boolean(identity)
  const [mode, setMode] = useState<'browse' | 'set'>('browse')
  const [problems, setProblems] = useState<Problem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ProblemHold[]>([])
  const [highlightedHoldId, setHighlightedHoldId] = useState<string | null>(null)
  const [currentRole, setCurrentRole] = useState<HoldRole>('hold')
  const [name, setName] = useState('')
  const [grade, setGrade] = useState('V4')
  const [setter, setSetter] = useState('Lu')
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

  const activeProblem = problems.find((p) => p.id === activeId) ?? null

  const refreshProblems = async () => {
    const sequence = ++listSequence.current
    setLoading(true)
    setListError('')
    try {
      const items = await problemStore.list()
      if (sequence === listSequence.current) setProblems(items)
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

  const openProblem = async (problem: Problem, edit = false) => {
    const sequence = ++selectionSequence.current
    setOpeningId(problem.id)
    setListError('')
    try {
      const fresh = await problemStore.get(problem.id)
      if (sequence !== selectionSequence.current) return
      setProblems((prev) => prev.map((item) => item.id === fresh.id ? fresh : item))
      setActiveId(fresh.id)
      if (edit) {
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
    if (!canWrite) { void signIn().catch((e) => setAuthError(e.message)); return }
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
    if (!validDraft || mutation.current || conflict) return
    mutation.current = true
    setBusy(true)
    setStorageError('')
    listSequence.current++
    setLoading(false)
    const input = { name: name.trim(), grade, setter: setter.trim() || 'Anonymous', holds: draft, ...(editing?.notes !== undefined ? { notes: editing.notes } : {}) }
    try {
      const problem = editing ? await problemStore.update(editing, input) : await problemStore.create(input)
      setProblems((prev) => [problem, ...prev.filter((p) => p.id !== problem.id)])
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
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">STONEHAM</div>
          <h1>Spray Wall</h1>
        </div>
        {mode === 'browse' ? (
          <button className="primary small" disabled={busy} onClick={startSetting}>＋ Set</button>
        ) : (
          <button className="ghost small" disabled={busy} onClick={() => { setMode('browse'); setHighlightedHoldId(null) }}>Cancel</button>
        )}
      </header>

      {problemStore.shared && <div className="problem-tools auth-tools">
        {identity ? <><span className="muted">{identity.isAdmin ? 'Gym administrator' : 'Signed in'}</span><button className="ghost small" disabled={busy} onClick={() => void signOut().catch((e) => setAuthError(e.message))}>Sign out</button></> :
          <button className="ghost small" disabled={!authConfigured} onClick={() => void signIn().catch((e) => setAuthError(e.message))}>Sign in with Google</button>}
        {authError && <p role="alert" className="error-message">{authError}</p>}
      </div>}
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
      <section className="wall-card">
        <WallViewer mode={mode} draft={draft} activeProblem={activeProblem} onHoldTap={tapHold}
          debugPolygons={showAllPolygons ? debugHolds : []} showPolygonLabels={showPolygonLabels} showCropFocus={showAllPolygons && debugDataset === 'sam2'} highlightedHoldId={highlightedHoldId} />
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
            <button className="primary" disabled={!validDraft || busy || conflict} onClick={() => void saveProblem()}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save problem'}</button>
          </div>
          </fieldset>
        </section>
      ) : (
        <section className="problem-sheet">
          <div className="section-heading">
            <div>
              <div className="eyebrow">{problemStore.shared ? 'SHARED WALL' : 'LOCAL MODE'}</div>
              <h2>Problems</h2>
            </div>
            <span className="muted">{problems.length} {problemStore.shared ? 'shared problems' : 'saved on this device'}</span>
          </div>

          <div className="problem-tools">
            <button className="ghost small" disabled={busy || loading} onClick={() => void refreshProblems()}>{loading ? 'Loading…' : 'Refresh'}</button>
            {activeProblem && (!problemStore.shared || identity?.isAdmin || (identity && activeProblem.ownerId === identity.userId)) && <button className="ghost small" disabled={busy || openingId !== null} onClick={() => void openProblem(activeProblem, true)}>Edit problem</button>}
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
        </section>
      )}
    </main>
  )
}

export default App
