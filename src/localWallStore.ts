import { STORAGE_KEY, readLocalProblems, ProblemStoreError } from './problemStore'
import type { ProblemStore, ProblemInput, UpgradeDraft } from './problemStore'
import { wallVersions, DEFAULT_WALL_VERSION, LEGACY_WALL_VERSION } from './wallVersions'
import { routeCompatibility, latestWall, nextUpgradeName } from './routeLifecycle'
import type { Problem } from './types'

export const localWallKey=(version:string)=>version===LEGACY_WALL_VERSION?STORAGE_KEY:STORAGE_KEY+':wall:'+version
export function createLocalWallStore(storage:Pick<Storage,'getItem'|'setItem'>):ProblemStore {
  const validIds=new Set(wallVersions.flatMap(wall=>wall.holds.map(hold=>hold.id)))
  const read=()=> {
    const seen=new Set<string>()
    return wallVersions.flatMap(wall=>readLocalProblems(storage,validIds,localWallKey(wall.id)).map(p=>({...p,wallVersionId:p.wallVersionId??wall.id})))
      .filter(p=>{if(seen.has(p.id))return false;seen.add(p.id);return true}).map(routeCompatibility)
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
  }
  const get=(id:string)=>{const p=read().find(p=>p.id===id);if(!p)throw new ProblemStoreError(404,'This problem no longer exists.');return p}
  const write=(p:Problem)=> {
    const key=localWallKey(p.wallVersionId??LEGACY_WALL_VERSION)
    const rows=readLocalProblems(storage,validIds,key)
    try{storage.setItem(key,JSON.stringify([p,...rows.filter(row=>row.id!==p.id)]))}
    catch{throw new Error('Could not save on this device. Your draft is still here.')}
    return p
  }
  const lock=<T,>(action:()=>T):Promise<T>=>navigator.locks?navigator.locks.request('stoneham-local-routes',action):Promise.resolve().then(action)
  const make=(input:ProblemInput):Problem=>routeCompatibility({...input,id:crypto.randomUUID?.()??'route-'+Date.now()+'-'+Math.random(),wallVersionId:DEFAULT_WALL_VERSION,createdAt:new Date().toISOString(),revision:1})
  const draft=(source:Problem):UpgradeDraft=> {
    if(!source.outdated)throw new Error('This route already supports the latest wall')
    const root=source.upgradeRootId??source.id,base=source.upgradeBaseName??source.name
    const number=Math.max(1,...read().filter(p=>(p.upgradeRootId??p.id)===root).map(p=>p.upgradeNumber??1))+1
    const ids=new Set(latestWall.holds.map(h=>h.id))
    return {sourceId:source.id,sourceRevision:source.revision??1,targetWallVersionId:DEFAULT_WALL_VERSION,name:nextUpgradeName(base,number),
      grade:source.grade,setter:source.setter,notes:source.notes,holds:source.holds.filter(h=>ids.has(h.holdId)),removedHoldIds:source.missingHoldIds??[]}
  }
  return {shared:false,async list(){return {items:read()}},async get(id){return get(id)},
    create:input=>lock(()=>write(make(input))),
    update:(existing,input)=>lock(()=>{const p=get(existing.id);if(p.revision!==existing.revision)throw new ProblemStoreError(409,'This problem changed.');return write(routeCompatibility({...p,...input,revision:(p.revision??1)+1,updatedAt:new Date().toISOString()}))}),
    async getUpgradeDraft(id){return draft(get(id))},
    upgrade:(seed,input,automaticName)=>lock(()=> {
      const source=get(seed.sourceId)
      if((source.revision??1)!==seed.sourceRevision)throw new ProblemStoreError(409,'The source route changed; reopen Upgrade')
      const current=draft(source),root=source.upgradeRootId??source.id,base=source.upgradeBaseName??source.name
      const number=Math.max(1,...read().filter(p=>(p.upgradeRootId??p.id)===root).map(p=>p.upgradeNumber??1))+1
      return write({...make({...input,name:automaticName?current.name:input.name}),upgradedFromId:source.id,upgradeRootId:root,upgradeBaseName:base,upgradeNumber:number})
    }),
  }
}
