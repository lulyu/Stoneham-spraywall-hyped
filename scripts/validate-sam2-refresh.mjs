import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { validateHold } from '../src/wallReview.ts'

const [input, output, report] = process.argv.slice(2)
if (!input || !output || !report) throw new Error('Usage: node scripts/validate-sam2-refresh.mjs RAW_JSON OUTPUT_JSON REPORT_JSON')
if (new Set([input, output, report]).size !== 3) throw new Error('Keep raw proposals, validated proposals and report separate.')
const raw = readFileSync(input), data = JSON.parse(raw)
if (data.format !== 'stoneham-sam2-refresh-v1' || data.publishable !== false || data.metadata.acceptedHoldCount !== 0) throw new Error('Expected unapproved SAM2 drafts.')
const rejected = []
const kept = data.proposals.filter(proposal => {
  try { validateHold(proposal); return true }
  catch (error) { rejected.push({id:proposal.id,oldHoldIds:proposal.oldHoldIds,reason:error.message});return false }
})
const ids = new Set(kept.map(proposal => proposal.id))
for (const entry of data.entries) {
  if (entry.proposalId !== null && !ids.has(entry.proposalId)) {
    entry.proposalId = null;entry.recommendation = 'no-usable-mask'
    entry.reasonCodes.push('invalid-simplified-outline-requires-manual-review')
  }
}
const validation = {rawSha256:createHash('sha256').update(raw).digest('hex'),rawProposalCount:data.proposals.length,
  deliveredProposalCount:kept.length,rejectedProposalCount:rejected.length,rejected,publishable:false}
data.proposals = kept
Object.assign(data.metadata,{rawProposalCount:validation.rawProposalCount,proposalCount:kept.length,geometryValidation:validation,
  recommendations:Object.fromEntries([...new Set(data.entries.map(entry=>entry.recommendation))].sort().map(name=>[name,data.entries.filter(entry=>entry.recommendation===name).length]))})
writeFileSync(output,JSON.stringify(data,null,2)+'\n')
writeFileSync(report,JSON.stringify(validation,null,2)+'\n')
console.log(JSON.stringify(validation))
