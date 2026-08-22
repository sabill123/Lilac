import { api, findCatalog, artUrl, esc, icon, me, refreshMe } from './api';
import type { Artist, SeedTrack, Ev, Product, CatalogTrack, PlayableTrack } from './api';
import { playQueue, openYt, toast, enqueue, openPlaylistPicker } from './player';
import { applyTone } from './colors';
import { openContextMenu, bindTilt, bindDragReorder } from './interactions';
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
/** 플레이 모드 = 전 페이지 스포티파이 디자인 */
const isPlay = () => document.body.classList.contains('play-mode');

/** 스포티파이식 페이지 헤더 (플리/차트/스토어/일정 공용) */
function spHeader(o: { label: string; title: string; meta: string; cover?: string; coverIcon?: string; mosaic?: string[] }) {
  const cover = o.mosaic?.length
    ? `<div class="sp-cover mosaic" data-tilt="9">${o.mosaic.map((a) => `<span style="background-image:url(${esc(a)})"></span>`).join('')}</div>`
    : o.cover
      ? `<div class="sp-cover" style="background-image:url(${esc(o.cover)})" data-tilt="9"></div>`
      : `<div class="sp-cover empty" data-tilt="9">${icon(o.coverIcon || 'i-queue', 'ic ph-ic')}</div>`;
  return `<div class="sp-head">${cover}
    <div class="sp-info">
      <p class="sp-label">${esc(o.label)}</p>
      <h1 class="sp-title plain">${esc(o.title)}</h1>
      <p class="sp-meta">${o.meta}</p>
    </div></div>`;
}

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
      ${opts.album === false ? '' : `<span class="t-al">${esc(r.album || '—')}</span>`}
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
      await api('/api/likes', { method: 'POST', body: JSON.stringify({ track: { title: tr.title, artist: tr.artist, album: tr.album, artwork: tr.artwork, preview: tr.preview, durationMs: tr.durationMs } }) });
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
function fillEventArts(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('[data-artist]').forEach((el) => {
    const a = artists.find((x) => x.name === el.dataset.artist);
    if (a) findCatalog(a.searchTerm).then((hit) => { if (hit) el.style.backgroundImage = `url(${artUrl(hit, 600)})`; });
  });
}

/* ================= 홈 ================= */
export async function pageHome() {
  if (isPlay()) return pageHomePlay();
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

  // 플레이 모드 전용: 스포티파이 홈의 바로 가기 타일
  if (document.body.classList.contains('play-mode')) {
    const [lists, likes] = await Promise.all([api('/api/playlists').catch(() => []), api('/api/likes').catch(() => [])]);
    const quick = [
      ...(likes.length ? [{ name: t('lib.likes'), href: '#/library/likes', liked: true, art: '' }] : []),
      ...lists.slice(0, 5).map((p: { id: string; name: string; tracks: PlayableTrack[] }) => ({ name: p.name, href: `#/playlist/${p.id}`, liked: false, art: p.tracks[0]?.artwork || '' })),
    ].slice(0, 6);
    if (quick.length) {
      root().insertAdjacentHTML('afterbegin', `
        <section class="sec quick-sec"><div class="sec-head"><h2>바로 가기</h2></div>
        <div class="quick-grid">${quick.map((q) => `
          <a class="quick" href="${q.href}">
            <span class="quick-art ${q.liked ? 'liked' : ''}" style="background-image:url(${esc(q.art)})">${q.liked ? icon('i-heart-f', 'ic s') : ''}</span>
            <b>${esc(q.name)}</b>
            <span class="quick-play">${icon('i-play')}</span>
          </a>`).join('')}</div></section>`);
    }
  }

  findCatalog(feat.searchTerm).then((hit) => {
    const blur = document.getElementById('bbBlur'), cardEl = document.getElementById('bbCard');
    if (!hit || !blur || !cardEl) return;
    const big = artUrl(hit, 1200);
    blur.style.backgroundImage = `url(${big})`;
    cardEl.innerHTML = `<img class="bb-card-inner" src="${big}" alt=""/><span class="glare"></span>`;
    void applyTone(document.getElementById('bb'), artUrl(hit, 200));
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
    const sq = document.querySelectorAll<HTMLElement>('#hMoods .mood-sq')[i];
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
  bindTilt($('#hStore'));
}

/* ================= 차트 ================= */
/* ---- 플레이 모드 홈 (스포티파이 홈) ---- */
async function pageHomePlay() {
  const hour = new Date().getHours();
  const greet = hour < 6 ? '깊은 밤이에요' : hour < 12 ? '좋은 아침이에요' : hour < 18 ? '좋은 오후예요' : '좋은 저녁이에요';
  root().innerHTML = `
    <section class="sec home-play">
      <h1 class="greet">${greet}</h1>
      <div class="quick-grid" id="hQuick"></div>
    </section>
    <section class="sec"><div class="sec-head"><h2>최근 재생</h2><a class="sec-link" href="#/library/history">${t('more')} ${icon('i-chev-r', 'ic s')}</a></div><div id="hRecent">${skCards(6)}</div></section>
    <section class="sec"><div class="sec-head"><h2>오늘의 추천</h2><a class="sec-link" href="#/chart">${t('chart.viewAll')} ${icon('i-chev-r', 'ic s')}</a></div><div id="hPicks">${skCards(6)}</div></section>
    <section class="sec"><div class="sec-head"><h2>${t('artists')}</h2></div><div id="hArtists">${skCards(7, true)}</div></section>
    <section class="sec"><div class="sec-head"><h2>무드로 듣기</h2></div><div class="mood-grid" id="hMoods"></div></section>`;

  // 바로 가기
  const [lists, likes, hist] = await Promise.all([
    api('/api/playlists').catch(() => []), api('/api/likes').catch(() => []), api('/api/history').catch(() => []),
  ]);
  const quick = [
    ...(likes.length ? [{ name: t('lib.likes'), href: '#/library/likes', liked: true, art: '' }] : []),
    ...lists.slice(0, 5).map((p: { id: string; name: string; tracks: PlayableTrack[] }) => ({ name: p.name, href: `#/playlist/${p.id}`, liked: false, art: p.tracks[0]?.artwork || '' })),
  ].slice(0, 6);
  $('#hQuick').innerHTML = quick.length ? quick.map((q) => `
    <a class="quick" href="${q.href}">
      <span class="quick-art ${q.liked ? 'liked' : ''}" style="background-image:url(${esc(q.art)})">${q.liked ? icon('i-heart-f', 'ic s') : ''}</span>
      <b>${esc(q.name)}</b><span class="quick-play">${icon('i-play')}</span></a>`).join('')
    : `<p class="loading">플레이리스트를 만들면 여기에 표시됩니다</p>`;

  // 최근 재생
  const recent: PlayableTrack[] = (hist as PlayableTrack[]).filter((h, i, arr) => arr.findIndex((x) => x.title === h.title) === i).slice(0, 6);
  if (recent.length) {
    $('#hRecent').innerHTML = `<div class="shelf">${recent.map((h, i) => `
      <a class="card" href="javascript:void 0" data-r="${i}" data-tilt="8" data-expand>
        <div class="cover"><img src="${esc(h.artwork || '')}" alt="" loading="lazy"/><span class="glare"></span>
          <button class="hover-play" data-play="${i}">${icon('i-play')}</button></div>
        <div class="c-title">${esc(h.title)}</div><div class="c-sub">${esc(h.artist)}</div></a>`).join('')}</div>`;
    $('#hRecent').querySelectorAll<HTMLElement>('[data-r]').forEach((el) =>
      el.addEventListener('click', () => playQueue(recent, Number(el.dataset.r))));
  } else {
    $('#hRecent').innerHTML = `<div class="empty-box sm">${icon('i-clock', 'ic eb')}<p>재생 기록이 없습니다</p></div>`;
  }

  // 오늘의 추천 (시드곡)
  const hits = await Promise.all(seeds.slice(0, 6).map((s) => findCatalog(s.searchTerm)));
  const picks = hits.map((h, i) => (h ? toPlayable(h, seeds[i].youtubeId) : null)).filter(Boolean) as PlayableTrack[];
  const pickBox = document.getElementById('hPicks');
  if (pickBox) {
    pickBox.innerHTML = `<div class="shelf">${picks.map((h, i) => `
      <a class="card" href="javascript:void 0" data-p="${i}" data-tilt="8" data-expand>
        <div class="cover"><img src="${esc(h.artwork || '')}" alt="" loading="lazy"/><span class="glare"></span>
          <button class="hover-play" data-play="${i}">${icon('i-play')}</button></div>
        <div class="c-title">${esc(h.title)}</div><div class="c-sub">${esc(h.artist)}</div></a>`).join('')}</div>`;
    pickBox.querySelectorAll<HTMLElement>('[data-p]').forEach((el) =>
      el.addEventListener('click', () => playQueue(picks, Number(el.dataset.p))));
  }

  // 아티스트
  const ab = document.getElementById('hArtists');
  if (ab) {
    ab.innerHTML = shelf(artists.map((a) => ({ title: a.name, sub: t('artists'), round: true, href: `#/artist/${a.id}`, term: a.searchTerm })));
    fillShelfArts(ab);
  }

  // 무드
  const moods = [
    { k: '애니 타이업', c: '#8b5cf6,#4c1d95', q: 'anime' },
    { k: '심야 시티팝', c: '#0ea5e9,#0c4a6e', q: 'city pop' },
    { k: 'J-ROCK', c: '#ef4444,#7f1d1d', q: 'j-rock' },
    { k: '보컬로이드', c: '#22d3ee,#155e75', q: 'vocaloid' },
    { k: '발라드', c: '#f59e0b,#7c2d12', q: 'ballad' },
    { k: '애니송 명곡', c: '#ec4899,#831843', q: 'anison' },
  ];
  const mb = document.getElementById('hMoods');
  if (mb) {
    mb.innerHTML = moods.map((m) => `
      <a class="mood" href="#/search?q=${encodeURIComponent(m.q)}" style="--m:linear-gradient(135deg,${m.c})" data-tilt="6">
        <span class="mood-k">${m.k}</span><span class="mood-sq"></span></a>`).join('');
    moods.forEach(async (m, i) => {
      const hit = await findCatalog(m.q === 'anime' ? seeds[0].searchTerm : m.q);
      const sq = document.querySelectorAll<HTMLElement>('#hMoods .mood-sq')[i];
      if (hit && sq) sq.style.backgroundImage = `url(${artUrl(hit, 200)})`;
    });
  }
}

export async function pageChart(sub?: string) {
  if (isPlay()) return pageChartPlay(sub);
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
  $('#chUpdated').innerHTML = `<span class="chart-live">${data.live ? `<span class="live-badge on">실시간</span>` : ''}${new Date(data.updated).toLocaleString()} 기준</span>`;
  if (data.list[0]?.artwork) void applyTone(document.querySelector('.chart-hero'), data.list[0].artwork);
  $('#chartBody').innerHTML = rankList(data.list, { big: true });
  bindRank($('#chartBody'), data.list);
  data.list.forEach(async (e: { artwork?: string; searchTerm?: string; artist: string; title: string }, i: number) => {
    if (!e.artwork) {
      const hit = await findCatalog(e.searchTerm || `${e.artist} ${e.title}`);
      const art = document.querySelectorAll('#chartBody .rk-art')[i];
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

/* ---- 플레이 모드 차트 (스포티파이 플리 페이지 구조) ---- */
async function pageChartPlay(sub?: string) {
  const source = sub || 'combined';
  const label: Record<string, string> = { combined: '종합 차트', apple: 'Apple Music 차트', youtube: 'YouTube 차트' };
  root().innerHTML = `
    <section class="sp-page">
      <div id="chHead"></div>
      <div class="sp-actions">
        <button class="play-big" id="chPlayAll">${icon('i-play')}</button>
        <button class="tbtn big-ghost" id="chShuffle" title="셔플">${icon('i-shuffle')}</button>
        <div class="seg small">${(['combined', 'apple', 'youtube'] as const).map((s) => `<a class="seg-btn ${s === source ? 'on' : ''}" href="#/chart/${s}">${t('chart.' + s)}</a>`).join('')}</div>
      </div>
      <div class="sp-body"><div id="chBody">${skRows(8)}</div></div>
    </section>`;

  const data = await api(`/api/chart?source=${source}`).catch(() => null);
  const head = document.getElementById('chHead');
  if (!data || !head) { const b = document.getElementById('chBody'); if (b) b.innerHTML = '<p class="loading">차트를 불러오지 못했습니다</p>'; return; }

  const entries = data.list as { rank: number; title: string; artist: string; artwork?: string; searchTerm?: string; youtubeId?: string | null; ytViews?: number }[];
  const covers = entries.slice(0, 4).map((e) => e.artwork).filter(Boolean) as string[];
  head.innerHTML = spHeader({
    label: '차트',
    title: label[source],
    meta: `${data.live ? '<span class="live-badge on">실시간</span>' : ''}${esc(data.note)}<span class="sep">·</span>${entries.length}곡`,
    mosaic: covers.length >= 4 ? covers : undefined,
    cover: covers[0],
  });
  if (covers[0]) void applyTone(document.querySelector('.sp-head'), covers[0]);
  bindTilt(root());

  // 트랙 테이블로 렌더링 (스포티파이 동일)
  const rows: PlayableTrack[] = entries.map((e) => ({
    title: e.title, artist: e.artist, artwork: e.artwork,
    album: e.ytViews ? `${(e.ytViews / 1e8).toFixed(2)}억 회` : '',
  }));
  const body = document.getElementById('chBody')!;
  body.innerHTML = trackTable(rows, { album: true, date: false, sticky: true });
  // 열 제목 교체
  const alHead = body.querySelector('.t-head .t-al');
  if (alHead) alHead.textContent = source === 'youtube' ? '조회수' : '지표';

  // 재생 시 카탈로그에서 실제 프리뷰 해석
  const resolveAll = async () => {
    const out: PlayableTrack[] = [];
    for (const e of entries) {
      const hit = await findCatalog(e.searchTerm || `${e.artist} ${e.title}`);
      out.push(hit ? toPlayable(hit, e.youtubeId) : { title: e.title, artist: e.artist, artwork: e.artwork });
    }
    return out;
  };
  body.querySelectorAll<HTMLElement>('.t-row').forEach((row) => {
    row.addEventListener('click', async (ev) => {
      if ((ev.target as HTMLElement).closest('.t-a')) return;
      const list = await resolveAll();
      playQueue(list, Number(row.dataset.i));
      body.querySelectorAll('.t-row').forEach((r) => r.classList.remove('playing'));
      row.classList.add('playing');
    });
  });
  $('#chPlayAll').addEventListener('click', async () => { const l = await resolveAll(); if (l.length) playQueue(l, 0); });
  $('#chShuffle').addEventListener('click', async () => { const l = await resolveAll(); if (l.length) playQueue(l.sort(() => Math.random() - 0.5), 0); });

  // 아트워크 없는 항목 보충
  entries.forEach(async (e, i) => {
    if (e.artwork) return;
    const hit = await findCatalog(e.searchTerm || `${e.artist} ${e.title}`);
    const img = document.querySelectorAll<HTMLImageElement>('#chBody .t-title img')[i];
    if (hit && img) img.src = artUrl(hit, 100);
  });
}

/* ================= 스토어 (BM: 일본 내수반 정식 공동구매) ================= */
const won = (n: number) => `₩${n.toLocaleString()}`;
const SIZE_FILTERS = [
  { k: 'all', label: '전체' }, { k: 'limited', label: '한정반' },
  { k: 'album', label: '정규 앨범' }, { k: 'mini', label: '미니 앨범' }, { k: 'single', label: '싱글' },
];
let stFilterSize = 'all';
let stFilterArtist = 'all';
let stSort: 'new' | 'low' | 'high' | 'name' = 'new';
let stPage = 1;
const PAGE_SIZE = 24;

function storeFiltered() {
  let list = products.slice();
  if (stFilterSize === 'limited') list = list.filter((p) => p.editions.some((e) => e.id === 'limited'));
  else if (stFilterSize !== 'all') list = list.filter((p) => p.size === stFilterSize);
  if (stFilterArtist !== 'all') list = list.filter((p) => p.brand === stFilterArtist);
  if (stSort === 'low') list.sort((a, b) => a.price - b.price);
  else if (stSort === 'high') list.sort((a, b) => b.price - a.price);
  else if (stSort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  else list.sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''));
  return list;
}
function productCard(p: Product) {
  const hasLtd = p.editions.some((e) => e.id === 'limited');
  return `<a class="p-card" href="#/store/${p.id}" data-tilt="7">
    <div class="p-img">
      <img src="${esc(p.artwork)}" alt="" loading="lazy"/>
      <span class="p-badge ${hasLtd ? 'ltd' : ''}">${esc(p.badge)}</span>
      ${p.stock <= 10 ? `<span class="p-stock">잔여 ${p.stock}</span>` : ''}
    </div>
    <div class="p-brand">${esc(p.brand)}</div>
    <div class="p-name">${esc(p.name)}</div>
    <div class="p-price">${won(p.price)}</div>
    <div class="p-sub">${esc(p.releaseDate?.slice(0, 4) || '')} · ${p.trackCount}곡</div>
  </a>`;
}

function storeToolbar(dark: boolean) {
  const brands = [...new Set(products.map((p) => p.brand))];
  return `
    <div class="st-filters">
      <div class="chips">${SIZE_FILTERS.map((f) => `<button class="chip ${f.k === stFilterSize ? 'on' : ''}" data-size="${f.k}">${f.label}</button>`).join('')}</div>
      <div class="chips artist-chips">
        <button class="chip ${stFilterArtist === 'all' ? 'on' : ''}" data-artist="all">모든 아티스트</button>
        ${brands.map((b) => `<button class="chip ${stFilterArtist === b ? 'on' : ''}" data-artist="${esc(b)}">${esc(b)}</button>`).join('')}
      </div>
    </div>
    <div class="st-bar">
      <span class="st-count" id="stCount"></span>
      <select id="stSort" class="${dark ? 'dark-select' : ''}">
        <option value="new">최신 발매순</option>
        <option value="low">낮은 가격순</option>
        <option value="high">높은 가격순</option>
        <option value="name">이름순</option>
      </select>
    </div>`;
}

function bindStoreToolbar(render: () => void) {
  document.querySelectorAll<HTMLButtonElement>('[data-size]').forEach((b) =>
    b.addEventListener('click', () => {
      stFilterSize = b.dataset.size!; stPage = 1;
      document.querySelectorAll('[data-size]').forEach((x) => x.classList.remove('on'));
      b.classList.add('on'); render();
    }));
  document.querySelectorAll<HTMLButtonElement>('[data-artist]').forEach((b) =>
    b.addEventListener('click', () => {
      stFilterArtist = b.dataset.artist!; stPage = 1;
      document.querySelectorAll('[data-artist]').forEach((x) => x.classList.remove('on'));
      b.classList.add('on'); render();
    }));
  const sel = document.getElementById('stSort') as HTMLSelectElement | null;
  if (sel) {
    sel.value = stSort;
    sel.addEventListener('change', () => { stSort = sel.value as never; stPage = 1; render(); });
  }
}

export async function pageStore() {
  if (isPlay()) return pageStorePlay();
  const fx = await api('/api/db/fx').catch(() => null);
  root().innerHTML = `
    <div class="store-wrap page-top full"><div class="store-inner">
      <div class="store-hero2">
        <div>
          <p class="sh-eyebrow">LILAC STORE</p>
          <h2>일본 내수 한정반,<br/>정식 루트로 받아보세요</h2>
          <p class="sh-sub">해외 배송이 지원되지 않는 상품을 현지에서 매입해 합배송으로 전달합니다.
            판매가는 <b>일본 정가 × 실시간 환율 + 대행 수수료 + 배송 분담</b>으로 자동 산출됩니다.</p>
          ${fx ? `<p class="fx-line">적용 환율 <b>1엔 = ${fx.rate}원</b> <span class="src-badge real">${fx.date} 실시간</span></p>` : ''}
        </div>
        <div class="sh-stats">
          <div><b>${products.length}</b><span>취급 상품</span></div>
          <div><b>${products.filter((p) => p.editions.some((e) => e.id === 'limited')).length}</b><span>한정반</span></div>
          <div><b>${[...new Set(products.map((p) => p.brand))].length}</b><span>아티스트</span></div>
        </div>
      </div>
      ${storeToolbar(false)}
      <div class="store-grid" id="storeGrid"></div>
      <div class="st-more-wrap"><button class="btn-out st-more" id="stMore">더보기</button></div>
    </div></div>`;
  const render = () => {
    const list = storeFiltered();
    const shown = list.slice(0, stPage * PAGE_SIZE);
    $('#stCount').textContent = `${list.length}개 상품${list.length > shown.length ? ` (${shown.length}개 표시)` : ''}`;
    $('#storeGrid').innerHTML = shown.map(productCard).join('') || `<div class="empty-box">${icon('i-bag', 'ic eb')}<p>조건에 맞는 상품이 없습니다</p></div>`;
    const more = document.getElementById('stMore') as HTMLButtonElement;
    if (more) more.style.display = list.length > shown.length ? '' : 'none';
    bindTilt($('#storeGrid'));
  };
  render();
  bindStoreToolbar(render);
  $('#stMore').addEventListener('click', () => { stPage++; render(); });
}

/* ---- 플레이 모드 스토어 (다크 스포티파이) ---- */
async function pageStorePlay() {
  const fx = await api('/api/db/fx').catch(() => null);
  root().innerHTML = `
    <section class="sp-page">
      <div id="stHead"></div>
      <div class="sp-body">
        ${storeToolbar(true)}
        <div class="lib-grid2" id="stGrid"></div>
        <div class="st-more-wrap"><button class="tbtn big-ghost st-more" id="stMore">더보기</button></div>
      </div>
    </section>`;
  const head = document.getElementById('stHead');
  if (head) {
    head.innerHTML = spHeader({
      label: '스토어', title: t('store.title'),
      meta: `${products.length}개 상품<span class="sep">·</span>${fx ? `1엔 = ${fx.rate}원 <span class="src-badge real">실시간</span>` : ''}`,
      mosaic: products.slice(0, 4).map((p) => p.artwork),
    });
    if (products[0]) void applyTone(document.querySelector('.sp-head'), products[0].artwork);
  }
  bindTilt(root());
  const render = () => {
    const list = storeFiltered();
    const shown = list.slice(0, stPage * PAGE_SIZE);
    $('#stCount').textContent = `${list.length}개 상품`;
    $('#stGrid').innerHTML = shown.map((p) => `
      <a class="lib-card" href="#/store/${p.id}" data-tilt="7">
        <div class="lib-cover"><img src="${esc(p.artwork)}" alt="" loading="lazy"/>
          <span class="card-badge">${esc(p.badge)}</span></div>
        <div class="c-title">${esc(p.name)}</div>
        <div class="c-sub">${esc(p.brand)} · ${won(p.price)}</div>
      </a>`).join('') || `<div class="empty-box">${icon('i-bag', 'ic eb')}<p>조건에 맞는 상품이 없습니다</p></div>`;
    const more = document.getElementById('stMore') as HTMLButtonElement;
    if (more) more.style.display = list.length > shown.length ? '' : 'none';
    bindTilt($('#stGrid'));
  };
  render();
  bindStoreToolbar(render);
  $('#stMore').addEventListener('click', () => { stPage++; render(); });
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
        <div class="pd-img"><img src="${esc(p.artwork)}" alt=""/><span class="p-badge ${p.editions.some((e) => e.id === 'limited') ? 'ltd' : ''}">${esc(p.badge)}</span></div>
        <div class="pd-info">
          <p class="p-brand">${esc(p.brand)} · ${esc(p.sizeLabel)}</p>
          <h2 class="pd-name">${esc(p.name)}</h2>
          <p class="pd-meta-line">${esc(p.releaseDate)} 발매 · ${p.trackCount}곡 · 재고 ${p.stock}개</p>
          <p class="pd-price" id="pdPrice">${won(p.editions[0].pricing.total)}</p>
          <div class="pd-ed" id="pdEd">
            ${p.editions.map((e, i) => `
              <button class="ed ${i === 0 ? 'on' : ''}" data-e="${i}">
                <span class="ed-label">${esc(e.label)}${e.real ? ' <span class="src-badge real">Apple 실정가</span>' : ''}</span>
                <span class="ed-price">${won(e.pricing.total)}</span>
                <span class="ed-jpy">일본 정가 ¥${e.jpy.toLocaleString()}</span>
              </button>`).join('')}
          </div>
          <div class="pd-row"><span>${t('store.qty')}</span><input id="pdQty" type="number" min="1" max="${p.stock}" value="1" /></div>
          <div class="pd-actions">
            <button class="btn-buy" id="pdOrder">${t('store.reserve')}</button>
            <a class="btn-out" href="${p.appleUrl}" target="_blank" rel="noopener">Apple Music ${icon('i-ext', 'ic s')}</a>
            <a class="btn-out" href="${p.towerUrl}" target="_blank" rel="noopener">${t('store.tower')} ${icon('i-ext', 'ic s')}</a>
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
    $('#pdPrice').textContent = won(e.pricing.total);
    $('#pdCalc').innerHTML = `
      <p class="calc-title">가격은 이렇게 계산됩니다 ${e.digital ? '<span class="calc-note">디지털 상품은 배송비가 없지만 데모에서는 동일 공식을 적용합니다</span>' : ''}</p>
      <table class="calc-table"><tbody>
        <tr><th>일본 정가</th><td>¥${e.jpy.toLocaleString()}</td><td class="calc-src">${e.real ? 'Apple Music 실데이터' : '일본 CD 시장 통상가 기준 추정'}</td></tr>
        <tr><th>적용 환율</th><td>× ${e.pricing.rate}</td><td class="calc-src">${esc(p.rateDate)} ${p.rateLive ? '실시간' : '캐시'}</td></tr>
        <tr><th>상품 원가</th><td>${won(e.pricing.base)}</td><td class="calc-src"></td></tr>
        <tr><th>대행 수수료</th><td>+ ${won(e.pricing.fee)}</td><td class="calc-src">${Math.round(e.pricing.feeRate * 100)}% (Lilac 마진)</td></tr>
        <tr><th>국제배송 분담</th><td>+ ${won(e.pricing.shipping)}</td><td class="calc-src">합배송 기준</td></tr>
        <tr class="calc-total"><th>최종 판매가</th><td>${won(e.pricing.total)}</td><td class="calc-src">100원 단위 올림</td></tr>
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
        <tr><th>공식 운영사</th><td>${esc(p.operator)}</td></tr>
        <tr><th>재고</th><td>${p.stock}개</td></tr>
      </tbody></table>`,
    ship: `<ul class="pd-ul">
        <li>현지 매입 후 합배송으로 발송하며, 예약 상품은 일본 발매일 이후 순차 발송됩니다(통상 2~3주).</li>
        <li>국제배송 분담금 3,500원은 합배송 기준으로 판매가에 이미 포함되어 있습니다.</li>
        <li>초회한정반·특전은 현지 수량 소진 시 통상반으로 대체되거나 주문이 취소될 수 있습니다.</li>
        <li>단순 변심 교환·반품은 미개봉 상태에서 수령 후 7일 이내 가능합니다.</li>
        <li class="dim">데모 페이지입니다. 실제 결제·배송은 이루어지지 않습니다.</li>
      </ul>`,
    op: `<p>이 상품의 공식 운영사는 <b>${esc(p.operator)}</b>입니다.</p>
      <p class="dim">Lilac은 티켓 재판매를 취급하지 않으며, 공식 유통채널에서 매입한 상품만 중개합니다.</p>
      <div class="pd-actions">
        <a class="btn-out" href="${p.officialUrl}" target="_blank" rel="noopener">아티스트 공식 사이트 ${icon('i-ext', 'ic s')}</a>
        <a class="btn-out" href="${p.towerUrl}" target="_blank" rel="noopener">${t('store.tower')} ${icon('i-ext', 'ic s')}</a>
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
interface RelItem { id: string; type: string; source: string; title: string; artist: string; artistId: string; date: string; venue: string; note: string; artwork: string; url: string }
export async function pageSchedule() {
  // 실데이터(Apple 발매일) + 데모 공연 일정 병합
  const rel = await api('/api/releases').catch(() => ({ releases: [] }));
  const realItems: Ev[] = ((rel.releases || []) as RelItem[]).map((r) => ({
    id: r.id, type: r.type, title: r.title, artist: r.artist, date: r.date, venue: r.venue, note: r.note,
  }));
  const demoItems: Ev[] = events.map((e) => ({ ...e }));
  const merged = [...realItems, ...demoItems];
  const isDemo = (e: Ev) => !e.id.startsWith('rel-');
  const artOf = new Map(((rel.releases || []) as RelItem[]).map((r) => [r.id, r.artwork]));
  const urlOf = new Map(((rel.releases || []) as RelItem[]).map((r) => [r.id, r.url]));
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
    <section class="sec page-top">
      <div class="page-head">
        <p class="sp-label">${t('nav.schedule')}</p>
        <h1 class="page-title">${t('schedule.title')}</h1>
        <p class="page-desc">다가오는 일정을 먼저 보여줍니다. 발매 일정은 <b>Apple Music 카탈로그 자동 수집 실데이터</b>(${realItems.length}건),
          공연·응모는 데모 데이터입니다.</p>
        <div class="sch-toolbar">
          <div class="chips" id="schFilters">
            <button class="chip on" data-f="all">전체</button>
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
      <p class="pd-note" style="margin-top:24px">데모 일정입니다. 실서비스에서는 공식 발표·팬클럽 공지를 자동 수집합니다.</p>
    </section>`;
  const matchF = (e: Ev, f: string) => (f === 'all' ? true : f === '__real' ? !isDemo(e) : e.type === f);
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
                <span class="src-badge ${isDemo(e) ? 'demo' : 'real'}">${isDemo(e) ? '데모' : 'Apple 실데이터'}</span>
                <span class="sch-dday ${d >= 0 && d <= 14 ? 'urgent' : ''}">${txt}</span>
              </div>
              <div class="sch-title">${esc(e.artist)} — ${esc(e.title)}</div>
              <div class="sch-sub">${esc(e.venue)} · ${esc(e.note)}</div>
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
      <div class="ar-info">
        <p class="ar-verified">${icon('i-check', 'ic s')} 인증된 아티스트</p>
        <h1 class="ar-name">${esc(a.name)}</h1>
        <p class="ar-stats" id="arStats"><span class="stat-sk"></span> · ${esc(a.nameJa)}</p>
      </div>
    </section>
    <div class="ar-actionbar">
      <button class="play-big" id="arPlay">${icon('i-play')}</button>
      <button class="tbtn big-ghost ${following ? 'on' : ''}" id="arFollow">${following ? '팔로잉' : '팔로우'}</button>
      <a class="tbtn big-ghost" href="${a.official}" target="_blank" rel="noopener" title="공식 사이트">${icon('i-ext')}</a>
      <span class="ar-op">${t('store.operator')} · ${esc(a.operator)}</span>
    </div>
    <section class="sec"><div class="sec-head"><h2>인기</h2></div><div id="arTracks">${skRows(5)}</div></section>
    <section class="sec" id="arDiscSec"><div class="sec-head"><h2>디스코그래피</h2><span class="sec-sub">Apple Music 카탈로그</span></div><div id="arDisc">${skCards(6)}</div></section>
    <section class="sec" id="arEvSec" style="display:none"><div class="sec-head"><h2>${t('schedule.title')}</h2><a class="sec-link" href="#/schedule">${t('more')} ${icon('i-chev-r', 'ic s')}</a></div><div class="ev-shelf" id="arEvents"></div></section>
    <section class="sec" id="arGoodsSec" style="display:none"><div class="sec-head"><h2>${t('store.title')}</h2><a class="sec-link" href="#/store">${t('more')} ${icon('i-chev-r', 'ic s')}</a></div><div class="store-dark-grid" id="arGoods"></div></section>
    <section class="sec"><div class="sec-head"><h2>비슷한 아티스트</h2></div><div id="arSimilar"></div></section>
    <section class="sec"><div class="sec-head"><h2>정보</h2></div>
      <div class="ar-about">
        <div class="ar-about-img" id="arAboutImg"></div>
        <div class="ar-about-txt">
          <p class="ar-listeners" id="arListeners"><span class="stat-sk"></span></p>
          <p>${esc(a.name)}(${esc(a.nameJa)})는 ${esc(a.genre)} 아티스트입니다. 공식 운영사는 ${esc(a.operator)}이며,
            Lilac은 공식 유통망과 연결된 정보만 표시합니다.</p>
          <p class="dim">이 소개문은 데모용으로 생성된 텍스트입니다. 실서비스에서는 레이블 제공 프로필이 들어갑니다.</p>
          <a class="btn-out" href="${a.official}" target="_blank" rel="noopener">공식 사이트 ${icon('i-ext', 'ic s')}</a>
        </div>
      </div>
    </section>`;

  findCatalog(a.searchTerm).then((hit) => {
    const bg = document.getElementById('arBg');
    if (!hit || !bg) return;
    bg.style.backgroundImage = `url(${artUrl(hit, 1200)})`;
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
    bindTilt($('#arGoods'));
  }
  // 실제 지표 (YouTube 공식 MV 누적 조회수 합산)
  api(`/api/artist/${a.id}/stats`).then((s: { totalViews: number; trackCount: number; live: boolean; source: string }) => {
    const st = document.getElementById('arStats');
    const ls = document.getElementById('arListeners');
    if (!s.totalViews) {
      if (st) st.innerHTML = `${esc(a.genre)} · ${esc(a.nameJa)}`;
      if (ls) ls.innerHTML = `<span class="dim">공개 지표를 가져오지 못했습니다</span>`;
      return;
    }
    const txt = `YouTube 공식 MV 누적 <b>${fmtViews(s.totalViews)}회</b>`;
    if (st) st.innerHTML = `${txt.replace(/<\/?b>/g, '')} · ${esc(a.nameJa)}`;
    if (ls) ls.innerHTML = `${txt} <span class="live-badge ${s.live ? 'on' : ''}">${s.live ? '실시간' : '캐시'}</span>
      <span class="dim" style="display:block;font-size:12px;margin-top:4px">${esc(s.source)} · 등록곡 ${s.trackCount}개 기준</span>`;
  }).catch(() => {
    const st = document.getElementById('arStats');
    if (st) st.textContent = `${a.genre} · ${a.nameJa}`;
  });

  // 디스코그래피
  api(`/api/catalog/albums?term=${encodeURIComponent(a.searchTerm)}`).then((r) => {
    const albums = (r.albums || []) as { id: number; title: string; artist: string; artwork: string; year: string; trackCount: number; appleUrl: string }[];
    const mine = albums.filter((x) => x.artist === a.searchTerm || x.artist === a.name || x.artist === a.nameJa);
    const use = (mine.length ? mine : albums).slice(0, 8);
    const el = document.getElementById('arDisc');
    const sec = document.getElementById('arDiscSec');
    if (!el || !sec) return;
    if (!use.length) { sec.style.display = 'none'; return; }
    el.innerHTML = `<div class="shelf">${use.map((al) => `
      <a class="card" href="${al.appleUrl}" target="_blank" rel="noopener" data-tilt="8">
        <div class="cover"><img src="${esc(al.artwork)}" alt="" loading="lazy"/><span class="glare"></span>
          <span class="card-badge">${al.trackCount}곡</span></div>
        <div class="c-title">${esc(al.title)}</div><div class="c-sub">${esc(al.year)} · 앨범</div>
      </a>`).join('')}</div>`;
    bindTilt(el);
    const about = document.getElementById('arAboutImg');
    if (use[0] && about) about.style.backgroundImage = `url(${esc(use[0].artwork)})`;
  }).catch(() => { const s = document.getElementById('arDiscSec'); if (s) s.style.display = 'none'; });

  const sim = artists.filter((x) => x.id !== a.id).slice(0, 6);
  $('#arSimilar').innerHTML = shelf(sim.map((x) => ({ title: x.name, sub: x.genre, round: true, href: `#/artist/${x.id}`, term: x.searchTerm })));
  fillShelfArts($('#arSimilar'));
}

/* ================= 보관함 (독립 페이지) =================
   레퍼런스: 스포티파이 라이브러리(필터 칩·정렬·그리드/리스트 토글)
   + 라프텔(태그 필터 감각) + 넷플릭스(행 단위 큐레이션) */
type LibFilter = 'all' | 'playlists' | 'artists' | 'likes' | 'history';
let libView: 'grid' | 'list' = (localStorage.getItem('lilac.libView') as 'grid' | 'list') || 'grid';
let libSort: 'recent' | 'name' | 'count' = (localStorage.getItem('lilac.libSort') as never) || 'recent';

export async function pageLibrary(sub?: string) {
  const filter = (sub || 'all') as LibFilter;
  const [likes, lists, hist, oshi] = await Promise.all([
    api('/api/likes').catch(() => []), api('/api/playlists').catch(() => []),
    api('/api/history').catch(() => []), api('/api/oshi').catch(() => []),
  ]);

  const FILTERS: { k: LibFilter; label: string }[] = [
    { k: 'all', label: '전체' }, { k: 'playlists', label: t('lib.playlists') },
    { k: 'artists', label: t('lib.follows') }, { k: 'likes', label: t('lib.likes') }, { k: 'history', label: t('lib.history') },
  ];

  root().innerHTML = `
    <section class="lib-page">
      <div class="lib-head">
        <div class="lib-title-row">
          <h1 class="page-title">${t('nav.library')}</h1>
          <button class="lib-newbtn" id="libNew">${icon('i-plus', 'ic s')} ${t('lib.newPlaylist')}</button>
        </div>
        <div class="lib-filters">
          ${FILTERS.map((f) => `<a class="chip ${f.k === filter ? 'on' : ''}" href="#/library/${f.k}">${f.label}</a>`).join('')}
        </div>
        <div class="lib-toolbar">
          <div class="lib-find">${icon('i-search', 'ic s')}<input id="libFind" placeholder="보관함에서 찾기" /></div>
          <div class="lib-tools">
            <select id="libSort">
              <option value="recent" ${libSort === 'recent' ? 'selected' : ''}>최근 추가순</option>
              <option value="name" ${libSort === 'name' ? 'selected' : ''}>이름순</option>
              <option value="count" ${libSort === 'count' ? 'selected' : ''}>곡 많은순</option>
            </select>
            <button class="view-toggle ${libView === 'grid' ? 'on' : ''}" id="libGrid" title="그리드">${icon('i-grid', 'ic s')}</button>
            <button class="view-toggle ${libView === 'list' ? 'on' : ''}" id="libList" title="리스트">${icon('i-rows', 'ic s')}</button>
          </div>
        </div>
      </div>
      <div id="libBody"></div>
    </section>`;

  type Item = { id: string; kind: 'playlist' | 'artist' | 'likes'; name: string; sub: string; art?: string; term?: string; href: string; count: number; at: string };
  const items: Item[] = [];
  if (filter === 'all' || filter === 'likes') {
    items.push({ id: 'likes', kind: 'likes', name: t('lib.likes'), sub: `플레이리스트 · ${likes.length}곡`, href: '#/library/likes', count: likes.length, at: likes[0]?.likedAt || '' });
  }
  if (filter === 'all' || filter === 'playlists') {
    lists.forEach((p: { id: string; name: string; tracks: PlayableTrack[]; createdAt: string }) =>
      items.push({ id: p.id, kind: 'playlist', name: p.name, sub: `플레이리스트 · ${p.tracks.length}곡`, art: p.tracks[0]?.artwork, href: `#/playlist/${p.id}`, count: p.tracks.length, at: p.createdAt }));
  }
  if (filter === 'all' || filter === 'artists') {
    oshi.forEach((o: { artistId: string; name: string; at: string }) => {
      const a = artists.find((x) => x.id === o.artistId);
      items.push({ id: o.artistId, kind: 'artist', name: o.name, sub: `아티스트 · ${a?.genre ?? ''}`, term: a?.searchTerm, href: `#/artist/${o.artistId}`, count: 0, at: o.at });
    });
  }

  const body = $('#libBody');
  const renderItems = (q = '') => {
    if (filter === 'likes' && sub === 'likes') { /* 전용 뷰 아래에서 처리 */ }
    let rows = items.filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()));
    if (libSort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
    else if (libSort === 'count') rows.sort((a, b) => b.count - a.count);
    else rows.sort((a, b) => (b.at || '').localeCompare(a.at || ''));

    if (!rows.length) {
      body.innerHTML = `<div class="empty-box">${icon('i-lib', 'ic eb')}<p>항목이 없습니다</p><span>플레이리스트를 만들거나 아티스트를 팔로우해 보세요</span></div>`;
      return;
    }
    if (libView === 'grid') {
      body.innerHTML = `<div class="lib-grid2">${rows.map((i) => `
        <a class="lib-card ${i.kind === 'artist' ? 'round' : ''}" href="${i.href}" data-id="${i.id}" data-kind="${i.kind}" data-term="${esc(i.term || '')}" data-tilt="7">
          <div class="lib-cover ${i.kind === 'likes' ? 'liked' : ''}">
            ${i.kind === 'likes' ? icon('i-heart-f', 'ic lt') : i.art ? `<img src="${esc(i.art)}" alt="" loading="lazy"/>` : `<span class="ph">${esc(i.name[0])}</span>`}
            <button class="hover-play" data-play="${i.id}">${icon('i-play')}</button>
          </div>
          <div class="c-title">${esc(i.name)}</div><div class="c-sub">${esc(i.sub)}</div>
        </a>`).join('')}</div>`;
    } else {
      body.innerHTML = `<div class="lib-rows">${rows.map((i) => `
        <a class="lib-row ${i.kind === 'artist' ? 'round' : ''}" href="${i.href}" data-id="${i.id}" data-kind="${i.kind}" data-term="${esc(i.term || '')}">
          <span class="lib-rcover ${i.kind === 'likes' ? 'liked' : ''}">
            ${i.kind === 'likes' ? icon('i-heart-f', 'ic s') : i.art ? `<img src="${esc(i.art)}" alt="" loading="lazy"/>` : `<span class="ph">${esc(i.name[0])}</span>`}</span>
          <span class="lib-rmeta"><b>${esc(i.name)}</b><i>${esc(i.sub)}</i></span>
          <span class="lib-rdate">${i.at ? new Date(i.at).toLocaleDateString() : '—'}</span>
        </a>`).join('')}</div>`;
    }
    // 아티스트 커버 채우기
    body.querySelectorAll<HTMLElement>('[data-term]').forEach(async (el) => {
      if (!el.dataset.term) return;
      const hit = await findCatalog(el.dataset.term);
      const box = el.querySelector('.lib-cover, .lib-rcover');
      if (hit && box) box.insertAdjacentHTML('afterbegin', `<img src="${artUrl(hit, 300)}" alt="" loading="lazy"/>`);
    });
    // 재생 버튼
    body.querySelectorAll<HTMLButtonElement>('[data-play]').forEach((btn) =>
      btn.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const id = btn.dataset.play!;
        if (id === 'likes') { if (likes.length) playQueue(likes, 0, 'likes:likes'); return; }
        const pl = lists.find((p: { id: string }) => p.id === id);
        if (pl?.tracks?.length) playQueue(pl.tracks, 0, `playlist:${id}`);
        else toast('재생할 곡이 없습니다');
      }));
    // 컨텍스트 메뉴
    body.querySelectorAll<HTMLElement>('[data-kind]').forEach((el) =>
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const kind = el.dataset.kind, id = el.dataset.id!;
        const menu: { label: string; icon?: string; danger?: boolean; run: () => void }[] = [
          { label: '열기', icon: 'i-ext', run: () => { location.hash = el.getAttribute('href')!; } },
        ];
        if (kind === 'playlist') {
          menu.push({ label: '이름 바꾸기', icon: 'i-mic', run: async () => {
            const pl = lists.find((p: { id: string; name: string }) => p.id === id);
            const name = prompt('플레이리스트 이름', pl?.name || '');
            if (!name) return;
            await api(`/api/playlists/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
            document.dispatchEvent(new CustomEvent('lilac:playlists'));
            pageLibrary(sub);
          } });
          menu.push({ label: '삭제', icon: 'i-close', danger: true, run: async () => {
            if (!confirm('플레이리스트를 삭제할까요?')) return;
            await api(`/api/playlists/${id}`, { method: 'DELETE' });
            document.dispatchEvent(new CustomEvent('lilac:playlists'));
            pageLibrary(sub);
          } });
        }
        if (kind === 'artist') {
          menu.push({ label: '팔로우 해제', icon: 'i-close', danger: true, run: async () => {
            await api('/api/oshi', { method: 'POST', body: JSON.stringify({ artistId: id, name: el.querySelector('b,.c-title')?.textContent }) });
            pageLibrary(sub);
          } });
        }
        openContextMenu(e.clientX, e.clientY, menu);
      }));
    bindTilt(body);
  };

  // 좋아요/최근재생 전용 트랙 뷰
  if (filter === 'likes') {
    const rows = likes.map((l: PlayableTrack & { likedAt?: string }) => ({ ...l, addedAt: l.likedAt }));
    body.innerHTML = `
      <div class="liked-hero">
        <div class="liked-tile" data-tilt="10">${icon('i-heart-f', 'ic lt')}</div>
        <div>
          <p class="sp-label">플레이리스트</p>
          <h2 class="liked-title">${t('lib.likes')}</h2>
          <p class="sp-meta">${esc(me?.name || 'Lilac 유저')}<span class="sep">·</span>${rows.length}곡</p>
          <div class="sp-actions inline"><button class="play-big" id="likePlay" ${rows.length ? '' : 'disabled'}>${icon('i-play')}</button></div>
        </div>
      </div>
      <div id="likeTable"></div>`;
    $('#likeTable').innerHTML = rows.length ? trackTable(rows) : `<div class="empty-box">${icon('i-heart', 'ic eb')}<p>저장한 곡이 없습니다</p><span>플레이어의 하트를 눌러 곡을 저장해 보세요</span></div>`;
    bindTable($('#likeTable'), rows);
    $('#likePlay')?.addEventListener('click', () => rows.length && playQueue(rows, 0, 'likes:likes'));
    bindTilt(body);
  } else if (filter === 'history') {
    const rows = hist.slice(0, 50).map((h: PlayableTrack & { playedAt?: string }) => ({ ...h, addedAt: h.playedAt }));
    body.innerHTML = rows.length ? trackTable(rows) : `<div class="empty-box">${icon('i-clock', 'ic eb')}<p>재생 기록이 없습니다</p><span>곡을 재생하면 여기에 쌓입니다</span></div>`;
    bindTable(body, rows);
  } else {
    renderItems();
  }

  $('#libNew').addEventListener('click', async () => {
    const name = prompt(t('lib.newPlaylist'), 'My Mix');
    if (!name) return;
    const pl = await api('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) });
    document.dispatchEvent(new CustomEvent('lilac:playlists'));
    location.hash = `#/playlist/${pl.id}`;
  });
  $('#libFind')?.addEventListener('input', (e) => {
    if (filter === 'likes' || filter === 'history') return;
    renderItems((e.target as HTMLInputElement).value);
  });
  $('#libSort')?.addEventListener('change', (e) => {
    libSort = (e.target as HTMLSelectElement).value as never;
    localStorage.setItem('lilac.libSort', libSort);
    if (filter !== 'likes' && filter !== 'history') renderItems(($('#libFind') as HTMLInputElement)?.value || '');
  });
  const setView = (v: 'grid' | 'list') => {
    libView = v; localStorage.setItem('lilac.libView', v);
    $('#libGrid').classList.toggle('on', v === 'grid');
    $('#libList').classList.toggle('on', v === 'list');
    if (filter !== 'likes' && filter !== 'history') renderItems(($('#libFind') as HTMLInputElement)?.value || '');
  };
  $('#libGrid')?.addEventListener('click', () => setView('grid'));
  $('#libList')?.addEventListener('click', () => setView('list'));
}

/* ================= 플레이리스트 상세 (스포티파이 심화) ================= */
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
          <p class="sp-label">공개 플레이리스트</p>
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
    const view = q ? rows.filter((r) => (r.title + r.artist).toLowerCase().includes(q.toLowerCase())) : rows;
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
    const name = prompt('플레이리스트 이름', pl.name);
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
        if (!confirm(`‘${pl.name}’ 플레이리스트를 삭제할까요?`)) return;
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
interface AlbumRes { id: number; title: string; artist: string; artwork: string; year: string; trackCount: number; appleUrl: string }
export async function pageSearch(q: string, tab = 'all') {
  root().innerHTML = `
    <section class="sec page-top">
      <div class="page-head">
        <p class="sp-label">검색 결과</p>
        <h1 class="page-title">${esc(q)}</h1>
        <div class="chips" id="srTabs">
          ${[['all', '전체'], ['songs', '곡'], ['artists', '아티스트'], ['albums', '앨범']].map(([k, l]) =>
            `<button class="chip ${k === tab ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}
        </div>
      </div>
      <div id="srBody">${skRows(6)}</div>
    </section>`;
  $('#srTabs').querySelectorAll<HTMLButtonElement>('.chip').forEach((b) =>
    b.addEventListener('click', () => pageSearch(q, b.dataset.t!)));

  const [songRes, albumRes] = await Promise.all([
    api(`/api/catalog/search?term=${encodeURIComponent(q)}&limit=20`).catch(() => ({ tracks: [] })),
    api(`/api/catalog/search?term=${encodeURIComponent(q)}&entity=album&limit=12`).catch(() => ({ albums: [] })),
  ]);
  const tracks = (songRes.tracks || []) as CatalogTrack[];
  const albums = (albumRes.albums || []) as AlbumRes[];
  // 아티스트는 곡/앨범 결과에서 집계 (이름 빈도순)
  const artistMap = new Map<string, number>();
  [...tracks.map((t) => t.artist), ...albums.map((a) => a.artist)].forEach((n) => artistMap.set(n, (artistMap.get(n) || 0) + 1));
  const artistList = [...artistMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name);

  if (!tracks.length && !albums.length) {
    $('#srBody').innerHTML = `<div class="empty-box">${icon('i-search', 'ic eb')}<p>‘${esc(q)}’ 결과가 없습니다</p><span>다른 검색어를 시도해 보세요</span></div>`;
    return;
  }

  const rows = tracks.map((c) => toPlayable(c));
  const localArtist = artists.find((a) => a.name.toLowerCase().includes(q.toLowerCase()) || a.searchTerm.toLowerCase().includes(q.toLowerCase()) || a.nameJa.includes(q));
  const top = tracks[0];

  const albumGrid = (list: AlbumRes[]) => `<div class="shelf">${list.map((a) => `
    <a class="card" href="${a.appleUrl}" target="_blank" rel="noopener" data-tilt="8">
      <div class="cover"><img src="${esc(a.artwork)}" alt="" loading="lazy"/><span class="glare"></span></div>
      <div class="c-title">${esc(a.title)}</div><div class="c-sub">${esc(a.year || '')} · ${esc(a.artist)}</div>
    </a>`).join('')}</div>`;
  const artistShelf = (names: string[]) => `<div class="shelf">${names.map((n) => {
    const local = artists.find((a) => a.name === n || a.nameJa === n || a.searchTerm === n);
    return `<a class="card round" href="${local ? `#/artist/${local.id}` : `#/search?q=${encodeURIComponent(n)}`}" data-term="${esc(n)}" data-tilt="8">
      <div class="cover"><div class="ph">${esc(n[0] || '?')}</div><span class="glare"></span></div>
      <div class="c-title">${esc(n)}</div><div class="c-sub">${t('artists')}</div></a>`;
  }).join('')}</div>`;

  let html = '';
  if (tab === 'all') {
    html = `
      <div class="sr-top">
        ${top ? `<div class="sr-topcard" id="srTop" data-tilt="6">
          <p class="sr-toplabel">상위 결과</p>
          <img src="${esc(artUrl(top, 300))}" alt=""/>
          <h3>${esc(top.title)}</h3>
          <p>${esc(top.artist)}<span class="sr-kind">곡</span></p>
          <button class="play-big" id="srTopPlay">${icon('i-play')}</button>
        </div>` : ''}
        <div class="sr-songs">
          <h3 class="sr-h">곡</h3>
          <div id="srSongs"></div>
        </div>
      </div>
      ${artistList.length ? `<div class="sec-head sr-sec"><h2>아티스트</h2></div>${artistShelf(artistList.slice(0, 6))}` : ''}
      ${albums.length ? `<div class="sec-head sr-sec"><h2>앨범</h2></div>${albumGrid(albums.slice(0, 8))}` : ''}`;
  } else if (tab === 'songs') html = '<div id="srSongs"></div>';
  else if (tab === 'artists') html = artistList.length ? artistShelf(artistList) : `<p class="loading">아티스트 결과가 없습니다</p>`;
  else html = albums.length ? albumGrid(albums) : `<p class="loading">앨범 결과가 없습니다</p>`;

  $('#srBody').innerHTML = html;

  const songBox = document.getElementById('srSongs');
  if (songBox) {
    const list = tab === 'all' ? rows.slice(0, 5) : rows;
    songBox.innerHTML = trackTable(list, { album: tab !== 'all', date: false });
    bindTable(songBox, list);
  }
  $('#srTopPlay')?.addEventListener('click', (e) => { e.stopPropagation(); if (top) playQueue([toPlayable(top)], 0); });
  $('#srTop')?.addEventListener('click', () => { if (top) playQueue([toPlayable(top)], 0); });
  if (localArtist) {
    $('#srTop')?.insertAdjacentHTML('beforeend', `<a class="sr-golink" href="#/artist/${localArtist.id}">아티스트 페이지 ${icon('i-chev-r', 'ic s')}</a>`);
  }
  fillShelfArts($('#srBody'));
  bindTilt($('#srBody'));
}

export function page404() {
  root().innerHTML = `<section class="sec page-top"><div class="page-head"><h1 class="page-title">페이지를 찾을 수 없습니다</h1></div><a class="btn-pill" href="#/">${t('nav.home')}</a></section>`;
}
