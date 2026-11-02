#!/usr/bin/env node
/** Real renderNews with API/DOM boundary doubles. No network or account writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
const original = fs.readFileSync(new URL('../frontend/src/app/pages/news.ts',import.meta.url),'utf8');
function el(data={}) {const handlers={},attrs={};return {dataset:data,innerHTML:'',textContent:'',hidden:false,classList:{toggle(){}},setAttribute(k,v){attrs[k]=v;},getAttribute:k=>attrs[k],addEventListener(k,fn){handlers[k]=fn;},click(){handlers.click?.();}};}
async function run(source=original){
 let locale='ko',reject=false,live=true;const topics=['','visit','release'].map(topic=>el({topic})),artists=[el({artist:'a'})];
 const nodes={};for(const id of ['#nTools','#nSide','#nList','#nCount','#nMore'])nodes[id]=el();
 nodes['#nTools'].querySelectorAll=()=>topics;nodes['#nSide'].querySelectorAll=()=>artists;
 const root={innerHTML:'',querySelector:s=>nodes[s],querySelectorAll(){return [];}};
 const items=Array.from({length:25},(_,i)=>({id:'news-'+i,title:'news '+i,topics:[i<10?'visit':'release'],artistIds:[i%2?'a':'b']}));
 const dependencies={
 '../../api':{api:async url=>{if(reject)throw Error('offline');return url.includes('/news?')?{items,cache:{}}:{items:[{id:'a',name:'Artist A'}]};}},
 '../state':{state:{edition:'kr'}},'../i18n':{t:k=>k,getLocale:()=>locale},
 '../ui':{esc:x=>String(x),skeletonRows:()=>'',errorState:()=>'<div>retry</div>',emptyState:()=>'<div>empty</div>',freshness:()=>''},
 '../cards':{newsRow:n=>'<li data-news="'+n.id+'"></li>',artistCard:()=>'<a>Artist A</a>'},
 };
 const ctx=vm.createContext({console});const exports={};vm.runInContext('(function(exports,require){'+ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText+'\n})',ctx)(exports,n=>{if(!(n in dependencies))throw Error(n);return dependencies[n];});
 await exports.renderNews(root,()=>live);
 const count=()=> (nodes['#nList'].innerHTML.match(/data-news=/g)||[]).length;
 assert.equal(count(),8,'initial page bounded to 8');assert.equal(nodes['#nMore'].hidden,false);assert.match(nodes['#nCount'].textContent,/25.*8/);
 nodes['#nMore'].click();assert.equal(count(),16);nodes['#nMore'].click();nodes['#nMore'].click();assert.equal(count(),25);assert.equal(nodes['#nMore'].hidden,true);
 topics[1].click();assert.equal(count(),8,'filter resets page');assert.equal(topics[1].getAttribute('aria-pressed'),'true');assert.equal(topics[0].getAttribute('aria-pressed'),'false');
 nodes['#nMore'].click();assert.equal(count(),10);assert.equal(nodes['#nMore'].hidden,true);
 artists[0].click();assert.equal(artists[0].getAttribute('aria-pressed'),'true');assert.equal(count(),5);
 locale='ja';topics[0].click();assert.match(nodes['#nCount'].textContent,/件中/);assert.equal(count(),8);
 artists[0].click();assert.equal(artists[0].getAttribute('aria-pressed'),'false');assert.equal(count(),8);
 reject=true;await exports.renderNews(root,()=>live);assert.match(nodes['#nList'].innerHTML,/retry/);
 live=false;nodes['#nList'].innerHTML='retained';await exports.renderNews(root,()=>live);assert.equal(nodes['#nList'].innerHTML,'retained','stale failure cannot replace newer page');
}
await run();
for(const [label,from,to]of [['unbounded list','rows.slice(0, shown).map(newsRow)','rows.map(newsRow)'],['no filter reset',"topic = b.dataset.topic || '';\n    shown = 8;","topic = b.dataset.topic || '';"],['missing selected state',"x.setAttribute('aria-pressed', String(x === b));",'']]){assert.ok(original.includes(from),label+' mutation valid');await assert.rejects(()=>run(original.replace(from,to)),label+' must fail');}
console.log('PASS news actual-module UI: initial8/more/filter reset/end/selection/localization/offline/stale; 3 old-behavior mutations rejected');
