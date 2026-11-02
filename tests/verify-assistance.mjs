import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import https from 'node:https';
import { collectAssistance } from '../backend/lib/live/assistance.mjs';

let passed = 0;
const test = async (name, fn) => { await fn(); console.log('PASS', ++passed, name); };
const base = 'https://official.example.com';
const now = () => new Date('2026-10-25T03:00:00Z');
const publicDNS = async () => [{ address: '8.8.8.8', family: 4 }];
const html = body => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
function mock(pages = {}) {
  const calls = [];
  return { calls, deps: { now, lookup: publicDNS, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.cookie, undefined); assert.equal(options.headers.authorization, undefined);
    assert.equal(options.address.address, '8.8.8.8');
    const response = pages[url];
    return typeof response === 'function' ? response() : html(response ?? '<title>Public</title>');
  } } };
}
const oldFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error('unexpected network'); };
try {
  await test('JSON-LD, OG, public product images and source sentences are source-bound', async () => {
    const fixture = mock({ [`${base}/products/test`]: `<title>公式 商品</title><meta property="og:image" content="/cover.jpg"><script type="application/ld+json">{"@graph":[{"@type":"Product","image":["https://cdn.example.com/goods.jpg",{"url":"/extra.jpg"}]}]}</script><h1>商品案内</h1><p>日本国内への配送のみ対応しています。</p><p>お支払いはクレジットカードに対応しています。</p><img class="product-image" src="/photo.jpg"><img class="logo" src="/logo.jpg">` });
    const result = await collectAssistance({ url: `${base}/products/test`, kind: 'goods', artistName: 'Arbitrary Artist' }, fixture.deps);
    assert.equal(result.status, 'ok'); assert.equal(result.title, '公式 商品'); assert.equal(result.images.length, 4);
    assert(result.images.some(x => x.kind === 'jsonld' && x.url.endsWith('extra.jpg')));
    assert(result.evidence.some(x => x.verbatim === '日本国内への配送のみ対応しています。'));
    for (const row of [...result.images, ...result.evidence]) { assert.equal(row.sourceUrl, `${base}/products/test`); assert.equal(row.fetchedAt, now().toISOString()); assert(row.location.tag); }
    assert(!result.fields.some(x => x.category === 'residence'), 'shipping prose must not invent a required residence field');
    assert(result.unknowns.some(x => x.topic === 'eligibility_and_mandatory_requirements'));
  });
  await test('labels, required markers, choice labels and autocomplete only, never values/names', async () => {
    const fixture = mock({ [`${base}/feature/entry`]: `<title>入会</title><form><label for="mail">メールアドレス 必須</label><input id="mail" name="customer_email" type="email" required autocomplete="email" value="private@example.com"><label>お名前<input type="text" value="private-name" autocomplete="name"></label><label for="kana">フリガナ</label><input id="kana" type="text" aria-required="true"><label for="country">居住国</label><select id="country"><option value="JP-secret">日本</option><option value="KR-secret">韓国</option></select><label for="hidden">Hidden token</label><input id="hidden" type="hidden" name="csrf_secret" value="secret-value"><label for="pw">パスワード</label><input id="pw" type="password" value="password-value"><input aria-label="認証コード" name="auth_token" value="token-value"><textarea aria-label="住所">private-address</textarea></form>` });
    const r = await collectAssistance({ url: `${base}/feature/entry`, locale: 'ja' }, fixture.deps);
    assert.equal(r.fields.length, 5); const email = r.fields.find(x => x.category === 'email');
    assert.equal(email.required, true); assert.equal(email.autocomplete, 'email'); assert.equal(email.translatedLabel, 'メールアドレス');
    assert.equal(r.fields.find(x => x.category === 'name').required, null);
    assert.equal(r.fields.find(x => x.category === 'phoneticName').requiredBy, 'aria-required');
    assert.deepEqual(r.fields.find(x => x.category === 'residence').choices, ['日本', '韓国']);
    const output = JSON.stringify(r);
    for (const secret of ['private@example.com', 'private-name', 'private-address', 'JP-secret', 'csrf_secret', 'password-value', 'secret-value', 'token-value', 'auth_token']) assert(!output.includes(secret), secret);
    assert(r.fields.every(x => x.uncertainty === 'public_markup_only'));
  });
  await test('only two same-origin help/entry links followed; auth and query credential links omitted', async () => {
    const fixture = mock({ [`${base}/`]: `<a href="/help">ヘルプ</a><a href="/feature/entry">入会</a><a href="/guide">Guide</a><a href="https://other.example.com/help">Help</a><a href="/login">入会 login</a><a href="/help?token=private">Help</a><a href="/feature/entry?redirect_uri=private">入会</a><a href="/orders">配送</a>` });
    const r = await collectAssistance({ url: `${base}/` }, fixture.deps);
    assert.deepEqual(fixture.calls.map(x => x.url), [`${base}/`, `${base}/help`, `${base}/feature/entry`]);
    assert.equal(r.sources.length, 3); assert.equal(r.guides.length, 3);
    assert(!JSON.stringify(r).includes('private')); assert(!JSON.stringify(r).includes('other.example.com'));
  });
  await test('malformed, credentialed, non-HTTPS, private literals and unsafe queries rejected before fetching', async () => {
    const fixture = mock();
    for (const url of ['not a URL', '/help', 'https:official.example.com', 'https:///official.example.com', `${base}/help%252faccount`, 'http://official.example.com/help', 'https://u:p@official.example.com/', 'https://127.1/', 'https://0x7f000001/', 'https://10.0.0.1/', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://localhost/', 'https://host.internal/', 'https://official.example.com:8443/', `${base}/help?token=x`, `${base}/help?email=x`, `${base}/help?unknown=x`, `${base}/%ZZ`, `${base}/login`, `${base}/checkout`, 'https://official.example.com\\@127.0.0.1/']) await assert.rejects(collectAssistance({ url }, fixture.deps));
    assert.equal(fixture.calls.length, 0);
    assert.equal((await collectAssistance({ url: `${base}/goods?id=123&lang=ja` }, fixture.deps)).status, 'ok');
  });
  await test('private or mixed DNS responses blocked including redirects, and no exception leaks URL secrets', async () => {
    for (const list of [[{ address: '127.0.0.1', family: 4 }], [{ address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 }], [{ address: '8.8.8.8', family: 6 }]]) {
      const fixture = mock(); const r = await collectAssistance({ url: `${base}/help` }, { ...fixture.deps, lookup: async () => list });
      assert.equal(r.status, 'unavailable'); assert.equal(r.warnings[0].code, 'private_dns'); assert.equal(fixture.calls.length, 0);
    }
    for (const location of ['https://127.0.0.1/help', 'https://other.example.com/help', '/help?token=secret', '/account', 'http://official.example.com/help']) {
      const fixture = mock({ [`${base}/help`]: () => new Response(null, { status: 302, headers: { location } }) });
      const r = await collectAssistance({ url: `${base}/help` }, fixture.deps);
      assert.equal(r.status, 'unavailable'); assert.equal(fixture.calls.length, 1); assert(!JSON.stringify(r).includes('token=secret'));
    }
  });
  await test('same-origin public redirect accepted and final URL is evidence source', async () => {
    const fixture = mock({ [`${base}/help`]: () => new Response(null, { status: 301, headers: { location: '/guide' } }), [`${base}/guide`]: '<p>会員登録の案内です。</p>' });
    const r = await collectAssistance({ url: `${base}/help` }, fixture.deps);
    assert.equal(r.status, 'ok'); assert.equal(r.evidence[0].sourceUrl, `${base}/guide`);
  });
  await test('DNS rebinding destination is pinned into native HTTPS request without network', async () => {
    const original = https.request; let calls = 0;
    try {
      https.request = (_url, options, callback) => {
        calls++; assert.equal(options.method, 'GET'); assert.equal(options.agent, false); assert.equal(options.rejectUnauthorized, true);
        options.lookup('official.example.com', { all: true }, (err, answers) => { assert.equal(err, null); assert.deepEqual(answers, [{ address: '8.8.8.8', family: 4 }]); });
        const req = new EventEmitter(); req.end = () => { const res = Readable.from([Buffer.from('<title>Public</title>')]); res.statusCode = 200; res.headers = { 'content-type': 'text/html' }; callback(res); }; return req;
      };
      assert.equal((await collectAssistance({ url: `${base}/` }, { lookup: publicDNS, now })).status, 'ok'); assert.equal(calls, 1);
    } finally { https.request = original; }
  });
  await test('byte limits, content types, upstream failure and time budget fail closed', async () => {
    for (const factory of [() => html('x'.repeat(300)), () => new Response('bad', { status: 403 }), () => new Response('json', { headers: { 'content-type': 'application/json' } }), () => new Response('tiny', { headers: { 'content-type': 'text/html', 'content-length': '999' } })]) {
      const fixture = mock({ [`${base}/`]: factory }); const r = await collectAssistance({ url: `${base}/` }, { ...fixture.deps, maxBytes: 100 }); assert.equal(r.status, 'unavailable'); assert.equal(r.sources.length, 0);
    }
    const start = Date.now();
    const r = await collectAssistance({ url: `${base}/` }, { now, timeoutMs: 20, lookup: publicDNS, fetchImpl: () => new Promise(() => {}) });
    assert.equal(r.status, 'unavailable'); assert(r.warnings.some(x => x.code === 'timeout')); assert(Date.now() - start < 1000);
  });
  await test('missing evidence remains unknown, broken help is partial, malformed JSON-LD is ignored', async () => {
    const fixture = mock({ [`${base}/`]: '<title>Artist</title><script type="application/ld+json">not JSON</script><a href="/help">Help</a>', [`${base}/help`]: () => new Response('', { status: 404 }) });
    const r = await collectAssistance({ url: `${base}/` }, fixture.deps);
    assert.equal(r.status, 'partial'); assert.equal(r.fields.length, 0); assert.equal(r.images.length, 0);
    for (const topic of ['residence', 'phone', 'payment', 'delivery']) assert(r.unknowns.some(x => x.topic === topic));
    assert(r.unknowns.every(x => x.sourceUrl === `${base}/`));
  });
  await test('main content excludes newsletter requirements and multiline attribute fragments', async () => {
    const fixture = mock({ [base + '/']: '<header><p>電話番号が必須です。</p></header><main><div\n id="shipping-private-attribute"\n class="payment">配送について</div><p>海外への配送は行っていません。</p></main><footer><input required type="email" aria-label="メール"></footer>' });
    const r = await collectAssistance({url:base+'/'}, fixture.deps);
    assert.equal(r.fields.length,0);
    assert(!JSON.stringify(r.evidence).includes('shipping-private-attribute'));
    assert(!JSON.stringify(r.evidence).includes('電話番号が必須'));
    assert(r.evidence.some(x=>x.verbatim==='海外への配送は行っていません。'));
  });
  console.log(`Assistance: ${passed} checks passed (network-free)`);
} finally { globalThis.fetch = oldFetch; }
