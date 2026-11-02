/** Real Stage3D/lifecycle + Three geometry and shaders, fake DOM/GPU only.
 * node tests/verify-stage-fluid.mjs — no network, backend or credentials. */
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
const resizeObservers = [];
class RO { constructor(cb) { this.cb = cb; resizeObservers.push(this); } observe() {} disconnect() {} }
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

// Project every actual geometry vertex, including the vertex shader's velocity bend.
function assertContained(rr, host, minCount = 2) {
  const meshes = rr.scene.children.filter(m => m.visible && m.userData.kind === 'card' && m.material.uniforms.uAlpha.value > 0.001);
  assert.ok(meshes.length >= minCount, 'fan must not solve containment by hiding every side poster');
  for (const mesh of meshes) {
    const p = mesh.geometry.getAttribute('position'), u = mesh.material.uniforms;
    for (let j = 0; j < p.count; j++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, j);
      const nx = v.x / (u.uCardW.value * 0.5);
      v.z -= u.uBend.value * nx * nx * u.uCardW.value * 0.5;
      v.applyMatrix4(mesh.matrixWorld).project(rr.camera);
      assert.ok(Math.abs(v.x) <= 0.966 && Math.abs(v.y) <= 0.966,
        'whole visible poster must fit with margin at ' + host.clientWidth + '×' + host.clientHeight + ': ' + v.toArray());
    }
  }
  return meshes;
}
for (const [width, height] of [[256,180], [280,260], [390,300], [580,326], [600,350], [1000,430], [1760,480]]) {
  const host = new El(); host.clientWidth = width; host.clientHeight = height;
  const stage = createStage3D(host, Array.from({length: 12}, (_, i) => ({image:'poster-' + i, label:String(i)})));
  const rr = renderers.at(-1), canvas = rr.domElement;
  observers.at(-1).cb([{isIntersecting:true}]); ticks(100);
  const resting = assertContained(rr, host, 3);
  assert.equal(resting.length, width >= 540 ? 5 : 3, 'container-sized 3/5 poster budget');
  const center = resting.find(m => m.renderOrder === 100);
  assert.ok(center, 'active central poster is visible');
  const top = new THREE.Vector3(0, center.geometry.parameters.height / 2, 0).applyMatrix4(center.matrixWorld).project(rr.camera);
  const bottom = new THREE.Vector3(0, -center.geometry.parameters.height / 2, 0).applyMatrix4(center.matrixWorld).project(rr.camera);
  assert.ok(Math.abs(top.y - bottom.y) * height / 2 >= height * 0.53, 'active poster retains editorial scale');
  stage.go(1);
  for (let i = 0; i < 80; i++) { tick(); assertContained(rr, host); }
  assert.equal(stage.index(), 1);
  // Interrupted navigation, ring wrap, maximum pointer tilt, velocity bend.
  for (const to of [11, 4, 0, 8]) {
    stage.goTo(to);
    for (let i = 0; i < 12; i++) { tick(); assertContained(rr, host); }
  }
  ticks(100);
  canvas.emit('pointermove', {pointerType:'mouse', pointerId:9, clientX:width, clientY:0});
  for (let i = 0; i < 80; i++) { tick(); assertContained(rr, host); }
  canvas.emit('pointerleave'); ticks(100);
  const renders = rr.renders; ticks(30);
  assert.equal(rr.renders, renders, 'settled stage submits no idle GPU renders');
  // Real pointer drag, cancellation and a responsive resize during the spring.
  const pointer = {pointerType:'touch', pointerId:77, button:0, isPrimary:true, clientX:width / 2, clientY:height / 2};
  canvas.emit('pointerdown', pointer);
  for (let i = 1; i <= 12; i++) {
    now += 16; canvas.emit('pointermove', {...pointer, clientX:width / 2 - i * 15});
    tick(); assertContained(rr, host);
  }
  canvas.emit('pointerup', {...pointer, clientX:width / 2 - 180});
  for (let i = 0; i < 60; i++) { tick(); assertContained(rr, host); }
  stage.go(2); tick();
  host.clientWidth = width >= 540 ? 280 : 600; host.clientHeight = 320;
  resizeObservers.at(-1).cb();
  for (let i = 0; i < 60; i++) { tick(); assertContained(rr, host); }
  host.clientWidth = width; host.clientHeight = height; resizeObservers.at(-1).cb(); ticks(60);
  stage.setPaused(true); stage.goTo(5); tick(); assertContained(rr, host, 3);
  assert.equal(frames.size, 0, 'pause does not animate');
  media.matches = true; media.emit('change'); stage.setPaused(false); stage.goTo(0); tick(); assertContained(rr, host, 3);
  media.matches = false; media.emit('change');
  stage.destroy(); assert.equal(host.children.length, 0);
}
assert.equal(intervals.size, 0); assert.equal(frames.size, 0);
console.log('PASS stage fluid: actual shader-deformed geometry contained at 280×260 / 390×300 / 600×350 / 1000×430 / 1760×480; 3/5 poster budget, central scale, transitions/wrap/interruption/tilt, idle GPU, pause/reduced motion and teardown');

// Reuse the existing real-consumer safety cases without changing the dirty original test.
requests.length = 0; observers.length = 0; renderers.length = 0;
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
const visible = rr.scene.children.filter(x => x.visible);
const cardMeshes = visible.filter(x => x.userData.kind === 'card');
assert.ok(visible.every(x => x.material.fragmentShader.includes('#include <colorspace_fragment>')), 'custom shaders encode to display color space');
assert.ok(cardMeshes.every(x => !x.material.fragmentShader.includes('tuv + vec2')), 'no artificial chromatic splitting');
assert.equal(cardMeshes.length, 5, 'only the contained five-poster fan is rendered');
// Velocity bend is real geometry in the vertex shader; side cards recede into the panel colour instead of being darkened.
assert.match(cardMeshes[0].material.vertexShader, /uBend/);
assert.match(cardMeshes[0].material.fragmentShader, /mix\(uVeil, col, mix\(0\.8, 1\.0, uFocus\)\)/);
assert.ok(!/col \*= mix/.test(cardMeshes[0].material.fragmentShader), 'artwork colour is not multiplied darker');

stage.go(1); ticks(32);
assert.equal(stage.index(), 1); assert.equal(focus.at(-1), 1);
const center = rr.scene.children.find(x => x.visible && x.userData.kind === 'card' && x.renderOrder === 100);
assert.ok(Math.abs(center.position.x) < 0.002, 'one-card snap settles within about half a second');
assert.equal(center.material.uniforms.uBend.value, 0, 'cards are flat again once settled');
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
  const mesh = rr.scene.children.find(x => x.visible && x.userData.kind === 'card' && x.renderOrder === 100);
  mesh.updateMatrixWorld();
  const v = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld).project(rr.camera);
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
console.log('PASS stage redesign (Lilac Ribbon): color/veil/bend/snap, paused/reduced controls, touch direction, cancel/capture, native scroll, focus/offscreen autoplay, context fallback and disposal');
