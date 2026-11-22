"""Offline preview only: align to v8, preserve real changes, save observation provenance."""
import sys,json,hashlib,time,gc
from pathlib import Path
import cv2,numpy as np
from PIL import Image,ImageOps,ImageDraw,ImageFont
from scipy.interpolate import LinearNDInterpolator
sys.path.insert(0,'/workspace/Stoneham-spraywall-project')
from tools.wall_rescan.compose import guard_regions
root=Path('/workspace/wall-comparison-2026-11-21');out=root/'new-wall-preview';out.mkdir(exist_ok=False)
cv2.setNumThreads(2);cv2.setRNGSeed(0);start=time.monotonic()
ref=Image.open(root/'current-site-wall.jpg').convert('RGB');W,H=ref.size
work=(1800,round(H*1800/W));scale=work[0]/W
refsmall=np.asarray(ref.resize(work,Image.Resampling.LANCZOS));paths=json.loads((root/'photos.json').read_text())
holds=json.load(open('/workspace/Stoneham-spraywall-project/src/data/walls/2026-11-v8/holds.json'))
# Actual changed regions, plus the uncertain bottom footholds, are excluded from deformation fitting.
scores=json.loads((root/'hold-comparison-scores.json').read_text())
exclude=[]
for record in scores:
 if record['best'] and record['best']['score']>17:
  x0,y0,x1,y1=record['box'];exclude.append((max(0,(x0-20)/3600),max(0,(y0-20)/(H*3600/W)),min(1,(x1+20)/3600),min(1,(y1+20)/(H*3600/W))))
(root/'changed-region-exclusions.json').write_text(json.dumps(exclude,indent=2))
# Fit smooth parallax corrections to stationary wall/background only.
static=np.ones((H,W),np.uint8)
for hold in holds:
 pts=np.rint(np.asarray(hold['polygon'])*[W,H]).astype(np.int32)
 cv2.fillPoly(static,[pts],0)
static=cv2.erode(static,np.ones((13,13),np.uint8))

field_size=(731,553);gridx,gridy=np.meshgrid(np.linspace(0,W-1,field_size[0]),np.linspace(0,H-1,field_size[1]));query=np.stack([gridx,gridy],axis=-1)
images=[];masks=[];fields=[];matrices=[];records=[]

def map_for_region(inv,field,width,height,xstart=0,ystart=0,working=False):
 yy,xx=np.mgrid[ystart:ystart+height,xstart:xstart+width].astype(np.float32)
 if working:xx=(xx+.5)/scale-.5;yy=(yy+.5)/scale-.5
 fx=xx*(field_size[0]-1)/(W-1);fy=yy*(field_size[1]-1)/(H-1)
 delta=cv2.remap(field,fx,fy,cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
 points=np.stack([xx+delta[:,:,0],yy+delta[:,:,1]],axis=-1)
 mapped=cv2.perspectiveTransform(points,inv)
 return mapped[:,:,0],mapped[:,:,1]

for i,path in enumerate(paths):
 geometry=np.load(root/f'geometry-{i}.npz');matrix=geometry['H'];a=geometry['source_points'];b=geometry['reference_points'];valid=geometry['inliers'].astype(bool)
 projected=cv2.perspectiveTransform(a.reshape(-1,1,2),matrix).reshape(-1,2);delta=projected-b
 for x0,y0,x1,y1 in exclude:valid&=~((b[:,0]>=x0*W)&(b[:,0]<=x1*W)&(b[:,1]>=y0*H)&(b[:,1]<=y1*H))
 valid&=np.linalg.norm(delta,axis=1)<=18
 coords=np.rint(b).astype(int);coords[:,0]=np.clip(coords[:,0],0,W-1);coords[:,1]=np.clip(coords[:,1],0,H-1)
 valid&=static[coords[:,1],coords[:,0]]>0
 indices=np.flatnonzero(valid);rng=np.random.default_rng(42);rng.shuffle(indices);cut=round(len(indices)*.8);fit,check=indices[:cut],indices[cut:]
 interpolator=LinearNDInterpolator(b[fit],delta[fit],fill_value=0)
 field=np.asarray(interpolator(query),np.float32);field=cv2.GaussianBlur(field,(0,0),5)
 magnitude=np.linalg.norm(field,axis=2);field*=np.minimum(1,12/np.maximum(magnitude,1e-4))[:,:,None]
 cx=(b[check,0]*(field_size[0]-1)/(W-1)).astype(np.float32).reshape(1,-1);cy=(b[check,1]*(field_size[1]-1)/(H-1)).astype(np.float32).reshape(1,-1)
 estimated=cv2.remap(field,cx,cy,cv2.INTER_LINEAR).reshape(-1,2)
 before=np.linalg.norm(delta[check],axis=1);after=np.linalg.norm(delta[check]-estimated,axis=1)
 use=float(np.median(after))<float(np.median(before)) and float(np.percentile(after,95))<=float(np.percentile(before,95))
 if not use:field[:]=0;after=before
 fields.append(field);matrices.append(matrix);np.savez_compressed(out/f'alignment-{i}.npz',source_to_reference=matrix,inverse_sampling_correction=field)
 source=np.asarray(ImageOps.exif_transpose(Image.open(path)).convert('RGB'))
 mx,my=map_for_region(np.linalg.inv(matrix),field,*work,working=True)
 image=cv2.remap(source,mx,my,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
 mask=((mx>=2)&(my>=2)&(mx<=source.shape[1]-3)&(my<=source.shape[0]-3)).astype(np.uint8)*255
 good=(mask>0)&(refsmall.mean(axis=2)>65)&(refsmall.mean(axis=2)<230)&(image.mean(axis=2)>40)
 # Bounded exposure match using unchanged observations. It cannot create or erase shapes.
 for x0,y0,x1,y1 in exclude:good[round(y0*work[1]):round(y1*work[1]),round(x0*work[0]):round(x1*work[0])]=False
 sub=good[::5,::5];old=refsmall[::5,::5][sub].astype(float);new=image[::5,::5][sub].astype(float)
 near=np.abs(old.mean(axis=1)-new.mean(axis=1))<40;old=old[near];new=new[near]
 gains=np.clip(np.median((old+8)/(new+8),axis=0),.85,1.18)
 image=np.clip(np.rint(image.astype(float)*gains),0,255).astype(np.uint8)
 images.append(image);masks.append(mask)
 record={'sourceIndex':i+1,'file':Path(path).name,'sha256':hashlib.sha256(Path(path).read_bytes()).hexdigest(),'sourceSize':[source.shape[1],source.shape[0]],'sourceToReference':matrix.tolist(),'localCorrectionEnabled':bool(use),'correctionFitPoints':len(fit),'correctionCheckPoints':len(check),'checkMedianBeforePx':float(np.median(before)),'checkMedianAfterPx':float(np.median(after)),'checkP95BeforePx':float(np.percentile(before,95)),'checkP95AfterPx':float(np.percentile(after,95)),'exposureGainRGB':gains.tolist()}
 records.append(record);print('Aligned',i,record,flush=True)
 del source,mx,my;gc.collect()
# Graph-cut seams choose one photo per pixel instead of blending hold outlines.
seam_masks=[cv2.UMat(mask.copy()) for mask in masks]
selected=cv2.detail_GraphCutSeamFinder('COST_COLOR_GRAD').find([im.astype(np.float32) for im in images],[(0,0)]*len(images),seam_masks)
labels=np.zeros(work[::-1],np.uint8)
for i,mask in enumerate(selected):labels[mask.get()>0]=i+1
quality=[]
for i,(im,mask,record) in enumerate(zip(images,masks,records)):
 dist=cv2.distanceTransform(mask,cv2.DIST_L2,3);gray=cv2.cvtColor(im,cv2.COLOR_RGB2GRAY).astype(np.float32)
 detail=cv2.GaussianBlur(np.abs(cv2.Laplacian(gray,cv2.CV_32F)),(0,0),3)
 quality.append((np.minimum(dist/80,1)*(.7+.3*detail/(detail+10))/(1+record['checkMedianAfterPx']/5)).astype(np.float32))
quality=np.stack(quality);union=np.any(np.stack(masks)>0,axis=0);best=np.argmax(quality,axis=0)+1
chosen_good=np.zeros(work[::-1],bool)
for i,m in enumerate(masks):chosen_good|=(labels==i+1)&(m>0)
labels[union&~chosen_good]=best[union&~chosen_good];labels[~union]=0
# Keep each existing hold silhouette, and every known changed cluster, in a single photograph.
count,guards,stats=guard_regions(holds,work,2);protected=0
for group in range(1,count):
 pixels=guards==group
 if not np.any(pixels):continue
 eligible=[i for i,m in enumerate(masks) if np.all(m[pixels]>0)]
 if not eligible:continue
 i=max(eligible,key=lambda k:float(quality[k][pixels].mean()));labels[pixels]=i+1;protected+=1
for x0,y0,x1,y1 in exclude:
 xs,ys=round(x0*work[0]),round(y0*work[1]);xe,ye=round(x1*work[0]),round(y1*work[1]);region=np.s_[ys:ye,xs:xe]
 eligible=[i for i,m in enumerate(masks) if np.all(m[region]>0)]
 if eligible:
  i=max(eligible,key=lambda k:float(quality[k][region].mean()));labels[region]=i+1
Image.fromarray(labels).save(out/'source-index-work.png')
# Native rendering samples the original photos once, with the same bounded alignment.
source_index=cv2.resize(labels,(W,H),interpolation=cv2.INTER_NEAREST);canvas=np.zeros((H,W,3),np.uint8);observed=np.zeros((H,W),np.uint8)
for i,path in enumerate(paths):
 source=np.asarray(ImageOps.exif_transpose(Image.open(path)).convert('RGB'));inv=np.linalg.inv(matrices[i]);gains=np.array(records[i]['exposureGainRGB'],np.float32)
 for y in range(0,H,384):
  height=min(384,H-y);wanted=source_index[y:y+height]==i+1
  if not np.any(wanted):continue
  mx,my=map_for_region(inv,fields[i],W,height,ystart=y)
  valid=(mx>=2)&(my>=2)&(mx<=source.shape[1]-3)&(my<=source.shape[0]-3)
  pix=cv2.remap(source,mx,my,cv2.INTER_CUBIC,borderMode=cv2.BORDER_CONSTANT)
  pix=np.clip(np.rint(pix.astype(np.float32)*gains),0,255).astype(np.uint8)
  keep=wanted&valid;canvas[y:y+height][keep]=pix[keep];observed[y:y+height][keep]=255
 print('Rendered native source',i,flush=True);del source;gc.collect()
# Explicitly record the unobserved edge fallback. It is not fresh observation.
missing=observed==0;fallback=np.asarray(ref);canvas[missing]=fallback[missing];source_index[missing]=0
Image.fromarray(canvas).save(out/'wall.jpg',quality=95,subsampling=0)
Image.fromarray(observed).save(out/'coverage.png');Image.fromarray(source_index).save(out/'source-index.png')
preview=Image.fromarray(canvas);preview.thumbnail((2000,2000));preview.save(out/'preview.jpg',quality=94)
np.savez_compressed(out/'alignment-fields.npz',**{f'source_{i}':f for i,f in enumerate(fields)})
report={'status':'unreviewed-image-preview','referenceVersion':'2026-11-v8','referenceSHA256':hashlib.sha256((root/'current-site-wall.jpg').read_bytes()).hexdigest(),'candidateWallVersion':None,'size':[W,H],'newObservationFraction':float((observed>0).mean()),'referenceFallbackFraction':float(missing.mean()),'fallback':'previous v8 image only where no new photo was sampled; source index 0','protectedHoldGroups':protected,'selection':'graph-cut seam selection plus whole-hold and changed-region source guards; no RGB blending','alignment':'saved global homographies plus smooth bounded inverse corrections from unchanged inlier features; changed regions and uncertain bottom footholds excluded','localCorrectionMaxNativePixels':12,'sources':records,'wallSHA256':hashlib.sha256((out/'wall.jpg').read_bytes()).hexdigest(),'elapsedSeconds':round(time.monotonic()-start,2),'limitations':['Local alignment checks use descriptor correspondences, not independent surveyed landmarks.','Protruding holds retain some viewpoint/parallax differences.','The old 801 polygons are reference geometry only, not approved geometry for this preview.','Physical changes were not warped away or filled with old wall pixels.','Source-index 0 is old edge fill, not a new observation.']}
(out/'manifest.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2),flush=True)
