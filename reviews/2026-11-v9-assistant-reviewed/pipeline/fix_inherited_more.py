import sys,json,hashlib,time
from pathlib import Path
sys.path.insert(0,'/workspace/Stoneham-spraywall-project')
import cv2,numpy as np,torch
from PIL import Image
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor
from tools.wall_rescan.sam2_refresh import select_mask
r=Path('/workspace/wall-comparison-2026-11-21');base=r/'new-wall-preview-r2';image=Image.open(base/'wall.jpg').convert('RGB');reference=Image.open(r/'current-site-wall.jpg').convert('RGB');size=image.size;coverage=np.array(Image.open(base/'coverage.png'));uncertainty=np.array(Image.open(base/'uncertainty.png'));old=json.loads((r/'reference-holds.json').read_text());sha=hashlib.sha256((base/'wall.jpg').read_bytes()).hexdigest();bad=[old[i]['id'] for i in [395,632,630,631,581,796]];prior=json.loads((r/'inherited-local-sam2.json').read_text());proposals=prior['proposals'];records=prior['records'];cv2.setNumThreads(2);torch.set_num_threads(2);torch.manual_seed(0);predictor=SAM2ImagePredictor(build_sam2('configs/sam2.1/sam2.1_hiera_s.yaml','/tmp/stoneham-sam2-models/sam2.1_hiera_small.pt',device='cpu',apply_postprocessing=False))
with torch.inference_mode():
 for identifier in bad:
  hold=next(h for h in old if h['id']==identifier);cx,cy=np.array(hold['center'])*size;region=[max(0,round(cx-220)),max(0,round(cy-200)),min(size[0],round(cx+220)),min(size[1],round(cy+200))];left,top,right,bottom=region;im=np.array(image.crop(region));ref=np.array(reference.crop(region));hsv=cv2.cvtColor(im,cv2.COLOR_RGB2HSV);rhsv=cv2.cvtColor(ref,cv2.COLOR_RGB2HSV);poly=np.rint(np.array(hold['polygon'])*size-[left,top]).astype(np.int32);zone=np.zeros(im.shape[:2],np.uint8);cv2.fillPoly(zone,[poly],1);values=rhsv[zone>0];colored=values[values[:,1]>45];isblack=len(colored)<len(values)*.2
  if isblack:mask=(hsv[:,:,2]<140).astype(np.uint8)
  else:
   hue=float(np.median(colored[:,0]));diff=np.abs(hsv[:,:,0].astype(float)-hue);diff=np.minimum(diff,180-diff);mask=((hsv[:,:,1]>40)&(diff<22)).astype(np.uint8)
  num,labels,stats,centers=cv2.connectedComponentsWithStats(mask);candidates=[i for i in range(1,num) if stats[i,cv2.CC_STAT_AREA]>40];which=min(candidates,key=lambda i:np.linalg.norm(centers[i]-[cx-left,cy-top]));component=(labels==which).astype(np.uint8);dist=cv2.distanceTransform(component,cv2.DIST_L2,5);_,_,_,loc=cv2.minMaxLoc(dist);seed=np.array(loc)+[left,top];x,y,w,h,_=stats[which];box=np.array([x-5,y-5,x+w+5,y+h+5]);negatives=[[x-10,y-10],[x+w+10,y-10],[x-10,y+h+10],[x+w+10,y+h+10]];points=np.asarray([loc,*negatives],np.float32);predictor.set_image(im);masks,scores,_=predictor.predict(point_coords=points,point_labels=np.array([1,0,0,0,0]),box=box,multimask_output=True);best=select_mask(masks,scores,hold,seed,region,coverage,uncertainty,size,.45)
  rec=dict(id=identifier,seed=seed.tolist(),region=region,modelScores=scores.tolist())
  if best:
   best.update(id='sam2-v9-local-'+hashlib.sha256((sha+identifier).encode()).hexdigest()[:14],oldHoldIds=[identifier],status='needs-review');proposals.append(best);rec['proposalId']=best['id']
  else:rec['failure']='no-usable-mask'
  records.append(rec);(r/'inherited-local-final-sam2.json').write_text(json.dumps(dict(imageSHA256=sha,proposals=proposals,records=records,publishable=False),indent=2));print(identifier,rec.get('failure','ok'),flush=True)
