import {GetCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb'
import {client,tableName} from './storage'
import {ApiError} from './walls'
import type {requireIdentity} from './auth'
export const accessKey=(id:string)=>({pk:'USER#'+id,sk:'ACCESS'})
export class RateLimitError extends ApiError {
 constructor(public readonly retryAfter:number){super(429,`Too many changes. Try again in ${retryAfter} seconds.`)}
}
export const rules:Record<string,{seconds:number;max:number}[]>={
 write:[{seconds:60,max:60}],create:[{seconds:60,max:5},{seconds:86400,max:30}],
 comment:[{seconds:60,max:5},{seconds:86400,max:100}],rating:[{seconds:60,max:30}],
 edit:[{seconds:60,max:30}],profile:[{seconds:60,max:10}],send:[{seconds:60,max:60}],admin:[{seconds:60,max:30}],
}
export function actionFor(method:string,path:string){
 if(path.startsWith('/v1/admin/'))return 'admin'
 if(method==='POST'&&(path.endsWith('/problems')||path.endsWith('/upgrade')))return 'create'
 if(method==='POST'&&path.endsWith('/comments'))return 'comment'
 if(path.endsWith('/rating'))return 'rating'
 if(path.endsWith('/profile'))return 'profile'
 if(path.endsWith('/sends'))return 'send'
 return 'edit'
}
export async function guardWrite(identity:ReturnType<typeof requireIdentity>,method:string,path:string,now=Date.now()){
 const access=(await client.send(new GetCommand({TableName:tableName,Key:accessKey(identity.userId),ConsistentRead:true}))).Item
 if(access?.banned)throw new ApiError(403,'This account is suspended from making changes.')
 const action=actionFor(method,path),windows=[...rules.write.map(r=>({...r,action:'write'})),...rules[action].map(r=>({...r,action}))]
 const reset=windows.map(r=>(Math.floor(now/1000/r.seconds)+1)*r.seconds)
 try {
  await client.send(new TransactWriteCommand({TransactItems:windows.map((r,i)=>({Update:{TableName:tableName,Key:{pk:'QUOTA#'+identity.userId,sk:r.action+'#'+r.seconds+'#'+Math.floor(now/1000/r.seconds)},UpdateExpression:'SET expiresAt = :ttl ADD #count :one',ConditionExpression:'attribute_not_exists(#count) OR #count < :limit',ExpressionAttributeNames:{'#count':'count'},ExpressionAttributeValues:{':ttl':reset[i]+86400,':one':1,':limit':r.max}}}))}))
 }catch(error){
  const e=error as {name?:string;CancellationReasons?:{Code?:string}[]}
  if(e.name==='TransactionCanceledException'&&e.CancellationReasons?.some(r=>r.Code==='ConditionalCheckFailed')){
   const blocked=reset.filter((_,i)=>e.CancellationReasons?.[i]?.Code==='ConditionalCheckFailed')
   throw new RateLimitError(Math.max(1,...blocked.map(t=>Math.ceil(t-now/1000))))
  }
  throw error
 }
}
