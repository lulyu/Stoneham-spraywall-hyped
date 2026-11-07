import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, TransactWriteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import type { Problem, UserProfile, ProblemItem, UpdateProblemInput } from './model'
import { ApiError, latestWall } from './walls'
import { compatibility, upgradeName } from './wallLifecycle'

export const tableName = process.env.DYNAMODB_TABLE
if (!tableName) throw new Error('DYNAMODB_TABLE is required')

export const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
})

const problemPk = (problemId: string) => `PROBLEM#${problemId}`
const wallVersionPk = (gymId: string, wallId: string, wallVersionId: string) =>
  `GYM#${gymId}#WALL#${wallId}#VERSION#${wallVersionId}`

function toProblem(item: ProblemItem): Problem {
  const { pk: _pk, sk: _sk, gsi1pk: _gsi1pk, gsi1sk: _gsi1sk, entityType: _entityType, ...problem } = item
  const normalized = {
    ...problem,
    holds: problem.holds.map((hold) => ({
      ...hold,
      role: (hold.role as string) === 'hand' ? 'hold' : hold.role,
    })),
  }
  return normalized.gymId&&normalized.wallId?compatibility(normalized):normalized
}

const wallPk = (gymId:string,wallId:string) => `GYM#${gymId}#WALL#${wallId}`

function problemWrites(problem:Problem, condition:Record<string,unknown>) {
  const order=`PROBLEM#${problem.createdAt}#${problem.id}`
  const item:ProblemItem={...problem,pk:problemPk(problem.id),sk:'META',
    gsi1pk:wallVersionPk(problem.gymId,problem.wallId,problem.wallVersionId),gsi1sk:order,entityType:'problem'}
  const pointer={pk:problemPk(problem.id),problemId:problem.id,gsi1sk:order,entityType:'problem-listing'}
  return [
    {Put:{TableName:tableName,Item:item,...condition}},
    {Put:{TableName:tableName,Item:{...pointer,sk:'LIST',gsi1pk:wallPk(problem.gymId,problem.wallId)+'#ALL'}}},
    ...(problem.supportedWallVersionIds??[]).filter(version=>version!==problem.wallVersionId).map(version=>({Put:{TableName:tableName,
      Item:{...pointer,sk:'COMPAT#'+version,gsi1pk:wallVersionPk(problem.gymId,problem.wallId,version)}}})),
  ]
}
async function persistProblem(problem:Problem,condition:Record<string,unknown>,extra:any[]=[]):Promise<Problem> {
  const next=compatibility(problem)
  try {
    await client.send(new TransactWriteCommand({TransactItems:[...problemWrites(next,condition),...extra]}))
  } catch(error) {
    const e=error as {name?:string;CancellationReasons?:{Code?:string}[]}
    if(e.name==='ConditionalCheckFailedException'||e.name==='TransactionConflictException'||
      (e.name==='TransactionCanceledException'&&e.CancellationReasons?.some(reason=>reason.Code==='ConditionalCheckFailed')))
      throw new ApiError(409,'problem changed; reload and try again')
    throw error
  }
  return next
}
export async function createProblem(problem:Problem):Promise<Problem> {
  return persistProblem(problem,{ConditionExpression:'attribute_not_exists(pk)'})
}

export async function getProblem(problemId: string): Promise<Problem | undefined> {
  const response = await client.send(new GetCommand({
    TableName: tableName,
    Key: { pk: problemPk(problemId), sk: 'META' },
    ConsistentRead: true,
  }))
  return response.Item ? toProblem(response.Item as ProblemItem) : undefined
}

export async function requireProblem(problemId: string): Promise<Problem> {
  const problem = await getProblem(problemId)
  if (!problem) throw new ApiError(404, 'problem not found')
  return problem
}

export async function listProblems(gymId:string,wallId:string,wallVersionId:string|undefined,cursor?:string):Promise<{items:Problem[];nextCursor?:string}> {
  const partition=wallVersionId?wallVersionPk(gymId,wallId,wallVersionId):wallPk(gymId,wallId)+'#ALL'
  let after:Record<string,string>|undefined
  if(cursor) {
    try {
      if(cursor.length>4096)throw new Error()
      const parsed=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'))
      if(!parsed||Object.keys(parsed).length!==4||!['pk','sk','gsi1pk','gsi1sk'].every(key=>typeof parsed[key]==='string')||
        parsed.gsi1pk!==partition||!parsed.pk.startsWith('PROBLEM#')||!parsed.gsi1sk.startsWith('PROBLEM#')||
        !(wallVersionId?(parsed.sk==='META'||parsed.sk==='COMPAT#'+wallVersionId):parsed.sk==='LIST'))throw new Error()
      after=parsed
    }catch{throw new ApiError(400,'invalid route cursor')}
  }
  const response=await client.send(new QueryCommand({TableName:tableName,IndexName:'gsi1',KeyConditionExpression:'gsi1pk = :pk',
    ExpressionAttributeValues:{':pk':partition},ScanIndexForward:false,Limit:50,ExclusiveStartKey:after}))
  const records=await Promise.all((response.Items??[]).map(item=>item.sk==='META'?toProblem(item as ProblemItem):getProblem(item.problemId)))
  const seen=new Set<string>()
  return {items:records.filter((p):p is Problem=>Boolean(p)).filter(p=> {
    if(seen.has(p.id))return false
    seen.add(p.id)
    // Stale compatibility pointers are harmless: hydrate and verify current metadata.
    return !wallVersionId||(p.supportedWallVersionIds?p.supportedWallVersionIds.includes(wallVersionId):p.wallVersionId===wallVersionId)
  }),...(response.LastEvaluatedKey?{nextCursor:Buffer.from(JSON.stringify(response.LastEvaluatedKey)).toString('base64url')}:{})}
}

export async function updateProblem(existing: Problem, patch: UpdateProblemInput): Promise<Problem> {
  if (patch.revision !== existing.revision) {
    throw new ApiError(409, `problem changed since revision ${patch.revision}`)
  }

  const { revision: _expectedRevision, ...fields } = patch
  const next: Problem = {
    ...existing,
    ...fields,
    updatedAt: new Date().toISOString(),
    revision: existing.revision + 1,
  }
  return persistProblem(next,{ConditionExpression:'revision = :revision',ExpressionAttributeValues:{':revision':existing.revision}})
}

export async function upgradeDraft(source:Problem) {
  const wall=latestWall(source.gymId,source.wallId)
  if(!compatibility(source).outdated)throw new ApiError(409,'This route already supports the latest wall')
  const root=source.upgradeRootId??source.id
  const counter=await client.send(new GetCommand({TableName:tableName,Key:{pk:problemPk(root),sk:'UPGRADE_COUNTER'},ConsistentRead:true}))
  const number=Math.max(counter.Item?.number??1,source.upgradeNumber??1)+1
  const base=source.upgradeBaseName??source.name
  return {sourceId:source.id,sourceRevision:source.revision,targetWallVersionId:wall.wallVersionId,
    name:upgradeName(base,number),grade:source.grade,setter:source.setter,notes:source.notes,
    holds:source.holds.filter(hold=>wall.holdIds.has(hold.holdId)),
    removedHoldIds:source.holds.filter(hold=>!wall.holdIds.has(hold.holdId)).map(hold=>hold.holdId)}
}

export async function createUpgrade(source:Problem,input:import('./model').CreateProblemInput,automaticName:boolean,newId:()=>string):Promise<Problem> {
  const latest=latestWall(source.gymId,source.wallId),root=source.upgradeRootId??source.id,base=source.upgradeBaseName??source.name
  for(let attempt=0;attempt<3;attempt++) {
    const counter=await client.send(new GetCommand({TableName:tableName,Key:{pk:problemPk(root),sk:'UPGRADE_COUNTER'},ConsistentRead:true}))
    const previous=counter.Item?.number,number=Math.max(previous??1,source.upgradeNumber??1)+1,now=new Date().toISOString()
    const next:Problem={...input,id:newId(),gymId:source.gymId,wallId:source.wallId,wallVersionId:latest.wallVersionId,
      name:automaticName?upgradeName(base,number):input.name,ownerId:source.ownerId,createdAt:now,updatedAt:now,revision:1,
      upgradedFromId:source.id,upgradeRootId:root,upgradeBaseName:base,upgradeNumber:number}
    try {
      return await persistProblem(next,{ConditionExpression:'attribute_not_exists(pk)'},[
        {ConditionCheck:{TableName:tableName,Key:{pk:problemPk(source.id),sk:'META'},ConditionExpression:'revision = :revision AND ownerId = :owner',
          ExpressionAttributeValues:{':revision':source.revision,':owner':source.ownerId}}},
        {Put:{TableName:tableName,Item:{pk:problemPk(root),sk:'UPGRADE_COUNTER',number,entityType:'upgrade-counter'},
          ConditionExpression:previous===undefined?'attribute_not_exists(pk)':'#number = :previous',
          ...(previous===undefined?{}:{ExpressionAttributeNames:{'#number':'number'},ExpressionAttributeValues:{':previous':previous}})}},
      ])
    }catch(error){if(!(error instanceof ApiError)||error.statusCode!==409||attempt===2)throw error}
  }
  throw new ApiError(409,'Upgrade numbering changed; retry saving your draft')
}

export async function migrateWallPage(gymId:string,wallId:string,version:string,cursor?:string,dryRun=false) {
  if(latestWall(gymId,wallId).wallVersionId!==version)throw new ApiError(400,'Publish migration must target the latest wall')
  let after:Record<string,string>|undefined
  if(cursor)try {
    if(cursor.length>4096)throw new Error()
    const token=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'))
    if(token.version!==version||!token.key||Object.keys(token.key).length!==2||typeof token.key.pk!=='string'||typeof token.key.sk!=='string')throw new Error()
    after=token.key
  }catch{throw new ApiError(400,'invalid migration cursor')}
  const page=await client.send(new ScanCommand({TableName:tableName,ConsistentRead:true,Limit:50,ExclusiveStartKey:after,
    FilterExpression:'#entity = :entity AND gymId = :gym AND wallId = :wall',ExpressionAttributeNames:{'#entity':'entityType'},
    ExpressionAttributeValues:{':entity':'problem',':gym':gymId,':wall':wallId}}))
  let compatible=0,outdated=0,changed=0;const conflicts:string[]=[]
  for(const item of page.Items??[]) {
    let original=item as ProblemItem
    for(let attempt=0;attempt<3;attempt++) {
      const raw=toProblem(original),next=compatibility({...raw,holds:original.holds})
      const differs=JSON.stringify([original.supportedWallVersionIds,original.outdated,original.compatibilityWallVersionId,original.missingHoldIds])!==
        JSON.stringify([next.supportedWallVersionIds,next.outdated,next.compatibilityWallVersionId,next.missingHoldIds])
      if(dryRun){if(next.outdated)outdated++;else compatible++;if(differs)changed++;break}
      const revision=original.revision??1
      try {
        await persistProblem({...next,revision:differs?revision+1:revision,compatibilityCheckedAt:differs?new Date().toISOString():raw.compatibilityCheckedAt},
          original.revision===undefined?{ConditionExpression:'attribute_exists(pk) AND attribute_not_exists(revision)'}:
            {ConditionExpression:'revision = :revision',ExpressionAttributeValues:{':revision':revision}})
        if(next.outdated)outdated++;else compatible++;if(differs)changed++;break
      }catch(error) {
        if(!(error instanceof ApiError)||error.statusCode!==409)throw error
        if(attempt===2){conflicts.push(raw.id);break}
        const fresh=await client.send(new GetCommand({TableName:tableName,Key:{pk:problemPk(raw.id),sk:'META'},ConsistentRead:true}))
        if(!fresh.Item){conflicts.push(raw.id);break}
        original=fresh.Item as ProblemItem
      }
    }
  }
  return {scanned:page.ScannedCount??0,processed:compatible+outdated,compatible,outdated,changed,conflicts,dryRun,
    ...(page.LastEvaluatedKey?{nextCursor:Buffer.from(JSON.stringify({version,key:page.LastEvaluatedKey})).toString('base64url')}:{})}
}

const profileKey = (userId: string) => ({ pk: 'USER#' + userId, sk: 'PROFILE' })
const publicProfile = (item: Record<string, unknown> = {}): UserProfile => ({
  displayName: typeof item.displayName === 'string' ? item.displayName : '',
  bio: typeof item.bio === 'string' ? item.bio : '',
})
export async function getProfile(userId: string): Promise<UserProfile> {
  const result = await client.send(new GetCommand({ TableName: tableName, Key: profileKey(userId), ConsistentRead: true }))
  return publicProfile(result.Item)
}
export async function updateProfile(userId: string, patch: Partial<UserProfile>): Promise<UserProfile> {
  const names: Record<string, string> = { '#entity': 'entityType', '#updated': 'updatedAt' }
  const values: Record<string, string> = { ':entity': 'profile', ':updated': new Date().toISOString() }
  const sets = ['#entity = :entity', '#updated = :updated']
  for (const field of ['displayName', 'bio'] as const) {
    if (patch[field] === undefined) continue
    names['#' + field] = field
    values[':' + field] = patch[field]!
    sets.push('#' + field + ' = :' + field)
  }
  const result = await client.send(new UpdateCommand({
    TableName: tableName, Key: profileKey(userId),
    UpdateExpression: 'SET ' + sets.join(', '),
    ExpressionAttributeNames: names, ExpressionAttributeValues: values, ReturnValues: 'ALL_NEW',
  }))
  return publicProfile(result.Attributes)
}
