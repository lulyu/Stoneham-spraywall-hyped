import {test} from 'node:test'
import assert from 'node:assert/strict'
import {exploreRoutes, defaultExploreQuery, loadRouteRatings, readRating} from '../src/exploreRoutes.ts'
const route=(id,grade,extra={})=>({id,grade,name:id,setter:'A',holds:[],createdAt:'2026-11-14',...extra})
const ids=items=>items.map(item=>item.id)
test('grade ordering is numeric, includes VB and V10+, and unknowns stay last',()=>{
 const items=[route('ten','V10+'),route('two','V2'),route('unknown','Unknown'),route('beginner','VB'),route('one','V1')]
 assert.deepEqual(ids(exploreRoutes(items,{...defaultExploreQuery,sort:'grade-asc'},new Map())),['beginner','one','two','ten','unknown'])
 assert.deepEqual(ids(exploreRoutes(items,{...defaultExploreQuery,sort:'grade-desc'},new Map())),['ten','two','one','beginner','unknown'])
 assert.equal(items[0].id,'ten')
})
test('grade and validity filters combine and default includes outdated routes',()=>{
 const items=[route('valid','V2'),route('old','V2',{outdated:true}),route('other','V3')]
 assert.equal(exploreRoutes(items,defaultExploreQuery,new Map()).length,3)
 assert.deepEqual(ids(exploreRoutes(items,{...defaultExploreQuery,grade:'V2',validOnly:true},new Map())),['valid'])
 assert.deepEqual(exploreRoutes(items,{...defaultExploreQuery,grade:'V7'},new Map()),[])
})
test('stars use average then vote count; unrated/unavailable are last in both directions',()=>{
 const items=['none','lower','tie','top','unknown'].map(id=>route(id,'V2'))
 const ratings=new Map([['none',{ratingAverage:null,ratingCount:0}],['lower',{ratingAverage:2,ratingCount:10}],['tie',{ratingAverage:5,ratingCount:1}],['top',{ratingAverage:5,ratingCount:4}]])
 assert.deepEqual(ids(exploreRoutes(items,{...defaultExploreQuery,sort:'stars-desc'},ratings)),['top','tie','lower','none','unknown'])
 assert.deepEqual(ids(exploreRoutes(items,{...defaultExploreQuery,sort:'stars-asc'},ratings)),['lower','top','tie','none','unknown'])
})
test('newest uses creation date with deterministic ties and rejects malformed rating summaries',()=>{
 assert.deepEqual(ids(exploreRoutes([route('old','V2',{createdAt:'2025-01-01'}),route('z','V2'),route('a','V2')],defaultExploreQuery,new Map())),['a','z','old'])
 for(const value of [null,{}, {ratingAverage:0,ratingCount:1},{ratingAverage:5,ratingCount:-1},{ratingAverage:null,ratingCount:2},{ratingAverage:Infinity,ratingCount:1}])assert.equal(readRating(value),undefined)
 assert.deepEqual(readRating({ratingAverage:null,ratingCount:0}),{ratingAverage:null,ratingCount:0})
})
test('rating reads are public, bounded and isolated from individual failures',async()=>{
 let active=0,peak=0
 const controller=new AbortController()
 const result=await loadRouteRatings('https://example.com/',Array.from({length:10},(_,i)=>String(i)),controller.signal,async(url,options)=>{
  assert(!options.headers);assert(options.signal);active++;peak=Math.max(peak,active)
  await new Promise(resolve=>setTimeout(resolve,2));active--
  if(String(url).includes('/2/'))return new Response('unavailable',{status:503})
  return new Response(JSON.stringify({ratingAverage:4,ratingCount:3}))
 })
 assert.equal(result.ratings.size,9);assert.equal(result.failed,1);assert(peak<=4)
 controller.abort();let calls=0
 await loadRouteRatings('https://example.com',['remaining'],controller.signal,async()=>{calls++;throw Error()})
 assert.equal(calls,0)
})
