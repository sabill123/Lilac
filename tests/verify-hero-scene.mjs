#!/usr/bin/env node
/** Hero scene: loads the real frontend/src/app/hero-scene.ts through TypeScript transpile + node:vm,
 * with real three.js math (Scene, PerspectiveCamera, PlaneGeometry, Mesh, Texture matrices). Only WebGLRenderer
 * and a minimal DOM (<img>/<canvas>/2D context) / RAF / clock / timers / matchMedia / IntersectionObserver /
 * ResizeObserver are stubbed. This is a mocked lifecycle/logic regression check. It does NOT verify real GPU
 * output, browser decoding, or visual quality. No network, backend, database or env files.
 * Run: node tests/verify-hero-scene.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
import * as THREE from '../frontend/node_modules/three/build/three.module.js';

const SOURCE = fs.readFileSync(new URL('../frontend/src/app/hero-scene.ts', import.meta.url), 'utf8');
const transpile = (src) => ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const close = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);

/* ---------------- minimal isolated world ---------------- */
function world(src = SOURCE, { reduced = false, compact = false, webgl = true, twoD = true, maxTex = 16384, w = 1200, h = 600 } = {}) {
  let seq = 0, now = 1000;
  const frames = new Map(), timers = new Map(), observers = [], renderers = [], loads = [], textures = [], canvases = [], draws = [];
  class Target {
    listeners = new Map();
    addEventListener(type, fn, o = {}) {
      if (o?.signal?.aborted) return;
      const set = this.listeners.get(type) || new Set(); set.add(fn); this.listeners.set(type, set);
      o?.signal?.addEventListener('abort', () => set.delete(fn), { once: true });
    }
    removeEventListener(t, fn) { this.listeners.get(t)?.delete(fn); }
    emit(type, data = {}) { const ev = { type, prevented: false, preventDefault() { this.prevented = true; }, ...data }; for (const fn of [...(this.listeners.get(type) || [])]) fn(ev); return ev; }
    count() { return [...this.listeners.values()].reduce((n, s) => n + s.size, 0); }
  }
  class El extends Target {
    dataset = {}; attrs = {}; children = []; parentNode = null; className = ''; hidden = false; style = { cssText: '' }; width = 0; height = 0;
    get isConnected() { let n = this; while (n) { if (n === doc.body) return true; n = n.parentNode; } return false; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    append(el) { el.remove(); el.parentNode = this; this.children.push(el); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; }
    contains(el) { for (let n = el; n; n = n.parentNode) if (n === this) return true; return false; }
    getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
    getContext(type) {
      if (type !== '2d' || !twoD) return null; const c = this;
      return { imageSmoothingEnabled: false, imageSmoothingQuality: 'low', drawImage(img, x, y, dw, dh) { draws.push({ canvas: c, img, dw, dh, quality: this.imageSmoothingQuality }); c.from = img.url; } };
    }
  }
  class Img { // private decode image created by the module; never the DOM cover <img>
    onload = null; onerror = null; crossOrigin = null; decoding = ''; naturalWidth = 0; naturalHeight = 0; url = ''; aborted = false; _src = '';
    get width() { return this.naturalWidth; } get height() { return this.naturalHeight; }
    get src() { return this._src; } set src(v) { this._src = v; this.url = v; loads.push(this); }
    removeAttribute(k) { if (k === 'src') { this._src = ''; this.aborted = true; } }
  }
  class IO { constructor(cb) { this.cb = cb; this.targets = new Set(); this.active = true; observers.push(this); }
    observe(el) { this.targets.add(el); } disconnect() { this.targets.clear(); this.active = false; }
    fire(isIntersecting) { this.cb([{ isIntersecting }]); } }
  class RO { constructor(cb) { this.cb = cb; this.active = true; observers.push(this); } observe() {} disconnect() { this.active = false; } fire() { this.cb([]); } }
  class Renderer {
    renders = 0; disposed = false; lostForced = false; size = null; failRender = false; capabilities = { maxTextureSize: maxTex };
    constructor(o) { if (!webgl) throw new Error('no webgl'); this.opts = o; this.canvas = o.canvas; renderers.push(this); }
    setPixelRatio(v) { this.pixelRatio = v; } setSize(a, b) { this.size = [a, b]; } setClearColor() {}
    render(scene, camera) { if (this.failRender) throw new Error('render failed'); this.renders++; this.scene = scene; this.camera = camera; }
    dispose() { this.disposed = true; } forceContextLoss() { this.lostForced = true; }
  }
  class Texture extends THREE.Texture { constructor(...a) { super(...a); this.disposed = false; textures.push(this); this.addEventListener('dispose', () => { this.disposed = true; }); } }
  const doc = new Target(); doc.body = new El(); doc.hidden = false;
  doc.createElement = (tag) => { if (tag === 'img') return new Img(); const e = new El(); if (tag === 'canvas') canvases.push(e); return e; };
  const media = new Target(); media.matches = reduced;
  const small = new Target(); small.matches = compact;
  const host = new El(); host.width = w; host.height = h; doc.body.append(host);
  const three = { ...THREE, WebGLRenderer: Renderer, Texture };
  const ctx = { console, URL, Math, Promise, Error, document: doc, location: { href: 'https://lilac.test/home', origin: 'https://lilac.test' },
    devicePixelRatio: 3, matchMedia: (q) => (q.includes('reduced-motion') ? media : small), performance: { now: () => now },
    IntersectionObserver: IO, ResizeObserver: RO,
    requestAnimationFrame: (fn) => { frames.set(++seq, fn); return seq; }, cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (fn, ms) => { timers.set(++seq, { fn, ms }); return seq; }, clearTimeout: (id) => timers.delete(id) };
  const exports = {};
  vm.runInNewContext(transpile(src), { ...ctx, exports, require: (n) => { if (n === 'three') return three; throw new Error('unexpected import ' + n); } });
  const ac = new AbortController();
  return {
    mod: exports, host, doc, media, small, frames, timers, observers, renderers, loads, textures, canvases, draws, ac,
    mount(opts = {}) { return exports.mountHeroScene(host, { signal: ac.signal, ...opts }); },
    io: () => observers.find((o) => o instanceof IO), ro: () => observers.find((o) => o instanceof RO),
    canvas: () => host.children.find((c) => c.className === 'cover-webgl') || null,
    img: (src, { currentSrc = '', nw = 800, nh = 1000 } = {}) => ({ src, currentSrc, naturalWidth: nw, naturalHeight: nh, alt: 'Artist · 현재 공식 프로필 사진', dataset: { kind: 'profile' } }),
    resolve(i, { nw = 800, nh = 1000 } = {}) { const im = loads[i]; im.naturalWidth = nw; im.naturalHeight = nh; im.onload?.(); return im; },
    reject(i) { loads[i].onerror?.(); },
    timeouts: () => [...timers.entries()].filter(([, t]) => t.ms === 12000),
    fireTimeout(k = 0) { const [id, t] = [...timers.entries()].filter(([, v]) => v.ms === 12000)[k]; timers.delete(id); t.fn(); },
    step(ms = 16) { now += ms; const q = [...frames.values()]; frames.clear(); q.forEach((f) => f(now)); },
    settle(max = 400) { for (let i = 0; i < max && frames.size; i++) this.step(); },
    advance(ms) { now += ms; },
    mesh() { const r = renderers.at(-1); return r?.scene?.children[0] || null; },
    srcOf: (t) => t?.image?.from || t?.image?.url,
    pointer(clientX, clientY) { host.emit('pointermove', { pointerType: 'mouse', clientX, clientY }); },
  };
}
async function ready(src, opts) {
  const W = world(src, opts); const api = W.mount(); W.io().fire(true);
  api.setImage(W.img('/media/a.jpg'), 'profile'); await tick();
  W.resolve(0); await tick(); W.step(); return { W, api };
}

/* ---------------- tests (each takes the module source so negative controls can mutate it) ---------------- */
const T = {};

T.offscreenReduced = async (src) => {
  const A = world(src); const a = A.mount(); a.setImage(A.img('/media/a.jpg'), 'profile'); await tick();
  assert.equal(A.renderers.length, 0, 'offscreen created a WebGLRenderer');
  assert.equal(A.loads.length, 0, 'offscreen started a texture load');
  assert.equal(A.canvas(), null, 'offscreen appended the canvas'); assert.equal(A.frames.size, 0, 'offscreen scheduled RAF');
  assert.equal(A.host.dataset.heroScene, 'offscreen', 'offscreen state not honest');
  const B = world(src, { reduced: true }); const b = B.mount(); B.io().fire(true); b.setImage(B.img('/media/a.jpg'), 'profile'); await tick();
  assert.equal(B.renderers.length, 0, 'reduced motion created a renderer'); assert.equal(B.loads.length, 0, 'reduced motion loaded a texture');
  assert.equal(B.canvases.length, 0, 'reduced motion created a canvas'); assert.equal(B.host.dataset.heroScene, 'reduced');
  const C = world(src); C.doc.hidden = true; const c = C.mount(); C.io().fire(true); c.setImage(C.img('/media/a.jpg'), 'profile'); await tick();
  assert.equal(C.renderers.length, 0, 'hidden document created a renderer'); assert.equal(C.loads.length, 0, 'hidden document loaded a texture');
  assert.equal(C.host.dataset.heroScene, 'hidden');
  A.io().fire(true); await tick();
  assert.equal(A.renderers.length, 1, 'entering view should init renderer'); assert.equal(A.loads.length, 1);
};

T.sourceToken = async (src) => {
  const W = world(src); const api = W.mount(); W.io().fire(true);
  const dom = W.img('https://cdn.example/x.jpg?a=1&b=2', { currentSrc: 'https://cdn.example/x@2x.jpg', nw: 5000, nh: 4000 });
  const before = JSON.stringify(dom);
  api.setImage(dom, 'profile'); await tick();
  assert.equal(W.loads[0].url, '/api/live/img?u=' + encodeURIComponent('https://cdn.example/x@2x.jpg'));
  assert.equal(W.loads[0].crossOrigin, 'anonymous'); assert.notEqual(W.loads[0], dom, 'decoded the DOM image itself');
  api.setImage(W.img('/media/b.jpg'), 'album'); await tick();
  assert.equal(W.loads[1].url, '/media/b.jpg');
  W.resolve(1, { nw: 1000, nh: 1000 }); await tick(); W.step();
  const tb = W.mesh().material.map;
  assert.equal(W.srcOf(tb), '/media/b.jpg', 'mesh bound to texture of a different source');
  assert.equal(W.canvas().dataset.revision, '2', 'canvas revision must be token of the current setImage');
  assert.equal(W.canvas().hidden, false); assert.equal(W.host.dataset.heroScene, 'ready');
  W.resolve(0, { nw: 5000, nh: 4000 }); await tick();
  api.setImage(W.img('/media/b.jpg'), 'album'); await tick(); W.step();
  assert.equal(W.loads.length, 2, 'cached source re-requested');
  assert.equal(W.mesh().material.map, tb); assert.equal(W.canvas().dataset.revision, '3');
  assert.equal(JSON.stringify(dom), before, 'original DOM image/detail mutated');
  const V = world(src); const v = V.mount({ textureUrl: (s) => 'proxied:' + s }); V.io().fire(true);
  v.setImage(V.img('https://cdn.example/z.jpg'), 'profile'); await tick();
  assert.equal(V.loads[0].url, 'proxied:https://cdn.example/z.jpg');
};

T.staleLateResponse = async (src) => {
  const W = world(src); const api = W.mount(); W.io().fire(true);
  api.setImage(W.img('/media/old.jpg'), 'profile'); await tick();
  api.setImage(W.img('/media/new.jpg'), 'album'); await tick();
  assert.equal(W.loads.length, 2);
  W.resolve(1, { nw: 1600, nh: 900 }); await tick(); W.step();
  const tNew = W.mesh().material.map; assert.equal(W.srcOf(tNew), '/media/new.jpg'); assert.equal(W.canvas().dataset.revision, '2');
  W.resolve(0); await tick(); W.step();
  assert.equal(W.mesh().material.map, tNew, 'late stale texture replaced the new photo');
  assert.equal(W.canvas().dataset.revision, '2', 'late stale texture changed the revision');
  assert.equal(W.host.dataset.heroScene, 'ready');
  const X = world(src); const x = X.mount(); X.io().fire(true);
  x.setImage(X.img('/media/old.jpg'), 'profile'); await tick(); x.setImage(X.img('/media/new.jpg'), 'profile'); await tick();
  X.resolve(0); await tick(); X.step();
  assert.equal(X.renderers[0].renders, 0, 'stale texture rendered while the new one was pending');
  assert.equal(X.canvas().hidden, true); assert.equal(X.host.dataset.heroScene, 'loading');
  assert.equal(X.mesh(), null);
};

T.failureAbortNoRewrite = async (src) => {
  const A = world(src); const a = A.mount(); A.io().fire(true); a.setImage(A.img('/media/a.jpg'), 'profile'); await tick();
  A.reject(0); await tick();
  assert.equal(A.host.dataset.heroScene, 'fallback'); assert.equal(A.canvas().hidden, true); assert.equal(A.frames.size, 0);
  assert.equal(A.timeouts().length, 0, 'timeout timer left after failure');
  const B = world(src); const b = B.mount(); B.io().fire(true);
  b.setImage(B.img('/media/a.jpg'), 'profile'); await tick(); b.setImage(B.img('/media/b.jpg'), 'profile'); await tick();
  B.reject(0); await tick();
  assert.equal(B.host.dataset.heroScene, 'loading', 'stale failure rewrote host state');
  B.resolve(1); await tick(); B.step();
  assert.equal(B.host.dataset.heroScene, 'ready'); assert.equal(B.canvas().hidden, false);
  // abort mid-load: request cancelled, timer cleared, late delivery inert, no DOM rewrite
  const C = world(src); const c = C.mount(); C.io().fire(true); c.setImage(C.img('/media/a.jpg'), 'profile'); await tick();
  const im = C.loads[0], lateOk = im.onload, lateErr = im.onerror;
  C.ac.abort(); await tick();
  assert.equal(im.aborted, true, 'abort did not cancel the image request'); assert.equal(C.timeouts().length, 0, 'timeout survived abort');
  im.naturalWidth = 10; im.naturalHeight = 10; lateOk?.(); lateErr?.(); await tick(); C.step();
  assert.equal('heroScene' in C.host.dataset, false, 'late outcome after abort rewrote dataset'); assert.equal(C.canvas(), null);
  assert.equal(C.textures.filter((t) => !t.disposed).length, 0, 'late outcome after abort leaked a texture');
  // load resolves in the same turn as abort (texture built, then fenced) → disposed
  const D = world(src); const d = D.mount(); D.io().fire(true); d.setImage(D.img('/media/a.jpg'), 'profile'); await tick();
  D.resolve(0); D.ac.abort(); await tick(); D.step();
  assert.equal(D.textures.length, 1); assert.equal(D.textures[0].disposed, true, 'texture arriving after abort leaked');
  assert.equal(D.canvas(), null); assert.equal('heroScene' in D.host.dataset, false); assert.equal(D.renderers[0].renders, 0);
  d.setImage(D.img('/media/z.jpg'), 'profile'); await tick();
  assert.equal(D.loads.length, 1); assert.equal('heroScene' in D.host.dataset, false);
};

T.timeout = async (src) => {
  const W = world(src); const api = W.mount(); W.io().fire(true);
  api.setImage(W.img('/media/hang.jpg'), 'profile'); await tick();
  assert.equal(W.timeouts().length, 1, 'no bounded texture timeout armed'); assert.equal(W.host.dataset.heroScene, 'loading');
  const im = W.loads[0], late = im.onload;
  W.fireTimeout(); await tick();
  assert.equal(W.host.dataset.heroScene, 'fallback', 'timeout did not fall back'); assert.equal(im.aborted, true, 'timed-out request not cancelled');
  im.naturalWidth = 900; im.naturalHeight = 900; late?.(); await tick(); W.step();
  assert.equal(W.textures.length, 0, 'late image after timeout created a texture'); assert.equal(W.host.dataset.heroScene, 'fallback');
  // no automatic or scroll-driven retry of the failed row
  W.io().fire(false); W.io().fire(true); W.doc.hidden = true; W.doc.emit('visibilitychange'); W.doc.hidden = false; W.doc.emit('visibilitychange'); await tick();
  assert.equal(W.loads.length, 1, 'failed row retried automatically'); assert.equal(W.host.dataset.heroScene, 'fallback');
  // slot freed: a new photo loads normally
  api.setImage(W.img('/media/next.jpg'), 'album'); await tick();
  assert.equal(W.loads.length, 2); W.resolve(1); await tick(); W.step(); assert.equal(W.host.dataset.heroScene, 'ready');
};

T.queue = async (src) => {
  const W = world(src); const api = W.mount(); W.io().fire(true);
  for (const s of ['a', 'b', 'c', 'd']) { api.setImage(W.img(`/media/${s}.jpg`), 'profile'); await tick(); }
  assert.equal(W.loads.length, 2, 'more than 2 concurrent texture loads');
  assert.equal(W.host.dataset.heroScene, 'loading', 'full slots should wait, not fall back');
  W.resolve(0); await tick();
  assert.equal(W.loads.length, 3, 'freed slot did not retry the waiting current row');
  assert.equal(W.loads[2].url, '/media/d.jpg', 'retried a superseded row instead of the newest');
  W.resolve(2); await tick(); W.step();
  assert.equal(W.host.dataset.heroScene, 'ready'); assert.equal(W.canvas().dataset.revision, '4');
  assert.equal(W.srcOf(W.mesh().material.map), '/media/d.jpg');
  W.resolve(1); await tick(); W.step(); assert.equal(W.loads.length, 3, '/media/c.jpg should never load'); assert.equal(W.canvas().dataset.revision, '4');
  // a failing load also frees the slot; a real failure of the current row is not retried forever
  const F = world(src); const f = F.mount(); F.io().fire(true);
  for (const s of ['a', 'b', 'c']) { f.setImage(F.img(`/media/${s}.jpg`), 'profile'); await tick(); }
  F.reject(1); await tick(); assert.equal(F.loads.length, 3); assert.equal(F.loads[2].url, '/media/c.jpg');
  F.reject(2); await tick(); F.resolve(0); await tick();
  assert.equal(F.loads.length, 3, 'current row failure retried'); assert.equal(F.host.dataset.heroScene, 'fallback');
};

T.idleRafStops = async (src) => {
  const { W } = await ready(src);
  const r = W.renderers[0];
  W.settle(120);
  assert.equal(W.frames.size, 0, 'RAF never went idle after the intro burst');
  const settled = r.renders; assert.ok(settled > 30 && settled < 70, `intro burst frames ${settled}`);
  W.step(); W.step(); W.advance(5000); W.step(); assert.equal(r.renders, settled, 'idle scene kept rendering');
  assert.equal(W.host.dataset.heroScene, 'ready');
  const flat = new THREE.PlaneGeometry(1, 1, 40, 24).attributes.position.array, pos = W.mesh().geometry.attributes.position.array;
  assert.equal(pos.length, flat.length); for (let i = 0; i < flat.length; i++) close(pos[i], flat[i], 1e-6, `vertex[${i}]`);
  W.pointer(1200, 0); assert.equal(W.frames.size, 1, 'pointer did not wake');
  W.host.emit('pointerleave'); W.settle();
  assert.equal(W.frames.size, 0, 'RAF kept running after pointer settled');
  W.host.emit('pointermove', { pointerType: 'touch', clientX: 0, clientY: 0 }); assert.equal(W.frames.size, 0);
  W.pointer(0, 0); W.io().fire(false); assert.equal(W.frames.size, 0); assert.equal(W.canvas().hidden, true);
  assert.equal(W.host.dataset.heroScene, 'offscreen', 'offscreen state still claims ready');
  W.io().fire(true); await tick(); W.step(); assert.equal(W.host.dataset.heroScene, 'ready');
  W.doc.hidden = true; W.doc.emit('visibilitychange'); assert.equal(W.host.dataset.heroScene, 'hidden'); assert.equal(W.frames.size, 0);
  W.doc.hidden = false; W.doc.emit('visibilitychange'); await tick(); W.step(); assert.equal(W.host.dataset.heroScene, 'ready');
};

T.burstCooldown = async (src) => {
  const { W } = await ready(src);
  const r = W.renderers[0];
  for (let i = 0; i < 400 && W.frames.size; i++) { W.pointer(i % 2 ? 1200 : 0, 300); W.step(); }
  assert.equal(W.frames.size, 0, 'continuous pointer kept RAF alive past burst cap');
  assert.equal(r.renders, 240, 'burst cap should bound continuous rendering');
  const cool = [...W.timers.values()].filter((t) => t.ms === 1200); assert.equal(cool.length, 1, 'cooldown timer missing');
  W.pointer(0, 0); assert.equal(W.frames.size, 0, 'pointer woke RAF during cooldown');
  const [id, t] = [...W.timers.entries()].find(([, v]) => v.ms === 1200); W.timers.delete(id); t.fn();
  W.pointer(1200, 600); assert.equal(W.frames.size, 1, 'cooldown never released');
};

T.cleanup = async (src) => {
  const { W, api } = await ready(src);
  const r = W.renderers[0], mesh = W.mesh(), tex = mesh.material.map;
  let geo = false, mat = false; mesh.geometry.addEventListener('dispose', () => { geo = true; }); mesh.material.addEventListener('dispose', () => { mat = true; });
  api.setImage(W.img('/media/inflight.jpg'), 'album'); await tick(); const inflight = W.loads[1];
  W.pointer(10, 10);
  W.ac.abort();
  assert.equal(W.frames.size, 0, 'RAF survived abort'); assert.equal(r.disposed, true); assert.equal(r.lostForced, true);
  assert.equal(tex.disposed, true, 'cached texture not disposed'); assert.ok(geo && mat, 'geometry/material not disposed');
  assert.equal(inflight.aborted, true, 'in-flight load survived abort'); assert.equal(W.timers.size, 0, 'timer survived abort');
  assert.equal(W.canvas(), null); assert.equal('heroScene' in W.host.dataset, false);
  assert.equal(W.observers.filter((o) => o.active).length, 0, 'observer still connected');
  assert.equal(W.media.count(), 0, 'matchMedia listener left'); assert.equal(W.host.count(), 0, 'host listener left');
  assert.equal(W.doc.count(), 0, 'document listener left'); assert.equal(r.canvas.count(), 0, 'canvas listener left');
  W.io().cb([{ isIntersecting: true }]); W.ro().fire(); await tick(); W.step();
  assert.equal(W.canvas(), null); assert.equal(W.frames.size, 0); assert.equal(W.loads.length, 2);
};

T.cooldownTimerCleared = async (src) => {
  const { W } = await ready(src);
  for (let i = 0; i < 400 && W.frames.size; i++) { W.pointer(i % 2 ? 1200 : 0, 300); W.step(); }
  assert.equal([...W.timers.values()].filter((t) => t.ms === 1200).length, 1);
  W.ac.abort(); assert.equal(W.timers.size, 0, 'cooldown timer survived abort');
};

T.reducedRelease = async (src) => {
  const { W, api } = await ready(src);
  const r1 = W.renderers[0], c1 = W.canvas(), mesh = W.mesh(), tex = mesh.material.map;
  let geo = false, mat = false; mesh.geometry.addEventListener('dispose', () => { geo = true; }); mesh.material.addEventListener('dispose', () => { mat = true; });
  api.setImage(W.img('/media/b.jpg'), 'album'); await tick(); const inflight = W.loads[1];
  W.media.matches = true; W.media.emit('change');
  assert.equal(W.host.dataset.heroScene, 'reduced'); assert.equal(W.frames.size, 0);
  assert.equal(r1.disposed, true, 'renderer kept under reduced motion'); assert.equal(r1.lostForced, true, 'context kept under reduced motion');
  assert.equal(tex.disposed, true, 'texture kept under reduced motion'); assert.ok(geo && mat, 'geometry/material kept under reduced motion');
  assert.equal(inflight.aborted, true, 'in-flight load kept under reduced motion'); assert.equal(W.timeouts().length, 0);
  assert.equal(W.canvas(), null, 'released canvas left in host');
  c1.emit('webglcontextlost'); assert.equal(W.host.dataset.heroScene, 'reduced', 'forced loss of discarded canvas rewrote state');
  W.pointer(0, 0); assert.equal(W.frames.size, 0, 'pointer woke RAF under reduced motion');
  api.setImage(W.img('/media/c.jpg'), 'concert'); await tick();
  assert.equal(W.loads.length, 2, 'loaded under reduced motion'); assert.equal(W.host.dataset.heroScene, 'reduced');
  // re-enable: fresh renderer on a fresh canvas, newest photo restored
  W.media.matches = false; W.media.emit('change'); await tick();
  assert.equal(W.renderers.length, 2, 'not re-activated after reduced motion'); assert.notEqual(W.canvas(), c1, 'reused a canvas after forced context loss');
  assert.equal(W.renderers[1].canvas, W.canvas()); assert.equal(W.loads.at(-1).url, '/media/c.jpg');
  W.resolve(W.loads.length - 1); await tick(); W.step();
  assert.equal(W.host.dataset.heroScene, 'ready'); assert.equal(W.canvas().dataset.revision, '3'); assert.equal(W.srcOf(W.mesh().material.map), '/media/c.jpg');
};

T.contextLostRestored = async (src) => {
  const { W, api } = await ready(src);
  const c = W.canvas(), r = W.renderers[0];
  const ev = c.emit('webglcontextlost'); assert.equal(ev.prevented, true, 'contextlost not preventDefault()ed (blocks restore)');
  assert.equal(W.host.dataset.heroScene, 'context-lost'); assert.equal(W.frames.size, 0);
  api.setImage(W.img('/media/new.jpg'), 'album'); await tick(); W.step();
  assert.equal(W.host.dataset.heroScene, 'context-lost', 'setImage hid the lost context'); assert.equal(r.renders > 0, true);
  const rendered = r.renders; W.pointer(5, 5); W.io().fire(false); W.io().fire(true); await tick(); W.step();
  assert.equal(r.renders, rendered, 'rendered while context lost'); assert.equal(W.host.dataset.heroScene, 'context-lost');
  c.emit('webglcontextrestored'); await tick();
  assert.equal(W.renderers.length, 1, 'restore should reuse the restored renderer'); assert.equal(W.canvas(), c);
  assert.equal(W.loads.at(-1).url, '/media/new.jpg', 'restore did not load the newest image');
  W.resolve(W.loads.length - 1); await tick(); W.step();
  assert.equal(W.host.dataset.heroScene, 'ready', 'not recovered after contextrestored'); assert.equal(W.canvas().dataset.revision, '2');
  assert.equal(W.srcOf(W.mesh().material.map), '/media/new.jpg');
};

T.runtimeFallbacks = async (src) => {
  const N = world(src, { webgl: false }); const n = N.mount(); N.io().fire(true); n.setImage(N.img('/media/a.jpg'), 'profile'); await tick();
  assert.equal(N.host.dataset.heroScene, 'fallback'); assert.equal(N.loads.length, 0);
  n.setImage(N.img('/media/b.jpg'), 'profile'); await tick(); assert.equal(N.host.dataset.heroScene, 'fallback');
  const F = world(src); const f = F.mount(); F.io().fire(true); f.setImage(F.img('/media/a.jpg'), 'profile'); await tick();
  F.renderers[0].failRender = true; F.resolve(0); await tick(); F.step();
  assert.equal(F.host.dataset.heroScene, 'fallback'); assert.equal(F.canvas().hidden, true); assert.equal(F.frames.size, 0);
  F.io().fire(false); assert.equal(F.host.dataset.heroScene, 'fallback', 'broken renderer reported as offscreen');
};

T.downsample = async (src) => {
  const { heroTextureSize } = world(src).mod;
  assert.deepEqual({ ...heroTextureSize(800, 1000, 2048) }, { width: 800, height: 1000, scaled: false });
  assert.deepEqual({ ...heroTextureSize(4000, 3000, 2048) }, { width: 2048, height: 1536, scaled: true });
  assert.deepEqual({ ...heroTextureSize(3000, 4000, 1024) }, { width: 768, height: 1024, scaled: true });
  const check = async (opts, nw, nh, want) => {
    const W = world(src, opts); const api = W.mount(); W.io().fire(true);
    const dom = W.img('/media/big.jpg', { nw, nh }); const before = JSON.stringify(dom);
    api.setImage(dom, 'profile'); await tick(); const im = W.resolve(0, { nw, nh }); await tick(); W.step();
    const map = W.mesh().material.map;
    if (want) {
      assert.equal(W.draws.length, 1, `large ${nw}x${nh} not downsampled`); const d = W.draws[0];
      assert.deepEqual([d.dw, d.dh, d.canvas.width, d.canvas.height], [...want, ...want]); assert.equal(d.quality, 'high');
      assert.equal(map.image, d.canvas, 'GPU texture still uses full-size image'); assert.equal(im.aborted, true, 'full-size private image kept');
      close(map.image.width / map.image.height, nw / nh, 2 / Math.min(...want), 'downsample aspect');
      const plane = W.mod.heroPlane(2, map.image.width / map.image.height, 'profile'); close(W.mesh().scale.x, plane.w);
    } else { assert.equal(W.draws.length, 0, 'small image re-encoded'); assert.equal(map.image, im); }
    assert.equal(JSON.stringify(dom), before, 'DOM image mutated');
    return W;
  };
  await check({}, 4000, 3000, [2048, 1536]);
  await check({ compact: true }, 3000, 4000, [768, 1024]);
  await check({}, 800, 1000, null);
  await check({ compact: true }, 1024, 700, null);
  await check({ maxTex: 512 }, 1600, 800, [512, 256]);
  const No2d = world(src, { twoD: false }); const a = No2d.mount(); No2d.io().fire(true); a.setImage(No2d.img('/media/big.jpg'), 'profile'); await tick();
  const im = No2d.resolve(0, { nw: 4000, nh: 3000 }); await tick(); No2d.step();
  assert.equal(No2d.mesh().material.map.image, im, 'no 2D context should fall back to the original image'); assert.equal(No2d.host.dataset.heroScene, 'ready');
};

T.cacheTrim = async (src) => {
  const W = world(src); const api = W.mount(); W.io().fire(true);
  for (let i = 0; i < 6; i++) { api.setImage(W.img(`/media/${i}.jpg`), 'album'); await tick(); W.resolve(i); await tick(); W.step(); }
  const live = W.textures.filter((t) => !t.disposed);
  assert.ok(live.length <= 4, `cache holds ${live.length} textures`);
  assert.equal(W.mesh().material.map.disposed, false, 'current texture disposed by trim');
  assert.equal(W.srcOf(W.mesh().material.map), '/media/5.jpg');
};

T.geometryContainCover = async (src) => {
  const W = world(src); const { heroUv, heroPlane } = W.mod;
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 50); cam.position.z = 4;
  const fh = 2 * 4 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  for (const view of [0.5, 0.75, 1, 1.6, 2.4]) for (const img of [0.6, 0.8, 1, 1.5, 3]) {
    const fw = fh * view;
    for (const mode of ['album', 'concert']) {
      const p = heroPlane(view, img, mode);
      close(p.w / p.h, img, 1e-9, `${mode} aspect v${view} i${img}`);
      assert.ok(p.w <= fw + 1e-9 && p.h <= fh + 1e-9, `${mode} overflows frustum v${view} i${img}`);
      assert.ok(Math.abs(p.w - fw) < 1e-9 || Math.abs(p.h - fh) < 1e-9, `${mode} does not fill an edge`);
    }
    const p = heroPlane(view, img, 'profile'); assert.ok(p.w >= fw && p.h >= fh, 'profile does not cover');
    const uv = heroUv(img, view), t = new THREE.Texture(); t.repeat.set(uv.x, uv.y); t.offset.set(uv.offsetX, uv.offsetY); t.updateMatrix();
    const a = new THREE.Vector2(0, 0).applyMatrix3(t.matrix), b = new THREE.Vector2(1, 1).applyMatrix3(t.matrix);
    for (const v of [a, b]) assert.ok(v.x >= -1e-9 && v.x <= 1 + 1e-9 && v.y >= -1e-9 && v.y <= 1 + 1e-9, 'profile crop leaves texture');
    close(((b.x - a.x) * img) / (b.y - a.y), p.w / p.h, 1e-9, `profile pixel aspect v${view} i${img}`);
  }
  const M = world(src, { w: 1200, h: 600 }); const m = M.mount(); M.io().fire(true);
  m.setImage(M.img('/media/p.jpg'), 'profile'); await tick(); M.resolve(0, { nw: 800, nh: 1000 }); await tick(); M.step();
  const mesh = M.mesh(), want = heroPlane(2, 0.8, 'profile'), u = heroUv(0.8, 2);
  close(mesh.scale.x, want.w); close(mesh.scale.y, want.h); close(mesh.material.map.repeat.x, u.x); close(mesh.material.map.repeat.y, u.y);
  M.host.width = 400; M.host.height = 800; M.ro().fire();
  assert.deepEqual(M.renderers[0].size, [400, 800]); close(M.renderers[0].camera.aspect, 0.5);
  close(mesh.scale.x, heroPlane(0.5, 0.8, 'profile').w); close(mesh.material.map.repeat.y, heroUv(0.8, 0.5).y);
  assert.equal(M.renderers[0].pixelRatio, 1.75, 'pixel ratio cap');
  assert.deepEqual({ ...M.renderers[0].opts }, { canvas: M.canvas(), alpha: true, antialias: true, powerPreference: 'low-power' }, 'renderer options changed');
  assert.equal(mesh.material.transparent, true); assert.equal(mesh.material.side, THREE.DoubleSide); assert.equal(mesh.material.depthTest, false);
  const g = mesh.geometry.parameters; assert.deepEqual([g.width, g.height, g.widthSegments, g.heightSegments], [1, 1, 40, 24]);
  assert.equal(mesh.material.map.colorSpace, THREE.SRGBColorSpace); assert.equal(mesh.material.map.generateMipmaps, false); assert.equal(mesh.material.map.minFilter, THREE.LinearFilter);
};

/* ---------------- runner ---------------- */
let passed = 0; const failures = [];
async function check(name, fn) {
  try { await fn(SOURCE); passed++; console.log('ok   ' + name); }
  catch (e) { failures.push(name); console.log('FAIL ' + name + '\n     ' + String(e.message || e).split('\n')[0]); }
}
const mutate = (src, from, to) => { assert.ok(src.includes(from), 'mutation anchor missing: ' + from); return src.replace(from, to); };
async function negative(name, fn, make) {
  let src; try { src = make(); } catch (e) { failures.push('negative control anchor: ' + name); console.log('FAIL negative control anchor missing: ' + name); return; }
  try { await fn(src); failures.push('negative control did not fail: ' + name); console.log('FAIL negative control passed (assertion is too weak): ' + name); }
  catch (e) { passed++; console.log('ok   negative control fails as expected: ' + name + ' -> ' + String(e.message || e).split('\n')[0]); }
}

await check('offscreen / reduced motion / hidden document allocate nothing and report honest state', T.offscreenReduced);
await check('original image source ↔ load URL ↔ token/revision ↔ bound texture; DOM image untouched', T.sourceToken);
await check('late stale image response never replaces the newer photo', T.staleLateResponse);
await check('failure/abort: stale or post-abort outcomes never rewrite DOM; late textures disposed', T.failureAbortNoRewrite);
await check('12s bounded texture timeout cancels request, frees slot, no automatic retry', T.timeout);
await check('2 concurrent loads: newest current row waits and auto-retries when a slot frees', T.queue);
await check('idle RAF stops; idle vertices equal real PlaneGeometry; offscreen/hidden honest', T.idleRafStops);
await check('continuous pointer burst capped at 240 frames with 1200ms cooldown', T.burstCooldown);
await check('abort cleanup disposes GPU objects, loads, listeners, observers, RAF and DOM', T.cleanup);
await check('cooldown timer cleared on abort', T.cooldownTimerCleared);
await check('reduced motion releases all GPU resources and re-activates on a fresh canvas', T.reducedRelease);
await check('context lost stays honest; contextrestored recovers the newest image', T.contextLostRestored);
await check('runtime fallbacks: no WebGL and render throw are sticky', T.runtimeFallbacks);
await check('large images downsampled (desktop 2048 / mobile 1024 / maxTextureSize) via 2D canvas', T.downsample);
await check('texture cache trimmed to 4 and never disposes the current texture', T.cacheTrim);
await check('geometry: contain/cover via real three matrices; renderer/material/geometry design unchanged', T.geometryContainCover);

const S = SOURCE;
await negative('stale token guard removed after await', T.staleLateResponse,
  () => mutate(S, 'if(dead||gen!==epoch||!current||current.token!==row.token||!host.isConnected)return;', 'if(dead||gen!==epoch||!current||!host.isConnected)return;'));
await negative('visibility/motion gate removed from show()+init()', T.offscreenReduced,
  () => mutate(mutate(S, 'if(lost||broken||reduce.matches||!visible||document.hidden||failed===row.token)', 'if(lost||broken||failed===row.token)'),
    'if(dead||broken||lost||!visible||document.hidden||reduce.matches)return false;', 'if(dead||broken||lost)return false;'));
await negative('idle stop removed from draw()', T.idleRafStops, () => mutate(S, 'if(moving&&burst<240)frame=', 'if(true)frame='));
await negative('stale-failure token check removed', T.failureAbortNoRewrite,
  () => mutate(S, 'if(!dead&&gen===epoch&&current?.token===row.token&&host.isConnected){failed', 'if(!dead&&gen===epoch&&host.isConnected){failed'));
await negative('late-texture dispose fence removed', T.failureAbortNoRewrite, () => mutate(S, 'if(dead||gen!==epoch){t.dispose();return;}', 'if(dead||gen!==epoch){return;}'));
await negative('texture timeout removed', T.timeout, () => mutate(S, "timer=setTimeout(()=>done(new Error('timeout')),HERO_TEXTURE_TIMEOUT_MS);", ''));
await negative('failed-row retry guard removed', T.timeout, () => mutate(S, '||failed===row.token){settle();return;}', '){settle();return;}'));
await negative('slot-freed retry (kick) removed', T.queue, () => mutate(S, 'function kick(){if(', 'function kick(){return;if('));
await negative('reduced-motion GPU release removed', T.reducedRelease, () => mutate(S, "if(reduce.matches){release();fallback('reduced');}", "if(reduce.matches){fallback('reduced');}"));
await negative('canvas reused after forced context loss', T.reducedRelease, () => mutate(S, 'canvas?.remove();canvas=null;lost=false;}', 'lost=false;}'));
await negative('contextrestored recovery removed', T.contextLostRestored, () => mutate(S, 'cache.forEach(t=>{t.needsUpdate=true;});void show();', 'cache.forEach(t=>{t.needsUpdate=true;});'));
await negative('2D downsampling removed', T.downsample, () => mutate(S, 'if(dim.scaled){', 'if(false){'));
await negative('honest offscreen state removed', T.idleRafStops, () => mutate(S, "const away=()=>{stop();if(canvas)canvas.hidden=true;settle();};", "const away=()=>{stop();if(canvas)canvas.hidden=true;};"));

console.log('\nnote: mocked renderer/DOM; verifies lifecycle, fencing and math only, not real GPU output or visual quality.');
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.log(' x ' + f)); process.exit(1); }
