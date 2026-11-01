import { useEffect, useMemo, useRef, useState } from 'react'
import holds0 from './data/holds-0.json'
import holds1 from './data/holds-1.json'
import holds2 from './data/holds-2.json'
import holds3 from './data/holds-3.json'
import holds4 from './data/holds-4.json'
import wallImage from './data/wall'
import type { Hold, HoldRole, Problem, ProblemHold } from './types'

const holds = [...holds0, ...holds1, ...holds2, ...holds3, ...holds4] as Hold[]
const STORAGE_KEY = 'stoneham-spraywall:problems:v1'
const WALL_WIDTH = 1536
const WALL_HEIGHT = 1152
const grades = ['VB', 'V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10+']

function loadProblems(): Problem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
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
  const drag = useRef({ active: false, moved: false, x: 0, y: 0, originX: 0, originY: 0 })
  const lastDistance = useRef<number | null>(null)

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
    const handler = () => fit()
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
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

  return (
    <div
      className="wall-viewport"
      ref={viewportRef}
      onWheel={(e) => {
        e.preventDefault()
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0012))
      }}
      onPointerDown={(e) => {
        if ((e.target as Element).closest('.hold-hit')) return
        drag.current = { active: true, moved: false, x: e.clientX, y: e.clientY, originX: view.x, originY: view.y }
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!drag.current.active) return
        const dx = e.clientX - drag.current.x
        const dy = e.clientY - drag.current.y
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true
        setView((v) => ({ ...v, x: drag.current.originX + dx, y: drag.current.originY + dy }))
      }}
      onPointerUp={() => {
        drag.current.active = false
      }}
      onTouchMove={(e) => {
        if (e.touches.length !== 2) {
          lastDistance.current = null
          return
        }
        const [a, b] = [e.touches[0], e.touches[1]]
        const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
        const midpointX = (a.clientX + b.clientX) / 2
        const midpointY = (a.clientY + b.clientY) / 2
        if (lastDistance.current) zoomAt(midpointX, midpointY, distance / lastDistance.current)
        lastDistance.current = distance
      }}
      onTouchEnd={() => { lastDistance.current = null }}
    >
      <div
        className="wall-stage"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
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
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      onHoldTap(hold.id)
                    }}
                  />
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <button className="fit-button" onClick={fit}>Fit wall</button>
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

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(problems))
  }, [problems])

  const startSetting = () => {
    setDraft([])
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
      id: crypto.randomUUID(),
      name: trimmed,
      grade,
      setter: setter.trim() || 'Anonymous',
      holds: draft,
      createdAt: new Date().toISOString(),
    }
    setProblems((prev) => [problem, ...prev])
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
