async function readInPage(revision) {
 const databases=await indexedDB.databases()
 let review
 if(databases.some(db=>db.name==='stoneham-wall-reviews')) {
  review=await new Promise((resolve,reject)=> {
   const open=indexedDB.open('stoneham-wall-reviews',1)
   open.onerror=()=>reject(open.error)
   open.onsuccess=()=> {
    const db=open.result,request=db.transaction('checkpoints').objectStore('checkpoints').getAll()
    request.onsuccess=()=>{db.close();resolve(request.result[0]?.review)}
    request.onerror=()=>{db.close();reject(request.error)}
   }
  })
 }
 if(!review) {
  const key=Object.keys(localStorage).find(key=>key.startsWith('stoneham-wall-review-v1:'))
  review=key?JSON.parse(localStorage.getItem(key)):null
 }
 return revision===null?review:review?.reviewRevision===revision
}
exports.readReviewState=page=>page.evaluate(readInPage,null)
exports.waitForReviewRevision=(page,revision)=>page.waitForFunction(readInPage,revision)
