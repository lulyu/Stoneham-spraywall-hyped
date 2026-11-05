"""Read-only, hash-checked artifact access for the unified rescan editor.

No annotation approval/export endpoint is provided: browser checkpoints remain
non-publishable. The legacy accepted-geometry storage must not receive rescans.
"""
import hashlib
import json
from pathlib import Path

FILES = ('manifest.json', 'holds_prelabels.json', 'review_queue.json', 'report.json',
         'wall_registered.png', 'coverage.png', 'uncertainty.png',
         'source-index-preview.png', 'qa-overlay.jpg')
REQUIRED = FILES[:7]


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


class ReviewBundle:
    def __init__(self, directory, root):
        self.directory = Path(directory).resolve()
        self.paths = {name: self.directory / name for name in FILES if (self.directory / name).is_file()}
        if any(name not in self.paths for name in REQUIRED):
            raise ValueError('Rescan folder needs manifest, prelabels, queue, report, registered PNG, coverage and uncertainty.')
        self.hashes = {name: digest(path) for name, path in self.paths.items()}
        manifest = json.loads(self.paths['manifest.json'].read_text())
        session = manifest.get('session', {})
        for key in ('sessionId', 'referenceImageSha256', 'referenceHoldsSha256', 'registeredImageSha256'):
            value = session.get(key)
            if not isinstance(value, str) or len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
                raise ValueError('Invalid scan identity: ' + key)
        if session.get('coordinateFrame', {}).get('size') != [7292, 5514]:
            raise ValueError('Unsupported scan dimensions.')
        for name in ('holds_prelabels.json', 'review_queue.json'):
            data = json.loads(self.paths[name].read_text())
            if data.get('session') != session or data.get('publishable') is not False:
                raise ValueError('Scan artifact identity differs: ' + name)
        queue = json.loads(self.paths['review_queue.json'].read_text())
        if queue.get('reviewRevision') != 0 or any(e.get('status') != 'inherited-unreviewed' for e in queue.get('entries', [])):
            raise ValueError('Use the original unreviewed pipeline folder, not an approved/modified queue.')
        report = json.loads(self.paths['report.json'].read_text())
        if manifest.get('publishable') is not False or report.get('publishable') is not False or report.get('sessionId') != session['sessionId']:
            raise ValueError('Expected a non-publishable scan candidate and matching QA report.')
        expected = {
            'wall_registered.png': session['registeredImageSha256'],
            'reference': session['referenceImageSha256'],
            'holds': session['referenceHoldsSha256'],
        }
        actual = {**self.hashes, 'reference': digest(Path(root) / 'public/wall/stoneham-spraywall-canonical.jpg'),
                  'holds': digest(Path(root) / 'src/data/polygons/holds.json')}
        if any(actual[key] != value for key, value in expected.items()):
            raise ValueError('Candidate/reference image or hold map differs from the session hashes.')
        self.session = session

    def file(self, name):
        if name not in self.paths:
            raise ValueError('Unknown rescan artifact.')
        path = self.paths[name]
        if digest(path) != self.hashes[name]:
            raise ValueError('Scan artifact changed on disk; restart with the matching immutable scan folder.')
        return path

    def validate_prediction(self, body):
        if body.get('sessionId') != self.session['sessionId'] or body.get('image_sha256') != self.session['registeredImageSha256']:
            raise ValueError('Prediction session/image mismatch. Open the matching scan server.')
        self.file('wall_registered.png')
