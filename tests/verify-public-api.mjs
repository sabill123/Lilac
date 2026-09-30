import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { createPublicHandler, isAllowedUpstreamURL } from '../server/public/handler.mjs';
import { project, sourceTimestamp } from '../server/public/projection.mjs';
const timestamp='2026-01-01T00:00:00Z';
const data={artists:[{id:'a',name:'Artist',links:{}}],catalog:{builtAt:timestamp,artists:{a:{name:'Artist',fetchedAt:timestamp,tracks:[{id:123,title:'Song',album:'Album',albumId:1,preview:'https://audio.example/123',stores:['jp']},{id:124,title:'Korean',album:'Album',stores:['kr']}]}}},charts:{updated:timestamp,countries:{jp:{label:'Japan',combined:[{title:'Song',rank:1}],apple:[]},kr:{label:'Korea',combined:[]}}},'search-index':{builtAt:timestamp,entries:[]},aliases:{artists:{아티스트:'Artist'},tracks:{}},products:[],events:[],tracks:[],releases:[{id:'r',artistId:'a',country:'jp',tier:'curated',editions:[],offers:[]}],fx:{date:'2026-01-01',jpyKrw:9,source:'snapshot'}};
let calls=0,active=0,maximum=0;const urls=[];
const fetchImpl=async url=>{calls++;urls.push(String(url));active++;maximum=Math.max(maximum,active);await Promise.resolve();active--;return {ok:true,json:async()=>({results:[{trackId:999,trackName:'Other',artistName:'Other'}]})}};
const handler=createPublicHandler({data,fetchImpl});
async function request(url,method='GET',body,run=handler,requestHeaders={}){const req=Readable.from(body?[JSON.stringify(body)]:[]);Object.assign(req,{url,method,headers:requestHeaders});const headers={};let value;const res={setHeader:(k,v)=>headers[k]=v,end:v=>value=JSON.parse(v)};await run(req,res);assert.match(headers['Content-Type'],/json/);return {status:res.statusCode,body:value}}
assert.equal((await request('/api/me')).body.user,null);
assert.equal((await request('/api/charts?country=jp')).body.updated,timestamp);
assert.equal((await request('/api/charts?country=kr')).body.total,0);
assert.equal((await request('/api/charts?source=missing')).status,404);
assert.equal((await request('/api/catalog/search?term=Song')).body.tracks[0].id,123);
assert.equal(calls,0);
assert.equal((await request('/api/catalog/search?term=Korean&country=kr')).body.tracks[0].id,124);
assert.equal((await request('/api/search?q=아티스트')).body.artists[0].id,'a');
assert.equal((await request('/api/catalog/batch','POST',{terms:['123','777']})).body.results['777'],null);
assert.equal((await request('/api/catalog/batch','POST',{terms:['123']})).body.results['123'].preview,'https://audio.example/123');
assert.equal((await request('/api/catalog/batch','POST',{terms:Array(41).fill('x')})).status,400);
assert.equal((await request('/api/catalog/batch','POST',{terms:[1]})).status,400);
assert.equal((await request('/api/catalog/batch','POST',{terms:['x'.repeat(17000)]})).status,413);
await request('/api/catalog/batch','POST',{terms:Array.from({length:10},(_,i)=>`missing ${i}`)});assert.ok(maximum<=3);assert.ok(urls.every(u=>u.startsWith('https://itunes.apple.com/')));
const before=calls;for(const p of ['/api/db/users','/api/db/sessions','/api/db/contacts','/api/db/groupbuys','/api/user/likes','/api/admin/shutdown','/api/index/rebuild','/api/sync','/api/signup','/api/orders','/api/ai/focus-session','/api/../db/users','/api/%2e%2e/db/users','/api/%252e%252e/db/users','/api/unknown'])for(const method of ['GET','POST','PATCH','DELETE'])assert.ok([403,405].includes((await request(p,method)).status),p);
for(const method of ['POST','PUT','PATCH','DELETE','HEAD','OPTIONS'])assert.equal((await request('/api/me',method)).status,405);
assert.equal(calls,before);
assert.equal((await request('/api/artist/a/stats')).body.totalViews,null);
assert.equal((await request('/api/artist/a/tracks')).body.tracks.length,2);
assert.equal((await request('/api/store/releases?country=kr')).body.total,0);
assert.deepEqual((await request('/api/store/releases/r')).body.comparison.rows,[]);
const projected=project('artists',[{id:'a',password:'hidden',links:{official:{url:'https://example.com',token:'hidden'}},email:'hidden'}]);assert.ok(!JSON.stringify(projected).includes('hidden'));
for(const file of ['server/public/handler.mjs','backend/lib/ko-ja.mjs','backend/lib/pricing.mjs'])assert.doesNotMatch(readFileSync(new URL('../'+file,import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,''),/readFile|writeFile|setInterval|setTimeout|collect-.*\.mjs|build-index/);

// Metadata containers and wrong scalar types must never cross the DTO/manifest boundary.
const privateMarker='ADVERSARIAL_PRIVATE_METADATA';
const container={password:privateMarker,nested:{token:privateMarker,email:privateMarker}};
for(const value of [container,[container],42,true,false,null,undefined]){
 for(const name of ['search-index','catalog'])assert.equal(project(name,{builtAt:value}).builtAt,null);
 const chart=project('charts',{updated:value,countries:{jp:{label:value}}});
 assert.equal(chart.updated,null);assert.equal(chart.countries.jp.label,undefined);
 for(const key of ['updated','builtAt','collectedAt'])assert.equal(sourceTimestamp({[key]:value}),null);
 assert.ok(!JSON.stringify(chart).includes(privateMarker));
}
for(const value of [container,[container],'50',true,null,undefined,NaN,Infinity,-Infinity])assert.equal(project('charts',{limit:value}).limit,undefined);
assert.equal(project('charts',{limit:50}).limit,50);
assert.equal(project('charts',{updated:timestamp,countries:{jp:{label:'Japan'}}}).countries.jp.label,'Japan');
for(const name of ['search-index','catalog'])assert.equal(project(name,{builtAt:timestamp}).builtAt,timestamp);
assert.equal(project('charts',{updated:timestamp}).updated,timestamp);
for(const key of ['updated','builtAt','collectedAt'])assert.equal(sourceTimestamp({[key]:timestamp}),timestamp);
assert.equal(sourceTimestamp({updated:container,builtAt:timestamp,collectedAt:'older'}),timestamp);
assert.equal(sourceTimestamp({updated:timestamp,builtAt:'older'}),timestamp);
assert.equal(sourceTimestamp({updated:'',builtAt:null,collectedAt:timestamp}),timestamp);
assert.equal(sourceTimestamp(null),null);
// The exporter must use the same regression-tested validator, not raw timestamp fallback.
assert.match(readFileSync(new URL('../scripts/export-public-demo.mjs',import.meta.url),'utf8'),/sourceTimestamp:sourceTimestamp\(parsed\)/);

const callsBeforeArtistQuery=calls;
for(const q of ['', '   ', 'x'.repeat(161)]){
 const rejected=await request('/api/artist/a/tracks?q='+encodeURIComponent(q));
 assert.equal(rejected.status,400);assert.equal(rejected.body.code,'INVALID_INPUT');
}
assert.equal((await request('/api/artist/a/tracks?q='+ 'x'.repeat(160))).status,200);
assert.deepEqual((await request('/api/artist/a/tracks?q=%20Song%20')).body.tracks.map(t=>t.id),[123]);
assert.deepEqual((await request('/api/artist/a/tracks?q=Album')).body.tracks.map(t=>t.id),[123,124]);
assert.equal(calls,callsBeforeArtistQuery);
const identityHandler=createPublicHandler({data:{...data,artists:[...data.artists,{id:'b',name:'Other artist'}],catalog:{...data.catalog,artists:{...data.catalog.artists,b:{name:'Other artist',tracks:[{id:222,title:'Song',album:'Album'}]}}}},fetchImpl});
const identityResult=await request('/api/artist/a/tracks?q=Song','GET',undefined,identityHandler);
assert.deepEqual(identityResult.body.tracks,[{...data.catalog.artists.a.tracks[0],artist:'Artist'}]);

// Real fetch responses are capped in decoded bytes, even without or with a false length header.
const upstreamLimit=1024*1024;
async function withFetch(fetcher){return request('/api/catalog/search?term=remote-only','GET',undefined,createPublicHandler({data,fetchImpl:fetcher}));}
const remote={results:[{trackId:456,trackName:'Remote',artistName:'Remote artist'}]};
assert.equal((await withFetch(async()=>new Response(JSON.stringify(remote)))).body.tracks[0].id,456);
const exactLimit=JSON.stringify({...remote,padding:''});
assert.equal((await withFetch(async()=>new Response(exactLimit.replace('"padding":""','"padding":"'+' '.repeat(upstreamLimit-Buffer.byteLength(exactLimit))+'"')))).body.tracks[0].id,456);
let headerCancelled=0,headerRead=0;
assert.deepEqual((await withFetch(async()=>({ok:true,headers:new Headers({'content-length':String(upstreamLimit+1)}),body:{cancel:async()=>headerCancelled++,getReader:()=>{headerRead++;throw new Error('must reject before reading')}}}))).body.tracks,[]);
assert.ok(headerCancelled>0);assert.equal(headerRead,0);
for(const headers of [{},{'content-length':'1'}]){
 let cancelled=0;
 const oversized=await withFetch(async()=>{let chunks=0;return new Response(new ReadableStream({pull(controller){if(chunks++<3)controller.enqueue(new Uint8Array(600000));else controller.close();},cancel(){cancelled++;}}),{headers})});
 assert.deepEqual(oversized.body.tracks,[]);assert.ok(cancelled>0);
}
const multibyte=JSON.stringify({...remote,padding:'界'.repeat(400000)});
assert.ok(multibyte.length<upstreamLimit&&Buffer.byteLength(multibyte)>upstreamLimit);
assert.deepEqual((await withFetch(async()=>new Response(multibyte))).body.tracks,[]);
assert.deepEqual((await withFetch(async()=>({ok:true,json:async()=>JSON.parse(multibyte)}))).body.tracks,[]);
assert.deepEqual((await withFetch(async()=>new Response('invalid json'))).body.tracks,[]);
assert.deepEqual((await withFetch(async()=>new Response('',{status:503}))).body.tracks,[]);

// Canonical FX migration: exact service origin/path, never arbitrary redirect destinations.
const canonicalFX='https://api.frankfurter.dev/v1/2026-06-09..?from=JPY&to=KRW';
for(const allowed of [canonicalFX,'https://itunes.apple.com/search?term=remote','https://itunes.apple.com/lookup?id=999'])assert.equal(isAllowedUpstreamURL(allowed),true,allowed);
for(const denied of [
 'https://api.frankfurter.app/2026-06-09..?from=JPY&to=KRW',
 'https://api.frankfurter.dev/2026-06-09..',
 'https://api.frankfurter.dev/v2/2026-06-09..',
 'https://api.frankfurter.dev/v1/latest',
 'https://api.frankfurter.dev/v1/2026-06-09../extra',
 'https://api.frankfurter.dev/v1/%32%30%32%36-06-09..',
 'https://api.frankfurter.dev.evil.example/v1/2026-06-09..',
 'https://api.frankfurter.dev:444/v1/2026-06-09..',
 'http://api.frankfurter.dev/v1/2026-06-09..',
 'https://user:private@api.frankfurter.dev/v1/2026-06-09..',
 canonicalFX+'#ignored',
 'https://itunes.apple.com/redirect','https://itunes.apple.com.evil.example/search',
 'http://127.0.0.1/search','file:///etc/passwd','not a URL'
])assert.equal(isAllowedUpstreamURL(denied),false,denied);

// Synthetic weekday rates reproduce the observed 64-date response shape, not market values.
const fxNow=Date.parse('2026-09-07T00:00:00Z'),mockRates={};
for(let day=Date.parse('2026-06-09');day<=Date.parse('2026-09-04');day+=864e5){
 const date=new Date(day);if(date.getUTCDay()!==0&&date.getUTCDay()!==6)mockRates[date.toISOString().slice(0,10)]={KRW:8+Object.keys(mockRates).length/100};
}
assert.equal(Object.keys(mockRates).length,64);
const mockFX={amount:1,base:'JPY',start_date:'2026-06-09',end_date:'2026-09-04',rates:mockRates};
const originalFX={date:'2026-09-04',jpyKrw:9.1234,source:'frankfurter.app'};
const fxData={...data,fx:originalFX};
let fxCalls=0;
const fxHandler=createPublicHandler({data:fxData,now:()=>fxNow,fetchImpl:async(url,options)=>{
 fxCalls++;assert.equal(String(url),canonicalFX);
 assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);assert.equal(options.signal.aborted,false);
 assert.deepEqual(options.headers,{accept:'application/json'});
 assert.deepEqual(Object.keys(options).sort(),['headers','redirect','signal']);
 return new Response(JSON.stringify(mockFX));
}});
const fxLive=await request('/api/fx/series?days=90&url=https%3A%2F%2Fevil.example&from=USD&to=EUR','GET',undefined,fxHandler,{authorization:'Bearer test-do-not-forward',cookie:'session=test-do-not-forward'});
assert.equal(fxCalls,1);assert.equal(fxLive.status,200);
assert.deepEqual(fxLive.body,{source:'frankfurter.dev',live:true,base:'JPY',quote:'KRW',days:90,points:Object.entries(mockRates).map(([date,v])=>({date,jpyKrw:v.KRW})),min:8,max:8.63,latest:{date:'2026-09-04',jpyKrw:8.63}});

async function fxWith(fetcher,fixture=fxData){return request('/api/fx/series?days=90','GET',undefined,createPublicHandler({data:fixture,now:()=>fxNow,fetchImpl:fetcher}));}
const expectedFallback={source:originalFX.source,live:false,base:'JPY',quote:'KRW',days:90,points:[{date:originalFX.date,jpyKrw:originalFX.jpyKrw}],min:originalFX.jpyKrw,max:originalFX.jpyKrw,latest:{date:originalFX.date,jpyKrw:originalFX.jpyKrw}};
for(const fetcher of [
 async(_url,options)=>{assert.equal(options.redirect,'error');throw new TypeError('redirect mode is set to error')},
 async()=>new Response(null,{status:301,headers:{location:'https://evil.example/fx'}}),
 async()=>new Response(null,{status:503}),
 async()=>{throw new DOMException('Timed out','TimeoutError')},
 async()=>new Response(JSON.stringify({rates:{}})),
 async()=>new Response(JSON.stringify({...mockFX,padding:' '.repeat(upstreamLimit)}))
]){
 const fallback=await fxWith(fetcher);assert.equal(fallback.status,200);assert.deepEqual(fallback.body,expectedFallback);
}
let redirectedBodyReads=0;
assert.deepEqual((await fxWith(async()=>({ok:true,redirected:true,json:async()=>{redirectedBodyReads++;return mockFX}}))).body,expectedFallback);
assert.equal(redirectedBodyReads,0);
assert.equal((await fxWith(async()=>new Response('{}'),{...fxData,fx:{...originalFX,source:'original-provider'}})).body.source,'original-provider');
assert.deepEqual((await fxWith(async()=>new Response('{}'),{...data,fx:null})).body,{source:'unavailable',live:false,base:'JPY',quote:'KRW',days:90,points:[],min:null,max:null,latest:null});

// Retain the 2.2s fetch timeout and 7.5s request budget; expired requests do not fetch.
const timeoutValues=[],originalTimeout=AbortSignal.timeout;
try{
 AbortSignal.timeout=ms=>{timeoutValues.push(ms);return originalTimeout(ms)};
 await fxWith(async()=>new Response(JSON.stringify(mockFX)));
 let reducedTimeReads=0;
 await request('/api/fx/series','GET',undefined,createPublicHandler({data:fxData,now:()=>fxNow+(reducedTimeReads++===0?0:6500),fetchImpl:async()=>new Response(JSON.stringify(mockFX))}));
 let timeReads=0,budgetFetches=0;
 await request('/api/fx/series','GET',undefined,createPublicHandler({data:fxData,now:()=>fxNow+(timeReads++===0?0:7501),fetchImpl:async()=>{budgetFetches++;throw new Error('budget expired')}}));
 assert.equal(budgetFetches,0);assert.deepEqual(timeoutValues,[2200,1000]);
}finally{AbortSignal.timeout=originalTimeout}

console.log('PASS public API contract, snapshot schema, country/filter, exact ID fallback, limits, strict metadata/manifest scalars, bounded artist queries/upstream bytes, canonical FX allowlist/64-date live series/redirect rejection/fallback provenance/time budget/no forwarded credentials, private/mutation boundaries, no side-effect imports');
