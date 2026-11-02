import { safeExternal, bindSectionLink } from './_safety';
import { api } from '../../api';
import { state, buyerCurrency } from '../state';
import { t, getLocale } from '../i18n';
import { esc, icon, img, skeletonRows, errorState, emptyState, freshness, params, money, convert, fmtDay } from '../ui';
import { likeBtn, shareBtn, bindSocial, commentsHtml, bindComments, targetAdapter, releaseTarget } from '../social';
import { ct } from '../cm-i18n';
import { goodsCard, releaseCard, releaseFlowItem } from '../cards';
import { coverFlowHtml, bindCoverFlow } from '../fx';
import { offerLinkInfo } from '../assistance';
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
  root.innerHTML = `<div class="detail-goods">
    <section class="page-head"><h1>${t('g.title')}</h1></section>
    <form class="bigsearch" id="gForm" role="search">
      ${icon('i-search')}
      <input type="search" name="q" value="${esc(q)}" placeholder="${t(ed === 'jp' ? 'g.ph.jp' : 'g.ph.kr')}" autocomplete="off" aria-label="${t('g.title')}">
      <button class="btn btn-solid">${t('search.go')}</button>
    </form>
    <div id="gSuggest" class="chips suggest"></div>
    <div id="gBody"></div>
    <p class="method">${t('g.method')}</p></div>`;
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
      <div class="seg" role="group" id="gSort" aria-label="${esc(ed === 'jp' ? '並び順' : '정렬 기준')}">
        <button data-sort="rel" aria-pressed="true" class="on">${ed === 'jp' ? '関連順' : '관련순'}</button>
        <button data-sort="new" aria-pressed="false">${ed === 'jp' ? '新しい順' : '최신 발매순'}</button>
        <button data-sort="low" aria-pressed="false">${ed === 'jp' ? '安い順' : '낮은 가격순'}</button>
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
    body.querySelectorAll('[data-sort]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
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
  /* 최신 14장은 3D 커버 플로로, 나머지는 격자로 — 같은 앨범을 두 번 보여 주지 않는다 */
  const flow: Release[] = rel.items.length >= 5 ? rel.items.slice(0, 14) : [];
  const rest: Release[] = rel.items.slice(flow.length);
  body.innerHTML = `
    ${curated.length ? `<section class="sec"><div class="sec-head"><h2>${t('g.compare')}</h2></div><div class="grid-squares">${curated.map(releaseCard).join('')}</div></section>` : ''}
    <section class="sec"><div class="sec-head"><h2>${t('g.new')}</h2></div>${flow.length ? coverFlowHtml(flow.map(releaseFlowItem), t('g.new')) : ''}${rest.length ? `<div class="grid-squares${flow.length ? ' after-flow' : ''}">${rest.map(releaseCard).join('')}</div>` : flow.length ? '' : emptyState(t('empty.generic'))}</section>`;
  if (flow.length) bindCoverFlow(body, flow.map(releaseFlowItem));
}

/* 판매처·특전 비교 (사람이 확인한 발매) */
export async function renderRelease(root: HTMLElement, alive: () => boolean, id: string) {
  root.innerHTML = `<div class="sk sk-block"></div>`;
  let d: { release: Record<string, any>; comparison: { rows: Record<string, any>[]; priceFixed?: boolean; fx?: { jpyKrw: number } } };
  try {
    d = await api(`/api/store/releases/${encodeURIComponent(id)}?buyer=${state.edition==='jp'?'jp':'kr'}`);
  } catch {
    if (!alive()) return;
    root.innerHTML = emptyState(t('err.generic'));
    return;
  }
  if (!alive()) return;
  const r = d.release;
  const rows = d.comparison?.rows || [];
  const ja = getLocale() === 'ja';
  const tg = releaseTarget({ id, title: r.title, artist: r.artist, artistId: r.artistId, artwork: r.artwork, releaseDate: r.releaseDate, type: r.type, country: r.country, tier: '' } as never);
  const editions = Array.isArray(r.editions) ? r.editions : [];
  const offers = [...new Map(rows.filter(o=>safeExternal(o.url)).map(o=>[o.offerId || o.url,o])).values()];
  const help = (o:Record<string,any>) => '#/assist?kind=purchase&url='+encodeURIComponent(safeExternal(o.url))+'&artist='+encodeURIComponent(r.artist||'')+'&title='+encodeURIComponent(r.title||'');
  const ended = r.campaign?.storeClosesAt && Date.parse(r.campaign.storeClosesAt+'T23:59:59+09:00') < Date.now();
  /* What each store link really opens (product page of one edition / list / store front), from the URL + this release's catalog numbers only. */
  const catalogs = editions.map((e:any)=>e.catalogNo).filter(Boolean).join(' · ');
  const editionLinks = (o:Record<string,any>) => {
    const seen = new Set<string>();
    return rows.filter(x => (x.offerId || x.url) === (o.offerId || o.url) && safeExternal(x.url)).map(x => ({ x, info: offerLinkInfo(x.url, editions) }))
      .filter(({ x, info }) => info.kind === 'product' && info.edition && String(info.edition.catalogNo || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase() === String(x.catalogNo || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase() && !seen.has(x.url) && seen.add(x.url))
      .map(({ x, info }) => ({ url: safeExternal(x.url), catalogNo: info.edition!.catalogNo, label: info.edition!.label || '' }));
  };
  const linkNote = (o:Record<string,any>) => {
    const info = offerLinkInfo(o.url, editions);
    const norm = (x:unknown) => String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
    /* 같은 판매처의 다른 판형 행이 이 품번 상품 링크를 그대로 쓰면(수집 데이터 오류) 그 판형들을 밝힌다 */
    const wrong = info.kind === 'product' && info.edition ? rows.filter(x => (x.offerId || x.url) === (o.offerId || o.url) && x.url === o.url && x.catalogNo && norm(x.catalogNo) !== norm(info.edition!.catalogNo)) : [];
    if (wrong.length) return { label: ja?'販売店の商品ページ':'판매처 상품 페이지', note: ja?`注意: このリンクは品番 ${info.edition!.catalogNo}（${info.edition!.label||''}）のページです。${wrong.map(x=>x.catalogNo).join('・')} は別の商品です。`:`주의: 이 링크는 품번 ${info.edition!.catalogNo} · ${info.edition!.label||''} 페이지입니다. ${wrong.map(x=>x.catalogNo).join(' · ')}는 다른 상품이니 판매처에서 품번을 확인하세요.`, mismatch: true };
    if (info.kind === 'product' && info.edition) return { label: ja?'販売店の商品ページ':'판매처 상품 페이지', note: ja?`このリンクは品番 ${info.edition.catalogNo}（${info.edition.label||''}）の商品ページです。他の仕様は販売店で別に選んでください。`:`이 링크는 품번 ${info.edition.catalogNo} · ${info.edition.label||''} 상품 페이지입니다. 다른 판형은 판매처에서 따로 고르세요.` };
    if (info.kind === 'home') return { label: ja?'販売店トップ':'판매처 첫 화면', note: (ja?'商品ページではなく販売店のトップにつながります。':'상품 페이지가 아니라 판매처 첫 화면으로 연결됩니다.') + (catalogs ? (ja?` 品番で検索してください: ${catalogs}`:` 판매처에서 품번으로 찾으세요: ${catalogs}`) : '') };
    if (info.kind === 'listing') return { label: ja?'販売店の一覧ページ':'판매처 목록 페이지', note: (ja?'商品ページではなくアーティスト・一覧ページにつながります。':'상품 페이지가 아니라 아티스트·목록 페이지로 연결됩니다.') + (catalogs ? (ja?` 品番: ${catalogs}`:` 원하는 판형의 품번으로 찾으세요: ${catalogs}`) : (ja?' 仕様名で探してください。':' 원하는 판형 이름으로 찾으세요.')) };
    return { label: ja?'販売店の原文':'판매처 원문', note: ja?'このリンクと選択仕様の一致は、商品ページで確認してください。':'연결된 상품과 원하는 판형이 일치하는지 원문에서 확인하세요.' };
  };
  root.innerHTML = `<div class="detail-release">
    <section class="rel-head rel-guide-head">
      <figure data-content-original-label>${img(r.artwork, r.title, 'square', {ratio:'1/1',initial:r.artist})}<figcaption>${ja?'アルバムカバー。販売店の商品写真・特典画像とは異なります。':'앨범 커버입니다. 판매처의 실물 구성·특전 사진과 구분합니다.'}</figcaption></figure>
      <div><p class="kicker">${esc(ja?r.artist:r.artistKo||r.artist)}</p><h1 data-content-original-work translate="no">${esc(r.title)}</h1><p class="muted">${esc(fmtDay(r.releaseDate,{year:true}))} ${t('g.release')}</p>
      <p class="rel-purpose">${ja?'写真と仕様を確認してから、販売店ごとの購入手順・入力サポートへ。':'사진과 판형을 확인하고, 판매처별 구매 절차·입력 도움으로 이어가세요.'}</p>
      <section class="detail-decision"><h2>${ja?'購入前に確認':'구매 전 확인'}</h2><p>${ja?'仕様と品番を選び、販売店の現行価格・送料・特典を原文で確認します。決済は販売店で行います。':'판형과 품번을 고른 뒤 판매처 원문에서 현재 가격·배송비·특전을 확인하세요. 결제는 판매처에서 합니다.'}</p><nav class="detail-next-actions" aria-label="${ja?'購入の確認順':'구매 확인 순서'}"><a href="#relEditions" data-release-scroll>${ja?'1. 仕様を比較':'1. 판형 비교'}</a><a href="#relStores" data-release-scroll>${ja?'2. 販売店を確認':'2. 판매처 확인'}</a></nav></section>
      <div class="rel-soc">${likeBtn(tg,'is-box')}${shareBtn(null,'#/release/'+encodeURIComponent(id),r.title+' · '+r.artist,'is-box')}<a class="soc-btn is-box" href="#relTalk">${icon('i-comment')}<span>${ct('soc.cmt')}</span></a></div>
      ${r.campaign?`<div class="rel-campaign ${ended?'is-ended':''}"><b>${ended?(ja?'終了した予約キャンペーン':'종료된 예약 캠페인'):(ja?'収集したキャンペーン案内':'수집된 캠페인 안내')} · ${esc(r.campaign.name)}</b><p>${esc(r.campaign.desc)}</p><small>${esc(r.campaign.storeOpensAt)} – ${esc(r.campaign.storeClosesAt)}${ended?' · '+(ja?'現在の購入特典ではありません':'현재 구매 특전이 아닙니다'):''}</small></div>`:''}
      <p class="rel-provenance">${t('src')}: <a href="${esc(safeExternal(r.source?.url))}" target="_blank" rel="noopener">${esc(r.source?.name)}</a> · ${esc(r.source?.collectedAt||'')}</p></div>
    </section>
    <section class="sec" id="relEditions"><div class="sec-head"><h2>${ja?'どの仕様を買う？':'어떤 판형을 살까요?'}</h2></div><div class="rel-edition-grid">${editions.map((e:any)=>`<article><div class="rel-edition-photo" data-edition-photo="${esc(e.id)}"></div><h3>${esc(e.label)}</h3><p>${esc(e.catalogNo||'')}</p><strong>${e.listPrice != null ? money(e.listPrice,e.listCurrency||r.currency) : (ja?'価格は原文確認':'가격은 원문 확인')}</strong><ul>${(e.includes||[]).map((x:string)=>`<li>${esc(x)}</li>`).join('')}</ul><small>${ja?'各仕様の実物写真は販売店の原文から確認します。':'판형별 실제 구성 사진은 판매처 원문에서 확인합니다.'}</small></article>`).join('')}</div></section>
    <section class="sec" id="relStores"><div class="sec-head"><h2>${ja?'販売店別の購入サポート':'판매처별 구매 도움'}</h2></div><p class="rel-store-note">${ja?'過去に収集した配送・特典情報と、今読み取った原文を区別して確認します。会員登録・配送先・支払い方法は店舗ごとに異なります。':'기존에 수집된 배송·특전 정보와 지금 읽은 원문을 구분해 확인합니다. 회원가입·배송지·결제 방법은 판매처마다 다릅니다.'}</p><div class="rel-offer-grid">${offers.map((o,i)=>`<article class="rel-offer" data-offer="${i}"><a class="rel-offer-photo" href="${help(o)}"><div data-offer-image="${i}" class="rel-photo-pending">${o.image?img(o.image,o.store+' · '+r.title,'square',{ratio:'1/1',initial:o.store}):`<span>${ja?'商品画像は原文確認後に表示':'상품 사진은 원문 확인 후 표시'}</span>`}</div></a><div class="rel-offer-body"><h3>${esc(ja?o.store:o.storeKo||o.store)}</h3><p>${esc(o.offerNote||'')}</p><dl><dt>${ja?'収集した特典':'수집된 특전'}</dt><dd>${esc((ja?o.bonusJa:o.bonus)||(ja?'未確認':'미확인'))}${ended?' · '+(ja?'過去の案内':'과거 안내'):''}</dd><dt>${ja?'配送の記録':'배송 정보 기록'}</dt><dd>${o.shipsDirect === true?(ja?'直送対応の記録あり':'직배송 가능 기록 있음'):o.shipsDirect === false?(ja?'直送不可・代行の記録あり':'직배송 불가·대행 필요 기록 있음'):(ja?'配送条件は未確認':'배송 조건 미확인')} · ${ja?'現在の条件は要確認':'현재 조건 재확인 필요'}</dd></dl>${editionLinks(o).length > 1 ? `<p class="rel-match-note" data-link-kind="per-edition">${ja?'仕様ごとの商品ページ（品番を公式ページで確認）':'판형별 상품 페이지(품번은 공식 페이지에서 확인)'}</p><ul class="rel-edition-links">${editionLinks(o).map(x => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.catalogNo || '')} · ${esc(x.label)}${icon('i-ext','ic xs')}</a></li>`).join('')}</ul>` : `<p class="rel-match-note" data-link-kind="${linkNote(o).mismatch ? 'mismatch' : offerLinkInfo(o.url, editions).kind}">${esc(linkNote(o).note)}</p>`}<a class="rel-help-action" href="${help(o)}">${ja?'写真・購入手順・入力欄を確認':'사진·구매 절차·입력란 확인'}${icon('i-chev-r','ic xs')}</a><a class="rel-original" href="${esc(safeExternal(o.url))}" target="_blank" rel="noopener">${esc(linkNote(o).label)}${icon('i-ext','ic xs')}</a></div></article>`).join('')}</div>${!offers.length?emptyState(ja?'確認済みの販売店はまだありません。':'확인된 판매처가 아직 없습니다.'):''}</section>
    <section class="sec" id="relTalk"><div class="sec-head"><h2>${ct('rel.talk')}</h2></div>${commentsHtml()}</section></div>`;
  // A bounded read of up to two actual product pages. No homepage/logo substituted for product photography.
  void Promise.all(offers.map((o,i)=>({o,i})).filter(({o})=>{try{return /\/(?:products?|goods|item|iteminfo)(?:\/|\.|$)/i.test(new URL(o.url).pathname);}catch{return false;}}).slice(0,2).map(async({o,i})=>{
    const info=await api('/api/live/assistance?kind=purchase&url='+encodeURIComponent(o.url)).catch(()=>null);
    if(!alive())return;
    const box=root.querySelector<HTMLElement>('[data-offer-image="'+i+'"]');
    const photo=(info?.images||[]).find((x:any)=>x.kind==='jsonld'&&safeExternal(x.url)) || (info?.images||[]).find((x:any)=>x.kind==='img'&&safeExternal(x.url));
    if(box&&photo)box.innerHTML=img(photo.url,o.store+' · '+r.title,'square',{ratio:'1/1',initial:o.store})+'<small>'+esc(ja?'販売店原文で見つかった画像・仕様は原文を確認':'판매처 원문에서 찾은 이미지 · 판형은 원문 확인')+'</small>';
    // Catalog-number-bound links were actually discovered on the official product page.
    for(const ed of (info?.editionSources||[]).slice(0,5)){
      if(!alive())break;
      const observed=await api('/api/live/assistance?kind=purchase&view=images&url='+encodeURIComponent(ed.url)).catch(()=>null);
      if(!alive())return;
      const picture=(observed?.images||[]).find((x:any)=>x.kind==='jsonld'&&safeExternal(x.url));
      const target=Array.from(root.querySelectorAll<HTMLElement>('[data-edition-photo]')).find(el=>el.dataset.editionPhoto===ed.editionId);
      if(target&&picture)target.innerHTML=img(picture.url,r.title,'square',{ratio:'1/1',initial:r.artist})+'<small>'+esc(ja?'公式商品ページで取得した画像':'공식 상품 페이지에서 수집한 이미지')+'</small>';
    }
  }));
  root.querySelectorAll<HTMLAnchorElement>('[data-release-scroll]').forEach(link => bindSectionLink(link, root.querySelector(link.getAttribute('href')!)));
  bindSectionLink(root.querySelector('a[href="#relTalk"]'), root.querySelector('#relTalk'));
  void bindSocial(root);
  void bindComments(root.querySelector<HTMLElement>('#relTalk .cmts')!, targetAdapter(tg));
}
