#!/usr/bin/env node
/** Run: node tests/verify-original-work-titles.mjs
 * "노래제목은 원문그대로": song/release/award work titles stay byte-for-byte in KO and JA.
 * 1) Executes the real chart/track/cards/awards renderers (KO and JA) and checks the emitted markup.
 * 2) Feeds that markup to the real content-localization engine in headless Chrome (real DOM, TreeWalker,
 *    MutationObserver) with a translator that rewrites everything it receives, and checks that marked titles and
 *    their aria-labels are untouched while sibling artist names and ordinary prose are still localized.
 * Set CHROME_BIN to a Chrome/Chromium binary; without one the DOM half is reported as SKIP. No network, no server. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const src = rel => fs.readFileSync(path.join(repo, 'frontend/src', rel), 'utf8');
function load(rel, deps = {}, globals = {}) {
  const js = ts.transpileModule(src(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, URL, console, setTimeout, ...globals, require(n) { if (!(n in deps)) throw Error(`unexpected import ${n} in ${rel}`); return deps[n]; } }, { filename: rel });
  return exports;
}
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const unesc = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const TITLES = ['ライラック', 'マリーゴールド', 'Brand New', '爆裂愛してる'];

const doc = { documentElement: { lang: 'ko' }, title: '' };
const i18n = load('app/i18n.ts', {}, { document: doc });
const cm = load('app/cm-i18n.ts', { './i18n': i18n });
const reading = load('app/name-reading.ts');
const ui = new Proxy({
  esc, icon: () => '<svg aria-hidden="true"></svg>', safeHref: x => x, safeImage: x => x || '', skeletonRows: () => '', errorState: () => '', emptyState: () => '', ago: () => '', fmtDay: () => '2026.01.01',
  img: (s, alt, cls, o = {}) => `<span class="media ${cls}"><img src="${esc(s || '')}" alt="${esc(alt)}">${o.cover ? `<span class="ph ph-cover" aria-hidden="true"><b>${esc(o.cover.title)}</b><span>${esc(o.cover.sub || '')}</span></span>` : `<span class="ph ph-text" aria-hidden="true">${esc(o.initial || '')}</span>`}</span>`,
}, { get: (o, k) => (k in o ? o[k] : () => '') });
const player = { keyOf: tr => `${tr.title}|${tr.artist}`.toLowerCase(), playList() {}, markPlaying() {} };
const cards = load('app/cards.ts', { './name-reading': reading, './ui': ui, './fanclub': { withUtm: x => x }, './i18n': i18n, './state': { state: { edition: 'all' }, isFollowing: () => false, toggleFollow() {} }, './player': player, './social': { likeBtn: () => '', talkBtn: () => '', trackTarget: x => x } });

// Minimal element sink for page renderers: records innerHTML per selector; real DOM behavior is tested in Chrome below.
function sink() {
  const els = new Map();
  const el = () => ({ innerHTML: '', textContent: '', addEventListener() {}, querySelector: sel => (sel.startsWith('#') && !sel.includes(' ') ? get(sel) : null), querySelectorAll: () => [] });
  const get = sel => { if (!els.has(sel)) els.set(sel, el()); return els.get(sel); };
  const root = { ...el(), querySelector: sel => (sel === '[data-play]' || sel.startsWith('#') && !sel.includes(' ') ? get(sel) : null) };
  return { root, get };
}
const tick = () => new Promise(r => setTimeout(r, 0));

const chartList = [
  { rank: 1, title: 'ライラック', artist: 'Mrs. GREEN APPLE', artwork: 'https://images.example/1.jpg', appleUrl: 'https://music.apple.com/jp/album/x?i=1' },
  { rank: 2, title: 'マリーゴールド', artist: 'あいみょん', artwork: null, appleUrl: null },
  { rank: 3, title: 'Brand New', artist: 'サンプル', artwork: null, appleUrl: null },
  { rank: 4, title: '爆裂愛してる', artist: '아이유', artwork: null, appleUrl: null },
];
const moves = { source: 'apple', sourceLabel: 'Apple Music', rising: [{ rank: 2, lastRank: 9, move: 'up', title: 'マリーゴールド', artist: 'あいみょん', artwork: null, appleUrl: null }], entries: [{ rank: 5, lastRank: null, move: 'new', title: '爆裂愛してる', artist: 'サンプル', artwork: null, appleUrl: null }] };
const chartApi = async url => url.startsWith('/api/charts') ? { list: chartList.map(e => ({ ...e })), sources: ['apple'], sourceLabels: null, updated: '', live: false, method: '' }
  : url.startsWith('/api/live/chart-moves') ? moves : url.startsWith('/api/live/artists') ? { items: [{ name: '아이유', nameJa: 'IU' }] } : (() => { throw Error(url); })();
const chart = load('app/pages/chart.ts', { '../../api': { api: chartApi }, '../state': { state: { edition: 'all' }, musicCountries: () => ['jp', 'kr'] }, '../i18n': i18n, '../ui': ui, '../cards': cards, '../player': player, '../social': { bindSocial: async () => {} } });
const snap = { title: 'ライラック', artist: 'Mrs. GREEN APPLE', artistId: 'mga', album: 'Brand New', preview: 'https://audio.example/p.m4a', appleUrl: 'https://music.apple.com/jp/song/1?i=2', artwork: null };
const track = load('app/pages/track.ts', { '../../api': { api: async () => ({ kind: 'track', key: 'k1', snap }) }, './_safety': { safeExternal: x => x }, '../i18n': i18n, '../ui': ui, '../cm-i18n': cm, '../cards': { concertRegistry: new Map(), openConcert() {} }, '../player': player, '../social': { likeBtn: () => '', shareBtn: () => '', bindSocial: async () => {}, commentsHtml: () => '<div class="cmts"></div>', bindComments: async () => {}, targetAdapter: x => x, trackTarget: x => x } }, { document: doc });
const edition = (id, series, entries) => ({ id, series, name: series, shortName: series, year: 2026, date: '2026-01-0' + (entries.length), country: 'jp', kind: 'awards', tone: '', scope: '범위', sources: [{ id: 's', label: '공식', url: 'https://example.org/s', kind: 'official', checkedAt: '2026-10-01' }], entries });
const entry = (recipient, work) => ({ category: '대상', recipient, work, group: '대상', sourceId: 's' });
const awardModel = load('awards/model.ts');
const awardI18n = load('awards/i18n.ts', {}, { document: doc });
const editions = [edition('mama-2026', 'mama', [entry('Mrs. GREEN APPLE', 'ライラック'), entry('あいみょん', 'マリーゴールド'), entry('サンプル', 'Brand New'), entry('サンプル', '爆裂愛してる')]), edition('maj-2026', 'maj', [entry('あいみょん', 'マリーゴールド')])];
const awards = load('awards/view.ts', { './data': { AWARD_EDITIONS: editions }, './model': awardModel, './i18n': awardI18n });

async function markupFor(locale) {
  i18n.setLocale(locale);
  const play = locale === 'ja' ? '試聴' : '미리듣기';
  const c = sink(); await chart.renderChart(c.root, () => true, 'jp'); await tick(); await tick();
  const rows = c.get('#chList').innerHTML, shelves = c.get('#chMoves').innerHTML;
  const t = sink(); await track.renderTrack(t.root, () => true, 'k1');
  const songPage = t.root.innerHTML;
  const release = cards.releaseCard({ id: 'r1', tier: 'curated', artist: 'あいみょん', artistKo: '아이묭', title: 'マリーゴールド - Single', country: 'jp', releaseDate: '2026-01-01', artwork: null });
  const award = awards.panelHtml(editions[0], new Set(['mama-2026:records'])) + awards.panelHtml(editions[1], new Set());
  // Legacy unmarked artist-page track row shape (pages/artists.ts): protected by the class fallback.
  const legacy = `<ol class="clist compact"><li class="crow"><button class="crow-art" data-play="0" aria-label="ライラック">x</button><div class="crow-main"><b>ライラック</b><span>Mrs. GREEN APPLE</span></div></li></ol>`;
  const all = rows + shelves + songPage + release + award;
  for (const title of TITLES) {
    const marked = [...all.matchAll(/data-content-original-work translate="no">([^<]*)</g)].map(m => unesc(m[1]));
    assert.ok(marked.includes(title), `${locale}: ${title} is emitted verbatim inside a marked work`);
  }
  for (const [html, where] of [[rows, 'chart row'], [shelves, 'chart shelf']]) {
    const labels = [...html.matchAll(/data-content-original-label aria-label="([^"]*)"/g)].map(m => unesc(m[1]));
    assert.ok(labels.length > 0, where + ' has original-label previews');
    for (const label of labels) assert.ok(TITLES.some(x => label === `${x} ${play}`), `${locale} ${where}: aria-label "${label}" = exact title + i18n "${play}"`);
  }
  assert.match(rows, new RegExp(`href="#/artist/name/${encodeURIComponent('Mrs. GREEN APPLE').replace(/[.]/g, '\\.')}"`), 'artist route id stays the original encoded name');
  if (locale === 'ja') assert.match(rows, />IU<\/a>/, 'ja: Korean chart artist still mapped to its Japanese display name (sibling of an untouched title)');
  assert.match(songPage, /<h1 data-content-original-work translate="no">ライラック<\/h1>/, 'track h1 marked');
  assert.match(songPage, /<dd data-content-original-work translate="no">Brand New<\/dd>/, 'track album marked');
  assert.ok(songPage.includes('href="https://music.apple.com/jp/song/1?i=2"'), 'Apple URL untouched');
  assert.match(songPage, /<dd><a href="#\/artist\/mga">Mrs\. GREEN APPLE<\/a><\/dd>/, 'artist link is not marked as a work');
  assert.match(award, /<span data-public-name>Mrs\. GREEN APPLE<\/span> · <bdi data-content-original-work translate="no">ライラック<\/bdi>/, 'award recipient stays a separate translatable sibling of the work');
  assert.ok(award.includes(`href="#/search?q=${encodeURIComponent('Mrs. GREEN APPLE ライラック')}"`), 'award search href untouched');
  assert.match(release, /<span class="rcard-title" data-content-original-work translate="no">マリーゴールド<\/span>/, 'release title marked');
  assert.equal(doc.title, 'ライラック · Mrs. GREEN APPLE · Lilac');
  return { all: all + legacy, play };
}
const marks = { ko: await markupFor('ko'), ja: await markupFor('ja') };
console.log('PASS markup: chart rows, chart shelves, track page, release card and award works emit KO/JA-identical original titles; preview labels = exact title + i18n word');

// ---------- Real DOM: the content-localization engine in headless Chrome ----------
const chromeBin = process.env.CHROME_BIN || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => fs.existsSync(p));
if (!chromeBin) { console.log('SKIP real-DOM localization check: no Chrome/Chromium (set CHROME_BIN)'); process.exit(0); }
const esbuild = (await import('../frontend/node_modules/esbuild/lib/main.js')).default;
const engineEntry = process.env.LILAC_CL_ENTRY || path.join(repo, 'frontend/src/app/content-localization.ts');
const bundle = esbuild.buildSync({ entryPoints: [engineEntry], bundle: true, format: 'iife', globalName: 'CL', write: false, platform: 'browser', target: 'es2022' }).outputFiles[0].text;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lilac-original-work-'));
function runPage(locale, markup) {
  const roster = [{ id: 'mga', name: 'Mrs. GREEN APPLE' }, { id: 'aimyon', name: 'あいみょん', nameKo: '아이묭' }, { id: 'iu', name: '아이유', nameJa: 'IU' }, { id: 'sample', name: 'サンプル', nameKo: '샘플' }];
  const prose = locale === 'ko' ? '<p id="prose">新しいお知らせがあります</p><p id="prose-title">あいみょんの「マリーゴールド」が新しい記録</p>'
    : '<p id="prose">새로운 소식이 있습니다</p><p id="prose-title">아이유의 爆裂愛してる 새로운 기록</p>';
  const html = `<!doctype html><html lang="${locale}"><body><main id="page">${markup}${prose}</main><div id="bar"></div><pre id="out">PENDING</pre><script>${bundle}</script><script>
(async()=>{try{const seen=[];const factory={availability:async()=>'available',create:async()=>({translate:async s=>{seen.push(s);return '[MT]'+s;},destroy(){}})};
const fetcher=async u=>new Response(JSON.stringify(u.startsWith('/api/live/artists')?{items:${JSON.stringify(roster)}}:{items:[]}),{headers:{'Content-Type':'application/json'}});
const root=document.getElementById('page');const engine=CL.installContentLocalization({locale:()=>'${locale}',root,controls:()=>document.getElementById('bar'),factory,fetch:fetcher,storage:null});
const done=()=>engine.status().running===0&&engine.status().waiting===0;for(let i=0;i<200&&!(done()&&document.getElementById('prose').textContent.startsWith('[MT]'));i++)await new Promise(r=>setTimeout(r,25));
await new Promise(r=>setTimeout(r,400));
const works=[...root.querySelectorAll('[data-content-original-work],.crow-main>b')].map(e=>e.textContent);/* closed <details> are deferred by design; artist checks use open content only */
const labels=[...root.querySelectorAll('[data-content-original-label],.crow-art')].map(e=>e.getAttribute('aria-label'));
const artists=[...root.querySelectorAll('a[href^="#/artist/"],[data-public-name],.rcard-artist')].filter(e=>!e.closest('details:not([open])')).map(e=>({href:e.getAttribute('href'),text:e.textContent}));
document.getElementById('out').textContent=JSON.stringify({works,labels,artists,seen,prose:document.getElementById('prose').textContent,proseTitle:document.getElementById('prose-title').textContent});
}catch(e){document.getElementById('out').textContent='ERROR '+e.stack;}})();
</script></body></html>`;
  const file = path.join(tmp, locale + '.html'); fs.writeFileSync(file, html);
  const r = spawnSync(chromeBin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + path.join(tmp, 'profile-' + locale), '--virtual-time-budget=20000', '--dump-dom', 'file://' + file], { encoding: 'utf8', timeout: 60000 });
  const m = (r.stdout || '').match(/<pre id="out">([\s\S]*?)<\/pre>/);
  assert.ok(m, 'chrome produced a DOM dump: ' + (r.stderr || '').slice(0, 400));
  const text = unesc(m[1]);
  assert.ok(!text.startsWith('ERROR') && text !== 'PENDING', 'page script finished: ' + text.slice(0, 600));
  return JSON.parse(text);
}
try {
  for (const locale of ['ko', 'ja']) {
    const out = runPage(locale, marks[locale].all);
    assert.ok(out.prose.startsWith('[MT]'), `${locale}: negative control - ordinary prose is still machine translated (engine ran)`);
    for (const title of TITLES) assert.ok(out.works.includes(title), `${locale}: ${title} survives the live engine verbatim`);
    assert.ok(out.works.length >= 12 && out.works.every(w => !w.includes('[MT]') && TITLES.includes(w)), `${locale}: no marked title rewritten: ${JSON.stringify(out.works)}`);
    assert.ok(out.labels.length >= 6 && out.labels.every(l => l === 'ライラック' || TITLES.some(x => l === `${x} ${marks[locale].play}`)), `${locale}: preview aria-labels exact: ${JSON.stringify(out.labels)}`);
    assert.ok(!out.seen.some(s => TITLES.some(x => s.includes(x))), `${locale}: no title text was ever sent to the translator: ${JSON.stringify(out.seen)}`);
    const shown = out.artists.map(a => a.text);
    if (locale === 'ko') {
      assert.ok(shown.includes('아이묭') && !shown.includes('あいみょん'), 'ko: kana artist beside a title is still localized: ' + JSON.stringify(shown));
      assert.ok(out.proseTitle.includes('マリーゴールド') && out.proseTitle.includes('아이묭') && out.proseTitle.includes('[MT]'), 'ko: a known title inside prose stays original while the artist is localized: ' + out.proseTitle);
    } else {
      assert.ok(shown.includes('IU') && !shown.includes('아이유'), 'ja: Korean artist beside a title is still localized: ' + JSON.stringify(shown));
      assert.ok(out.proseTitle.includes('爆裂愛してる') && out.proseTitle.includes('IU') && out.proseTitle.includes('[MT]'), 'ja: a known title inside prose stays original while the artist is localized: ' + out.proseTitle);
    }
    assert.ok(out.artists.some(a => a.href === '#/artist/name/' + encodeURIComponent('あいみょん')), `${locale}: artist route ids untouched`);
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('PASS real DOM (headless Chrome): KO and JA engine leaves ライラック/マリーゴールド/Brand New/爆裂愛してる and their preview aria-labels exact, never sends them to the translator, still localizes sibling artists and prose');
