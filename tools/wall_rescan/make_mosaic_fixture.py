"""Generate explicitly reference-derived overlapping inputs; not fresh wall scans."""
import argparse
import json
import os
from pathlib import Path
from PIL import ImageEnhance, ImageFilter
from .run import ROOT, digest, load_image, write_json


def generate(output,reference_path,holds_path,extra_photo=None):
    output=output.resolve();reference_path=reference_path.resolve();holds_path=holds_path.resolve()
    if output==ROOT or any(output.is_relative_to(ROOT/p) for p in ['public','src','backend','infra','tools','tests','docs','.git','.github']):raise ValueError('Fixture output must stay outside source/production directories.')
    if reference_path.is_relative_to(output) or holds_path.is_relative_to(output) or (extra_photo and extra_photo.resolve().is_relative_to(output)):raise ValueError('Fixture inputs cannot be inside output.')
    if output.exists() and any(output.iterdir()):raise ValueError('Fixture output is not empty.')
    output.mkdir(parents=True,exist_ok=True)
    photo,_=load_image(reference_path);w,h=photo.size
    width,height=round(w*.56),round(h*.70)
    entries=[];truth=[]
    for row,y in enumerate([0,h-height]):
        for col,x in enumerate([0,(w-width)//2,w-width]):
            id=f'crop-{row+1}-{col+1}';name=id+'.jpg'
            roi=[x,y,x+width,y+height]
            photo.crop(roi).save(output/name,quality=96)
            entries.append({'id':id,'image':name,'description':'Derived from canonical reference; synthetic test input.'})
            truth.append({'id':id,'reference_crop':roi,'image_sha256':digest(output/name)})
    first=photo.crop([0,0,width,height])
    ImageEnhance.Brightness(first.filter(ImageFilter.GaussianBlur(2))).enhance(1.12).save(output/'blurred-bright.jpg',quality=96)
    entries.append({'id':'blurred-bright','image':'blurred-bright.jpg','description':'Derived duplicate with Gaussian blur radius 2 and brightness x1.12.'})
    truth.append({'id':'blurred-bright','reference_crop':[0,0,width,height],'image_sha256':digest(output/'blurred-bright.jpg')})
    from PIL import Image
    Image.new('RGB',(640,480),'gray').save(output/'blank.jpg')
    entries.append({'id':'blank-rejection-check','image':'blank.jpg','description':'Synthetic blank image; must be rejected.'})
    if extra_photo:
        entries.append({'id':'user-partial-baseline','image':os.path.relpath(extra_photo.resolve(),output),'description':'User-supplied partial image from the original wall photo session; not a new scan.'})
    config={'scanId':'mosaic-fixture-v1','referenceVersion':'2026-10-v4','candidateVersion':'mosaic-fixture-v1',
        'referenceImage':os.path.relpath(reference_path,output),'referenceHolds':os.path.relpath(holds_path,output),
        'inputKind':'mixed-fixture-baseline' if extra_photo else 'reference-derived-fixtures',
        'settings':{'min_coverage':.995,'cell':32,'guard_pixels':8,'normalize_exposure':True},'sources':entries}
    write_json(output/'scan.json',config)
    write_json(output/'fixture-truth.json',{'warning':'Known reference-derived crop transforms, not independent real-world landmarks.',
        'reference_sha256':digest(reference_path),'generated_sources':truth,'reference_size':[w,h]})
    return output/'scan.json'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--reference-image',type=Path,default=ROOT/'public/wall/stoneham-spraywall-canonical.jpg')
    parser.add_argument('--reference-holds',type=Path,default=ROOT/'src/data/polygons/holds.json')
    parser.add_argument('--extra-photo',type=Path)
    args=parser.parse_args()
    try:print(generate(args.output,args.reference_image,args.reference_holds,args.extra_photo))
    except (ValueError,OSError) as error:parser.exit(1,str(error)+'\n')


if __name__=='__main__':main()
