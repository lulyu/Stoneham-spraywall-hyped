import cv2,numpy as np,json
from PIL import Image,ImageDraw
from pathlib import Path
root=Path('/workspace/wall-comparison-2026-11-21'); cv2.setNumThreads(2)
ref=cv2.imread(str(root/'reference-3600.jpg'));h,w=ref.shape[:2]
holds=json.load(open('/workspace/Stoneham-spraywall-project/src/data/walls/2026-11-v8/holds.json'))
rlab=cv2.cvtColor(ref,cv2.COLOR_BGR2LAB).astype(np.float32)
warps=[cv2.imread(str(root/f'aligned-{i}.jpg')) for i in range(3)];masks=[cv2.imread(str(root/f'coverage-{i}.png'),0) for i in range(3)]
rg=cv2.cvtColor(ref,cv2.COLOR_BGR2GRAY);grays=[cv2.cvtColor(im,cv2.COLOR_BGR2GRAY) for im in warps]
labs=[]
for im,m in zip(warps,masks):
 lab=cv2.cvtColor(im,cv2.COLOR_BGR2LAB).astype(np.float32);good=(m[::5,::5]>0)&(rg[::5,::5]>40)
 offset=np.median((rlab-lab)[::5,::5][good],axis=0);labs.append(lab+offset)
results=[]
for k,hold in enumerate(holds):
 p=np.rint(np.array(hold['polygon'])*[w,h]).astype(np.int32);x,y,bw,bh=cv2.boundingRect(p)
 x0,y0,x1,y1=max(0,x-3),max(0,y-3),min(w,x+bw+3),min(h,y+bh+3)
 if x1-x0<5 or y1-y0<5:continue
 mask=np.zeros((y1-y0,x1-x0),np.uint8);cv2.fillPoly(mask,[p-[x0,y0]],255);core=cv2.erode(mask,np.ones((3,3),np.uint8))>0
 if core.sum()<12:core=mask>0
 scores=[]
 for i,(im,valid) in enumerate(zip(warps,masks)):
  if (valid[y0:y1,x0:x1][mask>0]>0).mean()<.99:continue
  radius=10;lx,ly,rx,ry=max(0,x0-radius),max(0,y0-radius),min(w,x1+radius),min(h,y1+radius)
  match=cv2.matchTemplate(grays[i][ly:ry,lx:rx],rg[y0:y1,x0:x1],cv2.TM_CCOEFF_NORMED)
  _,corr,_,loc=cv2.minMaxLoc(match);nx,ny=lx+loc[0],ly+loc[1]
  diff=np.abs(rlab[y0:y1,x0:x1]-labs[i][ny:ny+y1-y0,nx:nx+x1-x0]);color=float(np.mean(diff[core]*[.4,1,1]))
  score=color+18*(1-max(0,corr));scores.append({'source':i,'score':score,'color':color,'correlation':corr,'dx':nx-x0,'dy':ny-y0})
 best=min(scores,key=lambda r:r['score']) if scores else None
 results.append({'id':hold['id'],'center':hold['center'],'box':[x0,y0,x1,y1],'area':int(core.sum()),'best':best,'sources':scores})
(root/'hold-comparison-scores.json').write_text(json.dumps(results,indent=2))
ranked=sorted([r for r in results if r['best']],key=lambda r:r['best']['score'],reverse=True)
for page in range(3):
 out=Image.new('RGB',(1440,1200),'#1d1d1d');d=ImageDraw.Draw(out)
 for j,r in enumerate(ranked[page*24:(page+1)*24]):
  cx,cy=np.array(r['center'])*[w,h];cx,cy=int(cx),int(cy);x0,y0,x1,y1=r['box'];span=max(64,min(200,max(x1-x0,y1-y0)+36));x0=max(0,cx-span//2);y0=max(0,cy-span//2);x1=min(w,x0+span);y1=min(h,y0+span)
  ox=(j%4)*360;oy=(j//4)*200;d.text((ox+5,oy+2),f'{page*24+j+1}. {r["id"]} score={r["best"]["score"]:.1f} cc={r["best"]["correlation"]:.2f}',fill='white')
  for col,im in enumerate([ref,warps[r['best']['source']]]):
   crop=Image.fromarray(cv2.cvtColor(im[y0:y1,x0:x1],cv2.COLOR_BGR2RGB));crop.thumbnail((174,174));out.paste(crop,(ox+col*180,oy+22))
 out.save(root/f'suspects-{page+1}.jpg',quality=95)
print(json.dumps({'holds':len(results),'covered':len(ranked),'top':[{k:r[k] for k in ['id','center','best']} for r in ranked[:35]]},indent=2))
