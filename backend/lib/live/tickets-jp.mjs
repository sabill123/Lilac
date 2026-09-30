import { withEventGeography } from './geography.mjs';
/* 일본 예매처 실시간 공연 목록 — e+(イープラス) · チケットぴあ
 *
 * e+ (eplus.jp)
 *   GET https://eplus.jp/sf/live/k-pop-asian[/pN]     장르 목록(SSR HTML, 50건/페이지). a.ticket-item--kouen 단위:
 *        href=/sf/detail/{koenKey}, ticket-item__yyyy/mmdd(공연일), ticket-item__title(+label-ticket 先着/抽選),
 *        ticket-item__venue(会場（都道府県）), ticket-status__item(受付中/発売前…)
 *   GET https://eplus.jp/sf/search?keyword={q}       검색 결과 페이지 안의 <script id="json" type="application/json">
 *        {data:{record_list:[{koenbi_term, kaien_time, kanren_venue{venue_name,todofuken_name}, kanren_kogyo_sub{kogyo_name_1},
 *        koen_detail_url_pc, kanren_uketsuke_koen_list[{uketsuke_name_pc, uketsuke_start_datetime, uketsuke_end_datetime, uketsuke_status, hambai_hoho_label}]}]}}
 *        e+ 검색은 공연명(興行名) 기준이라 아티스트 표기가 다르면 0건일 수 있다.
 *
 * チケットぴあ (t.pia.jp)
 *   GET https://t.pia.jp/pia/tag/tag.do?tagCd=0000078   K-POP・韓流エンタメ 태그 목록 (SSR, 12건). ul.Y15-tag-eventlist__list > li
 *
 * ローチケ(l-tike.com)는 이 환경에서 연결 자체가 실패해 제외했다.
 * 포스터: e+ 목록에는 이미지가 없다(상세 og:image도 공통 로고). 호출자가 아티스트 이미지로 대체 표시한다.
 */
import { fetchText, clean, halfwidth } from './http.mjs';

const EPLUS = 'https://eplus.jp';

function kindOf(title) {
  if (/ファンミーティング|fan ?meeting|fan ?con|ファンコン|FANMEETING|ファンミ/i.test(title)) return 'fanmeeting';
  if (/フェス|festival|FES\b/i.test(title)) return 'festival';
  if (/ムビチケ|ライブビューイング|上映|配信|バーチャル/i.test(title)) return 'other';
  return 'concert';
}

function jpStatus(txt) {
  if (!txt) return 'unknown';
  if (/受付中|販売中|発売中|販売期間中|抽選受付中/.test(txt)) return 'onsale';
  if (/発売前|受付前|予定/.test(txt)) return 'upcoming';
  if (/予定枚数終了|完売|売切/.test(txt)) return 'soldout';
  if (/終了/.test(txt)) return 'closed';
  return 'unknown';
}

function ymd(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/* ---------- e+ 장르 목록 ---------- */
function parseEplusList(html, fetchedAt) {
  const out = [];
  const blocks = html.split('<a class="ticket-item ticket-item--kouen"').slice(1);
  for (const b of blocks) {
    const href = (b.match(/href="([^"]+)"/) || [])[1];
    if (!href) continue;
    const yyyy = (b.match(/ticket-item__yyyy">(\d{4})\//) || [])[1];
    const mmdd = [...b.matchAll(/ticket-item__mmdd">(\d{1,2})\/(\d{1,2})/g)];
    const yyyys = [...b.matchAll(/ticket-item__yyyy">(\d{4})\//g)].map((m) => m[1]);
    const titleRaw = (b.match(/<h3 class="ticket-item__title">([\s\S]*?)<\/h3>/) || [])[1] || '';
    const label = clean((titleRaw.match(/<span class="label-ticket">([\s\S]*?)<\/span>/) || [])[1]);
    const title = halfwidth(clean(titleRaw.replace(/<span class="label-ticket">[\s\S]*?<\/span>/, '')));
    const venueRaw = clean((b.match(/ticket-item__venue"><p>([\s\S]*?)<\/p>/) || [])[1]);
    const pref = (venueRaw.match(/（([^）]+)）\s*$/) || [])[1] || null;
    const venue = venueRaw.replace(/（[^）]+）\s*$/, '').trim() || null;
    const statusTxt = clean((b.match(/ticket-status__item[^"]*">([\s\S]*?)<\/span>/) || [])[1]);
    const start = yyyy && mmdd[0] ? ymd(yyyy, mmdd[0][1], mmdd[0][2]) : null;
    const end = mmdd[1] ? ymd(yyyys[1] || yyyy, mmdd[1][1], mmdd[1][2]) : start;
    const key = href.replace('/sf/detail/', '');
    out.push({
      id: `eplus:${key}`,
      provider: 'eplus',
      providerLabel: 'イープラス',
      title,
      artists: [],
      venue,
      city: pref,
      country: null,
      startDate: start,
      endDate: end,
      ticketOpenAt: null,
      saleType: label || null,
      status: jpStatus(statusTxt),
      statusText: statusTxt || null,
      poster: null,
      url: `${EPLUS}${href}`,
      genre: 'K-POP・韓流・アジア',
      kind: kindOf(title),
      fetchedAt,
    });
  }
  return out.map(withEventGeography);
}

export async function eplusGenre(slug = 'k-pop-asian', { maxPages = 4 } = {}) {
  const fetchedAt = new Date().toISOString();
  const first = await fetchText(`${EPLUS}/sf/live/${slug}`, { timeout: 12000, retries: 4 });
  const total = Number((first.match(/block-paginator__status">\s*(\d+)件中/) || [])[1] || 0);
  const pages = Math.min(Math.ceil(total / 50) || 1, maxPages);
  let items = parseEplusList(first, fetchedAt);
  for (let p = 2; p <= pages; p++) {
    try {
      await new Promise((r) => setTimeout(r, 900));
      const html = await fetchText(`${EPLUS}/sf/live/${slug}/p${p}`, { timeout: 12000, retries: 4 });
      items = items.concat(parseEplusList(html, fetchedAt));
    } catch { break; }
  }
  if (slug !== 'k-pop-asian') for (const it of items) it.genre = slug;
  return items;
}

/* ---------- e+ 검색 (판매 일정 포함) ---------- */
function eplusTs(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00` : null;
}

export async function eplusSearch(query) {
  const fetchedAt = new Date().toISOString();
  const html = await fetchText(`${EPLUS}/sf/search?keyword=${encodeURIComponent(query)}`, { timeout: 12000, retries: 3 });
  const m = html.match(/<script id="json" class="json" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('e+ search JSON missing');
  const j = JSON.parse(m[1]);
  const now = Date.now();
  return (j.data?.record_list || []).map((r) => {
    const d = r.koenbi_term;
    const date = d && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;
    const sales = (r.kanren_uketsuke_koen_list || []).map((u) => ({
      at: eplusTs(u.uketsuke_start_datetime),
      endAt: eplusTs(u.uketsuke_end_datetime),
      label: u.uketsuke_name_pc || u.hambai_hoho_label || '受付',
      method: u.hambai_hoho_label || null,
      statusCode: u.uketsuke_status,
    })).filter((s) => s.at).sort((a, b) => a.at.localeCompare(b.at));
    const open = sales.filter((s) => Date.parse(s.at) <= now && (!s.endAt || Date.parse(s.endAt) >= now));
    const next = sales.find((s) => Date.parse(s.at) > now) || null;
    const title = halfwidth(clean([r.kanren_kogyo_sub?.kogyo_name_1, r.kanren_kogyo_sub?.kogyo_name_2].filter(Boolean).join(' ')));
    return {
      id: `eplus:${String(r.koen_detail_url_pc || '').replace('/sf/detail/', '') || r.kogyo_code + '-' + r.koen_code}`,
      provider: 'eplus',
      providerLabel: 'イープラス',
      title,
      artists: [],
      venue: r.kanren_venue?.venue_name || null,
      city: r.kanren_venue?.todofuken_name || null,
      country: null,
      startDate: date,
      endDate: date,
      ticketOpenAt: next?.at || null,
      ticketOpenLabel: next?.label || null,
      openSchedule: sales,
      saleType: open[0]?.method || next?.method || null,
      status: open.length ? 'onsale' : next ? 'upcoming' : sales.length ? 'closed' : 'unknown',
      poster: null,
      url: r.koen_detail_url_pc ? `${EPLUS}${r.koen_detail_url_pc}` : `${EPLUS}/sf/search?keyword=${encodeURIComponent(query)}`,
      genre: null,
      kind: kindOf(title),
      fetchedAt,
    };
  }).map(withEventGeography);
}

/* ---------- チケットぴあ 검색 (판매 단위: 抽選·先行·一般) ----------
 *   GET https://t.pia.jp/pia/rlsInfo.do?kw={q}&includeSaleEnd=false&page=1&responsive=true&noConvert=true&searchMode=1&mode=2&dispMode=1
 *   검색 페이지가 JS로 불러오는 HTML 조각. div.event_link 마다 schema.org Event 마이크로데이터(이름·startDate·endDate·장소)와
 *   판매 상태("抽選受付中 ～2026/9/27(日) 23:59", "発売前 2026/10/1(木) 11:00より発売")가 들어 있다. */
function piaTs(y, mo, d, hm) {
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${hm || '00:00'}:00+09:00`;
}

export async function piaSearch(query, { pages = 2 } = {}) {
  const fetchedAt = new Date().toISOString();
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const url = `https://t.pia.jp/pia/rlsInfo.do?kw=${encodeURIComponent(query)}&cAsgnFlg=false&bAsgnFlg=false&includeSaleEnd=false&page=${page}&responsive=true&noConvert=true&searchMode=1&mode=2&dispMode=1`;
    const html = await fetchText(url, { timeout: 12000, retries: 2, headers: { Referer: 'https://t.pia.jp/pia/search_all.do' } });
    const blocks = html.split('<div class="event_link"').slice(1);
    for (const b of blocks) {
      const href = (b.match(/<a href="([^"]+)"/) || [])[1];
      const rawFull = clean((b.match(/<li class="is_title">([\s\S]*?)<\/li>/) || [])[1]);
      const rawTitle = halfwidth(rawFull);
      // 판매 구분과 공연명 사이의 '／' — 괄호(＜１１／６公演＞, 【…】, 「…」) 안의 '／'는 건너뛴다
      let cut = -1, depth = 0;
      for (let i = 0; i < rawFull.length; i++) {
        const ch = rawFull[i];
        if ('＜<【「『（('.includes(ch)) depth++;
        else if ('＞>】」』）)'.includes(ch)) depth = Math.max(0, depth - 1);
        else if (ch === '／' && depth === 0) { cut = i; break; }
      }
      const [saleLabel, eventTitle] = cut >= 0 ? [halfwidth(rawFull.slice(0, cut)), halfwidth(rawFull.slice(cut + 1))] : ['', rawTitle];
      const sd = (b.match(/itemprop="startDate" datetime="(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
      const ed = (b.match(/itemprop="endDate" datetime="(\d{4}-\d{2}-\d{2})/) || [])[1] || sd;
      const venue = halfwidth(clean((b.match(/itemprop="location"[^>]*><span itemprop="name">([\s\S]*?)<\/span>/) || [])[1])) || null;
      const pref = clean((b.match(/itemprop="addressRegion">([\s\S]*?)<\/span>/) || [])[1]) || null;
      const st = halfwidth(clean((b.match(/<li class="is_status">([\s\S]*?)<\/li>/) || [])[1]));
      const until = st.match(/[～~](\d{4})\/(\d{1,2})\/(\d{1,2})\([^)]*\)\s*(\d{1,2}:\d{2})/);
      const from = st.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\([^)]*\)\s*(\d{1,2}:\d{2})より/);
      const status = /予定枚数終了|完売/.test(st) ? 'soldout' : /発売前|受付前/.test(st) ? 'upcoming' : /受付中|販売期間中|発売中/.test(st) ? 'onsale' : /終了/.test(st) ? 'closed' : 'unknown';
      const code = (href || '').match(/eventCd=(\d+)&rlsCd=(\d*)&lotRlsCd=(\d*)/);
      const openAt = from ? piaTs(from[1], from[2], from[3], from[4].padStart(5, '0')) : null;
      const endAt = until ? piaTs(until[1], until[2], until[3], until[4].padStart(5, '0')) : null;
      const method = /抽選|プレリザーブ|先行/.test(saleLabel + st) ? (/抽選|プレリザーブ/.test(saleLabel + st) ? '抽選' : '先行') : /一般/.test(saleLabel) ? '一般発売' : null;
      out.push({
        id: `pia:${code ? code.slice(1).join('-') : href}`,
        provider: 'pia', providerLabel: 'チケットぴあ',
        title: eventTitle || rawTitle,
        artists: [],
        venue, city: pref, country: null,
        startDate: sd, endDate: ed,
        ticketOpenAt: openAt,
        ticketOpenLabel: saleLabel || null,
        openSchedule: openAt || endAt ? [{ at: openAt || null, endAt, label: saleLabel || method || '受付' }] : [],
        saleType: method,
        status,
        statusText: st.replace(/\s+/g, ' ') || null,
        poster: null,
        url: href ? href.replace(/^http:/, 'https:') : 'https://t.pia.jp/',
        genre: null,
        kind: kindOf(eventTitle || rawTitle),
        fetchedAt,
      });
    }
    const total = Number((html.match(/全<strong>(\d+)<\/strong>件中/) || [])[1] || 0);
    if (out.length >= total || !blocks.length) break;
  }
  return out.map(withEventGeography);
}

/* ---------- チケットぴあ K-POP 태그 ---------- */
export async function piaTag(tagCd = '0000078') {
  const fetchedAt = new Date().toISOString();
  const html = await fetchText(`https://t.pia.jp/pia/tag/tag.do?tagCd=${tagCd}`, { timeout: 12000 });
  const i = html.indexOf('Y15-tag-eventlist__list');
  if (i < 0) throw new Error('pia list block missing');
  const seg = html.slice(i, html.indexOf('</ul>', i));
  return seg.split(/<li>/).slice(1).map((li) => {
    const href = (li.match(/href="([^"]+)"/) || [])[1];
    const title = halfwidth(clean((li.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1]));
    const d = clean((li.match(/Y15-tag-event_date">([^<]*)/) || [])[1]);
    const ds = [...d.matchAll(/(\d{4})\/(\d{1,2})\/(\d{1,2})/g)];
    const venueRaw = halfwidth(clean((li.match(/Y15-tag-event_venue">([\s\S]*?)<\/span>/) || [])[1]));
    let img = (li.match(/url\('([^']+)'\)/) || [])[1] || null;
    if (img && img.startsWith('//')) img = 'https:' + img;
    if (img && /img-eventlist-none/.test(img)) img = null;
    const desc = clean((li.match(/<p>([\s\S]*?)<\/p>/) || [])[1]);
    const code = (href || '').match(/event(?:Bundle)?Cd=([a-z0-9]+)/i)?.[1];
    return {
      id: `pia:${code}`,
      provider: 'pia',
      providerLabel: 'チケットぴあ',
      title,
      description: desc || null,
      artists: [],
      venue: /\(/.test(venueRaw) ? venueRaw.replace(/\(([^)]*)\)\s*$/, '').trim() : null,
      city: (venueRaw.match(/\(([^)]*)\)\s*$/) || [])[1] || (venueRaw && !/\(/.test(venueRaw) ? venueRaw : null),
      country: null, // Seller country / 海外 is not venue-country evidence.
      startDate: ds[0] ? ymd(ds[0][1], ds[0][2], ds[0][3]) : null,
      endDate: ds[1] ? ymd(ds[1][1], ds[1][2], ds[1][3]) : ds[0] ? ymd(ds[0][1], ds[0][2], ds[0][3]) : null,
      ticketOpenAt: null,
      status: 'unknown',
      poster: img,
      url: href ? href.replace(/^http:/, 'https:') : null,
      genre: 'K-POP・韓流エンタメ',
      kind: kindOf(title),
      fetchedAt,
    };
  }).filter((x) => x.url && x.title).map(withEventGeography);
}

async function timed(provider, fn) {
  const t0 = Date.now();
  try {
    const items = await fn();
    return { provider, ok: true, count: items.length, ms: Date.now() - t0, items };
  } catch (e) {
    return { provider, ok: false, count: 0, ms: Date.now() - t0, error: String(e?.message || e), items: [] };
  }
}

function merge(results) {
  const seen = new Set();
  const items = [];
  for (const r of results) for (const it of r.items) {
    // 같은 예매처에서 같은 공연(제목·날짜·장소)이 판매 방식별로 여러 줄 나오면 하나로
    const k2 = `${it.provider}|${it.title}|${it.startDate}|${it.venue}`;
    if (seen.has(it.id) || seen.has(k2)) continue;
    seen.add(it.id);
    seen.add(k2);
    items.push(withEventGeography(it));
  }
  items.sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999'));
  return { items, sources: results.map(({ items: _i, ...rest }) => rest), fetchedAt: new Date().toISOString() };
}

export async function fetchJpConcerts({ category = 'kpop' } = {}) {
  const jobs = [];
  if (category === 'kpop' || category === 'all') {
    jobs.push(timed('eplus:k-pop', () => eplusGenre('k-pop-asian', { maxPages: 3 })));
    jobs.push(timed('pia:k-pop', () => piaTag('0000078')));
  }
  return merge(await Promise.all(jobs));
}

/* 여러 이름으로 e+ 검색 (아티스트별 판매 일정) */
export async function searchJpConcerts(queries, { concurrency = 3 } = {}) {
  const list = Array.isArray(queries) ? queries : [queries];
  const results = [];
  for (let i = 0; i < list.length; i += concurrency) {
    const chunk = list.slice(i, i + concurrency);
    results.push(...await Promise.all(chunk.flatMap((q) => [
      timed(`eplus:search:${q}`, () => eplusSearch(q)),
      timed(`pia:search:${q}`, () => piaSearch(q)),
    ])));
  }
  return merge(results);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const show = (label, r) => {
    console.log(`\n## ${label}`);
    for (const s of r.sources) console.log(`  ${s.provider}: ok=${s.ok} n=${s.count} ${s.ms}ms ${s.error || ''}`);
    for (const it of r.items.slice(0, 15)) console.log('  ' + JSON.stringify({ id: it.id, title: it.title, venue: it.venue, city: it.city, start: it.startDate, open: it.ticketOpenAt, status: it.status, url: it.url }));
  };
  show('K-POP 来日', await fetchJpConcerts({ category: 'kpop' }));
  show('검색', await searchJpConcerts(process.argv.slice(2).length ? process.argv.slice(2) : ['YOASOBI', 'Mrs. GREEN APPLE', 'TWICE', 'ILLIT', 'BE:FIRST']));
}
