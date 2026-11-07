import { reviewKey, resumeReview, saveReview, validateProgress } from './wallReview'
import type { WallReview } from './wallReview'

export const REVIEW_DATABASE = 'stoneham-wall-reviews'
export const REVIEW_STORE = 'checkpoints'
type StoredReview = { review: WallReview; legacyFingerprint: string | null }
type LegacyStorage = Pick<Storage, 'getItem'>

async function fingerprint(raw: string | null) {
  if(raw===null)return null
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('')
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve,reject)=> {
    if(!globalThis.indexedDB){reject(new Error('Review storage is unavailable. Use a current browser that allows IndexedDB.'));return}
    const request=indexedDB.open(REVIEW_DATABASE,1)
    request.onupgradeneeded=()=>request.result.createObjectStore(REVIEW_STORE)
    request.onerror=()=>reject(request.error)
    request.onblocked=()=>reject(new Error('Close older review tabs, then reopen this scan to enable review storage.'))
    request.onsuccess=()=>resolve(request.result)
  })
}

async function transaction<T>(key:string, legacy:LegacyStorage, raw:string|null,
  update:(stored:StoredReview|undefined)=>{record?:StoredReview;value:T}):Promise<T> {
  const db=await database()
  try {
    return await new Promise<T>((resolve,reject)=> {
      const tx=db.transaction(REVIEW_STORE,'readwrite'), store=tx.objectStore(REVIEW_STORE)
      let value:T, problem:unknown
      tx.oncomplete=()=>resolve(value)
      tx.onabort=()=>reject(problem??tx.error??new Error('Review save was interrupted. No decisions were saved.'))
      const request=store.get(key)
      request.onsuccess=()=> {
        try {
          if(legacy.getItem(key)!==raw)throw new Error('Another tab changed this scan. Reopen it before continuing.')
          const result=update(request.result)
          value=result.value
          if(result.record)store.put(result.record,key)
        } catch(error){problem=error;tx.abort()}
      }
    })
  } finally {db.close()}
}

/** Migrate without deleting or rewriting any existing localStorage checkpoint. */
export async function loadStoredReview(baseline:WallReview, initial:WallReview, legacy:LegacyStorage=localStorage) {
  const key=reviewKey(baseline.session), raw=legacy.getItem(key), hash=await fingerprint(raw)
  return transaction(key,legacy,raw,stored=> {
    if((stored||raw!==null) && initial.reviewRevision>0)
      throw new Error('This folder includes a checkpoint and this browser already has progress. Open the original folder, then use Resume progress explicitly.')
    let review=stored?validateProgress(stored.review,baseline):raw!==null?validateProgress(JSON.parse(raw),baseline):initial
    if(stored && stored.legacyFingerprint===hash)return {value:review}
    if(stored && stored.legacyFingerprint!==hash) {
      if(raw===null)throw new Error('An older tab changed the saved checkpoint. Keep your exports and reopen the matching scan.')
      // An older build may still write localStorage. Only accept a validated,
      // forward continuation; never overwrite a conflicting IndexedDB history.
      review=resumeReview(JSON.parse(raw),review,baseline)
    }
    return {record:{review,legacyFingerprint:hash},value:review}
  })
}

/** Compare and write within one IDB transaction; resolve only after commit. */
export async function saveStoredReview(current:WallReview, next:WallReview, legacy:LegacyStorage=localStorage) {
  const key=reviewKey(current.session), raw=legacy.getItem(key), hash=await fingerprint(raw)
  return transaction(key,legacy,raw,stored=> {
    if(stored && stored.legacyFingerprint!==hash)
      throw new Error('An older tab changed this scan. Export its progress and reopen this scan before saving.')
    // Reuse the existing stale-tab and missing-checkpoint validation. The write
    // here is staged in memory; the actual persistent write is the IDB put above.
    saveReview({getItem:()=>stored?JSON.stringify(stored.review):raw,setItem:()=>{}},current,next)
    return {record:{review:next,legacyFingerprint:hash},value:undefined}
  })
}
