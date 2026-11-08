const {test,beforeEach}=require('node:test')
const assert=require('node:assert/strict')
const dynamo=require('@aws-sdk/lib-dynamodb')
const cognito=require('@aws-sdk/client-cognito-identity-provider')
process.env.DYNAMODB_TABLE='account-profile-test'
process.env.COGNITO_USER_POOL_ID='us-east-1_accounts'
let profiles,users,lookups,writes,concurrentEdit,pages
const subject='11111111-1111-1111-1111-111111111111'
const account=(name='Google Creator',sub=subject)=>({Enabled:true,Username:'Google_federated-id',Attributes:[{Name:'sub',Value:sub},{Name:'name',Value:name},{Name:'email',Value:'private@example.com'}]})
cognito.CognitoIdentityProviderClient.prototype.send=async function(command){
 assert.equal(command.constructor.name,'ListUsersCommand')
 assert.equal(command.input.UserPoolId,'us-east-1_accounts')
 assert.equal(command.input.Filter,`sub = "${subject}"`)
 lookups++
 if(pages)return pages.shift()
 return {Users:users}
}
dynamo.DynamoDBDocumentClient.from=()=>({send:async command=>{
 const p=command.input,kind=command.constructor.name
 if(kind==='GetCommand'){
  if(p.Key.sk==='META')return {Item:{pk:p.Key.pk,sk:'META',entityType:'problem',id:'route',ownerId:subject,holds:[]}}
  assert.equal(p.ConsistentRead,true)
  return {Item:profiles.get(p.Key.pk)}
 }
 if(kind==='UpdateCommand'){
  writes++
  assert.equal(p.ConditionExpression,'attribute_not_exists(#name) OR #name = :empty')
  if(concurrentEdit){profiles.set(p.Key.pk,concurrentEdit);concurrentEdit=null}
  const row=profiles.get(p.Key.pk)??{}
  if(row.displayName)throw Object.assign(new Error('Concurrent profile edit'),{name:'ConditionalCheckFailedException'})
  const next={...row,...p.Key,displayName:p.ExpressionAttributeValues[':name'],entityType:'profile',updatedAt:p.ExpressionAttributeValues[':updated']}
  profiles.set(p.Key.pk,next)
  return {Attributes:next}
 }
 throw Error('Unexpected '+kind)
}})
const {handler}=require('../dist/test-handler.cjs')
const request=async(path='/v1/me/profile')=>{
 const r=await handler({rawPath:path,requestContext:{requestId:'test',http:{method:'GET',path},authorizer:{jwt:{claims:{sub:subject}}}}})
 assert.equal(r.statusCode,200)
 return JSON.parse(r.body)
}
beforeEach(()=>{profiles=new Map();users=[account()];lookups=0;writes=0;concurrentEdit=null;pages=null})
test('first profile read resolves the exact Google creator subject and persists only public fields',async()=>{
 assert.deepEqual(await request(),{displayName:'Google Creator',bio:''})
 const stored=profiles.get('USER#'+subject)
 assert.equal(stored.displayName,'Google Creator')
 assert(!('email' in stored));assert(!('Username' in stored))
 assert.deepEqual(await request(),{displayName:'Google Creator',bio:''})
 assert.equal(lookups,1);assert.equal(writes,1)
})
test('existing routes resolve their creator independently of the setter and repair blank profiles',async()=>{
 profiles.set('USER#'+subject,{displayName:'',bio:'Saved bio'})
 assert.deepEqual(await request('/v1/problems/route/creator-profile'),{displayName:'Google Creator',bio:'Saved bio'})
 assert.equal(profiles.get('USER#'+subject).bio,'Saved bio')
})
test('custom display names are never replaced or looked up',async()=>{
 profiles.set('USER#'+subject,{displayName:'Custom Nickname',bio:'Bio'})
 assert.deepEqual(await request(),{displayName:'Custom Nickname',bio:'Bio'})
 assert.equal(lookups,0);assert.equal(writes,0)
})
test('a concurrent profile edit wins and its bio remains intact',async()=>{
 concurrentEdit={displayName:'Just Edited',bio:'Latest bio'}
 assert.deepEqual(await request(),{displayName:'Just Edited',bio:'Latest bio'})
 assert.equal(profiles.get('USER#'+subject).displayName,'Just Edited')
})
test('missing, disabled, or mismatched accounts never fall back to private email or setter',async()=>{
 for(const accounts of [[],[account('','other-sub')],[account('',subject)],[{...account(),Enabled:false}]]){
  users=accounts
  assert.deepEqual(await request(),{displayName:'',bio:''})
 }
 assert.equal(writes,0)
})
test('filtered empty pages continue to the exact subject and names respect profile limits',async()=>{
 pages=[{Users:[],PaginationToken:'next'},{Users:[account('  '+ 'N'.repeat(80)+'  ')]}]
 assert.deepEqual(await request(),{displayName:'N'.repeat(60),bio:''})
 assert.equal(lookups,2)
})
