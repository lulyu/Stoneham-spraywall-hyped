import { useEffect, useMemo, useRef, useState } from 'react'
import holds0 from './data/holds-0.json'
import holds1 from './data/holds-1.json'
import holds2 from './data/holds-2.json'
import holds3 from './data/holds-3.json'
import holds4 from './data/holds-4.json'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Hold, HoldRole, Problem, ProblemHold } from './types'

const wallImage = `${import.meta.env.BASE_URL}wall/stoneham-spraywall-canonical.jpg`
const holds = [...holds0, ...holds1, ...holds2, ...holds3, ...holds4] as Hold[]
const STORAGE_KEY = 'stoneham-spraywall:problems:v1'
const WALL_WIDTH = 1536
const WALL_HEIGHT = WALL_WIDTH * 5514 / 7292
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
        ['start', 'hand', 'finish'].includes(h.role)),
    )
  } catch {
    return []
  }
}

function roleLabel(role: HoldRole) {
  if (role === 'start') return 'START'
  if (role === 'finish') return 'FINISH'
  return 'HAND'
}

function roleClass(role: HoldRole) {
  return `role-${role}`
}

function WallViewer({
  mode,
  draft,
  activeProblem,
  onHoldTap,
}: {
  mode: 'browse' | 'set'
  draft: ProblemHold[]
  activeProblem: Problem | null
  onHoldTap: (id: string) => void
}) {
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
      onWheel={(e) => {
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0012))
      }}
      onPointerDown={(e) => {
        if ((e.target as Element).closest('button') || e.button !== 0) return
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (pointers.current.size === 1) {
          // Overlapping hit circles must select the closest hold, not SVG paint order.
          const rect = e.currentTarget.getBoundingClientRect()
          const wx = (e.clientX - rect.left - view.x) / view.scale
          const wy = (e.clientY - rect.top - view.y) / view.scale
          const nearest = mode === 'set' ? holds
            .map((hold) => ({ hold, distance: Math.hypot(hold.x * WALL_WIDTH - wx, hold.y * WALL_HEIGHT - wy) }))
            .filter(({ hold, distance }) => distance <= Math.max(20, Math.max(10, hold.radius * WALL_WIDTH) * 1.45))
            .sort((a, b) => a.distance - b.distance)[0]?.hold : undefined
          tap.current = { id: e.pointerId, x: e.clientX, y: e.clientY,
            holdId: nearest?.id,
            moved: false }
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
            return { scale,
              x: newMid.x - rect.left - (oldMid.x - rect.left - v.x) * scale / v.scale,
              y: newMid.y - rect.top - (oldMid.y - rect.top - v.y) * scale / v.scale }
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
          {holds.map((hold) => {
            const role = shownMap.get(hold.id)
            const baseRadius = Math.max(10, hold.radius * WALL_WIDTH)
            const hitRadius = Math.max(20, baseRadius * 1.45)
            const cx = hold.x * WALL_WIDTH
            const cy = hold.y * WALL_HEIGHT
            return (
              <g key={hold.id}>
                {role && (
                  <circle
                    className={`selected-ring ${roleClass(role)}`}
                    cx={cx}
                    cy={cy}
                    r={Math.max(14, baseRadius * 1.15)}
                  />
                )}
                {mode === 'set' && (
                  <circle
                    className="hold-hit"
                    cx={cx}
                    cy={cy}
                    r={hitRadius}
                    data-hold-id={hold.id}
                  />
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <button className="fit-button" onPointerUp={(e) => { e.stopPropagation(); fit() }} onClick={fit}>Fit wall</button>
      {mode === 'set' && <div className="tap-hint">Tap holds · drag to pan · pinch to zoom</div>}
    </div>
  )
}

function App() {
  const [mode, setMode] = useState<'browse' | 'set'>('browse')
  const [problems, setProblems] = useState<Problem[]>(loadProblems)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ProblemHold[]>([])
  const [currentRole, setCurrentRole] = useState<HoldRole>('hand')
  const [name, setName] = useState('')
  const [grade, setGrade] = useState('V4')
  const [setter, setSetter] = useState('Lu')

  const activeProblem = problems.find((p) => p.id === activeId) ?? null

  const [storageError, setStorageError] = useState('')

  const startSetting = () => {
    setDraft([])
    setStorageError('')
    setCurrentRole('hand')
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

      <section className="wall-card">
        <WallViewer mode={mode} draft={draft} activeProblem={activeProblem} onHoldTap={tapHold} />
      </section>

      {mode === 'set' ? (
        <section className="editor-sheet">
          <div className="role-row">
            {(['start', 'hand', 'finish'] as HoldRole[]).map((role) => (
              <button
                key={role}
                className={`role-button ${roleClass(role)} ${currentRole === role ? 'active' : ''}`}
                onClick={() => setCurrentRole(role)}
              >
                {roleLabel(role)}
              </button>
            ))}
            <span className="selection-count">{draft.length} selected</span>
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
