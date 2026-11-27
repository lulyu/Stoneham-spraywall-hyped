from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,math
r=Path('/workspace/wall-comparison-2026-11-27');raw=json.loads((r/'sam2-inherited/sam2-refresh.json').read_text());entries={e['oldHoldId']:e for e in raw['entries']};props={p['id']:p for p in raw['proposals']};local=json.loads((r/'inherited-local-trials.json').read_text());im=Image.open(r/'new-wall-preview-r2/wall.jpg');W,H=im.size;font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',12);records=[]
for p in local['proposals']:
 identifier=p['oldHoldIds'][0];e=entries[identifier];old=props.get(e['proposalId']);poly=p['polygon']+(old['polygon'] if old and len(old['oldHoldIds'])==1 else e['oldGeometry']['polygon']);xs=[x*W for x,y in poly];ys=[y*H for x,y in poly];span=max(100,min(600,max(max(xs)-min(xs),max(ys)-min(ys))+40));cx,cy=[v*z for v,z in zip(p['center'],[W,H])];box=[int(cx-span/2),int(cy-span/2),int(cx+span/2),int(cy+span/2)];records.append(dict(id=identifier,box=box,raw=old,local=p))
for page in range(math.ceil(len(records)/16)):
 sheet=Image.new('RGB',(1600,1200),'#181818');d=ImageDraw.Draw(sheet)
 for k,z in enumerate(records[page*16:(page+1)*16]):
  ox=k%4*400;oy=k//4*300;d.text((ox+5,oy+4),str(page*16+k+1)+' '+z['id'],font=font,fill='white');box=z['box']
  for col,p in enumerate([z['raw'],z['local']]):
   crop=im.crop(box).resize((196,260));draw=ImageDraw.Draw(crop)
   if p:
    pts=[((x*W-box[0])*196/(box[2]-box[0]),(y*H-box[1])*260/(box[3]-box[1])) for x,y in p['polygon']];draw.line(pts+[pts[0]],fill='#00ffff' if col==0 else '#ffff00',width=2)
   sheet.paste(crop,(ox+200*col,oy+28))
 sheet.save(r/f'inherited-local-review-{page+1}.jpg',quality=97)
(r/'inherited-local-review-order.json').write_text(json.dumps([z['id'] for z in records],indent=2));print(len(records),'masks; left=original, right=local trial')
