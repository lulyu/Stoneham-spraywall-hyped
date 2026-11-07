import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda'
import {parseArgs} from 'node:util'

const {values}=parseArgs({options:{function:{type:'string'},version:{type:'string'},region:{type:'string',default:'us-east-1'},'dry-run':{type:'boolean',default:false}}})
if(!values.function||!values.version)throw new Error('Usage: node backend/scripts/publish-wall.mjs --function API_FUNCTION --version WALL_VERSION [--dry-run]')
const client=new LambdaClient({region:values.region})
const path='/v1/admin/gyms/stoneham-crg/walls/spray-wall-1/versions/'+encodeURIComponent(values.version)+'/publish'
const totals={pages:0,scanned:0,processed:0,compatible:0,outdated:0,changed:0}
const seen=new Set();let cursor
do {
  // This administrative context is trusted only through IAM-authorized Lambda
  // invocation. HTTP callers must use API Gateway's verified admin JWT.
  const event={rawPath:path,body:JSON.stringify({cursor,dryRun:values['dry-run']}),requestContext:{requestId:'wall-publication',http:{method:'POST',path},authorizer:{jwt:{claims:{sub:'wall-publication-workflow','cognito:groups':'["admins"]'}}}}}
  const response=await client.send(new InvokeCommand({FunctionName:values.function,InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify(event))}))
  if(response.FunctionError)throw new Error('Migration Lambda failed: '+response.FunctionError)
  const reply=JSON.parse(Buffer.from(response.Payload).toString()),page=JSON.parse(reply.body)
  if(reply.statusCode!==200)throw new Error('Migration rejected: '+(page.error??reply.statusCode))
  if(page.conflicts?.length)throw new Error('Concurrent route edits remain unresolved. Rerun migration before publishing the frontend: '+page.conflicts.join(', '))
  totals.pages++
  for(const key of ['scanned','processed','compatible','outdated','changed'])totals[key]+=page[key]
  cursor=page.nextCursor
  if(cursor&&seen.has(cursor))throw new Error('Migration cursor repeated; publication stopped')
  if(cursor)seen.add(cursor)
}while(cursor)
console.log(JSON.stringify({wallVersionId:values.version,dryRun:values['dry-run'],complete:true,...totals},null,2))
