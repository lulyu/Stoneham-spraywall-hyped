"""Single-source pixels, smooth selection, guarded hold regions and honest gaps."""
import cv2
import numpy as np
from PIL import Image

from .geometry import project, resize_matrix, summary


def warp_valid(layer, size):
    return cv2.warpPerspective(layer['valid'], layer['matrix'], size, flags=cv2.INTER_NEAREST, borderValue=0)


def guard_regions(holds, size, margin):
    mask = np.zeros(size[::-1], np.uint8)
    for hold in holds:
        points = np.rint(np.asarray(hold['polygon']) * size).astype(np.int32)
        cv2.fillPoly(mask, [points], 255)
    count, core, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8, ltype=cv2.CV_16U)
    if not margin or count<=1:return count,core,stats
    # Expand toward the nearest original component, without merging neighbouring
    # holds just because their safety buffers touch. Truly touching cores stay one.
    distance,nearest=cv2.distanceTransformWithLabels(255-mask,cv2.DIST_L2,5,labelType=cv2.DIST_LABEL_CCOMP)
    mapping=np.zeros(int(nearest.max())+1,np.uint16)
    inside=mask>0
    mapping[nearest[inside]]=core[inside]
    labels=np.where(distance<=margin,mapping[nearest],0).astype(np.uint16)
    areas=np.bincount(labels.ravel().astype(np.int32),minlength=count)
    for group in range(count):
        x,y,w,h,_=stats[group]
        left,top=max(0,x-margin),max(0,y-margin)
        right,bottom=min(size[0],x+w+margin),min(size[1],y+h+margin)
        stats[group]=[left,top,right-left,bottom-top,int(areas[group])]
    return count,labels,stats


def score_field(layer, grid_size, reference_size):
    image = layer['image']
    ratio = min(1., 1400/max(image.size))
    size = tuple(max(1,round(n*ratio)) for n in image.size)
    small = np.asarray(image.resize(size, Image.Resampling.LANCZOS))
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    detail = cv2.GaussianBlur(np.abs(cv2.Laplacian(gray,cv2.CV_32F)), (0,0), 4)
    sharpness = .05 + .95*detail / (detail+8.)
    valid = cv2.resize(layer['valid'], size, interpolation=cv2.INTER_NEAREST)
    valid[[0,-1],:]=0;valid[:,[0,-1]]=0
    distance = cv2.distanceTransform(valid,cv2.DIST_L2,3)
    border = np.clip(distance/max(8,min(size)*.08),0,1)
    saturated = ((small.min(axis=2)>248)|(small.max(axis=2)<6)).astype(np.float32)
    exposure = 1.-.7*cv2.GaussianBlur(saturated,(0,0),4)
    metrics = layer['registration']['metrics']
    p95 = metrics['fit_inlier_error']['p95_px'] or 0
    confidence = min(1.,metrics.get('fit_inlier_ratio',.7)/.9)/(1+p95/layer['max_error'])
    shape = metrics['shape']
    resolution = min(1.,1/shape['local_scale_max'])
    distortion = 1/max(1.,shape['max_anisotropy'])
    score = (sharpness*border*exposure*confidence*resolution*distortion*layer['priority']).astype(np.float32)
    score[valid==0]=0
    transform = resize_matrix(reference_size,grid_size) @ layer['matrix'] @ np.linalg.inv(resize_matrix(image.size,size))
    field = cv2.warpPerspective(score,transform,grid_size,flags=cv2.INTER_LINEAR,borderValue=0)
    layer['quality']={'registration_weight':confidence,'resolution_weight':resolution,'distortion_weight':distortion,
        'median_sharpness':float(np.median(sharpness[valid>0])) if np.any(valid) else 0.,'priority':layer['priority']}
    return field


def regularized_choice(scores, iterations=3):
    """Neighbour agreement rewards coherent regions without blending RGB values."""
    valid = scores>0
    labels = np.argmax(scores,axis=0)
    labels[np.max(scores,axis=0)<=0]=-1
    strength = float(np.percentile(scores[scores>0],70))*.2 if np.any(scores>0) else 0
    for _ in range(iterations):
        utilities=[]
        for i,field in enumerate(scores):
            neighbours=cv2.blur((labels==i).astype(np.float32),(3,3))
            utilities.append(np.where(valid[i],field+strength*neighbours,-1e6))
        labels=np.argmax(utilities,axis=0)
        labels[~np.any(valid,axis=0)]=-1
    return labels


def overlap_evidence(a,b,max_error):
    def points(layer):
        if '_overlap_points' in layer:return layer['_overlap_points']
        pairs={}
        for item in layer['registration']['correspondences']:
            if item['fit_inlier'] or (item['held_out'] and item['error_full_reference_px']<=layer['max_error']):
                key=tuple(round(v,4) for v in item['reference'])
                pairs[key]=project([item['source']],layer['matrix'])[0]
        layer['_overlap_points']=pairs
        return pairs
    first,second=points(a),points(b)
    shared=sorted(first.keys()&second.keys())
    errors=np.array([np.linalg.norm(first[k]-second[k]) for k in shared])
    status='consistent' if len(errors)>=12 and np.percentile(errors,95)<=max_error else 'misaligned' if len(errors)>=12 else 'unverified'
    return {'sources':[a['id'],b['id']],'status':status,'shared_correspondences':len(errors),
        'error_full_reference_px':summary(errors),
        'note':'Shared-reference descriptor consistency, not independent scene validation.'}


def compose(layers, reference, holds, output, cell=32, margin=8, normalize=True, overlap_error=10.):
    size=reference.size;w,h=size
    grid=(max(1,(w+cell-1)//cell),max(1,(h+cell-1)//cell))
    group_count,guards,stats=guard_regions(holds,size,margin)
    guard_small=cv2.resize(guards,grid,interpolation=cv2.INTER_NEAREST)
    ref_small=np.asarray(reference.resize(grid,Image.Resampling.LANCZOS)).astype(float)
    guard_pixels=guards>0
    fields=[];group_scores=[];counts=np.zeros((h,w),np.uint16);valid_grids=[]
    for layer in layers:
        valid=warp_valid(layer,size)
        Image.fromarray(valid).save(output/'sources'/f"{layer['code']:03d}-coverage.png")
        counts+=(valid>0).astype(np.uint16)
        visible_groups=np.bincount(guards[guard_pixels&(valid>0)].astype(np.int32),minlength=group_count)
        eligible=visible_groups==stats[:,cv2.CC_STAT_AREA]
        eligible[0]=False
        field=score_field(layer,grid,size)
        valid_small=cv2.resize(valid,grid,interpolation=cv2.INTER_NEAREST)>0
        valid_grids.append(valid_small)
        field[~valid_small]=0
        fields.append(field)
        scores=np.zeros(group_count,float)
        for group in np.flatnonzero(eligible):
            samples=field[guard_small==group]
            if samples.size:scores[group]=float(samples.mean())
            else:
                x,y,bw,bh,_=stats[group]
                gx=min(grid[0]-1,int((x+bw/2)*grid[0]/w));gy=min(grid[1]-1,int((y+bh/2)*grid[1]/h))
                scores[group]=float(field[gy,gx])
        scores[eligible]=np.maximum(scores[eligible],1e-8)
        group_scores.append(scores)
        transform=resize_matrix(size,grid)@layer['matrix']
        observed=cv2.warpPerspective(np.asarray(layer['image']),transform,grid,flags=cv2.INTER_LINEAR,borderValue=0).astype(float)
        background=valid_small&(guard_small==0)&(ref_small.min(axis=2)>20)&(observed.min(axis=2)>20)
        gains=np.ones(3)
        if normalize and np.count_nonzero(background)>=50:
            gains=np.clip(np.median(ref_small[background],axis=0)/np.maximum(1,np.median(observed[background],axis=0)),.85,1.18)
        layer['exposure_gain_rgb']=gains.tolist()
    fields=np.asarray(fields)
    choice=regularized_choice(fields)
    codes=np.array([0]+[l['code'] for l in layers],np.uint16)
    desired=cv2.resize(codes[choice+1],size,interpolation=cv2.INTER_NEAREST)
    group_scores=np.asarray(group_scores)
    guarded_choices=[];unprotected=[]
    for group in range(1,group_count):
        if group_scores[:,group].max()>0:
            winner=int(np.argmax(group_scores[:,group]));code=layers[winner]['code']
            x,y,bw,bh,_=stats[group];region=guards[y:y+bh,x:x+bw]==group
            desired[y:y+bh,x:x+bw][region]=code
            guarded_choices.append({'group':group,'source_code':code,'pixel_count':int(stats[group,cv2.CC_STAT_AREA])})
        else:unprotected.append(group)
    canvas=np.zeros((h,w,3),np.uint8);source_index=np.zeros((h,w),np.uint16)
    primary=np.zeros((h,w),bool);best=np.full((h,w),-1,np.float32)
    for i,layer in enumerate(layers):
        valid=warp_valid(layer,size)>0
        field=cv2.resize(fields[i],size,interpolation=cv2.INTER_LINEAR)
        warped=cv2.warpPerspective(np.asarray(layer['image']),layer['matrix'],size,flags=cv2.INTER_LINEAR,borderValue=0)
        gains=np.array(layer['exposure_gain_rgb'])
        # Channel-at-a-time avoids allocating a full float64 RGB wall.
        for channel in range(3):warped[:,:,channel]=np.clip(np.rint(warped[:,:,channel]*gains[channel]),0,255).astype(np.uint8)
        fallback=(~primary)&valid&(field>best)
        canvas[fallback]=warped[fallback];source_index[fallback]=layer['code'];best[fallback]=field[fallback]
        selected=(desired==layer['code'])&valid
        canvas[selected]=warped[selected];source_index[selected]=layer['code'];primary[selected]=True
        layer['selected_pixel_count']=int(np.count_nonzero(source_index==layer['code']))
    # Counts must reflect final selection, after later sources replace early fallbacks.
    for layer in layers:layer['selected_pixel_count']=int(np.count_nonzero(source_index==layer['code']))
    coverage=np.where(counts>0,255,0).astype(np.uint8)
    assert np.array_equal(source_index>0,counts>0),'Every observed pixel needs exactly one source.'
    risk_grid=np.zeros(grid[::-1],np.uint8);overlaps=[]
    for i,a in enumerate(layers):
        for j in range(i+1,len(layers)):
            overlap=valid_grids[i]&valid_grids[j]
            if np.count_nonzero(overlap)<4:continue
            evidence=overlap_evidence(a,layers[j],overlap_error);overlaps.append(evidence)
            if evidence['status']!='consistent':risk_grid[overlap]|=2 if evidence['status']=='unverified' else 4
    uncertainty=cv2.resize(risk_grid,size,interpolation=cv2.INTER_NEAREST)
    uncertainty[coverage==0]=16
    high=cv2.dilate(source_index,np.ones((5,5),np.uint8));low=cv2.erode(source_index,np.ones((5,5),np.uint8))
    seams=(high!=low)&(low>0)
    uncertainty[seams]|=1
    unresolved=[]
    for group in unprotected:
        x,y,bw,bh,_=stats[group];region=guards[y:y+bh,x:x+bw]==group
        values=np.unique(source_index[y:y+bh,x:x+bw][region]);values=values[values>0]
        if len(values)>1:
            uncertainty[y:y+bh,x:x+bw][region]|=8
            unresolved.append({'group':group,'source_codes':values.tolist(),'reason':'no-single-source-covers-protected-region'})
    return canvas,coverage,source_index,counts,uncertainty,{'overlaps':overlaps,'guarded_regions':guarded_choices,
        'unresolved_hold_regions':unresolved,'seam_pixel_count':int(np.count_nonzero(seams))}
