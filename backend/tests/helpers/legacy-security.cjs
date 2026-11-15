// Existing domain tests keep their focused storage fixtures. Security and summary
// concurrency are exercised against the transactional fixture in guardrails.test.
exports.intercept=command=>{
 const p=command.input
 if(command.constructor.name==='GetCommand'&&p.Key.sk==='ACCESS')return {}
 if(command.constructor.name==='GetCommand'&&p.Key.sk==='COMMUNITY_SUMMARY')return {Item:{...p.Key,version:1,revision:1,commentCount:0,ratingCount:0,ratingTotal:0}}
 if(command.constructor.name==='TransactWriteCommand'&&p.TransactItems.every(a=>a.Update?.Key.pk.startsWith('QUOTA#')))return {}
}
