"""Phase A: one-photo registration to a canonical frame, without publication.

Run with: python -m tools.wall_rescan.run --help
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys

try:
    import cv2
    import numpy as np
    from PIL import Image, ImageDraw, ImageOps, __version__ as pillow_version
except ImportError as error:
    raise SystemExit('Missing image dependencies. Create a venv and run: pip install -r tools/wall_rescan/requirements.txt\n' + str(error))
from .geometry import check_shape, exif_matrix, fit_registration, footprint, hull_fraction, project, resize_matrix, summary

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def load_image(path):
    with Image.open(path) as raw:
        size = raw.size
        orientation = int(raw.getexif().get(274, 1))
        image = ImageOps.exif_transpose(raw).convert('RGB')
    return image, {'raw_size': list(size), 'exif_orientation': orientation,
        'prepared_size': list(image.size), 'raw_to_prepared': exif_matrix(orientation, *size).tolist(),
        'lens_undistortion': 'none; camera calibration is not supplied'}


def working_image(image, max_side):
    ratio = min(1., max_side / max(image.size))
    size = tuple(max(1, round(n * ratio)) for n in image.size)
    small = image.resize(size, Image.Resampling.LANCZOS)
    gray = cv2.cvtColor(np.asarray(small), cv2.COLOR_RGB2GRAY)
    return gray, resize_matrix(image.size, size)


def matches(source, reference, max_side, features, seed):
    cv2.setRNGSeed(seed)
    sift = cv2.SIFT_create(nfeatures=features)
    a, sa = working_image(source, max_side)
    b, sb = working_image(reference, max_side)
    ka, da = sift.detectAndCompute(a, None)
    kb, db = sift.detectAndCompute(b, None)
    if da is None or db is None or len(da) < 2 or len(db) < 2:
        raise ValueError('Not enough SIFT features. Use a sharper overlapping photo or --alignment-anchors.')
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    nearest = matcher.knnMatch(da, db, k=2)
    reverse = matcher.match(db, da)
    mutual = {m.queryIdx: m.trainIdx for m in reverse}
    selected = [pair[0] for pair in nearest if len(pair) == 2 and pair[0].distance < .75 * pair[1].distance
                and mutual.get(pair[0].trainIdx) == pair[0].queryIdx]
    selected.sort(key=lambda m: (m.queryIdx, m.trainIdx))
    src = project([ka[m.queryIdx].pt for m in selected], np.linalg.inv(sa))
    dst = project([kb[m.trainIdx].pt for m in selected], np.linalg.inv(sb))
    return src, dst, {'method': 'SIFT, Lowe ratio 0.75, mutual nearest', 'source_keypoints': len(ka),
        'reference_keypoints': len(kb), 'tentative_matches': len(selected), 'source_working_size': list(a.shape[::-1]),
        'reference_working_size': list(b.shape[::-1]), 'source_native_to_working': sa.tolist(),
        'reference_native_to_working': sb.tolist()}


def read_anchors(path, source_size, reference_size, minimum):
    value = json.loads(Path(path).read_text())
    if value.get('source_size') != list(source_size) or value.get('reference_size') != list(reference_size):
        raise ValueError('Anchor image sizes must match EXIF-prepared source and reference sizes.')
    source, reference = np.asarray(value.get('source_points'), float), np.asarray(value.get('reference_points'), float)
    if source.ndim != 2 or source.shape[1] != 2 or source.shape != reference.shape or len(source) < minimum:
        raise ValueError(f'Anchor file needs at least {minimum} matching source_points/reference_points.')
    if not np.isfinite(source).all() or not np.isfinite(reference).all():
        raise ValueError('Anchor coordinates must be finite.')
    for points, size in [(source, source_size), (reference, reference_size)]:
        if np.any(points < 0) or np.any(points > np.asarray(size)-1):
            raise ValueError('Anchor coordinates must be inside the EXIF-prepared images.')
    return source, reference


def transfer(holds, coverage, size):
    """Copy geometry exactly. Coverage is observation evidence, never approval."""
    copied, queue = [], []
    w, h = size
    for hold in holds:
        if not isinstance(hold.get('id'), str) or not hold['id'] or hold.get('kind') not in ('hold', 'macro', 'volume'):
            raise ValueError('Reference holds need a nonempty ID and a valid kind.')
        polygon = np.asarray(hold['polygon'], float)
        center = np.asarray(hold['center'], float)
        if polygon.ndim != 2 or polygon.shape[1] != 2 or not 3 <= len(polygon) <= 16 or center.shape != (2,):
            raise ValueError('Reference holds must have a center and 3–16 polygon vertices.')
        if not np.isfinite(polygon).all() or np.any(polygon < 0) or np.any(polygon > 1) or not np.isfinite(center).all() or np.any(center < 0) or np.any(center > 1):
            raise ValueError('Reference hold geometry must be finite and normalized.')
        pixels = np.rint(polygon * [w, h]).astype(np.int32)
        x, y, bw, bh = cv2.boundingRect(pixels)
        x0, y0, x1, y1 = max(0, x), max(0, y), min(w, x+bw), min(h, y+bh)
        if x1 <= x0 or y1 <= y0:
            fraction = 0.
        else:
            region = np.zeros((y1-y0, x1-x0), np.uint8)
            cv2.fillPoly(region, [pixels - [x0, y0]], 255)
            count = np.count_nonzero(region)
            fraction = float(np.count_nonzero((region > 0) & (coverage[y0:y1, x0:x1] > 0)) / max(1, count))
        observed = fraction > 0
        if observed: copied.append(hold)
        queue.append({'oldHoldId': hold['id'], 'candidateHoldId': hold['id'],
            'status': 'inherited-unreviewed', 'observed': observed, 'coverage_fraction': fraction,
            'reasonCodes': ['baseline-no-change-classification'] if fraction >= .99 else ['partial-coverage' if observed else 'outside-observed-area'],
            'reviewer': None, 'decisionTime': None})
    return copied, queue


def preview(image, path, max_side=1600):
    image = image.copy()
    image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    image.save(path, quality=93)


def artifacts(output, source, reference, matrix, holds, source_points, reference_points, inliers, holdout, errors):
    size = reference.size
    warped = cv2.warpPerspective(np.asarray(source), matrix, size, flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    # Erosion excludes source-edge interpolation pixels with incomplete support.
    source_valid = np.full((source.height, source.width), 255, np.uint8)
    source_valid[[0, -1], :] = 0; source_valid[:, [0, -1]] = 0
    coverage = cv2.warpPerspective(source_valid, matrix, size, flags=cv2.INTER_NEAREST, borderValue=0)
    if np.count_nonzero(coverage) < 100: raise ValueError('Registered source does not cover a useful part of the reference.')
    warped[coverage == 0] = 0
    Image.fromarray(warped).save(output / 'wall_registered.jpg', quality=95)
    Image.fromarray(coverage).save(output / 'coverage.png')
    Image.fromarray((coverage > 0).astype(np.uint8)).save(output / 'source-index.png')
    preview(source, output / 'source-preview.jpg')
    preview(Image.fromarray(warped), output / 'wall_registered_preview.jpg')
    context = reference.copy()
    context.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
    context = Image.blend(context, Image.new('RGB', context.size, '#10140e'), .7)
    small_new = Image.fromarray(warped).resize(context.size, Image.Resampling.LANCZOS)
    small_mask = Image.fromarray(coverage).resize(context.size, Image.Resampling.NEAREST)
    context.paste(small_new, (0, 0), small_mask)
    draw = ImageDraw.Draw(context)
    draw.rectangle((0, 0, context.width, 28), fill='#10140e')
    draw.text((10, 8), 'NEW PHOTO COVERAGE | dim surroundings = OLD reference, diagnostic only', fill='white')
    context.save(output / 'placement-preview.jpg', quality=93)
    x, y, width, height = cv2.boundingRect(cv2.findNonZero(coverage))
    bbox = (x, y, x+width, y+height)
    old = reference.crop(bbox)
    new = Image.fromarray(warped).crop(bbox)
    preview(new, output / 'aligned-crop.jpg')
    comparison = Image.new('RGB', (width*2, height+40), '#181b16')
    comparison.paste(old, (0, 40)); comparison.paste(new, (width, 40))
    draw = ImageDraw.Draw(comparison)
    draw.text((12, 12), 'OLD REFERENCE', fill='white'); draw.text((width+12, 12), 'REGISTERED SOURCE (black = no observation)', fill='white')
    preview(comparison, output / 'reference-vs-registered.jpg', 2400)
    overlay = new.copy()
    draw = ImageDraw.Draw(overlay)
    copied, queue = transfer(holds, coverage, size)
    for hold in copied:
        points = [(u*size[0]-x, v*size[1]-y) for u, v in hold['polygon']]
        draw.line(points + [points[0]], fill='#33e2ff', width=max(2, round(width/850)))
    preview(overlay, output / 'prelabels-overlay.jpg', 2000)
    blend = Image.blend(old, new, .5)
    preview(blend, output / 'old-new-overlay.jpg')
    # Spatial residual evidence on the old crop. Arrows amplified 10x for inspection.
    residual = old.copy(); draw = ImageDraw.Draw(residual)
    projected = project(source_points, matrix)
    used = np.flatnonzero(inliers | (holdout & (errors < 8)))
    for i in used[::max(1, len(used)//150)]:
        start = reference_points[i] - [x, y]
        end = start + 10*(projected[i] - reference_points[i])
        color = '#ffc857' if holdout[i] else '#33d6ff'
        draw.ellipse((start[0]-3, start[1]-3, start[0]+3, start[1]+3), fill=color)
        draw.line([tuple(start), tuple(end)], fill=color, width=2)
    preview(residual, output / 'residuals-10x.jpg')
    return coverage, bbox, copied, queue


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--photo', type=Path, required=True, help='Exactly one photo for Phase A, never overwrites it.')
    parser.add_argument('--reference-image', type=Path, default=ROOT/'public/wall/stoneham-spraywall-canonical.jpg')
    parser.add_argument('--reference-holds', type=Path, default=ROOT/'src/data/polygons/holds.json')
    parser.add_argument('--reference-version', default='2026-10-v4')
    parser.add_argument('--candidate-version', required=True)
    parser.add_argument('--scan-id', required=True)
    parser.add_argument('--output', type=Path, required=True, help='New/empty experiment directory; existing work is never overwritten.')
    parser.add_argument('--max-side', type=int, default=2400)
    parser.add_argument('--features', type=int, default=18000)
    parser.add_argument('--max-error-px', type=float, default=8., help='Experimental RANSAC/QA threshold in full reference pixels, not a calibrated accuracy claim.')
    parser.add_argument('--seed', type=int, default=0)
    parser.add_argument('--alignment-anchors', type=Path, help='Optional manual fit anchors, EXIF-prepared full pixel coordinates.')
    parser.add_argument('--validation-anchors', type=Path, help='Independent manual check points; never used for fitting.')
    return parser.parse_args()


def run(args):
    output = args.output.resolve()
    # Experiments must not write to source/production paths, even via symlinks.
    protected = ['public', 'src', 'backend', 'infra', 'tools', 'tests', 'docs', '.git', '.github']
    if output == ROOT or any(output.is_relative_to(ROOT/p) for p in protected):
        raise ValueError('Output must be an experiment directory outside source/production paths.')
    for path in [args.photo, args.reference_image, args.reference_holds, args.alignment_anchors, args.validation_anchors]:
        if path and Path(path).resolve().is_relative_to(output):
            raise ValueError('Inputs cannot be inside the output directory.')
    if not all(v.strip() for v in [args.scan_id,args.reference_version,args.candidate_version]) or args.reference_version == args.candidate_version:
        raise ValueError('Provide nonempty scan/version IDs and a candidate version distinct from the reference.')
    if args.max_side < 64 or args.features < 100 or not np.isfinite(args.max_error_px) or args.max_error_px <= 0:
        raise ValueError('Use max-side >=64, features >=100 and a positive finite error threshold.')
    if output.exists() and any(output.iterdir()): raise ValueError('Output already contains work. Choose a new output directory.')
    output.mkdir(parents=True, exist_ok=True)
    lock = output / '.run-lock'
    fd = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600); os.close(fd)
    try:
        cv2.setNumThreads(1); cv2.setRNGSeed(args.seed)
        photo, source_meta = load_image(args.photo)
        reference, reference_meta = load_image(args.reference_image)
        holds = json.loads(args.reference_holds.read_text())
        holds = holds if isinstance(holds, list) else holds['holds']
        if not isinstance(holds, list) or not all(isinstance(h, dict) for h in holds): raise ValueError('Reference holds must be a list of hold objects.')
        if len({h['id'] for h in holds}) != len(holds): raise ValueError('Reference holds contain duplicate IDs.')
        if args.alignment_anchors:
            src, dst = read_anchors(args.alignment_anchors, photo.size, reference.size, 4)
            matrix, mask = cv2.findHomography(src, dst, cv2.RANSAC, args.max_error_px)
            if matrix is None: raise ValueError('Manual anchors are degenerate; spread 4–8 points across the photo.')
            footprint(matrix, photo.size)
            inliers, held_out = mask.ravel().astype(bool), np.zeros(len(src), bool)
            errors = np.linalg.norm(project(src, matrix)-dst, axis=1)
            metrics = {'fit_inlier_error': summary(errors[inliers]), 'validation_note': 'Manual fit anchors are not independent check anchors.'}
            reasons = [] if inliers.sum() >= 4 and hull_fraction(src[inliers], photo.size) >= .05 else ['insufficient-or-clustered-manual-anchors']
            if len(errors[inliers]) and np.percentile(errors[inliers], 95) > args.max_error_px: reasons.append('manual-fit-p95-exceeds-threshold')
            matching = {'method': 'manual alignment anchors', 'input_sha256': digest(args.alignment_anchors)}
        else:
            src, dst, matching = matches(photo, reference, args.max_side, args.features, args.seed)
            matrix, inliers, held_out, errors, metrics, reasons = fit_registration(src, dst, photo.size, args.max_error_px, args.seed)
        corners = footprint(matrix, photo.size)
        shape_metrics, shape_failures = check_shape(matrix, photo.size)
        metrics['shape'] = shape_metrics; reasons.extend(shape_failures)
        metrics['independent_manual_anchor_error'] = None
        if args.validation_anchors:
            a, b = read_anchors(args.validation_anchors, photo.size, reference.size, 4)
            if args.alignment_anchors and any(np.any(np.all(np.isclose(src, p), axis=1) & np.all(np.isclose(dst, q), axis=1)) for p, q in zip(a,b)):
                raise ValueError('Validation anchors must not reuse manual fit anchor pairs.')
            validation = np.linalg.norm(project(a, matrix)-b, axis=1)
            metrics['independent_manual_anchor_error'] = summary(validation)
            if np.percentile(validation, 95) > args.max_error_px: reasons.append('independent-anchor-p95-exceeds-threshold')
        registration = {'status': 'needs-manual-alignment' if reasons else 'registered-for-inspection',
            'source': source_meta, 'reference': reference_meta, 'matching': matching,
            'coordinate_convention': 'EXIF-prepared source pixel centers -> EXIF-prepared full reference pixel centers; normalized hold coordinates use (u*width,v*height)',
            'source_to_reference': matrix.tolist(), 'reference_to_source': np.linalg.inv(matrix).tolist(),
            'raw_source_to_reference': (matrix @ np.asarray(source_meta['raw_to_prepared'])).tolist(),
            'source_footprint_reference_pixels': corners.tolist(), 'metrics': metrics, 'qa_failures': reasons,
            'correspondences': [{'source': a.tolist(), 'reference': b.tolist(), 'fit_inlier': bool(i), 'held_out': bool(v), 'error_full_reference_px': float(e)} for a,b,i,v,e in zip(src,dst,inliers,held_out,errors)]}
        write_json(output/'registration.json', registration)
        if reasons:
            raise ValueError('Registration needs manual alignment: ' + ', '.join(reasons) + '. See registration.json or supply --alignment-anchors.')
        coverage, bbox, copied, queue = artifacts(output, photo, reference, matrix, holds, src, dst, inliers, held_out, errors)
        identity = {'scanId': args.scan_id, 'gymId': 'stoneham-crg', 'wallId': 'spray-wall-1',
            'referenceVersion': args.reference_version, 'candidateVersion': args.candidate_version,
            'referenceImageSha256': digest(args.reference_image), 'referenceHoldsSha256': digest(args.reference_holds),
            'sourceImageSha256': digest(args.photo), 'registeredImageSha256': digest(output/'wall_registered.jpg'),
            'coordinateFrame': {'size': list(reference.size), 'orientation': 'EXIF-prepared canonical reference'}}
        identity['sessionId'] = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        try:
            commit = subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, text=True).strip()
            dirty = bool(subprocess.check_output(['git','status','--porcelain','--untracked-files=all','--','tools/wall_rescan','tests/wall_rescan'], cwd=ROOT, text=True).strip())
        except (FileNotFoundError, subprocess.CalledProcessError): commit, dirty = None, None
        code_hashes = {p.name: digest(p) for p in Path(__file__).parent.glob('*.py')}
        manifest = {'session': identity, 'versions': {'python': platform.python_version(), 'opencv': cv2.__version__, 'numpy': np.__version__, 'pillow': pillow_version},
            'code_commit': commit, 'code_dirty': dirty, 'code_sha256': code_hashes,
            'parameters': {'max_side': args.max_side, 'features': args.features, 'max_error_px': args.max_error_px, 'seed': args.seed, 'opencv_threads': 1},
            'inputs': {'photo': str(args.photo.resolve()), 'reference_image': str(args.reference_image.resolve()), 'reference_holds': str(args.reference_holds.resolve()),
                'alignment_anchors': None if not args.alignment_anchors else {'path':str(args.alignment_anchors.resolve()), 'sha256':digest(args.alignment_anchors)},
                'validation_anchors': None if not args.validation_anchors else {'path':str(args.validation_anchors.resolve()), 'sha256':digest(args.validation_anchors)}},
            'source_index_legend': {'0': 'no new observation', '1': str(args.photo.resolve())},
            'sam2': 'not used: registration and unreviewed prelabel transfer only'}
        write_json(output/'manifest.json', manifest)
        write_json(output/'holds_prelabels.json', {'session': identity, 'wallId': identity['wallId'], 'image_size': list(reference.size), 'datasetRole': 'unreviewed-prelabels', 'publishable': False,
            'warning': 'Do not import into the legacy annotator: it treats imported geometry as accepted. Phase C review mode is not implemented.', 'holds': copied})
        write_json(output/'review_queue.json', {'session': identity, 'reviewRevision': 0, 'publishable': False, 'entries': queue})
        write_json(output/'lineage.json', {'session': identity, 'reviewRevision': 0, 'links': [{'oldHoldId':h['id'], 'candidateHoldId':h['id'], 'relation':'unverified-continuity', 'reviewer':None} for h in copied]})
        report = {'status': 'registered-for-inspection', 'publishable': False, 'phase': 'A, one photograph', 'sessionId': identity['sessionId'],
            'reference_size': list(reference.size), 'crop_box': list(bbox), 'observed_pixel_count': int(np.count_nonzero(coverage)),
            'observed_reference_fraction': float(np.count_nonzero(coverage)/coverage.size),
            'reference_hold_count': len(holds), 'intersecting_prelabel_count': len(copied),
            'fully_observed_hold_count': sum(q['coverage_fraction'] >= .99 for q in queue),
            'partial_hold_count': sum(0 < q['coverage_fraction'] < .99 for q in queue),
            'accepted_hold_count': 0, 'removed_hold_count': None, 'new_hold_count': None, 'change_classification': 'not run',
            'metrics': metrics, 'limitations': ['Single global homography, no lens calibration or non-planar correction.',
                'No change classifier, SAM2 correction, interactive rescan review, multi-source compositing, or publication.',
                'Held-out feature consistency is not independent manual-anchor validation; same-source baseline is an optimistic test.']}
        write_json(output/'report.json', report)
        print(json.dumps(report, indent=2))
    except Exception as error:
        write_json(output/'report.json', {'status': 'failed', 'publishable': False, 'error': str(error)})
        raise
    finally:
        lock.unlink(missing_ok=True)


def main():
    try: run(arguments())
    except (ValueError, OSError, KeyError, TypeError, cv2.error, np.linalg.LinAlgError) as error:
        print(f'Rescan failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
