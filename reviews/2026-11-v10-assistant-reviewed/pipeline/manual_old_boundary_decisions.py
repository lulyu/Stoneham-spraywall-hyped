from pathlib import Path
import json
from PIL import Image,ImageDraw
r=Path('/workspace/wall-comparison-2026-11-27');meta=json.loads((r/'old-boundary-crop-metadata.json').read_text());polys=[[(119,205),(128,203),(148,180),(165,173),(184,173),(197,163),(205,167),(210,183),(200,205),(185,229),(169,240),(151,238),(131,230),(120,219)],[(116,218),(128,185),(145,165),(157,159),(168,161),(180,174),(185,190),(184,210),(174,230),(155,246),(135,254),(121,251),(115,242)]];records=[];sheet=Image.new('RGB',(640,355),'#202020');d=ImageDraw.Draw(sheet)
for i,pts in enumerate(polys):
 m=meta[i];x0,y0,x1,y1=m['box'];poly=[[(x0+x*(x1-x0)/320)/7292,(y0+y*(y1-y0)/320)/5514] for x,y in pts];records.append(dict(id=m['id'],reason='White hold moved/rotated; old prompt and local trial missed its body. Visually traced the new visible boundary.',cropBounds=m['box'],cropSize=[320,320],cropVertices=pts,polygon=poly,center=[sum(x for x,y in poly)/len(poly),sum(y for x,y in poly)/len(poly)],reviewerKind='assistant'));im=Image.open(r/f'old-boundary-{i+1}.png');ImageDraw.Draw(im).line(pts+[pts[0]],fill='#00ffff',width=2);sheet.paste(im,(i*320,30));d.text((i*320+5,5),m['id'],fill='white')
(r/'assistant-old-boundary-corrections.json').write_text(json.dumps(records,indent=2)+'\n');sheet.save(r/'assistant-old-corrected-boundaries.jpg',quality=98)
