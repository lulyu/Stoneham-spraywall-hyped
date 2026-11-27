from pathlib import Path
import json
r=Path('/workspace/wall-comparison-2026-11-27');ranked=sorted([v for v in json.loads((r/'hold-comparison-scores.json').read_text()) if v['best']],key=lambda x:x['best']['score'],reverse=True)
replacement={1:'N27',2:'N02',3:'N03-06',4:'R04',5:'N07',6:'R06',7:'N08',8:'R08',9:'N33',10:'R10',11:'N16',12:'N04-05',13:'N40',14:'N33',15:'N13-15',17:'N25-26',18:'R18',19:'R19',21:'N18-19',22:'N14-17',26:'N35',32:'N20-21',34:'N25-26'}
rotation=[16,20,23,24,25,27,28,29,30,36]
items=[]
for rank,tag in replacement.items():
 x=ranked[rank-1];items.append(dict(id=x['id'],rank=rank,decision='remove-old-position',newHint='nov27-'+tag,reason='Visible replacement, removal, or movement in supplied new photographs; do not transfer identity.',evidence=['suspects-1..3.jpg','identity-sector-1..9.jpg','change-detail-1..4.jpg']))
for rank in rotation:
 x=ranked[rank-1];items.append(dict(id=x['id'],rank=rank,decision='fresh-id-for-changed-pose',reason='Visible hold rotation or displacement relative to stationary neighbors; treat a changed grip configuration as a new position.',evidence=['identity-detail-1..3.jpg','identity-sector-1..9.jpg']))
(r/'identity-review-plan.json').write_text(json.dumps(dict(reviewerKind='assistant',policy='confirmed movement or rotation gets a fresh ID; uncertain cases remain pending',decisions=items),indent=2)+'\n');print('Confirmed replacement/movement/rotation decisions:',len(items))
