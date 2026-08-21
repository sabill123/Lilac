import { api, findCatalog, artUrl, esc, icon, me, refreshMe } from './api';
import type { Artist, SeedTrack, Ev, Product, CatalogTrack, PlayableTrack } from './api';
import { playQueue, openYt, toast } from './player';
import { applyTone } from './colors';
import { t } from './i18n';

/* ---- 스켈레톤 ---- */
const skRows = (n = 6) => `<div class="sk-list">${Array.from({ length: n }, () => `
  <div class="sk-row"><span class="sk sk-n"></span><span class="sk sk-art"></span>
  <span class="sk-tt"><span class="sk sk-l1"></span><span class="sk sk-l2"></span></span></div>`).join('')}</div>`;
const skCards = (n = 6, round = false) => `<div class="shelf">${Array.from({ length: n }, () => `
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
  ({ title: c.title, artist: c.artist, album: c.album, artwork: artUrl(c, 200), preview: c.preview, youtubeId: yt });

function dday(date: string) {
  const d = Math.ceil((new Date(date).getTime() - Date.now()) / 864e5);
  return { d, txt: d > 0 ? `D-${d}` : d === 0 ? 'D-DAY' : '종료' };
}
function relDate(iso?: string) {
  if (!iso) return '—';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? '오늘' : d === 1 ? '어제' : d < 30 ? `${d}일 전` : new Date(iso).toLocaleDateString();
}

/* ============ 공용: 스포티파이식 트랙 테이블 ============ */
function trackTable(rows: PlayableTrack[], opts: { date?: boolean; album?: boolean } = { date: true, album: true }) {
  return `
  <div class="sp-table ${opts.album === false ? 'no-al' : ''} ${opts.date === false ? 'no-dt' : ''}">
    <div class="t-head">
      <span class="t-num">#</span><span>제목</span>
      ${opts.album === false ? '' : '<span class="t-al">앨범</span>'}
      ${opts.date === false ? '' : '<span class="t-dt">추가한 날짜</span>'}
      <span class="t-du">${icon('i-clock', 'ic s')}</span>
    </div>
    ${rows.map((r, i) => `
    <div class="t-row" data-i="${i}">
      <span class="t-num"><span class="n">${i + 1}</span><span class="p">${icon('i-play')}</span></span>
      <span class="t-title"><img src="${esc(r.artwork || '')}" loading="lazy" alt=""/><span class="tt"><b>${esc(r.title)}</b><i>${esc(r.artist)}</i></span></span>
      ${opts.album === false ? '' : `<span class="t-al">${esc(r.album || '—')}</span>`}
      ${opts.date === false ? '' : `<span class="t-dt">${relDate(r.addedAt)}</span>`}
      <span class="t-du">0:30</span>
    </div>`).join('')}
  </div>`;
}
function bindTable(container: HTMLElement, rows: PlayableTrack[], onRemove?: (i: number) => void) {
  container.querySelectorAll<HTMLElement>('.t-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.t-x')) return;
      playQueue(rows, Number(row.dataset.i));
      container.querySelectorAll('.t-row').forEach((r) => { r.classList.remove('playing'); r.querySelector('.eq-slot')?.remove(); });
      row.classList.add('playing');
      row.querySelector('.t-num')!.insertAdjacentHTML('beforeend', `<span class="eq-slot"><span class="np-eq"><i></i><i></i><i></i></span></span>`);
    });
    if (onRemove) {
      row.insertAdjacentHTML('beforeend', `<button class="t-x" title="삭제">${icon('i-close')}</button>`);
      row.querySelector('.t-x')!.addEventListener('click', (e) => { e.stopPropagation(); onRemove(Number(row.dataset.i)); });
    }
  });
}

/* ============ 공용: 카드 셸프 ============ */
function shelf(cards: { title: string; sub: string; art?: string; round?: boolean; href: string; term?: string }[]) {
  return `<div class="shelf">${cards.map((c) => `
    <a class="card ${c.round ? 'round' : ''}" href="${c.href}" data-term="${esc(c.term || '')}" data-tilt="8" data-expand>
      <div class="cover">${c.art ? `<img src="${c.art}" alt="" loading="lazy"/>` : `<div class="ph">${esc(c.title[0] || '?')}</div>`}
        <span class="glare"></span>
        <button class="hover-play">${icon('i-play')}</button></div>
      <div class="c-title">${esc(c.title)}</div><div class="c-sub">${esc(c.sub)}</div>
    </a>`).join('')}</div>`;
}
function fillShelfArts(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('.card[data-term]').forEach(async (el) => {
    if (!el.dataset.term) return;
    const hit = await findCatalog(el.dataset.term);
    if (hit) el.querySelector('.cover')!.insertAdjacentHTML('afterbegin', `<img src="${artUrl(hit, 300)}" alt="" loading="lazy"/>`);
  });
}

/* ============ 공용: 랭킹 리스트 (차트/아티스트 인기곡) ============ */
function rankList(list: { rank: number; title: string; artist: string; artwork?: string; ytViews?: number; sources?: string[]; tag?: string; youtubeId?: string | null }[], opts: { big?: boolean } = {}) {
  return `<div class="rank-list ${opts.big ? 'big' : ''}">${list.map((e) => `
    <div class="rk-row" data-i="${e.rank - 1}">
      <span class="rk-n">${e.rank}</span>
      <div class="rk-art">${e.artwork ? `<img src="${e.artwork}" loading="lazy" alt=""/>` : ''}<span class="rk-ov">${icon('i-play')}</span></div>
      <div class="rk-meta"><div class="rk-t">${esc(e.title)}</div><div class="rk-a">${esc(e.artist)}</div></div>
      <div class="rk-side">
        ${e.tag ? `<span class="rk-tag">${esc(e.tag)}</span>` : ''}
        ${e.ytViews ? `<span class="rk-views">${(e.ytViews / 1e8).toFixed(2)}억</span>` : ''}
        ${e.sources ? `<span class="rk-src">${e.sources.map((s) => `<i class="src-dot ${s}"></i>`).join('')}</span>` : ''}
        ${e.youtubeId ? `<button class="rk-mv" data-yt="${e.youtubeId}" title="${t('mv')}">${icon('i-ext')}</button>` : ''}
      </div>
    </div>`).join('')}</div>`;
}
function bindRank(container: HTMLElement, entries: { title: string; artist: string; artwork?: string; searchTerm?: string; youtubeId?: string | null }[]) {
  container.querySelectorAll<HTMLButtonElement>('.rk-mv').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); openYt(b.dataset.yt!); }));
  container.querySelectorAll<HTMLElement>('.rk-row').forEach((row) =>
    row.addEventListener('click', async (e) => {
      if ((e.target as HTMLElement).closest('.rk-mv')) return;
      const i = Number(row.dataset.i);
      const list: PlayableTrack[] = [];
      for (const en of entries) {
        const hit = await findCatalog(en.searchTerm || `${en.artist} ${en.title}`);
        list.push(hit ? toPlayable(hit, en.youtubeId) : { title: en.title, artist: en.artist, artwork: en.artwork });
      }
      playQueue(list, i);
      container.querySelectorAll('.rk-row').forEach((r) => r.classList.remove('playing'));
      row.classList.add('playing');
    }));
}

/* ============ 공용: 상품 카드 ============ */
function productCard(p: Product) {
  return `<a class="p-card" href="#/store/${p.id}" data-tilt="7">
    <div class="p-img" data-term="${esc(p.searchTerm)}"><span class="p-badge">${esc(p.badge)}</span></div>
    <div class="p-brand">${esc(p.brand)}</div><div class="p-name">${esc(p.name)}</div>
    <div class="p-price">₩${p.price.toLocaleString()}</div>
  </a>`;
}
function fillProductArts(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('.p-img').forEach((el) => {
    findCatalog(el.dataset.term!).then((hit) => {
      if (hit) el.insertAdjacentHTML('beforeend', `<img src="${artUrl(hit, 400)}" alt="" loading="lazy"/>`);
    });
  });
}
function fillEventArts(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('[data-artist]').forEach((el) => {
    const a = artists.find((x) => x.name === el.dataset.artist);
    if (a) findCatalog(a.searchTerm).then((hit) => { if (hit) el.style.backgroundImage = `url(${artUrl(hit, 600)})`; });
  });
}

/* ================= 홈 ================= */
export async function pageHome() {
  const feat = seeds.find((s) => s.id === 't5') ?? seeds[0];
  root().innerHTML = `
    <section class="billboard" id="bb">
      <div class="bb-blur" id="bbBlur" data-parallax="0.34"></div>
      <div class="bb-scrim"></div>
      <div class="bb-inner">
        <div class="bb-content">
          <p class="bb-eyebrow">${t('todayPick')}</p>
          <h1 class="bb-title">${esc(feat.title.split(' (')[0])}</h1>
          <p class="bb-meta">${esc(feat.artist)}</p>
          <p class="bb-tag">${esc(feat.tag)}</p>
          <div class="bb-actions">
            <button class="btn-play-w" id="heroPlay">${icon('i-play')}${t('play')}</button>
            <button class="btn-sec" id="heroMv">${icon('i-info')}${t('mv')}</button>
          </div>
        </div>
        <div class="bb-card" id="bbCard" data-tilt="14"><div class="bb-card-inner sk"></div></div>
      </div>
    </section>
    <section class="sec"><div class="sec-head"><h2>${t('artists')}</h2><a class="sec-link" href="#/library/follows">${t('more')} ${icon('i-chev-r', 'ic s')}</a></div><div id="hArtists"></div></section>
    <section class="sec"><div class="sec-head"><h2>${t('chart.title')}</h2><a class="sec-link" href="#/chart">${t('chart.viewAll')} ${icon('i-chev-r', 'ic s')}</a></div><div id="hChart"></div></section>
    <section class="sec"><div class="sec-head"><h2>무드로 듣기</h2></div><div class="mood-grid" id="hMoods"></div></section>
    <section class="sec"><div class="sec-head"><h2>${t('upcoming')}</h2><a class="sec-link" href="#/schedule">${t('more')} ${icon('i-chev-r', 'ic s')}</a></div><div id="hEvents" class="ev-shelf"></div></section>
    <section class="store-wrap"><div class="store-inner">
      <p class="store-label">STORE</p>
      <div class="sec-head store-head"><h2>${t('newArrivals')}</h2><a class="sec-link dark" href="#/store">${t('more')} ${icon('i-chev-r', 'ic s')}</a></div>
      <div class="store-grid" id="hStore"></div>
    </div></section>`;

  findCatalog(feat.searchTerm).then((hit) => {
    if (!hit) return;
    const big = artUrl(hit, 1200);
    $('#bbBlur').style.backgroundImage = `url(${big})`;
    $('#bbCard').innerHTML = `<img class="bb-card-inner" src="${big}" alt=""/><span class="glare"></span>`;
    void applyTone($('#bb'), artUrl(hit, 200));
  });
  $('#heroPlay').addEventListener('click', async () => {
    const hit = await findCatalog(feat.searchTerm);
    if (hit) playQueue([toPlayable(hit, feat.youtubeId)], 0);
  });
  $('#heroMv').addEventListener('click', () => { if (feat.youtubeId) openYt(feat.youtubeId); });

  $('#hArtists').innerHTML = skCards(7, true);
  $('#hArtists').innerHTML = shelf(artists.map((a) => ({ title: a.name, sub: t('artists'), round: true, href: `#/artist/${a.id}`, term: a.searchTerm })));
  fillShelfArts($('#hArtists'));

  $('#hChart').innerHTML = skRows(5);
  const chart = await api('/api/chart?source=combined').catch(() => null);
  if (chart) { const top = chart.list.slice(0, 5); $('#hChart').innerHTML = rankList(top); bindRank($('#hChart'), top); }

  // 무드 타일
  const moods = [
    { k: '애니 타이업', c: '#8b5cf6,#4c1d95', q: 'anime' },
    { k: '심야 시티팝', c: '#0ea5e9,#0c4a6e', q: 'city pop' },
    { k: 'J-ROCK', c: '#ef4444,#7f1d1d', q: 'j-rock' },
    { k: '보컬로이드', c: '#22d3ee,#155e75', q: 'vocaloid' },
    { k: '발라드', c: '#f59e0b,#7c2d12', q: 'ballad' },
    { k: '애니송 명곡', c: '#ec4899,#831843', q: 'anison' },
  ];
  $('#hMoods').innerHTML = moods.map((m) => `
    <a class="mood" href="#/search?q=${encodeURIComponent(m.q)}" style="--m:linear-gradient(135deg,${m.c})" data-tilt="6">
      <span class="mood-k">${m.k}</span><span class="mood-sq" data-term="${esc(m.q)}"></span></a>`).join('');
  moods.forEach(async (m, i) => {
    const hit = await findCatalog(m.q === 'anime' ? seeds[0].searchTerm : m.q);
    const sq = $('#hMoods').querySelectorAll<HTMLElement>('.mood-sq')[i];
    if (hit && sq) sq.style.backgroundImage = `url(${artUrl(hit, 200)})`;
  });

  $('#hEvents').innerHTML = events.slice(0, 4).map((ev) => {
    const { d, txt } = dday(ev.date);
    return `<a class="ev-card" href="#/schedule">
      <div class="ev-bg" data-artist="${esc(ev.artist)}"></div><div class="ev-scrim"></div>
      <span class="ev-type">${esc(ev.type)}</span><span class="ev-dday ${d >= 0 && d <= 14 ? 'urgent' : ''}">${txt}</span>
      <div class="ev-body"><div class="ev-title">${esc(ev.title)}</div><div class="ev-info">${ev.date} · ${esc(ev.venue)}</div></div></a>`;
  }).join('');
  fillEventArts($('#hEvents'));

  $('#hStore').innerHTML = products.slice(0, 4).map(productCard).join('');
  fillProductArts($('#hStore'));
}

/* ================= 차트 ================= */
export async function pageChart(sub?: string) {
  const source = sub || 'combined';
  const desc: Record<string, string> = {
    combined: 'Apple Music 순위와 YouTube 조회수를 합산한 Lilac 종합 순위입니다.',
    apple: 'Apple Music 일본 스토어에서 가장 많이 재생된 곡을 실시간으로 가져옵니다.',
    youtube: '공식 뮤직비디오의 누적 조회수를 기준으로 정렬한 순위입니다.',
  };
  root().innerHTML = `
    <section class="chart-hero">
      <div class="ch-inner">
        <p class="sp-label">차트</p>
        <h1 class="ch-title">${t('chart.title')}</h1>
        <p class="ch-desc" id="chDesc">${desc[source]}</p>
        <div class="seg">${(['combined', 'apple', 'youtube'] as const).map((s) => `<a class="seg-btn ${s === source ? 'on' : ''}" href="#/chart/${s}">${t('chart.' + s)}</a>`).join('')}</div>
      </div>
    </section>
    <section class="sec chart-body">
      <div class="ch-bar"><button class="play-big" id="chPlayAll">${icon('i-play')}</button><span class="ch-updated" id="chUpdated"></span></div>
      <div id="chartBody">${skRows(8)}</div>
    </section>`;
  const data = await api(`/api/chart?source=${source}`).catch(() => null);
  if (!data) { $('#chartBody').innerHTML = '<p class="loading">차트를 불러오지 못했습니다</p>'; return; }
  $('#chUpdated').textContent = `${new Date(data.updated).toLocaleString()} 기준`;
  if (data.list[0]?.artwork) void applyTone(document.querySelector('.chart-hero'), data.list[0].artwork);
  $('#chartBody').innerHTML = rankList(data.list, { big: true });
  bindRank($('#chartBody'), data.list);
  data.list.forEach(async (e: { artwork?: string; searchTerm?: string; artist: string; title: string }, i: number) => {
    if (!e.artwork) {
      const hit = await findCatalog(e.searchTerm || `${e.artist} ${e.title}`);
      const art = $('#chartBody').querySelectorAll('.rk-art')[i];
      if (hit && art) art.insertAdjacentHTML('afterbegin', `<img src="${artUrl(hit, 100)}" alt=""/>`);
    }
  });
  $('#chPlayAll').addEventListener('click', async () => {
    const list: PlayableTrack[] = [];
    for (const en of data.list.slice(0, 10)) {
      const hit = await findCatalog(en.searchTerm || `${en.artist} ${en.title}`);
      if (hit) list.push(toPlayable(hit, en.youtubeId));
    }
    if (list.length) playQueue(list, 0);
  });
}

/* ================= 스토어 ================= */
export async function pageStore() {
  const brands = [...new Set(products.map((p) => p.brand))];
  root().innerHTML = `
    <div class="store-wrap page-top full"><div class="store-inner">
      <nav class="store-nav">
        <a class="sn-item on" data-f="all">전체</a>
        ${brands.map((b) => `<a class="sn-item" data-f="${esc(b)}">${esc(b)}</a>`).join('')}
      </nav>
      <div class="store-hero">
        <div class="sh-text"><p class="sh-eyebrow">LIMITED EDITION</p><h2>일본 내수 한정반,<br/>정식 루트로 받아보세요</h2>
          <p class="sh-sub">해외 배송이 지원되지 않는 상품을 Lilac 예약 공구로.</p></div>
        <div class="sh-img" id="shImg"></div>
      </div>
      <div class="sort-bar"><span id="pCount">${products.length}개 상품</span>
        <select id="pSort"><option value="new">신상품순</option><option value="low">낮은 가격순</option><option value="high">높은 가격순</option></select>
      </div>
      <div class="store-grid" id="storeGrid"></div>
    </div></div>`;
  let filter = 'all';
  const render = () => {
    let list = filter === 'all' ? [...products] : products.filter((p) => p.brand === filter);
    const s = ($('#pSort') as HTMLSelectElement).value;
    if (s === 'low') list.sort((a, b) => a.price - b.price);
    if (s === 'high') list.sort((a, b) => b.price - a.price);
    $('#pCount').textContent = `${list.length}개 상품`;
    $('#storeGrid').innerHTML = list.map(productCard).join('');
    fillProductArts($('#storeGrid'));
  };
  render();
  findCatalog(products[0].searchTerm).then((hit) => { if (hit) $('#shImg').style.backgroundImage = `url(${artUrl(hit, 600)})`; });
  $('#pSort').addEventListener('change', render);
  document.querySelectorAll<HTMLElement>('.sn-item').forEach((el) =>
    el.addEventListener('click', () => {
      document.querySelectorAll('.sn-item').forEach((x) => x.classList.remove('on'));
      el.classList.add('on'); filter = el.dataset.f!; render();
    }));
}

export async function pageProduct(id: string) {
  const p = products.find((x) => x.id === id);
  if (!p) return page404();
  const artist = artists.find((a) => a.name === p.brand);
  root().innerHTML = `
    <div class="store-wrap page-top full"><div class="store-inner product">
      <a class="crumb" href="#/store">${icon('i-chev-r', 'ic s flip')} ${t('store.title')}</a>
      <div class="pd-grid">
        <div class="pd-img" id="pdImg"><span class="p-badge">${esc(p.badge)}</span></div>
        <div class="pd-info">
          <p class="p-brand">${esc(p.brand)}</p>
          <h2 class="pd-name">${esc(p.name)}</h2>
          <p class="pd-price">₩${p.price.toLocaleString()}</p>
          <p class="pd-desc">${esc(p.desc)}</p>
          <div class="pd-row"><span>${t('store.option')}</span><select id="pdOpt">${p.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select></div>
          <div class="pd-row"><span>${t('store.qty')}</span><input id="pdQty" type="number" min="1" max="${p.stock}" value="1" /></div>
          <div class="pd-row dim"><span>${t('store.stock')}</span><span>${p.stock}개 남음</span></div>
          <div class="pd-row dim"><span>${t('store.operator')}</span><span>${esc(p.operator)}</span></div>
          <div class="pd-actions">
            <button class="btn-buy" id="pdOrder">${t('store.reserve')}</button>
            <a class="btn-out" href="${p.officialUrl}" target="_blank" rel="noopener">${t('store.official')} ${icon('i-ext', 'ic s')}</a>
            <a class="btn-out" href="${p.towerUrl}" target="_blank" rel="noopener">${t('store.tower')} ${icon('i-ext', 'ic s')}</a>
          </div>
          <p class="pd-note">예약 주문은 데모 크레딧으로 결제되며, 공식 스토어·타워레코드 링크는 실제 판매처로 연결됩니다.</p>
        </div>
      </div>
      ${artist ? `<div class="sec-head pd-sec"><h2 class="dark-h">${esc(artist.name)}의 곡</h2></div><div id="pdTracks" class="on-light"></div>` : ''}
    </div></div>`;
  findCatalog(p.searchTerm).then((hit) => { if (hit) $('#pdImg').insertAdjacentHTML('beforeend', `<img src="${artUrl(hit, 600)}" alt=""/>`); });
  $('#pdOrder').addEventListener('click', async () => {
    try {
      const r = await api('/api/orders', { method: 'POST', body: JSON.stringify({ productId: p.id, option: ($('#pdOpt') as HTMLSelectElement).value, qty: Number(($('#pdQty') as HTMLInputElement).value) }) });
      toast(`주문 완료 ${r.order.id} · 잔여 크레딧 ${r.credits.toLocaleString()}`);
      await refreshMe(); document.dispatchEvent(new CustomEvent('lilac:me'));
    } catch (e) { toast((e as Error).message); if ((e as Error).message.includes('로그인')) location.hash = '#/login'; }
  });
  if (artist) {
    const rel = seeds.filter((s) => s.artistId === artist.id);
    const hits = await Promise.all(rel.map((s) => findCatalog(s.searchTerm)));
    const entries = rel.map((s, i) => ({ rank: i + 1, title: s.title, artist: s.artist, artwork: hits[i] ? artUrl(hits[i]!, 100) : undefined, searchTerm: s.searchTerm, youtubeId: s.youtubeId }));
    if (entries.length) { $('#pdTracks').innerHTML = rankList(entries); bindRank($('#pdTracks'), entries); }
  }
}

/* ================= 일정 ================= */
export async function pageSchedule() {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const byMonth = new Map<string, Ev[]>();
  sorted.forEach((e) => {
    const k = e.date.slice(0, 7);
    byMonth.set(k, [...(byMonth.get(k) || []), e]);
  });
  root().innerHTML = `
    <section class="sec page-top">
      <div class="page-head">
        <p class="sp-label">${t('nav.schedule')}</p>
        <h1 class="page-title">${t('schedule.title')}</h1>
        <p class="page-desc">${t('schedule.hint')} — 팔로우한 아티스트의 일정이 가장 위에 표시됩니다.</p>
        <div class="chips" id="schFilters">
          <button class="chip on" data-f="all">전체</button>
          ${[...new Set(sorted.map((e) => e.type))].map((ty) => `<button class="chip" data-f="${esc(ty)}">${esc(ty)}</button>`).join('')}
        </div>
      </div>
      <div id="schBody"></div>
      <p class="pd-note" style="margin-top:24px">데모 일정입니다. 실서비스에서는 공식 발표·팬클럽 공지를 자동 수집합니다.</p>
    </section>`;
  const render = (f: string) => {
    const out: string[] = [];
    byMonth.forEach((list, month) => {
      const rows = f === 'all' ? list : list.filter((e) => e.type === f);
      if (!rows.length) return;
      const [y, m] = month.split('-');
      out.push(`<div class="sch-month"><div class="sch-mlabel"><b>${m}</b><span>${y}</span></div><div class="sch-rows">
        ${rows.map((e) => {
          const { d, txt } = dday(e.date);
          const a = artists.find((x) => x.name === e.artist);
          const day = new Date(e.date);
          return `<div class="sch-row" ${a ? `data-href="#/artist/${a.id}"` : ''}>
            <div class="sch-date"><b>${day.getDate()}</b><span>${['일','월','화','수','목','금','토'][day.getDay()]}</span></div>
            <div class="sch-poster" data-artist="${esc(e.artist)}"></div>
            <div class="sch-meta">
              <div class="sch-top"><span class="sch-type">${esc(e.type)}</span><span class="sch-dday ${d >= 0 && d <= 14 ? 'urgent' : ''}">${txt}</span></div>
              <div class="sch-title">${esc(e.title)}</div>
              <div class="sch-sub">${esc(e.venue)} · ${esc(e.note)}</div>
            </div>
            <span class="sch-go">${icon('i-chev-r')}</span>
          </div>`;
        }).join('')}</div></div>`);
    });
    $('#schBody').innerHTML = out.join('') || '<p class="loading">해당 일정이 없습니다</p>';
    fillEventArts($('#schBody'));
    $('#schBody').querySelectorAll<HTMLElement>('.sch-row[data-href]').forEach((el) =>
      el.addEventListener('click', () => { location.hash = el.dataset.href!; }));
  };
  render('all');
  $('#schFilters').querySelectorAll<HTMLButtonElement>('.chip').forEach((b) =>
    b.addEventListener('click', () => {
      $('#schFilters').querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on'); render(b.dataset.f!);
    }));
}

/* ================= 아티스트 상세 ================= */
export async function pageArtist(id: string) {
  const a = artists.find((x) => x.id === id);
  if (!a) return page404();
  const oshi = await api('/api/oshi').catch(() => []);
  const following = oshi.some((o: { artistId: string }) => o.artistId === a.id);
  const listeners = (2_400_000 + a.name.length * 137_000).toLocaleString();
  root().innerHTML = `
    <section class="ar-hero">
      <div class="ar-bg" id="arBg"></div><div class="ar-scrim"></div>
      <div class="ar-info">
        <p class="ar-verified">${icon('i-check', 'ic s')} 인증된 아티스트</p>
        <h1 class="ar-name">${esc(a.name)}</h1>
        <p class="ar-stats">월간 청취자 ${listeners}명 · ${esc(a.nameJa)}</p>
      </div>
    </section>
    <div class="ar-actionbar">
      <button class="play-big" id="arPlay">${icon('i-play')}</button>
      <button class="tbtn big-ghost ${following ? 'on' : ''}" id="arFollow">${following ? '팔로잉' : '팔로우'}</button>
      <a class="tbtn big-ghost" href="${a.official}" target="_blank" rel="noopener" title="공식 사이트">${icon('i-ext')}</a>
      <span class="ar-op">${t('store.operator')} · ${esc(a.operator)}</span>
    </div>
    <section class="sec"><div class="sec-head"><h2>인기</h2></div><div id="arTracks">${skRows(5)}</div></section>
    <section class="sec" id="arEvSec" style="display:none"><div class="sec-head"><h2>${t('schedule.title')}</h2><a class="sec-link" href="#/schedule">${t('more')} ${icon('i-chev-r', 'ic s')}</a></div><div class="ev-shelf" id="arEvents"></div></section>
    <section class="sec" id="arGoodsSec" style="display:none"><div class="sec-head"><h2>${t('store.title')}</h2><a class="sec-link" href="#/store">${t('more')} ${icon('i-chev-r', 'ic s')}</a></div><div class="store-dark-grid" id="arGoods"></div></section>
    <section class="sec"><div class="sec-head"><h2>비슷한 아티스트</h2></div><div id="arSimilar"></div></section>`;

  findCatalog(a.searchTerm).then((hit) => {
    if (!hit) return;
    $('#arBg').style.backgroundImage = `url(${artUrl(hit, 1200)})`;
    void applyTone(document.querySelector('.ar-hero'), artUrl(hit, 200));
  });
  $('#arFollow').addEventListener('click', async () => {
    const list = await api('/api/oshi', { method: 'POST', body: JSON.stringify({ artistId: a.id, name: a.name }) });
    const on = list.some((o: { artistId: string }) => o.artistId === a.id);
    $('#arFollow').classList.toggle('on', on);
    $('#arFollow').textContent = on ? '팔로잉' : '팔로우';
    toast(on ? `${a.name} 팔로우` : '팔로우 해제');
  });

  const { tracks } = await api(`/api/catalog/search?term=${encodeURIComponent(a.searchTerm)}&limit=10`).catch(() => ({ tracks: [] }));
  const top = (tracks as CatalogTrack[]).filter((x) => x.preview).slice(0, 5);
  const entries = top.map((c, i) => {
    const s = seeds.find((sd) => sd.artistId === a.id && c.title.includes(sd.title.split(' (')[0]));
    return { rank: i + 1, title: c.title, artist: c.artist, artwork: artUrl(c, 100), searchTerm: `${c.artist} ${c.title}`, youtubeId: s?.youtubeId ?? null };
  });
  $('#arTracks').innerHTML = entries.length ? rankList(entries) : '<p class="loading">카탈로그에서 찾지 못했습니다</p>';
  bindRank($('#arTracks'), entries);
  $('#arPlay').addEventListener('click', () => { if (top.length) playQueue(top.map((c) => toPlayable(c)), 0); });

  const evs = events.filter((e) => e.artist === a.name);
  if (evs.length) {
    $('#arEvSec').style.display = '';
    $('#arEvents').innerHTML = evs.map((ev) => {
      const { d, txt } = dday(ev.date);
      return `<div class="ev-card"><div class="ev-bg" data-artist="${esc(ev.artist)}"></div><div class="ev-scrim"></div>
        <span class="ev-type">${esc(ev.type)}</span><span class="ev-dday ${d >= 0 && d <= 14 ? 'urgent' : ''}">${txt}</span>
        <div class="ev-body"><div class="ev-title">${esc(ev.title)}</div><div class="ev-info">${ev.date} · ${esc(ev.venue)}</div></div></div>`;
    }).join('');
    fillEventArts($('#arEvents'));
  }
  const goods = products.filter((p) => p.brand === a.name);
  if (goods.length) {
    $('#arGoodsSec').style.display = '';
    $('#arGoods').innerHTML = goods.map(productCard).join('');
    fillProductArts($('#arGoods'));
  }
  const sim = artists.filter((x) => x.id !== a.id).slice(0, 6);
  $('#arSimilar').innerHTML = shelf(sim.map((x) => ({ title: x.name, sub: x.genre, round: true, href: `#/artist/${x.id}`, term: x.searchTerm })));
  fillShelfArts($('#arSimilar'));
}

/* ================= 보관함 ================= */
export async function pageLibrary(sub?: string) {
  const tab = sub || 'likes';
  const [likes, lists, hist, oshi] = await Promise.all([
    api('/api/likes').catch(() => []), api('/api/playlists').catch(() => []),
    api('/api/history').catch(() => []), api('/api/oshi').catch(() => []),
  ]);
  root().innerHTML = `
    <section class="sec page-top">
      <div class="page-head">
        <p class="sp-label">${t('nav.library')}</p>
        <h1 class="page-title">${t('nav.library')}</h1>
        <div class="chips">
          ${['likes', 'playlists', 'history', 'follows'].map((s) => `<a class="chip ${s === tab ? 'on' : ''}" href="#/library/${s}">${t('lib.' + s)}</a>`).join('')}
        </div>
      </div>
      <div id="libBody"></div>
    </section>`;
  const body = $('#libBody');

  if (tab === 'likes') {
    body.innerHTML = `
      <div class="liked-hero">
        <div class="liked-tile">${icon('i-heart-f', 'ic lt')}</div>
        <div>
          <p class="sp-label">플레이리스트</p>
          <h2 class="liked-title">${t('lib.likes')}</h2>
          <p class="sp-meta">${likes.length}곡</p>
          <div class="sp-actions inline"><button class="play-big" id="likePlay" ${likes.length ? '' : 'disabled'}>${icon('i-play')}</button></div>
        </div>
      </div>
      <div id="likeTable"></div>`;
    const rows = likes.map((l: PlayableTrack & { likedAt?: string }) => ({ ...l, addedAt: l.likedAt }));
    $('#likeTable').innerHTML = rows.length ? trackTable(rows) : `<div class="empty-box">${icon('i-heart', 'ic eb')}<p>저장한 곡이 없습니다</p><span>플레이어의 하트를 눌러 곡을 저장해 보세요</span></div>`;
    bindTable($('#likeTable'), rows);
    $('#likePlay')?.addEventListener('click', () => rows.length && playQueue(rows, 0));
  }
  if (tab === 'playlists') {
    body.innerHTML = `
      <div class="pl-toolbar"><button class="chip solid" id="newPl">${icon('i-plus', 'ic s')} ${t('lib.newPlaylist')}</button></div>
      <div class="lib-grid">
        <a class="lib-liked" href="#/library/likes"><div class="liked-tile sm">${icon('i-heart-f', 'ic lt')}</div>
          <div class="c-title">${t('lib.likes')}</div><div class="c-sub">${likes.length}곡</div></a>
        ${lists.map((p: { id: string; name: string; tracks: PlayableTrack[] }) => `
          <a class="card" href="#/playlist/${p.id}">
            <div class="cover">${p.tracks.length >= 4
              ? `<div class="mosaic">${p.tracks.slice(0, 4).map((x) => `<span style="background-image:url(${esc(x.artwork || '')})"></span>`).join('')}</div>`
              : p.tracks[0]?.artwork ? `<img src="${esc(p.tracks[0].artwork)}" alt=""/>` : `<div class="ph">${icon('i-queue')}</div>`}
              <button class="hover-play">${icon('i-play')}</button></div>
            <div class="c-title">${esc(p.name)}</div><div class="c-sub">플레이리스트 · ${p.tracks.length}곡</div>
          </a>`).join('')}
      </div>`;
    $('#newPl').addEventListener('click', async () => {
      const name = prompt(t('lib.newPlaylist'), 'My Mix');
      if (!name) return;
      await api('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) });
      document.dispatchEvent(new CustomEvent('lilac:playlists'));
      pageLibrary('playlists');
    });
  }
  if (tab === 'history') {
    const rows = hist.slice(0, 40).map((h: PlayableTrack & { playedAt?: string }) => ({ ...h, addedAt: h.playedAt }));
    body.innerHTML = rows.length ? trackTable(rows, { album: true, date: true }) : `<div class="empty-box">${icon('i-clock', 'ic eb')}<p>재생 기록이 없습니다</p><span>곡을 재생하면 여기에 쌓입니다</span></div>`;
    bindTable(body, rows);
  }
  if (tab === 'follows') {
    if (!oshi.length) { body.innerHTML = `<div class="empty-box">${icon('i-plus', 'ic eb')}<p>팔로우한 아티스트가 없습니다</p><span>아티스트 페이지에서 팔로우해 보세요</span></div>`; return; }
    body.innerHTML = shelf(oshi.map((o: { artistId: string; name: string }) => {
      const a = artists.find((x) => x.id === o.artistId);
      return { title: o.name, sub: a?.genre || t('artists'), round: true, href: `#/artist/${o.artistId}`, term: a?.searchTerm };
    }));
    fillShelfArts(body);
  }
}

/* ================= 플레이리스트 상세 (스포티파이) ================= */
export async function pagePlaylist(id: string) {
  const lists = await api('/api/playlists').catch(() => []);
  const pl = lists.find((p: { id: string }) => p.id === id);
  if (!pl) return page404();
  const covers = pl.tracks.slice(0, 4) as PlayableTrack[];
  const coverHtml = covers.length >= 4
    ? `<div class="sp-cover mosaic">${covers.map((x) => `<span style="background-image:url(${esc(x.artwork || '')})"></span>`).join('')}</div>`
    : covers[0]?.artwork
      ? `<div class="sp-cover" style="background-image:url(${esc(covers[0].artwork)})"></div>`
      : `<div class="sp-cover empty">${icon('i-queue', 'ic ph-ic')}</div>`;
  root().innerHTML = `
    <section class="sp-page">
      <div class="sp-head">
        ${coverHtml}
        <div class="sp-info">
          <p class="sp-label">공개 플레이리스트</p>
          <h1 class="sp-title">${esc(pl.name)}</h1>
          <p class="sp-meta"><span class="sp-owner">${esc((me?.name || 'L')[0])}</span><b>${esc(me?.name || 'Lilac 유저')}</b><span class="sep">·</span>${pl.tracks.length}곡<span class="sep">·</span>${new Date(pl.createdAt).toLocaleDateString()}</p>
        </div>
      </div>
      <div class="sp-actions">
        <button class="play-big" id="plPlayAll" ${pl.tracks.length ? '' : 'disabled'}>${icon('i-play')}</button>
        <button class="tbtn big-ghost" id="plShuffle" title="셔플 재생">${icon('i-shuffle')}</button>
        <button class="tbtn big-ghost" id="plDelete" title="플레이리스트 삭제">${icon('i-close')}</button>
      </div>
      <div class="sp-body" id="plTracks"></div>
    </section>`;
  if (covers[0]?.artwork) void applyTone(document.querySelector('.sp-head'), covers[0].artwork);
  const rows = pl.tracks as PlayableTrack[];
  $('#plTracks').innerHTML = rows.length ? trackTable(rows) : `<div class="empty-box">${icon('i-queue', 'ic eb')}<p>아직 곡이 없습니다</p><span>플레이어의 + 버튼으로 곡을 추가해 보세요</span></div>`;
  bindTable($('#plTracks'), rows, async (i) => { await api(`/api/playlists/${id}/tracks/${i}`, { method: 'DELETE' }); document.dispatchEvent(new CustomEvent('lilac:playlists')); pagePlaylist(id); });
  $('#plPlayAll').addEventListener('click', () => rows.length && playQueue(rows, 0));
  $('#plShuffle').addEventListener('click', () => rows.length && playQueue([...rows].sort(() => Math.random() - 0.5), 0));
  $('#plDelete').addEventListener('click', async () => {
    if (!confirm(`‘${pl.name}’ 플레이리스트를 삭제할까요?`)) return;
    await api(`/api/playlists/${id}`, { method: 'DELETE' });
    document.dispatchEvent(new CustomEvent('lilac:playlists'));
    location.hash = '#/library/playlists';
  });
}

/* ================= 인증 ================= */
export function pageLogin() {
  root().innerHTML = `
    <div class="auth-wrap page-top">
      <form class="auth-card" id="loginForm">
        <p class="auth-logo">Lilac</p>
        <h2>${t('auth.login.title')}</h2>
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
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }) });
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
        <h2>${t('auth.signup.title')}</h2>
        <label>${t('auth.name')}<input name="name" required placeholder="라일락" /></label>
        <label>${t('auth.email')}<input name="email" type="email" required placeholder="you@example.com" /></label>
        <label>${t('auth.password')}<input name="password" type="password" required minlength="4" placeholder="4자 이상" /></label>
        <button class="btn-pill" type="submit">${t('signup')}</button>
        <p class="pd-note">가입 시 데모 웰컴 크레딧 5,000이 지급됩니다. 데이터는 로컬 폴더(db/users.json)에만 저장됩니다.</p>
        <a class="auth-alt" href="#/login">${t('auth.toLogin')}</a>
      </form>
    </div>`;
  $('#signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    try {
      await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ name: fd.get('name'), email: fd.get('email'), password: fd.get('password') }) });
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
        <p class="sp-label">프로필</p>
        <h1 class="mp-name">${esc(me.name)}</h1>
        <p class="sp-meta">${esc(me.email)}<span class="sep">·</span>플레이리스트 ${lists.length}개<span class="sep">·</span>팔로우 ${oshi.length}명<span class="sep">·</span>가입 ${joined}</p>
      </div>
    </section>
    <section class="sec">
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
        <h3>${t('acct.orders')}</h3>
        ${orders.length ? `
        <table class="mp-table">
          <thead><tr><th>주문번호</th><th>상품</th><th>옵션</th><th>수량</th><th>결제</th><th>상태</th><th>주문일</th></tr></thead>
          <tbody>${orders.map((o: { id: string; name: string; brand: string; option: string; qty: number; total: number; status: string; orderedAt: string }) => `
            <tr><td class="num">${o.id}</td><td><b>${esc(o.name)}</b><br/><span class="dim">${esc(o.brand)}</span></td>
            <td>${esc(o.option)}</td><td class="num">${o.qty}</td><td class="num">₩${o.total.toLocaleString()}</td>
            <td><span class="mp-status">${esc(o.status)}</span></td><td class="dim num">${new Date(o.orderedAt).toLocaleDateString()}</td></tr>`).join('')}
          </tbody></table>` : '<p class="mp-empty">주문 내역이 없습니다</p>'}
      </div>

      <button class="btn-ghost-sm danger" id="acLogout">${t('logout')}</button>
    </section>`;
  $('#acSaveName').addEventListener('click', async () => {
    await api('/api/me', { method: 'PATCH', body: JSON.stringify({ name: ($('#acName') as HTMLInputElement).value }) });
    await refreshMe(); document.dispatchEvent(new CustomEvent('lilac:me')); toast('저장되었습니다');
  });
  $('#acTopup').addEventListener('click', async () => {
    await api('/api/me', { method: 'PATCH', body: JSON.stringify({ action: 'topup', amount: 50000 }) });
    await refreshMe(); document.dispatchEvent(new CustomEvent('lilac:me')); pageAccount();
  });
  $('#acUpgrade')?.addEventListener('click', async () => {
    await api('/api/me', { method: 'PATCH', body: JSON.stringify({ action: 'upgrade' }) });
    await refreshMe(); document.dispatchEvent(new CustomEvent('lilac:me')); pageAccount();
  });
  $('#acAddCard').addEventListener('click', async () => {
    const last4 = prompt('카드 마지막 4자리 (데모)', '4242') || '4242';
    await api('/api/me', { method: 'PATCH', body: JSON.stringify({ action: 'addCard', brand: 'VISA', last4 }) });
    pageAccount();
  });
  $('#acLogout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    await refreshMe(); document.dispatchEvent(new CustomEvent('lilac:me'));
    location.hash = '#/';
  });
}

/* ================= 검색 ================= */
export async function pageSearch(q: string) {
  root().innerHTML = `
    <section class="sec page-top">
      <div class="page-head"><p class="sp-label">검색</p><h1 class="page-title">‘${esc(q)}’</h1>
        <p class="page-desc">Apple Music 카탈로그 검색 결과입니다.</p></div>
      <div id="srBody">${skRows(6)}</div>
    </section>`;
  const { tracks } = await api(`/api/catalog/search?term=${encodeURIComponent(q)}&limit=15`).catch(() => ({ tracks: [] }));
  if (!tracks.length) { $('#srBody').innerHTML = '<p class="loading">결과가 없습니다</p>'; return; }
  const rows = (tracks as CatalogTrack[]).map((c) => toPlayable(c));
  $('#srBody').innerHTML = trackTable(rows, { album: true, date: false });
  bindTable($('#srBody'), rows);
}

export function page404() {
  root().innerHTML = `<section class="sec page-top"><div class="page-head"><h1 class="page-title">페이지를 찾을 수 없습니다</h1></div><a class="btn-pill" href="#/">${t('nav.home')}</a></section>`;
}
