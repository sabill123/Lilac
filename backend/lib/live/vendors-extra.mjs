/* 추가 예매처 — 티켓링크 · YES24 티켓 (한국), 로손티켓(로치케, 일본)
 *
 * 엔드포인트 (2026-09-30 브라우저 네트워크 관찰로 확인, 로그인 없이 동작)
 *  티켓링크  GET https://mapi.ticketlink.co.kr/mapi/productList/show?page=N&categoryId=14&locationCode=&categoryLevel=2
 *           콘서트(14) 28건/쪽. data.result[{productId, productName, productImagePath(//…), hallName, locationName,
 *           startDate/endDate(epoch ms), category2Name}]. 상세 = https://www.ticketlink.co.kr/product/{id}
 *  YES24    GET https://ticket.yes24.com/New/Genre/Ajax/GenreList_Data.aspx?genre=G&sort=3&area=&genretype=T&pCurPage=N&pPageSize=20
 *           HTML 조각. 콘서트 전체 genre=15456(type 1), 해외뮤지션 15463·페스티벌 15464(type 2).
 *           jsf_base_GoToPerfDetail(id) · img data-src · list-b-tit1(제목) · list-b-tit2(기간, 장소). 상세 = https://ticket.yes24.com/Perf/{id}
 *  로치케    GET https://l-tike.com/api/mevent-autopost?1&cc=2&gc=37   (K-POP·아시아 장르의 이벤트 페이지 목록, 대표 이미지 포함)
 *           GET https://l-tike.com/concert/fes/                         (페스 특집: 이벤트 페이지 링크 목록)
 *           이벤트 페이지 https://l-tike.com/concert/mevent/?mid=ID 의 JSON-LD Event(name, startDate, endDate, location, image)
 *           l-tike는 Node fetch(HTTP/1.1)를 받지 않아 curl(HTTP/2)로 읽는다.
 * 페이지 끝은 "새 id가 더 오지 않는 쪽"으로 판단한다(쪽 크기로 판단하지 않는다). 모르는 값은 null. */
import { fetchJson, fetchText, fetchViaCurl, clean, halfwidth } from './http.mjs';
import { eventGeography } from './geography.mjs';

const UA_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36' };
const kst = (ms) => (Number.isFinite(ms) ? new Date(ms + 9 * 3600e3).toISOString().slice(0, 10) : null);
const kindOf = (title, genre = '') => (/페스티벌|festival|fes\b|フェス|페스타/i.test(`${title} ${genre}`) ? 'festival' : /팬미팅|fan ?meeting|ファンミ/i.test(`${title} ${genre}`) ? 'fanmeeting' : 'concert');

/* ---------- 티켓링크 ---------- */
export function mapTicketlink(p, fetchedAt = new Date().toISOString()) {
  const title = halfwidth(clean(p.productName || ''));
  const img = p.productImagePath ? (p.productImagePath.startsWith('//') ? `https:${p.productImagePath}` : p.productImagePath) : null;
  const venue = p.hallName || null;
  const geo = p.regionDomesticYn === 'N' ? eventGeography({ venue, city: p.locationGlobal || p.locationName }) : { country: 'KR' };
  return {
    id: `ticketlink:${p.productId}`, provider: 'ticketlink', providerLabel: '티켓링크', title, artists: [],
    venue, city: p.locationName || null, country: geo.country || null,
    startDate: kst(p.startDate), endDate: kst(p.endDate || p.startDate), ticketOpenAt: null,
    status: 'onsale', poster: img, url: `https://www.ticketlink.co.kr/product/${p.productId}`,
    genre: p.category2Name || null, badges: (p.productFlagInfo || []).map((f) => f.flagName).filter(Boolean), kind: kindOf(title, p.category2Name), fetchedAt,
  };
}
export async function ticketlinkList(categoryId = 14, { maxPages = 12, get = (u) => fetchJson(u, { headers: { ...UA_HEADERS, Referer: 'https://www.ticketlink.co.kr/' }, timeout: 12000 }) } = {}) {
  const fetchedAt = new Date().toISOString();
  const out = new Map();
  for (let page = 1; page <= maxPages; page++) {
    const j = await get(`https://mapi.ticketlink.co.kr/mapi/productList/show?page=${page}&categoryId=${categoryId}&locationCode=&categoryLevel=2`);
    const list = j?.data?.result || [];
    let fresh = 0;
    for (const p of list) if (p?.productId && !out.has(p.productId)) { out.set(p.productId, mapTicketlink(p, fetchedAt)); fresh++; }
    if (!fresh) break;
  }
  return [...out.values()];
}

/* ---------- YES24 ---------- */
export function parseYes24List(html, fetchedAt = new Date().toISOString()) {
  const out = [];
  for (const m of String(html).matchAll(/jsf_base_GoToPerfDetail\((\d+)\);'\s*title='([^']*)'>([\s\S]*?)<\/a>/g)) {
    const [, id, rawTitle, body] = m;
    const img = (body.match(/data-src='([^']+)'/) || [])[1] || null;
    const t2 = [...body.matchAll(/class='list-b-tit2[^']*'>([^<]*)</g)].map((x) => clean(x[1]));
    const dates = (t2.find((x) => /\d{4}\.\d{2}\.\d{2}/.test(x)) || '').match(/\d{4}\.\d{2}\.\d{2}/g) || [];
    const venue = t2.find((x) => x && !/\d{4}\.\d{2}\.\d{2}/.test(x)) || null;
    const title = halfwidth(clean(rawTitle.replace(/&amp;/g, '&')));
    const d = (x) => (x ? x.replace(/\./g, '-') : null);
    out.push({
      id: `yes24:${id}`, provider: 'yes24', providerLabel: 'YES24 티켓', title, artists: [],
      venue, city: null, country: eventGeography({ venue }).country === 'JP' ? 'JP' : 'KR',
      startDate: d(dates[0]), endDate: d(dates[1] || dates[0]), ticketOpenAt: null, status: 'onsale',
      poster: img ? (img.startsWith('//') ? `https:${img}` : img).replace(/\/dims\/.*$/, '/dims/quality/80/') : null,
      url: `https://ticket.yes24.com/Perf/${id}`, genre: null, badges: [], kind: kindOf(title), fetchedAt,
    });
  }
  return out;
}
export async function yes24List(genre = 15456, genretype = 1, { maxPages = 15, get = (u) => fetchText(u, { headers: { ...UA_HEADERS, Referer: 'https://ticket.yes24.com/', 'X-Requested-With': 'XMLHttpRequest' }, timeout: 12000 }) } = {}) {
  const fetchedAt = new Date().toISOString();
  const out = new Map();
  for (let page = 1; page <= maxPages; page++) {
    const html = await get(`https://ticket.yes24.com/New/Genre/Ajax/GenreList_Data.aspx?genre=${genre}&sort=3&area=&genretype=${genretype}&pCurPage=${page}&pPageSize=20`);
    let fresh = 0;
    for (const it of parseYes24List(html, fetchedAt)) if (!out.has(it.id)) { out.set(it.id, it); fresh++; }
    if (!fresh) break;
  }
  return [...out.values()];
}

/* ---------- 로치케 ---------- */
const LT = 'https://l-tike.com';
const ltGet = (u) => fetchViaCurl(u, { timeout: 20000 });
/** 이벤트 페이지의 JSON-LD Event 목록 */
export function parseLtikeEvents(html, pageUrl) {
  const out = [];
  for (const m of String(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let j;
    try { j = JSON.parse(m[1]); } catch { continue; }
    for (const e of [j].flat()) {
      if (e?.['@type'] !== 'Event') continue;
      const loc = e.location || {};
      const addr = loc.address || {};
      out.push({
        name: halfwidth(String(e.name || '')).replace(/\s+/g, ' ').trim(),
        startDate: /^\d{4}-\d{2}-\d{2}/.test(e.startDate || '') ? e.startDate.slice(0, 10) : null,
        endDate: /^\d{4}-\d{2}-\d{2}/.test(e.endDate || '') ? e.endDate.slice(0, 10) : null,
        venue: loc.name ? halfwidth(loc.name) : null,
        region: addr.addressRegion || null,
        countryName: addr.addressCountry || null,
        image: [e.image].flat().find((x) => typeof x === 'string') || null,
        url: pageUrl,
      });
    }
  }
  return out;
}
/** 이벤트 페이지 하나 → 공연 항목 하나(여러 날짜는 기간으로 묶는다) */
export function ltikeItem(mid, events, { title = null, fetchedAt = new Date().toISOString() } = {}) {
  if (!events.length) return null;
  const starts = events.map((e) => e.startDate).filter(Boolean).sort();
  const ends = events.map((e) => e.endDate || e.startDate).filter(Boolean).sort();
  const first = events[0];
  const geo = eventGeography({ venue: first.venue, city: first.region, sourceCountry: /日本/.test(first.countryName || '') ? 'JP' : /韓国|대한민국/.test(first.countryName || '') ? 'KR' : null });
  const t = title || first.name;
  return {
    id: `ltike:${mid}`, provider: 'ltike', providerLabel: 'ローチケ', title: t, artists: [],
    venue: [...new Set(events.map((e) => e.venue).filter(Boolean))][0] || null, venueCount: new Set(events.map((e) => e.venue).filter(Boolean)).size,
    city: first.region, country: geo.country || null, startDate: starts[0] || null, endDate: ends[ends.length - 1] || starts[0] || null,
    ticketOpenAt: null, status: 'onsale', poster: first.image, url: `${LT}/concert/mevent/?mid=${mid}`,
    genre: null, badges: [], kind: kindOf(t), showCount: events.length, fetchedAt,
  };
}
async function ltikeEventPages(mids, { concurrency = 3, titles = new Map() } = {}) {
  const fetchedAt = new Date().toISOString();
  const out = [];
  const queue = [...new Set(mids)];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const mid = queue.shift();
      try {
        const url = `${LT}/concert/mevent/?mid=${mid}`;
        const it = ltikeItem(mid, parseLtikeEvents(await ltGet(url), url), { title: titles.get(mid) || null, fetchedAt });
        if (it) out.push(it);
      } catch { /* 한 페이지 실패는 건너뛴다 */ }
    }
  }));
  return out;
}
/** K-POP·아시아 장르(gc=37)의 이벤트 페이지들 */
export async function ltikeGenre(gc = 37) {
  const j = JSON.parse(await ltGet(`${LT}/api/mevent-autopost?1&cc=2&gc=${gc}&pref=&sd=&ed=&fpref=&fsd=&fed=`));
  const list = (j.eventpagelist || []).filter((e) => /^\d+$/.test(e.eventpageid || ''));
  return ltikeEventPages(list.map((e) => e.eventpageid), { titles: new Map(list.map((e) => [e.eventpageid, halfwidth(String(e.eventtitleja || '')).trim() || null])) });
}
/** 페스 특집 페이지의 페스티벌 이벤트 페이지(“제목（현）날짜” 형식의 링크만) */
export function parseLtikeFesPage(html) {
  const out = new Map();
  for (const m of String(html).matchAll(/<a[^>]+href="https:\/\/l-tike\.com\/concert\/mevent\/\?mid=(\d+)"[^>]*>([\s\S]{0,600}?)<\/a>/g)) {
    const text = halfwidth(m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    const t = text.match(/^(.+?)\s*[（(]([^）)]{1,8})[）)]\s*\d{1,2}\/\d{1,2}/);
    if (t && !out.has(m[1])) out.set(m[1], t[1].trim());
  }
  return out;
}
export async function ltikeFestivals() {
  const titles = parseLtikeFesPage(await ltGet(`${LT}/concert/fes/`));
  return ltikeEventPages([...titles.keys()], { titles });
}

/* ---------- 여러 예매처의 같은 공연 묶기 ----------
   같은 공연이 NOL·멜론·티켓링크·YES24(또는 e+·ぴあ·ローチケ)에 함께 올라온다. 제목(지역 머리표·연도 띄어쓰기 무시)과
   시작일이 같으면 하나로 묶고, 앞 예매처를 대표로, 나머지는 alsoAt(예매 링크)로 남긴다. 대표에 포스터가 없으면 채운다. */
export function titleKey(t) {
  return halfwidth(String(t || '')).toLowerCase()
    .replace(/^\s*[[［【(（]\s*[^\]］】)）]{1,6}\s*[\]］】)）]\s*/, '') // [서울] [대전] 【東京】
    .replace(/[\s'‘’"“”「」『』〈〉<>《》【】\[\]()（）・·.,:：!！?？~〜～\-–—_/|]/g, '');
}
/* 제목 앞의 같은 말 반복("PENTAGON PENTAGON 10th …")은 예매처가 아티스트명과 공연명을 이어 붙인 흔적 */
export function collapseLead(t, performer = null) {
  const m = String(t || '').match(/^(.{2,40}?)\s+\1(?=\s|$)/u);
  if (!m) return String(t || '');
  const lead = m[1];
  /* "Baby Baby"처럼 원래 제목인 반복은 두고, 출연자 이름이거나 대문자 표기 이름(PENTAGON)일 때만 */
  const isName = (performer && halfwidth(performer).toLowerCase() === halfwidth(lead).toLowerCase()) || (lead.length >= 4 && lead === lead.toUpperCase() && /[A-Z]/.test(lead));
  return isName ? String(t).replace(m[0], lead) : String(t);
}
const STOP = new Set(['live', 'tour', 'japan', 'korea', 'seoul', 'tokyo', 'osaka', 'concert', 'fanmeeting', 'fan', 'meeting', 'show', 'world', 'asia', 'arena', 'hall', 'zepp', 'special', 'official', 'edition', 'anniversary', 'album', 'project', 'ライブ', 'ツアー', 'コンサート', 'ファンミーティング', '콘서트', '팬미팅', '내한공연']);
const tokensOf = (t) => new Set(halfwidth(String(t || '')).toLowerCase().split(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7a3]+/).filter((x) => x.length >= 4 && !STOP.has(x) && !/^\d+$/.test(x)));
const venueKey = (v) => halfwidth(String(v || '')).toLowerCase().replace(/[\s()（）・·.\-_/'’‘]/g, '');
function attach(g, it) {
  (g.alsoAt ||= []).push({ provider: it.provider, providerLabel: it.providerLabel, url: it.url, status: it.status || null });
  if (!g.poster && it.poster) g.poster = it.poster;
  if (it.endDate && (!g.endDate || it.endDate > g.endDate)) g.endDate = it.endDate;
}
export function mergeVendors(items) {
  for (const it of items) if (it && it.title) it.title = collapseLead(it.title, it.performer || null);
  const byKey = new Map();
  const byPlace = new Map(); // 시작일|공연장 → 대표
  const out = [];
  for (const it of items) {
    /* 제목 표기가 예매처마다 달라도(キム・キュジョン ↔ KIM KYUJONG(キム・キュジョン)) 같은 날 같은 공연장이고 이름 토큰을 공유하면 같은 공연 */
    const pk = it.startDate && it.venue ? `${it.startDate}|${venueKey(it.venue)}` : null;
    const pg = pk && venueKey(it.venue).length >= 3 ? byPlace.get(pk) : null;
    if (pg && pg.provider !== it.provider && !(pg.alsoAt || []).some((a) => a.provider === it.provider)) {
      const a = tokensOf(pg.title), b = tokensOf(it.title);
      const ka = titleKey(pg.title), kb = titleKey(it.title);
      if ([...a].some((x) => b.has(x)) || (ka.length >= 4 && kb.length >= 4 && (ka.includes(kb) || kb.includes(ka)))) { attach(pg, it); continue; }
    }
    const k = it.startDate ? `${titleKey(it.title)}|${it.startDate}` : null;
    const g = k && k.length > 12 ? byKey.get(k) : null;
    if (!g) { if (k) byKey.set(k, it); if (pk && !byPlace.has(pk)) byPlace.set(pk, it); out.push(it); continue; }
    if (g.provider === it.provider) { out.push(it); continue; }
    attach(g, it);
  }
  return out;
}
