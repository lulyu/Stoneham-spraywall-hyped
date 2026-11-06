import { stable, validateHold } from './wallReview.ts'
import type { ReviewAction, WallReview } from './wallReview'
import type { PolygonHoldCandidate } from './types'

export type ModelProposal = PolygonHoldCandidate & { oldHoldIds: string[]; score: number; observedFraction: number; uncertaintyFraction: number }
export type ModelProposals = { proposals: ModelProposal[]; recommendations: Record<string, string> }

/** Proposals are editing drafts; never merge their provisional IDs into review entries. */
export function validateProposals(value: any, baseline: WallReview): ModelProposals {
  const session=baseline.session, meta=value?.metadata
  if(value?.format!=='stoneham-sam2-refresh-v1' || value.publishable!==false ||
    meta?.wallVersionId!==session.candidateVersion || meta?.referenceVersion!==session.referenceVersion ||
    meta?.sourceSessionId!==session.sourceSessionId || meta?.versionManifestSha256!==session.candidateManifestSha256 ||
    meta?.hashes?.image!==session.registeredImageSha256 || meta?.hashes?.oldHolds!==session.referenceHoldsSha256 ||
    meta?.hashes?.coverage!==session.coverageSha256 || meta?.hashes?.uncertainty!==session.uncertaintySha256 ||
    !Array.isArray(value.entries) || !Array.isArray(value.proposals)) throw new Error('SAM2 proposals belong to a different candidate or evidence set.')
  const old=new Map(baseline.entries.map(e=>[e.hold.id,e.hold]))
  const ids=new Set<string>()
  const proposals:ModelProposal[]=value.proposals.map((p:any)=> {
    const hold=validateHold(p)
    if(ids.has(hold.id) || old.has(hold.id) || p.status!=='needs-review' || !Array.isArray(p.oldHoldIds) ||
      !p.oldHoldIds.length || new Set(p.oldHoldIds).size!==p.oldHoldIds.length || !p.oldHoldIds.every((id:unknown)=>typeof id==='string'&&old.has(id)) ||
      ![p.evidence?.observedFraction,p.evidence?.uncertaintyFraction].every(n=>Number.isFinite(n)&&n>=0&&n<=1) ||
      !Number.isFinite(p.evidence?.modelScore) || p.evidence.modelScore<0 || p.evidence.modelScore>1) throw new Error('Invalid provisional SAM2 proposal.')
    ids.add(hold.id)
    return {...hold,oldHoldIds:[...p.oldHoldIds],score:p.evidence.modelScore,observedFraction:p.evidence.observedFraction,uncertaintyFraction:p.evidence.uncertaintyFraction}
  })
  const seen=new Set<string>(),recommendations:Record<string,string>={}
  for(const e of value.entries) {
    if(seen.has(e.oldHoldId) || !old.has(e.oldHoldId) || stable(validateHold(e.oldGeometry))!==stable(old.get(e.oldHoldId)) ||
      e.status!=='inherited-unreviewed' || typeof e.recommendation!=='string' ||
      (e.proposalId!==null && !proposals.some(p=>p.id===e.proposalId&&p.oldHoldIds.includes(e.oldHoldId)))) throw new Error('Invalid SAM2 inherited association.')
    seen.add(e.oldHoldId);recommendations[e.oldHoldId]=e.recommendation
  }
  if(seen.size!==old.size) throw new Error('SAM2 entries do not match the inherited hold map.')
  return {proposals,recommendations}
}

/** Explicit user-triggered bulk confirmation; risky associations stay pending. */
export function bulkProposalActions(data:WallReview, model:ModelProposals, threshold:number):ReviewAction[] {
  if(!Number.isFinite(threshold) || threshold<0 || threshold>1)throw new Error('Use a score threshold between 0 and 1.')
  const byOld=new Map<string,ModelProposal[]>()
  for(const proposal of model.proposals)for(const id of proposal.oldHoldIds)byOld.set(id,[...(byOld.get(id)??[]),proposal])
  return data.entries.flatMap(entry=> {
    const matches=byOld.get(entry.hold.id)??[],p=matches[0]
    if(entry.status!=='inherited-unreviewed' || !entry.observed || entry.coverageFraction<.99 || matches.length!==1 ||
      p.oldHoldIds.length!==1 || p.score<threshold || p.observedFraction<.99 || p.uncertaintyFraction!==0 ||
      !['possible-unchanged','suggested-refinement'].includes(model.recommendations[entry.hold.id]))return []
    return [{type:'refine' as const,id:entry.hold.id,hold:validateHold({...p,id:entry.hold.id})}]
  })
}
