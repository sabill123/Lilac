#!/usr/bin/env node
/** Execute the actual main.ts router with controlled imports, DOM and transitions.
 * Run: node tests/verify-route-lifecycle.mjs. No browser, network or API writes. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const source = readFileSync(new URL('../frontend/src/main.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const functions = new Set(['route', 'runTransition', 'canTransition']);
const variables = new Set(['sitePromise', 'resolvedSiteModule', 'loadSite', 'routeGeneration', 'lastHash']);
const selected = ast.statements.filter(node =>
  (ts.isFunctionDeclaration(node) && functions.has(node.name?.text)) ||
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => variables.has(d.name.getText(ast)))));
for (const name of functions) assert.ok(selected.some(n => n.name?.text === name), `Missing actual ${name} function`);
// Replace only the import boundary, not route logic, guards or cleanup behavior.
const compiled = ts.transpileModule(selected.map(n => n.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
  transformers: { before: [context => root => {
    const visit = node => ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      ? ts.factory.createCallExpression(ts.factory.createIdentifier('controlledImport'), undefined, [])
      : ts.visitEachChild(node, visit, context);
    return ts.visitNode(root, visit);
  }] },
  reportDiagnostics: true,
});
assert.equal(compiled.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
const routeHelpers = ts.transpileModule(readFileSync(new URL('../frontend/src/site/routes.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
}).outputText;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function classList() {
  const values = new Set();
  return {
    contains: value => values.has(value),
    remove: (...items) => items.forEach(value => values.delete(value)),
    toggle(value, on = !values.has(value)) { if (on) values.add(value); else values.delete(value); return on; },
  };
}
function harness({ transitions = false, reducedMotion = false, initialHash = '#/', renderGate } = {}) {
  const imported = deferred();
  const events = [];
  const queued = [];
  const host = { innerHTML: '' };
  const state = { page: 'initial', aboutMounts: 0, aboutAlive: false, leaves: 0, imports: 0, scrolls: [] };
  const document = {
    body: { classList: classList(), style: {} },
    documentElement: { classList: classList() },
    getElementById: id => id === 'siteRoot' ? host : null,
  };
  if (transitions) document.startViewTransition = callback => {
    const finished = deferred();
    queued.push({ callback, finished });
    return { finished: finished.promise, ready: Promise.resolve(), updateCallbackDone: Promise.resolve() };
  };
  const helpers = {};
  vm.runInNewContext(routeHelpers, { exports: helpers, document });
  const site = {
    renderSitePage(seg) {
      state.aboutAlive = seg === 'about';
      if (state.aboutAlive) state.aboutMounts++;
      state.page = seg;
      host.innerHTML = seg;
      events.push(`site:${seg}`);
    },
    renderSiteNotFound(path) { state.aboutAlive = false; state.page = `404:${path}`; events.push(state.page); },
    leaveSite() { state.leaves++; state.aboutAlive = false; events.push('leave'); },
  };
  const location = { hash: initialHash, replace(hash) { this.hash = hash; } };
  const context = vm.createContext({
    document, location, URLSearchParams, console,
    window: { matchMedia: () => ({ matches: reducedMotion }) },
    ...helpers,
    controlledImport() { state.imports++; return imported.promise; },
    rememberScroll() { events.push('remember'); },
    disposeDiscovery() { events.push('disposeDiscovery'); },
    disposeScene() { events.push('disposeScene'); },
    applyMode() { document.body.classList.toggle('immersive-home', location.hash === '#/'); },
    markActive() {}, setTitle() {},
    async renderRoute(seg) {
      state.page = seg || 'home'; events.push(`app:${state.page}`);
      if (renderGate) await renderGate.promise;
    },
    restoreScroll(hash) { state.scrolls.push(hash); },
    onScroll() { events.push('onScroll'); },
  });
  vm.runInContext(compiled.outputText, context, { filename: 'actual-main-router.js' });
  return {
    state, events, document, location, queued,
    navigate(hash) { location.hash = hash; return context.route(); },
    resolveImport() { imported.resolve(site); },
    lastHash() { return vm.runInContext('lastHash', context); },
    async transition(index, finish = true) { await queued[index].callback(); if (finish) queued[index].finished.resolve(); await flush(); },
    finish(index) { queued[index].finished.resolve(); },
  };
}
function expectHome(h) {
  assert.equal(h.state.page, 'home');
  assert.equal(h.state.aboutAlive, false);
  assert.equal(h.document.body.classList.contains('site-mode'), false);
  assert.equal(h.document.documentElement.classList.contains('site-mode'), false);
  assert.equal(h.document.body.classList.contains('immersive-home'), true);
}
let passed = 0;
const failures = [];
async function check(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.stack}`); }
}

await check('about import resolving after home never changes mode or mounts obsolete 3D', async () => {
  const h = harness();
  const about = h.navigate('#/about');
  await h.navigate('#/');
  h.resolveImport();
  await about;
  expectHome(h);
  assert.equal(h.state.aboutMounts, 0);
  assert.equal(h.lastHash(), '#/');
});
await check('about to another site while importing mounts only the newest site', async () => {
  const h = harness();
  const about = h.navigate('#/about');
  const pricing = h.navigate('#/pricing');
  h.resolveImport();
  await Promise.all([about, pricing]);
  assert.equal(h.state.page, 'pricing');
  assert.equal(h.state.aboutMounts, 0);
  assert.deepEqual(h.events.filter(e => e.startsWith('site:')), ['site:pricing']);
  assert.equal(h.state.imports, 1, 'Keep lazy import caching');
});
await check('hash change invalidates pending import even before hashchange handler runs', async () => {
  const h = harness();
  const about = h.navigate('#/about');
  h.location.hash = '#/';
  h.resolveImport();
  await about;
  assert.equal(h.state.aboutMounts, 0);
  assert.equal(h.document.body.classList.contains('site-mode'), false);
  assert.equal(h.state.page, 'initial');
});
await check('same-hash reentry invalidates the first generation, not only different URLs', async () => {
  const h = harness();
  const first = h.navigate('#/about');
  await h.navigate('#/');
  const newest = h.navigate('#/about');
  h.resolveImport();
  await Promise.all([first, newest]);
  assert.equal(h.state.aboutMounts, 1);
  assert.equal(h.state.page, 'about');
});
await check('normal about to home synchronously cleans site before app render and allows remount', async () => {
  const h = harness();
  const about = h.navigate('#/about'); h.resolveImport(); await about;
  assert.equal(h.state.aboutAlive, true);
  const home = h.navigate('#/');
  assert.equal(h.state.leaves, 1, 'Cleanup must not be deferred into a later route');
  assert.equal(h.state.aboutAlive, false);
  assert.ok(h.events.indexOf('leave') < h.events.indexOf('app:home'));
  await home; expectHome(h);
  await h.navigate('#/about'); await flush();
  assert.equal(h.state.aboutAlive, true);
  assert.equal(h.state.aboutMounts, 2);
  assert.equal(h.state.leaves, 1);
});
await check('queued stale site transition cannot mount over a completed home transition', async () => {
  const h = harness({ transitions: true });
  const about = h.navigate('#/about'); h.resolveImport(); await flush();
  assert.equal(h.queued.length, 1);
  const home = h.navigate('#/');
  assert.equal(h.queued.length, 2);
  await h.transition(1); await home;
  await h.transition(0); await about;
  expectHome(h);
  assert.equal(h.state.aboutMounts, 0);
});
await check('queued stale app transition cannot overwrite a newer site', async () => {
  const h = harness({ transitions: true });
  const home = h.navigate('#/');
  const about = h.navigate('#/about'); h.resolveImport(); await flush();
  await h.transition(1); await about;
  await h.transition(0); await home;
  assert.equal(h.state.page, 'about');
  assert.equal(h.state.aboutAlive, true);
  assert.deepEqual(h.state.scrolls, [], 'Stale app completion must not restore current route scroll');
  assert.equal(h.events.includes('app:home'), false);
});
await check('hash-only invalidation also guards a queued site callback', async () => {
  const h = harness({ transitions: true });
  const about = h.navigate('#/about'); h.resolveImport(); await flush();
  h.location.hash = '#/pricing';
  await h.transition(0); await about;
  assert.equal(h.state.aboutMounts, 0);
  assert.equal(h.state.page, 'initial');
  assert.equal(h.lastHash(), '#/', 'Stale transition completion cannot claim the new hash');
});
await check('stale transition completion cannot update route bookkeeping after its callback ran', async () => {
  const h = harness({ transitions: true, initialHash: '#/chart' });
  const about = h.navigate('#/about'); h.resolveImport(); await flush();
  await h.transition(0, false);
  const home = h.navigate('#/');
  assert.equal(h.state.leaves, 1);
  h.finish(0); await about;
  assert.equal(h.lastHash(), '#/chart', 'Only the current route may commit lastHash');
  await h.transition(1); await home; expectHome(h);
});
await check('queued stale about transition cannot mount after a newer site transition', async () => {
  const h = harness({ transitions: true });
  const about = h.navigate('#/about'); h.resolveImport(); await flush();
  const pricing = h.navigate('#/pricing'); await flush();
  await h.transition(1); await pricing;
  await h.transition(0); await about;
  assert.equal(h.state.page, 'pricing');
  assert.equal(h.state.aboutMounts, 0);
  assert.deepEqual(h.events.filter(e => e.startsWith('site:')), ['site:pricing']);
});
await check('delayed app renderer completion does not scroll or commit after navigation', async () => {
  const renderGate = deferred();
  const h = harness({ renderGate, initialHash: '#/chart' });
  const home = h.navigate('#/');
  const about = h.navigate('#/about');
  // Keep the new route pending so a stale bookkeeping write cannot hide behind it.
  renderGate.resolve(); await home;
  assert.deepEqual(h.state.scrolls, []);
  assert.equal(h.events.includes('onScroll'), false);
  assert.equal(h.lastHash(), '#/chart');
  h.resolveImport(); await about;
  assert.equal(h.state.page, 'about');
  assert.equal(h.lastHash(), '#/about');
});
await check('valid site subroute still uses its 404 and reduced motion bypasses transitions', async () => {
  const h = harness({ transitions: true, reducedMotion: true });
  const page = h.navigate('#/terms/missing'); h.resolveImport(); await page;
  assert.equal(h.state.page, '404:#/terms/missing');
  assert.equal(h.queued.length, 0);
  assert.equal(h.state.aboutMounts, 0);
  await h.navigate('#/'); expectHome(h);
});
console.log(`Route lifecycle: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
