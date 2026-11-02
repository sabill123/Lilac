import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {createLiveService} from '../backend/lib/live/service.mjs';
import {flushAllKv} from '../backend/lib/live/cache.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'lilac-portrait-routes-'));
const rows=Array.from({length:6},(_,i)=>({id:'artist-'+i,name:'Artist '+i,origin:'jp',country:'jp',links:{official:{url:'http://artist'+i+'.example/'}}}));
let calls=[],active=0,peak=0,fail=false;const routes=new Map();const realNow=Date.now;
const svc=createLiveService({dbDir:dir,readJson:async key=>key==='artists'?rows:[],getCharts:async()=>({}),portraitCollector:async input=>{calls.push(input);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,10));active--;return fail?{artistId:input.artistId,status:'unavailable',reason:'network_failed'}:{artistId:input.artistId,status:'verified',imageUrl:input.officialUrl+'portrait.jpg',sourceUrl:input.officialUrl+'profile',checkedAt:new Date(Date.now()).toISOString(),method:'official-profile'};}});
svc.register({get:(url,fn)=>routes.set(url,fn),post(){}});
async function get(query,originalUrl){let status=200,body;const res={set(){return res},status(s){status=s;return res},json(x){body=x;return res}};await routes.get('/api/live/portraits')({query,originalUrl},res);return{status,body};}
try{
 assert.equal((await get({})).status,400);assert.equal((await get({ids:Array(13).fill('artist-0').join(',')})).status,400);
 assert.equal((await get({ids:'artist-0,unknown'})).status,404);assert.equal(calls.length,0);
 const ids=rows.map(a=>a.id).join(',');const [one,two]=await Promise.all([get({ids,officialUrl:'https://wrong.invalid'}),get({ids})]);
 assert.equal(one.status,200);assert.equal(two.status,200);assert.equal(calls.length,6);assert.equal(peak,3);
 assert.ok(calls.every(x=>x.officialUrl===`https://artist${x.artistId.split('-')[1]}.example/`));assert.ok(calls.every(x=>x.names.includes('Artist '+x.artistId.split('-')[1])));
 assert.ok(one.body.items.every(x=>x.portrait.artistId===x.id));
 const initial=one.body.items[0].portrait.checkedAt;await get({ids:'artist-0'});assert.equal(calls.length,6);
 Date.now=()=>realNow()+2*86400000;fail=true;const stale=await get({ids:'artist-0'});assert.equal(stale.body.items[0].portrait,null);assert.equal(calls.length,7);
 await get({ids:'artist-0'});assert.equal(calls.length,7);await flushAllKv();
 const cache=JSON.parse(await readFile(path.join(dir,'live-cache','kv-official-portraits.json'),'utf8'));assert.equal(cache['artist-0'].checkedAt,initial);assert.equal(cache['artist-0'].firstSeenAt,initial);assert.equal(cache['artist-0'].lastError,'network_failed');
 fail=false;rows[0].links.official.url='https://replacement.example/';const changed=await get({ids:'artist-0'});assert.equal(changed.body.items[0].portrait.sourceUrl,'https://replacement.example/profile');assert.equal(calls.length,8);
 rows.push({id:'odd,/&',name:'Odd Artist',origin:'jp',country:'jp',links:{official:{url:'https://odd.example/'}}});Date.now=()=>realNow()+2*86400000+6*60000;const special=await get({ids:'odd,/&'},'/api/live/portraits?ids=odd%2C%2F%26');assert.equal(special.status,200);assert.equal(special.body.items[0].id,'odd,/&');assert.ok(special.body.items[0].portrait);
 console.log('PASS portrait routes: exact roster ownership, HTTPS seed, query URL ignored, 12-bound, dedupe, concurrency3, 24h freshness, failed recheck preserves observation date, source change invalidates cache');
}finally{Date.now=realNow;svc.dispose();await flushAllKv();await rm(dir,{recursive:true,force:true});}
