"""Data integrity and import/edit validation without loading model weights."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('annotation', ROOT / 'tools/sam2_annotation_server.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


class AnnotationDataTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((ROOT / 'src/data/groundtruth/top_left_manual_v1.json').read_text())

    def test_groundtruth_43_and_original_geometry(self):
        cleaned = module.clean_dataset(self.data)
        self.assertEqual(len(cleaned), 43)
        self.assertEqual(cleaned, self.data['holds'])
        for hold in cleaned:
            self.assertLessEqual(len(hold['polygon']), 16)
            for x, y in [hold['center'], *hold['polygon']]:
                self.assertTrue(0 <= x <= 2431 / 7292)
                self.assertTrue(0 <= y <= 1838 / 5514)

    def test_full_wall_regions_include_prompts_across_boundaries(self):
        for xy in [[.02, .02], [.34, .34], [.8, .8], [1, 1]]:
            prompts = [{'point': xy, 'label': 1}]
            module.validate_prompts({'points': prompts})
            l, t, r, b = module.prediction_region(prompts, None)
            self.assertTrue(l <= xy[0] * 7292 <= r)
            self.assertTrue(t <= xy[1] * 5514 <= b)
        l, t, r, b = module.prediction_region([{'point': [.32, .32], 'label': 1}, {'point': [.4, .4], 'label': 0}], None)
        self.assertTrue(l <= .32 * 7292 and r >= .4 * 7292 and t <= .32 * 5514 and b >= .4 * 5514)

    def test_canonical_production_array_can_seed_editor(self):
        canonical = json.loads((ROOT / 'src/data/polygons/holds.json').read_text())
        self.assertEqual(len(canonical), 677)
        self.assertEqual(module.clean_dataset(canonical), canonical)

    def test_bad_import_is_rejected(self):
        for mutate in [lambda d: d.update(wallId='other'), lambda d: d.update(image_size=[100, 100]),
                       lambda d: d['holds'].append(d['holds'][0]),
                       lambda d: d['holds'][0].update(center=[float('nan'), .2]),
                       lambda d: d['holds'][0].update(polygon=[[2, 2]] * 3)]:
            data = copy.deepcopy(self.data); mutate(data)
            with self.assertRaises(ValueError): module.clean_dataset(data)

    def test_writing_working_copy_does_not_modify_groundtruth(self):
        groundtruth = ROOT / 'src/data/groundtruth/top_left_manual_v1.json'
        original = groundtruth.read_bytes()
        with tempfile.TemporaryDirectory() as directory:
            annotator = module.Annotator.__new__(module.Annotator)
            annotator.storage = Path(directory) / 'work.json'
            annotator.write(copy.deepcopy(self.data))
            work = annotator.read(); work['holds'][0]['center'][0] += .001
            annotator.write(work)
            self.assertEqual(annotator.read()['holds'][0]['id'], self.data['holds'][0]['id'])
            self.assertEqual(groundtruth.read_bytes(), original)


if __name__ == '__main__': unittest.main()
