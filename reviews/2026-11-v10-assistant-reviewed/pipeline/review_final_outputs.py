from pathlib import Path
import json,math
from PIL import Image,ImageDraw,ImageFont
r=Path('/workspace/wall-comparison-2026-11-27');model=r/'sam2-inherited/sam2-refresh.json';payload=json.loads(model.read_text()) if model.exists() else {'entries':[],'proposals':[],'metadata':{'recommendations':{}}};additions=json.loads((r/'new-location-final-sam2.json').read_text());im=Image.open(r/'new-wall-preview-r2/wall.jpg').convert('RGB');old=Image.open(r/'current-site-wall.jpg').convert('RGB');W,H=im.size;proposals={p['id']:p for p in payload['proposals']};corrections={x['hintId']:x for x in json.loads((r/'assistant-boundary-corrections.json').read_text())};[p.update({k:corrections[p['hintId']][k] for k in ['center','polygon']}) for p in additions['proposals'] if p['hintId'] in corrections];hints={h['id']:h for h in json.loads((r/'new-location-hints.json').read_text())};out=r/'visual-review-model';out.mkdir(exist_ok=True);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',14)
risks=[]
for i,e in enumerate(payload['entries']):
 p=proposals.get(e['proposalId']);ev=p['evidence'] if p else {};reason=[]
 if not p:reason.append('no-mask')
 else:
  if len(p['oldHoldIds'])>1:reason.append('merged')
  if ev['oldMaskIoU']<.65:reason.append('low-overlap')
  if not .6<=ev['areaRatio']<=1.55:reason.append('area-change')
  if ev['modelScore']<.9:reason.append('low-score')
  if ev['centerDriftPixels']>22:reason.append('drift')
 if reason:risks.append(dict(index=i,id=e['oldHoldId'],reasons=reason,evidence=ev))
risks.sort(key=lambda t:(0 if 'no-mask' in t['reasons'] or 'merged' in t['reasons'] else 1,t['evidence'].get('oldMaskIoU',0)))
(out/'risks.json').write_text(json.dumps(risks,indent=2))
def sheet(records,name,perpage=24,cols=4):
 for page in range(math.ceil(len(records)/perpage)):
  view=Image.new('RGB',(1600,1440),'#171717');d=ImageDraw.Draw(view)
  for k,z in enumerate(records[page*perpage:(page+1)*perpage]):
   h=z['old'];p=z.get('new');pts=h['polygon']+(p['polygon'] if p else []);xs=[x*W for x,y in pts];ys=[y*H for x,y in pts];cx=(min(xs)+max(xs))/2;cy=(min(ys)+max(ys))/2;span=max(80,max(xs)-min(xs)+35,max(ys)-min(ys)+35);box=(round(cx-span/2),round(cy-span/2),round(cx+span/2),round(cy+span/2));ox=(k%cols)*400;oy=(k//cols)*240;d.text((ox+5,oy+3),z['label'],font=font,fill='white')
   for col,img in enumerate([old,im]):
    crop=img.crop(box);crop.thumbnail((195,208));draw=ImageDraw.Draw(crop)
    if col==1 and p:
     line=[((x*W-box[0])*crop.width/(box[2]-box[0]),(y*H-box[1])*crop.height/(box[3]-box[1])) for x,y in p['polygon']];draw.line(line+[line[0]],fill='#00ffcc',width=2)
    view.paste(crop,(ox+col*200,oy+28))
  view.save(out/f'{name}-{page+1}.jpg',quality=95)
records=[]
for rank,z in enumerate(risks):
 e=payload['entries'][z['index']];p=proposals.get(e['proposalId']);records.append(dict(old=e['oldGeometry'],new=p,label=f"R{rank+1} #{z['index']} "+','.join(z['reasons'])+f" IoU{z['evidence'].get('oldMaskIoU',0):.2f}"))
sheet(records,'risk')
records=[dict(old=hints[p['hintId']],new=p,label=p['hintId']+f" score {p['evidence']['modelScore']:.2f}") for p in additions['proposals']];sheet(records,'new')
# Sector overlays preserve enough context to check every boundary and the gaps.
for row in range(3):
 for col in range(3):
  rect=(max(0,col/3-.012),max(0,row/3-.012),min(1,(col+1)/3+.012),min(1,(row+1)/3+.012));box=(round(rect[0]*W),round(rect[1]*H),round(rect[2]*W),round(rect[3]*H));crop=im.crop(box);crop.thumbnail((1800,1400));d=ImageDraw.Draw(crop)
  for p in [p for p in payload['proposals'] if not p.get('newLocation')]+additions['proposals']:
   x,y=p['center']
   if not(rect[0]<=x<=rect[2] and rect[1]<=y<=rect[3]):continue
   pts=[((u*W-box[0])*crop.width/(box[2]-box[0]),(v*H-box[1])*crop.height/(box[3]-box[1])) for u,v in p['polygon']];d.line(pts+[pts[0]],fill='#ffff00' if p.get('newLocation') else '#00e6df',width=1 if not p.get('newLocation') else 2)
  crop.save(out/f'sector-{row*3+col+1}.jpg',quality=95)
print(json.dumps(dict(inherited=len(payload['entries']),proposals=len(payload['proposals']),new=len(additions['proposals']),riskCount=len(risks),recommendations=payload['metadata']['recommendations']),indent=2))
