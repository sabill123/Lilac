import { artUrl, esc, icon } from '../api';
import type { Artist, Product } from '../api';
import { smartMatch } from '../koja';
import { artistFacets, filterProducts, initialStoreState, productCurrency, productOrigin, updateStoreState, visibleProducts } from './model';
import type { StoreState } from './model';

let state = initialStoreState();
let listeners: AbortController | undefined;
const SIZES = [{ key: 'all', name: '전체 앨범' }, { key: 'album', name: '정규 앨범' }, { key: 'mini', name: '미니 앨범' }, { key: 'single', name: '싱글' }] as const;
const ORIGINS = [{ key: 'all', name: '전체' }, { key: 'jp', name: 'J-POP · 일본반' }, { key: 'kr', name: 'K-POP · 한국반' }] as const;
const cash = (p: Product) => `${productCurrency(p) === 'JPY' ? '¥' : '₩'}${p.price.toLocaleString('ko-KR')}`;
const productHref = (p: Product) => `#/store/${encodeURIComponent(p.id)}`;
function artwork(p: Product, eager = false) {
  return `<span class="shop-art"><span class="shop-art-fallback" aria-hidden="true">${icon('i-lib', 'ic')}<span>커버 준비 중</span></span>${p.artwork ? `<img src="${esc(artUrl(p, 300))}" alt="" loading="${eager ? 'eager' : 'lazy'}" decoding="async">` : ''}</span>`;
}
function productCard(p: Product, index: number) {
  return `<a class="shop-card" href="${productHref(p)}" data-product-id="${esc(p.id)}">
    ${artwork(p, index < 4)}
    <div class="shop-card-body"><span class="shop-card-brand">${esc(p.brand)}</span>
      <p class="shop-card-name">${esc(p.name)}</p>
      <p class="shop-card-price"><strong>${cash(p)}</strong><span>예상 구매가</span></p>
      <p class="shop-card-tags"><span>${productOrigin(p) === 'jp' ? '일본반' : '한국반'}</span><span>${esc(p.sizeLabel)}</span></p>
      <p class="shop-card-date">${p.releaseDate ? `${esc(p.releaseDate.replaceAll('-', '.'))} 발매` : '발매일 확인 중'}</p>
    </div></a>`;
}

/** A single commerce listing in both browse/play shells. Catalog products and
 * verified retailer comparisons remain distinct; no inferred stock or discounts. */
export function renderStore(root: HTMLElement, products: Product[], artists: Artist[]) {
  listeners?.abort();
  listeners = new AbortController();
  const { signal } = listeners;
  const aliases = new Map(artists.map(a => [a.id, `${a.name} ${a.nameJa || ''} ${a.nameOriginal || ''} ${a.searchTerm || ''}`]));
  const header = `<header class="shop-heading"><h1>스토어</h1>
    <form class="shop-search" role="search" aria-label="스토어 상품 검색"><input id="shopQuery" type="search" autocomplete="off" aria-label="앨범·아티스트 검색" placeholder="앨범, 아티스트 검색" value="${esc(state.query)}"><button type="submit" aria-label="상품 검색">${icon('i-search', 'ic')}</button></form>
    <a class="shop-orders" href="#/orders">${icon('i-bag', 'ic')}<span>주문 내역</span></a></header>`;
  root.innerHTML = `<div class="commerce-store"><div class="shop-container">
    ${header}
    <nav class="shop-nav" aria-label="스토어 카테고리">${ORIGINS.map(o => `<button type="button" data-shop-origin="${o.key}" aria-pressed="${state.origin === o.key}">${o.name}</button>`).join('')}<a href="#/releases">발매·특전 비교 ${icon('i-chev-r', 'ic s')}</a></nav>
    <div class="shop-catalog">
      <details class="shop-refinements" id="shopFilters" open><summary>${icon('i-rows', 'ic')}<span>상세 필터</span><span id="shopFilterCount"></span>${icon('i-chev-r', 'ic s shop-down')}</summary>
        <div class="shop-filter-content"><div class="shop-filter-head"><button type="button" data-shop-reset>초기화</button></div>
          <fieldset><legend>앨범 유형</legend><div id="shopTypes"></div></fieldset>
          <fieldset><legend>아티스트</legend><label class="shop-artist-search">${icon('i-search', 'ic s')}<input id="shopArtistQuery" type="search" aria-label="필터에서 아티스트 찾기" placeholder="아티스트 찾기" autocomplete="off"></label><div id="shopArtists" class="shop-artist-list"></div></fieldset>
        </div></details>
      <section class="shop-inventory" aria-label="상품 목록">
        <div class="shop-results-bar"><span id="shopCount" role="status" aria-live="polite"></span><label class="shop-sort"><span class="shop-sr-only">상품 정렬</span><select id="shopSort" aria-label="상품 정렬"><option value="new">최신 발매순</option><option value="low">낮은 가격순</option><option value="high">높은 가격순</option><option value="name">상품명순</option></select></label></div>
        <div class="shop-applied" id="shopApplied" aria-label="적용한 필터"></div>
        <p class="shop-price-note" id="shopPriceNote" hidden>원화 환산 기준</p>
        <div class="shop-products" id="shopProducts"></div>
        <div class="shop-more"><p id="shopProgress"></p><button type="button" id="shopMore">상품 더보기 ${icon('i-chev-r', 'ic s shop-down')}</button></div>
      </section>
    </div>
    <details class="shop-policy"><summary>가격·이용 안내${icon('i-chev-r', 'ic s shop-down')}</summary><div><p>이 스토어는 구매 흐름을 체험하는 데모입니다. 실제 결제·배송은 이루어지지 않으며, 상품 이미지와 발매 정보는 Apple Music 카탈로그를 바탕으로 합니다.</p><p>CD 구매가는 현지 통상가 추정치에 환율·대행 수수료·배송 분담액을 더한 예상 비용으로, 실제 판매처 가격이나 재고를 보장하지 않습니다. 일본반은 한국 구매자 기준 원화, 한국반은 일본 구매자 기준 엔화입니다.</p><p>가격순 정렬은 각 상품에 저장된 환율로 원화 환산한 값 기준이며, 환산할 수 없는 상품은 뒤에 표시합니다. 상품 분류는 카탈로그의 곡 수와 제목 기준입니다. 사양·특전·판매처는 발매·특전 비교에서 확인할 수 있습니다.</p><a href="#/help">데이터 출처와 이용 안내 ${icon('i-chev-r', 'ic s')}</a></div></details>
  </div></div>`;
  const host = root.querySelector<HTMLElement>('.commerce-store')!;
  const el = <T extends HTMLElement = HTMLElement>(id: string) => host.querySelector<T>(`#${id}`)!;
  const filters = el<HTMLDetailsElement>('shopFilters');
  const mobile = window.matchMedia('(max-width: 760px)');
  filters.open = !mobile.matches;
  mobile.addEventListener('change', () => { filters.open = !mobile.matches; }, { signal });
  let artistQuery = '';

  function renderFacets() {
    const scope = products.filter(p => state.origin === 'all' || productOrigin(p) === state.origin);
    el('shopTypes').innerHTML = SIZES.map(s => `<label class="shop-radio"><input type="radio" name="shopSize" value="${s.key}" ${state.size === s.key ? 'checked' : ''}><span>${s.name}</span><small>${s.key === 'all' ? scope.length : scope.filter(p => p.size === s.key).length}</small></label>`).join('');
    const facets = artistFacets(products, state.origin).filter(([name]) => !artistQuery || smartMatch(name, artistQuery));
    el('shopArtists').innerHTML = `<label class="shop-radio"><input type="radio" name="shopArtist" value="all" ${state.artist === 'all' ? 'checked' : ''}><span>모든 아티스트</span></label>` + facets.map(([name, count]) => `<label class="shop-radio"><input type="radio" name="shopArtist" value="${esc(name)}" ${state.artist === name ? 'checked' : ''}><span>${esc(name)}</span><small>${count}</small></label>`).join('') + (!facets.length ? '<p class="shop-no-artist">일치하는 아티스트가 없습니다.</p>' : '');
  }
  function render() {
    const list = filterProducts(products, state, aliases), shown = visibleProducts(list, state);
    el('shopCount').textContent = `${list.length.toLocaleString()}개`;
    el('shopProducts').innerHTML = shown.length ? shown.map(productCard).join('') : `<div class="shop-empty">${icon('i-search', 'ic')}<p class="shop-empty-title">조건에 맞는 앨범이 없습니다</p><p>검색어를 바꾸거나 필터를 해제해 보세요.</p><button type="button" data-shop-reset>전체 앨범 보기</button></div>`;
    const chips = [state.origin !== 'all' ? ['origin', ORIGINS.find(o => o.key === state.origin)!.name] : null, state.size !== 'all' ? ['size', SIZES.find(s => s.key === state.size)!.name] : null, state.artist !== 'all' ? ['artist', state.artist] : null, state.query.trim() ? ['query', `검색: ${state.query.trim()}`] : null].filter(Boolean) as string[][];
    el('shopApplied').innerHTML = chips.map(([key, label]) => `<button type="button" data-shop-remove="${key}" aria-label="${esc(label)} 필터 해제">${esc(label)} ${icon('i-close', 'ic s')}</button>`).join('') + (chips.length ? '<button type="button" class="shop-reset-all" data-shop-reset>모두 초기화</button>' : '');
    el('shopApplied').hidden = chips.length === 0;
    el('shopFilterCount').textContent = chips.length ? String(chips.length) : '';
    el('shopPriceNote').hidden = state.sort !== 'low' && state.sort !== 'high';
    el('shopProgress').textContent = list.length ? `${shown.length} / ${list.length}개 상품` : '';
    el('shopMore').hidden = shown.length >= list.length;
    host.querySelectorAll<HTMLButtonElement>('[data-shop-origin]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.shopOrigin === state.origin)));
    el<HTMLSelectElement>('shopSort').value = state.sort;
  }
  function change(patch: Partial<Omit<StoreState, 'page'>>) {
    state = updateStoreState(state, patch);
    if (patch.origin !== undefined) { artistQuery = ''; el<HTMLInputElement>('shopArtistQuery').value = ''; }
    renderFacets(); render();
  }
  function reset() {
    state = initialStoreState(); artistQuery = '';
    el<HTMLInputElement>('shopQuery').value = ''; el<HTMLInputElement>('shopArtistQuery').value = '';
    renderFacets(); render();
  }
  host.addEventListener('click', e => {
    const target = (e.target as Element).closest<HTMLButtonElement>('button');
    if (!target) return;
    if (target.hasAttribute('data-shop-reset')) reset();
    if (target.dataset.shopOrigin) change({ origin: target.dataset.shopOrigin as StoreState['origin'] });
    const key = target.dataset.shopRemove;
    if (key === 'query') { el<HTMLInputElement>('shopQuery').value = ''; change({ query: '' }); }
    else if (key === 'origin' || key === 'size' || key === 'artist') change({ [key]: 'all' });
  }, { signal });
  host.addEventListener('change', e => {
    const target = e.target as HTMLInputElement;
    if (target.name === 'shopSize') change({ size: target.value as StoreState['size'] });
    if (target.name === 'shopArtist') change({ artist: target.value });
    if (target.name === 'shopSize' || target.name === 'shopArtist') {
      Array.from(host.querySelectorAll<HTMLInputElement>('input[type="radio"]')).find(input => input.name === target.name && input.value === target.value)?.focus({ preventScroll: true });
    }
  }, { signal });
  host.addEventListener('error', e => { if (e.target instanceof HTMLImageElement) e.target.hidden = true; }, { capture: true, signal });
  el<HTMLInputElement>('shopQuery').addEventListener('input', () => { if (!el<HTMLInputElement>('shopQuery').value) change({ query: '' }); }, { signal });
  host.querySelector('form')!.addEventListener('submit', e => { e.preventDefault(); change({ query: el<HTMLInputElement>('shopQuery').value }); }, { signal });
  el<HTMLInputElement>('shopArtistQuery').addEventListener('input', () => { artistQuery = el<HTMLInputElement>('shopArtistQuery').value; renderFacets(); }, { signal });
  el<HTMLSelectElement>('shopSort').addEventListener('change', () => change({ sort: el<HTMLSelectElement>('shopSort').value as StoreState['sort'] }), { signal });
  el('shopMore').addEventListener('click', () => { state.page++; render(); }, { signal });
  renderFacets(); render();
}
