/* 표시 이름 경로(GET /api/live/display-names) — 오프라인(위키백과 대신 주입한 수집기) */
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os'; import path from 'node:path';
import { createLiveService } from '../backend/lib/live/service.mjs';
import { flushAllKv } from '../backend/lib/live/cache.mjs';
import { rosterDisplayName, lookupTitle, displayNameIdentity } from '../backend/lib/live/display-names.mjs';

const dir = await mkdtemp(path.join(os.tmpdir(), 'lilac-display-names-'));
const FIVE = [
  { id: 'official髭男dism', name: 'Official髭男dism', nameOriginal: 'Official髭男dism', nameJa: 'Official髭男dism', country: 'jp', appleGenre: 'J-Pop', searchTerm: 'OFFICIAL HIGE DANDISM', appleArtistId: '1' },
  { id: 'マカロニえんぴつ', name: 'マカロニえんぴつ', nameOriginal: 'マカロニえんぴつ', nameJa: 'マカロニえんぴつ', country: 'jp', appleGenre: 'ロック', searchTerm: 'Macaroni Empitsu', appleArtistId: '2' },
  { id: 'あいみょん', name: 'あいみょん', nameOriginal: 'あいみょん', nameJa: 'あいみょん', country: 'jp', appleGenre: 'J-Pop', searchTerm: 'aimyon', appleArtistId: '3' },
  { id: 'わ-すた', name: 'わーすた', nameOriginal: 'わーすた', nameJa: 'わーすた', country: 'jp', appleGenre: 'J-Pop', searchTerm: 'Wasuta', appleArtistId: '4' },
  { id: '乃木坂46', name: '乃木坂46', nameOriginal: '乃木坂46', nameJa: '乃木坂46', country: 'jp', appleGenre: 'J-Pop', searchTerm: 'Nogizaka46', appleArtistId: '5' },
];
const rows = [
  ...FIVE,
  { id: 'mga', name: 'Mrs. GREEN APPLE', nameOriginal: 'Mrs. GREEN APPLE', country: 'jp', appleGenre: 'J-Pop', appleArtistId: '6' },
  { id: 'bts', name: 'BTS', country: 'kr', appleGenre: 'K-Pop', appleArtistId: '7' },
  { id: 'bol4', name: '볼빨간사춘기', country: 'kr', appleGenre: 'K-Pop', appleArtistId: '8' },
  { id: 'ive', name: '아이브', nameJa: 'IVE', country: 'kr', appleGenre: 'K-Pop', appleArtistId: '9' },
  { id: 'sixtones', name: 'ストーンズ六', nameOriginal: 'ストーンズ六', searchTerm: 'SixTONES', country: 'jp', appleGenre: 'J-Pop', appleArtistId: '10' },
  { id: 'nolink', name: '未知のバンド', country: 'jp', appleGenre: 'J-Pop', appleArtistId: '11' },
  { id: 'omori', name: '大森元貴', country: 'jp', appleGenre: 'J-Pop', appleArtistId: '13' },
  { id: 'badread', name: '偽読歌手', country: 'jp', appleGenre: 'J-Pop', appleArtistId: '14' },
  { id: 'flaky', name: '不安定ユニット', country: 'jp', appleGenre: 'J-Pop', appleArtistId: '12' },
  ...Array.from({ length: 24 }, (_, i) => ({ id: 'many-' + i, name: '多数' + i + '号', country: 'jp', appleGenre: 'J-Pop', appleArtistId: String(100 + i) })),
];
const KO = { 'Official髭男dism': '오피셜히게단디즘', 'マカロニえんぴつ': '마카로니엔피쓰', 'あいみょん': '아이묭', 'わーすた': '와스타', '乃木坂46': '노기자카46' };
const calls = { ko: [], ja: [] };
let delay = 20, flakyFails = true, active = 0, peak = 0;
const page = (t) => `https://ko.wikipedia.org/wiki/${encodeURIComponent(t)}`;
const ko = async (titles) => {
  calls.ko.push(titles); active++; peak = Math.max(peak, active);
  await new Promise((r) => setTimeout(r, delay)); active--;
  const out = new Map(), meta = new Map(), checked = new Set();
  for (const t of titles) {
    if (t === '不安定ユニット' && flakyFails) continue;            // 실패: checked에 없음
    checked.add(t);
    if (KO[t]) { out.set(t, [KO[t]]); meta.set(t, { title: KO[t], url: page(KO[t]), via: 'title' }); }
    if (t === 'ストーンズ六') { out.set(t, ['스톤즈']); meta.set(t, { title: 'SixTONES', url: page('SixTONES'), via: 'lead' }); }
    if (t.startsWith('多数')) { out.set(t, ['다수']); meta.set(t, { title: '다수', url: 'https://evil.example/x', via: 'title' }); }
  }
  const readings = new Map();
  if (titles.includes('大森元貴')) readings.set('大森元貴', { kana: 'おおもり もとき', sourceUrl: 'https://ja.wikipedia.org/wiki/%E5%A4%A7%E6%A3%AE%E5%85%83%E8%B2%B4' });
  if (titles.includes('あいみょん')) readings.set('あいみょん', { kana: 'あいみょん', sourceUrl: 'https://ja.wikipedia.org/wiki/x' });
  if (titles.includes('偽読歌手')) readings.set('偽読歌手', { kana: '1996年', sourceUrl: 'https://evil.example/' });
  out.checked = checked; out.meta = meta; out.readings = readings; return out;
};
const ja = async (titles) => {
  calls.ja.push(titles);
  const out = new Map(), meta = new Map(), checked = new Set(titles);
  if (titles.includes('볼빨간사춘기')) { out.set('볼빨간사춘기', '赤頬思春期'); meta.set('볼빨간사춘기', { title: '赤頬思春期', url: 'https://ja.wikipedia.org/wiki/%E8%B5%A4%E9%A0%AC%E6%80%9D%E6%98%A5%E6%9C%9F', via: 'title' }); }
  out.checked = checked; out.meta = meta; return out;
};
/* 규칙 1 시절의 없음 기록(읽기 모름)은 규칙 2에서 무시되어야 한다 */
await mkdir(path.join(dir, 'live-cache'), { recursive: true });
const omoriRow = rows.find((x) => x.id === 'omori');
await writeFile(path.join(dir, 'live-cache', 'kv-display-names.json'), JSON.stringify({ ['ko|r1|omori|' + displayNameIdentity({ ...omoriRow, origin: 'jp' }, '大森元貴')]: { id: 'omori', identity: displayNameIdentity({ ...omoriRow, origin: 'jp' }, '大森元貴'), locale: 'ko', rule: 1, title: '大森元貴', status: 'none', name: null, at: Date.now() } }));
const make = (waitMs = 1500) => createLiveService({ dbDir: dir, readJson: async (k) => (k === 'artists' ? rows : []), getCharts: async () => ({}), displayNameCollectors: { ko, ja }, displayNameWaitMs: waitMs });
let svc = make();
const routes = new Map();
svc.register({ get: (u, fn) => routes.set(u, fn), post() {} });
async function get(query, originalUrl) {
  let status = 200, body; const headers = {};
  const res = { set(k, v) { headers[k.toLowerCase()] = v; return res; }, status(s) { status = s; return res; }, json(x) { body = x; return res; } };
  await routes.get('/api/live/display-names')({ query, originalUrl }, res);
  return { status, body, headers };
}
const byId = (b) => Object.fromEntries(b.items.map((x) => [x.id, x]));
const realNow = Date.now;
try {
  /* 순수 규칙 */
  assert.equal(rosterDisplayName({ name: 'Mrs. GREEN APPLE', nameKo: '미세스 그린 애플' }, 'ko'), 'Mrs. GREEN APPLE');
  assert.equal(rosterDisplayName({ name: 'Official髭男dism' }, 'ko'), null);
  assert.equal(rosterDisplayName({ name: 'Official髭男dism', nameKo: '오피셜히게단디즘' }, 'ko'), '오피셜히게단디즘');
  assert.equal(rosterDisplayName({ name: '아이묭', nameJa: 'あいみょん' }, 'ja'), 'あいみょん');
  assert.equal(lookupTitle({ name: '아이묭', nameJa: 'あいみょん' }, 'ko'), 'あいみょん');
  assert.equal(lookupTitle({ name: 'BTS' }, 'ja'), null);

  /* 입력 검증 — 수집기는 부르지 않는다 */
  assert.equal((await get({ ids: 'bts' })).status, 400);
  assert.equal((await get({ locale: 'en', ids: 'bts' })).status, 400);
  assert.equal((await get({ locale: 'ko' })).status, 400);
  assert.equal((await get({ locale: 'ko', ids: Array(21).fill('bts').join(',') })).status, 400);
  assert.equal((await get({ locale: 'ko', ids: ['bts', 'mga'] })).status, 400);
  assert.equal((await get({ locale: 'ko', ids: 'bts,https://evil.example/' })).status, 404);
  assert.equal((await get({ locale: 'ko', ids: '오피셜히게단디즘' })).status, 404);
  assert.equal(calls.ko.length + calls.ja.length, 0);

  /* 로스터에 이미 있는 이름은 바로(수집기 없이), 라틴 브랜드는 그대로 */
  const r0 = await get({ locale: 'ko', ids: 'mga,bts,bol4' });
  assert.equal(r0.headers['cache-control'], 'private, no-store');
  assert.deepEqual(r0.body.items.map((x) => [x.name, x.method, x.status]), [['Mrs. GREEN APPLE', 'roster', 'resolved'], ['BTS', 'roster', 'resolved'], ['볼빨간사춘기', 'roster', 'resolved']]);
  const r1 = byId((await get({ locale: 'ja', ids: 'ive,bts,あいみょん' })).body);
  assert.equal(r1.ive.name, 'IVE'); assert.equal(r1.bts.name, 'BTS'); assert.equal(r1['あいみょん'].name, 'あいみょん');
  assert.equal(calls.ko.length + calls.ja.length, 0);

  /* 처음: 다섯 이름을 한 묶음으로, 동시에 두 번 물어도 수집기 1회 */
  const ids5 = FIVE.map((a) => a.id).join(',');
  const [a, b] = await Promise.all([get({ locale: 'ko', ids: ids5 }), get({ locale: 'ko', ids: ids5 })]);
  assert.equal(calls.ko.length, 1); assert.equal(calls.ko[0].length, 5);
  for (const body of [a.body, b.body]) {
    assert.equal(body.pending, false);
    for (const x of body.items) { assert.equal(x.method, 'wikipedia-langlink'); assert.equal(x.status, 'resolved'); assert.equal(x.locale, 'ko'); assert.match(x.sourceUrl, /^https:\/\/ko\.wikipedia\.org\/wiki\//); }
  }
  assert.deepEqual(a.body.items.map((x) => x.name), ['오피셜히게단디즘', '마카로니엔피쓰', '아이묭', '와스타', '노기자카46']);
  await get({ locale: 'ko', ids: ids5 }); assert.equal(calls.ko.length, 1);

  /* 읽기: 이름은 없음(unknown)이어도 검증된 가나 읽기는 따로, name은 null 그대로 */
  const o = byId((await get({ locale: 'ko', ids: 'omori,badread' })).body);
  assert.ok(calls.ko.some((t) => t.includes('大森元貴')), 'rule-1 negative cache must not suppress lookup');
  assert.deepEqual([o.omori.name, o.omori.method, o.omori.status, o.omori.readingKana, o.omori.readingMethod], [null, null, 'unknown', 'おおもり もとき', 'ja-wikipedia-lead']);
  assert.match(o.omori.readingSourceUrl, /^https:\/\/ja\.wikipedia\.org\/wiki\//);
  assert.deepEqual([o.badread.name, o.badread.readingKana, o.badread.readingMethod], [null, null, null]);
  assert.ok(!('readingSourceUrl' in o.badread));
  const n9 = calls.ko.length; assert.equal(byId((await get({ locale: 'ko', ids: 'omori' })).body).omori.readingKana, 'おおもり もとき'); assert.equal(calls.ko.length, n9);
  /* 로스터 이름·찾음에도 같은 모양(reading 필드) */
  const shape = byId((await get({ locale: 'ko', ids: 'mga,あいみょん' })).body);
  assert.deepEqual([shape.mga.readingKana, shape.mga.readingMethod], [null, null]);
  assert.equal(shape['あいみょん'].name, '아이묭'); assert.equal(shape['あいみょん'].readingKana, 'あいみょん');

  /* 한국 아티스트의 일본어 표기 */
  const j = byId((await get({ locale: 'ja', ids: 'bol4' })).body);
  assert.equal(j.bol4.name, '赤頬思春期'); assert.equal(j.bol4.method, 'wikipedia-langlink'); assert.match(j.bol4.sourceUrl, /^https:\/\/ja\.wikipedia\.org\//);

  /* 본문 괄호에서 뽑은 한글이 로마자와 안 맞으면 없음(지어내지 않는다), 진짜 없음도 없음 — 둘 다 다시 묻지 않는다 */
  const u = byId((await get({ locale: 'ko', ids: 'sixtones,nolink' })).body);
  assert.deepEqual([u.sixtones.name, u.sixtones.status, u.nolink.name, u.nolink.status], [null, 'unknown', null, 'unknown']);
  const n0 = calls.ko.length; await get({ locale: 'ko', ids: 'sixtones,nolink' }); assert.equal(calls.ko.length, n0);

  /* 실패는 없음이 아니다: unavailable + retryAfterMs, 쉬는 동안 다시 부르지 않고, 쉼이 끝나면 다시 */
  const f1 = byId((await get({ locale: 'ko', ids: 'flaky' })).body);
  assert.equal(f1.flaky.status, 'unavailable'); assert.ok(f1.flaky.retryAfterMs > 0); assert.equal(f1.flaky.name, null);
  const n1 = calls.ko.length; await get({ locale: 'ko', ids: 'flaky' }); assert.equal(calls.ko.length, n1);
  flakyFails = false; Date.now = () => realNow() + 2 * 60e3;
  const f2 = byId((await get({ locale: 'ko', ids: 'flaky' })).body);
  assert.equal(calls.ko.length, n1 + 1); assert.equal(f2.flaky.status, 'unknown');
  Date.now = realNow;

  /* 느린 수집기: 기다림 상한을 넘기면 pending, 같은 요청을 다시 하면 결과(추가 호출 없음) */
  await svc.displayNameIdle(); svc.dispose(); await flushAllKv();
  svc = make(50); routes.clear(); svc.register({ get: (u2, fn) => routes.set(u2, fn), post() {} });
  delay = 300;
  const many = rows.filter((x) => x.id.startsWith('many-'));
  const p1 = await get({ locale: 'ko', ids: many.slice(0, 20).map((x) => x.id).join(',') });
  assert.equal(p1.body.pending, true); assert.ok(p1.body.items.every((x) => x.status === 'pending' && x.name === null));
  /* 대기열 20건이 차 있으면 나머지는 넣지 않고 pending */
  const p2 = await get({ locale: 'ko', ids: many.slice(20).map((x) => x.id).join(',') });
  assert.ok(p2.body.items.every((x) => x.status === 'pending'));
  await svc.displayNameIdle();
  assert.ok(calls.ko.every((t) => t.length <= 20)); assert.equal(peak, 1);
  const before = calls.ko.length;
  const p3 = await get({ locale: 'ko', ids: many.slice(0, 20).map((x) => x.id).join(',') });
  assert.equal(calls.ko.length, before); assert.equal(p3.body.pending, false);
  /* 출처 URL은 위키백과만 */
  assert.ok(p3.body.items.every((x) => x.name === '다수' && x.method === 'wikipedia-langlink' && !('sourceUrl' in x)));
  const p4 = await get({ locale: 'ko', ids: many.slice(20).map((x) => x.id).join(',') });
  await svc.displayNameIdle();
  assert.equal(byId((await get({ locale: 'ko', ids: 'many-23' })).body)['many-23'].status, 'resolved');
  void p4;

  /* 재시작해도(KV) 다시 묻지 않는다 · 로스터 행이 바뀌면(신원) 다시 */
  svc.dispose(); await flushAllKv();
  const kvFile = JSON.parse(await readFile(path.join(dir, 'live-cache', 'kv-display-names.json'), 'utf8'));
  assert.ok(Object.keys(kvFile).some((k) => k.startsWith('ko|r2|あいみょん|')));
  assert.ok(!Object.values(kvFile).some((v) => v.status === 'failed'));
  assert.equal(Object.values(kvFile).find((v) => v.id === 'omori' && v.rule === 2).readingKana, 'おおもり もとき');
  svc = make(); routes.clear(); svc.register({ get: (u2, fn) => routes.set(u2, fn), post() {} }); delay = 5;
  const c0 = calls.ko.length;
  const warm = await get({ locale: 'ko', ids: ids5 });
  assert.equal(calls.ko.length, c0); assert.ok(warm.body.items.every((x) => x.status === 'resolved'));
  rows.find((x) => x.id === 'あいみょん').appleArtistId = '333';
  svc.dispose(); svc = make(); routes.clear(); svc.register({ get: (u2, fn) => routes.set(u2, fn), post() {} });
  const changed = byId((await get({ locale: 'ko', ids: 'あいみょん' })).body);
  assert.equal(calls.ko.length, c0 + 1); assert.equal(changed['あいみょん'].name, '아이묭');
  /* 이상한 글자의 id도 정확히 */
  rows.push({ id: 'odd,/&', name: '変な名前', country: 'jp', appleArtistId: '999' });
  svc.dispose(); svc = make(); routes.clear(); svc.register({ get: (u2, fn) => routes.set(u2, fn), post() {} });
  const odd = await get({ ids: 'odd,/&', locale: 'ja' }, '/api/live/display-names?locale=ja&ids=odd%2C%2F%26');
  assert.equal(odd.status, 200); assert.equal(odd.body.items[0].id, 'odd,/&'); assert.equal(odd.body.items[0].name, '変な名前');
  console.log('PASS display-names: roster-id only, ko/ja roster-first (Latin brands kept), one batched lookup + singleflight, wiki-only sourceUrl, lead-name fit check, unknown vs failure (cooldown, not persisted), bounded wait → pending → retry, queue 20, KV restart + identity invalidation, private no-store');
} finally { Date.now = realNow; await svc.displayNameIdle?.(); svc.dispose(); await flushAllKv(); await rm(dir, { recursive: true, force: true }); }
