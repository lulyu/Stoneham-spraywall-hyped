from pathlib import Path
import json
r=Path('/workspace/wall-comparison-2026-11-21');boxes=json.loads((r/'manual-boundary-crop-boxes.json').read_text());polys={
7:[(72,215),(92,178),(128,140),(175,116),(245,101),(291,104),(321,134),(332,170),(319,204),(283,234),(239,263),(185,292),(132,295),(95,277),(75,249)],
17:[(55,241),(112,175),(163,116),(205,58),(216,12),(236,7),(253,33),(277,109),(302,155),(326,165),(332,208),(306,263),(276,302),(217,316),(150,311),(79,282)],
20:[(77,119),(95,90),(139,66),(195,55),(241,61),(283,94),(311,139),(328,186),(329,250),(313,290),(273,315),(244,338),(208,293),(167,237),(124,183),(91,145)],
25:[(51,167),(72,129),(112,83),(129,86),(163,101),(204,120),(245,131),(286,149),(322,160),(349,176),(304,191),(249,211),(200,239),(150,277),(97,315),(79,286)],
26:[(64,235),(81,206),(135,191),(181,170),(217,128),(253,130),(282,158),(300,189),(326,223),(328,253),(307,272),(262,264),(216,259),(166,276),(115,282),(76,268)],
27:[(65,194),(84,174),(101,122),(130,96),(181,80),(226,87),(267,92),(306,100),(327,120),(325,146),(289,178),(248,211),(219,268),(198,299),(145,312),(91,324)],
35:[(48,281),(90,229),(127,180),(163,121),(196,65),(216,33),(228,42),(243,91),(276,82),(302,100),(314,157),(328,197),(310,296),(286,330),(190,342),(101,329)],
36:[(67,228),(125,217),(176,192),(213,153),(242,111),(264,100),(285,111),(310,143),(326,181),(328,218),(310,251),(272,282),(229,300),(167,310),(111,305),(86,279)],
38:[(76,198),(84,153),(110,109),(143,83),(185,89),(217,97),(263,96),(298,102),(320,121),(331,147),(320,184),(285,218),(241,255),(191,293),(134,319),(99,283)],
41:[(60,281),(85,255),(135,230),(174,192),(197,146),(224,89),(239,80),(253,109),(257,148),(281,170),(292,204),(325,226),(337,252),(308,289),(227,300),(115,300)],
51:[(99,174),(111,133),(146,94),(193,70),(220,64),(226,113),(243,156),(247,194),(265,232),(270,273),(298,321),(265,334),(216,326),(168,306),(137,272),(113,225)]}
records=[]
for index,points in polys.items():
 identifier=f'nov21-N{index:02d}';x0,y0,x1,y1=boxes[identifier];polygon=[[(x0+x*(x1-x0)/400)/7292,(y0+y*(y1-y0)/400)/5514] for x,y in points];records.append(dict(hintId=identifier,reviewer='Codex (assistant visual review)',reviewerKind='assistant',polygon=polygon,center=[sum(x for x,y in polygon)/len(polygon),sum(y for x,y in polygon)/len(polygon)],method='visual polygon correction on labeled 400-pixel crop; exclude shadow, neighboring holds and bolt holes outside the body',evidence=['manual-new-boundaries-1.jpg' if index<=27 else 'manual-new-boundaries-2.jpg'],cropBox=boxes[identifier],cropVertices=points))
(r/'assistant-boundary-corrections.json').write_text(json.dumps(records,indent=2));print('Recorded',len(records),'explicit visual boundary corrections')
from PIL import Image,ImageDraw
im=Image.open(r/'new-wall-preview-r2/wall.jpg');sheet=Image.new('RGB',(1600,1200),'#171717');d=ImageDraw.Draw(sheet)
for i,v in enumerate(records):
 box=v['cropBox'];crop=im.crop(box).resize((400,370));draw=ImageDraw.Draw(crop);pts=[(x,y*370/400) for x,y in v['cropVertices']];draw.line(pts+[pts[0]],fill='#00ffcc',width=2);x=i%4*400;y=i//4*400;sheet.paste(crop,(x,y+28));d.text((x+10,y+5),v['hintId']+' | assistant corrected',fill='white')
sheet.save(r/'assistant-corrected-boundaries.jpg',quality=96)
