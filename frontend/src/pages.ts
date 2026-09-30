import { api, findCatalog, artUrl, esc, icon, me, refreshMe, setToken, needsLogin } from './api';
import { smartMatch } from './koja';
import { renderMusicHome, renderMusicChart } from './discovery';
import type { Artist, SeedTrack, Ev, Product, CatalogTrack, PlayableTrack } from './api';
import { playQueue, openYt, toast, enqueue, openPlaylistPicker, askName, askConfirm } from './player';
import { applyTone } from './colors';
import { openContextMenu, bindTilt, bindDragReorder } from './interactions';
import { renderStore } from './store';
import { t } from './i18n';

/* ---- 스켈레톤 ---- */
const skRows = (n = 6) => `<div class="sk-list">${Array.from({ length: n }, () => `
  <div class="sk-row"><span class="sk sk-n"></span><span class="sk sk-art"></span>
  <span class="sk-tt"><span class="sk sk-l1"></span><span class="sk sk-l2"></span></span></div>`).join('')}</div>`;
const skCards = (n = 6, round = false) => `<div class="shelf d3-stage">${Array.from({ length: n }, () => `
  <div class="card"><div class="cover sk ${round ? 'rd' : ''}"></div>
  <span class="sk sk-l1" style="margin-top:11px"></span><span class="sk sk-l2"></span></div>`).join('')}</div>`;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const root = () => $('#page');
let artists: Artist[] = [];
let seeds: SeedTrack[] = [];
let events: Ev[] = [];
let products: Product[] = [];
export async function loadData() {
  [artists, seeds, events, products] = await Promise.all([
    api('/api/db/artists'), api('/api/db/tracks'), api('/api/db/events'), api('/api/db/products'),
  ]);
}

const toPlayable = (c: CatalogTrack, yt?: string | null): PlayableTrack =>
  ({ title: c.title, artist: c.artist, album: c.album, artwork: artUrl(c, 200), preview: c.preview, youtubeId: yt, durationMs: c.durationMs });
const dur = (ms?: number) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}` : '0:30');

/** 일정 제목 — 대부분 "아티스트 · 제목" 형태로 들어와 아티스트가 두 번 나온다.
 *  제목이 이미 아티스트로 시작하면 그 부분을 떼고, 아티스트는 따로 한 줄로 둔다. */
function schTitle(e: { artist: string; title: string }) {
  const t = e.title.trim();
  const a = e.artist.trim();
  if (a && t.toLowerCase().startsWith(a.toLowerCase())) {
    return t.slice(a.length).replace(/^[\s·・\-–—:]+/, '') || t;
  }
  return t;
}

function dday(date: string) {
  const d = Math.ceil((new Date(date).getTime() - Date.now()) / 864e5);
  return { d, txt: d > 0 ? `D-${d}` : d === 0 ? 'D-DAY' : '종료' };
}
function relDate(iso?: string) {
  if (!iso) return '·';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? '오늘' : d === 1 ? '어제' : d < 30 ? `${d}일 전` : new Date(iso).toLocaleDateString();
}

/* ============ 공용: 스포티파이식 트랙 테이블 ============ */
function trackTable(rows: PlayableTrack[], opts: { date?: boolean; album?: boolean; sticky?: boolean } = { date: true, album: true }) {
  return `
  <div class="sp-table ${opts.album === false ? 'no-al' : ''} ${opts.date === false ? 'no-dt' : ''} ${opts.sticky ? 'sticky' : ''}">
    <div class="t-head">
      <span class="t-num">#</span><span>제목</span>
      ${opts.album === false ? '' : '<span class="t-al">앨범</span>'}
      ${opts.date === false ? '' : '<span class="t-dt">추가한 날짜</span>'}
      <span class="t-du">${icon('i-clock', 'ic s')}</span>
    </div>
    ${rows.map((r, i) => `
    <div class="t-row" data-i="${i}" draggable="false">
      <span class="t-num"><span class="n">${i + 1}</span><span class="p">${icon('i-play')}</span></span>
      <span class="t-title"><img src="${esc(r.artwork || '')}" loading="lazy" alt=""/><span class="tt"><b>${esc(r.title)}</b><i>${esc(r.artist)}</i></span></span>
      ${opts.album === false ? '' : `<span class="t-al">${esc(r.album || '·')}</span>`}
      ${opts.date === false ? '' : `<span class="t-dt">${relDate(r.addedAt)}</span>`}
      <span class="t-du">${dur(r.durationMs)}</span>
      <span class="t-acts">
        <button class="t-a" data-like="${i}" title="좋아요">${icon('i-heart')}</button>
        <button class="t-a" data-more="${i}" title="더보기">${icon('i-grip')}</button>
      </span>
    </div>`).join('')}
  </div>`;
}
function bindTable(
  container: HTMLElement, rows: PlayableTrack[], onRemove?: (i: number) => void,
  extra?: { onReorder?: (from: number, to: number) => void; onMenu?: (i: number, e: MouseEvent) => void },
) {
  container.querySelectorAll<HTMLElement>('.t-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.t-x, .t-a')) return;
      playQueue(rows, Number(row.dataset.i));
      container.querySelectorAll('.t-row').forEach((r) => { r.classList.remove('playing'); r.querySelector('.eq-slot')?.remove(); });
      row.classList.add('playing');
      row.querySelector('.t-num')!.insertAdjacentHTML('beforeend', `<span class="eq-slot"><span class="np-eq"><i></i><i></i><i></i></span></span>`);
    });
    row.querySelector('[data-like]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tr = rows[Number(row.dataset.i)];
      if (needsLogin('좋아요')) return;
      await api('/api/likes', { method: 'POST', body: JSON.stringify({ track: { title: tr.title, artist: tr.artist, album: tr.album, artwork: tr.artwork, preview: tr.preview, durationMs: tr.durationMs } }) }).catch(() => null);
      (e.currentTarget as HTMLElement).classList.toggle('on');
      toast('좋아요를 업데이트했습니다');
    });
    const menuHandler = (e: MouseEvent) => {
      e.preventDefault(); e.stopPropagation();
      const i = Number(row.dataset.i);
      if (extra?.onMenu) return extra.onMenu(i, e);
      const tr = rows[i];
      openContextMenu(e.clientX, e.clientY, [
        { label: '지금 재생', icon: 'i-play', run: () => playQueue(rows, i) },
        { label: '대기열에 추가', icon: 'i-queue', run: () => enqueue(tr) },
        { label: t('player.addPl'), icon: 'i-plus', run: () => void openPlaylistPicker(tr) },
      ]);
    };
    row.addEventListener('contextmenu', menuHandler);
    row.querySelector('[data-more]')?.addEventListener('click', (e) => menuHandler(e as MouseEvent));
    if (onRemove) {
      row.querySelector('.t-acts')!.insertAdjacentHTML('beforeend', `<button class="t-a t-x" title="삭제">${icon('i-close')}</button>`);
      row.querySelector('.t-x')!.addEventListener('click', (e) => { e.stopPropagation(); onRemove(Number(row.dataset.i)); });
    }
  });
  if (extra?.onReorder) bindDragReorder(container, extra.onReorder, '.t-row[data-i]');
}

/* ============ 공용: 카드 셸프 ============ */
function shelf(cards: { title: string; sub: string; art?: string; round?: boolean; href: string; term?: string }[]) {
  return `<div class="shelf d3-stage">${cards.map((c) => `
    <a class="card ${c.round ? 'round' : ''}" href="${c.href}" data-term="${esc(c.term || '')}" data-expand>
      <div class="cover">${c.art ? `<img src="${c.art}" alt="" loading="lazy"/>` : `<div class="ph">${esc(c.title[0] || '?')}</div>`}
        <span class="glare"></span>
        <span class="hover-play" aria-hidden="true">${icon(c.round ? 'i-chev-r' : 'i-play')}</span></div>
      <div class="c-title">${esc(c.title)}</div><div class="c-sub">${esc(c.sub)}</div>
    </a>`).join('')}</div>`;
}
function fillShelfArts(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('.card[data-term]').forEach(async (el) => {
    if (!el.dataset.term || el.querySelector('.cover img')) return;
    const hit = await findCatalog(el.dataset.term);
    if (hit) el.querySelector('.cover')!.insertAdjacentHTML('afterbegin', `<img src="${artUrl(hit, 300)}" alt="" loading="lazy"/>`);
  });
}

/* ============ 공용: 랭킹 리스트 (차트/아티스트 인기곡) ============ */
function rankList(list: { rank: number; title: string; artist: string; artwork?: string; ytViews?: number; sources?: string[]; tag?: string; youtubeId?: string | null }[], opts: { big?: boolean } = {}) {
  return `<div class="rank-list ${opts.big ? 'big' : ''}">${list.map((e) => `
    <div class="rk-row" data-i="${e.rank - 1}" tabindex="0" role="group" aria-label="${esc(e.title)} 미리듣기">
      <span class="rk-n">${e.rank}</span>
      <div class="rk-art">${e.artwork ? `<img src="${e.artwork}" loading="lazy" alt=""/>` : ''}<span class="rk-ov">${icon('i-play')}</span></div>
      <div class="rk-meta"><div class="rk-t">${esc(e.title)}</div><div class="rk-a">${esc(e.artist)}</div></div>
      <div class="rk-side">
        ${e.tag ? `<span class="rk-tag">${esc(e.tag)}</span>` : ''}
        ${e.ytViews ? `<span class="rk-views">${e.ytViews >= 1e8 ? (e.ytViews / 1e8).toFixed(1) + '억' : e.ytViews >= 1e4 ? Math.round(e.ytViews / 1e4).toLocaleString() + '만' : e.ytViews.toLocaleString()}회</span>` : ''}
        ${e.sources ? `<span class="rk-src">${e.sources.map((s) => `<i class="src-dot ${s}"></i>`).join('')}</span>` : ''}
        ${e.youtubeId ? `<button class="rk-mv" data-yt="${e.youtubeId}" title="${t('mv')}">${icon('i-ext')}</button>` : ''}
      </div>
    </div>`).join('')}</div>`;
}
function bindRank(container: HTMLElement, entries: { title: string; artist: string; artwork?: string; searchTerm?: string; youtubeId?: string | null }[]) {
  container.querySelectorAll<HTMLElement>('.rk-row').forEach((row) => row.addEventListener('keydown', (event) => { if(event.target === row && (event.key === 'Enter' || event.key === ' ')) {event.preventDefault(); row.click();} }));
  container.querySelectorAll<HTMLButtonElement>('.rk-mv').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); openYt(b.dataset.yt!); }));
  container.querySelectorAll<HTMLElement>('.rk-row').forEach((row) =>
    row.addEventListener('click', async (e) => {
      // MV 버튼과 소스 요약 칩은 행 재생과 다른 동작이다
      if ((e.target as HTMLElement).closest('.rk-mv, .rk-srcn')) return;
      const i = Number(row.dataset.i);

      /* 클릭한 곡부터 바로 튼다.
         예전에는 목록 전체(최대 100곡)의 카탈로그를 다 찾은 뒤 재생해서
         클릭 후 7초 넘게 무반응이었다. 지금은:
         1) 클릭한 곡 하나만 찾아 즉시 재생
         2) 나머지는 뒤에서 채워 큐를 완성 */
      container.querySelectorAll('.rk-row').forEach((r) => r.classList.remove('playing'));
      row.classList.add('playing');

      const asTrack = (en: typeof entries[number], hit: CatalogTrack | null): PlayableTrack =>
        hit ? toPlayable(hit, en.youtubeId) : { title: en.title, artist: en.artist, artwork: en.artwork };

      const clicked = entries[i];
      const first = await findCatalog(clicked.searchTerm || `${clicked.artist} ${clicked.title}`);
      // 우선 클릭한 곡 하나로 재생을 시작한다
      playQueue([asTrack(clicked, first)], 0, 'chart');

      // 이어서 주변 곡(앞뒤 20곡)만 큐로 채운다 — 100곡 전부는 과하다
      const from = Math.max(0, i - 5);
      const slice = entries.slice(from, from + 25);
      const hits = await Promise.all(slice.map((en) => findCatalog(en.searchTerm || `${en.artist} ${en.title}`).catch(() => null)));
      // 사용자가 그 사이 다른 곡을 틀지 않았을 때만 큐를 확장한다
      if (row.classList.contains('playing')) {
        playQueue(slice.map((en, k) => asTrack(en, hits[k])), i - from, 'chart');
      }
    }));
}

/* ============ 공용: 상품 카드 ============ */
function fillEventArts(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('[data-artist]').forEach((el) => {
    const a = artists.find((x) => x.name === el.dataset.artist);
    if (a) findCatalog(a.searchTerm).then((hit) => { if (hit) el.style.backgroundImage = `url(${artUrl(hit, 600)})`; });
  });
}

// The listening-first surface is shared by browse and play shells.
export async function pageHome() { await renderMusicHome(root(), { artists, products }); }
export async function pageChart(sub?: string) { await renderMusicChart(root(), { artists, products }, sub); }

/* ================= 스토어 (BM: 일본 내수반 정식 공동구매) ================= */
/** 구매자 통화에 맞춰 표기 — 한국 구매자는 원, 일본 구매자는 엔 */
/** 아티스트 보조 표기 — 일본 팀은 원표기, 한국 팀은 로마자를 쓴다 (없으면 빈 문자열) */
/** 수집 데이터에 저장된 아트워크(600px)를 표시 크기에 맞게 줄인다 */
const sized = (url?: string | null, size = 300) => artUrl({ artwork: url || undefined }, size);

const artistSub = (a: Artist) => a.nameJa || a.nameOriginal || (a.searchTerm !== a.name ? a.searchTerm : '') || '';
/** 국가 라벨 */
const countryLabel = (c?: string) => (c === 'kr' ? '한국' : '일본');
/** 주문의 구매자 통화 — 한국반 주문은 엔, 일본반 주문은 원.
 *  신규 주문은 최상위 buyerCurrency, 과거 주문은 breakdown에서 유추한다. */
const orderCur = (o: { buyerCurrency?: string; breakdown?: { buyerCurrency?: string; localCurrency?: string } | null }) =>
  ((o.buyerCurrency ?? o.breakdown?.buyerCurrency)
    ?? (o.breakdown?.localCurrency === 'KRW' ? 'JPY' : 'KRW')) as 'KRW' | 'JPY';

const money = (n: number, cur?: string) => (cur === 'JPY' ? `¥${n.toLocaleString()}` : `₩${n.toLocaleString()}`);
function productCard(p: Product) {
  /* 반(한정반/통상반)과 잔여 수량은 아트워크 위에 칩으로 얹지 않는다.
     글자는 글자 영역에 둔다. 원산지와 같은 줄에 놓으면 '어느 나라 판을
     어떤 조건으로 사는가'가 한 눈에 읽힌다. 잔여는 살지 말지를 가르는
     정보라 가격 바로 아래 둔다. */

  return `<a class="p-card d3-tilt" href="#/store/${p.id}" data-d3-tilt="7" data-d3="rise">
    <div class="p-img">
      <img src="${esc(sized(p.artwork, 300))}" alt="" loading="lazy" decoding="async"/>
    </div>
    <div class="p-brand">
      <span class="p-flag ${p.origin === 'kr' ? 'kr' : 'jp'}">${p.origin === 'kr' ? '한국반' : '일본반'}</span>
      <span class="p-ed">${esc(p.badge)}</span>
      <span class="p-bn">${esc(p.brand)}</span>
    </div>
    <div class="p-name">${esc(p.name)}</div>
    <div class="p-price">${money(p.price, p.priceCurrency)}</div>
    <div class="p-sub">${esc(p.releaseDate?.slice(0, 4) || '')} · ${p.trackCount}곡</div>
  </a>`;
}

export async function pageStore() {
  renderStore(root(), products, artists);
}

export async function pageProduct(id: string) {
  const p = products.find((x) => x.id === id);
  if (!p) return page404();
  const artist = artists.find((a) => a.id === p.artistId);
  let edIdx = 0;

  root().innerHTML = `
    <div class="store-wrap page-top full"><div class="store-inner product">
      <a class="crumb" href="#/store">${icon('i-chev-r', 'ic s flip')} ${t('store.title')}</a>
      <div class="pd-grid">
        <div class="pd-img"><img src="${esc(sized(p.artwork, 560))}" alt="" decoding="async"/></div>
        <div class="pd-info">
          <p class="p-brand"><span class="p-ed">${esc(p.badge)}</span><span class="p-bn">${esc(p.brand)} · ${esc(p.sizeLabel)}</span></p>
          <h1 class="pd-name">${esc(p.name)}</h1>
          <p class="pd-meta-line">${esc(p.releaseDate)} 발매 · ${p.trackCount}곡</p>
          <p class="pd-price" id="pdPrice">${money(p.editions[0].pricing.total, p.priceCurrency)}</p>
          <div class="pd-ed" id="pdEd">
            ${p.editions.map((e, i) => `
              <button class="ed ${i === 0 ? 'on' : ''}" data-e="${i}">
                <span class="ed-label">${esc(e.label)}${e.real
                  ? ' <span class="src-badge real">Apple 실정가</span>'
                  /* 확인 못 한 값을 확인한 값처럼 보이게 두면 안 된다.
                     상세 표 안쪽에만 적어두면 한눈에는 진짜 가격처럼 읽힌다. */
                  : ' <span class="src-badge demo">추정가</span>'}</span>
                <span class="ed-price">${money(e.pricing.total, e.pricing.buyerCurrency ?? p.priceCurrency)}</span>
                <span class="ed-jpy">현지 정가 ${e.localCurrency === 'KRW' || p.origin === 'kr' ? '₩' : '¥'}${(e.amount ?? e.jpy ?? 0).toLocaleString()}</span>
              </button>`).join('')}
          </div>
          <div class="pd-row"><span>${t('store.qty')}</span><input id="pdQty" type="number" min="1" max="5" value="1" /></div>
          <div class="pd-actions">
            <button class="btn-buy" id="pdOrder">${t('store.reserve')}</button>
            <a class="btn-out" href="${p.appleUrl}" target="_blank" rel="noopener">Apple Music ${icon('i-ext', 'ic s')}</a>
            ${(p.shopUrl || p.towerUrl) ? `<a class="btn-out" href="${esc(p.shopUrl || p.towerUrl || '')}" target="_blank" rel="noopener">${esc(p.shopLabel || t('store.tower'))} ${icon('i-ext', 'ic s')}</a>` : ''}
          </div>
          <div class="pd-calc" id="pdCalc"></div>
        </div>
      </div>

      <div class="pd-tabs" id="pdTabs">
        <button class="pd-tab on" data-p="info">상품 정보</button>
        <button class="pd-tab" data-p="ship">배송 · 교환</button>
        <button class="pd-tab" data-p="op">판매자 정보</button>
      </div>
      <div class="pd-panel" id="pdPanel"></div>

      ${artist ? `<div class="sec-head pd-sec"><h2 class="dark-h">${esc(artist.name)}의 다른 상품</h2></div><div class="store-grid" id="pdRelated"></div>` : ''}
    </div></div>`;

  const paintPrice = () => {
    const e = p.editions[edIdx];
    $('#pdPrice').textContent = money(e.pricing.total, e.pricing.buyerCurrency ?? p.priceCurrency);
    $('#pdCalc').innerHTML = `
      <p class="calc-title">가격은 이렇게 계산됩니다 ${e.digital ? '<span class="calc-note">디지털 상품은 배송비가 없지만 데모에서는 동일 공식을 적용합니다</span>' : ''}</p>
      <table class="calc-table"><tbody>
        <tr><th>현지 정가</th><td>${p.origin === 'kr' ? '₩' : '¥'}${(e.amount ?? e.jpy ?? 0).toLocaleString()}</td><td class="calc-src">${e.real ? 'Apple Music 실데이터' : `${p.origin === 'kr' ? '한국' : '일본'} CD 시장 통상가 기준 추정`}</td></tr>
        <tr><th>적용 환율</th><td>× ${e.pricing.rate}</td><td class="calc-src">${esc(p.rateDate)} ${p.rateLive ? '실시간' : '캐시'}</td></tr>
        <tr><th>상품 원가</th><td>${money(e.pricing.base, e.pricing.buyerCurrency ?? p.priceCurrency)}</td><td class="calc-src"></td></tr>
        <tr><th>대행 수수료</th><td>+ ${money(e.pricing.fee, e.pricing.buyerCurrency ?? p.priceCurrency)}</td><td class="calc-src">${Math.round(e.pricing.feeRate * 100)}% (Lilac 마진)</td></tr>
        <tr><th>국제배송 분담</th><td>+ ${money(e.pricing.shipping, e.pricing.buyerCurrency ?? p.priceCurrency)}</td><td class="calc-src">합배송 기준</td></tr>
        <tr class="calc-total"><th>최종 판매가</th><td>${money(e.pricing.total, e.pricing.buyerCurrency ?? p.priceCurrency)}</td><td class="calc-src">100원 단위 올림</td></tr>
      </tbody></table>`;
  };
  paintPrice();
  $('#pdEd').querySelectorAll<HTMLButtonElement>('.ed').forEach((b) =>
    b.addEventListener('click', () => {
      edIdx = Number(b.dataset.e);
      $('#pdEd').querySelectorAll('.ed').forEach((x) => x.classList.remove('on'));
      b.classList.add('on'); paintPrice();
    }));

  $('#pdOrder').addEventListener('click', async () => {
    try {
      const r = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ productId: p.id, option: p.editions[edIdx].label, qty: Number(($('#pdQty') as HTMLInputElement).value) }),
      });
      toast(`주문 완료 ${r.order.id} · 잔여 크레딧 ${r.credits.toLocaleString()}`);
      await refreshMe(); document.dispatchEvent(new CustomEvent('lilac:me'));
    } catch (e) { toast((e as Error).message); if ((e as Error).message.includes('로그인')) location.hash = '#/login'; }
  });

  const panels: Record<string, string> = {
    info: `<p>${esc(p.desc)}</p>
      <table class="pd-spec"><tbody>
        <tr><th>상품명</th><td>${esc(p.name)}</td></tr>
        <tr><th>아티스트</th><td>${esc(p.brand)}</td></tr>
        <tr><th>발매일</th><td>${esc(p.releaseDate)} <span class="src-badge real">Apple 실데이터</span></td></tr>
        <tr><th>수록곡 수</th><td>${p.trackCount}곡</td></tr>
        <tr><th>구성</th><td>${p.editions.map((e) => esc(e.label)).join(' / ')}</td></tr>
        ${p.operator ? `<tr><th>공식 운영사</th><td>${esc(p.operator)}</td></tr>` : ''}
        <tr><th>재고</th><td class="calc-src">판매처에서 확인해야 합니다 — 라일락은 재고를 알지 못합니다</td></tr>
      </tbody></table>`,
    ship: `<ul class="pd-ul">
        <li>현지 매입 후 합배송으로 발송하며, 예약 상품은 일본 발매일 이후 순차 발송됩니다(통상 2~3주).</li>
        <li>국제배송 분담금 3,500원은 합배송 기준으로 판매가에 이미 포함되어 있습니다.</li>
        <li>초회한정반·특전은 현지 수량 소진 시 통상반으로 대체되거나 주문이 취소될 수 있습니다.</li>
        <li>단순 변심 교환·반품은 미개봉 상태에서 수령 후 7일 이내 가능합니다.</li>
        <li class="dim">데모 페이지입니다. 실제 결제·배송은 이루어지지 않습니다.</li>
      </ul>`,
    op: `<p>${p.operator ? `이 상품의 공식 운영사는 <b>${esc(p.operator)}</b>입니다.` : '이 상품의 공식 운영사는 확인되지 않았습니다.'}</p>
      <p class="dim">Lilac은 티켓 재판매를 취급하지 않으며, 공식 유통채널에서 매입한 상품만 중개합니다.</p>
      <div class="pd-actions">
        <a class="btn-out" href="${p.officialUrl}" target="_blank" rel="noopener">아티스트 공식 사이트 ${icon('i-ext', 'ic s')}</a>
        ${(p.shopUrl || p.towerUrl) ? `<a class="btn-out" href="${esc(p.shopUrl || p.towerUrl || '')}" target="_blank" rel="noopener">${esc(p.shopLabel || t('store.tower'))} ${icon('i-ext', 'ic s')}</a>` : ''}
      </div>`,
  };
  const paintPanel = (k: string) => { $('#pdPanel').innerHTML = panels[k]; };
  paintPanel('info');
  $('#pdTabs').querySelectorAll<HTMLButtonElement>('.pd-tab').forEach((b) =>
    b.addEventListener('click', () => {
      $('#pdTabs').querySelectorAll('.pd-tab').forEach((x) => x.classList.remove('on'));
      b.classList.add('on'); paintPanel(b.dataset.p!);
    }));

  if (artist) {
    const rel = products.filter((x) => x.artistId === artist.id && x.id !== p.id).slice(0, 4);
    const box = document.getElementById('pdRelated');
    if (box) { box.innerHTML = rel.map(productCard).join(''); bindTilt(box); }
  }
}

/* ================= 일정 ================= */
export async function pageSchedule() {
  /* events.json 하나로 통합했다.
     수집기가 실발매일(isDemo=false)과 예시 공연(isDemo=true)을 함께 넣어준다. */
  const merged: Ev[] = events.map((e) => ({ ...e }));
  const isDemo = (e: Ev) => e.isDemo === true;
  const artOf = new Map(merged.map((e) => [e.id, e.artwork]));
  const urlOf = new Map(merged.map((e) => [e.id, e.appleUrl]));
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = merged.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = merged.filter((e) => e.date < today).sort((a, b) => b.date.localeCompare(a.date));
  let showPast = false;
  const sorted = upcoming;
  const groupBy = (list: Ev[]) => {
    const m = new Map<string, Ev[]>();
    list.forEach((e) => { const k = e.date.slice(0, 7); m.set(k, [...(m.get(k) || []), e]); });
    return m;
  };
  root().innerHTML = `
    <section class="page-section page-top">
      <div class="page-head" data-d3="head">
        <h1 class="page-title">${t('schedule.title')}</h1>
        <p class="page-desc">발매 일정은 <b>Apple Music 카탈로그</b>에서, 응모 마감은 <b>레이블 공식 특설 사이트</b>에서 자동으로 모읍니다.
          현재 ${merged.length}건 모두 출처가 있는 실데이터입니다. 내한·원정 공연은 공개 API가 없어 아직 넣지 않았습니다.</p>
        <div class="sch-toolbar">
          <div class="chips" id="schFilters">
            <button class="chip on" data-f="all">전체</button>
            <button class="chip" data-f="__jp">J-POP <b class="cnt">${merged.filter((e) => (e.country || 'jp') === 'jp').length}</b></button>
            <button class="chip" data-f="__kr">K-POP <b class="cnt">${merged.filter((e) => e.country === 'kr').length}</b></button>
            ${[...new Set(sorted.map((e) => e.type))].map((ty) => `<button class="chip" data-f="${esc(ty)}">${esc(ty)}</button>`).join('')}
            <button class="chip" data-f="__real">실데이터만</button>
          </div>
          <div class="lib-tools">
            <button class="view-toggle on" id="schListBtn" title="리스트">${icon('i-rows', 'ic s')}</button>
            <button class="view-toggle" id="schCalBtn" title="캘린더">${icon('i-cal', 'ic s')}</button>
          </div>
        </div>
      </div>
      <div id="schBody"></div>
      <p class="pd-note" style="margin-top:24px">발매 일정은 Apple Music 카탈로그에서 자동 수집한 실제 발매일입니다. 응모 일정은 각 공식 출처에서 조건과 마감일을 다시 확인해 주세요. 공연 정보는 공식 확인 후 제공됩니다.</p>
    </section>`;
  const matchF = (e: Ev, f: string) =>
    f === 'all' ? true
    : f === '__real' ? !isDemo(e)
    : f === '__jp' ? (e.country || 'jp') === 'jp'
    : f === '__kr' ? e.country === 'kr'
    : e.type === f;
  const render = (f: string) => {
    const out: string[] = [];
    const source = showPast ? [...upcoming, ...past.slice().reverse()] : upcoming;
    groupBy(source).forEach((list, month) => {
      const rows = list.filter((e) => matchF(e, f));
      if (!rows.length) return;
      const [y, m] = month.split('-');
      out.push(`<div class="sch-month"><div class="sch-mlabel"><b>${m}</b><span>${y}</span></div><div class="sch-rows">
        ${rows.map((e) => {
          const { d, txt } = dday(e.date);
          const a = artists.find((x) => x.name === e.artist);
          const day = new Date(e.date);
          const art = artOf.get(e.id);
          const link = urlOf.get(e.id);
          return `<div class="sch-row" ${a ? `data-href="#/artist/${a.id}"` : ''}>
            <div class="sch-date"><b>${day.getDate()}</b><span>${['일','월','화','수','목','금','토'][day.getDay()]}</span></div>
            <div class="sch-poster" ${art ? `style="background-image:url(${esc(art)})"` : `data-artist="${esc(e.artist)}"`}></div>
            <div class="sch-meta">
              <div class="sch-top">
                <span class="sch-type">${esc(e.type)}</span>
                ${isDemo(e) ? '' : '<span class="src-badge real">실데이터</span>'}
                <span class="sch-dday ${d >= 0 && d <= 14 ? 'urgent' : ''}">${txt}</span>
              </div>
              <div class="sch-title">${esc(schTitle(e))}</div>
              <div class="sch-sub"><b>${esc(e.artist)}</b> · ${esc(e.venue)} · ${esc(e.note)}</div>
            </div>
            ${link ? `<a class="sch-go ext" href="${link}" target="_blank" rel="noopener" title="Apple Music">${icon('i-ext')}</a>` : `<span class="sch-go">${icon('i-chev-r')}</span>`}
          </div>`;
        }).join('')}</div></div>`);
    });
    const emptyMsg = `<div class="empty-box">${icon('i-cal', 'ic eb')}<p>예정된 일정이 없습니다</p><span>지난 일정을 펼쳐 확인해 보세요</span></div>`;
    $('#schBody').innerHTML = (out.join('') || emptyMsg)
      + `<button class="past-toggle" id="pastToggle">${showPast ? '지난 일정 접기' : `지난 일정 더보기 (${past.length})`} ${icon('i-chev-r', 'ic s')}</button>`;
    document.getElementById('pastToggle')?.addEventListener('click', () => { showPast = !showPast; render(f); });
    fillEventArts($('#schBody'));
    $('#schBody').querySelectorAll<HTMLElement>('.sch-row[data-href]').forEach((el) =>
      el.addEventListener('click', (ev) => {
        if ((ev.target as HTMLElement).closest('.sch-go.ext')) return;
        location.hash = el.dataset.href!;
      }));
  };
  // 캘린더 뷰 (라프텔식 월간 그리드)
  // 캘린더는 한 달씩 (이전/다음 네비게이션)
  const now = new Date();
  let calY = now.getFullYear();
  let calM = now.getMonth() + 1;
  const renderCal = (f: string) => {
    const rows = merged.filter((e) => matchF(e, f));
    const monthKey = `${calY}-${String(calM).padStart(2, '0')}`;
    const counts = new Map<string, number>();
    rows.forEach((e) => counts.set(e.date.slice(0, 7), (counts.get(e.date.slice(0, 7)) || 0) + 1));
    $('#schBody').innerHTML = [monthKey].map((month) => {
      const [y, m] = month.split('-').map(Number);
      const first = new Date(y, m - 1, 1);
      const days = new Date(y, m, 0).getDate();
      const pad = first.getDay();
      const cells: string[] = [];
      for (let i = 0; i < pad; i++) cells.push('<div class="cal-cell empty"></div>');
      for (let d = 1; d <= days; d++) {
        const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const evs = rows.filter((e) => e.date === iso);
        const isToday = iso === new Date().toISOString().slice(0, 10);
        cells.push(`<div class="cal-cell ${evs.length ? 'has' : ''} ${isToday ? 'today' : ''}">
          <span class="cal-d">${d}</span>
          ${evs.map((e) => {
            const a = artists.find((x) => x.name === e.artist);
            return `<div class="cal-ev" ${a ? `data-href="#/artist/${a.id}"` : ''} title="${esc(e.title)}">
              <b>${esc(e.type)}</b><span>${esc(e.artist)}</span></div>`;
          }).join('')}
        </div>`);
      }
      return `<div class="cal-month">
        <div class="cal-nav">
          <button class="cal-arrow" id="calPrev" title="이전 달">${icon('i-chev-l')}</button>
          <div class="cal-title">${y}년 ${m}월 <span class="cal-count">${counts.get(month) || 0}건</span></div>
          <button class="cal-arrow" id="calNext" title="다음 달">${icon('i-chev-r')}</button>
          <button class="cal-today" id="calToday">오늘</button>
        </div>
        <div class="cal-grid">
          ${['일','월','화','수','목','금','토'].map((w, i) => `<div class="cal-w ${i === 0 ? 'sun' : ''}">${w}</div>`).join('')}
          ${cells.join('')}
        </div></div>`;
    }).join('');
    $('#schBody').querySelectorAll<HTMLElement>('.cal-ev[data-href]').forEach((el) =>
      el.addEventListener('click', () => { location.hash = el.dataset.href!; }));
    document.getElementById('calPrev')?.addEventListener('click', () => { calM--; if (calM < 1) { calM = 12; calY--; } renderCal(f); });
    document.getElementById('calNext')?.addEventListener('click', () => { calM++; if (calM > 12) { calM = 1; calY++; } renderCal(f); });
    document.getElementById('calToday')?.addEventListener('click', () => { calY = now.getFullYear(); calM = now.getMonth() + 1; renderCal(f); });
  };

  let schView: 'list' | 'cal' = 'list';
  let schFilter = 'all';
  const draw = () => (schView === 'list' ? render(schFilter) : renderCal(schFilter));
  draw();
  $('#schFilters').querySelectorAll<HTMLButtonElement>('.chip').forEach((b) =>
    b.addEventListener('click', () => {
      $('#schFilters').querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on'); schFilter = b.dataset.f!; draw();
    }));
  $('#schListBtn').addEventListener('click', () => {
    schView = 'list'; $('#schListBtn').classList.add('on'); $('#schCalBtn').classList.remove('on'); draw();
  });
  $('#schCalBtn').addEventListener('click', () => {
    schView = 'cal'; $('#schCalBtn').classList.add('on'); $('#schListBtn').classList.remove('on'); draw();
  });
}

/* ================= 아티스트 상세 ================= */
export async function pageArtist(id: string) {
  const a = artists.find((x) => x.id === id);
  if (!a) return page404();
  const oshi = await api('/api/oshi').catch(() => []);
  const following = oshi.some((o: { artistId: string }) => o.artistId === a.id);
  const fmtViews = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : n >= 1e4 ? `${Math.round(n / 1e4).toLocaleString()}만` : n.toLocaleString());
  root().innerHTML = `
    <section class="ar-hero">
      <div class="ar-bg" id="arBg"></div><div class="ar-scrim"></div>
      <div class="ar-head">
        <div class="ar-portrait" id="arPortrait" aria-hidden="true"></div>
        <div class="ar-info">
          <h1 class="ar-name">${esc(a.name)}</h1>
          <p class="ar-stats" id="arStats"><span class="ar-vf">${icon('i-mic', 'ic s')} 카탈로그 아티스트</span> · <span class="stat-sk"></span>${artistSub(a) ? ` · ${esc(artistSub(a))}` : ''}</p>
        </div>
      </div>
    </section>
    <div class="ar-actionbar">
      <button class="play-big" id="arPlay" aria-label="인기곡 전체 재생">${icon('i-play')}</button>
      <button class="tbtn big-ghost ${following ? 'on' : ''}" id="arFollow">${following ? '팔로잉' : '팔로우'}</button>
      ${a.official ? `<a class="tbtn big-ghost" href="${esc(a.official)}" target="_blank" rel="noopener" title="공식 사이트">${icon('i-ext')}</a>` : ''}
      <span class="ar-op">${a.operator ? `${t('store.operator')} · ${esc(a.operator)}` : `${countryLabel(a.country)} · ${esc(a.genre)}`}</span>
    </div>
    <section class="page-section"><div class="sec-head" data-d3="head"><h2>인기</h2></div><div id="arTracks">${skRows(5)}</div></section>
    <section class="page-section" id="arDiscSec"><div class="sec-head" data-d3="head"><h2>디스코그래피</h2><span class="sec-sub">Apple Music 카탈로그</span></div><div id="arDisc">${skCards(6)}</div></section>
    <section class="page-section" id="arEvSec" style="display:none"><div class="sec-head" data-d3="head"><h2>${t('schedule.title')}</h2><a class="sec-link" href="#/schedule">${t('more')} ${icon('i-chev-r', 'ic s')}</a></div><div class="ev-shelf" id="arEvents"></div></section>
    <section class="page-section" id="arGoodsSec" style="display:none"><div class="sec-head" data-d3="head"><h2>${t('store.title')}</h2><a class="sec-link" href="#/store">${t('more')} ${icon('i-chev-r', 'ic s')}</a></div><div class="store-dark-grid" id="arGoods"></div></section>
    <section class="page-section" id="arFandomSec" style="display:none">
      <div class="sec-head" data-d3="head"><h2>공식 채널 · 사는 법</h2><span class="sec-sub" id="arFandomSub"></span></div>
      <div class="fd-links" id="arLinks"></div>
      <div class="fd-mechs" id="arMechs"></div>
    </section>
    <section class="page-section"><div class="sec-head" data-d3="head"><h2>다른 아티스트도 만나보세요</h2></div><div id="arSimilar"></div></section>
    <section class="page-section"><div class="sec-head" data-d3="head"><h2>정보</h2></div>
      <div class="ar-about">
        <div class="ar-about-img" id="arAboutImg"></div>
        <div class="ar-about-txt">
          <p class="ar-listeners" id="arListeners"><span class="stat-sk"></span></p>
          <p>${esc(a.name)}${artistSub(a) ? `(${esc(artistSub(a))})` : ''}는 ${countryLabel(a.country)}의 ${esc(a.genre)} 아티스트입니다.${a.operator ? ` 공식 운영사는 ${esc(a.operator)}${a.operatorSource === 'musicbrainz' ? '<span class="src-note" title="MusicBrainz 공개 데이터베이스에서 자동 수집했습니다">(자동 수집)</span>' : ''}이며,` : ''}
            Lilac은 공식 유통망과 연결된 정보만 표시합니다.</p>
          <p class="dim">이 소개문은 데모용으로 생성된 텍스트입니다. 실서비스에서는 레이블 제공 프로필이 들어갑니다.</p>
          ${a.official ? `<a class="btn-out" href="${esc(a.official)}" target="_blank" rel="noopener">공식 사이트 ${icon('i-ext', 'ic s')}</a>` : ''}
        </div>
      </div>
    </section>`;

  findCatalog(a.searchTerm).then((hit) => {
    const bg = document.getElementById('arBg');
    const portrait = document.getElementById('arPortrait');
    if (!hit || !bg) return;
    /* 배경은 강한 블러라 잘려도 무방하고,
       원본은 초상 카드에 온전하게 보여준다 — 어떤 아트워크든 잘리지 않는다 */
    bg.style.backgroundImage = `url(${artUrl(hit, 600)})`;
    if (portrait) portrait.innerHTML = `<img src="${artUrl(hit, 440)}" alt="" decoding="async"/>`;
    void applyTone(document.querySelector('.ar-hero'), artUrl(hit, 200));
  });
  // 수집된 아트워크가 있으면 카탈로그 응답을 기다리지 않고 먼저 채운다
  if (a.artwork) {
    const bg0 = document.getElementById('arBg');
    const pt0 = document.getElementById('arPortrait');
    if (bg0) bg0.style.backgroundImage = `url(${sized(a.artwork, 600)})`;
    if (pt0) pt0.innerHTML = `<img src="${sized(a.artwork, 440)}" alt="" decoding="async"/>`;
  }
  $('#arFollow').addEventListener('click', async () => {
    if (needsLogin('팔로우')) return;
    const list = await api('/api/oshi', { method: 'POST', body: JSON.stringify({ artistId: a.id, name: a.name }) }).catch(() => null);
    if (!list) return;
    const on = list.some((o: { artistId: string }) => o.artistId === a.id);
    $('#arFollow').classList.toggle('on', on);
    $('#arFollow').textContent = on ? '팔로잉' : '팔로우';
    toast(on ? `${a.name} 팔로우` : '팔로우 해제');
  });

  /* 저장된 카탈로그(아티스트 ID 기준, 스토어별 최대 200곡)를 먼저 쓴다.
     예전엔 매 조회마다 애플을 이름으로 검색해 10곡만 받았다 — 레이트리밋에
     노출되고 동명 아티스트가 섞였다. 카탈로그가 아직 없을 때만 실시간으로 물러난다. */
  type CatTrack = { id: number; title: string; album: string; artwork: string; preview: string | null; appleUrl: string | null; durationMs: number | null; releaseDate: string; charted?: boolean };
  type CatEntry = { count: number; capped: boolean; tracks: CatTrack[]; popular: CatTrack[] };
  const cat = await api(`/api/artist/${a.id}/tracks?limit=500`).catch(() => null) as CatEntry | null;
  let tracks: CatalogTrack[];
  if (cat && cat.tracks.length) {
    /* '인기'는 서버가 차트 등장 순 + 제목 중복 제거로 만든 popular 를 쓴다.
       카탈로그를 그대로 자르면 같은 곡이 스토어별로 두 번 나온다. */
    const src = (cat.popular && cat.popular.length ? cat.popular : cat.tracks);
    tracks = src.map((t) => ({ id: t.id, title: t.title, artist: a.name, album: t.album, artwork: t.artwork, preview: t.preview || '', appleUrl: t.appleUrl || '', durationMs: t.durationMs || 0 } as unknown as CatalogTrack));
  } else {
    tracks = ((await api(`/api/catalog/search?term=${encodeURIComponent(a.searchTerm)}&limit=10`).catch(() => ({ tracks: [] }))).tracks || []) as CatalogTrack[];
  }
  const top = tracks.filter((x) => x.preview).slice(0, 5);
  const entries = top.map((c, i) => {
    const s = seeds.find((sd) => sd.artistId === a.id && c.title.includes(sd.title.split(' (')[0]));
    return { rank: i + 1, title: c.title, artist: c.artist, artwork: artUrl(c, 100), searchTerm: `${c.artist} ${c.title}`, youtubeId: s?.youtubeId ?? null };
  });
  $('#arTracks').innerHTML = entries.length ? rankList(entries) : '<p class="loading">카탈로그에서 찾지 못했습니다</p>';
  bindRank($('#arTracks'), entries);
  $('#arPlay').addEventListener('click', () => { if (top.length) playQueue(top.map((c) => toPlayable(c)), 0); });

  const todayStr = new Date().toISOString().slice(0, 10);
  const evs = events
    .filter((e) => e.artist === a.name && e.date >= todayStr)
    .sort((x, y) => x.date.localeCompare(y.date))
    .slice(0, 8);
  if (evs.length) {
    $('#arEvSec').style.display = '';
    $('#arEvents').innerHTML = evs.map((ev) => {
      const { d, txt } = dday(ev.date);
      return `<div class="ev-card"><div class="ev-bg" data-artist="${esc(ev.artist)}"></div><div class="ev-scrim"></div>
        <div class="ev-body"><div class="ev-title">${esc(ev.title)}</div>
          <div class="ev-info"><b class="ev-dday ${d >= 0 && d <= 14 ? 'urgent' : ''}">${txt}</b> <span class="ev-type">${esc(ev.type)}</span> · ${ev.date} · ${esc(ev.venue)}</div></div></div>`;
    }).join('');
    fillEventArts($('#arEvents'));
  }
  const goods = products.filter((p) => p.brand === a.name);
  if (goods.length) {
    $('#arGoodsSec').style.display = '';
    $('#arGoods').innerHTML = goods.map(productCard).join('');
    bindTilt($('#arGoods'));
  }
  // 인증 표기는 지표를 다시 그릴 때도 남아 있어야 한다
  const vf = `<span class="ar-vf">${icon('i-check', 'ic s')} 인증됨</span> · `;
  // 실제 지표 (YouTube 공식 MV 누적 조회수 합산)
  api(`/api/artist/${a.id}/stats`).then((s: { totalViews: number; trackCount: number; live: boolean; source: string }) => {
    const st = document.getElementById('arStats');
    const ls = document.getElementById('arListeners');
    if (!s.totalViews) {
      if (st) st.innerHTML = `${vf}${esc(a.genre)}${artistSub(a) ? ` · ${esc(artistSub(a))}` : ''}`;
      if (ls) ls.innerHTML = `<span class="dim">공개 지표를 가져오지 못했습니다</span>`;
      return;
    }
    const txt = `YouTube 공식 MV 누적 <b>${fmtViews(s.totalViews)}회</b>`;
    if (st) st.innerHTML = `${txt.replace(/<\/?b>/g, '')}${artistSub(a) && artistSub(a) !== a.name ? ` · ${esc(artistSub(a))}` : ''}`;
    if (ls) ls.innerHTML = `${txt} <span class="live-badge ${s.live ? 'on' : ''}">${s.live ? '실시간' : '캐시'}</span>
      <span class="dim" style="display:block;font-size:12px;margin-top:4px">${esc(s.source)} · 등록곡 ${s.trackCount}개 기준</span>`;
  }).catch(() => {
    const st = document.getElementById('arStats');
    if (st) st.innerHTML = `${vf}${esc(a.genre)}${artistSub(a) ? ` · ${esc(artistSub(a))}` : ''}`;
  });

  // 디스코그래피 — 카탈로그(ID 기준)가 있으면 그걸, 없으면 실시간 검색
  (async () => {
    type Al = { id: number; title: string; artist: string; artwork: string; year: string; trackCount: number; appleUrl: string };
    let albums: Al[] = [];
    if (cat && cat.tracks.length) {
      const byAlbum = new Map<number, Al & { n: number }>();
      for (const t of cat.tracks) {
        const cur = byAlbum.get((t as { albumId?: number }).albumId ?? 0) || { id: (t as { albumId?: number }).albumId ?? 0, title: t.album, artist: a.name, artwork: t.artwork, year: (t.releaseDate || '').slice(0, 4), trackCount: 0, appleUrl: t.appleUrl ? t.appleUrl.replace(/\?i=\d+$/, '') : '', n: 0 };
        cur.n++; cur.trackCount = cur.n; byAlbum.set(cur.id, cur);
      }
      albums = [...byAlbum.values()].sort((x, y) => y.year.localeCompare(x.year));
      const cnt = document.querySelector('#arDiscSec .sec-sub');
      if (cnt) cnt.textContent = `Apple Music 카탈로그 · ${albums.length}개 앨범 · ${cat.count}곡${cat.capped ? ' (스토어별 200곡 상한)' : ''}`;
    } else {
      const r = await api(`/api/catalog/albums?term=${encodeURIComponent(a.searchTerm)}`).catch(() => ({ albums: [] }));
      albums = (r.albums || []) as Al[];
    }
    return { albums };
  })().then((r) => {
    const albums = r.albums;
    const mine = albums.filter((x) => x.artist === a.searchTerm || x.artist === a.name || x.artist === a.nameJa);
    const use = (mine.length ? mine : albums).slice(0, 12);
    const el = document.getElementById('arDisc');
    const sec = document.getElementById('arDiscSec');
    if (!el || !sec) return;
    if (!use.length) { sec.style.display = 'none'; return; }
    el.innerHTML = `<div class="shelf d3-stage">${use.map((al) => `
      <a class="card" href="${al.appleUrl}" target="_blank" rel="noopener">
        <div class="cover"><img src="${esc(al.artwork)}" alt="" loading="lazy"/><span class="glare"></span>
          </div>
        <div class="c-title">${esc(al.title)}</div><div class="c-sub">${esc(al.year)} · ${al.trackCount}곡</div>
      </a>`).join('')}</div>`;
    bindTilt(el);
    const about = document.getElementById('arAboutImg');
    if (use[0] && about) about.style.backgroundImage = `url(${esc(use[0].artwork)})`;
  }).catch(() => { const s = document.getElementById('arDiscSec'); if (s) s.style.display = 'none'; });

  /* 공식 채널 + 이 팀에 해당하는 팬덤 방식.
     라일락은 팔지 않는다 — 공식 판매처·응모·팬클럽으로 보낸다. */
  api(`/api/artist/${a.id}/fandom`).then((f: {
    links: Record<string, { url: string; source?: string }>; linksSource: string | null; basis: string[];
    platform: { membership: { name: string; url: string } | null; shop: { name: string; url: string } | null; source: string } | null;
    mechanics: { id: string; country: string; name: string; what: string; how: string[]; note?: string; lilac?: string; resolvedLinks: { key: string; url: string }[] }[];
  }) => {
    const sec = document.getElementById('arFandomSec'); const lk = document.getElementById('arLinks'); const mk = document.getElementById('arMechs'); const sub = document.getElementById('arFandomSub');
    if (!sec || !lk || !mk) return;
    const LABEL: Record<string, string> = { official: '공식 사이트', youtube: 'YouTube', x: 'X', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', weverse: 'Weverse', tower: '타워레코드', hmv: 'HMV', amazonJp: 'Amazon JP', shop: '음반 구매', appleMusic: 'Apple Music', spotify: 'Spotify', fanpage: '팬 사이트' };
    const ORDER = ['official', 'weverse', 'youtube', 'x', 'instagram', 'tiktok', 'facebook', 'tower', 'hmv', 'amazonJp', 'shop', 'appleMusic', 'spotify', 'fanpage'];
    const entries = ORDER.filter((k) => f.links?.[k]?.url).map((k) => ({ k, url: f.links[k].url }));
    const plat: { k: string; url: string; name: string }[] = [];
    if (f.platform?.membership) plat.push({ k: 'membership', url: f.platform.membership.url, name: `${f.platform.membership.name} 멤버십` });
    if (f.platform?.shop) plat.push({ k: 'shop', url: f.platform.shop.url, name: `${f.platform.shop.name} 공식몰` });
    if (!entries.length && !plat.length && !f.mechanics.length) return;
    sec.style.display = '';
    if (sub) sub.textContent = [f.linksSource === 'musicbrainz' ? '채널: MusicBrainz 공개 데이터' : '', f.platform ? f.platform.source : ''].filter(Boolean).join(' · ');
    lk.innerHTML = [
      ...entries.map((e) => `<a class="fd-link${/tower|hmv|amazonJp|shop/.test(e.k) ? ' buy' : ''}" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(LABEL[e.k] || e.k)}</a>`),
      ...plat.map((p) => `<a class="fd-link plat" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>`),
    ].join('');
    mk.innerHTML = f.mechanics.map((m) => `
      <details class="fd-mech">
        <summary><span class="fd-cc ${m.country}">${m.country === 'jp' ? '일본' : '한국'}</span>${esc(m.name)}</summary>
        <p>${esc(m.what)}</p>
        <ol>${m.how.map((h) => `<li>${esc(h)}</li>`).join('')}</ol>
        ${m.note ? `<p class="fd-note">${esc(m.note)}</p>` : ''}
        ${m.lilac === 'releases' ? `<a class="fd-go" href="#/releases">라일락 판매처 비교로 →</a>` : ''}
        ${m.resolvedLinks.length ? `<div class="fd-mech-links">${m.resolvedLinks.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(LABEL[l.key] || l.key)}</a>`).join('')}</div>` : ''}
      </details>`).join('');
    if (f.basis.length) mk.insertAdjacentHTML('afterbegin', `<p class="fd-basis">${esc(f.basis.join(' · '))}</p>`);
  }).catch(() => { /* 없으면 섹션을 숨긴 채 둔다 */ });

  const sim = artists.filter((x) => x.id !== a.id).slice(0, 6);
  $('#arSimilar').innerHTML = shelf(sim.map((x) => ({ title: x.name, sub: x.genre, round: true, href: `#/artist/${x.id}`, term: x.searchTerm })));
  fillShelfArts($('#arSimilar'));
}

/* ================= 보관함 (독립 페이지) =================
   레퍼런스: 스포티파이 라이브러리(필터 칩·정렬·그리드/리스트 토글)
   + 라프텔(태그 필터 감각) + 넷플릭스(행 단위 큐레이션) */
type LibFilter = 'all' | 'playlists' | 'artists' | 'likes' | 'history';

export async function pageLibrary(sub?: string) {
  /* 보관함은 전부 로그인 필요 데이터다.
     비로그인이면 API 가 401 을 주는데, 예전엔 그걸 빈 배열로 삼켜서
     "플레이리스트 0 / 팔로우 0"만 뜨는 빈 껍데기가 됐다.
     사용자는 저장한 게 없다고 오해한다 — 주문·계정처럼 로그인부터 안내한다. */
  if (!me) {
    root().innerHTML = `
      <div class="page-section lib-guest">
        <h1>내 보관함</h1>
        <p>좋아요·플레이리스트·팔로우는 계정에 저장됩니다. 로그인하면 여기에서 한곳에 모아 볼 수 있습니다.</p>
        <div class="lib-guest-actions">
          <a class="btn-pill" href="#/login">로그인</a>
          <a class="lib-guest-alt" href="#/signup">가입하기</a>
        </div>
        <p class="lib-guest-hint">계정 없이도 차트·스토어·일정은 전부 이용할 수 있습니다.</p>
      </div>
      <section class="page-section"><div class="sec-head" data-d3="head"><h2>지금 인기</h2><span class="sec-sub">차트에서 좋아요를 누르면 여기에 모입니다</span><a class="sec-link" href="#/chart">${t('chart.viewAll')} ${icon('i-chev-r', 'ic s')}</a></div><div id="libGuestPicks">${skCards(6)}</div></section>
      <section class="page-section"><div class="sec-head" data-d3="head"><h2>${t('artists')}</h2><a class="sec-link" href="#/artists">${t('more')} ${icon('i-chev-r', 'ic s')}</a></div><div id="libGuestArtists">${skCards(7, true)}</div></section>`;

    /* 비로그인 보관함은 안내 박스 하나만 있고 아래가 통째로 비어 있었다.
       로그인 전에도 할 수 있는 것(차트 듣기·아티스트 보기)을 보여준다 — Spotify 도 그렇게 한다. */
    (async () => {
      const country = (localStorage.getItem('lilac.chartCountry') as 'jp' | 'kr') || 'jp';
      const j = await api(`/api/charts?country=${country}&source=combined`).catch(() => null);
      const picks = ((j?.list || []) as { title: string; artist: string; artwork?: string }[]).slice(0, 6);
      const pb = document.getElementById('libGuestPicks');
      if (pb) pb.innerHTML = picks.length
        ? shelf(picks.map((p) => ({ title: p.title, sub: p.artist, href: '#/chart', term: `${p.artist} ${p.title}`, art: p.artwork })))
        : '';
      const ab = document.getElementById('libGuestArtists');
      if (ab) { ab.innerHTML = shelf(artists.slice(0, 7).map((a) => ({ title: a.name, sub: t('artists'), round: true, href: `#/artist/${a.id}`, term: a.searchTerm }))); fillShelfArts(ab); }
    })();
    return;
  }

  const filter = (sub || 'all') as LibFilter;
  const [likes, lists, hist, oshi] = await Promise.all([
    api('/api/likes').catch(() => []), api('/api/playlists').catch(() => []),
    api('/api/history').catch(() => []), api('/api/oshi').catch(() => []),
  ]);

  type PL = { id: string; name: string; tracks: PlayableTrack[]; createdAt: string };
  const playlists = lists as PL[];
  const oshiList = oshi as { artistId: string; name: string; at: string }[];
  const likeList = likes as (PlayableTrack & { likedAt?: string })[];
  const histList = hist as PlayableTrack[];

  /* 최근 들은 곡 — 같은 곡이 반복되므로 중복을 접는다 */
  const recent = histList.filter((h, i, arr) => arr.findIndex((x) => x.title === h.title && x.artist === h.artist) === i);

  const totalTracks = playlists.reduce((n, p) => n + p.tracks.length, 0) + likeList.length;

  /** 플레이리스트 커버 — 수록곡 4장을 모자이크로 */
  const mosaic = (p: PL) => {
    const arts = p.tracks.map((t) => t.artwork).filter(Boolean).slice(0, 4) as string[];
    if (!arts.length) return `<div class="lc-ph">${icon('i-music', 'ic')}</div>`;
    if (arts.length < 4) return `<img src="${esc(sized(arts[0], 300))}" alt="" loading="lazy" decoding="async"/>`;
    return `<div class="lc-mosaic">${arts.map((a) => `<img src="${esc(sized(a, 160))}" alt="" loading="lazy" decoding="async"/>`).join('')}</div>`;
  };

  const SECTIONS: { k: LibFilter; label: string }[] = [
    { k: 'all', label: '전체' },
    { k: 'playlists', label: t('lib.playlists') },
    { k: 'artists', label: t('lib.follows') },
    { k: 'likes', label: t('lib.likes') },
    { k: 'history', label: t('lib.history') },
  ];

  root().innerHTML = `
    <section class="lib2">
      <header class="lib2-hero" data-d3="head">
        <div class="lib2-hero-main">
          <h1 class="lib2-title">내 보관함</h1>
          <p class="lib2-sub">저장한 플레이리스트와 팔로우한 아티스트를 한곳에서 봅니다.</p>
        </div>
        <dl class="lib2-stats">
          <div><dt>플레이리스트</dt><dd>${playlists.length}</dd></div>
          <div><dt>팔로우</dt><dd>${oshiList.length}</dd></div>
          <div><dt>좋아요</dt><dd>${likeList.length}</dd></div>
          <div><dt>보관 곡</dt><dd>${totalTracks}</dd></div>
        </dl>
      </header>

      <div class="lib2-bar">
        <nav class="lib2-tabs" aria-label="보관함 분류">
          ${SECTIONS.map((f) => `<a class="chip ${f.k === filter ? 'on' : ''}" href="#/library/${f.k}">${f.label}</a>`).join('')}
        </nav>
        <div class="lib2-tools">
          <div class="lib-find">${icon('i-search', 'ic s')}<input id="libFind" placeholder="보관함에서 찾기" aria-label="보관함 검색" /></div>
          <button class="lib-newbtn" id="libNew">${icon('i-plus', 'ic s')} ${t('lib.newPlaylist')}</button>
        </div>
      </div>

      <div id="libBody"></div>
    </section>`;

  const body = $('#libBody');

  /* ---- 섹션 렌더러 ---- */

  const emptyBox = (msg: string, cta?: { label: string; href: string }) => `
    <div class="lib2-empty">
      ${icon('i-music', 'ic eb')}
      <p>${esc(msg)}</p>
      ${cta ? `<a class="btn-out" href="${cta.href}">${esc(cta.label)}</a>` : ''}
    </div>`;

  const secContinue = () => {
    if (!recent.length) return '';
    return `
      <section class="lib2-sec">
        <div class="sec-head" data-d3="head"><h2>이어 듣기</h2></div>
        <div class="lib2-continue">
          ${recent.slice(0, 6).map((h, i) => `
            <button class="lc-cont" data-play-recent="${i}" data-d3-tilt="6">
              <span class="lc-cont-art">${h.artwork ? `<img src="${esc(sized(h.artwork, 140))}" alt="" loading="lazy" decoding="async"/>` : ''}</span>
              <span class="lc-cont-txt">
                <b>${esc(h.title)}</b>
                <span>${esc(h.artist)}</span>
              </span>
              <span class="lc-cont-play">${icon('i-play', 'ic s')}</span>
            </button>`).join('')}
        </div>
      </section>`;
  };

  const secPlaylists = (q: string) => {
    const rows = playlists.filter((p) => smartMatch(p.name, q));
    return `
      <section class="lib2-sec">
        <div class="sec-head" data-d3="head">
          <h2>플레이리스트 <span class="sec-count">${rows.length}</span></h2>
          ${filter === 'all' && playlists.length > 6 ? '<a class="sec-link" href="#/library/playlists">전체 보기</a>' : ''}
        </div>
        ${rows.length ? `<div class="lib2-grid">
          <a class="lc-card lc-likes" href="#/library/likes" data-d3="rise" data-d3-tilt="7">
            <span class="lc-art lc-likes-art">${icon('i-heart', 'ic')}</span>
            <b class="lc-name">${t('lib.likes')}</b>
            <span class="lc-sub">${likeList.length}곡</span>
          </a>
          ${rows.slice(0, filter === 'all' ? 6 : rows.length).map((p) => `
            <a class="lc-card" href="#/playlist/${p.id}" data-d3="rise" data-d3-tilt="7">
              <span class="lc-art">${mosaic(p)}</span>
              <b class="lc-name">${esc(p.name)}</b>
              <span class="lc-sub">${p.tracks.length}곡</span>
            </a>`).join('')}
        </div>` : emptyBox('아직 만든 플레이리스트가 없습니다', { label: '차트에서 곡 담기', href: '#/chart' })}
      </section>`;
  };

  const secArtists = (q: string) => {
    const rows = oshiList.filter((o) => smartMatch(o.name, q));
    return `
      <section class="lib2-sec">
        <div class="sec-head" data-d3="head"><h2>팔로우한 아티스트 <span class="sec-count">${rows.length}</span></h2></div>
        ${rows.length ? `<div class="lib2-artists">
          ${rows.map((o) => {
            const a = artists.find((x) => x.id === o.artistId);
            return `<a class="la-card" href="#/artist/${o.artistId}" data-d3="rise" data-d3-tilt="8">
              <span class="la-art">${a?.artwork ? `<img src="${esc(sized(a.artwork, 200))}" alt="" loading="lazy" decoding="async"/>` : esc(o.name[0])}</span>
              <b>${esc(o.name)}</b>
              <span>${esc(a?.genre || '아티스트')}</span>
            </a>`;
          }).join('')}
        </div>` : emptyBox('팔로우한 아티스트가 없습니다', { label: '아티스트 둘러보기', href: '#/artists' })}
      </section>`;
  };

  const secLikes = (q: string) => {
    const rows = likeList.filter((l) => smartMatch(`${l.title} ${l.artist}`, q));
    const shown = filter === 'all' ? rows.slice(0, 5) : rows;
    return `
      <section class="lib2-sec">
        <div class="sec-head" data-d3="head">
          <h2>${t('lib.likes')} <span class="sec-count">${rows.length}</span></h2>
          ${rows.length ? `<button class="sec-link" id="likesPlay">${icon('i-play', 'ic s')} 전체 재생</button>` : ''}
        </div>
        ${shown.length ? `<ol class="lib2-tracks">
          ${shown.map((l, i) => `
            <li class="lt-row" data-like="${i}">
              <span class="lt-i">${i + 1}</span>
              <span class="lt-art">${l.artwork ? `<img src="${esc(sized(l.artwork, 100))}" alt="" loading="lazy" decoding="async"/>` : ''}</span>
              <span class="lt-txt"><b>${esc(l.title)}</b><span>${esc(l.artist)}</span></span>
              <span class="lt-play">${icon('i-play', 'ic s')}</span>
            </li>`).join('')}
        </ol>` : emptyBox('좋아요한 곡이 없습니다', { label: '차트 보러 가기', href: '#/chart' })}
        ${filter === 'all' && rows.length > 5 ? '<a class="lib2-more" href="#/library/likes">좋아요 전체 보기</a>' : ''}
      </section>`;
  };

  const secHistory = (q: string) => {
    const rows = recent.filter((h) => smartMatch(`${h.title} ${h.artist}`, q));
    return `
      <section class="lib2-sec">
        <div class="sec-head" data-d3="head"><h2>${t('lib.history')} <span class="sec-count">${rows.length}</span></h2></div>
        ${rows.length ? `<ol class="lib2-tracks">
          ${rows.slice(0, filter === 'all' ? 5 : 50).map((h, i) => `
            <li class="lt-row" data-hist="${i}">
              <span class="lt-i">${i + 1}</span>
              <span class="lt-art">${h.artwork ? `<img src="${esc(sized(h.artwork, 100))}" alt="" loading="lazy" decoding="async"/>` : ''}</span>
              <span class="lt-txt"><b>${esc(h.title)}</b><span>${esc(h.artist)}</span></span>
              <span class="lt-play">${icon('i-play', 'ic s')}</span>
            </li>`).join('')}
        </ol>` : emptyBox('재생 기록이 없습니다')}
      </section>`;
  };

  const render = (q = '') => {
    const parts: string[] = [];
    if (filter === 'all') {
      parts.push(secContinue(), secPlaylists(q), secArtists(q), secLikes(q));
    } else if (filter === 'playlists') parts.push(secPlaylists(q));
    else if (filter === 'artists') parts.push(secArtists(q));
    else if (filter === 'likes') parts.push(secLikes(q));
    else if (filter === 'history') parts.push(secHistory(q));

    const html = parts.filter(Boolean).join('');
    body.innerHTML = html || emptyBox('보관함이 비어 있습니다', { label: '둘러보기', href: '#/' });
    bindBody();
  };

  /* ---- 상호작용 ---- */
  const bindBody = () => {
    body.querySelectorAll<HTMLElement>('[data-play-recent]').forEach((el) =>
      el.addEventListener('click', () => playQueue(recent, Number(el.dataset.playRecent))));

    body.querySelectorAll<HTMLElement>('[data-like]').forEach((el) =>
      el.addEventListener('click', () => playQueue(likeList, Number(el.dataset.like))));

    body.querySelectorAll<HTMLElement>('[data-hist]').forEach((el) =>
      el.addEventListener('click', () => playQueue(recent, Number(el.dataset.hist))));

    document.getElementById('likesPlay')?.addEventListener('click', () => {
      if (likeList.length) playQueue(likeList, 0);
    });
  };

  render();

  $('#libNew').addEventListener('click', async () => {
    const name = await askName(t('lib.newPlaylist'), 'My Mix');
    if (!name) return;
    const pl = await api('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) });
    document.dispatchEvent(new CustomEvent('lilac:playlists'));
    location.hash = `#/playlist/${pl.id}`;
  });

  let findTimer = 0;
  $('#libFind')?.addEventListener('input', (e) => {
    // 입력마다 전체를 다시 그리면 낭비라 잠깐 모아서 처리한다
    clearTimeout(findTimer);
    const v = (e.target as HTMLInputElement).value;
    findTimer = window.setTimeout(() => render(v), 120);
  });
}

export async function pagePlaylist(id: string) {
  const lists = await api('/api/playlists').catch(() => []);
  const pl = lists.find((p: { id: string }) => p.id === id);
  if (!pl) return page404();
  let rows = pl.tracks as PlayableTrack[];
  const covers = rows.slice(0, 4);
  const totalMs = rows.reduce((s, r) => s + (r.durationMs || 0), 0);
  const totalTxt = totalMs ? `${Math.floor(totalMs / 60000)}분` : '';
  const coverHtml = covers.length >= 4
    ? `<div class="sp-cover mosaic" data-tilt="9">${covers.map((x) => `<span style="background-image:url(${esc(x.artwork || '')})"></span>`).join('')}</div>`
    : covers[0]?.artwork
      ? `<div class="sp-cover" style="background-image:url(${esc(covers[0].artwork)})" data-tilt="9"></div>`
      : `<div class="sp-cover empty" data-tilt="9">${icon('i-queue', 'ic ph-ic')}</div>`;

  root().innerHTML = `
    <section class="sp-page">
      <div class="sp-head">
        ${coverHtml}
        <div class="sp-info">
          <h1 class="sp-title" id="plTitle" title="클릭해서 이름 변경">${esc(pl.name)}</h1>
          ${pl.desc ? `<p class="sp-desc">${esc(pl.desc)}</p>` : ''}
          <p class="sp-meta"><span class="sp-owner">${esc((me?.name || 'L')[0])}</span><b>${esc(me?.name || 'Lilac 유저')}</b><span class="sep">·</span>${rows.length}곡${totalTxt ? `<span class="sep">·</span>약 ${totalTxt}` : ''}</p>
        </div>
      </div>
      <div class="sp-actions">
        <button class="play-big" id="plPlayAll" ${rows.length ? '' : 'disabled'}>${icon('i-play')}</button>
        <button class="tbtn big-ghost" id="plShuffle" title="셔플 재생">${icon('i-shuffle')}</button>
        <button class="tbtn big-ghost" id="plMore" title="더보기">${icon('i-grip')}</button>
        <div class="sp-find">${icon('i-search', 'ic s')}<input id="plFind" placeholder="이 플레이리스트에서 찾기" /></div>
      </div>
      <div class="sp-body">
        <div id="plTracks"></div>
        <div class="sp-reco" id="plReco"></div>
      </div>
    </section>`;

  if (covers[0]?.artwork) void applyTone(document.querySelector('.sp-head'), covers[0].artwork);
  bindTilt(root());

  const paint = (q = '') => {
    const view = q ? rows.filter((r) => smartMatch(r.title + ' ' + r.artist, q)) : rows;
    $('#plTracks').innerHTML = view.length
      ? trackTable(view, { album: true, date: true, sticky: true })
      : `<div class="empty-box">${icon('i-queue', 'ic eb')}<p>${q ? '검색 결과가 없습니다' : '아직 곡이 없습니다'}</p><span>${q ? '다른 검색어를 시도해 보세요' : '아래 추천에서 곡을 추가해 보세요'}</span></div>`;
    bindTable($('#plTracks'), view, async (i) => {
      const realIdx = rows.indexOf(view[i]);
      await api(`/api/playlists/${id}/tracks/${realIdx}`, { method: 'DELETE' });
      document.dispatchEvent(new CustomEvent('lilac:playlists'));
      pagePlaylist(id);
    }, {
      onReorder: async (from, to) => {
        const [m] = rows.splice(from, 1); rows.splice(to, 0, m);
        await api(`/api/playlists/${id}/tracks`, { method: 'PUT', body: JSON.stringify({ tracks: rows }) });
        document.dispatchEvent(new CustomEvent('lilac:playlists'));
        paint(($('#plFind') as HTMLInputElement).value);
        toast('순서를 변경했습니다');
      },
      onMenu: (i, e) => {
        const tr = view[i];
        openContextMenu(e.clientX, e.clientY, [
          { label: '지금 재생', icon: 'i-play', run: () => playQueue(view, i) },
          { label: '대기열에 추가', icon: 'i-queue', run: () => enqueue(tr) },
          { label: t('player.addPl'), icon: 'i-plus', run: () => void openPlaylistPicker(tr) },
          { label: '이 플레이리스트에서 삭제', icon: 'i-close', danger: true, run: async () => {
            await api(`/api/playlists/${id}/tracks/${rows.indexOf(tr)}`, { method: 'DELETE' });
            document.dispatchEvent(new CustomEvent('lilac:playlists'));
            pagePlaylist(id);
          } },
        ]);
      },
    });
  };
  paint();

  $('#plPlayAll').addEventListener('click', () => rows.length && playQueue(rows, 0, `playlist:${id}`));
  $('#plShuffle').addEventListener('click', () => rows.length && playQueue([...rows].sort(() => Math.random() - 0.5), 0, `playlist:${id}`));
  $('#plFind').addEventListener('input', (e) => paint((e.target as HTMLInputElement).value));
  const rename = async () => {
    const name = await askName('플레이리스트 이름', pl.name);
    if (!name || name === pl.name) return;
    await api(`/api/playlists/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
    document.dispatchEvent(new CustomEvent('lilac:playlists'));
    pagePlaylist(id);
  };
  $('#plTitle').addEventListener('click', rename);
  $('#plMore').addEventListener('click', (e) => {
    const r = ($('#plMore')).getBoundingClientRect();
    openContextMenu(r.left, r.bottom + 6, [
      { label: '이름 바꾸기', icon: 'i-mic', run: rename },
      { label: '대기열에 모두 추가', icon: 'i-queue', run: () => { rows.forEach((tr) => enqueue(tr)); } },
      { label: '플레이리스트 삭제', icon: 'i-close', danger: true, run: async () => {
        if (!(await askConfirm(`‘${pl.name}’ 플레이리스트를 삭제할까요?`))) return;
        await api(`/api/playlists/${id}`, { method: 'DELETE' });
        document.dispatchEvent(new CustomEvent('lilac:playlists'));
        location.hash = '#/library/playlists';
      } },
    ]);
    e.stopPropagation();
  });

  // 추천: 플리에 없는 시드곡 제안 (스포티파이 '추천 항목')
  const have = new Set(rows.map((r) => (r.title || '').slice(0, 6)));
  const cands = seeds.filter((s) => !have.has(s.title.slice(0, 6))).slice(0, 5);
  const hits = await Promise.all(cands.map((s) => findCatalog(s.searchTerm)));
  const reco = cands.map((s, i) => ({ seed: s, hit: hits[i] })).filter((x) => x.hit);
  if (reco.length) {
    $('#plReco').innerHTML = `
      <div class="reco-head"><h3>추천 항목</h3><span>이 플레이리스트에 어울리는 곡</span></div>
      <div class="reco-list">${reco.map((r, i) => `
        <div class="reco-row" data-i="${i}">
          <img src="${artUrl(r.hit!, 100)}" alt="" loading="lazy"/>
          <span class="reco-meta"><b>${esc(r.hit!.title)}</b><i>${esc(r.hit!.artist)}</i></span>
          <span class="reco-al">${esc(r.hit!.album || '')}</span>
          <button class="reco-add" data-add="${i}">추가</button>
        </div>`).join('')}</div>`;
    $('#plReco').querySelectorAll<HTMLButtonElement>('[data-add]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const r = reco[Number(btn.dataset.add)];
        await api(`/api/playlists/${id}/tracks`, { method: 'POST', body: JSON.stringify({ track: toPlayable(r.hit!, r.seed.youtubeId) }) });
        document.dispatchEvent(new CustomEvent('lilac:playlists'));
        toast(`‘${r.hit!.title}’ 추가됨`);
        pagePlaylist(id);
      }));
    $('#plReco').querySelectorAll<HTMLElement>('.reco-row').forEach((el) =>
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.reco-add')) return;
        const r = reco[Number(el.dataset.i)];
        playQueue([toPlayable(r.hit!, r.seed.youtubeId)], 0);
      }));
  }
}

/* ================= 아티스트 전체 목록 ================= */
export async function pageArtists() {
  const oshi = await api('/api/oshi').catch(() => []);
  const followed = new Set(oshi.map((o: { artistId: string }) => o.artistId));
  root().innerHTML = `
    <section class="page-section page-top">
      <div class="page-head" data-d3="head">
        <h1 class="page-title">전체 아티스트</h1>
        <p class="page-desc">한국과 일본 양국 차트에서 자동으로 추린 ${artists.length}팀입니다.
          팔로우하면 보관함과 사이드바에 추가됩니다.</p>
        <div class="chips" id="arFilters">
          <button class="chip on" data-g="all">전체 <b class="cnt">${artists.length}</b></button>
          ${['J-POP', 'K-POP'].filter((g) => artists.some((a) => a.genre === g)).map((g) =>
            `<button class="chip" data-g="${esc(g)}">${esc(g)} <b class="cnt">${artists.filter((a) => a.genre === g).length}</b></button>`).join('')}
          <button class="chip" data-g="__following">팔로우 중 <b class="cnt">${followed.size}</b></button>
        </div>
      </div>
      <div class="artists-grid" id="arsGrid"></div>
    </section>`;

  const render = (f: string) => {
    const list = artists
      .filter((a) => (f === 'all' ? true : f === '__following' ? followed.has(a.id) : a.genre === f))
      .slice()
      .sort((x, y) => (y.chartHits || 0) - (x.chartHits || 0));
    const grid = $('#arsGrid');
    if (!list.length) {
      grid.innerHTML = `<div class="empty-box">${icon('i-mic', 'ic eb')}<p>해당 아티스트가 없습니다</p></div>`;
      return;
    }
    grid.innerHTML = list.map((a) => `
      <a class="ars-card d3-tilt" href="#/artist/${a.id}" ${a.artwork ? '' : `data-term="${esc(a.searchTerm)}"`} data-d3-tilt="8" data-d3="rise">
        <div class="ars-cover">
          ${a.artwork ? `<img src="${esc(sized(a.artwork, 260))}" alt="" loading="lazy" decoding="async"/>` : ''}
          <div class="ph">${esc(a.name[0])}</div>
          ${followed.has(a.id) ? `<span class="ars-follow">${icon('i-check', 'ic s')}</span>` : ''}</div>
        <div class="ars-name">${esc(a.name)}</div>
        <div class="ars-sub">${artistSub(a) ? `${esc(artistSub(a))} · ` : ''}${esc(a.genre)}</div>
        <div class="ars-op">${esc(a.operator || countryLabel(a.country))}</div>
      </a>`).join('');
    grid.querySelectorAll<HTMLElement>('[data-term]').forEach(async (el) => {
      const hit = await findCatalog(el.dataset.term!);
      const cov = el.querySelector('.ars-cover');
      if (hit && cov) cov.insertAdjacentHTML('afterbegin', `<img src="${artUrl(hit, 300)}" alt="" loading="lazy"/>`);
    });
    bindTilt(grid);
  };
  render('all');
  $('#arFilters').querySelectorAll<HTMLButtonElement>('.chip').forEach((b) =>
    b.addEventListener('click', () => {
      $('#arFilters').querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on'); render(b.dataset.g!);
    }));
}

/* ================= 주문 내역 ================= */
interface Order {
  id: string; productId: string; name: string; brand: string; option: string;
  qty: number; unit?: number; total: number; status: string; orderedAt: string;
  buyerCurrency?: string; chargedKrw?: number;
  artwork?: string;
  breakdown?: {
    jpy?: number; localAmount?: number; localCurrency?: string; buyerCurrency?: string;
    rate: number; base: number; feeRate: number; fee: number; shipping: number; total: number; rateDate?: string;
  } | null;
}
const STATUS_STEPS = ['예약 접수', '현지 매입', '국제 배송', '배송 완료'];

export async function pageOrders() {
  await refreshMe();
  if (!me) { location.hash = '#/login'; return; }
  const orders = (await api('/api/orders').catch(() => [])) as Order[];
  root().innerHTML = `
    <section class="page-section page-top narrow">
      <div class="page-head" data-d3="head">
        <h1 class="page-title">주문 내역</h1>
        <p class="page-desc">예약 공구 주문 ${orders.length}건. 데모 환경이라 실제 결제·배송은 이루어지지 않습니다.</p>
      </div>
      <div id="ordBody"></div>
    </section>`;
  const body = $('#ordBody');
  if (!orders.length) {
    body.innerHTML = `<div class="empty-box">${icon('i-bag', 'ic eb')}<p>주문 내역이 없습니다</p><span>스토어에서 한정반을 예약해 보세요</span>
      <a class="btn-pill" style="width:auto;margin-top:16px;padding:10px 24px" href="#/store">스토어 가기</a></div>`;
    return;
  }
  body.innerHTML = `<div class="ord-list">${orders.map((o) => `
    <a class="ord-card" href="#/orders/${o.id}">
      <div class="ord-art" style="background-image:url(${esc(o.artwork || '')})">${o.artwork ? '' : icon('i-bag')}</div>
      <div class="ord-meta">
        <div class="ord-top"><span class="ord-id">${esc(o.id)}</span><span class="mp-status">${esc(o.status)}</span></div>
        <div class="ord-name">${esc(o.name)}</div>
        <div class="ord-sub">${esc(o.brand)} · ${esc(o.option)} · ${o.qty}개</div>
      </div>
      <div class="ord-right">
        <div class="ord-total">${money(o.total, orderCur(o))}</div>
        <div class="ord-date">${new Date(o.orderedAt).toLocaleDateString()}</div>
      </div>
      ${icon('i-chev-r', 'ic s ord-go')}
    </a>`).join('')}</div>`;
}

export async function pageOrderDetail(id: string) {
  await refreshMe();
  if (!me) { location.hash = '#/login'; return; }
  const orders = (await api('/api/orders').catch(() => [])) as Order[];
  const o = orders.find((x) => x.id === id);
  if (!o) return page404();
  const stepIdx = Math.max(0, STATUS_STEPS.indexOf(o.status));
  const b = o.breakdown;
  root().innerHTML = `
    <section class="page-section page-top narrow">
      <a class="crumb" href="#/orders">${icon('i-chev-r', 'ic s flip')} 주문 내역</a>
      <div class="page-head" data-d3="head">
        <h1 class="page-title">${esc(o.name)}</h1>
        <p class="page-desc">${esc(o.id)} · ${new Date(o.orderedAt).toLocaleString()}</p>
      </div>

      <div class="ord-steps">
        ${STATUS_STEPS.map((s, i) => `
          <div class="ord-step ${i <= stepIdx ? 'done' : ''} ${i === stepIdx ? 'cur' : ''}">
            <span class="dot">${i <= stepIdx ? icon('i-check', 'ic s') : i + 1}</span>
            <span class="lb">${s}</span>
          </div>`).join('')}
      </div>

      <div class="ord-detail">
        <div class="ord-detail-art" style="background-image:url(${esc(o.artwork || '')})"></div>
        <table class="mp-table ord-table"><tbody>
          <tr><th>상품</th><td>${esc(o.name)}</td></tr>
          <tr><th>아티스트</th><td>${esc(o.brand)}</td></tr>
          <tr><th>사양</th><td>${esc(o.option)}</td></tr>
          <tr><th>수량</th><td>${o.qty}개</td></tr>
          <tr><th>단가</th><td>${money(o.unit ?? Math.round(o.total / o.qty), orderCur(o))}</td></tr>
          <tr><th>결제 금액</th><td><b>${money(o.total, orderCur(o))}</b> <span class="dim">(데모 크레딧)</span></td></tr>
          ${orderCur(o) === 'JPY' && o.chargedKrw
            ? `<tr><th>크레딧 차감</th><td>₩${o.chargedKrw.toLocaleString()} <span class="dim">엔화 주문 · 실시간 환율 환산</span></td></tr>`
            : ''}
          <tr><th>상태</th><td><span class="mp-status">${esc(o.status)}</span></td></tr>
        </tbody></table>
      </div>

      ${b ? `
      <div class="mp-section">
        <h3>가격 산출 내역</h3>
        <table class="calc-table on-dark"><tbody>
          <tr><th>현지 정가</th><td>${b.localCurrency === 'KRW' ? '₩' : '¥'}${(b.localAmount ?? b.jpy ?? 0).toLocaleString()}</td><td class="calc-src">주문 시점 기준</td></tr>
          <tr><th>적용 환율</th><td>× ${b.rate}</td><td class="calc-src">${esc(b.rateDate || '')}</td></tr>
          <tr><th>상품 원가</th><td>${money(b.base, orderCur(o))}</td><td class="calc-src"></td></tr>
          <tr><th>대행 수수료</th><td>+ ${money(b.fee, orderCur(o))}</td><td class="calc-src">${Math.round(b.feeRate * 100)}%</td></tr>
          <tr><th>국제배송 분담</th><td>+ ${money(b.shipping, orderCur(o))}</td><td class="calc-src">합배송</td></tr>
          <tr class="calc-total"><th>단가</th><td>${money(b.total, orderCur(o))}</td><td class="calc-src"></td></tr>
        </tbody></table>
      </div>` : ''}

      <div class="ord-actions">
        <a class="btn-out" href="#/store/${esc(o.productId)}">상품 페이지</a>
        <a class="btn-out" href="#/orders">목록으로</a>
      </div>
      <p class="pd-note">데모 주문입니다. 실제 결제·배송·취소는 이루어지지 않습니다.</p>
    </section>`;
}

/* ================= Focus Desk ================= */
type FocusMix = {
  id: string; title: string; creator: string; videoId: string; tone: string;
  energy: number; vocal: boolean; bestFor: string[]; color: string;
};
type FocusSession = {
  mixId: string; title: string; reason: string;
  plan: { minute: number; label: string }[];
};

let focusTimerId: number | undefined;
let focusEndsAt = 0;
let focusNativeHandler: ((event: Event) => void) | null = null;
/* 저장된 값이 없으면 72%로 시작한다.
   Number(null)은 0이고 0은 isFinite·범위 검사를 모두 통과하므로,
   getItem 결과를 바로 Number()에 넣으면 기본값 분기가 영영 실행되지 않는다.
   그 결과 처음 들어온 사용자가 무음으로 시작하게 된다. */
const savedFocusVolumeRaw = localStorage.getItem('lilac.workVolume');
const savedFocusVolume = savedFocusVolumeRaw === null || savedFocusVolumeRaw.trim() === ''
  ? Number.NaN
  : Number(savedFocusVolumeRaw);
let focusPreferredVolume = Number.isFinite(savedFocusVolume) && savedFocusVolume >= 0 && savedFocusVolume <= 100
  ? Math.round(savedFocusVolume)
  : 72;

function focusPostNative(message: Record<string, unknown>) {
  const bridge = (window as unknown as { webkit?: { messageHandlers?: { lilac?: { postMessage: (v: unknown) => void } } } }).webkit;
  bridge?.messageHandlers?.lilac?.postMessage(message);
}

function focusPlayerCommand(func: string, args: unknown[] = []) {
  const frame = document.getElementById('focusPlayer') as HTMLIFrameElement | null;
  frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube-nocookie.com');
}

function focusSetVolume(volume: number, restoreAfter = 0, ducking = false) {
  const next = Math.max(0, Math.min(100, Math.round(volume)));
  focusPlayerCommand('setVolume', [next]);
  const range = document.getElementById('focusVolume') as HTMLInputElement | null;
  const output = document.getElementById('focusVolumeValue');
  if (range) range.value = String(next);
  if (output) output.textContent = `${next}%`;
  document.querySelector('.focus-shell')?.classList.toggle('ducking', ducking);
  if (restoreAfter) window.setTimeout(() => {
    focusSetVolume(focusPreferredVolume);
  }, restoreAfter);
}

function focusClock(seconds: number) {
  const s = Math.max(0, seconds);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export async function pageFocus() {
  clearInterval(focusTimerId);
  if (focusNativeHandler) window.removeEventListener('lilac:native-command', focusNativeHandler);
  const data = await api('/api/focus/mixes').catch(() => ({ mixes: [], aiConfigured: false, model: 'gpt-5.4' }));
  const mixes = data.mixes as FocusMix[];
  const initial = mixes[0];
  if (!initial) throw new Error('focus mixes unavailable');

  root().innerHTML = `
    <section class="focus-shell work-shell page-top" style="--focus-tone:${esc(initial.color)}">
      <div class="focus-aurora" aria-hidden="true"></div>
      <header class="work-head">
        <div>
          <h1>워크 모드</h1>
          <p>할 일과 시간을 정하면 음악 선택부터 알림 볼륨까지 한 흐름으로 이어집니다.</p>
        </div>
        <div class="work-protection"><span class="focus-status-dot"></span><b>스마트 볼륨 사용 중</b><small>Slack · 미팅 · 개발 도구 알림 감지</small></div>
      </header>

      <div class="focus-grid work-grid">
        <section class="focus-player-card work-player-card">
          <div class="focus-video">
            <iframe id="focusPlayer" title="${esc(initial.title)}" src="https://www.youtube-nocookie.com/embed/${esc(initial.videoId)}?enablejsapi=1&playsinline=1&rel=0&origin=${encodeURIComponent(location.origin)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
            <div class="focus-duck-pill"><span></span> 알림이 지나갈 때까지 볼륨을 낮췄어요</div>
          </div>
          <div class="focus-now">
            <div><h2 id="focusNowTitle">${esc(initial.title)}</h2><p id="focusNowCreator">${esc(initial.creator)} · YouTube</p></div>
            <div class="focus-session-clock"><span id="focusClock">45:00</span><small id="focusClockLabel">시작 전</small></div>
          </div>
          <div class="focus-actions">
            <button class="focus-primary" id="focusStart">45분 작업 시작</button>
            <button class="focus-quiet" id="focusTestDuck">스마트 볼륨 확인</button>
            <label class="focus-volume" aria-label="YouTube 볼륨">
              ${icon('i-vol', 'ic s')}
              <input id="focusVolume" type="range" min="0" max="100" value="${focusPreferredVolume}"/>
              <output id="focusVolumeValue" for="focusVolume">${focusPreferredVolume}%</output>
            </label>
          </div>
        </section>

        <aside class="focus-curator work-setup">
          <h2>오늘 끝낼 일</h2>
          <p class="focus-curator-copy">업무를 적으면 GPT-5.4가 검증된 믹스와 시간 흐름을 골라줍니다.</p>
          <textarea id="focusTask" maxlength="240" placeholder="예: 투자자 피치덱 초안을 45분 안에 정리하기"></textarea>
          <label>작업 흐름</label>
          <div class="focus-mode-row" role="group" aria-label="작업 흐름">
            <button data-focus-mode="deep">차분하게</button>
            <button class="on" data-focus-mode="balanced">균형 있게</button>
            <button data-focus-mode="energy">빠르게</button>
          </div>
          <label>작업 시간</label>
          <div class="focus-duration-row" role="group" aria-label="작업 시간">
            ${[25, 45, 60, 90].map((m) => `<button class="${m === 45 ? 'on' : ''}" data-focus-minutes="${m}">${m}분</button>`).join('')}
          </div>
          <button class="focus-ai-btn" id="focusCurate"><span>✦</span> 내 작업에 맞추기</button>
          <div class="focus-ai-result" id="focusAiResult">
            <small>${data.aiConfigured ? `Letsur · ${esc(data.model)} 연결됨` : '기본 추천으로 바로 사용할 수 있어요'}</small>
            <p>입력한 업무는 추천을 만드는 데만 사용합니다.</p>
          </div>
        </aside>
      </div>

      <section class="focus-mixes-sec work-mixes-sec">
        <div class="focus-sec-head"><div><h2>바로 재생하기</h2><p>업무 중 오래 들어도 흐름을 끊지 않는 YouTube 믹스입니다.</p></div></div>
        <div class="focus-mix-grid">
          ${mixes.map((m, i) => `<button class="focus-mix ${i === 0 ? 'on' : ''}" data-focus-mix="${esc(m.id)}" style="--mix:${esc(m.color)}">
            <span class="focus-mix-art" style="background-image:url(https://i.ytimg.com/vi/${esc(m.videoId)}/hqdefault.jpg)"><i>${m.vocal ? '보컬 있음' : '보컬 없음'}</i></span>
            <span class="focus-mix-meta"><b>${esc(m.title)}</b><small>${esc(m.creator)}</small><em>${m.bestFor.map(esc).join(' · ')}</em></span>
            <span class="focus-energy"><i style="width:${m.energy}%"></i></span>
          </button>`).join('')}
        </div>
      </section>

      <section class="focus-native-sec work-native-sec">
        <div class="focus-native-copy">
          <h2>Mac에서는<br/>더 자연스럽게</h2>
          <p>컴퓨터를 켜면 메뉴바에서 바로 재생하고, 회의나 업무 알림이 오면 음악이 먼저 자리를 비웁니다.</p>
        </div>
        <div class="focus-menubar-demo">
          <div class="fmd-top"><b>Lilac</b><span>⌁</span></div>
          <div class="fmd-track"><span class="fmd-art"></span><div><b id="focusMenuTitle">${esc(initial.title)}</b><p id="focusMenuCreator">${esc(initial.creator)}</p></div></div>
          <div class="fmd-controls"><button>이전</button><button class="main">▶</button><button>다음</button></div>
          <div class="fmd-rule"><span>업무 알림에 맞춰 볼륨 낮추기</span><i>켬</i></div>
          <div class="fmd-rule"><span>Mac을 켤 때 함께 시작</span><i>켬</i></div>
        </div>
        <div class="focus-native-points">
          <div><span>⌁</span><b>열어둘 필요 없이</b><p>메뉴바에서 재생과 세션을 제어합니다.</p></div>
          <div><span>◒</span><b>알림은 놓치지 않게</b><p>회의와 업무 앱이 활성화되면 볼륨을 낮춥니다.</p></div>
          <div><span>↗</span><b>업무로 바로 돌아오게</b><p>알림이 끝나면 원래 볼륨으로 복원합니다.</p></div>
        </div>
      </section>
    </section>`;

  let selected = initial;
  let selectedMode = 'balanced';
  let selectedMinutes = 45;
  let focusIsPlaying = false;

  const focusFrame = $('#focusPlayer') as HTMLIFrameElement;
  focusFrame.addEventListener('load', () => window.setTimeout(() => focusSetVolume(focusPreferredVolume), 350));

  $('#focusVolume').addEventListener('input', (event) => {
    focusPreferredVolume = Number((event.currentTarget as HTMLInputElement).value) || 0;
    localStorage.setItem('lilac.workVolume', String(focusPreferredVolume));
    focusSetVolume(focusPreferredVolume);
  });

  const selectMix = (mix: FocusMix, autoplay = true) => {
    selected = mix;
    document.querySelectorAll('.focus-mix').forEach((el) => el.classList.toggle('on', (el as HTMLElement).dataset.focusMix === mix.id));
    const shell = document.querySelector<HTMLElement>('.focus-shell');
    if (shell) shell.style.setProperty('--focus-tone', mix.color);
    $('#focusNowTitle').textContent = mix.title;
    $('#focusNowCreator').textContent = `${mix.creator} · YouTube`;
    $('#focusMenuTitle').textContent = mix.title;
    $('#focusMenuCreator').textContent = mix.creator;
    const frame = $('#focusPlayer') as HTMLIFrameElement;
    frame.title = mix.title;
    frame.src = `https://www.youtube-nocookie.com/embed/${mix.videoId}?enablejsapi=1&playsinline=1&rel=0&origin=${encodeURIComponent(location.origin)}${autoplay ? '&autoplay=1' : ''}`;
    focusIsPlaying = autoplay;
    focusPostNative({ type: 'nowPlaying', title: mix.title, artist: mix.creator, playing: autoplay });
  };

  document.querySelectorAll<HTMLButtonElement>('[data-focus-mix]').forEach((button) => button.addEventListener('click', () => {
    const mix = mixes.find((m) => m.id === button.dataset.focusMix);
    if (mix) selectMix(mix);
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-focus-mode]').forEach((button) => button.addEventListener('click', () => {
    selectedMode = button.dataset.focusMode || 'balanced';
    document.querySelectorAll('[data-focus-mode]').forEach((el) => el.classList.toggle('on', el === button));
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-focus-minutes]').forEach((button) => button.addEventListener('click', () => {
    selectedMinutes = Number(button.dataset.focusMinutes) || 45;
    $('#focusClock').textContent = focusClock(selectedMinutes * 60);
    $('#focusStart').textContent = `${selectedMinutes}분 작업 시작`;
    document.querySelectorAll('[data-focus-minutes]').forEach((el) => el.classList.toggle('on', el === button));
  }));

  const startSession = () => {
    focusEndsAt = Date.now() + selectedMinutes * 60_000;
    $('#focusClockLabel').textContent = '작업 중';
    $('#focusStart').textContent = '세션 종료';
    $('#focusStart').classList.add('running');
    focusPlayerCommand('playVideo');
    focusIsPlaying = true;
    focusPostNative({ type: 'session', minutes: selectedMinutes, title: selected.title });
    clearInterval(focusTimerId);
    focusTimerId = window.setInterval(() => {
      const clock = document.getElementById('focusClock');
      if (!clock) return clearInterval(focusTimerId);
      const left = Math.max(0, Math.ceil((focusEndsAt - Date.now()) / 1000));
      clock.textContent = focusClock(left);
      if (!left) {
        clearInterval(focusTimerId);
        $('#focusClockLabel').textContent = '완료';
        $('#focusStart').textContent = `${selectedMinutes}분 다시 시작`;
        $('#focusStart').classList.remove('running');
        focusPlayerCommand('pauseVideo');
        focusIsPlaying = false;
        toast('작업 세션을 마쳤습니다');
        focusPostNative({ type: 'sessionComplete' });
      }
    }, 1000);
  };

  $('#focusStart').addEventListener('click', () => {
    if ($('#focusStart').classList.contains('running')) {
      clearInterval(focusTimerId); focusEndsAt = 0;
      $('#focusClock').textContent = focusClock(selectedMinutes * 60);
      $('#focusClockLabel').textContent = '시작 전';
      $('#focusStart').textContent = `${selectedMinutes}분 작업 시작`;
      $('#focusStart').classList.remove('running');
      focusPlayerCommand('pauseVideo');
      focusIsPlaying = false;
      focusPostNative({ type: 'sessionStopped' });
    } else startSession();
  });
  $('#focusTestDuck').addEventListener('click', () => {
    focusSetVolume(18, 2600, true);
    toast(`알림 중에는 18%로 낮추고 ${focusPreferredVolume}%로 복원합니다`);
  });

  $('#focusCurate').addEventListener('click', async () => {
    const button = $('#focusCurate') as HTMLButtonElement;
    const task = ($('#focusTask') as HTMLTextAreaElement).value.trim();
    button.disabled = true; button.innerHTML = '<span>✦</span> 세션 구성 중…';
    try {
      const result = await api('/api/ai/focus-session', { method: 'POST', body: JSON.stringify({ task, mode: selectedMode, minutes: selectedMinutes }) });
      const session = result.session as FocusSession;
      const mix = mixes.find((m) => m.id === session.mixId) || selected;
      selectMix(mix, false);
      $('#focusAiResult').innerHTML = `
        <small>${result.source === 'letsur' ? `Letsur · ${esc(result.model || 'gpt-5.4')}` : '기본 추천'}</small>
        <h3>${esc(session.title.replace('집중 세션', '작업 세션'))}</h3><p>${esc(session.reason)}</p>
        <ol>${session.plan.map((p) => `<li><b>${p.minute}분</b><span>${esc(p.label)}</span></li>`).join('')}</ol>`;
      toast('작업 세션이 준비됐습니다');
    } catch (error) { toast((error as Error).message || '추천을 만들지 못했습니다'); }
    finally { button.disabled = false; button.innerHTML = '<span>✦</span> 다시 맞추기'; }
  });

  focusNativeHandler = (event: Event) => {
    const command = String((event as CustomEvent<string>).detail || '');
    if (command === 'toggle') {
      focusPlayerCommand(focusIsPlaying ? 'pauseVideo' : 'playVideo');
      focusIsPlaying = !focusIsPlaying;
      focusPostNative({ type: 'nowPlaying', title: selected.title, artist: selected.creator, playing: focusIsPlaying });
    }
    else if (command === 'pause') {
      focusPlayerCommand('pauseVideo'); focusIsPlaying = false;
      focusPostNative({ type: 'nowPlaying', title: selected.title, artist: selected.creator, playing: false });
    }
    else if (command === 'prev' || command === 'next') {
      const i = mixes.findIndex((m) => m.id === selected.id);
      const offset = command === 'next' ? 1 : -1;
      selectMix(mixes[(i + offset + mixes.length) % mixes.length]);
    }
    else if (command.startsWith('duck:')) focusSetVolume(Number(command.split(':')[1]) || 18, 0, true);
    else if (command === 'restore') focusSetVolume(focusPreferredVolume);
    else if (command.startsWith('session:')) {
      selectedMinutes = Number(command.split(':')[1]) || 45;
      $('#focusClock').textContent = focusClock(selectedMinutes * 60);
      startSession();
    }
  };
  window.addEventListener('lilac:native-command', focusNativeHandler);
  focusPostNative({ type: 'ready', title: initial.title, artist: initial.creator });
}

/* ================= 서비스 안내 ================= */
export function pageHelp() {
  // 색인 규모는 자동 갱신되므로 하드코딩하지 않고 서버에 물어본다
  setTimeout(async () => {
    const el = document.getElementById('idxCount');
    if (!el) return;
    try {
      const s = await api('/api/index/status') as { count: number; ageHours: number | null };
      el.textContent = `${s.count.toLocaleString()}개 표기 · ${s.ageHours === null ? '갱신 이력 없음' : s.ageHours < 1 ? '방금 갱신' : `${Math.round(s.ageHours)}시간 전 갱신`}`;
    } catch { el.textContent = '조회 실패'; }
  }, 0);

  root().innerHTML = `
    <section class="page-section page-top narrow">
      <div class="page-head" data-d3="head">
        <h1 class="page-title">Lilac 소개 · 데이터 출처</h1>
        <p class="page-desc">이 데모가 어떤 데이터를 쓰고 무엇이 실제이며 무엇이 데모인지 정리했습니다.</p>
      </div>

      <div class="help-sec">
        <h3>무엇을 하는 서비스인가요</h3>
        <p>한국의 J-POP 팬과 일본의 K-POP 팬을 잇는 크로스보더 팬덤 플랫폼입니다.
          음원 스트리밍만으로는 채워지지 않는 <b>정보 · 커머스 · 일정</b>을 한 곳에 모으고,
          해외 배송이 지원되지 않는 현지 한정반을 정식 루트로 공동구매합니다.</p>
      </div>

      <div class="help-sec">
        <h3>실제 데이터</h3>
        <table class="help-table"><tbody>
          <tr><th>차트</th><td>Apple Music 국가별 최다 재생 · Billboard JAPAN HOT 100 · 오리콘 주간 싱글 · YouTube 공식 MV 조회수</td></tr>
          <tr><th>카탈로그</th><td>Apple Music 검색 API (제목 · 아티스트 · 앨범 · 아트워크 · 30초 미리듣기 · 재생시간)</td></tr>
          <tr><th>상품</th><td>Apple Music 카탈로그 기반 실제 앨범 100종 (발매일 · 수록곡 수 · 디지털 정가)</td></tr>
          <tr><th>환율</th><td>frankfurter.app 실시간 JPY→KRW</td></tr>
          <tr><th>발매 일정</th><td>Apple Music 카탈로그 발매일 자동 수집</td></tr>
          <tr><th>아티스트 지표</th><td>공식 뮤직비디오 누적 조회수 실측 합산</td></tr>
          <tr><th>한글 검색</th><td>일본어 표기의 읽기를 형태소 분석으로 자동 생성해 색인 (<span id="idxCount">…</span>)</td></tr>
          <tr><th>수집 현황</th><td><a href="#/status">서비스 상태 페이지</a>에서 각 소스의 마지막 수집 시각을 확인할 수 있습니다.</td></tr>
        </tbody></table>

        <h2>한글로 일본곡을 찾는 방법</h2>
        <p class="help-note">「ライラック」을 <b>라일락</b>, 「群青」을 <b>군조</b>로 검색할 수 있습니다. 세 단계로 처리합니다.</p>
        <table class="help-table"><tbody>
          <tr><th>1. 음역</th><td>한글을 로마자를 거쳐 가타카나로 변환합니다. ㄹ받침↔ラ행, 시↔shi, 삽입모음 '으', 유·무성 차이를 흡수합니다. <b>라일락 → ライラック</b></td></tr>
          <tr><th>2. 읽기 색인</th><td>차트·상품·아티스트 디스코그래피의 일본어 표기를 형태소 분석해 읽기를 만들어 둡니다. 하루 한 번 자동 갱신되므로 신곡도 별도 등록 없이 검색됩니다. <b>群青 → グンジョウ → 군조</b></td></tr>
          <tr><th>3. 수동 예외</th><td>발음이 아니라 뜻으로 부르는 곡(<b>봄도둑 = 春泥棒</b>)과 사전형과 다른 특수 읽기(<b>晴る는 ハレル이 아닌 ハル</b>)만 사람이 등록합니다.</td></tr>
        </tbody></table>
        <p class="help-note">한계: 추적 아티스트 밖의 한자 제목은 읽기를 정확히 입력해야 찾을 수 있고, 뜻으로 부르는 곡은 등록된 것만 검색됩니다.</p>
      </div>

      <div class="help-sec">
        <h3>아직 실제가 아닌 것</h3>
        <ul class="pd-ul">
          <li>피지컬 CD 정가: 판매처 확인분은 실제 가격이고, 나머지는 일본 CD 통상가 기준 <b>추정치</b>로 화면에 구분해 표시합니다.</li>
          <li>결제(크레딧) · 배송 상태: 데모 값이며 실제 거래가 일어나지 않습니다. PG 미연동입니다.</li>
          <li>재고: 표시하지 않습니다. 판매처 재고를 조회할 방법이 없어 지어내지 않습니다.</li>
          <li>내한 · 원정 공연 일정: 공개 API가 없어 넣지 않았습니다. 예시로 채우지 않습니다.</li>
          <li>가사: 라이선스 문제로 자체 제작 문구를 표시합니다.</li>
        </ul>
      </div>

      <div class="help-sec">
        <h3>판매가는 이렇게 계산됩니다</h3>
        <p class="mono-ish">일본 정가(¥) × 실시간 환율 + 대행 수수료(싱글 10% / 앨범 12% / 한정반 15%) + 국제배송 분담 3,500원 → 100원 단위 올림</p>
        <p class="dim">모든 상품 상세 페이지에서 이 계산 과정을 항목별로 확인할 수 있습니다.</p>
      </div>

      <div class="help-sec">
        <h3>하지 않는 것</h3>
        <p>티켓 재판매(암표)를 중개하지 않습니다. 일본은 2019년부터 입장권 부정전매를 법으로 금지하고 있어,
          Lilac은 공식 유통·응모 창구와 연결하는 역할만 합니다.</p>
      </div>

      <div class="ord-actions">
        <a class="btn-out" href="#/">홈으로</a>
        <a class="btn-out" href="#/store">스토어</a>
      </div>
    </section>`;
}

/* ================= 인증 ================= */
export function pageLogin() {
  root().innerHTML = `
    <div class="auth-wrap page-top">
      <form class="auth-card" id="loginForm">
        <p class="auth-logo">Lilac</p>
        <h1 class="auth-title">${t('auth.login.title')}</h1>
        <label>${t('auth.email')}<input name="email" type="email" required placeholder="you@example.com" /></label>
        <label>${t('auth.password')}<input name="password" type="password" required placeholder="••••••••" /></label>
        <button class="btn-pill" type="submit">${t('login')}</button>
        <a class="auth-alt" href="#/signup">${t('auth.toSignup')}</a>
      </form>
    </div>`;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    try {
      const { token } = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }) });
      setToken(token);   // 이걸 빠뜨리면 이후 요청이 전부 비로그인으로 나간다
      await refreshMe(); document.dispatchEvent(new CustomEvent('lilac:me'));
      toast('로그인 완료'); location.hash = '#/';
    } catch (err) { toast((err as Error).message); }
  });
}
export function pageSignup() {
  root().innerHTML = `
    <div class="auth-wrap page-top">
      <form class="auth-card" id="signupForm">
        <p class="auth-logo">Lilac</p>
        <h1 class="auth-title">${t('auth.signup.title')}</h1>
        <label>${t('auth.name')}<input name="name" required placeholder="라일락" /></label>
        <label>${t('auth.email')}<input name="email" type="email" required placeholder="you@example.com" /></label>
        <label>${t('auth.password')}<input name="password" type="password" required minlength="8" placeholder="8자 이상" /></label>
        <button class="btn-pill" type="submit">${t('signup')}</button>
        <p class="pd-note">가입 시 데모 웰컴 크레딧 5,000이 지급됩니다. 데이터는 로컬 폴더(db/users.json)에만 저장됩니다.</p>
        <a class="auth-alt" href="#/login">${t('auth.toLogin')}</a>
      </form>
    </div>`;
  $('#signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    try {
      const { token } = await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ name: fd.get('name'), email: fd.get('email'), password: fd.get('password') }) });
      setToken(token);
      await refreshMe(); document.dispatchEvent(new CustomEvent('lilac:me'));
      toast('가입 완료. 웰컴 크레딧 5,000 지급'); location.hash = '#/';
    } catch (err) { toast((err as Error).message); }
  });
}

/* ================= 마이페이지 ================= */
export async function pageAccount() {
  await refreshMe();
  if (!me) { location.hash = '#/login'; return; }
  const [orders, likes, lists, oshi] = await Promise.all([
    api('/api/orders').catch(() => []), api('/api/likes').catch(() => []),
    api('/api/playlists').catch(() => []), api('/api/oshi').catch(() => []),
  ]);
  const joined = new Date(me.createdAt).toLocaleDateString();
  root().innerHTML = `
    <section class="mp-hero">
      <div class="mp-avatar">${esc(me.name[0])}</div>
      <div class="mp-info">
        <h1 class="mp-name">${esc(me.name)}</h1>
        <p class="sp-meta">${esc(me.email)}<span class="sep">·</span>플레이리스트 ${lists.length}개<span class="sep">·</span>팔로우 ${oshi.length}명<span class="sep">·</span>가입 ${joined}</p>
      </div>
    </section>
    <section class="page-section">
      <div class="mp-cards">
        <div class="mp-card accent">
          <p class="mp-k">${t('acct.plan')}</p>
          <p class="mp-v">${esc(me.plan.name)}</p>
          <p class="mp-s">${me.plan.renewsAt ? `갱신일 ${me.plan.renewsAt}` : '무료 플랜 이용 중'}</p>
          ${me.plan.tier === 'free' ? `<button class="btn-pill sm" id="acUpgrade">${t('acct.upgrade')}</button>` : ''}
        </div>
        <div class="mp-card">
          <p class="mp-k">${t('acct.credits')}</p>
          <p class="mp-v num">${me.credits.toLocaleString()}</p>
          <p class="mp-s">예약 주문 시 차감됩니다</p>
          <button class="btn-ghost-sm" id="acTopup">${t('acct.topup')}</button>
        </div>
        <div class="mp-card">
          <p class="mp-k">${t('lib.likes')}</p>
          <p class="mp-v num">${likes.length}</p>
          <p class="mp-s">저장한 곡</p>
          <a class="btn-ghost-sm" href="#/library/likes">보관함으로</a>
        </div>
      </div>

      <div class="mp-section">
        <h3>계정 설정</h3>
        <div class="mp-row"><span class="mp-label">${t('auth.name')}</span>
          <span class="mp-field"><input id="acName" value="${esc(me.name)}" /></span>
          <button class="btn-ghost-sm" id="acSaveName">저장</button></div>
        <div class="mp-row"><span class="mp-label">${t('auth.email')}</span><span class="mp-field dim">${esc(me.email)}</span><span></span></div>
        <div class="mp-row"><span class="mp-label">${t('acct.language')}</span><span class="mp-field dim">${esc(me.language)}</span>
          <span class="mp-hint">우측 상단 지구본에서 변경</span></div>
      </div>

      <div class="mp-section">
        <h3>${t('acct.payment')}</h3>
        ${me.paymentMethods.length
          ? me.paymentMethods.map((c) => `<div class="mp-row"><span class="mp-label">${esc(c.brand)}</span><span class="mp-field num">•••• •••• •••• ${esc(c.last4)}</span><span></span></div>`).join('')
          : '<p class="mp-empty">등록된 결제 수단이 없습니다</p>'}
        <button class="btn-ghost-sm" id="acAddCard">${t('acct.addCard')}</button>
      </div>

      <div class="mp-section">
        <h3>${t('acct.orders')} <a class="sec-link" href="#/orders" style="margin-left:8px">전체보기</a></h3>
        ${orders.length ? `
        <table class="mp-table">
          <thead><tr><th>주문번호</th><th>상품</th><th>옵션</th><th>수량</th><th>결제</th><th>상태</th><th>주문일</th></tr></thead>
          <tbody>${orders.map((o: { id: string; name: string; brand: string; option: string; qty: number; total: number; status: string; orderedAt: string; breakdown?: { buyerCurrency?: string; localCurrency?: string } }) => `
            <tr><td class="num">${o.id}</td><td><b>${esc(o.name)}</b><br/><span class="dim">${esc(o.brand)}</span></td>
            <td>${esc(o.option)}</td><td class="num">${o.qty}</td><td class="num">${money(o.total, orderCur(o))}</td>
            <td><span class="mp-status">${esc(o.status)}</span></td><td class="dim num">${new Date(o.orderedAt).toLocaleDateString()}</td></tr>`).join('')}
          </tbody></table>` : '<p class="mp-empty">주문 내역이 없습니다</p>'}
      </div>

      <button class="btn-ghost-sm danger" id="acLogout">${t('logout')}</button>
    </section>`;
  $('#acSaveName').addEventListener('click', async () => {
    await api('/api/me', { method: 'PATCH', body: JSON.stringify({ name: ($('#acName') as HTMLInputElement).value }) });
    await refreshMe(); document.dispatchEvent(new CustomEvent('lilac:me')); toast('저장되었습니다');
  });
  $('#acTopup').addEventListener('click', () => {
    /* 고정 금액 대신 선택지를 준다 — 실서비스 충전 UX의 최소형 */
    document.getElementById('nameModal')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'nameModal';
    wrap.className = 'modal show name-modal';
    wrap.setAttribute('role', 'dialog');
    wrap.innerHTML = `
      <div class="modal-card nm-card">
        <h3 class="nm-title">크레딧 충전 (데모)</h3>
        <p class="nm-msg dim-sm">실제 결제 없이 즉시 충전됩니다.</p>
        <div class="topup-grid">
          ${[10000, 30000, 50000, 100000].map((a) => `<button class="topup-opt" data-amt="${a}">₩${a.toLocaleString()}</button>`).join('')}
        </div>
        <div class="nm-actions"><button class="btn-out nm-cancel" type="button">취소</button></div>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.querySelector('.nm-cancel')!.addEventListener('click', close);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.querySelectorAll<HTMLButtonElement>('.topup-opt').forEach((b) =>
      b.addEventListener('click', async () => {
        await api('/api/me', { method: 'PATCH', body: JSON.stringify({ action: 'topup', amount: Number(b.dataset.amt) }) });
        close();
        await refreshMe(); document.dispatchEvent(new CustomEvent('lilac:me'));
        toast(`₩${Number(b.dataset.amt).toLocaleString()} 충전 완료`);
        pageAccount();
      }));
  });
  $('#acUpgrade')?.addEventListener('click', async () => {
    await api('/api/me', { method: 'PATCH', body: JSON.stringify({ action: 'upgrade' }) });
    await refreshMe(); document.dispatchEvent(new CustomEvent('lilac:me')); pageAccount();
  });
  $('#acAddCard').addEventListener('click', async () => {
    const last4 = (await askName('카드 마지막 4자리 (데모)', '4242')) || '4242';
    await api('/api/me', { method: 'PATCH', body: JSON.stringify({ action: 'addCard', brand: 'VISA', last4 }) });
    pageAccount();
  });
  $('#acLogout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    setToken(null);   // 서버 세션과 함께 로컬 토큰도 파기
    await refreshMe(); document.dispatchEvent(new CustomEvent('lilac:me'));
    location.hash = '#/';
  });
}

/* ================= 통합 검색 =================
   곡 · 아티스트 · 상품 · 일정을 한 화면에서 찾는다. */
interface UniSearch {
  q: string;
  queries?: string[];
  translated?: string | null;
  counts: { tracks: number; artists: number; products: number; events: number };
  tracks: CatalogTrack[];
  artists: Artist[];
  products: Product[];
  events: Ev[];
  seedTracks: SeedTrack[];
}
const SR_TABS = [
  { k: 'all', label: '전체' }, { k: 'tracks', label: '곡' }, { k: 'artists', label: '아티스트' },
  { k: 'albums', label: '앨범' }, { k: 'products', label: '상품' }, { k: 'events', label: '일정' },
];

export async function pageSearch(q: string, tab = 'all') {
  if (!q) {
    root().innerHTML = `
      <section class="page-section page-top">
        <div class="page-head" data-d3="head"><p class="sp-label">검색</p><h1 class="page-title">무엇을 찾으세요?</h1>
          <p class="page-desc">곡·아티스트·앨범·굿즈·일정을 한 번에 검색합니다.</p></div>
        <div class="mood-grid" id="srBrowse"></div>
      </section>`;
    const moods = [
      { k: '애니 타이업', c: '#8b5cf6,#4c1d95', q: 'anime' }, { k: '심야 시티팝', c: '#0ea5e9,#0c4a6e', q: 'city pop' },
      { k: 'J-ROCK', c: '#ef4444,#7f1d1d', q: 'j-rock' }, { k: '보컬로이드', c: '#22d3ee,#155e75', q: 'vocaloid' },
      { k: '발라드', c: '#f59e0b,#7c2d12', q: 'ballad' }, { k: '초회반', c: '#ec4899,#831843', q: '初回' },
    ];
    $('#srBrowse').innerHTML = moods.map((m) => `
      <a class="mood d3-tilt" href="#/search?q=${encodeURIComponent(m.q)}" style="--m:linear-gradient(135deg,${m.c})" data-d3-tilt="10" data-d3="rise">
        <span class="mood-k">${m.k}</span><span class="mood-sq"></span></a>`).join('');
    bindTilt(root());
    return;
  }

  root().innerHTML = `
    <section class="page-section page-top">
      <div class="page-head" data-d3="head">
        <h1 class="page-title">${esc(q)}</h1>
        <div class="chips" id="srTabs">
          ${SR_TABS.map((s) => `<button class="chip ${s.k === tab ? 'on' : ''}" data-t="${s.k}">${s.label}</button>`).join('')}
        </div>
      </div>
      <div id="srBody" aria-live="polite">${skRows(6)}</div>
    </section>`;
  $('#srTabs').querySelectorAll<HTMLButtonElement>('.chip').forEach((b) =>
    b.addEventListener('click', () => pageSearch(q, b.dataset.t!)));

  const d = (await api(`/api/search?q=${encodeURIComponent(q)}`).catch(() => null)) as UniSearch | null;
  const body = document.getElementById('srBody');
  if (!d || !body) return;

  // 한글로 검색했을 때 어떤 일본어 표기로 찾았는지 알려준다
  const jaCands = (d.queries || []).filter((x) => /[ぁ-んァ-ヶ一-龥]/.test(x));
  if (jaCands.length) {
    document.querySelector('.page-head .page-title')?.insertAdjacentHTML('afterend',
      `<p class="sr-translit">일본어 표기 <b>${jaCands.slice(0, 2).map(esc).join('</b> · <b>')}</b> 로도 함께 검색했습니다</p>`);
  }

  // 탭 카운트 갱신
  const albumRes = await api(`/api/catalog/search?term=${encodeURIComponent(q)}&entity=album&limit=12`).catch(() => ({ albums: [] }));
  const albums = (albumRes.albums || []) as { id: number; title: string; artist: string; artwork: string; year: string; trackCount: number; appleUrl: string }[];
  const counts: Record<string, number> = {
    all: 0, tracks: d.tracks.length, artists: d.artists.length,
    albums: albums.length, products: d.products.length, events: d.events.length,
  };
  $('#srTabs').querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => {
    const k = b.dataset.t!;
    if (k !== 'all' && counts[k] === 0) b.classList.add('dim-chip');
    if (k !== 'all') b.innerHTML = `${SR_TABS.find((s) => s.k === k)!.label} <span class="chip-n">${counts[k]}</span>`;
  });

  const total = d.tracks.length + d.artists.length + albums.length + d.products.length + d.events.length;
  if (!total) {
    body.innerHTML = `<div class="empty-box">${icon('i-search', 'ic eb')}<p>‘${esc(q)}’ 결과가 없습니다</p>
      <span>아티스트명·곡명·앨범명으로 다시 시도해 보세요</span></div>`;
    return;
  }

  /* 섹션 빌더 */
  const artistShelf = (list: Artist[]) => `<div class="shelf d3-stage">${list.map((a) => `
    <a class="card round" href="#/artist/${a.id}" data-term="${esc(a.searchTerm)}">
      <div class="cover"><div class="ph">${esc(a.name[0])}</div><span class="glare"></span></div>
      <div class="c-title">${esc(a.name)}</div><div class="c-sub">${esc(a.genre)}</div></a>`).join('')}</div>`;

  const albumShelf = (list: typeof albums) => `<div class="shelf d3-stage">${list.map((al) => `
    <a class="card" href="${al.appleUrl}" target="_blank" rel="noopener">
      <div class="cover"><img src="${esc(al.artwork)}" alt="" loading="lazy" decoding="async"/><span class="glare"></span>
        </div>
      <div class="c-title">${esc(al.title)}</div><div class="c-sub">${esc(al.year)} · ${esc(al.artist)}</div></a>`).join('')}</div>`;

  const productGrid = (list: Product[]) => `<div class="store-dark-grid">${list.map((p) => `
    <a class="p-card d3-tilt" href="#/store/${p.id}" data-d3-tilt="7" data-d3="rise">
      <div class="p-img"><img src="${esc(p.artwork)}" alt="" loading="lazy" decoding="async"/></div>
      <div class="p-brand"><span class="p-ed">${esc(p.badge)}</span><span class="p-bn">${esc(p.brand)}</span></div><div class="p-name">${esc(p.name)}</div>
      <div class="p-price">₩${p.price.toLocaleString()}</div></a>`).join('')}</div>`;

  const eventList = (list: Ev[]) => `<div class="sch-rows">${list.map((e) => {
    const dd = Math.ceil((new Date(e.date).getTime() - Date.now()) / 864e5);
    return `<a class="sch-row" href="#/schedule">
      <div class="sch-date"><b>${new Date(e.date).getDate()}</b><span>${e.date.slice(5, 7)}월</span></div>
      <div class="sch-meta">
        <div class="sch-top"><span class="sch-type">${esc(e.type)}</span><span class="sch-dday ${dd >= 0 && dd <= 14 ? 'urgent' : ''}">${dd > 0 ? `D-${dd}` : dd === 0 ? 'D-DAY' : '종료'}</span></div>
        <div class="sch-title">${esc(schTitle(e))}</div>
        <div class="sch-sub"><b>${esc(e.artist)}</b> · ${esc(e.venue)}</div>
      </div>
      <span class="sch-go">${icon('i-chev-r')}</span></a>`;
  }).join('')}</div>`;

  const trackRows = (list: CatalogTrack[]) => {
    const rows = list.map((c) => toPlayable(c));
    return { html: trackTable(rows, { album: true, date: false }), rows };
  };

  const sec = (title: string, count: number, inner: string, more?: string) => count ? `
    <div class="sec-head sr-sec"><h2>${title}</h2><span class="sec-sub">${count}건</span>
      ${more ? `<button class="sec-link" data-more="${more}">더보기 ${icon('i-chev-r', 'ic s')}</button>` : ''}</div>
    ${inner}` : '';

  let html = '';
  if (tab === 'all') {
    const top = d.tracks[0];
    const localArtist = d.artists[0];
    html = `
      <div class="sr-top">
        ${top ? `<div class="sr-topcard" id="srTop" data-tilt="6">
          <p class="sr-toplabel">상위 결과</p>
          <img src="${esc(artUrl(top, 300))}" alt="" decoding="async"/>
          <h3>${esc(top.title)}</h3>
          <p>${esc(top.artist)}<span class="sr-kind">곡</span></p>
          <button class="play-big" id="srTopPlay" aria-label="상위 결과 재생">${icon('i-play')}</button>
          ${localArtist ? `<a class="sr-golink" href="#/artist/${localArtist.id}">아티스트 페이지 ${icon('i-chev-r', 'ic s')}</a>` : ''}
        </div>` : ''}
        <div class="sr-songs"><h3 class="sr-h">곡</h3><div id="srSongs"></div></div>
      </div>
      ${sec('아티스트', d.artists.length, artistShelf(d.artists.slice(0, 6)), d.artists.length > 6 ? 'artists' : '')}
      ${sec('앨범', albums.length, albumShelf(albums.slice(0, 6)), albums.length > 6 ? 'albums' : '')}
      ${sec('상품', d.products.length, productGrid(d.products.slice(0, 4)), d.products.length > 4 ? 'products' : '')}
      ${sec('일정', d.events.length, eventList(d.events.slice(0, 3)), d.events.length > 3 ? 'events' : '')}`;
  } else if (tab === 'tracks') html = '<div id="srSongs"></div>';
  else if (tab === 'artists') html = d.artists.length ? artistShelf(d.artists) : `<p class="loading">아티스트 결과가 없습니다</p>`;
  else if (tab === 'albums') html = albums.length ? albumShelf(albums) : `<p class="loading">앨범 결과가 없습니다</p>`;
  else if (tab === 'products') html = d.products.length ? productGrid(d.products) : `<p class="loading">상품 결과가 없습니다</p>`;
  else html = d.events.length ? eventList(d.events) : `<p class="loading">일정 결과가 없습니다</p>`;

  body.innerHTML = html;

  const songBox = document.getElementById('srSongs');
  if (songBox && d.tracks.length) {
    const { html: th, rows } = trackRows(tab === 'all' ? d.tracks.slice(0, 5) : d.tracks);
    songBox.innerHTML = th;
    bindTable(songBox, rows);
  }
  const top0 = d.tracks[0];
  $('#srTopPlay')?.addEventListener('click', (e) => { e.stopPropagation(); if (top0) playQueue([toPlayable(top0)], 0); });
  $('#srTop')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.sr-golink')) return;
    if (top0) playQueue([toPlayable(top0)], 0);
  });
  body.querySelectorAll<HTMLButtonElement>('[data-more]').forEach((b) =>
    b.addEventListener('click', () => pageSearch(q, b.dataset.more!)));
  fillShelfArts(body);
  bindTilt(body);
}

export function page404() {
  root().innerHTML = `<section class="page-section page-top"><div class="page-head" data-d3="head"><h1 class="page-title">페이지를 찾을 수 없습니다</h1></div><a class="btn-pill" href="#/">${t('nav.home')}</a></section>`;
}

/* 렌더 중 예외가 났을 때 보여줄 화면.
   지금까지는 이런 경우에도 404를 띄웠는데, 그러면 사용자는 주소를 잘못
   입력한 줄 안다. 백엔드가 죽었거나 네트워크가 끊긴 것과 '없는 주소'는
   원인도 대응도 다르다. 무엇을 확인해야 하는지 적고 다시 시도할 길을 준다. */
export function pageRenderError(detail?: string) {
  root().innerHTML = `
    <section class="page-section page-top">
      <div class="page-head" data-d3="head">
        <h1 class="page-title">화면을 불러오지 못했습니다</h1>
      </div>
      <p class="err-lead">데이터를 가져오는 중에 문제가 생겼습니다. 아래를 확인해 주세요.</p>
      <ul class="err-list">
        <li>백엔드가 실행 중인지 (<code>npm run dev</code>)</li>
        <li>네트워크 연결 상태</li>
        <li>계속 같은 화면이면 <a href="#/status">서비스 상태</a>에서 어느 소스가 끊겼는지 확인</li>
      </ul>
      ${detail ? `<p class="err-detail">${esc(detail)}</p>` : ''}
      <div class="err-actions">
        <button class="btn-pill" id="errRetry">다시 시도</button>
        <a class="btn-pill ghost" href="#/">홈으로</a>
      </div>
    </section>`;
  document.getElementById('errRetry')?.addEventListener('click', () => location.reload());
}


/* ================= 서비스 상태 =================
   외부 소스에 의존하는 서비스라 "지금 살아 있는가, 언제 수집한 데이터인가"가
   신뢰의 핵심이다. 낡았으면 낡았다고 그대로 표시한다. */

interface SvcRow {
  id: string; name: string; kind: string; ok: boolean;
  updatedAt: string | null; ageHours: number | null; detail: string;
  sources?: { country: string; source: string; count: number; ok: boolean }[];
}
interface StatusResp {
  now: string; uptimeSec: number; healthy: boolean; services: SvcRow[];
}

/** 경과 시간을 신선도로 환산 — 소스 종류마다 기대 주기가 다르다 */
function freshness(kind: string, ageHours: number | null): { level: 'fresh' | 'stale' | 'old' | 'na'; label: string } {
  if (ageHours === null) return { level: 'na', label: '상시' };
  const limit = kind === '실시간 API' ? 24 : 48;
  if (ageHours <= limit) return { level: 'fresh', label: `${ageHours < 1 ? '방금' : `${Math.round(ageHours)}시간 전`}` };
  if (ageHours <= limit * 3) return { level: 'stale', label: `${Math.round(ageHours / 24)}일 전` };
  return { level: 'old', label: `${Math.round(ageHours / 24)}일 전 (갱신 필요)` };
}

export async function pageStatus() {
  root().innerHTML = `
    <section class="page-section page-top narrow">
      <div class="page-head" data-d3="head">
        <h1 class="page-title">서비스 상태</h1>
        <p class="page-desc">Lilac은 외부 차트·카탈로그·환율에 의존합니다.
          각 소스가 마지막으로 언제 수집됐는지 그대로 보여줍니다.</p>
      </div>
      <div id="stBody"><div class="sk-block" style="height:220px"></div></div>
    </section>`;

  const d = (await api('/api/status').catch(() => null)) as StatusResp | null;
  const body = document.getElementById('stBody');
  if (!body) return;
  if (!d) {
    body.innerHTML = `<div class="empty-box">${icon('i-alert', 'ic eb')}<p>상태를 불러오지 못했습니다. 백엔드가 실행 중인지 확인해 주세요.</p></div>`;
    return;
  }

  const up = d.uptimeSec;
  const upTxt = up < 60 ? `${up}초` : up < 3600 ? `${Math.floor(up / 60)}분` : `${Math.floor(up / 3600)}시간 ${Math.floor((up % 3600) / 60)}분`;

  body.innerHTML = `
    <div class="svc-head ${d.healthy ? 'ok' : 'bad'}">
      <span class="svc-dot"></span>
      <div>
        <b>${d.healthy ? '모든 서비스 정상' : '일부 서비스 점검 필요'}</b>
        <span>백엔드 가동 ${upTxt} · ${new Date(d.now).toLocaleString('ko-KR')} 기준</span>
      </div>
    </div>
    <div class="svc-list">
      ${d.services.map((s) => {
        const f = freshness(s.kind, s.ageHours);
        return `<div class="svc-row ${s.ok ? '' : 'bad'}">
          <div class="svc-name">
            <span class="svc-state ${s.ok ? 'ok' : 'bad'}">${s.ok ? '정상' : '이상'}</span>
            <b>${esc(s.name)}</b>
            <span class="svc-kind">${esc(s.kind)}</span>
          </div>
          <div class="svc-detail">${esc(s.detail)}</div>
          <div class="svc-age ${f.level}">${esc(f.label)}</div>
        </div>
        ${s.sources?.length ? `<div class="svc-sub">${s.sources.map((x) =>
          `<span class="svc-chip ${x.ok ? '' : 'bad'}">${x.country === 'jp' ? '일본' : '한국'} ${esc(x.source)} <b>${x.count}</b></span>`).join('')}</div>` : ''}`;
      }).join('')}
    </div>
    <div class="svc-note">
      <h3>데이터가 낡으면 어떻게 되나요</h3>
      <p>수집기가 실패해도 이전 데이터를 유지합니다. 화면이 비는 대신 낡은 값이 보이므로,
        이 페이지에서 <b>마지막 수집 시각</b>을 함께 확인해 주세요.
        차트·상품은 하루 1회, 검색 색인은 수집 직후 자동 갱신됩니다.</p>
    </div>`;
}
