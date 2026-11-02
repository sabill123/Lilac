/* 굿즈 검색 신선도·HMV 파서·형식 분류 — 네트워크 없이(fetch를 가짜로 바꾼다).
 * 실행: node tests/verify-goods-freshness.mjs
 *
 * 운영(2026-10-22)에서 본 문제를 고정한다
 *  1) 몇 주 묵은 굿즈 캐시를 첫 요청에 현재 값처럼 냈다(stale-while-revalidate만 있고 상한이 없었다).
 *  2) 백그라운드 갱신이 이 프로세스 메모리의 최근 검색어만 봐서 재시작 뒤·추천 검색어는 갱신되지 않았다.
 *  3) HMV가 쿠키 없는 요청에 중간 페이지를 줘서 ok:true count:0으로 조용히 비었다.
 *  4) HMV의 LP(重量盤レコード)·책(本)이 CD로 표시됐다.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseHmv, hmvSearch, hmvFormat, formatOf, searchGoods, tidyOffer } from '../backend/lib/live/goods.mjs';
import { initCache, cached, revalidate, KV } from '../backend/lib/live/cache.mjs';
import { createGoodsRefresher } from '../backend/lib/live/goods-refresh.mjs';
import { createLiveService } from '../backend/lib/live/service.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name} ${detail}`); } };
const DAY = 24 * 3600e3;
const realNow = Date.now;
const shiftClock = (ms) => { Date.now = () => realNow() + ms; };
const resetClock = () => { Date.now = realNow; };

/* HMV는 Shift_JIS 페이지다. 의존성 없이 TextDecoder('shift_jis')를 뒤집어 인코더를 만든다 */
const SJIS = new Map();
{
  const dec = new TextDecoder('shift_jis');
  for (let b = 0xa1; b <= 0xdf; b++) SJIS.set(dec.decode(new Uint8Array([b])), [b]);
  for (const lead of [...Array(0x1f).keys()].map((i) => 0x81 + i).concat([...Array(0x1d).keys()].map((i) => 0xe0 + i))) {
    for (let tr = 0x40; tr <= 0xfc; tr++) {
      if (tr === 0x7f) continue;
      const ch = dec.decode(new Uint8Array([lead, tr]));
      if (ch.length === 1 && ch !== '\ufffd' && !SJIS.has(ch)) SJIS.set(ch, [lead, tr]);
    }
  }
}
const toSjis = (s) => new Uint8Array([...s].flatMap((c) => (c.charCodeAt(0) < 0x80 ? [c.charCodeAt(0)] : SJIS.get(c) || [0x3f])));

/* ---------- 합성 HMV 페이지 (2026-10-22 실제 마크업 구조) ---------- */
const INTERSTITIAL = `<!DOCTYPE html><html lang="ja"><head><title></title></head><body><main id="main" role="main"><div id="contentsMainBoxInner">
<a href="/search/keyword_Mrs.%20GREEN%20APPLE/target_MUSIC/type_sr/">検索ページへ遷移する</a></div></main></body></html>`;
const NO_RESULT = `<html><body><main><div class="searchResultTitleBlock clearfix"><p class="text">zqx は見つかりませんでした。</p></div><div class="productNoListByEmpty"></div></main></body></html>`;
const item = ({ sku, title, cats, price, rel = '2025年07月08日', cart = 'カートに入れる' }) => `<li class="list clearfix">
  <div class="itemImg"><a href="https://www.hmv.co.jp/artist_x/item_y_${sku}" class="thumbnail"><img src="https://img.hmv.co.jp/image/jacket/190/${sku}.jpg" alt=""></a></div>
  <div class="itemText"><div class="categories"><p class="itemCategory">${cats.map((c) => `<span class="greenItemWide">${c}</span>`).join('')}</p>
  <h3 class="title"><a href="https://www.hmv.co.jp/artist_x/item_y_${sku}">${title}</a></h3></div>
  <div class="itemStates"><div class="text"><p class="name"><a href="https://www.hmv.co.jp/artist_x/" class="trigger">Mrs. GREEN APPLE</a></p>
  <div class="price"><div class="list"><div class="left">価格<span class="tax">(税込)</span></div><span class="separate">：</span><div class="right">￥${price}</div></div></div>
  <div class="other"><div class="list"><div class="left">発売日</div><span class="separate">：</span><div class="right">${rel}</div></div></div>
  <div class="cartBtn"><a>${cart}</a></div></div></div></div></li>`;
const RESULTS = `<html><body><ul>${[
  item({ sku: '1001', title: 'ANTENNA (2枚組/重量盤レコード)', cats: ['LPレコード'], price: '5,500' }),
  item({ sku: '1002', title: 'MGA MAGICAL 10 YEARS ANNIVERSARY BOOK -OUR STORY-', cats: ['本'], price: '4,400' }),
  item({ sku: '1003', title: 'POPS【初回限定盤】(CD+DVD)', cats: ['CD'], price: '4,400' }),
  item({ sku: '1004', title: 'IRIS OUT / JANE DOE (45回転/アナログレコード)', cats: ['12inchシングル'], price: '3,300' }),
  item({ sku: '1005', title: 'Mrs. GREEN APPLE DOCUMENTARY (Blu-ray)', cats: ['Blu-ray Disc'], price: '6,600' }),
].join('\n')}</ul></body></html>`;

/* ---------- 1. HMV 파서: 중간 페이지는 0건이 아니라 실패 ---------- */
{
  let threw = null;
  try { parseHmv(INTERSTITIAL); } catch (e) { threw = e; }
  ok('HMV 중간 페이지 → 실패(조용한 0건 아님)', threw && /interstitial/.test(threw.message), String(threw));
  ok('HMV "見つかりませんでした" → 진짜 0건', Array.isArray(parseHmv(NO_RESULT)) && parseHmv(NO_RESULT).length === 0);
  let threw2 = null;
  try { parseHmv('<html><body><main>renewal</main></body></html>'); } catch (e) { threw2 = e; }
  ok('HMV 알 수 없는 페이지 → 실패', !!threw2);
  const r = await searchGoods('Mrs. GREEN APPLE', { market: 'kr', searchers: { aladin: async () => [], hmv: (q) => hmvSearch(q, { fetch: async () => INTERSTITIAL }) } });
  const hmv = r.sources.find((s) => s.store === 'hmv');
  ok('searchGoods: HMV 중간 페이지면 sources.hmv ok:false + error', hmv && hmv.ok === false && /interstitial/.test(hmv.error || ''), JSON.stringify(hmv));
  let sentHeaders = null;
  const items = await hmvSearch('Mrs. GREEN APPLE', { fetch: async (_u, o) => { sentHeaders = o.headers; return RESULTS; } });
  ok('HMV 요청에 쿠키를 붙인다(쿠키 없으면 중간 페이지)', /HMV=/.test(sentHeaders?.Cookie || ''), JSON.stringify(sentHeaders));
  ok('HMV 결과 5건 파싱', items.length === 5, String(items.length));
  const fmt = Object.fromEntries(items.map((x) => [x.id, tidyOffer(x).format]));
  ok('HMV 重量盤レコード(LPレコード) → LP', fmt['hmv:1001'] === 'LP', fmt['hmv:1001']);
  ok('HMV ANNIVERSARY BOOK(本) → Book', fmt['hmv:1002'] === 'Book', fmt['hmv:1002']);
  ok('HMV CD 분류 + (CD+DVD) → CD+DVD', fmt['hmv:1003'] === 'CD+DVD', fmt['hmv:1003']);
  ok('HMV 12inchシングル → LP', fmt['hmv:1004'] === 'LP', fmt['hmv:1004']);
  ok('HMV Blu-ray Disc → Blu-ray', fmt['hmv:1005'] === 'Blu-ray', fmt['hmv:1005']);
}

/* ---------- 2. 형식: 모르면 CD라고 하지 않는다 ---------- */
ok('제목만: 重量盤レコード → LP', formatOf('ANTENNA (2枚組/重量盤レコード)') === 'LP');
ok('제목만: ANNIVERSARY BOOK → 형식 없음(CD 아님)', formatOf('MGA MAGICAL 10 YEARS ANNIVERSARY BOOK -OUR STORY-') === null);
ok('제목만: "THE BOOK"(앨범명)은 책으로 보지 않는다', formatOf('[수입] YOASOBI - THE BOOK 2 (CD)') === 'CD');
ok('"LP Sized Jacket" CD는 LP 아님', formatOf('[수입] Vaundy - 飛ぶ時 (LP Sized Jacket) (완전생산한정반)(CD)') === 'CD');
ok('분류 없음 + 제목 형식 없음 → null', hmvFormat([], 'ANNIVERSARY BOOK') === null);
ok('CD+Blu-ray 유지', formatOf('ANTENNA (CD+Blu-ray)') === 'CD+Blu-ray');

/* ---------- 3. 캐시: 아주 오래된 값은 짧게 기다려 새로 받는다 ---------- */
const dir = await mkdtemp(path.join(tmpdir(), 'lilac-goods-fresh-'));
initCache(dir);
const OPTS = { budgetMs: 2000, maxStaleMs: DAY, staleWaitMs: 300 };
{
  await revalidate('t-verystale-fast', async () => ({ items: [{ id: 'old' }], sources: [{ store: 'x', ok: true }] }));
  shiftClock(21 * DAY); // 3주 뒤
  const r = await cached('t-verystale-fast', 30 * 60e3, async () => ({ items: [{ id: 'new' }], sources: [{ store: 'x', ok: true }] }), OPTS);
  ok('3주 묵은 값 + 원천 정상 → 첫 요청에 새 값(fresh)', r.items[0]?.id === 'new' && r.cache.state === 'fresh', JSON.stringify({ id: r.items[0]?.id, cache: r.cache }));
  resetClock();
}
{
  await revalidate('t-verystale-slow', async () => ({ items: [{ id: 'old' }], sources: [{ store: 'x', ok: true }] }));
  shiftClock(21 * DAY);
  const t0 = realNow();
  const r = await cached('t-verystale-slow', 30 * 60e3, () => new Promise((res) => setTimeout(() => res({ items: [{ id: 'late' }], sources: [{ store: 'x', ok: true }] }), 1200)), OPTS);
  const waited = realNow() - t0;
  ok('3주 묵은 값 + 원천 느림 → 상한(staleWaitMs)만 기다리고 stale 표시', r.items[0]?.id === 'old' && r.cache.state === 'stale' && waited >= 250 && waited < 1100, JSON.stringify({ waited, cache: r.cache }));
  ok('stale 응답은 마지막 성공 시각(updatedAt)을 그대로 준다(나이 표시용)', r.cache.ageSec >= 21 * 86400 - 5, String(r.cache.ageSec));
  await new Promise((res) => setTimeout(res, 1100));
  const r2 = await cached('t-verystale-slow', 30 * 60e3, async () => ({ items: [], sources: [] }), OPTS);
  ok('느린 갱신은 백그라운드에서 끝나 다음 요청은 새 값', r2.items[0]?.id === 'late' && r2.cache.state === 'fresh', JSON.stringify({ id: r2.items[0]?.id, cache: r2.cache }));
  resetClock();
}
{
  await revalidate('t-verystale-fail', async () => ({ items: [{ id: 'old' }], sources: [{ store: 'x', ok: true }] }));
  shiftClock(21 * DAY);
  const r = await cached('t-verystale-fail', 30 * 60e3, async () => { throw new Error('upstream down'); }, OPTS);
  ok('3주 묵은 값 + 원천 실패 → 이전 값, state stale + lastError', r.items[0]?.id === 'old' && r.cache.state === 'stale' && /upstream down/.test(r.cache.lastError || ''), JSON.stringify(r.cache));
  resetClock();
}
{
  await revalidate('t-mildstale', async () => ({ items: [{ id: 'old' }], sources: [{ store: 'x', ok: true }] }));
  shiftClock(60 * 60e3); // 1시간: TTL(30분) 초과, 상한(24시간) 이내
  let started = 0;
  const t0 = realNow();
  const r = await cached('t-mildstale', 30 * 60e3, () => { started++; return new Promise((res) => setTimeout(() => res({ items: [{ id: 'new' }], sources: [{ store: 'x', ok: true }] }), 200)); }, OPTS);
  const took = realNow() - t0;
  await new Promise((res) => setTimeout(res, 250));
  ok('조금 묵은 값은 기존대로 즉시(stale-while-revalidate) + 백그라운드 갱신 1회', r.items[0]?.id === 'old' && r.cache.state === 'stale' && took < 100 && started === 1, JSON.stringify({ took, started, cache: r.cache }));
  resetClock();
}

/* ---------- 4. 백그라운드 갱신: 추천 검색어 + 디스크의 최근 검색어, 재시작 뒤에도 ---------- */
{
  const keyOf = (q, m) => `goods-${m}-${q.toLowerCase().replace(/[\s.]+/g, '')}`;
  const ages = new Map([['goods-kr-mrsgreenapple', 21 * DAY], ['goods-kr-vaundy', 30 * 60e3], ['goods-kr-yoasobi', 7 * DAY]]);
  const calls = [];
  const sleeps = [];
  let active = 0, maxActive = 0;
  const mk = (recent) => createGoodsRefresher({
    recent, keyOf,
    ageOf: async (k) => (ages.has(k) ? ages.get(k) : Infinity),
    revalidate: async (key, query, market) => { active++; maxActive = Math.max(maxActive, active); calls.push(`${market}:${query}`); await new Promise((r) => setTimeout(r, 5)); active--; },
    seeds: async () => [{ query: 'Mrs. GREEN APPLE', market: 'kr' }, { query: 'Vaundy', market: 'kr' }, { query: 'back number', market: 'kr' }],
    sleep: async (ms) => { sleeps.push(ms); },
    minAgeMs: 2 * 3600e3, maxPerRun: 12, gapMs: 3000,
  });
  /* 처음 프로세스: 사용자가 YOASOBI를 검색 → 디스크에 남긴다 */
  const kv1 = new KV('goods-recent-test');
  const ref1 = mk(kv1);
  await ref1.remember('YOASOBI', 'kr');
  await kv1.flush();
  /* 재시작: 새 KV 인스턴스(메모리 비어 있음)로 다시 만든다 */
  const kv2 = new KV('goods-recent-test');
  const ref2 = mk(kv2);
  const n = await ref2.run();
  ok('재시작 뒤 첫 실행에서도 갱신이 돈다(lastResult 0 아님)', n === 3, `n=${n} calls=${calls.join(',')}`);
  ok('추천 검색어(아무도 검색 안 함)도 갱신 대상', calls.includes('kr:back number') && calls.includes('kr:Mrs. GREEN APPLE'), calls.join(','));
  ok('디스크에 남긴 최근 검색어가 재시작 뒤에도 갱신 대상', calls.includes('kr:YOASOBI'), calls.join(','));
  ok('방금 받은 것(30분)은 건너뛴다', !calls.includes('kr:Vaundy'), calls.join(','));
  ok('오래된 것부터(미캐시 → 3주 → 1주)', calls.join(',') === 'kr:back number,kr:Mrs. GREEN APPLE,kr:YOASOBI', calls.join(','));
  ok('하나씩 순서대로 + 사이에 간격', maxActive === 1 && sleeps.length === 2 && sleeps.every((s) => s === 3000), JSON.stringify({ maxActive, sleeps }));
  calls.length = 0;
  const limited = createGoodsRefresher({ recent: kv2, keyOf, ageOf: async () => Infinity, revalidate: async (k, q, m) => { calls.push(q); }, seeds: async () => Array.from({ length: 30 }, (_, i) => ({ query: `artist${i}`, market: 'kr' })), sleep: async () => {}, maxPerRun: 12 });
  ok('한 번에 maxPerRun개까지만(판매처 부담 상한)', (await limited.run()) === 12 && calls.length === 12);
}

/* ---------- 5. 서비스 전체 경로: 가짜 fetch(HMV는 쿠키 없으면 중간 페이지) + 3주 묵은 디스크 캐시 ---------- */
{
  const origFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    seen.push(u);
    const h = opts.headers || {};
    const sjis = (s) => new Response(toSjis(s), { status: 200, headers: { 'content-type': 'text/html' } });
    if (u.startsWith('https://www.hmv.co.jp/')) return sjis(/HMV=/.test(h.Cookie || h.cookie || '') ? RESULTS : INTERSTITIAL);
    if (u.startsWith('https://www.aladin.co.kr/')) return sjis('<html><body>검색 결과 없음</body></html>');
    throw new Error(`unexpected network in offline test: ${u}`);
  };
  try {
    const svc = createLiveService({ dbDir: dir, readJson: async (_n, d) => d, getCharts: async () => null });
    await revalidate('goods-kr-mrsgreenapple', async () => ({ items: [{ id: 'hmv:old', store: 'hmv', title: 'OLD', format: 'CD' }], sources: [{ store: 'hmv', ok: true, count: 1 }] }));
    shiftClock(21 * DAY);
    const r = await svc.goods({ q: 'Mrs. GREEN APPLE', market: 'kr' });
    const hmv = (r.sources || []).find((s) => s.store === 'hmv');
    ok('goods(): 3주 묵은 캐시 대신 첫 요청에 새 결과', r.cache?.state === 'fresh' && !r.items.some((x) => x.id === 'hmv:old'), JSON.stringify(r.cache));
    ok('goods(): HMV 결과가 0건이 아니다', hmv?.ok === true && hmv.count === 5, JSON.stringify(hmv));
    ok('goods(): LP·책이 CD로 표시되지 않는다', r.items.find((x) => x.id === 'hmv:1001')?.format === 'LP' && r.items.find((x) => x.id === 'hmv:1002')?.format === 'Book', JSON.stringify(r.items.map((x) => [x.id, x.format])));
    ok('offline: 허용한 가짜 호스트만 불렀다', seen.every((u) => /hmv\.co\.jp|aladin\.co\.kr/.test(u)));
    svc.dispose();
  } finally {
    resetClock();
    globalThis.fetch = origFetch;
  }
}

await rm(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
