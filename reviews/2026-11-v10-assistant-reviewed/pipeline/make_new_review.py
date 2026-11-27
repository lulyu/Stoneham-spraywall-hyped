from pathlib import Path
import json,math,sys
from PIL import Image,ImageDraw,ImageFont
r=Path('/workspace/wall-comparison-2026-11-27');payload=json.loads((r/(sys.argv[1] if len(sys.argv)>1 else 'new-location-sam2-r2.json')).read_text());hints={h['id']:h for h in json.loads((r/'new-location-hints.json').read_text())};im=Image.open(r/'new-wall-preview-r2/wall.jpg');old=Image.open(r/'current-site-wall.jpg');W,H=im.size;font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',14)
for page in range(math.ceil(len(payload['proposals'])/16)):
 sheet=Image.new('RGB',(1600,1200),'#171717');d=ImageDraw.Draw(sheet)
 for j,p in enumerate(payload['proposals'][page*16:(page+1)*16]):
  h=hints[p['hintId']];poly=h['polygon']+p['polygon'];xs=[v[0]*W for v in poly];ys=[v[1]*H for v in poly];cx=(min(xs)+max(xs))/2;cy=(min(ys)+max(ys))/2;span=max(120,max(xs)-min(xs)+50,max(ys)-min(ys)+50);box=(int(cx-span/2),int(cy-span/2),int(cx+span/2),int(cy+span/2));ox=j%4*400;oy=j//4*300;d.text((ox+5,oy+3),p['hintId']+' score '+str(round(p['evidence']['modelScore'],2)),font=font,fill='white')
  for k,photo in enumerate([old,im]):
   crop=photo.crop(box).resize((196,260));draw=ImageDraw.Draw(crop)
   if k==1:
    pts=[((x*W-box[0])*196/(box[2]-box[0]),(y*H-box[1])*260/(box[3]-box[1])) for x,y in p['polygon']];draw.line(pts+[pts[0]],fill='#00ffff',width=2)
   sheet.paste(crop,(ox+200*k,oy+28))
 sheet.save(r/f'{sys.argv[2] if len(sys.argv)>2 else "new-model-review"}-{page+1}.jpg',quality=95)
print(len(payload['proposals']))
