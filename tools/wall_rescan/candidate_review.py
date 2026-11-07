"""Prepare a hash-bound review bundle from the archived candidate and SAM2 hints."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def prepare(manifest_path, proposals_path, output, root=ROOT, old_holds=None, reference_image=None):
    from tools.wall_rescan.sam2_refresh import coverage_fraction
    import numpy as np
    from PIL import Image
    manifest_path, proposals_path, output = map(Path, (manifest_path, proposals_path, output))
    m = json.loads(manifest_path.read_text())
    model = json.loads(proposals_path.read_text())
    old_path = Path(old_holds) if old_holds is not None else root / 'src/data/polygons/holds.json'
    reference = Path(reference_image) if reference_image is not None else root / 'public/wall/stoneham-spraywall-canonical.jpg'
    old = json.loads(old_path.read_text())
    paths = {name: manifest_path.parent / m[key] for name, key in
             [('wall_registered.jpg', 'image'), ('coverage.png', 'coverage'), ('uncertainty.png', 'uncertainty')]}
    hashes = {name: digest(path) for name, path in paths.items()}
    expected = dict(image=m['imageSha256'], coverage=m['coverageSha256'], uncertainty=m['uncertaintySha256'], oldHolds=m['referenceHoldsSha256'])
    if (m.get('format') != 'stoneham-wall-candidate-v1' or m.get('publishable') is not False or
        hashes != dict(zip(paths, [expected['image'], expected['coverage'], expected['uncertainty']])) or
        digest(old_path) != expected['oldHolds'] or digest(reference) != m['referenceImageSha256']):
        raise ValueError('Candidate/reference evidence hash mismatch.')
    meta = model.get('metadata', {})
    if (model.get('format') != 'stoneham-sam2-refresh-v1' or model.get('publishable') is not False or
        meta.get('hashes') != expected or meta.get('wallVersionId') != m['wallVersionId'] or
        meta.get('sourceSessionId') != m['sourceSession']['sessionId'] or
        meta.get('versionManifestSha256') != digest(manifest_path)):
        raise ValueError('SAM2 proposals do not match the candidate.')
    if {e['oldHoldId']: e['oldGeometry'] for e in model['entries']} != {h['id']: h for h in old}:
        raise ValueError('SAM2 inherited geometry differs from the reference.')
    # A distinct session binds the presentation JPEG, masks, proposals and manifest.
    session = {**m['sourceSession'], 'scanId': m['wallVersionId'] + '-sam2-review',
               'candidateVersion': m['wallVersionId'], 'registeredImageSha256': expected['image'],
               'sourceSessionId': m['sourceSession']['sessionId'], 'candidateManifestSha256': digest(manifest_path),
               'coverageSha256': expected['coverage'], 'uncertaintySha256': expected['uncertainty'],
               'proposalsSha256': digest(proposals_path),
               'referenceFilledFraction': m.get('referenceFilledFraction', 0)}
    session.pop('sessionId')
    session['sessionId'] = hashlib.sha256(json.dumps(session, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    coverage = np.asarray(Image.open(paths['coverage.png']).convert('L'))
    if tuple(m['imageSize']) != (7292, 5514) or coverage.shape != (5514, 7292):
        raise ValueError('Unsupported candidate dimensions.')
    queue = []
    for hold in old:
        fraction = coverage_fraction(hold['polygon'], coverage, (7292, 5514))
        queue.append(dict(oldHoldId=hold['id'], candidateHoldId=hold['id'], status='inherited-unreviewed',
                          observed=fraction > 0, coverage_fraction=fraction, reasonCodes=['human-review-required']))
    output = output.resolve()
    if output == root.resolve() or any(output.is_relative_to((root / p).resolve()) for p in ('public', 'src', 'backend', 'tools', 'infra', '.git')):
        raise ValueError('Review output must be outside source/production directories.')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Choose a new empty review output directory.')
    if any(p.resolve().is_relative_to(output) for p in [manifest_path, proposals_path, old_path, reference, *paths.values()]):
        raise ValueError('Inputs cannot be inside the output directory.')
    output.mkdir(parents=True, exist_ok=True)
    def write(name, value):
        (output / name).write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    write('manifest.json', dict(session=session, publishable=False, inputKind='real-captures', imageFile='wall_registered.jpg'))
    write('holds_prelabels.json', dict(session=session, publishable=False, holds=old))
    write('review_queue.json', dict(session=session, publishable=False, reviewRevision=0, entries=queue))
    write('report.json', dict(sessionId=session['sessionId'], publishable=False, status='needs-review', qaFailures=m['qaFailures']))
    for name, path in paths.items():
        shutil.copyfile(path, output / name)
    shutil.copyfile(proposals_path, output / 'sam2-proposals.json')
    if old_holds is not None:
        shutil.copyfile(old_path, output / 'reference-holds.json')
    if reference_image is not None:
        shutil.copyfile(reference, output / 'reference.jpg')
    return session


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=ROOT / 'public/wall/versions/2026-11-v5/manifest.json')
    parser.add_argument('--proposals', type=Path, default=ROOT / 'src/data/experiments/wall-v5-sam2-refresh.json')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--old-holds', type=Path)
    parser.add_argument('--reference', type=Path)
    args = parser.parse_args()
    session = prepare(args.manifest, args.proposals, args.output, old_holds=args.old_holds, reference_image=args.reference)
    print(f"Review bundle ready: {args.output} (session {session['sessionId']})")
