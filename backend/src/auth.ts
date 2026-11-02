import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { ApiError } from './walls'
import type { Problem } from './model'

export function requireIdentity(event: APIGatewayProxyEventV2) {
  // Only API Gateway's verified JWT authorizer context is trusted, never headers/body.
  const context = event.requestContext as APIGatewayProxyEventV2['requestContext'] & {
    authorizer?: { jwt?: { claims: Record<string, unknown> } }
  }
  const claims = context.authorizer?.jwt?.claims
  if (!claims || typeof claims.sub !== 'string' || !claims.sub) throw new ApiError(401, 'Sign in to save or edit problems')
  let groups: unknown = claims['cognito:groups']
  if (typeof groups === 'string') {
    const encoded = groups
    try { groups = JSON.parse(encoded) }
    catch { groups = encoded.replace(/^\[|\]$/g, '').split(/[\s,]+/) }
  }
  return { userId: claims.sub, isAdmin: Array.isArray(groups) && groups.includes('admins') }
}
export function requireEditor(identity: ReturnType<typeof requireIdentity>, problem: Problem) {
  if (!identity.isAdmin && (!problem.ownerId || problem.ownerId !== identity.userId)) {
    throw new ApiError(403, 'Only the creator or a gym administrator can edit this problem')
  }
}
