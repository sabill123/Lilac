#!/usr/bin/env node
/** Actual home renderer (pages/home.ts) + actual cover candidate/slide logic (home-cover.ts with real i18n/ui/cards).
 * Doubles only at the boundary: API, cards renderers, cover HTML/mount, awards, community, DOM root. No network/credentials.
 * Markup order is checked on the generated HTML string; no real browser layout is claimed. */
import assert from 'node:assert/strict'; import fs from 'node:fs'; import vm from 'node:vm';
import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const compile = src => ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(rel, ctx, deps, source) { const exports = {}; vm.runInContext(`(function(exports,require){${compile(source ?? read(rel))}\n})`, ctx)(exports, n => { if(n==='../artist-marquee')return load('../frontend/src/app/artist-marquee.ts',ctx,{'./i18n':deps['../i18n'],'./ui':deps['../ui'],'./cards':deps['../cards']}); if(n==='./name-reading')return load('../frontend/src/app/name-reading.ts',ctx,{}); if (n in deps) return deps[n]; if (n.endsWith('.css')) return {}; throw new Error(`${rel}: unexpected import ${n}`); }); return exports; }
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

/* Negative controls on home.ts: each must make a check fail that passes on the real module. */
const MUTATION = process.env.HOME_HUB_MUTATION || '';
const MUTATIONS = {
  'hydrate: chunks of 20 instead of 12': ['Math.ceil(missing.length/12)},(_,i)=>missing.slice(i*12,i*12+12)', 'Math.ceil(missing.length/20)},(_,i)=>missing.slice(i*20,i*20+20)'],
  'hydrate: 6 workers instead of 3': ['Math.min(3,chunks.length)', 'Math.min(6,chunks.length)'],
  'hydrate: re-request already verified ids': ['const missing=ids.filter(', 'const missing=ids.filter(()=>true)||ids.filter('],
  'hydrate: ids not URL-encoded': ['chunks[at].map(encodeURIComponent).join(\',\')', 'chunks[at].join(\',\')'],
  'hydrate: merge portraits for a different artistId': ['&&x.portrait?.artistId===x.id', ''],
  'hydrate: workers keep pulling after abort': ['while(cursor<chunks.length&&!parent.signal.aborted)', 'while(cursor<chunks.length)'],
  'hydrate: stale hydrate may remount': ['if(!alive()||parent.signal.aborted||homeAbort!==parent)return;', 'if(!alive())return;'],
  'hydrate: paused state not restored': ['if(paused)root.querySelector', 'if(false)root.querySelector'],
  'order: support links before visiting': ['<section class="sec" id="secVisiting">', '${supportNavHtml()}<section class="sec" id="secVisiting">'],
  'order: news/chart outside discovery row': ['<div class="h-discovery-row">', '<div class="wrong-discovery-row">'],
  'order: chart before news': ['<section class="sec" id="secNews">', '<aside id="secChart"></aside><section class="sec" id="secNews">'],
};
const realHome = read('../frontend/src/app/pages/home.ts');
const homeSource = MUTATION ? (() => { const [a, b] = MUTATIONS[MUTATION] || []; if (!a || !realHome.includes(a)) { console.log(JSON.stringify({ skipped: true })); process.exit(0); } return realHome.split(a).join(b); })() : realHome;

/* ---------- actual cover candidate logic in its own realm (real i18n/ui/cards) ---------- */
const coverCtx = vm.createContext({ console, URL, Date, document: { documentElement: {} } });
const ci18n = load('../frontend/src/app/i18n.ts', coverCtx, {});
const cui = load('../frontend/src/app/ui.ts', coverCtx, { './i18n': ci18n });
const ccards = load('../frontend/src/app/cards.ts', coverCtx, { './ui': cui, './i18n': ci18n, './fanclub': { withUtm: u => u }, './state': { state: {}, isFollowing: () => false, toggleFollow() {} }, './player': { keyOf: () => '' }, './social': { likeBtn: () => '', talkBtn: () => '', trackTarget: () => '' } });
const realCover = load('../frontend/src/app/pages/home-cover.ts', coverCtx, { '../i18n': ci18n, '../ui': cui, '../cards': ccards });

/* ---------- boundary doubles for home.ts ---------- */
let locale = 'ko', clubs = [], clubFailure = false, gate = null, edition = 'kr';
const calls = [], mounts = [], coverHtmlCalls = [], portraitReqs = []; let inflight = 0, maxInflight = 0;
const empty = () => ({ edition, visiting: [], abroad: [], festivals: [], tickets: [], fanclub: [], chart: [], news: [], releases: [], artists: [], classifying: 0 });
let homeData = empty();
const esc = s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const homeCtx = vm.createContext({ console, URL, AbortController, Date, document: { createElement: () => ({ innerHTML: '', childNodes: [{ fresh: true }] }) }, IntersectionObserver: class { observe() {} disconnect() {} } });
const slideIds = d => realCover.coverSlides(d).map(s => s.artistId);
const modules = {
  '../../api': { api: async (url, opts) => {
    calls.push(url);
    if (url.includes('/home?')) { if (gate) { const p = gate; gate = null; return p.promise; } return homeData; }
    if (url.startsWith('/api/live/portraits?ids=')) {
      const req = { url, opts, ids: url.slice('/api/live/portraits?ids='.length).split(',').map(decodeURIComponent), gate: deferred() };
      portraitReqs.push(req); inflight++; maxInflight = Math.max(maxInflight, inflight);
      try { return await req.gate.promise; } finally { inflight--; }
    }
    if (url.includes('fanclub-list')) { if (clubFailure) throw Error('offline'); return { items: clubs }; }
    return { items: [], best: [], recent: [] };
  } },
  '../server-clock': { sharedServerClock:()=>({now:()=>null,state:()=>({uncertaintyMs:null}),watch:()=>()=>{},onChange:()=>()=>{},onDayChange:()=>()=>{}}),mountServerClock:()=>({destroy(){}}),ticketBoundaries:()=>[],SERVER_CLOCK_LABELS:{ko:{},ja:{}} },
  '../home-tickets': { plannedTickets:rows=>rows, homeTicketHtml:rows=>'<ol data-rows="'+rows.length+'"></ol>', updateTicketCountdowns(){} },
  '../home-planning': { upcomingHomeEvents:rows=>rows },
  '../home-news': {homeNewsHtml:()=>'<div data-home-news-ui></div>',mountHomeNews(){}},
  '../state': { state: { get edition() { return edition; } } }, '../i18n': { t: k => k, getLocale: () => locale },
  '../ui': { esc, img: () => '<img alt="">', icon: () => '', money: (n, c) => c + ' ' + n, fmtDay: x => x, errorState: () => '<p>Error</p>', emptyState: x => `<p>${esc(x)}</p>`, safeImage: cui.safeImage, safeHref: cui.safeHref },
  '../cards': { artistName: a => a.name, posterCard: c => `<article data-poster="${esc(c.id)}"></article>`, festCard: c => `<article data-fest="${esc(c.id)}"></article>`, newsRow: () => '<li data-news></li>', releaseCard: () => '<article data-release></article>', boardHtml: rows => `<div class="fx-board" data-rows="${rows.length}"></div>`, chartRow: () => '<li data-chart></li>' },
  '../cm-i18n': { ct: k => k }, '../social': { when: () => '' }, '../player': { playList() {} }, '../../awards': { homeAwardsHtml: () => '<div data-awards></div>', mountHomeAwards() {} }, '../../awards/live': { awardsUpdatesHtml: () => '', mountAwardsUpdates() {} }, '../fx': { bindBoard() {} },
  './home-cover': { coverCandidateIds: realCover.coverCandidateIds, coverSlides: realCover.coverSlides,
    homeCoverHtml: d => { coverHtmlCalls.push(d); const ids = slideIds(d); return ids.length ? `<section class="home-cover" data-test-stage data-slides="${esc(ids.join('|'))}"></section>` : `<header class="cover-empty" data-pending="${!!d.portraitsPending}"><h1>Empty artists</h1></header>`; },
    mountHomeCover(root, d, signal) { mounts.push({ d, signal }); } },
};
const home = load('../frontend/src/app/pages/home.ts', homeCtx, modules, homeSource);

/* ---------- fake root (selectors home.ts actually uses) ---------- */
const box = { innerHTML: '', setAttribute() {} }, sec = { hidden: false, querySelector: () => box };
const HERO = /<(section class="home-cover"|header class="cover-empty")[\s\S]*?<\/(section|header)>/;
const root = { innerHTML: '', children: [], heroPaused: false, motionClicks: 0, heroReplacements: 0,
  hero() { const r = this; return { get outerHTML() { return r.innerHTML.match(HERO)?.[0] ?? ''; }, set outerHTML(v) { r.heroReplacements++; r.innerHTML = r.innerHTML.replace(HERO, v); }, querySelector: s => s === '[data-cover-motion]' && r.innerHTML.includes('class="home-cover"') ? { getAttribute: () => String(r.heroPaused) } : null }; },
  querySelector(s) {
    const cover = this.innerHTML.includes('class="home-cover"'), emptyHero = this.innerHTML.includes('class="cover-empty"');
    if (s === '#secFanclub') return sec;
    if (s === '.home-cover') return cover ? this.hero() : null;
    if (s === '.cover-empty') return emptyHero ? this.hero() : null;
    if (s === '.home-cover,.cover-empty') return cover || emptyHero ? this.hero() : null;
    if (s === '[data-cover-motion]') return cover ? { click: () => { this.motionClicks++; } } : null;
    return null;
  },
  append(...nodes) { this.appended = nodes; } };

/* ---------- runner ---------- */
const failures = []; let passed = 0;
async function check(name, fn) { try { await fn(); passed++; } catch (e) { failures.push({ name, e }); } finally { home.leaveHome(); for (const r of portraitReqs) r.gate.resolve({ items: [] }); await flush(); portraitReqs.length = 0; inflight = 0; maxInflight = 0; locale = 'ko'; edition = 'kr'; gate = null; clubFailure = false; homeData = empty(); root.heroPaused = false; root.motionClicks = 0; root.heroReplacements = 0; mounts.length = 0; coverHtmlCalls.length = 0; } }
const IMG = n => `https://images.example/${n}.jpg`;
const fresh = id => ({ artistId: id, status: 'verified', method: 'official-profile', imageUrl: IMG('profile-' + encodeURIComponent(id)), sourceUrl: 'https://official.example/' + encodeURIComponent(id), checkedAt: new Date(Date.now() - 3600e3).toISOString() });
const rel = (id, artistId) => ({ id, tier: 'a', artist: 'x', artistId, title: 'Album ' + id, country: 'JP', releaseDate: '2026-10-01', artwork: IMG('album-' + encodeURIComponent(id)), artworkKind: 'album-cover', artworkSource: { sourceUrl: 'https://music.example/' + encodeURIComponent(id) } });
const at = (html, marker) => { const i = html.indexOf(marker); assert.ok(i >= 0, `missing ${marker}`); return i; };
const full = () => ({ ...empty(), visiting: [{ id: 'v1', title: 'Visit' }], releases: [{ id: 'r', title: 'Album' }], festivals: [{ id: 'f1', title: 'Fest' }], tickets: [{ id: 't1', provider: 'nol', ticketOpenAt: '2026-11-01' }], chart: [{ country: 'jp', items: [{ title: 'S', artist: 'A' }] }],
  abroad: [{ id: 'ab1', title: 'Abroad' }], news: [{ id: 'n1' }], artists: [{ id: 'a/b', name: '<Artist>', origin: 'jp' }] });

/* ================= section order ================= */
await check('order: ticket priority, upcoming visiting, festivals, local shows, news with compact chart, then memberships/releases/community', async()=>{
 homeData=full();await home.renderHome(root,()=>true);await flush();const h=root.innerHTML;
 const order=['class="cover-empty"','id="secTickets"','id="secVisiting"','id="secFest"','id="secAbroad"','class="h-discovery-row"','id="secNews"','id="secChart"','id="secFanclub"','id="secReleases"','id="secTalkWrap"','class="h-shortcuts"','class="h-goods-search"','id="secArtists"','class="awards-wrap"'];
 const positions=order.map(x=>at(h,x));for(let i=1;i<positions.length;i++)assert.ok(positions[i]>positions[i-1],order[i-1]+' precedes '+order[i]);
 assert.doesNotMatch(h.slice(0,positions[2]),/h-shortcuts|secArtists|secFanclub|h-goods-search/);
 assert.doesNotMatch(h,/h-live-row/);assert.match(h,/class="h-discovery-row">\s*<section class="sec" id="secNews">/);
 for(const marker of ['data-poster="v1"','data-release','data-fest="f1"','data-rows="1"','data-chart','data-home-news-ui'])assert.ok(h.includes(marker),marker);
});
await check('order: empty sources retain tickets and visiting, do not invent festivals/local shows/releases',async()=>{
 await home.renderHome(root,()=>true);await flush();const h=root.innerHTML;
 assert.ok(at(h,'id="secTickets"')<at(h,'id="secVisiting"'));assert.doesNotMatch(h,/id="secReleases"|id="secFest"|id="secAbroad"/);
 assert.ok(at(h,'id="secNews"')<at(h,'id="secChart"'));assert.ok(at(h,'id="secChart"')<at(h,'id="secFanclub"'));assert.match(box.innerHTML,/불러오지 못했습니다/);assert.match(h,/id="secTalkWrap"/);
});
await check('content: help links, safe identities, unknown fanclub conditions, Japanese strings, no rejected layouts', async () => {
  homeData = full(); clubs = [{ found: true, artistId: 'new/group', artist: '<Artist>', name: '<Club>', overseas: 'unknown', fees: null, checkedAt: '2026-10-25T00:00:00Z' }];
  await home.renderHome(root, () => true); await flush(); const h = root.innerHTML;
  const nav = h.match(/<nav class="h-shortcuts"[^>]*>(.*?)<\/nav>/s)[1]; for (const url of ['#/fanclub', '#/goods', '#/assist', '#/community']) assert.ok(nav.includes(`href="${url}"`)); assert.match(nav, /상품 사진/); assert.match(nav, /가나 형식/);
  assert.doesNotMatch(h, /hub-head|hub-search|<details class="hub-stage"|h-discovery(?:["\s])/);
  assert.ok(h.includes('#/community/a%2Fb')); assert.ok(h.includes('&lt;Artist&gt;'));
  assert.match(box.innerHTML, /#\/fanclub\/new%2Fgroup/); assert.match(box.innerHTML, /해외 조건 미확인/); assert.match(box.innerHTML, /회비 미확인/); assert.match(box.innerHTML, /&lt;Club&gt;/); assert.match(box.innerHTML, /원문 수집/);
  locale = 'ja'; await home.renderHome(root, () => true); await flush(); assert.match(root.innerHTML, /日韓翻訳・入力サポート/); assert.match(root.innerHTML, /アーティストごとの条件・会費/); assert.match(root.innerHTML, /チケット発売・FC先行/); assert.match(root.innerHTML, /日本チャート TOP 10/);
});

/* ================= cover hydration ================= */
const idOf = i => i === 10 ? 'id,10' : i === 11 ? 'id/11&x' : 'id' + i; // comma and slash/ampersand ids must survive chunk URLs
const pool = (n, valid = 0) => ({ ...empty(), edition: 'all', visiting: [{ id: 'v', title: 'V' }],
  artists: Array.from({ length: n }, (_, i) => ({ id: idOf(i), name: 'N' + i, ...(i < valid ? { portrait: fresh(idOf(i)) } : {}) })),
  coverReleases: Array.from({ length: n }, (_, i) => rel('r' + i, idOf(i))) });
await check('hydrate: 70-artist pool -> at most 60 candidates; only missing ids requested in chunks of <=12 with <=3 workers', async () => {
  homeData = pool(70, 5); const ids = realCover.coverCandidateIds(homeData); assert.equal(ids.length, 60);
  await home.renderHome(root, () => true); await flush();
  assert.equal(portraitReqs.length, 3, 'Exactly three workers start'); assert.equal(maxInflight, 3);
  for (let i = 0; i < 6 && portraitReqs.some(r => !r.done); i++) { const r = portraitReqs.find(x => !x.done); r.done = true; r.gate.resolve({ items: r.ids.map(id => ({ id, portrait: fresh(id) })) }); await flush(); assert.ok(maxInflight <= 3, 'Never more than 3 in flight'); }
  const requested = portraitReqs.flatMap(r => r.ids);
  assert.equal(portraitReqs.length, 5, '55 missing ids -> 5 requests'); assert.ok(portraitReqs.every(r => r.ids.length >= 1 && r.ids.length <= 12), portraitReqs.map(r => r.ids.length).join(','));
  assert.deepEqual([...requested].sort(), JSON.parse(JSON.stringify(ids)).slice(5).sort(), 'Exactly the 55 candidates without a fresh valid portrait; none of the 10 non-candidates');
  assert.equal(new Set(requested).size, requested.length, 'No id requested twice');
  for (const r of portraitReqs) { assert.equal(r.url.split('?ids=')[1].split(',').length, r.ids.length, 'Comma inside an id is encoded, not a separator'); assert.ok(r.opts?.signal && !r.opts.signal.aborted, 'Request carries the live home signal'); }
  assert.ok(requested.includes('id,10') && requested.includes('id/11&x'), 'Special-character ids round-trip through the chunk URL');
  assert.ok(!requested.some(id => ['id0', 'id1', 'id2', 'id3', 'id4'].includes(id)), 'Already-verified ids are not re-requested');
});
await check('hydrate: merge only matching portraits, tolerate a failed chunk, remount cover once with paused state preserved', async () => {
  homeData = pool(20, 0); await home.renderHome(root, () => true); await flush();
  assert.match(root.innerHTML, /class="cover-empty" data-pending="true"/, 'Pending message while portraits are verified'); home.leaveHome(); await flush(); portraitReqs.length = 0;
  homeData = pool(30, 3); await home.renderHome(root, () => true); await flush();
  assert.match(root.innerHTML, /data-slides="id0\|id1\|id2"/, 'Already-verified artists show immediately');
  const firstMount = mounts.at(-1); root.heroPaused = true;
  const [a, b, c] = portraitReqs; assert.equal(portraitReqs.length, 3); assert.deepEqual(portraitReqs.map(r => r.ids.length), [12, 12, 3]);
  a.gate.resolve({ items: [...a.ids.map(id => ({ id, portrait: fresh(id) })), { id: 'not-a-candidate', portrait: fresh('not-a-candidate') }, { id: a.ids[0], portrait: fresh('someone-else') }] });
  b.gate.reject(new Error('offline'));
  c.gate.resolve({ items: c.ids.map(id => ({ id, portrait: { ...fresh(id), artistId: 'other' } })) });
  await flush();
  const shown = (root.innerHTML.match(/data-slides="([^"]*)"/)?.[1] || '').split('|').filter(Boolean).map(s => s.replaceAll('&amp;', '&'));
  assert.equal(root.heroReplacements, 1, 'Hero replaced once'); assert.ok(shown.length > 0 && shown.length <= 12, `slides ${shown.length}`);
  assert.ok(shown.every(id => a.ids.includes(id) || ['id0', 'id1', 'id2'].includes(id)), 'Only ids from the successful matching chunk gained a profile');
  assert.ok(!shown.includes('not-a-candidate')); assert.ok(shown.includes(a.ids[0]), 'Mismatched duplicate did not overwrite the valid portrait');
  const last = coverHtmlCalls.at(-1); assert.equal(last.portraitsPending, false); assert.ok(!last.artists.some(x => x.id === 'not-a-candidate'));
  assert.ok(last.artists.filter(x => c.ids.includes(x.id)).every(x => !x.portrait), 'Portrait for a different artistId is never merged');
  assert.equal(firstMount.signal.aborted, true, 'Old cover mount aborted'); assert.notEqual(mounts.at(-1), firstMount); assert.equal(mounts.at(-1).signal.aborted, false);
  assert.equal(root.motionClicks, 1, 'Paused state re-applied after remount');
});
await check('hydrate: superseded or left home never remounts and stops pulling further chunks', async () => {
  homeData = pool(60, 0); await home.renderHome(root, () => true); await flush(); const stale = [...portraitReqs]; assert.equal(stale.length, 3);
  const staleMounts = mounts.length; homeData = full(); await home.renderHome(root, () => true); await flush(); const replacedBefore = root.heroReplacements;
  assert.ok(stale.every(r => r.opts.signal.aborted), 'Old requests receive an aborted signal');
  for (const r of stale) r.gate.resolve({ items: r.ids.map(id => ({ id, portrait: fresh(id) })) }); await flush();
  assert.equal(portraitReqs.length, 3, 'Workers stop after abort (no 4th/5th chunk)'); assert.equal(root.heroReplacements, replacedBefore, 'Stale hydrate cannot replace the newer hero'); assert.equal(mounts.length, staleMounts + 1);
  homeData = pool(50, 0); await home.renderHome(root, () => true); await flush(); const reqs = [...portraitReqs.slice(3)]; assert.equal(reqs.length, 3); home.leaveHome();
  for (const r of reqs) r.gate.resolve({ items: r.ids.map(id => ({ id, portrait: fresh(id) })) }); await flush(); assert.equal(portraitReqs.length, 6, 'leaveHome stops the remaining 2 chunks'); assert.equal(root.heroReplacements, replacedBefore);
});
await check('hydrate: nothing to request when every candidate is already verified, or there are no candidates', async () => {
  homeData = pool(12, 12); await home.renderHome(root, () => true); await flush();
  assert.equal(portraitReqs.length, 0); assert.match(root.innerHTML, /data-test-stage/); assert.equal(root.heroReplacements, 0);
  homeData = { ...empty(), visiting: [{ id: 'v' }], artists: [{ id: 'x', name: 'X', photoLarge: IMG('deezer') }] }; await home.renderHome(root, () => true); await flush();
  assert.equal(portraitReqs.length, 0, 'Artists without own media are not candidates'); assert.match(root.innerHTML, /data-pending="false"/);
});
await check('hydrate: when every requested portrait fails, the empty hero stops claiming it is still verifying', async () => {
  homeData = pool(5, 0); await home.renderHome(root, () => true); await flush(); assert.match(root.innerHTML, /data-pending="true"/); assert.equal(portraitReqs.length, 1);
  portraitReqs[0].gate.reject(new Error('offline')); await flush();
  assert.match(root.innerHTML, /class="cover-empty" data-pending="false"/); assert.equal(root.heroReplacements, 1); assert.doesNotMatch(root.innerHTML, /data-test-stage/);
});
await check('hydrate: an artist repeated in artists (verified portrait) and coverArtists (no portrait) is shown or re-verified, never silently dropped', async () => {
  homeData = { ...empty(), edition: 'all', visiting: [{ id: 'v' }], artists: [{ id: 'dup', name: 'Dup', portrait: fresh('dup') }], coverArtists: [{ id: 'dup', name: 'Dup' }], coverReleases: [rel('rd', 'dup')] };
  await home.renderHome(root, () => true); await flush();
  const shown = root.innerHTML.includes('data-slides="dup"'), requested = portraitReqs.some(r => r.ids.includes('dup'));
  assert.ok(shown || requested, `slides=${JSON.stringify(slideIds(homeData))} requested=${requested}: coverSlides keeps the later portrait-less row while hydrate's missing check sees the earlier verified row, so the artist is neither shown nor requested`);
});
await check('hydrate: edition origin guard limits which ids are ever requested', async () => {
  edition = 'kr'; homeData = { ...empty(), edition: 'kr', visiting: [{ id: 'v' }], artists: [{ id: 'k1', name: 'K', origin: 'kr' }, { id: 'j1', name: 'J', origin: 'jp' }, { id: 'u1', name: 'U' }], coverReleases: [rel('rk', 'k1'), rel('rj', 'j1'), rel('ru', 'u1')] };
  await home.renderHome(root, () => true); await flush(); assert.deepEqual(JSON.parse(JSON.stringify(portraitReqs.flatMap(r => r.ids))), ['j1'], 'kr edition only verifies jp-origin artists');
});

/* ================= refresh preservation and stale owners ================= */
await check('refresh keeps the hero and fences stale owners', async () => {
  homeData = full(); await home.renderHome(root, () => true); await flush();
  let removed = 0; const hero = { classList: { contains: x => x === 'home-cover' }, remove() { throw Error('Active cover removed by refresh'); } }, heading = { classList: { contains: x => x === 'sr-only' }, remove() { throw Error('Heading removed'); } }, stale = { classList: { contains: () => false }, remove() { removed++; } };
  root.children = [hero, heading, stale]; await home.refreshHome(root, () => true); assert.equal(removed, 1); assert.equal(root.appended.length, 1);
  const oldRefresh = deferred(); gate = oldRefresh; const pendingRefresh = home.refreshHome(root, () => true); await home.renderHome(root, () => true); const priorAppend = root.appended; oldRefresh.resolve(homeData); await pendingRefresh; assert.equal(root.appended, priorAppend, 'Old refresh cannot append into newer home owner');
  const oldRender = deferred(); gate = oldRender; const pendingRender = home.renderHome(root, () => true); const oldSignal = mounts.at(-1).signal; await home.renderHome(root, () => true); const current = root.innerHTML; oldRender.reject(Error('offline')); await pendingRender; assert.equal(root.innerHTML, current, 'Old failed request cannot overwrite newer home'); assert.equal(oldSignal.aborted, true);
  clubFailure = true; await home.renderHome(root, () => true); await flush(); assert.match(box.innerHTML, /불러오지 못했습니다/); assert.equal(sec.hidden, false); const lastSignal = mounts.at(-1).signal; home.leaveHome(); assert.ok(lastSignal.aborted);
  assert.ok(calls.every(u => u.startsWith('/api/')));
});

const total = passed + failures.length;
if (MUTATION) { console.log(JSON.stringify({ failed: failures.map(f => f.name) })); process.exit(0); }
const baseline = new Set(failures.map(f => f.name)); const controls = { caught: [], missed: [], skipped: [], invalid: [] };
if (!process.env.HUB_SKIP_MUTATIONS) for (const name of Object.keys(MUTATIONS)) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, HOME_HUB_MUTATION: name }, encoding: 'utf8', timeout: 60000 });
  let out; try { out = JSON.parse(r.stdout.trim().split('\n').at(-1)); } catch { controls.invalid.push(`${name}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`); continue; }
  if (out.skipped) { controls.skipped.push(name); continue; }
  const freshFail = out.failed.filter(n => !baseline.has(n)); (freshFail.length ? controls.caught : controls.missed).push(freshFail.length ? `${name} -> ${freshFail[0]}` : name);
}
console.log(`negative controls: ${controls.caught.length} caught, ${controls.missed.length} missed, ${controls.skipped.length} skipped, ${controls.invalid.length} invalid`);
for (const c of controls.caught) console.log(`  caught  ${c}`); for (const c of controls.missed) console.error(`  MISSED  ${c}`); for (const c of controls.skipped) console.error(`  SKIPPED ${c}`); for (const c of controls.invalid) console.error(`  INVALID ${c}`);
if (controls.missed.length || controls.skipped.length || controls.invalid.length) failures.push({ name: 'negative controls', e: new Error('every mutation must be caught and its anchor must exist') });
for (const { name, e } of failures) console.error(`FAIL ${name}\n  ${String(e?.message || e).split('\n').join('\n  ')}`);
if (process.env.HUB_DEBUG) for (const { e } of failures) console.error(e?.stack);
if (failures.length) { console.error(`\n${failures.length}/${total} home checks failed (${passed} passed)`); process.exit(1); }
console.log(`PASS home (${total} checks): cover -> tickets -> visiting -> festivals -> local -> news/compact chart -> fanclub -> releases -> community -> tools -> artist index -> awards; no support blocks before visiting; hydration <=60 candidates in <=12-id chunks with <=3 workers, only missing ids, matching-only merge, failed-chunk tolerance, single remount with paused state, stale/leave fencing, origin-guarded ids; refresh preservation`);
