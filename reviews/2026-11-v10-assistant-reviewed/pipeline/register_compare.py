import sys,json
from pathlib import Path
import cv2,numpy as np
from PIL import Image,ImageOps,ImageDraw
sys.path.insert(0,'/workspace/Stoneham-spraywall-project')
from tools.wall_rescan.run import matches
root=Path('/workspace/wall-comparison-2026-11-27');ref=Image.open(root/'current-site-wall.jpg').convert('RGB')
cv2.setNumThreads(2);cv2.setRNGSeed(0)
scale=3600/ref.width;size=(3600,round(ref.height*scale));S=np.diag([scale,scale,1.])
refsmall=np.asarray(ref.resize(size));cv2.imwrite(str(root/'reference-3600.jpg'),cv2.cvtColor(refsmall,cv2.COLOR_RGB2BGR))
cache={};reports=[]
for i,p in enumerate(json.loads((root/'photos.json').read_text())):
 src=ImageOps.exif_transpose(Image.open(p)).convert('RGB')
 a,b,meta=matches(src,ref,2600,30000,0,cache,'flann')
 H,inliers=cv2.findHomography(a,b,cv2.USAC_MAGSAC,18,maxIters=10000,confidence=.999)
 if H is None: raise RuntimeError('No registration '+p)
 error=np.linalg.norm(cv2.perspectiveTransform(a.reshape(-1,1,2),H).reshape(-1,2)-b,axis=1);good=inliers.ravel().astype(bool)
 image=np.asarray(src);warp=cv2.warpPerspective(image,S@H,size)
 valid=cv2.warpPerspective(np.full(image.shape[:2],255,np.uint8),S@H,size,flags=cv2.INTER_NEAREST)
 cv2.imwrite(str(root/f'aligned-{i}.jpg'),cv2.cvtColor(warp,cv2.COLOR_RGB2BGR));cv2.imwrite(str(root/f'coverage-{i}.png'),valid)
 np.savez_compressed(root/f'geometry-{i}.npz',H=H,source_points=a,reference_points=b,inliers=good)
 report={'index':i,'photo':Path(p).name,'matches':len(a),'inliers':int(good.sum()),'medianNativePixels':float(np.median(error[good])),'p95NativePixels':float(np.percentile(error[good],95)),'coverageFrame':float((valid>0).mean())}
 reports.append(report);print(json.dumps(report),flush=True)
 thumb=warp.copy();thumb[valid==0]=refsmall[valid==0]//4
 out=Image.new('RGB',(1800,round(size[1]/2)+32),'#202020');out.paste(Image.fromarray(refsmall).resize((900,size[1]//4)),(0,32));out.paste(Image.fromarray(thumb).resize((900,size[1]//4)),(900,32));d=ImageDraw.Draw(out);d.text((20,8),'CURRENT SITE',fill='white');d.text((920,8),Path(p).name+' | dark = not observed',fill='white');out.crop((0,0,1800,size[1]//4+32)).save(root/f'comparison-{i}.jpg')
(root/'registration-summary.json').write_text(json.dumps(reports,indent=2))
