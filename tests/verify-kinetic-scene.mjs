#!/usr/bin/env node
/** Kinetic layer: real kinetic-scene.ts, kinetic-ribbon.ts, three/lifecycle.ts and three.js geometry,
 * run through TypeScript with a deterministic fake DOM, observers, clock and WebGL renderer.
 * No network, GPU, backend or production env. Run: node tests/verify-kinetic-scene.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
import postcss from '../frontend/node_modules/postcss/lib/postcss.mjs';
import * as THREE from '../frontend/node_modules/three/build/three.module.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const transpile = (src) => ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const SRC = {
  scene: read(process.env.KINETIC_SCENE_SOURCE ? 'file://' + process.env.KINETIC_SCENE_SOURCE : '../frontend/src/app/kinetic-scene.ts'),
  ribbon: read(process.env.KINETIC_RIBBON_SOURCE ? 'file://' + process.env.KINETIC_RIBBON_SOURCE : '../frontend/src/app/kinetic-ribbon.ts'),
  lifecycle: read('../frontend/src/three/lifecycle.ts'),
};

function world({ reduced = false, webgl = true } = {}) {
  let seq = 0, now = 0;
  const frames = new Map(), timers = new Map(), observers = [], renderers = [];
  class Target {
    listeners = new Map();
    addEventListener(type, fn, o = {}) {
      if (o.signal?.aborted) return;
      const set = this.listeners.get(type) || new Set(); set.add(fn); this.listeners.set(type, set);
      o.signal?.addEventListener('abort', () => set.delete(fn), { once: true });
    }
    removeEventListener(t, fn) { this.listeners.get(t)?.delete(fn); }
    dispatchEvent(e) { for (const fn of [...this.listeners.get(e.type) || []]) fn(e); }
    emit(type, data = {}) { this.dispatchEvent({ type, preventDefault() {}, ...data }); }
    count() { return [...this.listeners.values()].reduce((n, s) => n + s.size, 0); }
  }
  class El extends Target {
    dataset = {}; attrs = {}; children = []; parentNode = null; className = ''; top = 0; height = 40;
    clientWidth = 960; clientHeight = 96; textContent = '';
    style = { props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; } };
    get isConnected() { let n = this; while (n) { if (n === doc.body) return true; n = n.parentNode; } return false; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    appendChild(el) { el.remove(); el.parentNode = this; this.children.push(el); return el; }
    insertBefore(el, ref) { el.remove(); el.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(el); else this.children.splice(i, 0, el); return el; }
    get nextSibling() { const p = this.parentNode; if (!p) return null; return p.children[p.children.indexOf(this) + 1] || null; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    querySelectorAll(sel) {
      if (sel === ':scope > .kx-ribbon') return this.children.filter(c => c.className.includes('kx-ribbon'));
      if (sel === ':scope > .sec-head') return this.children.filter(c => c.className === 'sec-head');
      return [];
    }
    getBoundingClientRect() { return { left: 0, top: this.top, width: this.clientWidth, height: this.height, bottom: this.top + this.height, right: this.clientWidth }; }
    getContext() { return webgl ? { getExtension: () => ({ loseContext() {} }) } : null; }
  }
  class IO { constructor(cb, opts) { this.cb = cb; this.opts = opts; this.targets = new Set(); this.active = true; observers.push(this); }
    observe(el) { this.targets.add(el); } unobserve(el) { this.targets.delete(el); } disconnect() { this.targets.clear(); this.active = false; }
    fire(el, isIntersecting = true) { this.cb([{ target: el, isIntersecting }]); } }
  class RO { constructor(cb) { this.cb = cb; this.active = true; observers.push(this); } observe() {} disconnect() { this.active = false; } }
  const doc = new Target(); doc.body = new El(); doc.hidden = false; doc.documentElement = { clientHeight: 800 };
  doc.createElement = () => new El();
  let selectorMap = {};
  doc.querySelectorAll = (sel) => selectorMap[sel] || [];
  doc.querySelector = (sel) => (selectorMap[sel] || []).find(e => e.isConnected) || null;
  const media = new Target(); media.matches = reduced;
  const win = new Target(); win.innerHeight = 800; win.devicePixelRatio = 3; win.matchMedia = () => media;
  class Renderer {
    domElement = new El(); renders = 0; pixelRatio = 0; size = null; disposed = false;
    constructor(o) { this.opts = o; renderers.push(this); }
    setPixelRatio(v) { this.pixelRatio = v; } setSize(w, h) { this.size = [w, h]; } setClearColor() {}
    render(scene) { this.renders++; this.scene = scene; } dispose() { this.disposed = true; }
  }
  const three = { ...THREE, WebGLRenderer: Renderer };
  const env = { console, document: doc, window: win, navigator: {}, performance: { now: () => now }, AbortController,
    IntersectionObserver: IO, ResizeObserver: RO, Promise,
    requestAnimationFrame: fn => { frames.set(++seq, fn); return seq; }, cancelAnimationFrame: id => frames.delete(id),
    setTimeout: fn => { timers.set(++seq, fn); return seq; }, clearTimeout: id => timers.delete(id) };
  const load = (code, require) => { const exports = {}; vm.runInNewContext(transpile(code), { ...env, exports, require }); return exports; };
  const lifecycle = load(SRC.lifecycle, () => { throw new Error('lifecycle imports nothing'); });
  const ribbon = load(SRC.ribbon, (n) => n === 'three' ? three : n === '../three/lifecycle' ? lifecycle : (() => { throw new Error('unexpected ' + n); })());
  const scene = load(SRC.scene, (n) => n.endsWith('.css') ? {} : n === './kinetic-ribbon' ? ribbon : (() => { throw new Error('unexpected ' + n); })());
  return { El, doc, win, media, frames, timers, observers, renderers, ribbon, scene, lifecycle,
    select(map) { selectorMap = map; },
    io: () => observers.filter(o => o instanceof IO),
    step(ms = 16) { now += ms; const q = [...frames.values()]; frames.clear(); q.forEach(f => f(now)); },
    advance(ms) { now += ms; },
    activeObservers: () => observers.filter(o => o.active && (o.targets ? o.targets.size : true)).length };
}
const tick = () => new Promise(r => setImmediate(r));

let passed = 0; const failures = [];
async function test(name, fn) { try { await fn(); passed++; console.log('PASS', name); } catch (e) { failures.push(name); console.error('FAIL', name, e.stack); } }

const REVEAL = (w) => w.scene.REVEAL_SEL;

await test('reveal: on-screen and above blocks are never hidden; below-fold waits, then stages in order', () => {
  const w = world(); const k = w.scene.installKinetic();
  const above = new w.El(), onscreen = new w.El(), below = [new w.El(), new w.El(), new w.El()];
  above.top = -400; onscreen.top = 300; below.forEach((e, i) => { e.top = 1200 + i * 10; });
  const all = [above, onscreen, ...below]; all.forEach(e => w.doc.body.appendChild(e));
  w.select({ [REVEAL(w)]: all });
  k.scan(w.doc);
  assert.equal(above.dataset.kx, 'shown'); assert.equal(onscreen.dataset.kx, 'shown');
  assert.deepEqual(below.map(e => e.dataset.kx), ['wait', 'wait', 'wait']); assert.equal(k.waiting(), 3);
  assert.equal(w.frames.size + w.timers.size, 0, 'reveal schedules no frames or timers');
  const io = w.io().at(-1); io.cb(below.map(target => ({ target, isIntersecting: true })));
  assert.deepEqual(below.map(e => e.dataset.kx), ['in', 'in', 'in']);
  assert.deepEqual(below.map(e => e.style.props['--kx-i']), ['0', '1', '2'], 'staggered by entry order');
  assert.equal(io.targets.size, 0); assert.equal(k.waiting(), 0);
  k.scan(w.doc); assert.deepEqual(below.map(e => e.dataset.kx), ['in', 'in', 'in'], 'processed blocks are not re-hidden');
  k.destroy();
});
await test('reveal: selectors exclude headings and page heads; untouched text', () => {
  const sel = world().scene.REVEAL_SEL;
  assert.ok(!/(^|[\s,>])h[1-6]\b/.test(sel), 'no heading element selectors');
  assert.ok(!sel.includes('.page-head'), 'page head stays immediate');
  assert.ok(sel.split(',').every(s => s.trim().startsWith('#page ')), 'scoped to routed page content');
});
await test('reveal: detached waiting blocks are released; reduced-motion change and teardown reveal everything', () => {
  const w = world(); const k = w.scene.installKinetic();
  const a = new w.El(), b = new w.El(); a.top = b.top = 2000; w.doc.body.appendChild(a); w.doc.body.appendChild(b);
  w.select({ [REVEAL(w)]: [a, b] }); k.scan(w.doc); assert.equal(k.waiting(), 2);
  a.remove(); k.scan(w.doc); assert.equal(k.waiting(), 1); assert.ok(!w.io().at(-1).targets.has(a));
  w.media.matches = true; w.media.emit('change'); assert.equal(b.dataset.kx, 'shown'); assert.equal(k.waiting(), 0);
  const c = new w.El(); c.top = 2000; w.doc.body.appendChild(c); w.select({ [REVEAL(w)]: [c] }); k.scan(w.doc);
  assert.equal(c.dataset.kx, undefined, 'reduced motion marks nothing');
  w.media.matches = false; const d = new w.El(); d.top = 2000; w.doc.body.appendChild(d); w.select({ [REVEAL(w)]: [d] }); k.scan(w.doc);
  assert.equal(d.dataset.kx, 'wait'); k.destroy(); assert.equal(d.dataset.kx, 'shown', 'teardown never leaves content hidden');
  assert.equal(w.io().every(o => !o.active || o.targets.size === 0), true); assert.equal(w.media.count(), 0);
  assert.notEqual(w.scene.installKinetic(), k, 'can reinstall after teardown');
});
await test('reveal: reduced motion at install hides nothing', () => {
  const w = world({ reduced: true }); const k = w.scene.installKinetic(); const e = new w.El(); e.top = 3000; w.doc.body.appendChild(e);
  w.select({ [REVEAL(w)]: [e] }); k.scan(w.doc); assert.equal(e.dataset.kx, undefined); assert.equal(w.io().length, 0); k.destroy();
});

function homeSection(w) {
  const page = new w.El(), sec = new w.El(), head = new w.El(), list = new w.El();
  head.className = 'sec-head'; sec.appendChild(head); sec.appendChild(list); page.appendChild(sec); w.doc.body.appendChild(page);
  return { page, sec, head, list };
}
await test('ribbon: autoattaches after artist section head, decorative, lazy until visible, one context', async () => {
  const w = world(); const k = w.scene.installKinetic(); const { sec, head, list } = homeSection(w);
  w.select({ '#page #secArtists': [sec] }); k.scan(w.doc);
  const band = sec.children[1]; assert.ok(band.className.includes('kx-ribbon')); assert.equal(sec.children[2], list, 'inserted after the head, list order kept');
  assert.equal(band.attrs['aria-hidden'], 'true'); assert.equal(band.textContent, ''); assert.equal(head.children.length, 0);
  assert.equal(w.renderers.length, 0, 'no WebGL before the band is near the viewport');
  k.scan(w.doc); assert.equal(sec.children.filter(c => c.className.includes('kx-ribbon')).length, 1, 'idempotent');
  w.io().at(-1).fire(band); await tick(); await tick();
  assert.equal(band.dataset.kxScene, 'ready'); assert.equal(w.renderers.length, 1);
  const canvas = w.renderers[0].domElement;
  assert.equal(canvas.style.pointerEvents, 'none'); assert.equal(canvas.attrs['aria-hidden'], 'true'); assert.equal(canvas.attrs.tabindex, '-1');
  assert.ok(w.renderers[0].pixelRatio <= w.ribbon.MAX_DPR, 'DPR capped');
  k.destroy(); assert.equal(sec.children.includes(band), false); assert.ok(w.renderers[0].disposed); assert.equal(w.frames.size, 0);
  assert.equal(sec.count(), 0, 'pointer listeners on the section are removed'); assert.equal(w.win.count(), 0);
});
await test('ribbon: route change removes host -> scene destroyed, then remounts on the new page head', async () => {
  const w = world(); const k = w.scene.installKinetic(); const { page, sec } = homeSection(w);
  w.select({ '#page #secArtists': [sec] }); k.scan(w.doc); const band = sec.children[1]; w.io().at(-1).fire(band); await tick(); await tick();
  const r = w.renderers[0]; page.remove(); const ph = new w.El(); const page2 = new w.El(); page2.appendChild(ph); w.doc.body.appendChild(page2);
  w.select({ '#page .page-head': [ph] }); k.scan(w.doc);
  assert.ok(r.disposed, 'old renderer disposed'); assert.equal(w.frames.size, 0);
  assert.ok(ph.children[0].className.includes('kx-ribbon--head')); k.destroy();
});
await test('ribbon: no WebGL2 and loader failure fall back to the static rule without throwing', async () => {
  const w = world({ webgl: false }); w.scene.setWebGLAvailable(undefined); const k = w.scene.installKinetic(); const { sec } = homeSection(w);
  w.select({ '#page #secArtists': [sec] }); k.scan(w.doc); const band = sec.children[1]; w.io().at(-1).fire(band);
  assert.equal(band.dataset.kxScene, 'fallback'); assert.equal(w.renderers.length, 0); k.destroy();
  const w2 = world(); w2.scene.setWebGLAvailable(true); w2.scene.setRibbonLoader(() => Promise.reject(new Error('chunk'))); const k2 = w2.scene.installKinetic(); const s2 = homeSection(w2);
  w2.select({ '#page #secArtists': [s2.sec] }); k2.scan(w2.doc); const b2 = s2.sec.children[1]; w2.io().at(-1).fire(b2); await tick(); await tick();
  assert.equal(b2.dataset.kxScene, 'fallback'); k2.destroy();
});
await test('ribbon: destroy before the lazy import resolves never creates a renderer', async () => {
  const w = world(); w.scene.setWebGLAvailable(true); const m = w.scene.mountKineticRibbon(w.doc.body.appendChild(new w.El()));
  w.io().at(-1).fire(m.el); m.destroy(); await tick(); await tick(); assert.equal(w.renderers.length, 0);
});

/* ---------- Real ribbon geometry/lifecycle ---------- */
function ribbonHost(w) { const pointer = new w.El(), host = new w.El(); pointer.appendChild(host); w.doc.body.appendChild(pointer); return { pointer, host }; }
await test('scene: real three strips, capped vertices, intro then settles and stops requesting frames', () => {
  const w = world(); const { pointer, host } = ribbonHost(w); host.clientWidth = 4000;
  const h = w.ribbon.createKineticRibbon(host, { pointerHost: pointer });
  w.io().at(-1).cb([{ isIntersecting: true }]);
  w.step(); const r = w.renderers[0]; const sc = r.scene;
  const meshes = sc.children.filter(c => c.isMesh); assert.equal(meshes.length, w.ribbon.RIBBONS.length);
  for (const m of meshes) assert.equal(m.geometry.getAttribute('position').count, (w.ribbon.MAX_SEGMENTS + 1) * 2, 'segments capped for very wide hosts');
  assert.ok(meshes.every(m => m.material.isMeshBasicMaterial && m.material.vertexColors), 'solid vertex colours, no lights/glow');
  assert.equal(sc.background, null, 'transparent: page white shows through');
  assert.equal(h.state(), 'intro');
  for (let i = 0; i < 400 && w.frames.size; i++) w.step(16);
  assert.equal(w.frames.size, 0, 'settles: no perpetual RAF'); assert.equal(h.state(), 'settled');
  const drawn = meshes.map(m => m.geometry.drawRange.count); assert.ok(drawn.every(c => c > 0), 'composition fully drawn after intro');
  const pos = meshes[1].geometry.getAttribute('position').array; assert.ok(pos.every(Number.isFinite));
  // A fine pointer wakes it briefly; it settles again.
  pointer.emit('pointermove', { pointerType: 'mouse', clientX: 300, clientY: 20 }); assert.ok(w.frames.size, 'mouse wakes');
  for (let i = 0; i < 400 && w.frames.size; i++) w.step(16);
  assert.equal(w.frames.size, 0); assert.equal(h.state(), 'settled');
  pointer.emit('pointermove', { pointerType: 'touch', clientX: 300, clientY: 20 }); assert.equal(w.frames.size, 0, 'touch never animates (page scroll stays native)');
  h.destroy(); h.destroy(); assert.ok(r.disposed); assert.equal(pointer.count() + w.win.count() + w.doc.count() + w.media.count(), 0);
  assert.equal(host.children.length, 0, 'canvas removed'); assert.equal(w.frames.size, 0);
});
await test('scene: constant input is still bounded by MAX_AWAKE_FRAMES', () => {
  const w = world(); const { pointer, host } = ribbonHost(w); const h = w.ribbon.createKineticRibbon(host, { pointerHost: pointer });
  w.io().at(-1).cb([{ isIntersecting: true }]);
  let n = 0; for (; n < 2000 && w.frames.size; n++) { pointer.emit('pointermove', { pointerType: 'mouse', clientX: (n * 37) % 900, clientY: 10 + (n % 50) }); w.step(16); }
  assert.ok(n <= w.ribbon.MAX_AWAKE_FRAMES + 5, `stopped after ${n} frames`); assert.equal(w.frames.size, 0);
  for (let i = 0; i < 20; i++) { pointer.emit('pointermove', { pointerType: 'mouse', clientX: i * 9, clientY: 12 }); w.advance(16); }
  assert.equal(w.frames.size, 0, 'continued input during cooldown stays settled');
  w.advance(1500); pointer.emit('pointermove', { pointerType: 'mouse', clientX: 40, clientY: 12 }); assert.ok(w.frames.size, 'positive control: resumes after input rests');
  h.destroy(); assert.equal(w.frames.size, 0);
});
await test('scene: off-screen, hidden tab, reduced motion stop frames; reduced motion draws one static composition', () => {
  const w = world(); const { pointer, host } = ribbonHost(w); const h = w.ribbon.createKineticRibbon(host, { pointerHost: pointer });
  const io = w.io().at(-1); assert.equal(w.frames.size, 0, 'nothing renders before intersection');
  io.cb([{ isIntersecting: true }]); w.step(); assert.ok(w.frames.size);
  io.cb([{ isIntersecting: false }]); assert.equal(w.frames.size, 0);
  io.cb([{ isIntersecting: true }]); assert.ok(w.frames.size);
  w.doc.hidden = true; w.doc.emit('visibilitychange'); assert.equal(w.frames.size, 0);
  w.doc.hidden = false; w.doc.emit('visibilitychange'); assert.ok(w.frames.size);
  w.media.matches = true; w.media.emit('change'); w.step(); w.step(); assert.equal(w.frames.size, 0, 'reduced motion: static');
  const r = w.renderers[0]; const before = r.renders; pointer.emit('pointermove', { pointerType: 'mouse', clientX: 10, clientY: 10 }); w.step();
  assert.equal(r.renders, before, 'pointer cannot override reduced motion'); h.destroy();
  const w2 = world({ reduced: true }); const x = ribbonHost(w2); const h2 = w2.ribbon.createKineticRibbon(x.host, {}); w2.io().at(-1).cb([{ isIntersecting: true }]);
  w2.step(); w2.step(); assert.equal(w2.renderers[0].renders, 1, 'exactly one static frame'); assert.equal(w2.frames.size, 0);
  assert.ok(w2.renderers[0].scene.children.filter(c => c.isMesh).every(m => m.geometry.drawRange.count > 0), 'static composition is complete'); h2.destroy();
});
await test('scene: resize rebuilds within caps; context loss is terminal and reports fallback', () => {
  const w = world(); const { pointer, host } = ribbonHost(w); let fell = 0;
  const h = w.ribbon.createKineticRibbon(host, { pointerHost: pointer, onFallback: () => fell++ });
  host.clientWidth = 200; w.observers.filter(o => o.constructor.name === 'RO').at(-1).cb([]);
  const meshes = () => w.renderers[0].scene ? w.renderers[0].scene.children.filter(c => c.isMesh) : null;
  w.io().at(-1).cb([{ isIntersecting: true }]); w.step();
  assert.equal(meshes()[0].geometry.getAttribute('position').count, (w.ribbon.MIN_SEGMENTS + 1) * 2);
  assert.deepEqual(w.renderers[0].size, [200, 96]);
  w.renderers[0].domElement.emit('webglcontextlost');
  assert.equal(fell, 1); assert.equal(h.state(), 'destroyed'); assert.ok(w.renderers[0].disposed); assert.equal(w.frames.size, 0);
  assert.equal(pointer.count() + w.win.count(), 0);
});
await test('scene: renderer construction failure returns null (caller falls back)', () => {
  const w = world(); const host = new w.El(); w.doc.body.appendChild(host);
  const code = transpile(SRC.ribbon); const exports = {};
  vm.runInNewContext(code, { window: w.win, document: w.doc, performance: { now: () => 0 }, AbortController, exports,
    require: (n) => n === 'three' ? { ...THREE, WebGLRenderer: class { constructor() { throw new Error('no gpu'); } } } : w.lifecycle });
  assert.equal(exports.createKineticRibbon(host, {}), null); assert.equal(host.children.length, 0);
});

/* ---------- CSS contract ---------- */
await test('CSS: parseable, solid palette, decorative band never takes input, hidden state only for waiting blocks', () => {
  const css = read('../frontend/src/app/kinetic-scene.css'); const ast = postcss.parse(css);
  assert.ok(!/gradient\(|blur\(|text-fill-color|background-clip:\s*text|drop-shadow|filter:/i.test(css), 'no gradients, blur, glow or gradient text');
  let hides = []; ast.walkDecls('opacity', d => { if (d.value.trim() === '0') hides.push(d.parent.selector); });
  assert.deepEqual(hides.filter(s => s !== 'from'), ['[data-kx="wait"]'], 'only waiting below-fold blocks are transparent');
  let band = false; ast.walkRules('.kx-ribbon', r => r.walkDecls('pointer-events', d => { band ||= d.value === 'none'; })); assert.ok(band);
  let canvas = false; ast.walkRules('.kx-ribbon-canvas', r => r.walkDecls('pointer-events', d => { canvas ||= d.value === 'none'; })); assert.ok(canvas);
  assert.ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\[data-kx="wait"\][\s\S]*opacity: 1 !important/.test(css), 'reduced motion shows everything');
  assert.ok(/@media print[\s\S]*\[data-kx\][\s\S]*opacity: 1 !important/.test(css), 'print shows everything');
  assert.ok(!/(^|\})\s*(html|body|:root)[^{]*\{[^}]*background(-color)?:\s*(#0|#1|#2|black)/i.test(css), 'never darkens the site');
});

console.log(JSON.stringify({ passed, failed: failures.length, failures })); if (failures.length) process.exitCode = 1;
