import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Point, PolygonHoldCandidate } from './types'
import './annotator.css'

const WIDTH = 7292
const HEIGHT = 5514
const CROP_WIDTH = 2431
const CROP_HEIGHT = 1838
const BASE = import.meta.env.BASE_URL
const API = `${BASE}api/sam2`
type Prompt = { point: Point; label: 0 | 1 }
type Box = [number, number, number, number]
type Candidate = Omit<PolygonHoldCandidate, 'id'> & { score: number }
type Status = { state: 'loading' | 'ready' | 'error'; device: string; error?: string }
type Saved = { holds: PolygonHoldCandidate[] }
type Tool = 'positive' | 'negative' | 'box' | 'pan'

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}/${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('SAM2 service unavailable. Open this page using the Python annotation server.')
  }
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`)
  return result as T
}

function points(polygon: Point[]) {
  return polygon.map(([x, y]) => `${x * WIDTH},${y * HEIGHT}`).join(' ')
}

export default function Annotator() {
  const [status, setStatus] = useState<Status>({ state: 'loading', device: 'checking' })
  const [error, setError] = useState('')
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [box, setBox] = useState<Box | null>(null)
  const [boxStart, setBoxStart] = useState<Point | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [candidateIndex, setCandidateIndex] = useState(0)
  const [saved, setSaved] = useState<Saved>({ holds: [] })
  const [savedLoaded, setSavedLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [tool, setTool] = useState<Tool>('positive')
  const [busy, setBusy] = useState(false)
  const [timing, setTiming] = useState<number | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ scale: .15, x: 0, y: 0 })
  const activePointers = useRef(new Map<number, Point>())
  const gesture = useRef<{ id: number; client: Point; point: Point; moved: boolean; multiple: boolean } | null>(null)
  const preview = candidates[candidateIndex]

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const next = await request<Status>('status')
        if (!alive) return
        setStatus(next)
        if (next.state === 'loading') timer = setTimeout(poll, 1500)
      } catch (problem) {
        if (alive) setStatus({ state: 'error', device: 'unavailable', error: String(problem) })
      }
    }
    void poll()
    void request<Saved>('annotations').then((data) => {
      if (alive) { setSaved(data); setSavedLoaded(true) }
    }).catch((problem) => { if (alive) setError(`Could not load saved holds: ${String(problem)}`) })
    return () => { alive = false; clearTimeout(timer) }
  }, [])

  const fit = () => {
    const element = viewport.current
    if (!element) return
    const scale = Math.min(element.clientWidth / CROP_WIDTH, element.clientHeight / CROP_HEIGHT)
    setView({ scale, x: (element.clientWidth - CROP_WIDTH * scale) / 2, y: (element.clientHeight - CROP_HEIGHT * scale) / 2 })
  }
  useEffect(() => {
    const observer = new ResizeObserver(fit)
    if (viewport.current) observer.observe(viewport.current)
    return () => observer.disconnect()
  }, [])

  const zoom = (factor: number) => {
    const element = viewport.current
    if (!element) return
    const x = element.clientWidth / 2, y = element.clientHeight / 2
    setView((previous) => {
      const scale = Math.min(2, Math.max(.08, previous.scale * factor))
      return { scale, x: x - (x - previous.x) * scale / previous.scale, y: y - (y - previous.y) * scale / previous.scale }
    })
  }
  const wallPoint = (event: ReactPointerEvent<HTMLDivElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return [Math.max(0, Math.min(CROP_WIDTH - 1, (event.clientX - rect.left - view.x) / view.scale)) / WIDTH,
      Math.max(0, Math.min(CROP_HEIGHT - 1, (event.clientY - rect.top - view.y) / view.scale)) / HEIGHT]
  }
  const invalidate = () => { setCandidates([]); setTiming(null) }
  const addBox = (a: Point, b: Point) => {
    if (Math.abs(a[0] - b[0]) * WIDTH < 5 || Math.abs(a[1] - b[1]) * HEIGHT < 5) return false
    setBox([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])])
    invalidate()
    return true
  }
  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    activePointers.current.delete(event.pointerId)
    const started = gesture.current
    if (!started || started.id !== event.pointerId) return
    gesture.current = null
    if (cancelled || started.multiple || busy) return
    const end = wallPoint(event)
    if (tool === 'box') {
      if (started.moved && addBox(started.point, end)) setBoxStart(null)
      else if (boxStart) { addBox(boxStart, end); setBoxStart(null) }
      else setBoxStart(end)
    } else if (!started.moved && tool !== 'pan') {
      if (prompts.length >= 64) { setError('Maximum 64 prompts per hold. Undo or start a new hold.'); return }
      setPrompts((previous) => [...previous, { point: end, label: tool === 'positive' ? 1 : 0 }])
      invalidate()
    }
  }
  const clear = () => { setPrompts([]); setBox(null); setBoxStart(null); invalidate(); setError('') }
  const predict = async () => {
    setBusy(true); setError('')
    try {
      const result = await request<{ candidates: Candidate[]; elapsed_seconds: number }>('predict', { points: prompts, box })
      setCandidates(result.candidates); setCandidateIndex(0); setTiming(result.elapsed_seconds)
      if (!result.candidates.length) setError('No usable outline. Add a positive point or tighten the box and try again.')
    } catch (problem) { setError(String(problem)) }
    finally { setBusy(false) }
  }
  const accept = async () => {
    if (!preview) return
    setBusy(true); setError('')
    try {
      const data = await request<Saved>('accept', { hold: preview })
      setSaved(data); clear()
    } catch (problem) { setError(`Not saved: ${String(problem)}`) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!selectedId) return
    setBusy(true); setError('')
    try {
      setSaved(await request<Saved>('delete', { id: selectedId })); setSelectedId('')
    } catch (problem) { setError(String(problem)) }
    finally { setBusy(false) }
  }
  const canPredict = status.state === 'ready' && !busy && (box !== null || prompts.some((prompt) => prompt.label === 1))

  return (
    <main className="annotation-shell">
      <header className="annotation-header">
        <div><div className="eyebrow">STONEHAM · LEFT TOP ⅓</div><h1>Hold annotator</h1></div>
        <a href={BASE}>Back to wall</a>
      </header>
      <p className="annotation-status" role="status">{status.state === 'ready' ? `SAM2.1 Small ready · ${status.device.toUpperCase()}` : status.state === 'loading' ? 'Loading SAM2 and encoding crop…' : status.error}</p>
      <fieldset disabled={busy} className="annotation-tools">
        <legend>Prompt tool</legend>
        {(['positive', 'negative', 'box', 'pan'] as Tool[]).map((value) => <button key={value} type="button" aria-pressed={tool === value}
          onClick={() => { setTool(value); setBoxStart(null) }}>{({ positive: '＋ Hold', negative: '− Exclude', box: 'Box', pan: 'Pan' })[value]}</button>)}
      </fieldset>
      <div className="annotation-zoom"><button onClick={() => zoom(1.5)}>Zoom in</button><button onClick={() => zoom(1 / 1.5)}>Zoom out</button><button onClick={fit}>Fit crop</button></div>
      <div className="annotation-viewport" ref={viewport} aria-label="Annotation crop"
        onPointerDown={(event) => {
          if (event.button !== 0 || busy) return
          activePointers.current.set(event.pointerId, [event.clientX, event.clientY])
          if (activePointers.current.size === 1) gesture.current = { id: event.pointerId, client: [event.clientX, event.clientY], point: wallPoint(event), moved: false, multiple: false }
          else if (gesture.current) { gesture.current.multiple = true; setBoxStart(null) }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const previous = activePointers.current.get(event.pointerId)
          if (!previous) return
          const before = [...activePointers.current.values()]
          activePointers.current.set(event.pointerId, [event.clientX, event.clientY])
          const after = [...activePointers.current.values()]
          const started = gesture.current
          if (started && Math.hypot(event.clientX - started.client[0], event.clientY - started.client[1]) > 6) started.moved = true
          if (before.length >= 2) {
            const oldMid: Point = [(before[0][0] + before[1][0]) / 2, (before[0][1] + before[1][1]) / 2]
            const newMid: Point = [(after[0][0] + after[1][0]) / 2, (after[0][1] + after[1][1]) / 2]
            const distance = (list: Point[]) => Math.hypot(list[0][0] - list[1][0], list[0][1] - list[1][1])
            const rect = event.currentTarget.getBoundingClientRect()
            setView((v) => { const scale = Math.max(.08, Math.min(2, v.scale * distance(after) / Math.max(1, distance(before))))
              return { scale, x: newMid[0] - rect.left - (oldMid[0] - rect.left - v.x) * scale / v.scale,
                y: newMid[1] - rect.top - (oldMid[1] - rect.top - v.y) * scale / v.scale } })
          } else if (tool === 'pan') setView((v) => ({ ...v, x: v.x + event.clientX - previous[0], y: v.y + event.clientY - previous[1] }))
          else if (tool === 'box' && started && !started.multiple && started.moved) addBox(started.point, wallPoint(event))
        }}
        onPointerUp={(event) => finishPointer(event)} onPointerCancel={(event) => finishPointer(event, true)}
        onLostPointerCapture={(event) => { activePointers.current.delete(event.pointerId); if (gesture.current?.id === event.pointerId) gesture.current = null }}>
        <svg className="annotation-stage" width={CROP_WIDTH} height={CROP_HEIGHT} viewBox={`0 0 ${CROP_WIDTH} ${CROP_HEIGHT}`}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          {status.state === 'ready' && <image href={`${API}/crop.jpg`} width={CROP_WIDTH} height={CROP_HEIGHT} />}
          {saved.holds.map((hold) => <polygon key={hold.id} className="annotation-saved" points={points(hold.polygon)} />)}
          {preview && <polygon className="annotation-preview" points={points(preview.polygon)} />}
          {box && <rect className="annotation-box" x={box[0] * WIDTH} y={box[1] * HEIGHT} width={(box[2] - box[0]) * WIDTH} height={(box[3] - box[1]) * HEIGHT} />}
          {prompts.map((prompt, index) => <g key={index} className={prompt.label ? 'annotation-positive' : 'annotation-negative'}>
            <circle cx={prompt.point[0] * WIDTH} cy={prompt.point[1] * HEIGHT} r={7 / view.scale} />
            <text x={prompt.point[0] * WIDTH} y={prompt.point[1] * HEIGHT} fontSize={12 / view.scale} dy=".35em" textAnchor="middle">{prompt.label ? '+' : '−'}</text>
          </g>)}
          {boxStart && <circle className="annotation-box-start" cx={boxStart[0] * WIDTH} cy={boxStart[1] * HEIGHT} r={7 / view.scale} />}
        </svg>
      </div>
      <p className="annotation-hint">{tool === 'box' ? 'Drag a box, or tap its two opposite corners.' : tool === 'pan' ? 'Drag to move the crop.' : tool === 'positive' ? 'Tap inside the hold. Add more points to refine it.' : 'Tap unwanted areas to exclude them.'} Pinch to zoom.</p>
      <div className="annotation-actions">
        <button disabled={busy || (!prompts.length && !box && !boxStart)} onClick={() => { if (boxStart) setBoxStart(null); else if (prompts.length) setPrompts((p) => p.slice(0, -1)); else setBox(null); invalidate() }}>Undo prompt</button>
        <button disabled={busy} onClick={clear}>New hold / Clear</button>
        <button className="primary" disabled={!canPredict} onClick={() => void predict()}>{busy ? 'Working…' : 'Generate mask'}</button>
      </div>
      <p className="annotation-hint">{prompts.filter((p) => p.label === 1).length} positive · {prompts.filter((p) => p.label === 0).length} negative · {box ? 'box set' : 'no box'}{timing !== null && ` · ${timing.toFixed(2)}s`}</p>
      {candidates.length > 0 && <div className="annotation-actions"><label>Outline candidate<select value={candidateIndex} disabled={busy} onChange={(event) => setCandidateIndex(Number(event.target.value))}>
        {candidates.map((candidate, index) => <option key={index} value={index}>Option {index + 1} · score {candidate.score.toFixed(2)}</option>)}
      </select></label><button className="primary" disabled={busy || !savedLoaded} onClick={() => void accept()}>Accept hold</button></div>}
      {error && <p className="annotation-error" role="alert">{error}</p>}
      <section className="annotation-library">
        <h2>Accepted holds ({saved.holds.length})</h2>
        <p>Saved on this running server. Export a copy to your phone.</p>
        <div className="annotation-actions"><label>Saved hold<select aria-label="Saved hold" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Choose a hold</option>
          {saved.holds.map((hold, index) => <option key={hold.id} value={hold.id}>{index + 1}. {hold.id}</option>)}</select></label>
          <button disabled={busy || !selectedId} onClick={() => void remove()}>Delete selected</button>
          {savedLoaded && <a className="annotation-download" href={`${API}/annotations`} download="stoneham-manual-holds.json">Export JSON</a>}
        </div>
      </section>
    </main>
  )
}
