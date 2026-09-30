/* 공식 팬클럽 — 정보 카드 · 가입 방법 · 유입 기록
 *
 * 예매처에 없는 공연도 팬클럽 선행·전용으로 신청할 수 있다. 팬에게는 신청 경로를,
 * 소속사에는 팬클럽 가입 유입을 만든다(가입 버튼은 utm_source=lilac 을 붙이고 클릭 수를 센다). */
import { esc, icon, img, money, fmtDateTime, until, approxMoney } from './ui';
import { t, getLocale } from './i18n';
import { buyerCurrency } from './state';
import { platformOf, clubName, PLATFORM_NAME } from './fcguide';
import type { Amt, Residence } from './fcguide';

export interface FcFacts {
  name: string | null; url: string;
  fees: { annual: number | null; monthly: number | null; joinFee: number | null; handlingFee?: number | null; free?: boolean; currency: string; overseasAnnual: number | null; overseasAnnualUsd: number | null } | null;
  overseas: 'yes' | 'no' | 'unknown'; payments: string[]; languages: string[]; platform: string | null;
}
export interface FcWindow {
  id: string; title: string; saleType: string | null; ticketOpenAt: string | null; closesAt: string | null; url: string;
  fcOnly?: boolean; fcFirst?: boolean; isPublic?: boolean; trade?: boolean; lottery?: boolean; overseasOk?: boolean; noJpPhone?: boolean; condition?: string | null; ticketing?: string | null;
  companionMember?: boolean; faceId?: boolean; joinDuringWindow?: boolean;
  showCount?: number | null; startDate?: string | null; endDate?: string | null; venue?: string | null; venueCount?: number;
}
export interface Fanclub {
  found?: boolean; name: string | null; entry: string | null; home: string | null; platform: string | null;
  facts: FcFacts | null; windows: FcWindow[]; tours: unknown[]; checkedAt?: string; official?: string;
}

export function withUtm(url: string | null | undefined, campaign: string) {
  if (!url) return '';
  try {
    const u = new URL(url);
    u.searchParams.set('utm_source', 'lilac');
    u.searchParams.set('utm_medium', 'referral');
    u.searchParams.set('utm_campaign', campaign);
    return u.href;
  } catch { return url; }
}

/* 가입·신청 클릭 수 (개인정보 없이 아티스트별 건수만). 상세 시트처럼 나중에 그려지는 버튼도 잡도록 문서에 한 번만 건다. */
let tracking = false;
export function installFcTracking() {
  if (tracking) return;
  tracking = true;
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('[data-fc-track]');
    if (!a || !a.dataset.artist) return;
    const body = JSON.stringify({ artistId: a.dataset.artist, kind: a.dataset.fcTrack });
    try {
      if (!navigator.sendBeacon?.('/api/live/fc-click', new Blob([body], { type: 'application/json' }))) {
        void fetch('/api/live/fc-click', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
      }
    } catch { /* 기록 실패는 무시 */ }
  }, true);
}

/* 원화 환산은 백 원 단위로 — 영수증이 아니라 감을 잡는 숫자 */
export function approx(v: number | null | undefined, fx: { jpyKrw?: number } | null) {
  const buyer = buyerCurrency();
  return buyer === 'KRW' ? approxMoney(v, 'JPY', 'KRW', fx) : '';
}

/* 결제 수단 이름 — 한국어 화면에서는 흔한 것만 옮기고 나머지는 원문 그대로 */
const PAY_KO: [RegExp, string][] = [
  [/クレジット/, '신용카드'], [/コンビニ/, '편의점 결제(일본)'], [/銀行振込|ペイジー|Pay-easy/i, '은행 결제(일본)'],
  [/d払い|auかんたん|ソフトバンク|キャリア決済|まとめて支払い/, '일본 통신사 결제'], [/PayPal/i, 'PayPal'], [/Apple ?Pay/i, 'Apple Pay'], [/Google ?Pay/i, 'Google Pay'],
];
export function payNames(list: string[]) {
  if (getLocale() === 'ja') return list;
  const out: string[] = [];
  for (const x of list) { const m = PAY_KO.find(([re]) => re.test(x)); const v = m ? m[1] : x; if (!out.includes(v)) out.push(v); }
  return out;
}

export function fcName(fc: Fanclub) {
  return fc.name ? `「${fc.name}」` : t('fc.official');
}

/* 아티스트 페이지의 팬클럽 — 상품 카드 한 장(자세한 가입 안내는 #/fanclub/<id> 상품 상세) + 열린 선행 접수 */
export function fanclubSection(fc: Fanclub | null, artist: { id: string | null; name: string; photo?: string | null }, fx: { jpyKrw?: number } | null) {
  if (!fc || fc.found === false || !fc.entry && !fc.home) return '';
  const f = fc.facts as (FcFacts & { residence?: Residence | null; image?: string | null; period?: string | null; fees: FcFacts['fees'] & { free?: boolean } }) | null;
  const plat = platformOf(fc);
  const open = fc.windows.filter((w) => !w.trade && (!w.closesAt || Date.parse(w.closesAt) > Date.now()));
  const club = clubName(fc.name || f?.name) || (plat === 'weverse' ? 'Weverse Membership' : `${artist.name} ${t('fc.official')}`);
  const ovsState = plat === 'familyclub' ? 'no' : f?.overseas || 'unknown';
  const ov = f?.residence?.overseas?.annual || null;
  const annual: Amt | null = ov || (f?.fees?.annual ? { v: f.fees.annual, cur: 'JPY' } : null);
  const price = f?.fees?.free ? t('fcp.free') : annual ? (annual.cur === 'USD' ? `${annual.v} USD` : money(annual.v, 'JPY')) : f?.fees?.monthly ? money(f.fees.monthly, 'JPY') : '';
  const per = f?.fees?.free ? '' : annual ? t('fc.perYear') : f?.fees?.monthly ? t('fc.perMonth') : '';
  const krw = annual && annual.cur === 'JPY' ? approx(annual.v, fx) : '';
  const href = artist.id ? `#/fanclub/${encodeURIComponent(artist.id)}` : withUtm(fc.entry || fc.home, 'fanclub_join');
  return `<section class="sec fc" id="fanclub">
    <div class="sec-head"><h2>${t('fc.title')}</h2></div>
    <a class="fcp-card" href="${href}">
      ${img(f?.image || artist.photo || null, '', 'fcp-img', { ratio: '1/1', initial: club })}
      <span class="fcp-body">
        ${PLATFORM_NAME[plat] ? `<span class="fcp-kicker">${esc(PLATFORM_NAME[plat])}</span>` : ''}
        <b class="fcp-name">${esc(club)}</b>
        <span class="fcp-price">${price ? `<strong>${esc(price)}</strong><em>${esc(per)}${ov ? ` · ${esc(t('fcl.ovs'))}` : ''}</em>${krw ? `<small>${esc(krw)}</small>` : ''}` : `<em>${esc(t('fcp.seePage'))}</em>`}</span>
        <span class="fcp-flags">${ovsState === 'yes' ? `<i class="ok">${esc(t('fc.overseas.yes2'))}</i>` : ovsState === 'no' ? `<i class="ng">${esc(t('fc.overseas.no2'))}</i>` : ''}${f?.languages?.includes('한국어') && getLocale() === 'ko' ? `<i>${esc(t('fc.step1.ko'))}</i>` : ''}${open.length ? `<i class="hot">${esc(t('fcp.openNow'))} ${open.length}</i>` : ''}</span>
      </span>
      <span class="fcp-go">${t('fc.howLink')}${icon('i-chev-r', 'ic xs')}</span>
    </a>
    ${open.length ? `<h3 class="day-h">${t('fc.windows')}</h3><ul class="tlist">${open.map((w) => fcWindowRow(w, artist)).join('')}</ul>` : ''}
  </section>`;
}

export function fcWindowRow(w: FcWindow, artist: { id: string | null; name: string }) {
  const now = Date.now();
  const opens = w.ticketOpenAt && Date.parse(w.ticketOpenAt) > now;
  const time = opens
    ? `<b>${esc(fmtDateTime(w.ticketOpenAt))}</b><span>${esc(t('c.soon', { t: until(w.ticketOpenAt) }))}</span>`
    : `<b>~ ${esc(fmtDateTime(w.closesAt))}</b><span>${esc(t('c.closes', { t: until(w.closesAt) }))}</span>`;
  const tags = [w.isPublic ? t('fc.tag.public') : w.fcOnly ? t('fc.tag.only') : t('fc.tag.first'), w.lottery ? t('fc.tag.lottery') : '', w.noJpPhone ? t('fc.tag.noPhone') : w.overseasOk ? t('fc.tag.overseas') : '', w.companionMember ? t('fc.tag.companion') : '', w.faceId ? t('fc.tag.face') : ''].filter(Boolean);
  return `<li class="trow is-fc fc-wrow${!opens ? ' is-soon' : ''}">
    <div class="trow-time">${time}</div>
    <div class="trow-main">
      <p class="trow-label">${tags.map((x) => `<span class="tag tag-fc">${esc(x)}</span>`).join('')}<span lang="ja">${esc(w.saleType || '')}</span></p>
      <h3>${esc(w.title)}</h3>
      <p class="trow-sub">${esc([w.venue ? (w.venueCount && w.venueCount > 1 ? t('c.venues', { v: w.venue, n: w.venueCount - 1 }) : w.venue) : '', w.condition ? w.condition.slice(0, 80) : ''].filter(Boolean).join(' · '))}</p>
    </div>
    <div class="trow-cta"><a class="btn btn-line sm" href="${esc(withUtm(w.url, 'fanclub_sale'))}" target="_blank" rel="noopener" data-fc-track="sale" data-artist="${esc(artist.id || artist.name)}">${t('fc.apply')}${icon('i-ext', 'ic xs')}</a></div>
  </li>`;
}
