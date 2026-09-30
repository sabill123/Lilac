/** Run: node tests/verify-player-ux.mjs
 * Executes the real TypeScript player and global shortcut handlers with a small
 * DOM/media double. No server, account writes, browser, or extra dependencies.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

class Element {
  constructor(parent = null) {
    this.parent = parent;
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = {};
    this.dataset = {};
    this.tagName = 'DIV';
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle: (name, force = !classes.has(name)) => {
        force ? classes.add(name) : classes.delete(name);
        return force;
      },
    };
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatchEvent(event) {
    event.target ||= this;
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    if (event.bubbles && !event.stopped) this.parent?.dispatchEvent(event);
    return !event.defaultPrevented;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  getBoundingClientRect() { return { left: 0, width: 100 }; }
  focus() { this.focused = true; }
  closest() { return null; }
}
function event(type, properties = {}) {
  return {
    type, bubbles: false, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
    ...properties,
  };
}
const document = new Element();
const elements = new Map();
const el = (selector) => {
  if (!elements.has(selector)) elements.set(selector, new Element(document));
  return elements.get(selector);
};
document.querySelector = el;
document.getElementById = (id) => el(`#${id}`);
document.body = el('body');
document.documentElement = el('html');
const audio = el('#audio');
audio.src = '';
audio.currentTime = 0;
audio.duration = NaN;
audio.paused = true;
audio.muted = false;
audio.playCalls = 0;
audio.play = () => {
  audio.playCalls++;
  if (audio.rejectPlay) return Promise.reject(new Error('Playback blocked'));
  audio.paused = false;
  audio.dispatchEvent(event('play'));
  return Promise.resolve();
};
audio.pause = () => { audio.paused = true; audio.dispatchEvent(event('pause')); };
let volume = 1;
Object.defineProperty(audio, 'volume', {
  get: () => volume,
  set: (value) => { volume = value; audio.dispatchEvent(event('volumechange')); },
});
const window = new Element();
window.matchMedia = () => ({ matches: false });
window.setTimeout = window.setInterval = () => 1;
const history = [];
let authRequired = 0;
document.addEventListener('lilac:auth-required', () => authRequired++);
const api = {
  me: null,
  esc: String,
  icon: () => '',
  needsLogin: () => !api.me,
  api: async (path, init) => {
    if (path === '/api/history') {
      history.push({ path, init });
      if (!api.me) document.dispatchEvent(event('lilac:auth-required'));
    }
    return [];
  },
};
const sandbox = {
  document, window, console,
  navigator: { maxTouchPoints: 0 }, matchMedia: window.matchMedia,
  location: { hash: '#/chart' },
  CustomEvent: class { constructor(type, options) { Object.assign(this, event(type), options); } },
  requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  clearInterval() {}, clearTimeout() {}, setTimeout: window.setTimeout,
};
function load(relative, imports = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, { ...sandbox, exports, require: (name) => {
    assert.ok(name in imports, `Unexpected import: ${name}`);
    return imports[name];
  } }, { filename: relative });
  return exports;
}
const interactions = load('../frontend/src/interactions.ts');
const player = load('../frontend/src/player.ts', {
  './api': api, './i18n': { t: (key) => key },
  './interactions': { applyMarquee() {}, bindDragReorder() {}, openContextMenu() {} },
  './colors': { applyTone() {} },
});
const globalCalls = [];
interactions.initKeyboard(Object.fromEntries(
  ['toggle', 'next', 'prev', 'seek', 'queue', 'lyrics', 'like'].map((name) => [name, (...args) => globalCalls.push([name, ...args])]),
));
const key = (target, name, properties = {}) => {
  const e = event('keydown', { bubbles: true, key: name, ...properties });
  target.dispatchEvent(e);
  return e;
};
const track = { title: 'Public preview', artist: 'Test artist', preview: 'https://example.test/preview.mp3' };
let failures = 0;
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
}
player.initPlayer();
await check('guest preview plays without history write or auth redirect', () => {
  player.playQueue([track]);
  assert.equal(audio.src, track.preview);
  assert.equal(audio.playCalls, 1);
  assert.equal(history.length, 0);
  assert.equal(authRequired, 0);
});
await check('authenticated preview still records the original history payload', () => {
  api.me = { id: 'test-user' };
  const before = history.length;
  player.playQueue([track]);
  assert.equal(history.length, before + 1);
  assert.equal(history.at(-1).init.method, 'POST');
  assert.deepEqual(JSON.parse(history.at(-1).init.body), { track });
  api.me = null;
  const after = history.length;
  player.playQueue([track]);
  assert.equal(history.length, after, 'logout must stop recording without reinitialization');
});
const progress = el('#progressBar'), vol = el('#volBar');
await check('existing divs receive slider semantics and labels', () => {
  for (const slider of [progress, vol]) {
    assert.equal(slider.getAttribute('role'), 'slider');
    assert.equal(slider.getAttribute('tabindex'), '0');
    assert.ok(slider.getAttribute('aria-label'));
    assert.equal(slider.getAttribute('aria-valuemin'), '0');
    assert.ok(Number.isFinite(Number(slider.getAttribute('aria-valuenow'))));
  }
  assert.equal(vol.getAttribute('aria-valuenow'), '70');
});
await check('progress metadata and paused media events update ARIA and fill', () => {
  audio.pause(); audio.duration = 42; audio.currentTime = 12;
  audio.dispatchEvent(event('loadedmetadata'));
  assert.equal(progress.getAttribute('aria-valuemax'), '42');
  audio.dispatchEvent(event('timeupdate'));
  assert.equal(progress.getAttribute('aria-valuenow'), '12');
  assert.equal(progress.getAttribute('aria-valuetext'), '0:12 / 0:42');
  assert.ok(parseFloat(el('#progressFill').style.width) > 28);
});
await check('progress arrows and endpoints are bounded and do not run global shortcuts', () => {
  audio.currentTime = 12; globalCalls.length = 0;
  for (const [name, expected] of [['ArrowRight', 17], ['ArrowUp', 22], ['ArrowLeft', 17], ['ArrowDown', 12], ['End', 42], ['ArrowRight', 42], ['Home', 0], ['ArrowLeft', 0]]) {
    const e = key(progress, name, { shiftKey: true });
    assert.equal(audio.currentTime, expected, name);
    assert.equal(Number(progress.getAttribute('aria-valuenow')), expected);
    assert.ok(e.defaultPrevented && e.stopped, `${name} must stay local`);
  }
  assert.deepEqual(globalCalls, []);
});
await check('volume arrows, endpoints, pointer and external changes stay in sync', () => {
  audio.volume = 0.7; globalCalls.length = 0;
  for (const [name, expected] of [['ArrowRight', 0.75], ['ArrowUp', 0.8], ['ArrowLeft', 0.75], ['ArrowDown', 0.7], ['End', 1], ['ArrowUp', 1], ['Home', 0], ['ArrowDown', 0]]) {
    const e = key(vol, name);
    assert.ok(Math.abs(audio.volume - expected) < 1e-9, name);
    assert.equal(Number(vol.getAttribute('aria-valuenow')), Math.round(expected * 100));
    assert.ok(e.defaultPrevented && e.stopped);
  }
  assert.deepEqual(globalCalls, []);
  vol.dispatchEvent(event('pointerdown', { clientX: 35 }));
  assert.equal(vol.getAttribute('aria-valuenow'), '35');
  audio.volume = 0.18;
  assert.equal(vol.getAttribute('aria-valuenow'), '18');
  assert.equal(el('#volFill').style.width, '18%');
});
await check('pointer scrubbing and unknown duration never produce non-finite values', () => {
  audio.duration = 42;
  progress.dispatchEvent(event('pointerdown', { clientX: 50 }));
  assert.equal(audio.currentTime, 21);
  assert.equal(progress.getAttribute('aria-valuenow'), '21');
  for (const duration of [NaN, Infinity, 0]) {
    audio.duration = duration;
    audio.dispatchEvent(event('durationchange'));
    key(progress, 'End');
    assert.ok(Number.isFinite(audio.currentTime));
    assert.ok(Number.isFinite(Number(progress.getAttribute('aria-valuemax'))));
  }
});
await check('unrelated keys and shortcuts outside sliders retain existing behavior', () => {
  globalCalls.length = 0;
  assert.equal(key(progress, 'Tab').defaultPrevented, false);
  assert.equal(key(vol, 'Escape').stopped, false);
  key(document.body, 'ArrowRight');
  key(vol, 'q');
  assert.deepEqual(globalCalls, [['seek', 5], ['queue']]);
});
await check('play label follows play, pause, end and rejected playback', async () => {
  assert.equal(el('#btnPlay').getAttribute('aria-label'), '재생');
  await audio.play();
  assert.equal(el('#btnPlay').getAttribute('aria-label'), '일시정지');
  audio.pause();
  assert.equal(el('#btnPlay').getAttribute('aria-label'), '재생');
  await audio.play(); audio.paused = true;
  audio.dispatchEvent(event('ended'));
  assert.equal(el('#btnPlay').getAttribute('aria-label'), '재생');
  audio.rejectPlay = true;
  player.playQueue([track]);
  await Promise.resolve();
  assert.equal(el('#btnPlay').getAttribute('aria-label'), '재생');
});
if (failures) process.exitCode = 1;
else console.log('Player UX regression checks passed (9 groups).');
