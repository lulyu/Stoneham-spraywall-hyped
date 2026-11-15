import { randomUUID } from 'node:crypto'
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { getProfile, getCommentCount } from './db'
import {client,tableName} from './storage'
import {getSummary,summaryWrite,commit,isConflict} from './summaries'
import { ApiError } from './walls'
import type { Problem } from './model'

type Item = Record<string, any>
const problemKey = (id: string) => 'PROBLEM#' + id
const userKey = (id: string) => 'USER#' + id
const sendKey = (userId: string, id: string) => ({ pk: userKey(userId), sk: 'SEND#' + id })
const ratingKey = (userId: string, id: string) => ({ pk: problemKey(id), sk: 'RATING#' + userId })
const commentView = (r: Item) => ({ id: r.id, text: r.text, author: r.author, hasAuthorProfile: typeof r.userId === 'string' && Boolean(r.userId), createdAt: r.createdAt, ...(r.updatedAt ? { updatedAt: r.updatedAt } : {}) })
const sendView = (r: Item) => ({
  problemId: r.problemId, name: r.name, grade: r.grade, setter: r.setter, sentAt: r.sentAt,
})
async function get(Key: { pk: string; sk: string }) {
  return (await client.send(new GetCommand({ TableName: tableName, Key, ConsistentRead: true }))).Item
}
async function createOnce(item: Item) {
  try {
    await client.send(new PutCommand({ TableName: tableName, Item: item, ConditionExpression: 'attribute_not_exists(pk)' }))
    return item
  } catch (e) {
    if ((e as { name?: string }).name !== 'ConditionalCheckFailedException') throw e
    const previous = await get({ pk: item.pk, sk: item.sk })
    if (!previous || previous.userId !== item.userId) throw new ApiError(409, 'request id already used')
    if (previous.deleted) throw new ApiError(410, 'comment was deleted')
    return previous
  }
}
function cursor(value: string | undefined, partition: string, pk: string, prefix: string) {
  if (!value) return undefined
  try {
    if (value.length > 4096) throw new Error()
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!parsed || Object.keys(parsed).length !== 4 ||
      !['pk', 'sk', 'gsi1pk', 'gsi1sk'].every((k) => typeof parsed[k] === 'string') ||
      parsed.gsi1pk !== partition || parsed.pk !== pk || !parsed.sk.startsWith(prefix)) throw new Error()
    return parsed
  } catch { throw new ApiError(400, 'invalid cursor') }
}
async function page(partition: string, pk: string, prefix: string, after?: string) {
  const result = await client.send(new QueryCommand({
    TableName: tableName, IndexName: 'gsi1', KeyConditionExpression: 'gsi1pk = :pk',
    ExpressionAttributeValues: { ':pk': partition }, Limit: 20, ScanIndexForward: false,
    ExclusiveStartKey: cursor(after, partition, pk, prefix),
  }))
  return { rows: result.Items ?? [], nextCursor: result.LastEvaluatedKey ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url') : undefined }
}
export async function logSend(userId: string, problem: Problem) {
  const sentAt = new Date().toISOString()
  return sendView(await createOnce({
    ...sendKey(userId, problem.id), entityType: 'send', userId, problemId: problem.id,
    name: problem.name, grade: problem.grade, setter: problem.setter, sentAt,
    gsi1pk: userKey(userId) + '#SENDS', gsi1sk: sentAt + '#' + problem.id,
  }))
}
export async function listSends(userId: string, after?: string) {
  const result = await page(userKey(userId) + '#SENDS', userKey(userId), 'SEND#', after)
  return { items: result.rows.map(sendView), nextCursor: result.nextCursor }
}
export async function myActivity(userId:string,problemId:string,requested?:string){
 const ids=requested?requested.split(','):[]
 if(ids.length>20||ids.some(id=>!/^[-a-zA-Z0-9]{1,80}$/.test(id)))throw new ApiError(400,'Request at most 20 comment IDs')
 const [send,rating,...comments]=await Promise.all([get(sendKey(userId,problemId)),get(ratingKey(userId,problemId)),...ids.map(id=>get({pk:problemKey(problemId),sk:'COMMENT#'+id}))])
 return {sent:Boolean(send),sentAt:send?.sentAt,rating:rating?.score??null,commentIds:comments.filter(r=>r?.userId===userId&&!r.deleted&&!r.hidden).map(r=>r!.id)}
}
export function rowWrite(previous:Item,next:Item){
 let condition=previous.revision===undefined?'attribute_not_exists(revision) AND attribute_exists(pk)':'revision = :revision'
 const values:Record<string,unknown>=previous.revision===undefined?{}:{':revision':previous.revision}
 if(previous.entityType==='comment'){condition+=' AND (attribute_not_exists(deleted) OR deleted = :notDeleted)';values[':notDeleted']=false}
 return {Put:{TableName:tableName,Item:next,ConditionExpression:condition,...(Object.keys(values).length?{ExpressionAttributeValues:values}:{})}}
}
export async function rate(userId: string, problemId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'rating body must be an object')
  const body = input as Record<string, unknown>
  if (Object.keys(body).some((k) => k !== 'score') || !Number.isInteger(body.score) ||
    (body.score as number) < 1 || (body.score as number) > 5) throw new ApiError(400, 'score must be an integer from 1 to 5')
  for(let attempt=0;attempt<6;attempt++){
   const [previous,summary]=await Promise.all([get(ratingKey(userId,problemId)),getSummary(problemId)])
   if(previous?.score===body.score)return {score:body.score}
   const next={...ratingKey(userId,problemId),entityType:'rating',score:body.score,updatedAt:new Date().toISOString(),revision:(previous?.revision??0)+1}
   const write=previous?rowWrite(previous,next):{Put:{TableName:tableName,Item:next,ConditionExpression:'attribute_not_exists(pk)'}}
   try{await commit([write,summaryWrite(summary,{ratings:previous?0:1,total:(body.score as number)-(previous?.score??0)})]);return {score:body.score}}
   catch(e){if(!isConflict(e))throw e}
  }
  throw new ApiError(409,'Ratings changed; please retry.')
}
export async function addComment(userId: string, problemId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'comment body must be an object')
  const body = input as Record<string, unknown>
  if (Object.keys(body).some((k) => !['text', 'requestId'].includes(k)) ||
    typeof body.text !== 'string' || !body.text.trim() || body.text.trim().length > 1000) throw new ApiError(400, 'comment must contain 1–1000 characters')
  const id = body.requestId ?? randomUUID()
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) throw new ApiError(400, 'requestId must be a UUID v4')
  for(let attempt=0;attempt<6;attempt++){
   const existing=await get({pk:problemKey(problemId),sk:'COMMENT#'+id})
   if(existing){
    if(existing.userId!==userId)throw new ApiError(409,'request id already used')
    if(existing.deleted||existing.hidden)throw new ApiError(410,'comment is unavailable')
    return {...commentView(existing),commentCount:await getCommentCount(problemId)}
   }
   const [profile,summary]=await Promise.all([getProfile(userId),getSummary(problemId)])
   const createdAt=new Date().toISOString()
   const added={pk:problemKey(problemId),sk:'COMMENT#'+id,id,userId,entityType:'comment',revision:1,text:body.text.trim(),author:profile.displayName||'Climber',createdAt,gsi1pk:problemKey(problemId)+'#COMMENTS',gsi1sk:createdAt+'#'+id}
   try{await commit([{Put:{TableName:tableName,Item:added,ConditionExpression:'attribute_not_exists(pk)'}},summaryWrite(summary,{comments:1})]);return {...commentView(added),commentCount:summary.commentCount+1}}
   catch(e){if(!isConflict(e))throw e}
  }
  throw new ApiError(409,'Comments changed; please retry.')
}
export async function community(problemId: string, after?: string) {
  const comments = await page(problemKey(problemId) + '#COMMENTS', problemKey(problemId), 'COMMENT#', after)
  const summary=await getSummary(problemId)
  // GSI entries may be stale: hydrate at most one page from the base table.
  const rows=await Promise.all(comments.rows.map(r=>get({pk:r.pk,sk:r.sk})))
  return {ratingAverage:summary.ratingCount?summary.ratingTotal/summary.ratingCount:null,ratingCount:summary.ratingCount,commentCount:summary.commentCount,comments:rows.filter((r):r is Item=>Boolean(r)&&!r!.deleted&&!r!.hidden).map(commentView),nextCursor:comments.nextCursor}
}
export async function changeComment(userId:string,problemId:string,id:string,input?:unknown){
 const Key={pk:problemKey(problemId),sk:'COMMENT#'+id},deleting=input===undefined
 let text=''
 if(!deleting){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'comment body must be an object')
  const body=input as Record<string,unknown>
  if(Object.keys(body).length!==1||typeof body.text!=='string'||!body.text.trim()||body.text.trim().length>1000)throw new ApiError(400,'comment must contain 1–1000 characters; only text can be changed')
  text=body.text.trim()
 }
 for(let attempt=0;attempt<6;attempt++){
  const previous=await get(Key)
  if(!previous)throw new ApiError(404,'comment not found')
  if(previous.userId!==userId)throw new ApiError(403,'Only the comment author can edit or delete this comment')
  if(previous.deleted){if(deleting)return {deleted:true,commentCount:await getCommentCount(problemId)};throw new ApiError(404,'comment not found')}
  if(previous.hidden&&!deleting)throw new ApiError(403,'A moderator has hidden this comment')
  const next:Item={...previous,revision:(previous.revision??0)+1}
  if(deleting){next.deleted=true;for(const field of ['text','author','gsi1pk','gsi1sk'])delete next[field]}
  else {next.text=text;next.updatedAt=new Date().toISOString()}
  const summary=deleting?await getSummary(problemId):undefined
  try{
   await commit([rowWrite(previous,next),...(summary&&!previous.hidden?[summaryWrite(summary,{comments:-1})]:[])])
   return deleting?{deleted:true,commentCount:summary!.commentCount-(previous.hidden?0:1)}:{...commentView(next),commentCount:await getCommentCount(problemId)}
  }catch(e){if(!isConflict(e))throw e;if(!deleting)throw new ApiError(409,'Comment changed or was deleted. Refresh and retry.')}
 }
 throw new ApiError(409,'Comment changed; please retry.')
}

export async function commentAuthorProfile(problemId: string, commentId: string) {
  const comment = await get({ pk: problemKey(problemId), sk: 'COMMENT#' + commentId })
  if (!comment || comment.deleted || comment.hidden || typeof comment.userId !== 'string' || !comment.userId)
    throw new ApiError(404, 'Comment author profile is unavailable')
  const profile = await getProfile(comment.userId)
  return { displayName: profile.displayName || comment.author || 'Climber', bio: profile.bio }
}
