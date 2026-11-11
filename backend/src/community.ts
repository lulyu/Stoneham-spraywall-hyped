import { randomUUID } from 'node:crypto'
import { GetCommand, PutCommand, QueryCommand, UpdateCommand, paginateQuery } from '@aws-sdk/lib-dynamodb'
import { client, tableName, getProfile, getCommentCount } from './db'
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
export async function myActivity(userId: string, problemId: string) {
  const [send, rating] = await Promise.all([get(sendKey(userId, problemId)), get(ratingKey(userId, problemId))])
  const commentIds: string[] = []
  for await (const part of paginateQuery({ client }, {
    TableName: tableName, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
    FilterExpression: 'userId = :user AND attribute_not_exists(deleted)',
    ExpressionAttributeValues: { ':pk': problemKey(problemId), ':prefix': 'COMMENT#', ':user': userId },
    ProjectionExpression: 'id', ConsistentRead: true,
  })) for (const row of part.Items ?? []) commentIds.push(row.id)
  return { sent: Boolean(send), sentAt: send?.sentAt, rating: rating?.score ?? null, commentIds }
}
export async function rate(userId: string, problemId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'rating body must be an object')
  const body = input as Record<string, unknown>
  if (Object.keys(body).some((k) => k !== 'score') || !Number.isInteger(body.score) ||
    (body.score as number) < 1 || (body.score as number) > 5) throw new ApiError(400, 'score must be an integer from 1 to 5')
  await client.send(new PutCommand({ TableName: tableName, Item: {
    ...ratingKey(userId, problemId), entityType: 'rating', score: body.score, updatedAt: new Date().toISOString(),
  } }))
  return { score: body.score }
}
export async function addComment(userId: string, problemId: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'comment body must be an object')
  const body = input as Record<string, unknown>
  if (Object.keys(body).some((k) => !['text', 'requestId'].includes(k)) ||
    typeof body.text !== 'string' || !body.text.trim() || body.text.trim().length > 1000) throw new ApiError(400, 'comment must contain 1–1000 characters')
  const id = body.requestId ?? randomUUID()
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) throw new ApiError(400, 'requestId must be a UUID v4')
  const profile = await getProfile(userId)
  const createdAt = new Date().toISOString()
  const added = await createOnce({
    pk: problemKey(problemId), sk: 'COMMENT#' + id, id, userId, entityType: 'comment',
    text: body.text.trim(), author: profile.displayName || 'Climber', createdAt,
    gsi1pk: problemKey(problemId) + '#COMMENTS', gsi1sk: createdAt + '#' + id,
  })
  return {...commentView(added), commentCount: await getCommentCount(problemId)}
}
export async function community(problemId: string, after?: string) {
  const comments = await page(problemKey(problemId) + '#COMMENTS', problemKey(problemId), 'COMMENT#', after)
  let count = 0, total = 0
  for await (const part of paginateQuery({ client }, {
    TableName: tableName, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
    ExpressionAttributeValues: { ':pk': problemKey(problemId), ':prefix': 'RATING#' },
    ProjectionExpression: '#score', ExpressionAttributeNames: { '#score': 'score' }, ConsistentRead: true,
  })) {
    for (const r of part.Items ?? []) { count++; total += r.score }
  }
  return { ratingAverage: count ? total / count : null, ratingCount: count, commentCount: await getCommentCount(problemId), comments: comments.rows.filter((row) => !row.deleted).map(commentView), nextCursor: comments.nextCursor }
}

export async function changeComment(userId: string, problemId: string, id: string, input?: unknown) {
  const Key = { pk: problemKey(problemId), sk: 'COMMENT#' + id }
  const existing = await get(Key)
  if (!existing) throw new ApiError(404, 'comment not found')
  if (existing.userId !== userId) throw new ApiError(403, 'Only the comment author can edit or delete this comment')
  const deleting = input === undefined
  if (existing.deleted) {
    if (deleting) return { deleted: true, commentCount: await getCommentCount(problemId) }
    throw new ApiError(404, 'comment not found')
  }
  let text = ''
  if (!deleting) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'comment body must be an object')
    const body = input as Record<string, unknown>
    if (Object.keys(body).length !== 1 || typeof body.text !== 'string' || !body.text.trim() || body.text.trim().length > 1000)
      throw new ApiError(400, 'comment must contain 1–1000 characters; only text can be changed')
    text = body.text.trim()
  }
  try {
    const result = await client.send(new UpdateCommand({
      TableName: tableName, Key,
      // Author checks are repeated atomically so an edit cannot resurrect a deleted comment.
      ConditionExpression: 'userId = :user AND attribute_not_exists(deleted)',
      UpdateExpression: deleting
        ? 'SET deleted = :deleted REMOVE #text, author, gsi1pk, gsi1sk'
        : 'SET #text = :text, updatedAt = :now',
      ExpressionAttributeNames: { '#text': 'text' },
      ExpressionAttributeValues: { ':user': userId, ...(deleting ? { ':deleted': true } : { ':text': text, ':now': new Date().toISOString() }) },
      ReturnValues: 'ALL_NEW',
    }))
    const commentCount = await getCommentCount(problemId)
    return deleting ? { deleted: true, commentCount } : {...commentView(result.Attributes!), commentCount}
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') {
      const latest = await get(Key)
      if (deleting && latest?.deleted && latest.userId === userId) return { deleted: true, commentCount: await getCommentCount(problemId) }
      throw new ApiError(409, 'Comment changed or was deleted. Refresh and retry.')
    }
    throw e
  }
}

export async function commentAuthorProfile(problemId: string, commentId: string) {
  const comment = await get({ pk: problemKey(problemId), sk: 'COMMENT#' + commentId })
  if (!comment || comment.deleted || typeof comment.userId !== 'string' || !comment.userId)
    throw new ApiError(404, 'Comment author profile is unavailable')
  const profile = await getProfile(comment.userId)
  return { displayName: profile.displayName || comment.author || 'Climber', bio: profile.bio }
}
