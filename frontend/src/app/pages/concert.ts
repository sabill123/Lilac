/* 공연 상세 — 티켓링크 상품 페이지(ticketlink.co.kr/product/…) 구성을 그대로:
 *   왼쪽 405x540 포스터 | 오른쪽 배지 · 제목(26/34)+공유 · 정보 목록(2열: 장소·관람시간·기간·관람연령 / 가격)
 *   → 예매 상자(예매 일정 | 공연 회차) + 버튼(GLOBAL BOOKING 고스트 · 예매 주 버튼)
 *   → 붙어 다니는 탭(linebox: 상세정보 · 예매안내 · 팬클럽 · 댓글) → 탭 내용(소제목 20/28 · 본문 15/22 · 정보 표)
 *   → 추천 공연(5열). 스크롤해서 정보 영역을 지나면 위에서 요약 바가 내려온다(.3s).
 * 값은 예매처 상품 페이지에서 읽은 사실만. 없는 칸은 만들지 않는다. */
import { api } from '../../api';
import { t, getLocale } from '../i18n';
import { esc, safeHref, safeImage, icon, fmtRange, fmtDateTime, fmtDay, ago, saleLabel } from '../ui';
import { concertRegistry, providerName, placeOf, whenOf, fcHowHref, followButton, bindFollow } from '../cards';
import type { Concert } from '../cards';
import type { DetailResponse } from '../detail';
import { howTo, fanclubBlock, priceCell, timesNote, statusJa, providerLabel } from '../detail';
import { withUtm } from '../fanclub';
import { likeBtn, shareBtn, bindSocial, commentsHtml, bindComments, targetAdapter, concertTarget } from '../social';
import { ct } from '../cm-i18n';
import { unstashConcert, stashConcert, posterFace, flagsOf, tlGrid, secHead, bindTopButton } from '../tl';

type Fest = Concert & { country?: string; lineup?: { name: string; artistId: string | null; origin: string | null }[]; links?: { provider: string; url: string; title: string }[]; officialSite?: string | null; exclusive?: boolean; isPublic?: boolean };
const ja = () => getLocale() === 'ja';

/* 새로고침·공유 링크로 들어와 메모리에 없으면: 세션 → 목록들에서 찾기 */
async function findConcert(id: string): Promise<Concert | null> {
  const hit = unstashConcert(id);
  if (hit) return hit;
  const eds = ['kr', 'jp'];
  const reqs = [
    ...eds.map((e) => api(`/api/live/tickets?edition=${e}&origin=all`).catch(() => null)),
    api('/api/live/concerts?edition=all&scope=all&origin=all').catch(() => null),
    api('/api/live/festivals?edition=all').catch(() => null),
  ];
  for (const r of await Promise.all(reqs)) {
    const c = (r?.items || []).find((x: Concert) => x.id === id);
    if (c) { stashConcert(c); return c; }
  }
  return null;
}

export async function renderConcertPage(root: HTMLElement, alive: () => boolean, rawId?: string) {
  const id = rawId ? decodeURIComponent(rawId) : '';
  root.innerHTML = `<div class="tl"><section class="tl-sec"><div class="tl-pd"><div class="tl-pd-imgbox tl-skel"></div><div class="tl-pd-info"><span class="tl-skel tl-skel-txt" style="width:40%"></span><span class="tl-skel tl-skel-txt" style="height:34px"></span><span class="tl-skel tl-skel-txt s"></span><span class="tl-skel tl-skel-txt s"></span></div></div></section></div>`;
  const c = id ? await findConcert(id) : null;
  if (!alive()) return;
  if (!c) {
    root.innerHTML = `<div class="tl"><section class="tl-sec"><div class="tl-page-heading"><h1 class="tl-page-title">${ja() ? '公演情報' : '공연 정보'}</h1></div><div class="tl-empty"><p>${ja() ? 'この公演は販売が終わったか、一覧から外れました。' : '판매가 끝났거나 목록에서 빠진 공연입니다.'}</p><div class="tl-more"><a class="tl-btn ghost md" href="#/concerts">${esc(t('nav.concerts'))}</a></div></div></section></div>`;
    return;
  }
  document.title = `${c.title} · Lilac`;
  paint(root, alive, c as Fest, null, null);
  const q = new URLSearchParams({ provider: c.provider, url: c.url, ...(c.artistId ? { artistId: c.artistId } : {}), ...(c.performer ? { performer: c.performer } : {}) });
  const [r, fx] = await Promise.all([api(`/api/live/detail?${q}`).catch(() => null), api('/api/live/fx').catch(() => null)]) as [DetailResponse | null, { jpyKrw?: number } | null];
  if (!alive()) return;
  const y = window.scrollY;
  paint(root, alive, c as Fest, r, fx);
  window.scrollTo({ top: y });
}

function paint(root: HTMLElement, alive: () => boolean, c: Fest, r: DetailResponse | null, fx: { jpyKrw?: number } | null) {
  const d = r?.detail || null;
  const fc = r?.fanclub || null;
  const f = d?.facts;
  const b = d?.booking;
  const loaded = !!r;
  const tg = concertTarget(c);
  const now = Date.now();
  const photo = c.posterKind === 'artist';
  const artistHref = c.artistId ? `#/artist/${encodeURIComponent(c.artistId)}` : c.performer ? `#/artist/name/${encodeURIComponent(c.performer)}` : '';

  /* 배지(티켓링크 flag_area): 분류 · 방향 · D-day · 상태 · 단독 */
  const flags: string[] = [];
  if (c.direction) flags.push(`<span class="tl-flag">${esc(t(`dir.${c.direction}`))}</span>`);
  flags.push(`<span class="tl-flag">${esc(c.genre || t(`kind.${c.kind || 'concert'}`))}</span>`);
  if (b?.exclusive) flags.push(`<span class="tl-flag is-primary-bg">${esc(t('d.exclusive'))}</span>`);
  const flagHtml = flagsOf(c, { withProvider: false }).replace('<div class="tl-flags"><div class="tl-flag-area">', `<div class="tl-flag-area">${flags.join('')}`).replace(/<\/div><\/div>$/, '</div>') || `<div class="tl-flag-area">${flags.join('')}</div>`;

  /* 정보 목록: 1줄에 2칸 — 장소 · 관람시간 / 기간 · 관람연령 / 출연 · 예매처, 가격은 한 줄 전체 */
  const period = f?.period?.length ? (f.period[0] === f.period[f.period.length - 1] ? fmtDay(f.period[0]) : `${fmtDay(f.period[0])} ~ ${fmtDay(f.period[f.period.length - 1])}`) : fmtRange(c.startDate, c.endDate).replace(/\s*–\s*/, ' ~ ');
  const venue = f?.venue || placeOf(c) || '';
  const item = (label: string, html: string, wide = false) => (html ? `<li class="tl-pd-item${wide ? ' is-wide' : ''}"><span>${esc(label)}</span><div>${html}</div></li>` : '');
  const mapHref = venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}` : '';
  const list1 = [
    item(t('c.venue'), venue ? `<a href="${esc(mapHref)}" target="_blank" rel="noopener">${esc(venue)}</a>` : ''),
    item(t('d.running'), f?.runningMin ? `${esc(t('d.min', { n: f.runningMin }))}${f.intermissionMin ? `<small>${esc(t('d.inter', { n: f.intermissionMin }))}</small>` : ''}` : ''),
    item(ja() ? '期間' : '기간', `<span class="num">${esc(period || '-')}</span>${(c.showCount || 0) > 1 ? `<small>${esc(t('c.shows', { n: c.showCount! }))}</small>` : ''}${timesNote(f?.times)}`),
    item(t('d.age'), f?.age ? esc(f.age) : ''),
    item(t('c.artist'), c.performer ? (artistHref ? `<a href="${artistHref}">${esc(c.performer)}</a>` : esc(c.performer)) : ''),
    item(t('c.provider'), `${esc(providerName(c))}${c.alsoAt?.length ? `<small>${ja() ? `ほか${c.alsoAt.length}社でも販売` : `다른 예매처 ${c.alsoAt.length}곳에서도 판매`}</small>` : ''}`),
  ].filter(Boolean);
  const prices = d?.prices || [];
  const priceList = prices.length ? prices.slice(0, 6).map((p) => `<div class="tl-pd-sub-item">${esc(p.grade || '-')}${p.kind ? ` <small style="display:inline">${esc(p.kind)}</small>` : ''} <span class="em num">${priceCell(p.price, p.currency, fx).replace(/<\/?b>/g, '').replace('<small>', '<small style="display:inline;margin-left:6px">')}</span></div>`).join('') + (prices.length > 6 ? `<div class="tl-pd-sub-item"><button type="button" class="tl-link" data-go="guide">${ja() ? '料金をすべて見る' : '전체 가격 보기'}</button></div>` : '') : '';
  const list2 = [item(t('d.price'), priceList || (loaded ? '' : `<span class="tl-skel tl-skel-txt s" style="margin:0;width:180px"></span>`), true)].filter(Boolean);

  /* 옵션 버튼(티켓링크 클린예매·대기 표시 자리): 외국인 예매 · 인증예매 · 팬클럽 */
  const opts = [
    b?.global ? `<a class="is-blue" href="${esc(safeHref(b.global.url, false))}" target="_blank" rel="noopener">${esc(t('d.globalShort'))}</a>` : '',
    b?.identityBooking ? `<span class="is-clean">${esc(t('d.identityShort'))}</span>` : '',
    fc ? `<button type="button" class="is-green" data-go="fc">${esc(t('fc.title'))}</button>` : '',
  ].filter(Boolean);

  /* 예매 상자: 예매 일정(예매처 상품 페이지 또는 목록의 일정) | 공연 회차 */
  const sched = (d?.sales?.length ? d.sales.map((s) => ({ label: `${s.type === 'lottery' ? t('d.lottery') : t('d.first')} · ${s.label}`, at: s.start, end: s.end, status: s.status ? statusJa(s.status) : '' }))
    : (c.openSchedule || []).filter((s) => s.at || s.endAt).map((s) => ({ label: c.provider === 'fanclub' ? s.label || '' : saleLabel(s.label) || t('c.open'), at: s.at, end: s.endAt || null, status: '' })));
  if (!sched.length && c.ticketOpenAt) sched.push({ label: saleLabel(c.ticketOpenLabel) || t('c.open'), at: c.ticketOpenAt, end: null, status: '' });
  const shows = d?.shows?.length ? d.shows.map((s) => ({ date: s.date, sub: [s.open ? `${t('d.doors')} ${s.open}` : '', s.start ? `${t('d.start')} ${s.start}` : ''].filter(Boolean).join(' · '), venue: s.venue || '' }))
    : (c.shows || []).map((s) => ({ date: s.date, sub: '', venue: [s.venue, s.city].filter(Boolean).join(' · ') }));
  const nextOpen = [b?.openAt, c.ticketOpenAt, ...sched.map((s) => s.at)].filter((x): x is string => !!x && Date.parse(x) > now).sort()[0];
  const schedCol = sched.length ? `<div class="tl-reserve-col" style="flex:1.1"><h3 class="tl-reserve-heading"><em>STEP 1</em><b>${esc(t('c.schedule'))}</b></h3><ul class="tl-reserve-list">${sched.slice(0, 8).map((s) => { const end = s.end ? Date.parse(s.end) : s.at ? Date.parse(s.at) : 0; const past = end && end < now && (s.end ? true : false); const on = s.at && Date.parse(s.at) <= now && (!s.end || Date.parse(s.end) > now); return `<li class="${past ? 'is-past' : on ? 'is-now' : ''}"><b lang="${c.provider === 'fanclub' || c.provider === 'eplus' ? 'ja' : ''}">${esc(s.label)}</b><span>${s.at ? esc(fmtDateTime(s.at)) : ''}${s.end ? ` ~ ${esc(fmtDateTime(s.end))}` : ''}${s.status ? ` · ${esc(s.status)}` : ''}</span></li>`; }).join('')}</ul></div>` : '';
  const showCol = shows.length ? `<div class="tl-reserve-col is-fill"><h3 class="tl-reserve-heading"><em>STEP ${schedCol ? 2 : 1}</em><b>${esc(t('d.times'))}</b></h3><ul class="tl-reserve-list">${shows.slice(0, 12).map((s) => `<li><b class="num">${esc(fmtDay(s.date))}</b><span>${esc([s.sub, s.venue].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul></div>` : '';
  const notice = c.status === 'soldout' ? (ja() ? '予定枚数が終了しました。' : '예정 매수가 모두 팔렸습니다.')
    : nextOpen ? (ja() ? `<b>${esc(fmtDateTime(nextOpen))}</b> 発売開始です。` : `<b>${esc(fmtDateTime(nextOpen))}</b>에 예매가 열립니다.`)
    : c.provider === 'fanclub' ? (ja() ? 'ファンクラブ会員の申込ページで受け付けています。' : '팬클럽 회원 신청 페이지에서 접수합니다.')
    : (ja() ? 'プレイガイドで日時と座席を選んで購入します。' : '예매처에서 날짜와 좌석을 골라 예매합니다.');
  const reserveBox = schedCol || showCol ? `<div class="tl-reserve">${schedCol}${showCol}</div>` : `<div class="tl-reserve"><p class="tl-reserve-notice">${notice}</p></div>`;

  /* 버튼: 고스트(외국인 예매 / 팬클럽 가입 방법) + 주 버튼(예매처로) */
  const bookLabel = c.provider === 'fanclub' ? t('fc.apply') : c.status === 'soldout' ? (ja() ? 'プレイガイドで確認' : '예매처에서 확인') : nextOpen ? (ja() ? '発売予定・ページを見る' : '판매예정 · 예매처 보기') : (ja() ? '予約する' : '예매하기');
  const bookHref = c.provider === 'fanclub' ? safeHref(withUtm(c.url, 'fanclub_sale'), false) : safeHref(c.url, false);
  const ghost = c.provider === 'fanclub' && fcHowHref(c) ? `<a class="tl-btn ghost xl" href="${esc(fcHowHref(c))}">${esc(t('fc.howLink'))}</a>`
    : b?.global ? `<a class="tl-btn ghost xl" href="${esc(safeHref(b.global.url, false))}" target="_blank" rel="noopener"><span>GLOBAL BOOKING</span></a>` : '';
  const primary = `<a class="tl-btn primary xl" href="${esc(bookHref)}" target="_blank" rel="noopener" ${c.provider === 'fanclub' ? `data-fc-track="sale" data-artist="${esc(c.artistId || '')}"` : ''}>${esc(bookLabel)} ${icon('i-ext', 'ic xs')}</a>`;
  const srcMeta = d ? `${esc(t('d.src', { p: providerLabel(c.provider) }))}${d.fetchedAt ? ` · ${esc(t('updated', { t: ago(d.fetchedAt) }))}` : ''} · <a href="${esc(safeHref(d.url, false))}" target="_blank" rel="noopener" style="text-decoration:underline">${esc(t('d.original'))}</a>` : loaded ? '' : esc(t('d.loading'));

  /* 탭 내용 */
  const panels: { key: string; label: string; html: string }[] = [];
  const infoRows = [
    [t('d.org'), f?.organizer], [t('d.contact'), f?.contact], [t('d.age'), f?.age],
    [t('d.running'), f?.runningMin ? t('d.min', { n: f.runningMin }) : ''], [t('c.venue'), venue], [t('c.provider'), providerName(c)],
  ].filter((x) => x[1]) as [string, string][];
  const festLineup = c.kind === 'festival' ? (c.lineup?.length
    ? `<h3 class="tl-pd-subtit">${ja() ? '出演' : '라인업'} <span class="num" style="color:var(--tl-ink-3);font-size:16px">${c.lineup.length}</span></h3><div class="tl-lineup">${c.lineup.map((x) => `<a href="${x.artistId ? `#/artist/${encodeURIComponent(x.artistId)}` : `#/artist/name/${encodeURIComponent(x.name)}`}">${esc(x.name)}${x.origin === 'jp' ? '<i class="jp">JP</i>' : x.origin === 'kr' ? '<i class="kr">KR</i>' : ''}</a>`).join('')}</div>`
    : `<h3 class="tl-pd-subtit">${ja() ? '出演' : '라인업'}</h3><div class="tl-editor"><p>${ja() ? '出演者はプレイガイドのページに画像で掲載されています。' : '라인업은 예매처 상품 페이지에 이미지로 공개되어 있습니다.'}</p></div>`) : '';
  const vname = (p: string, label?: string) => providerName({ ...c, provider: p, providerLabel: label || p } as Concert);
  const buyLinks = [
    ...(c.kind === 'festival' ? (c.links || []).map((l) => [vname(l.provider), l.url, l.title]) : [[providerName(c), c.url, t('d.vendorPage')], ...(c.alsoAt || []).map((l) => [vname(l.provider, l.providerLabel), l.url, t('d.vendorPage')])]),
    ...(c.officialSite ? [[ja() ? '公式サイト' : '공식 사이트', c.officialSite, c.officialSite.replace(/^https?:\/\//, '').replace(/\/$/, '')]] : []),
  ] as [string, string, string][];
  const openInfo = (b?.openInfo || []).filter(Boolean);
  panels.push({
    key: 'info', label: ja() ? '詳細情報' : '상세정보', html: `
    ${shows.length ? `<h3 class="tl-pd-subtit">${ja() ? '公演時間情報' : '공연시간 정보'}</h3><div class="tl-editor">${shows.slice(0, 20).map((s) => `<p><b style="color:var(--tl-ink);font-weight:500" class="num">${esc(fmtDay(s.date))}</b> ${esc([s.sub, s.venue].filter(Boolean).join(' · '))}</p>`).join('')}</div>` : ''}
    ${c.provider === 'fanclub' ? `<h3 class="tl-pd-subtit">${esc(t('fc.sheet', { name: c.fanclub?.name ? `「${c.fanclub.name}」` : '' }))}</h3><div class="tl-editor"><p>${esc([t('fc.sheet.join'), c.fanclub?.overseas === 'yes' ? t('fc.step2.ovs') : ''].filter(Boolean).join(' · '))}</p>${c.condition ? `<p lang="ja">${esc(c.condition)}</p>` : ''}</div>` : ''}
    ${openInfo.length || b?.endRule || b?.cancelUntil ? `<h3 class="tl-pd-subtit">${ja() ? 'お知らせ' : '공지사항'}</h3><div class="tl-editor">${openInfo.map((x) => `<p>${esc(x)}</p>`).join('')}${b?.endRule ? `<p>${esc(t('d.s.until', { v: b.endRule }))}</p>` : ''}${b?.cancelUntil ? `<p>${esc(t('d.s.cancelD', { v: b.cancelUntil }))}</p>` : ''}</div>` : ''}
    ${festLineup}
    ${buyLinks.length ? `<h3 class="tl-pd-subtit">${ja() ? 'チケット購入先' : '예매처'}</h3><ul class="tl-links">${buyLinks.map(([n, u, l]) => `<li><a href="${esc(safeHref(u, false))}" target="_blank" rel="noopener"><b>${esc(n)}</b><span>${esc(l)}</span>${icon('i-ext', 'ic xs')}</a></li>`).join('')}</ul>` : ''}
    ${infoRows.length ? `<h3 class="tl-pd-subtit">${ja() ? '商品情報' : '상품 정보'}</h3><div class="tl-table"><table><tbody>${infoRows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${!loaded ? `<p class="tl-note">${esc(t('d.loading'))}</p>` : ''}`,
  });
  const how = howTo(c, d, fc, r?.guide || null).replace(/<h3 class="sheet-h">[^<]*<\/h3>/, '');
  const guideHtml = [
    how ? `<h3 class="tl-pd-subtit">${esc(t('d.how'))}</h3><div class="tl-editor">${how}</div>` : '',
    prices.length ? `<h3 class="tl-pd-subtit">${esc(t('d.price'))}</h3><div class="tl-table"><table><tbody>${prices.map((p) => `<tr><th scope="row">${esc(p.grade || '-')}${p.kind ? `<small>${esc(p.kind)}</small>` : ''}${p.note ? `<small lang="ja">${esc(p.note)}</small>` : ''}</th><td class="price">${priceCell(p.price, p.currency, fx)}</td></tr>`).join('')}</tbody></table></div>` : '',
    d?.sales?.length ? `<h3 class="tl-pd-subtit">${esc(t('c.schedule'))}</h3><div class="tl-table"><table><tbody>${d.sales.map((s) => `<tr><th scope="row">${esc(s.type === 'lottery' ? t('d.lottery') : t('d.first'))}<small lang="ja">${esc(s.label)}</small></th><td>${s.start ? esc(fmtDateTime(s.start)) : ''}${s.end ? ` ~ ${esc(fmtDateTime(s.end))}` : ''}${s.status ? `<small>${esc(statusJa(s.status))}</small>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '',
    d?.refund?.length ? `<h3 class="tl-pd-subtit">${esc(t('d.refund'))}</h3><div class="tl-editor">${d.refund.map((x) => `<p>${esc(x)}</p>`).join('')}</div>` : '',
  ].join('');
  if (guideHtml) panels.push({ key: 'guide', label: ja() ? '購入案内' : '예매안내', html: guideHtml });
  if (fc) panels.push({ key: 'fc', label: t('fc.title'), html: `<div class="tl-editor tl-pd-fc">${fanclubBlock(fc, fx)}</div>` });
  panels.push({ key: 'talk', label: ct('soc.cmt'), html: `<div class="tl-pd-talk">${commentsHtml()}</div>` });

  /* 추천: 같은 방향(내한·원정)·가까운 날짜의 다른 공연 5개(지금 메모리에 있는 목록에서) */
  const rec = [...concertRegistry.values()].filter((x) => x.id !== c.id && x.provider !== 'fanclub' && x.poster && (c.direction ? x.direction === c.direction : x.kind === c.kind) && (x.startDate || '') >= new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10))
    .filter((x, i, arr) => arr.findIndex((y) => y.title === x.title) === i)
    .sort((a, b2) => Number(b2.artistId === c.artistId && !!c.artistId) - Number(a.artistId === c.artistId && !!c.artistId) || (a.startDate || '').localeCompare(b2.startDate || '')).slice(0, 5);

  root.innerHTML = `<div class="tl" id="pdRoot">
    <section class="tl-sec">
      <div class="tl-pd" id="pdInfo">
        <div class="tl-pd-imgbox${photo ? ' is-photo' : ''}">${posterFace(c)}</div>
        <div class="tl-pd-info">
          ${flagHtml}
          <div class="tl-pd-heading">
            <h1 class="tl-pd-title">${esc(c.title)}</h1>
            ${c.performerKo && getLocale() === 'ko' && !c.title.includes(c.performerKo) ? `<p class="tl-pd-sub">${esc(c.performerKo)}</p>` : ''}
            <div class="tl-pd-share">${shareBtn(tg, '#/e/{key}', c.title, 'icon-only')}</div>
          </div>
          <h2 class="blind">${ja() ? '商品の代表情報' : '상품 대표 정보'}</h2>
          <ul class="tl-pd-list col2">${list1.join('')}</ul>
          ${list2.length ? `<ul class="tl-pd-list col2">${list2.join('')}</ul>` : ''}
          ${c.provider !== 'fanclub' && (c.artistId || c.performer) ? `<div style="margin-top:8px">${c.artistId ? followButton(c.artistId, c.performer || c.title, 'sm') : followButton(`name:${c.performer}`, c.performer!, 'sm')}</div>` : ''}
        </div>
        ${opts.length ? `<div class="tl-pd-option">${opts.join('')}</div>` : ''}
      </div>
    </section>
    <section class="tl-sec">
      <h2 class="blind">${ja() ? '予約' : '상품 예매'}</h2>
      ${reserveBox}
      <div class="tl-reserve-util"><p class="tl-reserve-meta">${srcMeta}</p><div class="tl-reserve-btns">${likeBtn(tg, 'is-box')}${ghost}${primary}</div></div>
    </section>
    <section class="tl-pd-tab" id="pdTab"><h2 class="blind">${ja() ? '商品情報タブ' : '상품 정보 탭'}</h2>
      <div class="tl-inner"><div class="tl-tab-linebox" role="tablist">${panels.map((p, i) => `<div class="${i === 0 ? 'is-active' : ''}"><button type="button" role="tab" aria-selected="${i === 0}" data-pd="${p.key}">${esc(p.label)}${p.key === 'talk' ? ' <em class="sd-cn num" style="font-style:normal"></em>' : ''}</button></div>`).join('')}</div></div>
    </section>
    <section class="tl-sec tl-pd-tabcont" id="pdCont">${panels.map((p, i) => `<section class="tl-pd-sec" data-panel="${p.key}" ${i === 0 ? '' : 'hidden'}><h2 class="blind">${esc(p.label)}</h2>${p.html}</section>`).join('')}</section>
    ${rec.length ? `<section class="tl-sec tl-pd-rec">${secHead(ja() ? 'おすすめ公演' : '추천 공연')}${tlGrid(rec, { col5: true })}</section>` : ''}
    <section class="tl-sum" id="pdSum" aria-hidden="true"><div class="tl-inner tl-sum-in">
      <div class="tl-sum-img">${safeImage(c.poster) ? `<img src="${esc(safeImage(c.poster))}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</div>
      <div class="tl-sum-info"><strong class="tl-sum-title">${esc(c.title)}</strong><div class="tl-sum-side">${venue ? `<span>${esc(venue)}</span>` : ''}<span class="num">${esc(whenOf(c) || period)}</span></div></div>
      <div class="tl-sum-btns">${ghost.replace('tl-btn ghost xl', 'tl-btn ghost md')}${primary.replace('tl-btn primary xl', 'tl-btn primary md')}</div>
    </div></section>
  </div>`;

  const pd = root.querySelector<HTMLElement>('#pdRoot')!;
  /* 탭 전환(한 번에 한 내용) — 탭이 붙어 있는 상태면 내용 맨 위로 */
  const pick = (key: string) => {
    pd.querySelectorAll<HTMLElement>('[data-pd]').forEach((btn) => { const on = btn.dataset.pd === key; btn.setAttribute('aria-selected', String(on)); btn.parentElement!.classList.toggle('is-active', on); });
    pd.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== key; });
    const cont = pd.querySelector<HTMLElement>('#pdCont')!;
    const tabEl = pd.querySelector<HTMLElement>('#pdTab')!;
    if (tabEl.getBoundingClientRect().top <= (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hdr-total')) || 64) + 130) cont.scrollIntoView({ block: 'start' });
  };
  pd.querySelectorAll<HTMLButtonElement>('[data-pd]').forEach((btn) => btn.addEventListener('click', () => pick(btn.dataset.pd!)));
  pd.querySelectorAll<HTMLElement>('[data-go]').forEach((el) => el.addEventListener('click', () => { pick(el.dataset.go!); pd.querySelector('#pdTab')!.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));

  /* 요약 바: 정보 영역 아래로 스크롤하면 내려온다 */
  const sum = pd.querySelector<HTMLElement>('#pdSum')!;
  const info = pd.querySelector<HTMLElement>('#pdInfo')!;
  const onScroll = () => {
    if (!alive() || !pd.isConnected) { window.removeEventListener('scroll', onScroll); return; }
    const fixed = info.getBoundingClientRect().bottom < 0;
    if (fixed !== sum.classList.contains('is-fixed')) {
      sum.classList.toggle('is-fixed', fixed);
      sum.setAttribute('aria-hidden', String(!fixed));
      pd.style.setProperty('--tl-sum-h', fixed ? `${sum.querySelector<HTMLElement>('.tl-sum-in')!.offsetHeight}px` : '0px');
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  bindTopButton(alive);

  const talk = pd.querySelector<HTMLElement>('[data-panel="talk"] .cmts');
  if (talk) void bindComments(talk, targetAdapter(tg, (n) => { const el = pd.querySelector('.sd-cn'); if (el) el.textContent = n ? String(n) : ''; }));
  bindFollow(pd);
  void bindSocial(pd);
}
