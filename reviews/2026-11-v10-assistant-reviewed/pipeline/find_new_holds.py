from pathlib import Path
import json,cv2,numpy as np
from PIL import Image,ImageDraw,ImageFont
root=Path('/workspace/wall-comparison-2026-11-27');out=root/'new-wall-preview-r2';W=3600
old=cv2.imread(str(root/'current-site-wall.jpg'));new=cv2.imread(str(out/'wall.jpg'));H=round(old.shape[0]*W/old.shape[1]);old=cv2.resize(old,(W,H));new=cv2.resize(new,(W,H));holds=json.loads((root/'reference-holds.json').read_text());mask=np.zeros((H,W),np.uint8)
for h in holds:cv2.fillPoly(mask,[np.rint(np.array(h['polygon'])*[W,H]).astype(np.int32)],255)
blocked=cv2.dilate(mask,np.ones((11,11),np.uint8))>0
labold=cv2.cvtColor(old,cv2.COLOR_BGR2LAB).astype(float);labnew=cv2.cvtColor(new,cv2.COLOR_BGR2LAB).astype(float);diff=np.linalg.norm(labold[:,:,1:]-labnew[:,:,1:],axis=2)
sat=cv2.cvtColor(new,cv2.COLOR_BGR2HSV)[:,:,1];satold=cv2.cvtColor(old,cv2.COLOR_BGR2HSV)[:,:,1]
change=((diff>12)&(sat>45)&(~blocked)).astype(np.uint8)*255
change=cv2.morphologyEx(change,cv2.MORPH_CLOSE,np.ones((5,5),np.uint8));num,labels,stats,centers=cv2.connectedComponentsWithStats(change)
records=[]
for j in range(1,num):
 x,y,w,h,a=map(int,stats[j]);cx,cy=centers[j]
 if a<45 or w<7 or h<7:continue
 records.append(dict(index=len(records)+1,center=[cx/W,cy/H],box=[x/W,y/H,(x+w)/W,(y+h)/H],area=a))
(root/'new-component-candidates.json').write_text(json.dumps(records,indent=2))
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16)
for page in range((len(records)+23)//24):
 sheet=Image.new('RGB',(1600,1440),'#171717');d=ImageDraw.Draw(sheet)
 for k,r in enumerate(records[page*24:(page+1)*24]):
  ox=k%4*400;oy=k//4*240;cx,cy=np.array(r['center'])*[W,H];x,y,x1,y1=np.array(r['box'])*[W,H,W,H];span=max(75,x1-x+35,y1-y+35);box=(int(cx-span/2),int(cy-span/2),int(cx+span/2),int(cy+span/2));d.text((ox+5,oy+3),f"N{r['index']}  {r['center'][0]:.3f},{r['center'][1]:.3f}",font=font,fill='white')
  for col,im in enumerate([old,new]):
   crop=Image.fromarray(cv2.cvtColor(im,cv2.COLOR_BGR2RGB)).crop(box);crop.thumbnail((194,210));sheet.paste(crop,(ox+col*200,oy+26))
 sheet.save(root/f'new-candidates-{page+1}.jpg',quality=95)
print('Residual components',len(records))
