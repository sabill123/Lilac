#!/usr/bin/env node
/** Execute real HTML renderer/controller; native focus trapping also checked in the local browser. No API writes. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
const source=readFileSync(new URL('../frontend/src/app/product-navigation.ts',import.meta.url),'utf8');
function setup(code=source){
 const api={}, win=new EventTarget(), body={style:{overflow:'auto',paddingRight:'8px'}}, doc={body,documentElement:{clientWidth:980},activeElement:null};
 class Element extends EventTarget {constructor(){super();this.attrs={};this.isConnected=true;this.value='';}setAttribute(k,v){this.attrs[k]=v;}focus(){doc.activeElement=this;}click(){this.dispatchEvent(new Event('click'));}closest(){return null;}getClientRects(){return[{}];}}
 const toggle=new Element(), dialog=new Element(), form=new Element(), input=new Element(), first=new Element(), last=new Element();dialog.open=false;
 dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;dialog.dispatchEvent(new Event('close'));};
 dialog.querySelector=s=>s==='form'?form:s==='input'?input:null;
 dialog.querySelectorAll=()=>[first,input,last];
 const root={ownerDocument:doc,querySelector:s=>s==='#productMenuToggle'?toggle:s==='#productMenu'?dialog:null};
 Object.assign(win,{innerWidth:1000});
 vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.CommonJS}}).outputText,{exports:api,window:win,location:{hash:'#/'},getComputedStyle:()=>({paddingRight:'8px'}),parseFloat,console});
 return {api,win,body,doc,toggle,dialog,form,input,root,first,last};
}
const h=setup();
const destinations=['home','concerts','fanclub','community','goods','assist','news','chart','artists','my','guide','about','faq','terms','privacy','contact','status','login'].map(r=>({r,href:r==='home'?'#/':`#/${r}`,label:r}));
const html=h.api.productNavigationHtml(destinations);
// Inspect output of actual renderer, not a manually assembled menu fixture.
for(const n of destinations) assert.ok(html.includes(`href="${n.href}" data-r="${n.r}"`),`Rendered ${n.r}`);
assert.match(html,/<dialog[^>]+aria-labelledby="productMenuTitle"/);
assert.match(html,/<label for="menuQuery">/);
assert.match(h.api.productNavigationHtml(destinations,true),/すべてのメニュー/);
assert.match(h.api.productNavigationHtml([{r:'x',href:'#/x?q="',label:'<img>'}]),/&lt;img&gt;/);
function checkLifecycle(h){
 const cleanup=h.api.mountProductNavigation(h.root);
 h.toggle.click();assert.equal(h.dialog.open,true);assert.equal(h.body.style.overflow,'hidden');assert.equal(h.body.style.paddingRight,'28px');assert.equal(h.toggle.attrs['aria-expanded'],'true');
 h.last.focus();const forward=Object.assign(new Event('keydown',{cancelable:true}),{key:'Tab',shiftKey:false});h.dialog.dispatchEvent(forward);assert.equal(forward.defaultPrevented,true);assert.equal(h.doc.activeElement,h.first,'Last Tab wraps to first');
 h.first.focus();const backward=Object.assign(new Event('keydown',{cancelable:true}),{key:'Tab',shiftKey:true});h.dialog.dispatchEvent(backward);assert.equal(backward.defaultPrevented,true);assert.equal(h.doc.activeElement,h.last,'First Shift+Tab wraps to last');
 const cancel=new Event('cancel',{cancelable:true});h.dialog.dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,true);assert.equal(h.dialog.open,false);assert.equal(h.doc.activeElement,h.toggle);assert.equal(h.body.style.overflow,'auto');assert.equal(h.body.style.paddingRight,'8px');
 h.toggle.click();h.win.dispatchEvent(new Event('hashchange'));assert.equal(h.dialog.open,false);assert.equal(h.body.style.overflow,'auto');
 h.toggle.click();h.dialog.dispatchEvent(Object.assign(new Event('click'),{ }));
 h.input.value='  Mrs. GREEN APPLE & live  ';h.form.dispatchEvent(new Event('submit',{cancelable:true}));assert.equal(h.dialog.open,false);
 h.toggle.click();cleanup();assert.equal(h.dialog.open,false);assert.equal(h.body.style.overflow,'auto');h.toggle.click();assert.equal(h.dialog.open,false,'Disposed listener must not reopen removed dialog');cleanup();
}
checkLifecycle(h);
// Negative control executes the same assertions with a broken cleanup implementation.
assert.throws(()=>checkLifecycle(setup(source.replace("body.style.overflow = oldOverflow;","body.style.overflow = 'hidden';"))),/Expected values to be strictly equal/);
const main=readFileSync(new URL('../frontend/src/app/main.ts',import.meta.url),'utf8');
assert.match(main,/const MOBILE_NAV = \['home', 'concerts', 'fanclub', 'community', 'my'\]/);
assert.match(main,/\.product-menu-links a/);
assert.match(main,/cleanupProductNavigation\?\.\(\)/);
assert.match(main,/mountProductNavigation\(\$\('hdr'\)\)/);
assert.match(main,/role="radiogroup"/);assert.match(main,/ArrowRight/);assert.match(main,/onLive\(\(u\)/);
console.log('PASS product navigation: actual renderer, destinations, localization, escaping, open/cancel, route cleanup, search, disposal, negative control; browser native semantics checked separately.');

// Browser consumer: pass the real imported TS module, document and window.
// BEGIN_RENDERED_DOM_REGRESSION
export async function verifyRenderedNavigation(api, document, window) {
 const check=(condition,message)=>{if(!condition)throw new Error(message);};
 const root=document.createElement('header');document.body.append(root);
 const oldOverflow=document.body.style.overflow,oldPadding=document.body.style.paddingRight;
 const items=['home','concerts','fanclub','community','goods','assist','news','chart','artists','my','guide','about','faq','terms','privacy','contact','status','login'].map(r=>({r,href:r==='home'?'#/':`#/${r}`,label:r}));
 root.innerHTML=api.productNavigationHtml(items);
 const links=[...root.querySelectorAll('.product-menu-links a')];
 check(links.length===items.length,'Every destination is rendered in actual DOM');
 check(links.every((a,i)=>a.hash===items[i].href),'Rendered destination hrefs match');
 const toggle=root.querySelector('button'),dialog=root.querySelector('dialog');
 const cleanup=api.mountProductNavigation(root);
 try {
  toggle.focus();toggle.click();
  check(dialog.open && dialog.matches(':modal'),'Uses real native modal dialog');
  check(document.body.style.overflow==='hidden','Background scroll is locked');
  check(document.activeElement===dialog.querySelector('[data-menu-close]'),'Native autofocus reaches close control');
  const cancel=new Event('cancel',{cancelable:true});dialog.dispatchEvent(cancel);
  check(!dialog.open && document.activeElement===toggle,'Escape cancellation restores trigger focus');
  check(document.body.style.overflow===oldOverflow,'Cancellation restores overflow');
  toggle.click();window.dispatchEvent(new Event('hashchange'));
  check(!dialog.open,'Route event closes dialog');
  toggle.click();dialog.querySelector('input').value='';
  dialog.querySelector('form').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
  check(!dialog.open,'Search closes modal');
  toggle.click();cleanup();
  check(!dialog.open && document.body.style.overflow===oldOverflow && document.body.style.paddingRight===oldPadding,'Rerender cleanup restores exact body state');
  toggle.click();check(!dialog.open,'Unmount removes old trigger listeners');
  root.innerHTML=api.productNavigationHtml(items,true);check(root.querySelector('h2').textContent==='すべてのメニュー','Japanese actual DOM');
  return {destinations:links.length,nativeDialog:true,autofocus:true,escape:true,routeCleanup:true,search:true,rerenderCleanup:true,localization:true};
 } finally {cleanup();root.remove();}
}
// END_RENDERED_DOM_REGRESSION
