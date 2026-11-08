import { CognitoIdentityProviderClient, paginateListUsers } from '@aws-sdk/client-cognito-identity-provider'

const accounts = new CognitoIdentityProviderClient({
  maxAttempts: 2,
  requestHandler: { connectionTimeout: 1500, requestTimeout: 3000 },
})

/** Resolve only an existing route/comment owner's or authenticated caller's subject. */
export async function accountDisplayName(userId: string): Promise<string | undefined> {
  const userPoolId = process.env.COGNITO_USER_POOL_ID
  if (!userPoolId) return undefined
  const subject = userId.replace(/[\\"]/g, '\\$&')
  // Federated usernames differ from their stable sub; look up the exact subject.
  const pages = paginateListUsers({ client: accounts }, {
    UserPoolId: userPoolId, Filter: `sub = "${subject}"`, Limit: 1,
  })
  for await (const page of pages) {
    for (const user of page.Users ?? []) {
      if (!user.Enabled || !user.Attributes?.some(attribute => attribute.Name === 'sub' && attribute.Value === userId)) continue
      const name = user.Attributes.find(attribute => attribute.Name === 'name')?.Value?.trim().slice(0, 60)
      if (name) return name
    }
  }
  return undefined
}
