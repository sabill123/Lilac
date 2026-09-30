#!/usr/bin/env node
/** Run: node tests/verify-discovery-ui.mjs
 * Execute production discovery TS and its actual pure model. API/catalog/player
 * and optional Three adapters are injected. Lightweight HTML sinks exercise
 * emitted markup and real listeners, not browser layout or CSS visibility.
 * No server, network, account state, catalog reads or new dependencies. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
function load(relative, imports = {}, globals = {}) {
  const js = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 }, reportDiagnostics: true,
  });
  assert.equal(js.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, relative);
  const exports = {};
  vm.runInNewContext(js.outputText, { exports, URL, AbortController, ...globals, require(name) {
    assert.ok(Object.hasOwn(imports, name), `Unexpected import ${name} in ${relative}`);
    return imports[name];
  } }, { filename: relative });
  return exports;
}
const model = load('../frontend/src/discovery/model.ts');
const decode = value => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attributeMap = text => {
  const result = {};
  for (const match of text.matchAll(/([^\s=<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    result[match[1]] = decode(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
};
const dataKey = key => key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

/** HTML sinks deliberately support only this renderer's simple selectors. They
 * never fabricate a missing element, so missing controls fail the test. Nodes
 * preserve listeners between queries and respect their production AbortSignal. */
class Sink {
  constructor(tag = 'div', attrs = {}, owner = null) {
    this.tagName = tag; this.attrs = { ...attrs }; this.owner = owner; this.dataset = {};
    for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) this.dataset[dataKey(key)] = value;
    this._html = ''; this.textContent = ''; this.value = attrs.value || ''; this.hidden = Object.hasOwn(attrs, 'hidden');
    this.disabled = Object.hasOwn(attrs, 'disabled'); this.isConnected = true; this.listeners = new Map(); this.nodes = new Map();
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  get innerHTML() { return this._html; }
  set innerHTML(value) { this._html = value; this.nodes.clear(); }
  setAttribute(key, value) { this.attrs[key] = String(value); if (key.startsWith('data-')) this.dataset[dataKey(key)] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  hasAttribute(key) { return Object.hasOwn(this.attrs, key); }
  removeAttribute(key) { delete this.attrs[key]; }
  toggleAttribute(key, force) { const enabled = force ?? !this.hasAttribute(key); if (enabled) this.setAttribute(key, ''); else this.removeAttribute(key); if (key === 'hidden') this.hidden = enabled; return enabled; }
  closest(selector) { assert.equal(selector, 'button'); return this.tagName === 'button' ? this : null; }
  replaceChildren() { this.innerHTML = ''; }
  addEventListener(type, listener, options = {}) {
    const list = this.listeners.get(type) || []; list.push({ listener, options }); this.listeners.set(type, list);
  }
  async dispatch(type, target = this) {
    const event = { type, target, currentTarget: this, preventDefault() {}, stopPropagation() {} };
    for (const { listener, options } of this.listeners.get(type) || []) if (!options.signal?.aborted) await listener(event);
  }
  async click() { if (this.disabled) return; await this.dispatch('click'); if (this.owner && this.owner !== this) await this.owner.dispatch('click', this); }
  matchesSelector(tag, attrs, selector) {
    if (selector.startsWith('#')) return attrs.id === selector.slice(1);
    if (selector.startsWith('.')) return (attrs.class || '').split(/\s+/).includes(selector.slice(1));
    const match = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (match) return Object.hasOwn(attrs, match[1]) && (match[2] === undefined || attrs[match[1]] === match[2]);
    if (/^[a-z]+$/.test(selector)) return tag === selector;
    assert.fail(`Unsupported fixture selector: ${selector}`);
  }
  querySelectorAll(selector) {
    const found = [];
    for (const match of this._html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)) {
      const attrs = attributeMap(match[2]);
      if (!this.matchesSelector(match[1], attrs, selector)) continue;
      const identity = String(match.index);
      if (!this.nodes.has(identity)) this.nodes.set(identity, new Sink(match[1], attrs, this.owner || this));
      found.push(this.nodes.get(identity));
    }
    // Dynamic child sinks (chart rows) can contribute controls after rendering.
    for (const node of this.nodes.values()) if (node._html) found.push(...node.querySelectorAll(selector));
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const song = (title, patch = {}) => ({ rank: 1, title, artist: 'Example Artist', artwork: 'https://images.example/cover.jpg', ...patch });
const snapshot = (list, patch = {}) => ({ country: 'jp', source: 'combined', updated: new Date().toISOString(), live: false,
  method: '검증용 공식 단일 차트가 아닌 가중 합산 방식', sources: ['apple', 'appleRss', 'billboard', 'youtube'], weights: { apple: .2, billboard: .3 }, list, ...patch });
const context = {
  artists: [{ id: 'veteran', name: 'Example Artist', nameJa: null, searchTerm: 'Example Artist', aliases: [] }],
  products: [{ id: 'album /special', origin: 'jp', name: 'Album Commerce Sentinel', brand: 'Example Artist', releaseDate: '2025-01-01', artwork: 'https://images.example/album.jpg' }],
  // Must never be a substitute for unavailable chart evidence.
  tracks: [song('SEED_FALLBACK_SENTINEL')], seeds: [song('SEED_FALLBACK_SENTINEL')],
};
function fixture({ combined = snapshot([]), billboard = snapshot([], { source: 'billboard' }), response, country = 'jp', webgl = false, gpuFailure = false, catalog, candidates = [] } = {}) {
  const requests = [], catalogRequests = [], plays = [], messages = [], storage = new Map([['lilac.chartCountry', country]]);
  const visuals = { disposed: 0, home: 0, chart: 0 };
  const browserLocation = { hash:'#/chart/billboard', pathname:'/', search:'' }, replacements=[];
  const root = new Sink(); let host = null;
  Object.defineProperty(root, 'innerHTML', { get: () => root._html, set: value => {
    root._html = value; root.nodes.clear(); host = null;
  } });
  root.querySelector = selector => {
    assert.equal(selector, '.music-discovery');
    if (!root._html.includes('music-discovery')) return null;
    if (!host) { host = new Sink(); host._html = root._html; host.owner = host; }
    return host;
  };
  const homeHero = load('../frontend/src/discovery/home-hero.ts', { '../api': { artUrl: row => row.artwork || '', esc: escape, icon: () => '<svg aria-hidden="true"></svg>' } });
  const module = load('../frontend/src/discovery/index.ts', {
    './home-hero': homeHero,
    '../awards': { homeAwardsHtml: () => '<section class="home-awards" id="homeAwards"><h2>음악상 · 연말무대</h2></section>', mountHomeAwards() {} },
    './model': model, './debuts': { DEBUT_EVIDENCE: [] },
    '../api': { api: async (url, options) => {
      requests.push({ url, options });
      const parsed = new URL(url, 'https://lilac.example');
      if(parsed.pathname === '/api/catalog/search') return {tracks:candidates};
      assert.equal(parsed.pathname, '/api/charts', 'Discovery reads only plural chart snapshots, never seeds/private APIs');
      assert.ok(['jp', 'kr'].includes(parsed.searchParams.get('country')));
      assert.ok(parsed.searchParams.get('source'), 'Source parameter must be explicit');
      if (response) return response(parsed);
      return parsed.searchParams.get('source') === 'billboard' ? billboard : combined;
    }, artUrl: row => row.artwork || '', esc: escape, icon: () => '<svg aria-hidden="true"></svg>',
    findCatalog: async query => { catalogRequests.push(query); const actual=[...(combined?.list||[]),...(billboard?.list||[])].find(r=>r && `${r.artist} ${r.title}`===query); return catalog ? catalog(query) : {
      title: actual?.title||query.replace(/^Example Artist /,''), artist: actual?.artist||'Example Artist', album: 'Catalog album', artwork: 'https://images.example/resolved.jpg', preview: 'https://audio.example/preview.m4a',
    }; }, needsLogin: () => false, me: null },
    '../player': { playQueue: (...args) => plays.push(args), enqueue() {}, openYt() {}, toast: message => messages.push(message) },
    '../three': { can3D: () => webgl, setSceneMotionPaused() {}, disposeScene: () => { visuals.disposed++; },
      // Real Three adapter catches GPU/import failures and resolves with fallback.
      mountHero3D: async stage => { visuals.home++; if (gpuFailure) stage.dataset.scene3d = 'fallback'; },
      mountChart3D: async stage => { visuals.chart++; if (gpuFailure) stage.dataset.scene3d = 'fallback'; } },
  }, { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    matchMedia: () => ({ matches: false, addEventListener() {} }), HTMLImageElement: class {},
    location:browserLocation, history:{replaceState:(_state,_title,url)=>replacements.push(url)},
  });
  return { root, module, requests, catalogRequests, plays, messages, storage, visuals, replacements,
    host: () => host, html: () => root.innerHTML, rows: () => host?.querySelector('#mdChartRows')?.innerHTML || '',
    home: async () => { await module.renderMusicHome(root, context); await flush(); },
    chart: async (source = 'combined') => { await module.renderMusicChart(root, context, source); await flush(); } };
}
const text = markup => decode(markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
const button = (host, attribute, value) => {
  const node = host.querySelector(`[${attribute}="${value}"]`);
  assert.ok(node, `Missing ${attribute}=${value}`); return node;
};
let passed = 0; const failures = [];
async function check(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.stack}`); }
}

await check('home fetches plural country/source snapshots and puts playable music before commerce', async () => {
  const f = fixture({ combined: snapshot([song('Chart Music Sentinel')]) }); await f.home();
  assert.deepEqual(f.requests.map(r => r.url), ['/api/charts?country=jp&source=combined', '/api/charts?country=jp&source=billboard']);
  assert.equal((f.html().match(/<h1\b/g) || []).length, 1);
  assert.match(f.html(), /<h1 class="li-home-wordmark" aria-label="Lilac 음악">음악<\/h1>/);
  assert.ok(f.html().indexOf('li-home-hero') < f.html().indexOf('home-awards'));
  assert.ok(f.html().indexOf('home-awards') < f.html().indexOf('id="homeMusic"'));
  assert.doesNotMatch(f.html(), /#\/specials|aw-home-card/);
  assert.ok(f.html().indexOf('data-md-play') < f.html().indexOf('href="#/store'), 'Music playback precedes store navigation');
  assert.ok(f.html().indexOf('Chart Music Sentinel') < f.html().indexOf('Album Commerce Sentinel'));
  assert.match(text(f.html()), /미리듣기 30초/);
  assert.doesNotMatch(f.html(), /SEED_FALLBACK_SENTINEL/);
  assert.equal(f.catalogRequests.length, 0, 'No background catalog resolution before playback');
  await button(f.host(), 'data-md-play', '0').click(); await flush();
  assert.equal(f.catalogRequests[0], 'Example Artist Chart Music Sentinel');
  assert.equal(f.plays.length, 1);
});
await check('Korean country persists in requests and incompatible chart source falls back to combined', async () => {
  const f = fixture({ country: 'kr', combined: snapshot([song('Korean Song')], { country: 'kr', sources: ['melon', 'genie'] }) });
  await f.home();
  assert.deepEqual(f.requests.map(r => r.url), ['/api/charts?country=kr&source=combined']);
  await f.chart('billboard');
  assert.equal(f.requests.at(-1).url, '/api/charts?country=kr&source=combined');
  assert.match(text(f.html()), /한국/);
  assert.equal(f.replacements.at(-1),'/#/chart/combined');
});
await check('chart shows raw provider count, independent classification method and collection caveat', async () => {
  const f = fixture({ combined: snapshot([song('Corroborated', { rank: 4, ranks: { apple: 2, appleRss: 3, billboard: 4 }, ytViews: 1200000 })]) });
  await f.chart();
  assert.equal((f.html().match(/<h1\b/g) || []).length, 1);
  assert.match(text(f.html()), /검증용 공식 단일 차트가 아닌 가중 합산 방식/);
  assert.match(text(f.html()), /수집 시각은 원본 차트의 발표 시각과 다를 수 있습니다/);
  assert.match(text(f.rows()), /3개 출처/);
  assert.match(text(f.rows()), /Apple Music 2위/); assert.match(text(f.rows()), /Apple 공식 피드 3위/);
  assert.match(text(f.rows()), /Billboard JAPAN 4위/); assert.match(text(f.rows()), /YouTube 누적/);
  assert.match(f.html(), /href="#\/chart\/appleRss"/);
  assert.equal(f.host().querySelector('#mdChartCount').textContent, '1곡');
});
await check('combined missing movement stays unknown and NEW never creates rookie evidence', async () => {
  const f = fixture({ combined: snapshot([song('Combined Unknown')]), billboard: snapshot([
    song('Veteran New', { move: 'new', lastRank: null }), song('Bad Up', { rank: 2, move: 'up', lastRank: 1 }),
    song('True Up', { rank: 8, move: 'up', lastRank: 20 }),
  ], { source: 'billboard' }) });
  await f.home();
  assert.match(f.html(), /Veteran New/); assert.match(text(f.html()), /신규 진입.*신인 아티스트 분류와 다릅니다/);
  assert.match(text(f.html()), /공식 데뷔일을 확인한 신인이 없습니다/);
  assert.doesNotMatch(f.html(), /class="md-rookie-tag"/);
  await f.chart();
  assert.doesNotMatch(f.rows(), /↑|↓|>NEW</);
  assert.match(text(f.html()), /전회 대비/); assert.doesNotMatch(text(f.html()), /실시간 상승|오늘 상승|지금 급상승/);
  await f.chart('billboard');
  await button(f.host(), 'data-md-filter', 'new').click();
  assert.match(f.rows(), /Veteran New/); assert.doesNotMatch(f.rows(), /True Up|Bad Up/);
  await button(f.host(), 'data-md-filter', 'rookie').click();
  assert.match(text(f.rows()), /조건에 맞는 곡이 없습니다/);
  assert.equal(f.host().querySelector('#mdChartCount').textContent, '0곡');
});
await check('filter/search preserve reported ranks and selected-row playback mapping', async () => {
  const f = fixture({ billboard: snapshot([
    song('First', { rank: 1, move: 'same', lastRank: 1 }),
    song('Chosen', { rank: 17, move: 'up', lastRank: 30 }),
    song('Other Rising', { rank: 35, move: 'up', lastRank: 40 }),
  ], { source: 'billboard' }) }); await f.chart('billboard');
  await button(f.host(), 'data-md-filter', 'up').click();
  const search = f.host().querySelector('#mdChartSearch'); search.value = '  Chosen  '; await search.dispatch('input');
  assert.equal(f.host().querySelector('#mdChartCount').textContent, '1곡');
  assert.match(f.rows(), />17</); assert.doesNotMatch(f.rows(), /Other Rising|>First</);
  const play = f.host().querySelector('#mdChartRows').querySelector('[data-md-play="1"]');
  assert.ok(play, 'Filtered row keeps original row identity');
  await play.click(); await flush();
  assert.equal(f.catalogRequests.at(-1), 'Example Artist Chosen');
  assert.equal(f.plays.length, 1);
  await f.host().querySelector('#mdPlayChart').click(); await flush();
  assert.equal(f.plays.length, 2); assert.equal(f.plays[1][0].length, 1);
  assert.equal(f.catalogRequests.at(-1), 'Example Artist Chosen');
});
await check('chart filter reset restores rows and disables play on empty searches', async () => {
  const f = fixture({ combined: snapshot([song('Visible')]) }); await f.chart();
  const search = f.host().querySelector('#mdChartSearch'); search.value = 'Unmatched'; await search.dispatch('input');
  assert.equal(f.host().querySelector('#mdPlayChart').disabled, true);
  assert.equal(f.host().querySelector('#mdShuffle').disabled, true);
  const clear = f.host().querySelector('#mdChartRows').querySelector('[data-md-clear]'); assert.ok(clear);
  await clear.click();
  assert.equal(search.value, ''); assert.equal(f.host().querySelector('#mdChartCount').textContent, '1곡');
  assert.equal(f.host().querySelector('#mdPlayChart').disabled, false);
});
await check('null/malformed envelopes and lists render safely without invented chart songs', async () => {
  for (const data of [null, {}, { list: null }, { list: {} }, { list: 'not an array' }]) {
    const f = fixture({ combined: data, billboard: data }); await f.home(); await f.chart();
    assert.equal(f.host().querySelector('#mdChartCount').textContent, '0곡');
    assert.doesNotMatch(f.html() + f.rows(), /SEED_FALLBACK_SENTINEL/);
    assert.equal(f.host().querySelector('#mdPlayChart').disabled, true);
  }
});
await check('null rows and malformed identities/ranks are ignored while valid rows survive', async () => {
  const data = snapshot([null, undefined, {}, song('Negative', { rank: -1 }), song('Decimal', { rank: 1.5 }),
    song('String rank', { rank: '2' }), song('Bad title', { title: 123 }), song('Bad artist', { artist: {} }),
    song('Valid survivor', { rank: 9 })]);
  const f = fixture({ combined: data, billboard: data }); await f.home(); await f.chart();
  assert.equal(f.host().querySelector('#mdChartCount').textContent, '1곡');
  assert.match(f.rows(), /Valid survivor/); assert.doesNotMatch(f.rows(), /Negative|Decimal|String rank|Bad title|Bad artist/);
});
await check('network failures yield explicit empty/error state without seed fallback', async () => {
  const f = fixture({ response: () => { throw Error('Synthetic offline'); } });
  await f.home(); assert.match(text(f.html()), /차트를 불러오지 못했습니다/); assert.match(text(f.html()), /다시 시도/);
  await f.chart(); assert.match(text(f.rows()), /차트를 불러오지 못했습니다/);
  assert.equal(f.host().querySelector('#mdChartCount').textContent, '0곡');
  assert.doesNotMatch(f.html() + f.rows(), /SEED_FALLBACK_SENTINEL/);
  assert.equal(f.catalogRequests.length, 0);
});
await check('static hero artwork and preview controls survive unavailable or failed Three enhancement', async () => {
  for (const options of [{ webgl: false }, { webgl: true, gpuFailure: true }]) {
    const f = fixture({ ...options, combined: snapshot([song('Static Hero')]) });
    for (const render of [() => f.home(), () => f.chart()]) {
      await render();
      assert.match(f.html(), /<img[^>]+src="https:\/\/images\.example\/cover.jpg"/);
      assert.match(f.html(), /md-static-art[\s\S]*<img/);
      assert.match(text(f.html()), /Static Hero/); assert.match(text(f.html()), /미리듣기/);
      assert.ok(f.host().querySelector('[data-md-play="0"]'));
      assert.doesNotMatch(f.html(), /<canvas/);
      const motion = f.host().querySelector('[data-md-motion]');
      assert.equal(motion.disabled, true, 'A failed scene must not leave an operational-looking motion control');
      assert.equal(motion.textContent, '정적 아트워크');
      assert.equal(motion.getAttribute('aria-pressed'), 'false');
    }
    if (options.webgl) { assert.equal(f.visuals.home, 1); assert.equal(f.visuals.chart, 1); }
    else { assert.equal(f.visuals.home, 0); assert.equal(f.visuals.chart, 0); }
  }
});
await check('unavailable preview reports honestly without starting fabricated playback', async () => {
  const f = fixture({ combined: snapshot([song('No Preview', { youtubeId: null })]), catalog: () => null });
  await f.chart(); await button(f.host(), 'data-md-play', '0').click(); await flush();
  assert.equal(f.plays.length, 0); assert.match(f.messages.join(' '), /미리듣기가 없습니다/);
});
await check('disposal cancels delayed chart/home responses before they overwrite another route', async () => {
  for (const render of ['renderMusicHome', 'renderMusicChart']) {
    const pending = deferred(); const f = fixture({ response: () => pending.promise });
    assert.equal(typeof f.module.disposeDiscovery, 'function', 'Parent must export disposeDiscovery()');
    const rendering = f.module[render](f.root, context);
    f.module.disposeDiscovery(); f.root.innerHTML = '<main><h1>다른 경로</h1></main>';
    pending.resolve(snapshot([song('STALE_RESPONSE_SENTINEL')]));
    await rendering; await flush();
    assert.equal(f.root.innerHTML, '<main><h1>다른 경로</h1></main>');
  }
});
await check('newer render wins when previous route request resolves out of order', async () => {
  const old = deferred(); let calls = 0;
  const f = fixture({ response: () => ++calls === 1 ? old.promise : snapshot([song('New Route')], { source: 'apple' }) });
  const first = f.module.renderMusicChart(f.root, context, 'combined');
  await f.module.renderMusicChart(f.root, context, 'apple');
  old.resolve(snapshot([song('Old Route')])); await first; await flush();
  assert.match(f.html(), /New Route/); assert.doesNotMatch(f.html(), /Old Route/);
});
await check('hero never relabels first available rank as fabricated number one', async () => {
  const f = fixture({ combined: snapshot([song('First available', { rank: 9 })]) });
  await f.home();
  assert.doesNotMatch(text(f.html()), /통합 1위/);
  await f.chart();
  assert.doesNotMatch(f.html(), /aria-label="차트 1위"/);
  assert.doesNotMatch(text(f.html()), /1위/);
  assert.match(text(f.html()), /9위/);
});
await check('selected identity rejects covers and unrelated first hits but finds exact candidates', async () => {
  const row=song('Original');
  const f=fixture({combined:snapshot([row]),catalog:()=>({title:'Original',artist:'Cover Band',preview:'https://audio.example/wrong'})});
  await f.chart();await button(f.host(),'data-md-play','0').click();await flush();assert.equal(f.plays.length,0);
  const g=fixture({combined:snapshot([row]),catalog:()=>({title:'Different',artist:'Example Artist',preview:'https://audio.example/wrong'}),candidates:[{title:'Original',artist:'Example Artist',preview:'https://audio.example/right'}]});
  await g.chart();await button(g.host(),'data-md-play','0').click();await flush();assert.equal(g.plays[0][0][0].preview,'https://audio.example/right');
});
await check('Apple track ID is binding when supplied by the chart', async () => {
  const row=song('Original',{appleUrl:'https://music.apple.com/jp/album/example/9988?i=12345'});
  const f=fixture({combined:snapshot([row]),catalog:()=>({id:777,title:'Original',artist:'Example Artist',preview:'https://audio.example/wrong'}),candidates:[{id:12345,title:'Localized original',artist:'Example Artist',preview:'https://audio.example/right'}]});
  await f.chart();await button(f.host(),'data-md-play','0').click();await flush();assert.equal(f.plays[0][0][0].preview,'https://audio.example/right');
});
await check('disposal invalidates delayed playback as well as rendered content', async () => {
  const pending=deferred();const f=fixture({combined:snapshot([song('Slow')]),catalog:()=>pending.promise});
  await f.chart();const click=button(f.host(),'data-md-play','0').click();await flush();f.module.disposeDiscovery();
  pending.resolve({title:'Slow',artist:'Example Artist',preview:'https://audio.example/old'});await click;await flush();assert.equal(f.plays.length,0);
});

await check('missing provider artwork joins by full identity without borrowing rank or movement', async () => {
  const own=song('Same',{rank:9,move:'down',lastRank:3,artwork:null});
  const f=fixture({billboard:snapshot([own],{source:'billboard'}),combined:snapshot([song('Same',{rank:1,move:'up',lastRank:99,artwork:'https://images.example/correct-art'})])});
  await f.chart('billboard');assert.match(f.html(),/correct-art/);assert.match(text(f.rows()),/9.*↓ 6/);assert.doesNotMatch(text(f.rows()),/↑ 98/);
  const g=fixture({billboard:snapshot([own],{source:'billboard'}),combined:snapshot([song('Same',{artist:'Different Artist',artwork:'https://images.example/wrong-art'})])});
  await g.chart('billboard');assert.doesNotMatch(g.html(),/wrong-art/);
});

await check('menus choose available space above player and constrain short viewports', async () => {
  const f=fixture({combined:snapshot([song('Menu Song')])});await f.chart();
  const panel={scrollHeight:254,style:{}}, bounds={top:644,bottom:686}, player={top:720,height:64};
  const menu={open:true,dataset:{},matches:()=>true,querySelector:()=>panel,getBoundingClientRect:()=>bounds,ownerDocument:{defaultView:{innerHeight:844},querySelector:selector=>({getBoundingClientRect:()=>selector==='#player'?player:{bottom:116,height:116}})}};
  const host=f.host(), original=host.querySelectorAll.bind(host);host.querySelectorAll=selector=>selector.includes('[open]')?[menu]:original(selector);
  await host.dispatch('toggle',menu);assert.equal(menu.dataset.placement,'up');assert.equal(panel.style.maxHeight,'513px');
  bounds.top=160;bounds.bottom=202;await host.dispatch('toggle',menu);assert.equal(menu.dataset.placement,'down');
  player.top=320;bounds.top=235;bounds.bottom=277;await host.dispatch('toggle',menu);assert.equal(menu.dataset.placement,'up');assert.equal(panel.style.maxHeight,'104px');
});

await check('MV-only tracks are not queued as nonexistent audio previews', async () => {
  const f = fixture({ combined: snapshot([song('MV only', { youtubeId: 'video-only-id' })]), catalog: () => null });
  await f.chart(); await button(f.host(), 'data-md-play', '0').click(); await flush();
  // Production playQueue calls playCurrent(), which requires preview and does
  // not open YouTube. Sending a youtubeId-only object silently skips the track.
  assert.ok(f.plays.every(([queue]) => queue.every(track => Boolean(track.preview))),
    'Preview queue must contain playable preview URLs, not only youtubeId; MV has its own explicit control');
});
await check('all displayed record destinations have ordinary keyboard-accessible links', async () => {
  const f = fixture({ combined: snapshot([song('No artwork', { artwork: null }), song('Record one'), song('Record two'), song('Record three'), song('Beyond scene')]) });
  await f.home();
  const links = f.html().match(/<nav class="li-home-record-links"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(links, 'The decorative canvas cannot be the sole path to its destinations');
  assert.equal((links.match(/<a\b/g) || []).length, 3);
  for (const title of ['Record one', 'Record two', 'Record three']) {
    assert.ok(links.includes('#/search?q=' + encodeURIComponent('Example Artist ' + title)));
    assert.ok(links.includes(title + ' · Example Artist'));
  }
  assert.doesNotMatch(links, /No artwork|Beyond scene/);
});
await check('record selection updates the existing exact playback target without autoplay', async () => {
  const f = fixture({ combined: snapshot([song('First', {rank:1}), song('Second', {rank:2}), song('Third', {rank:3})]) });
  await f.home();
  const stage=f.host().querySelector('.md-scene'), selected=[]; stage.__selectHero=i=>selected.push(i);
  await button(f.host(),'data-home-record','1').click();
  assert.equal(f.plays.length,0);
  assert.equal(f.host().querySelector('[data-home-title]').textContent,'Second');
  assert.equal(f.host().querySelector('[data-home-rank]').textContent,'2위');
  assert.equal(button(f.host(),'data-home-record','1').getAttribute('aria-pressed'),'true');
  assert.equal(button(f.host(),'data-home-record','0').getAttribute('aria-pressed'),'false');
  assert.deepEqual(selected,[1]);
  await f.host().querySelector('.li-home-play').click(); await flush();
  assert.equal(f.plays[0][0][0].title,'Second');
  f.module.disposeDiscovery(); await button(f.host(),'data-home-record','2').click();
  assert.deepEqual(selected,[1], 'Aborted controls cannot mutate a departed scene');
});
console.log(`Discovery UI checks: ${passed} passed, ${failures.length} failed (${passed + failures.length} groups).`);
if (failures.length) { console.error(`Failed groups: ${failures.join('; ')}`); process.exitCode = 1; }
