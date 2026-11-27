from pathlib import Path
import json,cv2,numpy as np
r=Path('/workspace/wall-comparison-2026-11-27');holds=json.loads((r/'reference-holds.json').read_text());records=[]
for h in holds:
 poly=np.array(h['polygon'],np.float32)*[7292,5514];sources=[]
 for i in range(3):
  z=np.load(r/f'geometry-{i}.npz');a=cv2.perspectiveTransform(z['source_points'].reshape(-1,1,2),z['H']).reshape(-1,2);b=z['reference_points'];indices=[k for k,p in enumerate(b) if cv2.pointPolygonTest(poly.astype(np.float32),tuple(map(float,p)),False)>=0]
  if len(indices)<4:continue
  b0=b[indices];a0=a[indices];M,ok=cv2.estimateAffinePartial2D(b0,a0,method=cv2.RANSAC,ransacReprojThreshold=4,maxIters=3000)
  if M is None or ok.sum()<4:continue
  angle=float(np.degrees(np.arctan2(M[1,0],M[0,0])));scale=float(np.hypot(M[0,0],M[1,0]));c=np.array(h['center'])*[7292,5514];shift=float(np.linalg.norm(M@[*c,1]-c))
  if abs(angle)>=10 and .75<scale<1.3:sources.append(dict(photo=i,angle=angle,scale=scale,shiftPx=shift,inliers=int(ok.sum())))
 if sources:records.append(dict(id=h['id'],center=h['center'],sources=sources))
(r/'rotation-triage.json').write_text(json.dumps(records,indent=2));print(json.dumps(records,indent=2))
