import {randomUUID} from 'node:crypto'
import {GetCommand,ScanCommand} from '@aws-sdk/lib-dynamodb'
import {client,tableName} from './storage'
import {accessKey} from './guardrails'
import {commit,getSummary,isConflict,summaryWrite} from './summaries'
import {rowWrite} from './community'
import {ApiError} from './walls'
const read=async(Key:{pk:string;sk:string})=>(await client.send(new GetCommand({TableName:tableName,Key,ConsistentRead:true}))).Item
function audit(actor:string,target:string,action:string,reason:string){
 const now=new Date().toISOString(),id=randomUUID()
 return {Put:{TableName:tableName,Item:{pk:'MODERATION#'+target,sk:now+'#'+id,entityType:'moderation-audit',actor,target,action,reason,createdAt:now},ConditionExpression:'attribute_not_exists(pk)'}}
}
export function moderationInput(input:unknown,field:'hidden'|'banned'){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'Invalid moderation request')
 const body=input as Record<string,unknown>
 if(Object.keys(body).some(k=>k!==field&&k!=='reason')||typeof body[field]!=='boolean'||typeof body.reason!=='string'||body.reason.trim().length>300||!body.reason.trim())throw new ApiError(400,'A decision and reason (1–300 characters) are required')
 return {value:body[field] as boolean,reason:body.reason.trim()}
}
export async function setAccess(actor:string,userId:string,banned:boolean,reason:string){
 if(actor===userId)throw new ApiError(400,'You cannot suspend your own account')
 if(!userId||userId.length>128)throw new ApiError(400,'Invalid account ID')
 const key=accessKey(userId)
 for(let attempt=0;attempt<6;attempt++){
  const previous=await read(key)
  if(previous?.banned===banned)return {userId,banned}
  const next={...key,entityType:'account-access',userId,banned,reason,updatedAt:new Date().toISOString(),updatedBy:actor,revision:(previous?.revision??0)+1}
  const write=previous?rowWrite(previous,next):{Put:{TableName:tableName,Item:next,ConditionExpression:'attribute_not_exists(pk)'}}
  try{await commit([write,audit(actor,userId,banned?'ban':'unban',reason)]);return {userId,banned}}
  catch(e){if(!isConflict(e))throw e}
 }
 throw new ApiError(409,'Account changed; please retry.')
}
export async function setVisibility(actor:string,problemId:string,commentId:string|undefined,hidden:boolean,reason:string){
 const key={pk:'PROBLEM#'+problemId,sk:commentId?'COMMENT#'+commentId:'META'}
 for(let attempt=0;attempt<6;attempt++){
  const previous=await read(key)
  if(!previous||previous.deleted)throw new ApiError(404,'Content not found')
  if(Boolean(previous.hidden)===hidden)return {hidden}
  const next={...previous,hidden,revision:(previous.revision??0)+1}
  const summary=commentId?await getSummary(problemId):undefined
  try{await commit([rowWrite(previous,next),...(summary?[summaryWrite(summary,{comments:hidden?-1:1})]:[]),audit(actor,problemId+(commentId?'/'+commentId:''),hidden?'hide':'restore',reason)]);return {hidden}}
  catch(e){if(!isConflict(e))throw e}
 }
 throw new ApiError(409,'Content changed; please retry.')
}
export async function listModeration(kind:string,after?:string){
 if(!['routes','comments','users'].includes(kind))throw new ApiError(400,'Choose routes, comments or users')
 let start
 if(after)try{
  if(after.length>4096)throw Error()
  const parsed=JSON.parse(Buffer.from(after,'base64url').toString('utf8'))
  if(parsed.kind!==kind||!parsed.key||Object.keys(parsed.key).length!==2||!['pk','sk'].every(k=>typeof parsed.key[k]==='string'))throw Error()
  start=parsed.key
 }catch{throw new ApiError(400,'Invalid moderation cursor')}
 const page=await client.send(new ScanCommand({TableName:tableName,Limit:50,ExclusiveStartKey:start,FilterExpression:'entityType = :type',ExpressionAttributeValues:{':type':{routes:'problem',comments:'comment',users:'account-access'}[kind]}}))
 // Base-table consistent hydration prevents a stale scan from leaking deleted text.
 const records=await Promise.all((page.Items??[]).map(r=>read({pk:r.pk,sk:r.sk})))
 const items=records.filter(r=>r&&!r.deleted).map(r=>kind==='routes'?{id:r!.id,name:r!.name,userId:r!.ownerId,hidden:Boolean(r!.hidden)}:kind==='comments'?{id:r!.id,problemId:r!.pk.slice(8),text:r!.text,author:r!.author,userId:r!.userId,hidden:Boolean(r!.hidden)}:{userId:r!.userId,banned:Boolean(r!.banned),reason:r!.reason})
 return {items,...(page.LastEvaluatedKey?{nextCursor:Buffer.from(JSON.stringify({kind,key:page.LastEvaluatedKey})).toString('base64url')}:{})}
}
