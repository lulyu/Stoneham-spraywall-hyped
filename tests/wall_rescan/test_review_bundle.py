import io
import json
from email.message import Message
from pathlib import Path
import tempfile
import unittest

from tools.wall_rescan.review_bundle import ReviewBundle, digest
from tools.sam2_annotation_server import Annotator, Handler


class ReviewBundleTests(unittest.TestCase):
    def make_bundle(self, root):
        (root/'public/wall').mkdir(parents=True)
        (root/'src/data/polygons').mkdir(parents=True)
        reference=root/'public/wall/stoneham-spraywall-canonical.jpg';reference.write_bytes(b'reference')
        holds=root/'src/data/polygons/holds.json';holds.write_text('[]')
        scan=root/'scan';scan.mkdir()
        (scan/'wall_registered.png').write_bytes(b'candidate')
        for name in ('coverage.png','uncertainty.png'):(scan/name).write_bytes(b'mask')
        session=dict(sessionId='a'*64,referenceImageSha256=digest(reference),referenceHoldsSha256=digest(holds),
                     registeredImageSha256=digest(scan/'wall_registered.png'),coordinateFrame=dict(size=[7292,5514]))
        for name in ('manifest.json','holds_prelabels.json','review_queue.json'):
            (scan/name).write_text(json.dumps(dict(session=session,publishable=False,reviewRevision=0,entries=[])))
        (scan/'report.json').write_text(json.dumps(dict(sessionId=session['sessionId'],publishable=False)))
        return scan,session

    def test_exact_candidate_identity_and_mutation_detection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);scan,session=self.make_bundle(root);bundle=ReviewBundle(scan,root)
            bundle.validate_prediction(dict(sessionId=session['sessionId'],image_sha256=session['registeredImageSha256']))
            for body in ({},dict(sessionId=session['sessionId'],image_sha256='f'*64)):
                with self.assertRaisesRegex(ValueError,'mismatch'):bundle.validate_prediction(body)
            with self.assertRaises(ValueError):bundle.file('../manifest.json')
            (scan/'coverage.png').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'changed on disk'):bundle.file('coverage.png')
            (scan/'wall_registered.png').write_bytes(b'wrong image')
            with self.assertRaisesRegex(ValueError,'hashes'):ReviewBundle(scan,root)

    def test_wrong_session_queue_and_missing_files_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);scan,_=self.make_bundle(root)
            queue=json.loads((scan/'review_queue.json').read_text());queue['session']['sessionId']='e'*64
            (scan/'review_queue.json').write_text(json.dumps(queue))
            with self.assertRaisesRegex(ValueError,'identity differs'):ReviewBundle(scan,root)
            (scan/'coverage.png').unlink()
            with self.assertRaisesRegex(ValueError,'folder needs'):ReviewBundle(scan,root)

    def test_supplied_references_are_hash_bound_and_do_not_change_production(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);scan,session=self.make_bundle(root)
            (scan/'reference.jpg').write_bytes(b'reviewed v6 image')
            (scan/'reference-holds.json').write_text('[{"id":"reviewed-hold"}]')
            session.update(referenceImageSha256=digest(scan/'reference.jpg'),referenceHoldsSha256=digest(scan/'reference-holds.json'))
            for name in ('manifest.json','holds_prelabels.json','review_queue.json'):
                data=json.loads((scan/name).read_text());data['session']=session
                (scan/name).write_text(json.dumps(data))
            bundle=ReviewBundle(scan,root)
            self.assertEqual(bundle.file('reference.jpg'),scan/'reference.jpg')
            self.assertEqual((root/'src/data/polygons/holds.json').read_text(),'[]')
            (scan/'reference-holds.json').write_text('[]')
            with self.assertRaisesRegex(ValueError,'changed on disk'):bundle.file('reference-holds.json')
            with self.assertRaisesRegex(ValueError,'hashes'):ReviewBundle(scan,root)

    def test_review_server_never_seeds_or_writes_legacy_storage(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);scan,session=self.make_bundle(root);bundle=ReviewBundle(scan,root)
            storage=root/'must-not-exist.json'
            annotator=Annotator(None,storage,1,seed=root/'src/data/polygons/holds.json',rescan=bundle,review_only=True)
            self.assertFalse(storage.exists());self.assertEqual(annotator.status['sessionId'],session['sessionId'])
            with self.assertRaisesRegex(ValueError,'legacy'):annotator.write(dict(holds=[]))
            with self.assertRaisesRegex(ValueError,'legacy'):annotator.read()
            handler=object.__new__(Handler);handler.annotator=annotator;handler.access_key=None
            handler.headers=Message();handler.headers['Content-Type']='application/json';handler.headers['Content-Length']='0'
            results=[];handler.json=lambda status,body:results.append((status,body))
            for path in ('accept','import','delete','dismiss','predict'):
                handler.path='/api/sam2/'+path;content=b'{}';handler.headers.replace_header('Content-Length',str(len(content)));handler.rfile=io.BytesIO(content)
                handler.do_POST();self.assertIn(results[-1][0],(400,409));self.assertFalse(storage.exists())
            handler.path='/api/sam2/predict'
            content=json.dumps(dict(sessionId=session['sessionId'],image_sha256=session['registeredImageSha256'],points=[dict(point=[.5,.5],label=1)])).encode()
            handler.headers.replace_header('Content-Length',str(len(content)));handler.rfile=io.BytesIO(content);handler.do_POST()
            self.assertEqual(results[-1][0],503)
            annotator.executor.shutdown(wait=False)
