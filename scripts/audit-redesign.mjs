/** Read-only visual audit, Node 22+ and installed Chrome. No user browser/profile.
 * OUT=/absolute/tmp/audit BASE=http://localhost:5180 node scripts/audit-redesign.mjs
 * Uses the project's CDP harness pattern. AX trees are the primary route read;
 * DOM evaluation is restricted to exact #page/.site-root layout measurements.
 * No pixel baseline is supplied: this is a screenshot/structural regression audit.
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const BASE = process.env.BASE || 'http://localhost:5180';
const OUT = path.resolve(process.env.OUT || path.join(tmpdir(), 'lilac-redesign-audit'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { startedAt: new Date().toISOString(), base: BASE, out: OUT, readOnly: true, discovery: [], results: [], blocked: [], cleanup: {} };
let chrome, profile, ws, id = 0, current = null, stopping = false;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(`CDP timeout ${method}`)); }, 12000);
    pending.set(n, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
}
async function cleanup() {
  if (stopping) return;
  stopping = true;
  if (ws?.readyState === WebSocket.OPEN) {
    await send('Page.navigate', { url: 'about:blank' }).catch(() => {});
    await send('Page.close').catch(() => {});
    ws.close();
  }
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('audit cleanup')); }
  pending.clear();
  if (chrome?.pid) {
    try { process.kill(-chrome.pid, 'SIGTERM'); } catch { try { chrome.kill('SIGTERM'); } catch {} }
    for (let i = 0; i < 15 && chrome.exitCode === null && chrome.signalCode === null; i++) await sleep(100);
    if (chrome.exitCode === null && chrome.signalCode === null) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch {} }
    report.cleanup.chromeTerminated = chrome.exitCode !== null || chrome.signalCode !== null;
  }
  if (profile) { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); report.cleanup.profileRemoved = true; }
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, async () => { await cleanup(); process.exit(130); });
async function publicGet(endpoint) {
  try {
    const r = await fetch(new URL(endpoint, BASE), { signal: AbortSignal.timeout(8000), redirect: 'error' });
    const text = await r.text();
    report.discovery.push({ endpoint, status: r.status, contentType: r.headers.get('content-type') });
    if (!r.ok) return null;
    try { return JSON.parse(text); } catch { return null; }
  } catch (e) { report.discovery.push({ endpoint, error: e.message }); return null; }
}
const asArray = d => Array.isArray(d) ? d : d?.items || [];
async function snapshot() {
  const { nodes } = await send('Accessibility.getFullAXTree');
  const live = nodes.filter(n => !n.ignored);
  const tree = live.map(n => `${n.role?.value || ''}${n.properties?.find(p => p.name === 'level') ? ` [level=${n.properties.find(p => p.name === 'level').value.value}]` : ''} ${n.name?.value || ''}`).join('\n');
  const h1 = live.filter(n => n.role?.value === 'heading' && n.properties?.some(p => p.name === 'level' && p.value.value === 1)).map(n => n.name?.value);
  return { tree, h1, textNodes: live.filter(n => n.role?.value === 'StaticText').length };
}
const metricsExpression = `(() => {
  const site = document.body.classList.contains('site-mode');
  const root = document.querySelector(site ? '.site-root' : '#page');
  const visible = e => !!(e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none');
  const label = e => e.tagName.toLowerCase() + (e.id ? '#'+e.id : '') + [...e.classList].slice(0,4).map(c=>'.'+c).join('');
  const rect = e => {const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}};
  if (!root) return {missingRoot:true,hash:location.hash,site};
  const descendants = [...root.querySelectorAll('*')].filter(visible);
  const scrollers = descendants.filter(e => /auto|scroll/.test(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 2);
  const protectedByScroller = e => scrollers.some(s => s !== e && s.contains(e));
  const rr = root.getBoundingClientRect();
  const overflowElements = descendants.filter(e => { const r=e.getBoundingClientRect(); return r.width > 0 && !protectedByScroller(e) && (r.right > Math.min(rr.right,innerWidth)+2 || r.left < Math.max(rr.left,0)-2); }).map(e=>({selector:label(e),...rect(e)}));
  const imgs = [...root.querySelectorAll('img')].filter(visible);
  const imageInfo = i => ({selector:label(i),src:i.currentSrc || i.src,alt:i.alt,...rect(i)});
  return {hash:location.hash,title:document.title,site,rootSelector:site?'.site-root':'#page',root:rect(root),h1:[...root.querySelectorAll('h1')].filter(visible).map(e=>e.textContent.trim()),documentOverflow:Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth),rootOverflow:Math.max(0,root.scrollWidth-root.clientWidth),overflowElements, intendedHorizontalScrollers:scrollers.map(e=>({selector:label(e),overflow:e.scrollWidth-e.clientWidth})),brokenImages:imgs.filter(i=>i.complete && i.naturalWidth===0 && (i.currentSrc||i.getAttribute('src'))).map(imageInfo),pendingImages:imgs.filter(i=>!i.complete).map(imageInfo),imageCount:imgs.length,blockedStorageWrites:window.__auditBlockedStorage || []};
})()`;
async function main() {
  await mkdir(OUT, { recursive: true });
  const [pd, ad, rd, cd] = await Promise.all([publicGet('/api/db/products'), publicGet('/api/db/artists'), publicGet('/api/store/releases?limit=24'), publicGet('/api/charts?country=jp&limit=1')]);
  const product = asArray(pd).find(x => typeof x.id === 'string');
  const artists = asArray(ad);
  const artistJP = artists.find(x => x.country === 'jp' && x.id) || artists.find(x => x.id);
  const artistKR = artists.find(x => x.country === 'kr' && x.id);
  let release = rd?.releases?.find(x=>x.id);
  if (!release) {
    const fallback = await publicGet('/api/db/releases');
    release = asArray(fallback).find(x=>x.id);
  }
  report.entities = { product: product?.id, artistJP: artistJP?.id, artistKR: artistKR?.id, release: release?.id || null };
  report.chartCountry = 'jp';
  const routes = [];
  const add = (name, hash, expected='public') => routes.push({name,hash,expected});
  for (const p of ['about','pricing','faq','contact','terms','privacy','subprocessors']) add('site-'+p,'#/'+p);
  add('site404','#/terms/audit-missing','404');
  add('home','#/'); add('chart','#/chart');
  for (const source of [...new Set(['combined',...(cd?.sources || [])])]) add('chart-'+source,'#/chart/'+encodeURIComponent(source));
  add('store','#/store');
  if(product) add('product','#/store/'+encodeURIComponent(product.id)); else report.blocked.push({route:'product',reason:'No valid product ID returned by public GET'});
  add('releases','#/releases');
  if(release) add('release','#/release/'+encodeURIComponent(release.id));
  else { report.blocked.push({route:'release',reason:'Public release endpoints unavailable; valid detail ID cannot be established'}); add('release-no-id','#/release','missing-id'); }
  for(const p of ['schedule','artists']) add(p,'#/'+p);
  if(artistJP) add('artist-jp','#/artist/'+encodeURIComponent(artistJP.id));
  if(artistKR) add('artist-kr','#/artist/'+encodeURIComponent(artistKR.id));
  for(const p of ['library','orders','account']) add(p,'#/'+p,p==='library'?'guest-gate':'login-redirect');
  for(const p of ['login','signup','help','status','work']) add(p,'#/'+p);
  add('search','#/search?q='+encodeURIComponent(artistJP?.name || 'Lilac'));
  add('404','#/audit-missing-route','404');
  profile = await mkdtemp(path.join(tmpdir(),'lilac-redesign-chrome-'));
  report.isolation = { profile, debugPort: 0, browser: 'headless Chrome', binary: CHROME, userBrowserUsed: false }; 
  chrome = spawn(CHROME,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--window-size=1440,900','about:blank'],{stdio:['ignore','ignore','pipe'],detached:true});
  let launchError, chromeStderr = '';
  chrome.on('error', e => { launchError = e.message; });
  chrome.stderr.on('data', b => { chromeStderr = (chromeStderr + String(b)).slice(-4000); });
  let port;
  for(let i=0;i<60;i++){try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}if(launchError || chrome.exitCode!==null || chrome.signalCode!==null)break;await sleep(100);}
  if(!port) { report.isolation.startup = { error:launchError,exitCode:chrome.exitCode,signal:chrome.signalCode,stderr:chromeStderr }; throw new Error('Isolated Chrome did not expose DevToolsActivePort: '+(launchError || chrome.signalCode || chrome.exitCode || 'startup timeout')); }
  report.isolation.assignedPort=port;
  const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
  const target=targets.find(t=>t.type==='page'); if(!target)throw new Error('No isolated page target');
  ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=({data})=>{ const m=JSON.parse(data); if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);return;}
    if(m.method==='Fetch.requestPaused') {const {requestId,request}=m.params; const safe=['GET','HEAD','OPTIONS'].includes(request.method);if(!safe)current?.blockedRequests.push({method:request.method,url:request.url});void send(safe?'Fetch.continueRequest':'Fetch.failRequest',safe?{requestId}:{requestId,errorReason:'BlockedByClient'}).catch(()=>{});}
    if(!current)return;
    if(m.method==='Runtime.exceptionThrown')current.exceptions.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')current.consoleErrors.push(m.params.args.map(a=>a.value || a.description || '').join(' '));
    if(m.method==='Network.responseReceived'&&m.params.response.status>=400)current.httpErrors.push({url:m.params.response.url,status:m.params.response.status,type:m.params.type});
  };
  await send('Page.enable');await send('Runtime.enable');await send('Accessibility.enable');await send('Network.enable');
  await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(new URL(BASE).origin)}){localStorage.setItem('lilac.onboarded','1');localStorage.setItem('lilac.mode','browse');window.__auditBlockedStorage=[];const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(this===localStorage&&['lilac.onboarded','lilac.mode'].includes(k))return set.call(this,k,v);window.__auditBlockedStorage.push(String(k));};Storage.prototype.removeItem=function(k){window.__auditBlockedStorage.push('remove:'+k)};Storage.prototype.clear=function(){window.__auditBlockedStorage.push('clear')};}`});
  for(const [width,height] of [[1440,900],[390,844]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
    for(const route of routes) {
      current={...route,viewport:{width,height},exceptions:[],consoleErrors:[],httpErrors:[],blockedRequests:[],defects:[]};
      const started=Date.now();
      try {
        // A unique query ensures a real new document, never a previous route's AX tree.
        await send('Page.navigate',{url:`${BASE}/?visualAudit=${Date.now()}${route.hash}`});
        let ax,signature='',stable=0;
        do {await sleep(250);ax=await snapshot();const s=ax.h1.join('|')+'|'+ax.textNodes;stable=s===signature?stable+1:0;signature=s;if(Date.now()-started>850&&ax.textNodes>12&&stable>=1&&!/불러오는 중|Loading\.\.\./.test(ax.tree))break;}while(Date.now()-started<3200);
        await sleep(750);
        ax=await snapshot();
        const {result,exceptionDetails}=await send('Runtime.evaluate',{expression:metricsExpression,returnByValue:true});
        if(exceptionDetails)throw new Error(exceptionDetails.text);
        current.metrics=result.value;
        const stem=`${width}x${height}-${route.name}`;
        current.screenshot=path.join(OUT,stem+'.png');current.accessibilitySnapshot=path.join(OUT,stem+'.ax.txt');
        await writeFile(current.accessibilitySnapshot,ax.tree);
        const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        await writeFile(current.screenshot,Buffer.from(shot.data,'base64'));
        current.headings=ax.h1;
        const notFound=ax.h1.some(t=>/찾을 수 없|존재하지 않|404|not found/i.test(t));
        const login=current.metrics.hash==='#/login';
        current.state=route.expected==='404'&&notFound?'expected-404':route.expected==='login-redirect'&&login?'expected-login-redirect':route.expected==='guest-gate'&&/로그인/.test(ax.tree)?'expected-guest-gate':route.expected==='missing-id'?'blocked-valid-id':notFound?'unexpected-404':'rendered';
        if(route.expected==='404'&&!notFound)current.defects.push('Expected 404 heading not observed');
        if(route.expected==='login-redirect'&&!login)current.defects.push('Expected guest login redirect missing');
        if(route.expected==='public'&&notFound)current.defects.push('Unexpected 404 for valid public route');
        if(current.metrics.missingRoot)current.defects.push('Expected content root missing');
        if((current.metrics.h1||[]).length!==1)current.defects.push(`Visible root h1 count ${current.metrics.h1?.length||0}, expected 1`);
        if(current.metrics.documentOverflow>2)current.defects.push(`Document horizontal overflow ${current.metrics.documentOverflow}px`);
        if(current.metrics.overflowElements?.length)current.defects.push(`${current.metrics.overflowElements.length} elements exceed content/viewport bounds outside intended horizontal scrollers`);
        if(current.metrics.brokenImages?.length)current.defects.push(`${current.metrics.brokenImages.length} broken images`);
        if(current.exceptions.length)current.defects.push(`${current.exceptions.length} JavaScript exceptions`);
        if(/화면을 불러오지 못했습니다/.test(ax.tree))current.defects.push('Route render-error UI');
        if(/불러오는 중|Loading\.\.\./.test(ax.tree))current.warnings=['Loading text remains at capture; asynchronous completion not proven'];
      }catch(e){current.defects.push('Harness/route capture error: '+e.message);}
      current.durationMs=Date.now()-started;
      report.results.push(current);
      console.log(JSON.stringify({route:current.name,width,state:current.state,defects:current.defects,ms:current.durationMs}));
      await writeFile(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
      current=null;
    }
  }
}
try {await main();}catch(e){report.fatal=e.stack;process.exitCode=1;console.error(e.message);}finally{
  await cleanup();
  report.finishedAt=new Date().toISOString();
  report.summary={captures:report.results.filter(r=>r.screenshot).length,routes: new Set(report.results.map(r=>r.name)).size,defectiveCaptures:report.results.filter(r=>r.defects.length).length,expectedLogin:report.results.filter(r=>r.state==='expected-login-redirect').length,expectedGuestGate:report.results.filter(r=>r.state==='expected-guest-gate').length,expected404:report.results.filter(r=>r.state==='expected-404').length,exceptions:report.results.reduce((n,r)=>n+r.exceptions.length,0),brokenImages:report.results.reduce((n,r)=>n+(r.metrics?.brokenImages?.length||0),0),blockedRequests:report.results.reduce((n,r)=>n+r.blockedRequests.length,0),blocked:report.blocked};
  await mkdir(OUT,{recursive:true});await writeFile(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
  await writeFile(path.join(OUT,'summary.json'),JSON.stringify({summary:report.summary,entities:report.entities,cleanup:report.cleanup,fatal:report.fatal,defects:report.results.filter(r=>r.defects.length).map(({name,viewport,defects,screenshot})=>({name,viewport,defects,screenshot}))},null,2));
  console.log(JSON.stringify({summary:report.summary,cleanup:report.cleanup,out:OUT}));
}
