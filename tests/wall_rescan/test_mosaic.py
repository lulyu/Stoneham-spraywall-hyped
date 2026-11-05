import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import cv2
import numpy as np
from PIL import Image

from tools.wall_rescan.compose import compose, guard_regions
from tools.wall_rescan.geometry import project
from tools.wall_rescan.mosaic import source_layer
from tools.wall_rescan.run import matches

ROOT=Path(__file__).resolve().parents[2]


def layer(code,reference,roi=None,blur=False,shift=0):
    x,y,r,b=roi or (0,0,*reference.size)
    photo=reference.crop((x,y,r,b))
    if blur:photo=Image.fromarray(cv2.GaussianBlur(np.asarray(photo),(15,15),4))
    matrix=np.array([[1.,0,x+shift],[0,1,y],[0,0,1]])
    valid=np.full((b-y,r-x),255,np.uint8);valid[[0,-1],:]=0;valid[:,[0,-1]]=0
    matches=[]
    for px in range(20,reference.width-10,20):
        for py in range(20,reference.height-10,20):
            if x+5<px<r-5 and y+5<py<b-5:
                matches.append({'source':[px-x,py-y],'reference':[px,py],'fit_inlier':True,'held_out':False,'error_full_reference_px':abs(shift)})
    return {'id':'source-'+str(code),'code':code,'image':photo,'valid':valid,'matrix':matrix,'max_error':8.,'priority':1.,
        'registration':{'metrics':{'fit_inlier_error':{'p95_px':abs(shift)},'fit_inlier_ratio':1.,'shape':{'local_scale_max':1.,'max_anisotropy':1.}},'correspondences':matches}}


def hold(left=.4,right=.6):
    return {'id':'old','kind':'hold','center':[(left+right)/2,.5],'polygon':[[left,.3],[right,.3],[right,.6],[left,.6]]}


class CompositeTests(unittest.TestCase):
    def setUp(self):
        self.reference=Image.fromarray(np.random.default_rng(33).integers(10,240,(240,360,3),dtype=np.uint8))
        self.temp=tempfile.TemporaryDirectory();self.output=Path(self.temp.name);(self.output/'sources').mkdir()
    def tearDown(self):self.temp.cleanup()

    def test_pixels_have_one_source_and_hold_guard_stays_whole(self):
        first=layer(1,self.reference,(0,0,260,240))
        second=layer(2,self.reference,(100,0,360,240))
        second['image']=Image.fromarray(np.clip(np.asarray(second['image']).astype(int)+[10,0,0],0,255).astype(np.uint8))
        result,coverage,index,counts,uncertainty,qa=compose([first,second],self.reference,[hold()],self.output,cell=12,margin=6,normalize=False)
        self.assertTrue(np.all(counts[coverage>0]>=1))
        np.testing.assert_array_equal(index>0,coverage>0)
        for source in [first,second]:
            warped=cv2.warpPerspective(np.asarray(source['image']),source['matrix'],self.reference.size)
            selected=index==source['code']
            np.testing.assert_array_equal(result[selected],warped[selected])
        _,guards,_=guard_regions([hold()],self.reference.size,6)
        self.assertEqual(len(np.unique(index[guards>0])),1)
        self.assertFalse(qa['unresolved_hold_regions'])
        self.assertTrue(qa['overlaps']);self.assertEqual(qa['overlaps'][0]['status'],'consistent')

    def test_nearby_hold_buffers_do_not_merge_separate_cores(self):
        first,second=hold(.1,.4),hold(.45,.75)
        count,labels,stats=guard_regions([first,second],(200,200),8)
        self.assertEqual(count,3)
        self.assertNotEqual(labels[80,50],labels[80,120])
        self.assertTrue(np.all(labels[65:115,25:75]==labels[80,50]))

    def test_sharp_source_wins_over_blurred_duplicate(self):
        sharp=layer(1,self.reference);blur=layer(2,self.reference,blur=True)
        _,coverage,index,*_=compose([sharp,blur],self.reference,[],self.output,cell=12,normalize=False)
        self.assertGreater(sharp['quality']['median_sharpness'],blur['quality']['median_sharpness'])
        self.assertGreater(np.mean(index[coverage>0]==1),.99)

    def test_exposure_gain_is_bounded_recorded_and_preserves_provenance(self):
        source=layer(1,self.reference)
        source['image']=Image.fromarray((np.asarray(source['image'])*.5).astype(np.uint8))
        result,coverage,index,*_=compose([source],self.reference,[],self.output,cell=12,normalize=True)
        gains=np.asarray(source['exposure_gain_rgb'])
        self.assertTrue(np.all(gains>=.85));self.assertTrue(np.all(gains<=1.18))
        expected=np.clip(np.rint(np.asarray(source['image'])*gains),0,255).astype(np.uint8)
        np.testing.assert_array_equal(result[coverage>0],expected[coverage>0])
        self.assertTrue(np.all(index[coverage>0]==1))

    def test_holes_and_occlusion_masks_never_use_old_reference_pixels(self):
        first=layer(1,self.reference);first['valid'][80:120,90:140]=0
        result,coverage,index,counts,uncertainty,_=compose([first],self.reference,[],self.output,cell=12,normalize=False)
        self.assertTrue(np.all(result[85:115,95:135]==0))
        self.assertTrue(np.all(coverage[85:115,95:135]==0))
        self.assertTrue(np.all(index[85:115,95:135]==0))
        self.assertTrue(np.all(uncertainty[85:115,95:135]&16))

    def test_split_hold_without_covering_source_is_explicitly_uncertain(self):
        a=layer(1,self.reference,(0,0,190,240));b=layer(2,self.reference,(170,0,360,240))
        *_,uncertainty,qa=compose([a,b],self.reference,[hold(.25,.75)],self.output,cell=8,margin=6,normalize=False)
        self.assertTrue(qa['unresolved_hold_regions'])
        self.assertTrue(np.any(uncertainty&8))

    def test_overlapping_registration_disagreement_is_flagged(self):
        a=layer(1,self.reference,shift=6);b=layer(2,self.reference,shift=-6)
        *_,uncertainty,qa=compose([a,b],self.reference,[],self.output,cell=12,normalize=False,overlap_error=10)
        self.assertEqual(qa['overlaps'][0]['status'],'misaligned')
        self.assertAlmostEqual(qa['overlaps'][0]['error_full_reference_px']['median_px'],12)
        self.assertTrue(np.any(uncertainty&4))

    def test_masked_regions_do_not_supply_registration_features(self):
        mask=np.full((240,360),255,np.uint8);mask[:,:180]=0
        source,_,_=matches(self.reference,self.reference,2400,3000,0,matcher_kind='flann',source_mask=mask)
        self.assertGreater(len(source),20)
        self.assertTrue(np.all(np.rint(source[:,0])>=180))

    def test_feature_cache_is_bound_to_the_reference_image(self):
        cache={}
        matches(self.reference,self.reference,2400,3000,0,reference_cache=cache,matcher_kind='flann')
        other=Image.fromarray(np.random.default_rng(654).integers(0,256,(240,360,3),dtype=np.uint8))
        source,target,_=matches(other,other,2400,3000,0,reference_cache=cache,matcher_kind='flann')
        self.assertGreater(len(source),20)
        np.testing.assert_allclose(source,target,atol=.001)

    def test_source_roi_and_mask_use_prepared_full_photo_coordinates(self):
        self.reference.save(self.output/'photo.png')
        mask=np.full((240,360),255,np.uint8);mask[30:40,50:60]=0
        Image.fromarray(mask).save(self.output/'mask.png')
        value=source_layer({'id':'panel','image':'photo.png','valid_mask':'mask.png','source_roi':[40,20,300,200]},self.output,1)
        self.assertEqual(value['image'].size,(260,180))
        self.assertEqual(value['valid'][15,15],0)
        np.testing.assert_allclose(project([[50,30]],value['source_metadata']['raw_to_prepared']),[[10,10]])


class MosaicCLITests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        reference=Image.fromarray(np.random.default_rng(5).integers(0,256,(384,512,3),dtype=np.uint8))
        reference.save(self.root/'reference.png');reference.crop((0,0,330,384)).save(self.root/'partial.png')
        Image.new('RGB',(512,384),'gray').save(self.root/'blank.png')
        (self.root/'holds.json').write_text(json.dumps([hold(.15,.3)]))
    def tearDown(self):self.temp.cleanup()
    def run_manifest(self,sources,name='out'):
        config={'scanId':'test','referenceVersion':'old','candidateVersion':'candidate','referenceImage':'reference.png',
            'referenceHolds':'holds.json','inputKind':'reference-derived-fixtures','settings':{'min_coverage':.98,'cell':12},'sources':sources}
        path=self.root/'scan.json';path.write_text(json.dumps(config))
        result=subprocess.run([sys.executable,'-m','tools.wall_rescan.mosaic','--manifest',str(path),'--output',str(self.root/name)],cwd=ROOT,capture_output=True,text=True)
        return result,self.root/name

    def test_rejected_photo_excluded_and_repeatable_outputs_keep_provenance(self):
        sources=[{'id':'good','image':'reference.png'},{'id':'bad','image':'blank.png'}]
        first,a=self.run_manifest(sources,'one');second,b=self.run_manifest(sources,'two')
        self.assertEqual(first.returncode,0,first.stderr);self.assertEqual(second.returncode,0,second.stderr)
        report=json.loads((a/'report.json').read_text())
        self.assertEqual(report['accepted_source_count'],1);self.assertEqual(report['rejected_source_count'],1)
        self.assertFalse(report['publishable']);self.assertEqual(report['accepted_hold_count'],0)
        self.assertEqual(json.loads((a/'sources/002-registration.json').read_text())['status'],'rejected')
        self.assertTrue(np.all(np.isin(np.asarray(Image.open(a/'source-index.png')),[0,1])))
        for file in ['report.json','wall_registered.png','source-index.png','coverage.png','holds_prelabels.json']:
            self.assertEqual((a/file).read_bytes(),(b/file).read_bytes(),file)
        original=(a/'report.json').read_bytes()
        again,_=self.run_manifest(sources,'one');self.assertNotEqual(again.returncode,0)
        self.assertEqual((a/'report.json').read_bytes(),original)

    def test_missing_coverage_returns_review_status_and_visible_holes(self):
        result,out=self.run_manifest([{'id':'partial','image':'partial.png'}])
        self.assertEqual(result.returncode,2,result.stderr)
        report=json.loads((out/'report.json').read_text())
        self.assertIn('required-region-coverage-below-threshold',report['qa_failures'])
        self.assertFalse(report['publishable'])
        self.assertTrue(np.all(np.asarray(Image.open(out/'wall_registered.png'))[:,400:]==0))
        self.assertTrue(np.all(np.asarray(Image.open(out/'source-index.png'))[:,400:]==0))

    def test_manual_facet_rois_preserve_raw_full_photo_coordinates(self):
        sources=[]
        for id,x,r in [('left',0,256),('right',256,512)]:
            width=r-x
            points=[[20,20],[width-21,20],[width-21,363],[20,363]]
            anchors={'source_size':[width,384],'reference_size':[512,384],'source_points':points,'reference_points':[[px+x,py] for px,py in points]}
            (self.root/(id+'-anchors.json')).write_text(json.dumps(anchors))
            sources.append({'id':id,'image':'reference.png','source_roi':[x,0,r,384],'alignment_anchors':id+'-anchors.json'})
        result,out=self.run_manifest(sources)
        self.assertEqual(result.returncode,0,result.stderr)
        for code in [1,2]:
            record=json.loads((out/'sources'/f'{code:03d}-registration.json').read_text())
            np.testing.assert_allclose(project([[300,100]],record['registration']['raw_source_to_reference']),[[300,100]],atol=.001)

    def test_all_bad_sources_fail_without_a_mosaic(self):
        result,out=self.run_manifest([{'id':'bad','image':'blank.png'}])
        self.assertEqual(result.returncode,1)
        self.assertEqual(json.loads((out/'report.json').read_text())['status'],'failed')
        self.assertFalse((out/'wall_registered.png').exists())

    def test_duplicate_source_ids_are_rejected_before_output(self):
        result,out=self.run_manifest([{'id':'same','image':'reference.png'},{'id':'same','image':'partial.png'}])
        self.assertNotEqual(result.returncode,0)
        self.assertIn('unique',result.stderr);self.assertFalse(out.exists())


if __name__=='__main__':unittest.main()
