"""Reproduce the isolated v7 seam experiment from the repository root.

Requires the four hash-matched original photographs under private-inputs/.
Keeps fixed v6 registration; never edits the reviewed image or checkpoint.
This is an image experiment, not a review-session or publication generator.
"""
from pathlib import Path
import argparse,json,hashlib,time
import cv2,numpy as np
from PIL import Image,ImageDraw
from tools.wall_rescan.mosaic import source_layer

def digest(path):
 with Path(path).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def run():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--output',type=Path,required=True)
 parser.add_argument('--recipe',type=Path,default=Path('public/wall/versions/2026-11-v7-seam-trial/recipe.json'))
 args=parser.parse_args()
 start=time.monotonic();cv2.setNumThreads(2)
 scan=Path('public/wall/versions/2026-11-v6-highres');out=args.output;out.mkdir(parents=True,exist_ok=False)
 meta=json.loads(args.recipe.read_text());base=Path(meta['input_manifest']).parent
 reviewed=Path('reviews/2026-11-v6-highres/confirmed-geometry.json');holds=json.loads(reviewed.read_text())['holds']
 size=tuple(meta['session']['coordinateFrame']['size']);w,h=size;scale=2400/w;work=(2400,round(h*scale))
 reviewed_meta=json.loads(reviewed.read_text())
 assert digest(scan/'wall.jpg')==reviewed_meta['imageSha256']
 baseline=json.loads((scan/'manifest.json').read_text())
 for name,key in [('coverage.png','coverageSha256'),('source-index.png','sourceIndexSha256'),('uncertainty.png','uncertaintySha256')]:
  assert digest(scan/name)==baseline[key]
 original_index=np.asarray(Image.open(scan/'source-index.png'));coverage=np.asarray(Image.open(scan/'coverage.png'))
 original_uncertainty=np.asarray(Image.open(scan/'uncertainty.png'));reference=Image.open('public/wall/stoneham-spraywall-canonical.jpg').convert('RGB')
 assert digest('public/wall/stoneham-spraywall-canonical.jpg')==meta['session']['referenceImageSha256']
 layers=[];images=[];masks=[];T=np.diag([work[0]/w,work[1]/h,1.])
 for record in meta['sources']:
  if record['status']!='registered-for-inspection':continue
  layer=source_layer(record['input'],base,record['source_code']);assert layer['input_hashes']==record['input_hashes']
  layer['matrix']=np.asarray(record['registration']['source_to_reference']);layer['gains']=np.asarray(record['exposure_gain_rgb']);layers.append(layer)
  image=cv2.warpPerspective(np.asarray(layer['image']),T@layer['matrix'],work,flags=cv2.INTER_LINEAR).astype(np.float32)
  image=np.clip(image*layer['gains'],0,255).astype(np.float32)
  mask=cv2.warpPerspective(layer['valid'],T@layer['matrix'],work,flags=cv2.INTER_NEAREST)
  images.append(image);masks.append(cv2.UMat(mask))
  print('Prepared source',layer['id'],flush=True)
 finder=cv2.detail_GraphCutSeamFinder('COST_COLOR_GRAD');selected=finder.find(images,[(0,0)]*len(images),masks)
 small=np.zeros(work[::-1],np.uint16);overlap=np.zeros(work[::-1],np.uint8)
 for layer,mask in zip(layers,selected):
  active=mask.get()>0;small[active]=layer['code'];overlap+=active.astype(np.uint8)
 print('Graph-cut complete; seam work overlaps',int(np.count_nonzero(overlap>1)),flush=True)
 desired=cv2.resize(small,size,interpolation=cv2.INTER_NEAREST)
 # Source masks at native resolution stay authoritative near photograph boundaries.
 chosen_valid=np.zeros((h,w),bool)
 for layer in layers:
  valid=cv2.warpPerspective(layer['valid'],layer['matrix'],size,flags=cv2.INTER_NEAREST)>0
  chosen_valid|=(desired==layer['code'])&valid
 fallback=(coverage>0)&~chosen_valid
 desired[fallback]=original_index[fallback];desired[coverage==0]=0
 canvas=np.zeros((h,w,3),np.uint8)
 for layer in layers:
  warped=cv2.warpPerspective(np.asarray(layer['image']),layer['matrix'],size,flags=cv2.INTER_LINEAR)
  for c in range(3):warped[:,:,c]=np.clip(np.rint(warped[:,:,c]*layer['gains'][c]),0,255).astype(np.uint8)
  mask=desired==layer['code'];canvas[mask]=warped[mask]
  print('Rendered source',layer['id'],int(mask.sum()),flush=True)
 assert np.array_equal(desired>0,coverage>0)
 # Preserve the requested v1 fallback; it never becomes a new observation.
 filled=canvas.copy();filled[coverage==0]=np.asarray(reference)[coverage==0]
 Image.fromarray(filled).save(out/'wall.jpg',quality=95);Image.fromarray(canvas).save(out/'wall_observed.png')
 Image.fromarray(desired).save(out/'source-index.png');Image.fromarray(coverage).save(out/'coverage.png')
 def seams(index):
  high=cv2.dilate(index,np.ones((5,5),np.uint8));low=cv2.erode(index,np.ones((5,5),np.uint8));return (high!=low)&(low>0)
 old_seams=seams(original_index);new_seams=seams(desired)
 uncertainty=original_uncertainty&np.uint8(254);uncertainty[new_seams]|=1
 Image.fromarray(uncertainty).save(out/'uncertainty.png')
 mask=np.zeros((h,w),np.uint8)
 for hold in holds:cv2.fillPoly(mask,[np.rint(np.asarray(hold['polygon'])*size).astype(np.int32)],255)
 buffer=cv2.dilate(mask,np.ones((49,49),np.uint8))>0
 region=(slice(2030,2310),slice(3180,3510))
 report={'format':'stoneham-seam-trial-v1','publishable':False,'version':'2026-11-v7-seam-trial','imageSize':list(size),'imageSha256':digest(out/'wall.jpg'),'coordinateFrame':meta['session']['coordinateFrame'],'sourceScanSession':meta['session'],'reviewedGeometrySha256':digest(reviewed),'method':'OpenCV COST_COLOR_GRAD graph-cut seam selection, no RGB blending, fixed v6 registration transforms','seamWorkingSize':list(work),'coverageUnchanged':True,'nativeBoundaryFallbackPixels':int(fallback.sum()),'oldSeamPixels':int(old_seams.sum()),'newSeamPixels':int(new_seams.sum()),'oldSeamPixelsNearReviewedHolds':int((old_seams&buffer).sum()),'newSeamPixelsNearReviewedHolds':int((new_seams&buffer).sum()),'blackHoldCropOldSeamPixels':int(old_seams[region].sum()),'blackHoldCropNewSeamPixels':int(new_seams[region].sum()),'sourcePixelCounts':{l['id']:int((desired==l['code']).sum()) for l in layers},'newObservationFraction':float((coverage>0).mean()),'referenceFilledFraction':float((coverage==0).mean()),'oldReviewImageSha256':json.loads(reviewed.read_text())['imageSha256'],'referenceFilledFrom':'v1 canonical image, unobserved pixels only','limitations':['Existing global registration/parallax uncertainty remains.','Image selection changes hold projection; v6 approvals stay attached to v6, not this trial.','Coverage and alignment QA are not improved by seam selection alone.'],'elapsedSeconds':round(time.monotonic()-start,2)}
 (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 preview=Image.fromarray(filled);preview.thumbnail((1800,1800));preview.save(out/'preview.jpg',quality=95)
 old=Image.open('public/wall/versions/2026-11-v6-highres/wall.jpg');new=Image.fromarray(filled);compare=Image.new('RGB',(1320,940),'#202020');d=ImageDraw.Draw(compare)
 for row,box in enumerate([(3100,1950,3760,2380),(4700,1800,5360,2230)]):
  for col,(name,im) in enumerate([('Reviewed v6 (original)',old),('Graph-cut seam trial',new)]):
   y=row*470;compare.paste(im.crop(box),(col*660,y+35));d.text((col*660+10,y+10),name,fill='white')
 compare.save(out/'detail-comparison.jpg',quality=95)
 print(json.dumps(report,indent=2),flush=True)
if __name__=='__main__':run()
