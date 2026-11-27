from pathlib import Path
import sys,json,hashlib,time
sys.path.insert(0,'/workspace/Stoneham-spraywall-project')
import cv2,numpy as np,torch
from PIL import Image
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor
from tools.wall_rescan.sam2_refresh import inset_prompt_for,select_mask
r=Path('/workspace/wall-comparison-2026-11-27');base=r/'new-wall-preview-r2';image=Image.open(base/'wall.jpg').convert('RGB');size=image.size;coverage=np.array(Image.open(base/'coverage.png'));uncertainty=np.array(Image.open(base/'uncertainty.png'));hints=json.loads((r/'new-location-hints.json').read_text());raw=json.loads((r/'new-location-sam2-r2.json').read_text());byhint={p['hintId']:p for p in raw['proposals']};sha=hashlib.sha256((base/'wall.jpg').read_bytes()).hexdigest();cv2.setNumThreads(1);torch.set_num_threads(1);torch.manual_seed(0);predictor=SAM2ImagePredictor(build_sam2('configs/sam2.1/sam2.1_hiera_s.yaml','/tmp/stoneham-sam2-models/sam2.1_hiera_small.pt',device='cpu',apply_postprocessing=False));proposals=[];records=[]
with torch.inference_mode():
 for h in hints:
  p=byhint.get(h['id'],h);points,_,info=inset_prompt_for(p,size,.3,max_points=3);q=np.array(h['polygon'])*size;x0,y0=q.min(axis=0);x1,y1=q.max(axis=0);region=[max(0,int(x0-120)),max(0,int(y0-120)),min(size[0],int(x1+120)),min(size[1],int(y1+120))];left,top,_,_=region;box=np.array([x0-4,y0-4,x1+4,y1+4]);neg=[[x0-9,y0-9],[x1+9,y0-9],[x1+9,y1+9],[x0-9,y1+9]];coords=np.array(points+neg,np.float32)-[left,top];predictor.set_image(np.array(image.crop(region),copy=True));masks,scores,_=predictor.predict(point_coords=coords,point_labels=np.array([1]*len(points)+[0]*len(neg)),box=box-[left,top,left,top],multimask_output=True);best=select_mask(masks,scores,h,points[0],region,coverage,uncertainty,size,.4);rec=dict(id=h['id'],region=region,positive=points,negative=neg,box=box.tolist(),modelScores=scores.tolist())
  if best:
   best.update(id='sam2-v10-new-local-'+hashlib.sha256((sha+h['id']).encode()).hexdigest()[:14],oldHoldIds=[],newLocation=True,status='needs-review',hintName=h['name'],hintId=h['id']);proposals.append(best);rec['proposalId']=best['id']
  else:rec['failure']='no-mask'
  records.append(rec);(r/'new-local-trials.json').write_text(json.dumps(dict(publishable=False,imageSha256=sha,proposals=proposals,records=records),indent=2));print(h['id'],rec.get('failure','ok'),flush=True)
