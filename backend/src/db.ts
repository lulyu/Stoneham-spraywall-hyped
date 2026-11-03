import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { Problem, UserProfile, ProblemItem, UpdateProblemInput } from './model'
import { ApiError } from './walls'

export const tableName = process.env.DYNAMODB_TABLE
if (!tableName) throw new Error('DYNAMODB_TABLE is required')

export const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
})

const problemPk = (problemId: string) => `PROBLEM#${problemId}`
const wallVersionPk = (gymId: string, wallId: string, wallVersionId: string) =>
  `GYM#${gymId}#WALL#${wallId}#VERSION#${wallVersionId}`

function toProblem(item: ProblemItem): Problem {
  const { pk: _pk, sk: _sk, gsi1pk: _gsi1pk, gsi1sk: _gsi1sk, entityType: _entityType, ...problem } = item
  return {
    ...problem,
    holds: problem.holds.map((hold) => ({
      ...hold,
      role: (hold.role as string) === 'hand' ? 'hold' : hold.role,
    })),
  }
}

export async function createProblem(problem: Problem): Promise<Problem> {
  const item: ProblemItem = {
    ...problem,
    pk: problemPk(problem.id),
    sk: 'META',
    gsi1pk: wallVersionPk(problem.gymId, problem.wallId, problem.wallVersionId),
    gsi1sk: `PROBLEM#${problem.createdAt}#${problem.id}`,
    entityType: 'problem',
  }

  try {
    await client.send(new PutCommand({
      TableName: tableName,
      Item: item,
      ConditionExpression: 'attribute_not_exists(pk)',
    }))
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      throw new ApiError(409, 'problem id already exists')
    }
    throw error
  }
  return problem
}

export async function getProblem(problemId: string): Promise<Problem | undefined> {
  const response = await client.send(new GetCommand({
    TableName: tableName,
    Key: { pk: problemPk(problemId), sk: 'META' },
    ConsistentRead: true,
  }))
  return response.Item ? toProblem(response.Item as ProblemItem) : undefined
}

export async function requireProblem(problemId: string): Promise<Problem> {
  const problem = await getProblem(problemId)
  if (!problem) throw new ApiError(404, 'problem not found')
  return problem
}

export async function listProblems(gymId: string, wallId: string, wallVersionId: string, cursor?: string): Promise<{ items: Problem[]; nextCursor?: string }> {
  const partition = wallVersionPk(gymId, wallId, wallVersionId)
  let after: Record<string, string> | undefined
  if (cursor) {
    try {
      if (cursor.length > 4096) throw new Error()
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
      if (!parsed || Object.keys(parsed).length !== 4 ||
        !['pk', 'sk', 'gsi1pk', 'gsi1sk'].every((key) => typeof parsed[key] === 'string') ||
        parsed.gsi1pk !== partition || parsed.sk !== 'META' ||
        !parsed.pk.startsWith('PROBLEM#') || !parsed.gsi1sk.startsWith('PROBLEM#')) throw new Error()
      after = parsed
    } catch { throw new ApiError(400, 'invalid route cursor') }
  }
  const response = await client.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'gsi1',
    KeyConditionExpression: 'gsi1pk = :pk',
    ExpressionAttributeValues: {
      ':pk': partition,
    },
    ScanIndexForward: false,
    Limit: 50,
    ExclusiveStartKey: after,
  }))
  return {
    items: (response.Items ?? []).map((item: Record<string, unknown>) => toProblem(item as ProblemItem)),
    ...(response.LastEvaluatedKey ? { nextCursor: Buffer.from(JSON.stringify(response.LastEvaluatedKey)).toString('base64url') } : {}),
  }
}

export async function updateProblem(existing: Problem, patch: UpdateProblemInput): Promise<Problem> {
  if (patch.revision !== existing.revision) {
    throw new ApiError(409, `problem changed since revision ${patch.revision}`)
  }

  const { revision: _expectedRevision, ...fields } = patch
  const next: Problem = {
    ...existing,
    ...fields,
    updatedAt: new Date().toISOString(),
    revision: existing.revision + 1,
  }
  const item: ProblemItem = {
    ...next,
    pk: problemPk(next.id),
    sk: 'META',
    gsi1pk: wallVersionPk(next.gymId, next.wallId, next.wallVersionId),
    gsi1sk: `PROBLEM#${next.createdAt}#${next.id}`,
    entityType: 'problem',
  }

  try {
    await client.send(new PutCommand({
      TableName: tableName,
      Item: item,
      ConditionExpression: 'revision = :revision',
      ExpressionAttributeValues: { ':revision': existing.revision },
    }))
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      throw new ApiError(409, 'problem was updated by another request; reload and try again')
    }
    throw error
  }
  return next
}

const profileKey = (userId: string) => ({ pk: 'USER#' + userId, sk: 'PROFILE' })
const publicProfile = (item: Record<string, unknown> = {}): UserProfile => ({
  displayName: typeof item.displayName === 'string' ? item.displayName : '',
  bio: typeof item.bio === 'string' ? item.bio : '',
})
export async function getProfile(userId: string): Promise<UserProfile> {
  const result = await client.send(new GetCommand({ TableName: tableName, Key: profileKey(userId), ConsistentRead: true }))
  return publicProfile(result.Item)
}
export async function updateProfile(userId: string, patch: Partial<UserProfile>): Promise<UserProfile> {
  const names: Record<string, string> = { '#entity': 'entityType', '#updated': 'updatedAt' }
  const values: Record<string, string> = { ':entity': 'profile', ':updated': new Date().toISOString() }
  const sets = ['#entity = :entity', '#updated = :updated']
  for (const field of ['displayName', 'bio'] as const) {
    if (patch[field] === undefined) continue
    names['#' + field] = field
    values[':' + field] = patch[field]!
    sets.push('#' + field + ' = :' + field)
  }
  const result = await client.send(new UpdateCommand({
    TableName: tableName, Key: profileKey(userId),
    UpdateExpression: 'SET ' + sets.join(', '),
    ExpressionAttributeNames: names, ExpressionAttributeValues: values, ReturnValues: 'ALL_NEW',
  }))
  return publicProfile(result.Attributes)
}
