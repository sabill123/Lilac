/* Executes actual router functions with minimal DOM doubles. No persisted writes. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
const src = fs.readFileSync('frontend/src/app/main.ts', 'utf8');
const extract = (start, end) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));
const soft = extract('let softGen = 0;', '\nasync function renderStatus');
const seg = extract('function seg()', '\nfunction markNav');
let done = 0;
async function test(name, fn) { await fn(); done++; console.log(`PASS ${name}`); }
function environment(render) {
  const root = { children: [], replaceChildren(...els) { this.children = els; } };
  const context = { gen: 1, seg: () => ['concerts', 'tickets', ''], $: () => root,
    document: { createElement() { return { children: [], querySelector() { return this.children[0] || null; } }; } },
    captureLocalView: () => () => {}, renderInto: render, userBusy: () => false, window: { scrollY: 340, scrollTo({ top }) { this.scrollY = top; } }, markPlaying() {}, refreshHome: async () => {}, console };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(soft, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { c: context, root };
}
await test('SSE refresh keeps the rendered root and event closure alive', async () => {
  let held, click, alive;
  const { c, root } = environment(async (box, isAlive) => { held = box; alive = isAlive; box.children.push({ text: 'filter' }); click = () => { box.querySelector().text = 'changed'; }; });
  assert.equal(await c.softRoute(), true); assert.equal(root.children[0], held); click();
  assert.equal(root.children[0].children[0].text, 'changed'); assert.equal(alive(), true); assert.equal(c.gen, 2); assert.equal(c.window.scrollY, 340);
});
await test('route navigation invalidates the staged response', async () => {
  let release; const { c, root } = environment(() => new Promise((r) => { release = r; }));
  const pending = c.softRoute(); c.gen++; release(); assert.equal(await pending, false); assert.equal(root.children.length, 0);
});
await test('newer refresh wins even if older response completes last', async () => {
  const releases = []; const { c, root } = environment((box) => new Promise((r) => { box.children.push({ text: String(releases.length) }); releases.push(r); }));
  const old = c.softRoute(); const recent = c.softRoute(); releases[1](); assert.equal(await recent, true); releases[0](); assert.equal(await old, false); assert.equal(root.children[0].children[0].text, '1');
});
await test('busy input discards staged view and invalidates delayed callbacks', async () => {
  let alive; const { c, root } = environment(async (_, a) => { alive = a; }); c.userBusy = () => true;
  assert.equal(await c.softRoute(), false); assert.equal(alive(), false); assert.equal(root.children.length, 0);
});
await test('malformed hash percent encoding does not crash router', () => {
  const c = { location: { hash: '#/artist/%E0%A4%A' } }; vm.createContext(c);
  vm.runInContext(ts.transpileModule(seg, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, c);
  assert.equal(c.seg()[1], '%E0%A4%A');
});
await test('3D is opt-in, home content has no reveal visibility dependency', () => {
  const h = fs.readFileSync('frontend/src/app/pages/home.ts', 'utf8');
  assert.ok(h.indexOf('mountStage3D(host') > h.indexOf("mode.addEventListener('click'"));
  assert.ok(!h.includes("classList.add('rv')"));
  assert.ok(h.includes('!signal.aborted'));
});
await test('local search and course choices survive refresh without replaying mutations', () => {
  const capture = extract('function captureLocalView(', '\nlet softGen = 0;');
  const c = { Event: class { constructor(type) { this.type = type; } } }; vm.createContext(c);
  vm.runInContext(ts.transpileModule(capture, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, c);
  const old = { querySelector(q) { if(q === '#fcQuery') return { value: 'Vaundy' }; if(q.startsWith('[data-f]')) return { getAttribute: () => 'ovs' }; return null; } };
  const input = { value: '', dispatchEvent(e) { this.event = e.type; } };
  let clicks = 0; const next = { querySelector: () => input, querySelectorAll: () => [{ getAttribute: () => 'ovs', click: () => clicks++ }] };
  c.captureLocalView(old)(next); assert.equal(input.value,'Vaundy'); assert.equal(input.event,'input'); assert.equal(clicks,1);
});
console.log(`\n${done} passed, 0 failed`);
