from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import hashlib,json,shutil,datetime,numpy as np,cv2,sys
sys.path.insert(0,'/workspace/Stoneham-spraywall-project')
from tools.wall_rescan.sam2_refresh import coverage_fraction,polygon_overlap
r=Path('/workspace/wall-comparison-2026-11-21');repo=Path('/workspace/Stoneham-spraywall-project');out=repo/'reviews/2026-11-v9-assistant-reviewed';out.mkdir(exist_ok=False);base=r/'new-wall-preview-r2';bundle=r/'v9-review-bundle';review=r/'assistant-reviewed';summary=json.loads((review/'summary.json').read_text());assert summary['reviewRevision']==854

def copy(src,name):
 dst=out/name;dst.parent.mkdir(exist_ok=True,parents=True);shutil.copy2(src,dst)
def write(name,data):(out/name).write_text(json.dumps(data,indent=2)+'\n')
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
for name in ['wall.jpg','coverage.png','source-index.png','uncertainty.png']:copy(base/name,name)
copy(base/'sam2-candidate-manifest.json','candidate-manifest.json');copy(base/'manifest.json','composition-manifest.json');copy(review/'confirmed-geometry.json','confirmed-geometry.json');copy(review/'review-progress.json','review-progress-r854.json')
for name in ['manifest.json','holds_prelabels.json','review_queue.json','report.json','sam2-proposals.json']:copy(bundle/name,'baseline/'+name)
for name in ['assistant-decisions.json','assistant-boundary-corrections.json','assistant-foot-corrections.json','new-location-hints.json','new-component-review.json','originals-manifest.json','production-reference-check.json']:copy(r/name,name)
for name in ['new-location-sam2-r2.json','new-location-focused-sam2.json','inherited-local-final-sam2.json','sam2-inset20-r2/sam2-refresh.json','assistant-boundary-corrections.json','new-location-hints.json','new-component-review.json']:copy(r/name,'inference/'+name)
for name in ['preview.jpg','previous-vs-new.gif','side-by-side.jpg',*[f'bottom-{i+1}.gif' for i in range(4)]]:copy(base/name,'comparisons/'+name)
for name in ['assistant-corrected-boundaries.jpg','kickboard-seam-fix.jpg','manual-new-boundaries-1.jpg','manual-new-boundaries-2.jpg','manual-old-foot-boundaries.jpg','inherited-local-review.jpg','new-candidates-1.jpg','new-candidates-2.jpg','new-candidates-3.jpg']:copy(r/name,'evidence/'+name)
for i in range(1,10):
 copy(r/f'visual-review/identity-sector-{i}.jpg',f'evidence/identity-sector-{i}.jpg');copy(r/f'visual-review-model/sector-{i}.jpg',f'evidence/model-sector-{i}.jpg')
for name in ['register_compare.py','build_candidate.py','fix_kickboard.py','prepare_sam2_candidate_r2.py','run_new_sam2_r2.py','refine_new_local.py','refine_new_focused.py','fix_inherited_local.py','fix_inherited_more.py','manual_boundary_decisions.py','final_foot_corrections.py','assemble_final_model.py','record_assistant_review.mjs']:copy(r/name,'pipeline/'+name)
for i in range(3):copy(base/f'alignment-{i}.npz',f'alignment/alignment-{i}.npz')
# Geometry and duplicate QA is separate from the visual review decisions.
holds=json.loads((review/'confirmed-geometry.json').read_text())['holds'];old=json.loads((r/'reference-holds.json').read_text());oldids={h['id'] for h in old};coverage=np.array(Image.open(base/'coverage.png'));fractions=[coverage_fraction(h['polygon'],coverage,(7292,5514)) for h in holds];bounds=[(np.min(h['polygon'],axis=0),np.max(h['polygon'],axis=0)) for h in holds];duplicates=[]
for i,h in enumerate(holds):
 for j in range(i+1,len(holds)):
  if np.any(bounds[i][1]<bounds[j][0]) or np.any(bounds[j][1]<bounds[i][0]):continue
  iou,containment=polygon_overlap(h['polygon'],holds[j]['polygon'],(7292,5514))
  if iou>.85:duplicates.append(dict(ids=[h['id'],holds[j]['id']],iou=iou))
qa=dict(holdCount=len(holds),uniqueIds=len({h['id'] for h in holds}),retainedOldIds=len(oldids&{h['id'] for h in holds}),newIds=len({h['id'] for h in holds}-oldids),minimumNewPhotoCoverage=min(fractions),holdsBelow99PercentCoverage=sum(x<.99 for x in fractions),nearIdenticalPolygons=duplicates,allowedOverlap='Small holds mounted on macro volumes retain separate IDs; containment alone is not a duplicate.')
assert qa['holdCount']==qa['uniqueIds']==852 and qa['retainedOldIds']==801 and not duplicates
write('geometry-qa.json',qa)
raw=json.loads((r/'route-snapshot-private.json').read_text());valid=[p for p in raw['items'] if all(h['holdId'] in {x['id'] for x in holds} for h in p['holds'])];impact=dict(mode='read-only-impact-assessment; no database writes',observedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),listedRouteRecords=len(raw['items']),wouldSupportV9=len(valid),wouldRemainHistorical=len(raw['items'])-len(valid),newlyOutdatedComparedWithV8=sum(p.get('outdated') is not True and p not in valid for p in raw['items']),scope='Public wall route-list snapshot, not an admin publication sweep; re-scan all stored routes during actual publication.')
write('route-impact.json',impact)
summary.update(checkpoint='review-progress-r854.json',geometryQA=qa,manualNewBoundaryCorrections=11,manualKickboardBoundaryCorrections=2,localInheritedReprompts=13,newLocationDecisions=[dict(proposalId=p['id'],hintId=p['hintId'],reviewHoldId='new-v9-'+hashlib.sha256(p['id'].encode()).hexdigest()[:14],resolved=True) for p in json.loads((r/'new-location-sam2-r2.json').read_text())['proposals']]);write('summary.json',summary)
im=Image.open(out/'wall.jpg').convert('RGB');im.thumbnail((2400,2400));d=ImageDraw.Draw(im);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',15)
for h in holds:
 pts=[(x*im.width,y*im.height) for x,y in h['polygon']];isnew=h['id'] not in oldids;d.line(pts+[pts[0]],fill='#ffff26' if isnew else '#11e0d0',width=3 if isnew else 1)
im.save(out/'confirmed-overlay.jpg',quality=95)
# The publication step must verify these exact bytes again.
assets={str(p.relative_to(out)):{'sha256':sha(p),'bytes':p.stat().st_size} for p in sorted(out.rglob('*')) if p.is_file()};write('archive-manifest.json',dict(format='stoneham-wall-assistant-review-archive-v1',publishable=False,referenceImage=dict(path='public/wall/versions/2026-11-v8/wall.jpg',sha256=sha(r/'current-site-wall.jpg')),referenceHolds=dict(path='src/data/walls/2026-11-v8/holds.json',sha256=sha(r/'reference-holds.json')),assets=assets))
print(json.dumps(dict(archive=str(out),qa=qa,routeImpact=impact,totalBytes=sum(x['bytes'] for x in assets.values())),indent=2))
