import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
test('moderation and backfill routes require verified JWTs and write scope, with bounded quota storage',()=>{
 const {Resources}=JSON.parse(readFileSync('infra/cloudformation/backend.json'))
 for(const name of ['ListModerationRoute','ModerateAccountRoute','ModerateProblemRoute','ModerateCommentRoute','BackfillCommunityRoute']){
  const p=Resources[name].Properties
  assert.equal(p.AuthorizationType,'JWT');assert.deepEqual(p.AuthorizationScopes,['stoneham-api/write'])
  assert.deepEqual(p.AuthorizerId,{Ref:'JwtAuthorizer'})
 }
 assert.deepEqual(Resources.Table.Properties.TimeToLiveSpecification,{AttributeName:'expiresAt',Enabled:true})
 assert(Resources.Api.Properties.CorsConfiguration.ExposeHeaders.includes('Retry-After'))
 const actions=Resources.Role.Properties.Policies.flatMap(p=>p.PolicyDocument.Statement).flatMap(s=>s.Action)
 assert(!actions.includes('dynamodb:DeleteItem'));assert(!actions.includes('dynamodb:*'))
})
