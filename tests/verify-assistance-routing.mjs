import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createLiveService} from '../backend/lib/live/service.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'lilac-assistance-routes-'));
const routes=new Map();let calls=[];
const svc=createLiveService({dbDir:dir,readJson:async key=>key==='releases'?[{artist:'Source Artist',offers:[{url:'https://shop.example/products/verified'}]}]:[],getCharts:async()=>({}),assistanceCollector:async input=>{calls.push(input);return {status:'ok',url:input.url,title:'Verified product',fetchedAt:'2026-01-01T00:00:00Z',evidence:[]};}});
svc.register({get:(url,fn)=>routes.set(url,fn),post(){}});
async function get(query){let status=200,body,headers;await routes.get('/api/live/assistance')({query},{set:(...h)=>{headers=h},status:s=>{status=s;return {json:x=>{body=x}}},json:x=>{body=x}});return {status,body,headers};}
try{
 const missing=await get({kind:'purchase',url:'https://shop.example/products/guessed'});assert.equal(missing.status,404);assert.equal(calls.length,0);
 const poisoned=await get({kind:'purchase',url:'https://shop.example/products/verified?token=secret'});assert.equal(poisoned.status,404);assert.equal(calls.length,0);
 const badkind=await get({kind:'unknown',url:'https://shop.example/products/verified'});assert.equal(badkind.status,404);
 const success=await get({kind:'purchase',url:'https://shop.example/products/verified',artistName:'Wrong artist'});assert.equal(success.status,200);assert.equal(calls.length,1);assert.equal(calls[0].artistName,'Source Artist');assert.equal(calls[0].kind,'goods');assert.equal(success.headers[1],'private, no-store');
 const cached=await get({kind:'purchase',url:'https://shop.example/products/verified'});assert.equal(cached.status,200);assert.equal(calls.length,1);assert.equal(cached.body.cache.state,'cached');
 console.log('PASS assistance routing: existing exact source only, guessed/query-poisoned rejection, server-owned artist, collector mapping, no-store, bounded reuse');
}finally{svc.dispose();await rm(dir,{recursive:true,force:true});}
