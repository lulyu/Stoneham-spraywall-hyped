"""Phase B: registered multi-photo candidate mosaic; never publishes a wall."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
from types import SimpleNamespace

from .run import cv2, np, Image, ImageDraw, ROOT, digest, load_image, pillow_version, preview, register_photo, transfer, write_json
from .compose import compose


def resolve_input(base, value):
    return None if value is None else (base / value).resolve()


def source_layer(entry, base, code):
    path=resolve_input(base,entry['image'])
    image,metadata=load_image(path)
    full_size=image.size
    roi=entry.get('source_roi',[0,0,*full_size])
    if not isinstance(roi,list) or len(roi)!=4 or any(type(v) is not int for v in roi):
        raise ValueError('source_roi must contain four integer EXIF-prepared full-source pixels.')
    x,y,right,bottom=roi
    if not (0<=x<right<=full_size[0] and 0<=y<bottom<=full_size[1]):raise ValueError('source_roi is outside the prepared photograph.')
    if min(right-x,bottom-y)<8:raise ValueError('source_roi must be at least 8 pixels per side.')
    mask_path=resolve_input(base,entry.get('valid_mask'))
    if mask_path:
        with Image.open(mask_path) as mask:
            if mask.size!=full_size:raise ValueError('valid_mask must match the full EXIF-prepared photograph size.')
            valid=np.where(np.asarray(mask.convert('L').crop(roi))>=128,255,0).astype(np.uint8)
    else:valid=np.full((bottom-y,right-x),255,np.uint8)
    valid[[0,-1],:]=0;valid[:,[0,-1]]=0
    image=image.crop(roi)
    crop=np.array([[1,0,-x],[0,1,-y],[0,0,1.]])
    metadata['full_prepared_size']=list(full_size);metadata['source_roi']=roi
    metadata['prepared_size']=list(image.size)
    metadata['raw_to_prepared']=(crop@np.asarray(metadata['raw_to_prepared'])).tolist()
    priority=entry.get('priority',1.)
    if isinstance(priority,bool) or not isinstance(priority,(int,float)) or not np.isfinite(priority) or not .25<=priority<=4:
        raise ValueError('priority must be between 0.25 and 4.')
    hashes={'image':digest(path)}
    if mask_path:hashes['valid_mask']=digest(mask_path)
    return {'id':entry['id'],'code':code,'image':image,'valid':valid,'source_metadata':metadata,
        'path':path,'mask_path':mask_path,'input_hashes':hashes,'priority':priority}


def input_config(path,output):
    content=path.read_bytes();value=json.loads(content);base=path.parent
    for key in ['scanId','referenceVersion','candidateVersion','referenceImage','referenceHolds','inputKind']:
        if not isinstance(value.get(key),str) or not value[key].strip():raise ValueError('Missing manifest field: '+key)
    if value['referenceVersion']==value['candidateVersion']:raise ValueError('Candidate version must differ from reference version.')
    if value['inputKind'] not in ['real-captures','reference-derived-fixtures','mixed-fixture-baseline']:
        raise ValueError('inputKind must explicitly describe real captures versus derived fixtures.')
    entries=value.get('sources')
    if not isinstance(entries,list) or not 1<=len(entries)<=64 or any(not isinstance(e,dict) for e in entries):raise ValueError('Manifest needs 1–64 source entries.')
    if any(type(e.get('enabled',True)) is not bool for e in entries):raise ValueError('enabled must be boolean.')
    ids=[e.get('id') for e in entries]
    if any(not isinstance(id,str) or not id.strip() for id in ids) or len(set(ids))!=len(ids):raise ValueError('Source IDs must be nonempty and unique.')
    inputs=[path,resolve_input(base,value['referenceImage']),resolve_input(base,value['referenceHolds'])]
    for entry in entries:
        for key in ['image','valid_mask','alignment_anchors','validation_anchors']:
            if key=='image' and not isinstance(entry.get(key),str):raise ValueError('Every source needs an image path.')
            if entry.get(key) is not None:inputs.append(resolve_input(base,entry[key]))
    protected=['public','src','backend','infra','tools','tests','docs','.git','.github']
    if output==ROOT or any(output.is_relative_to(ROOT/p) for p in protected):raise ValueError('Output cannot be a source or production directory.')
    if any(p.is_relative_to(output) for p in inputs):raise ValueError('Inputs cannot be inside the output directory.')
    if output.exists() and any(output.iterdir()):raise ValueError('Output contains existing work; choose a new directory.')
    return value,base,inputs,hashlib.sha256(content).hexdigest()


def inspection_previews(output,reference,canvas,coverage,source_index,uncertainty,holds,input_kind,layers_for_preview):
    result=Image.fromarray(canvas)
    candidate=result.copy();candidate.thumbnail((1600,1600),Image.Resampling.LANCZOS)
    draw=ImageDraw.Draw(candidate);draw.rectangle((0,0,candidate.width,28),fill='#10140e')
    draw.text((8,8),'PHASE B CANDIDATE | '+input_kind+' | not a published wall',fill='white')
    candidate.save(output/'mosaic-preview.jpg',quality=93)
    context=reference.copy();context.thumbnail((1600,1600))
    context=Image.blend(context,Image.new('RGB',context.size,'#10140e'),.75)
    context.paste(result.resize(context.size,Image.Resampling.LANCZOS),(0,0),Image.fromarray(coverage).resize(context.size,Image.Resampling.NEAREST))
    draw=ImageDraw.Draw(context);draw.rectangle((0,0,context.width,28),fill='#10140e')
    draw.text((8,8),'CANDIDATE OBSERVATIONS | dim background = OLD reference, diagnostic only',fill='white')
    context.save(output/'placement-preview.jpg',quality=93)
    small=cv2.resize(source_index,(context.width,context.height),interpolation=cv2.INTER_NEAREST)
    colors=np.zeros((65,3),np.uint8)
    for code in range(1,65):
        hue=np.uint8([[[code*137%180,180,240]]]);colors[code]=cv2.cvtColor(hue,cv2.COLOR_HSV2RGB)[0,0]
    source_colors=colors[small];source_colors[small==0]=[255,0,180]
    palette=[(0,'no observation')]+[(layer['code'],layer['id']) for layer in layers_for_preview]
    chart=Image.new('RGB',(context.width,context.height+24*((len(palette)+3)//4)+8),'#10140e')
    chart.paste(Image.fromarray(source_colors),(0,0));draw=ImageDraw.Draw(chart)
    for i,(code,name) in enumerate(palette):
        x=(i%4)*(context.width//4)+8;y=context.height+8+(i//4)*24
        color=(255,0,180) if code==0 else tuple(int(c) for c in colors[code])
        draw.rectangle((x,y,x+12,y+12),fill=color);draw.text((x+18,y),f'{code}: {name}',fill='white')
    chart.save(output/'source-index-preview.png')
    risk=cv2.resize(uncertainty,(context.width,context.height),interpolation=cv2.INTER_NEAREST)
    overlay=np.asarray(result.resize(context.size,Image.Resampling.LANCZOS)).copy()
    overlay[(risk&16)>0]=[160,0,100]
    overlay[(risk&1)>0]=[255,200,70]
    overlay[(risk&14)>0]=[255,60,70]
    qa_image=Image.fromarray(overlay);draw=ImageDraw.Draw(qa_image)
    draw.rectangle((0,0,qa_image.width,28),fill='#10140e')
    draw.text((8,8),'QA: magenta = missing | yellow = source seam | red = alignment/split risk (NOT hold-change detection)',fill='white')
    qa_image.save(output/'qa-overlay.jpg',quality=93)
    outlines=result.copy();draw=ImageDraw.Draw(outlines)
    for hold in holds:
        points=[(u*reference.width,v*reference.height) for u,v in hold['polygon']]
        draw.line(points+[points[0]],fill='#33e2ff',width=max(1,reference.width//2200))
    preview(outlines,output/'prelabels-overlay.jpg',1800)


def run(args):
    path=args.manifest.resolve();output=args.output.resolve()
    config,base,input_paths,read_manifest_hash=input_config(path,output)
    settings={'max_side':2400,'features':18000,'max_error_px':8.,'seed':0,'cell':32,'guard_pixels':8,
        'normalize_exposure':True,'min_coverage':.995,'max_overlap_error_px':10.,'matcher':'flann'}
    supplied=config.get('settings',{})
    if not isinstance(supplied,dict) or set(supplied)-set(settings):raise ValueError('Unknown settings in manifest.')
    settings.update(supplied)
    for key,lo,hi in [('max_side',64,5000),('features',100,50000),('cell',4,256),('guard_pixels',0,64),('seed',0,2147483647)]:
        if type(settings[key]) is not int or not lo<=settings[key]<=hi:raise ValueError('Invalid setting: '+key)
    for key,lo,hi in [('max_error_px',.01,100),('max_overlap_error_px',.01,200),('min_coverage',.01,1)]:
        if isinstance(settings[key],bool) or not isinstance(settings[key],(int,float)) or not np.isfinite(settings[key]) or not lo<=settings[key]<=hi:raise ValueError('Invalid setting: '+key)
    if settings['matcher'] not in ['bf','flann']:raise ValueError('matcher must be bf or flann.')
    if type(settings['normalize_exposure']) is not bool:raise ValueError('normalize_exposure must be boolean.')
    output.mkdir(parents=True,exist_ok=True)
    lock=output/'.run-lock';fd=os.open(lock,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.close(fd)
    try:
        (output/'sources').mkdir()
        cv2.setNumThreads(1);cv2.setRNGSeed(settings['seed'])
        initial_hashes={str(p):digest(p) for p in input_paths if p.exists()}
        if initial_hashes[str(path)]!=read_manifest_hash:raise ValueError('Manifest changed while being opened.')
        reference_path=resolve_input(base,config['referenceImage']);holds_path=resolve_input(base,config['referenceHolds'])
        reference,reference_meta=load_image(reference_path)
        holds=json.loads(holds_path.read_text());holds=holds if isinstance(holds,list) else holds['holds']
        transfer(holds,np.zeros(reference.size[::-1],np.uint8),reference.size)
        if len({h['id'] for h in holds})!=len(holds):raise ValueError('Reference hold IDs must be unique.')
        region=config.get('required_roi',[0,0,*reference.size])
        if not isinstance(region,list) or len(region)!=4 or any(type(v) is not int for v in region) or not (0<=region[0]<region[2]<=reference.width and 0<=region[1]<region[3]<=reference.height):raise ValueError('Invalid required_roi in full reference pixels.')
        records=[];layers=[];cache={}
        for code,entry in enumerate(config['sources'],1):
            record={'id':entry['id'],'source_code':code,'input':entry,'status':'disabled'}
            if entry.get('enabled',True) is not True:
                records.append(record);continue
            try:
                layer=source_layer(entry,base,code)
                fit_args=SimpleNamespace(**{key:settings[key] for key in ['max_side','features','max_error_px','seed','matcher']},
                    alignment_anchors=resolve_input(base,entry.get('alignment_anchors')),
                    validation_anchors=resolve_input(base,entry.get('validation_anchors')))
                registration,matrix,*_=register_photo(layer['image'],reference,layer['source_metadata'],reference_meta,fit_args,cache,source_mask=layer['valid'])
                record.update(status=registration['status'],registration=registration,input_hashes=layer['input_hashes'])
                if registration['qa_failures']:
                    record['status']='rejected';record['error']=', '.join(registration['qa_failures'])
                else:
                    valid=cv2.warpPerspective(layer['valid'],matrix,reference.size,flags=cv2.INTER_NEAREST,borderValue=0)
                    if np.count_nonzero(valid)<100:raise ValueError('Less than 100 reference pixels of usable coverage.')
                    layer.update(matrix=matrix,registration=registration,max_error=settings['max_error_px'])
                    layers.append(layer)
            except (ValueError,OSError,KeyError,TypeError,cv2.error,np.linalg.LinAlgError) as error:
                record.update(status='rejected',error=str(error))
            records.append(record);write_json(output/'sources'/f'{code:03d}-registration.json',record)
            print(f"{code}/{len(config['sources'])}: {entry['id']}: {record['status']}",file=sys.stderr)
        if not layers:
            write_json(output/'report.json',{'status':'failed','publishable':False,'error':'No source passed registration QA. Supply clearer photos, masks, source ROIs or manual anchors.','sources':records})
            return 1
        canvas,coverage,indices,counts,uncertainty,qa=compose(layers,reference,holds,output,cell=settings['cell'],margin=settings['guard_pixels'],normalize=settings['normalize_exposure'],overlap_error=settings['max_overlap_error_px'])
        for p in input_paths:
            if (digest(p) if p.exists() else None)!=initial_hashes.get(str(p)):raise ValueError('Input changed during the run: '+str(p))
        Image.fromarray(canvas).save(output/'wall_registered.png')
        Image.fromarray(canvas).save(output/'wall_registered.jpg',quality=95)
        for name,array in [('coverage.png',coverage),('source-index.png',indices),('coverage-count.png',counts),('uncertainty.png',uncertainty)]:Image.fromarray(array).save(output/name)
        copied,queue=transfer(holds,coverage,reference.size)
        for hold,item in zip(holds,queue):
            points=np.rint(np.asarray(hold['polygon'])*reference.size).astype(np.int32)
            x,y,bw,bh=cv2.boundingRect(points);x0,y0,x1,y1=max(0,x),max(0,y),min(reference.width,x+bw),min(reference.height,y+bh)
            if x1>x0 and y1>y0:
                mask=np.zeros((y1-y0,x1-x0),np.uint8);cv2.fillPoly(mask,[points-[x0,y0]],255)
                values=uncertainty[y0:y1,x0:x1][mask>0]
                item['uncertain_pixel_fraction']=float(np.count_nonzero(values)/max(1,len(values)))
                if np.any(values&14):item['reasonCodes'].append('mosaic-alignment-or-source-seam-review')
        identity={'scanId':config['scanId'],'gymId':'stoneham-crg','wallId':'spray-wall-1',
            'referenceVersion':config['referenceVersion'],'candidateVersion':config['candidateVersion'],
            'referenceImageSha256':digest(reference_path),'referenceHoldsSha256':digest(holds_path),
            'inputManifestSha256':digest(path),'sourceContents':[{
                'id':e['id'],'hashes':{key:initial_hashes.get(str(resolve_input(base,e[key]))) for key in ['image','valid_mask','alignment_anchors','validation_anchors'] if e.get(key) is not None}
                } for e in config['sources']],'registeredImageSha256':digest(output/'wall_registered.png'),
            'coordinateFrame':{'size':list(reference.size),'orientation':'EXIF-prepared canonical reference'}}
        identity['sessionId']=hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest()
        write_json(output/'holds_prelabels.json',{'session':identity,'wallId':identity['wallId'],'image_size':list(reference.size),'datasetRole':'unreviewed-prelabels','publishable':False,'holds':copied})
        write_json(output/'review_queue.json',{'session':identity,'reviewRevision':0,'publishable':False,'entries':queue})
        write_json(output/'lineage.json',{'session':identity,'reviewRevision':0,'links':[{'oldHoldId':h['id'],'candidateHoldId':h['id'],'relation':'unverified-continuity','reviewer':None} for h in copied]})
        x0,y0,x1,y1=region;fraction=float(np.count_nonzero(coverage[y0:y1,x0:x1])/((y1-y0)*(x1-x0)))
        failures=[]
        if fraction<settings['min_coverage']:failures.append('required-region-coverage-below-threshold')
        if any(pair['status']!='consistent' for pair in qa['overlaps']):failures.append('overlap-alignment-not-verified')
        if qa['unresolved_hold_regions']:failures.append('known-hold-region-spans-multiple-sources')
        code_commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
        code_dirty=bool(subprocess.check_output(['git','status','--porcelain','--untracked-files=all','--','tools/wall_rescan','tests/wall_rescan'],cwd=ROOT,text=True).strip())
        for layer in layers:
            records[layer['code']-1].update(quality=layer['quality'],exposure_gain_rgb=layer['exposure_gain_rgb'],selected_pixel_count=layer['selected_pixel_count'])
        manifest={'session':identity,'publishable':False,'inputKind':config['inputKind'],'settings':settings,'required_roi':region,
            'input_manifest':str(path),'input_hashes':initial_hashes,'sources':records,
            'source_index_legend':{'0':'no observation',**{str(l['code']):l['id'] for l in layers}},
            'uncertainty_bits':{'1':'source seam band','2':'overlap correspondence support insufficient','4':'overlap registration disagreement','8':'known hold protection region split','16':'no observation'},
            'versions':{'python':platform.python_version(),'opencv':cv2.__version__,'numpy':np.__version__,'pillow':pillow_version},
            'code_commit':code_commit,'code_dirty':code_dirty,'code_sha256':{p.name:digest(p) for p in Path(__file__).parent.glob('*.py')}}
        write_json(output/'manifest.json',manifest)
        report={'phase':'B, multi-photo candidate','status':'ready-for-review' if not failures else 'needs-review','publishable':False,
            'inputKind':config['inputKind'],'sessionId':identity['sessionId'],'reference_size':list(reference.size),
            'accepted_source_count':len(layers),'rejected_source_count':sum(r['status']=='rejected' for r in records),
            'required_roi':region,'required_coverage_fraction':fraction,'whole_reference_coverage_fraction':float(np.count_nonzero(coverage)/coverage.size),
            'intersecting_prelabel_count':len(copied),'fully_observed_hold_count':sum(q['coverage_fraction']>=.99 for q in queue),
            'accepted_hold_count':0,'change_classification':'not run','qa_failures':failures,
            'source_contributions':[{k:r[k] for k in ['id','source_code','selected_pixel_count','quality','exposure_gain_rgb']} for r in records if r['status']=='registered-for-inspection'],
            **qa,'limitations':['Global or explicitly cropped per-facet homographies; no automatic 3D reconstruction.','Unknown/new holds are not covered by old-outline seam protection.','Overlap checks use shared-reference feature matches, not independent landmark validation.','No SAM2 correction, change classifier, rescan review UI or WallVersion publication.']}
        write_json(output/'report.json',report)
        inspection_previews(output,reference,canvas,coverage,indices,uncertainty,copied,config['inputKind'],layers)
        print(json.dumps({k:v for k,v in report.items() if k not in ['source_contributions','guarded_regions','overlaps']},indent=2))
        return 2 if failures else 0
    except Exception as error:
        write_json(output/'report.json',{'status':'failed','publishable':False,'error':str(error)})
        raise
    finally:lock.unlink(missing_ok=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    try:return run(args)
    except (ValueError,OSError,KeyError,TypeError,cv2.error,np.linalg.LinAlgError) as error:
        print('Mosaic failed: '+str(error),file=sys.stderr);return 1


if __name__=='__main__':raise SystemExit(main())
