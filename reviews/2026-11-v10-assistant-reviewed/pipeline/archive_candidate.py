from pathlib import Path
import sys,json,shutil,hashlib,datetime
import cv2,numpy as np
from PIL import Image,ImageDraw
sys.path.insert(0,'/workspace/Stoneham-spraywall-project')
from tools.wall_rescan.sam2_refresh import coverage_fraction,polygon_overlap
r=Path('/workspace/wall-comparison-2026-11-27');repo=Path('/workspace/Stoneham-spraywall-project');out=repo/'reviews/2026-11-v10-assistant-reviewed';out.mkdir(exist_ok=False);base=r/'new-wall-preview-r2';review=r/'assistant-reviewed';bundle=r/'v10-review-bundle';summary=json.loads((review/'summary.json').read_text())
def cp(src,name):
 dst=out/name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dst)
def write(name,obj):(out/name).write_text(json.dumps(obj,indent=2)+'\n')
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
for name in ['wall.jpg','coverage.png','uncertainty.png','source-index.png']:cp(base/name,name)
cp(base/'sam2-candidate-manifest.json','candidate-manifest.json');cp(base/'manifest.json','composition-manifest.json')
for name in ['review-progress.json','confirmed-geometry.json']:cp(review/name,name)
for name in ['manifest.json','holds_prelabels.json','review_queue.json','report.json','sam2-proposals.json']:cp(bundle/name,'baseline/'+name)
for name in ['assistant-decisions.json','assistant-boundary-corrections.json','assistant-old-boundary-corrections.json','new-location-hints.json','new-component-review.json','identity-review-plan.json','originals-manifest.json','reference-live-verification.json','registration-summary.json','hold-comparison-scores.json','rotation-triage.json','rejected-first-pass-geometry-qa.json']:cp(r/name,name)
for name in ['sam2-inherited/sam2-refresh.json','new-location-sam2-r2.json','new-local-trials.json','inherited-local-trials.json','new-location-final-sam2.json','assistant-boundary-corrections.json','assistant-old-boundary-corrections.json','identity-review-plan.json','new-component-review.json']:cp(r/name,'inference/'+name)
for name in ['preview.jpg','previous-vs-new.gif','side-by-side.jpg',*[f'bottom-{i+1}.gif' for i in range(4)]]:cp(base/name,'comparisons/'+name)
for path in r.glob('*.py'):cp(path,'pipeline/'+path.name)
cp(r/'record_assistant_review.mjs','pipeline/record_assistant_review.mjs');cp(r/'viewer-template.html','pipeline/viewer-template.html')
for i in range(3):cp(base/f'alignment-{i}.npz',f'alignment/alignment-{i}.npz');cp(r/f'geometry-{i}.npz',f'alignment/global-geometry-{i}.npz')
for pattern in ['suspects-*.jpg','identity-detail-*.jpg','change-detail-*.jpg','new-candidates-*.jpg','new-model-review-*.jpg','new-local-review-*.jpg','inherited-local-review-*.jpg','assistant*boundaries.jpg','bottom-image-check.jpg']:
 for path in r.glob(pattern):cp(path,'evidence/'+path.name)
for path in (r/'visual-review').glob('identity-sector-*.jpg'):cp(path,'evidence/'+path.name)
for path in (r/'visual-review-model').glob('sector-*.jpg'):cp(path,'evidence/model-'+path.name)
for name in ['boundary-crop-metadata.json','old-boundary-crop-metadata.json','inherited-local-review-order.json']:cp(r/name,'evidence/'+name)
holds=json.loads((review/'confirmed-geometry.json').read_text())['holds'];old=json.loads((r/'reference-holds.json').read_text());oldids={h['id'] for h in old};ids={h['id'] for h in holds};coverage=np.array(Image.open(base/'coverage.png'));fractions=[coverage_fraction(h['polygon'],coverage,(7292,5514)) for h in holds];bounds=[(np.min(h['polygon'],axis=0),np.max(h['polygon'],axis=0)) for h in holds];duplicates=[]
for i,h in enumerate(holds):
 for j in range(i+1,len(holds)):
  if np.any(bounds[i][1]<bounds[j][0]) or np.any(bounds[j][1]<bounds[i][0]):continue
  iou,containment=polygon_overlap(h['polygon'],holds[j]['polygon'],(7292,5514))
  if iou>.85:duplicates.append(dict(ids=[h['id'],holds[j]['id']],iou=iou))
qa=dict(holdCount=len(holds),uniqueIds=len(ids),retainedOldIds=len(oldids&ids),newIds=len(ids-oldids),removedOldIds=sorted(oldids-ids),minimumNewPhotoCoverage=min(fractions),holdsBelow99PercentCoverage=sum(v<.99 for v in fractions),nearIdenticalPolygons=duplicates,allowedOverlap='Separate holds mounted on volumes may have containment; containment alone is not duplication.')
write('geometry-qa.json',qa);assert len(ids)==len(holds) and not duplicates and min(fractions)>=.99
raw=json.loads((r/'route-snapshot-private.json').read_text());assert not raw.get('nextCursor');valid=[p for p in raw['items'] if all(h['holdId'] in ids for h in p['holds'])];impact=dict(mode='read-only public API impact assessment; no database writes',observedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),listedRouteRecords=len(raw['items']),wouldSupportV10=len(valid),wouldBeHistorical=len(raw['items'])-len(valid),newlyOutdatedComparedWithV9=sum(p.get('outdated') is not True and p not in valid for p in raw['items']),scope='Public route-list snapshot only; actual publication must scan every stored route and cursor.')
write('route-impact.json',impact);summary.update(geometryQA=qa,newLocationPromptCount=30,acceptedNewLocationHolds=29,dismissedDuplicateNewLocationHints=['nov27-R19'],poseChangesWithFreshIds=10,manualNewBoundaryCorrections=11,manualInheritedBoundaryCorrections=2,localInheritedReprompts=41,selectedLocalInheritedMasks=6,routeImpact=impact);write('summary.json',summary)
im=Image.open(base/'wall.jpg');im.thumbnail((2400,2400));d=ImageDraw.Draw(im)
for h in holds:
 pts=[(x*im.width,y*im.height) for x,y in h['polygon']];d.line(pts+[pts[0]],fill='#ffff26' if h['id'] not in oldids else '#11e0d0',width=2 if h['id'] not in oldids else 1)
im.save(out/'confirmed-overlay.jpg',quality=95)
for row in range(3):
 for col in range(3):
  source=Image.open(base/'wall.jpg');rect=(max(0,col/3-.012),max(0,row/3-.012),min(1,(col+1)/3+.012),min(1,(row+1)/3+.012));box=(round(rect[0]*7292),round(rect[1]*5514),round(rect[2]*7292),round(rect[3]*5514));crop=source.crop(box);crop.thumbnail((1800,1400));draw=ImageDraw.Draw(crop)
  for h in holds:
   if not(rect[0]<=h['center'][0]<=rect[2] and rect[1]<=h['center'][1]<=rect[3]):continue
   pts=[((x*7292-box[0])*crop.width/(box[2]-box[0]),(y*5514-box[1])*crop.height/(box[3]-box[1])) for x,y in h['polygon']];draw.line(pts+[pts[0]],fill='#ffff26' if h['id'] not in oldids else '#11e0d0',width=2 if h['id'] not in oldids else 1)
  crop.save(out/f'evidence/final-sector-{row*3+col+1}.jpg',quality=95)
print(json.dumps(dict(archive=str(out),qa=qa,impact=impact),indent=2))
