import sys,json,hashlib,time
from pathlib import Path
sys.path.insert(0,'/workspace/Stoneham-spraywall-project')
import cv2,numpy as np,torch
from PIL import Image
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor
from tools.wall_rescan.sam2_refresh import select_mask
r=Path('/workspace/wall-comparison-2026-11-21');base=r/'new-wall-preview-r2';image=Image.open(base/'wall.jpg').convert('RGB');reference=Image.open(r/'current-site-wall.jpg').convert('RGB');size=image.size;coverage=np.array(Image.open(base/'coverage.png'));uncertainty=np.array(Image.open(base/'uncertainty.png'));hints=json.loads((r/'new-location-hints.json').read_text());old=json.loads((r/'reference-holds.json').read_text());sha=hashlib.sha256((base/'wall.jpg').read_bytes()).hexdigest();start=time.monotonic();out=r/'new-location-focused-sam2.json'
cv2.setNumThreads(1);torch.set_num_threads(1);torch.manual_seed(0);predictor=SAM2ImagePredictor(build_sam2('configs/sam2.1/sam2.1_hiera_s.yaml','/tmp/stoneham-sam2-models/sam2.1_hiera_small.pt',device='cpu',apply_postprocessing=False));prior=json.loads((r/'new-location-local-sam2.json').read_text());proposals=prior['proposals'];records=prior['records'];done={p['hintId'] for p in proposals};focus={7,17,20,25,26,27,35,36,38,41,51};hints=[h for h in hints if h['sourceComponent'] in focus and h['id'] not in done]
with torch.inference_mode():
 for hint in hints:
  poly=np.array(hint['polygon'])*size;lo=poly.min(axis=0);hi=poly.max(axis=0);mid=(lo+hi)/2;span=max(420,float((hi-lo).max())+220);region=[max(0,round(mid[0]-span/2)),max(0,round(mid[1]-span/2)),min(size[0],round(mid[0]+span/2)),min(size[1],round(mid[1]+span/2))];left,top,right,bottom=region;im=np.array(image.crop(region));ref=np.array(reference.crop(region));lab=cv2.cvtColor(im,cv2.COLOR_RGB2LAB).astype(float);rlab=cv2.cvtColor(ref,cv2.COLOR_RGB2LAB).astype(float);sat=cv2.cvtColor(im,cv2.COLOR_RGB2HSV)[:,:,1];diff=np.linalg.norm(lab[:,:,1:]-rlab[:,:,1:],axis=2);mask=((sat>45)&(diff>10)).astype(np.uint8)
  zone=np.zeros(mask.shape,np.uint8);cv2.fillPoly(zone,[np.rint(poly-[left,top]).astype(np.int32)],1);mask&=zone
  negatives=[]
  for h in old:
   cx,cy=np.array(h['center'])*size
   if not(left<cx<right and top<cy<bottom):continue
   negatives.append([cx-left,cy-top]);p=np.rint(np.array(h['polygon'])*size-[left,top]).astype(np.int32);cv2.fillPoly(mask,[p],0)
  num,labels,stats,centers=cv2.connectedComponentsWithStats(mask)
  if num<2:raise RuntimeError('No color-positive interior '+hint['id'])
  component=labels==1+int(np.argmax(stats[1:,cv2.CC_STAT_AREA]));dist=cv2.distanceTransform(component.astype(np.uint8),cv2.DIST_L2,5);points=[]
  for _ in range(3):
   _,v,_,loc=cv2.minMaxLoc(dist)
   if v<2:break
   points.append(list(loc));cv2.circle(dist,loc,max(6,int(v*1.5)),0,-1)
  predictor.set_image(np.array(im,copy=True));seed=np.array(points[0])+[left,top]
  box=[lo[0]-left-6,lo[1]-top-6,hi[0]-left+6,hi[1]-top+6]
  coords=np.asarray(points+negatives,np.float32);plabels=np.array([1]*len(points)+[0]*len(negatives),np.int32)
  masks,scores,_=predictor.predict(point_coords=coords,point_labels=plabels,box=np.array(box),multimask_output=True);best=select_mask(masks,scores,hint,seed,region,coverage,uncertainty,size,.65);rec=dict(hint=hint['id'],modelScores=scores.tolist(),positivePoints=[[p[0]+left,p[1]+top] for p in points],negativePoints=[[p[0]+left,p[1]+top] for p in negatives],crop=region,promptBox=box)
  if best:
   best.update(id='sam2-v9-new-'+hashlib.sha256((sha+hint['id']).encode()).hexdigest()[:14],oldHoldIds=[],newLocation=True,status='needs-review',hintName=hint['name'],hintId=hint['id']);proposals.append(best);rec['proposalId']=best['id'];rec['evidence']=best['evidence']
  else:rec['failure']='no-usable-mask'
  records.append(rec);out.write_text(json.dumps(dict(publishable=False,imageSHA256=sha,proposals=proposals,records=records,elapsedSeconds=time.monotonic()-start,promptPolicy='local native crop; positive seeds inside observed new color component; neighboring old hold centers negative; visual review required'),indent=2));print(hint['id'],rec.get('failure','ok'),flush=True)
print('Done',len(proposals),'/',len(hints),flush=True)
