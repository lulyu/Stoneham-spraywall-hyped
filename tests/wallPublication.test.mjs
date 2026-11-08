import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

test('publication exposes upgrade/publish behind verified JWTs and scopes migration access to the existing table',()=>{
  const template=JSON.parse(readFileSync('infra/cloudformation/backend.json'))
  for(const name of ['UpgradeDraftRoute','UpgradeSaveRoute','PublishWallRoute']) {
    const p=template.Resources[name].Properties
    assert.equal(p.AuthorizationType,'JWT');assert.deepEqual(p.AuthorizerId,{Ref:'JwtAuthorizer'})
    assert.deepEqual(p.AuthorizationScopes,['stoneham-api/write'])
  }
  const roles=Object.values(template.Resources).filter(r=>r.Type==='AWS::IAM::Role')
  const statements=roles.flatMap(r=>r.Properties.Policies??[]).flatMap(p=>p.PolicyDocument.Statement)
  const dynamo=statements.find(s=>s.Action?.includes('dynamodb:PutItem'))
  assert(dynamo.Action.includes('dynamodb:Scan'));assert(dynamo.Action.includes('dynamodb:ConditionCheckItem'))
  assert(!dynamo.Action.includes('dynamodb:DeleteItem'));assert(!dynamo.Action.includes('dynamodb:*'))
  assert(dynamo.Resource.every(resource=>resource!=='*'))
  const walls=JSON.parse(readFileSync('backend/walls.json'))
  assert.deepEqual(walls.filter(w=>w.active).map(w=>w.wallVersionId),['2026-11-v7'])
})

test('creator-name lookup is scoped to the configured Cognito user pool',()=>{
  const {Resources}=JSON.parse(readFileSync('infra/cloudformation/backend.json'))
  assert.deepEqual(Resources.Function.Properties.Environment.Variables.COGNITO_USER_POOL_ID,{Ref:'UserPool'})
  const statements=Resources.Role.Properties.Policies.flatMap(policy=>policy.PolicyDocument.Statement)
  const accounts=statements.filter(statement=>statement.Action.some(action=>action.startsWith('cognito-idp:')))
  assert.equal(accounts.length,1)
  assert.deepEqual(accounts[0].Action,['cognito-idp:ListUsers'])
  assert.deepEqual(accounts[0].Resource,{'Fn::GetAtt':['UserPool','Arn']})
})
