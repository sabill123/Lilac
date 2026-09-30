#!/usr/bin/env node
/** Run: node tests/verify-public-preview-ui.mjs
 * Executes both real TS modules with the frontend's declared TypeScript dependency.
 * No new dependencies, browser, network, server, or personal storage/file access.
 * Storage, cookies, DOM, timers and fetch below are strictly in-memory fixtures.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const compiled = new Map(['public-preview', 'api'].map(name => {
  const file = new URL(`../frontend/src/${name}.ts`, import.meta.url);
  const result = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
    reportDiagnostics: true,
  });
  assert.equal(result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0,
    `${name} must transpile`);
  return [name, { js: result.outputText, filename: file.pathname }];
}));
const privateRoutes = ['login', 'signup', 'account', 'orders', 'library', 'playlist'];
const publicRoutes = ['', 'chart', 'search', 'store', 'schedule', 'artist', 'about', 'pricing', 'faq', 'contact', 'work'];
const localDisclosure = 'LOCAL FIXTURE: account features use the local backend.';
const fixtureToken = 'synthetic-test-token';
const malicious = '<img src=x onerror="globalThis.injected=true"><script>injected=true</script>';

function fixture({ footerPresent = true } = {}) {
  const attributes = new Set(), requests = [], storageOps = [], cookieOps = [], events = [], timers = [];
  let text = localDisclosure, textWrites = 0, htmlWrites = 0;
  const footer = {
    get textContent() { return text; },
    set textContent(value) { textWrites++; text = String(value); },
    set innerHTML(value) { htmlWrites++; throw new Error('Disclosure must use textContent, not an HTML sink'); },
    insertAdjacentHTML() { htmlWrites++; throw new Error('Disclosure must not insert HTML'); },
  };
  const storage = new Map([['lilac.token', fixtureToken]]);
  const document = {
    body: {
      toggleAttribute(name, force = !attributes.has(name)) {
        force ? attributes.add(name) : attributes.delete(name);
        return force;
      },
    },
    querySelector(selector) {
      assert.equal(selector, '.footer-disclosure', 'Unexpected DOM access');
      return footerPresent ? footer : null;
    },
    dispatchEvent(event) { events.push(event); return true; },
    get cookie() { cookieOps.push(['read']); return 'lilac_token=synthetic-cookie'; },
    set cookie(value) { cookieOps.push(['write', value]); },
  };
  let response = { ok: true, status: 200, json: async () => ({ fixture: 'ok' }) };
  const sandbox = {
    document, Headers,
    localStorage: {
      getItem(key) { storageOps.push(['read', key]); return storage.get(key) ?? null; },
      setItem(key, value) { storageOps.push(['write', key]); storage.set(key, value); },
      removeItem(key) { storageOps.push(['remove', key]); storage.delete(key); },
    },
    window: { setTimeout(callback) { timers.push(callback); return timers.length; } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    fetch: async (path, init) => {
      requests.push({ path, init });
      if (response instanceof Error) throw response;
      return response;
    },
  };
  function load(name, imports = {}) {
    const exports = {}, source = compiled.get(name);
    vm.runInNewContext(source.js, { ...sandbox, exports, require(importName) {
      assert.ok(Object.hasOwn(imports, importName), `Unexpected module import: ${importName}`);
      return imports[importName];
    } }, { filename: source.filename, timeout: 1000 });
    return exports;
  }
  const preview = load('public-preview');
  // Use the actual shared exports object, not a snapshot of publicPreview. This
  // exercises TS CommonJS live binding behavior when configuration changes.
  const client = load('api', { './public-preview': preview });
  return { preview, client, attributes, requests, storageOps, cookieOps, events, footer,
    get textWrites() { return textWrites; }, get htmlWrites() { return htmlWrites; },
    respond(next) { response = next; },
    async flushTimers() { for (const callback of timers.splice(0)) await callback(); },
  };
}
let passed = 0;
const failures = [];
async function check(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.stack}`); }
}
function noStorage(h) {
  assert.equal(h.storageOps.length, 0, 'Preview must not consult or mutate stored session state');
  assert.equal(h.cookieOps.length, 0, 'Preview must not consult or mutate cookies');
}
function protectedPreviewCredentials(request) {
  const headers = new Headers(request.init.headers);
  assert.equal(headers.has('authorization'), false, 'Preview must not forward an Authorization header');
  assert.equal(headers.has('cookie'), false, 'Preview must not forward an explicit Cookie header');
  // Vercel Authentication uses browser-managed same-origin cookies. Keep those
  // available to the gateway without reading them or forwarding app credentials.
  assert.equal(request.init.credentials, 'same-origin',
    'Preview must preserve gateway cookies and override caller credential policy');
}

// Execute the real bootstrap health try/catch and fatal-screen retry handler.
// Other boot initialization is outside this fixture's credential boundary.
const mainSource = readFileSync(new URL('../frontend/src/main.ts', import.meta.url), 'utf8');
const mainAst = ts.createSourceFile('main.ts', mainSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const bootNode = mainAst.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'boot');
const healthTry = bootNode.body.statements.find(ts.isTryStatement);
const backendErrorNode = mainAst.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'showBackendError');
assert.ok(healthTry && backendErrorNode, 'Actual bootstrap and retry code must exist');
function bootstrapFixture(h) {
  const handlers = new Map(), elements = new Map();
  let reloads = 0;
  const context = vm.createContext({
    ...h.preview,
    api: (...args) => h.client.api(...args),
    document: { body: { classList: { remove() {} } } },
    location: { reload() { reloads++; } },
    toast() {},
    $(selector) {
      if (!elements.has(selector)) elements.set(selector, {
        textContent: '', disabled: false, innerHTML: '',
        addEventListener(type, callback) { handlers.set(`${selector}:${type}`, callback); },
      });
      return elements.get(selector);
    },
  });
  const code = ts.transpileModule(`async function initialHealth() { ${healthTry.getText(mainAst)} }\n${backendErrorNode.getText(mainAst)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInContext(code, context, { filename: 'actual-main-bootstrap-health.js', timeout: 1000 });
  return {
    initial: () => context.initialHealth(),
    retry: () => handlers.get('#fatalRetry:click')(),
    get retryButton() { return elements.get('#fatalRetry'); },
    get reloads() { return reloads; },
  };
}
function neutralHealthRequest(h) {
  assert.equal(h.requests.length, 1, 'Health must issue exactly one request');
  const request = h.requests[0];
  assert.equal(request.path, '/api/health');
  assert.equal(request.init.method ?? 'GET', 'GET');
  assert.equal(request.init.body, undefined);
  assert.deepEqual(Array.from(new Headers(request.init.headers).entries()), [['accept', 'application/json']],
    'Health must send only its fixed Accept header, never app credentials or caller headers');
  protectedPreviewCredentials(request);
  noStorage(h);
  assert.equal(h.events.length, 0, 'Health must never emit auth or identity events');
}

await check('main imports the neutral probe and never calls generic API for health', () => {
  const previewImport = mainAst.statements.find(n => ts.isImportDeclaration(n) && n.moduleSpecifier.text === './public-preview');
  assert.ok(previewImport.importClause.namedBindings.elements.some(n => n.name.text === 'probeDeploymentHealth'));
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(mainAst);
  assert.equal(calls.filter(n => n.expression.getText(mainAst) === 'probeDeploymentHealth').length, 2);
  assert.equal(calls.filter(n => n.expression.getText(mainAst) === 'api' && n.arguments[0]?.text === '/api/health').length, 0);
});
await check('pre-capability health uses only neutral headers without reading saved app credentials', async () => {
  const h = fixture();
  const payload = { ok: true, readOnly: true };
  h.respond({ ok: true, status: 200, json: async () => payload });
  assert.equal(h.preview.publicPreview, false);
  assert.equal(await h.preview.probeDeploymentHealth(), payload);
  assert.equal(h.preview.publicPreview, false, 'Probe must not configure capabilities itself');
  neutralHealthRequest(h);
});
await check('actual initial health accepts local responses and configures only literal readOnly:true', async () => {
  for (const payload of [{ ok: true, service: 'lilac-backend', version: '0.3' }, null, {},
    { readOnly: false }, { readOnly: 'true' }, { readOnly: 1 }, { publicPreview: true }, { readOnly: true }]) {
    const h = fixture(), boot = bootstrapFixture(h);
    h.respond({ ok: true, status: 200, json: async () => payload });
    await boot.initial();
    assert.equal(h.preview.publicPreview, payload?.readOnly === true);
    assert.equal(h.attributes.has('data-public-preview'), payload?.readOnly === true);
    assert.equal(boot.retryButton, undefined, 'Valid local health must not show backend error');
    neutralHealthRequest(h);
  }
});
await check('failed pre-capability probes preserve the existing account, token and cookies', async () => {
  const failures = [
    { ok: false, status: 401, json: async () => ({ error: 'Synthetic gateway denial' }) },
    { ok: false, status: 401, json: async () => { throw new SyntaxError('Synthetic HTML gateway'); } },
    { ok: false, status: 503, json: async () => ({}) },
    new TypeError('Synthetic network failure'),
    { ok: true, status: 200, json: async () => { throw new SyntaxError('Synthetic invalid JSON'); } },
  ];
  for (const response of failures) {
    const h = fixture(), account = { id: 'synthetic-account' };
    h.respond({ ok: true, status: 200, json: async () => ({ user: account }) });
    await h.client.refreshMe();
    h.requests.length = 0; h.storageOps.length = 0;
    h.respond(response);
    await assert.rejects(h.preview.probeDeploymentHealth());
    assert.equal(h.preview.publicPreview, false);
    assert.equal(h.client.me, account, 'Failed health must not replace the loaded account');
    neutralHealthRequest(h);
    h.respond({ ok: true, status: 200, json: async () => ({}) });
    await h.client.api('/api/charts');
    assert.equal(new Headers(h.requests.at(-1).init.headers).get('authorization'), `Bearer ${fixtureToken}`,
      'Saved local token must still be available after a failed probe');
  }
});
await check('actual initial failure and retry remain neutral until successful reload', async () => {
  const h = fixture(), boot = bootstrapFixture(h);
  h.respond({ ok: false, status: 401, json: async () => ({}) });
  await boot.initial();
  assert.ok(boot.retryButton, 'Initial health failure must show retry UI');
  neutralHealthRequest(h);
  h.requests.length = 0;
  await boot.retry();
  assert.equal(boot.reloads, 0);
  assert.equal(boot.retryButton.disabled, false);
  assert.equal(boot.retryButton.textContent, '다시 시도');
  neutralHealthRequest(h);
  h.requests.length = 0;
  h.respond({ ok: true, status: 200, json: async () => ({ readOnly: true }) });
  await boot.retry();
  assert.equal(boot.reloads, 1, 'Successful retry keeps existing reload behavior');
  neutralHealthRequest(h);
});

await check('preview is off by default and only literal readOnly:true enables it', () => {
  const h = fixture();
  assert.equal(h.preview.publicPreview, false);
  for (const capability of [null, undefined, {}, { readOnly: false }, { readOnly: 'true' },
    { readOnly: 1 }, { readOnly: malicious }, { publicPreview: true }]) {
    h.preview.configurePublicPreview({ readOnly: true });
    h.preview.configurePublicPreview(capability);
    assert.equal(h.preview.publicPreview, false);
    assert.equal(h.attributes.has('data-public-preview'), false);
  }
  h.preview.configurePublicPreview({ readOnly: true });
  assert.equal(h.preview.publicPreview, true);
  assert.equal(h.attributes.has('data-public-preview'), true);
  h.preview.configurePublicPreview({ readOnly: true });
  assert.equal(h.attributes.has('data-public-preview'), true, 'Repeated configuration must not toggle preview off');
  noStorage(h);
});
await check('local configuration leaves existing disclosure untouched', () => {
  const h = fixture();
  for (const capability of [null, {}, { readOnly: false }]) h.preview.configurePublicPreview(capability);
  assert.equal(h.footer.textContent, localDisclosure);
  assert.equal(h.textWrites, 0);
  assert.equal(h.htmlWrites, 0);
});
await check('preview disclosure is truthful, snapshot-based and written only as plain text', () => {
  const h = fixture();
  h.preview.configurePublicPreview({ readOnly: true, notice: malicious, disclosure: malicious, updated: malicious });
  const text = h.footer.textContent;
  assert.match(text, /읽기 전용 미리보기/);
  assert.match(text, /검색.*차트.*카탈로그.*30초.*미리듣기/);
  assert.match(text, /계정 저장.*주문.*결제.*문의 접수.*자동 수집.*연결되어 있지 않습니다/);
  assert.match(text, /차트.*수집 시점.*스냅샷/);
  assert.doesNotMatch(text, /실시간|<[^>]+>|onerror|injected/);
  assert.ok(h.textWrites > 0);
  assert.equal(h.htmlWrites, 0);
  noStorage(h);
});
await check('configuration tolerates a missing disclosure element', () => {
  const h = fixture({ footerPresent: false });
  for (const readOnly of [true, true, false]) {
    h.preview.configurePublicPreview({ readOnly });
    assert.equal(h.preview.publicPreview, readOnly);
  }
  noStorage(h);
});
await check('all six private route segments are blocked only in preview', () => {
  const h = fixture();
  for (const readOnly of [false, true, false]) {
    h.preview.configurePublicPreview({ readOnly });
    for (const route of privateRoutes) assert.equal(h.preview.previewAccountPage(route), readOnly, route);
    for (const route of [...publicRoutes, 'login-help', 'playlists', malicious]) {
      assert.equal(h.preview.previewAccountPage(route), false, route);
    }
  }
});
await check('account notice provides truthful limits and a safe home link, never interpolated HTML', () => {
  const h = fixture();
  const html = h.preview.previewNoticeHtml(malicious);
  assert.equal(html, h.preview.previewNoticeHtml());
  assert.match(html, /읽기 전용 미리보기/);
  assert.match(html, /계정.*보관함 저장.*주문.*연결되어 있지 않습니다/);
  assert.match(html, /href=["']#\/["']/);
  assert.doesNotMatch(html, /<script|<iframe|<form|<input|<img|\bon\w+\s*=|javascript:|injected/i);
});
await check('request guard permits GET/HEAD and only the exact catalog batch POST exception', () => {
  const h = fixture();
  for (const readOnly of [false, true, false]) {
    h.preview.configurePublicPreview({ readOnly });
    for (const path of ['/api/orders', '/api/catalog/batch', '/api/catalog/batch?country=jp',
      '/api/catalog/batch/extra', '/api/catalog/batch/', '/api/catalog/batcher']) {
      for (const method of [undefined, 'GET', 'get', 'HEAD', 'head', 'POST', 'post', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        const verb = (method ?? 'GET').toUpperCase();
        const read = ['GET', 'HEAD'].includes(verb) || (verb === 'POST' && ['/api/catalog/batch', '/api/catalog/batch?country=jp'].includes(path));
        assert.equal(h.preview.previewBlocksRequest(path, method), readOnly && !read, `${method} ${path}`);
      }
    }
  }
});
await check('API writes reject with a typed preview error before fetch, credentials or auth events', async () => {
  const h = fixture();
  h.preview.configurePublicPreview({ readOnly: true });
  const paths = ['/api/login', '/api/signup', '/api/account', '/api/orders', '/api/likes', '/api/playlists',
    '/api/history', '/api/contact', '/api/sync', '/api/unknown', '/api/catalog/batch/extra'];
  for (const path of paths) for (const method of ['POST', 'post', 'PUT', 'PATCH', 'DELETE']) {
    await assert.rejects(h.client.api(path, { method, credentials: 'include',
      headers: { Authorization: 'synthetic-explicit' }, body: '{"fixture":true}' }), error => {
      assert.ok(error instanceof h.client.ApiError);
      assert.equal(error.status, 403);
      assert.equal(error.code, 'READ_ONLY_PREVIEW');
      assert.equal(error.message, h.preview.PREVIEW_NOTICE);
      return true;
    });
  }
  assert.equal(h.requests.length, 0);
  assert.equal(h.events.length, 0);
  noStorage(h);
});
await check('preview GET responses and custom non-auth headers are unchanged without reading saved tokens', async () => {
  const h = fixture();
  h.preview.configurePublicPreview({ readOnly: true });
  const payload = { tracks: [{ id: 123, title: 'Fixture song' }] };
  h.respond({ ok: true, status: 200, json: async () => payload });
  for (const init of [undefined, { method: 'GET', headers: { 'x-fixture': 'keep' } }]) {
    assert.equal(await h.client.api('/api/charts?country=jp', init), payload);
    const request = h.requests.at(-1);
    assert.equal(request.path, '/api/charts?country=jp');
    assert.equal(new Headers(request.init.headers).has('authorization'), false);
    if (init) assert.equal(new Headers(request.init.headers).get('x-fixture'), 'keep');
  }
  assert.equal(h.requests.length, 2);
  noStorage(h);
});
await check('preview GET and HEAD preserve gateway cookies with explicit same-origin policy', async () => {
  const h = fixture();
  h.preview.configurePublicPreview({ readOnly: true });
  for (const init of [undefined, { method: 'GET', credentials: 'include' },
    { method: 'GET', credentials: 'omit' }, { method: 'HEAD' }]) {
    await h.client.api('/api/charts', init);
    protectedPreviewCredentials(h.requests.at(-1));
  }
  noStorage(h);
});
for (const shape of ['object', 'tuples', 'Headers']) {
  await check(`preview strips app credentials and preserves non-auth headers from ${shape}`, async () => {
    const h = fixture();
    h.preview.configurePublicPreview({ readOnly: true });
    for (const [authName, cookieName] of [['Authorization', 'Cookie'], ['authorization', 'cookie'], ['AUTHORIZATION', 'COOKIE']]) {
      const entries = [[authName, 'synthetic-explicit'], [cookieName, 'synthetic=value'],
        ['X-Fixture', 'keep'], ['Content-Type', 'application/fixture+json']];
      const headers = shape === 'Headers' ? new Headers(entries)
        : shape === 'tuples' ? Object.freeze(entries.map(entry => Object.freeze(entry)))
        : Object.freeze(Object.fromEntries(entries));
      const before = Array.from(new Headers(headers).entries());
      await h.client.api('/api/search?q=fixture', { headers, credentials: 'include' });
      const request = h.requests.at(-1);
      protectedPreviewCredentials(request);
      const forwarded = new Headers(request.init.headers);
      assert.equal(forwarded.get('x-fixture'), 'keep');
      assert.equal(forwarded.get('content-type'), 'application/fixture+json', 'Caller content type must win once, case-insensitively');
      assert.equal(forwarded.has('0'), false, 'Tuple arrays must not become numeric header names');
      assert.deepEqual(Array.from(new Headers(headers).entries()), before, 'Caller headers must not be mutated');
    }
    noStorage(h);
  });
}
await check('catalog batch POST remains a read query with original payload and response', async () => {
  const h = fixture();
  h.preview.configurePublicPreview({ readOnly: true });
  const payload = { results: { fixture: { id: 123 } } };
  h.respond({ ok: true, status: 200, json: async () => payload });
  for (const path of ['/api/catalog/batch', '/api/catalog/batch?country=jp']) {
    const body = JSON.stringify({ terms: ['fixture'] });
    assert.equal(await h.client.api(path, { method: 'POST', body }), payload);
    const request = h.requests.at(-1);
    assert.equal(request.path, path);
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.body, body);
    assert.equal(new Headers(request.init.headers).get('content-type'), 'application/json');
    assert.equal(new Headers(request.init.headers).has('authorization'), false);
  }
  noStorage(h);
});
await check('catalog batch API exception preserves gateway cookies without explicit app credentials', async () => {
  const h = fixture();
  h.preview.configurePublicPreview({ readOnly: true });
  await h.client.api('/api/catalog/batch', { method: 'POST', credentials: 'include', body: '{"terms":["fixture"]}' });
  protectedPreviewCredentials(h.requests.at(-1));
  noStorage(h);
});
await check('actual findCatalog batching remains readable with gateway cookies and no explicit app credentials', async () => {
  const h = fixture();
  h.preview.configurePublicPreview({ readOnly: true });
  const track = { id: 123, title: 'Fixture song' };
  h.respond({ ok: true, status: 200, json: async () => ({ results: { fixture: track } }) });
  const first = h.client.findCatalog('fixture'), duplicate = h.client.findCatalog('fixture');
  assert.equal(h.requests.length, 0);
  await h.flushTimers();
  assert.equal(await first, track);
  assert.equal(await duplicate, track);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].path, '/api/catalog/batch');
  assert.deepEqual(JSON.parse(h.requests[0].init.body), { terms: ['fixture'] });
  assert.equal(await h.client.findCatalog('fixture'), track);
  assert.equal(h.requests.length, 1);
  noStorage(h);
  protectedPreviewCredentials(h.requests[0]);
});
await check('preview 401s preserve local tokens/cookies and do not emit app login redirects', async () => {
  for (const malformedJson of [false, true]) {
    const h = fixture();
    h.preview.configurePublicPreview({ readOnly: true });
    h.respond({ ok: false, status: 401, json: async () => {
      if (malformedJson) throw new SyntaxError('Fixture gateway HTML is not JSON');
      return { error: 'Fixture gateway authentication required', code: 'FIXTURE_GATEWAY_AUTH' };
    } });
    for (const [path, init] of [['/api/charts', undefined],
      ['/api/catalog/batch', { method: 'POST', body: '{"terms":["fixture"]}' }]]) {
      await assert.rejects(h.client.api(path, init), error => {
        assert.ok(error instanceof h.client.ApiError);
        assert.equal(error.status, 401);
        assert.equal(error.message, malformedJson ? 'HTTP 401' : 'Fixture gateway authentication required');
        assert.equal(error.code, malformedJson ? undefined : 'FIXTURE_GATEWAY_AUTH');
        return true;
      });
      protectedPreviewCredentials(h.requests.at(-1));
      noStorage(h);
      assert.equal(h.events.length, 0, 'Gateway 401 must not redirect into app login');
    }
    assert.equal(h.requests.length, 2, 'No hidden retry or app login request');
    h.preview.configurePublicPreview({ readOnly: false });
    h.respond({ ok: true, status: 200, json: async () => ({ fixture: 'ok' }) });
    await h.client.api('/api/orders', { method: 'POST' });
    assert.equal(new Headers(h.requests.at(-1).init.headers).get('authorization'), `Bearer ${fixtureToken}`,
      'A gateway 401 must not destroy the local app token needed after leaving preview');
  }
});
await check('local 401s still clear expired app credentials and notify only non-GET actions', async () => {
  for (const method of ['GET', 'POST']) {
    const h = fixture();
    h.preview.configurePublicPreview({ readOnly: true });
    h.preview.configurePublicPreview({ readOnly: false });
    h.respond({ ok: false, status: 401, json: async () => ({ error: 'Fixture expired app token' }) });
    await assert.rejects(h.client.api('/api/orders', { method }), error => {
      assert.ok(error instanceof h.client.ApiError);
      assert.equal(error.status, 401);
      return true;
    });
    assert.deepEqual(h.storageOps, [['read', 'lilac.token'], ['remove', 'lilac.token']]);
    assert.equal(h.cookieOps.length, 1);
    assert.equal(h.cookieOps[0][0], 'write');
    assert.match(h.cookieOps[0][1], /lilac_token=;.*max-age=0/);
    assert.equal(h.events.length, method === 'GET' ? 0 : 1);
    if (method !== 'GET') {
      assert.equal(h.events[0].type, 'lilac:auth-required');
      assert.equal(h.events[0].detail.path, '/api/orders');
    }
    h.respond({ ok: true, status: 200, json: async () => ({ fixture: 'ok' }) });
    await h.client.api('/api/charts');
    assert.equal(new Headers(h.requests.at(-1).init.headers).has('authorization'), false);
  }
});
await check('switching back to local restores writes, saved-token forwarding and normal response handling', async () => {
  const h = fixture();
  for (const capability of [{ readOnly: false }, null]) {
    h.preview.configurePublicPreview({ readOnly: true });
    h.preview.configurePublicPreview(capability);
    const body = '{"fixture":true}';
    const result = await h.client.api('/api/orders', { method: 'POST', body, credentials: 'include', headers: { 'x-fixture': 'keep' } });
    assert.equal(result.fixture, 'ok');
    const request = h.requests.at(-1);
    assert.equal(request.init.body, body);
    assert.equal(request.init.credentials, 'include');
    assert.equal(new Headers(request.init.headers).get('authorization'), `Bearer ${fixtureToken}`);
    assert.equal(new Headers(request.init.headers).get('x-fixture'), 'keep');
    assert.equal(new Headers(request.init.headers).get('content-type'), 'application/json');
    assert.equal(h.attributes.has('data-public-preview'), false);
    for (const route of privateRoutes) assert.equal(h.preview.previewAccountPage(route), false);
  }
  assert.equal(h.storageOps.length, 2);
  assert.ok(h.storageOps.every(([operation]) => operation === 'read'));
  assert.equal(h.cookieOps.length, 0);
});
await check('switching back to local restores the original disclosure instead of claiming read-only mode', () => {
  const h = fixture();
  for (const capability of [{ readOnly: false }, null]) {
    h.preview.configurePublicPreview({ readOnly: true });
    h.preview.configurePublicPreview(capability);
    assert.equal(h.footer.textContent, localDisclosure);
    assert.equal(h.htmlWrites, 0);
  }
});
await check('local GET and HTTP errors retain existing API semantics', async () => {
  const h = fixture();
  h.preview.configurePublicPreview({ readOnly: false });
  await h.client.api('/api/charts');
  assert.equal(new Headers(h.requests[0].init.headers).get('authorization'), `Bearer ${fixtureToken}`);
  assert.equal(new Headers(h.requests[0].init.headers).get('content-type'), null);
  assert.equal(h.requests[0].init.credentials, undefined, 'Local default fetch policy must stay unchanged');
  h.respond({ ok: false, status: 409, json: async () => ({ error: 'Fixture conflict', code: 'FIXTURE_CONFLICT' }) });
  await assert.rejects(h.client.api('/api/orders', { method: 'POST' }), error => {
    assert.ok(error instanceof h.client.ApiError);
    assert.equal(error.status, 409);
    assert.equal(error.code, 'FIXTURE_CONFLICT');
    assert.equal(error.message, 'Fixture conflict');
    return true;
  });
  assert.equal(h.requests.length, 2);
  assert.equal(h.events.length, 0);
});
console.log(`Public preview UI checks: ${passed} passed, ${failures.length} failed (${passed + failures.length} groups).`);
if (failures.length) process.exitCode = 1;
