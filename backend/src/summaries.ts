import {GetCommand, PutCommand, QueryCommand, TransactWriteCommand} from '@aws-sdk/lib-dynamodb'
import {client,tableName} from './storage'
import {ApiError} from './walls'
export type Summary={pk:string;sk:string;entityType:'community-summary';version:1;revision:number;commentCount:number;ratingCount:number;ratingTotal:number}
export const summaryKey=(id:string)=>({pk:'PROBLEM#'+id,sk:'COMMUNITY_SUMMARY'})
export const emptySummary=(id:string):Summary=>({...summaryKey(id),entityType:'community-summary',version:1,revision:1,commentCount:0,ratingCount:0,ratingTotal:0})
export const emptySummaryWrite=(id:string)=>({Put:{TableName:tableName,Item:emptySummary(id),ConditionExpression:'attribute_not_exists(pk)'}})
export async function getSummary(id:string):Promise<Summary>{
 const row=(await client.send(new GetCommand({TableName:tableName,Key:summaryKey(id),ConsistentRead:true}))).Item
 if(row?.version!==1)throw new ApiError(503,'Community totals are being prepared. Please retry shortly.')
 return row as Summary
}
export function summaryWrite(previous:Summary,delta:{comments?:number;ratings?:number;total?:number}){
 const next={...previous,revision:previous.revision+1,commentCount:previous.commentCount+(delta.comments??0),ratingCount:previous.ratingCount+(delta.ratings??0),ratingTotal:previous.ratingTotal+(delta.total??0)}
 if(next.commentCount<0||next.ratingCount<0||next.ratingTotal<0)throw Object.assign(new Error('Community summary changed; retry'),{name:'TransactionConflictException'})
 return {Put:{TableName:tableName,Item:next,ConditionExpression:'revision = :revision',ExpressionAttributeValues:{':revision':previous.revision}}}
}
export const isConflict=(error:unknown)=>{
 const e=error as {name?:string;CancellationReasons?:{Code?:string}[]}
 return e.name==='ConditionalCheckFailedException'||e.name==='TransactionConflictException'||e.name==='TransactionCanceledException'&&e.CancellationReasons?.some(r=>r.Code==='ConditionalCheckFailed'||r.Code==='TransactionConflict')
}
export async function commit(items:any[]){await client.send(new TransactWriteCommand({TransactItems:items}))}
// Explicit administrator-only migration. Never called from public reads or writes.
// Missing summaries block community writes, so a conditional initialization cannot
// race new-counter writers. Wait for old Lambda invocations to drain before rollout.
export async function initializeSummary(id:string){
 const existing=(await client.send(new GetCommand({TableName:tableName,Key:summaryKey(id),ConsistentRead:true}))).Item
 if(existing)return {initialized:false}
 const summary=emptySummary(id);let cursor:Record<string,any>|undefined;let pages=0
 do {
  const page=await client.send(new QueryCommand({TableName:tableName,KeyConditionExpression:'pk = :pk',ExpressionAttributeValues:{':pk':'PROBLEM#'+id},ConsistentRead:true,ExclusiveStartKey:cursor,Limit:100}))
  for(const row of page.Items??[]){
   if(row.entityType==='comment'&&!row.deleted&&!row.hidden)summary.commentCount++
   if(row.entityType==='rating'){summary.ratingCount++;summary.ratingTotal+=row.score}
  }
  cursor=page.LastEvaluatedKey
  if(++pages>=100&&cursor)throw new ApiError(409,'Backfill needs offline handling for this large route')
 }while(cursor)
 try{await client.send(new PutCommand({TableName:tableName,Item:summary,ConditionExpression:'attribute_not_exists(pk)'}))}
 catch(e){if(!isConflict(e))throw e;return {initialized:false}}
 return {initialized:true,commentCount:summary.commentCount,ratingCount:summary.ratingCount,ratingTotal:summary.ratingTotal}
}
