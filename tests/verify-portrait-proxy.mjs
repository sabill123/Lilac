#!/usr/bin/env node
/** /api/live/img trust for official-profile portraits (WebGL hero textures).
 * Calls the real createLiveService().register() handlers. Only portraitCollector and artworkFetcher are injected
 * (plus the required readJson/getCharts/dbDir test inputs). KV state lives in a fresh os.tmpdir() directory.
 * Global fetch is replaced by a recorder that throws, so any outbound request fails the run. No DB, env file or network.
 * Negative controls load in-memory mutated copies of service.mjs (data: URL, absolute imports) and expect the same scenario to fail.
 * Run: node tests/verify-portrait-proxy.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { flushAllKv } from '../backend/lib/live/cache.mjs';
import { fetchArtwork } from '../backend/lib/live/image-proxy.mjs';

const SERVICE_URL = new URL('../backend/lib/live/service.mjs', import.meta.url);
const SERVICE_SRC = fs.readFileSync(SERVICE_URL, 'utf8');
const realNow = Date.now, realFetch = globalThis.fetch;
const outbound = [];
globalThis.fetch = async (u) => { outbound.push(String(u)); throw new Error('network disabled in test: ' + u); };

const PROFILE_A = 'https://artist-a.example/img/profile.jpg?v=1';
const PROFILE_B = 'https://artist-b.example/photos/b.png';
const CDN = ['https://is1-ssl.mzstatic.com/image/thumb/Music/x/600x600bb.jpg', 'https://upload.wikimedia.org/wikipedia/commons/a/a0/x.jpg'];

async function scenario(createLiveService) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lilac-portrait-proxy-'));
  const rows = [
    { id: 'artist-a', name: 'Artist A', origin: 'jp', country: 'jp', links: { official: { url: 'https://artist-a.example/' } } },
    { id: 'artist-b', name: 'Artist B', origin: 'jp', country: 'jp', links: { official: { url: 'https://artist-b.example/' } } },
  ];
  const images = { 'artist-a': PROFILE_A, 'artist-b': PROFILE_B }; let collect = 0, fetched = [];
  let offset = 0; Date.now = () => realNow() + offset;
  const svc = createLiveService({
    dbDir: dir, readJson: async (key) => (key === 'artists' ? rows : []), getCharts: async () => ({}),
    portraitCollector: async ({ artistId, officialUrl }) => { collect++; return { artistId, status: 'verified', method: 'official-profile', imageUrl: images[artistId], sourceUrl: officialUrl + 'profile', checkedAt: new Date(Date.now()).toISOString() }; },
    artworkFetcher: async (key, opts) => { fetched.push({ key, trusted: opts?.trusted }); return { type: 'image/jpeg', buf: Buffer.from('jpeg:' + key) }; },
  });
  const routes = new Map(); svc.register({ get: (u, fn) => routes.set(u, fn), post() {} });
  const img = async (u) => {
    let status = 200, body = null, headers = {};
    const res = { set(h) { Object.assign(headers, h); return res; }, status(s) { status = s; return res; }, end() { return res; }, send(b) { body = b; return res; }, json(b) { body = b; return res; } };
    await routes.get('/api/live/img')({ query: { u } }, res); return { status, body, headers };
  };
  const verify = async (ids) => { let status = 200, body; const res = { set() { return res; }, status(s) { status = s; return res; }, json(b) { body = b; return res; } };
    await routes.get('/api/live/portraits')({ query: { ids } }, res); assert.equal(status, 200, 'portrait route'); return body; };
  const denied = async (u, msg) => { const before = fetched.length; const r = await img(u); assert.equal(r.status, 403, `${msg}: expected 403 for ${u}, got ${r.status}`); assert.equal(fetched.length, before, `${msg}: fetcher called for ${u}`); };
  try {
    // 0. before any verified portrait, the exact profile URL is not trusted
    await denied(PROFILE_A, 'unverified profile');
    assert.equal((await img('not a url')).status, 400);
    // 1. fresh, roster-owned official profile → exact URL proxied
    const v = await verify('artist-a,artist-b');
    assert.equal(v.items.find((x) => x.id === 'artist-a').portrait.imageUrl, PROFILE_A); assert.equal(collect, 2);
    const ok = await img(PROFILE_A);
    assert.equal(ok.status, 200, 'fresh official profile URL rejected'); assert.equal(ok.headers['content-type'], 'image/jpeg');
    assert.equal(String(ok.body), 'jpeg:' + PROFILE_A); assert.equal(fetched.length, 1); assert.equal(fetched[0].key, PROFILE_A);
    assert.equal(fetched[0].trusted(PROFILE_A), true); assert.equal(fetched[0].trusted('https://artist-a.example/img/other.jpg'), false, 'fetcher got host-wide trust');
    assert.equal((await img(PROFILE_B)).status, 200);
    // 2. same host other path / other query / no query / fragment / scheme / port / unregistered host → 403, no fetch
    for (const u of ['https://artist-a.example/img/other.jpg', 'https://artist-a.example/img/profile.jpg?v=2', 'https://artist-a.example/img/profile.jpg',
      'https://artist-a.example/img/profile.jpg?v=1&x=1', 'https://artist-a.example/img/profile.jpg?v=1#f', 'http://artist-a.example/img/profile.jpg?v=1',
      'https://artist-a.example:8443/img/profile.jpg?v=1', 'https://cdn.artist-a.example/img/profile.jpg?v=1', 'https://stranger.example/img/profile.jpg?v=1',
      'https://artist-b.example/photos/a.png']) await denied(u, 'non-exact');
    // 3. repeat exact URL is a cache hit (no second fetch)
    assert.equal((await img(PROFILE_A)).status, 200); assert.equal(fetched.length, 2);
    // 4. 24h expiry: cached bytes must not be served once the portrait is no longer current
    offset = 24 * 3600e3 + 60e3;
    await denied(PROFILE_A, 'expired (24h) portrait cache hit');
    await denied(PROFILE_B, 'expired (24h) portrait cache hit');
    await verify('artist-a'); assert.equal(collect, 3);
    assert.equal((await img(PROFILE_A)).status, 200, 're-verified profile rejected'); assert.equal(fetched.length, 2, 're-verified profile should reuse cache');
    // 5. official URL change: old record and its cached bytes are no longer trusted
    rows[0].links.official.url = 'https://artist-a-new.example/'; offset += 6 * 60e3; // roster cache is 5 min
    await denied(PROFILE_A, 'official URL changed, old cached profile');
    images['artist-a'] = 'https://artist-a-new.example/p.jpg'; await verify('artist-a'); assert.equal(collect, 4);
    assert.equal((await img('https://artist-a-new.example/p.jpg')).status, 200); await denied(PROFILE_A, 'superseded profile after re-verify');
    // 6. artist dropped from roster: its stored portrait no longer grants trust
    await verify('artist-b'); assert.equal((await img(PROFILE_B)).status, 200);
    rows.splice(1, 1); offset += 6 * 60e3; await denied(PROFILE_B, 'artist removed from roster');
    // 7. fixed CDN allowlist unchanged (no portrait needed)
    for (const u of CDN) { const before = fetched.length; const r = await img(u); assert.equal(r.status, 200, 'fixed CDN rejected: ' + u); assert.equal(fetched.length, before + 1); }
    assert.equal(outbound.length, 0, 'outbound network attempted: ' + outbound.join(', '));
  } finally { svc.dispose(); await flushAllKv(); Date.now = realNow; await rm(dir, { recursive: true, force: true }); }
}

/* real fetchArtwork with the injected trust function: transport fully faked (no DNS, no socket) */
async function redirectCharacterization() {
  const trusted = (h) => h === PROFILE_A;
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const reply = (statusCode, headers = {}, body = null) => (url, opts, cb) => {
    const { Readable } = Readable_; const r = Readable.from(body ? [body] : []); Object.assign(r, { statusCode, headers });
    return { once() {}, end() { cb(r); } };
  };
  let hop = 0; const chain = (steps) => (url, opts, cb) => reply(...steps[Math.min(hop++, steps.length - 1)])(url, opts, cb);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
  hop = 0; const direct = await fetchArtwork(PROFILE_A, { trusted, lookup, request: chain([[200, { 'content-type': 'image/jpeg', 'content-length': '3' }, jpeg]]) });
  assert.equal(direct.type, 'image/jpeg');
  hop = 0; const sameHost = await fetchArtwork(PROFILE_A, { trusted, lookup, request: chain([[302, { location: '/any/other/path.jpg' }], [200, { 'content-type': 'image/jpeg', 'content-length': '3' }, jpeg]]) }).then(() => 'allowed', (e) => e.status);
  hop = 0; const offHost = await fetchArtwork(PROFILE_A, { trusted, lookup, request: chain([[302, { location: 'https://stranger.example/x.jpg' }]]) }).then(() => 'allowed', (e) => e.status);
  assert.equal(offHost, 403, 'redirect off the trusted host must be refused');
  return { sameHost };
}
const Readable_ = await import('node:stream');

const { createLiveService } = await import(SERVICE_URL.href);
let passed = 0; const failures = [];
try { await scenario(createLiveService); passed++; console.log('ok   real service: exact fresh roster-owned profile URL only; 24h expiry, official URL change and roster removal revoke cached hits; fixed CDN kept'); }
catch (e) { failures.push('real service'); console.log('FAIL real service\n     ' + String(e.message).split('\n')[0]); }
let note = '';
try { const r = await redirectCharacterization(); passed++; note = r.sameHost; console.log('ok   real fetchArtwork: off-host redirect from a trusted profile refused (403)'); }
catch (e) { failures.push('fetchArtwork redirect'); console.log('FAIL fetchArtwork redirect\n     ' + String(e.message).split('\n')[0]); }

const abs = (src) => src.replace(/from '(\.\.?\/[^']+)'/g, (_, p) => `from '${new URL(p, SERVICE_URL).href}'`);
const mutate = (from, to) => { const hit = typeof from === 'string' ? SERVICE_SRC.includes(from) : from.test(SERVICE_SRC); assert.ok(hit, 'mutation anchor missing: ' + from); return SERVICE_SRC.replace(from, to); };
const controls = [
  ['host-wide trust instead of exact href', () => mutate('officialImages.has(href)', '[...officialImages].some(x=>new URL(x).hostname===new URL(href).hostname)')],
  ['24h freshness dropped (raw stored portrait)', () => mutate("{ const p=currentPortrait(a);if(p?.method!=='official-profile'", "{ const p=portraits.get(a.id);if(p?.method!=='official-profile'")],
  ['roster ownership dropped (any fresh stored portrait)', () => mutate(".flatMap(a => { const p=currentPortrait(a);if(p?.method", ".concat([...(portraits.map?.values()||[])].map(r=>({id:r.artistId}))).flatMap(a => { const r=portraits.get(a.id),p=r?.status==='verified'&&Date.now()-Date.parse(r.checkedAt)<864e5?r:null;if(p?.method")],
  ['official trust removed (poster-only, the original bug)', () => mutate('isKnownPoster(href) || officialImages.has(href)', 'isKnownPoster(href)')],
];
for (const [name, make] of controls) {
  let mod; try { mod = await import('data:text/javascript;base64,' + Buffer.from(abs(make())).toString('base64')); }
  catch (e) { failures.push('negative control load: ' + name); console.log('FAIL negative control could not load: ' + name + ' -> ' + e.message); continue; }
  try { await scenario(mod.createLiveService); failures.push('negative control passed: ' + name); console.log('FAIL negative control passed (assertion too weak): ' + name); }
  catch (e) { passed++; console.log('ok   negative control fails as expected: ' + name + ' -> ' + String(e.message).split('\n')[0]); }
}
globalThis.fetch = realFetch;
console.log(`\nnote: same-host redirect from a trusted exact profile URL is ${note === 'allowed' ? 'ALLOWED by fetchArtwork (any path on that host)' : 'refused (' + note + ')'}; injected transport, not live bytes.`);
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.log(' x ' + f)); process.exit(1); }
process.exit(0);
