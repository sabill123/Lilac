#!/usr/bin/env node
/** Runs the real fx.ts through TypeScript + a deterministic DOM/clock. No network or production env.
 * FX_SOURCE=/absolute/old/fx.ts runs the same assertions against old code as a negative control.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
import postcss from '../frontend/node_modules/postcss/lib/postcss.mjs';
const source = fs.readFileSync(process.env.FX_SOURCE || new URL('../frontend/src/app/fx.ts', import.meta.url), 'utf8');
const kineticSource = fs.readFileSync(new URL('../frontend/src/app/kinetic-scene.ts', import.meta.url), 'utf8');
function harness(reduced = false) {
  const frames = new Map(), timers = new Map(), observers = [], nodes = [];
  let id = 0, now = 0;
  class Target {
    listeners = new Map();
    addEventListener(type, fn, options = {}) {
      if (options.signal?.aborted) return;
      const set = this.listeners.get(type) || new Set(); set.add(fn); this.listeners.set(type, set);
      options.signal?.addEventListener('abort', () => set.delete(fn), { once: true });
    }
    removeEventListener(t, fn) { this.listeners.get(t)?.delete(fn); }
    emit(t, data = {}) { for (const fn of [...this.listeners.get(t) || []]) fn({ type: t, preventDefault() {}, target: this, ...data }); }
    count() { return [...this.listeners.values()].reduce((n, s) => n + s.size, 0); }
  }
  class Element extends Target {
    constructor() { super(); nodes.push(this); }
    dataset = {}; style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
    classes = new Set(); classList = { add: (...v) => v.forEach(x => this.classes.add(x)), remove: (...v) => v.forEach(x => this.classes.delete(x)), contains: v => this.classes.has(v) };
    children = []; childNodes = []; parentNode = null; isConnected = true; textContent = ''; html = ''; selectors = new Map();
    offsetWidth = 80; offsetHeight = 30; offsetLeft = 0; offsetTop = 0; scrollWidth = 240; clientWidth = 800;
    append(el) { el.parentNode = this; this.children.push(el); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(e => e !== this); this.parentNode = null; this.isConnected = false; }
    set innerHTML(v) { this.html = v; this.selectors.set('.fx-nt-stack', [...v.matchAll(/data-v="(\d)"/g)].map(m => { const e = new Element(); e.dataset.v = m[1]; return e; })); }
    get innerHTML() { return this.html; }
    querySelectorAll(sel) { return this.selectors.get(sel) || []; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    matches(sel) { return sel.includes('.on') && this.classes.has('on'); }
    closest() { return null; } contains(el) { return this === el || this.children.includes(el); }
    setAttribute(k, v) { this[k] = v; }
    getBoundingClientRect() { return { left: 0, top: 1000, width: 100, height: 100 }; }
    hasPointerCapture() { return false; }
  }
  class Observer {
    constructor(fn) { this.fn = fn; observers.push(this); }
    active = false; targets = [];
    observe(el) { this.active = true; this.targets.push(el); }
    disconnect() { this.active = false; this.targets = []; }
    unobserve(el) { this.targets = this.targets.filter(x => x !== el); }
  }
  class MO extends Observer {} class RO extends Observer {} class IO extends Observer {}
  const document = new Target(); document.body = new Element(); document.hidden = false; document.querySelectorAll = () => []; document.querySelector = () => null;
  document.createElement = () => new Element();
  const window = new Target();
  const media = new Target(); media.matches = reduced;
  const kinetic = {};
  const context = { console, exports: {}, require: (name) => name === './kinetic-scene' ? kinetic : name.endsWith('.css') ? {} : ({ getLocale: () => 'ko' }), HTMLElement: Element, navigator: {},
    document, window, location: {}, innerHeight: 800, performance: { now: () => now }, AbortController,
    MutationObserver: MO, ResizeObserver: RO, IntersectionObserver: IO,
    getComputedStyle: () => ({ paddingLeft: '0', paddingRight: '0', borderRadius: '12px' }),
    matchMedia: q => q.includes('reduced-motion') ? media : { matches: true },
    requestAnimationFrame: fn => { frames.set(++id, fn); return id; }, cancelAnimationFrame: n => frames.delete(n),
    setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: n => timers.delete(n),
  };
  window.setTimeout = context.setTimeout; window.matchMedia = context.matchMedia; window.innerHeight = context.innerHeight;
  // fx.ts installs the real kinetic layer; it shares this deterministic DOM, observers and clock.
  const kineticCode = ts.transpileModule(kineticSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(kineticCode, { ...context, exports: kinetic });
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { fx: context.exports, Element, document, window, media, frames, timers, observers,
    mutations() { for (const o of [...observers]) if (o instanceof MO && o.active) o.fn([]); },
    frame(ms = 16) { now += ms; const batch = [...frames]; frames.clear(); for (const [, f] of batch) f(now); },
    active: () => observers.filter(o => o.active).length,
  };
}
let passed = 0; const failures = [];
function test(name, fn) { try { fn(); passed++; console.log('PASS', name); } catch (e) { failures.push(name); console.error('FAIL', name, e.message); } }
test('first ticker paint keeps real text, no wrapper, observer, timer or frame', () => {
  const h = harness(), el = new h.Element(); el.textContent = '128'; h.fx.ticker(el);
  assert.equal(el.innerHTML, ''); assert.equal(el.textContent, '128'); assert.equal(h.active(), 0); assert.equal(h.frames.size + h.timers.size, 0);
});
test('updated ticker animates real value and cancels on detached DOM', () => {
  const h = harness(), el = new h.Element(); el.textContent = '12'; h.fx.ticker(el); el.textContent = '13'; h.fx.ticker(el);
  assert.ok(h.frames.size); el.isConnected = false; h.mutations(); assert.equal(h.frames.size, 0); assert.equal(h.active(), 0);
});
test('ticker delay is cancelled on removal', () => {
  const h = harness(), el = new h.Element(); el.textContent = '12'; h.fx.ticker(el, { from0: true, delay: 100 });
  assert.ok(h.timers.size || h.active()); el.isConnected = false; h.mutations(); assert.equal(h.timers.size, 0); assert.equal(h.active(), 0);
});
test('ticker finishes within 250ms and releases its lifetime', () => {
  const h = harness(), el = new h.Element(); el.dataset.fxTick = '12'; el.textContent = '13'; h.fx.ticker(el); h.frame(250);
  assert.equal(h.frames.size, 0); assert.equal(h.active(), 0);
});
test('tilt removes pointer listeners and pending frame when detached', () => {
  const h = harness(), el = new h.Element(); h.fx.tilt(el); el.emit('pointermove', { clientX: 20, clientY: 30 }); assert.ok(h.frames.size);
  el.isConnected = false; h.mutations(); assert.equal(h.frames.size, 0); assert.equal(el.count(), 0); assert.equal(h.active(), 0);
});
test('installation is idempotent and teardown cancels queued work', () => {
  const h = harness(); const cleanup = h.fx.installFx(); assert.equal(h.fx.installFx(), cleanup); assert.equal(h.active(), 1);
  h.mutations(); assert.equal(h.frames.size, 1); assert.equal(typeof cleanup, 'function'); cleanup(); assert.equal(h.frames.size, 0); assert.equal(h.active(), 0); assert.equal(h.window.count(), 0);
});
test('glide disconnects both observers, cancels frame, and can rebind', () => {
  const h = harness(), box = new h.Element(), selected = new h.Element(); selected.classList.add('on'); box.append(selected);
  h.document.querySelectorAll = sel => sel === '.chips' ? [box] : [];
  const cleanup = h.fx.installFx(); assert.equal(box.dataset.fxGlide, 'invert'); assert.equal(box.children.length, 2);
  h.mutations(); assert.ok(h.frames.size); box.isConnected = false; h.document.querySelectorAll = () => []; h.mutations(); h.frame();
  assert.equal(box.dataset.fxGlide, undefined); assert.equal(box.children.length, 1); assert.equal(h.active(), 1);
  box.isConnected = true; h.document.querySelectorAll = sel => sel === '.chips' ? [box] : []; h.mutations(); h.frame(); assert.equal(box.children.length, 2); cleanup(); assert.equal(h.active(), 0);
});
test('generic installation leaves headings and below-fold sections intact', () => {
  const h = harness(), title = new h.Element(), sec = new h.Element(); title.textContent = 'Task title';
  h.document.querySelectorAll = sel => sel.includes('h1') ? [title] : sel.includes('#page >') ? [sec] : [];
  h.fx.installFx(); assert.equal(title.dataset.fxRv, undefined); assert.equal(sec.dataset.fxRise, undefined); assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0);
});
test('marquee retains controls, cancels frame and observers on abort', () => {
  const h = harness(), box = new h.Element(), row = new h.Element(); box.selectors.set('.fx-mq-row', [row]);
  const ctrl = new AbortController(); h.fx.bindMarquee(box, ctrl.signal); assert.ok(box.count()); assert.ok(h.frames.size); ctrl.abort();
  assert.equal(h.frames.size, 0); assert.equal(h.active(), 0); assert.equal(box.count(), 0); assert.equal(h.document.count(), 0); assert.equal(box.dataset.bound, undefined);
});
test('coverflow retains keyboard navigation and cancels all work on removal', () => {
  const h = harness(), root = new h.Element(), box = new h.Element(), cap = new h.Element(), stage = new h.Element();
  root.selectors.set('[data-fx-flow]', [box]); box.selectors.set('.fx-cf-cap', [cap]); box.selectors.set('.fx-cf-stage', [stage]); cap.selectors.set('b', [new h.Element()]); cap.selectors.set('span', [new h.Element()]);
  const cards = Array.from({ length: 5 }, () => new h.Element()); box.selectors.set('.fx-cf-card', cards);
  h.fx.bindCoverFlow(root, cards.map((_, i) => ({ id: String(i), title: String(i), sub: '', image: null })));
  assert.equal(cards[3]['aria-selected'], 'true'); box.emit('keydown', { key: 'Home' }); assert.ok(h.frames.size); box.isConnected = false; h.mutations();
  assert.equal(h.frames.size, 0); assert.equal(h.active(), 0); assert.equal(box.count() + stage.count() + h.media.count(), 0); assert.equal(box.dataset.bound, undefined);
});
test('reduced motion: real values, no tilt, no automatic marquee frames', () => {
  const h = harness(true), el = new h.Element(); el.textContent = '25'; h.fx.ticker(el, { from0: true }); h.fx.tilt(el);
  const box = new h.Element(); box.selectors.set('.fx-mq-row', [new h.Element()]); h.fx.bindMarquee(box);
  assert.equal(el.innerHTML, ''); assert.equal(el.count(), 0); assert.equal(h.frames.size, 0);
});
if (!process.env.FX_SOURCE) test('CSS is parseable, no global section entrance; intentional reduced-motion value fallback', () => {
  const css = fs.readFileSync(new URL('../frontend/src/app/fx.css', import.meta.url), 'utf8'); const ast = postcss.parse(css);
  ast.walkRules(r => { assert.ok(!r.selector.includes('#page.is-ready'), 'global page choreography returned'); });
  assert.ok(css.includes('.fx-ghost { color: inherit; }')); assert.ok(!css.includes('blur(8px)')); assert.ok(!css.includes('scale(1.32)'));
});
console.log(JSON.stringify({ passed, failed: failures.length, failures })); if (failures.length) process.exitCode = 1;
