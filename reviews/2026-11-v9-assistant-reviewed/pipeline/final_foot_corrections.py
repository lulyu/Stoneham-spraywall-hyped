from pathlib import Path
import json
r=Path('/workspace/wall-comparison-2026-11-21');boxes=json.loads((r/'manual-old-foot-boxes.json').read_text());old={h['id']:h for h in json.loads((r/'reference-holds.json').read_text())};polys={
'manual-60a23a83b3ca':[(152,141),(228,139),(249,160),(249,248),(233,290),(208,313),(178,288),(132,250),(137,207)],
'scan-75b8a71e-1ce5-4413-a479-d66735c7ad78':[(173,212),(185,170),(200,128),(226,112),(255,113),(286,121),(311,139),(323,165),(319,199),(300,247),(280,280),(251,294),(220,293),(193,280),(179,252)]}
a=json.loads((r/'assistant-decisions.json').read_text());records=[]
for identifier,points in polys.items():
 x0,y0,x1,y1=boxes[identifier];polygon=[[(x0+x*(x1-x0)/400)/7292,(y0+y*(y1-y0)/400)/5514] for x,y in points];h={**old[identifier], 'polygon':polygon,'center':[sum(x for x,y in polygon)/len(polygon),sum(y for x,y in polygon)/len(polygon)]};a['actions'].append(dict(type='refine',id=identifier,hold=h,coverageFraction=1));records.append(dict(id=identifier,reviewerKind='assistant',method='visual boundary correction; retain white cube body and exclude kickboard shadow; pink hold excludes cast shadow',cropVertices=points,cropBox=boxes[identifier],evidence='manual-old-foot-boundaries.jpg'))
(r/'assistant-foot-corrections.json').write_text(json.dumps(records,indent=2));(r/'assistant-decisions.json').write_text(json.dumps(a,indent=2))
p=r/'record_assistant_review.mjs';s=p.read_text().replace('let state=baseline;',"let state=fs.existsSync(root+'/assistant-reviewed/review-progress.json')?validateProgress(read(root+'/assistant-reviewed/review-progress.json'),baseline):baseline;\nconst already=state.reviewRevision;").replace('for(const action of plan.actions)','for(const action of plan.actions.slice(already))');p.write_text(s)
