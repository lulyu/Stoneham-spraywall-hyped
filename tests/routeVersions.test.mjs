import {test} from 'node:test'
import assert from 'node:assert/strict'
import {latestRouteVersions,routeFamilyId} from '../src/routeVersionGroups.ts'
import {exploreRoutes,defaultExploreQuery} from '../src/exploreRoutes.ts'
const route=(id,extra={})=>({id,name:'Same name',grade:'V3',setter:'Climber',holds:[],createdAt:'2026-11-01',...extra})
test('only explicit upgrade lineage groups versions; names and edits never group unrelated routes',()=>{
 const old=route('root'),upgrade=route('v2',{upgradeRootId:'root',upgradedFromId:'root',upgradeNumber:2,name:'Custom name'}),unrelated=route('other')
 assert.deepEqual(latestRouteVersions([old,upgrade,unrelated]).map(r=>r.id),['v2','other'])
 assert.equal(routeFamilyId(unrelated),'other')
 assert.equal(latestRouteVersions([old,{...old,revision:4,name:'Renamed'}]).length,1)
})
test('numbering selects V10 numerically, tolerates branches and duplicate pages, and falls back after removal',()=>{
 const old=route('root'),v2=route('v2',{upgradeRootId:'root',upgradeNumber:2}),v10=route('v10',{upgradeRootId:'root',upgradedFromId:'root',upgradeNumber:10})
 assert.deepEqual(latestRouteVersions([v10,v2,old,v2,old]).map(r=>r.id),['v10'])
 assert.deepEqual(latestRouteVersions([old,v2,{...v10,hidden:true}]).map(r=>r.id),['v2'])
})
test('filters operate on the latest version and cannot resurrect old grades or outdated versions',()=>{
 const old=route('root',{grade:'V2',outdated:true}),fresh=route('v2',{grade:'V5',upgradeRootId:'root',upgradeNumber:2,outdated:false})
 const items=[old,fresh,route('other',{grade:'V2'})]
 assert.deepEqual(exploreRoutes(items,{...defaultExploreQuery,grade:'V2'},new Map()).map(r=>r.id),['other'])
 assert.deepEqual(exploreRoutes(items,{...defaultExploreQuery,validOnly:true},new Map()).map(r=>r.id),['other','v2'])
})
