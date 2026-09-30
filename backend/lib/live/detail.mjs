/* 공연 상세 — 예매처 상품 페이지에서 "어떻게 사는가"에 필요한 사실을 뽑는다.
 *
 * 목록 API에는 제목·날짜·장소뿐이라, 팬이 실제로 묻는 것(가격, 입장·시작 시각, 관람 시간, 연령,
 * 수령 방법, 외국인 예매 경로, 일본 전화번호 필요 여부, 결제 수단, 추첨/선착 구분)이 없다.
 * 각 예매처 상품 페이지에 공개된 값만 옮긴다. 없는 값은 null. 추측하지 않는다.
 *
 *  NOL 티켓   : Next.js RSC 안의 goodsDetail·prices JSON
 *  멜론티켓    : 상품 페이지 HTML(공연기간·관람시간·가격정보·수령 방법·외국인 예매 버튼)
 *  e+         : 상세 페이지의 회차(開場·開演)와 접수 목록(抽選/先着, 기간, 상태)
 *  티켓피아     : 공연 일시·좌석 등급별 가격·결제 수단·수령 방법·전자티켓 조건
 */
import { fetchText, halfwidth } from './http.mjs';

const lines = (html) => html
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(p|div|li|tr|h\d|dt|dd|th|td|section|ul|ol|table)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .split('\n').map((x) => halfwidth(x).replace(/\s+/g, ' ').trim()).filter(Boolean);

const yen = (s) => { const m = String(s).match(/([\d,]+)\s*円/); return m ? Number(m[1].replace(/,/g, '')) : null; };
const won = (s) => { const m = String(s).match(/([\d,]+)\s*원/); return m ? Number(m[1].replace(/,/g, '')) : null; };
const iso = (s) => { const m = String(s || '').match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:\s*[(（][^)）]{0,4}[)）])?(?:\s*T?\s*(\d{1,2}):(\d{2}))?/); if (!m) return null; const [, y, mo, d, h, mi] = m; return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}${h ? `T${h.padStart(2, '0')}:${mi}:00+09:00` : ''}`; };

/* 페이지 전체 글에서 공통으로 찾는 조건들 */
function commonFlags(text) {
  const perPerson = (text.match(/(?:1인|お一人様?|1名様?|1人)\s*(?:당\s*)?(?:최대\s*)?(\d{1,2})\s*(?:매|枚)(?:까지|まで)?/) || [])[1];
  return {
    perPerson: perPerson ? Number(perPerson) : null,
    jpPhone: /(090|080|070)[、,・\s]*(080|070)?[^。]{0,40}(日本国内|国内)[^。]{0,20}(携帯|電話)|日本国内で契約している携帯電話|日本国内の携帯電話/.test(text),
    idCheck: /본인\s*확인|신분증|本人確認|身分証/.test(text),
    faceId: /顔写真登録|顔認証|얼굴\s*사진/.test(text),
  };
}

/* ---------- NOL 티켓 ---------- */
function rscText(html) {
  return [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)]
    .map((m) => { try { return JSON.parse(`"${m[1]}"`); } catch { return ''; } }).join('');
}
function grabJson(src, key) {
  const i = src.indexOf(`"${key}":`);
  if (i < 0) return null;
  let j = i + key.length + 3;
  while (src[j] === ' ') j++;
  const open = src[j];
  if (open !== '{' && open !== '[') return null;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let k = j; k < src.length; k++) {
    const ch = src[k];
    if (ch === '"') { k++; while (k < src.length && src[k] !== '"') { if (src[k] === '\\') k++; k++; } continue; }
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) { try { return JSON.parse(src.slice(j, k + 1)); } catch { return null; } }
  }
  return null;
}
function strField(src, key) {
  const m = src.match(new RegExp(`"${key}":("(?:[^"\\\\]|\\\\.)*")`));
  if (!m) return '';
  try { return JSON.parse(m[1]); } catch { return ''; }
}
async function nolDetail(url) {
  const html = await fetchText(url, { timeout: 12000 });
  const rsc = rscText(html);
  const g = { ...(grabJson(rsc, 'goodsDetail') || {}) };
  for (const k of ['playTimeInfo', 'bizInfo', 'openInfo', 'noticeInfo', 'contentInfo', 'deliveryMethodName', 'discountInfo']) if (!g[k]) g[k] = strField(rsc, k);
  const prices = grabJson(rsc, 'prices');
  const globalLangs = grabJson(rsc, 'globalTypeList') || [];
  const intl = (html.match(/href="(https:\/\/world\.nol\.com\/[^"]+)"[^>]*>[^<]*For international users/) || html.match(/href="(https:\/\/world\.nol\.com\/[^"]+)"/) || [])[1] || null;
  const content = lines(String(g.contentInfo || ''));
  const text = [g.noticeInfo, g.openInfo, g.playTimeInfo, content.join('\n')].filter(Boolean).join('\n');
  const t = lines(html);
  const refundStart = t.findIndex((x) => /^ⓐ 취소수수료 규정|^취소수수료 규정/.test(x));
  const refund = refundStart >= 0 ? t.slice(refundStart + 1, refundStart + 12).filter((x) => /관람일|취소|환불|수수료/.test(x) && x.length < 90).slice(0, 6) : [];
  const seen = new Set();
  const priceRows = (prices?.all || prices?.basic || [])
    .filter((p) => p.priceType === 'basic' || !p.priceType)
    .map((p) => ({ grade: p.seatGradeName || null, kind: p.priceGradeName && p.priceGradeName !== '일반' ? p.priceGradeName : null, price: Number(p.salesPrice) || null, currency: 'KRW' }))
    .filter((p) => { const k = `${p.grade}|${p.kind}|${p.price}`; if (seen.has(k)) return false; seen.add(k); return p.price; });
  const times = String(g.playTimeInfo || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 4);
  return {
    provider: 'nol', url,
    facts: {
      period: g.playStartDate ? [g.playStartDate, g.playEndDate].filter(Boolean) : null,
      venue: g.placeName || null,
      times,
      runningMin: Number(g.runningTime) || null,
      intermissionMin: Number(g.interMissionTime) || null,
      age: g.viewRateName || null,
      genre: g.subGenreName || g.genreName || null,
      organizer: (String(g.bizInfo || '').match(/주최\s*[:：]\s*([^\r\n]+)/) || [])[1]?.trim() || g.bizName || null,
      contact: (String(g.bizInfo || '').match(/문의\s*[:：]\s*([^\r\n]+)/) || [])[1]?.trim() || null,
    },
    prices: priceRows,
    booking: {
      openAt: g.bookingOpenTime ? iso(g.bookingOpenTime) : null,
      endAt: g.bookingEndTime ? iso(g.bookingEndTime) : null,
      endRule: g.bookingEndTimeName || null,
      cancelUntil: g.cancelableTimeName || null,
      delivery: g.deliveryMethodName ? [g.deliveryMethodName] : [],
      deliveryFee: Number(g.deliveryFee) || null,
      global: intl ? { url: intl, langs: globalLangs } : null,
      openInfo: g.openInfo ? lines(g.openInfo).slice(0, 6) : [],
      ...commonFlags(text),
    },
    refund,
    fetchedAt: new Date().toISOString(),
  };
}

/* ---------- 멜론티켓 ---------- */
async function melonDetail(url) {
  const html = await fetchText(url, { timeout: 12000 });
  const t = lines(html);
  const after = (label) => { const i = t.findIndex((x) => x === label); return i >= 0 ? t[i + 1] : null; };
  const globalUrl = (html.match(/href="(https:\/\/tkglobal\.melon\.com\/performance\/index\.htm[^"]*)"/) || [])[1]?.replace(/&amp;/g, '&') || null;
  const pi = t.findIndex((x) => x === '가격정보');
  const prices = [];
  if (pi >= 0) {
    for (let k = pi + 1; k < Math.min(t.length, pi + 40); k++) {
      if (/^(예매 공지사항|할인정보|작품설명|기획사 정보)/.test(t[k])) break;
      const p = won(t[k]);
      if (p && k > pi + 1 && !won(t[k - 1]) && !/가격|기본가/.test(t[k - 1])) prices.push({ grade: t[k - 1], kind: null, price: p, currency: 'KRW' });
    }
  }
  const ri = t.findIndex((x) => x === '티켓 수령 방법 안내');
  const delivery = ri >= 0 ? t.slice(ri + 1, ri + 14).filter((x) => /^(현장수령|배송|모바일티켓|모바일 티켓)$/.test(x)) : [];
  const text = t.join('\n');
  return {
    provider: 'melon', url,
    facts: {
      period: after('공연기간') ? after('공연기간').split(/\s*-\s*/).map((x) => iso(x)).filter(Boolean) : null,
      venue: after('공연장'),
      times: after('공연시간') ? [after('공연시간')] : [],
      runningMin: Number((after('관람시간') || '').match(/(\d+)\s*분/)?.[1]) || null,
      intermissionMin: null,
      age: after('관람등급'),
      genre: after('장르'),
      organizer: (text.match(/주\s*최\s*[:：]\s*([^\n]+)/) || [])[1]?.trim() || null,
      contact: (text.match(/예매 관련 문의\n([^\n]+)/) || [])[1]?.trim() || null,
    },
    prices,
    booking: {
      openAt: null, endAt: null, endRule: null, cancelUntil: null,
      delivery: [...new Set(delivery)],
      deliveryFee: null,
      global: globalUrl ? { url: globalUrl, langs: ['EN', 'JP', 'CN'].filter((l) => /Foreigner|外國人/.test(html) && l) } : null,
      identityBooking: t.some((x) => /(^|\s)인증예매($|\s)/.test(x)),
      exclusive: t.some((x) => /(^|\s)단독판매($|\s)/.test(x)),
      openInfo: [],
      ...commonFlags(text),
    },
    refund: [],
    fetchedAt: new Date().toISOString(),
  };
}

/* ---------- e+ ---------- */
async function eplusDetail(url) {
  const html = await fetchText(url, { timeout: 12000 });
  const t = lines(html);
  const shows = [];
  const sales = [];
  t.forEach((x, i) => {
    const d = x.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\((.)\)$/);
    if (d && /開演/.test(t[i + 1] || '')) {
      const start = (t[i + 1].match(/開演\s*[:：]\s*(\d{1,2}:\d{2})/) || [])[1] || null;
      const open = ((t[i + 2] || '').match(/開場\s*(\d{1,2}:\d{2})/) || [])[1] || null;
      const venue = t[i + 3] && !/^\(|（/.test(t[i + 3]) ? t[i + 3] : null;
      const date = `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}`;
      if (!shows.some((s) => s.date === date && s.venue === venue)) shows.push({ date, open, start, venue });
    }
    const s = x.match(/^(先着|抽選)\s*(.+)$/);
    if (s && /受付期間/.test(t[i + 1] || '')) {
      const m = t[i + 1].match(/受付期間\s*[:：]\s*(.+?)[～~〜](.+)$/);
      sales.push({ type: s[1] === '抽選' ? 'lottery' : 'first', label: s[2].replace(/^★/, ''), start: m ? iso(m[1]) : null, end: m ? iso(m[2]) : null, status: /受付前|受付中|予定枚数終了|受付終了/.test(t[i + 2] || '') ? t[i + 2] : null });
    }
  });
  const text = t.join('\n');
  return {
    provider: 'eplus', url,
    facts: { period: shows.length ? [shows[0].date, shows[shows.length - 1].date] : null, venue: shows[0]?.venue || null, times: [], runningMin: null, intermissionMin: null, age: null, genre: null, organizer: null, contact: null },
    shows: shows.slice(0, 30),
    prices: [],
    sales: sales.slice(0, 12),
    booking: { openAt: null, endAt: null, endRule: null, cancelUntil: null, delivery: [], deliveryFee: null, global: null, openInfo: [], ...commonFlags(text) },
    refund: [],
    fetchedAt: new Date().toISOString(),
  };
}

/* ---------- 티켓피아 ---------- */
async function piaDetail(url) {
  const html = await fetchText(url, { timeout: 12000 });
  const t = lines(html);
  const shows = [];
  const prices = [];
  const seenP = new Set();
  t.forEach((x, i) => {
    const d = x.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\(\s*(.)\s*\)$/);
    if (d) {
      const tm = (t[i + 1] || '').match(/(\d{1,2}:\d{2})\s*開演\s*\(\s*(\d{1,2}:\d{2})\s*開場/);
      const venue = ((t[i + 2] || '').match(/会場\s*[:：]\s*(.+)$/) || [])[1] || null;
      const date = `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}`;
      if (!shows.some((s) => s.date === date)) shows.push({ date, start: tm?.[1] || null, open: tm?.[2] || null, venue });
    }
    const p = x.match(/^(\S[^0-9]{0,24}?)\s+([\d,]+)円(.*)$/);
    if (p && !/手数料|合計|料金/.test(p[1])) {
      const k = `${p[1]}|${p[2]}`;
      if (!seenP.has(k)) { seenP.add(k); prices.push({ grade: p[1].trim(), kind: null, price: Number(p[2].replace(/,/g, '')), currency: 'JPY', note: p[3].replace(/^\s*※\s*/, '').trim().slice(0, 60) || null }); }
    }
  });
  const block = (label) => { const i = t.findIndex((x) => x === label); if (i < 0) return []; const out = []; for (let k = i + 1; k < Math.min(t.length, i + 8); k++) { if (/^(決済方法の詳細|利用可能な|ヘルプ)/.test(t[k])) break; if (t[k].length < 24) out.push(t[k]); } return out; };
  const text = t.join('\n');
  return {
    provider: 'pia', url,
    facts: { period: shows.length ? [shows[0].date, shows[shows.length - 1].date] : null, venue: shows[0]?.venue || null, times: [], runningMin: null, intermissionMin: null, age: null, genre: null, organizer: null, contact: (text.match(/お問い合わせ先\s*[:：]?\s*\n?([^\n]{4,60})/) || [])[1] || null },
    shows: shows.slice(0, 30),
    prices: prices.slice(0, 12),
    booking: {
      openAt: null, endAt: null, endRule: null, cancelUntil: null,
      payments: [...new Set(block('利用可能な決済方法'))].filter((x) => !/^※|手数料|円|詳細|ヘルプ/.test(x) && /カード|払い|決済|Pay|コンビニ|セブン|ファミリーマート|ローソン|店頭|銀行|ATM/i.test(x)).slice(0, 6),
      delivery: [...new Set(block('利用可能な引取方法'))].filter((x) => /発券|受取|配送|引取|コンビニ|電子|店頭/.test(x) && !/^※|詳細|ヘルプ|手数料/.test(x)).slice(0, 6),
      deliveryFee: null,
      systemFee: yen((text.match(/システム利用料[\s\S]{0,40}?([\d,]+円)/) || [])[1] || '') , global: null, openInfo: [],
      eticket: /電子チケット/.test(text),
      ...commonFlags(text),
    },
    refund: [],
    fetchedAt: new Date().toISOString(),
  };
}

const PARSERS = { nol: nolDetail, melon: melonDetail, eplus: eplusDetail, pia: piaDetail };
const HOSTS = { nol: /(^|\.)nol\.yanolja\.com$|(^|\.)interpark\.com$/, melon: /(^|\.)ticket\.melon\.com$/, eplus: /(^|\.)eplus\.jp$/, pia: /(^|\.)pia\.jp$/ };

export async function concertDetail(provider, url) {
  const fn = PARSERS[provider];
  if (!fn) return null;
  const u = new URL(url);
  if (!HOSTS[provider].test(u.hostname)) throw new Error('host not allowed');
  return fn(u.href);
}

/* 이용 안내: 예매처 공식 도움말에서 확인한 사실만. 화면의 "예매 방법"은 이것과 상품 페이지 값을 합쳐 만든다. */
export const PROVIDER_GUIDE = {
  nol: {
    help: 'https://nol.yanolja.com/ticket',
    intl: 'https://world.nol.com/',
  },
  melon: {
    help: 'https://ticket.melon.com/main/index.htm',
    intl: 'https://tkglobal.melon.com/main/index.htm?langCd=EN',
  },
  eplus: {
    // 가입: 메일 인증 → 이름 등 입력 → 휴대폰 번호 입력 후 인증 번호로 발신(공식 이용 가이드)
    // 해외 거주: "원칙적으로 일본 국내용, 가입 시 일본 국내 휴대폰 필요 · 해외용은 eplus.tickets"(공식 FAQ)
    help: 'https://eplus.jp/sf/guide/service',
    faqOverseas: 'https://support-qa.eplus.jp/hc/ja/articles/360041176854',
    intl: 'https://eplus.tickets/en/',
    smaticket: 'https://eplus.jp/sf/guide/spticket',
  },
  pia: {
    // 가입·구매 시 전화번호 인증(지정 번호로 발신) 필요(공식 도움말)
    help: 'https://t.pia.jp/guide/entry.jsp',
    telAuth: 'https://t.pia.jp/guide/tel-auth.jsp',
  },
};
