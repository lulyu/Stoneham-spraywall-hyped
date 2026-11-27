from pathlib import Path
import sys,json,hashlib
sys.path.insert(0,'/workspace/Stoneham-spraywall-project')
import cv2,numpy as np,torch
from PIL import Image
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor
from tools.wall_rescan.sam2_refresh import inset_prompt_for,select_mask
r=Path('/workspace/wall-comparison-2026-11-27');base=r/'new-wall-preview-r2';image=Image.open(base/'wall.jpg').convert('RGB');size=image.size;coverage=np.array(Image.open(base/'coverage.png'));uncertainty=np.array(Image.open(base/'uncertainty.png'));model=json.loads((r/'sam2-inherited/sam2-refresh.json').read_text());old={e['oldHoldId']:e['oldGeometry'] for e in model['entries']};ids=json.loads((r/'inherited-local-ids.json').read_text());sha=hashlib.sha256((base/'wall.jpg').read_bytes()).hexdigest();cv2.setNumThreads(2);torch.set_num_threads(2);torch.manual_seed(0);predictor=SAM2ImagePredictor(build_sam2('configs/sam2.1/sam2.1_hiera_s.yaml','/tmp/stoneham-sam2-models/sam2.1_hiera_small.pt',device='cpu',apply_postprocessing=False));saved=json.loads((r/'inherited-local-trials.json').read_text()) if (r/'inherited-local-trials.json').exists() else {'proposals':[],'records':[]};proposals=saved['proposals'];records=saved['records'];done={x['id'] for x in records}
with torch.inference_mode():
 for identifier in ids:
  if identifier in done:continue
  h=old[identifier];pts,box,info=inset_prompt_for(h,size,.2,max_points=3);cx,cy=np.array(h['center'])*size;span=max(360,min(720,max(box[2]-box[0],box[3]-box[1])+220));region=[max(0,int(cx-span/2)),max(0,int(cy-span/2)),min(size[0],int(cx+span/2)),min(size[1],int(cy+span/2))];left,top,right,bottom=region;im=np.array(image.crop(region),copy=True);x0,y0,x1,y1=box;neg=[[x0-10,y0-10],[x1+10,y0-10],[x1+10,y1+10],[x0-10,y1+10]]
  # Select an interior seed on small mounted holds, separate from their black supporting macro.
  if identifier in ['manual-fe6f9e6d46f2','manual-bbee7b567dbd']:
   hsv=cv2.cvtColor(im,cv2.COLOR_RGB2HSV);z=np.zeros(im.shape[:2],np.uint8);cv2.fillPoly(z,[np.rint(np.array(h['polygon'])*size-[left,top]).astype(np.int32)],1);color=((hsv[:,:,1]>45)&(hsv[:,:,2]>80)&(z>0)).astype(np.uint8);dist=cv2.distanceTransform(color,cv2.DIST_L2,5);_,_,_,loc=cv2.minMaxLoc(dist);pts=[[loc[0]+left,loc[1]+top]]
  if identifier in ['manual-b80b591af707','manual-9bf5e27daef1']:
   hsv=cv2.cvtColor(im,cv2.COLOR_RGB2HSV);mask=((hsv[:,:,1]<65)&(hsv[:,:,2]>145)).astype(np.uint8);n,labels,stats,centers=cv2.connectedComponentsWithStats(mask);near=[i for i in range(1,n) if 250<stats[i,4]<16000 and np.linalg.norm(centers[i]-[cx-left,cy-top])<110]
   if near:
    j=min(near,key=lambda i:np.linalg.norm(centers[i]-[cx-left,cy-top]));component=(labels==j).astype(np.uint8);dist=cv2.distanceTransform(component,cv2.DIST_L2,5);_,_,_,loc=cv2.minMaxLoc(dist);pts=[[loc[0]+left,loc[1]+top]];x,y,w,h0,_=stats[j];box=[left+x-8,top+y-8,left+x+w+8,top+y+h0+8];neg=[]
  if identifier in ['scan-835088bb-8077-4a5a-8fdf-8ccfd7c8531c','scan-7d0a8be5-a28b-440b-8459-e684069a33ef']:
   hsv=cv2.cvtColor(im,cv2.COLOR_RGB2HSV);mask=(hsv[:,:,2]<100).astype(np.uint8);n,labels,stats,centers=cv2.connectedComponentsWithStats(mask);near=[i for i in range(1,n) if 300<stats[i,4]<20000 and np.linalg.norm(centers[i]-[cx-left,cy-top])<140]
   if near:
    j=min(near,key=lambda i:np.linalg.norm(centers[i]-[cx-left,cy-top]));component=(labels==j).astype(np.uint8);dist=cv2.distanceTransform(component,cv2.DIST_L2,5);_,_,_,loc=cv2.minMaxLoc(dist);pts=[[loc[0]+left,loc[1]+top]];x,y,w,h0,_=stats[j];box=[left+x-8,top+y-8,left+x+w+8,top+y+h0+8];neg=[]
  predictor.set_image(im);masks,scores,_=predictor.predict(point_coords=np.array(pts+neg,np.float32)-[left,top],point_labels=np.array([1]*len(pts)+[0]*len(neg)),box=np.array(box)-[left,top,left,top],multimask_output=True);best=select_mask(masks,scores,h,pts[0],region,coverage,uncertainty,size,.35);record=dict(id=identifier,region=region,positive=pts,negative=neg,box=box,modelScores=scores.tolist())
  if best:best.update(id='sam2-v10-local-'+hashlib.sha256((sha+identifier).encode()).hexdigest()[:14],oldHoldIds=[identifier],status='needs-review');proposals.append(best);record['proposalId']=best['id']
  else:record['failure']='no-eligible-mask'
  records.append(record);(r/'inherited-local-trials.json').write_text(json.dumps(dict(publishable=False,imageSha256=sha,proposals=proposals,records=records),indent=2,default=lambda v:v.item()));print(identifier,record.get('failure','ok'),flush=True)
