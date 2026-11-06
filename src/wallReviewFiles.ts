import referenceMapUrl from './data/polygons/holds.json?url'
import { initializeReview, sameSession, validateProgress } from './wallReview'
import type { WallReview } from './wallReview'
import type { PolygonHoldCandidate } from './types'
import { validateProposals } from './wallProposals'
import type { ModelProposals } from './wallProposals'

export type ReviewAssets = {
  proposals?: ModelProposals; baseline: WallReview; initial: WallReview; image: string; reference: string
  coverage: string; uncertainty: string; sources?: string; qa?: string
  inputKind: string; qaStatus: string; dispose: () => void
  observedFraction: (hold:PolygonHoldCandidate)=>Promise<number>
}
const BASE=import.meta.env.BASE_URL
export async function sha256(bytes: BufferSource) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('')
}
async function decoded(blob:Blob,size:[number,number]) {
  const bitmap=await createImageBitmap(blob)
  if(bitmap.width!==size[0] || bitmap.height!==size[1]) { bitmap.close();throw new Error('Scan image/mask dimensions do not match the session.') }
  return bitmap
}
export async function loadReviewFiles(files: File[]):Promise<ReviewAssets> {
  const urls:string[]=[], bitmaps:ImageBitmap[]=[]
  const get=(name:string,optional=false)=> {
    const matches=files.filter(f=>f.name===name)
    if(matches.length>1) throw new Error(`Select only one scan folder: duplicate ${name}.`)
    if(!matches.length && !optional) throw new Error(`Missing ${name}. Select the pipeline output folder (including full-resolution files).`)
    return matches[0]
  }
  const json=async(name:string)=> {const f=get(name);if(f.size>16*1024*1024)throw new Error(`${name} is too large.`);return JSON.parse(await f.text())}
  const url=(blob:Blob)=>{ const value=URL.createObjectURL(blob);urls.push(value);return value }
  const dispose=()=>{urls.forEach(URL.revokeObjectURL);bitmaps.forEach(b=>b.close())}
  try {
    const [manifest,prelabels,queue,report]=await Promise.all(['manifest.json','holds_prelabels.json','review_queue.json','report.json'].map(json))
    const suppliedMap=get('reference-holds.json',true)
    const mapResponse=suppliedMap?null:await fetch(referenceMapUrl)
    if(mapResponse && !mapResponse.ok)throw new Error('Could not load the old hold map.')
    if(suppliedMap && suppliedMap.size>16*1024*1024)throw new Error('Reference hold map is too large.')
    const referenceText=suppliedMap?await suppliedMap.text():await mapResponse!.text()
    const oldMap=JSON.parse(referenceText)
    const baseline=initializeReview(manifest,prelabels,queue,oldMap), size=baseline.session.coordinateFrame.size
    sameSession(baseline.session,prelabels.session)
    if(await sha256(new TextEncoder().encode(referenceText))!==baseline.session.referenceHoldsSha256) throw new Error('This app has a different old hold map. Use the build for the reference version; do not transfer approvals.')
    if(report.sessionId!==baseline.session.sessionId || report.publishable!==false) throw new Error('QA report belongs to another scan.')
    const imageFile=manifest.imageFile ?? 'wall_registered.png'
    if(!['wall_registered.png','wall_registered.jpg'].includes(imageFile))throw new Error('Unsupported candidate image file.')
    const candidate=get(imageFile)
    if(candidate.size>180*1024*1024) throw new Error('Candidate image exceeds 180 MiB.')
    if(await sha256(await candidate.arrayBuffer())!==baseline.session.registeredImageSha256) throw new Error('Candidate image hash differs. Rebuild the scan and start a new session.')
    const candidateBitmap=await decoded(candidate,size);candidateBitmap.close()
    // Reference bytes are verified too: equal dimensions alone are insufficient.
    const supplied=get('reference.jpg',true)
    const response=supplied?null:await fetch(`${BASE}wall/stoneham-spraywall-canonical.jpg`)
    if(response && !response.ok) throw new Error('Could not load the old reference image.')
    const reference=supplied??await response!.blob()
    if(await sha256(await reference.arrayBuffer())!==baseline.session.referenceImageSha256) throw new Error('Wrong old reference image. Include hash-matching reference.jpg in the selected files.')
    const referenceBitmap=await decoded(reference,size);referenceBitmap.close()
    const coverage=get('coverage.png'), uncertainty=get('uncertainty.png')
    for(const [file,key] of [[coverage,'coverageSha256'],[uncertainty,'uncertaintySha256']] as const) {
      if(baseline.session[key] && await sha256(await file.arrayBuffer())!==baseline.session[key])throw new Error(`Wrong scan evidence: ${file.name}.`)
    }
    const proposalFile=get('sam2-proposals.json',true)
    let proposals:ModelProposals|undefined
    if(baseline.session.proposalsSha256) {
      if(!proposalFile || proposalFile.size>16*1024*1024 || await sha256(await proposalFile.arrayBuffer())!==baseline.session.proposalsSha256)throw new Error('Missing or changed SAM2 proposal data.')
      proposals=validateProposals(JSON.parse(await proposalFile.text()),baseline)
    } else if(proposalFile)throw new Error('SAM2 proposals must be bound to the scan identity.')
    const coverageBitmap=await decoded(coverage,size);bitmaps.push(coverageBitmap)
    const uncertaintyBitmap=await decoded(uncertainty,size)
    const overlay=document.createElement('canvas');overlay.width=2048;overlay.height=Math.round(2048*size[1]/size[0])
    const context=overlay.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('Canvas unavailable.')
    context.imageSmoothingEnabled=false;context.drawImage(uncertaintyBitmap,0,0,overlay.width,overlay.height);uncertaintyBitmap.close()
    const pixels=context.getImageData(0,0,overlay.width,overlay.height)
    for(let i=0;i<pixels.data.length;i+=4) {
      const flag=pixels.data[i],color=flag&16?[255,0,220]:flag&14?[255,70,75]:[255,210,40]
      pixels.data.set([...color,flag?160:0],i)
    }
    context.putImageData(pixels,0,0)
    const qaMask=await new Promise<Blob>((resolve,reject)=>overlay.toBlob(blob=>blob?resolve(blob):reject(new Error('QA overlay failed.')),'image/png'))
    const progress=get('review-progress.json',true)
    const initial=progress?validateProgress(JSON.parse(await progress.text()),baseline):baseline
    return {proposals,baseline,initial,image:url(candidate),reference:url(reference),coverage:url(coverage),uncertainty:url(qaMask),
      sources:get('source-index-preview.png',true)?url(get('source-index-preview.png')):undefined,
      qa:get('qa-overlay.jpg',true)?url(get('qa-overlay.jpg')):undefined,
      inputKind:manifest.inputKind,qaStatus:report.status,dispose,
      observedFraction:async(hold)=> {
        const w=size[0],h=size[1],xs=hold.polygon.map(p=>p[0]*w),ys=hold.polygon.map(p=>p[1]*h)
        const x=Math.max(0,Math.floor(Math.min(...xs))),y=Math.max(0,Math.floor(Math.min(...ys)))
        const width=Math.min(w-x,Math.ceil(Math.max(...xs))-x+1),height=Math.min(h-y,Math.ceil(Math.max(...ys))-y+1)
        const scale=Math.min(1,1024/Math.max(width,height)),canvas=document.createElement('canvas')
        canvas.width=Math.max(1,Math.ceil(width*scale));canvas.height=Math.max(1,Math.ceil(height*scale))
        const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Canvas unavailable.')
        ctx.imageSmoothingEnabled=false;ctx.drawImage(coverageBitmap,x,y,width,height,0,0,canvas.width,canvas.height)
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data
        ctx.clearRect(0,0,canvas.width,canvas.height);ctx.beginPath()
        hold.polygon.forEach(([u,v],i)=>{if(i===0)ctx.moveTo((u*w-x)*scale,(v*h-y)*scale);else ctx.lineTo((u*w-x)*scale,(v*h-y)*scale)})
        ctx.closePath();ctx.fillStyle='white';ctx.fill()
        const mask=ctx.getImageData(0,0,canvas.width,canvas.height).data
        let count=0,observed=0
        for(let i=0;i<mask.length;i+=4)if(mask[i+3]>0){count++;if(pixels[i]>=128)observed++}
        return count?observed/count:0
      }}
  } catch(error) {dispose();throw error}
}
// Same artifact contract, fetched only when a local rescan server is explicitly configured.
export async function loadServerReview():Promise<ReviewAssets> {
  const response=await fetch(`${BASE}api/sam2/review-bundle`)
  if(!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('No local rescan server. Import a scan folder, or start the server with --rescan-session.')
  const bundle=await response.json()
  if(!Array.isArray(bundle.files))throw new Error('Invalid review bundle.')
  const allowed=['manifest.json','holds_prelabels.json','review_queue.json','report.json','wall_registered.png','coverage.png','uncertainty.png','source-index-preview.png','qa-overlay.jpg','wall_registered.jpg','sam2-proposals.json','reference.jpg','reference-holds.json']
  const files:File[]=[]
  // Sequential fetch bounds peak memory while handling full-resolution images.
  for(const name of allowed.filter(n=>bundle.files.includes(n))) {
    const result=await fetch(`${BASE}api/sam2/review-file/${name}`);if(!result.ok)throw new Error(`Cannot load ${name}.`)
    files.push(new File([await result.blob()],name))
  }
  return loadReviewFiles(files)
}
