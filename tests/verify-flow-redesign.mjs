/** Real transpiled fx.ts; deterministic DOM/event/scheduler boundaries, no network or backend. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
let clock = 1000, seq = 0;
const frames = new Map(), timers = new Map(), mutations = [], resizes = [], intersections = [];
class El {
  listeners = new Map(); dataset = {}; style = { setProperty(k,v) { this[k]=v; } }; attrs = {};
  isConnected = true; clientWidth = 390; scrollWidth = 1000; captured = new Set(); releases = 0;
  classList = { add(){}, remove(){} }; offsetWidth = 390;
  addEventListener(type, fn, options={}) {
    if(options.signal?.aborted)return;
    const set=this.listeners.get(type)||new Set();set.add(fn);this.listeners.set(type,set);
    options.signal?.addEventListener('abort',()=>set.delete(fn),{once:true});
  }
  removeEventListener(t,f){this.listeners.get(t)?.delete(f);}
  emit(type,data={}){const e={button:0,pointerId:1,clientX:100,clientY:10,target:this,prevented:false,preventDefault(){this.prevented=true;},...data};for(const fn of [...(this.listeners.get(type)||[])])fn(e);return e;}
  setAttribute(k,v){this.attrs[k]=v;}
  setPointerCapture(id){this.captured.add(id);}
  hasPointerCapture(id){return this.captured.has(id);}
  releasePointerCapture(id){this.captured.delete(id);this.releases++;this.emit('lostpointercapture',{pointerId:id});}
  contains(el){return this===el||this.children?.includes(el);}
  matches(){return false;}
  closest(){return this.card||null;}
  count(){return [...this.listeners.values()].reduce((n,s)=>n+s.size,0);}
}
const media = new El();media.matches=false;
const doc = new El();doc.body = new El();doc.hidden=false;doc.activeElement=null;
const loc = { hash:'' };
class MO{constructor(cb){this.cb=cb;mutations.push(this);}observe(){}disconnect(){this.disconnected=true;}}
class RO{constructor(cb){this.cb=cb;resizes.push(this);}observe(){}disconnect(){this.disconnected=true;}}
class IO{constructor(cb){this.cb=cb;intersections.push(this);}observe(){}disconnect(){this.disconnected=true;}}
const env={exports:{},require:()=>({getLocale:()=> 'ko'}),document:doc,location:loc,AbortController,
  matchMedia:()=>media,performance:{now:()=>clock},console,MutationObserver:MO,ResizeObserver:RO,IntersectionObserver:IO,
  requestAnimationFrame:fn=>{const id=++seq;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
  setTimeout:fn=>{const id=++seq;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),};env.window=env;
const source=fs.readFileSync(process.env.FX_SOURCE||new URL('../frontend/src/app/fx.ts',import.meta.url),'utf8');
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,env);
const {bindCoverFlow,bindMarquee}=env.exports;
const step=()=>{clock+=16;const q=[...frames];frames.clear();for(const [,fn]of q)fn(clock);};
const flush=()=>{for(let n=0;n<300&&frames.size;n++)step();assert.equal(frames.size,0,'bounded animation settles');};
function cover(){const box=new El(),stage=new El(),cap=new El(),title=new El(),sub=new El(),buttons=[new El(),new El()];const cards=Array.from({length:6},(_,i)=>{const e=new El();e.dataset.cf=String(i);e.card=e;return e;});buttons[0].dataset.cfStep='-1';buttons[1].dataset.cfStep='1';cap.querySelector=s=>s==='b'?title:sub;box.querySelector=s=>s==='.fx-cf-cap'?cap:s==='.fx-cf-stage'?stage:null;box.querySelectorAll=s=>s==='.fx-cf-card'?cards:s==='[data-cf-step]'?buttons:[];const root={querySelector:()=>box};const ctrl=new AbortController();bindCoverFlow(root,cards.map((_,i)=>({title:'Album '+i,sub:'Artist',href:'#/album/'+i})),ctrl.signal);return{box,stage,cap,cards,ctrl,title};}
let f=cover();assert.equal(f.title.textContent,'Album 3');
f.stage.emit('pointerdown',{target:f.cards[3]});f.stage.emit('pointercancel');assert.equal(loc.hash,'','cancelled tap must not navigate');flush();
f.stage.emit('pointerdown',{target:f.cards[3]});f.stage.emit('pointermove',{clientX:104,clientY:70});f.stage.emit('pointerup',{target:f.cards[3]});assert.equal(loc.hash,'','vertical swipe must not navigate');assert.equal(f.stage.captured.size,0);
f.stage.emit('pointerdown',{target:f.cards[3]});f.stage.emit('pointerup',{target:f.cards[3]});assert.equal(loc.hash,'/album/3','positive control: ordinary selected-card tap navigates');loc.hash='';
f.stage.emit('pointerdown',{target:f.cards[3]});f.stage.emit('pointermove',{clientX:45,clientY:12});assert.equal(f.stage.captured.size,1);f.stage.emit('pointercancel');assert.equal(loc.hash,'');assert.equal(f.stage.captured.size,0);assert.equal(f.stage.releases,1);flush();
media.matches=true;media.emit('change');const before=Number(f.cards.find(c=>c.attrs['aria-selected']==='true').dataset.cf);const wheel=f.box.emit('wheel',{deltaX:-45,deltaY:0,shiftKey:false});assert.ok(wheel.prevented);assert.equal(Number(f.cards.find(c=>c.attrs['aria-selected']==='true').dataset.cf),Math.max(before-1,0));assert.equal(frames.size,0,'reduced-motion wheel is immediate');assert.equal(timers.size,0);
media.matches=false;media.emit('change');f.box.emit('wheel',{deltaX:50,deltaY:0,shiftKey:false});assert.ok(frames.size);assert.ok(timers.size);media.matches=true;media.emit('change');assert.equal(frames.size,0);assert.equal(timers.size,0,'motion change cancels pending snap');
f.ctrl.abort();assert.equal(f.box.count()+f.stage.count(),0);assert.equal(frames.size,0);assert.equal(timers.size,0);assert.ok(resizes.at(-1).disconnected);assert.ok(mutations.at(-1).disconnected);
// Goods caller supplies no signal; DOM removal still releases all owned resources.
const detached=new El(),stage2=new El(),cap2=new El();cap2.querySelector=()=>new El();detached.querySelector=s=>s==='.fx-cf-stage'?stage2:cap2;detached.querySelectorAll=()=>[];bindCoverFlow({querySelector:()=>detached},[]);detached.isConnected=false;mutations.at(-1).cb([]);assert.ok(resizes.at(-1).disconnected);assert.ok(mutations.at(-1).disconnected);assert.equal(detached.count()+stage2.count(),0);
function marquee(){const box=new El(),row=new El(),link=new El();row.children=[link];box.querySelectorAll=()=>[row];const ctrl=new AbortController();bindMarquee(box,ctrl.signal);return{box,row,link,ctrl};}
media.matches=true;const m=marquee();assert.equal(frames.size,0);
m.box.emit('pointerdown',{target:m.link});m.box.emit('pointermove',{target:m.link,clientX:103,clientY:70});m.box.emit('pointerup');assert.ok(m.box.emit('click').prevented,'vertical gesture does not click artist');
clock+=300;m.box.emit('pointerdown',{target:m.link});m.box.emit('pointercancel');assert.ok(m.box.emit('click').prevented,'cancelled gesture blocks click');
clock+=300;m.box.emit('pointerdown',{target:m.link});m.box.emit('pointermove',{target:m.link,clientX:55,clientY:11});assert.ok(m.box.dataset.dragging!==undefined);const transform=m.row.style.transform;assert.ok(transform,'reduced-motion dragging paints without animation');m.box.emit('pointerup');assert.equal(m.box.captured.size,0);assert.ok(m.box.emit('click').prevented);
media.matches=false;media.emit('change');assert.ok(frames.size);step();doc.hidden=true;doc.emit('visibilitychange');assert.equal(frames.size,0,'hidden document has no perpetual marquee loop');doc.hidden=false;doc.emit('visibilitychange');assert.ok(frames.size);intersections.at(-1).cb([{isIntersecting:false}]);assert.equal(frames.size,0,'offscreen loop stops');intersections.at(-1).cb([{isIntersecting:true}]);assert.ok(frames.size);media.matches=true;media.emit('change');assert.equal(frames.size,0,'runtime reduced-motion stops loop');
m.box.isConnected=false;mutations.at(-1).cb([]);assert.equal(m.box.count(),0);assert.ok(resizes.at(-1).disconnected);assert.ok(intersections.at(-1).disconnected);assert.ok(mutations.at(-1).disconnected);assert.equal(frames.size,0);assert.equal(timers.size,0);assert.equal(media.count(),0);assert.equal(doc.count(),0);
console.log('PASS flow redesign: cancelled/vertical gestures, tap positive control, capture release, immediate reduced wheel, runtime motion preference, timers/frames and all observer cleanup including no-signal goods');
