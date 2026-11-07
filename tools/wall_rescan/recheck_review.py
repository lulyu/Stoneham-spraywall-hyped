"""Prepare an unapproved image recheck using a completed review's geometry."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

from .review_bundle import ReviewBundle, digest
from .sam2_refresh import coverage_fraction

ROOT = Path(__file__).resolve().parents[2]


def prepare(candidate, reviewed, reference, output):
    import numpy as np
    from PIL import Image
    candidate, reviewed, reference, output = map(Path, (candidate, reviewed, reference, output))
    manifest = json.loads(candidate.read_text())
    snapshot = json.loads(reviewed.read_text())
    summary = json.loads((reviewed.parent / 'summary.json').read_text())
    checkpoint = reviewed.parent / summary['checkpoint']
    if (manifest.get('format') != 'stoneham-seam-trial-assets-v1' or manifest.get('publishable') is not False
            or snapshot.get('format') != 'stoneham-reviewed-geometry-v1' or snapshot.get('publishable') is not False
            or summary.get('pendingCount') != 0 or digest(checkpoint) != snapshot['checkpointSha256']
            or digest(checkpoint) != summary['checkpointSha256']
            or digest(reference) != snapshot['imageSha256']
            or manifest.get('reviewedImageSha256') != snapshot['imageSha256']
            or manifest.get('reviewedGeometrySha256') != digest(reviewed)):
        raise ValueError('Completed review/candidate provenance mismatch.')
    for name, record in manifest['assets'].items():
        if Path(name).name != name or digest(candidate.parent / name) != record['sha256']:
            raise ValueError('Candidate asset hash differs: ' + name)
    holds = snapshot['holds']
    if len(holds) != summary['confirmedHoldCount'] or len({h['id'] for h in holds}) != len(holds):
        raise ValueError('Completed hold map differs from its summary.')
    if tuple(manifest['imageSize']) != (7292, 5514):
        raise ValueError('Unsupported candidate size.')
    coverage = np.asarray(Image.open(candidate.parent / 'coverage.png').convert('L'))
    if coverage.shape != (5514, 7292):
        raise ValueError('Unsupported coverage size.')
    # Keep this draft separate from every input and all source/production files.
    output = output.resolve()
    if output == ROOT or any(output.is_relative_to(ROOT / p) for p in ('public', 'src', 'backend', 'tools', '.git')):
        raise ValueError('Choose an output outside source/production directories.')
    if any(p.resolve().is_relative_to(output) for p in (candidate, reviewed, reference, checkpoint)):
        raise ValueError('Inputs cannot be inside the output directory.')
    output.mkdir(parents=True, exist_ok=False)

    def write(name, value):
        (output / name).write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')

    write('reference-holds.json', holds)
    session = dict(scanId=manifest['wallVersionId'] + '-final-review', gymId='stoneham', wallId=snapshot['wallId'],
                   referenceVersion=snapshot['wallVersionId'], candidateVersion=manifest['wallVersionId'],
                   referenceImageSha256=digest(reference), referenceHoldsSha256=digest(output / 'reference-holds.json'),
                   registeredImageSha256=manifest['assets']['wall.jpg']['sha256'],
                   coverageSha256=manifest['assets']['coverage.png']['sha256'],
                   uncertaintySha256=manifest['assets']['uncertainty.png']['sha256'],
                   coordinateFrame=dict(size=[7292, 5514], orientation='canonical'),
                   candidateManifestSha256=digest(candidate), sourceCheckpointSha256=digest(checkpoint),
                   sourceReviewedGeometrySha256=digest(reviewed), reviewPurpose='final-image-recheck',
                   referenceFilledFraction=float((coverage == 0).mean()))
    session['sessionId'] = hashlib.sha256(json.dumps(session, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    queue = []
    for hold in holds:
        fraction = coverage_fraction(hold['polygon'], coverage, (7292, 5514))
        queue.append(dict(oldHoldId=hold['id'], candidateHoldId=hold['id'], status='inherited-unreviewed',
                          observed=fraction > 0, coverage_fraction=fraction,
                          reasonCodes=['saved-v6-outline', 'new-image-recheck-required']))
    write('manifest.json', dict(session=session, publishable=False, inputKind='real-captures', imageFile='wall_registered.jpg'))
    write('holds_prelabels.json', dict(session=session, publishable=False, holds=holds))
    write('review_queue.json', dict(session=session, publishable=False, reviewRevision=0, entries=queue))
    write('report.json', dict(sessionId=session['sessionId'], publishable=False, status='needs-final-image-review',
                             inheritedHoldCount=len(holds), acceptedHoldCount=0,
                             note='Saved v6 outlines are starting geometry, not approvals for this image.'))
    for name, source in [('wall_registered.jpg', candidate.parent / 'wall.jpg'),
                         ('coverage.png', candidate.parent / 'coverage.png'),
                         ('uncertainty.png', candidate.parent / 'uncertainty.png'), ('reference.jpg', reference)]:
        shutil.copyfile(source, output / name)
    ReviewBundle(output, ROOT)
    return session


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', type=Path, default=ROOT / 'public/wall/versions/2026-11-v7-seam-trial/manifest.json')
    parser.add_argument('--reviewed', type=Path, default=ROOT / 'reviews/2026-11-v6-highres/confirmed-geometry.json')
    parser.add_argument('--reference', type=Path, default=ROOT / 'public/wall/versions/2026-11-v6-highres/wall.jpg')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    session = prepare(args.candidate, args.reviewed, args.reference, args.output)
    print(json.dumps(session, indent=2))
