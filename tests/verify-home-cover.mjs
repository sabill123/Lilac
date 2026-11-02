#!/usr/bin/env node
/** Actual home-cover module (plus actual i18n/ui/cards) transpiled into a controlled VM.
 * Contract: per artist a CURRENT verified official profile (2s) then that artist's own album cover or
 * official/event concert image (2s), then the next artist. Fake DOM / Image readiness / virtual clock /
 * IntersectionObserver / matchMedia only. No network, browser, backend, storage, credentials or production env.
 * node tests/verify-home-cover.mjs            -> suite + negative-control mutations (child processes of this file)
 * HOME_COVER_MUTATION=<name> node tests/...   -> internal: run the suite against one mutated copy, print JSON */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
import postcss from '../frontend/node_modules/postcss/lib/postcss.mjs';

const plain = v => JSON.parse(JSON.stringify(v)); const same = (actual, expected, msg) => assert.deepEqual(plain(actual), expected, msg);
const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const MUTATION = process.env.HOME_COVER_MUTATION || '';
const realSource = read('../frontend/src/app/pages/home-cover.ts');

/* Negative controls: each mutation must make at least one check fail that passes on the real module. */
const MUTATIONS = {
  'timing: 9s interval instead of COVER_FRAME_MS': ['},COVER_FRAME_MS);', '},9000);'],
  'timing: autoplay armed before the visible image loads': ['paintImage();sync();\n}', 'paintImage();sync();ready=true;restart();\n}'],
  'readiness: commit without waiting for the preloaded image': ['if(image.complete){if(image.naturalWidth)apply();else fail();return;}', 'apply();return;'],
  'readiness: stale preload may overwrite newer navigation': ['const apply=()=>{if(!live()||request!==token)return;', 'const apply=()=>{if(!live())return;'],
  'readiness: already-failed cached preload stays busy': ['if(image.naturalWidth)apply();else fail();return;', 'if(image.naturalWidth){apply();return;}'],
  'readiness: autoplay re-armed while a navigation is pending': ['||!ready||pending||', '||!ready||'],
  'holds: automatic load commits despite holds at load time': ['if(automatic&&(paused||reduce.matches||!inView||document.hidden||hover||host.contains(document.activeElement)))', 'if(false)'],
  'ownership: portrait artistId not checked': ["p.artistId!==a.id||", ''],
  'ownership: portrait status/method not checked': ["p.status!=='verified'||p.method!=='official-profile'||", ''],
  'ownership: stale portrait (>24h) accepted': ['age>=86400000', 'age>=8640000000'],
  'ownership: any release artwork kind accepted': ["r.artworkKind==='album-cover'", 'true'],
  'ownership: any concert poster kind accepted': ["['official','event'].includes(c.posterKind||'')", 'true'],
  'ownership: profile equal to secondary allowed': ['secondary.image===image||', ''],
  'navigation: manual tab keeps current phase': ["b.addEventListener('click',()=>go(i,0)", "b.addEventListener('click',()=>go(i,phase)"],
  'holds: focus inside never holds autoplay (timer and load-time check)': ['host.contains(document.activeElement)', 'false'],
  'holds: reduced motion ignored by autoplay': ['if(paused||reduce.matches||!ready', 'if(paused||!ready'],
  'holds: pause cancels a pending manual navigation': ['if(paused&&pending&&pendingAutomatic)', 'if(paused)'],
  'origin: edition guard removed': ['.filter(a=>!wanted||a.origin===wanted)', ''],
  'origin: kr edition keeps kr artists': ["d.edition==='kr'?'jp'", "d.edition==='kr'?'kr'"],
  'ranking: follow concert/release order instead of artist ranking': ['const ids=[...artists.keys()].filter(id=>eligible.has(id));', 'const ids=[...eligible];'],
  'pool: coverReleases ignored': ['...(d.coverReleases||[]),', ''],
  'pool: coverConcerts ignored': ['...(d.coverConcerts||[]),', ''],
  'bounds: 6 slides instead of 12': ['}).slice(0,12);', '}).slice(0,6);'],
  'bounds: 12 candidate ids instead of 60': ['ownedCandidates(d).slice(0,60)', 'ownedCandidates(d).slice(0,12)'],
  'dedup: cross-artist image reuse allowed': ['||usedImages.has(image)||usedImages.has(secondary.image)', ''],
  'labels: visible 2s frame label returns': ['<h2 class="cover-name">', '<span>공식 프로필 · 2초</span><h2 class="cover-name">'],
};
const coverSource = MUTATION ? (() => { const [a, b] = MUTATIONS[MUTATION] || []; if (!a || !realSource.includes(a)) { console.log(JSON.stringify({ skipped: true })); process.exit(0); } return realSource.split(a).join(b); /* every occurrence */ })() : realSource;

/* ---------- fake image readiness (shared by preloaders and rendered <img>) ---------- */
const imageState = new Map(); // src -> 'loaded' | 'error'; absent = still loading
const domImages = [], fakeImages = [], preloadRequests = [];
class FakeImage extends EventTarget {
  referrerPolicy = ''; decoding = ''; _src = ''; srcRemoved = false;
  get src() { return this._src; } set src(v) { this._src = String(v); fakeImages.push(this); preloadRequests.push(this._src); }
  get complete() { return imageState.has(this._src); } get naturalWidth() { return imageState.get(this._src) === 'loaded' ? 1600 : 0; }
  removeAttribute(k) { if (k === 'src') { this._src = ''; this.srcRemoved = true; } }
}
function settle(src, state = 'loaded') {
  imageState.set(src, state);
  const targets = [...fakeImages.filter(i => i._src === src), ...domImages.filter(i => i.getAttribute('src') === src)];
  for (const t of targets) t.dispatchEvent(new Event(state === 'loaded' ? 'load' : 'error'));
}

/* ---------- minimal HTML fake DOM (enough for the markup this module generates) ---------- */
const VOID = new Set(['img', 'br', 'input', 'meta', 'link', 'source', 'hr', 'use']);
const decode = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const encAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const encText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let fakeDocument; // assigned below
// image readiness lives in imageState (see FakeImage)
class Text { constructor(t) { this.text = t; this.parent = null; } get textContent() { return this.text; } }
class El extends EventTarget {
  constructor(tag = 'div') { super(); this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.children = []; this.parent = null; this.connectedRoot = false; this.styleProps = new Map();
    const self = this; this.style = { setProperty(k, v) { self.styleProps.set(k, v); }, getPropertyValue(k) { return self.styleProps.get(k) ?? ''; } };
    if (this.tagName === 'IMG') domImages.push(this);
  }
  get localName() { return this.tagName.toLowerCase(); }
  get complete() { return this.tagName === 'IMG' ? imageState.has(this.getAttribute('src')) : undefined; }
  get naturalWidth() { return this.tagName === 'IMG' && imageState.get(this.getAttribute('src')) === 'loaded' ? 1600 : 0; }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  removeAttribute(k) { this.attrs.delete(k); }
  hasAttribute(k) { return this.attrs.has(k); }
  get hidden() { return this.attrs.has('hidden'); } set hidden(v) { v ? this.attrs.set('hidden', '') : this.attrs.delete('hidden'); }
  get disabled() { return this.attrs.has('disabled'); } set disabled(v) { v ? this.attrs.set('disabled', '') : this.attrs.delete('disabled'); }
  get tabIndex() { return Number(this.attrs.get('tabindex') ?? -1); } set tabIndex(v) { this.attrs.set('tabindex', String(v)); }
  get className() { return this.attrs.get('class') || ''; }
  get classList() { const el = this; const list = () => (el.attrs.get('class') || '').split(/\s+/).filter(Boolean); const put = a => el.attrs.set('class', a.join(' '));
    return { contains: c => list().includes(c), add: (...c) => put([...new Set([...list(), ...c])]), remove: (...c) => put(list().filter(x => !c.includes(x))), toggle(c, f) { const on = f ?? !list().includes(c); on ? this.add(c) : this.remove(c); return on; } }; }
  get dataset() { const out = {}; for (const [k, v] of this.attrs) if (k.startsWith('data-')) out[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v; return out; }
  get isConnected() { let n = this; while (n) { if (n.connectedRoot) return true; n = n.parent; } return false; }
  get textContent() { return this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children.forEach(c => { c.parent = null; }); const t = new Text(String(v)); t.parent = this; this.children = [t]; }
  get innerHTML() { return this.children.map(serialize).join(''); }
  set innerHTML(html) { this.children.forEach(c => { c.parent = null; }); this.children = []; parseInto(this, String(html)); }
  get elements() { return this.children.filter(c => c instanceof El); }
  *walk() { for (const c of this.elements) { yield c; yield* c.walk(); } }
  matches(sel) { return sel.split(',').some(s => matchChain(this, s.trim().split(/\s+/))); }
  querySelector(sel) { for (const e of this.walk()) if (e.matches(sel)) return e; return null; }
  querySelectorAll(sel) { return [...this.walk()].filter(e => e.matches(sel)); }
  contains(n) { while (n) { if (n === this) return true; n = n.parent; } return false; }
  focus() { fakeDocument.activeElement = this; }
  click() { this.dispatchEvent(new Event('click')); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 500 }; }
}
function serialize(n) {
  if (n instanceof Text) return encText(n.text);
  const attrs = [...n.attrs].map(([k, v]) => v === '' && (k === 'hidden' || k === 'disabled') ? ` ${k}` : ` ${k}="${encAttr(v)}"`).join('');
  const tag = n.localName; return VOID.has(tag) ? `<${tag}${attrs}>` : `<${tag}${attrs}>${n.children.map(serialize).join('')}</${tag}>`;
}
function parseInto(root, html) {
  const re = /<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)((?:\s+[^\s=\/>]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g; let m, cur = root;
  while ((m = re.exec(html))) {
    if (m[1]) { const tag = m[1].toUpperCase(); let n = cur; while (n && n !== root && n.tagName !== tag) n = n.parent; if (!n || n === root) throw new Error(`Unbalanced </${m[1]}> in generated HTML`); cur = n.parent; }
    else if (m[2]) { const el = new El(m[2]); for (const a of m[3].matchAll(/([^\s=\/>]+)(?:="([^"]*)")?/g)) el.attrs.set(a[1], a[2] === undefined ? '' : decode(a[2])); el.parent = cur; cur.children.push(el); if (!m[4] && !VOID.has(m[2].toLowerCase())) cur = el; }
    else if (m[5]) { const t = new Text(decode(m[5])); t.parent = cur; cur.children.push(t); }
    else throw new Error('Unparseable HTML near: ' + html.slice(re.lastIndex, re.lastIndex + 40));
  }
  if (cur !== root) throw new Error(`Unclosed <${cur.localName}> in generated HTML`);
}
function matchChain(el, parts) { if (!matchCompound(el, parts.at(-1))) return false; const rest = parts.slice(0, -1); if (!rest.length) return true; for (let p = el.parent; p instanceof El; p = p.parent) if (matchChain(p, rest)) return true; return false; }
function matchCompound(el, sel) {
  const parts = sel.match(/^[a-z0-9]+|\.[\w-]+|\[[^\]]+\]/gi); if (!parts || parts.join('') !== sel) throw new Error('Unsupported selector in fake DOM: ' + sel);
  return parts.every(p => { if (p[0] === '.') return el.classList.contains(p.slice(1)); if (p[0] === '[') { const [, k, op, v] = p.match(/^\[([^=\]^]+)(?:(\^?=)"([^"]*)")?\]$/); if (v === undefined) return el.attrs.has(k); const got = el.attrs.get(k); return op === '^=' ? typeof got === 'string' && got.startsWith(v) : got === v; } return el.localName === p.toLowerCase(); });
}


/* ---------- controlled globals: virtual clock, observers, media, Date ---------- */
let seq = 0, clock = 0; const intervals = new Map(), frames = new Map(), observers = [], mediaQueries = [];
let reduceMotion = false;
const NOW = Date.parse('2026-10-25T03:00:00.000Z'); const RealDate = Date;
class FakeDate extends RealDate { constructor(...a) { a.length ? super(...a) : super(NOW); } static now() { return NOW; } }
fakeDocument = { hidden: false, activeElement: null, documentElement: { lang: '' } };
class FakeIO { constructor(cb) { this.cb = cb; this.targets = []; this.disconnected = false; observers.push(this); } observe(t) { this.targets.push(t); } disconnect() { this.disconnected = true; } emit(isIntersecting) { if (!this.disconnected) this.cb([{ isIntersecting, target: this.targets[0] }]); } }
const globals = {
  console, URL, URLSearchParams, AbortController, Event, EventTarget, encodeURIComponent, Date: FakeDate,
  document: fakeDocument, IntersectionObserver: FakeIO, Image: FakeImage,
  matchMedia(q) { const mq = new EventTarget(); mq.media = q; mq.matches = q.includes('prefers-reduced-motion') ? reduceMotion : false; mediaQueries.push(mq); return mq; },
  setInterval(fn, ms) { const id = ++seq; intervals.set(id, { fn, ms, due: clock + ms }); return id; }, clearInterval(id) { intervals.delete(id); },
  setTimeout() { throw new Error('home-cover is not expected to use setTimeout'); },
  requestAnimationFrame(fn) { const id = ++seq; frames.set(id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); globals.cancelledFrames.push(id); },
  cancelledFrames: [],
};
globals.window = globals;
/** Advance the virtual clock, firing intervals in due order (an interval cleared inside a callback stops). */
function advance(ms) { const end = clock + ms; for (;;) { let next = null; for (const [id, t] of intervals) if (t.due <= end && (!next || t.due < next[1].due)) next = [id, t]; if (!next) break; clock = next[1].due; next[1].due += next[1].ms; next[1].fn(); } clock = end; }
const ctx = vm.createContext(globals);
const loaded = {};
function load(rel, deps, source) {
  const js = ts.transpileModule(source ?? read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; vm.runInContext(`(function(exports,require){${js}\n})`, ctx)(exports, name => { if(name==='./name-reading')return load('../frontend/src/app/name-reading.ts',{}); if (name in deps) return deps[name]; throw new Error(`${rel}: unexpected import ${name}`); });
  return exports;
}
loaded.i18n = load('../frontend/src/app/i18n.ts', {});
loaded.ui = load('../frontend/src/app/ui.ts', { './i18n': loaded.i18n });
loaded.cards = load('../frontend/src/app/cards.ts', { './ui': loaded.ui, './i18n': loaded.i18n,
  './fanclub': { withUtm: u => u }, './state': { state: {}, isFollowing: () => false, toggleFollow() {} }, './player': { keyOf: () => '' }, './social': { likeBtn: () => '', talkBtn: () => '', trackTarget: () => '' } });
const cover = load('../frontend/src/app/pages/home-cover.ts', { '../i18n': loaded.i18n, '../ui': loaded.ui, '../cards': loaded.cards }, coverSource);
const setLocale = l => loaded.i18n.setLocale(l);

/* ---------- check runner: run every case, report all failures ---------- */
const failures = []; let passed = 0; const liveFixtures = [];
async function check(name, fn) {
  try { await fn(); passed++; } catch (e) { failures.push({ name, e }); }
  finally { liveFixtures.splice(0).forEach(c => c.abort()); intervals.clear(); frames.clear(); imageState.clear(); domImages.length = 0; fakeImages.length = 0; preloadRequests.length = 0; clock = 0; setLocale('ko'); fakeDocument.hidden = false; fakeDocument.activeElement = null; reduceMotion = false; }
}

/* ---------- synthetic fixtures (no real personal data) ---------- */
const IMG = n => `https://images.example/${n}.jpg`;
const iso = ms => new RealDate(ms).toISOString();
const HOUR = 3600e3;
const portrait = (id, o = {}) => ({ artistId: id, status: 'verified', method: 'official-profile', imageUrl: IMG('profile-' + id), sourceUrl: `https://official.example/${id}/profile`, checkedAt: iso(NOW - HOUR), ...o });
const artist = (id, o = {}) => ({ id, name: `Artist ${id}`, portrait: portrait(id), ...o });
const release = (id, artistId, o = {}) => ({ id, tier: 'a', artist: 'listed artist', artistId, title: `Album ${id}`, country: 'KR', releaseDate: '2026-10-01', artwork: IMG('album-' + id), artworkKind: 'album-cover', artworkSource: { artistId, sourceUrl: `https://music.example/album/${id}` }, ...o });
const concert = (id, o = {}) => ({ id, provider: 'nol', providerLabel: 'NOL', title: `Performer ${id} Tour`, performer: `Performer ${id}`, artistId: null, venue: 'Hall A', city: 'Seoul', country: 'KR', startDate: '2026-11-20', endDate: null, status: 'onsale', poster: IMG('poster-' + id), posterKind: 'official', url: `https://tickets.example/${id}`, ...o });
const data = (o = {}) => ({ visiting: [], abroad: [], artists: [], releases: [], ...o });
/** n artists a0..a(n-1), each with a verified portrait and own album r0..; release dates descend so order is a0, a1, ... */
const pairs = (n = 8) => data({ artists: Array.from({ length: n }, (_, i) => artist('a' + i)), releases: Array.from({ length: n }, (_, i) => release('r' + i, 'a' + i, { releaseDate: `2026-09-${String(28 - i).padStart(2, '0')}` })) });
const P = i => IMG('profile-a' + i), A = i => IMG('album-r' + i);

function mountFixture(d, { connected = true } = {}) {
  const root = new El('main'); root.connectedRoot = connected; root.innerHTML = cover.homeCoverHtml(d);
  const ctrl = new AbortController(); liveFixtures.push(ctrl); const before = { io: observers.length, media: mediaQueries.length };
  cover.mountHomeCover(root, d, ctrl.signal);
  const host = root.querySelector('.home-cover');
  const q = s => host.querySelector(s), tabs = () => host.querySelectorAll('[data-cover-to]');
  const visual = q('.cover-visual');
  return { root, host, ctrl, q, tabs, visual, belt: q('.cover-belt'), motion: q('[data-cover-motion]'), io: observers[before.io], mq: mediaQueries[before.media],
    src: () => visual.querySelector('.cover-photo').getAttribute('src'), alt: () => visual.querySelector('.cover-photo').getAttribute('alt'), kind: () => visual.getAttribute('data-cover-kind'), busy: () => visual.getAttribute('aria-busy'),
    context: () => visual.querySelector('.cover-context')?.textContent ?? '', copy: () => visual.querySelector('.cover-copy').textContent, name: () => visual.querySelector('.cover-name').textContent, count: () => q('.cover-count').textContent,
    selected: () => tabs().findIndex(b => b.getAttribute('aria-selected') === 'true'), error: () => visual.querySelector('.cover-image-error'),
    armed: () => [...intervals.values()].filter(t => t.ms === cover.COVER_FRAME_MS).length,
    snapshot() { return JSON.stringify([this.src(), this.alt(), this.kind(), this.context(), this.name(), this.belt.innerHTML, this.count(), this.selected()]); } };
}
const key = (host, k, target) => { const ev = new Event('keydown', { cancelable: true }); ev.key = k; Object.defineProperty(ev, 'target', { value: target ?? host }); host.dispatchEvent(ev); return ev; };
const pointer = (el, type, o) => { const ev = new Event(type); Object.assign(ev, o); el.dispatchEvent(ev); };
const loadedFixture = (d = pairs()) => { const m = mountFixture(d); settle(m.src()); return m; };

/* ================= pure: coverSlides / coverCandidateIds ================= */
await check('pairing: verified current official portrait + same artist album, with provenance fields', () => {
  assert.equal(cover.COVER_FRAME_MS, 2000);
  const d = data({ artists: [artist('a1', { photo: IMG('deezer-small'), photoLarge: IMG('deezer-large') })], releases: [release('r1', 'a1')] });
  const [s] = cover.coverSlides(d);
  assert.equal(s.key, 'artist:a1'); assert.equal(s.artistId, 'a1'); assert.equal(s.name, 'Artist a1'); assert.equal(s.photo, true);
  assert.equal(s.image, IMG('profile-a1'), 'Profile frame is the verified official portrait, never the legacy Deezer photo');
  same(s.secondary, { image: IMG('album-r1'), kind: 'album', title: 'Album r1', sourceUrl: 'https://music.example/album/r1' });
  assert.equal(s.portraitSource, 'https://official.example/a1/profile'); assert.equal(s.portraitCheckedAt, iso(NOW - HOUR));
  assert.equal(s.release.id, 'r1'); assert.equal(s.concert, null);
});
await check('legacy photo/photoLarge alone never becomes the current profile', () => {
  const d = data({ artists: [artist('a1', { portrait: null, photo: IMG('p'), photoLarge: IMG('pl') }), artist('a2', { portrait: undefined, photoLarge: IMG('pl2') })], releases: [release('r1', 'a1'), release('r2', 'a2')] });
  same(cover.coverSlides(d), []);
  assert.match(cover.homeCoverHtml(d), /class="cover-empty"/);
  same(cover.coverCandidateIds(d), ['a1', 'a2'], 'They remain hydration candidates (own media exists) so the service can verify portraits');
});
await check('portrait gate: status, method, identity, safe image/source and 24h freshness', () => {
  const ok = o => cover.coverSlides(data({ artists: [artist('a1', { portrait: portrait('a1', o) })], releases: [release('r1', 'a1')] })).length === 1;
  assert.ok(ok({}));
  for (const [label, o] of Object.entries({
    pending: { status: 'pending' }, failed: { status: 'failed' }, deezerMethod: { method: 'deezer' }, noMethod: { method: undefined },
    otherArtist: { artistId: 'a2' }, noArtistId: { artistId: undefined },
    jsImage: { imageUrl: 'javascript:alert(1)' }, relImage: { imageUrl: '//evil.example/x.jpg' }, credImage: { imageUrl: 'https://u:p@images.example/x.jpg' }, noImage: { imageUrl: '' },
    noSource: { sourceUrl: '' }, jsSource: { sourceUrl: 'javascript:alert(1)' }, hashSource: { sourceUrl: '#/artist/a1' },
    stale25h: { checkedAt: iso(NOW - 25 * HOUR) }, exactly24h: { checkedAt: iso(NOW - 24 * HOUR) }, future2m: { checkedAt: iso(NOW + 2 * 60e3) }, badDate: { checkedAt: 'yesterday' }, noDate: { checkedAt: undefined },
  })) assert.equal(ok(o), false, label);
  assert.ok(ok({ checkedAt: iso(NOW - 24 * HOUR + 60e3) }), '23h59m is still current'); assert.ok(ok({ checkedAt: iso(NOW + 30e3) }), 'Small clock skew tolerated');
  const fromCoverArtists = cover.coverSlides(data({ artists: [], coverArtists: [artist('c1')], releases: [release('rc', 'c1')] }));
  assert.equal(fromCoverArtists[0]?.artistId, 'c1', 'Hydrated coverArtists are eligible');
});
await check('secondary ownership: exact artistId, album-cover kind, safe artwork, newest own album first', () => {
  const base = { artists: [artist('a1'), artist('a2', { portrait: null })] };
  const sec = releases => cover.coverSlides(data({ ...base, releases }))[0]?.secondary ?? null;
  assert.equal(sec([release('x', undefined)]), null, 'Release without artistId is not borrowed');
  assert.equal(sec([release('x', 'a2')]), null, 'Another artist album is not borrowed');
  assert.equal(sec([release('x', 'a1', { artwork: 'javascript:alert(1)' })]), null);
  assert.equal(sec([release('x', 'a1', { artwork: null })]), null);
  for (const k of ['artist-photo', 'track', '', null, undefined]) assert.equal(sec([release('x', 'a1', { artworkKind: k })]), null, `artworkKind ${k}`);
  assert.equal(sec([release('old', 'a1', { releaseDate: '2025-01-01' }), release('new', 'a1', { releaseDate: '2026-10-20' })]).image, IMG('album-new'));
  assert.equal(sec([release('x', 'a1', { artworkSource: null, appleUrl: 'https://apple.example/x' })]).sourceUrl, 'https://apple.example/x');
  assert.equal(sec([release('x', 'a1', { artworkSource: { sourceUrl: 'javascript:alert(1)' } })]).sourceUrl, '', 'Unsafe album source is dropped, not linked');
});
await check('secondary concert fallback: only official/event posters of the exact artist, album preferred', () => {
  const sl = (concerts, releases = []) => cover.coverSlides(data({ abroad: concerts, artists: [artist('a1', { name: 'Same Name' })], releases }));
  for (const k of ['official', 'event']) { const [s] = sl([concert('c1', { artistId: 'a1', posterKind: k })]); same(s.secondary, { image: IMG('poster-c1'), kind: 'concert', title: 'Performer c1 Tour', sourceUrl: 'https://tickets.example/c1' }); assert.equal(s.concert.id, 'c1'); }
  for (const k of ['artist', 'album', 'fallback', null, undefined]) same(sl([concert('c1', { artistId: 'a1', posterKind: k })]), [], `posterKind ${k}`);
  same(sl([concert('c1', { artistId: 'a1', poster: 'javascript:alert(1)' })]), []);
  same(sl([concert('c1', { artistId: 'a1', unconfirmed: true })]), [], 'Unconfirmed concert is not used');
  same(sl([concert('c1', { performer: 'Same Name', title: 'Same Name Live' })]), [], 'Name match without artistId never borrows');
  same(sl([concert('c1', { artistId: 'zz', performer: 'Same Name' })]), [], 'Unknown artistId never borrows');
  const [both] = sl([concert('c1', { artistId: 'a1' })], [release('r1', 'a1')]); assert.equal(both.secondary.kind, 'album'); assert.equal(both.concert.id, 'c1', 'Concert still drives the belt facts');
  const [poorPoster] = sl([concert('c1', { artistId: 'a1', posterKind: 'artist' })], [release('r1', 'a1')]); assert.equal(poorPoster.secondary.kind, 'album'); assert.equal(poorPoster.concert.id, 'c1');
});
await check('bounds and dedup: max 12 slides, 60 candidate ids in ranking order, profile must differ from secondary', () => {
  const many = pairs(14); assert.equal(cover.coverSlides(many).length, 12); same(cover.coverSlides(many).map(s => s.artistId), Array.from({ length: 12 }, (_, i) => 'a' + i));
  const huge = data({ artists: Array.from({ length: 70 }, (_, i) => artist('h' + i)), coverReleases: Array.from({ length: 70 }, (_, i) => release('hr' + i, 'h' + i)) });
  same(cover.coverCandidateIds(huge), Array.from({ length: 60 }, (_, i) => 'h' + i)); assert.equal(cover.coverSlides(huge).length, 12);
  const noMedia = data({ artists: [artist('a1'), artist('a2')], releases: [release('r2', 'a2')] }); same(cover.coverCandidateIds(noMedia), ['a2']);
  same(cover.coverSlides(data({ artists: [artist('a1', { portrait: portrait('a1', { imageUrl: IMG('album-r1') }) })], releases: [release('r1', 'a1')] })), [], 'Album art reused as profile is not a pair');
  const dup = cover.coverSlides(data({ artists: [artist('a1'), artist('a1', { name: 'dup' })], releases: [release('r1', 'a1'), release('r1b', 'a1')] }));
  assert.equal(dup.length, 1, 'One slide per artist id');
  const keys = cover.coverSlides(pairs(6)).map(s => s.key); assert.equal(new Set(keys).size, 6);
});
await check('dedup across artists: the same profile URL or secondary URL is never shown twice', () => {
  const sharedAlbum = data({ artists: [artist('a1'), artist('a2')], releases: [release('r1', 'a1', { artwork: IMG('collab') }), release('r2', 'a2', { artwork: IMG('collab') })] });
  const s1 = cover.coverSlides(sharedAlbum); assert.equal(new Set(s1.map(s => s.secondary.image)).size, s1.length, `secondary images ${s1.map(s => s.secondary.image)}`);
  const sharedProfile = data({ artists: [artist('a1', { portrait: portrait('a1', { imageUrl: IMG('group-shot') }) }), artist('a2', { portrait: portrait('a2', { imageUrl: IMG('group-shot') }) })], releases: [release('r1', 'a1'), release('r2', 'a2')] });
  const s2 = cover.coverSlides(sharedProfile); assert.equal(new Set(s2.map(s => s.image)).size, s2.length, `profile images ${s2.map(s => s.image)}`);
  const crossed = data({ artists: [artist('a1'), artist('a2', { portrait: portrait('a2', { imageUrl: IMG('album-r1') }) })], releases: [release('r1', 'a1'), release('r2', 'a2')] });
  const s3 = cover.coverSlides(crossed); const all = s3.flatMap(s => [s.image, s.secondary.image]); assert.equal(new Set(all).size, all.length, `URLs ${all}`);
});

await check('origin guard: kr edition shows only jp-origin artists, jp edition only kr-origin; all/undefined keep everyone', () => {
  const mixed = o => data({ ...o, artists: [artist('k1', { origin: 'kr' }), artist('j1', { origin: 'jp' }), artist('u1'), artist('o1', { origin: 'other' }), artist('j2', { origin: 'jp' })],
    releases: ['k1', 'j1', 'u1', 'o1', 'j2'].map(id => release('r-' + id, id)) });
  same(cover.coverSlides(mixed({ edition: 'kr' })).map(s => s.artistId), ['j1', 'j2']); same(cover.coverCandidateIds(mixed({ edition: 'kr' })), ['j1', 'j2']);
  same(cover.coverSlides(mixed({ edition: 'jp' })).map(s => s.artistId), ['k1']); same(cover.coverCandidateIds(mixed({ edition: 'jp' })), ['k1']);
  for (const edition of [undefined, 'all']) same(cover.coverSlides(mixed({ edition })).map(s => s.artistId), ['k1', 'j1', 'u1', 'o1', 'j2'], String(edition));
  for (const bad of ['KR', ' kr', 'jp ', 'JP']) same(cover.coverSlides(mixed({ edition: bad })).map(s => s.artistId), ['k1', 'j1', 'u1', 'o1', 'j2'], `unknown edition ${JSON.stringify(bad)} uses the existing fallback`);
});
await check('origin guard: malicious mixed pool cannot smuggle a same-country artist in via concerts, releases or coverArtists', () => {
  const d = data({ edition: 'kr',
    artists: [artist('k1', { origin: 'kr', name: 'Shared Name' }), artist('j1', { origin: 'jp', name: 'Shared Name' })],
    coverArtists: [artist('k2', { origin: 'kr' }), artist('k3', { origin: undefined })],
    coverConcerts: [concert('ck1', { artistId: 'k1', posterKind: 'official' }), concert('cn', { performer: 'Shared Name', posterKind: 'official' }), concert('ck2', { artistId: 'k2', posterKind: 'event' })],
    coverReleases: [release('rk1', 'k1'), release('rk3', 'k3'), release('rj-borrow', undefined, { artist: 'Shared Name' })],
    releases: [release('rk2', 'k2')] });
  same(cover.coverSlides(d), [], 'No kr/unknown-origin artist, and no name-borrowed media for the jp artist');
  same(cover.coverCandidateIds(d), []);
  const html = cover.homeCoverHtml(d); assert.match(html, /class="cover-empty"/); assert.doesNotMatch(html, /profile-k|album-rk|poster-ck/);
  const withOwn = { ...d, coverReleases: [...d.coverReleases, release('rj1', 'j1')] };
  same(cover.coverSlides(withOwn).map(s => [s.artistId, s.secondary.image]), [['j1', IMG('album-rj1')]]);
});
await check('ranking: slides and candidates follow the artist ranking, not concert/release list order', () => {
  const d = data({ artists: [artist('a3'), artist('a1'), artist('a2')], coverArtists: [artist('a4'), artist('a1', { name: 'later duplicate' })],
    abroad: [concert('c2', { artistId: 'a2' })], coverConcerts: [concert('c4', { artistId: 'a4' })],
    releases: [release('r1', 'a1', { releaseDate: '2026-10-20' }), release('r3', 'a3', { releaseDate: '2025-01-01' })] });
  same(cover.coverCandidateIds(d), ['a3', 'a1', 'a2', 'a4']); same(cover.coverSlides(d).map(s => s.artistId), ['a3', 'a1', 'a2', 'a4']);
});
await check('full cover pool: coverReleases/coverConcerts supply own media beyond the small home lists', () => {
  const d = data({ artists: Array.from({ length: 14 }, (_, i) => artist('p' + i)), releases: [release('home-only', 'p0')],
    coverReleases: Array.from({ length: 10 }, (_, i) => release('cr' + i, 'p' + (i + 1))),
    coverConcerts: [concert('cc11', { artistId: 'p11', posterKind: 'official' }), concert('cc12', { artistId: 'p12', posterKind: 'event' }), concert('cc13', { artistId: 'p13', posterKind: 'artist' })] });
  const slides = cover.coverSlides(d);
  same(slides.map(s => s.artistId), Array.from({ length: 12 }, (_, i) => 'p' + i), 'Pool fills 12 slides; p13 has only an artist-kind poster');
  same(slides.slice(0, 2).map(s => s.secondary.image), [IMG('album-home-only'), IMG('album-cr0')]); same(slides.slice(11).map(s => [s.secondary.kind, s.secondary.image]), [['concert', IMG('poster-cc11')]]);
  same(cover.coverCandidateIds(d), Array.from({ length: 13 }, (_, i) => 'p' + i));
  const legacy = data({ artists: [artist('l1', { portrait: null, photoLarge: IMG('deezer-l1'), photo: IMG('deezer-l1s') })], coverArtists: [artist('l2', { portrait: portrait('l2', { method: 'deezer', imageUrl: IMG('deezer-l2') }) })], coverReleases: [release('l1r', 'l1'), release('l2r', 'l2')] });
  same(cover.coverSlides(legacy), [], 'Legacy Deezer photos never become the profile, even from the full pool'); same(cover.coverCandidateIds(legacy), ['l1', 'l2']);
  const undated = data({ artists: [artist('u1')], coverReleases: [release('nd', 'u1', { releaseDate: null }), release('dated', 'u1', { releaseDate: '2026-01-01' })] });
  assert.equal(cover.coverSlides(undated)[0]?.secondary.image, IMG('album-dated'), 'Null releaseDate neither throws nor outranks a dated album');
});

/* ================= pure: rendering ================= */
await check('labels: profile frame vs album/concert frame are honest in ko and ja', () => {
  const [album] = cover.coverSlides(data({ artists: [artist('a1')], releases: [release('r1', 'a1')] }));
  const [gig] = cover.coverSlides(data({ abroad: [concert('c1', { artistId: 'a1', country: 'JP', posterKind: 'event' })], artists: [artist('a1')] }));
  const NO_FRAME_LABEL = /2\s*초|2\s*秒|공식 프로필 ·|앨범 커버 ·|공연 이미지 ·|公式プロフィール ·|アルバムカバー ·|公演画像 ·/;
  const v = (s, p) => { const el = new El(); el.innerHTML = cover.coverVisual(s, p); assert.doesNotMatch(el.textContent, NO_FRAME_LABEL, `visible frame label in phase ${p}: ${el.textContent}`); return { img: el.querySelector('img'), ctx: el.querySelector('.cover-context')?.textContent ?? '', tour: el.querySelector('.cover-tour')?.textContent ?? null }; };
  let r = v(album, 0); assert.equal(r.img.getAttribute('src'), IMG('profile-a1')); assert.match(r.img.getAttribute('alt'), /Artist a1 · 현재 공식 프로필 사진/); assert.ok(!r.img.classList.contains('is-poster')); assert.equal(r.ctx, '', 'Release-only profile frame has no context line'); assert.equal(r.img.getAttribute('referrerpolicy'), 'no-referrer');
  r = v(album, 1); assert.equal(r.img.getAttribute('src'), IMG('album-r1')); assert.match(r.img.getAttribute('alt'), /앨범 커버/); assert.doesNotMatch(r.img.getAttribute('alt'), /프로필/); assert.ok(r.img.classList.contains('is-poster')); assert.equal(r.ctx, ''); assert.equal(r.tour, 'Album r1');
  r = v(gig, 1); assert.match(r.img.getAttribute('alt'), /공연 이미지/); assert.equal(r.ctx, '일본 현지 · 예매 중', 'Concert context is factual (country/status), not a frame label');
  setLocale('ja');
  r = v(album, 0); assert.match(r.img.getAttribute('alt'), /現在の公式プロフィール写真/); assert.equal(r.ctx, '');
  r = v(album, 1); assert.match(r.img.getAttribute('alt'), /アルバムカバー/); assert.equal(r.ctx, '');
  r = v(gig, 1); assert.match(r.img.getAttribute('alt'), /公演画像/); assert.match(r.ctx, /日本公演 · 発売中/);
});
await check('belt: profile/album provenance links; release-only artist gets no fabricated concert', () => {
  const before = loaded.cards.concertRegistry.size;
  const [s] = cover.coverSlides(data({ artists: [artist('a/1"x')], releases: [release('r1', 'a/1"x')] }));
  const v = new El(); v.innerHTML = cover.coverVisual(s); const b = new El(); b.innerHTML = cover.coverBelt(s);
  const ext = b.querySelectorAll('a[target="_blank"]');
  same(ext.map(a => [a.getAttribute('href'), a.getAttribute('rel'), a.textContent]), [['https://official.example/a/1%22x/profile', 'noopener noreferrer', '프로필 원문'], ['https://music.example/album/r1', 'noopener noreferrer', '앨범 원문']]);
  assert.equal(b.querySelector('[data-open-concert]'), null); assert.equal(v.querySelector('.cover-context'), null, 'Release-only slide has no context line at all'); assert.equal(v.querySelector('.cover-tour'), null);
  assert.doesNotMatch(v.textContent + b.textContent, /예매|공연 자세히|한국 공연|일본 현지|Hall|NOL|2026/);
  assert.equal(b.querySelector('.cover-primary').getAttribute('href'), '#/artist/a%2F1%22x'); assert.equal(b.querySelector('.cover-member').getAttribute('href'), '#/assist?kind=fanclub&artistId=a%2F1%22x');
  assert.equal(loaded.cards.concertRegistry.size, before, 'No concert registered for a release-only slide');
  const c = concert('c1', { artistId: 'a1', venue: 'Hall B', city: 'Osaka', country: 'JP' }); const [g] = cover.coverSlides(data({ abroad: [c], artists: [artist('a1')] }));
  const gb = new El(); gb.innerHTML = cover.coverBelt(g); assert.equal(gb.querySelector('[data-open-concert]').getAttribute('data-open-concert'), 'c1'); assert.equal(loaded.cards.concertRegistry.get('c1'), c);
  assert.equal(gb.querySelector('.cover-event-place').textContent, 'Hall B · Osaka'); assert.match(gb.textContent, /공연 이미지 원문/); assert.ok(gb.querySelectorAll('a[target="_blank"]').some(a => a.getAttribute('href') === 'https://tickets.example/c1'));
});
await check('escaping: portrait/album/concert URLs, names and titles cannot break out of markup', () => {
  const id = 'a"1</a>';
  const d = data({ abroad: [concert('id"><script>x</script>', { artistId: id, title: '<b>t</b>', url: 'https://tickets.example/p?a=1&b="2"<x>', provider: 'custom', providerLabel: '<i>Shop</i>' })],
    artists: [artist(id, { name: '<img src=x onerror=alert(1)>', portrait: portrait(id, { imageUrl: 'https://images.example/p.jpg?x="1"&y=<2>', sourceUrl: 'https://official.example/p?q="1"<z>' }) })],
    releases: [release('r', id, { title: '<script>album</script> & "co"', artwork: 'https://images.example/a.jpg?"&<', artworkSource: { sourceUrl: 'https://music.example/a?"<>' } })] });
  const html = cover.homeCoverHtml(d); assert.doesNotMatch(html, /<script|<img src=x|<b>t|<i>Shop/i);
  const root = new El(); root.innerHTML = html; // parser throws on broken structure
  const [s] = cover.coverSlides(d); const v0 = new El(); v0.innerHTML = cover.coverVisual(s, 0); const v1 = new El(); v1.innerHTML = cover.coverVisual(s, 1); const b = new El(); b.innerHTML = cover.coverBelt(s);
  assert.equal(v0.querySelector('img').getAttribute('src'), new URL('https://images.example/p.jpg?x="1"&y=<2>').href); assert.equal(v1.querySelector('img').getAttribute('src'), new URL('https://images.example/a.jpg?"&<').href);
  assert.equal(v0.querySelector('.cover-name').textContent, '<img src=x onerror=alert(1)>'); assert.equal(v1.querySelector('.cover-tour').textContent, '<script>album</script> & "co"');
  for (const a of b.querySelectorAll('a[target="_blank"]')) assert.doesNotMatch(a.getAttribute('href'), /["<>\s]/, a.getAttribute('href'));
  assert.equal(b.querySelector('[data-open-concert]').getAttribute('data-open-concert'), 'id"><script>x</script>');
  assert.ok(root.querySelectorAll('[data-cover-to]').some(t => t.textContent === '<img src=x onerror=alert(1)>'));
});
await check('Korean/Japanese shell and empty states (pending vs not)', () => {
  const d = pairs(2); const ko = cover.homeCoverHtml(d);assert.doesNotMatch(ko,/한국에서 만나는|공연부터 팬클럽까지|공연 일정, 가입 조건|cover-intro/,'hero starts directly without removed introduction');
  for (const re of [/아티스트 스포트라이트/, /자동 넘김 정지/, /이전 아티스트/, /다음 아티스트/]) assert.match(ko, re);
  assert.match(cover.homeCoverHtml(data({ portraitsPending: true })), /공식 프로필과 같은 아티스트의 앨범·공연 이미지를 확인하고 있어요/);
  assert.match(cover.homeCoverHtml(data()), /함께 확인한 아티스트를 준비하고 있어요/);
  setLocale('ja'); const ja = cover.homeCoverHtml(pairs(2)); const el = new El(); el.innerHTML = ja;
  for (const re of [/自動再生を停止/, /現在の公式プロフィール写真/]) assert.match(ja, re);
  assert.doesNotMatch(el.textContent, /[가-힣]/); assert.doesNotMatch(el.textContent, /2\s*秒|公式プロフィール ·|アルバムカバー ·|公演画像 ·/);
  const koEl = new El(); setLocale('ko'); koEl.innerHTML = cover.homeCoverHtml(pairs(2)); assert.doesNotMatch(koEl.textContent, /2\s*초|공식 프로필 ·|앨범 커버 ·|공연 이미지 ·/); setLocale('ja'); assert.doesNotMatch([...el.walk()].map(e => (e.getAttribute('aria-label') || '') + (e.getAttribute('alt') || '')).join(' '), /[가-힣]/);
  assert.match(cover.homeCoverHtml(data({ portraitsPending: true })), /公式プロフィールと同じアーティストのアルバム・公演画像を確認しています/); assert.match(cover.homeCoverHtml(data()), /アーティスト一覧を見る/);
  const kArtist = data({ artists: [artist('k1', { name: '아이유', nameOriginal: 'IU' })], releases: [release('rk', 'k1')] }); assert.match(cover.homeCoverHtml(kArtist), />IU</, 'Japanese uses the non-Hangul original name');
  setLocale('ko'); assert.match(cover.homeCoverHtml(kArtist), />아이유</);
});
await check('structure: full-bleed carousel with tab/tabpanel wiring; no legacy stage or network in module', () => {
  const root = new El(); root.innerHTML = cover.homeCoverHtml(pairs(6)); const host = root.elements[0];
  assert.equal(host.localName, 'section'); assert.ok(host.classList.contains('home-cover')); assert.equal(host.getAttribute('aria-roledescription'), 'carousel');
  const view = host.querySelector('.cover-visual'); assert.equal(view.getAttribute('role'), 'tabpanel'); assert.equal(view.getAttribute('aria-labelledby'), 'coverTab0'); assert.equal(view.getAttribute('data-cover-kind'), 'profile');
  host.querySelectorAll('[data-cover-to]').forEach((b, i) => { assert.equal(b.getAttribute('role'), 'tab'); assert.equal(b.getAttribute('id'), 'coverTab' + i); assert.equal(b.getAttribute('aria-controls'), view.getAttribute('id')); });
  same(host.elements.map(e => e.className), ['sr-only', 'cover-visual', 'cover-navigation', 'cover-belt']);
  assert.doesNotMatch(realSource, /h-stage|home-stage|grid-template|style="/); assert.doesNotMatch(realSource, /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie/);
});

/* ================= actual mount: timing and readiness ================= */
await check('timing: nothing is armed until the visible profile image loads; then 2s profile -> own album -> next profile', () => {
  const m = mountFixture(pairs());
  assert.equal(m.armed(), 0, 'No timer before the visible image is ready'); same(preloadRequests, [], 'No preloading before the visible image is ready');
  advance(10000); assert.equal(m.src(), P(0));
  settle(P(0)); assert.equal(m.armed(), 1); same(preloadRequests, [A(0)], 'Same artist album preloaded first');
  settle(A(0));
  advance(1999); assert.equal(m.src(), P(0)); advance(1); assert.equal(m.src(), A(0)); assert.equal(m.kind(), 'album'); assert.equal(m.selected(), 0); assert.equal(m.count(), '1 / 8', 'All 8 eligible artists shown (cap is 12)'); assert.match(m.alt(), /앨범 커버/);
  assert.ok(preloadRequests.includes(P(1)), 'Next artist profile preloaded after album shows'); settle(P(1));
  advance(1999); assert.equal(m.src(), A(0)); advance(1); assert.equal(m.src(), P(1)); assert.equal(m.kind(), 'profile'); assert.equal(m.selected(), 1); assert.equal(m.count(), '2 / 8'); assert.equal(m.visual.getAttribute('aria-labelledby'), 'coverTab1');
  assert.match(m.alt(), /현재 공식 프로필 사진/); assert.match(m.belt.innerHTML, /official\.example\/a1\/profile/);
  for (const t of [m.copy(), m.host.textContent]) assert.doesNotMatch(t, /2\s*초|2\s*秒|공식 프로필 ·|앨범 커버 ·/, 'No visible frame labels while rotating');
});
await check('readiness: pending target keeps the old image AND labels; timer suspended until load, then reset', () => {
  const m = loadedFixture(); settle(A(0)); advance(2000); assert.equal(m.src(), A(0));
  const shown = m.snapshot(); advance(2000); // P(1) never loaded yet
  assert.equal(m.snapshot(), shown, 'Old image, alt, kind, context, name, belt, count and tab unchanged'); assert.equal(m.busy(), 'true'); assert.equal(m.armed(), 0, 'No timer while pending');
  advance(20000); assert.equal(m.snapshot(), shown);
  clock = 50000; settle(P(1)); assert.equal(m.src(), P(1)); assert.equal(m.busy(), 'false'); assert.equal(m.armed(), 1);
  settle(A(1)); advance(1999); assert.equal(m.src(), P(1), 'Fresh 2s counted from the load, not from the old interval'); advance(1); assert.equal(m.src(), A(1));
});
await check('readiness: a visible image that is not yet decoded does not arm the timer even after commit', () => {
  const m = loadedFixture(); m.tabs()[3].click(); assert.equal(m.src(), P(0), 'Click waits for preload');
  const pre = fakeImages.find(i => i._src === P(3)); pre.dispatchEvent(new Event('load')); // preloader event without the src being complete for <img>
  assert.equal(m.src(), P(3)); assert.equal(m.armed(), 0, 'Rendered <img> not complete -> still not armed');
  settle(P(3)); assert.equal(m.armed(), 1, 'Armed on the visible image load');
});
await check('readiness: a late older preload never overwrites a newer click, autoplay step or abort', () => {
  const m = loadedFixture(); settle(P(2));
  m.tabs()[3].click(); assert.equal(m.busy(), 'true'); m.tabs()[2].click(); assert.equal(m.src(), P(2)); assert.equal(m.selected(), 2);
  settle(P(3)); assert.equal(m.src(), P(2), 'Late tab-3 load ignored'); assert.equal(m.selected(), 2);
  settle(P(2)); settle(A(2)); advance(2000); assert.equal(m.src(), A(2)); // autoplay pending for P(3)? already loaded -> commits
  const n = loadedFixture(); advance(2000); assert.equal(n.busy(), 'true', 'Autoplay waiting for album'); settle(P(4)); n.tabs()[4].click(); assert.equal(n.src(), P(4));
  settle(A(0)); assert.equal(n.src(), P(4), 'Late autoplay album load ignored after manual click'); assert.equal(n.selected(), 4);
  const o = loadedFixture(); o.tabs()[5].click(); o.ctrl.abort(); settle(P(5)); assert.equal(o.src(), P(0), 'Late load after abort ignored'); assert.equal(o.selected(), 0);
});
await check('readiness: target image error keeps old image visible with an honest message; failed cache retried immediately', () => {
  const m = loadedFixture(); m.tabs()[3].click(); settle(P(3), 'error');
  assert.equal(m.src(), P(0)); assert.equal(m.busy(), 'false'); assert.equal(m.error().hidden, false); assert.match(m.error().textContent, /다음 이미지를 불러오지 못했습니다/); assert.equal(m.visual.querySelector('.cover-photo').hidden, false, 'Old image stays visible');
  m.tabs()[3].click(); assert.equal(m.busy(), 'false', 'Re-navigating to an already-failed image does not hang busy'); assert.equal(m.error().hidden, false);
  const n = loadedFixture(); settle(A(0), 'error'); advance(2000); assert.notEqual(n.busy(), 'true', 'Autoplay to a preload that already failed is not a silent hang'); assert.equal(n.error().hidden, false); assert.equal(n.src(), P(0));
  setLocale('ja'); const j = loadedFixture(); j.tabs()[2].click(); settle(P(2), 'error'); assert.match(j.error().textContent, /次の画像を取得できませんでした/);
});
await check('readiness: visible image error hides it, shows message and never arms autoplay', () => {
  const m = mountFixture(pairs()); settle(P(0), 'error');
  assert.equal(m.visual.querySelector('.cover-photo').hidden, true); assert.ok(m.visual.classList.contains('has-image-error')); assert.equal(m.error().hidden, false); assert.match(m.error().textContent, /이미지를 불러오지 못했습니다/); assert.equal(m.armed(), 0);
  settle(P(1)); m.tabs()[1].click(); assert.ok(!m.visual.classList.contains('has-image-error')); assert.equal(m.error().hidden, true); assert.equal(m.armed(), 1);
  m.ctrl.abort(); settle(P(2), 'error'); // cached-broken: complete && naturalWidth 0 before the next mount renders it
  const n = mountFixture(data({ artists: [artist('a2')], releases: [release('r2', 'a2')] })); assert.equal(n.visual.querySelector('.cover-photo').hidden, true, 'Already-broken cached image detected at mount'); assert.equal(n.armed(), 0);
});

/* ================= actual mount: navigation ================= */
await check('navigation: tabs, prev/next wrap and swipe always land on phase 0 (profile) of that artist', () => {
  for (let i = 0; i < 8; i++) { settle(P(i)); settle(A(i)); }
  const m = loadedFixture(); advance(2000); assert.equal(m.kind(), 'album');
  m.q('[data-cover-go="1"]').click(); assert.equal(m.src(), P(1)); assert.equal(m.kind(), 'profile'); assert.equal(m.selected(), 1);
  advance(2000); assert.equal(m.src(), A(1)); m.tabs()[1].click(); assert.equal(m.src(), P(1), 'Clicking the current tab during album returns to its profile');
  m.q('[data-cover-go="-1"]').click(); m.q('[data-cover-go="-1"]').click(); assert.equal(m.selected(), 7, 'Prev wraps'); m.q('[data-cover-go="1"]').click(); assert.equal(m.selected(), 0, 'Next wraps');
  advance(2000); assert.equal(m.kind(), 'album');
  pointer(m.visual, 'pointerdown', { pointerType: 'touch', clientX: 300, clientY: 100 }); pointer(m.visual, 'pointerup', { clientX: 200, clientY: 110 }); assert.equal(m.src(), P(1), 'Left swipe -> next artist profile');
  pointer(m.visual, 'pointerdown', { pointerType: 'touch', clientX: 100, clientY: 100 }); pointer(m.visual, 'pointerup', { clientX: 130, clientY: 300 }); assert.equal(m.selected(), 1, 'Vertical gesture ignored');
  pointer(m.visual, 'pointerdown', { pointerType: 'touch', clientX: 100, clientY: 100 }); pointer(m.visual, 'pointercancel', {}); pointer(m.visual, 'pointerup', { clientX: 400, clientY: 100 }); assert.equal(m.selected(), 1);
  pointer(m.visual, 'pointerdown', { pointerType: 'touch', clientX: 100, clientY: 100 }); pointer(m.visual, 'pointerup', { clientX: 200, clientY: 100 }); assert.equal(m.src(), P(0), 'Right swipe -> previous artist profile');
});
await check('navigation: keyboard Arrow/Home/End -> profile of target and focus; inputs ignored; timer reset', () => {
  for (let i = 0; i < 8; i++) { settle(P(i)); settle(A(i)); }
  const m = loadedFixture(); advance(2000); assert.equal(m.kind(), 'album');
  let ev = key(m.host, 'ArrowRight', m.tabs()[0]); assert.ok(ev.defaultPrevented); assert.equal(m.src(), P(1)); assert.equal(fakeDocument.activeElement, m.tabs()[1]);
  key(m.host, 'End', m.tabs()[1]); assert.equal(m.selected(), 7); assert.equal(m.kind(), 'profile'); key(m.host, 'ArrowRight'); assert.equal(m.selected(), 0); key(m.host, 'ArrowLeft'); assert.equal(m.selected(), 7); key(m.host, 'Home'); assert.equal(m.selected(), 0);
  ev = key(m.host, 'Enter'); assert.ok(!ev.defaultPrevented); ev = key(m.host, 'ArrowRight', new El('input')); assert.ok(!ev.defaultPrevented); assert.equal(m.selected(), 0);
  fakeDocument.activeElement = null;
  advance(1500); m.q('[data-cover-go="1"]').click(); advance(1999); assert.equal(m.src(), P(1), 'Manual navigation restarts the 2s phase'); advance(1); assert.equal(m.src(), A(1));
});
await check('single artist still alternates its two images; motion control enabled', () => {
  const m = mountFixture(data({ artists: [artist('solo')], releases: [release('rs', 'solo')] })); settle(IMG('profile-solo')); settle(IMG('album-rs'));
  assert.equal(m.motion.disabled, false); assert.equal(m.armed(), 1);
  advance(2000); assert.equal(m.src(), IMG('album-rs')); advance(2000); assert.equal(m.src(), IMG('profile-solo')); advance(2000); assert.equal(m.src(), IMG('album-rs')); assert.equal(m.count(), '1 / 1');
  m.q('[data-cover-go="1"]').click(); assert.equal(m.src(), IMG('profile-solo'), 'Next on a single artist returns to its profile');
});

/* ================= actual mount: holds ================= */
await check('holds: hover, offscreen, hidden document and focus inside block autoplay; release resumes', () => {
  for (let i = 0; i < 8; i++) { settle(P(i)); settle(A(i)); }
  const m = loadedFixture();
  m.host.dispatchEvent(new Event('pointerenter')); advance(6000); assert.equal(m.src(), P(0), 'Hover holds');
  m.visual.style.setProperty('--px', '4px'); m.host.dispatchEvent(new Event('pointerleave')); assert.equal(m.visual.style.getPropertyValue('--px'), '0px'); advance(2000); assert.equal(m.src(), A(0));
  m.io.emit(false); advance(6000); assert.equal(m.src(), A(0), 'Offscreen holds'); m.io.emit(true); advance(2000); assert.equal(m.src(), P(1));
  fakeDocument.hidden = true; advance(6000); assert.equal(m.src(), P(1), 'Hidden document holds'); fakeDocument.hidden = false; advance(2000); assert.equal(m.src(), A(1));
  m.tabs()[0].focus(); advance(6000); assert.equal(m.src(), A(1), 'Focus inside holds'); fakeDocument.activeElement = new El('button'); advance(2000); assert.equal(m.src(), P(2));
  assert.ok(m.io.targets.includes(m.host));
});
await check('holds: conditions that start while the automatic target is loading defer the commit', () => {
  const cases = { hover: m => m.host.dispatchEvent(new Event('pointerenter')), offscreen: m => m.io.emit(false), hidden: () => { fakeDocument.hidden = true; }, focus: m => m.tabs()[0].focus() };
  for (const [name, block] of Object.entries(cases)) {
    imageState.delete(A(0)); const m = loadedFixture(); advance(2000); assert.equal(m.busy(), 'true', name); block(m); settle(A(0));
    assert.equal(m.src(), P(0), `${name}: late automatic load does not advance while held`); assert.notEqual(m.busy(), 'true', name);
    m.host.dispatchEvent(new Event('pointerleave')); m.io.emit(true); fakeDocument.hidden = false; fakeDocument.activeElement = null;
    advance(2000); assert.equal(m.src(), A(0), `${name}: resumes after release`); m.ctrl.abort();
  }
});
await check('holds: pause stops autoplay (and a pending automatic step) with honest control state; resume re-arms', () => {
  const m = loadedFixture();
  assert.equal(m.motion.getAttribute('aria-pressed'), 'false'); assert.equal(m.motion.getAttribute('aria-label'), '자동 넘김 정지');
  advance(2000); assert.equal(m.busy(), 'true'); m.motion.click();
  assert.equal(m.armed(), 0); assert.equal(m.busy(), 'false'); assert.equal(m.motion.getAttribute('aria-pressed'), 'true'); assert.equal(m.motion.getAttribute('aria-label'), '자동 넘김 재개'); assert.match(m.motion.innerHTML, /i-play/);
  settle(A(0)); assert.equal(m.src(), P(0), 'Late automatic load after pause does not advance');
  advance(10000); assert.equal(m.src(), P(0));
  settle(P(1)); m.tabs()[1].click(); assert.equal(m.src(), P(1), 'Manual navigation works while paused'); advance(10000); assert.equal(m.src(), P(1), 'and does not resume autoplay');
  m.motion.click(); assert.equal(m.armed(), 1); assert.match(m.motion.innerHTML, /i-pause/); settle(A(1)); advance(2000); assert.equal(m.src(), A(1));
  setLocale('ja'); const j = loadedFixture(); j.motion.click(); assert.equal(j.motion.getAttribute('aria-label'), '自動再生を再開');
});
await check('holds: pause or reduced-motion change does not cancel a pending MANUAL navigation', () => {
  const m = loadedFixture(); m.tabs()[3].click(); assert.equal(m.busy(), 'true'); m.motion.click(); settle(P(3));
  assert.equal(m.src(), P(3), 'User-chosen artist still appears after pressing pause while it loads'); assert.equal(m.selected(), 3);
  const n = loadedFixture(); n.tabs()[4].click(); n.mq.matches = true; n.mq.dispatchEvent(new Event('change')); settle(P(4));
  assert.equal(n.src(), P(4), 'User-chosen artist still appears after reduced-motion turns on while it loads');
});
await check('holds: prefers-reduced-motion disables autoplay/parallax/control and follows media changes', () => {
  reduceMotion = true; const m = loadedFixture(); settle(A(0));
  assert.match(m.mq.media, /prefers-reduced-motion: reduce/); assert.equal(m.armed(), 0); assert.equal(m.motion.disabled, true); assert.equal(m.motion.getAttribute('aria-pressed'), 'true'); assert.equal(m.motion.getAttribute('aria-label'), '모션 줄이기 설정 적용 중');
  advance(10000); assert.equal(m.src(), P(0)); pointer(m.visual, 'pointermove', { pointerType: 'mouse', clientX: 900, clientY: 400 }); assert.equal(frames.size, 0);
  settle(P(2)); m.tabs()[2].click(); assert.equal(m.src(), P(2), 'Manual navigation still works'); assert.equal(m.armed(), 0);
  m.mq.matches = false; m.mq.dispatchEvent(new Event('change')); assert.equal(m.armed(), 1); assert.equal(m.motion.disabled, false);
  advance(2000); assert.equal(m.busy(), 'true'); m.mq.matches = true; m.mq.dispatchEvent(new Event('change')); assert.equal(m.armed(), 0); settle(A(2)); assert.equal(m.src(), P(2), 'Pending automatic step cancelled by reduced motion');
  reduceMotion = true; const single = mountFixture(data({ artists: [artist('solo')], releases: [release('rs', 'solo')] })); settle(IMG('profile-solo')); assert.equal(single.motion.disabled, true); assert.equal(single.armed(), 0);
});
await check('restart suppressed while pending: pause/resume during a pending step does not arm a competing timer', () => {
  const m = loadedFixture(); m.tabs()[3].click(); assert.equal(m.busy(), 'true');
  m.mq.matches = false; m.mq.dispatchEvent(new Event('change')); assert.equal(m.armed(), 0, 'Media change while pending does not arm');
  settle(A(0)); advance(4000); assert.equal(m.src(), P(0)); settle(P(3)); assert.equal(m.src(), P(3), 'The pending manual target still wins');
});

/* ================= actual mount: parallax and lifecycle ================= */
await check('parallax: mouse only, one rAF at a time, cancelled on abort', () => {
  const m = loadedFixture();
  pointer(m.visual, 'pointermove', { pointerType: 'touch', clientX: 1000, clientY: 500 }); assert.equal(frames.size, 0);
  pointer(m.visual, 'pointermove', { pointerType: 'mouse', clientX: 1000, clientY: 500 }); pointer(m.visual, 'pointermove', { pointerType: 'mouse', clientX: 0, clientY: 0 }); assert.equal(frames.size, 1);
  const [[fid, fn]] = [...frames]; frames.delete(fid); fn(); assert.equal(m.visual.style.getPropertyValue('--px'), '7px'); assert.equal(m.visual.style.getPropertyValue('--py'), '5px');
  pointer(m.visual, 'pointermove', { pointerType: 'mouse', clientX: 500, clientY: 250 }); const pending = [...frames.keys()].at(-1); m.ctrl.abort(); assert.ok(globals.cancelledFrames.includes(pending));
});
await check('lifecycle: abort clears timer, observer, preload sources and every listener', () => {
  const m = loadedFixture(); settle(A(0)); const preloaders = fakeImages.filter(i => i._src === A(0));
  m.tabs()[3].click(); m.ctrl.abort();
  assert.equal(m.armed(), 0); assert.equal(m.io.disconnected, true); assert.ok(preloaders.length && preloaders.every(i => i.srcRemoved), 'Preloaders released'); assert.ok(fakeImages.filter(i => i.srcRemoved).length >= 2);
  const shown = m.snapshot();
  settle(P(3)); settle(P(4)); m.tabs()[4].click(); m.q('[data-cover-go="1"]').click(); key(m.host, 'End', m.tabs()[0]); m.motion.click(); advance(10000);
  pointer(m.visual, 'pointerdown', { pointerType: 'touch', clientX: 300, clientY: 100 }); pointer(m.visual, 'pointerup', { clientX: 100, clientY: 100 }); m.mq.matches = false; m.mq.dispatchEvent(new Event('change'));
  assert.equal(m.snapshot(), shown); assert.equal(m.armed(), 0); assert.equal(m.motion.getAttribute('aria-pressed'), 'false');
});
await check('lifecycle: pre-aborted signal, empty data and disconnected host are inert', () => {
  const root = new El(); root.connectedRoot = true; root.innerHTML = cover.homeCoverHtml(pairs()); const ctrl = new AbortController(); ctrl.abort();
  const before = [intervals.size, observers.length, fakeImages.length];
  cover.mountHomeCover(root, pairs(), ctrl.signal); settle(P(0)); assert.deepEqual([intervals.size, observers.length, fakeImages.length], before);
  const empty = new El(); empty.innerHTML = cover.homeCoverHtml(data()); cover.mountHomeCover(empty, data(), new AbortController().signal); assert.equal(intervals.size, 0);
  const m = loadedFixture(); settle(A(0)); m.root.connectedRoot = false; advance(4000); assert.equal(m.src(), P(0), 'Detached cover does not advance'); settle(P(2)); m.tabs()[2].click(); assert.equal(m.src(), P(0));
});

/* ================= CSS scoped to the new hero ================= */
const homeCss = postcss.parse(read('../frontend/src/app/home-v2.css'));
const v2Css = postcss.parse(read('../frontend/src/app/v2.css'));
const rulesOf = (css, test) => { const out = []; css.walkRules(r => { if (r.parent?.type === 'atrule' && /keyframes/.test(r.parent.name)) return; if (test(r.selector)) out.push(r); }); return out; };
const decl = (rules, prop) => rules.flatMap(r => r.nodes.filter(n => n.type === 'decl' && n.prop === prop).map(n => ({ sel: r.selector, value: n.value, media: r.parent?.type === 'atrule' ? r.parent.params : '' })));
const isCover = s => s.split(',').some(part => /(?:^|[ >])\.?(?:home-cover|cover-intro|cover-visual|cover-belt|cover-navigation)$/.test(part.trim()));
await check('css: no .h-stage parent styling and no rounded/pale panel around the hero', () => {
  for (const css of [homeCss, v2Css]) assert.deepEqual(rulesOf(css, s => /\.h-stage\b/.test(s) && /home|cover/.test(s)).map(r => r.selector), []);
  assert.deepEqual(rulesOf(homeCss, s => /\.h-stage\b/.test(s)).map(r => r.selector), [], 'home-v2.css does not restyle the legacy stage');
  const cover = rulesOf(homeCss, isCover);
  for (const d of decl(cover, 'border-radius')) assert.match(d.value, /^0(px)?$/, `${d.sel} border-radius ${d.value}`);
  // Any rule whose subject is the hero host itself (e.g. ".home-cover" or ".page.is-home > section.home-cover").
  const host = rulesOf(homeCss, s => s.split(',').some(x => /(^|[\s>])([a-z]+)?\.home-cover$/.test(x.trim())));
  assert.ok(host.length, 'Hero host rule exists');
  for (const p of ['background', 'background-color', 'box-shadow', 'border', 'border-radius']) for (const d of decl(host, p)) assert.match(d.value, /^(0|none|transparent)$/, `${d.sel} ${p}:${d.value} paints a panel around the hero`);
  assert.ok(decl(host, 'width').some(d => d.value === '100%'));
  for (const d of decl(host, 'max-width')) assert.equal(d.value, 'none', d.sel);
  for (const p of ['margin', 'margin-inline', 'padding', 'padding-inline']) for (const d of decl(host, p)) assert.match(d.value, /^0(px)?$/, `${d.sel} ${p}:${d.value} insets the hero`);
  const page = rulesOf(homeCss, s => s.trim() === '.page.is-home'); assert.ok(decl(page, 'max-width').some(d => d.value === 'none')); assert.ok(decl(page, 'padding').some(d => /^0 0 /.test(d.value)), 'Page has no side padding so the photo is full-bleed');
});
await check('css: no fixed two-column HERO grid (home body rows such as the requested .h-live-row are out of scope)', () => {
  for (const css of [homeCss, v2Css]) {
    const scoped = rulesOf(css, s => /home-cover|\.cover-/.test(s) || /^\s*\.page\.is-home\s*$/.test(s));
    for (const d of [...decl(scoped, 'grid-template-columns'), ...decl(scoped, 'grid-template')]) assert.doesNotMatch(d.value, /^\s*(\S+\s+\S+|repeat\(\s*2\s*,)/, `${d.sel} ${d.value}`);
    for (const d of decl(scoped, 'columns').concat(decl(scoped, 'column-count'))) assert.fail(`${d.sel} uses multi-column ${d.value}`);
  }
  // Layout containers only; display:grid for centring an icon inside a button is not page layout.
  const containers = rulesOf(homeCss, s => s.split(',').some(x => /(\.home-cover|\.cover-(visual|belt|navigation|intro|copy|event|actions))$/.test(x.trim()) || /^\.page\.is-home$/.test(x.trim())));
  for (const d of decl(containers, 'display')) if(d.value==='grid'){assert.equal(d.sel,'.home-cover','Only the single-column photo/navigation overlap may use grid');const tracks=decl(rulesOf(homeCss,s=>s.trim()==='.home-cover'),'grid-template-columns');assert.ok(tracks.length);for(const track of tracks)assert.equal(track.value,'minmax(0,1fr)','No two-column hero');}
});
await check('css: user-requested .h-live-row is two explicit columns on desktop and one column at <=960px; hero stays full-bleed', () => {
  const row = rulesOf(homeCss, s => /\.h-live-row$/.test(s.trim()) || s.split(',').some(x => /\.h-live-row$/.test(x.trim())));
  const desk = decl(row, 'grid-template-columns').filter(d => !d.media), mob = decl(row, 'grid-template-columns').filter(d => /max-width:\s*960px/.test(d.media));
  assert.equal(desk.length, 1, 'One desktop column definition'); const tracks = desk[0].value.match(/minmax\([^)]*\)|[^\s]+/g); assert.equal(tracks.length, 2, `two explicit tracks: ${desk[0].value}`); assert.ok(tracks.every(t => /^minmax\(0,/.test(t)), 'Tracks can shrink (minmax(0,...))');
  assert.ok(decl(row, 'display').some(d => d.value === 'grid' && !d.media)); assert.equal(mob.length, 1, 'Mobile override at 960px'); assert.match(mob[0].value, /^(minmax\(0,\s*1fr\)|1fr)$/, mob[0].value);
  assert.ok(decl(rulesOf(homeCss, s => /\.h-live-row\s*>\s*\.sec$/.test(s.trim())), 'min-width').some(d => d.value === '0'), 'Columns cannot overflow');
  for (const css of [homeCss, v2Css]) for (const r of rulesOf(css, s => s.split(',').some(part => { const leaf=part.trim().split(/\s*[>+~]\s*|\s+/).at(-1); return /[#.](?:secTickets|secChart|h-live-row)(?=[:.#\[]|$)/.test(leaf) || /\.h-live-row\s*>\s*[^ >+~]+$/.test(part.trim()); }))) for (const p of ['order', 'grid-column', 'grid-area', 'direction', 'grid-auto-flow']) assert.equal(r.nodes.some(n => n.prop === p), false, `${r.selector} sets ${p}; tickets must stay left, chart right`);
  for (const r of row) assert.doesNotMatch(r.selector, /home-cover|cover-/, 'Live row rules never target the hero');
});
await check('css: fluid photography and fluid type for the new hero', () => {
  const at = s => rulesOf(homeCss, x => x.trim() === s);
  const vis = decl(at('.cover-visual'), 'height'); assert.equal(vis.length >= 2, true, 'Desktop + mobile heights'); for (const d of vis) assert.match(d.value, /calc\(100svh - var\(--hdr-total/, `${d.media} ${d.value}`);
  assert.equal(decl(at('.cover-visual'), 'width').length, 0, 'Visual is never a fixed-width box');
  const photo = at('.cover-photo'); assert.ok(decl(photo, 'object-fit').some(d => d.value === 'cover')); assert.ok(decl(photo, 'width').some(d => d.value === '100%')); assert.ok(decl(photo, 'height').some(d => d.value === '100%'));
  assert.ok(decl(at('.cover-photo.is-poster'), 'object-fit').some(d => d.value === 'contain'), 'Poster fallback is not cropped as if it were a photo');
  for (const s of ['.cover-name', '.cover-tour', '.cover-event-date', '.cover-tabs button']) { const fs = decl(at(s), 'font-size').filter(d => !d.media); assert.ok(fs.length, s); for (const d of fs) assert.match(d.value, /clamp\([^)]*vw/, `${s} ${d.value}`); }
  for (const d of decl(at('.cover-name'), 'font-size')) assert.match(d.value, /clamp\(/, `.cover-name ${d.media} ${d.value}`);
  assert.ok(decl(at('.cover-name'), 'overflow-wrap').some(d => d.value === 'anywhere'), 'Long CJK/Latin names wrap');
  const reduced = []; homeCss.walkAtRules('media', a => { if (/prefers-reduced-motion/.test(a.params)) a.walkRules(r => reduced.push(r)); });
  assert.ok(reduced.some(r => /\.cover-photo/.test(r.selector) && r.nodes.some(n => n.prop === 'animation' && n.value === 'none')), 'Reduced motion stops cover animation');
});


/* ---------- report + negative controls ---------- */
const total = passed + failures.length;
if (MUTATION) { console.log(JSON.stringify({ failed: failures.map(f => f.name) })); process.exit(0); }
for (const { name, e } of failures) console.error(`FAIL ${name}\n  ${String(e?.message || e).split('\n').join('\n  ')}`);
if (process.env.COVER_DEBUG) for (const { e } of failures) console.error(e?.stack);
const baseline = new Set(failures.map(f => f.name)); const controls = { caught: [], missed: [], skipped: [], invalid: [] };
if (!process.env.COVER_SKIP_MUTATIONS) for (const name of Object.keys(MUTATIONS)) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, HOME_COVER_MUTATION: name }, encoding: 'utf8', timeout: 60000 });
  let out; try { out = JSON.parse(r.stdout.trim().split('\n').at(-1)); } catch { controls.invalid.push(`${name}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`); continue; }
  if (out.skipped) { controls.skipped.push(name); continue; }
  const fresh = out.failed.filter(n => !baseline.has(n)); (fresh.length ? controls.caught : controls.missed).push(fresh.length ? `${name} -> ${fresh[0]}${fresh.length > 1 ? ` (+${fresh.length - 1})` : ''}` : name);
}
console.log(`negative controls: ${controls.caught.length} caught, ${controls.missed.length} missed, ${controls.skipped.length} skipped (anchor not in module), ${controls.invalid.length} invalid`);
for (const c of controls.caught) console.log(`  caught  ${c}`);
for (const c of controls.missed) console.error(`  MISSED  ${c}`);
for (const c of controls.skipped) console.error(`  SKIPPED ${c} (anchor missing: update the mutation table)`);
for (const c of controls.invalid) console.error(`  INVALID ${c}`);
if (failures.length || controls.missed.length || controls.invalid.length || controls.skipped.length) { console.error(`\n${failures.length}/${total} home-cover checks failed (${passed} passed); ${controls.missed.length} mutation(s) missed, ${controls.invalid.length} invalid`); process.exit(1); }
console.log(`PASS home cover (${total} checks): verified official portrait gate (status/method/identity/24h), own album/official-event secondary, edition origin guard, artist ranking, full cover pool, no borrowed names or legacy photos, cross-artist dedup, 12-slide/60-candidate bounds, ko/ja with no visible 2s frame labels, escaping, 2s profile->secondary->next timing armed only on visible load, pending keeps old image+labels, stale/abort fencing, failed-image honesty, holds (pause/hover/offscreen/hidden/focus/reduced motion), keyboard/swipe phase-0 reset, single-artist rotation, scoped CSS`);
