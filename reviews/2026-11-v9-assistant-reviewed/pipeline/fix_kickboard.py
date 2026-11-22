from pathlib import Path
import shutil,json,hashlib
import numpy as np,cv2
from PIL import Image,ImageOps,ImageDraw
r=Path('/workspace/wall-comparison-2026-11-21');old=r/'new-wall-preview';out=r/'new-wall-preview-r2';shutil.copytree(old,out);cv2.setNumThreads(2)
im=np.array(Image.open(old/'wall.jpg'));H,W=im.shape[:2];index=np.array(Image.open(old/'source-index.png'));coverage=np.array(Image.open(old/'coverage.png'));paths=json.loads((r/'photos.json').read_text());meta=json.loads((old/'manifest.json').read_text());top=round(.925*H);field_size=(731,553);yy,xx=np.mgrid[top:H,0:W].astype(np.float32)
for i,p in enumerate(paths):
 data=np.load(old/f'alignment-{i}.npz');field=data['inverse_sampling_correction'];inv=np.linalg.inv(data['source_to_reference']);delta=cv2.remap(field,xx*(field_size[0]-1)/(W-1),yy*(field_size[1]-1)/(H-1),cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE);mapped=cv2.perspectiveTransform(np.stack([xx+delta[:,:,0],yy+delta[:,:,1]],axis=-1),inv);mx,my=mapped[:,:,0],mapped[:,:,1];source=np.array(ImageOps.exif_transpose(Image.open(p)).convert('RGB'));valid=(mx>=2)&(my>=2)&(mx<=source.shape[1]-3)&(my<=source.shape[0]-3);wanted=(xx<W*.35) if i==0 else ((xx>=W*.35)&(xx<W*.68)) if i==1 else xx>=W*.68;keep=valid&wanted;pix=cv2.remap(source,mx,my,cv2.INTER_CUBIC);pix=np.clip(np.rint(pix.astype(float)*np.array(meta['sources'][i]['exposureGainRGB'])),0,255).astype(np.uint8);im[top:][keep]=pix[keep];index[top:][keep]=i+1;coverage[top:][keep]=255
Image.fromarray(im).save(out/'wall.jpg',quality=95,subsampling=0);Image.fromarray(index).save(out/'source-index.png');Image.fromarray(coverage).save(out/'coverage.png');preview=Image.fromarray(im);preview.thumbnail((2000,2000));preview.save(out/'preview.jpg',quality=94)
meta.update(wallSHA256=hashlib.sha256((out/'wall.jpg').read_bytes()).hexdigest(),referenceFallbackFraction=float((coverage==0).mean()),newObservationFraction=float((coverage>0).mean()),kickboardSourcePolicy={'startY':.925,'xBoundaries':[.35,.68],'sourceIndices':[1,2,3],'reason':'contiguous single-photo kickboard segments, with seams in blank gaps; old silhouette guards caused clipping under kickboard parallax'},supersedesImageSHA256=meta['wallSHA256'])
(out/'manifest.json').write_text(json.dumps(meta,indent=2));s=(r/'prepare_sam2_candidate.py').read_text().replace("base=root/'new-wall-preview'","base=root/'new-wall-preview-r2'");(r/'prepare_sam2_candidate_r2.py').write_text(s)
# Delete derived R1 previews from this copied folder; regenerate every comparison against R2.
for p in out.glob('*.gif'):p.unlink()
for name in ['side-by-side.jpg','sam2-candidate-manifest.json','uncertainty.png']:
 p=out/name
 if p.exists():p.unlink()
print('kickboard revision ready',meta['wallSHA256'])
