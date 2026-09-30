/** Run: node tests/verify-landing-intro.mjs. Actual landing/components, controlled catalog and GPU boundary. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
const base = path.resolve('frontend/src/site/pages/landing.ts');
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
class Target {
  listeners = new Map(); dataset = {}; attributes = {}; isConnected = true;
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  setAttribute(k, v) { this.attributes[k] = v; }
  emit(type) { for (const fn of this.listeners.get(type) || []) fn({ type }); }
}
function setup({ delayed = false, reduced = false, focusApi = true, missing = '' } = {}) {
  const cleanups = [], observers = [], selections = [], modules = new Map();
  let resolveCatalog;
  const gate = delayed ? new Promise(resolve => { resolveCatalog = resolve; }) : Promise.resolve();
  const host = new Target(), toggle = new Target(), media = new Target(); media.matches = reduced;
  if (focusApi) host.__selectHero = index => selections.push(index);
  const links = ['YOASOBI', 'LE SSERAFIM', 'Vaundy'].map(artist => Object.assign(new Target(), { dataset: { stageArtist: artist } }));
  const root = {
    querySelector: selector => selector === '[data-landing-scene]' ? host : selector === '[data-landing-motion]' ? toggle : null,
    querySelectorAll: selector => selector === '[data-stage-artist]' ? links : [],
  };
  const storage = new Map([['lilac.discovery.motion', 'off']]);
  const scene = { mounts: 0, disposed: 0, paused: false, items: [],
    setSceneMotionPaused(value) { this.paused = value; }, isSceneMotionPaused() { return this.paused; },
    async mountHero3D(element, items) { this.mounts++; this.items = items; element.dataset.scene3d = 'ready'; },
    disposeScene() { this.disposed++; },
  };
  const lifecycle = {
    onCleanup: fn => cleanups.push(fn),
    listen(target, event, fn) { target.addEventListener(event, fn); cleanups.push(() => target.removeEventListener(event, fn)); },
    observe(observer) { cleanups.push(() => observer.disconnect()); return observer; },
  };
  const api = {
    esc: value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
    async findCatalog(term) { await gate; return term === missing ? null : { title: `${term} song`, art: `https://art.invalid/${encodeURIComponent(term)}` }; },
    artUrl: hit => hit?.art || '',
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {}; modules.set(file, exports);
    vm.runInNewContext(code, { exports, console, window: { matchMedia: () => media },
      localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
      MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } },
      require(spec) {
        if (spec.endsWith('/api')) return api;
        if (spec.endsWith('/lifecycle')) return lifecycle;
        if (spec === '../../three') return scene;
        return load(path.resolve(path.dirname(file), spec + '.ts'));
      },
    }, { filename: file });
    return exports;
  }
  const landing = load(base);
  return { landing, root, host, toggle, scene, links, selections, storage, observers,
    resolve: () => resolveCatalog?.(), cleanup() { cleanups.splice(0).forEach(fn => fn()); },
  };
}
const chartSource = fs.readFileSync(path.resolve('frontend/src/site/chart.ts'),'utf8');
function assertNoCoordinateTransitions(source) {
  for (const [, value] of source.matchAll(/\btransition\s*:\s*([^;"\n]+)/g)) {
    assert.doesNotMatch(value, /(?:^|,)\s*(?:left|top|all)(?:\s|$)/,
      'Tooltip coordinates must not animate layout properties (including transition:all)');
  }
}
assertNoCoordinateTransitions(chartSource);
// Mutation controls: this regression guard must fail for the original defect.
for (const property of ['left', 'top', 'all']) {
  assert.throws(() => assertNoCoordinateTransitions(`transition:opacity .4s ease, ${property} .2s ease`));
}
const html = setup().landing.landingHtml();
assert.equal((html.match(/<h1\b/g) || []).length, 1);
assert.match(html, /id="li-title"><span>J-POP<\/span>/);
assert.doesNotMatch(html, /0[123]\s*\/\s*[A-Z]|li-wordmark|—/);
for (const term of ['YOASOBI', 'LE SSERAFIM', 'Vaundy', 'Ado']) {
  assert.ok(html.includes(`href="#/search?q=${encodeURIComponent(term)}"`), `Native search link: ${term}`);
}
for (const hook of ['data-match-demo', 'data-uc-scroller', 'data-fx-chart', 'data-landing-motion']) assert.ok(html.includes(hook));
for (const text of ['전곡 재생은 현재 활성화되어 있지 않습니다.', '데모 크레딧', '공연 일정은 아직 수집하지 않습니다.']) {
  // These remain in carousel modal data, not its initial collapsed HTML.
  assert.ok(fs.readFileSync(base, 'utf8').includes(text));
}
assert.match(html, /실제 결제·배송은 제공하지 않습니다/);
assert.equal((html.match(/class="li-artist"/g) || []).length, 4);
console.log('PASS semantic music heading, four native artist paths, honest disclosures and live component hooks');
const live = setup(); live.landing.mountLanding(live.root); await flush();
assert.equal(live.scene.mounts, 1); assert.equal(live.scene.paused, true);
assert.equal(live.toggle.attributes['aria-pressed'], 'true');
live.links[1].emit('focus'); live.links[2].emit('pointerenter');
assert.deepEqual(live.selections, [1, 2]);
live.toggle.emit('click'); assert.equal(live.storage.get('lilac.discovery.motion'), 'on');
live.cleanup(); assert.equal(live.scene.disposed, 1);
assert.equal(live.links[1].listeners.get('focus').size, 0);
assert.ok(live.observers.every(observer => observer.disconnected));
console.log('PASS saved motion, equivalent pointer/keyboard scene focus and listener teardown');
const absent = setup({ focusApi: false, missing: 'YOASOBI' }); absent.landing.mountLanding(absent.root); await flush();
absent.links[1].emit('focus'); assert.equal(absent.host.dataset.scene3d, 'ready'); absent.cleanup();
const shifted = setup({ missing: 'YOASOBI' }); shifted.landing.mountLanding(shifted.root); await flush(); shifted.links[1].emit('focus');
assert.deepEqual(shifted.selections, [0]); shifted.cleanup();
console.log('PASS optional scene API and artwork failures preserve correct artist-to-record mapping');
const stale = setup({ delayed: true }); stale.landing.mountLanding(stale.root); stale.cleanup(); stale.resolve(); await flush();
assert.equal(stale.scene.mounts, 0); assert.equal(stale.links[0].listeners.size, 0);
const reduced = setup({ reduced: true }); reduced.landing.mountLanding(reduced.root); await flush();
assert.equal(reduced.toggle.disabled, true); assert.equal(reduced.toggle.textContent, '모션 줄이기 적용됨'); reduced.cleanup();
console.log('PASS delayed catalog cannot mount after route cleanup; reduced-motion preference stays authoritative');

// Execute the real TypeScript chart renderer. Only browser boundaries are mocked.
function setupChart({ points = [{ date: '2026-09-04', jpyKrw: 9.123456 }], live = false,
  reduced = true, error = '', delayed = false } = {}) {
  const cleanups = [], observers = [], frames = new Map();
  let frameId = 0, resolveFetch, fetchSignal;
  const media = { matches: reduced };
  class Stage extends Target {
    _html = ''; bands = []; total = null;
    set innerHTML(value) {
      this._html = value;
      this.bands = [...value.matchAll(/data-band="(\d+)"/g)].map(([, band]) =>
        Object.assign(new Target(), { dataset: { band } }));
      const total = value.match(/data-fx-total>([^<]*)</);
      this.total = total ? Object.assign(new Target(), { textContent: total[1] }) : null;
    }
    get innerHTML() { return this._html; }
    querySelectorAll(selector) { return selector === '[data-band]' ? this.bands : []; }
    querySelector(selector) { return selector === '[data-fx-total]' ? this.total : null; }
  }
  const stage = new Stage(), wrap = new Target(), badge = new Target(), note = new Target();
  const nodes = { '[data-fx-chart]': wrap, '[data-fx-stage]': stage, '[data-fx-badge]': badge, '[data-fx-note]': note };
  const response = { ok: error !== 'http', status: 503, async json() {
    if (error === 'json') throw new Error('bad json');
    // Misleading API metadata must not determine the displayed coverage/latest.
    return { points, source: 'test-source', live, days: 90, latest: { date: '2099-01-01', jpyKrw: 1 }, min: 1, max: 99 };
  } };
  class Observer {
    constructor(fn) { this.fn = fn; observers.push(this); }
    observe() {} unobserve() {} disconnect() { this.disconnected = true; }
  }
  const exports = {};
  vm.runInNewContext(ts.transpileModule(chartSource, { compilerOptions: {
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS,
  } }).outputText, {
    exports, console, AbortController, window: { matchMedia: () => media },
    IntersectionObserver: Observer, ResizeObserver: Observer,
    requestAnimationFrame(fn) { const id = ++frameId; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    async fetch(url, options) {
      assert.equal(url, '/api/fx/series?days=90'); fetchSignal = options.signal;
      if (error === 'network') throw new Error('offline');
      if (delayed) return new Promise(resolve => { resolveFetch = resolve; });
      return response;
    },
    require(spec) {
      assert.equal(spec, './lifecycle');
      return {
        onCleanup: fn => cleanups.push(fn),
        observe(observer) { cleanups.push(() => observer.disconnect()); return observer; },
        listen(target, event, fn) { target.addEventListener(event, fn); cleanups.push(() => target.removeEventListener(event, fn)); },
      };
    },
  }, { filename: 'chart.ts' });
  exports.mountChart({ querySelector: selector => nodes[selector] });
  const resize = (width = 760, height = 420) => observers[1].fn([{ contentRect: { width, height } }]);
  resize(); observers[0].fn([{ isIntersecting: true, target: wrap }]);
  return { stage, badge, note, frames, observers, media, resize, exports,
    get signal() { return fetchSignal; },
    resolve: () => resolveFetch?.(response), cleanup() { cleanups.splice(0).forEach(fn => fn()); },
  };
}
const ticks = html => [...html.matchAll(/class="fx-xtick(?: on)?">([^<]*)</g)].map(match => match[1]);
const currency = n => `₩${Math.round(n).toLocaleString('ko-KR')}`;
function assertAmounts(chart, rate) {
  const { jpyAmount, feeRate, shippingKrw } = chart.exports.PRICING;
  assert.equal(jpyAmount, 3300); assert.equal(feeRate, 0.1); assert.equal(shippingKrw, 3500);
  const base = jpyAmount * rate;
  for (const value of [currency(base), currency(base * feeRate), currency(shippingKrw), `${rate.toFixed(4)}원`]) {
    assert.ok(chart.stage.innerHTML.includes(value), `Unchanged precision and pricing: ${value}`);
  }
  assert.equal(chart.stage.total.textContent, currency(base * (1 + feeRate) + shippingKrw));
  assertNoCoordinateTransitions(chart.stage.innerHTML);
  assert.doesNotMatch(chart.stage.innerHTML, /최근 90일|실측 환율|최종 결제|2099|NaN|Infinity/);
}
const snapshotChart = setupChart(); await flush();
assert.match(snapshotChart.exports.chartHtml(), /라일락 예상 총액/);
assert.doesNotMatch(snapshotChart.exports.chartHtml(), /최종 결제액|실측 환율/);
assert.deepEqual(ticks(snapshotChart.stage.innerHTML), ['2026-09-04']);
assert.match(snapshotChart.stage.innerHTML, /aria-label="2026-09-04 기준 스냅숏 추정/);
assert.match(snapshotChart.stage.innerHTML, /단일 날짜 · 예상 총액/);
assert.doesNotMatch(snapshotChart.stage.innerHTML, /<path\b/);
assert.equal(snapshotChart.badge.textContent, '2026-09-04 스냅숏');
assert.match(snapshotChart.note.textContent, /실제 결제·배송은 제공하지 않습니다/);
assert.match(snapshotChart.note.textContent, /실시간 데이터가 아닙니다/);
assertAmounts(snapshotChart, 9.123456); assert.equal(snapshotChart.frames.size, 0);
snapshotChart.resize(360, 340); assertAmounts(snapshotChart, 9.123456);
assert.match(snapshotChart.stage.innerHTML, /width="360" height="340"/);
snapshotChart.cleanup(); assert.ok(snapshotChart.observers.every(o => o.disconnected));
assert.equal(snapshotChart.stage.listeners.get('pointerleave').size, 0);
const duplicateChart = setupChart({ points: [
  { date: '2026-09-04', jpyKrw: 8.1 }, { date: '2026-09-04', jpyKrw: 9.87654321 },
] }); await flush();
assert.deepEqual(ticks(duplicateChart.stage.innerHTML), ['2026-09-04']);
assert.equal(duplicateChart.stage.bands.length, 1); assertAmounts(duplicateChart, 9.87654321);
duplicateChart.cleanup();
console.log('PASS real FX renderer: single/duplicate dates become dated snapshots; exact pricing, no synthetic history, compact resize');

const observations = [
  { date: '2026-09-04', jpyKrw: 9.012345 },
  { date: '2026-08-01', jpyKrw: 9.234567 },
  { date: '2026-08-02', jpyKrw: 9.456789 },
  { date: '2026-08-02', jpyKrw: 9.567891 },
];
const historyChart = setupChart({ points: observations, live: true }); await flush();
assert.deepEqual(ticks(historyChart.stage.innerHTML), ['08-01', '08-02', '09-04']);
assert.match(historyChart.stage.innerHTML, /2026-08-01 ~ 2026-09-04 · 3개 관측/);
assert.equal(historyChart.stage.bands.length, 3);
assert.equal((historyChart.stage.innerHTML.match(/<path\b/g) || []).length, 3);
for (const [, curve] of historyChart.stage.innerHTML.matchAll(/<path d="([^"]+)" fill="none"/g)) {
  let previousX = Number(curve.match(/^M ([\d.]+)/)[1]);
  for (const [, firstX, secondX, nextX] of curve.matchAll(/C ([\d.]+) [-\d.]+, ([\d.]+) [-\d.]+, ([\d.]+) [-\d.]+/g)) {
    for (const controlX of [Number(firstX), Number(secondX)]) {
      assert.ok(controlX >= previousX && controlX <= Number(nextX), 'Curve controls stay within observed calendar segment');
    }
    previousX = Number(nextX);
  }
}
assertAmounts(historyChart, 9.012345);
const xTicks = [...historyChart.stage.innerHTML.matchAll(/<text x="([\d.]+)"[^>]*\s+class="fx-xtick/g)].map(m => Number(m[1]));
assert.ok(xTicks[1] - xTicks[0] < (xTicks[2] - xTicks[0]) / 10, 'Calendar spacing, not fabricated equal day spacing');
historyChart.stage.bands[0].emit('pointerenter'); assertAmounts(historyChart, 9.234567);
historyChart.stage.bands[1].emit('pointerdown'); assertAmounts(historyChart, 9.567891);
historyChart.stage.emit('pointerleave'); assertAmounts(historyChart, 9.012345);
historyChart.resize(360, 340); assertAmounts(historyChart, 9.012345); historyChart.cleanup();
const twoDates = setupChart({ points: observations.slice(0, 2) }); await flush();
assert.equal(ticks(twoDates.stage.innerHTML).length, 2);
assert.match(twoDates.badge.textContent, /저장된 관측 환율/); twoDates.cleanup();
const manyDates = setupChart({ points: Array.from({ length: 8 }, (_, i) => ({ date: `2026-08-0${i + 1}`, jpyKrw: 9 + i / 100 })) });
await flush(); assert.equal(ticks(manyDates.stage.innerHTML).length, 5);
assert.equal(new Set(ticks(manyDates.stage.innerHTML)).size, 5); manyDates.cleanup();
console.log('PASS real FX renderer: sorted distinct range/count, calendar spacing, unique ticks, hover/reset preserves all rate precision');

for (const options of [
  { error: 'http' }, { error: 'network' }, { error: 'json' }, { points: [] }, { points: null },
  { points: [{ date: '2026-02-30', jpyKrw: 9 }] },
  { points: [{ date: '2026-09-04', jpyKrw: NaN }] },
  { points: [{ date: '2026-09-04', jpyKrw: 0 }] },
]) {
  const broken = setupChart(options); await flush(); broken.resize();
  assert.match(broken.stage.innerHTML, /환율 데이터를 불러오지 못했습니다/);
  assert.doesNotMatch(broken.stage.innerHTML, /<svg|data-fx-total/);
  assert.equal(broken.badge.textContent, '환율 확인 불가'); broken.cleanup();
}
const pendingChart = setupChart({ delayed: true }); pendingChart.cleanup(); pendingChart.resolve(); await flush();
assert.equal(pendingChart.stage.innerHTML, ''); assert.equal(pendingChart.signal.aborted, true);
const animatedChart = setupChart({ reduced: false }); await flush(); assert.equal(animatedChart.frames.size, 1);
animatedChart.media.matches = true; animatedChart.resize();
assert.equal(animatedChart.frames.size, 0); assertAmounts(animatedChart, 9.123456);
animatedChart.media.matches = false; animatedChart.resize(); assert.equal(animatedChart.frames.size, 1);
animatedChart.cleanup(); assert.equal(animatedChart.frames.size, 0);
console.log('PASS real FX renderer: HTTP/network/JSON/invalid-data failures, fetch/observer/listener/rAF teardown and reduced-motion totals');
