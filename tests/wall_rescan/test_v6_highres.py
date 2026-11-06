import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image
from tools.wall_rescan.candidate_review import ROOT, digest, prepare
from tools.wall_rescan.review_bundle import ReviewBundle


class HighResolutionReviewTests(unittest.TestCase):
    def test_reference_fill_never_becomes_new_observation(self):
        directory = ROOT / 'public/wall/versions/2026-11-v6-highres'
        m = json.loads((directory / 'manifest.json').read_text())
        self.assertFalse(m['publishable'])
        for key in ('image', 'coverage', 'uncertainty', 'sourceIndex'):
            self.assertEqual(digest(directory / m[key]), m[key + 'Sha256'])
        coverage = np.asarray(Image.open(directory / m['coverage']))
        sources = np.asarray(Image.open(directory / m['sourceIndex']))
        self.assertTrue(np.array_equal(coverage == 0, sources == 0))
        self.assertAlmostEqual(float((coverage == 0).mean()), m['referenceFilledFraction'])
        self.assertAlmostEqual(m['observedCoverageFraction'] + m['referenceFilledFraction'], 1)
        self.assertEqual(len(m['sources']), 4)
        self.assertTrue(all(s['size'] == [6144, 8192] for s in m['sources']))
        catalog = json.loads((ROOT / 'backend/walls.json').read_text())
        self.assertEqual([v['wallVersionId'] for v in catalog if v['active']], ['2026-10-v4'])

    def test_v6_review_uses_new_image_and_preserves_reference_fill_metadata(self):
        manifest = ROOT / 'public/wall/versions/2026-11-v6-highres/manifest.json'
        proposals = ROOT / 'src/data/experiments/wall-v6-highres-sam2-refresh.json'
        with tempfile.TemporaryDirectory() as tmp:
            session = prepare(manifest, proposals, Path(tmp) / 'review')
            bundle = ReviewBundle(Path(tmp) / 'review', ROOT)
            self.assertEqual(session['candidateVersion'], '2026-11-v6-highres')
            self.assertGreater(session['referenceFilledFraction'], 0)
            self.assertEqual(digest(bundle.file(bundle.image_name)), session['registeredImageSha256'])
            queue = json.loads(bundle.file('review_queue.json').read_text())
            self.assertTrue(all(e['status'] == 'inherited-unreviewed' for e in queue['entries']))
            self.assertTrue(any(e['coverage_fraction'] < .99 for e in queue['entries']))
