import sys,json,hashlib,time
from pathlib import Path
sys.path.insert(0,'/workspace/Stoneham-spraywall-project')
import cv2,numpy as np,torch
from PIL import Image
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor
from tools.wall_rescan.sam2_refresh import inset_prompt_for,select_mask
r=Path('/workspace/wall-comparison-2026-11-21');base=r/'new-wall-preview-r2';image=Image.open(base/'wall.jpg').convert('RGB');size=image.size;coverage=np.array(Image.open(base/'coverage.png'));uncertainty=np.array(Image.open(base/'uncertainty.png'));hints=json.loads((r/'new-location-hints.json').read_text());sha=hashlib.sha256((base/'wall.jpg').read_bytes()).hexdigest();start=time.monotonic()
cv2.setNumThreads(1);torch.set_num_threads(1);torch.manual_seed(0)
predictor=SAM2ImagePredictor(build_sam2('configs/sam2.1/sam2.1_hiera_s.yaml','/tmp/stoneham-sam2-models/sam2.1_hiera_small.pt',device='cpu',apply_postprocessing=False));proposals=[];records=[]
with torch.inference_mode():
 for row in range(3):
  for col in range(3):
   group=[h for h in hints if min(2,int(h['center'][0]*3))==col and min(2,int(h['center'][1]*3))==row]
   if not group:continue
   region=[max(0,round(col*size[0]/3)-180),max(0,round(row*size[1]/3)-180),min(size[0],round((col+1)*size[0]/3)+180),min(size[1],round((row+1)*size[1]/3)+180)];left,top,_,_=region;predictor.set_image(np.array(image.crop(region),copy=True))
   for hint in group:
    points,box,info=inset_prompt_for(hint,size,.2);masks,scores,_=predictor.predict(point_coords=np.asarray(points,np.float32)-[left,top],point_labels=np.ones(len(points),np.int32),box=np.asarray(box)-[left,top,left,top],multimask_output=True);best=select_mask(masks,scores,hint,points[0],region,coverage,uncertainty,size,.65);rec=dict(hint=hint['id'],modelScores=scores.tolist(),promptPoints=points,promptBox=box)
    if best:
     best.update(id='sam2-v9-new-'+hashlib.sha256((sha+hint['id']).encode()).hexdigest()[:14],oldHoldIds=[],newLocation=True,status='needs-review',hintName=hint['name'],hintId=hint['id']);proposals.append(best);rec['proposalId']=best['id'];rec['evidence']=best['evidence']
    else:rec['failure']='no-usable-mask'
    records.append(rec);print(hint['id'],rec.get('failure','ok'),flush=True)
   (r/'new-location-sam2-r2.json').write_text(json.dumps(dict(publishable=False,imageSHA256=sha,proposals=proposals,records=records,elapsedSeconds=time.monotonic()-start),indent=2))
print('Done',len(proposals),'/',len(hints),flush=True)
