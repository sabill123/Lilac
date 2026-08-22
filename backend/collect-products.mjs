/**
 * Lilac 스토어 상품 수집 스크립트
 *
 * BM: "해외 배송이 지원되지 않는 일본 내수 피지컬 반(한정반 포함)을
 *      정식 루트로 공동구매하고 대행 수수료를 붙여 유통한다."
 *
 * 데이터 출처 구분 (중요)
 *  - 상품 아이덴티티(제목/아티스트/발매일/수록곡수/아트워크/Apple 링크) : Apple Music 카탈로그 실데이터
 *  - 디지털 정가(¥)                                                  : Apple Music 실데이터
 *  - 피지컬 CD 정가(¥)                                               : 일본 CD 시장 통상가 기준 추정치 (실데이터 아님)
 *  - 환율                                                            : frankfurter.app 실시간
 *
 * 판매가 공식
 *   상품원가(KRW) = 사양별 일본 정가(JPY) × 실시간 환율
 *   대행 수수료   = 상품원가 × 수수료율 (싱글 10% / 앨범 12% / 한정반 15%)
 *   국제배송 분담 = 3,500원 (합배송 기준)
 *   최종 판매가   = 100원 단위 올림(원가 + 수수료 + 배송분담)
 *
 * 실행: node backend/collect-products.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(__dirname, '..', 'db');
const UA = 'lilac-collector/1.0';
const TARGET = 100;
const PER_ARTIST = 12;              // 아티스트별 상한 (편중 방지)

const FEE = { single: 0.10, album: 0.12, limited: 0.15 };
const SHIPPING_SHARE = 3500;

/** 일본 CD 시장 통상 정가(엔) — 피지컬 사양별 추정 기준 */
const PHYSICAL_JPY = {
  single:  { normal: 1320, limited: 1980 },
  mini:    { normal: 2750, limited: 3850 },
  album:   { normal: 3300, limited: 5500 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round100 = (n) => Math.ceil(n / 100) * 100;

function sizeOf(trackCount, name) {
  if (trackCount <= 3 || /- Single$|Single$/i.test(name)) return 'single';
  if (trackCount <= 7 || /- EP$|EP$/i.test(name)) return 'mini';
  return 'album';
}
const SIZE_LABEL = { single: '싱글', mini: '미니 앨범', album: '정규 앨범' };

/** 초회한정반이 존재하는 상품인지 (일본은 싱글·정규 대부분 초회반이 나온다) */
const hasLimited = (id, size) => size !== 'mini' && id % 3 !== 0;

async function fxRate() {
  try {
    const r = await fetch('https://api.frankfurter.app/latest?from=JPY&to=KRW');
    const j = await r.json();
    if (j?.rates?.KRW) return { rate: j.rates.KRW, date: j.date, source: 'frankfurter.app', live: true };
  } catch { /* noop */ }
  return { rate: 8.7, date: new Date().toISOString().slice(0, 10), source: 'fallback', live: false };
}

function priceOf(jpy, feeKind, rate) {
  const base = jpy * rate;
  const fee = base * FEE[feeKind];
  return {
    jpy, rate, base: Math.round(base), feeRate: FEE[feeKind], fee: Math.round(fee),
    shipping: SHIPPING_SHARE, total: round100(base + fee + SHIPPING_SHARE),
  };
}

async function albumsOf(artist) {
  const url = `https://itunes.apple.com/search?media=music&entity=album&country=jp&limit=25&term=${encodeURIComponent(artist.searchTerm)}`;
  const r = await fetch(url, { headers: { 'user-agent': UA } });
  const j = await r.json();
  return (j.results || []).filter((x) =>
    x.artistName === artist.searchTerm || x.artistName === artist.name || x.artistName === artist.nameJa);
}

async function main() {
  const artists = JSON.parse(await readFile(path.join(DB, 'artists.json'), 'utf-8'));
  const fx = await fxRate();
  console.log(`[fx] 1 JPY = ${fx.rate} KRW (${fx.date}, ${fx.source})`);

  const seen = new Set();
  const buckets = [];

  for (const a of artists) {
    const list = await albumsOf(a);
    const picked = [];
    for (const x of list) {
      if (picked.length >= PER_ARTIST) break;
      const key = `${x.artistName}|${x.collectionName}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const size = sizeOf(x.trackCount || 0, x.collectionName);
      const limited = hasLimited(x.collectionId || 0, size);
      const base = PHYSICAL_JPY[size];

      // 사양(에디션) 구성
      const editions = [
        { id: 'normal', label: `통상반 CD (${SIZE_LABEL[size]})`, jpy: base.normal, feeKind: size === 'single' ? 'single' : 'album', real: false },
        ...(limited ? [{ id: 'limited', label: '초회한정반 (CD+DVD)', jpy: base.limited, feeKind: 'limited', real: false }] : []),
        ...(x.collectionPrice > 0 ? [{ id: 'digital', label: `디지털 다운로드 (Apple)`, jpy: x.collectionPrice, feeKind: 'single', real: true, digital: true }] : []),
      ].map((e) => ({ ...e, pricing: priceOf(e.jpy, e.feeKind, fx.rate) }));

      const primary = editions[0];
      picked.push({
        id: `it-${x.collectionId}`,
        name: x.collectionName,
        brand: a.name,
        artistId: a.id,
        size, sizeLabel: SIZE_LABEL[size],
        badge: limited ? '한정반' : SIZE_LABEL[size],
        price: primary.pricing.total,
        editions,
        rate: fx.rate, rateDate: fx.date, rateLive: fx.live,
        releaseDate: (x.releaseDate || '').slice(0, 10),
        trackCount: x.trackCount || 0,
        artwork: (x.artworkUrl100 || '').replace('100x100', '600x600'),
        appleUrl: x.collectionViewUrl,
        digitalJpy: x.collectionPrice > 0 ? x.collectionPrice : null,
        operator: a.operator,
        officialUrl: a.official,
        towerUrl: `https://tower.jp/search/item/${encodeURIComponent(x.collectionName)}`,
        searchTerm: `${a.searchTerm} ${x.collectionName}`,
        stock: 3 + ((x.collectionId || 0) % 48),
        desc: `${a.name}의 ${SIZE_LABEL[size]}. 일본 내수 유통 상품이라 해외 배송이 지원되지 않아, Lilac이 현지에서 매입해 합배송으로 전달합니다.`,
      });
    }
    buckets.push(picked);
    console.log(`[${a.name}] 후보 ${list.length} → 채택 ${picked.length}`);
    await sleep(220);
  }

  // 아티스트별로 라운드로빈 배분해 100개 채우기 (한 아티스트 쏠림 방지)
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

  const bySize = rows.reduce((m, r) => ({ ...m, [r.sizeLabel]: (m[r.sizeLabel] || 0) + 1 }), {});
  const byArtist = rows.reduce((m, r) => ({ ...m, [r.brand]: (m[r.brand] || 0) + 1 }), {});
  console.log(`\n[완료] ${rows.length}개 저장`);
  console.log('유형별:', bySize);
  console.log('아티스트별:', byArtist);
  console.log('한정반 보유:', rows.filter((r) => r.editions.some((e) => e.id === 'limited')).length, '건');
  console.log('가격대:', Math.min(...rows.map((r) => r.price)).toLocaleString(), '~', Math.max(...rows.map((r) => r.price)).toLocaleString(), '원');
}

main().catch((e) => { console.error(e); process.exit(1); });
