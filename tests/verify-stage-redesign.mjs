/** Real Stage3D/lifecycle + Three geometry and shaders, fake DOM/GPU only.
 * node tests/verify-stage-redesign.mjs — no network, backend or credentials. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
import * as THREE from '../frontend/node_modules/three/build/three.module.js';

class El {
  listeners = new Map(); children = []; style = {}; dataset = {}; isConnected = true;
  clientWidth = 1440; clientHeight = 680; top = 0; captured = null;
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn({ type, preventDefault() {}, ...event }); }
  setAttribute() {}
  appendChild(el) { el.parent = this; this.children.push(el); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); }
  getBoundingClientRect() { return { left: 0, top: this.top, width: this.clientWidth, height: this.clientHeight }; }
  setPointerCapture(id) { this.captured = id; } releasePointerCapture() { this.captured = null; }
  getContext() { return null; }
  closest() { return { contains: el => el?.insideStage === true }; }
}
const media = new El(); media.matches = false;
const document = new El(); document.hidden = false; document.activeElement = null;
document.createElement = () => new El();
const window = new El(); window.matchMedia = () => media; window.devicePixelRatio = 2; window.innerHeight = 900;
let id = 0, now = 0;
const frames = new Map(), observers = [], renderers = [], requests = [], intervals = new Map(), timers = new Map();
class IO { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } }
class RO { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} }
class Renderer {
  domElement = new El(); capabilities = { getMaxAnisotropy: () => 8 }; renders = 0;
  constructor() { renderers.push(this); }
  setPixelRatio(n) { assert.ok(n <= 1.75); }
  setSize() {} setClearColor() {}
  render(scene, camera) { this.scene = scene; this.camera = camera; camera.updateMatrixWorld(); scene.updateMatrixWorld(); this.renders++; }
  dispose() { this.disposed = true; } forceContextLoss() { this.contextLost = true; }
}
class Loader { setCrossOrigin() {} load(url, done, _, fail) { requests.push({ url, done, fail }); } }
const env = {
  Date: class extends Date { static now() { return 200000 + now; } },
  document, window, console, performance: { now: () => now },
  IntersectionObserver: IO, ResizeObserver: RO,
  requestAnimationFrame(fn) { const i = ++id; frames.set(i, fn); return i; }, cancelAnimationFrame(i) { frames.delete(i); },
  setInterval(fn) { const i = ++id; intervals.set(i, fn); return i; }, clearInterval(i) { intervals.delete(i); },
  setTimeout(fn) { const i = ++id; timers.set(i, fn); return i; }, clearTimeout(i) { timers.delete(i); },
};
function load(file, require) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; vm.runInNewContext(js, { ...env, exports, require }); return exports;
}
const { createSceneLifecycle } = load('../frontend/src/three/lifecycle.ts', () => { throw Error('unexpected import'); });
const { createStage3D } = load('../frontend/src/three/stage3d.ts', name => name === 'three' ? { ...THREE, WebGLRenderer: Renderer, TextureLoader: Loader } : { createSceneLifecycle });
function tick(ms = 16) { now += ms; const f = [...frames.values()]; frames.clear(); f.forEach(fn => fn(now)); }
function ticks(n = 50) { for (let i = 0; i < n; i++) tick(); }
const focus = [], picks = []; let fallbacks = 0;
const host = new El();
const stage = createStage3D(host, Array.from({ length: 8 }, (_, i) => ({ image: `art-${i}`, label: String(i) })), {
  onFocus: i => focus.push(i), onPick: i => picks.push(i), onFallback: () => fallbacks++,
});
assert.ok(stage); assert.equal(requests.length, 8);
const rr = renderers.at(-1), canvas = rr.domElement;
assert.equal(rr.outputColorSpace, THREE.SRGBColorSpace);
assert.equal(rr.toneMapping, THREE.NoToneMapping);
assert.equal(frames.size, 0, 'no GPU work before intersection');
observers.at(-1).cb([{ isIntersecting: true }]); tick();
assert.deepEqual(focus, [0], 'first frame focuses requested artwork, no intro sweep');
const textures = requests.map(r => {
  const t = new THREE.Texture({ width: 600, height: 800 }); t.disposals = 0;
  t.addEventListener('dispose', () => t.disposals++); r.done(t); return t;
});
await Promise.resolve(); ticks();
assert.ok(textures.every(t => t.colorSpace === THREE.SRGBColorSpace), 'source artwork explicitly tagged sRGB');
assert.ok(rr.scene.children.filter(x => x.visible).every(x => x.material.fragmentShader.includes('#include <colorspace_fragment>')), 'custom shaders encode to display color space');
assert.ok(rr.scene.children.filter(x => x.visible).every(x => !x.material.fragmentShader.includes('tuv + vec2')), 'no artificial chromatic splitting');
assert.equal(rr.scene.children.filter(x => x.visible).length, 8, 'no floor reflections');
// Curve remains real geometry in the vertex shader, with full center color.
assert.match(rr.scene.children[0].material.vertexShader, /sin\(a\) \* r/);
assert.match(rr.scene.children[0].material.fragmentShader, /mix\(0\.62, 1\.0, uFocus\)/);

stage.go(1); ticks(32);
assert.equal(stage.index(), 1); assert.equal(focus.at(-1), 1);
const center = rr.scene.children.find(x => x.visible && x.renderOrder === 100);
assert.ok(Math.abs(center.material.uniforms.uTheta.value) < 0.002, 'one-card snap settles within about half a second');
stage.goTo(6); stage.goTo(3); stage.goTo(7); ticks(40);
assert.equal(stage.index(), 7, 'rapid tab choices land on the final requested item');
assert.equal(focus.at(-1), 7);
stage.setPaused(true); tick();
const before = focus.length;
stage.goTo(4);
assert.equal(focus.length, before + 1, 'paused arrows update DOM focus synchronously');
assert.equal(focus.at(-1), 4); tick(); assert.equal(frames.size, 0, 'paused navigation renders one static frame, not a loop');
media.matches = true; media.emit('change'); stage.setPaused(false); stage.goTo(2);
assert.equal(focus.at(-1), 2, 'OS reduced motion still allows immediate manual navigation'); tick();
assert.equal(frames.size, 0);

// Project the actual shader-centered card to canvas coordinates for hit testing.
function point() {
  const mesh = rr.scene.children.find(x => x.visible && x.renderOrder === 100);
  const u = mesh.material.uniforms, radius = u.uRadius.value - u.uFocus.value * 0.14 - u.uLift.value * 0.12;
  const v = new THREE.Vector3(Math.sin(u.uTheta.value) * radius, -(1 - u.uIntro.value) * 0.16, -Math.cos(u.uTheta.value) * radius).project(rr.camera);
  return { clientX: (v.x + 1) * host.clientWidth / 2, clientY: (1 - v.y) * host.clientHeight / 2 };
}
let serial = 0;
function down(pointerType = 'touch') { const e = { ...point(), pointerType, pointerId: ++serial, button: 0, isPrimary: true }; canvas.emit('pointerdown', e); return e; }
const tap = down(); canvas.emit('pointerup', tap); assert.equal(picks.length, 1, 'real center tap picks in reduced motion');
const cancel = down(); canvas.emit('pointercancel', cancel); assert.equal(picks.length, 1, 'pointercancel is never a click');
const lost = down('mouse'); canvas.emit('lostpointercapture', lost); canvas.emit('pointerup', lost); assert.equal(picks.length, 1, 'lost capture is never a click');
const vert = down();
assert.equal(canvas.captured, null, 'touch pointerdown leaves scroll ownership with browser');
canvas.emit('pointermove', { ...vert, clientY: vert.clientY + 60, clientX: vert.clientX + 3 });
assert.equal(canvas.captured, null, 'vertical intention does not capture pointer');
canvas.emit('pointerup', { ...vert, clientY: vert.clientY + 60 }); assert.equal(picks.length, 1);
const horiz = down(); now += 20;
canvas.emit('pointermove', { ...horiz, clientX: horiz.clientX - 220, clientY: horiz.clientY + 2 });
assert.equal(canvas.captured, horiz.pointerId, 'horizontal intention captures after threshold');
canvas.emit('pointerup', { ...horiz, clientX: horiz.clientX - 220 }); tick();
assert.equal(picks.length, 1, 'horizontal drag never activates a poster');
let prevented = false;
canvas.emit('wheel', { deltaX: 3, deltaY: 90, preventDefault() { prevented = true; } });
assert.equal(prevented, false, 'vertical wheel remains native');

// Autoplay cannot advance offscreen or while CTA keyboard focus is inside the stage.
media.matches = false; media.emit('change'); stage.setPaused(false); ticks();
now += 20000;
const auto = [...intervals.values()][0], index = stage.index();
host.top = -800; auto(); assert.equal(stage.index(), index, 'offscreen autoplay held');
host.top = 0; document.activeElement = { insideStage: true }; auto(); assert.equal(stage.index(), index, 'focus-within autoplay held');
document.activeElement = null; auto();
assert.equal(stage.index(), (index + 1) % 8, 'positive control: eligible autoplay advances');
// Context loss is terminal and notifies the DOM owner only once.
canvas.emit('webglcontextlost');
assert.equal(fallbacks, 1); assert.equal(host.dataset.scene3d, 'fallback');
assert.equal(host.children.length, 0); assert.ok(rr.disposed); assert.ok(rr.contextLost);
assert.equal(intervals.size, 0); assert.equal(timers.size, 0); assert.equal(frames.size, 0);
assert.ok([...canvas.listeners.values()].every(x => x.size === 0), 'all input listeners removed');
await Promise.resolve(); await Promise.resolve();
assert.ok(textures.every(t => t.disposals === 1), 'all textures disposed exactly once');
stage.destroy(); stage.go(1); assert.equal(fallbacks, 1);
// A stalled texture request must not hold the already loaded texture's disposal hostage.
const lateHost = new El(), requestStart = requests.length;
const lateStage = createStage3D(lateHost, [{ image: 'loaded', label: 'loaded' }, { image: 'late', label: 'late' }]);
const loadedTex = new THREE.Texture(); loadedTex.disposals = 0;
loadedTex.addEventListener('dispose', () => loadedTex.disposals++);
requests[requestStart].done(loadedTex); await Promise.resolve();
lateStage.destroy(); await Promise.resolve();
assert.equal(loadedTex.disposals, 1, 'already loaded texture releases even if another request remains pending');
const lateTex = new THREE.Texture(); lateTex.disposals = 0;
lateTex.addEventListener('dispose', () => lateTex.disposals++);
requests[requestStart + 1].done(lateTex); await Promise.resolve(); await Promise.resolve();
assert.equal(lateTex.disposals, 1, 'late arriving texture is disposed after destroy');
console.log('PASS stage redesign: color/curve/snap, paused/reduced controls, touch direction, cancel/capture, native scroll, focus/offscreen autoplay, context fallback and disposal');
