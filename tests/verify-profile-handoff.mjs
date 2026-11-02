import assert from 'node:assert/strict';import{officialProfileHandoff}from'../backend/lib/live/profile-handoff.mjs';
const seed='https://official.example/';let calls=0;
const run=(target,names=['Sample Artist'])=>officialProfileHandoff(seed,names,{read:async()=>{calls++;return{url:seed,html:`<meta http-equiv="refresh" content="0;url=${target}">`}}});
const good=await run('https://agency.example/artist/profile/Sample%20Artist');assert.equal(good.url,'https://agency.example/artist/profile/Sample%20Artist');assert.equal(good.sourceUrl,seed);
for(const u of ['https://other.example/','https://other.example/news/Sample%20Artist','https://agency.example/artist/profile/Other','http://agency.example/artist/profile/Sample%20Artist','https://user:fixture@agency.example/artist/profile/Sample%20Artist','https://agency.example/artist/profile/Sample%20Artist?token=fixture'])assert.equal(await run(u),null);
assert.equal(await run('https://agency.example/artist/profile/LIVE',['IVE']),null);assert.equal(calls,8);
console.log('PASS official handoff: only observed meta-refresh to exact named artist profile, not arbitrary cross-site/root/news/credential/query handoffs; destination still validated by official collector');
