import type { Point, PolygonHoldCandidate } from './types'

export type ScanSession = {
  sessionId: string; scanId: string; gymId: string; wallId: string
  referenceVersion: string; candidateVersion: string
  referenceImageSha256: string; referenceHoldsSha256: string; registeredImageSha256: string
  coordinateFrame: { size: [number, number]; orientation: string }
  [key: string]: unknown
}
export type ReviewStatus = 'inherited-unreviewed' | 'verified-unchanged' | 'verified-refined' | 'removed' | 'new' | 'dismissed'
export type ReviewEntry = {
  hold: PolygonHoldCandidate; oldHoldId: string | null; status: ReviewStatus
  observed: boolean; coverageFraction: number; reasonCodes: string[]
  reviewer: string | null; decisionTime: string | null
}
export type ReviewEvent = { revision: number; id: string; action: string; reviewer: string; time: string; before: ReviewEntry | null; after: ReviewEntry }
export type WallReview = {
  format: 'stoneham-wall-review-v1'; session: ScanSession; publishable: false
  reviewRevision: number; entries: ReviewEntry[]; history: ReviewEvent[]
}
export type ReviewAction =
  | { type: 'confirm' | 'remove' | 'reset'; id: string }
  | { type: 'refine'; id: string; hold: PolygonHoldCandidate }
  | { type: 'add'; hold: PolygonHoldCandidate; replaces?: string }

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function object(value: unknown): Record<string, any> { // JSON boundary, validated below.
  check(value && typeof value === 'object' && !Array.isArray(value), 'Expected a JSON object.'); return value as Record<string, any>
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= 200 }
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
  return JSON.stringify(value)
}
export function validateSession(value: unknown): ScanSession {
  const s = object(value)
  for (const key of ['sessionId','referenceImageSha256','referenceHoldsSha256','registeredImageSha256']) check(typeof s[key] === 'string' && /^[a-f0-9]{64}$/.test(s[key]), `Invalid session hash: ${key}`)
  for (const key of ['scanId','gymId','wallId','referenceVersion','candidateVersion']) check(text(s[key]), `Missing session field: ${key}`)
  check(s.referenceVersion !== s.candidateVersion, 'Candidate must have its own version.')
  check(stable(s.coordinateFrame?.size) === '[7292,5514]' && text(s.coordinateFrame?.orientation), 'Unsupported reference coordinate frame.')
  return structuredClone(s) as ScanSession
}
export function sameSession(a: unknown, b: unknown) { check(stable(validateSession(a)) === stable(validateSession(b)), 'Wrong scan/image identity. Reopen the matching scan; approvals cannot transfer between images.') }
export function validateHold(value: unknown): PolygonHoldCandidate {
  const h = object(value)
  const point = (p: unknown): p is Point => Array.isArray(p) && p.length === 2 && p.every(v => finite(v) && v >= 0 && v <= 1)
  check(text(h.id) && h.id.length <= 100, 'Invalid hold ID.')
  check(['hold','macro','volume'].includes(h.kind), 'Invalid hold kind.')
  check(point(h.center) && Array.isArray(h.polygon) && h.polygon.length >= 3 && h.polygon.length <= 16 && h.polygon.every(point), 'Use 3–16 normalized polygon vertices.')
  const p = h.polygon as Point[]
  const area = Math.abs(p.reduce((sum, [x,y], i) => { const q=p[(i+1)%p.length]; return sum+x*q[1]-q[0]*y }, 0))/2
  check(area > 1e-10, 'Polygon has no area.')
  // Crossing outlines are ambiguous for coverage and manual approval.
  const orient = (a: Point,b: Point,c: Point) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
  for (let i=0;i<p.length;i++) for (let j=i+2;j<p.length;j++) {
    if (i===0 && j===p.length-1) continue
    const a=p[i], b=p[(i+1)%p.length], c=p[j], d=p[(j+1)%p.length]
    check(!(orient(a,b,c)*orient(a,b,d)<0 && orient(c,d,a)*orient(c,d,b)<0), 'Polygon edges cross. Move or undo a vertex.')
  }
  return { id:h.id, kind:h.kind, center:[...h.center] as Point, polygon:p.map(v=>[...v] as Point) }
}
export function initializeReview(manifest: unknown, prelabels: unknown, queue: unknown, reference: unknown): WallReview {
  const m=object(manifest), p=object(prelabels), q=object(queue), session=validateSession(m.session)
  check(m.publishable===false && p.publishable===false && q.publishable===false, 'Expected non-publishable pipeline artifacts.')
  sameSession(session,p.session); sameSession(session,q.session)
  check(q.reviewRevision===0 && Array.isArray(q.entries), 'Import the original pipeline queue; use Resume progress for reviewed data.')
  check(Array.isArray(p.holds) && p.holds.length<=5000 && Array.isArray(reference), 'Invalid prelabels.')
  const referenceHolds=reference.map(validateHold) as PolygonHoldCandidate[]
  const byId=new Map(referenceHolds.map(hold=>[hold.id,hold]))
  check(new Set(p.holds.map((hold:any)=>hold.id)).size===p.holds.length && p.holds.every((hold:any)=>stable(hold)===stable(byId.get(hold.id))), 'Prelabels must exactly match their hash-verified old geometry.')
  const holds=referenceHolds
  check(new Set(holds.map(h=>h.id)).size===holds.length, 'Duplicate hold IDs.')
  check(q.entries.length===holds.length && new Set(q.entries.map((e:any)=>e.oldHoldId)).size===holds.length, 'Review queue does not match prelabels.')
  const entries=holds.map(hold=> {
    const e=q.entries.find((e:any)=>e.oldHoldId===hold.id)
    check(e && e.candidateHoldId===hold.id && e.status==='inherited-unreviewed' && typeof e.observed==='boolean' && finite(e.coverage_fraction) && e.coverage_fraction>=0 && e.coverage_fraction<=1 && Array.isArray(e.reasonCodes) && e.reasonCodes.every(text), 'Invalid inherited review entry.')
    check(e.observed===(e.coverage_fraction>0), 'Inconsistent coverage evidence.')
    check(!e.observed || p.holds.some((h:any)=>h.id===hold.id), 'Observed hold missing from prelabels.')
    return {hold,oldHoldId:hold.id,status:'inherited-unreviewed' as const,observed:e.observed,coverageFraction:e.coverage_fraction,reasonCodes:e.reasonCodes,reviewer:null,decisionTime:null}
  })
  return {format:'stoneham-wall-review-v1',session,publishable:false,reviewRevision:0,entries,history:[]}
}
export function applyReview(current: WallReview, action: ReviewAction, reviewer: string, time=new Date().toISOString()): WallReview {
  check(text(reviewer), 'Enter your reviewer name before confirming a decision.')
  const next=structuredClone(current), revision=current.reviewRevision+1
  const record=(before: ReviewEntry|null, after: ReviewEntry, name: string) => {
    const index=next.entries.findIndex(e=>e.hold.id===after.hold.id)
    if (index<0) next.entries.push(after); else next.entries[index]=after
    next.history.push({revision,id:after.hold.id,action:name,reviewer:reviewer.trim(),time,before:before ? structuredClone(before):null,after:structuredClone(after)})
  }
  const entry='id' in action ? next.entries.find(e=>e.hold.id===action.id) : undefined
  if (action.type==='add') {
    const hold=validateHold(action.hold)
    check(!next.entries.some(e=>e.hold.id===hold.id), 'New/replacement holds must have a fresh ID.')
    let old: ReviewEntry|undefined
    if (action.replaces) {
      old=next.entries.find(e=>e.hold.id===action.replaces)
      check(old?.oldHoldId && old.status!=='removed', 'Choose an active inherited hold to replace.')
      check(old.observed && old.coverageFraction>=.99, 'Unobserved regions cannot be confirmed as removed.')
      record(old,{...old,status:'removed',reviewer:reviewer.trim(),decisionTime:time},'replace-old')
    }
    record(null,{hold,oldHoldId:old?.oldHoldId??null,status:'new',observed:true,coverageFraction:1,reasonCodes:old?['human-confirmed-replacement']:['human-added'],reviewer:reviewer.trim(),decisionTime:time},old?'replacement':'add')
  } else {
    check(entry, 'Hold is missing. Reload the workspace.')
    if (action.type!=='reset') check(entry.observed && entry.coverageFraction>=.99, 'This region lacks observation coverage. Inspect or recapture it; do not approve absence from a gap.')
    check(entry.status!=='removed' && entry.status!=='dismissed' || action.type==='reset', 'Restore this entry before editing it.')
    let after:ReviewEntry
    if (action.type==='reset') {
      check(!next.entries.some(e=>e.status==='new' && e.oldHoldId===entry.hold.id), 'Undo/dismiss the replacement first, then restore the old hold.')
      const original=current.history.find(event=>event.id===entry.hold.id)?.before?.hold ?? entry.hold
      after={...entry,hold:structuredClone(original),status:entry.oldHoldId===entry.hold.id?'inherited-unreviewed':'dismissed',reviewer:reviewer.trim(),decisionTime:time}
    } else if (action.type==='refine') {
      check(action.hold.id===entry.hold.id,'Refinement must preserve the ID; use Replace for a different hold.')
      after={...entry,hold:validateHold(action.hold),status:entry.status==='new'?'new':'verified-refined',reviewer:reviewer.trim(),decisionTime:time}
    } else if (action.type==='remove') after={...entry,status:entry.oldHoldId===entry.hold.id?'removed':'dismissed',reviewer:reviewer.trim(),decisionTime:time}
    else {
      check(entry.oldHoldId===entry.hold.id && entry.status==='inherited-unreviewed','Only an unedited inherited outline can be confirmed unchanged.')
      after={...entry,status:'verified-unchanged',reviewer:reviewer.trim(),decisionTime:time}
    }
    record(entry,after,action.type)
  }
  next.reviewRevision=revision
  return next
}
// Rebuild from immutable baseline and decisions, rather than trusting imported status flags.
export function validateProgress(value: unknown, baseline: WallReview): WallReview {
  const v=object(value)
  check(v.format===baseline.format && v.publishable===false, 'Import a review checkpoint, not a geometry-only file.')
  sameSession(v.session,baseline.session)
  check(Number.isSafeInteger(v.reviewRevision) && v.reviewRevision>=0 && Array.isArray(v.history) && v.history.length<=20000, 'Invalid review revision/history.')
  let replay=structuredClone(baseline), cursor=0
  while(cursor<v.history.length) {
    const event=v.history[cursor], after=event.after as ReviewEntry
    check(event.revision===replay.reviewRevision+1 && text(event.reviewer) && typeof event.time==='string' && Number.isFinite(Date.parse(event.time)), 'Invalid decision history.')
    let action:ReviewAction
    if(event.action==='replace-old') {
      const added=v.history[cursor+1]
      check(added?.action==='replacement' && added.revision===event.revision, 'Replacement must be atomic.')
      action={type:'add',hold:added.after.hold,replaces:event.id}
    } else if(event.action==='add') action={type:'add',hold:after.hold}
    else { check(['confirm','remove','reset','refine'].includes(event.action), 'Unknown review action.'); action=event.action==='refine'?{type:'refine',id:event.id,hold:after.hold}:{type:event.action,id:event.id} }
    const next=applyReview(replay,action,event.reviewer,event.time), count=next.history.length-replay.history.length
    check(stable(next.history.slice(-count))===stable(v.history.slice(cursor,cursor+count)), 'Decision history was changed or does not match its geometry.')
    replay=next;cursor+=count
  }
  check(replay.reviewRevision===v.reviewRevision && stable(replay.entries)===stable(v.entries), 'Review state and history do not match.')
  return replay
}
export const reviewKey=(session:ScanSession)=>`stoneham-wall-review-v1:${session.sessionId}`
export function saveReview(storage: Pick<Storage,'getItem'|'setItem'>, current:WallReview, next:WallReview) {
  sameSession(current.session,next.session)
  const stored=storage.getItem(reviewKey(current.session))
  if(!stored) check(current.reviewRevision===0, 'Saved progress disappeared. Reopen the scan before saving again.')
  if(stored) check(stable(JSON.parse(stored))===stable(current), 'Another tab changed this scan. Export your current draft and reopen the scan before continuing.')
  storage.setItem(reviewKey(current.session),JSON.stringify(next))
}
export function confirmed(entry:ReviewEntry) { return ['verified-unchanged','verified-refined','new'].includes(entry.status) }

export function resumeReview(value:unknown,current:WallReview,baseline:WallReview):WallReview {
  const next=validateProgress(value,baseline)
  check(next.reviewRevision>=current.reviewRevision, 'This checkpoint is older than the current progress. It was not imported.')
  check(stable(next.history.slice(0,current.history.length))===stable(current.history), 'Checkpoint history conflicts with this browser. Keep both exports; no decisions were overwritten.')
  return next
}
