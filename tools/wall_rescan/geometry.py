"""Pixel-center transforms and conservative registration checks."""
import cv2
import numpy as np


def project(points, matrix):
    points = np.asarray(points, dtype=np.float64).reshape(-1, 2)
    homogeneous = np.c_[points, np.ones(len(points))] @ np.asarray(matrix, dtype=float).T
    if not np.isfinite(homogeneous).all() or np.any(np.abs(homogeneous[:, 2]) < 1e-10):
        raise ValueError('Transform maps points to infinity.')
    return homogeneous[:, :2] / homogeneous[:, 2:]


def resize_matrix(native, working):
    sx, sy = np.asarray(working, dtype=float) / np.asarray(native, dtype=float)
    return np.array([[sx, 0, (sx - 1) / 2], [0, sy, (sy - 1) / 2], [0, 0, 1.]])


def exif_matrix(orientation, width, height):
    return np.array({
        1: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        2: [[-1, 0, width-1], [0, 1, 0], [0, 0, 1]],
        3: [[-1, 0, width-1], [0, -1, height-1], [0, 0, 1]],
        4: [[1, 0, 0], [0, -1, height-1], [0, 0, 1]],
        5: [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
        6: [[0, -1, height-1], [1, 0, 0], [0, 0, 1]],
        7: [[0, -1, height-1], [-1, 0, width-1], [0, 0, 1]],
        8: [[0, 1, 0], [-1, 0, width-1], [0, 0, 1]],
    }.get(orientation, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]), dtype=float)


def hull_fraction(points, size):
    if len(points) < 3:
        return 0.
    return float(cv2.contourArea(cv2.convexHull(np.asarray(points, np.float32)))) / (size[0] * size[1])


def footprint(matrix, size):
    w, h = size
    corners = np.array([[0, 0], [w-1, 0], [w-1, h-1], [0, h-1]], float)
    denominator = np.c_[corners, np.ones(4)] @ matrix[2]
    if not (np.all(denominator > 1e-10) or np.all(denominator < -1e-10)):
        raise ValueError('Projective horizon crosses the source photograph.')
    if abs(np.linalg.det(matrix)) < 1e-12 or np.linalg.cond(matrix) > 1e12:
        raise ValueError('Singular or numerically unstable transform.')
    points = project(corners, matrix).astype(np.float32)
    if not cv2.isContourConvex(points) or cv2.contourArea(points, oriented=True) <= 1:
        raise ValueError('Folded, mirrored or degenerate source footprint.')
    return points


def summary(errors):
    if not len(errors):
        return {'count': 0, 'median_px': None, 'p95_px': None, 'max_px': None}
    return {'count': len(errors), 'median_px': float(np.median(errors)),
            'p95_px': float(np.percentile(errors, 95)), 'max_px': float(np.max(errors))}


def fit_registration(source, target, source_size, threshold=8., seed=0):
    """Fit using 80% of matches; hold out 20% before fitting, never refit on them."""
    source, target = np.asarray(source, float), np.asarray(target, float)
    if len(source) < 12:
        raise ValueError(f'Only {len(source)} matches; need at least 12. Supply a clearer/overlapping photo or manual alignment anchors.')
    rng = np.random.default_rng(seed)
    order = rng.permutation(len(source))
    holdout = np.zeros(len(source), bool)
    holdout[order[:max(4, len(source)//5)]] = True
    cv2.setRNGSeed(seed)
    matrix, mask = cv2.findHomography(source[~holdout], target[~holdout],
        method=getattr(cv2, 'USAC_MAGSAC', cv2.RANSAC), ransacReprojThreshold=threshold,
        maxIters=10000, confidence=.999)
    if matrix is None:
        raise ValueError('Robust homography estimation failed. Try an overview or manual anchors.')
    matrix /= matrix[2, 2]
    footprint(matrix, source_size)
    errors = np.linalg.norm(project(source, matrix) - target, axis=1)
    inliers = np.zeros(len(source), bool)
    inliers[~holdout] = mask.ravel().astype(bool)
    consistent_holdout = holdout & (errors <= threshold)
    reasons = []
    count = int(inliers.sum())
    ratio = count / int((~holdout).sum())
    spread = hull_fraction(source[inliers], source_size)
    if count < 20: reasons.append('fewer-than-20-fit-inliers')
    if ratio < .35: reasons.append('fit-inlier-ratio-below-0.35')
    if spread < .05: reasons.append('fit-inliers-cover-less-than-5-percent-of-source')
    if count and np.percentile(errors[inliers], 95) > threshold: reasons.append('fit-p95-exceeds-threshold')
    if consistent_holdout.sum() < 4 or consistent_holdout.sum() / holdout.sum() < .5:
        reasons.append('insufficient-held-out-match-consistency')
    metrics = {'fit_inliers': count, 'fit_inlier_ratio': ratio, 'source_inlier_hull_fraction': spread,
               'fit_inlier_error': summary(errors[inliers]), 'held_out_all_match_error': summary(errors[holdout]),
               'held_out_consistent_match_error': summary(errors[consistent_holdout]),
               'held_out_consistent_fraction': float(consistent_holdout.sum() / holdout.sum()),
               'validation_note': 'Held-out descriptor correspondences test consistency, not independent manual-anchor accuracy. Outliers are retained in held_out_all_match_error.'}
    return matrix, inliers, holdout, errors, metrics, reasons


def check_shape(matrix, size):
    corners = footprint(matrix, size)
    scales, ratios = [], []
    for x in np.linspace(0, size[0]-1, 3):
        for y in np.linspace(0, size[1]-1, 3):
            point = np.array([x,y,1.])
            denominator = matrix[2] @ point
            numerator = matrix[:2] @ point
            jacobian = (matrix[:2,:2]*denominator - np.outer(numerator,matrix[2,:2])) / denominator**2
            singular = np.linalg.svd(jacobian,compute_uv=False)
            scales.extend(singular.tolist())
            ratios.append(float(singular[0]/max(singular[-1],1e-15)))
    metrics={'local_scale_min':min(scales),'local_scale_max':max(scales),'max_anisotropy':max(ratios),
             'footprint_area_reference_pixels_squared':float(cv2.contourArea(corners))}
    reasons=[]
    if min(scales)<.01 or max(scales)>100:reasons.append('extreme-local-scale')
    if max(ratios)>20:reasons.append('extreme-local-anisotropy')
    return metrics,reasons
