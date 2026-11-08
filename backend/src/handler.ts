import { logSend, listSends, rate, addComment, community, myActivity, changeComment, commentAuthorProfile } from './community'
import { requireIdentity, requireEditor } from './auth'
import { randomUUID } from 'node:crypto'
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { createProblem, getProfile, updateProfile, listProblems, listOwnedProblems, requireProblem, updateProblem, upgradeDraft, createUpgrade, migrateWallPage } from './db'
import type { Problem } from './model'
import { parseProfile, parseCreateProblem, parseUpdateProblem } from './validation'
import { ApiError, requireWallVersion, latestWall } from './walls'

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

    if (path === '/v1/me/profile') {
      const identity = requireIdentity(event)
      if (method === 'GET') return response(200, await getProfile(identity.userId))
      if (method === 'PATCH') return response(200, await updateProfile(identity.userId, parseProfile(parseJsonBody(event))))
      return response(405, { error: 'method not allowed', requestId })
    }

    if (path === '/v1/me/sends') {
      const identity = requireIdentity(event)
      if (method === 'GET') return response(200, await listSends(identity.userId, event.queryStringParameters?.cursor))
      return response(405, { error: 'method not allowed', requestId })
    }
    if (path === '/v1/me/problems') {
      const identity = requireIdentity(event)
      if (method === 'GET') return response(200, await listOwnedProblems(identity.userId, event.queryStringParameters?.cursor))
      return response(405, { error: 'method not allowed', requestId })
    }
    const creatorProfilePath = pathMatch(path, /^\/v1\/problems\/([^/]+)\/creator-profile$/)
    if (creatorProfilePath) {
      if (method !== 'GET') return response(405, { error: 'method not allowed', requestId })
      const problem = await requireProblem(creatorProfilePath[0])
      if (!problem.ownerId) throw new ApiError(404, 'Creator profile is unavailable for this route')
      const profile = await getProfile(problem.ownerId)
      return response(200, { displayName: profile.displayName || 'Climber', bio: profile.bio })
    }
    const commentProfilePath = pathMatch(path, /^\/v1\/problems\/([^/]+)\/comments\/([^/]+)\/author-profile$/)
    if (commentProfilePath) {
      if (method !== 'GET') return response(405, { error: 'method not allowed', requestId })
      await requireProblem(commentProfilePath[0])
      return response(200, await commentAuthorProfile(commentProfilePath[0], commentProfilePath[1]))
    }
    const commentPath = pathMatch(path, /^\/v1\/problems\/([^/]+)\/comments\/([^/]+)$/)
    if (commentPath) {
      const identity = requireIdentity(event)
      const [problemId, commentId] = commentPath
      await requireProblem(problemId)
      if (method === 'PATCH') return response(200, await changeComment(identity.userId, problemId, commentId, parseJsonBody(event)))
      if (method === 'DELETE') return response(200, await changeComment(identity.userId, problemId, commentId))
      return response(405, { error: 'method not allowed', requestId })
    }
    const communityPath = pathMatch(path, /^\/v1\/problems\/([^/]+)\/(community|my-activity|sends|rating|comments)$/)
    if (communityPath) {
      const [problemId, action] = communityPath
      const identity = action === 'community' && method === 'GET' ? undefined : requireIdentity(event)
      const problem = await requireProblem(problemId)
      if (method === 'GET' && action === 'community') return response(200, await community(problemId, event.queryStringParameters?.cursor))
      if (method === 'GET' && action === 'my-activity') return response(200, await myActivity(identity!.userId, problemId))
      if (method === 'POST' && action === 'sends') return response(200, await logSend(identity!.userId, problem))
      if (method === 'PATCH' && action === 'rating') return response(200, await rate(identity!.userId, problemId, parseJsonBody(event)))
      if (method === 'POST' && action === 'comments') return response(200, await addComment(identity!.userId, problemId, parseJsonBody(event)))
      return response(405, { error: 'method not allowed', requestId })
    }

    const publishPath=pathMatch(path,/^\/v1\/admin\/gyms\/([^/]+)\/walls\/([^/]+)\/versions\/([^/]+)\/publish$/)
    if(publishPath) {
      const identity=requireIdentity(event)
      if(!identity.isAdmin)throw new ApiError(403,'Only gym administrators can publish a wall')
      if(method!=='POST')return response(405,{error:'method not allowed'})
      const input=event.body?parseJsonBody(event):{}
      if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'Invalid publish request')
      const {cursor,dryRun}=input as {cursor?:unknown;dryRun?:unknown}
      if(cursor!==undefined&&typeof cursor!=='string'||dryRun!==undefined&&typeof dryRun!=='boolean')throw new ApiError(400,'Invalid migration options')
      return response(200,await migrateWallPage(publishPath[0],publishPath[1],publishPath[2],cursor as string|undefined,dryRun===true))
    }
    const allProblemsPath=pathMatch(path,/^\/v1\/gyms\/([^/]+)\/walls\/([^/]+)\/problems$/)
    if(allProblemsPath) {
      if(method!=='GET')return response(405,{error:'method not allowed'})
      latestWall(allProblemsPath[0],allProblemsPath[1])
      return response(200,await listProblems(allProblemsPath[0],allProblemsPath[1],undefined,event.queryStringParameters?.cursor))
    }
    const upgradePath=pathMatch(path,/^\/v1\/problems\/([^/]+)\/upgrade$/)
    if(upgradePath) {
      const identity=requireIdentity(event),source=await requireProblem(upgradePath[0])
      if(!source.ownerId||source.ownerId!==identity.userId)throw new ApiError(403,'Only the original creator can upgrade this route')
      if(!source.outdated)throw new ApiError(409,'This route already supports the latest wall')
      if(method==='GET')return response(200,await upgradeDraft(source))
      if(method!=='POST')return response(405,{error:'method not allowed'})
      const body=parseJsonBody(event) as Record<string,unknown>
      if(!body||!Number.isSafeInteger(body.sourceRevision))throw new ApiError(400,'sourceRevision is required')
      if(body.sourceRevision!==source.revision)throw new ApiError(409,'The source route changed; reopen Upgrade')
      if(body.automaticName!==undefined&&typeof body.automaticName!=='boolean')throw new ApiError(400,'Invalid automaticName')
      const input=parseCreateProblem(body,latestWall(source.gymId,source.wallId))
      return response(201,await createUpgrade(source,input,body.automaticName!==false,randomUUID))
    }
    const wallProblemPath = pathMatch(
      path,
      /^\/v1\/gyms\/([^/]+)\/walls\/([^/]+)\/versions\/([^/]+)\/problems$/,
    )
    if (wallProblemPath) {
      const [gymId, wallId, wallVersionId] = wallProblemPath
      const wall = requireWallVersion(gymId, wallId, wallVersionId)

      if (method === 'GET') {
        return response(200, await listProblems(gymId, wallId, wallVersionId, event.queryStringParameters?.cursor))
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
        const body=parseJsonBody(event) as Record<string,unknown>
        const target=body?.editWallVersionId
        if(target!==undefined&&(typeof target!=='string'||target!==latestWall(existing.gymId,existing.wallId).wallVersionId))throw new ApiError(400,'Invalid edit wall version')
        if(target!==undefined&&existing.outdated)throw new ApiError(409,'Upgrade this outdated route to create a new route')
        const wall = requireWallVersion(existing.gymId, existing.wallId, typeof target==='string'?target:existing.wallVersionId)
        const patch = parseUpdateProblem(body, wall)
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
