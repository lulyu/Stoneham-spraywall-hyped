#!/usr/bin/env python3
"""Render an exact polygon-coverage visualization, filling accepted holds with nearby wall gray."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--annotations', type=Path, default=ROOT / 'src/data/annotations/full_wall_manual_v2.json')
    parser.add_argument('--image', type=Path, default=ROOT / 'public/wall/stoneham-spraywall-canonical.jpg')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/stoneham-unmarked-holds-preview.jpg')
    args = parser.parse_args()
    import cv2
    import numpy as np
    from PIL import Image
    from sam2_annotation_server import clean_dataset

    data = json.loads(args.annotations.read_text())
    holds = clean_dataset(data)
    image = np.array(Image.open(args.image).convert('RGB'))
    height, width = image.shape[:2]
    assert [width, height] == data['image_size'] == [7292, 5514]
    mask = np.zeros((height, width), np.uint8)
    polygons = [np.rint(np.array(hold['polygon']) * [width, height]).astype(np.int32) for hold in holds]
    for polygon in polygons:
        cv2.fillPoly(mask, [polygon], 255)
    # Estimate background only from currently unmasked, bright, low-chroma pixels.
    small = image[::8, ::8].astype(np.int16)
    gray = ((small.max(2) - small.min(2)) < 35) & (small.mean(2) > 100) & (small.mean(2) < 235) & (mask[::8, ::8] == 0)
    if not gray.any(): raise RuntimeError('Could not estimate neutral wall background.')
    fallback = np.rint(np.median(small[gray], axis=0)).astype(np.uint8)
    preview = image.copy()
    for polygon in polygons:
        x, y, w, h = cv2.boundingRect(polygon)
        left, top, right, bottom = max(0, x - 55), max(0, y - 55), min(width, x + w + 55), min(height, y + h + 55)
        sample = image[top:bottom:3, left:right:3].astype(np.int16)
        eligible = (mask[top:bottom:3, left:right:3] == 0) & ((sample.max(2) - sample.min(2)) < 35) & (sample.mean(2) > 100) & (sample.mean(2) < 235)
        color = np.rint(np.median(sample[eligible], axis=0)).astype(np.uint8) if eligible.sum() >= 30 else fallback
        cv2.fillPoly(preview, [polygon], tuple(int(c) for c in color))
    assert np.array_equal(preview[mask == 0], image[mask == 0]), 'Visualization changed pixels outside annotations'
    args.output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(preview).save(args.output, quality=97, subsampling=0)
    mask_path = args.output.with_name('stoneham-annotated-holds-mask.png')
    Image.fromarray(mask).save(mask_path)
    metadata = dict(annotation_file=str(args.annotations.relative_to(ROOT)), hold_count=len(holds),
                    annotation_sha256=hashlib.sha256(args.annotations.read_bytes()).hexdigest(),
                    image_sha256=hashlib.sha256(args.image.read_bytes()).hexdigest(), image_size=[width,height],
                    masked_pixel_fraction=round(float((mask > 0).mean()), 5),
                    fill='Median nearby bright, low-chroma unmasked wall pixels per polygon; global wall median fallback.',
                    global_wall_rgb=fallback.tolist(), outside_polygons_unchanged_before_jpeg=True)
    args.output.with_suffix('.metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps(metadata, indent=2))


if __name__ == '__main__': main()
