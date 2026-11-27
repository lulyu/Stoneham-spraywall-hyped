from pathlib import Path
import json,hashlib,copy
r=Path('/workspace/wall-comparison-2026-11-27');main=json.loads((r/'sam2-inherited/sam2-refresh.json').read_text());new=json.loads((r/'new-location-final-sam2.json').read_text());local=json.loads((r/'inherited-local-trials.json').read_text());chosen={'manual-fe6f9e6d46f2','manual-bbee7b567dbd','manual-fde8b33b9f26','manual-1801f8273d6e','scan-835088bb-8077-4a5a-8fdf-8ccfd7c8531c','scan-7d0a8be5-a28b-440b-8459-e684069a33ef'}
byold={p['oldHoldIds'][0]:p for p in local['proposals'] if p['oldHoldIds'][0] in chosen}
for p in main['proposals']:p['oldHoldIds']=[i for i in p['oldHoldIds'] if i not in byold]
main['proposals']=[p for p in main['proposals'] if p['oldHoldIds']]+list(byold.values())+new['proposals']
for e in main['entries']:
 if e['oldHoldId'] in byold:
  p=byold[e['oldHoldId']];e.update(proposalId=p['id'],evidence=p['evidence'],recommendation='local-refinement-needs-review');e['reasonCodes'].append('local-reprompt-after-visual-inspection')
provenance=['sam2-inherited/sam2-refresh.json','new-location-sam2-r2.json','new-local-trials.json','inherited-local-trials.json','new-location-final-sam2.json','assistant-boundary-corrections.json','identity-review-plan.json','new-component-review.json','assistant-old-boundary-corrections.json']
main['metadata'].update(proposalCount=len(main['proposals']),additionalNewLocationPromptCount=30,additionalNewLocationProposalCount=30,localInheritedRepromptCount=len(local['records']),selectedLocalInheritedCount=len(byold),localTrialsSelection='Visual comparison; rejected trials retained separately.',provenance={p:hashlib.sha256((r/p).read_bytes()).hexdigest() for p in provenance})
(r/'sam2-final').mkdir(exist_ok=True);(r/'sam2-final/sam2-refresh.json').write_text(json.dumps(main,indent=2)+'\n')
plan=json.loads((r/'identity-review-plan.json').read_text());changes={v['id']:v for v in plan['decisions']};props={p['id']:p for p in main['proposals']};corrections={v['hintId']:v for v in json.loads((r/'assistant-boundary-corrections.json').read_text())};actions=[];decisions=[];unresolved=[];primary={};old_corrections={x['id']:x for x in json.loads((r/'assistant-old-boundary-corrections.json').read_text())}
for v in changes.values():
 if v.get('newHint') not in primary and v.get('newHint'):primary[v['newHint']]=v['id']
for e in main['entries']:
 identifier=e['oldHoldId'];p=props.get(e['proposalId']);change=changes.get(identifier)
 if identifier in old_corrections:p={**old_corrections[identifier],'id':'assistant-boundary-correction','kind':e['oldGeometry']['kind'],'oldHoldIds':[identifier],'evidence':{'observedFraction':1}}
 if change and change['decision']=='remove-old-position':
  if primary.get(change['newHint'])!=identifier:actions.append(dict(type='remove',id=identifier))
  decisions.append(dict(id=identifier,identity=change['decision'],reason=change['reason'],newHint=change['newHint'],reviewerKind='assistant'));continue
 if not p or len(p['oldHoldIds'])!=1:
  unresolved.append(dict(id=identifier,reason='No visually accepted independent outline'));continue
 hold={k:p[k] for k in ['kind','center','polygon']}
 if change:
  hold['id']='new-v10-pose-'+hashlib.sha256(identifier.encode()).hexdigest()[:14];actions.append(dict(type='add',hold=hold,replaces=identifier,coverageFraction=p['evidence']['observedFraction']));decisions.append(dict(id=identifier,newId=hold['id'],identity='changed pose; fresh ID',reason=change['reason'],geometrySource=p['id'],reviewerKind='assistant'))
 else:
  hold['id']=identifier;actions.append(dict(type='refine',id=identifier,hold=hold,coverageFraction=p['evidence']['observedFraction']));decisions.append(dict(id=identifier,identity='same hold and position; camera/outline refinement',geometrySource=p['id'],evidenceSector=1+min(2,int(hold['center'][1]*3))*3+min(2,int(hold['center'][0]*3)),reviewerKind='assistant'))
for p in new['proposals']:
 if p['hintId']=='nov27-R19':continue
 hold={k:p[k] for k in ['kind','center','polygon']};hold['id']='new-v10-'+hashlib.sha256(p['hintId'].encode()).hexdigest()[:14]
 if p['hintId'] in corrections:hold.update({k:corrections[p['hintId']][k] for k in ['center','polygon']})
 action=dict(type='add',hold=hold,coverageFraction=p['evidence']['observedFraction'])
 if p['hintId'] in primary:action['replaces']=primary[p['hintId']]
 actions.append(action);decisions.append(dict(id=hold['id'],identity='new grip configuration; fresh ID',hintId=p['hintId'],replaces=action.get('replaces'),geometrySource='assistant-boundary-correction' if p['hintId'] in corrections else p['id'],reviewerKind='assistant'))
(r/'assistant-decisions.json').write_text(json.dumps(dict(reviewer='Codex (assistant visual review)',reviewerKind='assistant',publishable=False,actions=actions,decisions=decisions,unresolved=unresolved),indent=2)+'\n');print(dict(proposals=len(main['proposals']),selectedLocal=len(byold),actions=len(actions),unresolved=unresolved))
