import type {Problem} from './types'
export const routeFamilyId=(route:Problem)=>route.upgradeRootId??route.id
export const compareRouteVersions=(a:Problem,b:Problem)=>(b.upgradeNumber??1)-(a.upgradeNumber??1)||b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)
/** Only explicit Upgrade lineage groups routes; ordinary edits and names do not. */
export function latestRouteVersions(routes:Problem[]):Problem[]{
 const latest=new Map<string,Problem>()
 for(const route of routes){
  if(route.hidden)continue
  const root=routeFamilyId(route),previous=latest.get(root)
  if(!previous||compareRouteVersions(route,previous)<0)latest.set(root,route)
 }
 return [...latest.values()]
}
