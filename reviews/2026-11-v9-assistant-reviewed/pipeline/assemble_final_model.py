from pathlib import Path
import json,hashlib
r=Path('/workspace/wall-comparison-2026-11-21');main=json.loads((r/'sam2-inset20-r2/sam2-refresh.json').read_text());new=json.loads((r/'new-location-sam2-r2.json').read_text());local=json.loads((r/'inherited-local-final-sam2.json').read_text());assert len(local['records'])==13 and len(local['proposals'])==13
byold={p['oldHoldIds'][0]:p for p in local['proposals']}
for p in main['proposals']:p['oldHoldIds']=[identifier for identifier in p['oldHoldIds'] if identifier not in byold]
main['proposals']=[p for p in main['proposals'] if p['oldHoldIds']]
for e in main['entries']:
 if e['oldHoldId'] in byold:
  p=byold[e['oldHoldId']];e.update(proposalId=p['id'],evidence=p['evidence'],recommendation='local-refinement-needs-review');e['reasonCodes'].append('local-reprompt-after-visual-inspection')
main['proposals']+=local['proposals']+new['proposals']
main['metadata'].update(proposalCount=len(main['proposals']),additionalNewLocationPromptCount=51,additionalNewLocationProposalCount=51,localInheritedRepromptCount=13,manualBoundaryCorrectionCount=11,focusedNewLocationTrialsRetainedAsEvidenceOnly=True,reviewerKind='assistant',recommendations={name:sum(e['recommendation']==name for e in main['entries']) for name in sorted(set(e['recommendation'] for e in main['entries']))},provenance={name:hashlib.sha256((r/name).read_bytes()).hexdigest() for name in ['new-location-hints.json','new-component-review.json','new-location-sam2-r2.json','new-location-focused-sam2.json','inherited-local-final-sam2.json','sam2-inset20-r2/sam2-refresh.json','assistant-boundary-corrections.json']})
assert len(main['entries'])==801 and len(main['proposals'])==852
(r/'sam2-final/sam2-refresh.json').write_text(json.dumps(main,indent=2));(r/'new-location-final-sam2.json').write_text(json.dumps(new,indent=2));print('Final model: 801 distinct inherited masks plus 51 distinct new-location masks')
# Proposed decisions are recorded only after visual review. Keep the raw model geometry immutable.
corrections={x['hintId']:x for x in json.loads((r/'assistant-boundary-corrections.json').read_text())};props={p['id']:p for p in main['proposals']};actions=[];decisions=[]
for e in main['entries']:
 p=props[e['proposalId']];assert p['oldHoldIds']==[e['oldHoldId']];hold={k:p[k] for k in ['kind','center','polygon']};hold['id']=e['oldHoldId'];actions.append(dict(type='refine',id=hold['id'],hold=hold,coverageFraction=p['evidence']['observedFraction']));decisions.append(dict(id=hold['id'],identity='same-physical-hold; retain ID',geometrySource=p['id'],evidenceSector=1+min(2,int(hold['center'][1]*3))*3+min(2,int(hold['center'][0]*3)),reviewerKind='assistant'))
for p in new['proposals']:
 hold={k:p[k] for k in ['kind','center','polygon']};hold['id']='new-v9-'+hashlib.sha256(p['id'].encode()).hexdigest()[:14]
 if p['hintId'] in corrections:hold.update({k:corrections[p['hintId']][k] for k in ['center','polygon']})
 actions.append(dict(type='add',hold=hold,coverageFraction=1));decisions.append(dict(id=hold['id'],identity='new physical hold; fresh ID',hintId=p['hintId'],geometrySource='assistant-boundary-correction' if p['hintId'] in corrections else p['id'],reviewerKind='assistant'))
(r/'assistant-decisions.json').write_text(json.dumps(dict(reviewer='Codex (assistant visual review)',reviewerKind='assistant',publishable=False,actions=actions,decisions=decisions,unresolved=[]),indent=2))
