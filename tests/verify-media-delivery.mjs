/* 이미지 전달: 재확인 규칙·제한 큐·실패 쉬기·공식 프로필 우선·출처 표기·img 상태 전이
 * 실제 모듈(media-refresh.mjs, service.mjs, ui.ts)을 그대로 돌린다. 네트워크 없음(수집기는 주입).
 * 음성 대조: 규칙을 일부러 깨뜨린 사본이 같은 단언에서 실패해야 한다. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
import * as media from '../backend/lib/live/media-refresh.mjs';
import { createLiveService } from '../backend/lib/live/service.mjs';
import { flushAllKv } from '../backend/lib/live/cache.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const tick = () => new Promise((r) => setImmediate(r));

/* ---------- 1. 재확인 규칙 ---------- */
const DAY = 864e5, NOW = Date.parse('2026-11-02T08:00:00Z');
const rule = (m, prev, extra = {}) => m.recheckDue(prev, { rule: 2, now: NOW, positiveMs: 14 * DAY, negativeMs: DAY, ...extra });
function ruleSuite(m) {
  ok(rule(m, undefined), 'no record → due');
  ok(!rule(m, { photo: 'https://x.example/a.jpg', at: NOW - DAY, v: 2 }), 'fresh positive → not due');
  ok(rule(m, { photo: 'https://x.example/a.jpg', at: NOW - 15 * DAY, v: 2 }), 'positive older than 14d → due');
  ok(rule(m, { photo: null, at: Date.parse('2026-09-29T17:18:45Z') }), '9/29 legacy negative (no rule version) → due');
  ok(rule(m, { photo: null, at: NOW - 60e3 }), 'recent negative under an older rule → due');
  ok(!rule(m, { photo: null, at: NOW - 60e3, v: 2 }), 'recent negative under current rule → not due');
  ok(rule(m, { photo: null, at: NOW - 2 * DAY, v: 2 }), 'negative past TTL → due');
  ok(!rule(m, { photo: 'https://x.example/a.jpg', at: 0 }, { positiveMs: Infinity }), 'positiveMs=Infinity keeps positives');
}
ruleSuite(media);
eq([1, 2, 3, 4, 5, 9].map(media.failureCooldownMs), [15 * 60e3, 60 * 60e3, 4 * 3600e3, 16 * 3600e3, 24 * 3600e3, 24 * 3600e3], 'failure cooldown 15m→1h→4h→16h→24h cap');

/* 음성 대조: 규칙 버전 비교를 지운 사본은 9/29 판정을 다시 보지 않아 같은 단언에서 실패해야 한다 */
{
  const src = fs.readFileSync(path.join(ROOT, 'backend/lib/live/media-refresh.mjs'), 'utf8');
  const broken = src.replace('if ((Number(prev.v) || 1) < rule) return true;', '');
  ok(broken !== src, 'mutation applied');
  const bm = await import('data:text/javascript;base64,' + Buffer.from(broken).toString('base64'));
  let failed = false; try { ruleSuite(bm); } catch { failed = true; }
  ok(failed, 'negative control: rule-version check removed → suite fails');
}

/* ---------- 2. 제한 큐: 상한 12·합치기·동시 3·실패 쉬기·성공 초기화 ---------- */
{
  let clock = NOW, active = 0, peak = 0; const gates = []; const outcome = new Map();
  const q = media.createRefreshQueue({ max: 12, concurrency: 3, now: () => clock, run: async (p) => {
    active++; peak = Math.max(peak, active); await new Promise((r) => gates.push(r)); active--;
    const o = outcome.get(p.id); if (o === 'throw') throw new Error('boom'); return o || { ok: true };
  } });
  const res = Array.from({ length: 14 }, (_, i) => q.enqueue('k' + i, { id: 'k' + i }));
  eq(res.filter((x) => x === 'queued').length, 12, '12 accepted'); eq(res.slice(12), ['full', 'full'], 'over cap → full');
  eq(q.enqueue('k0', { id: 'k0' }), 'duplicate', 'running key merges'); eq(q.enqueue('k11', { id: 'k11' }), 'duplicate', 'pending key merges');
  outcome.set('k1', { ok: false, reason: 'no_profile_link' }); outcome.set('k2', 'throw');
  while (gates.length || q.stats().pending || q.stats().active) { const g = gates.shift(); if (g) g(); await tick(); }
  await q.idle();
  eq(peak, 3, 'concurrency 3');
  eq(q.enqueue('k1', { id: 'k1' }), 'cooldown', 'failed key cools down'); eq(q.failureOf('k1').reason, 'no_profile_link', 'reason kept');
  eq(q.failureOf('k2').reason, 'error', 'thrown run → error reason');
  clock += 16 * 60e3; eq(q.enqueue('k1', { id: 'k1' }), 'queued', 'retries automatically after 15m');
  while (gates.length || q.stats().active) { const g = gates.shift(); if (g) g(); await tick(); } await q.idle();
  eq(q.failureOf('k1').count, 2, 'second consecutive failure'); clock += 30 * 60e3; eq(q.enqueue('k1', { id: 'k1' }), 'cooldown', 'second failure waits 1h');
  clock += 31 * 60e3; outcome.delete('k1'); eq(q.enqueue('k1', { id: 'k1' }), 'queued', 'retry after 1h');
  while (gates.length || q.stats().active) { const g = gates.shift(); if (g) g(); await tick(); } await q.idle();
  eq(q.failureOf('k1'), null, 'success resets failures');
  const st = q.stats(); ok(st.reasons.no_profile_link === 2 && st.reasons.error === 1, 'reason counters');
  ok(!JSON.stringify(st).includes('http'), 'stats carry counts only, no URLs');
}

/* ---------- 3. 사진 선택: 공식 먼저·출처 표기·재킷은 사진이 아니다 ---------- */
{
  const portrait = { status: 'verified', imageUrl: 'https://official.example/p.jpg', sourceUrl: 'https://official.example/profile', checkedAt: '2026-11-02T08:00:00.000Z' };
  const deezer = { photo: 'https://cdn.example/l.jpg', medium: 'https://cdn.example/m.jpg', at: NOW };
  eq(media.artistPhoto({ portrait, deezer }).kind, 'official-profile', 'official first');
  eq(media.artistPhoto({ portrait: { ...portrait, status: 'unavailable' }, deezer }).kind, 'deezer-artist', 'unverified portrait ignored');
  eq(media.artistPhoto({ deezer }), { url: deezer.medium, large: deezer.photo, kind: 'deezer-artist', sourceUrl: null, checkedAt: new Date(NOW).toISOString() }, 'deezer metadata');
  eq(media.artistPhoto({ deezer: { photo: null, at: NOW } }), null, 'negative record → no photo');
  eq(media.artistPhoto({ artwork: 'https://music.example/a.jpg' }), null, 'artwork never becomes an artist photo');
  eq(media.artistFallbackImage({ artwork: 'https://music.example/a.jpg' }).kind, 'album-cover', 'artwork fallback labelled album-cover');
  eq(media.posterMissingReason({ eligible: false }), 'no_image_source', 'no source');
  eq(media.posterMissingReason({ eligible: true, eventPoster: { none: true, at: 1 } }), 'event_page_has_no_image', 'page without image');
  eq(media.posterMissingReason({ eligible: true }), 'pending_event_page_check', 'pending');
}

/* ---------- 4. 실제 service 경로: artists() → 백그라운드 재확인 ---------- */
{
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lilac-media-delivery-'));
  const realNow = Date.now;
  try {
    const rows = Array.from({ length: 16 }, (_, i) => ({ id: 'artist-' + i, name: 'Artist ' + i, origin: 'jp', country: 'jp', chartHits: 100 - i, artwork: 'https://music.example/a' + i + '.jpg', links: { official: { url: 'https://artist' + i + '.example/' } } }));
    delete rows[1].links; delete rows[2].links; // 1·2: 공식 주소 없음 → 공식 재확인 대상 아님, Deezer만
    rows.push({ id: 'odd-js', name: 'Odd Js', origin: 'jp', country: 'jp', links: { official: { url: 'javascript:alert(1)' } } }); // 모르는·위험한 입력
    await mkdir(path.join(dir, 'live-cache'), { recursive: true });
    const now = realNow();
    await writeFile(path.join(dir, 'live-cache', 'kv-photos.json'), JSON.stringify({
      'artist-0': { photo: 'https://cdn.example/a0.jpg', medium: 'https://cdn.example/a0m.jpg', at: now, v: 2 },
      'artist-1': { photo: null, medium: null, at: now - 60e3, v: 2 },                  // 현재 규칙의 최근 '없음' → 다시 묻지 않는다
      'artist-2': { photo: null, medium: null, at: Date.parse('2026-09-29T17:18:45Z') }, // 9/29 옛 '없음' → 다시 묻는다
      ...Object.fromEntries(rows.slice(3).map((a) => [a.id, { photo: 'https://cdn.example/' + a.id + '.jpg', medium: null, at: now, v: 2 }])),
    }));
    const portraitCalls = []; let pActive = 0, pPeak = 0;
    const photoCalls = [];
    const svc = createLiveService({ dbDir: dir, readJson: async (k) => (k === 'artists' ? rows : []), getCharts: async () => ({}),
      portraitCollector: async (input) => {
        portraitCalls.push(input.artistId); pActive++; pPeak = Math.max(pPeak, pActive); await new Promise((r) => setTimeout(r, 5)); pActive--;
        if (input.artistId === 'artist-3') return { artistId: 'artist-3', status: 'unavailable', reason: 'no_profile_link' };
        if (input.artistId === 'artist-4') return { artistId: 'artist-999', status: 'verified', imageUrl: 'https://wrong.example/x.jpg', sourceUrl: 'https://wrong.example/', checkedAt: new Date(Date.now()).toISOString(), method: 'official-profile' }; // 다른 아티스트 소유
        return { artistId: input.artistId, status: 'verified', imageUrl: input.officialUrl + 'portrait.jpg', sourceUrl: input.officialUrl + 'profile', checkedAt: new Date(Date.now()).toISOString(), method: 'official-profile' };
      },
      artistPhotoLookup: async (names) => { photoCalls.push(names[0]); if (names.includes('Artist 2')) return { picture: 'https://cdn.example/a2.jpg', pictureMedium: 'https://cdn.example/a2m.jpg', fans: 1 }; return null; },
    });
    const first = await svc.artists({ edition: 'kr' });
    const a0 = first.items.find((x) => x.id === 'artist-0');
    eq([a0.photoKind, a0.photo, a0.photoLarge, a0.artworkKind], ['deezer-artist', 'https://cdn.example/a0m.jpg', 'https://cdn.example/a0.jpg', 'album-cover'], 'before revalidation: existing Deezer labelled honestly; artwork separate');
    const st0 = svc.mediaRefresh.status().portraitRefresh;
    eq(st0.queued, 12, 'portrait queue accepted 12'); ok(st0.full >= 1, 'rest deferred (full)');
    await svc.mediaRefresh.idle();
    ok((await svc.status()).realtime.topics.media?.at, 'successful media recovery emits an actual media update topic');
    ok(pPeak <= 3, 'portrait concurrency ≤3'); ok(!portraitCalls.includes('odd-js') && !portraitCalls.includes('artist-2'), 'unsafe/absent official URL never collected');
    eq(photoCalls, ['Artist 2'], 'only the legacy 9/29 negative was rechecked (fresh negative & positives skipped)');
    const second = await svc.artists({ edition: 'kr' });
    const by = Object.fromEntries(second.items.map((x) => [x.id, x]));
    eq([by['artist-0'].photoKind, by['artist-0'].photo, by['artist-0'].photoSourceUrl], ['official-profile', 'https://artist0.example/portrait.jpg', 'https://artist0.example/profile'], 'after revalidation: official first with source');
    eq([by['artist-2'].photoKind, by['artist-2'].photo], ['deezer-artist', 'https://cdn.example/a2m.jpg'], 'recovered from negative cache');
    eq([by['artist-1'].photo, by['artist-1'].artwork], [null, 'https://music.example/a1.jpg'], 'genuine missing stays missing; album art not promoted');
    eq(by['artist-4'].photoKind, 'deezer-artist', 'portrait owned by another artist rejected');
    eq(svc.mediaRefresh.failureOf('portrait', 'artist-3')?.reason, 'no_profile_link', 'failure reason recorded');
    const before3 = portraitCalls.filter((x) => x === 'artist-3').length;
    await svc.artists({ edition: 'kr' }); await svc.mediaRefresh.idle();
    eq(portraitCalls.filter((x) => x === 'artist-3').length, before3, 'cooldown: no immediate retry');
    Date.now = () => realNow() + 16 * 60e3;
    await svc.artists({ edition: 'kr' }); await svc.mediaRefresh.idle();
    eq(portraitCalls.filter((x) => x === 'artist-3').length, before3 + 1, 'automatic bounded retry after cooldown');
    Date.now = () => realNow() + 25 * 3600e3; // 공식 확인 24시간 경과
    const stale = await svc.artists({ edition: 'kr' });
    const s0 = stale.items.find((x) => x.id === 'artist-0');
    ok(s0.portrait === null && s0.photoKind !== 'official-profile', '24h portrait admission rule unchanged');
    await svc.mediaRefresh.idle(); await flushAllKv();
    const kv = JSON.parse(await readFile(path.join(dir, 'live-cache', 'kv-photos.json'), 'utf8'));
    eq([kv['artist-2'].v, !!kv['artist-2'].photo], [2, true], 'recheck persisted with rule version');
  } finally { Date.now = realNow; await rm(dir, { recursive: true, force: true }); }
}

/* ---------- 5. ui.img 상태 전이(실제 ui.ts를 변환해 실행) ---------- */
{
  const code = fs.readFileSync(path.join(ROOT, 'frontend/src/app/ui.ts'), 'utf8');
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: (n) => { if (n === './i18n') return { getLocale: () => 'ko', t: (k) => k }; throw new Error('Unmocked ' + n); }, URL, console });
  const ui = exports;
  const attr = (html, name) => (html.match(new RegExp(name + '="([^"]*)"')) || [])[1];
  const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  eq(attr(ui.img(null, 'x'), 'data-media-state'), 'missing', 'no URL → missing');
  eq(attr(ui.img('javascript:alert(1)', 'x'), 'data-media-state'), 'missing', 'unsafe URL → missing');
  const h = ui.img('https://a.example/large.jpg', 'x', '', { alternates: ['https://a.example/medium.jpg', 'javascript:alert(1)', 'https://a.example/large.jpg', 'data:text/html,1'] });
  eq(attr(h, 'data-media-state'), 'loading', 'URL → loading');
  eq(attr(h, 'data-alt'), 'https://a.example/medium.jpg', 'alternates: only safe, existing, distinct URLs');
  ok(attr(ui.img(null, 'x', '', { alternates: ['https://a.example/m.jpg'] }), 'data-media-state') === 'loading', 'missing primary falls to an existing alternate');
  function fakeImg(html) {
    const parent = { attrs: { 'data-media-state': attr(html, 'data-media-state') }, cls: new Set(), setAttribute(k, v) { this.attrs[k] = v; }, classList: { add: (c) => parent.cls.add(c) } };
    const el = { attrs: { 'data-alt': attr(html, 'data-alt') ? unesc(attr(html, 'data-alt')) : null }, src: unesc(attr(html, 'src')), removed: false, parentElement: parent,
      getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; }, remove() { this.removed = true; } };
    const fire = (name) => new Function(unesc(attr(html, name))).call(el);
    return { el, parent, load: () => fire('onload'), error: () => fire('onerror') };
  }
  let f = fakeImg(h); f.load(); eq(f.parent.attrs['data-media-state'], 'loaded', 'onload → loaded');
  f = fakeImg(h); f.error();
  eq([f.el.src, f.parent.attrs['data-media-state'], f.el.removed], ['https://a.example/medium.jpg', 'loading', false], 'first error → alternate, still loading');
  f.error(); eq([f.parent.attrs['data-media-state'], f.parent.cls.has('is-empty'), f.el.removed], ['error', true, true], 'alternates exhausted → error + placeholder');
  const plain = fakeImg(ui.img('https://a.example/x.jpg', 'x')); plain.error(); eq(plain.parent.attrs['data-media-state'], 'error', 'no alternates → error');
  ok(!/ data-alt="/.test(ui.img('https://a.example/x.jpg', 'x', '', { alternates: ['https://a.example/x.jpg'] })), 'alternate identical to src dropped');
}

console.log(`PASS media delivery (${checks} checks): versioned negative TTL + 9/29 legacy recheck (mutation fails), bounded queue 12/merge/concurrency3/backoff/reset, official-first honest photo kinds, album art never artist photo, service artists() background revalidation with ownership/unsafe-input rejection and 24h rule kept, ui.img missing/loading/loaded/error with existing-URL alternates`);
process.exit(0);
