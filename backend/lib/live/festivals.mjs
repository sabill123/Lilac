/* 음악 페스티벌 — 한국·일본에서 지금 예매 중이거나 곧 열리는 페스티벌
 *
 * 왜: 원더리벳처럼 한국 페스티벌에 J-POP 아티스트가 대거 나오고, 일본 락 페스티벌에도 K-POP 팀이 선다.
 *     아티스트 단독 공연 목록만 보면 이런 무대가 빠진다.
 * 소스 (아티스트·페스티벌별 수작업 목록 없음)
 *   한국: NOL 티켓 페스티벌 장르(03024), 멜론티켓 페스티벌 장르(GENRE_CON_FESTIVAL)
 *   일본: e+ 페스티벌 목록(/sf/live/festival)
 *   라인업: 멜론 상세의 출연진 목록(아티스트 링크), e+ 상세의 「出演」 블록
 * 같은 페스티벌의 권종별 상품(1일권·우선입장권·얼리버드·<入場券のみ>)은 하나로 묶는다.
 * 모르는 값은 null. 소스 하나가 실패해도 나머지는 반환한다. */
import { fetchText, clean, halfwidth } from './http.mjs';
import { nolList, melonList, venueCountry } from './tickets-kr.mjs';
import { eventGeography } from './geography.mjs';
import { yes24List, ticketlinkList, ltikeFestivals } from './vendors-extra.mjs';

const EPLUS = 'https://eplus.jp';
/* 음악 페스티벌이 아닌 행사(국악·클래식·연극·전시·스포츠) */
const NOT_MUSIC = /국악|연희|풍류|판소리|가곡|오페라|뮤지컬|연극|클래식|오케스트라|전시|박람회|마라톤|축구|야구|歌舞伎|落語|演劇|ミュージカル|クラシック|オーケストラ|将棋|スポーツ/;
/* 권종·부가 상품 표기: 묶을 때 떼어 낸다 */
const TICKET_SUFFIX = /\s*[-–—:：]\s*(?:우선입장권|익스클루시브[^\s]*|라운지[^\s]*|슈퍼\s*얼리버드|얼리버드|주차권|셔틀[^\s]*|1일권|2일권|3일권|양일권|VIP[^\s]*|캠핑[^\s]*)[^\n]*$|\s*(?:<[^>]*>|＜[^＞]*＞|&lt;[\s\S]*?&gt;|【[^】]*】|［[^］]*］|\[[^\]]*(?:券|권|ticket|TICKET)[^\]]*\])|\s*(?:シャトルバス券|駐車券|入場券のみ|前夜祭|後夜祭)$|\s+[^\s]{0,10}(?:入場券|通し券|観覧券|券)$|\s+[^\s]{0,6}(?:일권|입장권)$/gi;

export function festivalKey(title) {
  let t = halfwidth(String(title || '')).replace(/&amp;/g, '&').replace(/(〉|>|」)\s*\/[^/]{1,12}$/, '$1');
  for (let i = 0; i < 3; i++) t = t.replace(TICKET_SUFFIX, '');
  t = t.replace(/\((?:[가-힣A-Za-z0-9\s]+)\)\s*$/, '') // "WONDERLIVET 2026 (원더리벳 2026)" → 앞쪽
    .replace(/\[(?:Global|글로벌)\]\s*/i, '')
    .replace(/[\s'’"“”・·.,!！?？~〜～]+/g, '').toLowerCase();
  return t;
}
export function festivalTitle(title) {
  let t = halfwidth(String(title || '')).replace(/&amp;/g, '&').replace(/(〉|>|」)\s*\/[^/]{1,12}$/, '$1');
  for (let i = 0; i < 3; i++) t = t.replace(TICKET_SUFFIX, '');
  return t.replace(/\[(?:Global|글로벌)\]\s*/i, '').trim();
}

/* ---------- e+ 페스티벌 목록 (ticket-item--sub 블록) ---------- */
export function parseEplusFestivalList(html) {
  const out = [];
  for (const b of String(html).split('<a class="ticket-item ticket-item--sub"').slice(1)) {
    const href = (b.match(/href="([^"]+)"/) || [])[1];
    if (!href) continue;
    const dates = [...b.matchAll(/ticket-item__yyyy">(\d{4})\/<\/span><span class="ticket-item__mmdd">(\d{1,2})\/(\d{1,2})/g)].map((m) => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
    const title = halfwidth(clean((b.match(/ticket-item__title">([\s\S]*?)<\/h4>/) || [])[1] || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    const venueRaw = clean((b.match(/ticket-item__venue">\s*<p>([\s\S]*?)<\/p>/) || [])[1] || '');
    const pref = (venueRaw.match(/（([^）]+)）\s*$/) || [])[1] || null;
    const raw = (b.match(/background-image:\s*url\('([^']+)'\)/) || [])[1] || null;
    /* 이미지 없는 공연의 대체 그림(img_no_thumb)은 포스터가 아니다 — 상세 og:image로 채운다 */
    const image = raw && !/daitai|no_thumb|noimage/i.test(raw) ? raw : null;
    if (!title) continue;
    out.push({
      provider: 'eplus', title, url: `${EPLUS}${href}`,
      startDate: dates[0] || null, endDate: dates[dates.length - 1] || dates[0] || null,
      venue: venueRaw.replace(/（[^）]+）\s*$/, '').trim() || null, city: pref, country: 'JP',
      /* 목록 이미지는 작은 썸네일(/list/). 상세의 큰 이미지 경로로 바꾼다 */
      poster: image ? `${EPLUS}${image.replace('/list/', '/')}` : null,
    });
  }
  return out;
}

export async function eplusFestivals({ maxPages = 3, read = (u) => fetchText(u, { timeout: 12000, retries: 3 }) } = {}) {
  const first = await read(`${EPLUS}/sf/live/festival`);
  const total = Number((first.match(/(\d+)件中/) || [])[1] || 0);
  let items = parseEplusFestivalList(first);
  for (let p = 2; p <= Math.min(Math.ceil(total / 50) || 1, maxPages); p++) {
    try { await new Promise((r) => setTimeout(r, 900)); items = items.concat(parseEplusFestivalList(await read(`${EPLUS}/sf/live/festival/p${p}`))); } catch { break; }
  }
  return items;
}

/* ---------- 라인업 ---------- */
/** 멜론 상세: 출연진 목록(artistId 링크) */
export function melonLineup(html) {
  const out = [];
  /* 이름은 링크 바로 뒤 글자만(태그 전까지) — 마지막 출연자 뒤의 "더보기·가격정보"를 끌어오지 않게 */
  for (const m of String(html).matchAll(/artistId=(\d+)"\s+class="txt_name">([\s\S]{0,400}?)<\/a>/g)) {
    const name = m[2].replace(/<img[\s\S]*$/i, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 80) continue;
    if (name && !out.some((x) => x.name === name)) out.push({ name, melonId: m[1] });
  }
  return out;
}
/** 멜론 아티스트 페이지의 국적 → 'jp' | 'kr' | 'other' | null */
export function melonNation(html) {
  const m = String(html).match(/국적<\/dt>\s*<dd>([^<]{1,20})<|국적\s*(?:<[^>]+>\s*)*([가-힣A-Za-z]{2,10})/);
  const v = (m?.[1] || m?.[2] || '').trim();
  if (!v) return null;
  return /일본/.test(v) ? 'jp' : /대한민국|한국/.test(v) ? 'kr' : 'other';
}
/** e+ 상세: 「出演」 다음 줄들(날짜 줄은 건너뛰고, 공식 사이트·다음 블록 전까지) */
export function eplusLineup(html) {
  const text = String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '\n').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
  const lines = text.split('\n').map((l) => halfwidth(l).replace(/[\u00a0\u3000]/g, ' ').replace(/ {2,}/g, ' ').trim()).filter(Boolean);
  const i = lines.findIndex((l) => /^出演(?:者)?$|^【出演(?:者)?】$|^LINE ?UP$/i.test(l));
  if (i < 0) return [];
  const out = [];
  for (const l of lines.slice(i + 1, i + 40)) {
    if (/^(?:オフィシャルサイト|公式サイト|次へ|抽選|先着|受付|※|料金|チケット|【|問い?合わせ|開場|開演|曲目|演目|★|☆|注意|政府|令和|平成|ご来場)/.test(l) || /^https?:/.test(l)) break;
    /* 「出演者は公式サイトを参照」「後日発表」 — 라인업이 아니다 */
    if (/参照|後日|発表予定|決定次第|お知らせ|coming soon/i.test(l) && l.length > 8) break;
    if (/^[■□◆◇●○▼▽]?\s*(?:\d{1,2}月\d{1,2}日|\d{1,2}\/\d{1,2})|^DAY\s?\d|^<[^>]*>$|^＜[^＞]*＞$/i.test(l)) continue;
    for (const n of l.replace(/^[A-Za-z][A-Za-z0-9\s]{0,20}STAGE\s*[:：]\s*/i, '').split(/\s*[/／、,]\s*/)) {
      if (/^[\[［].*[\]］]$|ステージ$|^会場|^合計/.test(n.trim())) continue;
      const name = n.replace(/^[-・]\s*/, '').replace(/\s*(?:and more|ほか|他)[.…]*$/i, '').trim();
      if (name.length >= 1 && name.length <= 60 && !/^(?:and more|and more\.\.\.|ほか|他|TBA|coming soon)$/i.test(name) && !out.includes(name)) out.push(name);
    }
  }
  return out.slice(0, 120);
}

/* ---------- 한국 ---------- */
export async function krFestivals() {
  const [nol, melon, y24, tl] = await Promise.allSettled([nolList('03024', { maxPages: 8 }), melonList('GENRE_CON_FESTIVAL'), yes24List(15464, 2), ticketlinkList(14).then((l) => l.filter((x) => x.kind === 'festival'))]);
  const items = [];
  const push = (r) => { if (r.status === 'fulfilled') items.push(...(r.value.items || r.value)); };
  push(nol); push(melon); push(y24); push(tl);
  return {
    /* NOL 글로벌([Global]) 판매분은 해외 공연 — 공연장 단서로만 나라를 정하고, 모르면 뺀다 */
    items: items.map((x) => ({ provider: x.provider, title: x.title, url: x.url, startDate: x.startDate, endDate: x.endDate || x.startDate, venue: x.venue, city: x.city || null, country: /^\s*\[(?:Global|글로벌)\]/i.test(x.title) ? eventGeography({ venue: x.venue, city: x.city }).country : venueCountry(x.title, x.venue), poster: x.poster || null, status: x.status || null })).filter((x) => x.country === 'KR' || x.country === 'JP'),
    sources: [{ provider: 'nol:festival', ok: nol.status === 'fulfilled' }, { provider: 'melon:festival', ok: melon.status === 'fulfilled' }, { provider: 'yes24:festival', ok: y24.status === 'fulfilled' }, { provider: 'ticketlink:festival', ok: tl.status === 'fulfilled' }],
  };
}

/* ---------- 묶기 ---------- */
export function groupFestivals(items, { today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) } = {}) {
  const map = new Map();
  for (const it of items) {
    if (!it.title || NOT_MUSIC.test(it.title) || NOT_MUSIC.test(it.venue || '')) continue;
    if ((it.endDate || it.startDate || '9999') < today) continue;
    const key = `${it.country}|${festivalKey(it.title)}`;
    const g = map.get(key);
    const link = { provider: it.provider, url: it.url, title: it.title, status: it.status || null };
    if (!g) {
      map.set(key, { id: `fest:${key}`, kind: 'festival', title: festivalTitle(it.title), country: it.country, startDate: it.startDate, endDate: it.endDate, venue: it.venue, city: it.city, poster: it.poster, posterKind: it.poster ? 'official' : null, provider: it.provider, url: it.url, status: it.status || null, links: [link] });
      continue;
    }
    if (!g.links.some((l) => l.url === it.url)) g.links.push(link);
    if (it.startDate && (!g.startDate || it.startDate < g.startDate)) g.startDate = it.startDate;
    if (it.endDate && (!g.endDate || it.endDate > g.endDate)) g.endDate = it.endDate;
    if (!g.poster && it.poster) { g.poster = it.poster; g.posterKind = 'official'; }
    if (!g.venue && it.venue) g.venue = it.venue;
    /* 본 상품(권종 표기가 없는 제목)을 대표 링크로 */
    if (festivalTitle(it.title) === it.title.trim() && festivalTitle(g.links[0].title) !== g.links[0].title.trim()) { g.url = it.url; g.provider = it.provider; }
    if (it.status === 'onsale') g.status = 'onsale';
  }
  return [...map.values()].sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999'));
}

/* 멜론 아티스트 검색 결과 — [{ id, name }] */
export function melonArtistResults(html) {
  const out = [];
  for (const m of String(html).matchAll(/goArtistDetail\('(\d+)'\)[^>]*>([\s\S]{0,200}?)<\/a>/g)) {
    const name = m[2].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (name && !out.some((x) => x.id === m[1])) out.push({ id: m[1], name });
  }
  return out;
}
/* 검색어와 이름이 정확히 같은 결과만(괄호 안 표기 포함): "찬열 ( CHANYEOL )" ↔ CHANYEOL, "KickFlip (킥플립)" ↔ KickFlip.
   "세훈&찬열"·"동현 ( KickFlip )"처럼 멤버·유닛 결과는 괄호 밖 이름이 달라 제외한다 */
const nk = (s) => halfwidth(String(s || '')).toLowerCase().replace(/[\s'’"“”.·・!！?？\-_]/g, '');
export function melonExactMatches(query, results) {
  const q = nk(query);
  if (!q) return [];
  return results.filter((r) => {
    const outside = r.name.replace(/\([^)]*\)/g, '').trim();
    const inside = [...r.name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim());
    if (nk(outside) === q) return true;
    /* 괄호 안이 검색어: 같은 사람의 다른 표기(찬열 ( CHANYEOL ))이거나 소속 그룹 표기(동현 ( KickFlip )). 둘 다 국적은 같다 */
    return inside.some((x) => nk(x) === q) && !/[&,]/.test(outside) && inside.length === 1 && !/[A-Za-z]/.test(outside);
  });
}

/** 멜론 아티스트 페이지의 소속사 — 이름 검색으로 찾은 동명이인을 거르는 근거(소속사가 없는 무명 동명이인은 판정하지 않는다) */
export function melonAgency(html) {
  const m = String(html).match(/소속사<\/dt>\s*<dd[^>]*>([\s\S]{0,120}?)<\/dd>/);
  return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() || null : null;
}
/** 이름 검색 결과의 판정: 일본 국적이면 jp, 한국 법인(주식회사·(주)) 소속이면 kr, 그 밖에는 모른다 */
export function nameSearchNation(infos) {
  const v = infos.map((x) => (x.nation === 'jp' ? 'jp' : x.agency && /\(주\)|주식회사|㈜/.test(x.agency) ? 'kr' : x.nation === 'kr' && x.agency ? 'kr' : null)).filter(Boolean);
  const set = [...new Set(v)];
  return set.length === 1 ? set[0] : null;
}

/** e+ 상세의 「オフィシャルサイト: https://…」 — 이미지 없는 페스티벌은 공식 사이트 대표 이미지로 채운다 */
export function eplusOfficialSite(html) {
  const t = String(html).replace(/<script[\s\S]*?<\/script>/g, ' ');
  const m = t.match(/(?:オフィシャルサイト|公式サイト|公式HP|オフィシャルHP)\s*[:：]?\s*(?:<[^>]+>\s*)*(https?:\/\/[^\s"'<>]+)/);
  if (!m) return null;
  try { const u = new URL(m[1].replace(/&amp;/g, '&')); return /eplus\.jp$/.test(u.host) ? null : u.href; } catch { return null; }
}

/* ---------- 공식 사이트 찾기 (예매처에 이미지가 없는 페스티벌) ---------- */
const NOT_OFFICIAL = /(^|\.)(eplus\.jp|pia\.jp|l-tike\.com|lawson|ticketjam|ticket|twitter\.com|x\.com|instagram\.com|facebook\.com|youtube\.com|tiktok\.com|wikipedia\.org|natalie\.mu|barks\.jp|oricon\.co\.jp|musicvoice|okmusic|billboard-japan|mdpr\.jp|walkerplus|jorudan|note\.com|ameblo\.jp|yahoo|google|bing|line\.me|jalan|rurubu|enjoytokyo|iko-yo|festival-life|fesdb|livefans|setlist|spice|rockinon\.com\/news|creatorsbox|fnmnl|jrocknews|tokyo-np|asahi|yomiuri|nikkei|mainichi|nhk)(\.|$|\/)/i;
/** 제목의 식별 토큰: 연도·흔한 말을 뺀 가장 긴 조각 */
export function festivalTokens(title) {
  const t = festivalTitle(title).normalize('NFKC').toLowerCase()
    .replace(/presents?|supported by|powered by|sponsored by/g, ' ')
    .replace(/(?:19|20)\d{2}|'\d{2}|’\d{2}|vol\.?\s*\d+/g, ' ');
  return t.split(/[^a-z0-9ぁ-んァ-ヶ一-龯ー가-힣]+/).filter((x) => x.length >= 3 && !/^(?:festival|fes|fest|music|live|rock|the|and|tour|in|of|stage|special|presents|フェス|フェスティバル|ライブ|音楽祭)$/.test(x)).sort((a, b) => b.length - a.length);
}
/** 검색 결과에서 공식 사이트: 페이지 제목에 페스티벌의 식별 토큰이 들어 있어야 한다 */
export async function findFestivalSite(title, { queryEngine, readPage, ogImageOf }) {
  const tokens = festivalTokens(title);
  if (!tokens.length) return null;
  const q = `${festivalTitle(title)} 公式サイト`;
  let urls = [];
  for (const eng of ['yahoo', 'brave', 'ddg']) {
    const r = await queryEngine(eng, q);
    if (r.urls.length) { urls = r.urls; break; }
  }
  const seen = new Set();
  for (const u of urls) {
    let host;
    try { host = new URL(u).host; } catch { continue; }
    if (NOT_OFFICIAL.test(host + new URL(u).pathname) || seen.has(host)) continue;
    seen.add(host);
    if (seen.size > 4) break;
    let html;
    try { html = await readPage(u); } catch { continue; }
    const head = `${(html.match(/<title>([^<]*)/i) || [])[1] || ''} ${(html.match(/property=["']og:title["'][^>]+content=["']([^"']+)/i) || [])[1] || ''}`.normalize('NFKC').toLowerCase().replace(/[\s\-_・·]/g, '');
    if (!head.includes(tokens[0].replace(/[\s\-_・·]/g, ''))) continue;
    const image = ogImageOf(html, u);
    return { url: u, image: image && !/logo|favicon|noimage|webclip/i.test(image) ? image : null };
  }
  return null;
}

/** 일본: e+ 목록 + 로치케 페스 특집 */
export async function jpFestivals({ eplus = () => eplusFestivals() } = {}) {
  const [ep, lt] = await Promise.allSettled([eplus(), ltikeFestivals()]);
  const items = [...(ep.status === 'fulfilled' ? ep.value : []), ...(lt.status === 'fulfilled' ? lt.value.filter((x) => x.country === 'JP').map((x) => ({ provider: 'ltike', title: x.title, url: x.url, startDate: x.startDate, endDate: x.endDate, venue: x.venue, city: x.city, country: 'JP', poster: x.poster, status: x.status })) : [])];
  return { items, sources: [{ provider: 'eplus:festival', ok: ep.status === 'fulfilled', count: ep.status === 'fulfilled' ? ep.value.length : 0 }, { provider: 'ltike:festival', ok: lt.status === 'fulfilled', count: lt.status === 'fulfilled' ? lt.value.length : 0 }] };
}
