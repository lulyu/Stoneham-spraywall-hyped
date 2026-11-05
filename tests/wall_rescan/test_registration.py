import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageOps

from tools.wall_rescan.geometry import check_shape, exif_matrix, fit_registration, footprint, project, resize_matrix
from tools.wall_rescan.run import transfer
from tools.sam2_annotation_server import clean_dataset as legacy_import

ROOT = Path(__file__).resolve().parents[2]


class GeometryTests(unittest.TestCase):
    def test_known_homography_outliers_holdout_and_repeatability(self):
        rng = np.random.default_rng(11)
        source = rng.uniform([0,0], [1000,700], (200,2))
        known = np.array([[1.3,.04,120],[-.02,1.1,60],[.00003,.00002,1.]])
        target = project(source, known)
        target[:25] = rng.uniform([0,0],[1500,900],(25,2))
        a = fit_registration(source, target, (1001,701), threshold=3)
        b = fit_registration(source, target, (1001,701), threshold=3)
        self.assertFalse(a[-1])
        self.assertGreater(a[2].sum(), 0)
        self.assertTrue(np.array_equal(a[0], b[0]))
        probes = rng.uniform([0,0],[1000,700],(50,2))
        np.testing.assert_allclose(project(probes,a[0]), project(probes,known), atol=.01)
        np.testing.assert_allclose(project(project(probes,a[0]),np.linalg.inv(a[0])),probes,atol=1e-8)
        self.assertGreater(a[4]['held_out_all_match_error']['max_px'],3)

    def test_resize_half_pixel_and_non_square_round_trip(self):
        s = resize_matrix((1001,777),(333,258))
        r = resize_matrix((7292,5514),(2400,1815))
        h = np.array([[2.1,.1,32],[.01,2.5,200],[.00001,0,1.]])
        working = r @ h @ np.linalg.inv(s)
        np.testing.assert_allclose(np.linalg.inv(r) @ working @ s,h,atol=1e-12)
        np.testing.assert_allclose(project([[0,0]],s)[0],[(333/1001-1)/2,(258/777-1)/2])

    def test_all_exif_orientations_match_pixel_transposition(self):
        values = np.arange(15,dtype=np.uint8).reshape(3,5)
        for orientation in range(1,9):
            image = Image.fromarray(values)
            image.getexif()[274] = orientation
            result = np.asarray(ImageOps.exif_transpose(image))
            for y in range(3):
                for x in range(5):
                    px,py=np.rint(project([[x,y]],exif_matrix(orientation,5,3))[0]).astype(int)
                    self.assertEqual(result[py,px],values[y,x])

    def test_clustered_inliers_are_not_approved(self):
        source = np.random.default_rng(4).uniform([5,5],[30,30],(100,2))
        result = fit_registration(source,source+[50,100],(1000,1000))
        self.assertIn('fit-inliers-cover-less-than-5-percent-of-source',result[-1])

    def test_degenerate_or_horizon_crossing_geometry_is_rejected(self):
        with self.assertRaises(ValueError):
            footprint(np.array([[1,0,0],[0,1,0],[.02,0,-1.]]),(101,101))
        with self.assertRaises(ValueError):
            footprint(np.zeros((3,3)),(100,100))
        source=np.c_[np.arange(40),np.arange(40)]
        with self.assertRaises(ValueError):fit_registration(source,source,(100,100))

    def test_extreme_anisotropy_is_flagged(self):
        metrics,reasons=check_shape(np.diag([50.,1.,1.]),(100,100))
        self.assertEqual(metrics['max_anisotropy'],50.)
        self.assertIn('extreme-local-anisotropy',reasons)

    def test_prelabels_keep_geometry_ids_and_uncertain_coverage(self):
        def hold(id,left,right):
            return dict(id=id,kind='hold',center=[(left+right)/2,.3],polygon=[[left,.2],[right,.2],[right,.4],[left,.4]])
        holds=[hold('full',.1,.2),hold('partial',.5,.7),hold('outside',.8,.9)]
        original=json.dumps(holds)
        mask=np.zeros((100,100),np.uint8);mask[:,:60]=255
        copied,queue=transfer(holds,mask,(100,100))
        self.assertEqual(copied,holds[:2])
        self.assertEqual(json.dumps(holds),original)
        self.assertTrue(all(q['status']=='inherited-unreviewed' for q in queue))
        self.assertEqual(queue[0]['coverage_fraction'],1)
        self.assertTrue(0<queue[1]['coverage_fraction']<1)
        self.assertFalse(queue[2]['observed'])
        self.assertNotIn('removed',[q['status'] for q in queue])


class PipelineTests(unittest.TestCase):
    def run_cli(self,root,output):
        return subprocess.run([sys.executable,'-m','tools.wall_rescan.run',
            '--photo',str(root/'photo.png'),'--reference-image',str(root/'reference.png'),
            '--reference-holds',str(root/'holds.json'),'--scan-id','synthetic','--candidate-version','synthetic-v1',
            '--output',str(output)],cwd=ROOT,text=True,capture_output=True)

    def test_real_feature_pipeline_reproducibility_masks_and_no_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            pixels=np.random.default_rng(99).integers(0,256,(384,512,3),dtype=np.uint8)
            reference=Image.fromarray(pixels)
            reference.save(root/'reference.png')
            reference.crop((64,32,448,352)).save(root/'photo.png')
            (root/'holds.json').write_text(json.dumps([{'id':'stable','kind':'hold','center':[.5,.5],'polygon':[[.4,.4],[.6,.4],[.6,.6],[.4,.6]]}]))
            before={p.name:p.read_bytes() for p in root.iterdir()}
            for name in ['one','two']:
                result=self.run_cli(root,root/name)
                self.assertEqual(result.returncode,0,result.stderr)
            a=json.loads((root/'one/registration.json').read_text())
            b=json.loads((root/'two/registration.json').read_text())
            self.assertEqual(a,b)
            np.testing.assert_allclose(project([[0,0],[200,150]],a['source_to_reference']),[[64,32],[264,182]],atol=.1)
            for name in ['coverage.png','source-index.png','wall_registered.jpg','holds_prelabels.json']:
                self.assertEqual((root/'one'/name).read_bytes(),(root/'two'/name).read_bytes())
            mask=np.asarray(Image.open(root/'one/coverage.png'))
            provenance=np.asarray(Image.open(root/'one/source-index.png'))
            self.assertEqual(mask[0,0],0)
            self.assertEqual(mask[100,100],255)
            np.testing.assert_array_equal(provenance,mask>0)
            prelabels=json.loads((root/'one/holds_prelabels.json').read_text())
            with self.assertRaisesRegex(ValueError,'Wrong wall ID'):
                legacy_import(prelabels)
            report=json.loads((root/'one/report.json').read_text())
            self.assertFalse(report['publishable']);self.assertEqual(report['accepted_hold_count'],0)
            for name,content in before.items():self.assertEqual((root/name).read_bytes(),content)
            self.assertNotEqual(self.run_cli(root,root/'one').returncode,0)

    def test_blank_photo_fails_clearly_without_registered_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name in ['reference','photo']:Image.new('RGB',(256,256),'gray').save(root/(name+'.png'))
            (root/'holds.json').write_text('[]')
            result=self.run_cli(root,root/'failed')
            self.assertNotEqual(result.returncode,0)
            self.assertIn('Not enough SIFT features',result.stderr)
            self.assertEqual(json.loads((root/'failed/report.json').read_text())['status'],'failed')
            self.assertFalse((root/'failed/wall_registered.jpg').exists())


if __name__=='__main__':unittest.main()
