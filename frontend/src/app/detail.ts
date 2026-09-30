/* 공연 상세 시트의 본문 — 예매처 상품 페이지에서 읽은 사실 + 그 아티스트의 공식 팬클럽.
 * "어떻게 사나"를 한 화면에: 공연 정보 · 가격 · 예매 일정 · 예매 방법 · 팬클럽 · 취소 규정.
 * 값이 없으면 칸을 만들지 않는다(추측 금지). 예매 방법은 보는 사람(에디션·언어)과 예매처에 따라 달라진다. */
import { state } from './state';
import { t, getLocale } from './i18n';
import { esc, safeHref, icon, money, convert, fmtDateTime, fmtDay, ago } from './ui';
import type { Concert } from './cards';
import { withUtm, payNames } from './fanclub';

export interface Detail {
  provider: string; url: string; fetchedAt?: string;
  facts: { period: string[] | null; venue: string | null; times: string[]; runningMin: number | null; intermissionMin: number | null; age: string | null; genre: string | null; organizer: string | null; contact: string | null };
  prices: { grade: string | null; kind: string | null; price: number; currency: string; note?: string | null }[];
  sales?: { type: 'lottery' | 'first'; label: string; start: string | null; end: string | null; status: string | null }[];
  shows?: { date: string; open: string | null; start: string | null; venue: string | null }[];
  booking: { openAt: string | null; endAt: string | null; endRule: string | null; cancelUntil: string | null; delivery: string[]; deliveryFee: number | null; systemFee?: number | null; payments?: string[]; global: { url: string; langs: string[] } | null; identityBooking?: boolean; exclusive?: boolean; perPerson: number | null; jpPhone: boolean; idCheck: boolean; faceId: boolean; eticket?: boolean; openInfo: string[] };
  refund: string[];
}
export interface DetailFanclub { artistId: string; name: string | null; entry: string; platform: string | null; fees: { annual: number | null; monthly: number | null; joinFee: number | null; handlingFee?: number | null; free?: boolean; overseasAnnual: number | null; overseasAnnualUsd: number | null } | null; overseas: string; payments: string[]; windows: { label: string; start: string | null; end: string | null; url: string; fcOnly?: boolean; overseasOk?: boolean; noJpPhone?: boolean; companionMember?: boolean }[] }
export interface DetailResponse { detail: (Detail & { cache?: { updatedAt: string | null } }) | null; fanclub: DetailFanclub | null; guide: Record<string, string> | null }

const JP_WORDS: [RegExp, string, string][] = [
  [/^クレジットカード(決済)?$/, '신용카드', 'クレジットカード'], [/^ぴあカード$/, '피아 카드', 'ぴあカード'], [/コンビニ/, '편의점 결제(일본)', 'コンビニ'],
  [/(セブン|ファミリーマート|ローソン|ミニストップ).*支払/, '편의점 결제(일본)', 'コンビニ支払'], [/電子チケット/, '전자 티켓', '電子チケット'], [/紙チケット/, '종이 티켓', '紙チケット'], [/^(店頭|セブン)/, '편의점 발권(일본)', '店頭発券'], [/配送/, '배송(일본 국내)', '配送'],
];
const jpWord = (x: string) => { const ja = getLocale() === 'ja'; const m = JP_WORDS.find(([re]) => re.test(x)); return m ? (ja ? m[2] : m[1]) : x; };
const TIME_KO = (s: string) => s
  .replace(/^\s*(관객 입장|공연 시작)\s*[:：]\s*/, (_, l: string) => `${l === '관객 입장' ? t('d.doors') : t('d.start')} `)
  .replace(/(\d{1,2})시\s*(\d{1,2})분/g, (_, h: string, m: string) => `${h.padStart(2, '0')}:${m.padStart(2, '0')}`)
  .replace(/(\d{1,2})시/g, (_, h: string) => `${h.padStart(2, '0')}:00`);

function priceCell(v: number, cur: string, fx: { jpyKrw?: number } | null) {
  const ja = getLocale() === 'ja';
  const other = cur === 'JPY' ? 'KRW' : 'JPY';
  const want = (state.edition === 'jp' || (state.edition === 'all' && ja)) ? 'JPY' : 'KRW';
  const c = want !== cur ? convert(v, cur, other, fx) : null;
  const approx = c ? (other === 'KRW' ? t('fcp.approxWon', { v: (Math.round(c / 100) * 100).toLocaleString('ko-KR') }) : `約¥${(Math.round(c / 10) * 10).toLocaleString('ja-JP')}`) : '';
  return `<b>${money(v, cur)}</b>${approx ? `<small>${esc(approx)}</small>` : ''}`;
}

function howTo(c: Concert, d: Detail | null, fc: DetailFanclub | null, guide: Record<string, string> | null) {
  const ja = getLocale() === 'ja';
  const kr = c.provider === 'nol' || c.provider === 'melon' || c.provider === 'yes24' || c.provider === 'ticketlink';
  const steps: [string, string][] = [];
  const link = (href: string, label: string) => { const url = safeHref(href, false); return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}${icon('i-ext', 'ic xs')}</a>` : esc(label); };
  const b = d?.booking;
  if (c.provider === 'fanclub') return '';
  if (kr) {
    const prov = providerLabel(c.provider);
    if ((ja || state.edition === 'jp') && (c.provider === 'nol' || c.provider === 'melon')) {
      steps.push([t('d.s.overseas'), b?.global ? `${link(b.global.url, c.provider === 'nol' ? 'NOL World' : 'Melon Ticket Global')}${b.global.langs.length ? ` · ${esc(b.global.langs.join(' / '))}` : ''}` : esc(t('d.s.noGlobal'))]);
    }
    steps.push([t('d.s.login'), esc([t('d.s.loginD', { p: prov }), b?.identityBooking ? t('d.s.identity') : ''].filter(Boolean).join(' · '))]);
    const open = b?.openAt && Date.parse(b.openAt) > Date.now() ? t('d.s.openAt', { t: fmtDateTime(b.openAt) }) : t('d.s.onsale');
    steps.push([t('d.s.open'), esc([open, b?.endRule ? t('d.s.until', { v: b.endRule }) : ''].filter(Boolean).join(' · '))]);
    const grades = [...new Set((d?.prices || []).map((p) => p.grade).filter(Boolean))];
    steps.push([t('d.s.seat'), esc([grades.length ? t('d.s.grades', { v: grades.join(' · ') }) : t('d.s.seatD'), b?.perPerson ? t('d.s.per', { n: b.perPerson }) : ''].filter(Boolean).join(' · '))]);
    if (b?.delivery?.length) steps.push([t('d.s.receive'), esc([b.delivery.join(' · '), b.deliveryFee && !/배송불가/.test(b.delivery.join('')) ? t('d.s.fee', { v: money(b.deliveryFee, 'KRW') }) : '', b.delivery.some((x) => /현장/.test(x)) && (c.provider === 'melon' || b.idCheck) ? t('d.s.idAtVenue') : ''].filter(Boolean).join(' · '))]);
    if (b?.cancelUntil) steps.push([t('d.s.cancel'), esc(t('d.s.cancelD', { v: b.cancelUntil }))]);
  } else {
    // 일본 예매처
    if (c.provider === 'eplus') {
      steps.push([t('d.s.join'), `${esc(t('d.s.eplusJoin'))} ${guide?.faqOverseas ? link(guide.faqOverseas, t('guide.src')) : ''}`]);
      if (!ja) steps.push([t('d.s.overseas'), `${esc(t('d.s.eplusIntl'))} ${guide?.intl ? link(guide.intl, 'eplus.tickets') : ''}`]);
      const next = (d?.sales || []).filter((s) => !/終了/.test(s.status || '')).slice(0, 3);
      steps.push([t('d.s.method'), esc(next.length ? next.map((s) => `${s.type === 'lottery' ? t('d.lottery') : t('d.first')} ${s.label}${s.end ? ` (~${fmtDateTime(s.end)})` : ''}`).join(' / ') : t('d.s.methodD'))]);
      steps.push([t('d.s.result'), esc(t('d.s.resultD'))]);
      steps.push([t('d.s.receive'), `${esc(t('d.s.smaticket'))} ${guide?.smaticket ? link(guide.smaticket, t('guide.src')) : ''}`]);
    } else if (c.provider === 'pia') {
      steps.push([t('d.s.join'), `${esc(t('d.s.piaJoin'))} ${guide?.telAuth ? link(guide.telAuth, t('guide.src')) : ''}`]);
      if (b?.payments?.length) steps.push([t('d.s.pay'), esc([...new Set(b.payments.map(jpWord))].join(' · '))]);
      const recv = [b?.delivery?.length ? b.delivery.map(jpWord).join(' · ') : '', b?.jpPhone ? t('d.s.jpPhone') : '', b?.systemFee ? t('d.s.sysFee', { v: money(b.systemFee, 'JPY') }) : ''].filter(Boolean);
      if (recv.length) steps.push([t('d.s.receive'), esc(recv.join(' · '))]);
      if (b?.perPerson) steps.push([t('d.s.seat'), esc(t('d.s.per', { n: b.perPerson }))]);
    } else if (c.provider === 'ltike') {
      steps.push([t('d.s.login'), esc(t('d.s.loginD', { p: providerLabel(c.provider) }))]);
      const grades = [...new Set((d?.prices || []).map((p) => p.grade).filter(Boolean))];
      steps.push([t('d.s.seat'), esc([grades.length ? t('d.s.grades', { v: grades.join(' · ') }) : t('d.s.seatD'), b?.perPerson ? t('d.s.per', { n: b.perPerson }) : ''].filter(Boolean).join(' · '))]);
      if (b?.jpPhone) steps.push([t('d.s.receive'), esc(t('d.s.jpPhone'))]);
    }
    if (fc) steps.push([t('d.s.fcFirst'), esc(t('d.s.fcFirstD', { name: fc.name ? `「${fc.name}」` : '' }).replace(/\s{2,}/g, ' '))]);
  }
  if (b?.faceId) steps.push([t('d.s.entry'), esc(t('fc.need.face'))]);
  if (!steps.length) return '';
  return `<section class="sd-sec" id="sdHow"><h3 class="sheet-h">${t('d.how')}</h3>
    <ol class="doc-steps is-compact">${steps.map(([h, v], i) => `<li><h4><span class="doc-n">${i + 1}.</span>${esc(h)}</h4><p>${v}</p></li>`).join('')}</ol>
    <p class="src-note"><a href="#/guide/${kr ? 'kr' : 'jp'}" data-close-nav>${t('nav.guide')}</a></p></section>`;
}

function fanclubBlock(fc: DetailFanclub | null, fx: { jpyKrw?: number } | null) {
  if (!fc) return '';
  const f = fc.fees;
  const rows: string[] = [];
  const yen = (v: number | null | undefined) => (v ? priceCell(v, 'JPY', fx) : '');
  if (f?.free) rows.push(`<dt>${t('fc.annual')}</dt><dd><b>${t('fcp.free')}</b></dd>`);
  if (f?.annual) rows.push(`<dt>${t('fc.annual')}</dt><dd>${yen(f.annual)}</dd>`);
  if (f?.monthly) rows.push(`<dt>${t('fc.monthly')}</dt><dd>${yen(f.monthly)}</dd>`);
  if (f?.joinFee) rows.push(`<dt>${t('fc.joinFee')}</dt><dd>${yen(f.joinFee)}</dd>`);
  rows.push(`<dt>${t('fc.overseas')}</dt><dd>${fc.overseas === 'yes' ? `<b class="ok">${t('fcp.ovsYes')}</b>${f?.overseasAnnual ? ` <small>${t('fcp.ovsFee', { v: money(f.overseasAnnual, 'JPY') })}</small>` : f?.overseasAnnualUsd ? ` <small>${t('fcp.ovsFee', { v: `$${f.overseasAnnualUsd}` })}</small>` : ''}` : fc.overseas === 'no' ? t('fcp.ovsNo') : `<span class="muted">${t('fcp.seePage')}</span>`}</dd>`);
  if (!f?.annual && !f?.monthly && !f?.free) rows.push(`<dt>${t('fcp.fee')}</dt><dd class="muted">${t('fcp.seePage')}</dd>`);
  const pays = payNames(fc.payments || []).filter((x) => !/^【/.test(x) && x.length < 30);
  if (pays.length) rows.push(`<dt>${t('fc.payments')}</dt><dd>${esc(pays.slice(0, 4).join(' · '))}</dd>`);
  const open = fc.windows.filter((w) => w.end && Date.parse(w.end) > Date.now());
  return `<section class="sd-sec" id="sdFc"><h3 class="sheet-h">${t('fc.title')} ${fc.name ? `<span class="sd-fcname">「${esc(fc.name)}」</span>` : ''}</h3>
    <dl class="kv">${rows.join('')}</dl>
    ${open.length ? `<ul class="sched">${open.map((w) => `<li><b lang="ja">${esc(w.label)}</b><span>~ ${esc(fmtDateTime(w.end))}${w.noJpPhone ? ` · ${esc(t('fc.tag.noPhone'))}` : w.overseasOk ? ` · ${esc(t('fc.tag.overseas'))}` : ''}</span></li>`).join('')}</ul>` : ''}
    <div class="sd-actions">
      <a class="btn btn-solid" href="${esc(safeHref(withUtm(fc.entry, 'fanclub_join'), false))}" target="_blank" rel="noopener" data-fc-track="join" data-artist="${esc(fc.artistId)}">${t('fc.join')}${icon('i-ext', 'ic xs')}</a>
      <a class="btn btn-line" href="#/artist/${encodeURIComponent(fc.artistId)}?fc=1" data-close-nav>${t('fc.howLink')}</a>
    </div></section>`;
}

export function detailHtml(c: Concert, r: DetailResponse | null, fx: { jpyKrw?: number } | null, listSched = '') {
  const d = r?.detail || null;
  const fc = r?.fanclub || null;
  const f = d?.facts;
  const info: string[] = [];
  const period = f?.period?.length ? (f.period[0] === f.period[f.period.length - 1] ? fmtDay(f.period[0]) : `${fmtDay(f.period[0])} – ${fmtDay(f.period[f.period.length - 1])}`) : '';
  info.push(`<dt>${t('c.date')}</dt><dd>${esc(period || [c.startDate ? fmtDay(c.startDate) : '', c.endDate && c.endDate !== c.startDate ? fmtDay(c.endDate) : ''].filter(Boolean).join(' – ') || '-')}${f?.times?.length ? `<small>${esc(f.times.map(TIME_KO).join(' · '))}</small>` : ''}</dd>`);
  if (d?.shows?.length) info.push(`<dt>${t('d.times')}</dt><dd>${d.shows.slice(0, 6).map((s) => `<span class="sd-show">${esc(fmtDay(s.date))} ${s.open ? `${esc(t('d.doors'))} ${esc(s.open)} · ` : ''}${s.start ? `${esc(t('d.start'))} ${esc(s.start)}` : ''}</span>`).join('')}</dd>`);
  info.push(`<dt>${t('c.venue')}</dt><dd>${esc(f?.venue || c.venue || '-')}</dd>`);
  if (f?.runningMin) info.push(`<dt>${t('d.running')}</dt><dd>${esc(t('d.min', { n: f.runningMin }))}${f.intermissionMin ? ` <small>${esc(t('d.inter', { n: f.intermissionMin }))}</small>` : ''}</dd>`);
  if (f?.age) info.push(`<dt>${t('d.age')}</dt><dd>${esc(f.age)}</dd>`);
  if (f?.organizer) info.push(`<dt>${t('d.org')}</dt><dd>${esc(f.organizer)}</dd>`);
  if (f?.contact) info.push(`<dt>${t('d.contact')}</dt><dd>${esc(f.contact)}</dd>`);
  const prices = d?.prices || [];
  const sales = (d?.sales || []);
  const b = d?.booking;
  const badges = [b?.exclusive ? t('d.exclusive') : '', b?.identityBooking ? t('d.identityShort') : '', b?.global ? t('d.globalShort') : ''].filter(Boolean);
  return `
    <nav class="sd-tabs"><a href="#sdInfo">${t('c.info')}</a>${prices.length ? `<a href="#sdPrice">${t('d.price')}</a>` : ''}<a href="#sdHow">${t('d.how')}</a>${fc ? `<a href="#sdFc">${t('fc.title')}</a>` : ''}${d?.refund?.length ? `<a href="#sdRefund">${t('d.refund')}</a>` : ''}</nav>
    ${badges.length ? `<p class="sd-badges">${badges.map((x) => `<span>${esc(x)}</span>`).join('')}</p>` : ''}
    <section class="sd-sec" id="sdInfo"><h3 class="sheet-h">${t('c.info')}</h3><dl class="kv">${info.join('')}</dl></section>
    ${prices.length ? `<section class="sd-sec" id="sdPrice"><h3 class="sheet-h">${t('d.price')}</h3><table class="sd-price"><tbody>${prices.map((p) => `<tr><th scope="row">${esc(p.grade || '-')}${p.kind ? ` <small>${esc(p.kind)}</small>` : ''}${p.note ? `<small lang="ja">${esc(p.note)}</small>` : ''}</th><td>${priceCell(p.price, p.currency, fx)}</td></tr>`).join('')}</tbody></table></section>` : ''}
    ${listSched && !(d?.sales?.length) ? `<section class="sd-sec">${listSched}</section>` : listSched && d?.sales?.length ? `<section class="sd-sec">${listSched.replace(/<h3 class="sheet-h">[^<]*<\/h3><ul class="sched">(?:(?!<\/ul>)[\s\S])*<\/ul>/, '')}</section>` : ''}
    ${sales.length ? `<section class="sd-sec"><h3 class="sheet-h">${t('c.schedule')}</h3><ul class="sched">${sales.map((s) => `<li class="${/終了/.test(s.status || '') ? 'is-past' : ''}"><b>${esc(s.type === 'lottery' ? t('d.lottery') : t('d.first'))} · <span lang="ja">${esc(s.label)}</span></b><span>${s.start ? esc(fmtDateTime(s.start)) : ''}${s.end ? ` ~ ${esc(fmtDateTime(s.end))}` : ''}${s.status ? ` · ${esc(statusJa(s.status))}` : ''}</span></li>`).join('')}</ul></section>` : ''}
    ${howTo(c, d, fc, r?.guide || null)}
    ${fanclubBlock(fc, fx)}
    ${d?.refund?.length ? `<section class="sd-sec" id="sdRefund"><details><summary class="sheet-h">${t('d.refund')}</summary><ul class="sd-refund">${d.refund.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details></section>` : ''}
    ${d ? `<p class="src-note">${t('d.src', { p: providerLabel(c.provider) })}${d.fetchedAt ? ` · ${esc(t('updated', { t: ago(d.fetchedAt) }))}` : ''} · <a href="${esc(safeHref(d.url, false))}" target="_blank" rel="noopener">${t('d.original')}${icon('i-ext', 'ic xs')}</a></p>` : ''}`;
}

const STATUS_KO: Record<string, string> = { 受付前: '접수 전', 受付中: '접수 중', 予定枚数終了: '매진', 受付終了: '접수 끝' };
function statusJa(s: string) { return getLocale() === 'ja' ? s : STATUS_KO[s] || s; }
function providerLabel(p: string) {
  const ja = getLocale() === 'ja';
  return ({ nol: ja ? 'NOLチケット' : 'NOL 티켓', melon: ja ? 'メロンチケット' : '멜론티켓', eplus: ja ? 'イープラス' : 'e+', pia: ja ? 'チケットぴあ' : '티켓피아', yes24: ja ? 'YES24チケット' : 'YES24 티켓', ticketlink: ja ? 'チケットリンク' : '티켓링크', ltike: ja ? 'ローチケ' : '로치케' } as Record<string, string>)[p] || p;
}
