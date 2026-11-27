from pathlib import Path
import json
r=Path('/workspace/wall-comparison-2026-11-27')
# Separate physical holds identified from the old/new sectors and numbered residual crops.
items=[
('N01','New ribbed green hold',[.433,.149,.453,.174]),
('N03-06','Green triangular replacement',[.438,.175,.484,.217]),
('N02','New upper-right green hold',[.815,.164,.833,.183]),
('N04-05','Purple replacement',[.877,.183,.909,.218]),
('N07','Purple replacement near timber',[.798,.194,.827,.226]),
('N08','Red hold in a new position',[.495,.287,.518,.306]),
('R10','Upper purple replacement',[.495,.265,.531,.295]),
('R04','Lower purple replacement',[.527,.291,.555,.314]),
('N09-green','New green hold above purple disk',[.887,.297,.911,.318]),
('R06','Yellow replacement below volume',[.894,.316,.925,.348]),
('N13-15','Yellow replacement on right edge',[.951,.395,.988,.431]),
('N14-17','Green hold in a new position',[.049,.401,.066,.437]),
('N16','Yellow replacement on left edge',[.021,.423,.052,.456]),
('N18-19','Yellow replacement above blue textured hold',[.294,.448,.326,.483]),
('N20-21','Purple replacement in center-right',[.642,.479,.674,.506]),
('N23','New small red hold below purple dome',[.191,.512,.212,.533]),
('N24','New red hold near blue striped hold',[.217,.546,.241,.572]),
('N25-26','Large green replacement',[.494,.552,.534,.595]),
('N27','Yellow replacement near purple crimp',[.641,.580,.672,.625]),
('R08','Green replacement above orange hold',[.812,.530,.838,.558]),
('R19','Black replacement beside volume',[.565,.183,.588,.205]),
('R18','White replacement near bottom',[.545,.843,.570,.875]),
('N30','New blue hold',[.337,.670,.360,.700]),
('N31','New orange hold on left',[.053,.685,.088,.726]),
('N33','Large yellow replacement',[.626,.743,.677,.811]),
('N35','Red replacement near bottom',[.335,.771,.380,.806]),
('N37','New lime hold near bottom',[.770,.794,.806,.825]),
('N39','New blue half-moon',[.644,.823,.673,.848]),
('N40','Red replacement near bottom left',[.187,.827,.232,.862]),
('N41','New green hold near bottom right',[.837,.847,.892,.893]),
]
hints=[]
for tag,name,box in items:
 x0,y0,x1,y1=box
 hints.append(dict(id='nov27-'+tag,name=name,kind='hold',center=[(x0+x1)/2,(y0+y1)/2],polygon=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]],visualEvidence=['identity-sector-1..9.jpg','new-candidates-1..2.jpg']))
(r/'new-location-hints.json').write_text(json.dumps(hints,indent=2)+'\n')
print(len(hints),'independent new-position prompts')
