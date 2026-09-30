import { safeExternal, bindSectionLink } from './_safety';
import { api } from '../../api';
import { state, buyerCurrency } from '../state';
import { t } from '../i18n';
import { esc, icon, img, skeletonRows, errorState, emptyState, freshness, params, money, convert, fmtDay } from '../ui';
import { likeBtn, shareBtn, bindSocial, commentsHtml, bindComments, targetAdapter, releaseTarget } from '../social';
import { ct } from '../cm-i18n';
import { goodsCard, releaseCard } from '../cards';
import type { Offer, Release, ArtistLite } from '../cards';

interface StoreInfo { id: string; label: string; market: string; currency: string; shipsToNote: string; homepage: string; policySource: string }

let fxAt = 0;
let fxCache: { jpyKrw?: number } | null = null;
async function fx() {
  if (!fxCache || Date.now() - fxAt > 5 * 60e3) {
    fxCache = await api('/api/live/fx').catch(() => null);
    fxAt = Date.now();
  }
  return fxCache;
}

export async function renderGoods(root: HTMLElement, alive: () => boolean) {
  const ed = state.edition;
  const q = (params().get('q') || '').trim();
  root.innerHTML = `
    <section class="page-head"><h1>${t('g.title')}</h1></section>
    <form class="bigsearch" id="gForm" role="search">
      ${icon('i-search')}
      <input type="search" name="q" value="${esc(q)}" placeholder="${t(ed === 'jp' ? 'g.ph.jp' : 'g.ph.kr')}" autocomplete="off" aria-label="${t('g.title')}">
      <button class="btn btn-solid">${t('search.go')}</button>
    </form>
    <div id="gSuggest" class="chips suggest"></div>
    <div id="gBody"></div>
    <p class="method">${t('g.method')}</p>`;
  root.querySelector<HTMLFormElement>('#gForm')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = (new FormData(e.target as HTMLFormElement).get('q') as string || '').trim();
    location.hash = v ? `#/goods?q=${encodeURIComponent(v)}` : '#/goods';
  });

  const body = root.querySelector<HTMLElement>('#gBody')!;
  const artistsP = api(`/api/live/artists?edition=${ed}`).catch(() => ({ items: [] }));
  artistsP.then((a: { items: ArtistLite[] }) => {
    if (!alive()) return;
    const top = a.items.slice(0, 10);
    root.querySelector('#gSuggest')!.innerHTML = top.length ? `<span class="label">${t('g.try')}</span>${top.map((x) => `<a class="chip" href="#/goods?q=${encodeURIComponent(x.nameOriginal && /[A-Za-z]/.test(x.nameOriginal) ? x.nameOriginal : x.name)}">${esc(x.name)}</a>`).join('')}` : '';
  });

  if (q) return searchView(body, q, alive);
  return browseView(body, alive);
}

async function searchView(body: HTMLElement, q: string, alive: () => boolean) {
  const ed = state.edition;
  body.innerHTML = `<p class="note">${t('g.searching')}</p><div class="grid-goods">${skeletonRows(8, 'sk-square')}</div>`;
  let r: { items: Offer[]; sources: { store: string; ok: boolean; count: number; error?: string }[]; stores: StoreInfo[]; cache?: { state: string; updatedAt: string | null } };
  try {
    r = await api(`/api/live/goods?q=${encodeURIComponent(q)}&market=${ed}`);
  } catch {
    if (!alive()) return;
    body.innerHTML = errorState(t('err.generic'));
    body.querySelector('[data-retry]')?.addEventListener('click', () => searchView(body, q, alive));
    return;
  }
  const rate = await fx();
  if (!alive()) return;
  const buyer = buyerCurrency();
  const stores = r.stores || [];
  const used = [...new Set(r.items.map((x) => x.store))];
  let store = '';
  let sort: 'rel' | 'new' | 'low' = 'rel';

  const failed = (r.sources || []).filter((s) => !s.ok);
  body.innerHTML = `
    <div class="toolbar">
      <div class="chips" id="gStores"><button class="chip on" data-store="">${t('c.filter.all')} <span class="n">${r.items.length}</span></button>
        ${used.map((s) => `<button class="chip" data-store="${esc(s)}">${esc(stores.find((x) => x.id === s)?.label || s)} <span class="n">${r.items.filter((x) => x.store === s).length}</span></button>`).join('')}</div>
      <div class="seg" role="group" id="gSort">
        <button data-sort="rel" class="on">${ed === 'jp' ? '関連順' : '관련순'}</button>
        <button data-sort="new">${ed === 'jp' ? '新しい順' : '최신 발매순'}</button>
        <button data-sort="low">${ed === 'jp' ? '安い順' : '낮은 가격순'}</button>
      </div>
      ${freshness(r.cache)}
    </div>
    ${failed.length ? `<p class="note is-warn">${failed.map((f) => esc(t('err.upstream', { src: stores.find((x) => x.id === f.store)?.label || f.store }))).join(' ')}</p>` : ''}
    <h2 class="result-h">${esc(t('g.results', { q, n: r.items.length }))}</h2>
    <div class="grid-goods" id="gGrid"></div>
    <section class="sec stores-info"><h2 class="side-h">${t('g.stores')}</h2><ul class="store-list">${stores.filter((s) => used.includes(s.id) || s.market === ed || s.market === 'both' || ed === 'all').map((s) => `<li><b>${esc(s.label)}</b><span>${esc(s.shipsToNote)}</span><a href="${esc(safeExternal(s.policySource))}" target="_blank" rel="noopener">${t('src')}${icon('i-ext', 'ic xs')}</a></li>`).join('')}</ul></section>`;

  const grid = body.querySelector<HTMLElement>('#gGrid')!;
  const comparable = (o: Offer) => (o.price == null ? Infinity : o.currency === buyer ? o.price : convert(o.price, o.currency, buyer, rate) ?? Infinity);
  const paint = () => {
    let rows = r.items.slice();
    if (store) rows = rows.filter((x) => x.store === store);
    if (sort === 'new') rows.sort((a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')));
    if (sort === 'low') rows.sort((a, b) => comparable(a) - comparable(b));
    grid.innerHTML = rows.length ? rows.map((g) => goodsCard(g, rate, buyer)).join('') : emptyState(t('g.noResult'));
  };
  paint();
  body.querySelectorAll<HTMLButtonElement>('[data-store]').forEach((b) => b.addEventListener('click', () => {
    store = b.dataset.store || '';
    body.querySelectorAll('[data-store]').forEach((x) => x.classList.toggle('on', x === b));
    paint();
  }));
  body.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    sort = b.dataset.sort as typeof sort;
    body.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('on', x === b));
    paint();
  }));
}

async function browseView(body: HTMLElement, alive: () => boolean) {
  const ed = state.edition;
  body.innerHTML = `<section class="sec"><div class="sec-head"><h2>${t('g.new')}</h2></div><div class="grid-squares">${skeletonRows(12, 'sk-square')}</div></section>`;
  const [rel, cur] = await Promise.all([
    api(`/api/live/releases?edition=${ed}&limit=36`).catch(() => ({ items: [] })),
    api('/api/store/releases?tier=curated&limit=12').catch(() => ({ releases: [] })),
  ]);
  if (!alive()) return;
  const curated: Release[] = (cur.releases || []).map((r: Release & { offerCount?: number }) => ({ ...r, tier: 'curated' }));
  body.innerHTML = `
    ${curated.length ? `<section class="sec"><div class="sec-head"><h2>${t('g.compare')}</h2></div><div class="grid-squares">${curated.map(releaseCard).join('')}</div></section>` : ''}
    <section class="sec"><div class="sec-head"><h2>${t('g.new')}</h2></div>${rel.items.length ? `<div class="grid-squares">${rel.items.map(releaseCard).join('')}</div>` : emptyState(t('empty.generic'))}</section>`;
}

/* 판매처·특전 비교 (사람이 확인한 발매) */
export async function renderRelease(root: HTMLElement, alive: () => boolean, id: string) {
  root.innerHTML = `<div class="sk sk-block"></div>`;
  let d: { release: Record<string, any>; comparison: { rows: Record<string, any>[]; priceFixed?: boolean; fx?: { jpyKrw: number } } };
  try {
    d = await api(`/api/store/releases/${encodeURIComponent(id)}`);
  } catch {
    if (!alive()) return;
    root.innerHTML = emptyState(t('err.generic'));
    return;
  }
  if (!alive()) return;
  const r = d.release;
  const rows = d.comparison?.rows || [];
  const byEdition = new Map<string, Record<string, any>[]>();
  for (const row of rows) {
    if (!byEdition.has(row.editionLabel)) byEdition.set(row.editionLabel, []);
    byEdition.get(row.editionLabel)!.push(row);
  }
  const ja = state.edition === 'jp';
  const buyer = buyerCurrency();
  const tg = releaseTarget({ id, title: r.title, artist: r.artist, artistId: r.artistId, artwork: r.artwork, releaseDate: r.releaseDate, type: r.type, country: r.country, tier: '' } as never);
  root.innerHTML = `
    <section class="rel-head">
      ${img(r.artwork, '', 'square', { ratio: '1/1', initial: r.artist })}
      <div>
        <p class="kicker">${esc(ja ? r.artist : r.artistKo || r.artist)}</p>
        <h1>${esc(ja ? r.title : r.titleKo || r.title)}</h1>
        <p class="muted">${esc(fmtDay(r.releaseDate, { year: true }))} ${t('g.release')} · ${esc(r.type || '')}</p>
        <div class="rel-soc">${likeBtn(tg, 'is-box')}${shareBtn(null, `#/release/${encodeURIComponent(id)}`, `${r.title} · ${r.artist}`, 'is-box')}<a class="soc-btn is-box" href="#relTalk">${icon('i-comment')}<span>${ct('soc.cmt')}</span></a></div>
        ${r.campaign ? `<div class="callout"><b>${esc(r.campaign.name)}</b><p>${esc(r.campaign.desc)}</p><p class="muted">${esc(r.campaign.storeOpensAt)} – ${esc(r.campaign.storeClosesAt)}</p></div>` : ''}
        <p class="muted small">${t('src')}: <a href="${esc(safeExternal(r.source?.url))}" target="_blank" rel="noopener">${esc(r.source?.name)}</a> · ${esc(r.source?.collectedAt || '')}</p>
      </div>
    </section>
    ${[...byEdition].map(([label, list]) => `
      <section class="sec">
        <div class="sec-head"><h2>${esc(label)}</h2><span class="muted">${esc(list[0].catalogNo || '')} · ${money(list[0].listPrice, list[0].listCurrency)}${list[0].listCurrency !== buyer && d.comparison.fx ? ` (${t('g.approx', { v: money(convert(list[0].listPrice, list[0].listCurrency, buyer, d.comparison.fx), buyer) })})` : ''}</span></div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>${t('g.stores')}</th><th>${t('g.bonus')}</th><th>${ja ? '韓国直送' : '한국 직배송'}</th><th></th></tr></thead>
          <tbody>${list.map((o) => `<tr>
            <td><b>${esc(ja ? o.store : o.storeKo || o.store)}</b>${o.offerNote ? `<p class="muted small">${esc(o.offerNote)}</p>` : ''}</td>
            <td>${esc((ja ? o.bonusJa : o.bonus) || '-')}${o.campaignEligible ? ` <span class="tag tag-accent">${esc(r.campaign?.name || '')}</span>` : ''}</td>
            <td>${o.shipsDirect ? (ja ? '対応' : '가능') : (ja ? '非対応' : '불가 (배송대행 필요)')}</td>
            <td><a class="btn btn-line sm" href="${esc(safeExternal(o.url))}" target="_blank" rel="noopener">${t('ext.buy')}${icon('i-ext', 'ic xs')}</a></td>
          </tr>`).join('')}</tbody></table></div>
      </section>`).join('')}
    <section class="sec" id="relTalk"><div class="sec-head"><h2>${ct('rel.talk')}</h2></div>${commentsHtml()}</section>
    ${d.comparison?.priceFixed ? `<p class="method">${ja ? '日本の音楽CDは再販売価格維持制度の対象のため、ショップによる価格差はありません。違いは特典と配送です。' : '일본 음반은 재판매가격유지 제도 대상이라 판매처별 가격이 같습니다. 차이는 특전과 배송입니다.'}</p>` : ''}`;
  bindSectionLink(root.querySelector('a[href="#relTalk"]'), root.querySelector('#relTalk'));
  void bindSocial(root);
  void bindComments(root.querySelector<HTMLElement>('#relTalk .cmts')!, targetAdapter(tg));
}
