import { useEffect, useRef, useState } from 'react'
import Annotator from './Annotator'
import { applyReview, reviewKey, validateProgress, resumeReview } from './wallReview'
import { loadStoredReview, saveStoredReview } from './reviewStorage'
import type { ReviewAction, WallReview } from './wallReview'
import { loadReviewFiles, loadServerReview } from './wallReviewFiles'
import type { ReviewAssets } from './wallReviewFiles'
import './annotator.css'

export type ReviewController = {
  assets:ReviewAssets; data:WallReview; reviewer:string; setReviewer:(name:string)=>void
  commit:(action:ReviewAction)=>Promise<void>; commitMany:(actions:ReviewAction[])=>Promise<void>; exportProgress:()=>void; resume:(file?:File)=>Promise<void>
}
function download(data:unknown,name:string) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}))
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export default function AnnotationWorkspace() {
  const [mode,setMode]=useState<'manual'|'rescan'>(new URLSearchParams(location.search).get('review')==='1'?'rescan':'manual')
  const [assets,setAssets]=useState<ReviewAssets|null>(null),[data,setData]=useState<WallReview|null>(null)
  const [epoch,setEpoch]=useState(0)
  const [error,setError]=useState(''),[loading,setLoading]=useState(false),[reviewer,setReviewer]=useState('')
  const active=useRef<ReviewAssets|null>(null),loadId=useRef(0)
  useEffect(()=>()=>{loadId.current++;active.current?.dispose()},[])
  const open=async(load:()=>Promise<ReviewAssets>)=> {
    const id=++loadId.current;setLoading(true);setError('')
    let next:ReviewAssets|undefined
    try {
      next=await load()
      if(id!==loadId.current){next.dispose();return}
      if(!navigator.locks) throw new Error('Safe saving requires Web Locks. Open this tool in a current HTTPS browser.')
      const loaded=next
      const restored=await navigator.locks.request(reviewKey(loaded.baseline.session),()=>loadStoredReview(loaded.baseline,loaded.initial))
      if(id!==loadId.current){next.dispose();return}
      active.current?.dispose();active.current=next;setAssets(next);setData(restored);setReviewer(name=>name || restored.history.at(-1)?.reviewer || '');setEpoch(e=>e+1)
    } catch(problem) {next?.dispose();setError(String(problem))}
    finally {if(id===loadId.current)setLoading(false)}
  }
  const commitMany=async(actions:ReviewAction[],manual=false)=> {
    if(!data || !assets)throw new Error('Open a scan first.')
    const generation=loadId.current
    if(!actions.length)return
    if(!reviewer.trim())throw new Error('Enter your reviewer name before confirming a decision.')
    let next=data
    for(const action of actions) {
      let measuredAction=action
      if(action.type==='add' || action.type==='refine'){
        const fraction=await assets.observedFraction(action.hold)
        if(!manual && fraction<.99)throw new Error('The edited outline crosses an unobserved gap. No decisions in this batch were saved.')
        measuredAction={...action,coverageFraction:fraction}
      }
      next=applyReview(next,measuredAction,reviewer)
    }
    // Serialize same-origin tabs using a browser lock; the stored state is also compared in saveReview.
    if(!navigator.locks)throw new Error('This browser needs Web Locks for safe saving. Use a current HTTPS browser.')
    await navigator.locks.request(reviewKey(data.session),async()=>{
      if(generation!==loadId.current)throw new Error('The scan workspace changed. Reopen the correct scan before saving.')
      await saveStoredReview(data,next)
    })
    setData(next)
  }
  const commit=(action:ReviewAction)=>commitMany([action],true)
  const resume=async(file?:File)=> {
    if(!file || !data || !assets)return
    if(file.size>16*1024*1024)throw new Error('Checkpoint exceeds 16 MiB.')
    const generation=loadId.current
    const next=resumeReview(JSON.parse(await file.text()),data,assets.baseline)
    if(!navigator.locks)throw new Error('Use a current HTTPS browser with Web Locks.')
    await navigator.locks.request(reviewKey(data.session),async()=>{
      if(generation!==loadId.current)throw new Error('The scan workspace changed. Reopen it before resuming progress.')
      await saveStoredReview(data,next)
    });setData(next);setEpoch(e=>e+1)
  }
  return <>
    <nav className="annotation-mode" aria-label="Annotation mode">
      <button aria-pressed={mode==='manual'} onClick={()=>setMode('manual')}>Manual annotation</button>
      <button aria-pressed={mode==='rescan'} onClick={()=>setMode('rescan')}>Wall update review</button>
    </nav>
    {mode==='manual'?<Annotator />:<>
      <section className="annotation-shell review-import">
        <details open={!assets}><summary>{assets ? `Scan: ${data?.session.scanId} · reopen / change` : 'Open a wall update workspace'}</summary>
        <h1>Wall update workspace</h1>
        <p>Import a registered scan, compare it with the old wall, and continue annotating here. Everything stays a draft. No production changes.</p>
        <div className="annotation-actions">
          <label className="review-file">Open scan folder<input aria-label="Open scan folder" type="file" multiple disabled={loading}
            ref={element=>{element?.setAttribute('webkitdirectory','')}} onChange={event=>{const files=Array.from(event.target.files??[]);if(files.length)void open(()=>loadReviewFiles(files));event.target.value=''}} /></label>
          <label className="review-file">Or select scan files<input aria-label="Select scan files" type="file" multiple disabled={loading} onChange={event=>{const files=Array.from(event.target.files??[]);if(files.length)void open(()=>loadReviewFiles(files));event.target.value=''}} /></label>
          <button disabled={loading} onClick={()=>void open(loadServerReview)}>Open local server scan</button>
        </div>
        <details><summary>What to import</summary><p>Select the Phase B output folder containing manifest.json, holds_prelabels.json, review_queue.json, report.json, wall_registered.png (or wall_registered.jpg for v5), coverage.png and uncertainty.png. A v5 bundle also includes hash-bound sam2-proposals.json. Keep these files together. The old reference comes from the app and is hash checked. Optional review-progress.json resumes exported progress.</p></details>
        </details>
        {loading&&<p role="status">Checking scan identity and image bytes… Large images can take a moment.</p>}
        {error&&<p className="annotation-error" role="alert">{error}</p>}
      </section>
      {assets&&data&&<Annotator key={`${data.session.sessionId}:${epoch}`} review={{assets,data,reviewer,setReviewer,commit,commitMany,resume,
        exportProgress:()=>download(validateProgress(data,assets.baseline),'review-progress.json')}} />}
    </>}
  </>
}
