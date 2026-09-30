/* 실제 판매처 상품 검색 — HMV&BOOKS online · 알라딘 수입음반 · Ktown4u(일본 스토어)
 *
 * market 'kr' : 한국 팬이 일본 발매반을 산다  → 알라딘 수입(원화·국내배송), HMV(엔화·EMS/WorldShopping 해외배송)
 * market 'jp' : 일본 팬이 한국 발매반을 산다  → Ktown4u JP(엔화·일본 배송), HMV(엔화·일본 국내 발매/수입 韓国盤)
 *
 * 엔드포인트
 *   HMV      GET https://www.hmv.co.jp/search/keyword_{q}/target_MUSIC/type_sr/   (Shift_JIS HTML, li.list 단위)
 *            제목·아티스트·형태(CD/Blu-ray)·限定盤·税込価格·会員価格·発売日·オリジナル特典 표시·자켓 이미지·상세 URL
 *   알라딘   GET https://www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget=Music&SearchWord={q}&SortOrder=5  (UTF-8, div.ss_book_box)
 *            제목([수입] 표기)·판매가·예약 여부·발매 월·표지·상세 URL
 *   Ktown4u  GET https://jp.ktown4u.com/searchList?goodsTextSearch={q}   (__NEXT_DATA__ JSON, props.pageProps.result.data[])
 *            goodsNm·grpNm(아티스트)·kindNm·dispPrice/dispDcPrice(円)·releaseDt·saleYn·imgPath → 상세 https://jp.ktown4u.com/iteminfo?goods_no=
 *
 * CDJapan은 2026-09-27 기준 검색 API·검색 페이지 모두 결과 0건을 반환해 제외했다(가짜로 채우지 않음).
 * 배송 가능 여부는 각 판매처의 공개 정책이며 policySource에 확인한 URL을 남긴다.
 */
import { fetchText, clean, halfwidth } from './http.mjs';

export const STORES = [
  {
    id: 'aladin', label: '알라딘', market: 'kr', currency: 'KRW', shipsTo: ['KR'],
    shipsToNote: '국내 배송 (수입음반은 입고까지 통상 2주 안팎)',
    homepage: 'https://www.aladin.co.kr', policySource: 'https://www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget=Music',
  },
  {
    id: 'hmv', label: 'HMV&BOOKS online', market: 'both', currency: 'JPY', shipsTo: ['JP', 'KR', 'INTL'],
    shipsToNote: '일본 국내 배송 · 해외는 EMS 또는 WorldShopping(대행, 상품가 10% 수수료)',
    homepage: 'https://www.hmv.co.jp', policySource: 'https://www.hmv.co.jp/news/article/241030119',
  },
  {
    id: 'ktown4u', label: 'Ktown4u', market: 'jp', currency: 'JPY', shipsTo: ['JP', 'INTL'],
    shipsToNote: '일본 스토어(jp.ktown4u.com) · 엔화 결제 · 일본 배송',
    homepage: 'https://jp.ktown4u.com', policySource: 'https://jp.ktown4u.com',
  },
];

const STORE_BY_ID = Object.fromEntries(STORES.map((s) => [s.id, s]));

function yen(s) {
  const m = String(s || '').replace(/,/g, '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/* 형식: "[2LP]" "(アナログ盤)" "LP판"처럼 숫자·기호가 붙은 LP도 잡는다. CD는 제목에 CD라고 있거나 다른 형식이 없을 때만 */
export function formatOf(title) {
  const t = title || '';
  const parts = [];
  if (/Blu-?ray|ブルーレイ|블루레이/i.test(t)) parts.push('Blu-ray');
  if (/DVD/i.test(t)) parts.push('DVD');
  if (/(?:^|[^A-Za-z])\d*\s*LP(?![A-Za-z])|アナログ|Vinyl|バイナル|레코드|LP판/i.test(t)) parts.push('LP');
  if (/(?:^|[^A-Za-z])\d*\s*CD(?![A-Za-z])/i.test(t) || !parts.length) parts.unshift('CD');
  return [...new Set(parts)].join('+');
}
/* 알라딘 제목 앞 머리표([수입] [LP] [미개봉] [예약] …)는 형식을 읽은 뒤 떼어 낸다 */
export const stripTags = (t) => String(t || '').replace(/^(\s*\[[^\]]{1,12}\]\s*)+/, '').trim();

/* ---------- 화면용 정제(모든 판매처 공통, 여러 번 거쳐도 같은 결과) ----------
   판매처마다 제목에 붙이는 머리표가 달라 화면에 그대로 내면 같은 정보가 두세 번 반복된다.
     알라딘  "Radwimps (라드윔프스) - あにゅ- (CD)"        → 아티스트 크레딧·형식 꼬리 제거
     알라딘  "(일본반) 에스파(aespa) - 일본 미니 1집 …"   → 일본반 표시는 edition으로
     HMV    "《特典付》 …" "《4種セット》 …"               → 특전·세트 수는 필드로
     Ktown4u "aespa - [2026 LIVE TOUR …] BADGE"           → 아티스트 크레딧 제거
   형식은 판매처 분류를 공통 코드로 맞춘다(화면에서 언어별로 번역). */
const nrm = (x) => String(x || '').normalize('NFKC').toLowerCase().replace(/[\s.・·'’()\[\]（）-]/g, '');
const FORMAT_CODE = [
  [/^(グッズ|goods|md)$/i, 'Goods'], [/^CDシングル$/i, 'CD Single'], [/^(Blu-?ray( Disc)?|ブルーレイ)$/i, 'Blu-ray'],
  [/^(アナログ|LP|アナログレコード|Vinyl)$/i, 'LP'], [/^カセット$/i, 'Cassette'], [/^(書籍|本|雑誌)$/i, 'Book'],
];
export function formatCode(f) {
  if (!f) return null;
  return String(f).split('+').map((p) => { const x = p.trim(); const hit = FORMAT_CODE.find(([re]) => re.test(x)); return hit ? hit[1] : x; }).join('+');
}
const creditMatches = (credit, artist, store) => {
  const c = nrm(credit);
  if (!c) return false;
  if (artist && (c.includes(nrm(artist)) || nrm(artist).includes(c))) return true;
  /* 알라딘은 항상 "아티스트 (별칭) - 제목" 형식: 괄호 별칭이 붙은 짧은 크레딧이면 크레딧으로 본다 */
  if (store !== 'aladin') return false;
  /* 알라딘은 항상 "아티스트 (별칭) - 제목" 형식: 괄호 별칭이 붙은 짧은 크레딧, 또는 아티스트 칸이 비어 있을 때의 짧은 크레딧 */
  return credit.length <= 50 && (/[(（][^)）]+[)）]\s*$/.test(credit.trim()) || (!artist && credit.length <= 40 && !/[\[\]【】「」]/.test(credit)));
};
export function tidyOffer(o) {
  if (!o || typeof o.title !== 'string') return o;
  let t = o.title.trim();
  let { edition = null, bonus = null, set = null, artist = null } = o;
  let region = o.region || null;
  if (bonus === 'HMV 오리지널 특전') bonus = 'hmv';
  for (let m; (m = t.match(/^\s*《([^》]{1,16})》\s*/));) {
    const k = m[1];
    if (/特典/.test(k)) bonus = bonus || 'bonus';
    else if (/(\d+)\s*(種|形態|枚)\s*セット/.test(k)) set = Number(k.match(/(\d+)/)[1]);
    else edition = edition || k;
    t = t.slice(m[0].length);
  }
  for (let m; (m = t.match(/^\s*[(\[]\s*(일본반|한국반|국내반|수입|미개봉|예약)\s*[)\]]\s*/));) {
    if (m[1] === '일본반') region = 'JP';
    if (m[1] === '한국반' || m[1] === '국내반') region = 'KR';
    t = t.slice(m[0].length);
  }
  if (o.store === 'aladin' || o.store === 'ktown4u') {
    const cm = t.match(/^(.{1,60}?)\s+-\s+(.+)$/);
    if (cm && creditMatches(cm[1], artist, o.store)) {
      if (!artist) artist = cm[1].replace(/\s*[(（][^)）]*[)）]\s*$/, '').trim() || null;
      t = cm[2].trim();
    }
  }
  const format = formatCode(o.format);
  /* 꼬리의 "(CD)" "(Blu-ray)"처럼 형식과 똑같은 표시는 뺀다. "(2LP)" "(CD+DVD)"처럼 정보가 더 있으면 둔다 */
  const toks = new Set(String(format || '').toLowerCase().split('+').flatMap((x) => [x, x.split(' ')[0]]));
  t = t.replace(/\s*[(（\[]\s*(CD|LP|DVD|Blu-?ray)\s*[)）\]]\s*$/i, (all, f) => (toks.has(f.toLowerCase().replace(/^blu-?ray$/, 'blu-ray')) ? '' : all)).trim();
  return { ...o, title: t || o.title, artist, format, edition, bonus, set, region };
}
/** 알라딘 상품 페이지의 정확한 발매일(목록에는 월까지만 나온다) */
export function parseAladinDate(html) {
  const m = String(html).match(/<meta itemprop="datePublished" content="(\d{4}-\d{2}-\d{2})"/);
  return m ? m[1] : null;
}
export async function aladinReleaseDate(url) {
  return parseAladinDate(await fetchText(url, { timeout: 12000, retries: 1 }));
}

function editionOf(title) {
  const m = (title || '').match(/【([^】]*(?:限定|通常|盤|Edition|ver)[^】]*)】|\(([^)]*(?:Limited|Edition|Ver\.?|限定|通常盤)[^)]*)\)|（([^）]*(?:限定|通常)[^）]*)）/i);
  return m ? (m[1] || m[2] || m[3]).trim() : null;
}

/* ---------- HMV ---------- */
export async function hmvSearch(query, { limit = 20 } = {}) {
  const fetchedAt = new Date().toISOString();
  const url = `https://www.hmv.co.jp/search/keyword_${encodeURIComponent(query)}/target_MUSIC/type_sr/`;
  const html = await fetchText(url, { encoding: 'shift_jis', timeout: 12000, retries: 2 });
  const blocks = html.split('<li class="list clearfix">').slice(1);
  const out = [];
  for (const raw of blocks) {
    const b = raw.split(/<\/li>\s*<li class="list clearfix">/)[0];
    const href = (b.match(/<h3 class="title">[\s\S]*?<a href="([^"]+)"/) || [])[1];
    if (!href) continue;
    /* 음반이 아닌 악보(楽譜) 상품은 뺀다 — 주소가 artist_楽譜 로 시작한다 */
    if (/artist_(%E6%A5%BD%E8%AD%9C|楽譜)/i.test(href)) continue;
    const title = halfwidth(clean((b.match(/<h3 class="title">[\s\S]*?<a [^>]*>([\s\S]*?)<\/a>/) || [])[1]));
    const artist = clean((b.match(/<p class="name">\s*<a [^>]*>([\s\S]*?)<\/a>/) || [])[1]) || null;
    const img = (b.match(/<img src="(https:\/\/img\.hmv\.co\.jp[^"]+)"/) || [])[1] || null;
    const cats = [...b.matchAll(/<span class="(?:greenItemWide|grayItemWide)">([^<]+)<\/span>/g)].map((m) => clean(m[1]));
    const prices = [...b.matchAll(/<div class="left">([^<]+)<span class="tax">[^<]*<\/span><\/div>\s*<span class="separate">[^<]*<\/span>\s*<div class="right">([^<]+)<\/div>/g)]
      .map((m) => ({ label: clean(m[1]), value: yen(m[2]) }));
    const list = prices.find((p) => p.label === '価格');
    const member = prices.find((p) => /会員/.test(p.label));
    const rel = (b.match(/発売日<\/div>\s*<span class="separate">[^<]*<\/span>\s*<div class="right">(\d{4})年(\d{2})月(\d{2})日/) || []);
    const catText = b.match(/<p class="itemCategory">[\s\S]*?<\/p>/g)?.join(' ') || '';
    const bonus = /オリジナル特典/.test(catText) || cats.includes('オリジナル特典') ? 'hmv' : /特典/.test(catText) || cats.includes('特典') ? 'bonus' : null;
    const imported = cats.includes('輸入盤') || /輸入盤/.test(catText);
    const sku = (href.match(/_(\d+)(?:[#?].*)?$/) || [])[1];
    const cartTxt = clean((b.match(/<div class="cartBtn">([\s\S]*?)<\/div>/) || [])[1]);
    const releaseDate = rel[1] ? `${rel[1]}-${rel[2]}-${rel[3]}` : null;
    const future = releaseDate && releaseDate > new Date().toISOString().slice(0, 10);
    out.push({
      id: `hmv:${sku || href}`,
      store: 'hmv', storeLabel: STORE_BY_ID.hmv.label,
      title, artist,
      format: cats.find((c) => /^(グッズ|CDシングル|CD|DVD|Blu-?ray.*|LP|アナログ.*|カセット|書籍|雑誌)$/i.test(c)) || formatOf(title),
      edition: editionOf(title) || cats.find((c) => /限定|通常/.test(c)) || null,
      catalogNo: null,
      price: list?.value ?? null,
      memberPrice: member?.value ?? null,
      currency: 'JPY', priceIncludesTax: list ? true : null,
      releaseDate,
      image: img,
      bonus,
      imported,
      availability: /予約/.test(cartTxt) || future ? 'preorder' : /カート/.test(cartTxt) ? 'instock' : /販売終了|完売/.test(b) ? 'soldout' : 'unknown',
      url: href.replace(/#.*$/, ''),
      fetchedAt,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/* ---------- 알라딘 ---------- */
export async function aladinSearch(query, { limit = 20 } = {}) {
  const fetchedAt = new Date().toISOString();
  const url = `https://www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget=Music&SearchWord=${encodeURIComponent(query)}&SortOrder=5`;
  const html = await fetchText(url, { timeout: 12000, retries: 2 });
  const blocks = html.split('<div class="ss_book_box"').slice(1);
  const out = [];
  for (const b of blocks) {
    const itemId = (b.match(/itemId="(\d+)"/) || [])[1];
    if (!itemId) continue;
    const titleRaw = (b.match(/<a href="[^"]*wproduct\.aspx\?ItemId=\d+"[^>]*class="bo3">([\s\S]*?)<\/a>/) || [])[1];
    const title = clean(titleRaw);
    if (!title) continue;
    const img = (b.match(/<img src="(https:\/\/image\.aladin\.co\.kr[^"]+)"/) || [])[1] || null;
    const info = clean((b.match(/<li>([^<]*\|[^<]*\d{4}년[^<]*)<\/li>/) || [])[1]);
    const [artistPart, label, when] = info.split('|').map((x) => x.trim());
    const wm = (when || '').match(/(\d{4})년\s*(\d{1,2})월(?:\s*(\d{1,2})일)?/);
    const sale = (b.match(/<span class="ss_p2"\s*><em>([\d,]+)원<\/em>/) || [])[1];
    const list = (b.match(/<span class="">([\d,]+)<\/span>원/) || [])[1];
    const preorder = /예약<br\/>/.test(b);
    const soldout = /품절|절판/.test(b);
    const imported = /\[수입\]/.test(title);
    out.push({
      id: `aladin:${itemId}`,
      store: 'aladin', storeLabel: STORE_BY_ID.aladin.label,
      title: stripTags(title) || title,
      artist: artistPart ? artistPart.replace(/\s*\([^)]*\)\s*$/, '') || null : null,
      format: formatOf(title),
      edition: editionOf(title),
      catalogNo: null,
      price: sale ? Number(sale.replace(/,/g, '')) : list ? Number(list.replace(/,/g, '')) : null,
      listPrice: list ? Number(list.replace(/,/g, '')) : null,
      currency: 'KRW', priceIncludesTax: true,
      releaseDate: wm ? `${wm[1]}-${String(wm[2]).padStart(2, '0')}${wm[3] ? '-' + String(wm[3]).padStart(2, '0') : ''}` : null,
      releaseDatePrecision: wm ? (wm[3] ? 'day' : 'month') : null,
      label: label || null,
      imported,
      image: img ? img.replace('/cover150/', '/cover500/') : null,
      availability: soldout ? 'soldout' : preorder ? 'preorder' : 'instock',
      url: `https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=${itemId}`,
      fetchedAt,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/* ---------- Ktown4u 일본 스토어 ---------- */
export async function ktown4uSearch(query, { limit = 24, host = 'jp.ktown4u.com' } = {}) {
  const fetchedAt = new Date().toISOString();
  const html = await fetchText(`https://${host}/searchList?goodsTextSearch=${encodeURIComponent(query)}`, { timeout: 12000, retries: 2 });
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('ktown4u NEXT_DATA missing');
  const j = JSON.parse(m[1]);
  const rows = j.props?.pageProps?.result?.data || [];
  const q = query.toLowerCase().replace(/\s+/g, '');
  const currency = host.startsWith('jp.') ? 'JPY' : 'USD';
  return rows
    .filter((r) => `${r.grpNm} ${r.goodsNm}`.toLowerCase().replace(/\s+/g, '').includes(q))
    .slice(0, limit)
    .map((r) => {
      const sale = Number(r.dispDcPrice) || null;
      const list = Number(r.dispPrice) || null;
      const price = sale && list ? Math.min(sale, list) : sale || list;
      return {
        id: `ktown4u:${r.goodsNo}`,
        store: 'ktown4u', storeLabel: STORE_BY_ID.ktown4u.label,
        title: halfwidth(clean(r.goodsNm)),
        artist: r.grpNm || null,
        format: r.kindNm || null,
        edition: editionOf(r.goodsNm),
        catalogNo: null,
        price,
        listPrice: list && price && list > price ? list : null,
        currency, priceIncludesTax: null,
        releaseDate: r.releaseDt || null,
        image: r.imgPath || null,
        availability: r.saleYn === 'Y' ? 'instock' : r.releaseDt && r.releaseDt > new Date().toISOString().slice(0, 10) ? 'preorder' : 'unknown',
        url: `https://${host}/iteminfo?goods_no=${r.goodsNo}`,
        fetchedAt,
      };
    });
}

async function timed(store, fn) {
  const t0 = Date.now();
  try {
    const items = await fn();
    return { store, ok: true, count: items.length, ms: Date.now() - t0, items };
  } catch (e) {
    return { store, ok: false, count: 0, ms: Date.now() - t0, error: String(e?.message || e), items: [] };
  }
}

export function relevance(it, q) {
  const n = (s) => String(s || '').toLowerCase().replace(/[\s.・]/g, '');
  const qq = n(q);
  let s = 0;
  const na = n(it.artist);
  if (na.length >= 2 && (na.includes(qq) || qq.includes(na))) s += 3; // 빈 아티스트('')는 모든 검색어에 포함돼 버린다
  /* 로마자 검색어는 단어 경계로("aespa"가 "Viva Espana"에 걸리지 않게) */
  const latin = /^[\x20-\x7E]+$/.test(String(q || '').trim());
  const esc = String(q || '').trim().toLowerCase().split(/[\s.·・]+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c)).join('[\\s.·・]*');
  if (latin ? esc && new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(halfwidth(String(it.title || '')).toLowerCase()) : n(it.title).includes(qq)) s += 2;
  return s;
}

export async function searchGoods(query, { market = 'kr', limit = 40, stores } = {}) {
  const want = stores || (market === 'kr' ? ['aladin', 'hmv'] : market === 'jp' ? ['ktown4u', 'hmv'] : ['aladin', 'hmv', 'ktown4u']);
  const jobs = [];
  if (want.includes('aladin')) jobs.push(timed('aladin', () => aladinSearch(query)));
  if (want.includes('hmv')) jobs.push(timed('hmv', () => hmvSearch(query)));
  if (want.includes('ktown4u')) jobs.push(timed('ktown4u', () => ktown4uSearch(query)));
  const res = await Promise.all(jobs);
  const seen = new Set();
  let items = [];
  for (const r of res) for (const it of r.items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    items.push(it);
  }
  const ranked = items
    .map((it) => ({ it, r: relevance(it, query) }))
    .filter((x) => x.r > 0)
    .sort((a, b) => b.r - a.r || String(b.it.releaseDate || '').localeCompare(String(a.it.releaseDate || '')));
  /* 같은 관련도 안에서는 판매처를 번갈아(한 판매처 상품이 화면을 다 차지하지 않게) */
  items = [];
  for (let i = 0; i < ranked.length;) {
    let j = i;
    while (j < ranked.length && ranked[j].r === ranked[i].r) j++;
    const byStore = new Map();
    for (const x of ranked.slice(i, j)) { if (!byStore.has(x.it.store)) byStore.set(x.it.store, []); byStore.get(x.it.store).push(x.it); }
    const queues = [...byStore.values()];
    while (queues.some((q) => q.length)) for (const q of queues) if (q.length) items.push(q.shift());
    i = j;
  }
  items = items.slice(0, limit);
  return { items, sources: res.map(({ items: _i, ...rest }) => rest), stores: STORES, fetchedAt: new Date().toISOString() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const q = process.argv[2] || 'Mrs. GREEN APPLE';
  const market = process.argv[3] || 'kr';
  const r = await searchGoods(q, { market });
  for (const s of r.sources) console.log(`  ${s.store}: ok=${s.ok} n=${s.count} ${s.ms}ms ${s.error || ''}`);
  for (const it of r.items.slice(0, 10)) console.log('  ' + JSON.stringify({ id: it.id, title: it.title, artist: it.artist, price: it.price, cur: it.currency, rel: it.releaseDate, av: it.availability, img: !!it.image, url: it.url }));
}
