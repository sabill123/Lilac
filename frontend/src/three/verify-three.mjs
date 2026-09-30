/** Run: node frontend/src/three/verify-three.mjs. Real scene geometry, fake GPU/DOM. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';
import * as THREE from '../../node_modules/three/build/three.module.js';
class Element {
  listeners = new Map(); style = {}; dataset = {}; isConnected = true; clientWidth = 500; clientHeight = 300;
  children = [];
  addEventListener(k, fn) { if (!this.listeners.has(k)) this.listeners.set(k, new Set()); this.listeners.get(k).add(fn); }
  removeEventListener(k, fn) { this.listeners.get(k)?.delete(fn); }
  dispatchEvent(e) { for (const fn of this.listeners.get(e.type) ?? []) fn(e); }
  setAttribute() {}
  appendChild(el) { this.children.push(el); el.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(el => el !== this); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 500, height: 300 }; }
  setPointerCapture() {} releasePointerCapture() {}
  getContext() { return null; }
}
const document = new Element(); document.hidden = false; document.createElement = () => new Element();
const window = new Element(); const media = new Element(); media.matches = false;
window.matchMedia = () => media; window.devicePixelRatio = 2;
let nextId = 0; const frames = new Map(), idle = new Map(), observers = [], resizers = [];
window.requestIdleCallback = fn => { const id = ++nextId; idle.set(id, fn); return id; };
window.cancelIdleCallback = id => idle.delete(id);
class Observer { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } }
class Resize { constructor(cb) { this.cb = cb; resizers.push(this); } observe() {} disconnect() { this.disconnected = true; } }
const env = {
  document, window, navigator: {}, IntersectionObserver: Observer, ResizeObserver: Resize,
  requestAnimationFrame: fn => { const id = ++nextId; frames.set(id, fn); return id; },
  cancelAnimationFrame: id => frames.delete(id), setTimeout, clearTimeout,
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } }, location: {}, console,
};
function load(file, require = () => { throw new Error('Unexpected import'); }) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {}; vm.runInNewContext(code, { ...env, exports, require }); return exports;
}
function step(now = 16) { const queued = [...frames.values()]; frames.clear(); queued.forEach(fn => fn(now)); }
function visible() { observers.at(-1).cb([{ isIntersecting: true }]); }
const { createSceneLifecycle } = load('./lifecycle.ts');
const host = new Element(); const draws = [];
const life = createSceneLifecycle(host, (...args) => draws.push(args), () => {});
assert.equal(frames.size, 0, 'no rendering before intersection');
visible(); step(); assert.equal(frames.size, 1);
life.setPaused(true); step(32); assert.equal(frames.size, 0); assert.equal(draws.at(-1)[2], false);
life.invalidate(); step(48); assert.equal(frames.size, 0, 'paused textures get one static render');
life.setPaused(false); step(64); assert.equal(frames.size, 1);
media.matches = true; media.dispatchEvent({ type: 'change' }); step(80); assert.equal(frames.size, 0);
life.setPaused(false); step(96); assert.equal(frames.size, 0, 'user resume cannot override OS preference');
media.matches = false; media.dispatchEvent({ type: 'change' }); step(112);
document.hidden = true; document.dispatchEvent({ type: 'visibilitychange' }); assert.equal(frames.size, 0);
document.hidden = false; document.dispatchEvent({ type: 'visibilitychange' }); step(10000);
assert.equal(draws.at(-1)[1], 0, 'resume does not jump elapsed time');
observers.at(-1).cb([{ isIntersecting: false }]); assert.equal(frames.size, 0);
life.destroy(); life.destroy(); life.invalidate(); assert.equal(frames.size, 0);
assert.equal(document.listeners.get('visibilitychange').size, 0);
assert.equal(media.listeners.get('change').size, 0);

const requests = [], renderers = [];
class Renderer {
  domElement = new Element(); capabilities = { getMaxAnisotropy: () => 4 }; renders = 0;
  constructor() { renderers.push(this); }
  setPixelRatio(value) { assert.ok(value <= 1.5); } setSize() {}
  render() { this.renders++; } dispose() { this.disposed = true; } forceContextLoss() { this.lost = true; }
}
class Loader { setCrossOrigin() {} load(url, success, _progress, error) { requests.push({ url, success, error }); } }
const three = { ...THREE, WebGLRenderer: Renderer, TextureLoader: Loader };
const imports = name => name === 'three' ? three : { createSceneLifecycle };
function texture() { const tex = new THREE.Texture(); tex.disposals = 0; tex.addEventListener('dispose', () => tex.disposals++); return tex; }
const { createChart3D } = load('./chart3d.ts', imports);
let picked = '';
const chartHost = new Element();
const chart = createChart3D(chartHost, [{ artwork: 'first', onPick: () => { picked = 'first'; } }]);
visible(); chart.setPaused(true); step();
chartHost.__swapTop({ artwork: 'second', onPick: () => { picked = 'second'; } });
const stale = texture(); requests[0].success(stale); assert.equal(stale.disposals, 1);
const latest = texture(); requests[1].success(latest); step();
assert.equal(chartHost.dataset.scene3d, 'ready'); assert.equal(frames.size, 0);
renderers.at(-1).domElement.dispatchEvent({ type: 'click' }); assert.equal(picked, 'second');
chartHost.__swapTop({ artwork: 'third' }); chart.destroy(); chart.destroy();
const late = texture(); requests[2].success(late); assert.equal(late.disposals, 1);
assert.equal(latest.disposals, 1); assert.equal(chartHost.__swapTop, undefined); assert.equal(chartHost.children.length, 0);

// Hero-only capture: chart and shared lifecycle assertions remain unchanged.
const originalRender = Renderer.prototype.render;
Renderer.prototype.render = function(scene, camera) { originalRender.call(this); this.scene = scene; this.camera = camera; };
const { createHero3D } = load('./hero3d.ts', imports);
const heroHost = new Element(); const before = requests.length;
const hero = createHero3D(heroHost, [{ title: 'A', artist: 'B', artwork: 'same', href: '#/artist/a' }]);
const heroRenderer = renderers.at(-1);
assert.equal(requests.length - before, 1, 'three sculptures share duplicate artwork requests');
assert.equal(heroHost.dataset.scene3d, 'loading');
assert.equal(heroRenderer.domElement.style.visibility, 'hidden', 'no blank artwork reveal before texture success');
visible(); hero.setPaused(true); step();
const heroTexture = texture(); requests.at(-1).success(heroTexture); step();
assert.equal(heroHost.dataset.scene3d, 'ready'); assert.equal(frames.size, 0);
const composition = heroRenderer.scene.getObjectByName('three-record-composition');
const sculptures = composition.children.filter(child => child.name.startsWith('record-sculpture-'));
assert.equal(sculptures.length, 3, 'exactly three coherent sculptures, no tiled wall or clones');
assert.equal(heroRenderer.scene.background, null, 'transparent canvas preserves DOM wordmark and stage');
assert.equal(sculptures.filter(group => group.children.some(child => child.isGroup)).length, 3, 'each sleeve has a record');
let extrudedRecords = 0, grooveSets = 0;
composition.traverse(object => {
  if (object.geometry?.type === 'ExtrudeGeometry') extrudedRecords++;
  if (object.isLineSegments) grooveSets++;
});
assert.equal(extrudedRecords, 3, 'vinyl is solid bevelled geometry');
assert.equal(grooveSets, 3, 'each vinyl has concentric grooves');
const cutSurfaces = sculptures.map(group => group.getObjectByName('physical-groove-surface'));
assert.ok(cutSurfaces.every(mesh => mesh?.material.isMeshPhysicalMaterial), 'grooves respond to physical lights, not just decorative lines');
const cutNormals = cutSurfaces[0].geometry.getAttribute('normal');
assert.ok(Array.from(cutNormals.array).some((value, i) => i % 3 !== 2 && Math.abs(value) > 0.01), 'physical grooves have actual sloping surface normals');
// Picking is a direct raycast and works without motion or an earlier hover event.
heroRenderer.scene.updateMatrixWorld(true); heroRenderer.camera.updateMatrixWorld(true);
const vinylMesh = sculptures[0].children.find(child => child.isGroup).children.find(child => child.isMesh);
const point = vinylMesh.localToWorld(new THREE.Vector3(0.65, 0, 0.07)).project(heroRenderer.camera);
const clickPoint = { clientX: (point.x + 1) * 250, clientY: (1 - point.y) * 150 };
heroRenderer.domElement.dispatchEvent({ type: 'click', ...clickPoint });
assert.equal(env.location.hash, '#/artist/a', 'paused click picks the actual item');
for (const unsafeHref of ['//external.example', 'https://external.example', 'javascript:alert(1)']) {
  vinylMesh.userData.item.href = unsafeHref; env.location.hash = 'safe';
  heroRenderer.domElement.dispatchEvent({ type: 'click', ...clickPoint });
  assert.equal(env.location.hash, 'safe', 'canvas cannot navigate to external or executable URLs');
}
vinylMesh.userData.item.href = '#/artist/a';
let hoverDetail;
heroHost.addEventListener('wall:hover', event => { hoverDetail = event.detail; });
heroRenderer.domElement.dispatchEvent({ type: 'pointermove', pointerType: 'mouse', ...clickPoint });
assert.equal(hoverDetail?.title, 'A', 'legacy hover contract remains available while paused');
heroRenderer.domElement.dispatchEvent({ type: 'pointerleave' });
assert.equal(hoverDetail, null); assert.equal(frames.size, 0, 'paused pointer picking schedules no animation');
env.location.hash = 'unchanged';
heroRenderer.domElement.dispatchEvent({ type: 'click', clientX: -1000, clientY: -1000 });
assert.equal(env.location.hash, 'unchanged', 'background click never follows stale hover');
hero.setPaused(false); step(12000); step(12016);
const beforeRotation = sculptures[0].children.find(child => child.isGroup).rotation.z;
step(12032);
assert.notEqual(sculptures[0].children.find(child => child.isGroup).rotation.z, beforeRotation, 'records autonomously rotate when enabled');
hero.setPaused(true); step(12048); assert.equal(frames.size, 0);
const resources = new Set();
composition.traverse(object => {
  if (object.geometry) resources.add(object.geometry);
  for (const mat of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) resources.add(mat);
});
const disposedResources = new Set();
resources.forEach(resource => resource.addEventListener('dispose', () => disposedResources.add(resource)));
hero.destroy(); hero.destroy();
assert.equal(disposedResources.size, resources.size, 'all shared hero geometries and materials are disposed');
assert.equal(heroTexture.disposals, 1); assert.equal(heroHost.children.length, 0);
assert.equal([...heroRenderer.domElement.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0), 0);

const boundedHost = new Element(); const boundedBefore = requests.length;
const bounded = createHero3D(boundedHost, Array.from({ length: 30 }, (_, i) => ({ title: String(i), artist: 'Artist', artwork: 'art-' + i, href: i === 0 ? '//external.example' : '#/artist/' + i })));
assert.equal(requests.length - boundedBefore, 3, 'at most three artwork downloads even for thirty inputs');
const boundedRequests = requests.slice(boundedBefore);
boundedRequests[0].error();
assert.equal(boundedHost.dataset.scene3d, 'loading', 'one failed request does not preempt pending artworks');
const boundedTexture = texture(); boundedRequests[1].success(boundedTexture);
assert.equal(boundedHost.dataset.scene3d, 'ready', 'partial texture success is usable');
boundedRequests[2].error();
assert.equal(boundedHost.dataset.scene3d, 'ready', 'partial failures do not remove successful artwork');
visible(); bounded.setPaused(true); step();
const boundedRenderer = renderers.at(-1);
const boundedGroups = boundedRenderer.scene.getObjectByName('three-record-composition').children.filter(child => child.name.startsWith('record-sculpture-'));
// Exercise both requested art-stage sizes with the actual projection, not hardcoded layout tests.
for (const [width, height] of [[1440, 660], [390, 540], [390, 338], [320, 310]]) {
  boundedHost.clientWidth = width; boundedHost.clientHeight = height;
  resizers.at(-1).cb(); step();
  boundedRenderer.scene.updateMatrixWorld(true); boundedRenderer.camera.updateMatrixWorld(true);
  for (const group of boundedGroups) {
    const center = group.getWorldPosition(new THREE.Vector3()).project(boundedRenderer.camera);
    assert.ok(Math.abs(center.x) < 0.92 && Math.abs(center.y) < 0.92, 'all three sculpture centers fit desktop/mobile stage');
  }
  if (width <= 600) {
    const front = boundedGroups[0].getWorldPosition(new THREE.Vector3()).project(boundedRenderer.camera);
    assert.ok(Math.abs(front.x) < 0.1, 'short mobile stages keep the foreground record centered, not desktop-right');
  }
  assert.equal(frames.size, 0, 'responsive static framing does not restart motion');
}
// Selection preserves source identity and changes geometry, not just a host flag.
assert.equal(typeof boundedHost.__selectHero, 'function');
const select = boundedHost.__selectHero;
const identities = boundedGroups.map(group => group.getObjectByName('artwork-sleeve').userData.item);
const rearRecordX = boundedGroups[2].getObjectByName('vinyl-record').position.x;
select(2);
assert.equal(boundedHost.dataset.heroSelected, '2');
assert.ok(boundedGroups[2].position.z > Math.max(boundedGroups[0].position.z, boundedGroups[1].position.z), 'paused selection applies foreground depth synchronously');
assert.ok(boundedGroups[2].getObjectByName('vinyl-record').position.x > rearRecordX + 0.3, 'selected vinyl extracts from its sleeve');
assert.equal(boundedGroups[0].getObjectByName('vinyl-record').position.x, rearRecordX, 'old foreground record tucks back into sleeve');
step(); assert.equal(frames.size, 0, 'paused selection renders once, without a continuous animation');
for (const index of [-1, 3, 1.5, NaN, Infinity]) select(index);
assert.equal(boundedHost.dataset.heroSelected, '2', 'invalid selection indices are ignored');
boundedGroups.forEach((group, i) => {
  assert.equal(group.getObjectByName('artwork-sleeve').userData.item, identities[i]);
  assert.equal(identities[i].title, String(i), 'first-three source order remains stable');
});
// Fresh navigation uses the newly selected record, without requiring hover.
boundedHost.clientWidth = 500; boundedHost.clientHeight = 300; resizers.at(-1).cb(); step();
boundedRenderer.scene.updateMatrixWorld(true); boundedRenderer.camera.updateMatrixWorld(true);
const selectedVinyl = boundedGroups[2].getObjectByName('vinyl-record').children.find(child => child.geometry?.type === 'ExtrudeGeometry');
const selectedPoint = selectedVinyl.localToWorld(new THREE.Vector3(0.65, 0, 0.07)).project(boundedRenderer.camera);
boundedRenderer.domElement.dispatchEvent({ type: 'click', clientX: (selectedPoint.x + 1) * 250, clientY: (1 - selectedPoint.y) * 150 });
assert.equal(env.location.hash, '#/artist/2', 'selected record navigates to its own original app route');
bounded.setPaused(false); step(20000);
const oldDepth = boundedGroups[1].position.z;
select(1); assert.equal(boundedGroups[1].position.z, oldDepth, 'enabled selection starts a damped transition rather than teleporting');
step(20016); assert.ok(boundedGroups[1].position.z > oldDepth, 'selected record begins advancing on the next moving frame');
for (let i = 1; i <= 80; i++) step(20016 + i * 50);
assert.ok(boundedGroups[1].position.z > Math.max(boundedGroups[0].position.z, boundedGroups[2].position.z), 'enabled transition converges to new foreground record');
select(0); step(24100);
media.matches = true; media.dispatchEvent({ type: 'change' }); step(24116);
assert.ok(boundedGroups[0].position.z > Math.max(boundedGroups[1].position.z, boundedGroups[2].position.z), 'OS reduced motion settles a transition interrupted midway');
assert.equal(frames.size, 0);
select(2);
assert.ok(boundedGroups[2].position.z > boundedGroups[0].position.z, 'reduced-motion selection is synchronous too');
step(24132); assert.equal(frames.size, 0);
boundedHost.dataset.heroLayout = 'center'; boundedHost.clientWidth = 1440; boundedHost.clientHeight = 660;
resizers.at(-1).cb(); step();
boundedRenderer.scene.updateMatrixWorld(true); boundedRenderer.camera.updateMatrixWorld(true);
assert.ok(Math.abs(boundedGroups[2].getWorldPosition(new THREE.Vector3()).project(boundedRenderer.camera).x) < 0.05, 'About center layout centers whichever record is selected');
bounded.destroy(); assert.equal(boundedTexture.disposals, 1);
assert.equal(boundedHost.__selectHero, undefined, 'selection hook removed on teardown');
assert.equal(boundedHost.dataset.heroSelected, undefined);
select(1); assert.equal(frames.size, 0, 'retained callback is inert after destruction');
media.matches = false;
// Entrance starts withdrawn and lifted, advances only during visible motion, then settles.
const entranceHost = new Element(); const entrance = createHero3D(entranceHost, [{ artwork: 'entrance' }]);
const entranceRenderer = renderers.at(-1); const entranceTexture = texture(); requests.at(-1).success(entranceTexture);
visible(); step(30000);
const entranceGroup = entranceRenderer.scene.getObjectByName('record-sculpture-0');
const entryY = entranceGroup.position.y;
step(30016); for (let i = 1; i <= 60; i++) step(30016 + i * 50);
assert.ok(entranceGroup.position.y > entryY + 1, 'entrance visibly lifts the main sculpture into its finished pose');
const entranceRecord = entranceGroup.getObjectByName('vinyl-record');
const beforeHoverX = entranceRecord.position.x;
entranceRenderer.scene.updateMatrixWorld(true); entranceRenderer.camera.updateMatrixWorld(true);
const hoverVinyl = entranceRecord.children.find(child => child.geometry?.type === 'ExtrudeGeometry');
const hoverPoint = hoverVinyl.localToWorld(new THREE.Vector3(0.65, 0, 0.07)).project(entranceRenderer.camera);
entranceRenderer.domElement.dispatchEvent({ type: 'pointermove', pointerType: 'mouse', clientX: (hoverPoint.x + 1) * 250, clientY: (1 - hoverPoint.y) * 150 });
for (let i = 1; i <= 30; i++) step(33016 + i * 50);
assert.ok(entranceRecord.position.x > beforeHoverX + 0.08, 'pointer hover has a real sleeve-extraction response');
entrance.destroy(); assert.equal(entranceTexture.disposals, 1);
assert.equal(frames.size, 0);
assert.equal(document.listeners.get('visibilitychange').size, 0);
assert.equal(media.listeners.get('change').size, 0);
const lateHeroHost = new Element(); const lateHero = createHero3D(lateHeroHost, [{ artwork: 'late-hero' }]);
const lateHeroRequest = requests.at(-1); lateHero.destroy();
const lateHeroTexture = texture(); lateHeroRequest.success(lateHeroTexture);
assert.equal(lateHeroTexture.disposals, 1, 'cancelled late hero textures are disposed');
assert.equal(lateHeroHost.dataset.scene3d, undefined);
const heroLostHost = new Element(); const heroLost = createHero3D(heroLostHost, [{ artwork: 'hero-loss' }]);
renderers.at(-1).domElement.dispatchEvent({ type: 'webglcontextlost', preventDefault() {} });
assert.equal(heroLostHost.dataset.scene3d, 'fallback'); assert.equal(heroLostHost.children.length, 0); heroLost.destroy();
const allFailedHost = new Element(); const allFailedBefore = requests.length;
createHero3D(allFailedHost, [{ artwork: 'fail-a' }, { artwork: 'fail-b' }, { artwork: 'fail-c' }]);
requests[allFailedBefore].error(); requests[allFailedBefore + 1].error();
assert.equal(allFailedHost.dataset.scene3d, 'loading');
requests[allFailedBefore + 2].error();
assert.equal(allFailedHost.dataset.scene3d, 'fallback'); assert.equal(allFailedHost.children.length, 0);
Renderer.prototype.render = originalRender;
const lostHost = new Element(); const lost = createChart3D(lostHost, [{ artwork: 'loss' }]);
renderers.at(-1).domElement.dispatchEvent({ type: 'webglcontextlost', preventDefault() {} });
assert.equal(lostHost.dataset.scene3d, 'fallback'); assert.equal(lostHost.children.length, 0); lost.destroy();

const failedHost = new Element(); createHero3D(failedHost, [{ artwork: 'broken' }]);
requests.at(-1).error(); assert.equal(failedHost.dataset.scene3d, 'fallback'); assert.equal(failedHost.children.length, 0);
const unavailable = load('./index.ts'); assert.equal(unavailable.can3D(), false, 'missing WebGL returns fallback');
let probes = 0, released = 0;
document.createElement = () => ({ getContext: () => { probes++; return { getExtension: () => ({ loseContext: () => released++ }) }; } });
const index = load('./index.ts');
assert.equal(index.can3D(), true); assert.equal(index.can3D(), true); assert.equal(probes, 1); assert.equal(released, 1);
env.navigator.connection = { saveData: true }; assert.equal(index.can3D(), false); env.navigator.connection.saveData = false;
const mountHost = new Element(); const pending = index.mountHero3D(mountHost, [{ artwork: 'test' }]);
assert.equal(idle.size, 0); visible(); assert.equal(idle.size, 1);
index.disposeScene(); await pending; assert.equal(idle.size, 0); assert.equal(mountHost.dataset.scene3d, undefined);
index.setSceneMotionPaused(true); assert.equal(index.isSceneMotionPaused(), true);
console.log('PASS: lifecycle pause/reduce/visibility/intersection, cleanup, texture races/deduplication, chart swaps, context loss, eligibility, hero entrance/selection/hover and cancelled lazy mounts');
