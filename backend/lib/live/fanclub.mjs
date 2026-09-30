import { weverseKind } from './membership-policy.mjs';
/* 공식 팬클럽 — 찾기 · 가입 조건 · 팬클럽 선행/전용 공연
 *
 * 왜: 일본 아티스트의 큰 공연은 예매처(e+·ぴあ)보다 팬클럽 선행이 먼저, 때로는 팬클럽 전용으로만 팔린다.
 *     예매처만 보면 "공연 없음"으로 보이지만 실제로는 팬클럽 회원이면 지금 신청할 수 있다.
 *     팬에게는 신청 경로를, 소속사에는 팬클럽 가입 유입을 만든다.
 *
 * 방법 (아티스트별 수작업 목록 없음)
 *   1) 공식 사이트(MusicBrainz official 링크) 첫 화면의 링크에서 팬클럽·가입 페이지를 찾는다
 *      - 문구: 新規入会 / 入会 / 会員登録 / FAN CLUB / ファンクラブ / MEMBER / JOIN / 멤버십
 *      - 주소: /feature/entry, introduction_fc, fc.·member.·fanclub. 하위 도메인, go.weverse.io(Weverse 멤버십)
 *   2) 가입 페이지 본문에서 연회비·월회비·입회금, 해외 거주자 가입(日本以外にお住まいの方·海外在住), 결제 수단, 제공 언어를 뽑는다
 *   3) 공식 사이트·팬클럽 사이트의 투어/라이브/티켓 페이지에서 "受付期間" 블록을 찾아
 *      선행 이름(OFFICIAL FAN CLUB「…」全会員先行, VAWS（海外在住）先行…), 접수 기간, 신청 조건, 해외 거주자 여부, 공연 일정을 뽑는다
 * 모든 값에 원문 URL을 남긴다. 추출하지 못한 값은 null — 추측하지 않는다.
 */
import { fetchText, fetchViaCurl, halfwidth } from './http.mjs';
import { fanclubEvidence } from './fc-evidence.mjs';

/* 팬클럽 화면은 일본어로 받는다 — 파서가 일본어 표기(年会費·入会金)를 읽고, 한국어로 바뀐 화면(bmsg.shop/ko-kr)은 요금 표기가 달라진다 */
const fetchJa = (u, o = {}) => fetchText(u, { ...o, headers: { 'Accept-Language': 'ja,en;q=0.8', ...(o.headers || {}) } });

const text = (html) => String(html || '')
  .replace(/<!--[\s\S]*?-->/g, ' ') // 주석 처리된(화면에 안 보이는) 옛 요금·문구는 읽지 않는다
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/g, ' ')
  .replace(/\r?\n/g, ' ') // HTML 원문의 줄바꿈은 공백이다(태그로만 줄을 나눈다)
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(p|div|li|tr|h\d|dt|dd|th|td|section|article|header|footer)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&yen;/g, '¥').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#0?39;|&#x27;/g, "'").replace(/&quot;/g, '"')
  /* 숫자 참조(&#x1F4CD; 같은 그림 문자 포함)를 풀고, 그림 문자는 지운다 — 화면에 "&#x1F4CD;"가 그대로 나오던 문제 */
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ' '; } })
  .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(Number(d)); } catch { return ' '; } })
  .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
  .replace(/[ \t\u3000]+/g, ' ')
  .split('\n').map((l) => l.trim()).filter(Boolean);

function links(html, base) {
  const out = [];
  for (const m of String(html).matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]{0,3000}?)<\/a>/gi)) {
    let href = m[1].replace(/&amp;/g, '&').trim();
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    try { href = new URL(href, base).href; } catch { continue; }
    const alt = (m[2].match(/alt="([^"]*)"/) || [])[1] || '';
    const label = `${m[2].replace(/<[^>]+>/g, ' ')} ${alt}`.replace(/\s+/g, ' ').trim();
    out.push({ href, label });
  }
  return out;
}

const ENTRY_TXT = /新規入会|入会はこちら|ご入会|会員登録|新規会員|入会・継続|JOIN\b|SIGN ?UP|Join us|가입|멤버십/i;
const ENTRY_URL = /\/feature\/entry|introduction_fc|\/join\b|\/signup|\/entry\b|\/register|go\.weverse\.io|weverse\.io\/.*membership/i;
const FC_TXT = /FAN ?CLUB|ファンクラブ|OFFICIAL FAN|MEMBERS?\b|メンバーシップ|会員サイト|팬클럽|\bCLUB [A-Z0-9]{2,}\b/i;
const FC_HOST = /^(fc|member|members|fanclub|club)\./i;
const BAD_HOST = /(^|\.)(twitter\.com|x\.com|instagram\.com|youtube\.com|youtu\.be|tiktok\.com|facebook\.com|line\.me|apple\.com|spotify\.com|amazon\.co\.jp|amazon\.com|tower\.jp|hmv\.co\.jp|pixiv\.net)$/i;
const BAD_PATH = /store|shop|goods|login|privacy|terms|faq|contact|recruit|profile|archive|device|deals/i;
/* 상점 도메인이라도 팬클럽 안내 경로면 팬클럽이다(bmsg.shop/pages/befirst-fc-members) */
const FC_PATH = /fc[-_]?members?|fanclub|fan-club|membership|\/fc(\/|$)/i;
const NOT_FC = { test: (u) => { try { const x = new URL(u); return BAD_HOST.test(x.host) || (BAD_PATH.test(x.host + x.pathname) && !FC_PATH.test(x.pathname)); } catch { return true; } } };

/* 플랫폼: 주소로 먼저, 안 되면 페이지 안의 표식(운영사 링크·스크립트 경로)으로 */
export function platformFromHtml(html) {
  const h = String(html || '');
  if (/plusmember\.jp|fanpla\.jp|\/static\/original\/fanclub/i.test(h)) return 'PLUS MEMBER';
  if (/familyclub\.jp/i.test(h) && /fc-member|会員規約/.test(h)) return 'FAMILY CLUB';
  if (/sonymusicsolutions\.co\.jp|©\s*Sony Music Solutions/i.test(h)) return 'Sony Music Solutions';
  if (/skiyaki|bitfan\.net/i.test(h)) return 'SKIYAKI';
  if (/fanicon\.net/i.test(h)) return 'Fanicon';
  if (/cdn\.shopify\.com|Shopify\.theme/i.test(h)) return 'Shopify';
  return null;
}

function platformOf(url) {
  const u = String(url || '');
  if (/plusmember\.jp|\/static\/original\/fanclub/.test(u)) return 'PLUS MEMBER';
  if (/weverse/.test(u)) return 'Weverse';
  if (/fanicon/.test(u)) return 'Fanicon';
  if (/bitfan/.test(u)) return 'Bitfan';
  if (/emtg|m-on-music/.test(u)) return 'EMTG';
  if (/tobe-community\.jp/.test(u)) return 'TOBE';
  return null;
}

export async function discoverFanclub(officialUrl) {
  if (!officialUrl || /music\.apple\.com|spotify|wikipedia/.test(officialUrl)) return null;
  const home = await fetchJa(officialUrl, { timeout: 10000, retries: 1 });
  const ls = links(home, officialUrl);
  const siteHost = new URL(officialUrl).host.replace(/^www\./, '');
  const score = (l) => {
    if (NOT_FC.test(l.href) && !ENTRY_URL.test(l.href)) return 0;
    let s = 0;
    if (ENTRY_TXT.test(l.label)) s += 5;
    if (ENTRY_URL.test(l.href)) s += 4;
    if (FC_TXT.test(l.label)) s += 3;
    try { if (FC_HOST.test(new URL(l.href).host)) s += 3; if (FC_PATH.test(new URL(l.href).pathname)) s += 3; } catch { /* */ }
    if (/weverse/.test(l.href)) s += 2;
    return s;
  };
  const ranked = ls.map((l) => ({ ...l, s: score(l) })).filter((l) => l.s >= 3).sort((a, b) => b.s - a.s);
  // 공식 사이트 자체가 팬클럽 플랫폼인 경우(PLUS MEMBER 사이트는 /feature/entry 를 가진다)
  const embedded = /plusmember\.jp|\/static\/original\/fanclub/.test(home);
  let entry = ranked.find((l) => ENTRY_TXT.test(l.label) || ENTRY_URL.test(l.href)) || null;
  let top = ranked.find((l) => FC_TXT.test(l.label) || (() => { try { return FC_HOST.test(new URL(l.href).host) || FC_PATH.test(new URL(l.href).pathname); } catch { return false; } })()) || null;
  if (!entry && embedded) entry = { href: new URL('/feature/entry', officialUrl).href, label: '新規入会' };
  // 팬클럽 사이트가 따로 있으면 그 첫 화면에서 가입 링크를 한 번 더 찾는다
  if (!entry && top && !/weverse/.test(top.href)) {
    try {
      const fcHtml = await fetchJa(top.href, { timeout: 10000, retries: 1 });
      const fl = links(fcHtml, top.href).map((l) => ({ ...l, s: score(l) })).filter((l) => ENTRY_TXT.test(l.label) || ENTRY_URL.test(l.href)).sort((a, b) => b.s - a.s);
      if (fl[0]) entry = fl[0];
      else if (/plusmember\.jp|\/static\/original\/fanclub/.test(fcHtml)) entry = { href: new URL('/feature/entry', top.href).href, label: '新規入会' };
    } catch { /* 팬클럽 첫 화면 실패 */ }
  }
  if (!entry && !top) return { found: false, official: officialUrl, checkedAt: new Date().toISOString() };
  const fcHome = top?.href || (embedded ? officialUrl : entry?.href) || null;
  // 투어·티켓 후보 페이지 (공식 사이트 + 팬클럽 사이트의 링크)
  const tourLinks = ls.filter((l) => {
    let host = '';
    try { host = new URL(l.href).host.replace(/^www\./, ''); } catch { return false; }
    const same = host === siteHost || host.endsWith(`.${siteHost}`) || FC_HOST.test(host);
    return same && !NOT_FC.test(l.href) && (/\/feature\/[^?#]*(tour|live|arena|dome|stadium|hall|fanclub|fc|ticket|concert)/i.test(l.href) || /\/ticket\/?(\?|$)/i.test(l.href) || /TOUR|ツアー|ライブ|公演|先行|チケット/.test(l.label));
  }).map((l) => l.href);
  return {
    found: true,
    official: officialUrl,
    home: fcHome,
    /* 상점형 팬클럽(BMSG)의 가입 링크가 상점 공용 계정 만들기(/account/register)면 팬클럽 안내 화면을 입구로 — 이름·이미지·요금이 거기 있다 */
    entry: (() => { const e = entry?.href || null; try { if (e && fcHome && /\/account\/(register|login)/.test(new URL(e).pathname)) return fcHome; } catch { /* 주소 오류 */ } return e; })(),
    platform: platformOf(entry?.href) || platformOf(fcHome) || (embedded ? 'PLUS MEMBER' : null),
    tourLinks: [...new Set(tourLinks.map((h) => h.replace(/[?&]_normalbrowse_=1/, '')))].slice(0, 6),
    checkedAt: new Date().toISOString(),
  };
}

const yen = (s) => (s ? Number(String(s).replace(/[,，]/g, '')) : null);

/* 금액 옆의 기간 표시로 연·월을 가른다: "6,600円／12ヶ月"은 이름이 월회비 코스여도 1년치다 */
function periodFees(flat) {
  const out = { annual: null, monthly: null };
  for (const m of flat.matchAll(/(?:[¥￥]\s*([0-9][0-9,]{1,7})|([0-9][0-9,]{1,7})\s*円)(?:\s*¶?\s*[（(]税込[）)])?\s*¶?\s*[/／]\s*(12\s*[ヶかカケ]月|1\s*年|年|1\s*[ヶかカケ]月|[ヶかカケ]月|月)/g)) {
    const v = yen(m[1] || m[2]);
    if (!v) continue;
    if (/12|年/.test(m[3])) out.annual ??= v; else out.monthly ??= v;
  }
  // "12ヵ月まとめ払い 5,280円(税込)" (CLUB GNU 같은 월정액 사이트의 연간 결제)
  for (const m of flat.matchAll(/(12\s*[ヵヶかカケ]月|1\s*年)\s*(?:まとめ払い|一括払い|一括|分)\s*¶?\s*(?:[¥￥]\s*([0-9][0-9,]{2,7})|([0-9][0-9,]{2,7})\s*円)/g)) {
    const v = yen(m[2] || m[3]);
    if (v) out.annual ??= v;
  }
  // "550円（1ヶ月・税込）", "6,600円（12ヶ月・税込）"
  for (const m of flat.matchAll(/(?:[¥￥]\s*([0-9][0-9,]{1,7})|([0-9][0-9,]{1,7})\s*円)\s*[（(]\s*(12\s*[ヶかカケ]月|1\s*年|年間|1\s*[ヶかカケ]月)/g)) {
    const v = yen(m[1] || m[2]);
    if (!v) continue;
    if (/12|年/.test(m[3])) out.annual ??= v; else out.monthly ??= v;
  }
  return out;
}

/* ---------- Weverse Shop 멤버십 ----------
   go.weverse.io 짧은 주소는 Weverse Shop 카테고리(예: JAPAN MEMBERSHIP)로 넘어간다.
   카테고리·상품 화면은 서버가 __NEXT_DATA__ 에 상품 카드(이름·판매가·상태·썸네일)를 실어 보내므로 그걸 읽는다.
   일본 팬 기준(엔화 샵)으로 읽는다: /ja/shop/JPY/... */
async function resolveRedirect(url) {
  let u = url;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(u, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36' }, signal: AbortSignal.timeout(8000) });
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) { u = new URL(loc, u).href; continue; }
    return u;
  }
  return u;
}
function nextData(html) {
  const m = String(html || '').match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
}
function findAll(o, pred, out = []) {
  if (!o || typeof o !== 'object') return out;
  if (pred(o)) out.push(o);
  for (const k of Object.keys(o)) findAll(o[k], pred, out);
  return out;
}
export function parseWeverseShop(html, pageUrl) {
  const data = nextData(html);
  const cards = findAll(data, (o) => o.saleId && typeof o.name === 'string' && o.price && typeof o.price === 'object');
  const seen = new Set();
  const members = cards.filter((c) => /MEMBERSHIP|メンバーシップ|멤버십/i.test(c.name) && !seen.has(c.saleId) && seen.add(c.saleId));
  const m = String(pageUrl).match(/artists\/(\d+)/);
  return members.map((c) => ({
    saleId: c.saleId, name: c.name.trim(), price: Number(c.price.salePrice ?? c.price.originalPrice) || null, taxIncluded: typeof c.price.isTaxIncluded === 'boolean' ? c.price.isTaxIncluded : null,
    status: c.status || null, image: c.thumbnailImageUrl || c.thumbnailImageUrls?.[0] || c.thumbnailUrl || null,
    url: m ? `https://shop.weverse.io/ja/shop/JPY/artists/${m[1]}/sales/${c.saleId}` : null,
  }));
}
export async function weverseShopFacts(url) {
  let u = url;
  if (weverseKind(u) === 'shortlink') u = await resolveRedirect(u);
  const m = weverseKind(u) === 'shop' && u.match(/shop\.weverse\.io\/(?:[a-z]{2}\/shop\/[A-Z]{3}\/|shop\/)artists\/(\d+)\/(categories|sales)\/(\d+)(?:\?[^#]*?subCategoryId=(\d+))?/);
  if (!m) {
    /* 아티스트 커뮤니티의 멤버십 탭(weverse.io/newjeansofficial/media?tab=jpmembership)은 팬클럽이 맞지만 앱 안이라 요금을 못 읽는다.
       샵 첫 화면·Weverse 첫 화면으로 가는 공용 링크(사이트 바닥글의 go.weverse.io)는 팬클럽이 아니다 */
    if (weverseKind(u) === 'membership') return { url: u, platform: 'Weverse', membershipVerified: true, fees: null, overseas: 'unknown' };
    return { error: 'weverse-generic-link', url: u };
  }
  const [, aid, kind, id, sub] = m;
  const page = `https://shop.weverse.io/ja/shop/JPY/artists/${aid}/${kind}/${id}${sub ? `?subCategoryId=${sub}` : ''}`;
  const html = await fetchJa(page, { timeout: 10000, retries: 1, headers: { 'Accept-Language': 'ja' } });
  let items = parseWeverseShop(html, page);
  /* 이 샵이 어느 아티스트의 샵인지(멤버 솔로 검색에 그룹 멤버십이 걸리는 것을 막는 데 쓴다) */
  const shopArtist = (findAll(nextData(html), (o) => (o.artistId === Number(aid) || o.id === Number(aid)) && typeof o.name === 'string' && typeof o.shortName === 'string')[0] || {}).name || null;
  if (kind === 'sales' && !items.length) {
    const d = nextData(html);
    const sale = findAll(d, (o) => o.saleId === Number(id) && typeof o.name === 'string')[0];
    if (sale) items = [{ saleId: sale.saleId, name: sale.name, price: Number(sale.price?.salePrice ?? sale.price?.originalPrice ?? sale.salePrice) || null, taxIncluded: typeof sale.price?.isTaxIncluded === 'boolean' ? sale.price.isTaxIncluded : null, status: sale.status || null, image: sale.thumbnailImageUrl || sale.thumbnailImageUrls?.[0] || null, url: page }];
    /* 판매 화면에서 이미지가 비면 같은 판매의 다른 조각(thumbnailImageUrls)에서 */
    if (items[0] && !items[0].image) { const alt = findAll(d, (o) => o.saleId === Number(id) && Array.isArray(o.thumbnailImageUrls) && o.thumbnailImageUrls.length)[0]; if (alt) items[0].image = alt.thumbnailImageUrls[0]; }
  }
  /* 일본 멤버십(JP)을 먼저, 판매 중인 것 */
  const ordered = items.filter((x) => /\(JP\)|JAPAN|JP\b/i.test(x.name) && !/KIT/i.test(x.name)).concat(items.filter((x) => !/KIT/i.test(x.name)), items);
  /* 지금 판매 중인 멤버십이 없으면(모집 기간이 아님) 마지막 판매가를 '지난 모집가'로 보여 준다 */
  const open = ordered.find((x) => x.status === 'SALE' && x.price);
  const pick = open || ordered.find((x) => x.price) || null;
  if (!pick) return null;
  /* 상품 화면의 판매 공지에서 유효 기간 */
  let period = null;
  let jpAddress = false;
  try {
    const ph = await fetchJa(pick.url, { timeout: 10000, retries: 0, headers: { 'Accept-Language': 'ja' } });
    const txt = ph.replace(/<script(?! id="__NEXT_DATA__")[\s\S]*?<\/script>/g, ' ').replace(/\\n/g, ' ');
    const pm = txt.match(/有効期限[：:]\s*(入会日から\s*\d+\s*日)|(入会日より\s*\d+\s*日)/);
    period = pm ? (pm[1] || pm[2]).replace(/\s+/g, '') : null;
    jpAddress = /日本国内の住所をお持ちの方のみ/.test(txt);
  } catch { /* 기간은 비워 둔다 */ }
  const q = pick.name.match(/[「『]([^」』]{2,30})[」』]/);
  return {
    url: pick.url, title: pick.name, name: q ? q[1] : pick.name.replace(/\s*MEMBERSHIP.*$/i, '').trim() || pick.name,
    ogTitle: pick.name, image: pick.image, period,
    fees: { annual: pick.price, monthly: null, joinFee: null, free: false, currency: 'JPY', overseasAnnual: null, overseasAnnualUsd: null, taxIncluded: pick.taxIncluded ?? null },
    saleOpen: !!open, saleStatus: pick.status || null,
    overseas: 'unknown', residence: null, overseasJoin: null, payments: [], languages: [], needsPhone: false,
    platform: 'Weverse', shopArtist, shipJpOnly: jpAddress, checkedAt: new Date().toISOString(),
  };
}

export async function fanclubFacts(entryUrl) {
  if (weverseKind(entryUrl) && weverseKind(entryUrl) !== 'campaign') return weverseShopFacts(entryUrl);
  /* Weverse는 캠페인(입회 안내) 페이지만 서버가 그린다. 샵·앱 링크는 스크립트로 그려 읽을 수 없다 */
  if (!entryUrl || (/weverse/.test(entryUrl) && !/campaigns\.weverse\.io/.test(entryUrl))) return null;
  /* FAMILY CLUB: 입회 시작 화면(/join/index/f/XX)은 규약만 보여 주고, 회비·특전·절차는 상세 안내(/join/detail/f/XX)에 있다 */
  const famCode = (entryUrl.match(/familyclub\.jp\/join\/(?:index|detail)\/f\/([A-Za-z0-9]+)/) || [])[1];
  const readUrl = famCode ? `https://www.familyclub.jp/join/detail/f/${famCode}` : entryUrl;
  const html = await fetchJa(readUrl, { timeout: 10000, retries: 1 });
  const facts = parseFacts(html, readUrl);
  if (!facts.platform) facts.platform = platformFromHtml(html);
  /* 가입 페이지·FAQ·규약에서 해외 가입·결제·전화 인증·전자티켓 등 주제별 원문 문장 */
  try {
    const ev = await fanclubEvidence(readUrl, html, { readPage: (u) => fetchJa(u, { timeout: 8000, retries: 0 }) });
    facts.evidence = ev.evidence;
    facts.verdict = ev.verdict;
    facts.evidencePages = ev.pagesRead;
    facts.globalSite = ev.globalSite;
    /* 요금표로 판정하지 못했을 때만 원문 판정을 쓴다. 해외 코스 요금표(residence)가 있으면 그게 가장 강한 근거다 */
    if (facts.overseas === 'unknown' && ev.verdict.overseas) facts.overseas = ev.verdict.overseas;
    else if (facts.overseas === 'yes' && !facts.residence && ev.verdict.overseas === 'no') facts.overseas = 'no';
  } catch { facts.evidence = null; }
  if (famCode) {
    facts.url = entryUrl; facts.feeSource = readUrl; facts.platform = 'FAMILY CLUB';
    /* 회원 규약 제5조(일본 국내 거주)는 모든 FAMILY CLUB 팬클럽 공통이다 */
    facts.overseas = 'no';
  }
  // 가입 페이지에 요금이 없으면 같은 사이트의 소개·입회 안내 쪽을 두세 장 더 본다
  if (!facts.fees.annual && !facts.fees.monthly && !facts.fees.free) {
    const host = new URL(entryUrl).host;
    const subs = [...html.matchAll(/<a[^>]+href="([^"#]+)"[^>]*>([\s\S]{0,600}?)<\/a>/g)]
      .map((m) => { try { return { u: new URL(m[1].replace(/&amp;/g, '&'), entryUrl).href, t: m[2].replace(/<[^>]+>/g, ' ') }; } catch { return null; } })
      .filter((x) => x && new URL(x.u).host === host && x.u !== entryUrl && /ABOUT|とは|入会案内|ご入会|会費|特典|introduction|guide|benefit|会員規約|会員・チケット規約|kiyaku/i.test(x.t + ' ' + x.u) && !/login|logout|regist|validation|mypage/i.test(x.u));
    /* 팬클럽 사이트가 다른 도메인에 따로 있으면(kinggnu.jp/club-gnu → clubgnu.com) 그쪽 첫 화면과 소개·요금 화면도 본다 */
    const cross = [...html.matchAll(/<a[^>]+href="([^"#]+)"[^>]*>([\s\S]{0,600}?)<\/a>/g)]
      .map((m) => { try { return { u: new URL(m[1].replace(/&amp;/g, '&'), entryUrl).href, t: m[2].replace(/<[^>]+>/g, ' ') }; } catch { return null; } })
      .filter((x) => { if (!x) return false; try { const hh = new URL(x.u).host; return hh !== host && !BAD_HOST.test(hh) && (/club|fc|fan|member/i.test(hh) || FC_PATH.test(new URL(x.u).pathname) || /ファンクラブ|FAN ?CLUB|入会/i.test(x.t)); } catch { return false; } })
      .slice(0, 2);
    for (const c of cross) {
      try {
        const ch = await fetchJa(c.u, { timeout: 9000, retries: 0 });
        const cu = c.u;
        const chost = new URL(cu).host;
        const inner = [...ch.matchAll(/<a[^>]+href="([^"#]+)"[^>]*>([\s\S]{0,600}?)<\/a>/g)]
          .map((m) => { try { return { u: new URL(m[1].replace(/&amp;/g, '&'), cu).href, t: m[2].replace(/<[^>]+>/g, ' ') }; } catch { return null; } })
          .filter((x) => x && new URL(x.u).host === chost && /ABOUT|とは|入会案内|ご入会|会費|料金|特典|introduction|guide|benefit/i.test(x.t + ' ' + x.u) && !/login|logout|mypage/i.test(x.u));
        subs.push({ u: cu, t: 'fanclub' }, ...inner.slice(0, 2));
      } catch { /* 다음 후보 */ }
    }
    const seen = new Set();
    for (const sub of subs) {
      if (seen.has(sub.u) || seen.size >= 6) continue;
      seen.add(sub.u);
      try {
        const f2 = parseFacts(await fetchJa(sub.u, { timeout: 8000, retries: 0 }), sub.u);
        if (f2.fees.annual || f2.fees.monthly || f2.fees.free) {
          facts.fees = f2.fees; facts.feeSource = sub.u;
          if (facts.overseas === 'unknown') facts.overseas = f2.overseas;
          if (!facts.name) facts.name = f2.name;
          if (!facts.payments.length) facts.payments = f2.payments;
          break;
        }
      } catch { /* 다음 후보 */ }
    }
  }
  return facts;
}

/* 거주지별 코스 — PLUS MEMBER 계열 입회 페이지는 「日本にお住まいの方」「日本以外にお住まいの方」로 나눠
   코스(연회비·월회비)·결제 수단·주의사항을 따로 적는다. 한국 팬에게 필요한 건 해외 쪽이다. */
const PAY_WORD = /クレジットカード|コンビニ|d払い|auかんたん|ソフトバンク|ワイモバイル|キャリア決済|PayPay|PayPal|Pay-easy|ペイジー|銀行振込|楽天ペイ|App Store|Google Play|アプリ内課金/;
function segPayments(seg) {
  const out = [];
  for (const m of seg.matchAll(/お支払い?方法|決済方法/g)) {
    const part = seg.slice(m.index + 5, m.index + 240).split(/※|注意|会員期間|会員期限|月会費|年会費|翌年|自動継続/)[0];
    for (const t of part.split(/[¶・•/]/)) {
      const v = t.trim();
      if (v.length >= 2 && v.length <= 30 && PAY_WORD.test(v) && !/できません|不可/.test(v)) out.push(v.replace(/[(（]VISA.*$/, ''));
    }
  }
  return [...new Set(out)];
}
/* 금액: '6,050円' '6,050 ¶ 円' '¥6,050' '95 USD' '95 ¶ USD' */
const AMT = String.raw`(?:[¥￥]\s*([0-9][0-9,]{0,7})|([0-9][0-9,]{0,7})\s*(?:¶\s*)*(円|USD|ドル))`;
function amountAfter(seg, label) {
  const m = seg.match(new RegExp(`(?:${label})(?:(?!入会金|年会費|月会費|特典の発送|年額|月額)[^0-9¥￥]){0,40}${AMT}`));
  if (!m) return null;
  const v = yen(m[1] || m[2]);
  return v == null ? null : { v, cur: m[3] === 'USD' || m[3] === 'ドル' ? 'USD' : 'JPY' };
}
export function parseResidence(flatPara) {
  const f = flatPara;
  const JP = /日本にお住まいの方|日本国内にお住まいの方|日本国内在住の方/g;
  const OV = /日本以外にお住まいの方|海外にお住まいの方|海外在住の方/g;
  /* 요금표 머리만 고른다: 표기 바로 뒤가 칸 구분(¶)이고(문장 속 【…】で 언급 제외) 400자 안에 금액이 있는 것 */
  const heads = (re) => [...f.matchAll(re)].map((m) => m.index + m[0].length).filter((end) => /^\s*¶/.test(f.slice(end, end + 4)) && new RegExp(AMT).test(f.slice(end, end + 400)));
  const ji = heads(JP)[0], oi = heads(OV)[0];
  if (oi == null) return null;
  const END = /注意事項|推奨環境|会員登録\s*¶|新規会員登録の前に|よくある(?:ご)?質問|日本(?:以外)?にお住まいの方\s*¶/;
  const cut = (from) => { const s2 = f.slice(from, from + 3200); const e = s2.slice(10).search(END); return e >= 0 ? s2.slice(0, e + 10) : s2; };
  const course = (seg) => {
    const ship = amountAfter(seg, '特典の発送をご希望の方|特典発送あり');
    const noShip = amountAfter(seg, '特典の発送が不要な方|特典発送なし');
    /* '会費6,600円（税込）／12ヶ月' '60 USD(tax-exclusive)／12ヶ月'처럼 기간이 금액 뒤에 붙는 표기 */
    const byPeriod = (re) => { const m = seg.match(new RegExp(`${AMT}\\s*(?:[（(](?:税込|tax-exclusive|tax-inclusive)[）)])?\\s*[/／]\\s*(${re.source})`)); return m ? { v: yen(m[1] || m[2]), cur: m[3] === 'USD' ? 'USD' : 'JPY' } : null; };
    const annual = noShip || amountAfter(seg, '年会費|年額') || byPeriod(/12\s*[ヶかカケ]月|1\s*年|年/);
    const monthly = amountAfter(seg, '月会費(?!まとめて)|月額') || byPeriod(/1\s*[ヶかカケ]月|月/);
    const joinFee = amountAfter(seg, '入会金');
    const sf = seg.match(new RegExp(`海外配送料\\s*${AMT}`));
    return {
      annual, annualShip: ship && (!annual || ship.v !== annual.v) ? ship : null, monthly, joinFee,
      shipFee: sf ? { v: yen(sf[1] || sf[2]), cur: sf[3] === 'USD' ? 'USD' : 'JPY' } : null,
      payments: segPayments(seg),
      debitNg: /デビットカード[^。¶]{0,24}(?:動作保証外|できません|ご利用いただけません|使用できません)/.test(seg),
    };
  };
  return {
    jp: ji != null ? course(cut(ji)) : null,
    overseas: course(cut(oi)),
    autoRenew: /自動継続/.test(f),
    residenceLocked: /誤って【?日本以外にお住まいの方】?として|退会いただかないとコース変更/.test(f),
    realName: /必ず本人様がご登録|申込者と会員情報が違うと/.test(f),
    overseasLimits: /(?:日本以外にお住まいの方|海外会員)[^。]{0,60}(?:一部異なります|対象外|国内会員に限らせて)/.test(f),
  };
}

function parseFacts(html, entryUrl) {
  const lines = text(html);
  const all = lines.join('\n');
  const flat = halfwidth(lines.join(' / '));
  const title = ((html.match(/<title>([^<]*)/) || [])[1] || '').replace(/&quot;/g, '"').replace(/&ndash;|&mdash;/g, '–').replace(/&amp;/g, '&').replace(/&#0?39;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/\s+/g, ' ').trim();
  const titleName = title.split(/[｜|:：]|\s[-–]\s/).map((x) => x.trim()).find((x) => /members?|fan ?club|ファンクラブ|メンバーズ/i.test(x) && x.length < 50) || null;
  const inTitle = (title.match(/(?:OFFICIAL\s*FAN\s*CLUB|ファンクラブ|fanclub)\s*[「『“"]([^」』”"]{2,40})[」』”"]/i) || [])[1];
  const cleanName = (x) => {
    if (!x) return null;
    let n = x.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, '&');
    const q = n.match(/[“"「『]([^”"」』]{2,30})[”"」』]/);
    if (q) n = q[1];
    n = n.replace(/^(新規会員登録|新規入会|ご入会案内|入会案内|入会)\s*/, '').replace(/\s*(リニューアル)?(のお知らせ|について|開設|オープン).*$/, '').trim();
    /* 로그인·계정 시스템 이름은 팬클럽 이름이 아니다 */
    if (/^(Plus member ID|チケプラ|Fanplus|EMTG ID|ログイン|新規会員登録|会員登録)$/i.test(n || '')) return null;
    /* 사이트 이름 같은 일반 표기("Official Site & Fanclub")도 팬클럽 이름이 아니다 */
    if (/^(official\s*(web\s*)?(site|fan\s*club|fanclub)|オフィシャル(サイト|ファンクラブ)|公式(サイト|ファンクラブ))(\s*[&＆・/|｜]\s*(official\s*)?(site|fan\s*club|fanclub|オフィシャルファンクラブ|ファンクラブ))?$/i.test((n || '').trim())) return null;
    return n && n.length <= 40 ? n : null;
  };
  /* og:title 의 「…」 ("…OFFICIAL FAN CLUB「one room」", "aespa OFFICIAL FANCLUB 「MY-J」 MEMBERSHIP") */
  const ogT = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '';
  const ogName = /OFFICIAL\s*FAN\s*CLUB|ファンクラブ|FANCLUB|MEMBERSHIP/i.test(ogT) ? (ogT.match(/[「『]([^」』]{2,30})[」』]/) || [])[1] || null : null;
  const name = cleanName(inTitle || ogName
    || (() => { const ns = [...new Set([...all.matchAll(/(?:OFFICIAL\s*FAN\s*CLUB|オフィシャルファンクラブ|official fanclub)\s*[「『“"]([^」』”"]{2,40})[」』”"]/gi)].map((m) => m[1]))]; return ns.length === 1 ? ns[0] : null; })() // 다른 팬클럽을 나열한 페이지(공통 ID 안내 등)면 이름을 고르지 않는다
    || titleName || null);
  const price = (label) => {
    const m = flat.match(new RegExp(`(?:${label})(?:(?!入会金|年会費|月会費|月額|年額|年間会費)[^0-9¥￥]){0,24}(?:[¥￥]\\s*([0-9][0-9,]{1,7})|([0-9][0-9,]{1,7})\\s*円)`));
    return m ? yen(m[1] || m[2]) : null;
  };
  const per = periodFees(halfwidth(lines.join(' ¶ ')));
  /* 회원 규약의 "会費 5,200円"(V.I.P (JP)): 같은 문서가 연회비(年会費)를 말하면 한 해 회비로 본다 */
  const annual = per.annual ?? price('年会費|年額|年間会費') ?? (/年会費/.test(flat) ? (() => { const m = flat.match(/(?:^|[^入月年])会費\s*[:：]?\s*(?:[¥￥]\s*([0-9][0-9,]{2,7})|([0-9][0-9,]{2,7})\s*円)/); return m ? yen(m[1] || m[2]) : null; })() : null);
  const monthly = per.monthly ?? (per.annual ? null : price('月会費|月額'));
  const free = !annual && !monthly && /無料会員|会費無料|年会費無料|入会金・年会費無料|無料で(?:ご)?(?:登録|入会)/.test(flat);
  const joinFee = price('入会金');
  const handlingFee = (() => { const m = flat.match(/事務手数料\s*([0-9][0-9,]{1,5})\s*円/); return m ? yen(m[1]) : null; })();
  const overseasYes = /fc_foreign_reg/.test(html) || /海外（日本以外）にお住まい|日本以外にお住まいの方|海外にお住まいの方|海外在住の方|海外在住者|海外会員|overseas|international member|海外からのご入会/i.test(flat);
  const overseasNo = /日本国内(?:在住|にお住まい)の方のみ|国内在住の方に限|海外からのご入会はできません|海外在住の方はご入会いただけません/.test(flat);
  const overseasFee = (() => {
    const marks = [...flat.matchAll(/日本以外にお住まいの方|海外にお住まいの方|海外在住の方/g)].map((m) => m.index);
    for (const i of marks.reverse()) {
      const nums = [...flat.slice(i, i + 400).matchAll(/([0-9][0-9,]{2,7})\s*円/g)].map((m) => yen(m[1])).filter((n) => n >= 1000);
      if (nums.length) return Math.max(...nums);
    }
    return null;
  })();
  const overseasUsd = (() => {
    const i = flat.search(/日本以外にお住まいの方|海外にお住まいの方|海外在住の方/);
    const m = i >= 0 ? flat.slice(i, i + 300).match(/([0-9]+(?:\.[0-9]+)?)\s*USD/) : null;
    return m ? Number(m[1]) : null;
  })();
  const payments = [];
  for (const m of flat.matchAll(/お支払い?方法|決済方法/g)) {
    const seg = flat.slice(m.index, m.index + 260).replace(/[^/。]*(できません|ご利用いただけません)[^/。]*/g, '');
    for (const t of seg.matchAll(/(?:[・•]|\/)\s*([^・•/※]{2,24}?)\s*(?=[・•/※]|$)/g)) if (/決済|払い|カード|Pay|PayPal|キャリア|コンビニ|銀行/i.test(t[1]) && !/できません|不可|方法|自動継続|手数料|期限|ガイド|手続き|について|案内/.test(t[1])) payments.push(t[1].trim());
  }
  /* 번역 메뉴(WOVN 등)가 있으면 그 언어를 쓴다 */
  const languages = ['한국어', 'English', '中文', '日本語'].filter((l) => html.includes(l) || (l === '한국어' && /data-value="ko"|hreflang="ko"|[?&]lang=ko\b/.test(html)));
  const residence = parseResidence(halfwidth(lines.join(' ¶ ')));
  const jpOnly = /日本国内に居住し|日本国内に住所を有する方|日本国内在住の方のみ|会員とは、?日本に居住する者/.test(flat);
  /* 해외 거주자 전용 가입 버튼(PLUS MEMBER: fc_foreign_reg=1) */
  const ovJoinRaw = (html.match(/href="([^"]*fc_foreign_reg=1[^"]*)"/) || [])[1];
  let overseasJoin = null;
  try { overseasJoin = ovJoinRaw ? new URL(ovJoinRaw.replace(/&amp;/g, '&'), entryUrl).href : null; } catch { overseasJoin = null; }
  const needsPhone = /電話番号(?:の)?(?:ご)?登録が必須|電話番号.*必須|SMS認証/.test(flat);
  /* 상품 상세 화면용: 대표 이미지(og:image), 회원 기간 */
  const meta = (p) => { const m = html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']+)["']`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${p}["']`, 'i')); return m ? m[1].replace(/&amp;/g, '&').trim() : null; };
  let image = null;
  try { const im = meta('image'); image = im ? new URL(im, entryUrl).href : null; } catch { image = null; }
  const periodM = flat.match(/(?:会員期間|会員有効期間|会員資格有効期間|有効期間)\s*[/:：]?\s*((?:ご入会|入会|当社が入会を承認した日)[^/。※]{2,24}?(?:12\s*[ヵヶかカケ]月|1\s*年間?|365\s*日|翌年[^/。※]{0,14}まで))/);
  const period = periodM ? periodM[1].replace(/\s+/g, '').trim() : null;
  const ogTitle = meta('title');
  return {
    url: entryUrl,
    image,
    period,
    ogTitle: ogTitle ? ogTitle.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, '&').trim().slice(0, 120) : null,
    title,
    name,
    fees: { annual, monthly, joinFee, handlingFee, free, currency: 'JPY', overseasAnnual: overseasFee && overseasFee !== annual ? overseasFee : null, overseasAnnualUsd: overseasUsd },
    overseas: overseasNo || jpOnly ? 'no' : overseasYes || residence ? 'yes' : 'unknown',
    residence,
    overseasJoin,
    payments: (() => { const seen = new Set(); return payments.filter((x) => { const k = x.replace(/[(（][^)）]*[)）]/g, "").replace(/\s+/g, "").toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6); })(),
    languages,
    needsPhone,
    platform: platformOf(entryUrl) || (/plusmember/.test(html) ? 'PLUS MEMBER' : null),
    checkedAt: new Date().toISOString(),
  };
}
export const _parseFactsForTest = (html, url) => parseFacts(html, url);

/* ---------- 팬클럽 선행·전용 접수 ---------- */
const DT = /(?:(\d{4})\s*[年/.]\s*)?(\d{1,2})\s*[月/.]\s*(\d{1,2})\s*日?\s*(?:[(（][^)）]{1,4}[)）])?\s*(\d{1,2})[:：](\d{2})/g;
function parseRange(s, fallbackYear) {
  const ms = [...String(s).matchAll(DT)];
  if (!ms.length) return null;
  const toIso = (m, y) => `${m[1] || y}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}T${String(m[4]).padStart(2, '0')}:${m[5]}:00+09:00`;
  const y0 = ms[0][1] || fallbackYear;
  const start = toIso(ms[0], y0);
  let end = ms[1] ? toIso(ms[1], ms[1][1] || y0) : null;
  if (end && end < start) end = end.replace(/^\d{4}/, String(Number(y0) + 1));
  return { start, end };
}

const VENUE = /(アリーナ|ドーム|ホール|スタジアム|Zepp|ZEPP|会館|劇場|武道館|体育館|メッセ|Kアリーナ|\b(?:arena|dome|hall|stadium|expo|centre|center|coliseum|theater|theatre)\b|아레나|돔|홀|체조경기장|스타디움)/i;
// 표 머리의 도시 이름 → 나라. 줄 전체가 도시 이름일 때만 구역 제목으로 본다("SOGO TOKYO" 같은 문의처는 제외)
const CITY = [
  ['KR', /^(SEOUL|INCHEON|BUSAN|ソウル|仁川|釜山|서울|인천|부산|KOREA|韓国)$/i],
  ['TW', /^(TAIPEI|KAOHSIUNG|TAICHUNG|台北|高雄|台中|TAIWAN|台湾)$/i],
  ['HK', /^(HONG ?KONG|香港)$/i],
  ['CN', /^(SHANGHAI|BEIJING|GUANGZHOU|SHENZHEN|上海|北京|広州|深圳)$/i],
  ['TH', /^(BANGKOK|バンコク)$/i], ['SG', /^(SINGAPORE|シンガポール)$/i], ['ID', /^(JAKARTA|ジャカルタ)$/i],
  ['PH', /^(MANILA|マニラ)$/i], ['MY', /^(KUALA ?LUMPUR|クアラルンプール)$/i],
  ['US', /^(LOS ANGELES|NEW YORK|CHICAGO|SAN FRANCISCO|SEATTLE|ロサンゼルス|ニューヨーク)$/i],
  ['GB', /^(LONDON|ロンドン)$/i], ['FR', /^(PARIS|パリ)$/i],
  ['JP', /^(HOKKAIDO|AOMORI|IWATE|MIYAGI|AKITA|YAMAGATA|FUKUSHIMA|IBARAKI|TOCHIGI|GUNMA|SAITAMA|CHIBA|TOKYO|KANAGAWA|NIIGATA|TOYAMA|ISHIKAWA|FUKUI|YAMANASHI|NAGANO|GIFU|SHIZUOKA|AICHI|MIE|SHIGA|KYOTO|OSAKA|HYOGO|NARA|WAKAYAMA|TOTTORI|SHIMANE|OKAYAMA|HIROSHIMA|YAMAGUCHI|TOKUSHIMA|KAGAWA|EHIME|KOCHI|FUKUOKA|SAGA|NAGASAKI|KUMAMOTO|OITA|MIYAZAKI|KAGOSHIMA|OKINAWA|NAGOYA|SAPPORO|SENDAI|YOKOHAMA|KOBE|KITAKYUSHU|MAKUHARI|JAPAN|日本|(北海道|青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|東京|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|京都|大阪|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)[都道府県]?|名古屋|札幌|仙台|横浜|神戸|北九州|幕張)(公演)?$/i],
];
const SECTION_END = /^(GOODS|ATTENTION|TICKETS?|CONTACT|NEWS|Q ?& ?A|FAQ|SPECIAL|AREA ?MAP|グッズ|注意事項|チケット|お問い?合わせ|物販)$/i;
// 공연장 이름만으로 나라가 드러나는 곳
const KR_VENUE = /INSPIRE ARENA|KSPO|고척|GOCHEOK|올림픽|OLYMPIC HALL|핸드볼경기장|체조경기장|잠실|JAMSIL|YES24 ?LIVE|BEXCO|벡스코|킨텍스|KINTEX|ソウル|서울|인스파이어/i;
const NOT_SHOW = /受付|入金|当落|発表|発送|登録|締切|まで|≪|公開|決定|お知らせ|ご案内|MAP|中止|延期|販売|グッズ|物販|開催を予定|予定しており|場所[:：]|[「」、。]|\d{1,2}:\d{2}\s*[〜~～]|公演\]/;
const SDATE = /(?:(\d{4})\s*[年/.\s]\s*)?(\d{1,2})\s*[月/.]\s*(\d{1,2})\s*日?/;

export async function fanclubSales(pageUrl, { fcName = null } = {}) {
  const html = await fetchJa(pageUrl, { timeout: 10000, retries: 1 });
  return parseSalesPage(html, pageUrl, { fcName });
}

/* 네트워크 없이 HTML만으로 — 테스트가 배치별 규칙을 고정한다 */
export function parseSalesPage(html, pageUrl, { fcName = null, now = new Date() } = {}) {
  const lines = text(html).map((l) => halfwidth(l));
  const pageTitle = ((html.match(/<meta property="og:title" content="([^"]+)"/) || [])[1] || (html.match(/<title>([^<]*)/) || [])[1] || '').replace(/\s+/g, ' ').replace(/[｜|].*$/, '').trim();
  const year = now.getFullYear();
  /* 연도 없는 공연일: 페이지 제목·주소에 올해 이후 연도가 있으면 그 해("【2027】… TOUR 2027"),
     없으면 이미 두 달 넘게 지난 날짜는 다음 해로 본다(지난 회차로 잘못 버려지지 않게) */
  const hintYear = Number((pageTitle.match(/(?:^|[^0-9])(20[2-9][0-9])(?:[^0-9]|$)/) || String(pageUrl).match(/(?:\/|d-|=)(20[2-9][0-9])/) || [])[1]) || null;
  const showYear = (m, dd) => {
    if (hintYear && hintYear >= year && hintYear <= year + 2) return hintYear;
    /* 제목에 지난 연도가 박힌 페이지("… TOUR 2023")는 지난 공연 — 다음 해로 밀면 끝난 투어가 미래 공연으로 뜬다 */
    if (hintYear && hintYear < year) return hintYear;
    return Date.UTC(year, m - 1, dd) < now.getTime() - 60 * 864e5 ? year + 1 : year;
  };
  const sales = [];
  lines.forEach((l, i) => {
    if (!/^[▼■◼︎◆●○□・【\[\s]*(受付期間|申込受付期間|抽選受付期間|受付日時)/.test(l) || l.length > 90) return;
    const range = parseRange(`${l} ${lines[i + 1] || ''} ${lines[i + 2] || ''}`, year);
    if (!range) return;
    // 이 접수의 이름: 위쪽 줄 중 先行/受付/会員/トレード 가 든 가장 가까운 줄들
    const head = [];
    for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
      const h = lines[k];
      if (/^[▼■◼︎◆●○□・【\[\s]*(受付期間|当落|入金|申し?込み?条件|対象席種|注意)/.test(h)) break;
      if (/先行|受付|会員|トレード|抽選|一般発売|FAN CLUB|ファンクラブ|＜|</.test(h) && h.length < 80) head.unshift(h);
    }
    const tail = head.filter((h) => /先行|受付|トレード|抽選|一般発売|会員/.test(h) && !/^※/.test(h));
    const label = (tail[tail.length - 1] || head[head.length - 1] || '受付').replace(/^[▼■◼︎◆●○□・\s]+/, '').replace(/※[^※]*$/g, '').replace(/受付中!?|受付は終了しました/g, '').replace(/\s+/g, ' ').trim() || '受付';
    const ended = head.some((h) => /受付は終了/.test(h));
    const nextIdx = lines.findIndex((x, k) => k > i && /^[▼■◼︎◆●○□・【\[\s]*(受付期間|申込受付期間|抽選受付期間)/.test(x));
    const ctxLines = lines.slice(i, nextIdx > i ? Math.min(nextIdx, i + 40) : i + 40);
    const condIdx = ctxLines.findIndex((x) => /^[▼■◼︎◆●○□・【\[\s]*(申込者|申し?込み?条件|応募資格)/.test(x));
    const condition = condIdx >= 0 ? ctxLines.slice(condIdx + 1, condIdx + 3).join(' ').replace(/[┗└→][^/]*?(こちら|はこちら)\s*/g, '').replace(/\s*(新規入会|ご入会)は\s*こちら.*$/, '').replace(/\s+/g, ' ').trim().slice(0, 140) || null : null;
    const ctx = `${label} ${ctxLines.join(' ')}`;
    const fcOnly0 = /ともに[^。]{0,90}(会員|FAN CLUB|ファンクラブ)|会員限定|ファンクラブ限定|FC限定|会員のみ|会員の方のみ/.test(ctx);
    const isPublic = /どなたでも|どなた様でも|会員登録不要|会員でなくても/.test(ctx) || (/セブン|ローソン|ローチケ|ぴあ|イープラス|e\+|プレイガイド|一般発売|一般先行|一般抽選|一般受付|一般販売|オフィシャル先行|公式先行/.test(label) && !(fcName && label.includes(fcName)) && !/会員/.test(label));
    const fcOnly = fcOnly0 && !/どなたでも/.test(ctx);
    const fcFirst = !isPublic && (/会員先行|ファンクラブ先行|FC先行|全会員先行|年会員|会員\S*先行|OFFICIAL FAN CLUB|VAWS|会員さま/.test(ctx) || !!(fcName && ctx.includes(fcName)));
    const overseas = /海外在住|海外にお住まい|Overseas|海外の方/.test(label + ' ' + (condition || ''));
    const noJpPhone = /日本の携帯電話番号をお持ちでない[^。]{0,20}海外在住の方でも/.test(ctx);
    const trade = /トレード|リセール/.test(label + ' ' + (lines[i - 1] || ''));
    const lottery = /抽選/.test(ctx) && !/先着/.test(label);
    const ticketing = (ctx.match(/(EMTG電子チケット|電子チケット|紙チケット|スマチケ|QRチケット|チケプラ|Tixplus|EMTG)/i) || [])[1] || null;
    const companion = /同行者[^。/]{0,12}(ともに|も)[^。]{0,60}(会員|FAN CLUB|ファンクラブ)/.test(ctx);
    const perPerson = (ctx.match(/(?:お一人|1会員|おひとり)[^/]{0,12}?(\d)\s*枚まで/) || [])[1] || null;
    sales.push({ label: trade ? '公式トレード（リセール）' : label, start: range.start, end: range.end, ended, condition, fcOnly, fcFirst, overseas, noJpPhone, trade, lottery, isPublic, companion, ticketing: ticketing?.trim() || null, perPerson: perPerson ? Number(perPerson) : null });
  });
  // 공연 일정. 페이지마다 배치가 다르다:
  //  (가) 한 줄에 날짜+공연장, (나) 날짜 다음 줄에 공연장, (다) 공연장 다음 줄부터 날짜들(투어 특설 페이지 표)
  // (다)인지 (나)인지는 페이지 전체에서 공연장 줄 바로 다음이 날짜인 경우가 많은지로 정한다.
  const startsDate = (x) => /^\s*(\d{4}\s*[年/.\s]\s*)?\d{1,2}\s*[月/.]\s*\d{1,2}/.test(x || '');
  const isVenueLine = (x) => !!x && VENUE.test(x) && x.length < 50 && !startsDate(x) && !NOT_SHOW.test(x) && !/問い合わせ|TEL|https?:/i.test(x);
  let venueFirst = 0;
  lines.forEach((x, v) => {
    if (!isVenueLine(x)) return;
    if (startsDate(lines[v + 1])) venueFirst++;
    else if ([1, 2, 3, 4].some((k) => startsDate(lines[v - k]))) venueFirst--;
  });
  const cleanVenue = (c) => c.replace(/[\[\]【】]/g, ' ').trim().replace(/^[●○■□◆・\s]*\S{1,6}公演[・:：\s]+/, '').replace(/^[●○■◆・\s]*(会場|VENUE)\s*[:：]\s*/i, '').replace(/^\S{2,4}[都道府県]\s*会場\s*/, '').replace(/\s+(NEW|追加|NEW!|SOLD OUT)$/i, '').replace(/\s*\d{1,2}\s*月\s*\d{1,2}\s*日.*$/, '').replace(/^[^・\s]{2,4}[都道府県]?・/, '').replace(/[／/].*$/, '').replace(/^[・\-]/, '').trim().slice(0, 40);
  const shows = [];
  let region = null;
  let lastVenue = null;
  let lastVenueIdx = -1;
  // 공연장 줄과 날짜 사이에는 날짜·시간 줄만 있어야 같은 표로 본다
  const tableFiller = (x) => startsDate(x) || /^(OPEN|START|開場|開演|Open|Start)|^\d{1,2}[:：]\d{2}|^[(（][^)）]{0,30}[)）]$|現地時間/i.test(x.trim());
  lines.forEach((l, i) => {
    const tl = l.trim();
    if (SECTION_END.test(tl)) { region = null; lastVenue = null; return; }
    const city = CITY.find(([, re]) => re.test(tl));
    if (city) { region = city[0]; return; }
    if (isVenueLine(tl)) { lastVenue = tl; lastVenueIdx = i; return; }
    const d = l.match(SDATE);
    if (!d || NOT_SHOW.test(l)) return;
    if (Number(d[2]) < 1 || Number(d[2]) > 12 || Number(d[3]) < 1 || Number(d[3]) > 31 || /^\s*\d{1,2}[:：]\d{2}/.test(l)) return;
    const before = l.slice(0, d.index).trim();
    const rest = l.slice(d.index + d[0].length).replace(/^\s*[(（][^)）]{1,6}[)）]\s*/, '').replace(/^\d{1,2}[:：]\d{2}\s*/, '').trim();
    let cand = VENUE.test(rest) && !NOT_SHOW.test(rest) ? rest : VENUE.test(before) && !NOT_SHOW.test(before) ? before : null;
    if (!cand && venueFirst > 0 && lastVenue && i - lastVenueIdx <= 12 && lines.slice(lastVenueIdx + 1, i).every(tableFiller)) cand = lastVenue;
    if (!cand) {
      for (let k = 1; k <= 5 && !cand; k++) {
        const x = lines[i + k] || '';
        if (startsDate(x) || SECTION_END.test(x.trim()) || x.length > 44 || /[。、]/.test(x)) break;
        if (isVenueLine(x)) cand = x;
      }
    }
    if (!cand && venueFirst <= 0) cand = null;
    if (!cand) return;
    const v = cleanVenue(cand);
    if (!v || v.length < 3) return;
    const y = d[1] || showYear(Number(d[2]), Number(d[3]));
    const date = `${y}-${String(d[2]).padStart(2, '0')}-${String(d[3]).padStart(2, '0')}`;
    const pref = /^(北海道|青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|東京|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|京都|大阪|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)[都道府県]?・/.test(cand.replace(/^[●○■◆・\s]*(会場|VENUE)\s*[:：]\s*/i, ''));
    const country = KR_VENUE.test(v) ? 'KR' : region || (pref ? 'JP' : null);
    const key = v.replace(/[\s()（）]/g, '');
    const dupe = shows.find((x) => { const k = x.venue.replace(/[\s()（）]/g, ''); return x.date === date && (k === key || k.startsWith(key) || key.startsWith(k)); });
    if (!dupe) shows.push({ date, venue: v, country });
    else if (!dupe.country && country) dupe.country = country;
  });
  // 나라를 못 정한 회차: 같은 공연장의 다른 회차에서 빌리고, 그래도 없으면 일본어 표기 공연장은 일본으로
  for (const x of shows) {
    if (x.country) continue;
    const k = x.venue.replace(/[\s()（）]/g, '');
    x.country = shows.find((y) => y.country && y.venue.replace(/[\s()（）]/g, '') === k)?.country || (/[\u3040-\u30ff\u4e00-\u9fff]/.test(x.venue) && !/[\uac00-\ud7a3]/.test(x.venue) ? 'JP' : null);
  }
  const flatAll = lines.join(' / ');
  const notes = {
    joinDuringWindow: /受付期間内に[^。]{0,60}(ご入会|入会)いただくと[^。]{0,40}(お申し?込み|申し?込み)いただけます/.test(flatAll),
    faceId: /顔写真登録|顔認証/.test(flatAll),
    idCheck: /本人確認/.test(flatAll),
    eticket: /電子チケット|アプリで発券|OFFICIAL APP|チケプラ|Tixplus|EMTG/i.test(flatAll),
  };
  const uniq = [];
  for (const s of sales) if (!uniq.some((u) => u.label === s.label && u.start === s.start)) uniq.push(s);
  return { url: pageUrl, title: pageTitle, sales: uniq, shows: shows.slice(0, 40), notes, checkedAt: new Date().toISOString() };
}

/* 한 아티스트의 팬클럽 전체 정보 */
export async function fanclubFor(officialUrl) {
  const d = await discoverFanclub(officialUrl);
  if (!d?.found) return d;
  let facts = await fanclubFacts(d.entry).catch((e) => ({ error: String(e?.message || e) }));
  /* 가입 버튼 화면(member/add 등)에는 요금이 없고 팬클럽 소개 화면에 있는 경우(NSWER JAPAN) — 소개 화면도 읽어 합친다 */
  const hasFee = (x) => x?.fees && (x.fees.annual || x.fees.monthly || x.fees.free);
  if (facts && !facts.error && !hasFee(facts) && d.home && d.home !== d.entry) {
    const h = await fanclubFacts(d.home).catch(() => null);
    if (h && !h.error) {
      if (hasFee(h)) { facts.fees = h.fees; facts.feeSource = d.home; }
      facts.name = facts.name || h.name;
      facts.image = facts.image || h.image;
      facts.period = facts.period || h.period;
      if (facts.overseas === 'unknown') facts.overseas = h.overseas;
      if (!facts.payments?.length) facts.payments = h.payments;
      if (!facts.residence) facts.residence = h.residence;
    }
  }
  /* 가입 페이지가 공용 가입 서버(secure.plusmember.jp 등)면 그 페이지에 FAQ·규약 링크가 없다 — 팬클럽 홈에서 한 번 더 모은다 */
  if (facts && !facts.error && d.home && d.home !== d.entry && !(facts.evidencePages || []).includes(d.home)) {
    try {
      const hh = await fetchJa(d.home, { timeout: 9000, retries: 0 });
      const ev = await fanclubEvidence(d.home, hh, { readPage: (u) => fetchJa(u, { timeout: 8000, retries: 0 }) });
      const merged = { ...(facts.evidence || {}) };
      for (const [k, v] of Object.entries(ev.evidence)) merged[k] = [...(merged[k] || []), ...v].slice(0, 2);
      facts.evidence = merged;
      facts.verdict = { ...(ev.verdict || {}), ...Object.fromEntries(Object.entries(facts.verdict || {}).filter(([, v]) => v !== null)) };
      facts.evidencePages = [...new Set([...(facts.evidencePages || []), ...ev.pagesRead])];
      facts.globalSite = facts.globalSite || ev.globalSite;
      if (facts.overseas === 'unknown' && facts.verdict.overseas) facts.overseas = facts.verdict.overseas;
    } catch { /* 홈을 못 읽으면 가입 페이지 근거만 */ }
  }
  const pages = [];
  for (const u of d.tourLinks || []) {
    try {
      const p = await fanclubSales(u, { fcName: facts?.name || null });
      if (p.sales.length || p.shows.length) pages.push(p);
    } catch { /* 페이지 하나 실패는 건너뜀 */ }
  }
  return { ...d, facts, pages };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const u of process.argv.slice(2)) {
    const t0 = Date.now();
    const r = await fanclubFor(u).catch((e) => ({ error: String(e) }));
    console.log(`\n### ${u} (${Date.now() - t0}ms)`);
    console.log(JSON.stringify({ found: r?.found, home: r?.home, entry: r?.entry, platform: r?.platform, facts: r?.facts && { name: r.facts.name, fees: r.facts.fees, overseas: r.facts.overseas, payments: r.facts.payments, languages: r.facts.languages, needsPhone: r.facts.needsPhone }, tourLinks: r?.tourLinks }, null, 1));
    for (const p of r?.pages || []) {
      console.log(`  page: ${p.title} ${p.url} shows=${p.shows.length}`);
      for (const s of p.sales) console.log(`    - ${s.label} | ${s.start} ~ ${s.end} | fcOnly=${s.fcOnly} fcFirst=${s.fcFirst} overseas=${s.overseas} noJpPhone=${s.noJpPhone} trade=${s.trade} | ${s.condition || ''}`);
    }
  }
}

/* ---------- 공식 사이트 링크가 없거나 낡은 아티스트: 검색으로 팬클럽 가입 페이지를 찾고 검증한다 ---------- */
const SEARCH_BAD_HOST = /blog|note\.com|ameblo|hatena|fc2\.com|livedoor|wikipedia|yahoo|matome|naver|twitter|x\.com|instagram|youtube|tiktok|facebook|amazon|rakuten|mercari|ticketjam|goo\.ne|news|oricon|natalie|musicman|chiebukuro|lit\.link|linktr/i;
const FC_PLATFORM = /plusmember\.jp|emtg\.jp|tobe-community\.jp|\/fc\/|fanclub|fc\.|club|member|m-up|bitfan|famm|starto\.jp|tobe-official|b-me|campaigns\.weverse\.io|japan/i;
/* 검색 엔진 하나씩: yahoo → brave → ddg. 결과 화면이 아니면(확인 화면·차단) 결과 없음이 아니라 막힘으로 센다 */
const ENGINES = ['yahoo', 'brave', 'ddg'];
export async function searchEngine(engine, q) {
  try {
    if (engine === 'yahoo') {
      const html = await fetchJa(`https://search.yahoo.co.jp/search?p=${encodeURIComponent(q)}`, { timeout: 10000, retries: 1, headers: { 'Accept-Language': 'ja' } });
      if (!/Algo__cite|sw-CardBase/.test(html)) return { urls: [], limited: 1 };
      return { urls: [...html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&').replace(/#.*$/, '')).filter((u) => !/yahoo\.co\.jp|yahoo\.com|yimg\.jp|yahoo\.net|lycorp\.co\.jp/.test(u)), limited: 0 };
    }
    if (engine === 'brave') {
      /* Node fetch는 429지만 브라우저 방식(HTTP/2) 요청은 결과 화면을 준다 */
      const html = await fetchViaCurl(`https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web`, { timeout: 12000 });
      const found = [...html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&').replace(/#.*$/, '')).filter((u) => !/brave\.com|bravesoftware|imgs\.search/.test(u));
      return { urls: found, limited: found.length ? 0 : 1 };
    }
    const html = await fetchJa(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { timeout: 10000, retries: 0, headers: { 'Accept-Language': 'ja' } });
    const urls = [...html.matchAll(/class="result__a" href="([^"]+)"/g)].map((m) => { const u = (m[1].match(/uddg=([^&]+)/) || [])[1]; return u ? decodeURIComponent(u) : m[1]; });
    return { urls, limited: urls.length ? 0 : 1 };
  } catch (e) { return { urls: [], limited: /HTTP (429|403|503)|curl|abort|timeout/i.test(String(e?.message)) ? 1 : 0 }; }
}

/* 검색어: 일본어 "○○ ファンクラブ 入会" 먼저, 없으면 한국 아티스트는 "○○ JAPAN OFFICIAL FANCLUB"(일본 팬클럽 공식 표기),
   일본 아티스트는 "○○ オフィシャルファンクラブ". 결과 페이지에 이름·팬클럽·가입 말이 모두 있어야 인정 */
export async function searchFanclub(names, { officialHost = null, origin = 'jp', wait = (ms) => new Promise((r) => setTimeout(r, ms)), queryEngine = searchEngine, readPage = fetchJa } = {}) {
  const latin = names.filter((n) => /[A-Za-z]/.test(n));
  const tokens = [...new Set(names.map((n) => n.normalize('NFKC').toLowerCase().replace(/[^a-z0-9ぁ-んァ-ン一-龯]/g, '')).filter((x) => x.length >= 2))];
  const queries = [`${names[0]} ファンクラブ 入会`, origin === 'kr' && latin[0] ? `${latin[0]} JAPAN OFFICIAL FANCLUB` : `${names[0]} オフィシャルファンクラブ`];
  const score = (u) => {
    let h;
    try { h = new URL(u); } catch { return -9; }
    const host = h.host.toLowerCase();
    if (SEARCH_BAD_HOST.test(host)) return -9;
    let sc = 0;
    /* 이름 + 두 글자 이내, 또는 이름 + japan/jp/official/fc (twicejapan.com, straykidsjapan.com) */
    const labels = host.split(/[.-]/);
    if (tokens.some((t) => /^[a-z0-9]+$/.test(t) && t.length >= 3 && labels.some((l) => l.startsWith(t) && (l.length - t.length <= 2 || /^(japan|jpn|jp|official|fc|fanclub|club|members?)$/.test(l.slice(t.length)))))) sc += 4;
    /* 공식 팬클럽 입회 안내를 싣는 플랫폼 페이지(Weverse 캠페인 등) */
    if (/^campaigns\.weverse\.io$/.test(host)) sc += 4;
    /* Weverse Shop 멤버십 판매·카테고리 화면(JENNIE MEMBERSHIP) — 주인 확인은 본문의 상품 이름으로 */
    if (host === 'shop.weverse.io' && /\/artists\/\d+\/(sales|categories)\/\d+/.test(h.pathname)) sc += 4;
    if (officialHost && (host === officialHost || host.endsWith('.' + officialHost))) sc += 4;
    if (FC_PLATFORM.test(host + h.pathname)) sc += 2;
    if (/\/(feature\/entry|regist|join|member\/add|entry|signup|membership)/i.test(h.pathname)) sc += 2;
    return sc;
  };
  let limitedAll = 0;
  let failedCandidates = 0;
  const tried = new Set();
  for (let qi = 0; qi < queries.length; qi++) for (const engine of ENGINES) {
    if (qi || engine !== ENGINES[0]) await wait(qi && engine === ENGINES[0] ? 4000 : 1500);
    const { urls, limited } = await queryEngine(engine, queries[qi]);
    limitedAll += limited;
    /* 이름이 주소에 없어도 팬클럽 호스트(fc.·club·japan 등)면 후보로(vip.fc.avex.jp, nswerjapan.com) — 대신 본문 검증을 더 엄하게 */
    const cands = [...new Set(urls)].filter((u) => !tried.has(u)).map((u) => ({ u, sc: score(u) })).filter((x) => x.sc >= 2).sort((a, b) => b.sc - a.sc).slice(0, 5);
    for (const c of cands) {
      tried.add(c.u);
      /* 로그인 뒤에서 그려지는 팬클럽 플랫폼(TOBE)은 본문을 읽을 수 없다 — 주소의 아티스트 이름(/fc/number_i)이 정확히 같을 때만 인정 */
      const slugM = (() => { try { const x = new URL(c.u); return /(^|\.)tobe-community\.jp$/.test(x.host) ? x.pathname.match(/^\/fc\/([^/?#]+)/) : null; } catch { return null; } })();
      if (slugM) {
        const sl = decodeURIComponent(slugM[1]).normalize('NFKC').toLowerCase().replace(/[^a-z0-9ぁ-んァ-ン一-龯]/g, '');
        if (tokens.includes(sl)) return { url: new URL(`/fc/${slugM[1]}`, c.u).href, score: 6, query: queries[qi], platform: 'TOBE' };
        continue;
      }
      try {
        /* 일본어로 받는다 — 한국어 화면(팔로우하기 같은 UI 글자)을 한국 쪽 단서로 착각하지 않게 */
        const page = await readPage(c.u, { timeout: 9000, retries: 0, headers: { 'Accept-Language': 'ja' } });
        const body = page.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ');
        // 검증: 아티스트 이름이 있고, 가입·회비 말이 있는 페이지만
        /* 로마자 이름은 단어 경계로(IU 가 NiziU 에 걸리지 않게) */
        const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const hasName = names.some((n) => !/^[A-Za-z0-9 .&'-]+$/.test(n) && body.includes(n)) || latin.some((n) => new RegExp(`(^|[^A-Za-z0-9])${esc(n)}([^A-Za-z0-9]|$)`, 'i').test(body));
        if (/shop\.weverse\.io/.test(c.u)) {
          const items = parseWeverseShop(page, c.u);
          if (items.some((it) => latin.some((n) => new RegExp(`(^|[^A-Za-z0-9])${esc(n)}([^A-Za-z0-9]|$)`, 'i').test(it.name)))) return { url: c.u, score: c.sc, query: queries[qi] };
          continue;
        }
        if (!hasName || !/入会|会員登録|ファンクラブ|FAN ?CLUB/i.test(body)) continue;
        if (c.sc < 4 && !(/OFFICIAL\s*FAN\s*CLUB|ファンクラブ|FANCLUB/i.test(body) && /入会|会員登録|新規登録|年会費|月会費|会費/.test(body))) continue;
        /* 주소에 이름이 없는 약한 후보는 문서 제목(title·og:title)에 이 아티스트 이름이 있어야 한다(다른 팀 팬클럽 글에 이름만 나온 경우를 거른다) */
        if (c.sc < 4) {
          const head = ((page.match(/<title>([^<]*)/) || [])[1] || '') + ' ' + ((page.match(/property=["']og:title["'][^>]*content=["']([^"']+)/) || [])[1] || '');
          const inHead = names.some((n) => !/^[A-Za-z0-9 .&'-]+$/.test(n) && head.includes(n)) || latin.some((n) => new RegExp(`(^|[^A-Za-z0-9])${esc(n)}([^A-Za-z0-9]|$)`, 'i').test(head));
          if (!inHead) continue;
        }
        // 팬 블로그·정리 글·팬 운영 사이트(팬베이스)는 버린다
        if (/このブログ|当ブログ|管理人|筆者|アフィリエイト|まとめ記事|目次|この記事|記事を書い|ファンベース|FANBASE|ファンサイト|ファンアーカイブ|ファンガイド|FAN ?ARCHIVE|FAN ?GUIDE|非公式|個人運営|有志/i.test(body)) continue;
        /* 한국 아티스트: 흔한 단어 같은 로마자 이름(ROSÉ → rose)은 일본의 다른 가수 팬클럽에도 걸린다.
           Weverse·공식 도메인이 아닌 곳은 본문에 한국 쪽 단서(한글 이름·韓国·K-POP·소속사)가 있어야 한다 */
        if (origin === 'kr' && !/weverse|smtown|ygex|jype|fnc-jp|hybe|kpop|k-pop/i.test(c.u)) {
          /* 태그 속성(해시·클래스 이름)에 걸리지 않게 글자만, 약어는 단어 경계로 */
          const txt = body.replace(/<[^>]+>/g, ' ');
          const krSignal = /[가-힣]{2,}|韓国|ケイポップ|\b(K-?POP|HYBE|BIGHIT|BELIFT|ADOR|SOURCE MUSIC|KOZ|PLEDIS|SM ENTERTAINMENT|SMTOWN|YG ENTERTAINMENT|YG PLUS|THE ?BLACK ?LABEL|JYP|STARSHIP|CUBE ENTERTAINMENT|FNC|WAKEONE|KQ ENTERTAINMENT|RBW|WM ENTERTAINMENT|IST ENTERTAINMENT|P NATION|MODHAUS|VLAST|CJ ENM|MNET|EDAM|ANTENNA|MYSTIC|AOMG|KAKAO|WOOLLIM|FANTAGIO|JELLYFISH|BRAND NEW MUSIC|YUEHUA|TOP MEDIA|DSP MEDIA|OA ENTERTAINMENT)\b/i.test(txt);
          if (!krSignal) continue;
        }
        return { url: c.u, score: c.sc, query: queries[qi] };
      } catch { failedCandidates++; /* 다음 후보 */ }
    }
  }
  // 엔진 차단·후보 페이지 실패가 남았으면 검색이 불완전하다. '없음'을 저장하지 않는다.
  if (failedCandidates > 0 || limitedAll > 0) { const err = new Error('fanclub search incomplete; retry required'); err.retry = true; throw err; }
  return null;
}
