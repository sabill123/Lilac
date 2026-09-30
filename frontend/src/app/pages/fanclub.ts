import { safeExternal } from './_safety';
/* 팬클럽 — 요금표 · 지금 열린 선행 · 가입부터 신청까지
 * 값은 각 공식 팬클럽 가입 페이지에서 읽은 것만. 못 읽은 칸은 비우지 않고 "가입 페이지 기준"으로 적는다. */
import { api } from '../../api';
import { state, buyerCurrency } from '../state';
import { t, getLocale } from '../i18n';
import { esc, icon, img, money, fmtDateTime, safeImage, errorState, emptyState, skeletonRows } from '../ui';
import { ticketRow } from '../cards';
import type { Concert } from '../cards';
import { approx } from '../fanclub';
import { platformOf, payKo, clubName, PLATFORM_NAME } from '../fcguide';
import { platKey, PLATFORM_KNOW } from '../fcknow';
import type { PlatformId, Residence } from '../fcguide';

const PLATS: PlatformId[] = ['plusmember', 'weverse', 'familyclub', 'generic'];

interface Fees { annual: number | null; monthly: number | null; joinFee: number | null; handlingFee?: number | null; taxIncluded?: boolean | null; free?: boolean; currency: string; overseasAnnual: number | null; overseasAnnualUsd: number | null }
export interface FanclubCache { state?: string; lastError?: string | null; updatedAt?: string | null }

/* Last successful observation is not a claim that fees or availability are current. */
export function fanclubCacheNotice(cache?: FanclubCache | null): string {
  if (!cache) return '';
  const ja = getLocale() === 'ja';
  const warning = cache.lastError ? (ja ? '更新に失敗したため、以前に確認した情報を表示しています。入会前に公式ページをご確認ください。' : '갱신에 실패해 이전에 확인한 정보를 표시합니다. 가입 전에 공식 페이지를 확인하세요.')
    : cache.state === 'stale' ? (ja ? '更新間隔を過ぎた情報です。入会前に公式ページをご確認ください。' : '확인 주기가 지난 정보입니다. 가입 전에 공식 페이지를 확인하세요.')
    : cache.state === 'pending' ? (ja ? '公式情報を確認中です。' : '공식 정보를 확인 중입니다.') : '';
  const at = fmtDateTime(cache.updatedAt);
  const label = [warning, at ? `${ja ? '最終確認' : '마지막 확인'} ${at}` : ''].filter(Boolean).join(' · ');
  return label ? `<span class="fresh${warning ? ' is-stale' : ''}"${warning ? ' role="status"' : ''}>${esc(label)}</span>` : '';
}

interface FcRow {
  cache?: FanclubCache | null; status?: string;
  artistId: string; artist: string; artistKo: string | null; artistLatin?: string | null; photo: string | null; official: string | null; found: boolean;
  name?: string | null; entry?: string; platform?: string | null; fees?: Fees | null; overseas?: string; payments?: string[]; languages?: string[];
  source?: string; image?: string | null; saleOpen?: boolean | null; residence?: Residence | null; overseasJoin?: string | null; open?: { label: string; end: string | null; url: string; fcOnly?: boolean; overseasOk?: boolean; noJpPhone?: boolean }[];
}


export async function renderFanclubPage(root: HTMLElement, alive: () => boolean) {
  const ed = state.edition;
  root.innerHTML = `
    <section class="page-head"><h1>${t('nav.fanclub')}</h1></section>
    <div id="fcpBody">${skeletonRows(8)}</div>`;
  let list: { items: FcRow[] }, feed: { windows: Concert[] }, fx: { jpyKrw?: number } | null;
  try {
    [list, feed, fx] = await Promise.all([
      api(`/api/live/fanclub-list?edition=${ed}`),
      api(`/api/live/fanclubs?edition=${ed}`).catch(() => ({ windows: [] })),
      api('/api/live/fx').catch(() => null),
    ]);
  } catch {
    if (!alive()) return;
    root.querySelector('#fcpBody')!.innerHTML = errorState(t('err.generic'));
    root.querySelector('[data-retry]')?.addEventListener('click', () => renderFanclubPage(root, alive));
    return;
  }
  if (!alive()) return;
  const ja = getLocale() === 'ja';
  const found = list.items.filter((x) => x.found);
  const missing = list.items.filter((x) => !x.found);
  const windows = feed.windows.filter((w) => !(w as Concert & { isPublic?: boolean }).isPublic);
  const nm = (x: FcRow) => esc(ja && /[가-힣]/.test(x.artist) && x.artistLatin ? x.artistLatin : x.artist);
  const kr = !ja;
  const now = Date.now();
  const isOpen = (x: FcRow) => (x.open || []).some((w) => !w.end || Date.parse(w.end) > now);
  const plat = (x: FcRow) => platformOf({ platform: x.platform, entry: x.entry, home: (x as FcRow & { home?: string }).home });
  const ovsOf = (x: FcRow) => { if (plat(x) === 'familyclub') return 'no'; if (x.overseas && x.overseas !== 'unknown') return x.overseas; const k = platKey(x.platform, x.entry || ''); const v = k ? PLATFORM_KNOW[k]?.overseas?.v : null; return v === 'yes' || v === 'no' ? v : 'unknown'; };
  const cond = (x: FcRow) => {
    const o = ovsOf(x);
    const pays = x.residence?.overseas?.payments?.length ? payKo(x.residence.overseas.payments).join('·') : '';
    const main = o === 'yes' ? `<b class="ok">${t('fc.overseas.yes2')}</b>` : o === 'no' ? `<b class="ng">${t('fc.overseas.no2')}</b>` : o === 'limited' ? `<b>${t('fc.overseas.limited')}</b>` : plat(x) === 'weverse' ? `<b>${t('fc.overseas.wv')}</b>` : `<span class="muted">${t('fc.overseas.unknown2')}</span>`;
    const sub = [kr && pays ? pays : '', kr && x.languages?.includes('한국어') ? t('fc.step1.ko') : ''].filter(Boolean).join(' · ');
    return main + (sub ? `<small>${esc(sub)}</small>` : '');
  };
  /* 상품 목록(Weverse Shop 멤버십 목록처럼): 대표 이미지 · 아티스트 · 팬클럽 이름 · 가격 · 조건 */
  const price = (x: FcRow) => {
    const ov = kr ? x.residence?.overseas?.annual : null;
    if (x.fees?.free) return `<b>${t('fcp.free')}</b>`;
    const a = ov || (x.fees?.annual ? { v: x.fees.annual, cur: 'JPY' as const } : null);
    /* Weverse 멤버십은 모집 기간에만 판다 — 지금 판매가 없으면 지난 판매가임을 밝힌다. 세금 별도 가격이면 표시 */
    const note = [x.fees?.taxIncluded === false ? t('fc.taxExcl') : '', x.saleOpen === false ? `${t('fc.lastPrice')} · ${t('fc.saleClosed')}` : ''].filter(Boolean).join(' · ');
    if (a) return `<b>${a.cur === 'USD' ? `${a.v} USD` : money(a.v, 'JPY')}</b><span>${t('fc.perYear')}${ov ? ` · ${t('fcl.ovs')}` : ''}</span>${a.cur === 'JPY' && approx(a.v, fx) ? `<small>${esc(approx(a.v, fx))}</small>` : ''}${note ? `<small>${esc(note)}</small>` : ''}`;
    if (x.fees?.monthly) return `<b>${money(x.fees.monthly, 'JPY')}</b><span>${t('fc.perMonth')}</span>`;
    return `<span class="muted">${t('fcp.seePage')}</span>`;
  };
  const row = (x: FcRow) => `<li class="fct" data-search="${esc([x.artist, x.artistKo, x.artistLatin, x.name].filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase())}" data-ovs="${ovsOf(x)}" data-open="${isOpen(x) ? 1 : 0}">
      <a href="#/fanclub/${encodeURIComponent(x.artistId)}">
        <span class="fct-img">${safeImage(x.image) ? `<img src="${esc(safeImage(x.image))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="if(this.naturalWidth/this.naturalHeight<1.6)this.classList.add('fit')" onerror="this.remove()">` : img(x.photo, '', '', { ratio: '1/1', initial: x.artist })}${isOpen(x) ? `<em class="fct-open">${t('fcp.openNow')}</em>` : ''}</span>
        <span class="fct-artist">${nm(x)}</span>
        <b class="fct-name">${esc(clubName(x.name) || (plat(x) === 'weverse' ? 'Weverse Membership' : `${ja && x.artistLatin ? x.artistLatin : x.artist} ${t('fc.official')}`))}</b>
        <span class="fct-price">${price(x)}</span>
        <span class="fcl-cond">${cond(x)}</span>
        ${fanclubCacheNotice(x.cache)}
      </a>
    </li>`;
  const counts = { all: found.length, ovs: found.filter((x) => ovsOf(x) === 'yes').length, open: found.filter(isOpen).length };
  const byPlat = PLATS.map((p) => ({ p, rows: found.filter((x) => plat(x) === p) })).filter((g) => g.rows.length);
  root.querySelector('#fcpBody')!.innerHTML = `

    <section class="sec"><div class="sec-head"><h2>${t('fcp.fees')}</h2></div>
      <div class="toolbar fc-toolbar"><label class="find">${icon('i-search')}<input type="search" id="fcQuery" maxlength="100" aria-label="${ja ? 'アーティスト・ファンクラブを検索' : '아티스트·팬클럽 검색'}" placeholder="${ja ? 'アーティスト・ファンクラブを検索' : '아티스트·팬클럽 검색'}"></label><div class="chips" role="group">
        <button type="button" class="chip on" data-f="all" aria-pressed="true">${t('fcl.all')} ${counts.all}</button>
        ${kr ? `<button type="button" class="chip" data-f="ovs" aria-pressed="false">${t('fc.overseas.yes2')} ${counts.ovs}</button>` : ''}
        <button type="button" class="chip" data-f="open" aria-pressed="false">${t('fcp.openNow')} ${counts.open}</button>
      </div></div>
      <p class="fc-result-count" role="status" aria-live="polite"></p>
      ${found.length ? `<ul class="fct-grid" id="fcl">${found.map(row).join('')}</ul>` : emptyState(t('empty.generic'))}
      <p class="fc-filter-empty muted" hidden>${ja ? '一致するファンクラブがありません。検索語や条件を変えてください。' : '일치하는 팬클럽이 없습니다. 검색어나 조건을 바꿔 보세요.'}</p>
      <p class="src-note">${t('fcp.src')}${buyerCurrency() === 'KRW' && fx?.jpyKrw ? ` · ${t('fcp.fx', { v: (fx.jpyKrw * 100).toFixed(0) })}` : ''}</p>
      ${missing.length ? `<details class="fcp-miss"><summary>${t('fcp.missing', { n: missing.length })}</summary><ul>${missing.map((x) => `<li><a href="#/artist/${encodeURIComponent(x.artistId)}">${esc(x.artist)}</a>${x.status === 'unverified' ? `<span class="muted"> ${ja ? '未確認' : '아직 확인하지 못함'}</span>` : ''}${fanclubCacheNotice(x.cache)}${x.official ? ` <a class="muted" href="${esc(safeExternal(x.official))}" target="_blank" rel="noopener">${t('fcp.official')}${icon('i-ext', 'ic xs')}</a>` : ''}</li>`).join('')}</ul></details>` : ''}
    </section>
    ${windows.length ? `<section class="sec"><div class="sec-head"><h2>${t('home.fanclub')}</h2><a class="more" href="#/concerts/tickets">${t('more')}</a></div><ul class="tlist">${windows.slice(0, 4).map((c) => ticketRow(c)).join('')}</ul></section>` : ''}
    <section class="sec"><div class="sec-head"><h2>${t('fcl.byPlat')}</h2><a class="more" href="#/guide/fc">${t('nav.guide')}</a></div>
      <ul class="plat-list">${byPlat.map((g) => `<li><a href="#/guide/fc/${g.p}"><b>${esc(PLATFORM_NAME[g.p])}</b><span>${esc(g.rows.slice(0, 4).map((x) => (ja && x.artistLatin ? x.artistLatin : x.artist)).join(', '))}${g.rows.length > 4 ? ` ${t('fcl.more', { n: g.rows.length - 4 })}` : ''}</span><em>${esc(t(`fcl.plat.${g.p}`))}</em></a></li>`).join('')}</ul>
    </section>`;
  let filter = 'all';
  const search = root.querySelector<HTMLInputElement>('#fcQuery')!;
  const apply = () => {
    const query = search.value.trim().normalize('NFKC').toLocaleLowerCase().split(/\s+/).filter(Boolean);
    let visible = 0;
    root.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) => { const on = b.dataset.f === filter; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    root.querySelectorAll<HTMLElement>('.fct').forEach((li) => {
      const match = (filter === 'all' || (filter === 'ovs' ? li.dataset.ovs === 'yes' : li.dataset.open === '1')) && query.every((q) => (li.dataset.search || '').includes(q));
      li.hidden = !match; if (match) visible++;
    });
    root.querySelector('.fc-result-count')!.textContent = ja ? visible + '件' : visible + '개 팬클럽';
    (root.querySelector('.fc-filter-empty') as HTMLElement).hidden = visible > 0 || !found.length;
  };
  search.addEventListener('input', apply);
  root.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((btn) => btn.addEventListener('click', () => { filter = btn.dataset.f || 'all'; apply(); }));
  apply();
}
