# Cognito authentication layer (not deployed yet)

Production still runs the pre-auth release until Google OAuth is configured and
the coordinated backend/frontend rollout is tested.

## Permissions

- Anonymous: health and problem list/read only.
- Signed-in user: create; edit only rows with ownerId equal to the verified sub.
- admins Cognito group: edit any row, including old unowned anonymous rows.
- DELETE is removed for everyone, including admins; permanent deletion is not a UI feature.
- ownerId is assigned by the server on creation and is not accepted in updates.
- Existing anonymous records remain unowned, not automatically claimable.
- Display names, email addresses, form values and localStorage never grant authority.

API Gateway verifies JWT signature, issuer, audience, expiry and the required
stoneham-api/write scope on the explicit POST, PATCH and /v1/me routes. This scope
requires a Cognito access token, not an ID token. Lambda only trusts the resulting
authorizer context and separately checks ownership/group membership. The Lambda
execution role cannot manage Cognito users or group membership. The default
route's handler also rejects writes without authorizer context, so an alternate
URL cannot bypass the ownership checks.

## Administrator assignment

After the intended administrator signs in, identify the exact Cognito username
and sub in the AWS console. An AWS operator with scoped Cognito administrative
permissions can add that verified user to the admins group:

```bash
aws cognito-idp admin-add-user-to-group --region us-east-1 \
  --user-pool-id POOL_ID --username VERIFIED_COGNITO_USERNAME --group-name admins
```

Remove access using admin-remove-user-from-group with the same arguments.
No public endpoint grants roles. This application group grants no AWS IAM role.
Access tokens last 15 minutes; membership changes affect newly issued tokens,
so existing tokens may keep their previous permissions until expiration.
Do not assign administrator access based solely on a submitted email address.

## Google setup and rollout

1. Create a Google Cloud OAuth web application. Register the Cognito domain's
   /oauth2/idpresponse as its authorized redirect URI.
2. Store the Google client secret in AWS Secrets Manager as a JSON client_secret
   value. Do not commit it, place it in Vite, or send it in chat.
3. Update the CloudFormation backend stack with GoogleClientId and GoogleSecretArn,
   plus the new Lambda artifact. The template creates the user pool, Google
   provider, public OAuth client, domain, admins group, JWT authorizer and protected
   routes. It also adds an initial 10 requests/second, burst 20 stage throttle;
   this is best effort throttling, not a spending cap.
4. Set Vercel Production VITE_COGNITO_AUTHORITY and VITE_COGNITO_CLIENT_ID from the
   stack outputs, retaining VITE_API_BASE_URL, then deploy this branch's frontend.
5. Test real Google login, sign-out, two distinct users and an administrator.
   Verify anonymous POST/PATCH = 401, non-owner PATCH = 403, admin edit of legacy
   records succeeds, and DELETE = 405. Old anonymous-write smoke scripts need a
   new authenticated harness and must not be used to clean up with public DELETE.

The browser uses oidc-client-ts authorization code flow with PKCE, state/nonce
validation, sessionStorage and renewal. Login occurs before setting a route.
Login expiry during editing reports a save error without a local-save fallback.
User-facing identity and permissions come from the authenticated /v1/me endpoint.
The frontend's visibility checks are convenience only; backend checks are mandatory.

Tests currently cover backend ownership/auth context and frontend token headers.
Real Google login and expired-session browser tests require the configured OAuth
application and remain rollout gates. Do not deploy only the frontend before the
backend authorization routes exist.
