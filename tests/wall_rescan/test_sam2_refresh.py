import copy
import hashlib
import json
from pathlib import Path
import unittest

import numpy as np
import cv2

from tools.wall_rescan.sam2_refresh import coverage_fraction, prompt_for, select_mask, deduplicate, recommendation
from tools.sam2_annotation_server import clean_dataset

ROOT=Path(__file__).resolve().parents[2]
HOLD=dict(id='old',kind='hold',center=[.5,.5],polygon=[[.35,.35],[.65,.35],[.65,.65],[.35,.65]])


class RefreshTests(unittest.TestCase):
    def test_old_reference_fallback_is_not_observed_or_approved(self):
        mask=np.full((100,100),255,np.uint8);mask[40:60,40:60]=0
        self.assertLess(coverage_fraction(HOLD['polygon'],mask,(100,100)),.99)
        self.assertEqual(coverage_fraction(HOLD['polygon'],np.zeros_like(mask),(100,100)),0)
        mask[:]=255
        self.assertEqual(coverage_fraction(HOLD['polygon'],mask,(100,100)),1)

    def test_prompt_uses_polygon_interior_instead_of_an_outside_concave_centroid(self):
        hold=dict(HOLD,center=[.5,.5],polygon=[[.1,.1],[.9,.1],[.9,.3],[.3,.3],[.3,.9],[.1,.9]])
        seed,box=prompt_for(hold,(100,100))
        polygon=np.asarray(hold['polygon'],np.float32)*100
        self.assertGreater(cv2.pointPolygonTest(polygon,tuple(seed),True),0)
        self.assertLessEqual(box[0],seed[0]);self.assertLessEqual(box[1],seed[1])
        self.assertGreaterEqual(box[2],seed[0]);self.assertGreaterEqual(box[3],seed[1])

    def test_mask_selection_keeps_normalized_simple_geometry_and_evidence(self):
        masks=np.zeros((3,100,100),bool);masks[0,34:66,34:66]=True;masks[1,:,:]=True;masks[2,48:50,48:50]=True
        coverage=np.full((100,100),255,np.uint8);uncertain=np.zeros_like(coverage)
        result=select_mask(masks,np.array([.9,.99,.99]),HOLD,[50,50],[0,0,100,100],coverage,uncertain,(100,100),.75)
        self.assertIsNotNone(result);self.assertLessEqual(len(result['polygon']),16)
        self.assertTrue(all(0<=n<=1 for p in result['polygon'] for n in p))
        self.assertGreater(result['evidence']['oldMaskIoU'],.8)
        self.assertNotIn('verified',recommendation(result['evidence']))
        self.assertNotIn('removed',recommendation(result['evidence']))
        self.assertNotIn('id',result)  # a segmentation cannot verify/reuse the old identity

    def test_high_score_cannot_override_gap_low_score_or_tile_boundary(self):
        masks=np.zeros((1,100,100),bool);masks[0,35:65,35:65]=True
        coverage=np.full((100,100),255,np.uint8);uncertain=np.zeros_like(coverage)
        coverage[40:60,40:60]=0
        self.assertIsNone(select_mask(masks,[1.],HOLD,[50,50],[0,0,100,100],coverage,uncertain,(100,100),.75))
        coverage[:]=255
        self.assertIsNone(select_mask(masks,[.5],HOLD,[50,50],[0,0,100,100],coverage,uncertain,(100,100),.75))
        masks[:]=True
        self.assertIsNone(select_mask(masks,[1.],HOLD,[50,50],[0,0,100,100],coverage,uncertain,(100,100),.75))

    def test_overlap_with_old_outline_does_not_discard_replacement_proposal(self):
        a=dict(id='proposal-a',polygon=HOLD['polygon'],oldHoldIds=['old-a'],selectionQuality=.9)
        b=dict(id='proposal-b',polygon=HOLD['polygon'],oldHoldIds=['old-b'],selectionQuality=.8)
        original=copy.deepcopy(HOLD)
        unique,mapping=deduplicate([a,b],(100,100))
        self.assertEqual(len(unique),1);self.assertEqual(unique[0]['oldHoldIds'],['old-a','old-b'])
        self.assertEqual(mapping['proposal-b'],'proposal-a');self.assertEqual(HOLD,original)
        with self.assertRaises(ValueError):clean_dataset(dict(format='stoneham-sam2-refresh-v1',proposals=unique,publishable=False))

    def test_uncertain_alignment_stays_provisional_even_with_high_overlap(self):
        evidence=dict(uncertaintyFraction=.01,oldMaskIoU=1.,areaRatio=1.,centerDriftPixels=0.)
        self.assertEqual(recommendation(evidence),'alignment-needs-review')
        evidence['uncertaintyFraction']=0
        self.assertEqual(recommendation(evidence),'possible-unchanged')

    def test_v5_is_separate_hash_bound_candidate_and_v4_stays_active(self):
        path=ROOT/'public/wall/versions/2026-11-v5/manifest.json'
        data=json.loads(path.read_text())
        self.assertEqual(data['wallVersionId'],'2026-11-v5');self.assertFalse(data['publishable'])
        self.assertEqual(data['status'],'candidate-needs-review')
        for key in ['image','coverage','uncertainty','sourceIndex']:
            self.assertEqual(hashlib.sha256((path.parent/data[key]).read_bytes()).hexdigest(),data[key+'Sha256'])
        catalog=json.loads((ROOT/'backend/walls.json').read_text())
        self.assertEqual([v['wallVersionId'] for v in catalog if v['active']],['2026-10-v4'])
