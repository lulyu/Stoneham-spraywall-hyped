const assert=require('node:assert/strict')
const key=p=>p.pk+'|'+p.sk
const conditionError=()=>Object.assign(new Error('Conditional check failed'),{name:'ConditionalCheckFailedException'})
class Memory {
 constructor(){this.rows=new Map();this.calls=[];this.beforeTransaction=null;this.beforePut=null;this.staleIndex=null}
 put(row){this.rows.set(key(row),structuredClone(row))}
 get(pk,sk){return this.rows.get(pk+'|'+sk)}
 condition(op){
  const row=this.rows.get(key(op.Item??op.Key)),v=op.ExpressionAttributeValues??{}
  const suffix=' AND (attribute_not_exists(deleted) OR deleted = :notDeleted)'
  if(op.ConditionExpression?.endsWith(suffix)){if(row?.deleted)return false;op={...op,ConditionExpression:op.ConditionExpression.slice(0,-suffix.length)}}
  switch(op.ConditionExpression){
   case undefined:return true
   case 'attribute_not_exists(pk)':return !row
   case 'revision = :revision':return row?.revision===v[':revision']
   case 'attribute_not_exists(revision) AND attribute_exists(pk)':return !!row&&row.revision===undefined
   case 'attribute_exists(pk) AND attribute_not_exists(revision)':return !!row&&row.revision===undefined
   case 'revision = :revision AND ownerId = :owner':return row?.revision===v[':revision']&&row?.ownerId===v[':owner']
   case '#number = :previous':return row?.number===v[':previous']
   case 'attribute_not_exists(#count) OR #count < :limit':return !row||row.count<v[':limit']
   default:throw Error('Unsupported condition: '+op.ConditionExpression)
  }
 }
 apply(a){
  if(a.Put)this.put(a.Put.Item)
  if(a.Update){const p=a.Update,v=p.ExpressionAttributeValues;assert.equal(p.UpdateExpression,'SET expiresAt = :ttl ADD #count :one');const row=this.rows.get(key(p.Key));this.put({...p.Key,count:(row?.count??0)+v[':one'],expiresAt:v[':ttl']})}
 }
 async send(command){
  const p=command.input,kind=command.constructor.name;this.calls.push({kind,input:structuredClone(p)})
  if(kind==='GetCommand'){const row=this.rows.get(key(p.Key));return {Item:row&&structuredClone(row)}}
  if(kind==='PutCommand'){
   if(this.beforePut){const f=this.beforePut;this.beforePut=null;f(p)}
   if(!this.condition(p))throw conditionError();this.put(p.Item);return {}
  }
  if(kind==='TransactWriteCommand'){
   if(this.beforeTransaction){const f=this.beforeTransaction;this.beforeTransaction=null;f(p)}
   const reasons=p.TransactItems.map(a=>({Code:this.condition(a.Put??a.Update??a.ConditionCheck)?'None':'ConditionalCheckFailed'}))
   if(reasons.some(r=>r.Code!=='None'))throw Object.assign(Error('Transaction canceled'),{name:'TransactionCanceledException',CancellationReasons:reasons})
   for(const a of p.TransactItems)this.apply(a);return {}
  }
  if(kind==='QueryCommand'){
   const v=p.ExpressionAttributeValues,pk=v[':pk'];let all=[...this.rows.values()]
   if(p.IndexName){
    all=(this.staleIndex??all).filter(r=>r.gsi1pk===pk).sort((a,b)=>(a.gsi1sk??'').localeCompare(b.gsi1sk??'')*(p.ScanIndexForward===false?-1:1))
   }else all=all.filter(r=>r.pk===pk&&(!v[':prefix']||r.sk.startsWith(v[':prefix']))).sort((a,b)=>a.sk.localeCompare(b.sk))
   const start=p.ExclusiveStartKey?all.findIndex(r=>key(r)===key(p.ExclusiveStartKey))+1:0
   const items=all.slice(start,start+(p.Limit??100)),last=items.at(-1)
   return {Items:structuredClone(items),Count:items.length,...(start+items.length<all.length?{LastEvaluatedKey:{pk:last.pk,sk:last.sk,...(p.IndexName?{gsi1pk:last.gsi1pk,gsi1sk:last.gsi1sk}:{})}}:{})}
  }
  if(kind==='ScanCommand'){
   const all=[...this.rows.values()].sort((a,b)=>key(a).localeCompare(key(b))),start=p.ExclusiveStartKey?all.findIndex(r=>key(r)===key(p.ExclusiveStartKey))+1:0
   const scanned=all.slice(start,start+p.Limit),last=scanned.at(-1),v=p.ExpressionAttributeValues??{}
   const items=scanned.filter(r=>!v[':type']||r.entityType===v[':type'])
   return {Items:structuredClone(items),ScannedCount:scanned.length,...(start+scanned.length<all.length?{LastEvaluatedKey:{pk:last.pk,sk:last.sk}}:{})}
  }
  throw Error('Unexpected command '+kind)
 }
}
module.exports={Memory,key}
