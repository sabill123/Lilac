import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
let ja=false, passed=0;
const check=(label,fn)=>{fn();passed++;console.log('PASS',label);};
const escapeHtml=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const row=(id,date='2026-10-14')=>({id,series:'mama',seriesName:'MAMA AWARDS',title:id,url:'https://example.org/'+id,source:'News',publishedAt:date,kind:'lineup',editionYear:2026});
// Focus-aware DOM contract: replacing a subtree disconnects it and loses focus;
// moving a node also blurs, matching browser insertBefore behavior.
function harness(href='https://example.org/?edition=jp#/home?keep=ok') {
  const timers=new Map(), requests=[], historyCalls=[];let nextTimer=0;
  const document={activeElement:null,createElement:tag=>new Element(tag)};
  class Element {
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.attrs={};this.listeners=new Map();this.isConnected=true;this.value='';this.hidden=false;this.textContent='';this.html='';this.writes=0;}
    set innerHTML(html){this.writes++;this.html=html;for(const c of this.children)c.disconnect();this.children=[];}
    get innerHTML(){return this.html;}
    get firstElementChild(){return this.children[0];}
    disconnect(){this.isConnected=false;if(document.activeElement===this)document.activeElement=null;for(const c of this.children)c.disconnect();}
    append(child){this.insertBefore(child,null);}
    insertBefore(child,before){if(child.parent){child.parent.children.splice(child.parent.children.indexOf(child),1);if(document.activeElement===child || document.activeElement===child.firstElementChild)document.activeElement=null;}const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,child);child.parent=this;child.isConnected=true;}
    remove(){this.parent?.children.splice(this.parent.children.indexOf(this),1);this.disconnect();}
    setAttribute(k,v){this.attrs[k]=v;}
    focus(){document.activeElement=this;}
    closest(selector){return this.selector===selector?this:null;}
    addEventListener(type,fn,opts){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);opts?.signal?.addEventListener('abort',()=>this.listeners.get(type).delete(fn),{once:true});}
    emit(type,target){for(const fn of this.listeners.get(type)||[])fn({target});}
  }
  class Select extends Element {}
  const box=new Element(), elements={};
  for(const key of ['series','kind','source'])elements[`[data-award-${key}]`]=new Select('select');
  for(const key of ['checked','status','more','retry','official'])elements[`[data-award-${key}]`]=new Element();
  elements['.award-notice-list']=new Element('ul');elements['#award-result-count']=new Element();
  const setHtml=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML').set;
  Object.defineProperty(box,'innerHTML',{set(html){setHtml.call(this,html);for(const e of Object.values(elements))e.disconnect();for(const e of Object.values(elements))e.isConnected=true;},get(){return this.html;}});
  box.querySelector=q=>elements[q];
  for(const [selector,e]of Object.entries(elements))e.selector=selector;
  const window={location:{href},history:{state:{scroll:82},replaceState(state,title,url){historyCalls.push({state,title,url});window.location.href=url;}}};
  const exports={};
  const js=ts.transpileModule(readFileSync(new URL('../frontend/src/awards/live.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2023}}).outputText;
  vm.runInNewContext(js,{exports,URL,URLSearchParams,Intl,Date,document,window,HTMLSelectElement:Select,setTimeout:(fn,delay)=>{timers.set(++nextTimer,{fn,delay});return nextTimer;},clearTimeout:id=>timers.delete(id),require(p){if(p==='../api')return{api:(url,opts)=>new Promise((resolve,reject)=>requests.push({url,signal:opts.signal,resolve,reject}))};if(p==='./i18n')return{isJa:()=>ja};if(p==='./view')return{escapeHtml};if(p==='./model')return{safeUrl:v=>{try{const u=new URL(v);return /^https?:$/.test(u.protocol)?u.href:'';}catch{return'';}}};throw Error(p);}});
  const abort=new AbortController();
  return {exports,document,window,box,elements,requests,timers,historyCalls,abort,mount:()=>exports.mountAwardsUpdates({querySelector:()=>box},abort.signal),change(key,value){const e=elements[`[data-award-${key}]`];e.value=value;e.focus();box.emit('change',e);},click(key){box.emit('click',elements[`[data-award-${key}]`]);},poll(){const [id,timer]=[...timers][0];timers.delete(id);timer.fn();}};
}
const tick=()=>new Promise(r=>setImmediate(r));
const h=harness(), api=h.exports;
check('sort dates, unknown last and +09 day boundary',()=>{const html=api.awardNoticeRows([row('older','2026-09-01'),row('unknown',null),row('day','2026-10-14'),row('timed','2026-10-13T16:00:00Z')]);assert.ok(html.indexOf('>timed<')<html.indexOf('>day<'));assert.ok(html.indexOf('>older<')<html.indexOf('>unknown<'));});
check('escape untrusted text and reject unsafe links',()=>{const html=api.awardNoticeRows([{...row('x',null),title:'<script>x</script>',url:'javascript:alert(1)',stale:true}]);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('href="javascript:'));assert.match(html,/발표일 미확인/);assert.match(html,/갱신 실패/);});
check('URL roundtrip preserves route, document query, unrelated hash params',()=>{const url=api.awardFiltersUrl(h.window.location.href,{series:'a&b',kind:'lineup',source:'official'});const parsed=new URL(url);assert.equal(parsed.search,'?edition=jp');assert.match(parsed.hash,/^#\/home\?keep=ok&/);assert.equal(api.awardFiltersFromUrl(url).series,'a&b');assert.equal(api.awardFiltersFromUrl(url).source,'official');assert.equal(api.awardFiltersFromUrl('https://example.org/#/?awardSource=bogus').source,'');const cleared=api.awardFiltersUrl(url,{series:'',kind:'',source:''});assert.equal(cleared,h.window.location.href);});
check('all recognized facets shown once; unknown array IDs ignored and fallback escaped',()=>{const mixed=api.awardNoticeRows([{...row('mixed'),kind:'results',kinds:['results','lineup','lineup','<img src=x>','constructor']}]);assert.match(mixed,/수상 결과 \/ 출연 발표/);assert.equal((mixed.match(/출연 발표/g)||[]).length,1);assert.ok(!mixed.includes('&lt;img'));assert.ok(!mixed.includes('constructor'));const vtr=api.awardNoticeRows([{...row('vtr'),kind:'news',kinds:['appearance']}]);assert.match(vtr,/VTR·게스트·진행/);assert.ok(!vtr.includes('관련 소식'));const fallback=api.awardNoticeRows([{...row('fallback'),kind:'schedule',kinds:['unknown']}]);assert.match(fallback,/일정·예매/);assert.ok(!fallback.includes('unknown'));const unsafe=api.awardNoticeRows([{...row('fallback'),kind:'<script>kind</script>',kinds:[]}]);assert.match(unsafe,/&lt;script&gt;kind&lt;\/script&gt;/);});
check('empty hash gets canonical home route and filters restore from current URL',()=>{const start='https://example.org/?edition=jp';const current=api.awardFiltersUrl(start,{series:'mama',kind:'appearance',source:'official'});assert.match(new URL(current).hash,/^#\/\?awardSeries=/);assert.equal(new URL(current).search,'?edition=jp');assert.equal(api.awardFiltersFromUrl(current).kind,'appearance');assert.equal(api.awardFiltersFromUrl(current).source,'official');const cleared=api.awardFiltersUrl(current,{series:'',kind:'',source:''});assert.equal(cleared,start+'#/');});
ja=true;check('Japanese chrome and appearance kind',()=>{assert.match(api.awardsUpdatesHtml(),/アワード最新発表/);assert.match(api.awardNoticeRows([{...row('vtr'),kind:'appearance'}]),/VTR・ゲスト・司会/);});ja=false;
h.mount();
check('loading shell exists before response and request is abortable',()=>{assert.equal(h.requests[0].signal,h.abort.signal);assert.match(h.elements['[data-award-status]'].textContent,/확인 중/);assert.equal(h.timers.size,0);});
const feed={items:[...Array.from({length:10},(_,i)=>({...row('notice'+i),provider:i%2?'google:press':'official:mama'})),{...row('mixed'),kind:'results',kinds:['results','lineup'],provider:'official:mama'},{...row('vtr'),kind:'appearance',kinds:['appearance'],provider:'official:mama'}],sources:[],series:[{id:'mama',name:'MAMA',officialUrl:'https://example.org/'}]};
h.requests[0].resolve(feed);await tick();
const list=h.elements['.award-notice-list'], controls=h.elements['[data-award-series]'], more=h.elements['[data-award-more]'];
check('result counts and 60s polling after successful response',()=>{assert.equal(list.children.length,8);assert.match(h.elements['#award-result-count'].textContent,/12건/);assert.equal([...h.timers.values()][0].delay,60000);});
h.click('more');controls.focus();const controlWrites=controls.writes, firstLink=list.children[0].firstElementChild;
h.poll();h.requests.at(-1).resolve({...feed,checkedAt:'2026-10-14T00:00:00Z'});await tick();
check('poll preserves expanded list, controls identity/options/focus and keyed links',()=>{assert.equal(list.children.length,12);assert.equal(more.attrs['aria-expanded'],'true');assert.equal(controls.writes,controlWrites);assert.equal(h.box.writes,1);assert.equal(h.document.activeElement,controls);assert.equal(list.children[0].firstElementChild,firstLink);});
firstLink.focus();h.poll();h.requests.at(-1).resolve({...feed,items:feed.items.map(x=>({...x,title:x.title+' updated'}))});await tick();
check('updated article retains actual focused anchor',()=>{assert.equal(list.children[0].firstElementChild,firstLink);assert.equal(h.document.activeElement,firstLink);assert.match(firstLink.innerHTML,/updated/);});
h.change('source','official');h.change('kind','lineup');
check('official + facet filters combine, preserve focus and URL history state',()=>{assert.equal(list.children.length,6);assert.equal(h.document.activeElement,h.elements['[data-award-kind]']);assert.equal(more.attrs['aria-expanded'],'false');assert.equal(h.historyCalls.at(-1).state,h.window.history.state);assert.match(h.window.location.href,/keep=ok/);assert.match(h.window.location.href,/awardSource=official/);});
const restored=harness(h.window.location.href);restored.mount();restored.requests[0].resolve(feed);await tick();
check('refresh restores series/kind/source filters',()=>{assert.equal(restored.elements['[data-award-source]'].value,'official');assert.equal(restored.elements['[data-award-kind]'].value,'lineup');assert.equal(restored.elements['.award-notice-list'].children.length,6);});restored.abort.abort();
h.poll();h.requests.at(-1).reject(new Error('offline'));await tick();
check('refresh failure retains last rows, visible warning and retry',()=>{assert.equal(list.children.length,6);assert.match(h.elements['[data-award-status]'].textContent,/마지막으로/);assert.equal(h.elements['[data-award-retry]'].hidden,false);assert.equal([...h.timers.values()][0].delay,60000);});
h.click('retry');h.click('retry');
check('manual retry clears timer and prevents overlapping requests',()=>{assert.equal(h.timers.size,0);assert.equal(h.requests.length,5);});
h.requests.at(-1).resolve({...feed,pending:true,cache:{state:'stale'},sources:[{provider:'failed',ok:false}]});await tick();
check('pending stale partial source failures visible and quick poll',()=>{assert.equal([...h.timers.values()][0].delay,5000);assert.match(h.elements['[data-award-status]'].textContent,/이전 수집/);assert.match(h.elements['[data-award-status]'].textContent,/일부 발표/);});
h.change('series','missing');
check('empty filtered result is explicit and count is zero',()=>{assert.equal(list.children.length,0);assert.match(h.elements['#award-result-count'].textContent,/0건/);});
h.abort.abort();const oldUrl=h.window.location.href;h.change('source','press');
check('abort clears timer and listeners',()=>{assert.equal(h.timers.size,0);assert.equal(h.window.location.href,oldUrl);});
const late=harness();late.mount();late.abort.abort();const before=late.elements['[data-award-status]'].textContent;late.requests[0].resolve(feed);await tick();
check('late response cannot repaint unmounted view or schedule polling',()=>{assert.equal(late.elements['[data-award-status]'].textContent,before);assert.equal(late.elements['.award-notice-list'].children.length,0);assert.equal(late.timers.size,0);});
const broken=harness();broken.mount();broken.requests[0].reject(Error('offline'));await tick();
check('initial failure has visible retry, stable controls and recovery',()=>{assert.equal(broken.box.writes,1);assert.equal(broken.elements['[data-award-retry]'].hidden,false);assert.match(broken.elements['[data-award-status]'].textContent,/불러오지/);});broken.click('retry');broken.requests.at(-1).resolve({items:[],sources:[]});await tick();
check('empty successful response does not imply no announcement exists',()=>{assert.match(broken.elements['[data-award-status]'].textContent,/아직 발표되지 않았다는 뜻은 아닙니다/);assert.equal(broken.elements['[data-award-retry]'].hidden,true);});broken.abort.abort();
const boundary=harness();boundary.mount();
const boundaryFeed={items:Array.from({length:10},(_,i)=>row(`boundary${String(i).padStart(2,'0')}`)),sources:[]};
boundary.requests[0].resolve(boundaryFeed);await tick();
const boundaryList=boundary.elements['.award-notice-list'], eighth=boundaryList.children[7].firstElementChild;
eighth.focus();const nextItems=[row('brand-new','2026-10-15'),...boundaryFeed.items];boundary.poll();boundary.requests.at(-1).resolve({items:nextItems,sources:[]});await tick();
check('poll prepending announcement retains focused eighth as ninth without expanding all',()=>{assert.equal(boundaryList.children.length,9);assert.equal(boundaryList.children[8].firstElementChild,eighth);assert.equal(boundary.document.activeElement,eighth);assert.match(boundaryList.children[0].firstElementChild.innerHTML,/brand-new/);assert.equal(boundary.elements['[data-award-more]'].attrs['aria-expanded'],'false');assert.match(boundary.elements['#award-result-count'].textContent,/9건 표시/);});
boundary.poll();boundary.requests.at(-1).resolve({items:nextItems,sources:[]});await tick();
check('focused out-of-window article survives subsequent unchanged poll',()=>{assert.equal(boundaryList.children.length,9);assert.equal(boundary.document.activeElement,eighth);});
boundary.poll();boundary.requests.at(-1).resolve({items:nextItems.filter(x=>x.id!=='boundary07'),sources:[]});await tick();
check('article removed from feed transfers focus to result count with explicit explanation',()=>{assert.equal(eighth.isConnected,false);assert.equal(boundaryList.children.length,8);assert.equal(boundary.document.activeElement,boundary.elements['#award-result-count']);assert.match(boundary.elements['[data-award-status]'].textContent,/최신 목록에서 제외되어 결과 건수로 이동/);assert.match(boundary.box.innerHTML,/id="award-result-count" tabindex="-1"/);});
const remainingLink=boundaryList.children[0].firstElementChild;remainingLink.focus();boundary.poll();boundary.requests.at(-1).resolve({items:[],sources:[]});await tick();
check('entire feed becoming empty also transfers article focus meaningfully',()=>{assert.equal(boundaryList.children.length,0);assert.equal(boundary.document.activeElement,boundary.elements['#award-result-count']);assert.match(boundary.elements['#award-result-count'].textContent,/0건 표시/);});boundary.abort.abort();
console.log(`${passed} awards UI checks passed`);
