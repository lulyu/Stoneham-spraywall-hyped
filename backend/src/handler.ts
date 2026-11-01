import { requireIdentity, requireEditor } from './auth'
import { randomUUID } from 'node:crypto'
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { createProblem, listProblems, requireProblem, updateProblem } from './db'
import type { Problem } from './model'
import { parseCreateProblem, parseUpdateProblem } from './validation'
import { ApiError, requireWallVersion } from './walls'

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

function response(statusCode: number, body?: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

function parseJsonBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) throw new ApiError(400, 'request body is required')
  try {
    const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
    return JSON.parse(body)
  } catch {
    throw new ApiError(400, 'request body must be valid JSON')
  }
}

function pathMatch(path: string, expression: RegExp): string[] | undefined {
  const match = path.match(expression)
  return match?.slice(1).map(decodeURIComponent)
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method.toUpperCase()
  const path = event.rawPath || event.requestContext.http.path
  const requestId = event.requestContext.requestId

  try {
    // API Gateway adds the configured CORS headers to this preflight response.
    if (method === 'OPTIONS') return response(204)

    if (method === 'GET' && path === '/health') {
      return response(200, { ok: true, service: 'stoneham-spraywall-api' })
    }

    if (method === 'GET' && path === '/v1/me') return response(200, requireIdentity(event))

    const wallProblemPath = pathMatch(
      path,
      /^\/v1\/gyms\/([^/]+)\/walls\/([^/]+)\/versions\/([^/]+)\/problems$/,
    )
    if (wallProblemPath) {
      const [gymId, wallId, wallVersionId] = wallProblemPath
      const wall = requireWallVersion(gymId, wallId, wallVersionId)

      if (method === 'GET') {
        return response(200, { items: await listProblems(gymId, wallId, wallVersionId) })
      }
      if (method === 'POST') {
        const identity = requireIdentity(event)
        const input = parseCreateProblem(parseJsonBody(event), wall)
        const now = new Date().toISOString()
        const problem: Problem = {
          id: randomUUID(),
          gymId,
          wallId,
          wallVersionId,
          ...input,
          createdAt: now,
          updatedAt: now,
          revision: 1,
          ownerId: identity.userId,
        }
        return response(201, await createProblem(problem))
      }
      return response(405, { error: 'method not allowed', requestId })
    }

    const problemPath = pathMatch(path, /^\/v1\/problems\/([^/]+)$/)
    if (problemPath) {
      const [problemId] = problemPath
      if (method === 'GET') return response(200, await requireProblem(problemId))
      if (method === 'PATCH') {
        const identity = requireIdentity(event)
        const existing = await requireProblem(problemId)
        requireEditor(identity, existing)
        const wall = requireWallVersion(existing.gymId, existing.wallId, existing.wallVersionId)
        const patch = parseUpdateProblem(parseJsonBody(event), wall)
        return response(200, await updateProblem(existing, patch))
      }
      return response(405, { error: 'method not allowed', requestId })
    }

    return response(404, { error: 'not found', requestId })
  } catch (error) {
    if (error instanceof ApiError) return response(error.statusCode, { error: error.message, requestId })
    console.error('Unhandled request error', { requestId, error })
    return response(500, { error: 'internal server error', requestId })
  }
}
