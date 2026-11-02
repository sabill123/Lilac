#!/usr/bin/env node
/** Execute the actual page modules with DOM/API boundary doubles. Never contacts a server. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
const source = file => fs.readFileSync(new URL('../frontend/src/app/pages/'+file,import.meta.url),'utf8');
function el(dataset={}) { const handlers={}, attrs={};return {dataset,innerHTML:'',textContent:'',value:'',hidden:false,disabled:false,focused:false,classList:{toggle(){}},addEventListener(k,fn){handlers[k]=fn;},setAttribute(k,v){attrs[k]=v;},removeAttribute(k){delete attrs[k];},getAttribute:k=>attrs[k],focus(){this.focused=true;},fire(k){handlers[k]?.({preventDefault(){}});},click(){this.fire('click');},querySelector(){return null;}}; }
function load(text,deps){const ctx=vm.createContext({console,Date,location:{hash:''}}),exports={};vm.runInContext('(function(exports,require){'+ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText+'\n})',ctx)(exports,n=>{if(!(n in deps))throw Error('Unknown dependency '+n);return deps[n];});return exports;}
const ui={esc:v=>String(v??''),icon:()=>'',img:()=>'',money:v=>String(v),fmtDateTime:()=>'',safeImage:()=>'',skeletonRows:()=>'<i>loading</i>',emptyState:(s,action='')=>`<div class="empty">${s}${action}</div>`,errorState:()=>'<div class="error">retry</div>',freshness:()=>''};
async function fanclub(text=source('fanclub.ts')) {
 const nodes=Object.fromEntries(['#fcpBody','#fcQuery','#fcReset','.fc-result-count','.fc-filter-empty'].map(k=>[k,el()]));
 const buttons=['all','ovs','open'].map(f=>el({f}));const cards=[el({search:'alpha one',ovs:'yes',open:'1'}),el({search:'beta two',ovs:'no',open:'0'})];
 const root={innerHTML:'',querySelector:k=>nodes[k],querySelectorAll:k=>k==='[data-f]'?buttons:k==='.fct'?cards:[]};let offline=false;
 const deps={'./_safety':{safeExternal:v=>v},'../../api':{api:async url=>{if(offline)throw Error('offline');return url.includes('fanclub-list')?{items:[{found:true,artistId:'a',artist:'Alpha',platform:'generic'},{found:true,artistId:'b',artist:'Beta',platform:'generic'}]}:url.includes('fanclubs')?{windows:[]}:{}}},'../state':{state:{edition:'kr'},buyerCurrency:()=> 'JPY'},'../i18n':{t:k=>k,getLocale:()=> 'ko'},'../ui':ui,'../cards':{ticketRow:()=>''},'../fanclub':{approx:()=>''},'../fcguide':{platformOf:()=> 'generic',payKo:()=>[],clubName:()=>'',PLATFORM_NAME:{generic:'Generic'}},'../fcknow':{platKey:()=>null,PLATFORM_KNOW:{}}};
 const mod=load(text,deps);await mod.renderFanclubPage(root,()=>true);
 assert.equal(nodes['#fcReset'].disabled,true);assert.match(nodes['.fc-result-count'].textContent,/전체 2개 중 2개/);
 buttons[1].click();assert.equal(cards[1].hidden,true);assert.equal(nodes['#fcReset'].disabled,false);assert.match(nodes['.fc-result-count'].textContent,/fc.overseas.yes2/);
 nodes['#fcQuery'].value='ALPHA';nodes['#fcQuery'].fire('input');assert.equal(cards[0].hidden,false);
 nodes['#fcQuery'].value='no match';nodes['#fcQuery'].fire('input');assert.equal(nodes['.fc-filter-empty'].hidden,false);assert.match(nodes['.fc-result-count'].textContent,/no match.*0개/);
 nodes['#fcReset'].click();assert.equal(nodes['#fcQuery'].value,'');assert.equal(cards[1].hidden,false);assert.equal(nodes['.fc-filter-empty'].hidden,true);assert.equal(nodes['#fcQuery'].focused,true);
 assert.equal((nodes['#fcpBody'].innerHTML.match(/id="fcReset"/g)||[]).length,1);
 offline=true;await mod.renderFanclubPage(root,()=>true);assert.match(nodes['#fcpBody'].innerHTML,/class="error"/);assert.doesNotMatch(nodes['#fcpBody'].innerHTML,/class="empty"/);
 nodes['#fcpBody'].innerHTML='newer';await mod.renderFanclubPage(root,()=>false);assert.equal(nodes['#fcpBody'].innerHTML,'newer');
}
async function news(){const text=source('news.ts'),nodes=Object.fromEntries(['#nTools','#nSide','#nList','#nCount','#nMore','#nReset'].map(k=>[k,el()])),topics=['','visit','release'].map(topic=>el({topic})),artists=[el({artist:'a'})];nodes['#nTools'].querySelectorAll=()=>topics;nodes['#nSide'].querySelectorAll=()=>artists;const root={innerHTML:'',querySelector:k=>nodes[k]};
 const items=Array.from({length:20},(_,i)=>({id:String(i),topics:[i<10?'visit':'release'],artistIds:[i<10?'a':'b']}));
 const mod=load(text,{'../../api':{api:async u=>u.includes('/news?')?{items}:{items:[{id:'a',name:'Actual artist'}]}},'../state':{state:{edition:'kr'}},'../i18n':{t:k=>k,getLocale:()=> 'ko'},'../ui':ui,'../cards':{newsRow:n=>`<li data-id="${n.id}"></li>`,artistCard:()=>'<a>Actual artist</a>'}});
 await mod.renderNews(root,()=>true);const rows=()=> (nodes['#nList'].innerHTML.match(/data-id=/g)||[]).length;
 assert.equal(rows(),8);nodes['#nMore'].click();assert.equal(rows(),16);topics[2].click();artists[0].click();assert.equal(rows(),0);assert.match(nodes['#nCount'].textContent,/Actual artist/);assert.equal(nodes['#nReset'].disabled,false);nodes['#nReset'].click();assert.equal(rows(),8);assert.equal(nodes['#nReset'].disabled,true);assert.equal(artists[0].getAttribute('aria-pressed'),'false');assert.equal(topics[0].getAttribute('aria-pressed'),'true');assert.doesNotMatch(nodes['#nCount'].textContent,/Actual artist/);
}
async function searchAndAuth(){let query='absent',offline=false,locale='ko';const body=el(),form=el();form.querySelector=()=>el();const root={innerHTML:'',querySelector:k=>k==='#sBody'?body:form};
 const mod=load(source('misc.ts'),{'../../api':{api:async()=>{if(offline)throw Error('offline');return {artists:[],concerts:[],releases:[]};}},'../state':{state:{edition:'kr'},onChange:()=>{}},'../i18n':{t:(k,v)=>k+(v?.q||''),getLocale:()=>locale},'../ui':{...ui,params:()=>new URLSearchParams({q:query}),toast:()=>{}},'../cm-i18n':{ct:k=>k},'../cards':{}});
 await mod.renderSearch(root,()=>true);for(const route of ['artists','concerts','releases'])assert.ok(body.innerHTML.includes(`href="#/${route}"`));assert.match(body.innerHTML,/검색어|표기/);assert.doesNotMatch(body.innerHTML,/trending/i);
 offline=true;await mod.renderSearch(root,()=>true);assert.match(body.innerHTML,/class="error"/);assert.doesNotMatch(body.innerHTML,/browse-search-recovery/);
 for(const language of ['ko','ja'])for(const mode of ['login','signup']){locale=language;mod.renderAuth(root,mode);assert.match(root.innerHTML,/id="authScope"/);assert.match(root.innerHTML,/aria-describedby="authScope"/);assert.match(root.innerHTML,/href="#\/artists"/);assert.match(root.innerHTML,/autocomplete="(?:current|new)-password"/);}
}
await fanclub();await news();await searchAndAuth();
for(const [label,from,to]of [['reset leaves query',"search.value = ''; apply();",'apply();'],['search ignores case',"search.value.trim().normalize('NFKC').toLocaleLowerCase()",'search.value.trim()']]){const text=source('fanclub.ts');assert.ok(text.includes(from));await assert.rejects(()=>fanclub(text.replace(from,to)),label+' must be detected');}
console.log('PASS browse actual modules: fanclub search/filter/reset/empty/error/stale; news combined filter/count/reset/pagination; search real recovery/error; KO/JA auth boundary; 2 regressions detected. No network/account writes.');
