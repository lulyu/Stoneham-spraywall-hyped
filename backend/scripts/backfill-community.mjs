import {DynamoDBClient} from '@aws-sdk/client-dynamodb'
import {DynamoDBDocumentClient,paginateScan,GetCommand} from '@aws-sdk/lib-dynamodb'
import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda'
import {parseArgs} from 'node:util'
const {values}=parseArgs({options:{function:{type:'string'},table:{type:'string'},region:{type:'string',default:'us-east-1'},'dry-run':{type:'boolean',default:false}}})
if(!values.function||!values.table)throw Error('Use --function API_FUNCTION --table TABLE [--dry-run]')
const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:values.region})),lambda=new LambdaClient({region:values.region})
const result={routes:0,initialized:0,alreadyReady:0,dryRun:values['dry-run']}
for await(const page of paginateScan({client:db},{TableName:values.table,FilterExpression:'entityType = :type',ExpressionAttributeValues:{':type':'problem'}})){
 for(const row of page.Items??[]){
  result.routes++
  if((await db.send(new GetCommand({TableName:values.table,Key:{pk:row.pk,sk:'COMMUNITY_SUMMARY'},ConsistentRead:true}))).Item){result.alreadyReady++;continue}
  if(values['dry-run'])continue
  const path='/v1/admin/community/backfill'
  const event={rawPath:path,body:JSON.stringify({problemId:row.id}),requestContext:{requestId:'community-backfill',http:{method:'POST',path},authorizer:{jwt:{claims:{sub:'community-backfill-workflow','cognito:groups':'["admins"]'}}}}}
  for(;;){
   const reply=await lambda.send(new InvokeCommand({FunctionName:values.function,Payload:Buffer.from(JSON.stringify(event))}))
   if(reply.FunctionError)throw Error('Backfill Lambda failed')
   const response=JSON.parse(Buffer.from(reply.Payload).toString()),body=JSON.parse(response.body)
   if(response.statusCode===429){await new Promise(resolve=>setTimeout(resolve,Math.min(body.retryAfter??60,60)*1000));continue}
   if(response.statusCode!==200)throw Error(body.error??'Backfill failed')
   if(body.initialized)result.initialized++;else result.alreadyReady++
   break
  }
 }
}
console.log(JSON.stringify(result,null,2))
