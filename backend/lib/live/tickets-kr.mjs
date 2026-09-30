/* 한국 예매처 실시간 공연 목록 — NOL 티켓(인터파크) · 멜론티켓
 *
 * 사용하는 엔드포인트 (2026-09-27 브라우저 네트워크 관찰로 확인)
 *
 * NOL 티켓 (구 인터파크 티켓, nol.yanolja.com)
 *   POST https://nol.yanolja.com/ticket/genre/api/cx-display/widget/v1/multiple-filtered-entertainment-list/items
 *        body {target:'ENTERTAINMENT:CONCERT', page, category, filters:[REGION_FILTER ALL, SORT_FILTER DAILY_RANKING_SCORE_DESC]}
 *        category: 'ALL' | '03017'(내한공연) | '03025|03006'(팬클럽/팬미팅) | '03012'(콘서트) | '03024'(페스티벌) …
 *        응답 {items:[{data:{id,title,dateInfo:'26.10.23 ~ 26.10.25',locationDetails,thumbnail,action.web},
 *                     serverLogMeta:{subGenreCode,subGenreName,regionName,placeName,saleStatus}}], paging:{isLast,total}}
 *        페이지당 10건. 상세 URL = https://nol.yanolja.com/ticket/products/{id}
 *   GET  https://nol.yanolja.com/ticket/display/upcoming?genre=concert   (SSR, React Server Components 스트림)
 *        self.__next_f.push([1,"…"]) 조각을 이어 붙이면 notices[] JSON이 들어 있다:
 *        ticket_dates[{ticket_open_date,ticket_open_type_name,ticket_other_open_name}], title, venue_name,
 *        goods_code, goods_poster_image_url, goods_start_date, goods_end_date, goods_sub_genre_name, open_type_name
 *
 * 멜론티켓 (ticket.melon.com)
 *   GET https://ticket.melon.com/performance/ajax/prodList.json?perfGenreCode=GENRE_CON_VISIT_KOR&sortType=HIT&filterCode=FILTER_ALL&v=1
 *        perfGenreCode: GENRE_CON_ALL / GENRE_CON_VISIT_KOR(내한) / GENRE_CON_IDOL / GENRE_FAN …  (필터가 실제로 적용됨: 98/25/7건 비교 확인)
 *        data[{prodId,title,periodInfo:'2026.10.23 - 2026.10.25',placeName,regionName,posterImg,saleTypeJson,stateFlg}]
 *        상세 URL = https://ticket.melon.com/performance/index.htm?prodId={prodId}
 *   GET https://ticket.melon.com/csoon/ajax/listTicketOpen.htm?orderType=0&pageIndex=N&schGcode=GENRE_CON_ALL[&schText=]
 *        HTML 조각. li 단위로 티켓오픈일·제목·csoonId·포스터. 상세 = https://ticket.melon.com/csoon/detail.htm?csoonId=
 *
 * YES24 티켓은 이번 단계에서 제외: 장르 목록이 ASP.NET 포스트백으로만 바뀌어 안정적인 목록 엔드포인트를 찾지 못했다.
 *
 * 원칙: 값은 모두 예매처 응답에서 온다. 모르는 값은 null. 예매처 하나가 실패해도 나머지는 반환한다.
 */
import { fetchText, fetchJson, clean, halfwidth, normDate, pool } from './http.mjs';

const NOL_LIST = 'https://nol.yanolja.com/ticket/genre/api/cx-display/widget/v1/multiple-filtered-entertainment-list/items';
const NOL_UPCOMING = 'https://nol.yanolja.com/ticket/display/upcoming?genre=concert';
const MELON_LIST = 'https://ticket.melon.com/performance/ajax/prodList.json';
const MELON_CSOON = 'https://ticket.melon.com/csoon/ajax/listTicketOpen.htm';
const MELON_IMG = 'https://cdnticket.melon.co.kr';

export const NOL_CATEGORY = { visiting: '03017', fanmeeting: '03025|03006', concert: '03012', festival: '03024', all: 'ALL' };

/* NOL 월드(글로벌) 판매분 중 일본 공연 — 제목의 IN JAPAN, 장소가 일본 돔·아레나 */
const JP_VENUE = /TOKYO|OSAKA|NAGOYA|FUKUOKA|SAPPORO|KYOCERA|VANTELIN|MIZUHO|BELLUNA|SAITAMA|YOKOHAMA|KOBE|도쿄|오사카|나고야|후쿠오카|東京|大阪|名古屋|福岡/i;
export function venueCountry(title, venue) {
  if (/\bIN JAPAN\b|JAPAN TOUR|JAPAN FAN ?MEETING|\bJAPAN\b.*\bDOME\b/i.test(title || '')) return 'JP';
  if (JP_VENUE.test(venue || '')) return 'JP';
  return 'KR';
}

function kindOf(title, genre) {
  const t = `${title} ${genre || ''}`;
  if (/팬미팅|팬클럽|fan ?meeting|fan ?con|팬콘/i.test(t)) return 'fanmeeting';
  if (/페스티벌|festival|fes\b|페스타/i.test(t)) return 'festival';
  if (/MD|굿즈|사전 판매/i.test(t) && !/콘서트|concert|live/i.test(t)) return 'other';
  return 'concert';
}

function nolStatus(s) {
  if (!s) return 'unknown';
  if (/ON_SALE/.test(s)) return 'onsale';
  if (/SOLD_OUT/.test(s)) return 'soldout';
  if (/(BEFORE|READY|UPCOMING|PRE)/.test(s)) return 'upcoming';
  if (/(END|CLOSE)/.test(s)) return 'closed';
  return 'unknown';
}

function splitRange(s) {
  if (!s) return [null, null];
  const parts = String(s).split(/~|-(?=\s*\d{2,4}\.)|–/).map((x) => x.trim()).filter(Boolean);
  const a = normDate(parts[0]);
  const b = normDate(parts[1] || parts[0]);
  return [a, b];
}

/* ---------- NOL 티켓 ---------- */
async function nolPage(category, page) {
  const body = JSON.stringify({
    target: 'ENTERTAINMENT:CONCERT', page, category,
    filters: [{ key: 'REGION_FILTER', code: 'ALL' }, { key: 'SORT_FILTER', code: 'DAILY_RANKING_SCORE_DESC' }],
  });
  const txt = await fetchText(NOL_LIST, {
    method: 'POST', body, timeout: 9000,
    headers: { 'Content-Type': 'application/json', Origin: 'https://nol.yanolja.com', Referer: 'https://nol.yanolja.com/ticket/genre/concert' },
  });
  return JSON.parse(txt);
}

function nolItem(it, fetchedAt) {
  const d = it.data || {};
  const m = it.serverLogMeta || {};
  const [startDate, endDate] = splitRange(d.dateInfo || m.dateInfo);
  const title = halfwidth(clean(d.title));
  return {
    id: `nol:${d.id}`,
    provider: 'nol',
    providerLabel: 'NOL 티켓(인터파크)',
    title,
    artists: [],
    venue: m.placeName || (d.locationDetails || [])[0] || null,
    city: m.regionName || null,
    country: venueCountry(title, m.placeName || (d.locationDetails || [])[0]),
    startDate, endDate,
    ticketOpenAt: null,
    status: nolStatus(m.saleStatus),
    poster: d.thumbnail || null,
    url: d.action?.web || `https://nol.yanolja.com/ticket/products/${d.id}`,
    genre: m.subGenreName || null,
    badges: (d.benefitBadges || []).map((b) => b.text).filter(Boolean),
    kind: kindOf(title, m.subGenreName),
    fetchedAt,
  };
}

export async function nolList(category = 'ALL', { maxPages = 40, concurrency = 4 } = {}) {
  const fetchedAt = new Date().toISOString();
  const first = await nolPage(category, 1);
  const total = Math.min(first.paging?.total || 1, maxPages);
  const pages = [first];
  if (total > 1) {
    const rest = await pool(Array.from({ length: total - 1 }, (_, i) => i + 2), concurrency, (p) => nolPage(category, p));
    for (const r of rest) if (r && !r.error) pages.push(r);
  }
  const seen = new Set();
  const out = [];
  for (const pg of pages) for (const it of pg.items || []) {
    if (it.type !== 'PRODUCT_ITEM') continue;
    const row = nolItem(it, fetchedAt);
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/* RSC 스트림에서 notices 배열을 꺼낸다 */
function rscText(html) {
  let out = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { out += JSON.parse(m[1]); } catch { /* 조각 하나 손상은 무시 */ }
  }
  return out;
}

function extractJsonArray(text, key) {
  const k = `"${key}":[`;
  const i = text.indexOf(k);
  if (i < 0) return null;
  let depth = 0, inStr = false, esc = false;
  const start = i + k.length - 1;
  for (let j = start; j < text.length; j++) {
    const c = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, j + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

export async function nolTicketOpens() {
  const fetchedAt = new Date().toISOString();
  const html = await fetchText(NOL_UPCOMING, { timeout: 12000 });
  const notices = extractJsonArray(rscText(html), 'notices') || [];
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  return notices.filter((n) => !n.goods_end_date || n.goods_end_date >= today).map((n) => {
    const dates = (n.ticket_dates || [])
      .map((t) => ({
        at: t.ticket_open_date ? `${t.ticket_open_date}+09:00` : null,
        label: t.ticket_other_open_name || t.ticket_open_type_name || '예매 오픈',
      }))
      .filter((t) => t.at && !t.at.startsWith('9999'))
      .sort((a, b) => a.at.localeCompare(b.at));
    const tba = (n.ticket_dates || []).some((t) => String(t.ticket_open_date || '').startsWith('9999'));
    const now = Date.now();
    const next = dates.find((d) => Date.parse(d.at) > now) || dates[dates.length - 1] || null;
    const title = halfwidth(clean(n.title));
    return {
      id: `nol-open:${n.id}`,
      provider: 'nol',
      providerLabel: 'NOL 티켓(인터파크)',
      title,
      artists: [],
      venue: n.venue_name || null,
      city: n.goods_region_name || null,
      country: 'KR',
      startDate: n.goods_start_date || null,
      endDate: n.goods_end_date || null,
      ticketOpenAt: next?.at || null,
      ticketOpenLabel: next?.label || null,
      openTba: tba && !next,
      openSchedule: dates,
      openType: n.open_type_name || null,
      status: 'upcoming',
      poster: n.goods_poster_image_url || n.open_notice_poster_image_url || null,
      url: n.goods_code ? `https://nol.yanolja.com/ticket/products/${n.goods_code}` : 'https://nol.yanolja.com/ticket/display/upcoming?genre=concert',
      genre: (n.goods_sub_genre_name || '').replace(/^콘서트 - /, '') || null,
      badges: [n.goods_seat_type_name].filter((b) => b && b !== '일반'),
      kind: kindOf(title, n.goods_sub_genre_name),
      fetchedAt,
    };
  });
}

/* ---------- 멜론티켓 ---------- */
function melonTs(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00` : null;
}

function melonSaleDates(json) {
  try {
    const j = JSON.parse(json || '{}');
    const web = (j.data?.list || []).find((p) => p.pocCode === 'SC0002') || (j.data?.list || [])[0];
    return (web?.saleTypeCodeList || []).map((s) => ({ at: melonTs(s.reserveStartDt), label: s.saleTypeName || '예매' }))
      .filter((s) => s.at).sort((a, b) => a.at.localeCompare(b.at));
  } catch { return []; }
}

function melonStatus(flag, dates) {
  const now = Date.now();
  if (dates.length && dates.every((d) => Date.parse(d.at) > now)) return 'upcoming';
  if (flag === 'SS0200') return 'onsale';
  if (flag === 'SS0300' || flag === 'SS0400') return 'closed';
  return dates.length ? 'onsale' : 'unknown';
}

export async function melonList(genre = 'GENRE_CON_ALL') {
  const fetchedAt = new Date().toISOString();
  const url = `${MELON_LIST}?commCode=&sortType=HIT&perfGenreCode=${encodeURIComponent(genre)}&perfThemeCode=&filterCode=FILTER_ALL&v=1`;
  const j = await fetchJson(url, { headers: { Referer: 'https://ticket.melon.com/concert/index.htm' }, timeout: 12000 });
  const now = Date.now();
  return (j.data || []).map((d) => {
    const [startDate, endDate] = splitRange(d.periodInfo);
    const dates = melonSaleDates(d.saleTypeJson);
    const next = dates.find((x) => Date.parse(x.at) > now) || null;
    const title = halfwidth(clean(d.title));
    return {
      id: `melon:${d.prodId}`,
      provider: 'melon',
      providerLabel: '멜론티켓',
      title,
      artists: [],
      venue: d.placeName || null,
      city: d.regionName || null,
      country: 'KR',
      startDate, endDate,
      ticketOpenAt: next?.at || null,
      ticketOpenLabel: next?.label || null,
      openSchedule: dates,
      status: melonStatus(d.stateFlg, dates),
      poster: d.posterImg ? `${MELON_IMG}${d.posterImg}` : null,
      url: `https://ticket.melon.com/performance/index.htm?prodId=${d.prodId}`,
      genre: genre === 'GENRE_CON_VISIT_KOR' ? '내한공연' : genre === 'GENRE_FAN' ? '팬미팅' : '콘서트',
      badges: [],
      kind: kindOf(title, genre === 'GENRE_FAN' ? '팬미팅' : ''),
      fetchedAt,
    };
  });
}

export async function melonTicketOpens({ pages = 3, schGcode = 'GENRE_CON_ALL', query = '' } = {}) {
  const fetchedAt = new Date().toISOString();
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const url = `${MELON_CSOON}?orderType=0&pageIndex=${p}&schGcode=${schGcode}&schText=${encodeURIComponent(query)}`;
    const html = await fetchText(url, { headers: { Referer: 'https://ticket.melon.com/csoon/index.htm' } });
    const lis = html.split(/<li>/).slice(1);
    if (!lis.length) break;
    for (const li of lis) {
      const id = (li.match(/csoonId=(\d+)/) || [])[1];
      if (!id) continue;
      const date = clean((li.match(/<span class="date">([\s\S]*?)<\/span>/) || [])[1]);
      const title = halfwidth(clean((li.match(/class="tit">([\s\S]*?)<\/a>/) || [])[1]).replace(/\s*티켓\s*오픈\s*안내\s*$/, '').replace(/\s*티켓오픈\s*안내\s*$/, ''));
      const img = (li.match(/<img src=\s*"([^"]+)"/) || [])[1] || null;
      const state = clean((li.match(/<span class="ticket_state">([\s\S]*?)<\/span>/) || [])[1]);
      const dm = date.match(/(\d{4})\.(\d{2})\.(\d{2})\([^)]*\)\s*(\d{2}):(\d{2})/);
      const badges = [...li.matchAll(/<span class="ico_list[^"]*">([^<]+)<\/span>/g)].map((m) => clean(m[1]));
      out.push({
        id: `melon-open:${id}`,
        provider: 'melon',
        providerLabel: '멜론티켓',
        title,
        artists: [],
        venue: null,
        city: null,
        country: 'KR',
        startDate: null, endDate: null,
        ticketOpenAt: dm ? `${dm[1]}-${dm[2]}-${dm[3]}T${dm[4]}:${dm[5]}:00+09:00` : null,
        ticketOpenLabel: state || '티켓오픈',
        openSchedule: [],
        status: 'upcoming',
        poster: img ? img.replace(/\/melon\/resize\/\d+x\d+\/strip\/true$/, '/melon/resize/320x456/strip/true') : null,
        url: `https://ticket.melon.com/csoon/detail.htm?csoonId=${id}`,
        genre: schGcode === 'GENRE_FAN_ALL' ? '팬미팅' : '콘서트',
        badges,
        kind: kindOf(title, schGcode === 'GENRE_FAN_ALL' ? '팬미팅' : ''),
        fetchedAt,
      });
    }
  }
  return out;
}

/* ---------- 묶음 API ---------- */
async function timed(provider, fn) {
  const t0 = Date.now();
  try {
    const items = await fn();
    return { provider, ok: true, count: items.length, ms: Date.now() - t0, items };
  } catch (e) {
    return { provider, ok: false, count: 0, ms: Date.now() - t0, error: String(e?.message || e), items: [] };
  }
}

function sortByDate(a, b) {
  return (a.startDate || '9999').localeCompare(b.startDate || '9999');
}

function merge(results) {
  const seen = new Set();
  const items = [];
  for (const r of results) for (const it of r.items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    items.push(it);
  }
  return {
    items,
    sources: results.map(({ items: _i, ...rest }) => rest),
    fetchedAt: new Date().toISOString(),
  };
}

/* category: 'visiting'(내한) | 'kpop'(국내 콘서트·팬미팅 전체 — K-POP 여부 판정은 호출자가 한다) | 'all' */
export async function fetchKrConcerts({ category = 'visiting' } = {}) {
  const jobs = [];
  if (category === 'visiting' || category === 'all') {
    jobs.push(timed('nol:visiting', () => nolList(NOL_CATEGORY.visiting)));
    jobs.push(timed('melon:visiting', () => melonList('GENRE_CON_VISIT_KOR')));
  }
  if (category === 'kpop' || category === 'all') {
    jobs.push(timed('nol:concert', () => nolList(NOL_CATEGORY.all, { maxPages: 40 })));
    jobs.push(timed('nol:fanmeeting', () => nolList(NOL_CATEGORY.fanmeeting)));
    jobs.push(timed('melon:concert', () => melonList('GENRE_CON_ALL')));
    jobs.push(timed('melon:fanmeeting', () => melonList('GENRE_FAN')));
  }
  const res = merge(await Promise.all(jobs));
  res.items.sort(sortByDate);
  return res;
}

export async function fetchKrTicketOpens() {
  const res = merge(await Promise.all([
    timed('nol:open', () => nolTicketOpens()),
    timed('melon:open', () => melonTicketOpens({ pages: 3, schGcode: 'GENRE_CON_ALL' })),
    timed('melon:open-fan', () => melonTicketOpens({ pages: 1, schGcode: 'GENRE_FAN_ALL' })),
  ]));
  res.items.sort((a, b) => (a.ticketOpenAt || '9999').localeCompare(b.ticketOpenAt || '9999'));
  return res;
}

/* CLI: node backend/lib/live/tickets-kr.mjs */
if (import.meta.url === `file://${process.argv[1]}`) {
  const show = (label, r) => {
    console.log(`\n## ${label}`);
    for (const s of r.sources) console.log(`  ${s.provider}: ok=${s.ok} n=${s.count} ${s.ms}ms ${s.error || ''}`);
    for (const it of r.items.slice(0, 15)) console.log('  ' + JSON.stringify({ id: it.id, title: it.title, venue: it.venue, start: it.startDate, open: it.ticketOpenAt, status: it.status, genre: it.genre, url: it.url, poster: !!it.poster }));
  };
  show('내한', await fetchKrConcerts({ category: 'visiting' }));
  show('티켓 오픈', await fetchKrTicketOpens());
  const k = await fetchKrConcerts({ category: 'kpop' });
  show('국내 콘서트 전체', k);
}
