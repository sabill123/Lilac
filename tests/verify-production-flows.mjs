/* Behavioral tests execute the shipped TS modules, with isolated browser/API doubles.
   No network, user accounts, or persisted records are touched. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
let count = 0;
const test = (name, fn) => { fn(); console.log(`PASS ${name}`); count++; };
function load(file, globals = {}, modules = {}) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: (name) => { if (!(name in modules)) throw new Error(`Unmocked import ${name}`); return modules[name]; }, URL, console: { error() {} }, ...globals });
  return exports;
}
const safety = load('frontend/src/app/pages/_safety.ts');
test('external URL gate rejects script/data/control-character/credential payloads', () => {
  for (const u of ['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,test', '//evil.test', 'https://user:pass@host.test', '', null]) assert.equal(safety.safeExternal(u), '');
});
test('bad ticket dates do not crash grouping', () => { assert.equal(safety.ticketDay('bad-date'), ''); assert.equal(safety.ticketDay(null), ''); });
test('ticket grouping uses Korean/Japanese local day', () => assert.equal(safety.ticketDay('2026-09-27T16:00:00Z'), '2026-09-28'));
test('external URL gate preserves real HTTPS queries', () => assert.equal(safety.safeExternal('https://example.com/join?q=jp&x=1'), 'https://example.com/join?q=jp&x=1'));
test('release comment link scrolls without destroying hash route', () => {
  let listener, prevented = false, scrolled = false;
  safety.bindSectionLink({ addEventListener: (_, fn) => { listener = fn; } }, { scrollIntoView: () => { scrolled = true; } });
  listener({ preventDefault: () => { prevented = true; } });
  assert.ok(prevented && scrolled);
});
let source;
class ES { constructor() { source = this; this.listeners = {}; } addEventListener(k, fn) { this.listeners[k] = fn; } }
const live = load('frontend/src/app/live.ts', { EventSource: ES, window: { addEventListener() {} }, document: { visibilityState: 'visible', activeElement: null, querySelector: () => null } });
live.startLive(); let updates = 0;
live.onLive(() => { throw new Error('broken independent subscriber'); });
live.onLive(() => { updates++; });
test('malformed SSE payload cannot poison state or invoke subscribers', () => {
  for (const data of ['null', '{}', JSON.stringify({ topic: 'goods', keys: 'not-array', at: 7, added: 1 }), JSON.stringify({ topic: 'unknown', keys: [], at: 7, added: 1 })]) source.listeners.update({ data });
  assert.equal(updates, 0); assert.equal(live.live.lastAt, 0);
});
test('a failing subscriber does not prevent the next subscriber', () => {
  source.listeners.update({ data: JSON.stringify({ topic: 'goods', keys: [], at: 123, added: 1 }) });
  assert.equal(updates, 1); assert.equal(live.live.lastAt, 123);
});
test('edition filters ignore unrelated source updates', () => {
  assert.equal(live.relevance({ keys: ['news-jp'], added: 5 }, 'kr').hit, false);
  assert.equal(live.relevance({ keys: ['news-jp', 'news-kr'], byKey: { 'news-jp': 5, 'news-kr': 2 } }, 'kr').added, 2);
});
const listeners = {};
const body = { innerHTML: '' };
const form = { addEventListener: (k, fn) => { listeners[k] = fn; }, querySelector: () => ({ focus() {} }) };
const retry = { addEventListener: (k, fn) => { listeners.retry = fn; } };
const root = { innerHTML: '', querySelector: (q) => q === '#sForm' ? form : q === '[data-retry]' ? retry : body };
let requests = 0;
const misc = load('frontend/src/app/pages/misc.ts', { location: { hash: '#/search?q=test' } }, {
  '../../api': { api: async () => { requests++; throw new Error('offline'); } },
  '../state': { state: { edition: 'kr' } }, '../i18n': { t: (x) => x }, '../cm-i18n': { ct: (x) => x }, '../cards': {},
  '../ui': { params: () => new URLSearchParams('q=test'), esc: (x) => x, icon: () => '', skeletonRows: () => '', errorState: () => '<button data-retry>retry</button>', emptyState: () => 'NO RESULTS' },
});
await misc.renderSearch(root, () => true);
test('search failure shows retry, not a false zero-result conclusion', () => { assert.ok(body.innerHTML.includes('data-retry')); assert.ok(!body.innerHTML.includes('NO RESULTS')); });
await listeners.retry();
test('search retry issues a new request', () => assert.equal(requests, 2));
body.innerHTML = 'new route'; await misc.renderSearch(root, () => false);
test('stale search rejection leaves the new route untouched', () => assert.equal(body.innerHTML, 'new route'));
let authCalls = 0, submitAuth;
const authButton = { disabled: false };
const authForm = { addEventListener: (_, fn) => { submitAuth = fn; }, reportValidity: () => false, querySelector: () => authButton };
const authRoot = { innerHTML: '', querySelector: () => authForm };
const auth = load('frontend/src/app/pages/misc.ts', {}, {
  '../../api': {}, '../state': { state: {}, login: async () => { authCalls++; } }, '../i18n': { t: (x) => x }, '../cm-i18n': {}, '../cards': {},
  '../ui': { params: () => new URLSearchParams(), esc: (x) => x },
});
auth.renderAuth(authRoot, 'login');
await submitAuth({ preventDefault() {} });
test('invalid auth form does not submit a network mutation', () => assert.equal(authCalls, 0));
authButton.disabled = true;
authForm.reportValidity = () => { throw new Error('must not start second submission'); };
await submitAuth({ preventDefault() {} });
test('pending auth submission rejects duplicate submit', () => assert.equal(authCalls, 0));
const ui = load('frontend/src/app/ui.ts', {}, { './i18n': { getLocale: () => 'ko', t: (k) => k } });
test('date helpers reject malformed/impossible dates without NaN', () => {
  for (const day of ['bad', '2026-02-30', '2026-13-01', '2026-00-01']) { assert.equal(ui.fmtDay(day), ''); assert.equal(ui.ddayOf(day), ''); }
  assert.equal(ui.until('not-a-date'), ''); assert.ok(ui.fmtDay('2024-02-29').includes('2.29'));
});
test('shared link sanitizer preserves in-app links and blocks executable protocols', () => {
  assert.equal(ui.safeHref('#/artist/test'), '#/artist/test'); assert.equal(ui.safeHref('#sdTalk'), '#sdTalk');
  for (const href of ['javascript:alert(1)', 'data:text/html,1', '//evil.test', '/\\evil.test']) assert.equal(ui.safeHref(href), '');
});
test('image rendering rejects SVG data scripts but permits raster/local artwork', () => {
  assert.ok(ui.img('data:image/svg+xml,<svg/>', 'x').includes('is-empty'));
  assert.ok(ui.img('javascript:alert(1)', 'x').includes('is-empty'));
  assert.ok(ui.img('/guides/example.jpg', 'x').includes('<img'));
  assert.ok(ui.img('data:image/png;base64,AAAA', 'x').includes('<img'));
});
let resolveLookup, resolveLike, socialLikes = 0;
const social = load('frontend/src/app/social.ts', { location: { origin: 'https://lilac.test', pathname: '/', hash: '#/chart' } }, {
  '../api': { api: (path) => path === '/api/social/lookup' ? new Promise((r) => { resolveLookup = r; }) : path === '/api/social/like' ? (socialLikes++, new Promise((r) => { resolveLike = r; })) : Promise.reject(new Error('Unexpected mutation')) },
  './state': { state: { me: { name: 'Fixture' } }, sessionReady: Promise.resolve() }, './ui': { ...ui, toast() {} }, './cm-i18n': { ct: (x) => x }, './i18n': { t: (x) => x },
});
test('comment dates and HTML linkification handle malformed content safely', () => {
  assert.equal(social.when('invalid'), '');
  const html = social.linkify('https://good.test/" onclick="alert(1) <script>x</script>');
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('href="https://good.test/&quot;'));
  assert.ok(html.includes('&lt;script&gt;'));
});
const socialMarkup = social.likeBtn({ kind: 'track', ref: 'fixture', snap: {} });
const socialId = socialMarkup.match(/data-soc-like="([^"]+)"/)[1];
let likeClick; const countNode = { textContent: '0' }; const attrs = {};
const likeElement = { dataset: { socLike: socialId }, isConnected: true, disabled: false, classList: { remove() {}, add() {} }, querySelector: () => countNode, setAttribute: (k, v) => { attrs[k] = v; }, addEventListener: (_, fn) => { likeClick = fn; } };
await social.bindSocial({ querySelectorAll: (q) => q.startsWith('[data-soc-like]') ? [likeElement] : [] });
test('like button binds before slow lookup completes', () => assert.equal(typeof likeClick, 'function'));
const firstLike = likeClick(); const duplicateLike = likeClick();
test('duplicate like action sends only one request', () => assert.equal(socialLikes, 1));
resolveLike({ liked: true, likes: 7 }); await firstLike; await duplicateLike;
resolveLookup({ items: [{ liked: false, likes: 0, cmt: 0 }] }); await Promise.resolve();
test('late count lookup cannot overwrite the successful like mutation', () => { assert.equal(countNode.textContent, '7'); assert.equal(attrs['aria-pressed'], 'true'); });
const cards = load('frontend/src/app/cards.ts', {}, { './ui': ui, './fanclub': { withUtm: (u) => u }, './detail': {}, '../api': {}, './i18n': { getLocale: () => 'ko', t: (x) => x }, './state': { state: {} }, './player': {}, './social': {}, './cm-i18n': {} });
test('shared cards block unsafe outbound news/product links', () => {
  assert.ok(!cards.newsRow({ url: 'javascript:alert(1)', title: 'Fixture', topics: [] }).includes('javascript:'));
  assert.ok(!cards.goodsCard({ url: 'data:text/html,x', title: 'Fixture', price: 1, currency: 'JPY' }, null, 'JPY').includes('data:text/html'));
});
test('invalid concert dates do not crash poster/open cards', () => {
  assert.equal(cards.openLabel('invalid'), '');
  assert.ok(cards.posterCard({ id: 'fixture', title: 'Fixture', startDate: 'invalid', provider: 'nol', status: 'unknown' }).includes('pcard'));
});
test('concert registry has a finite memory bound', () => {
  for (let i = 0; i < 5100; i++) cards.concertRegistry.set('fixture-' + i, { id: 'fixture-' + i });
  assert.equal(cards.concertRegistry.size, 5000); assert.ok(cards.concertRegistry.has('fixture-5099'));
});

let commentSubmit, resolveComment, commentAdds = 0, paints = 0;
const commentText = { value: '', addEventListener() {} };
const commentButton = { disabled: false };
const commentLen = { textContent: '' };
const commentForm = { dataset: { parent: '' }, querySelector: (q) => q === 'textarea' ? commentText : q === '.cmt-len' ? commentLen : q.startsWith('button:') ? commentButton : null, addEventListener: (kind, fn) => { if (kind === 'submit') commentSubmit = fn; } };
const commentUl = { set innerHTML(_) { paints++; }, querySelectorAll: () => [] };
const commentBox = { dataset: {}, isConnected: true, querySelector: (q) => q === '.cmts-n' ? {} : q === '.cmt-list' ? commentUl : {}, querySelectorAll: (q) => q === '.cmt-form' ? [commentForm] : [] };
const comments = load('frontend/src/app/social.ts', { setTimeout: () => 0 }, {
  '../api': {}, './state': { state: { me: { name: 'Fixture' } }, sessionReady: Promise.resolve() }, './ui': { ...ui, toast() {} }, './cm-i18n': { ct: (x) => x }, './i18n': { t: (x) => x },
});
await comments.bindComments(commentBox, { load: async () => [], add: () => { commentAdds++; return new Promise((r) => { resolveComment = r; }); } });
commentText.value = 'Test body';
const submitOne = commentSubmit({ preventDefault() {} }); const submitTwo = commentSubmit({ preventDefault() {} });
test('comment double submit sends only one mutation', () => assert.equal(commentAdds, 1));
commentBox.isConnected = false; const paintBeforeResponse = paints;
resolveComment({ item: { id: 'fixture', body: 'Test body' }, count: 1 }); await submitOne; await submitTwo;
test('detached comment response does not repaint another route', () => assert.equal(paints, paintBeforeResponse));

const detail = load('frontend/src/app/detail.ts', {}, {
  './state': { state: { edition: 'jp' } }, './i18n': { getLocale: () => 'ja', t: (x) => x }, './ui': ui, './fanclub': { withUtm: (u) => u, payNames: (x) => x },
});
test('detail outbound URLs reject executable schemes, internal guide links remain', () => {
  const html = detail.detailHtml({ provider: 'nol' }, { detail: { url: 'javascript:alert(1)', prices: [], facts: {}, booking: { global: { url: 'data:text/html,x', langs: [] } }, refund: [] }, fanclub: { artistId: 'fixture', entry: 'javascript:alert(2)', payments: [], windows: [] } }, null);
  assert.ok(!html.includes('javascript:')); assert.ok(!html.includes('data:text/html')); assert.ok(html.includes('#/guide/kr'));
});
const fcList = load('frontend/src/app/pages/fanclub.ts', {}, {
  './_safety': safety, '../../api': {}, '../state': {}, '../i18n': { getLocale: () => 'ko' }, '../ui': ui, '../cards': {}, '../fanclub': {}, '../fcguide': {}, '../fcknow': { platKey: () => null, PLATFORM_KNOW: {} },
});
test('fanclub cache notice distinguishes stale versus refresh failure', () => {
  const stale = fcList.fanclubCacheNotice({ state: 'stale', updatedAt: '2026-09-27T00:00:00Z' });
  const failed = fcList.fanclubCacheNotice({ state: 'fresh', lastError: 'private internal stack trace', updatedAt: '2026-09-27T00:00:00Z' });
  assert.ok(stale.includes('확인 주기가 지난')); assert.ok(stale.includes('마지막 확인'));
  assert.ok(failed.includes('갱신에 실패')); assert.ok(!failed.includes('private internal'));
  assert.equal(fcList.fanclubCacheNotice(null), '');
});
function guestSocial(existingKey) {
  const calls = [], messages = []; let popups = 0;
  const loc = { origin: 'https://lilac.test', pathname: '/', hash: '#/chart' };
  const control = { addEventListener() {}, focus() {} };
  const pop = { className: '', style: {}, offsetWidth: 200, offsetHeight: 100, setAttribute() {}, remove() {}, querySelector: () => control, querySelectorAll: () => [] };
  const mod = load('frontend/src/app/social.ts', { location: loc, navigator: {}, innerWidth: 1000, innerHeight: 1000, setTimeout: () => 1, clearTimeout() {}, document: { title: 'Fixture', createElement: () => pop, body: { appendChild() { popups++; } }, addEventListener() {}, removeEventListener() {} } }, {
    '../api': { api: async (path) => { calls.push(path); if (path !== '/api/social/lookup') throw new Error('Unexpected write'); return { items: existingKey ? [{ key: existingKey, likes: 0, cmt: 0, liked: false }] : [null] }; } },
    './state': { state: { me: null }, sessionReady: Promise.resolve() }, './ui': { ...ui, toast: (s) => messages.push(s) }, './cm-i18n': { ct: (x) => x }, './i18n': { t: (x) => x },
  });
  function el(dataset) { const b = { dataset, tagName: 'BUTTON', disabled: false, isConnected: true, setAttribute() {}, querySelector: () => ({ textContent: '' }), addEventListener: (_, fn) => { b.click = fn; }, getBoundingClientRect: () => ({ left: 20, top: 20, bottom: 40, width: 30 }) }; return b; }
  return { mod, calls, messages, loc, el, popups: () => popups };
}
const existingGuest = guestSocial('saved-thread');
const existingMarkup = existingGuest.mod.talkBtn({ kind: 'track', ref: 'fixture', snap: {} }, '#/track/{key}');
const existingTalk = existingGuest.el({ socCmt: existingMarkup.match(/data-soc-cmt="([^"]+)"/)[1], route: '#/track/{key}' });
await existingGuest.mod.bindSocial({ querySelectorAll: (q) => q.startsWith('[data-soc-cmt]') ? [existingTalk] : [] });
await existingTalk.click();
test('guest opens existing discussion through lookup without creating target', () => { assert.equal(existingGuest.loc.hash, '#/track/saved-thread'); assert.ok(existingGuest.calls.every((p) => p === '/api/social/lookup')); });
const newGuest = guestSocial(null);
const newMarkup = newGuest.mod.talkBtn({ kind: 'track', ref: 'fixture-new', snap: {} }, '#/track/{key}');
const newTalk = newGuest.el({ socCmt: newMarkup.match(/data-soc-cmt="([^"]+)"/)[1], route: '#/track/{key}' });
await newGuest.mod.bindSocial({ querySelectorAll: (q) => q.startsWith('[data-soc-cmt]') ? [newTalk] : [] });
await newTalk.click();
test('guest missing target gets a login prompt, never a target POST', () => { assert.ok(newGuest.loc.hash.startsWith('#/login?next=')); assert.ok(newGuest.messages.includes('soc.login')); assert.ok(newGuest.calls.every((p) => p === '/api/social/lookup')); });
const directGuest = guestSocial(null);
const directShare = directGuest.el({ socShare: '', hash: '#/fanclub/fixture', title: 'Fixture' });
await directGuest.mod.bindSocial({ querySelectorAll: (q) => q.startsWith('[data-soc-share]') ? [directShare] : [] });
await directShare.click({ stopPropagation() {} });
test('guest direct URL sharing opens menu without authentication or API writes', () => { assert.equal(directGuest.popups(), 1); assert.equal(directGuest.calls.length, 0); assert.equal(directGuest.loc.hash, '#/chart'); });

const existingShareMarkup = existingGuest.mod.shareBtn({ kind: 'concert', ref: 'fixture', snap: {} }, '#/e/{key}', 'Fixture');
const existingShare = existingGuest.el({ socShare: existingShareMarkup.match(/data-soc-share="([^"]+)"/)[1], hash: '#/e/{key}', title: 'Fixture' });
await existingGuest.mod.bindSocial({ querySelectorAll: (q) => q.startsWith('[data-soc-share]') ? [existingShare] : [] });
await existingShare.click({ stopPropagation() {} });
test('guest can share an existing target without creating a public record', () => { assert.equal(existingGuest.popups(), 1); assert.ok(existingGuest.calls.every((p) => p === '/api/social/lookup')); });
const missingShareMarkup = newGuest.mod.shareBtn({ kind: 'concert', ref: 'new-fixture', snap: {} }, '#/e/{key}', 'Fixture');
const missingShare = newGuest.el({ socShare: missingShareMarkup.match(/data-soc-share="([^"]+)"/)[1], hash: '#/e/{key}', title: 'Fixture' });
newGuest.loc.hash = '#/concerts';
await newGuest.mod.bindSocial({ querySelectorAll: (q) => q.startsWith('[data-soc-share]') ? [missingShare] : [] });
await missingShare.click({ stopPropagation() {} });
test('guest share requiring a new record offers login instead of failing silently', () => { assert.ok(newGuest.loc.hash.startsWith('#/login?next=')); assert.equal(newGuest.popups(), 0); assert.ok(newGuest.calls.every((p) => p === '/api/social/lookup')); });
console.log(`\n${count} passed, 0 failed`);
