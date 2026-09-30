/* 환율 갱신.

   왜 따로 뺐나: 환율은 collect-products.mjs 안에만 있어서 상품을 다시 수집할 때만
   갱신됐다. 실측하니 db/fx.json 이 214시간(9일) 지난 값이었는데,
   그 값으로 스토어 가격(현지 정가 × 환율 + 수수료)을 계산하고 있었다.
   화면에 찍히는 금액이 9일 전 환율이면 실제 청구와 갈라진다. */

const API = 'https://api.frankfurter.app/latest?from=JPY&to=KRW';

/** 실패 시 이전 값을 유지한다 — 못 받아온 것을 근거로 값을 망가뜨리지 않는다 */
export async function fetchFx(prev = null) {
  const out = {
    date: new Date().toISOString().slice(0, 10),
    source: 'fallback',
    live: false,
    jpyKrw: prev?.jpyKrw ?? 8.7,
    krwJpy: prev?.krwJpy ?? 0.115,
  };
  try {
    const r = await fetch(API, { headers: { 'user-agent': 'Lilac/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const rate = j?.rates?.KRW;
    if (!(rate > 0)) throw new Error('KRW 환율이 없다');
    out.date = j.date || out.date;
    out.source = 'frankfurter.app';
    out.live = true;
    out.jpyKrw = Number(rate.toFixed(4));
    out.krwJpy = Number((1 / rate).toFixed(6));
  } catch (e) {
    out.error = e.message;
    // prev 를 그대로 들고 나간다. live:false 로 화면이 구분할 수 있다.
    if (prev) { out.date = prev.date; out.source = prev.source; }
  }
  out.collectedAt = new Date().toISOString();
  return out;
}

/** 환율이 얼마나 묵었는지 (시간) */
export function fxAgeHours(fx) {
  const t = Date.parse(fx?.collectedAt || fx?.date || '');
  return Number.isFinite(t) ? (Date.now() - t) / 36e5 : Infinity;
}
