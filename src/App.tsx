import { useEffect, useId, useMemo, useRef, useState } from 'react'
import sam2Experiment from './data/experiments/top_left_sam2_polygons.json'
import { polygonCandidates as holds } from './data/polygons'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { HoldRole, Problem, ProblemHold, PolygonHoldCandidate, Point } from './types'

const wallImage = `${import.meta.env.BASE_URL}wall/stoneham-spraywall-canonical.jpg`
const STORAGE_KEY = 'stoneham-spraywall:problems:v3'
const WALL_WIDTH = 1536
const WALL_HEIGHT = WALL_WIDTH * 5514 / 7292
const sam2Holds: PolygonHoldCandidate[] = sam2Experiment.holds.map((hold) => ({
  id: hold.id, kind: 'hold', center: [hold.center[0], hold.center[1]],
  polygon: hold.polygon.map(([x, y]): Point => [x, y]),
}))
const holdRoles: HoldRole[] = ['start', 'finish', 'hold', 'foot-only']
const grades = ['VB', 'V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10+']

function loadProblems(): Problem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p): p is Problem =>
      p !== null && typeof p === 'object' &&
      typeof p.id === 'string' && typeof p.name === 'string' &&
      typeof p.grade === 'string' && typeof p.setter === 'string' &&
      typeof p.createdAt === 'string' && Array.isArray(p.holds) &&
      p.holds.every((h: ProblemHold) => h !== null && typeof h === 'object' &&
        holds.some((hold) => hold.id === h.holdId) &&
        [...holdRoles, 'hand'].includes(h.role)),
    ).map((problem) => ({ ...problem, holds: problem.holds.map((h): ProblemHold => ({
      ...h, role: (h.role as HoldRole | 'hand') === 'hand' ? 'hold' : h.role,
    })) }))
  } catch {
    return []
  }
}

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
}: {
  mode: 'browse' | 'set'
  draft: ProblemHold[]
  activeProblem: Problem | null
  onHoldTap: (id: string) => void
  debugPolygons: PolygonHoldCandidate[]
  showPolygonLabels: boolean
  showCropFocus: boolean
}) {
  const selectionGradientId = useId()
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
            <linearGradient id={selectionGradientId} x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
              <stop offset="0%" stopColor="#33d6ff" />
              <stop offset="20%" stopColor="#a580ff" />
              <stop offset="40%" stopColor="#ff6eac" />
              <stop offset="60%" stopColor="#ffc857" />
              <stop offset="80%" stopColor="#d7ff65" />
              <stop offset="100%" stopColor="#33d6ff" />
              {motionAllowed && <animateTransform attributeName="gradientTransform" type="rotate" from="0 .5 .5" to="360 .5 .5" dur="3s" repeatCount="indefinite" />}
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
          {holds.map((hold) => {
            const role = shownMap.get(hold.id)
            const [cx, cy] = toWallPoint(hold.center)
            return (
              <g key={hold.id}>
                {role && (
                  <>
                    <polygon className={`selected-hold ${roleClass(role)}`} points={polygonPoints(hold)} />
                    <polygon className="selected-rainbow" points={polygonPoints(hold)} pathLength={100}
                      stroke={`url(#${selectionGradientId})`} aria-hidden="true" />
                  </>
                )}
                {mode === 'set' && (
                  <polygon className="hold-hit-polygon" points={polygonPoints(hold)} data-hold-id={hold.id} />
                )}
                {role && <circle className="selected-center" cx={cx} cy={cy} r={3.5} />}
              </g>
            )
          })}
        </svg>
      </div>
      <button className="fit-button" onPointerUp={(e) => { e.stopPropagation(); fit() }} onClick={fit}>Fit wall</button>
      {showCropFocus && <button className="crop-focus-button" onPointerUp={(e) => { e.stopPropagation(); focusCrop() }} onClick={focusCrop}>Focus top-left crop</button>}
      {mode === 'set' && <div className="tap-hint">Tap holds · drag to pan · pinch to zoom</div>}
    </div>
  )
}

function App() {
  const [mode, setMode] = useState<'browse' | 'set'>('browse')
  const [problems, setProblems] = useState<Problem[]>(loadProblems)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ProblemHold[]>([])
  const [currentRole, setCurrentRole] = useState<HoldRole>('hold')
  const [name, setName] = useState('')
  const [grade, setGrade] = useState('V4')
  const [setter, setSetter] = useState('Lu')
  const [storageError, setStorageError] = useState('')
  const [showAllPolygons, setShowAllPolygons] = useState(false)
  const [showPolygonLabels, setShowPolygonLabels] = useState(false)
  const [debugDataset, setDebugDataset] = useState<'current' | 'sam2'>('current')
  const experimentHolds = sam2Holds
  const debugHolds = debugDataset === 'current' ? holds : experimentHolds

  const activeProblem = problems.find((p) => p.id === activeId) ?? null

  const startSetting = () => {
    setDraft([])
    setStorageError('')
    setCurrentRole('hold')
    setName('')
    setGrade('V4')
    setMode('set')
  }

  const tapHold = (holdId: string) => {
    setDraft((prev) => {
      const index = prev.findIndex((h) => h.holdId === holdId)
      if (index >= 0) {
        const existing = prev[index]
        if (existing.role === currentRole) return prev.filter((_, i) => i !== index)
        const next = [...prev]
        next[index] = { holdId, role: currentRole }
        return next
      }
      return [...prev, { holdId, role: currentRole }]
    })
  }

  const saveProblem = () => {
    const trimmed = name.trim()
    if (!trimmed || draft.length < 2) return
    const problem: Problem = {
      id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() :
        `problem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: trimmed,
      grade,
      setter: setter.trim() || 'Anonymous',
      holds: draft,
      createdAt: new Date().toISOString(),
    }
    const next = [problem, ...problems]
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      setStorageError('Could not save on this device. Free storage or enable browser storage, then try again.')
      return
    }
    setStorageError('')
    setProblems(next)
    setActiveId(problem.id)
    setMode('browse')
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">STONEHAM</div>
          <h1>Spray Wall</h1>
        </div>
        {mode === 'browse' ? (
          <button className="primary small" onClick={startSetting}>＋ Set</button>
        ) : (
          <button className="ghost small" onClick={() => setMode('browse')}>Cancel</button>
        )}
      </header>

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
          debugPolygons={showAllPolygons ? debugHolds : []} showPolygonLabels={showPolygonLabels} showCropFocus={showAllPolygons && debugDataset === 'sam2'} />
      </section>

      {mode === 'set' ? (
        <section className="editor-sheet">
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
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Technical Butt" />
            </label>
            <label>
              Grade
              <select value={grade} onChange={(e) => setGrade(e.target.value)}>
                {grades.map((g) => <option key={g}>{g}</option>)}
              </select>
            </label>
            <label>
              Setter
              <input value={setter} onChange={(e) => setSetter(e.target.value)} />
            </label>
          </div>
          {storageError && <p role="alert">{storageError}</p>}
          <div className="editor-actions">
            <button className="ghost" onClick={() => setDraft([])}>Clear</button>
            <button className="primary" disabled={!name.trim() || draft.length < 2} onClick={saveProblem}>Save problem</button>
          </div>
        </section>
      ) : (
        <section className="problem-sheet">
          <div className="section-heading">
            <div>
              <div className="eyebrow">LOCAL PROTOTYPE</div>
              <h2>Problems</h2>
            </div>
            <span className="muted">{problems.length} saved on this device</span>
          </div>

          {problems.length === 0 ? (
            <button className="empty-state" onClick={startSetting}>
              <span className="empty-plus">＋</span>
              <strong>Set the first problem</strong>
              <span>Tap holds directly on the wall. Nothing leaves this device yet.</span>
            </button>
          ) : (
            <div className="problem-list">
              {problems.map((problem) => (
                <button
                  key={problem.id}
                  className={`problem-card ${activeId === problem.id ? 'active' : ''}`}
                  onClick={() => setActiveId(problem.id)}
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
