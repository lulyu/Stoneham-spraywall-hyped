import json,hashlib
from pathlib import Path
import numpy as np,cv2
from PIL import Image
root=Path('/workspace/wall-comparison-2026-11-21');base=root/'new-wall-preview-r2';old=Path('/workspace/Stoneham-spraywall-project/src/data/walls/2026-11-v8/holds.json')
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
meta=json.loads((base/'manifest.json').read_text());index=np.array(Image.open(base/'source-index.png'));coverage=np.array(Image.open(base/'coverage.png'))
uncertain=np.zeros(coverage.shape,np.uint8);uncertain[coverage==0]=16
high=cv2.dilate(index,np.ones((5,5),np.uint8));low=cv2.erode(index,np.ones((5,5),np.uint8));uncertain[(high!=low)&(low>0)]|=1
# Flag source changes crossing a previous outline, without pretending old outlines are verified on v8.
holds=json.loads(old.read_text());W,H=meta['size']
for h in holds:
 points=np.rint(np.array(h['polygon'])*[W,H]).astype(np.int32);x,y,w,height=cv2.boundingRect(points);x0,y0=max(0,x),max(0,y);x1,y1=min(W,x+w),min(H,y+height)
 mask=np.zeros((y1-y0,x1-x0),np.uint8);cv2.fillPoly(mask,[points-[x0,y0]],1);values=np.unique(index[y0:y1,x0:x1][mask>0]);values=values[values>0]
 if len(values)>1:uncertain[y0:y1,x0:x1][mask>0]|=8
Image.fromarray(uncertain).save(base/'uncertainty.png')
session={'scanId':'stoneham-20261121-originals','gymId':'stoneham-crg','wallId':'spray-wall-1','referenceVersion':'2026-11-v8','candidateVersion':'2026-11-v9','referenceImageSha256':sha(root/'current-site-wall.jpg'),'referenceHoldsSha256':sha(old),'registeredImageSha256':sha(base/'wall.jpg'),'coordinateFrame':{'size':[W,H],'orientation':'v8 canonical frame; EXIF-prepared source photos'},'sourceContents':[{'id':r['file'],'imageSha256':r['sha256']} for r in meta['sources']],'compositionManifestSha256':sha(base/'manifest.json')}
session['sessionId']=hashlib.sha256(json.dumps(session,sort_keys=True,separators=(',',':')).encode()).hexdigest()
manifest={'format':'stoneham-wall-candidate-v1','wallId':'spray-wall-1','wallVersionId':'2026-11-v9','referenceVersion':'2026-11-v8','status':'candidate-needs-review','publishable':False,'imageSize':[W,H],'image':'wall.jpg','coverage':'coverage.png','uncertainty':'uncertainty.png','sourceIndex':'source-index.png','sourceSession':session,'referenceImageSha256':session['referenceImageSha256'],'referenceHoldsSha256':sha(old),'referenceFilledFraction':meta['referenceFallbackFraction'],'qaFailures':['assistant-identity-review-pending','assistant-boundary-review-pending','new-hold-search-pending'],'reviewPriority':{'reviewer':'assistant, as requested by user','allInheritedHolds':True,'newHoldSearch':True}}
for key in ['image','coverage','uncertainty','sourceIndex']:manifest[key+'Sha256']=sha(base/manifest[key])
(base/'sam2-candidate-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print('Candidate',manifest['wallVersionId'],'image',manifest['imageSha256'])
