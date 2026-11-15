import {randomUUID} from 'node:crypto'
import {tableName} from './storage'
export function auditWrite(actor:string,target:string,action:string,reason:string){
 const now=new Date().toISOString()
 return {Put:{TableName:tableName,Item:{pk:'MODERATION#'+target,sk:now+'#'+randomUUID(),entityType:'moderation-audit',actor,target,action,reason,createdAt:now},ConditionExpression:'attribute_not_exists(pk)'}}
}
