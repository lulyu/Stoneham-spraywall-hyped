from pathlib import Path
import json,zipfile,hashlib
r=Path('/workspace/wall-comparison-2026-11-27');archive=Path('/workspace/Stoneham-spraywall-project/reviews/2026-11-v10-assistant-reviewed');bundle=r/'v10-review-bundle';out=r/'v10-assistant-reviewed.zip'
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=5) as z:
 for name in ['manifest.json','holds_prelabels.json','review_queue.json','report.json','wall_registered.jpg','coverage.png','uncertainty.png','sam2-proposals.json','reference.jpg','reference-holds.json']:z.write(bundle/name,name)
 for name in ['review-progress.json','summary.json','confirmed-geometry.json']:z.write(archive/name,name)
 for name in ['preview.jpg','previous-vs-new.gif']:z.write(archive/'comparisons'/name,name)
 z.write(r/'viewer-offline.html','review.html');z.writestr('README.txt','Unpublished assistant-reviewed v10 candidate.\nExtract this ZIP and open review.html to compare photos and outlines offline.\nTo continue editing, import the extracted folder and review-progress.json into the existing annotation editor.\nReview decisions are attributed to Codex (assistant visual review).\nCurrent production remains v9. No route migration has been run.\n')
result=dict(file=out.name,bytes=out.stat().st_size,sha256=hashlib.sha256(out.read_bytes()).hexdigest());(r/'package-summary.json').write_text(json.dumps(result,indent=2));print(result)
