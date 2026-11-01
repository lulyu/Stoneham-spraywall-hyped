import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { Problem, ProblemItem, UpdateProblemInput } from './model'
import { ApiError } from './walls'

const tableName = process.env.DYNAMODB_TABLE
if (!tableName) throw new Error('DYNAMODB_TABLE is required')

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
})

const problemPk = (problemId: string) => `PROBLEM#${problemId}`
const wallVersionPk = (gymId: string, wallId: string, wallVersionId: string) =>
  `GYM#${gymId}#WALL#${wallId}#VERSION#${wallVersionId}`

function toProblem(item: ProblemItem): Problem {
  const { pk: _pk, sk: _sk, gsi1pk: _gsi1pk, gsi1sk: _gsi1sk, entityType: _entityType, ...problem } = item
  return problem
}

export async function createProblem(problem: Problem): Promise<Problem> {
  const item: ProblemItem = {
    ...problem,
    pk: problemPk(problem.problemId),
    sk: 'META',
    gsi1pk: wallVersionPk(problem.gymId, problem.wallId, problem.wallVersionId),
    gsi1sk: `PROBLEM#${problem.createdAt}#${problem.problemId}`,
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
  }))
  return response.Item ? toProblem(response.Item as ProblemItem) : undefined
}

export async function requireProblem(problemId: string): Promise<Problem> {
  const problem = await getProblem(problemId)
  if (!problem) throw new ApiError(404, 'problem not found')
  return problem
}

export async function listProblems(gymId: string, wallId: string, wallVersionId: string): Promise<Problem[]> {
  const response = await client.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'gsi1',
    KeyConditionExpression: 'gsi1pk = :pk',
    ExpressionAttributeValues: {
      ':pk': wallVersionPk(gymId, wallId, wallVersionId),
    },
    ScanIndexForward: false,
    Limit: 100,
  }))
  return (response.Items ?? []).map((item: Record<string, unknown>) => toProblem(item as ProblemItem))
}

export async function updateProblem(existing: Problem, patch: UpdateProblemInput): Promise<Problem> {
  if (patch.revision !== undefined && patch.revision !== existing.revision) {
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
    pk: problemPk(next.problemId),
    sk: 'META',
    gsi1pk: wallVersionPk(next.gymId, next.wallId, next.wallVersionId),
    gsi1sk: `PROBLEM#${next.createdAt}#${next.problemId}`,
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

export async function deleteProblem(problemId: string): Promise<void> {
  try {
    await client.send(new DeleteCommand({
      TableName: tableName,
      Key: { pk: problemPk(problemId), sk: 'META' },
      ConditionExpression: 'attribute_exists(pk)',
    }))
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      throw new ApiError(404, 'problem not found')
    }
    throw error
  }
}
