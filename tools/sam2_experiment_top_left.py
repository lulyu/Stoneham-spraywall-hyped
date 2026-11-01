#!/usr/bin/env python3
"""SAM2.1 Small, candidate-center + sparse-grid experiment on the top-left 1/3 crop."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
MODEL_CONFIG = 'configs/sam2.1/sam2.1_hiera_s.yaml'
SAM2_REVISION = '2b90b9f5ceec907a1c18123530e92e794ad901a4'


def candidate_centers(path: Path) -> list[tuple[float, float]]:
    """Read the same validated uint16 dataset used by the app; never evaluate TS."""
    match = re.search(r"const PACKED = '([^']+)'", path.read_text())
    if not match:
        raise ValueError(f'No packed candidates in {path}')
    data = base64.b64decode(match[1], validate=True)
    centers, offset = [], 0
    while offset < len(data):
        kind, vertices, x, y = struct.unpack_from('<BBHH', data, offset)
        if kind > 2 or not 3 <= vertices <= 16:
            raise ValueError('Invalid packed candidate record')
        offset += 6 + vertices * 4
        if offset > len(data):
            raise ValueError('Truncated packed candidates')
        centers.append((x / 65535, y / 65535))
    return centers


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def run(args: argparse.Namespace, report: dict) -> None:
    try:
        import torch
    except ImportError as error:
        raise RuntimeError('PyTorch is missing. Follow docs/sam2-top-left-experiment.md to install the CPU or CUDA dependencies.') from error
    # Check this before constructing or loading a model.
    cuda = torch.cuda.is_available()
    report.update(cuda_available=cuda, torch_version=torch.__version__)
    device = 'cuda' if cuda and args.device != 'cpu' else 'cpu'
    if args.device == 'cuda' and not cuda:
        raise RuntimeError('CUDA was requested but torch.cuda.is_available() is false. Use --device auto or cpu.')
    report['device'] = device
    print(f'CUDA available: {cuda}; using {device}', flush=True)
    try:
        import cv2
        import numpy as np
        from PIL import Image, ImageDraw, ImageFont
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
    except ImportError as error:
        raise RuntimeError(f'SAM2 dependency missing: {error}. See docs/sam2-top-left-experiment.md; CUDA extensions are optional.') from error

    torch.manual_seed(0)
    np.random.seed(0)
    torch.set_num_threads(args.threads)
    image = Image.open(args.image).convert('RGB')
    width, height = image.size
    crop_width, crop_height = round(width / 3), round(height / 3)
    crop = image.crop((0, 0, crop_width, crop_height))
    crop.save(args.artifacts / 'sam2-top-left-crop.jpg', quality=95)
    report.update(image_size=[width, height], crop_box=[0, 0, crop_width, crop_height],
                  image_sha256=sha256(args.image), model_config=MODEL_CONFIG,
                  sam2_revision=SAM2_REVISION, threads=args.threads)
    if not args.checkpoint.is_file():
        raise RuntimeError(f'Checkpoint missing: {args.checkpoint}. Download official sam2.1_hiera_small.pt as described in the experiment docs.')
    report['checkpoint_sha256'] = sha256(args.checkpoint)

    points = [(x * width, y * height) for x, y in candidate_centers(args.candidates)
              if 0 < x * width < crop_width and 0 < y * height < crop_height]
    candidate_count = len(points)
    for row in range(args.grid):
        for col in range(args.grid):
            point = ((col + .5) * crop_width / args.grid, (row + .5) * crop_height / args.grid)
            if all((point[0] - x) ** 2 + (point[1] - y) ** 2 > 35 ** 2 for x, y in points):
                points.append(point)
    report.update(candidate_prompt_count=candidate_count, prompt_count=len(points), grid=args.grid,
                  min_score=args.min_score, min_area=args.min_area, max_area_fraction=args.max_area_fraction,
                  candidates_sha256=sha256(args.candidates), min_foreground_fraction=args.min_foreground)
    print(f'Crop {crop_width}x{crop_height}: {candidate_count} candidate centers, {len(points)} total prompts', flush=True)
    # Disable optional CUDA postprocessing. OpenCV below handles components/contours on CPU.
    model = build_sam2(MODEL_CONFIG, str(args.checkpoint), device=device, apply_postprocessing=False)
    predictor = SAM2ImagePredictor(model)
    hsv = cv2.cvtColor(np.array(crop), cv2.COLOR_RGB2HSV)
    foreground = (hsv[:, :, 1] > 45) | (hsv[:, :, 2] < 130)
    accepted = []
    with torch.inference_mode():
        predictor.set_image(np.array(crop, copy=True))
        for index, point in enumerate(points):
            masks, scores, _ = predictor.predict(point_coords=np.array([point], dtype=np.float32),
                                                  point_labels=np.array([1], dtype=np.int32),
                                                  multimask_output=True)
            choices = []
            for mask, score in zip(masks, scores):
                if float(score) < args.min_score:
                    continue
                count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
                px, py = min(crop_width - 1, int(point[0])), min(crop_height - 1, int(point[1]))
                label = labels[py, px]
                if label == 0 or count < 2:
                    continue
                area = int(stats[label, cv2.CC_STAT_AREA])
                if not args.min_area <= area <= crop_width * crop_height * args.max_area_fraction:
                    continue
                component = labels == label
                # Cut-off objects cannot produce complete hold definitions.
                if component[0].any() or component[-1].any() or component[:, 0].any() or component[:, -1].any():
                    continue
                if float(foreground[component].mean()) < args.min_foreground:
                    continue
                choices.append((float(score), area, component))
            if not choices:
                continue
            score, area, mask = max(choices, key=lambda item: item[0])
            accepted.append(dict(score=score, area=area, mask=mask, prompt_index=index))
            if (index + 1) % 10 == 0:
                print(f'Processed {index + 1}/{len(points)} prompts', flush=True)

    # Prefer the highest-confidence duplicate; suppress nested masks too.
    unique = []
    for item in sorted(accepted, key=lambda item: (-item['score'], item['prompt_index'])):
        duplicate = False
        for other in unique:
            intersection = int(np.count_nonzero(item['mask'] & other['mask']))
            union = item['area'] + other['area'] - intersection
            if intersection / union > .65 or intersection / min(item['area'], other['area']) > .85:
                duplicate = True
                break
        if not duplicate:
            unique.append(item)
    unique.sort(key=lambda item: tuple(np.argwhere(item['mask']).mean(axis=0)))
    results = []
    for item in unique:
        contours, _ = cv2.findContours(item['mask'].astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contour = max(contours, key=cv2.contourArea)
        perimeter = cv2.arcLength(contour, True)
        epsilon = .005 * perimeter
        polygon = cv2.approxPolyDP(contour, epsilon, True)
        while len(polygon) > 16:
            epsilon *= 1.2
            polygon = cv2.approxPolyDP(contour, epsilon, True)
        if len(polygon) < 3:
            continue
        ys, xs = np.nonzero(item['mask'])
        results.append(dict(id=f'sam2-tl-{len(results) + 1:03d}', kind='hold',
                            center=[round(float(xs.mean()) / width, 7), round(float(ys.mean()) / height, 7)],
                            polygon=[[round(int(x) / width, 7), round(int(y) / height, 7)] for x, y in polygon[:, 0]],
                            score=round(item['score'], 5)))
    if not results:
        raise RuntimeError('SAM2 ran but no masks passed filtering. Inspect the crop and adjust score/area thresholds; no dataset was replaced.')
    report.update(status='success', polygon_count=len(results), masks_before_dedup=len(accepted))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({'metadata': report, 'holds': results}, indent=2) + '\n')

    for labeled, filename in [(False, 'sam2-top-left-overlay.jpg'), (True, 'sam2-top-left-overlay-labeled.jpg')]:
        layer = Image.new('RGBA', crop.size)
        draw = ImageDraw.Draw(layer)
        for index, hold in enumerate(results):
            color = tuple(int(value) for value in np.random.default_rng(index).integers(50, 240, 3))
            polygon = [(x * width, y * height) for x, y in hold['polygon']]
            draw.polygon(polygon, fill=(*color, 65), outline=(*color, 255), width=4)
        overlay = Image.alpha_composite(crop.convert('RGBA'), layer)
        if labeled:
            draw = ImageDraw.Draw(overlay)
            for hold in results:
                x, y = hold['center']
                draw.text((x * width, y * height), hold['id'], fill='white', stroke_width=2, stroke_fill='black', font=ImageFont.load_default(size=22))
        overlay.convert('RGB').save(args.artifacts / filename, quality=95)
    print(f'Saved {len(results)} polygons to {args.output}', flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, default=ROOT / 'public/wall/stoneham-spraywall-canonical.jpg')
    parser.add_argument('--candidates', type=Path, default=ROOT / 'src/data/polygons/auto-v1-packed.ts')
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'src/data/experiments/top_left_sam2_polygons.json')
    parser.add_argument('--artifacts', type=Path, default=ROOT / 'artifacts')
    parser.add_argument('--device', choices=['auto', 'cpu', 'cuda'], default='auto')
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--grid', type=int, default=6)
    parser.add_argument('--min-score', type=float, default=.7)
    parser.add_argument('--min-foreground', type=float, default=.35)
    parser.add_argument('--min-area', type=int, default=150)
    parser.add_argument('--max-area-fraction', type=float, default=.12)
    args = parser.parse_args()
    if args.threads < 1 or not 0 <= args.grid <= 32 or not 0 <= args.min_score <= 1 or not 0 <= args.min_foreground <= 1 or args.min_area < 1 or not 0 < args.max_area_fraction < 1:
        parser.error('Invalid threads, grid, score or area settings')
    args.artifacts.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    report = {'status': 'running', 'model': 'SAM2.1 Small', 'seed': 0}
    try:
        run(args, report)
    except Exception as error:
        report.update(status='failed', error=f'{type(error).__name__}: {error}')
        print(f'SAM2 experiment failed: {report["error"]}', file=sys.stderr)
        print('See docs/sam2-top-left-experiment.md for setup and CPU fallback.', file=sys.stderr)
    report['elapsed_seconds'] = round(time.monotonic() - started, 2)
    if report['status'] == 'success':
        payload = json.loads(args.output.read_text())
        payload['metadata'] = report
        args.output.write_text(json.dumps(payload, indent=2) + '\n')
    (args.artifacts / 'sam2-top-left-run.json').write_text(json.dumps(report, indent=2) + '\n')
    return 0 if report['status'] == 'success' else 1


if __name__ == '__main__':
    sys.exit(main())
