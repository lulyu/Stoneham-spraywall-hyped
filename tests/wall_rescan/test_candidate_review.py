import json
from pathlib import Path
import tempfile
import shutil
import unittest

from tools.wall_rescan.candidate_review import prepare, ROOT
from tools.wall_rescan.review_bundle import ReviewBundle


class CandidateReviewTests(unittest.TestCase):
    def test_supplied_review_references_are_bundled_without_replacing_production(self):
        manifest = ROOT / 'public/wall/versions/2026-11-v5/manifest.json'
        proposals = ROOT / 'src/data/experiments/wall-v5-sam2-refresh.json'
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            holds = root / 'reviewed-holds.json'
            reference = root / 'reviewed-reference.jpg'
            shutil.copyfile(ROOT / 'src/data/polygons/holds.json', holds)
            shutil.copyfile(ROOT / 'public/wall/stoneham-spraywall-canonical.jpg', reference)
            output = root / 'review'
            prepare(manifest, proposals, output, old_holds=holds, reference_image=reference)
            bundle = ReviewBundle(output, ROOT)
            self.assertEqual(bundle.file('reference-holds.json').read_bytes(), holds.read_bytes())
            self.assertEqual(bundle.file('reference.jpg').read_bytes(), reference.read_bytes())

    def test_real_v5_bundle_uses_exact_jpeg_and_hash_bound_evidence(self):
        manifest = ROOT / 'public/wall/versions/2026-11-v5/manifest.json'
        proposals = ROOT / 'src/data/experiments/wall-v5-sam2-refresh.json'
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'review'
            session = prepare(manifest, proposals, output)
            bundle = ReviewBundle(output, ROOT)
            self.assertEqual(bundle.image_name, 'wall_registered.jpg')
            self.assertEqual(session['candidateVersion'], '2026-11-v5')
            self.assertNotEqual(session['sessionId'], json.loads(manifest.read_text())['sourceSession']['sessionId'])
            queue = json.loads(bundle.file('review_queue.json').read_text())
            self.assertEqual(len(queue['entries']), 677)
            self.assertTrue(all(e['status'] == 'inherited-unreviewed' for e in queue['entries']))
            self.assertTrue(any(e['coverage_fraction'] < .99 for e in queue['entries']))
            bundle.validate_prediction(dict(sessionId=session['sessionId'], image_sha256=session['registeredImageSha256']))
            with self.assertRaisesRegex(ValueError, 'empty'):
                prepare(manifest, proposals, output)
            (output / 'sam2-proposals.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'evidence hash'):
                ReviewBundle(output, ROOT)

    def test_different_proposals_cannot_be_attached_to_candidate(self):
        manifest = ROOT / 'public/wall/versions/2026-11-v5/manifest.json'
        raw = json.loads((ROOT / 'src/data/experiments/wall-v5-sam2-refresh.json').read_text())
        raw['metadata']['hashes']['image'] = 'a' * 64
        with tempfile.TemporaryDirectory() as tmp:
            proposals = Path(tmp) / 'wrong.json'
            proposals.write_text(json.dumps(raw))
            with self.assertRaisesRegex(ValueError, 'do not match'):
                prepare(manifest, proposals, Path(tmp) / 'review')
