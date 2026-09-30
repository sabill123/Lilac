/* 팬클럽 가입 근거 문장 — 가입 페이지·FAQ·회원 규약에서 주제별 원문을 뽑는다
 *
 * 왜: "해외에서 가입되나, 한국 카드가 되나, 일본 번호가 있어야 하나"는 팬클럽마다 다르고,
 *     요금표만 읽어서는 알 수 없다. 팬클럽이 직접 쓴 문장을 주제별로 모아 원문·출처와 함께 보여 준다.
 * 방법 (아티스트별 수작업 목록 없음)
 *   1) 가입 페이지 본문을 문장 단위로 자른다
 *   2) 같은 사이트의 FAQ·よくある質問·ご利用ガイド·会員規約 링크를 몇 장 더 읽는다
 *   3) 문장마다 주제 규칙(해외 가입 가능/불가, 결제, 전화 인증, 전자티켓, 자동 갱신, 대리 가입·양도 금지 …)을 맞춰 본다
 *   4) 주제마다 원문 문장 최대 2개와 URL을 남긴다. 판정(verdict)은 원문 문장이 있을 때만 낸다.
 * 부정문이 긍정 규칙에 걸리지 않도록 "불가" 규칙을 먼저 보고, 같은 문장은 한 판정에만 쓴다.
 */
import { halfwidth } from './http.mjs';

const plain = (html) => String(html || '')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/g, ' ')
  .replace(/\r?\n/g, ' ')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(p|div|li|tr|h\d|dt|dd|th|td|section|article|summary|details|button)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&yen;/g, '¥').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#0?39;|&#x27;/g, "'").replace(/&quot;/g, '"')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ' '; } })
  .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(Number(d)); } catch { return ' '; } })
  .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '');

/** 문장 단위: 줄바꿈과 「。」로 자르고, 너무 짧거나 메뉴 같은 조각은 버린다 */
export function sentences(html) {
  const out = [];
  for (const line of plain(html).split('\n')) {
    const l = halfwidth(line).replace(/[ \t\u3000]+/g, ' ').trim();
    if (l.length < 8) continue;
    for (const s of l.split(/(?<=[。．!?！？])\s*/)) {
      const t = s.trim();
      if (t.length >= 8 && t.length <= 400) out.push(t);
    }
  }
  return out;
}

/* 주제 규칙. 순서가 중요하다: 같은 문장은 먼저 맞은 판정에만 쓴다(불가 → 가능). */
const OVS = '(?:海外|日本国外|日本以外|国外)(?:在住|にお住まい|に居住|からの|の方|在留)';
export const TOPICS = [
  /* 발송·특전만 일본 국내로 한정하는 문장은 가입 불가가 아니다(CLUB GNU: "発送特典やサービスは、日本国内に居住の方に限ります") */
  { id: 'ship.jpOnly', re: /(?:発送|配送|お届け|郵送|特典)[^。]{0,40}(?:日本国内|国内)[^。]{0,20}(?:に限|のみ|限定)|(?:日本国内|国内)[^。]{0,20}(?:住所|居住)[^。]{0,30}(?:発送|配送|お届け|特典)/ },
  { id: 'overseas.no', re: new RegExp(`(?:(?:登録|入会)[^。]{0,30}日本国内の(?:ご)?住所に限|日本国内に(?:居住|在住|お住まい)[^。]{0,40}(?:のみ|に限り|に限ら|方が対象|とします|必要|条件)|日本国内に住所を有する|国内在住の方に限|国内在住の方のみ|${OVS}[^。]{0,40}(?:ご?入会(?:は|を)?(?:いただけ|でき|受け付けて(?:おり|い)|承って(?:おり|い))ません|対象外|お受けできません|ご利用いただけません|ご登録いただけません))`) },
  { id: 'overseas.yes', re: new RegExp(`(?:${OVS}[^。]{0,50}(?:も|でも)?(?:ご?入会|ご?登録|ご?加入)(?:いただけ|でき|が可能|可能|することができ)(?!ません)|${OVS}[^。]{0,20}(?:向け|専用)[^。]{0,20}(?:入会|コース|会員)|日本以外にお住まいの方(?:の|は)[^。]{0,30}(?:コース|会費|入会)|海外会員|overseas (?:members?|residents?)[^.]{0,60}(?:can|may|are able)|residents? outside (?:of )?Japan[^.]{0,60}(?:can|may|join))`, 'i') },
  /* "일본 국내 대상 서비스, 해외 이용은 동작 보증 외"(マカロニえんぴつ OKKAKE) — 가입 불가는 아니지만 지원하지 않는다 */
  { id: 'overseas.unsupported', re: /(?:日本国内(?:向け|を対象)|国内向け)(?:の)?サービス[^。]{0,60}(?:海外|国外)[^。]{0,40}(?:保証(?:は)?(?:して|いたし)(?:おり)?ません|動作保証外|対象外|サポート(?:して|いたし)(?:おり)?ません)|(?:海外|国外)(?:から)?(?:の)?(?:ご)?利用[^。]{0,30}(?:動作)?保証(?:は)?(?:して|いたし)(?:おり)?ません/ },
  { id: 'pay.overseasCard', re: /(?:海外|日本国外)(?:で)?発行(?:された|の)?[^。]{0,20}(?:クレジット)?カード|海外(?:の)?クレジットカード|overseas(?:-issued)? (?:credit )?cards?|cards? issued outside Japan/i },
  { id: 'pay.debitNg', re: /(?:デビット|プリペイド)カード[^。]{0,60}(?:保証|ご利用いただけな|利用できな|使用できな|お使いいただけな|できない|対象外|動作)/ },
  { id: 'pay.3ds', re: /3[D-DＤ]\s?セキュア|本人認証サービス|EMV\s?3-?D|3-?D ?Secure/i },
  { id: 'phone.jp', re: /(?:日本国内で契約(?:された|した)|日本国内の|国内の|日本の)(?:携帯)?電話番号[^。]{0,40}(?:必要|必須|のみ|限り|登録)|(?:海外|日本国外)の電話番号[^。]{0,40}(?:ご利用いただけ|登録でき|認証でき|受信でき)ません|SMS[^。]{0,30}(?:日本国内|国内)の/ },
  { id: 'phone.sms', re: /SMS認証|電話番号認証|SMS\s?\(ショートメッセージ\)|ショートメッセージ[^。]{0,20}認証|認証コード[^。]{0,30}SMS/ },
  { id: 'ticket.app', re: /(?:チケプラ|tixplus|スマチケ|EMTG電子チケット|ticket ?board|チケットボード|Weverse[^。]{0,10}(?:アプリ|チケット)|電子チケット)[^。]{0,60}(?:アプリ|受け取|受取|分配|表示|ダウンロード|発券)/i },
  { id: 'card.digital', re: /デジタル会員証|電子会員証|アプリ(?:内)?(?:の)?会員証|会員証[^。]{0,20}(?:アプリ|画面|デジタル)/ },
  { id: 'card.ship', re: /(?:会員証|会報|入会特典|特典)[^。]{0,40}(?:発送|郵送|お届け)/ },
  { id: 'ship.overseasNo', re: /(?:海外|日本国外)(?:への|へ)?(?:発送|配送|お届け)[^。]{0,30}(?:いたしません|しておりません|できません|行っておりません|対象外|不可)/ },
  /* "自動更新などはございません" — 자동 갱신이 없다는 문장을 자동 갱신 근거로 쓰지 않는다 */
  { id: 'renew.none', re: /自動(?:継続|更新)[^。]{0,12}(?:は|など(?:は)?|の)?\s*(?:ございません|ありません|行って(?:おり)?ません|いたしません|しておりません)/ },
  { id: 'renew.auto', re: /自動(?:継続|更新|引き落とし)/ },
  { id: 'renew.window', re: /継続(?:手続き|期間|受付)[^。]{0,50}(?:[0-9]+\s*(?:日|ヶ月|か月|カ月)|有効期限|月末)/ },
  { id: 'rule.noProxy', re: /(?:代行業者|代行サービス|入会代行|登録代行|申込代行|代理入会|代理での(?:ご)?(?:入会|登録|申込))[^。]{0,40}(?:禁止|お断り|できません|認めて(?:おり|い)ません|無効)|第三者(?:名義|による)[^。]{0,30}(?:入会|登録|申込|申し込み)[^。]{0,20}(?:禁止|できません|無効|お断り)/ },
  { id: 'rule.noResale', re: /(?:転売|譲渡|オークション)[^。]{0,40}(?:禁止|無効|できません|お断り)|不正転売禁止法/ },
  { id: 'rule.realName', re: /(?:本人|ご本人様?)名義[^。]{0,40}(?:必要|必須|お願い|ください|限り)|(?:入場|来場)[^。]{0,30}(?:本人確認|身分証)|身分証[^。]{0,30}(?:提示|確認)/ },
  { id: 'mail.domain', re: /(?:ドメイン|@[a-z0-9.-]+\.[a-z]{2,})[^。]{0,40}(?:受信|許可|指定|解除|設定)|(?:iCloud|icloud)[^。]{0,40}(?:届|受信)/i },
  { id: 'join.timing', re: /(?:入会|ご入会)(?:日|月)[^。]{0,40}(?:翌月|当月|から|より)[^。]{0,40}(?:有効|会員期間|開始)/ },
];

const FOLLOW = /FAQ|よくある(?:ご)?質問|Q\s?&\s?A|ヘルプ|help|ご利用ガイド|利用ガイド|入会案内|入会について|ご入会について|会員規約|会員・チケット規約|規約|kiyaku|terms|guide|about|海外|overseas|ファンクラブ|FAN ?CLUB|メンバーシップ|MEMBERSHIP/i;
const SKIP = /login|logout|mypage|cart|regist(?!ration-guide)|validation|contact|inquiry|privacy|policy\/privacy|javascript:/i;

/** 같은 사이트의 FAQ·안내·규약 링크를 우선순위대로 */
/* 같은 사이트: 등록 도메인이 같으면(faq.bokunchi.radwimps.jp ↔ bokunchi.radwimps.jp) */
export function siteKey(host) {
  const p = String(host || '').toLowerCase().split('.');
  const n = p.length >= 3 && /^(co|or|ne|ac|go|gr|ed|lg)$/.test(p[p.length - 2]) ? 3 : 2;
  return p.slice(-n).join('.');
}

export function followLinks(html, base, { limit = 4 } = {}) {
  let host;
  try { host = siteKey(new URL(base).host); } catch { return []; }
  const seen = new Set([base]);
  const cands = [];
  for (const m of String(html).matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]{0,600}?)<\/a>/gi)) {
    let u;
    try { u = new URL(m[1].replace(/&amp;/g, '&'), base); } catch { continue; }
    if (siteKey(u.host) !== host || !/^https?:$/.test(u.protocol)) continue;
    const label = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const key = `${label} ${u.pathname}`;
    if (!FOLLOW.test(key) || SKIP.test(u.pathname + u.search)) continue;
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    /* 해외 안내·FAQ를 먼저, 그다음 입회 안내·규약 */
    const score = /海外|overseas/i.test(key) ? 0 : /FAQ|よくある|Q\s?&\s?A|ヘルプ|help/i.test(key) ? 1 : /入会|ガイド|guide/i.test(key) ? 2 : 3;
    cands.push({ url: u.href, label, score });
  }
  return cands.sort((a, b) => a.score - b.score).slice(0, limit);
}

/** 해외 팬용 별도 사이트(global.clubgnu.com, "for overseas fans", "International") */
export function globalSite(html, base) {
  let key;
  try { key = siteKey(new URL(base).host); } catch { return null; }
  for (const m of String(html).matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]{0,400}?)<\/a>/gi)) {
    let u;
    try { u = new URL(m[1].replace(/&amp;/g, '&'), base); } catch { continue; }
    const label = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const hostHit = /^(global|intl|international|en|world)\./i.test(u.host) && siteKey(u.host) === key;
    const labelHit = /海外(?:在住)?の(?:方|ファン)|for (?:overseas|international) (?:fans|members)|GLOBAL (?:FAN ?CLUB|MEMBERSHIP|SITE)|INTERNATIONAL (?:FAN ?CLUB|MEMBERSHIP)/i.test(label);
    if (hostHit || labelHit) return { url: u.href, label: label.slice(0, 60) || u.host };
  }
  return null;
}

/** 문장들에서 주제별 근거를 뽑는다 */
export function classify(pages) {
  const byTopic = {};
  const used = new Set();
  const isQ = (x) => /^(?:Q|Ｑ)\s*[.:．：]?\s*/.test(x) || /(?:か|ですか|ますか|ください)\s*[?？。]?$/.test(x) && /[?？]|教えて|ますか|ですか/.test(x);
  for (const { url, html } of pages) {
    /* FAQ 상세 페이지: 첫 <dt>가 이 페이지의 질문이다 */
    const pageQ = /faq|qa|help|question/i.test(url) && /\d/.test(url) ? ((sentences((String(html).match(/<dt\b[^>]*>([\s\S]{0,400}?)<\/dt>/i) || [])[1] || '')[0] || '').replace(/^(?:Q|Ｑ)\s*[.:．：]?\s*/, '') || null) : null;
    let lastQ = pageQ, sinceQ = pageQ ? -99 : 99;
    for (const s of sentences(html)) {
      sinceQ++;
      if (pageQ && s === pageQ) continue;
      if (isQ(s)) { if (pageQ) continue; lastQ = s.replace(/^(?:Q|Ｑ)\s*[.:．：]?\s*/, ''); sinceQ = 0; continue; }
      if (used.has(s)) continue;
      /* 제목·항목 머리(■電子チケットの受け取りについて)는 규칙이 아니다 */
      if (/^[■□▼▽●◆◇【]/.test(s) && s.length < 40) continue;
      /* FAQ의 질문 문장은 답이 아니다. 미성년자 법정대리인 조항은 대리 가입 규칙이 아니다 */
      if (/法定代理人|親権者|13歳未満|未成年/.test(s)) continue;
      /* 공지 목록 제목("2026.08.31 【…】発送のお知らせ")은 규칙이 아니다 */
      if (/^\d{4}[./年]\s?\d{1,2}[./月]\s?\d{1,2}/.test(s) || /のお知らせ$/.test(s)) continue;
      for (const t of TOPICS) {
        if (!t.re.test(s)) continue;
        /* 규약의 "~인 경우가 있습니다"(限られる場合があります)는 이 팬클럽의 규칙이 아니라 가능성이다 */
        if (t.id === 'ship.jpOnly' && /場合があります|場合がございます/.test(s)) continue;
        (byTopic[t.id] ||= []);
        if (byTopic[t.id].length < 2 && !byTopic[t.id].some((x) => x.quote === s)) byTopic[t.id].push({ quote: (s.length > 220 ? `${s.slice(0, 218)}…` : s).replace(/^A\s+/, ''), url, ...(lastQ && sinceQ <= 3 ? { q: lastQ.slice(0, 120) } : {}) });
        used.add(s);
        break;
      }
    }
  }
  return byTopic;
}

/** 근거에서 판정: 원문이 있을 때만. 해외 불가 문장이 있으면 불가가 이긴다(요금표에 해외 칸이 없는데 FAQ가 막는 경우) */
export function verdicts(ev) {
  const has = (k) => !!ev[k]?.length;
  return {
    overseas: has('overseas.no') ? 'no' : has('overseas.yes') ? 'yes' : has('overseas.unsupported') ? 'limited' : null,
    phoneJp: has('phone.jp') ? true : null,
    sms: has('phone.sms') || has('phone.jp') ? true : null,
    overseasCard: has('pay.overseasCard') ? true : null,
    debitNg: has('pay.debitNg') ? true : null,
    threeDS: has('pay.3ds') ? true : null,
    autoRenew: has('renew.none') && !has('renew.auto') ? false : has('renew.auto') ? true : null,
    digitalCard: has('card.digital') ? true : null,
    shipOverseasNo: has('ship.overseasNo') || has('ship.jpOnly') ? true : null,
    noProxy: has('rule.noProxy') ? true : null,
    noResale: has('rule.noResale') ? true : null,
    realName: has('rule.realName') ? true : null,
  };
}

/* FAQ 목록에서 주제와 관계있는 문항(상세 페이지)만 — 질문 문구로 고른다 */
const FAQ_TOPIC = /海外|日本以外|国外|overseas|abroad|外国|クレジット|カード|決済|支払|お支払い|電話番号|SMS|認証|電子チケット|チケプラ|アプリ|会員証|発送|継続|自動|退会|解約|名義|本人|メール|届かない|受信|入会方法|入会について|代行|転売|譲渡/i;
export function faqDetailLinks(html, base, { limit = 6 } = {}) {
  let key;
  try { key = siteKey(new URL(base).host); } catch { return []; }
  const out = [];
  const seen = new Set();
  for (const m of String(html).matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]{0,600}?)<\/a>/gi)) {
    let u;
    try { u = new URL(m[1].replace(/&amp;/g, '&'), base); } catch { continue; }
    if (siteKey(u.host) !== key || !/faq|qa|question|help|support/i.test(u.host + u.pathname)) continue;
    if (!/\d/.test(u.pathname + u.search)) continue; // 상세 문항은 번호가 있다(/faq/detail/182, /faq_answer/F53856)
    const label = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!FAQ_TOPIC.test(label) || seen.has(u.href)) continue;
    seen.add(u.href);
    /* 해외 문항이 가장 먼저 */
    out.push({ url: u.href, label: label.slice(0, 80), score: /海外|日本以外|国外|overseas|abroad|外国/i.test(label) ? 0 : /クレジット|カード|決済|支払|電話番号|SMS|認証/i.test(label) ? 1 : 2 });
  }
  return out.sort((a, b) => a.score - b.score).slice(0, limit);
}

/** 가입 페이지 HTML과 URL로: 같은 사이트 안내 몇 장을 더 읽고 근거·판정을 만든다 */
export async function fanclubEvidence(entryUrl, entryHtml, { readPage, limit = 4, faqLimit = 8 } = {}) {
  const pages = [{ url: entryUrl, html: entryHtml }];
  const read = [];
  const seen = new Set([entryUrl]);
  const visit = async (u) => {
    if (seen.has(u)) return null;
    seen.add(u);
    try {
      const html = await readPage(u);
      pages.push({ url: u, html });
      read.push(u);
      return html;
    } catch { return null; } /* 한 장 실패는 건너뜀 — 근거가 없으면 판정도 없다 */
  };
  for (const l of followLinks(entryHtml, entryUrl, { limit })) await visit(l.url);
  /* 소개 페이지(/fanclub/about/)에는 FAQ 링크가 없고 상위(/fanclub/)에 있는 사이트 — 한 단계 위에서 한 번 더 */
  if (!pages.some((p) => /faq|qa|question/i.test(p.url))) {
    try {
      const up = new URL(entryUrl);
      const parent = up.pathname.replace(/[^/]+\/?$/, '');
      if (parent && parent !== up.pathname) {
        up.pathname = parent; up.search = '';
        const ph = await visit(up.href);
        if (ph) for (const l of followLinks(ph, up.href, { limit: 3 })) await visit(l.url);
        /* 상위 페이지가 없으면(404) 같은 폴더의 흔한 FAQ 주소 두 곳만 */
        if (!pages.some((p) => /faq|qa|question/i.test(p.url))) for (const tail of ['qa/', 'faq/']) { const hit = await visit(new URL(tail, up.href).href); if (hit) break; }
      }
    } catch { /* 상위 경로가 없으면 그대로 */ }
  }
  /* FAQ 목록은 질문 제목만 있다. 해외·결제·전화 인증 같은 문항의 답 페이지를 몇 장 더 연다 */
  const details = [];
  for (const p of [...pages]) for (const d of faqDetailLinks(p.html, p.url, { limit: faqLimit })) if (!details.some((x) => x.url === d.url)) details.push(d);
  details.sort((a, b) => a.score - b.score);
  for (const d of details.slice(0, faqLimit)) await visit(d.url);
  const ev = classify(pages);
  let global = null;
  for (const p of pages) { global = globalSite(p.html, p.url); if (global) break; }
  return { evidence: ev, verdict: verdicts(ev), pagesRead: [entryUrl, ...read], globalSite: global };
}
