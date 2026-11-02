/* 굿즈 검색 결과 백그라운드 갱신
 *
 * 예전: 이 프로세스 메모리에 남은 "최근 6시간 안에 검색된 키"만 갱신했다. 재시작하면 목록이 비고,
 * 추천 검색어(굿즈 화면의 칩)는 누가 검색하기 전엔 한 번도 갱신되지 않아 디스크 캐시가 몇 주씩 묵었다
 * (운영 2026-10-22: Vaundy 9/30, YOASOBI 10/15, sync lastResult 0).
 *
 * 지금: 후보 = 추천 검색어(seeds, 화면과 같은 목록) + 디스크에 남긴 최근 검색어(KV).
 *       캐시 나이가 minAgeMs 이상인 것만, 오래된 것부터, 한 번에 maxPerRun개까지, 하나씩 gapMs 간격으로.
 *       판매처에 동시에 여러 요청을 보내지 않는다.
 */
export const GOODS_SEEDS_FALLBACK = {
  kr: ['Mrs. GREEN APPLE', 'back number', 'M!LK', 'Official髭男dism', '=LOVE', 'Vaundy', 'RADWIMPS', 'HANA', '米津玄師', 'マカロニえんぴつ'],
  jp: [],
};

/* 굿즈 화면의 추천 칩과 같은 규칙(frontend/src/app/pages/goods.ts: 로마자 원어명이 있으면 원어명, 아니면 표시 이름) */
export const suggestQuery = (a) => (a?.nameOriginal && /[A-Za-z]/.test(a.nameOriginal) ? a.nameOriginal : a?.name) || null;

export function createGoodsRefresher({
  recent, // KV 같은 객체: ready(), get(k), set(k, v), map
  keyOf, // (query, market) => cache key
  ageOf, // async key => ms since last successful fetch (Infinity if never)
  revalidate, // async (key, query, market) => any
  seeds = async () => [], // async () => [{ query, market }]
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); }),
  minAgeMs = 2 * 3600e3,
  recentWindowMs = 7 * 24 * 3600e3,
  maxRecent = 200,
  maxPerRun = 12,
  gapMs = 3000,
} = {}) {
  async function remember(query, market) {
    await recent.ready();
    const key = keyOf(query, market);
    recent.set(key, { query, market, at: now() });
    const map = recent.map;
    if (map && map.size > maxRecent) {
      const oldest = [...map].sort((a, b) => (a[1]?.at || 0) - (b[1]?.at || 0)).slice(0, map.size - maxRecent);
      for (const [k] of oldest) map.delete(k);
    }
    return key;
  }

  async function candidates() {
    await recent.ready();
    const out = new Map();
    let seedList = [];
    try { seedList = await seeds(); } catch { seedList = []; }
    for (const s of seedList || []) {
      if (!s?.query) continue;
      const key = keyOf(s.query, s.market);
      if (!out.has(key)) out.set(key, { key, query: s.query, market: s.market, seed: true });
    }
    const since = now() - recentWindowMs;
    for (const [key, v] of recent.map || []) {
      if (!v?.query || (v.at || 0) < since || out.has(key)) continue;
      out.set(key, { key, query: v.query, market: v.market, seed: false });
    }
    return [...out.values()];
  }

  /* 한 번 돌기: 갱신한 개수를 돌려준다 */
  async function run() {
    const list = [];
    for (const c of await candidates()) {
      let age = Infinity;
      try { age = await ageOf(c.key); } catch { /* 모르면 갱신 대상 */ }
      if (age >= minAgeMs) list.push({ ...c, age });
    }
    list.sort((a, b) => (a.age === b.age ? 0 : b.age > a.age ? 1 : -1));
    const todo = list.slice(0, maxPerRun);
    let n = 0;
    for (let i = 0; i < todo.length; i++) {
      const c = todo[i];
      try { await revalidate(c.key, c.query, c.market); n++; } catch { /* 다음 것 */ }
      if (i < todo.length - 1) await sleep(gapMs);
    }
    return n;
  }

  return { remember, candidates, run };
}
