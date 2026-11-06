import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Point, PolygonHoldCandidate } from './types'
import './annotator.css'
import { annotationWallColors } from './annotationWallColors'
import { bulkProposalActions } from './wallProposals'
import { confirmed, stable } from './wallReview'
import type { ReviewController } from './AnnotationWorkspace'
import { sam2Request, Sam2RequestError } from './sam2Api'

const WIDTH = 7292
const HEIGHT = 5514
const CROP_WIDTH = WIDTH
const CROP_HEIGHT = HEIGHT
const BASE = import.meta.env.BASE_URL
const API = `${BASE}api/sam2`
type Prompt = { point: Point; label: 0 | 1 }
type Box = [number, number, number, number]
type Candidate = Omit<PolygonHoldCandidate, 'id'> & { score?: number }
type Status = { state: 'loading' | 'ready' | 'error'; device: string; error?: string; sessionId?: string; image_sha256?: string }
type Saved = { holds: PolygonHoldCandidate[]; dismissed_suggestions?: string[] }
type Tool = 'positive' | 'negative' | 'box' | 'pan' | 'select' | 'polygon' | 'vertex'

async function request<T>(path: string, body?: unknown): Promise<T> {
  return sam2Request<T>(`${API}/${path}`,body)
}

function points(polygon: Point[]) {
  return polygon.map(([x, y]) => `${x * WIDTH},${y * HEIGHT}`).join(' ')
}

function inside([x, y]: Point, polygon: Point[]) {
  let result = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) result = !result
  }
  return result
}

export default function Annotator({ review }: { review?: ReviewController }) {
  const [status, setStatus] = useState<Status>({ state: 'loading', device: 'checking' })
  const [serviceAttempt,setServiceAttempt]=useState(0)
  const connectionError=useRef('')
  const [error, setError] = useState('')
  const reviewerInput=useRef<HTMLInputElement>(null)
  const requireReviewer=()=>{
    if(!review || review.reviewer.trim())return true
    setError('Enter your reviewer name to confirm holds.');reviewerInput.current?.focus();return false
  }
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [box, setBox] = useState<Box | null>(null)
  const [boxStart, setBoxStart] = useState<Point | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [candidateIndex, setCandidateIndex] = useState(0)
  const [legacySaved, setSaved] = useState<Saved>({ holds: [] })
  const [savedLoaded, setSavedLoaded] = useState(false)
  const [coverConfirmed, setCoverConfirmed] = useState(false)
  const [coverLoading, setCoverLoading] = useState(false)
  const [wallColors, setWallColors] = useState<Record<string, string>>({})
  const wallPixels = useRef<Promise<ImageData> | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [editingOriginal, setEditingOriginal] = useState<PolygonHoldCandidate | null>(null)
  const [suggestions, setSuggestions] = useState<(PolygonHoldCandidate & { score?: number })[]>([])
  const [showSuggestions, setShowSuggestions] = useState(true)
  const [suggestionId, setSuggestionId] = useState('')
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [tool, setTool] = useState<Tool>('positive')
  const [busy, setBusy] = useState(false)
  const [autoPredict,setAutoPredict]=useState(()=>!review?.assets.proposals)
  const [autoHold,setAutoHold]=useState<PolygonHoldCandidate|null>(null)
  const [threshold,setThreshold]=useState(.95)
  const [batchNotice,setBatchNotice]=useState('')
  const predictionId=useRef(0)
  useEffect(()=>()=>{predictionId.current++},[])
  const [timing, setTiming] = useState<number | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ scale: .15, x: 0, y: 0 })
  const activePointers = useRef(new Map<number, Point>())
  const gesture = useRef<{ id: number; client: Point; point: Point; moved: boolean; multiple: boolean } | null>(null)
  const [comparison, setComparison] = useState<'new' | 'old' | 'overlay'>('new')
  const [opacity, setOpacity] = useState(.5)
  const [showQA, setShowQA] = useState(false)
  const [showRemoved, setShowRemoved] = useState(true)
  const [manualPoints, setManualPoints] = useState<Point[]>([])
  const movingVertex = useRef<number | null>(null)
  const saved: Saved = review ? { holds: review.data.entries.map(entry => entry.hold) } : legacySaved
  const selectedEntry = review?.data.entries.find(entry => entry.hold.id === selectedId)
  const imageUrl = review?.assets.image ?? `${API}/image.jpg`
  const imageReady = !!review || status.state === 'ready'
  const visibleEntries = review?.data.entries.filter(entry => showRemoved || !['removed', 'dismissed'].includes(entry.status))
  const coverHolds = review ? review.data.entries.filter(confirmed).map(entry => entry.hold) : saved.holds
  const modelByOld = useMemo(() => {
    const map = new Map<string, NonNullable<ReviewController['assets']['proposals']>['proposals']>()
    for (const proposal of review?.assets.proposals?.proposals ?? []) for (const id of proposal.oldHoldIds) map.set(id, [...(map.get(id) ?? []), proposal])
    return map
  }, [review?.assets.proposals])
  const selectedProposals = modelByOld.get(selectedId) ?? []
  const pendingModel = useMemo(() => {
    const pendingIds = new Set(review?.data.entries.filter(e => e.status === 'inherited-unreviewed').map(e => e.hold.id))
    return review?.assets.proposals?.proposals.filter(p => p.oldHoldIds.some(id => pendingIds.has(id))) ?? []
  }, [review?.data, review?.assets.proposals])
  const preview = candidates[candidateIndex]
  const pendingSuggestions = suggestions.filter((hold) => !saved.dismissed_suggestions?.includes(hold.id) &&
    !saved.holds.some((accepted) => accepted.id === hold.id || (inside(hold.center, accepted.polygon) && inside(accepted.center, hold.polygon))))
  const highScoreSuggestions = pendingSuggestions.filter((hold) => (hold.score ?? 0) >= .95)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const next = await request<Status>('status')
        if (!alive) return
        setStatus(next)
        if(next.state==='ready'){
          const previousConnectionError=connectionError.current
          setError(previous=>previous===previousConnectionError?'':previous)
          connectionError.current=''
        }
        if (next.state === 'loading') timer = setTimeout(poll, 1500)
      } catch (problem) {
        if (alive) {
          const message=problem instanceof Error?problem.message:String(problem)
          connectionError.current=message
          setStatus({ state: 'error', device: 'unavailable', error: message })
        }
      }
    }
    void poll()
    if (review) return () => { alive = false; clearTimeout(timer) }
    void request<{ holds: (PolygonHoldCandidate & { score?: number })[] }>('suggestions').then((data) => {
      if (alive) setSuggestions(data.holds)
    }).catch((problem) => { if (alive) setError(`Could not load suggestions: ${String(problem)}`) })
    void request<Saved>('annotations').then((data) => {
      if (alive) { setSaved(data); setSavedLoaded(true) }
    }).catch((problem) => { if (alive) setError(`Could not load saved holds: ${String(problem)}`) })
    return () => { alive = false; clearTimeout(timer) }
  }, [review?.assets,serviceAttempt])

  useEffect(() => {
    if (!coverConfirmed || !imageReady) return
    let cancelled = false
    setCoverLoading(true)
    if (!wallPixels.current) wallPixels.current = (async () => {
      const image = new Image()
      image.src = imageUrl
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = 1024; canvas.height = Math.round(1024 * HEIGHT / WIDTH)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('Canvas is unavailable')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      return context.getImageData(0, 0, canvas.width, canvas.height)
    })()
    void wallPixels.current.then((pixels) => {
      if (!cancelled) setWallColors(annotationWallColors(coverHolds, pixels))
    }).catch((problem) => {
      wallPixels.current = null
      if (!cancelled) setError(`Could not estimate wall colors: ${String(problem)}`)
    }).finally(() => { if (!cancelled) setCoverLoading(false) })
    return () => { cancelled = true }
  }, [coverConfirmed, review?.data, legacySaved.holds, imageReady, imageUrl])

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
    if (cancelled || started.multiple || busy || !canEdit) return
    const end = wallPoint(event)
    movingVertex.current = null
    if (tool === 'vertex') return
    if (tool === 'polygon' && !started.moved) {
      if (manualPoints.length >= 16) { setError('Use at most 16 vertices. Undo a vertex first.'); return }
      setManualPoints(previous => [...previous, end]); return
    }
    if (tool === 'box') {
      if (started.moved && addBox(started.point, end)) setBoxStart(null)
      else if (boxStart) { addBox(boxStart, end); setBoxStart(null) }
      else setBoxStart(end)
    } else if (!started.moved && tool === 'select') {
      const accepted = (review ? visibleEntries!.map(entry => entry.hold) : saved.holds).filter((hold) => inside(end, hold.polygon))
      const automatic = showSuggestions ? (review ? pendingModel : pendingSuggestions).filter((hold) => inside(end, hold.polygon)) : []
      const nearest = <T extends { center: Point }>(list: T[]) => list.sort((a, b) => Math.hypot(a.center[0] - end[0], a.center[1] - end[1]) - Math.hypot(b.center[0] - end[0], b.center[1] - end[1]))[0]
      if (accepted.length) editHold(nearest(accepted))
      else if (automatic.length) {
        const chosen = nearest(automatic)
        if (review && 'oldHoldIds' in chosen) {
          const old = review.data.entries.find(e => (chosen.oldHoldIds as string[]).includes(e.hold.id) && e.status === 'inherited-unreviewed')
          if (old) { editHold(old.hold); setCandidates([chosen]); setTool('vertex') }
        } else reviewSuggestion(chosen)
      }
    } else if (!started.moved && tool !== 'pan') {
      if (prompts.length >= 64) { setError('Maximum 64 prompts per hold. Undo or start a new hold.'); return }
      setPrompts((previous) => [...previous, { point: end, label: tool === 'positive' ? 1 : 0 }])
      invalidate()
    }
  }
  const clear = () => { predictionId.current++; setAutoHold(null); setBusy(false); setPrompts([]); setBox(null); setBoxStart(null); invalidate(); setError(''); setEditingOriginal(null); setSelectedId(''); setSuggestionId(''); setManualPoints([]) }
  const predict = async (input?:{points:Prompt[];box:Box|null}) => {
    const id=++predictionId.current
    setBusy(true); setError('')
    try {
      const result = await request<{ candidates: Candidate[]; elapsed_seconds: number }>('predict', { points: input?.points ?? prompts, box: input ? input.box : box, ...(review ? { sessionId: review.data.session.sessionId, image_sha256: review.data.session.registeredImageSha256 } : {}) })
      if(id!==predictionId.current)return
      setCandidates(result.candidates); setCandidateIndex(0); setTiming(result.elapsed_seconds)
      if (!result.candidates.length) setError('No usable outline. Add a positive point or tighten the box and try again.')
    } catch (problem) {
      if(id===predictionId.current){
        const message=problem instanceof Error?problem.message:String(problem)
        setError(message)
        if(problem instanceof Sam2RequestError && (problem.status===0 || problem.status===410 || problem.code.startsWith('SANDBOX_'))){connectionError.current=message;setStatus({state:'error',device:'unavailable',error:message})}
      }
    }
    finally { if(id===predictionId.current)setBusy(false) }
  }
  const accept = async () => {
    if (!preview || !requireReviewer()) return
    setBusy(true); setError('')
    try {
      if (review) {
        const hold = { ...preview, id: editingOriginal?.id ?? `scan-${crypto.randomUUID()}` }
        await review.commit(editingOriginal ? { type: 'refine', id: editingOriginal.id, hold } : { type: 'add', hold })
        clear(); return
      }
      const data = await request<Saved>('accept', { hold: preview, id: editingOriginal?.id, original: editingOriginal })
      setSaved(data); clear()
    } catch (problem) { setError(`Not saved: ${String(problem)}`) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!selectedId || !requireReviewer()) return
    setBusy(true); setError('')
    try {
      if (review) { await review.commit({ type: 'remove', id: selectedId }); setSelectedId(''); clear(); return }
      setSaved(await request<Saved>('delete', { id: selectedId })); setSelectedId(''); clear()
    } catch (problem) { setError(String(problem)) }
    finally { setBusy(false) }
  }
  const focusHold = (hold: { polygon: Point[] }) => {
    const element = viewport.current
    if (!element) return
    const xs = hold.polygon.map(([x]) => x * WIDTH), ys = hold.polygon.map(([, y]) => y * HEIGHT)
    const left = Math.max(0, Math.min(...xs) - 100), top = Math.max(0, Math.min(...ys) - 100)
    const right = Math.min(WIDTH, Math.max(...xs) + 100), bottom = Math.min(HEIGHT, Math.max(...ys) + 100)
    const scale = Math.min(2, element.clientWidth / (right - left), element.clientHeight / (bottom - top))
    setView({ scale, x: (element.clientWidth - (right + left) * scale) / 2, y: (element.clientHeight - (bottom + top) * scale) / 2 })
    if (review) element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const prepareOutline = (hold: PolygonHoldCandidate) => {
    predictionId.current++;setAutoHold(null)
    setPrompts([]); setBoxStart(null); setError(''); setTiming(null)
    const xs = hold.polygon.map(([x]) => x), ys = hold.polygon.map(([, y]) => y)
    setBox([Math.max(0, Math.min(...xs) - .003), Math.max(0, Math.min(...ys) - .003), Math.min(1, Math.max(...xs) + .003), Math.min(1, Math.max(...ys) + .003)])
    setCandidates([hold]); setCandidateIndex(0); focusHold(hold); setTool('positive')
  }
  const editHold = (hold: PolygonHoldCandidate) => {
    setManualPoints([]); setEditingOriginal(hold); setSuggestionId(''); setSelectedId(hold.id); prepareOutline(hold); if (review) setTool('vertex')
  }
  const reviewSuggestion = (hold: PolygonHoldCandidate) => {
    setEditingOriginal(null); setSuggestionId(hold.id); setSelectedId(''); prepareOutline(hold)
  }
  const skipSuggestion = async () => {
    setBusy(true)
    try { setSaved(await request<Saved>('dismiss', { id: suggestionId })); clear() }
    catch (problem) { setError(String(problem)) }
    finally { setBusy(false) }
  }
  const importData = async (data: unknown) => {
    setBusy(true); setError('')
    try { setSaved(await request<Saved>('import', { dataset: data, replace_existing: replaceExisting })); clear() }
    catch (problem) { setError(String(problem)) }
    finally { setBusy(false) }
  }
  const upload = async (file?: File) => {
    if (!file) return
    if (file.size > 4 * 1024 * 1024) { setError('Import is limited to 4 MiB.'); return }
    try { await importData(JSON.parse(await file.text())) }
    catch (problem) { setError(`Invalid JSON file: ${String(problem)}`) }
  }
  const serviceMatches = !review || (status.sessionId === review.data.session.sessionId && status.image_sha256 === review.data.session.registeredImageSha256)
  const canEdit = !review || comparison === 'new'
  const canPredict = canEdit && serviceMatches && status.state === 'ready' && !busy && (box !== null || prompts.some((prompt) => prompt.label === 1))

  useEffect(()=> {
    if(!autoPredict){setAutoHold(null);return}
    if(!autoHold || !serviceMatches || status.state!=='ready' || !canEdit)return
    const xs=autoHold.polygon.map(p=>p[0]),ys=autoHold.polygon.map(p=>p[1])
    const bounds:Box=[Math.max(0,Math.min(...xs)-.003),Math.max(0,Math.min(...ys)-.003),Math.min(1,Math.max(...xs)+.003),Math.min(1,Math.max(...ys)+.003)]
    setAutoHold(null)
    void predict({points:[],box:bounds})
  },[autoHold,autoPredict,serviceMatches,status.state,canEdit])

  const reviewDecision = async (type: 'confirm' | 'reset') => {
    if (!review || !selectedId) return
    setBusy(true); setError('')
    try { await review.commit({ type, id: selectedId }); clear() } catch (problem) { setError(String(problem)) } finally { setBusy(false) }
  }
  const replacement = async () => {
    if (!review || !preview || !editingOriginal || !requireReviewer()) return
    setBusy(true); setError('')
    try { await review.commit({ type: 'add', replaces: editingOriginal.id, hold: { ...preview, id: `scan-${crypto.randomUUID()}` } }); clear() }
    catch (problem) { setError(String(problem)) } finally { setBusy(false) }
  }
  const finishPolygon = () => {
    if (manualPoints.length < 3) return
    const center: Point = [manualPoints.reduce((sum,p)=>sum+p[0],0)/manualPoints.length, manualPoints.reduce((sum,p)=>sum+p[1],0)/manualPoints.length]
    setCandidates([{ kind: 'hold', center, polygon: manualPoints }]); setCandidateIndex(0); setManualPoints([]); setTool('vertex')
  }
  const pending = review?.data.entries.filter(entry => entry.status === 'inherited-unreviewed') ?? []
  const nextPending = () => {
    const covered = pending.filter(entry => entry.observed && entry.coverageFraction >= .99)
    const queue = covered.length ? covered : pending
    if (!queue.length) return
    const index = queue.findIndex(entry => entry.hold.id === selectedId)
    const entry=queue[(index + 1) % queue.length]
    setComparison('new');editHold(entry.hold)
    const suggestions=modelByOld.get(entry.hold.id)??[]
    if(review?.assets.proposals){setCandidates(suggestions);setCandidateIndex(0)}
    if(autoPredict && entry.coverageFraction>=.99)setAutoHold(entry.hold)
  }
  const bulkActions=useMemo(()=>review?.assets.proposals && Number.isFinite(threshold) && threshold>=0 && threshold<=1 ? bulkProposalActions(review.data,review.assets.proposals,threshold) : [],[review?.data,review?.assets.proposals,threshold])
  const confirmBatch=async()=>{
    if(!review || !bulkActions.length || !requireReviewer())return
    setBusy(true);setError('');setBatchNotice('')
    try{await review.commitMany(bulkActions);clear();setBatchNotice(`${bulkActions.length} SAM2 outlines confirmed. Other entries remain pending.`)}
    catch(problem){setError(`Batch not saved: ${String(problem)}`)}finally{setBusy(false)}
  }
  const canChangeSelected=Boolean(!busy && canEdit && selectedEntry && !['removed','dismissed'].includes(selectedEntry.status) && selectedEntry.coverageFraction>=.99)
  const canReplace=Boolean(canChangeSelected && preview && editingOriginal && selectedEntry?.oldHoldId===selectedEntry?.hold.id)
  return (
    <main className={`annotation-shell ${review?.assets.proposals ? 'has-model-proposals' : ''}`}>
      <header className="annotation-header">
        <div><div className="eyebrow">STONEHAM · FULL WALL</div><h1>{review ? 'Review & annotate' : 'Hold annotator'}</h1></div>
        <a href={BASE}>Back to wall</a>
      </header>
      <p className="annotation-status" role="status">{review && (!serviceMatches || status.state === 'error') ? `Manual editing ready · ${status.error || 'SAM2 needs a matching scan server.'}` : status.state === 'ready' ? `SAM2.1 Small ready · ${status.device.toUpperCase()}` : status.state === 'loading' ? 'Loading SAM2 and preparing wall tiles…' : status.error}</p>
      <button className="small" disabled={busy} onClick={()=>setServiceAttempt(n=>n+1)}>Check SAM2 connection</button>
      {review && <section className="review-panel" aria-label="Scan review">
        <p className="review-badge">DRAFT · {review.data.session.candidateVersion} · revision {review.data.reviewRevision}</p>
        {Number(review.data.session.referenceFilledFraction)>0 && <p className="annotation-hint">{((1-Number(review.data.session.referenceFilledFraction))*100).toFixed(2)}% new photos · {(Number(review.data.session.referenceFilledFraction)*100).toFixed(2)}% v1 edge fill. Filled areas are display-only and remain unobserved.</p>}
        <label>Reviewer name<input ref={reviewerInput} aria-label="Reviewer name" value={review.reviewer} maxLength={100} placeholder="Enter your name to enable confirmation" onChange={event => {review.setReviewer(event.target.value);if(error==='Enter your reviewer name to confirm holds.')setError('')}} /></label>
        <details><summary>Session, reviewer & backups</summary>
        <p className="annotation-hint">{review.assets.inputKind} · QA: {review.assets.qaStatus}. Decisions are local working notes, not publication approval.</p>


        <div className="annotation-actions">

          <button onClick={review.exportProgress}>Export progress</button>
          <label className="review-file">Resume progress<input type="file" aria-label="Resume progress" accept=".json" disabled={busy} onChange={event => { void review.resume(event.target.files?.[0]).catch(problem => setError(String(problem))); event.target.value = '' }} /></label>
        </div>
        <p className="annotation-hint">Saved on this browser after every decision. Reopen the same scan to resume. Export a backup before clearing browser data.</p>
        </details>
        <div className="review-counts"><span>{pending.length} pending</span><span>{review.data.entries.filter(confirmed).length} confirmed</span><span>{review.data.entries.filter(e => e.status === 'removed').length} removed</span></div>
        <fieldset className="annotation-tools"><legend>Compare wall</legend>
          {(['new', 'old', 'overlay'] as const).map(value => <button key={value} disabled={busy} aria-pressed={comparison === value} onClick={() => setComparison(value)}>{ { new: 'New scan', old: 'Old wall', overlay: 'Overlay' }[value]}</button>)}
        </fieldset>
        {comparison === 'overlay' && <label>New scan opacity<input aria-label="New scan opacity" type="range" min="0" max="1" step=".05" value={opacity} onChange={event => setOpacity(Number(event.target.value))} /></label>}
        {comparison !== 'new' && <p className="annotation-hint">Comparison view · switch to New scan to edit or confirm.</p>}
        <details><summary>QA overlays & legend</summary>
        <label className="annotation-inline"><input type="checkbox" checked={showQA} onChange={event => setShowQA(event.target.checked)} />Show alignment / seam QA</label>
        <label className="annotation-inline"><input type="checkbox" checked={showRemoved} onChange={event => setShowRemoved(event.target.checked)} />Show removed / dismissed outlines</label>
        <p className="annotation-hint">Orange = pending · cyan = confirmed · red dashed = removed · green = new. QA seams are not hold-change detections.</p>
        <div className="review-links">{review.assets.sources && <a href={review.assets.sources} target="_blank" rel="noreferrer">Photo source map ↗</a>}{review.assets.qa && <a href={review.assets.qa} target="_blank" rel="noreferrer">Full QA preview ↗</a>}</div></details>
      </section>}
      <div className="annotation-zoom"><button onClick={fit}>Fit wall</button></div>
      <button className="annotation-coverage-toggle" type="button" aria-pressed={coverConfirmed}
        disabled={!imageReady || (!review && !savedLoaded)} onClick={() => setCoverConfirmed((value) => !value)}>
        {coverConfirmed ? 'Show original holds' : 'Cover confirmed holds'}
      </button>
      {coverConfirmed && <p className="annotation-hint">{coverLoading ? 'Estimating nearby wall colors…' : `${coverHolds.length} confirmed holds covered. Uncovered holds retain their original colors. Thin rims or shadows may be outline errors.`}</p>}
      <div className="annotation-viewport" ref={viewport} aria-label="Annotation wall"
        onPointerDown={(event) => {
          if (event.button !== 0 || busy) return
          if (!canEdit && tool !== 'pan') return
          if (tool === 'vertex' && preview) {
            const point = wallPoint(event)
            const distances = preview.polygon.map(p => Math.hypot((p[0]-point[0])*WIDTH, (p[1]-point[1])*HEIGHT)*view.scale)
            const nearest = distances.indexOf(Math.min(...distances))
            movingVertex.current = distances[nearest] < 24 ? nearest : null
          }
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
            movingVertex.current = null
            const oldMid: Point = [(before[0][0] + before[1][0]) / 2, (before[0][1] + before[1][1]) / 2]
            const newMid: Point = [(after[0][0] + after[1][0]) / 2, (after[0][1] + after[1][1]) / 2]
            const distance = (list: Point[]) => Math.hypot(list[0][0] - list[1][0], list[0][1] - list[1][1])
            const rect = event.currentTarget.getBoundingClientRect()
            setView((v) => { const scale = Math.max(.02, Math.min(2, v.scale * distance(after) / Math.max(1, distance(before))))
              return { scale, x: newMid[0] - rect.left - (oldMid[0] - rect.left - v.x) * scale / v.scale,
                y: newMid[1] - rect.top - (oldMid[1] - rect.top - v.y) * scale / v.scale } })
          } else if (tool === 'vertex' && movingVertex.current !== null && preview) {
            const point = wallPoint(event), index = movingVertex.current
            setCandidates(previous => previous.map((candidate,i) => i === candidateIndex ? { ...candidate, polygon: candidate.polygon.map((p,j) => j === index ? point : p) } : candidate))
          } else if (tool === 'pan') setView((v) => ({ ...v, x: v.x + event.clientX - previous[0], y: v.y + event.clientY - previous[1] }))
          else if (tool === 'box' && started && !started.multiple && started.moved) addBox(started.point, wallPoint(event))
        }}
        onPointerUp={(event) => finishPointer(event)} onPointerCancel={(event) => finishPointer(event, true)}
        onLostPointerCapture={(event) => { activePointers.current.delete(event.pointerId); if (gesture.current?.id === event.pointerId) gesture.current = null }}>
        <svg className="annotation-stage" width={CROP_WIDTH} height={CROP_HEIGHT} viewBox={`0 0 ${CROP_WIDTH} ${CROP_HEIGHT}`}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          {imageReady && <image href={review && comparison === 'old' ? review.assets.reference : imageUrl} width={CROP_WIDTH} height={CROP_HEIGHT} />}
          {review && comparison === 'overlay' && <><image href={review.assets.reference} width={WIDTH} height={HEIGHT} /><image href={imageUrl} width={WIDTH} height={HEIGHT} opacity={opacity} /></>}
          {review && showQA && <image href={review.assets.uncertainty} width={WIDTH} height={HEIGHT} /> }
          {!review && saved.holds.map((hold) => <polygon key={hold.id} className={`annotation-saved ${coverConfirmed ? 'annotation-covered' : ''} ${selectedId === hold.id ? 'annotation-selected' : ''}`} points={points(hold.polygon)} style={coverConfirmed ? { fill: wallColors[hold.id] ?? 'rgb(170, 168, 162)', stroke: 'none' } : undefined} />)}
          {review && visibleEntries!.map(entry => <polygon key={entry.hold.id} className={`annotation-saved review-${entry.status} ${selectedId === entry.hold.id ? 'annotation-selected' : ''} ${coverConfirmed && confirmed(entry) ? 'annotation-covered' : ''}`} points={points(entry.hold.polygon)} style={{ strokeWidth: (selectedId === entry.hold.id ? 3 : 1.5) / view.scale, ...(['removed','dismissed'].includes(entry.status) ? { strokeDasharray: `${6/view.scale} ${4/view.scale}` } : {}), ...(coverConfirmed && confirmed(entry) ? { fill: wallColors[entry.hold.id] ?? 'rgb(170,168,162)', stroke: 'none' } : {}) }} />)}
          {manualPoints.length > 0 && <polyline className="annotation-preview" points={points(manualPoints)} />}
          {showSuggestions && !coverConfirmed && (review ? pendingModel : pendingSuggestions).map((hold) => <polygon key={hold.id} className="annotation-suggestion" points={points(hold.polygon)} />)}
          {preview && <polygon className="annotation-preview" points={points(preview.polygon)} style={review ? { strokeWidth: 3/view.scale } : undefined} />}
          {review && tool === 'vertex' && preview && preview.polygon.map((point,index) => <circle key={index} className="annotation-vertex" cx={point[0]*WIDTH} cy={point[1]*HEIGHT} r={8/view.scale} />)}
          {box && <rect className="annotation-box" x={box[0] * WIDTH} y={box[1] * HEIGHT} width={(box[2] - box[0]) * WIDTH} height={(box[3] - box[1]) * HEIGHT} />}
          {prompts.map((prompt, index) => <g key={index} className={prompt.label ? 'annotation-positive' : 'annotation-negative'}>
            <circle cx={prompt.point[0] * WIDTH} cy={prompt.point[1] * HEIGHT} r={7 / view.scale} />
            <text x={prompt.point[0] * WIDTH} y={prompt.point[1] * HEIGHT} fontSize={12 / view.scale} dy=".35em" textAnchor="middle">{prompt.label ? '+' : '−'}</text>
          </g>)}
          {boxStart && <circle className="annotation-box-start" cx={boxStart[0] * WIDTH} cy={boxStart[1] * HEIGHT} r={7 / view.scale} />}
        </svg>
      </div>
      {review && <section className="review-quick-actions" aria-label="Quick hold review">
        <div className="review-quick-buttons">
          <button disabled={busy || !pending.length} onClick={nextPending}>Next pending hold</button>
          <button className="primary" disabled={busy || !canEdit || !preview || !!(selectedEntry && (['removed','dismissed'].includes(selectedEntry.status) || selectedEntry.coverageFraction<.99))} onClick={()=>void accept()}>Confirm</button>
          <button disabled={!canChangeSelected} onClick={()=>void remove()}>Mark removed</button>
          <button disabled={!canReplace} title="Replace the selected old hold with this outline and a fresh ID" onClick={()=>void replacement()}>Mark replaced</button>
          <button disabled={!canPredict} onClick={()=>void predict()}>Generate mask</button>
        </div>
        <p className="annotation-hint" role="status">{busy ? 'SAM2 is running…' : !preview ? 'Next pending hold loads its SAM2 suggestion.' : !canEdit ? 'Switch to New scan to confirm.' : selectedEntry && selectedEntry.coverageFraction<.99 ? 'Insufficient new-photo coverage to confirm this hold.' : !review.reviewer.trim() ? 'Enter your reviewer name above to confirm. Tap Confirm to jump there.' : `Outline ready${preview.score===undefined?'':` · score ${preview.score.toFixed(2)}`}`}</p>
        {error&&<p className="annotation-error" role="alert">{error}</p>}
      </section>}
      {review && <h2 className="review-edit-heading">Edit outline & rerun SAM2</h2>}
      <fieldset disabled={busy} className="annotation-tools">
        <legend>Prompt tool</legend>
        {(['positive', 'negative', 'box', 'pan', 'select', ...(review ? ['polygon', 'vertex'] : [])] as Tool[]).map((value) => <button key={value} type="button" disabled={!canEdit && value !== 'pan'} aria-pressed={tool === value}
          onClick={() => { setTool(value); setBoxStart(null); if (value !== 'polygon') setManualPoints([]); else invalidate() }}>{({ positive: '＋ Hold', negative: '− Exclude', box: 'Box', pan: 'Pan', select: 'Select', polygon: 'Draw polygon', vertex: 'Move vertex' })[value]}</button>)}
      </fieldset>
      <p className="annotation-hint">{tool === 'polygon' ? 'Tap around the outline, then Finish polygon. Up to 16 vertices.' : tool === 'vertex' ? 'Drag the round handles, then explicitly confirm the correction.' : tool === 'box' ? 'Drag a box, or tap its two opposite corners.' : tool === 'pan' ? 'Drag to move the wall.' : tool === 'select' ? 'Tap a blue hold to edit it, or an orange suggestion to review.' : tool === 'positive' ? 'Tap inside the hold. Add more points to refine it.' : 'Tap unwanted areas to exclude them.'} Pinch to zoom.</p>
      {review && <div className="annotation-actions"><button disabled={busy || !manualPoints.length} onClick={() => setManualPoints(p => p.slice(0,-1))}>Undo vertex</button><button disabled={busy || manualPoints.length < 3 || !canEdit} onClick={finishPolygon}>Finish polygon</button></div>}
      <div className="annotation-actions">
        <button disabled={busy || (!prompts.length && !box && !boxStart)} onClick={() => { if (boxStart) setBoxStart(null); else if (prompts.length) setPrompts((p) => p.slice(0, -1)); else setBox(null); invalidate() }}>Undo prompt</button>
        <button disabled={busy} onClick={clear}>New hold / Clear</button>
        {!review && <button className="primary" disabled={!canPredict} onClick={() => void predict()}>{busy ? 'Working…' : 'Generate mask'}</button>}
      </div>
      <p className="annotation-hint">{prompts.filter((p) => p.label === 1).length} positive · {prompts.filter((p) => p.label === 0).length} negative · {box ? 'box set' : 'no box'}{timing !== null && ` · ${timing.toFixed(2)}s`}</p>
      {candidates.length > 0 && <div className="annotation-actions"><label>Outline candidate<select value={candidateIndex} disabled={busy} onChange={(event) => setCandidateIndex(Number(event.target.value))}>
        {candidates.map((candidate, index) => <option key={index} value={index}>Option {index + 1} · {candidate.score === undefined ? 'saved outline' : `score ${candidate.score.toFixed(2)}`}</option>)}
      </select></label><button className="primary" disabled={busy || !canEdit || (!review && !savedLoaded) || !!(selectedEntry && ['removed', 'dismissed'].includes(selectedEntry.status))} onClick={() => void accept()}>{review ? editingOriginal ? 'Confirm corrected outline' : 'Confirm new hold' : editingOriginal ? 'Save changes' : 'Accept hold'}</button></div>}
      {review && <section className="annotation-library" aria-label="Batch review tools"><h2>Batch confirmation & automation</h2>
        <label className="annotation-inline"><input type="checkbox" checked={autoPredict} disabled={busy} onChange={event=>setAutoPredict(event.target.checked)} />Auto-run SAM2 on next hold</label>
        <p className="annotation-hint">Next pending hold loads its saved SAM2 suggestion immediately. Enable auto-run here if you also want a fresh prediction.</p>
        {review.assets.proposals && <section aria-label="Bulk confirmation">
          <label>Minimum SAM2 score<input aria-label="Minimum SAM2 score" type="number" min="0" max="1" step="0.01" value={Number.isFinite(threshold)?threshold:''} disabled={busy} onChange={event=>setThreshold(event.target.value===''?NaN:Number(event.target.value))} /></label>
          {busy ? <p className="review-required">Wait for the current operation to finish.</p> : !canEdit ? <p className="review-required">Switch to New scan to confirm.</p> : !bulkActions.length ? <p className="review-required">No pending suggestions qualify at this threshold.</p> : null}
          <button disabled={busy || !canEdit || !bulkActions.length} onClick={()=>void confirmBatch()}>Confirm eligible SAM2 outlines ({bulkActions.length})</button>
          {!review.reviewer.trim()&&<p className="review-required" role="status">Enter your reviewer name above. You can tap this button to jump to the name field.</p>}
          <p className="annotation-hint">Uses saved SAM2 scores. Skips reviewed entries, coverage gaps, shared masks and alignment/change warnings. Confirms the proposed outline while keeping its old ID.</p>

          {batchNotice&&<p role="status">{batchNotice}</p>}
        </section>}
      </section>}
      {review?.assets.proposals && <section className="annotation-library" aria-label="SAM2 proposals">
        <h2>SAM2 suggestions ({review.assets.proposals.proposals.length})</h2>
        <label className="annotation-inline"><input type="checkbox" checked={showSuggestions} onChange={event => setShowSuggestions(event.target.checked)} />Show SAM2 suggestions</label>
        <p>Cyan dashed outlines are inherited; orange outlines are SAM2 suggestions. Select an inherited hold, load its suggestion, then inspect and confirm a correction or replacement.</p>
      </section>}
      {review && selectedEntry && <section className="review-decision">
        <p>{selectedEntry.hold.id} · {selectedEntry.status} · observed {(selectedEntry.coverageFraction*100).toFixed(1)}%</p>
        <p className="annotation-hint">{selectedEntry.reasonCodes.join(' · ')}</p>
        {review.assets.proposals && <div className="model-proposal-controls">
          <p>Model recommendation: {review.assets.proposals.recommendations[selectedEntry.hold.id] ?? 'Not an inherited hold'}.</p>
          {selectedProposals.length ? selectedProposals.map(proposal => <div key={proposal.id}>
            <p>Score {proposal.score.toFixed(2)}{proposal.oldHoldIds.length > 1 ? ` · shared by ${proposal.oldHoldIds.length} old holds; inspect for merging` : ''}</p>
            <button disabled={busy || !canEdit || ['removed','dismissed'].includes(selectedEntry.status)} onClick={() => { editHold(selectedEntry.hold); setCandidates([proposal]); setTool('vertex') }}>Load SAM2 suggestion</button>
          </div>) : <p>No saved suggestion. Use points / a box and Generate mask, or draw an outline.</p>}
          <button disabled={busy || !canEdit} onClick={() => editHold(selectedEntry.hold)}>Restore saved outline</button>
        </div>}

        <div className="annotation-actions">
          <button className="primary" disabled={busy || !canEdit || selectedEntry.status !== 'inherited-unreviewed' || (!!preview && stable(preview.polygon) !== stable(selectedEntry.hold.polygon))} onClick={() => void reviewDecision('confirm')}>Confirm unchanged</button>
          <button disabled={busy || !canEdit} onClick={() => void reviewDecision('reset')}>Reset decision</button>
        </div>
        {preview && selectedEntry.oldHoldId === selectedEntry.hold.id && <details><summary>Different / moved hold?</summary><p>Replacing removes the old hold and assigns a new ID to this outline. Existing routes stay on their old wall version.</p><p>Use Mark replaced beside Confirm above to record this replacement.</p></details>}
      </section>}
      {editingOriginal && <p className="annotation-hint">Editing {editingOriginal.id}. Save changes keeps its ID; Clear cancels this edit.</p>}
      {suggestionId && <button disabled={busy} onClick={() => void skipSuggestion()}>Skip this suggestion</button>}
      {!review && error && <p className="annotation-error" role="alert">{error}</p>}
      {!review && <section className="annotation-library">
        <h2>Auto suggestions ({pendingSuggestions.length})</h2>
        <p>Orange = unreviewed. Blue = accepted. Model scores do not guarantee accuracy.</p>
        <label className="annotation-inline"><input type="checkbox" checked={showSuggestions} onChange={(event) => setShowSuggestions(event.target.checked)} />Show auto suggestions</label>
        <div className="annotation-actions">
          <button disabled={busy || !pendingSuggestions.length} onClick={() => reviewSuggestion(pendingSuggestions[0])}>Review next suggestion</button>
          <button disabled={busy || !highScoreSuggestions.length || !savedLoaded} onClick={() => void importData({ wallId: 'stoneham-spraywall-v1', image_size: [WIDTH, HEIGHT], holds: highScoreSuggestions })}>Accept all ≥0.95 ({highScoreSuggestions.length})</button>
        </div>
      </section>}
      <section className="annotation-library">
        <h2>{review ? 'Review entries' : 'Accepted holds'} ({saved.holds.length})</h2>
        <p>{review ? 'Choose any entry to inspect, correct, remove or reset its decision.' : 'Saved on this running server. Export a copy to your phone.'}</p>
        <div className="annotation-actions"><label>Saved hold<select aria-label="Saved hold" disabled={busy} value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Choose a hold</option>
          {saved.holds.map((hold, index) => <option key={hold.id} value={hold.id}>{index + 1}. {hold.id}</option>)}</select></label>
          <button disabled={busy || !selectedId} onClick={() => { const hold = saved.holds.find((h) => h.id === selectedId); if (hold) editHold(hold) }}>Edit selected</button>
          {!review && <button disabled={busy || !selectedId} onClick={() => void remove()}>Delete selected</button>}
          {!review && savedLoaded && <a className="annotation-download" href={`${API}/annotations`} download="stoneham-manual-holds.json">Export JSON</a>}
        </div>
        {!review && <><label className="annotation-inline"><input type="checkbox" checked={replaceExisting} onChange={(event) => setReplaceExisting(event.target.checked)} />Replace matching IDs on import</label>
        <label>Import existing annotations<input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = '' }} /></label></>}
      </section>
    </main>
  )
}
