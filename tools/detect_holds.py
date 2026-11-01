#!/usr/bin/env python3
"""Bootstrap polygon hold candidates from the canonical wall image.

This is intentionally a starting point, not ground truth. The output is meant to be
cleaned in the wall-editor UI. Polygons are normalized to [0, 1] coordinates and
capped at 16 vertices so they remain lightweight for SVG rendering.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def simplify_contour(contour: np.ndarray, max_vertices: int = 16) -> np.ndarray:
    perimeter = cv2.arcLength(contour, True)
    epsilon = max(1e-6, 0.008 * perimeter)
    approx = cv2.approxPolyDP(contour, epsilon, True)
    while len(approx) > max_vertices and epsilon < 0.08 * perimeter:
        epsilon *= 1.25
        approx = cv2.approxPolyDP(contour, epsilon, True)
    return approx


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--scale", type=float, default=0.25)
    parser.add_argument("--max-vertices", type=int, default=16)
    args = parser.parse_args()

    image = cv2.imread(str(args.image))
    if image is None:
        raise SystemExit(f"Could not read image: {args.image}")

    image_h, image_w = image.shape[:2]
    small = cv2.resize(
        image,
        (0, 0),
        fx=args.scale,
        fy=args.scale,
        interpolation=cv2.INTER_AREA,
    )

    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).astype(np.float32)
    lightness, a, b = cv2.split(lab)
    chroma = np.sqrt((a - 128) ** 2 + (b - 128) ** 2)

    # The Stoneham wall is a warm, low-chroma gray. Colored holds separate well by
    # chroma; black volumes / dark holds separate by lightness.
    mask = ((chroma > 18) | (lightness < 115)).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))

    count, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, 8)
    candidates: list[dict] = []

    for component_id in range(1, count):
        area = int(stats[component_id, cv2.CC_STAT_AREA])
        x = int(stats[component_id, cv2.CC_STAT_LEFT])
        y = int(stats[component_id, cv2.CC_STAT_TOP])
        width = int(stats[component_id, cv2.CC_STAT_WIDTH])
        height = int(stats[component_id, cv2.CC_STAT_HEIGHT])

        # Tuned only to suppress obvious speckles, panel seams and signage.
        if area < 65:
            continue
        if y < 55 and area > 800:
            continue
        if width > small.shape[1] * 0.45 and height < 40:
            continue
        if height > small.shape[0] * 0.35 and width < 18:
            continue
        if max(width / max(1, height), height / max(1, width)) > 12 and area < 2500:
            continue

        component = (labels == component_id).astype(np.uint8) * 255
        contours, _ = cv2.findContours(component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        contour = max(contours, key=cv2.contourArea)
        if cv2.contourArea(contour) < 45:
            continue

        polygon = simplify_contour(contour, args.max_vertices)
        if len(polygon) < 3:
            continue

        points = []
        for px, py in polygon[:, 0, :]:
            full_x = float(px / args.scale)
            full_y = float(py / args.scale)
            points.append([round(full_x / image_w, 5), round(full_y / image_h, 5)])

        cx = float(centroids[component_id][0] / args.scale)
        cy = float(centroids[component_id][1] / args.scale)
        full_area = area / (args.scale * args.scale)
        kind = "volume" if full_area > 250_000 else "macro" if full_area > 50_000 else "hold"

        candidates.append(
            {
                "id": "",
                "center": [round(cx / image_w, 5), round(cy / image_h, 5)],
                "polygon": points,
                "kind": kind,
                "source": "auto-v1",
            }
        )

    candidates.sort(key=lambda hold: (hold["center"][1], hold["center"][0]))
    for index, hold in enumerate(candidates, 1):
        hold["id"] = f"auto-{index:03d}"

    payload = {
        "wallId": "stoneham-spraywall-v1",
        "imageWidth": image_w,
        "imageHeight": image_h,
        "maxPolygonVertices": args.max_vertices,
        "candidateCount": len(candidates),
        "holds": candidates,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {len(candidates)} candidates -> {args.output}")


if __name__ == "__main__":
    main()
