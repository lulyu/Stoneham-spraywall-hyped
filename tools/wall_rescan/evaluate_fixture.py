"""Evaluate known reference-derived crop geometry, never claim real-scene accuracy."""
import argparse
import json
from pathlib import Path
import numpy as np
from .geometry import project,summary
from .run import digest,write_json


def evaluate(truth_path,result_path):
    truth=json.loads(truth_path.read_text());manifest=json.loads((result_path/'manifest.json').read_text())
    if truth['reference_sha256']!=manifest['session']['referenceImageSha256']:raise ValueError('Fixture reference hash mismatch.')
    results=[];all_errors=[]
    for expected in truth['generated_sources']:
        source=next(s for s in manifest['sources'] if s['id']==expected['id'])
        if source['status']!='registered-for-inspection':
            results.append({'id':source['id'],'status':'not-registered'});continue
        if expected['image_sha256']!=source['input_hashes']['image']:raise ValueError('Fixture source hash mismatch: '+source['id'])
        x,y,r,b=expected['reference_crop']
        roi=source['registration']['source']['source_roi'];width,height=source['registration']['source']['prepared_size']
        points=np.array([[px,py] for px in np.linspace(width*.1,width*.9,5) for py in np.linspace(height*.1,height*.9,5)])
        targets=points+[x+roi[0],y+roi[1]]
        errors=np.linalg.norm(project(points,np.asarray(source['registration']['source_to_reference']))-targets,axis=1)
        all_errors.extend(errors.tolist());results.append({'id':source['id'],'status':'evaluated','error_full_reference_px':summary(errors)})
    return {'validation_kind':'known reference-derived crop transforms, independent of fitted SIFT pairs; NOT real-world landmark validation',
        'truth_sha256':digest(truth_path),'sessionId':manifest['session']['sessionId'],'aggregate_error_full_reference_px':summary(np.array(all_errors)),
        'sources':results,'notes':'The user-supplied partial photo has no independent transform ground truth and is excluded.'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--truth',type=Path,required=True);parser.add_argument('--result',type=Path,required=True)
    args=parser.parse_args()
    try:
        result=evaluate(args.truth,args.result)
        write_json(args.result/'fixture-validation.json',result)
        print(json.dumps(result,indent=2))
    except (ValueError,OSError,KeyError,StopIteration) as error:parser.exit(1,str(error)+'\n')


if __name__=='__main__':main()
