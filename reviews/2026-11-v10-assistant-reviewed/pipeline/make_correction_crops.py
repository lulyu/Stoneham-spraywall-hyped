from pathlib import Path
import json,math
from PIL import Image,ImageDraw,ImageFont
r=Path('/workspace/wall-comparison-2026-11-27');im=Image.open(r/'new-wall-preview-r2/wall.jpg');hints={h['id']:h for h in json.loads((r/'new-location-hints.json').read_text())};props={p['hintId']:p for p in json.loads((r/'new-location-sam2-r2.json').read_text())['proposals']};tags=['N03-06','N08','N07','N09-green','N14-17','N18-19','N23','N24','N25-26','N27','R08'];records=[]
for tag in tags:
 h=hints['nov27-'+tag];poly=h['polygon'];xs=[x*im.width for x,y in poly];ys=[y*im.height for x,y in poly];pad=60 if tag in ['N09-green','R08'] else 24;box=[int(min(xs)-pad),int(min(ys)-pad),int(max(xs)+pad),int(max(ys)+pad)];crop=im.crop(box).resize((320,320));records.append(dict(hintId=h['id'],box=box,cropSize=[320,320]));crop.save(r/f'boundary-{tag}.png')
for page in range(math.ceil(len(tags)/6)):
 out=Image.new('RGB',(990,730),'#202020');d=ImageDraw.Draw(out)
 for j,tag in enumerate(tags[page*6:(page+1)*6]):
  crop=Image.open(r/f'boundary-{tag}.png');draw=ImageDraw.Draw(crop)
  for v in range(0,320,40):
   draw.line((v,0,v,319),fill='#ddd',width=1);draw.line((0,v,319,v),fill='#ddd',width=1);draw.text((v+2,2),str(v),fill='#000');draw.text((2,v+12),str(v),fill='#000')
  x=j%3*330;y=j//3*365;out.paste(crop,(x,y+30));d.text((x+5,y+3),tag,fill='white')
 out.save(r/f'boundary-sheet-{page+1}.jpg',quality=98)
(r/'boundary-crop-metadata.json').write_text(json.dumps(records,indent=2))
