#!/usr/bin/env node
/** Run: node tests/verify-store-ux.mjs
 * Executes the real store model and Korean/Japanese matcher using the frontend's
 * declared TypeScript dependency. Only node built-ins otherwise; no browser,
 * server, catalog reads/writes, network, accounts, or new dependencies.
 * Renderer checks use HTML sinks, not a browser/layout simulation.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
function load(relative, imports = {}, globals = {}) {
  const js = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
    reportDiagnostics: true,
  });
  assert.equal(js.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0,
    `TypeScript transpilation failed: ${relative}`);
  const exports = {};
  vm.runInNewContext(js.outputText, { exports, ...globals, require(name) {
    assert.ok(Object.hasOwn(imports, name), `Unexpected import in ${relative}: ${name}`);
    return imports[name];
  } }, { filename: relative });
  return exports;
}
const koja = load('../frontend/src/koja.ts'); // Never replace smartMatch with a stub.
const model = load('../frontend/src/store/model.ts', { '../koja': koja });
const { initialStoreState, productOrigin, productCurrency, comparablePrice,
  filterProducts, updateStoreState, artistFacets, visibleProducts, PAGE_SIZE } = model;
const state = (patch = {}) => ({ ...initialStoreState(), ...patch });
const product = (id, patch = {}) => ({
  id, name: `Album ${id}`, brand: 'Future Artist', artistId: 'future-artist',
  origin: 'jp', size: 'album', sizeLabel: '정규 앨범', price: 20000,
  priceCurrency: 'KRW', rate: 9, releaseDate: '2026-01-01', artwork: '',
  editions: [], searchTerm: '', badge: '', stock: 0, ...patch,
});
// Convert cross-realm arrays/objects for strict equality without discarding NaN.
const ids = (list) => Array.from(list, p => p.id);
const facets = (list, origin) => Array.from(artistFacets(list, origin), pair => Array.from(pair));
const sorted = (list, sort, patch = {}) => ids(filterProducts(list, state({ ...patch, sort })));
let passed = 0;
const failures = [];
function check(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
}

check('initial state is complete and independently allocated', () => {
  assert.deepEqual({ ...initialStoreState() }, {
    origin: 'all', size: 'all', artist: 'all', query: '', sort: 'new', page: 1,
  });
  const first = initialStoreState(); first.artist = 'changed'; first.page = 9;
  assert.equal(initialStoreState().artist, 'all');
  assert.equal(initialStoreState().page, 1);
});

const intersection = [
  product('match', { name: '라이브 특별판' }),
  product('wrong-origin', { name: '라이브 특별판', origin: 'kr' }),
  product('wrong-size', { name: '라이브 특별판', size: 'single' }),
  product('wrong-artist', { name: '라이브 특별판', brand: 'Other Artist' }),
  product('wrong-query', { name: 'Studio recording' }),
];
check('origin + size + artist + query intersect instead of replacing each other', () => {
  assert.deepEqual(ids(filterProducts(intersection, state({
    origin: 'jp', size: 'album', artist: 'Future Artist', query: '특별판',
  }))), ['match']);
  assert.deepEqual(ids(filterProducts(intersection, state({ origin: 'kr', size: 'mini' }))), []);
});
check('whitespace-only and padded queries retain all other filters', () => {
  const filters = { origin: 'jp', size: 'album', artist: 'Future Artist' };
  assert.deepEqual(ids(filterProducts(intersection, state({ ...filters, query: ' \t\n ' }))), ['match', 'wrong-query']);
  assert.deepEqual(ids(filterProducts(intersection, state({ ...filters, query: ' \n 특별판 \t ' }))), ['match']);
});
check('real smartMatch searches Korean phonetics, aliases, brand and searchTerm', () => {
  const records = [
    product('kana', { name: 'ライラック', brand: 'Band One' }),
    product('alias', { name: 'BLUE', brand: 'Unlisted Name', artistId: 'unknown-id' }),
    product('term', { name: 'Archive', brand: 'Band Three', searchTerm: '별빛 특전' }),
  ];
  const aliases = new Map([['unknown-id', '미래밴드 未知のバンド']]);
  assert.deepEqual(ids(filterProducts(records, state({ query: '라일락' }), aliases)), ['kana']);
  assert.deepEqual(ids(filterProducts(records, state({ origin: 'jp', size: 'album', artist: 'Unlisted Name', query: ' 미래밴드 ' }), aliases)), ['alias']);
  assert.deepEqual(ids(filterProducts(records, state({ origin: 'jp', size: 'single', artist: 'Unlisted Name', query: ' 미래밴드 ' }), aliases)), []);
  assert.deepEqual(ids(filterProducts(records, state({ query: '  bAnD oNe ' }), aliases)), ['kana']);
  assert.deepEqual(ids(filterProducts(records, state({ query: '별빛' }), aliases)), ['term']);
  assert.deepEqual(ids(filterProducts(records, state({ origin: 'kr', query: '미래밴드' }), aliases)), []);
  assert.deepEqual(ids(filterProducts(records, state({ query: '미래밴드' }))), []);
});
check('sorting, filtering, facets and pagination never mutate source data', () => {
  const source = Object.freeze([
    Object.freeze(product('z', { price: 31000, releaseDate: '2026-06-01' })),
    Object.freeze(product('a', { price: 12000, name: 'A' })),
    Object.freeze(product('m', { origin: 'kr', priceCurrency: 'JPY', price: 2100, rate: 0.1 })),
  ]);
  const before = structuredClone(source);
  const frozenState = Object.freeze(state());
  for (const sort of ['new', 'name', 'low', 'high']) {
    const result = filterProducts(source, { ...frozenState, sort });
    assert.notEqual(result, source);
    assert.ok(result.every(p => source.includes(p)), 'Filtering must not rewrite product prices/objects');
  }
  artistFacets(source, 'all'); visibleProducts(source, frozenState);
  assert.deepEqual(source, before);
});
check('changing origin resets artist and page but preserves size, query and sort', () => {
  const old = Object.freeze(state({ origin: 'jp', artist: 'Future Artist', size: 'mini', query: ' BLUE ', sort: 'high', page: 4 }));
  const next = updateStoreState(old, { origin: 'kr' });
  assert.deepEqual({ ...next }, { ...old, origin: 'kr', artist: 'all', page: 1 });
  assert.equal(old.page, 4); assert.equal(old.artist, 'Future Artist');
  assert.deepEqual({ ...updateStoreState(next, { origin: 'all' }) }, { ...next, origin: 'all', artist: 'all', page: 1 });
});
check('same origin keeps artist; every filter and sort change resets pagination', () => {
  const old = state({ origin: 'jp', artist: 'Future Artist', size: 'album', query: 'blue', sort: 'high', page: 3 });
  for (const patch of [{ origin: 'jp' }, { size: 'single' }, { artist: 'New artist' }, { query: 'new' }, { sort: 'low' }]) {
    assert.deepEqual({ ...updateStoreState(old, patch) }, { ...old, ...patch, page: 1 });
  }
});
check('native KRW and converted JPY sort by the same KRW value in both directions', () => {
  const records = [
    product('krw-20k', { price: 20000, rate: undefined }),
    product('jpy-30k', { origin: 'kr', priceCurrency: 'JPY', price: 3000, rate: 0.1 }),
    product('jpy-10k', { origin: 'kr', priceCurrency: 'JPY', price: 1000, rate: 0.1 }),
  ];
  assert.equal(comparablePrice(records[0]), 20000, 'KRW needs no exchange rate');
  assert.equal(comparablePrice(records[1]), 30000, 'JPY total must be divided by KRW-to-JPY rate');
  assert.deepEqual(sorted(records, 'low'), ['jpy-10k', 'krw-20k', 'jpy-30k']);
  assert.deepEqual(sorted(records, 'high'), ['jpy-30k', 'krw-20k', 'jpy-10k']);
});
check('missing, zero, negative and non-finite JPY rates stay last for low and high', () => {
  const invalid = [undefined, null, 0, -0.1, NaN, Infinity, -Infinity, '0.1'].map((rate, i) =>
    product(`invalid-${i}`, { priceCurrency: 'JPY', origin: 'kr', rate, price: 1000 }));
  for (const p of invalid) assert.equal(comparablePrice(p), null, `Invalid rate ${String(p.rate)} must not be sortable`);
  const records = [invalid[3], product('valid-high', { price: 40000 }), ...invalid.filter((_, i) => i !== 3), product('valid-low', { price: 5000 })];
  assert.deepEqual(sorted(records, 'low'), ['valid-low', 'valid-high', ...ids(invalid)]);
  assert.deepEqual(sorted(records, 'high'), ['valid-high', 'valid-low', ...ids(invalid)]);
});
check('invalid prices stay last while valid zero prices remain sortable', () => {
  const invalid = [undefined, null, -1, NaN, Infinity, -Infinity, '1000'].map((price, i) => product(`bad-${i}`, { price }));
  for (const p of invalid) assert.equal(comparablePrice(p), null, `Invalid price ${String(p.price)} must not be sortable`);
  const zero = product('zero', { price: 0 });
  assert.equal(comparablePrice(zero), 0);
  const records = [...invalid].reverse().concat(zero, product('positive', { price: 1 }));
  assert.deepEqual(sorted(records, 'low'), ['zero', 'positive', ...ids(invalid)]);
  assert.deepEqual(sorted(records, 'high'), ['positive', 'zero', ...ids(invalid)]);
});
check('missing origin and currency preserve legacy JP/KRW and KR/JPY fallbacks', () => {
  const legacy = product('legacy', { origin: undefined, priceCurrency: undefined, price: 15000, rate: undefined });
  const korean = product('korean', { origin: 'kr', priceCurrency: undefined, price: 2000, rate: 0.1 });
  assert.equal(productOrigin(legacy), 'jp'); assert.equal(productCurrency(legacy), 'KRW');
  assert.equal(comparablePrice(legacy), 15000);
  assert.equal(productCurrency(korean), 'JPY'); assert.equal(comparablePrice(korean), 20000);
  assert.deepEqual(ids(filterProducts([korean, legacy], state({ origin: 'jp' }))), ['legacy']);
  assert.deepEqual(ids(filterProducts([korean, legacy], state({ origin: 'kr' }))), ['korean']);
  assert.deepEqual(sorted([korean, legacy], 'low'), ['legacy', 'korean']);
  assert.equal(productCurrency(product('explicit', { origin: 'kr', priceCurrency: 'KRW' })), 'KRW');
  assert.equal(productCurrency(product('explicit-jpy', { origin: undefined, priceCurrency: 'JPY' })), 'JPY');
});
check('latest sort is deterministic for equal and absent release dates', () => {
  const records = [product('b'), product('empty-z', { releaseDate: '' }), product('a'),
    product('latest', { releaseDate: '2026-09-05' }), product('empty-a', { releaseDate: undefined })];
  const expected = ['latest', 'a', 'b', 'empty-a', 'empty-z'];
  for (const input of [records, [...records].reverse(), [...records.slice(2), ...records.slice(0, 2)]]) {
    assert.deepEqual(sorted(input, 'new'), expected);
  }
});
check('name sort is deterministic with id tie-breaks rather than input order or date', () => {
  const records = [product('z', { name: 'Alpha', releaseDate: '2026-12-31' }),
    product('b', { name: 'Beta' }), product('a', { name: 'Alpha', releaseDate: '2020-01-01' })];
  assert.deepEqual(sorted(records, 'name'), ['a', 'z', 'b']);
  assert.deepEqual(sorted([...records].reverse(), 'name'), ['a', 'z', 'b']);
});
check('equal converted prices deterministically use latest date then id', () => {
  const records = [product('b', { price: 10000 }), product('a', { priceCurrency: 'JPY', price: 1000, rate: 0.1 }),
    product('recent', { price: 10000, releaseDate: '2026-08-01' })];
  for (const sort of ['low', 'high']) {
    assert.deepEqual(sorted(records, sort), ['recent', 'a', 'b']);
    assert.deepEqual(sorted([...records].reverse(), sort), ['recent', 'a', 'b']);
  }
});
check('load-more pagination exposes 24 then 48 then all 53 without duplicates', () => {
  assert.equal(PAGE_SIZE, 24);
  const records = Array.from({ length: 53 }, (_, i) => product(`p-${String(i).padStart(2, '0')}`,
    i === 0 ? { name: 'Unique Needle' } : {}));
  for (const [page, count] of [[1, 24], [2, 48], [3, 53], [9, 53], [0, 24], [-1, 24]]) {
    const visible = visibleProducts(records, state({ page }));
    assert.equal(visible.length, count); assert.deepEqual(ids(visible), ids(records.slice(0, count)));
    assert.equal(new Set(ids(visible)).size, count);
  }
  assert.deepEqual(ids(visibleProducts([], state())), []);
  assert.equal(visibleProducts(records.slice(0, 24), state({ page: 2 })).length, 24);
  // A word-based query avoids assuming exact matching for numeric IDs: the
  // real phonetic matcher intentionally normalizes punctuation and digits.
  const narrowed = filterProducts(records, state({ query: 'Unique Needle' }));
  assert.deepEqual(ids(visibleProducts(narrowed, updateStoreState(state({ page: 3 }), { query: 'Unique Needle' }))), ['p-00']);
});
check('artist facets discover unknown catalog artists and count within origin only', () => {
  const records = [product('one', { brand: 'Unregistered 2040' }), product('two', { brand: 'Unregistered 2040' }),
    product('three', { brand: 'Unregistered 2040', origin: 'kr' }),
    product('four', { brand: 'Another New Band', origin: undefined }), product('five', { brand: 'Korean New Band', origin: 'kr' })];
  assert.deepEqual(facets(records, 'all'), [['Another New Band', 1], ['Korean New Band', 1], ['Unregistered 2040', 3]]);
  assert.deepEqual(facets(records, 'jp'), [['Another New Band', 1], ['Unregistered 2040', 2]]);
  assert.deepEqual(facets(records, 'kr'), [['Korean New Band', 1], ['Unregistered 2040', 1]]);
  assert.deepEqual(facets([...records].reverse(), 'all'), facets(records, 'all'));
  const added = product('six', { brand: 'Never Seen Before' });
  assert.ok(facets([...records, added], 'all').some(([name, count]) => name === added.brand && count === 1));
  assert.deepEqual(ids(filterProducts([...records, added], state({ artist: added.brand }))), ['six']);
  assert.deepEqual(facets([], 'all'), []);
});

// Render actual HTML without implementing DOM parsing or starting any UI.
function renderFixture(records) {
  const nodes = new Map();
  const sink = () => ({ innerHTML: '', textContent: '', value: '', hidden: false,
    addEventListener() {}, setAttribute() {} });
  const node = (selector) => { if (!nodes.has(selector)) nodes.set(selector, sink()); return nodes.get(selector); };
  const host = { ...sink(), querySelector: node, querySelectorAll: () => [] };
  const root = { innerHTML: '', querySelector(selector) {
    assert.equal(selector, '.commerce-store'); return host;
  } };
  const esc = (value) => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const renderer = load('../frontend/src/store/index.ts', {
    '../api': { esc, icon: () => '<svg aria-hidden="true"></svg>', artUrl: p => p.artwork },
    '../koja': koja, './model': model,
  }, { AbortController, window: { matchMedia: () => ({ matches: false, addEventListener() {} }) } });
  renderer.renderStore(root, records, []);
  return { shell: root.innerHTML, cards: node('#shopProducts').innerHTML };
}
check('rendered links preserve encoded product detail, orders, comparison and help families', () => {
  const id = 'future/id ?#한글';
  const { shell, cards } = renderFixture([product(id, { artwork: 'https://example.test/cover.jpg' })]);
  const href = `#/store/${encodeURIComponent(id)}`;
  assert.ok(cards.includes(`href="${href}"`), 'Product card must link to its encoded product detail, not a search/listing');

  for (const route of ['#/orders', '#/releases', '#/help']) assert.ok(shell.includes(`href="${route}"`), `Missing ${route} destination`);
  // Source invariants are limited to the real route hand-off, not model behavior.
  assert.match(read('../frontend/src/pages.ts'), /export\s+async\s+function\s+pageStore\s*\(\s*\)\s*\{\s*renderStore\(root\(\),\s*products,\s*artists\);?\s*\}/,
    'pageStore must hand the live product and artist arrays to the new renderer');
});
check('cards use native estimated prices without fabricated stock or discount claims', () => {
  const { shell, cards } = renderFixture([
    product('krw', { price: 20000, stock: 987654321, badge: 'FAKE_SALE_SENTINEL_70%' }),
    product('jpy', { origin: 'kr', priceCurrency: 'JPY', price: 2000, rate: 0.1, stock: 987654321, badge: 'FAKE_SALE_SENTINEL_70%' }),
  ]);
  assert.ok(cards.includes('₩20,000')); assert.ok(cards.includes('¥2,000'));
  assert.match(cards, /예상 구매가/);
  assert.doesNotMatch(cards, /987654321|FAKE_SALE_SENTINEL|(?:남은|잔여|재고)\s*\d|\d+\s*%|할인|품절|<del\b|<s\b/,
    'Catalog stock/badge/discount assumptions must not become commerce claims');
  assert.match(shell, /실제 결제·배송은 이루어지지 않/);
  assert.match(shell, /재고를 보장하지 않/);
});

check('store has no promotional subtitles or duplicate section headings', () => {
  const {shell,cards} = renderFixture([product('plain')]);
  assert.match(shell, /<h1>스토어<\/h1>/);
  assert.doesNotMatch(shell + cards, /<h[23]\b|shop-feature|shop-compare-entry|NEW RELEASES|소장하는 즐거움|좋아하는 아티스트의 앨범을 한곳에서/);
  assert.match(shell, /aria-label="상품 목록"/);
  assert.match(shell, /<legend>앨범 유형<\/legend>/);
  assert.match(shell, /<legend>아티스트<\/legend>/);
  assert.match(cards, /shop-card-name/);
});

// Exercise the production alias-loading path, including the misleading reading
// that caused a real YOASOBI search to include unrelated "You" releases.
const aliasRequests = [];
const populatedKoja = load('../frontend/src/koja.ts', {}, { fetch: async (url) => {
  aliasRequests.push(url);
  return { ok: true, json: async () => ({
    [koja.phoneticKey('YOASOBI')]: ['You'],
    [koja.phoneticKey('하루')]: ['晴る'],
  }) };
} });
await populatedKoja.loadAliases();
const populatedModel = load('../frontend/src/store/model.ts', { '../koja': populatedKoja });
check('loaded reading aliases cannot broaden ASCII artist or numeric literal searches', () => {
  assert.deepEqual(aliasRequests, ['/api/readings'], 'Must populate READINGS through the real loadAliases path');
  assert.equal(populatedKoja.smartMatch('You', 'YOASOBI'), true,
    'Regression setup must reproduce the misleading alias in real smartMatch');
  const records = [
    product('own-a', { name: 'THE BOOK', brand: 'YOASOBI' }),
    product('own-b', { name: 'E-SIDE', brand: 'ＹＯＡＳＯＢＩ' }),
    product('own-c', { name: '夜に駆ける', brand: 'ヨアソビ', artistId: 'yoasobi' }),
    product('unrelated-you', { name: 'You', brand: 'Unrelated Band' }),
    product('unrelated-you-and-me', { name: 'You and Me', brand: 'Another Band' }),
    product('split-fields', { name: 'YOA', brand: 'SOBI' }),
    product('number-a', { name: 'Release p-00' }),
    product('number-b', { name: 'Release p-01' }),
    product('year-a', { name: 'Edition 2026' }),
    product('year-b', { name: 'Edition ２０２６' }),
    product('year-c', { name: 'Edition 2027' }),
    product('kanji', { name: '晴る' }),
  ];
  const aliases = new Map([['yoasobi', 'YOASOBI ヨアソビ']]);
  const find = (query) => ids(populatedModel.filterProducts(records, state({ query }), aliases));
  for (const query of ['YOASOBI', 'yoasobi', ' \tYoAsObI\n ']) {
    assert.deepEqual(find(query), ['own-a', 'own-b', 'own-c'],
      'ASCII searches must be case-insensitive NFKC literals, not reading expansions');
  }
  assert.deepEqual(find('YOA SOBI'), [], 'A query must not match across concatenated product fields');
  assert.deepEqual(find('p-00'), ['number-a'], 'Repeated digits must remain literal');
  assert.deepEqual(find('p-01'), ['number-b']);
  assert.deepEqual(find('2026'), ['year-a', 'year-b'], 'Numeric queries must retain digits and normalize full-width text');
  assert.deepEqual(find('2027'), ['year-c']);
  assert.deepEqual(find('하루'), ['kanji'], 'Korean queries must still use populated real reading aliases');
});

console.log(`Store UX regression checks: ${passed} passed, ${failures.length} failed (${passed + failures.length} groups).`);
if (failures.length) { console.error(`Failed groups: ${failures.join('; ')}`); process.exitCode = 1; }
