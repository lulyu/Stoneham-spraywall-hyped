"""Prompt SAM2 from inherited outlines on a versioned candidate; never approves holds."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import platform
import subprocess
import sys
import time

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
CONFIG = 'configs/sam2.1/sam2.1_hiera_s.yaml'


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    temporary.replace(path)


def raster(polygon, size, origin=(0, 0), scale=1):
    points = np.rint((np.asarray(polygon) * size - origin) * scale).astype(np.int32)
    return points


def bounds(polygon, size):
    p = np.asarray(polygon) * size
    return [math.floor(p[:, 0].min()), math.floor(p[:, 1].min()), math.ceil(p[:, 0].max()) + 1, math.ceil(p[:, 1].max()) + 1]


def coverage_fraction(polygon, coverage, size):
    x, y, right, bottom = bounds(polygon, size)
    x, y, right, bottom = max(0, x), max(0, y), min(size[0], right), min(size[1], bottom)
    if right <= x or bottom <= y:
        return 0.
    mask = np.zeros((bottom-y, right-x), np.uint8)
    cv2.fillPoly(mask, [raster(polygon, size, (x, y))], 1)
    return float(np.count_nonzero((coverage[y:bottom, x:right] > 0) & (mask > 0)) / max(1, mask.sum()))


def prompt_for(hold, size):
    """An interior seed resists small contour drift better than a concave centroid."""
    x, y, right, bottom = bounds(hold['polygon'], size)
    mask = np.zeros((bottom-y+2, right-x+2), np.uint8)
    cv2.fillPoly(mask, [raster(hold['polygon'], size, (x-1, y-1))], 255)
    distance = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    py, px = np.unravel_index(distance.argmax(), distance.shape)
    seed = [float(x-1+px), float(y-1+py)]
    padding = max(12, .1 * max(right-x, bottom-y))
    box = [max(0, x-padding), max(0, y-padding), min(size[0]-1, right+padding), min(size[1]-1, bottom+padding)]
    return seed, box


def select_mask(masks, scores, old, seed, region, coverage, uncertainty, size, min_score, min_observed=.99):
    left, top, right, bottom = region
    w, h = right-left, bottom-top
    old_mask = np.zeros((h, w), np.uint8)
    cv2.fillPoly(old_mask, [raster(old['polygon'], size, (left, top))], 1)
    old_area = max(1, int(old_mask.sum()))
    best = None
    for mask, score in zip(masks, scores):
        if not np.isfinite(score) or float(score) < min_score:
            continue
        _, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
        label = labels[min(h-1, max(0, round(seed[1]-top))), min(w-1, max(0, round(seed[0]-left)))]
        if label == 0:
            continue
        component = labels == label
        area = int(stats[label, cv2.CC_STAT_AREA])
        ratio = area / old_area
        if area < 50 or not .15 <= ratio <= 6:
            continue
        if component[0].any() or component[-1].any() or component[:, 0].any() or component[:, -1].any():
            continue
        observed = float(np.count_nonzero(component & (coverage[top:bottom, left:right] > 0)) / area)
        if observed < min_observed:
            continue
        intersection = int(np.count_nonzero(component & (old_mask > 0)))
        iou = intersection / max(1, area+old_area-intersection)
        ys, xs = np.nonzero(component)
        center = [(float(xs.mean())+left)/size[0], (float(ys.mean())+top)/size[1]]
        drift = float(np.linalg.norm((np.asarray(center)-old['center']) * size))
        contours, _ = cv2.findContours(component.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contour = max(contours, key=cv2.contourArea)
        epsilon = max(.1, .004 * cv2.arcLength(contour, True))
        polygon = cv2.approxPolyDP(contour, epsilon, True)
        while len(polygon) > 16:
            epsilon *= 1.2
            polygon = cv2.approxPolyDP(contour, epsilon, True)
        if len(polygon) < 3:
            continue
        normalized = [[(int(x)+left)/size[0], (int(y)+top)/size[1]] for x, y in polygon[:, 0]]
        # Simplification can bridge a narrow observation gap; validate exported geometry too.
        if coverage_fraction(normalized, coverage, size) < min_observed:
            continue
        quality = .55*float(score)+.35*iou-.08*abs(math.log(ratio))
        evidence = dict(modelScore=float(score), oldMaskIoU=iou, areaRatio=ratio, centerDriftPixels=drift,
                        observedFraction=observed, uncertaintyFraction=float(np.count_nonzero(uncertainty[top:bottom, left:right][component] & 14) / area))
        item = dict(kind=old['kind'], center=center, polygon=normalized, evidence=evidence, selectionQuality=quality)
        if best is None or quality > best['selectionQuality']:
            best = item
    return best


def polygon_overlap(a, b, size):
    aa, bb = np.asarray(a)*size, np.asarray(b)*size
    if (aa.max(axis=0) < bb.min(axis=0)).any() or (bb.max(axis=0) < aa.min(axis=0)).any():
        return 0., 0.
    lo = np.floor(np.minimum(aa.min(axis=0), bb.min(axis=0))).astype(int)
    hi = np.ceil(np.maximum(aa.max(axis=0), bb.max(axis=0))).astype(int)
    scale = min(1., 700/max(1, *(hi-lo)))
    shape = tuple((np.ceil((hi-lo+1)*scale).astype(int)+1)[::-1])
    x, y = np.zeros(shape, np.uint8), np.zeros(shape, np.uint8)
    cv2.fillPoly(x, [np.rint((aa-lo)*scale).astype(np.int32)], 1)
    cv2.fillPoly(y, [np.rint((bb-lo)*scale).astype(np.int32)], 1)
    intersection = int(np.count_nonzero(x & y)); ax, ay = int(x.sum()), int(y.sum())
    return intersection/max(1, ax+ay-intersection), intersection/max(1, min(ax, ay))


def deduplicate(proposals, size):
    """Deduplicate proposals only. Unreviewed old geometry is NEVER an exclusion mask."""
    unique = []
    mapping = {}
    for item in sorted(proposals, key=lambda p: (-p['selectionQuality'], p['id'])):
        duplicate = next((other for other in unique if (lambda pair: pair[0] > .7 or pair[1] > .88)(polygon_overlap(item['polygon'], other['polygon'], size))), None)
        if duplicate:
            duplicate['oldHoldIds'] = sorted(set(duplicate['oldHoldIds']+item['oldHoldIds']))
            mapping[item['id']] = duplicate['id']
        else:
            unique.append(item); mapping[item['id']] = item['id']
    return unique, mapping


def recommendation(evidence):
    if evidence['uncertaintyFraction'] > 0:
        return 'alignment-needs-review'
    if evidence['oldMaskIoU'] >= .8 and .75 <= evidence['areaRatio'] <= 1.3 and evidence['centerDriftPixels'] < 25:
        return 'possible-unchanged'
    if evidence['oldMaskIoU'] >= .4 and .4 <= evidence['areaRatio'] <= 2.5:
        return 'suggested-refinement'
    return 'possible-change-or-prompt-error'


def overlays(image, old, proposals, output):
    view = image.copy(); view.thumbnail((2400, 2400)); view = view.convert('RGBA')
    layer = Image.new('RGBA', view.size); draw = ImageDraw.Draw(layer)
    for hold in old:
        draw.line([(u*view.width, v*view.height) for u, v in hold['polygon']+[hold['polygon'][0]]], fill=(35, 220, 255, 200), width=1)
    for hold in proposals:
        draw.polygon([(u*view.width, v*view.height) for u, v in hold['polygon']], fill=(255, 170, 35, 35), outline=(255, 170, 35, 245), width=2)
    result = Image.alpha_composite(view, layer).convert('RGB')
    result.save(output/'old-vs-sam2-overlay.jpg', quality=95)
    new_only = image.copy(); new_only.thumbnail((2400, 2400)); draw = ImageDraw.Draw(new_only)
    for hold in proposals:
        draw.line([(u*new_only.width, v*new_only.height) for u, v in hold['polygon']+[hold['polygon'][0]]], fill='#ffba35', width=2)
    new_only.save(output/'sam2-proposals-overlay.jpg', quality=95)


def run(args):
    started = time.monotonic()
    include_partial = getattr(args, 'include_partial', False)
    if args.output.exists() and any(args.output.iterdir()):
        raise ValueError('Choose a new/empty output directory; prior experiment data is never overwritten.')
    if any((ROOT/p).resolve() == args.output.resolve() or (ROOT/p).resolve() in args.output.resolve().parents for p in ['public', 'src', 'backend', 'tools']):
        raise ValueError('Run outputs must be separate from production/source paths.')
    args.output.mkdir(parents=True, exist_ok=True)
    try:
        import torch
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
    except ImportError as error:
        raise RuntimeError('Install the pinned SAM2 CPU environment from docs/sam2-top-left-experiment.md. '+str(error)) from error
    cuda = torch.cuda.is_available()
    print(f'CUDA available: {cuda}; using {"cuda" if cuda else "cpu"}', flush=True)
    if not args.checkpoint.is_file():
        raise ValueError('Missing official SAM2.1 Small checkpoint; see docs/sam2-top-left-experiment.md.')
    if digest(args.checkpoint) != '6d1aa6f30de5c92224f8172114de081d104bbd23dd9dc5c58996f0cad5dc4d38':
        raise ValueError('Checkpoint SHA-256 does not match the pinned SAM2.1 Small model.')
    version = json.loads(args.version_manifest.read_text()); base = args.version_manifest.parent
    paths = {'image':base/version['image'], 'coverage':base/version['coverage'], 'uncertainty':base/version['uncertainty'], 'oldHolds':args.old_holds}
    expected = {'image':version['imageSha256'], 'coverage':version['coverageSha256'], 'uncertainty':version['uncertaintySha256'], 'oldHolds':version['referenceHoldsSha256']}
    if version.get('publishable') is not False or version.get('status') != 'candidate-needs-review':
        raise ValueError('Expected an explicitly unreviewed candidate version.')
    hashes = {k:digest(p) for k, p in paths.items()}
    if hashes != expected:
        raise ValueError('Candidate image/masks/reference holds differ from the version manifest hashes.')
    image = Image.open(paths['image']).convert('RGB'); size = image.size
    coverage = np.asarray(Image.open(paths['coverage']).convert('L')); uncertainty = np.asarray(Image.open(paths['uncertainty']).convert('L'))
    if list(size) != version['imageSize'] or coverage.shape != size[::-1] or uncertainty.shape != size[::-1]:
        raise ValueError('Image/mask coordinate frames differ.')
    old = json.loads(paths['oldHolds'].read_text())
    from tools.sam2_annotation_server import clean_dataset
    old = clean_dataset(old)
    torch.manual_seed(args.seed); np.random.seed(args.seed); cv2.setRNGSeed(args.seed); torch.set_num_threads(args.threads)
    model = build_sam2(CONFIG, str(args.checkpoint), device='cuda' if cuda else 'cpu', apply_postprocessing=False)
    predictor = SAM2ImagePredictor(model)
    entries = []
    for hold in old:
        fraction = coverage_fraction(hold['polygon'], coverage, size)
        entries.append(dict(oldHoldId=hold['id'], status='inherited-unreviewed', oldGeometry=hold, observationFraction=fraction,
                            proposalId=None, recommendation='not-observed' if fraction == 0 else 'partial-observation' if fraction < .99 else 'no-usable-mask', reasonCodes=[]))
    by_id = {e['oldHoldId']:e for e in entries}; proposals = []; prompts = 0
    with torch.inference_mode():
        for row in range(3):
            for col in range(3):
                group = [h for h in old if min(2,int(h['center'][0]*3)) == col and min(2,int(h['center'][1]*3)) == row and (include_partial or by_id[h['id']]['observationFraction'] >= .99)]
                if not group:
                    continue
                initial = [max(0,round(col*size[0]/3)-160), max(0,round(row*size[1]/3)-160), min(size[0],round((col+1)*size[0]/3)+160), min(size[1],round((row+1)*size[1]/3)+160)]
                boxes = [prompt_for(h,size)[1] for h in group]
                region = [max(0,math.floor(min(initial[0],*(b[0]-64 for b in boxes)))),max(0,math.floor(min(initial[1],*(b[1]-64 for b in boxes)))),min(size[0],math.ceil(max(initial[2],*(b[2]+64 for b in boxes)))),min(size[1],math.ceil(max(initial[3],*(b[3]+64 for b in boxes))))]
                left,top,right,bottom = region
                predictor.set_image(np.asarray(image.crop(region)))
                before = len(proposals)
                for hold in group:
                    seed, box = prompt_for(hold,size); prompts += 1
                    masks,scores,_ = predictor.predict(point_coords=np.asarray([[seed[0]-left,seed[1]-top]],np.float32),point_labels=np.array([1],np.int32),box=np.asarray(box,np.float32)-[left,top,left,top],multimask_output=True)
                    entry = by_id[hold['id']]
                    entry['prompt'] = dict(point=[seed[0]/size[0],seed[1]/size[1]],box=[box[0]/size[0],box[1]/size[1],box[2]/size[0],box[3]/size[1]],tileRegion=region)
                    best = select_mask(masks,scores,hold,seed,region,coverage,uncertainty,size,args.min_score,min_observed=0 if include_partial else .99)
                    if best:
                        best.update(id='sam2-v5-'+hashlib.sha256((version['imageSha256']+hold['id']).encode()).hexdigest()[:14],oldHoldIds=[hold['id']],status='needs-review')
                        entry.update(proposalId=best['id'],recommendation=recommendation(best['evidence']),evidence=best['evidence'])
                        if best['evidence']['observedFraction'] < .99 or entry['observationFraction'] < .99:
                            entry.update(recommendation='partial-observation')
                            entry['reasonCodes'].append('reference-filled-mask-requires-manual-review')
                        proposals.append(best)
                    else:
                        entry['reasonCodes'].append('no-eligible-mask-is-not-proof-of-removal')
                print(f'Tile {row*3+col+1}/9: {len(group)} inherited prompts, {len(proposals)-before} usable masks',flush=True)
                write(args.output/'progress.json',dict(prompts=prompts,masks=len(proposals),entries=entries,publishable=False))
    unique, mapping = deduplicate(proposals,size)
    for entry in entries:
        if entry['proposalId']:
            entry['proposalId'] = mapping[entry['proposalId']]
    for proposal in unique:
        if len(proposal['oldHoldIds'])>1:
            for identifier in proposal['oldHoldIds']:
                by_id[identifier]['recommendation']='possible-merge-or-duplicate-prompt'
    if any(digest(path)!=hashes[key] for key,path in paths.items()):
        raise ValueError('Inputs changed during inference; output is invalid.')
    counts = {name:sum(e['recommendation']==name for e in entries) for name in sorted({e['recommendation'] for e in entries})}
    try:
        commit = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True,stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        commit = 'unavailable-in-source-only-runtime'
    metadata = dict(wallVersionId=version['wallVersionId'],referenceVersion=version['referenceVersion'],sourceSessionId=version['sourceSession']['sessionId'],imageSize=list(size),hashes=hashes,versionManifestSha256=digest(args.version_manifest),checkpointSha256=digest(args.checkpoint),model='SAM2.1 Small',device='cuda' if cuda else 'cpu',cudaAvailable=cuda,python=platform.python_version(),torch=torch.__version__,opencv=cv2.__version__,numpy=np.__version__,seed=args.seed,threads=args.threads,minScore=args.min_score,oldHoldCount=len(old),promptCount=prompts,masksBeforeDedup=len(proposals),proposalCount=len(unique),recommendations=counts,elapsedSeconds=round(time.monotonic()-started,2),codeCommit=commit,scriptSha256=digest(__file__),reviewRequired=True,acceptedHoldCount=0,limitations=['Point and box prompts assume rough old placement, not continued hold identity.','Reference-filled/partially observed old locations are skipped.','No automatic removed classification or approval; SAM2 score is not identity evidence.','No search for entirely new holds away from old prompts in this first pass.','No automatic publication or old-route migration.'])
    payload = dict(format='stoneham-sam2-refresh-v1',datasetRole='unreviewed-model-proposals',wallId=version['wallId'],publishable=False,metadata=metadata,entries=entries,proposals=unique)
    metadata['includePartialObservationPrompts'] = include_partial
    if include_partial:
        metadata['limitations'][1] = 'Partial/reference-filled locations were explicitly prompted; actual observation evidence remains recorded and bulk approval still excludes these regions.'
    write(args.output/'sam2-refresh.json',payload)
    write(args.output/'report.json',metadata)
    overlays(image,old,unique,args.output)
    print(json.dumps({k:v for k,v in metadata.items() if k not in ['limitations','hashes']},indent=2),flush=True)
    return 0


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version-manifest',type=Path,required=True)
    parser.add_argument('--old-holds',type=Path,default=ROOT/'src/data/polygons/holds.json')
    parser.add_argument('--checkpoint',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--threads',type=int,default=4)
    parser.add_argument('--seed',type=int,default=0)
    parser.add_argument('--min-score',type=float,default=.75)
    parser.add_argument('--include-partial',action='store_true',help='Also prompt partial/reference-filled locations as manual-review suggestions; never changes coverage or approves them.')
    args=parser.parse_args()
    if args.threads<1 or not 0<=args.min_score<=1:
        parser.error('threads must be positive and min-score between 0 and 1.')
    try:
        return run(args)
    except Exception as error:
        print(f'SAM2 refresh failed: {type(error).__name__}: {error}. See docs/sam2-top-left-experiment.md for model setup.',file=sys.stderr)
        return 1


if __name__=='__main__':raise SystemExit(main())
