#!/usr/bin/env python3
"""Pre-label the full wall with overlapping SAM2.1 Small tiles; output review suggestions."""
import argparse
import hashlib
import json
from pathlib import Path
import time
from sam2_experiment_top_left import candidate_centers

ROOT = Path(__file__).resolve().parents[1]


def overlap(a, b):
    """Rasterized polygon IoU and intersection/min-area at quarter resolution."""
    import cv2
    import numpy as np
    aa = np.rint(np.array(a) * [1823, 1378.5]).astype(np.int32)
    bb = np.rint(np.array(b) * [1823, 1378.5]).astype(np.int32)
    if (aa.max(axis=0) < bb.min(axis=0)).any() or (bb.max(axis=0) < aa.min(axis=0)).any():
        return 0., 0.
    lower = np.minimum(aa.min(axis=0), bb.min(axis=0))
    upper = np.maximum(aa.max(axis=0), bb.max(axis=0))
    shape = (int(upper[1] - lower[1] + 1), int(upper[0] - lower[0] + 1))
    x, y = np.zeros(shape, np.uint8), np.zeros(shape, np.uint8)
    cv2.fillPoly(x, [aa - lower], 1); cv2.fillPoly(y, [bb - lower], 1)
    intersection = int((x & y).sum())
    areas = int(x.sum()), int(y.sum())
    return intersection / max(1, sum(areas) - intersection), intersection / max(1, min(areas))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'src/data/experiments/full_wall_sam2_suggestions.json')
    parser.add_argument('--groundtruth', type=Path, default=ROOT / 'src/data/polygons/holds.json')
    parser.add_argument('--min-score', type=float, default=.88)
    parser.add_argument('--threads', type=int, default=4)
    args = parser.parse_args()
    import torch
    import cv2
    import numpy as np
    from PIL import Image, ImageDraw
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor
    started = time.monotonic()
    cuda = torch.cuda.is_available()
    device = 'cuda' if cuda else 'cpu'
    print(f'CUDA available: {cuda}; using {device}', flush=True)
    torch.manual_seed(0); np.random.seed(0); torch.set_num_threads(args.threads)
    path = ROOT / 'public/wall/stoneham-spraywall-canonical.jpg'
    image = Image.open(path).convert('RGB'); width, height = image.size
    groundtruth_path = args.groundtruth
    groundtruth_data = json.loads(groundtruth_path.read_text())
    groundtruth = groundtruth_data if isinstance(groundtruth_data, list) else groundtruth_data['holds']
    centers = candidate_centers(ROOT / 'src/data/polygons/holds.json')
    model = build_sam2('configs/sam2.1/sam2.1_hiera_s.yaml', str(args.checkpoint), device=device, apply_postprocessing=False)
    predictor = SAM2ImagePredictor(model)
    proposals, prompt_count = [], 0
    with torch.inference_mode():
        for row in range(3):
            for col in range(3):
                left, top = max(0, round(col * width / 3) - 160), max(0, round(row * height / 3) - 160)
                right, bottom = min(width, round((col + 1) * width / 3) + 160), min(height, round((row + 1) * height / 3) + 160)
                crop = np.array(image.crop((left, top, right, bottom)), copy=True)
                h, w = crop.shape[:2]
                prompts = [(x * width - left, y * height - top) for x, y in centers if left < x * width < right and top < y * height < bottom]
                for gy in range(6):
                    for gx in range(6):
                        point = ((gx + .5) * w / 6, (gy + .5) * h / 6)
                        if all((point[0] - x) ** 2 + (point[1] - y) ** 2 > 35 ** 2 for x, y in prompts): prompts.append(point)
                predictor.set_image(crop)
                hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
                foreground = (hsv[:, :, 1] > 45) | (hsv[:, :, 2] < 130)
                before = len(proposals)
                for point in prompts:
                    prompt_count += 1
                    masks, scores, _ = predictor.predict(point_coords=np.array([point], np.float32), point_labels=np.array([1], np.int32), multimask_output=True)
                    choices = []
                    for mask, score in zip(masks, scores):
                        if float(score) < args.min_score: continue
                        count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
                        label = labels[min(h - 1, int(point[1])), min(w - 1, int(point[0]))]
                        if label == 0 or count < 2: continue
                        area = int(stats[label, cv2.CC_STAT_AREA])
                        if not 150 <= area <= w * h * .12: continue
                        component = labels == label
                        if component[0].any() or component[-1].any() or component[:, 0].any() or component[:, -1].any(): continue
                        if float(foreground[component].mean()) < .35: continue
                        choices.append((float(score), component))
                    if not choices: continue
                    score, mask = max(choices, key=lambda item: item[0])
                    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                    contour = max(contours, key=cv2.contourArea)
                    epsilon = max(.1, .005 * cv2.arcLength(contour, True))
                    polygon = cv2.approxPolyDP(contour, epsilon, True)
                    while len(polygon) > 16:
                        epsilon *= 1.2; polygon = cv2.approxPolyDP(contour, epsilon, True)
                    if len(polygon) < 3: continue
                    ys, xs = np.nonzero(mask)
                    proposals.append(dict(kind='hold', center=[round((float(xs.mean()) + left) / width, 7), round((float(ys.mean()) + top) / height, 7)],
                        polygon=[[round((int(x) + left) / width, 7), round((int(y) + top) / height, 7)] for x, y in polygon[:, 0]], score=round(score, 5)))
                print(f'Tile {row * 3 + col + 1}/9: {len(prompts)} prompts, {len(proposals) - before} masks', flush=True)
    unique, skipped_gt = [], 0
    for proposal in sorted(proposals, key=lambda h: -h['score']):
        if any(overlap(proposal['polygon'], h['polygon'])[1] > .7 for h in groundtruth):
            skipped_gt += 1; continue
        if any((lambda pair: pair[0] > .65 or pair[1] > .85)(overlap(proposal['polygon'], h['polygon'])) for h in unique): continue
        unique.append(proposal)
    unique.sort(key=lambda hold: (hold['center'][1], hold['center'][0]))
    for index, hold in enumerate(unique, 1): hold['id'] = f'sam2-auto-{index:04d}'
    payload = dict(metadata=dict(status='success', model='SAM2.1 Small', cuda_available=cuda, device=device,
        image_size=[width, height], image_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        groundtruth_sha256=hashlib.sha256(groundtruth_path.read_bytes()).hexdigest(), groundtruth_count=len(groundtruth),
        checkpoint_sha256=hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(), prompt_count=prompt_count,
        tile_grid=[3, 3], overlap_pixels=160, min_score=args.min_score, masks_before_dedup=len(proposals),
        masks_overlapping_groundtruth=skipped_gt, polygon_count=len(unique), elapsed_seconds=round(time.monotonic() - started, 2),
        review_required=True), holds=unique)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + '\n')
    overlay = image.copy(); overlay.thumbnail((2048, 2048)); overlay = overlay.convert('RGBA')
    layer = Image.new('RGBA', overlay.size); draw = ImageDraw.Draw(layer)
    for hold in unique:
        poly = [(x * overlay.width, y * overlay.height) for x, y in hold['polygon']]
        draw.polygon(poly, fill=(255, 180, 40, 60), outline=(255, 180, 40, 230), width=2)
    for hold in groundtruth:
        draw.polygon([(x * overlay.width, y * overlay.height) for x, y in hold['polygon']], outline=(40, 210, 255, 255), width=2)
    Image.alpha_composite(overlay, layer).convert('RGB').save(ROOT / 'artifacts/sam2-full-wall-suggestions.jpg', quality=95)
    print(f'Saved {len(unique)} review suggestions; {skipped_gt} overlapping-GT masks excluded', flush=True)


if __name__ == '__main__': main()
