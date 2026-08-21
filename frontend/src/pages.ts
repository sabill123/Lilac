import { api, findCatalog, artUrl, esc, icon, me, refreshMe } from './api';
import type { Artist, SeedTrack, Ev, Product, CatalogTrack, PlayableTrack } from './api';
import { playQueue, enqueue, openYt, openPlaylistPicker, toast } from './player';
import { t } from './i18n';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const root = () => $('#page');

// 공용 데이터 (1회 로드)
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
  ({ title: c.title, artist: c.artist, artwork: artUrl(c, 200), preview: c.preview, youtubeId: yt });

async function seedPlayables(): Promise<PlayableTrack[]> {
  const hits = await Promise.all(seeds.map((s) => findCatalog(s.searchTerm)));
  return hits.map((h, i) => (h ? toPlayable(h, seeds[i].youtubeId) : null)).filter(Boolean) as PlayableTrack[];
}

function dday(date: string) {
  const d = Math.ceil((new Date(date).getTime() - Date.now()) / 864e5);
  return { d, txt: d > 0 ? `D-${d}` : d === 0 ? 'D-DAY' : '종료' };
}

/* ================= 조각 렌더러 ================= */
function shelfCards(list: { title: string; sub: string; art?: string; round?: boolean; href?: string; onPlay?: () => void; following?: boolean }[]) {
  return `<div class="shelf">${list.map((c, i) => `
    <a class="card ${c.round ? 'round' : ''} ${c.following ? 'following' : ''}" data-i="${i}" href="${c.href ?? 'javascript:void 0'}">
      <span class="follow-state">${icon('i-check')}</span>
      <div class="cover">${c.art ? `<img src="${c.art}" alt="" loading="lazy" />` : `<div class="ph">${esc(c.title[0] || '?')}</div>`}
        ${c.onPlay ? `<button class="hover-play" data-play="${i}">${icon('i-play')}</button>` : ''}</div>
      <div class="c-title">${esc(c.title)}</div>
      <div class="c-sub">${esc(c.sub)}</div>
    </a>`).join('')}</div>`;
}
function bindShelf(container: HTMLElement, list: { onPlay?: () => void }[]) {
  container.querySelectorAll<HTMLButtonElement>('[data-play]').forEach((btn) =>
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); list[Number(btn.dataset.play)].onPlay?.(); }));
}

function chartRows(list: { rank: number; title: string; artist: string; artwork?: string; ytViews?: number; sources?: string[]; tag?: string; youtubeId?: string | null }[], compact = false) {
  return `<ol class="chart-list ${compact ? 'compact' : ''}">${list.map((e) => `
    <li class="chart-row" data-r="${e.rank}">
      <span class="rank">${e.rank}</span>
      <div class="art">${e.artwork ? `<img src="${e.artwork}" loading="lazy" alt=""/>` : ''}<div class="overlay">${icon('i-play')}</div></div>
      <div class="meta"><div class="t">${esc(e.title)}</div><div class="a">${esc(e.artist)}</div></div>
      <div class="side">
        ${e.ytViews ? `<span class="views">${(e.ytViews / 1e8).toFixed(1)}억 뷰</span>` : ''}
        ${e.sources ? e.sources.map((s) => `<span class="src-dot ${s}" title="${s}"></span>`).join('') : ''}
        ${e.tag && !compact ? `<span class="tagchip">${esc(e.tag)}</span>` : ''}
        ${e.youtubeId ? `<button class="mv-link" data-yt="${e.youtubeId}" title="${t('mv')}">${icon('i-ext')}</button>` : ''}
      </div>
    </li>`).join('')}</ol>`;
}
function bindChart(container: HTMLElement, entries: { title: string; artist: string; artwork?: string; searchTerm?: string; youtubeId?: string | null }[]) {
  container.querySelectorAll<HTMLButtonElement>('.mv-link').forEach((btn) =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); openYt(btn.dataset.yt!); }));
  container.querySelectorAll<HTMLElement>('.chart-row').forEach((row, i) =>
    row.addEventListener('click', async (e) => {
      if ((e.target as HTMLElement).closest('.mv-link')) return;
      const list: PlayableTrack[] = [];
      for (const en of entries) {
        const hit = await findCatalog(en.searchTerm || `${en.artist} ${en.title}`);
        list.push(hit ? toPlayable(hit, en.youtubeId) : { title: en.title, artist: en.artist, artwork: en.artwork });
      }
      playQueue(list, i);
    }));
}

/* ================= 페이지: 홈 ================= */
export async function pageHome() {
  const feat = seeds.find((s) => s.id === 't5') ?? seeds[0];
  root().innerHTML = `
    <section class="billboard">
      <img class="bb-img" id="bbImg" alt="" />
      <div class="bb-scrim"></div>
      <div class="bb-content">
        <p class="bb-eyebrow">${t('todayPick')}</p>
        <h1 class="bb-title">${esc(feat.title.split(' (')[0])}</h1>
        <p class="bb-meta">${esc(feat.artist)} · ${esc(feat.tag)}</p>
        <div class="bb-actions">
          <button class="btn-play-w" id="heroPlay">${icon('i-play')}${t('play')}</button>
          <button class="btn-sec" id="heroMv">${icon('i-info')}${t('mv')}</button>
        </div>
      </div>
    </section>
    <section class="sec"><div class="sec-head"><h2>${t('artists')}</h2><span class="sec-sub">${t('artist.follow.hint')}</span></div><div id="hArtists"></div></section>
    <section class="sec"><div class="sec-head"><h2>${t('chart.title')}</h2><a class="sec-link" href="#/chart">${t('chart.viewAll')} ${icon('i-chev-r', 'ic s')}</a></div><div id="hChart"></div></section>
    <section class="sec"><div class="sec-head"><h2>${t('upcoming')}</h2><a class="sec-link" href="#/schedule">${t('more')} ${icon('i-chev-r', 'ic s')}</a></div><div id="hEvents" class="event-grid"></div></section>
    <section class="store-wrap"><div class="store-inner">
      <p class="store-label">STORE</p>
      <div class="sec-head store-head"><h2>${t('newArrivals')}</h2><a class="sec-link dark" href="#/store">${t('more')} ${icon('i-chev-r', 'ic s')}</a></div>
      <div class="store-grid" id="hStore"></div>
    </div></section>`;

  findCatalog(feat.searchTerm).then((hit) => { if (hit) ($('#bbImg') as HTMLImageElement).src = artUrl(hit, 1200); });
  $('#heroPlay').addEventListener('click', async () => {
    const hit = await findCatalog(feat.searchTerm);
    if (hit) playQueue([toPlayable(hit, feat.youtubeId)], 0);
  });
  $('#heroMv').addEventListener('click', () => { if (feat.youtubeId) openYt(feat.youtubeId); });

  // 아티스트
  const oshi = await api('/api/oshi').catch(() => []);
  const followSet = new Set(oshi.map((o: { artistId: string }) => o.artistId));
  const aCards = artists.map((a) => ({ title: a.name, sub: t('artists'), round: true, href: `#/artist/${a.id}`, following: followSet.has(a.id) }));
  $('#hArtists').innerHTML = shelfCards(aCards);
  artists.forEach(async (a, i) => {
    const hit = await findCatalog(a.searchTerm);
    const img = $('#hArtists').querySelectorAll('.cover')[i];
    if (hit && img) img.innerHTML = `<img src="${artUrl(hit, 300)}" alt="" loading="lazy" />`;
  });

  // 차트 TOP5 (종합)
  const chart = await api('/api/chart?source=combined').catch(() => null);
  if (chart) {
    const top5 = chart.list.slice(0, 5);
    $('#hChart').innerHTML = chartRows(top5, true);
    bindChart($('#hChart'), top5);
  }

  // 일정 4개
  $('#hEvents').innerHTML = events.slice(0, 4).map((ev) => {
    const { d, txt } = dday(ev.date);
    return `<a class="ev-card" href="#/schedule">
      <div class="ev-bg" data-artist="${esc(ev.artist)}"></div><div class="ev-scrim"></div>
      <span class="ev-type">${esc(ev.type)}</span><span class="ev-dday ${d >= 0 && d <= 14 ? 'urgent' : ''}">${txt}</span>
      <div class="ev-body"><div class="ev-title">${esc(ev.title)}</div><div class="ev-info">${ev.date} · ${esc(ev.venue)}</div></div>
    </a>`;
  }).join('');
  fillEventArts($('#hEvents'));

  // 스토어 4개
  $('#hStore').innerHTML = products.slice(0, 4).map(productCard).join('');
  fillProductArts($('#hStore'));
}

function fillEventArts(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('.ev-bg').forEach((el) => {
    const a = artists.find((x) => x.name === el.dataset.artist);
    if (a) findCatalog(a.searchTerm).then((hit) => { if (hit) el.style.backgroundImage = `url(${artUrl(hit, 600)})`; });
  });
}
function productCard(p: Product) {
  return `<a class="p-card" href="#/store/${p.id}">
    <div class="p-img" data-term="${esc(p.searchTerm)}"><span class="p-badge">${esc(p.badge)}</span></div>
    <div class="p-brand">${esc(p.brand)}</div><div class="p-name">${esc(p.name)}</div>
    <div class="p-price">₩${p.price.toLocaleString()}</div>
  </a>`;
}
function fillProductArts(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('.p-img').forEach((el) => {
    findCatalog(el.dataset.term!).then((hit) => {
      if (hit) el.insertAdjacentHTML('beforeend', `<img src="${artUrl(hit, 400)}" alt="" loading="lazy" />`);
    });
  });
}

/* ================= 페이지: 차트 ================= */
export async function pageChart(sub?: string) {
  const source = sub || 'combined';
  root().innerHTML = `
    <section class="sec page-top">
      <div class="sec-head"><h2>${t('chart.title')}</h2><span class="sec-sub" id="chartNote"></span></div>
      <div class="tabs">
        ${(['combined', 'apple', 'youtube'] as const).map((s) => `<a class="tab ${s === source ? 'on' : ''}" href="#/chart/${s}">${t('chart.' + s)}</a>`).join('')}
      </div>
      <div id="chartBody"><p class="loading">…</p></div>
    </section>`;
  const data = await api(`/api/chart?source=${source}`).catch(() => null);
  if (!data) { $('#chartBody').innerHTML = '<p class="loading">차트를 불러오지 못했습니다</p>'; return; }
  $('#chartNote').textContent = `${data.note} · ${new Date(data.updated).toLocaleTimeString()}`;
  $('#chartBody').innerHTML = chartRows(data.list);
  bindChart($('#chartBody'), data.list);
  // 아트워크 없는 엔트리(유튜브 소스) 보충
  data.list.forEach(async (e: { artwork?: string; searchTerm?: string; artist: string; title: string }, i: number) => {
    if (!e.artwork) {
      const hit = await findCatalog(e.searchTerm || `${e.artist} ${e.title}`);
      const art = $('#chartBody').querySelectorAll('.art')[i];
      if (hit && art) art.insertAdjacentHTML('afterbegin', `<img src="${artUrl(hit, 100)}" alt=""/>`);
    }
  });
}

/* ================= 페이지: 스토어 목록/상세 ================= */
export async function pageStore() {
  root().innerHTML = `
    <div class="store-wrap page-top full"><div class="store-inner">
      <p class="store-label">STORE</p>
      <div class="sec-head store-head"><h2>${t('store.title')}</h2><span class="store-sub">${t('store.sub')}</span></div>
      <div class="store-grid" id="storeGrid">${products.map(productCard).join('')}</div>
    </div></div>`;
  fillProductArts($('#storeGrid'));
}

export async function pageProduct(id: string) {
  const p = products.find((x) => x.id === id);
  if (!p) return page404();
  const artist = artists.find((a) => a.name === p.brand || a.nameJa === p.brand);
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
          <div class="pd-row"><span>${t('store.option')}</span>
            <select id="pdOpt">${p.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select></div>
          <div class="pd-row"><span>${t('store.qty')}</span>
            <input id="pdQty" type="number" min="1" max="${p.stock}" value="1" /></div>
          <div class="pd-row dim"><span>${t('store.stock')}</span><span>${p.stock}</span></div>
          <div class="pd-row dim"><span>${t('store.operator')}</span><span>${esc(p.operator)}</span></div>
          <div class="pd-actions">
            <button class="btn-buy" id="pdOrder">${t('store.reserve')}</button>
            <a class="btn-out" href="${p.officialUrl}" target="_blank" rel="noopener">${t('store.official')} ${icon('i-ext', 'ic s')}</a>
            <a class="btn-out" href="${p.towerUrl}" target="_blank" rel="noopener">${t('store.tower')} ${icon('i-ext', 'ic s')}</a>
          </div>
          <p class="pd-note">예약 주문은 데모 크레딧으로 결제되며, 공식 스토어/타워레코드 링크는 실제 판매처로 연결됩니다.</p>
        </div>
      </div>
      ${artist ? `<div class="sec-head" style="margin-top:44px"><h2 class="dark-h">${esc(artist.name)}의 곡</h2></div><div id="pdTracks"></div>` : ''}
    </div></div>`;
  findCatalog(p.searchTerm).then((hit) => {
    if (hit) $('#pdImg').insertAdjacentHTML('beforeend', `<img src="${artUrl(hit, 600)}" alt="" />`);
  });
  $('#pdOrder').addEventListener('click', async () => {
    try {
      const r = await api('/api/orders', { method: 'POST', body: JSON.stringify({ productId: p.id, option: ($('#pdOpt') as HTMLSelectElement).value, qty: Number(($('#pdQty') as HTMLInputElement).value) }) });
      toast(`주문 완료 ${r.order.id} · 잔여 크레딧 ${r.credits.toLocaleString()}`);
      await refreshMe();
      document.dispatchEvent(new CustomEvent('lilac:me'));
    } catch (e) { toast((e as Error).message); if ((e as Error).message.includes('로그인')) location.hash = '#/login'; }
  });
  if (artist) {
    const related = seeds.filter((s) => s.artistId === artist.id);
    const hits = await Promise.all(related.map((s) => findCatalog(s.searchTerm)));
    const entries = related.map((s, i) => ({ rank: i + 1, title: s.title, artist: s.artist, artwork: hits[i] ? artUrl(hits[i], 100) : undefined, searchTerm: s.searchTerm, youtubeId: s.youtubeId, tag: s.tag }));
    const el = $('#pdTracks');
    if (el && entries.length) { el.innerHTML = `<div class="chart-on-light">${chartRows(entries, true)}</div>`; bindChart(el, entries); }
  }
}

/* ================= 페이지: 일정 ================= */
export async function pageSchedule() {
  root().innerHTML = `
    <section class="sec page-top">
      <div class="sec-head"><h2>${t('schedule.title')}</h2><span class="sec-sub">${t('schedule.hint')}</span></div>
      <div class="event-grid" id="evGrid"></div>
      <p class="pd-note" style="margin-top:18px">데모 일정입니다. 실서비스에서는 공식 발표·FC 공지 기반으로 자동 수집됩니다.</p>
    </section>`;
  $('#evGrid').innerHTML = events.map((ev) => {
    const { d, txt } = dday(ev.date);
    const a = artists.find((x) => x.name === ev.artist);
    return `<div class="ev-card ${a ? 'link' : ''}" ${a ? `data-href="#/artist/${a.id}"` : ''}>
      <div class="ev-bg" data-artist="${esc(ev.artist)}"></div><div class="ev-scrim"></div>
      <span class="ev-type">${esc(ev.type)}</span><span class="ev-dday ${d >= 0 && d <= 14 ? 'urgent' : ''}">${txt}</span>
      <div class="ev-body"><div class="ev-title">${esc(ev.title)}</div><div class="ev-info">${ev.date} · ${esc(ev.venue)}</div><div class="ev-note">${esc(ev.note)}</div></div>
    </div>`;
  }).join('');
  fillEventArts($('#evGrid'));
  $('#evGrid').querySelectorAll<HTMLElement>('.ev-card.link').forEach((el) =>
    el.addEventListener('click', () => { location.hash = el.dataset.href!; }));
}

/* ================= 페이지: 아티스트 ================= */
export async function pageArtist(id: string) {
  const a = artists.find((x) => x.id === id);
  if (!a) return page404();
  const oshi = await api('/api/oshi').catch(() => []);
  const following = oshi.some((o: { artistId: string }) => o.artistId === a.id);
  root().innerHTML = `
    <section class="artist-hero page-top">
      <div class="ah-avatar" id="ahAvatar"><div class="ph">${esc(a.name[0])}</div></div>
      <div class="ah-meta">
        <p class="ah-label">${t('artists')}</p>
        <h1>${esc(a.name)} <span class="ah-ja">${esc(a.nameJa)}</span></h1>
        <p class="ah-op">${esc(a.genre)} · ${t('store.operator')}: ${esc(a.operator)}</p>
        <div class="ah-actions">
          <button class="btn-follow ${following ? 'on' : ''}" id="ahFollow">${following ? icon('i-check') + ' 팔로잉' : icon('i-plus') + ' 팔로우'}</button>
          <a class="btn-out" href="${a.official}" target="_blank" rel="noopener">공식 사이트 ${icon('i-ext', 'ic s')}</a>
        </div>
      </div>
    </section>
    <section class="sec"><div class="sec-head"><h2>인기 곡</h2></div><div id="ahTracks"><p class="loading">…</p></div></section>
    <section class="sec" id="ahEventsSec" style="display:none"><div class="sec-head"><h2>${t('schedule.title')}</h2></div><div class="event-grid" id="ahEvents"></div></section>
    <section class="sec" id="ahGoodsSec" style="display:none"><div class="sec-head"><h2>${t('store.title')}</h2></div><div class="store-dark-grid" id="ahGoods"></div></section>`;

  findCatalog(a.searchTerm).then((hit) => { if (hit) $('#ahAvatar').innerHTML = `<img src="${artUrl(hit, 400)}" alt="" />`; });
  $('#ahFollow').addEventListener('click', async () => {
    const list = await api('/api/oshi', { method: 'POST', body: JSON.stringify({ artistId: a.id, name: a.name }) });
    const on = list.some((o: { artistId: string }) => o.artistId === a.id);
    $('#ahFollow').classList.toggle('on', on);
    $('#ahFollow').innerHTML = on ? icon('i-check') + ' 팔로잉' : icon('i-plus') + ' 팔로우';
    toast(on ? `${a.name} 팔로우 — db/user/oshi.json 저장` : '팔로우 해제');
  });

  // 인기곡: 카탈로그 검색 상위 5
  const { tracks } = await api(`/api/catalog/search?term=${encodeURIComponent(a.searchTerm)}&limit=8`).catch(() => ({ tracks: [] }));
  const top = (tracks as CatalogTrack[]).filter((x) => x.preview).slice(0, 5);
  const entries = top.map((c, i) => {
    const s = seeds.find((sd) => sd.artistId === a.id && c.title.includes(sd.title.split(' (')[0]));
    return { rank: i + 1, title: c.title, artist: c.artist, artwork: artUrl(c, 100), searchTerm: `${c.artist} ${c.title}`, youtubeId: s?.youtubeId ?? null };
  });
  $('#ahTracks').innerHTML = entries.length ? chartRows(entries, true) : '<p class="loading">카탈로그에서 찾지 못했습니다</p>';
  bindChart($('#ahTracks'), entries);

  const evs = events.filter((e) => e.artist === a.name);
  if (evs.length) {
    $('#ahEventsSec').style.display = '';
    $('#ahEvents').innerHTML = evs.map((ev) => {
      const { d, txt } = dday(ev.date);
      return `<div class="ev-card"><div class="ev-bg" data-artist="${esc(ev.artist)}"></div><div class="ev-scrim"></div>
        <span class="ev-type">${esc(ev.type)}</span><span class="ev-dday ${d >= 0 && d <= 14 ? 'urgent' : ''}">${txt}</span>
        <div class="ev-body"><div class="ev-title">${esc(ev.title)}</div><div class="ev-info">${ev.date} · ${esc(ev.venue)}</div></div></div>`;
    }).join('');
    fillEventArts($('#ahEvents'));
  }
  const goods = products.filter((p) => p.brand === a.name);
  if (goods.length) {
    $('#ahGoodsSec').style.display = '';
    $('#ahGoods').innerHTML = goods.map(productCard).join('');
    fillProductArts($('#ahGoods'));
  }
}

/* ================= 페이지: 보관함 ================= */
export async function pageLibrary(sub?: string) {
  const tab = sub || 'likes';
  const tabs = ['likes', 'playlists', 'history', 'follows'];
  root().innerHTML = `
    <section class="sec page-top">
      <div class="sec-head"><h2>${t('nav.library')}</h2></div>
      <div class="tabs">${tabs.map((s) => `<a class="tab ${s === tab ? 'on' : ''}" href="#/library/${s}">${t('lib.' + s)}</a>`).join('')}</div>
      <div id="libBody"><p class="loading">…</p></div>
    </section>`;
  const body = $('#libBody');

  if (tab === 'likes') {
    const likes = await api('/api/likes').catch(() => []);
    if (!likes.length) { body.innerHTML = `<p class="loading">플레이어의 하트를 눌러 곡을 저장해 보세요</p>`; return; }
    const entries = likes.map((l: PlayableTrack & { key: string }, i: number) => ({ rank: i + 1, title: l.title, artist: l.artist, artwork: l.artwork, searchTerm: `${l.artist} ${l.title}` }));
    body.innerHTML = chartRows(entries, true);
    body.querySelectorAll<HTMLElement>('.chart-row').forEach((row, i) =>
      row.addEventListener('click', () => playQueue(likes.map((l: PlayableTrack) => l), i)));
  }
  if (tab === 'playlists') {
    const lists = await api('/api/playlists').catch(() => []);
    body.innerHTML = `
      <button class="btn-out new-pl" id="newPl">${icon('i-plus', 'ic s')} ${t('lib.newPlaylist')}</button>
      <div class="pl-grid">${lists.map((p: { id: string; name: string; tracks: PlayableTrack[] }) => `
        <a class="pl-card" href="#/playlist/${p.id}">
          <div class="pl-cover">${p.tracks.slice(0, 4).map((x) => `<span style="background-image:url(${esc(x.artwork || '')})"></span>`).join('')}</div>
          <div class="c-title">${esc(p.name)}</div><div class="c-sub">${p.tracks.length}곡</div>
        </a>`).join('')}</div>`;
    $('#newPl').addEventListener('click', async () => {
      const name = prompt(t('lib.newPlaylist'), 'My Mix');
      if (!name) return;
      await api('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) });
      pageLibrary('playlists');
    });
  }
  if (tab === 'history') {
    const hist = await api('/api/history').catch(() => []);
    if (!hist.length) { body.innerHTML = `<p class="loading">아직 재생 기록이 없습니다</p>`; return; }
    const entries = hist.slice(0, 30).map((h: PlayableTrack & { playedAt: string }, i: number) => ({ rank: i + 1, title: h.title, artist: h.artist, artwork: h.artwork }));
    body.innerHTML = chartRows(entries, true);
    body.querySelectorAll<HTMLElement>('.chart-row').forEach((row, i) =>
      row.addEventListener('click', () => playQueue(hist.map((h: PlayableTrack) => h), i)));
  }
  if (tab === 'follows') {
    const oshi = await api('/api/oshi').catch(() => []);
    if (!oshi.length) { body.innerHTML = `<p class="loading">아티스트를 팔로우해 보세요</p>`; return; }
    const cards = oshi.map((o: { artistId: string; name: string }) => {
      const a = artists.find((x) => x.id === o.artistId);
      return { title: o.name, sub: t('artists'), round: true, href: `#/artist/${o.artistId}`, following: true, term: a?.searchTerm };
    });
    body.innerHTML = shelfCards(cards);
    cards.forEach(async (c: { term?: string }, i: number) => {
      if (!c.term) return;
      const hit = await findCatalog(c.term);
      const img = body.querySelectorAll('.cover')[i];
      if (hit && img) img.innerHTML = `<img src="${artUrl(hit, 300)}" alt="" loading="lazy" />`;
    });
  }
}

/* ================= 페이지: 플레이리스트 상세 ================= */
export async function pagePlaylist(id: string) {
  const lists = await api('/api/playlists').catch(() => []);
  const pl = lists.find((p: { id: string }) => p.id === id);
  if (!pl) return page404();
  root().innerHTML = `
    <section class="sec page-top">
      <a class="crumb" href="#/library/playlists">${icon('i-chev-r', 'ic s flip')} ${t('lib.playlists')}</a>
      <div class="pl-head">
        <div class="pl-cover big">${pl.tracks.slice(0, 4).map((x: PlayableTrack) => `<span style="background-image:url(${esc(x.artwork || '')})"></span>`).join('')}</div>
        <div>
          <p class="ah-label">${t('lib.playlists')}</p>
          <h1>${esc(pl.name)}</h1>
          <p class="sec-sub">${pl.tracks.length}곡 · ${new Date(pl.createdAt).toLocaleDateString()}</p>
          <div class="ah-actions">
            <button class="btn-play-w" id="plPlayAll" ${pl.tracks.length ? '' : 'disabled'}>${icon('i-play')}${t('play')}</button>
            <button class="btn-out" id="plDelete">삭제</button>
          </div>
        </div>
      </div>
      <div id="plTracks"></div>
    </section>`;
  const entries = pl.tracks.map((x: PlayableTrack, i: number) => ({ rank: i + 1, title: x.title, artist: x.artist, artwork: x.artwork }));
  $('#plTracks').innerHTML = entries.length ? chartRows(entries, true) : `<p class="loading">플레이어의 + 버튼으로 곡을 추가해 보세요</p>`;
  $('#plTracks').querySelectorAll<HTMLElement>('.chart-row').forEach((row, i) => {
    row.insertAdjacentHTML('beforeend', `<button class="q-x pl-x" data-i="${i}">${icon('i-close')}</button>`);
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.pl-x')) return;
      playQueue(pl.tracks, i);
    });
  });
  $('#plTracks').querySelectorAll<HTMLButtonElement>('.pl-x').forEach((btn) =>
    btn.addEventListener('click', async () => { await api(`/api/playlists/${id}/tracks/${btn.dataset.i}`, { method: 'DELETE' }); pagePlaylist(id); }));
  $('#plPlayAll').addEventListener('click', () => playQueue(pl.tracks, 0));
  $('#plDelete').addEventListener('click', async () => {
    if (!confirm(`‘${pl.name}’ 플레이리스트를 삭제할까요?`)) return;
    await api(`/api/playlists/${id}`, { method: 'DELETE' });
    location.hash = '#/library/playlists';
  });
}

/* ================= 페이지: 인증 ================= */
export function pageLogin() {
  root().innerHTML = `
    <div class="auth-wrap page-top">
      <form class="auth-card" id="loginForm">
        <h2>${t('auth.login.title')}</h2>
        <label>${t('auth.email')}<input name="email" type="email" required placeholder="you@example.com" /></label>
        <label>${t('auth.password')}<input name="password" type="password" required placeholder="••••••••" /></label>
        <button class="btn-buy wide" type="submit">${t('login')}</button>
        <a class="auth-alt" href="#/signup">${t('auth.toSignup')}</a>
      </form>
    </div>`;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }) });
      await refreshMe();
      document.dispatchEvent(new CustomEvent('lilac:me'));
      toast('로그인 완료');
      location.hash = '#/';
    } catch (err) { toast((err as Error).message); }
  });
}
export function pageSignup() {
  root().innerHTML = `
    <div class="auth-wrap page-top">
      <form class="auth-card" id="signupForm">
        <h2>${t('auth.signup.title')}</h2>
        <label>${t('auth.name')}<input name="name" required placeholder="라일락" /></label>
        <label>${t('auth.email')}<input name="email" type="email" required placeholder="you@example.com" /></label>
        <label>${t('auth.password')}<input name="password" type="password" required minlength="4" placeholder="4자 이상" /></label>
        <button class="btn-buy wide" type="submit">${t('signup')}</button>
        <p class="pd-note">가입 시 데모 웰컴 크레딧 5,000이 지급됩니다. 데이터는 로컬 폴더(db/users.json)에만 저장됩니다.</p>
        <a class="auth-alt" href="#/login">${t('auth.toLogin')}</a>
      </form>
    </div>`;
  $('#signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    try {
      await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ name: fd.get('name'), email: fd.get('email'), password: fd.get('password') }) });
      await refreshMe();
      document.dispatchEvent(new CustomEvent('lilac:me'));
      toast('가입 완료. 웰컴 크레딧 5,000 지급');
      location.hash = '#/';
    } catch (err) { toast((err as Error).message); }
  });
}

/* ================= 페이지: 계정 ================= */
export async function pageAccount() {
  await refreshMe();
  if (!me) { location.hash = '#/login'; return; }
  const orders = await api('/api/orders').catch(() => []);
  root().innerHTML = `
    <section class="sec page-top narrow">
      <div class="sec-head"><h2>${t('account')}</h2><span class="sec-sub">${esc(me.email)}</span></div>
      <div class="acct-grid">
        <div class="acct-card">
          <h3>${t('auth.name')}</h3>
          <div class="acct-row"><input id="acName" value="${esc(me.name)}" /><button class="btn-out" id="acSaveName">저장</button></div>
        </div>
        <div class="acct-card">
          <h3>${t('acct.plan')}</h3>
          <p class="acct-big">${esc(me.plan.name)}</p>
          <p class="sec-sub">${me.plan.renewsAt ? `갱신일 ${me.plan.renewsAt}` : '무료 플랜'}</p>
          ${me.plan.tier === 'free' ? `<button class="btn-buy" id="acUpgrade">${t('acct.upgrade')}</button>` : ''}
        </div>
        <div class="acct-card">
          <h3>${t('acct.credits')}</h3>
          <p class="acct-big">${me.credits.toLocaleString()}</p>
          <button class="btn-out" id="acTopup">${t('acct.topup')}</button>
        </div>
        <div class="acct-card">
          <h3>${t('acct.payment')}</h3>
          ${me.paymentMethods.length ? me.paymentMethods.map((c) => `<p class="acct-line">${esc(c.brand)} •••• ${esc(c.last4)}</p>`).join('') : '<p class="sec-sub">등록된 카드가 없습니다</p>'}
          <button class="btn-out" id="acAddCard">${t('acct.addCard')}</button>
        </div>
      </div>
      <div class="acct-card wide-card">
        <h3>${t('acct.orders')}</h3>
        ${orders.length ? `<table class="acct-table"><thead><tr><th>주문번호</th><th>상품</th><th>옵션</th><th>수량</th><th>금액</th><th>상태</th></tr></thead>
          <tbody>${orders.map((o: { id: string; name: string; option: string; qty: number; total: number; status: string }) => `
            <tr><td>${o.id}</td><td>${esc(o.name)}</td><td>${esc(o.option)}</td><td>${o.qty}</td><td>₩${o.total.toLocaleString()}</td><td>${o.status}</td></tr>`).join('')}</tbody></table>`
        : '<p class="sec-sub">주문 내역이 없습니다</p>'}
      </div>
      <button class="btn-out danger" id="acLogout">${t('logout')}</button>
    </section>`;
  $('#acSaveName').addEventListener('click', async () => {
    await api('/api/me', { method: 'PATCH', body: JSON.stringify({ name: ($('#acName') as HTMLInputElement).value }) });
    await refreshMe(); document.dispatchEvent(new CustomEvent('lilac:me')); toast('저장되었습니다');
  });
  $('#acTopup')?.addEventListener('click', async () => {
    await api('/api/me', { method: 'PATCH', body: JSON.stringify({ action: 'topup', amount: 50000 }) });
    await refreshMe(); document.dispatchEvent(new CustomEvent('lilac:me')); pageAccount();
  });
  $('#acUpgrade')?.addEventListener('click', async () => {
    await api('/api/me', { method: 'PATCH', body: JSON.stringify({ action: 'upgrade' }) });
    await refreshMe(); document.dispatchEvent(new CustomEvent('lilac:me')); pageAccount();
  });
  $('#acAddCard')?.addEventListener('click', async () => {
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

/* ================= 페이지: 검색 ================= */
export async function pageSearch(q: string) {
  root().innerHTML = `
    <section class="sec page-top">
      <div class="sec-head"><h2>‘${esc(q)}’ 검색 결과</h2><span class="sec-sub">Apple Music 카탈로그</span></div>
      <div id="srBody"><p class="loading">…</p></div>
    </section>`;
  const { tracks } = await api(`/api/catalog/search?term=${encodeURIComponent(q)}&limit=15`).catch(() => ({ tracks: [] }));
  if (!tracks.length) { $('#srBody').innerHTML = '<p class="loading">결과가 없습니다</p>'; return; }
  const entries = (tracks as CatalogTrack[]).map((c, i) => ({ rank: i + 1, title: c.title, artist: c.artist, artwork: artUrl(c, 100) }));
  $('#srBody').innerHTML = chartRows(entries, true);
  $('#srBody').querySelectorAll<HTMLElement>('.chart-row').forEach((row, i) =>
    row.addEventListener('click', () => playQueue((tracks as CatalogTrack[]).map((c) => toPlayable(c)), i)));
}

export function page404() {
  root().innerHTML = `<section class="sec page-top"><div class="sec-head"><h2>페이지를 찾을 수 없습니다</h2></div><a class="btn-out" href="#/">${t('nav.home')}</a></section>`;
}
