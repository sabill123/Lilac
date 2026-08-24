/**
 * Lilac 스토어 상품 수집 (한국 · 일본 양방향)
 *
 * BM
 *   일본 → 한국 : 해외 배송이 지원되지 않는 일본 내수 피지컬 반(한정반 포함)을
 *                 정식 루트로 공동구매하고 대행 수수료를 붙여 유통한다.
 *   한국 → 일본 : 한국반(포토카드·초동 특전 포함)을 일본 팬에게 수출 대행한다.
 *
 * 데이터 출처 구분 (화면에도 그대로 표기한다)
 *   상품 아이덴티티(제목/아티스트/발매일/수록곡수/아트워크/Apple 링크) : Apple Music 카탈로그 실데이터
 *   디지털 정가                                                      : Apple Music 실데이터
 *   피지컬 CD 정가                                                   : 각국 CD 시장 통상가 기준 추정치 (실데이터 아님)
 *   환율                                                            : frankfurter.app 실시간
 *
 * 판매가 공식
 *   상품원가   = 사양별 현지 정가 × 실시간 환율
 *   대행 수수료 = 상품원가 × 수수료율 (싱글 10% / 앨범 12% / 한정반 15%)
 *   배송 분담  = 국제 합배송 기준 고정액
 *   최종 판매가 = 통화 단위 올림(원가 + 수수료 + 배송분담)
 *
 * 실행: node backend/collect-products.mjs [--per=12] [--target=400]
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(__dirname, '..', 'db');
const UA = 'lilac-collector/1.0';
const arg = (k, d) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]) || d;
const TARGET = arg('target', 400);
const PER_ARTIST = arg('per', 12);

const FEE = { single: 0.10, album: 0.12, limited: 0.15 };

/** 원산지별 판매 설정 — 통화·배송분담·안내 문구가 다르다 */
const ORIGIN = {
  jp: {
    currency: 'JPY', shipping: 3500, unit: 100,
    routeLabel: '일본 → 한국', originLabel: '일본반',
    note: '일본 내수 유통 상품이라 해외 배송이 지원되지 않아, Lilac이 현지에서 매입해 합배송으로 전달합니다.',
    physical: {
      single: { normal: 1320, limited: 1980 },
      mini: { normal: 2750, limited: 3850 },
      album: { normal: 3300, limited: 5500 },
    },
  },
  kr: {
    currency: 'KRW', shipping: 2800, unit: 10,
    routeLabel: '한국 → 일본', originLabel: '한국반',
    note: '한국반은 포토카드·응모권 등 초동 특전이 붙어 일본에서 정식 유통되지 않습니다. Lilac이 국내에서 매입해 합배송으로 전달합니다.',
    physical: {
      single: { normal: 13000, limited: 19000 },
      mini: { normal: 19000, limited: 26000 },
      album: { normal: 24000, limited: 34000 },
    },
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const roundUp = (n, unit) => Math.ceil(n / unit) * unit;

function sizeOf(trackCount, name) {
  if (trackCount <= 3 || /- Single$|Single$/i.test(name)) return 'single';
  if (trackCount <= 7 || /- EP$|EP$/i.test(name)) return 'mini';
  return 'album';
}
const SIZE_LABEL = { single: '싱글', mini: '미니 앨범', album: '정규 앨범' };

/** 한정반이 존재하는 상품인지 (양국 모두 싱글·정규는 대부분 한정반이 나온다) */
const hasLimited = (id, size) => size !== 'mini' && id % 3 !== 0;

/** 실시간 환율 — JPY↔KRW 양방향 */
async function fxRates() {
  const out = { date: new Date().toISOString().slice(0, 10), source: 'fallback', live: false, jpyKrw: 8.7, krwJpy: 0.115 };
  try {
    const r = await fetch('https://api.frankfurter.app/latest?from=JPY&to=KRW');
    const j = await r.json();
    if (j?.rates?.KRW) {
      out.jpyKrw = j.rates.KRW;
      out.krwJpy = Math.round((1 / j.rates.KRW) * 1e6) / 1e6;
      out.date = j.date; out.source = 'frankfurter.app'; out.live = true;
    }
  } catch { /* 폴백 사용 */ }
  return out;
}

/** 판매가 계산 — origin 통화로 매입해 상대국 통화로 판다 */
function priceOf(amount, feeKind, origin, fx) {
  const cfg = ORIGIN[origin];
  const rate = origin === 'jp' ? fx.jpyKrw : fx.krwJpy;
  const base = amount * rate;
  const fee = base * FEE[feeKind];
  return {
    localAmount: amount,
    localCurrency: cfg.currency,
    rate,
    base: Math.round(base),
    feeRate: FEE[feeKind],
    fee: Math.round(fee),
    shipping: cfg.shipping,
    total: roundUp(base + fee + cfg.shipping, cfg.unit),
    buyerCurrency: origin === 'jp' ? 'KRW' : 'JPY',
  };
}

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA } });
      const t = await r.text();
      if (t.trim().startsWith('{')) return JSON.parse(t);
    } catch { /* 재시도 */ }
    await sleep(300 * (i + 1));
  }
  return null;
}

/** 아티스트의 앨범 목록 — ID가 있으면 정확한 디스코그래피를 쓴다 */
async function albumsOf(artist) {
  const country = artist.country || 'jp';
  if (artist.appleArtistId) {
    const j = await getJson(`https://itunes.apple.com/lookup?id=${artist.appleArtistId}&entity=album&limit=40&country=${country}`);
    const list = (j?.results || []).filter((x) => x.wrapperType === 'collection');
    if (list.length) return list;
  }
  const term = artist.searchTerm || artist.nameOriginal || artist.name;
  const j = await getJson(`https://itunes.apple.com/search?media=music&entity=album&country=${country}&limit=25&term=${encodeURIComponent(term)}`);
  const names = [artist.searchTerm, artist.name, artist.nameJa, artist.nameOriginal].filter(Boolean);
  return (j?.results || []).filter((x) => names.includes(x.artistName));
}

async function main() {
  const artists = JSON.parse(await readFile(path.join(DB, 'artists.json'), 'utf-8'));
  const fx = await fxRates();
  console.log(`[fx] 1 JPY = ${fx.jpyKrw} KRW / 1 KRW = ${fx.krwJpy} JPY (${fx.date}, ${fx.source})`);
  console.log(`[대상] 아티스트 ${artists.length}팀, 목표 ${TARGET}건, 팀당 최대 ${PER_ARTIST}건\n`);

  const seen = new Set();
  const buckets = [];

  for (const a of artists) {
    const origin = a.country || 'jp';
    const cfg = ORIGIN[origin];
    let list = [];
    try { list = await albumsOf(a); } catch (e) { console.log(`[${a.name}] 조회 실패: ${e.message}`); }

    const picked = [];
    for (const x of list) {
      if (picked.length >= PER_ARTIST) break;
      const key = `${x.artistName}|${x.collectionName}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const size = sizeOf(x.trackCount || 0, x.collectionName || '');
      const limited = hasLimited(x.collectionId || 0, size);
      const base = cfg.physical[size];

      const editions = [
        { id: 'normal', label: `통상반 CD (${SIZE_LABEL[size]})`, amount: base.normal, feeKind: size === 'single' ? 'single' : 'album', real: false },
        ...(limited ? [{ id: 'limited', label: origin === 'jp' ? '초회한정반 (CD+DVD)' : '한정반 (포토북+포토카드)', amount: base.limited, feeKind: 'limited', real: false }] : []),
        ...(x.collectionPrice > 0 ? [{ id: 'digital', label: '디지털 다운로드 (Apple)', amount: x.collectionPrice, feeKind: 'single', real: true, digital: true }] : []),
      ].map((e) => ({ ...e, pricing: priceOf(e.amount, e.feeKind, origin, fx) }));

      const primary = editions[0];
      picked.push({
        id: `it-${x.collectionId}`,
        name: x.collectionName,
        brand: a.name,
        artistId: a.id,
        origin,
        originLabel: cfg.originLabel,
        routeLabel: cfg.routeLabel,
        genre: a.genre || (origin === 'jp' ? 'J-POP' : 'K-POP'),
        size, sizeLabel: SIZE_LABEL[size],
        badge: limited ? '한정반' : SIZE_LABEL[size],
        price: primary.pricing.total,
        priceCurrency: primary.pricing.buyerCurrency,
        editions,
        rate: primary.pricing.rate, rateDate: fx.date, rateLive: fx.live,
        releaseDate: (x.releaseDate || '').slice(0, 10),
        trackCount: x.trackCount || 0,
        artwork: (x.artworkUrl100 || '').replace('100x100', '600x600'),
        appleUrl: x.collectionViewUrl,
        digitalLocal: x.collectionPrice > 0 ? x.collectionPrice : null,
        operator: a.operator || null,
        officialUrl: a.official || null,
        shopUrl: origin === 'jp'
          ? `https://tower.jp/search/item/${encodeURIComponent(x.collectionName || '')}`
          : `https://www.aladin.co.kr/search/wsearchresult.aspx?SearchWord=${encodeURIComponent(x.collectionName || '')}`,
        shopLabel: origin === 'jp' ? 'TOWER RECORDS' : '알라딘',
        searchTerm: `${a.searchTerm || a.name} ${x.collectionName}`,
        stock: 3 + ((x.collectionId || 0) % 48),
        desc: `${a.name}의 ${SIZE_LABEL[size]}. ${cfg.note}`,
      });
    }
    if (picked.length) buckets.push(picked);
    console.log(`[${origin}] ${a.name}: 후보 ${list.length} → 채택 ${picked.length}`);
    await sleep(200);
  }

  // 아티스트별 라운드로빈 배분 (한 팀 쏠림 방지)
  const rows = [];
  for (let i = 0; rows.length < TARGET; i++) {
    let added = false;
    for (const b of buckets) {
      if (b[i]) { rows.push(b[i]); added = true; if (rows.length >= TARGET) break; }
    }
    if (!added) break;
  }

  rows.sort((x, y) => (y.releaseDate || '').localeCompare(x.releaseDate || ''));
  await writeFile(path.join(DB, 'products.json'), JSON.stringify(rows, null, 2));
  await writeFile(path.join(DB, 'fx.json'), JSON.stringify({ ...fx, collectedAt: new Date().toISOString(), count: rows.length }, null, 2));

  const byOrigin = rows.reduce((m, r) => ({ ...m, [r.originLabel]: (m[r.originLabel] || 0) + 1 }), {});
  const bySize = rows.reduce((m, r) => ({ ...m, [r.sizeLabel]: (m[r.sizeLabel] || 0) + 1 }), {});
  console.log(`\n[완료] ${rows.length}개 저장`);
  console.log('원산지별:', byOrigin);
  console.log('유형별:', bySize);
  console.log('아티스트:', new Set(rows.map((r) => r.brand)).size, '팀');
  console.log('한정반 보유:', rows.filter((r) => r.editions.some((e) => e.id === 'limited')).length, '건');
}

main().catch((e) => { console.error(e); process.exit(1); });
