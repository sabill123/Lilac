import { piaTag } from '../backend/lib/live/tickets-jp.mjs';
import { eventGeography, concertsInCountry } from '../backend/lib/live/geography.mjs';
import { Readable } from 'node:stream';
import { fetchArtwork, isPublicAddress, MAX_IMAGE_BYTES } from '../backend/lib/live/image-proxy.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { initCache, cached, revalidate, peek, cacheEvents } from '../backend/lib/live/cache.mjs';
import { weverseKind, membershipEvidence, matchesMembershipOwner, exposeMembership } from '../backend/lib/live/membership-policy.mjs';
import { weverseShopFacts, searchFanclub } from '../backend/lib/live/fanclub.mjs';
import { attachStream } from '../backend/lib/live/stream.mjs';
import { createLiveService } from '../backend/lib/live/service.mjs';
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
const dir = await mkdtemp(path.join(tmpdir(), 'lilac-production-live-'));
initCache(dir);
let service;
try {
  const imageFixture = (responses) => {
    const calls = [], streams = [];
    const request = (url, options, done) => {
      const req = new EventEmitter();
      req.end = () => queueMicrotask(() => {
        calls.push({ url: url.href, options });
        const spec = responses[calls.length - 1];
        if (!spec) return req.emit('error', Error('unexpected network request'));
        const body = Readable.from(spec.chunks || [Buffer.from([137, 80, 78, 71])], { highWaterMark: 1 });
        body.statusCode = spec.status || 200;
        body.headers = spec.headers || { 'content-type': 'image/png' };
        streams.push(body); done(body);
      });
      return req;
    };
    return { calls, streams, request, lookup: async () => [{ address: '93.184.216.34', family: 4 }] };
  };
  await test('Image transport allows genuine artwork and pins DNS while retaining hostname', async () => {
    const f = imageFixture([{}, {}]); let resolutions = 0;
    const img = await fetchArtwork('https://is1-ssl.mzstatic.com/image/artwork.png', { ...f, lookup: async () => { resolutions++; return [{ address: '93.184.216.34', family: 4 }]; } });
    assert.equal(img.type, 'image/png'); assert.equal(img.buf.length, 4); assert.equal(resolutions, 1);
    const opts = f.calls[0].options; assert.equal(opts.agent, false); assert.equal(opts.rejectUnauthorized, true);
    opts.lookup('is1-ssl.mzstatic.com', { all: true }, (error, addresses) => { assert.equal(error, null); assert.deepEqual(addresses, [{ address: '93.184.216.34', family: 4 }]); });
    assert.equal(resolutions, 1); assert.equal(new URL(f.calls[0].url).hostname, 'is1-ssl.mzstatic.com');
  });
  await test('Image proxy validates every redirect and accepts allowed CDN redirect', async () => {
    const f = imageFixture([{ status: 302, headers: { location: 'https://is2-ssl.mzstatic.com/art.png' } }, {}]);
    let resolutions = 0; await fetchArtwork('https://is1-ssl.mzstatic.com/art.png', { ...f, lookup: async () => { resolutions++; return [{ address: '93.184.216.34', family: 4 }]; } });
    assert.equal(f.calls.length, 2); assert.equal(resolutions, 2); assert.equal(f.streams[0].destroyed, true);
    for (const location of ['http://127.0.0.1/secret', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'https://localhost/', 'https://evil.example/image', 'https://is1-ssl.mzstatic.com.evil.example/', 'https://user:pass@is1-ssl.mzstatic.com/']) {
      const blocked = imageFixture([{ status: 302, headers: { location } }]);
      await assert.rejects(fetchArtwork('https://is1-ssl.mzstatic.com/image', blocked), e => e.status === 403);
      assert.equal(blocked.calls.length, 1); assert.equal(blocked.streams[0].destroyed, true);
    }
  });
  await test('Image proxy blocks private DNS, mixed answers and rebinding at next redirect', async () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '172.16.0.1', '192.168.0.1', '198.18.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1']) {
      assert.equal(isPublicAddress(address), false);
      const f = imageFixture([{}]);
      await assert.rejects(fetchArtwork('https://is1-ssl.mzstatic.com/image', { ...f, lookup: async () => [{ address, family: address.includes(':') ? 6 : 4 }] }), e => e.status === 403);
      assert.equal(f.calls.length, 0);
    }
    assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
    const mixed = imageFixture([{}]);
    await assert.rejects(fetchArtwork('https://is1-ssl.mzstatic.com/image', { ...mixed, lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }] }), e => e.status === 403);
    assert.equal(mixed.calls.length, 0);
    const rebound = imageFixture([{ status: 302, headers: { location: '/next.png' } }, {}]); let dnsCalls = 0;
    await assert.rejects(fetchArtwork('https://is1-ssl.mzstatic.com/image', { ...rebound, lookup: async () => [{ address: ++dnsCalls === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 }] }), e => e.status === 403);
    assert.equal(rebound.calls.length, 1);
  });
  await test('Image streaming aborts at 6MB without buffering the complete body', async () => {
    let yielded = 0, cancelled = false;
    async function* chunks() { try { for (let n = 0; n < 50; n++) { yielded++; yield Buffer.alloc(1024 * 1024); } } finally { cancelled = true; } }
    const f = imageFixture([{ chunks: chunks() }]);
    await assert.rejects(fetchArtwork('https://is1-ssl.mzstatic.com/large.png', f), e => e.status === 413);
    await new Promise(r => setImmediate(r));
    assert.ok(yielded < 50); assert.equal(cancelled, true); assert.equal(f.streams[0].destroyed, true); assert.equal(f.calls[0].options.signal.aborted, true);
    const declared = imageFixture([{ headers: { 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 1) } }]);
    await assert.rejects(fetchArtwork('https://is1-ssl.mzstatic.com/large.png', declared), e => e.status === 413);
    assert.equal(declared.streams[0].readableLength, 0);
  });
  await test('Image DNS timeout fails closed without contacting a destination', async () => {
    const f = imageFixture([{}]);
    await assert.rejects(fetchArtwork('https://is1-ssl.mzstatic.com/image', { ...f, timeoutMs: 10, lookup: () => new Promise(() => {}) }), e => e.status === 504);
    assert.equal(f.calls.length, 0);
  });
  await test('Image proxy rejects HTML, active SVG, compressed payloads and redirect loops', async () => {
    for (const headers of [{ 'content-type': 'text/html' }, { 'content-type': 'image/svg+xml' }, { 'content-type': 'image/png', 'content-encoding': 'gzip' }]) {
      const f = imageFixture([{ headers }]);
      await assert.rejects(fetchArtwork('https://is1-ssl.mzstatic.com/image', f), e => e.status === 502);
      assert.equal(f.streams[0].destroyed, true);
    }
    const loop = imageFixture(Array.from({ length: 5 }, () => ({ status: 302, headers: { location: '/loop' } })));
    await assert.rejects(fetchArtwork('https://is1-ssl.mzstatic.com/image', loop), e => e.status === 502);
    assert.equal(loop.calls.length, 5);
  });
  await test('Actual image endpoint rejects loopback and nonstandard ports before fetching', async () => {
    const routes = new Map();
    const api = createLiveService({ dbDir: dir, readJson: async (_k, fallback) => fallback, getCharts: async () => ({}) });
    api.register({ get: (url, fn) => routes.set(url, fn), post: () => {} });
    try {
      for (const u of ['http://127.0.0.1/', 'https://is1-ssl.mzstatic.com:8443/image']) {
        let status;
        const res = { status(code) { status = code; return this; }, end() {} };
        await routes.get('/api/live/img')({ query: { u } }, res);
        assert.equal(status, 403);
      }
    } finally { api.dispose(); }
  });
  await test('Japanese vendor geography uses venue evidence, not vendor or overseas defaults', () => {
    const festival = { provider: 'pia', country: 'KR', title: 'Xnterstellar Music Festival 2026', city: '海外', venue: '仁川パラダイスシティ' };
    assert.equal(eventGeography(festival).country, 'KR');
    assert.equal(concertsInCountry([festival], 'JP').length, 0);
    assert.equal(eventGeography({ ...festival, country: 'JP' }).country, 'KR');
    assert.equal(eventGeography({ provider: 'pia', country: 'KR', city: '海外' }).country, null);
    assert.equal(eventGeography({ provider: 'pia', country: 'JP', title: 'JAPAN TOUR', city: null, venue: null }).country, null);
    assert.equal(eventGeography({ provider: 'pia', country: 'JP', city: '海外', venue: '台北アリーナ' }).country, 'TW');
    assert.equal(eventGeography({ provider: 'eplus', country: 'JP', venue: 'Zepp Namba', city: '大阪府', description: '韓国出身のグループ' }).country, 'JP');
    assert.equal(eventGeography({ provider: 'pia', sourceCountry: 'JP' }).country, 'JP');
    assert.equal(eventGeography({ provider: 'pia', sourceCountry: 'KR', city: '東京都' }).country, null);
    assert.equal(eventGeography({ provider: 'pia', country: 'JP', venue: '東京 / ソウル' }).country, null);
  });
  await test('Pia ingestion does not translate overseas to Korea or default unknown venues to Japan', async () => {
    const originalFetch = globalThis.fetch;
    const locations = ['仁川パラダイスシティ(海外)', '台北アリーナ(海外)', '東京都', '海外'];
    globalThis.fetch = async () => new Response('<ul class="Y15-tag-eventlist__list">' + locations.map((location, i) => '<li><a href="https://t.pia.jp/pia/event/event.do?eventCd=fixture' + i + '"><h3>Fixture ' + i + '</h3><span class="Y15-tag-event_venue">' + location + '</span></a></li>').join('') + '</ul>');
    try { assert.deepEqual((await piaTag()).map(x => x.country), ['KR', 'TW', 'JP', null]); }
    finally { globalThis.fetch = originalFetch; }
  });
  await test('M!LK exact official title survives short-name normalization without weakening IU/NiziU', () => {
    const fc = { found: true, entry: 'https://sd-milk.com/about/membership', discoveredBy: 'search', facts: { title: '当サイトについて | M!LKオフィシャルサイト', name: 'PREMIUM MILK', fees: { annual: 4400 } } };
    assert.equal(exposeMembership(fc, { name: 'M!LK', nameOriginal: 'M!LK' }).found, true);
    assert.equal(matchesMembershipOwner(['M!LK'], [fc.facts.title]), true);
    assert.equal(matchesMembershipOwner(['M!LK'], ['https://sd-milk.com/about/membership']), false); // title is evidence, not a guessed ! -> i mapping
    assert.equal(matchesMembershipOwner(['IU'], ['NiziU OFFICIAL FANCLUB', 'https://niziu.com']), false);
    assert.equal(matchesMembershipOwner(['ME'], ['membership']), false);
    assert.equal(matchesMembershipOwner(['D.O.'], ['D.O. OFFICIAL FANCLUB']), true);
  });
  await test('Actual Japanese home excludes Korea/unknown venues but keeps confirmed Japan', async () => {
    const events = [
      { id: 'pia:fixture-festival', provider: 'pia', title: 'Xnterstellar Music Festival 2026', venue: '仁川パラダイスシティ', city: '海外', country: 'KR' },
      { id: 'pia:fixture-japan', provider: 'pia', title: 'Fixture Japan Concert', venue: 'Zepp Namba', city: '大阪府', country: 'JP' },
      { id: 'pia:fixture-unknown', provider: 'pia', title: 'Fixture JAPAN TOUR', country: 'JP' },
    ].map(x => ({ ...x, startDate: '2099-10-03', endDate: '2099-10-04', poster: 'https://fixture.example/image.png', kind: 'concert' }));
    await revalidate('jp-kpop', async () => ({ items: events, sources: [{ ok: true }] }));
    for (const key of ['kr-opens', 'kr-domestic', 'news-jp', 'eplus-search-']) await revalidate(key, async () => ({ items: [], sources: [{ ok: true }] }));
    const api = createLiveService({ dbDir: dir, readJson: async (_k, fallback) => fallback, getCharts: async () => ({}) });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw Error('offline fixture must not access network'); };
    try {
      const result = await api.home({ edition: 'jp' });
      assert.deepEqual(result.visiting.map(x => x.id), ['pia:fixture-japan']);
      assert.equal(result.visiting[0].direction, 'jp-visiting');
      assert.equal(result.visiting[0].country, 'JP'); assert.equal(result.visitingTotal, 1);
    } finally { api.dispose(); globalThis.fetch = originalFetch; }
  });
  await test('Cold all-source failure is an error, never a fresh empty result', async () => {
    const v = await cached('cold', 60000, async () => ({ items: [], sources: [{ provider: 'fixture', ok: false, error: '503' }] }));
    assert.equal(v.cache.state, 'error'); assert.equal(await peek('cold'), null);
    const recovered = await cached('cold', 60000, async () => ({ items: [{ id: 'recovered' }], sources: [{ ok: true }] }));
    assert.equal(recovered.items[0].id, 'recovered');
  });
  await test('Synchronous throw cannot poison inflight retries', async () => {
    await assert.rejects(revalidate('sync-failure', () => { throw Error('fixture'); }));
    const r = await revalidate('sync-failure', () => ({ items: [{ id: 'retry' }] }));
    assert.equal(r.value.items[0].id, 'retry');
  });
  await test('Failed refresh preserves content and marks it stale even inside TTL', async () => {
    const initial = await revalidate('stale', async () => ({ items: [{ id: 'old' }] }));
    await revalidate('stale', async () => { throw Error('HTTP 503'); });
    const v = await cached('stale', 60000, async () => ({ items: [] }));
    assert.equal(v.cache.state, 'stale'); assert.equal(v.items[0].id, 'old');
    assert.equal(v.cache.updatedAt, new Date(initial.at).toISOString()); assert.equal(v.cache.lastError, 'HTTP 503');
  });
  await test('Transient failures retry before the ordinary six-hour TTL', async () => {
    let called = false;
    await cached('stale', 6 * 3600000, async () => { called = true; return { items: [{ id: 'new' }] }; }, { retryAfterMs: 0 });
    await new Promise(r => setTimeout(r, 10));
    assert.equal(called, true); assert.equal((await peek('stale')).items[0].id, 'new');
  });
  await test('Peek exposes TTL expiry instead of pretending cached facts are current', async () => {
    const v = await peek('stale', { ttlMs: 0 }); assert.equal(v.cache.state, 'stale');
  });
  await test('Legacy cached group memberships are rejected when read', () => {
    const fc = { found: true, entry: 'https://neverland-japan.com/about/', discoveredBy: 'search', facts: { title: 'i-dle JAPAN OFFICIAL FANCLUB', name: 'NEVERLAND' } };
    assert.equal(exposeMembership(fc, { name: 'SOYEON' }).found, false);
    const shop = { found: true, entry: 'https://shop.weverse.io/ja/shop/JPY/artists/1/sales/2', facts: { shopArtist: 'BLACKPINK' } };
    assert.equal(exposeMembership(shop, { name: 'ROSE' }).found, false);
  });
  await test('Concurrent refreshes call the source only once', async () => {
    let calls = 0;
    await Promise.all(Array.from({ length: 8 }, () => revalidate('single-flight', async () => { calls++; await new Promise(r => setTimeout(r, 5)); return { items: [] }; })));
    assert.equal(calls, 1);
  });
  await test('Generic Weverse links and deceptive hosts are not membership evidence', async () => {
    for (const entry of ['https://weverse.io/', 'https://shop.weverse.io/', 'https://weverse.io/jennie', 'https://go.weverse.io/short']) assert.equal(membershipEvidence({ found: true, entry }), false);
    assert.equal(weverseKind('https://evilweverse.io/newjeans/membership'), null);
    assert.equal(weverseKind('https://shop.weverse.io.evil.example/artists/1/sales/2'), null);
    const f = await weverseShopFacts('https://shop.weverse.io/'); assert.equal(f.error, 'weverse-generic-link');
  });
  await test('Genuine artist membership tabs retain explicit evidence without invented fees', async () => {
    const url = 'https://weverse.io/newjeansofficial/media?tab=jpmembership';
    const f = await weverseShopFacts(url);
    assert.equal(f.membershipVerified, true); assert.equal(f.fees, null);
    assert.equal(membershipEvidence({ found: true, entry: 'https://go.weverse.io/fixture', facts: f }), true);
  });
  await test('Owner matching rejects short-name substring collisions and group ownership', () => {
    assert.equal(matchesMembershipOwner(['IU'], ['NiziU OFFICIAL FANCLUB', 'https://niziu.com']), false);
    assert.equal(matchesMembershipOwner(['IU'], ['IU JAPAN FANCLUB']), true);
    assert.equal(matchesMembershipOwner(['SOYEON'], ['i-dle JAPAN NEVERLAND']), false);
    assert.equal(matchesMembershipOwner(['Leon Niihama'], ['Niihama LEON Official Fan Club']), true);
  });
  await test('Candidate failures and partial search blocks do not become negative search cache', async () => {
    const opts = { wait: async () => {}, queryEngine: async () => ({ urls: ['https://fixture-fanclub.example/join'], limited: 0 }), readPage: async () => { throw Error('HTTP 503'); } };
    await assert.rejects(searchFanclub(['Fixture'], opts), /incomplete/);
    await assert.rejects(searchFanclub(['Fixture'], { ...opts, queryEngine: async () => ({ urls: [], limited: 1 }) }), /incomplete/);
    assert.equal(await searchFanclub(['Fixture'], { ...opts, queryEngine: async () => ({ urls: [], limited: 0 }) }), null);
  });
  await test('SSE disconnect removes client and heartbeat listeners', () => {
    const req = new EventEmitter(), res = new EventEmitter(), clients = new Set();
    res.write = () => true;
    const close = attachStream(req, res, clients, 'hello', { intervalMs: 5 });
    assert.equal(clients.size, 1); res.emit('close'); close();
    assert.equal(clients.size, 0); assert.equal(req.listenerCount('close'), 0); assert.equal(res.listenerCount('error'), 0);
  });
  await test('SSE backpressure disconnects instead of unbounded buffering', () => {
    const req = new EventEmitter(), res = new EventEmitter(), clients = new Set();
    let destroyed = false; res.write = () => false; res.destroy = () => { destroyed = true; };
    attachStream(req, res, clients, 'hello'); assert.equal(clients.size, 0); assert.equal(destroyed, true);
  });
  await test('A membership-page 503 is not persisted as fanclub not-found', async () => {
    const id = 'fixture-transient';
    await revalidate('fc-' + id, async () => ({ items: [], fc: { found: true, entry: 'https://fixture.example/feature/entry', facts: { name: 'Fixture Club', fees: { annual: 6000 } } } }));
    await writeFile(path.join(dir, 'live-cache', 'kv-fc-search.json'), JSON.stringify({ [id]: { url: null, at: Date.now() } }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      assert.ok(String(url).startsWith('https://fixture.example/'), 'no external requests permitted');
      return String(url) === 'https://fixture.example/' ? new Response('<html><a href="/feature/entry">新規入会 FAN CLUB</a></html>') : new Response('maintenance', { status: 503 });
    };
    const roster = [{ id, name: 'Fixture Transient', country: 'jp', official: 'https://fixture.example/' }];
    const routes = new Map();
    try {
      service = createLiveService({ dbDir: dir, readJson: async (k, fallback) => k === 'artists' ? roster : fallback, getCharts: async () => ({}) });
      service.register({ get: () => {}, post: (url, fn) => routes.set(url, fn) });
      await routes.get('/api/live/admin/refresh-fc')({ ip: '127.0.0.1', query: { ids: id } }, { json() {}, status() { return this; } });
      let pk;
      for (let i = 0; i < 100; i++) { pk = await peek('fc-' + id); if (pk.cache.lastError) break; await new Promise(r => setTimeout(r, 30)); }
      assert.equal(pk.fc.found, true); assert.match(pk.cache.lastError, /503/); assert.equal(pk.cache.state, 'stale');
    } finally { globalThis.fetch = originalFetch; service?.dispose(); service = null; }
  });
  await test('Fanclub list does not resurrect rejected clubs via roster community links; stale evidence survives', async () => {
    const roster = [
      { id: 'fixture-community', name: 'Fixture Community', country: 'kr', links: { weverse: { url: 'https://weverse.io/community' } } },
      { id: 'fixture-short', name: 'Fixture Short', country: 'kr' },
      { id: 'fixture-valid', name: 'Fixture Valid', country: 'kr' },
    ];
    await revalidate('fc-fixture-community', async () => ({ items: [], fc: { found: false, reason: 'wrong-owner' } }));
    await revalidate('fc-fixture-short', async () => ({ items: [], fc: { found: true, entry: 'https://go.weverse.io/unknown', facts: null } }));
    await revalidate('fc-fixture-valid', async () => ({ items: [], fc: { found: true, entry: 'https://fixture.example/join', facts: { name: 'Fixture Club', fees: { annual: 6000 } } } }));
    await revalidate('fc-fixture-valid', async () => { throw Error('upstream maintenance'); });
    const before = cacheEvents.listenerCount('change');
    service = createLiveService({ dbDir: dir, readJson: async (k, fallback) => k === 'artists' ? roster : fallback, getCharts: async () => ({}) });
    const routes = new Map(); service.register({ get: (url, fn) => routes.set(url, fn), post: () => {} });
    let result; await routes.get('/api/live/fanclub-list')({ query: { edition: 'jp' } }, { json: v => { result = v; }, status() { return this; } });
    assert.equal(result.items.find(x => x.artistId === 'fixture-community').found, false);
    assert.equal(result.items.find(x => x.artistId === 'fixture-short').found, false);
    const valid = result.items.find(x => x.artistId === 'fixture-valid'); assert.equal(valid.found, true); assert.equal(valid.cache.state, 'stale');
    service.dispose(); service = null; assert.equal(cacheEvents.listenerCount('change'), before);
  });
} finally {
  service?.dispose();
  await new Promise(r => setTimeout(r, 40));
  await rm(dir, { recursive: true, force: true });
}
console.log(`\n${passed} passed, 0 failed`);
