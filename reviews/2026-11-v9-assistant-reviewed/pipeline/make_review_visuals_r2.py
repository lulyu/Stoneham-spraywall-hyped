from pathlib import Path
import json
from PIL import Image,ImageDraw,ImageFont
root=Path('/workspace/wall-comparison-2026-11-21');out=root/'new-wall-preview-r2'
old=Image.open(root/'current-site-wall.jpg').convert('RGB');new=Image.open(out/'wall.jpg').convert('RGB');font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',22)
def gif(a,b,path):
 combo=Image.new('RGB',(a.width,a.height*2));combo.paste(a);combo.paste(b,(0,a.height));palette=combo.quantize(colors=256);frames=[im.quantize(palette=palette,dither=Image.Dither.NONE) for im in [a,b]];frames[0].save(path,save_all=True,append_images=frames[1:],duration=1400,loop=0,disposal=2,optimize=False)
frames=[]
for label,im in [('PREVIOUS | v8',old),('NEW | Nov 21 | v9 candidate',new)]:
 s=(1800,round(im.height*1800/im.width));f=Image.new('RGB',(s[0],s[1]+42),'#171d13');f.paste(im.resize(s,Image.Resampling.LANCZOS),(0,42));ImageDraw.Draw(f).text((15,7),label,font=font,fill='white');frames.append(f)
gif(*frames,out/'previous-vs-new.gif')
holds=json.loads((root/'reference-holds.json').read_text());d=root/'visual-review';d.mkdir(exist_ok=True)
for row in range(3):
 for col in range(3):
  rect=(max(0,col/3-.012),max(0,row/3-.012),min(1,(col+1)/3+.012),min(1,(row+1)/3+.012));box=tuple(round(v*(old.width if k%2==0 else old.height)) for k,v in enumerate(rect));pair=Image.new('RGB',(2000,820),'#161616');draw=ImageDraw.Draw(pair)
  for i,im in enumerate([old,new]):
   crop=im.crop(box);crop.thumbnail((995,780));pair.paste(crop,(i*1000,38));draw.text((i*1000+10,5),('OLD v8' if i==0 else 'NEW Nov21')+f' | sector {row*3+col+1}',font=font,fill='white')
  pair.save(d/f'identity-sector-{row*3+col+1}.jpg',quality=95)
  current=new.crop(box);current.thumbnail((1800,1400));draw=ImageDraw.Draw(current)
  for index,h in enumerate(holds):
   cx,cy=h['center']
   if rect[0]<=cx<=rect[2] and rect[1]<=cy<=rect[3]:
    pts=[((u*old.width-box[0])*current.width/(box[2]-box[0]),(v*old.height-box[1])*current.height/(box[3]-box[1])) for u,v in h['polygon']];draw.line(pts+[pts[0]],fill='#00e4dd',width=1)
  current.save(d/f'coverage-sector-{row*3+col+1}.jpg',quality=95)
# Enlarged bottom strip as four common-palette toggles.
for i in range(4):
 box=(round(i*old.width/4),round(old.height*.88),round((i+1)*old.width/4),old.height);a=old.crop(box);b=new.crop(box);a.thumbnail((1200,700));b=b.resize(a.size);gif(a,b,out/f'bottom-{i+1}.gif')
side=Image.new('RGB',(2200,round(old.height*1100/old.width)+42),'#171d13');draw=ImageDraw.Draw(side)
for i,(label,im) in enumerate([('OLD v8',old),('NEW Nov21',new)]):
 im=im.resize((1100,round(im.height*1100/im.width)),Image.Resampling.LANCZOS);side.paste(im,(i*1100,42));draw.text((i*1100+15,7),label,font=font,fill='white')
side.save(out/'side-by-side.jpg',quality=95)
print('Comparison and 18 sector review images ready')
