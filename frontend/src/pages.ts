import { api, findCatalog, artUrl, esc, icon, me, refreshMe } from './api';
import { smartMatch } from './koja';
import { mountHero3D, mountChart3D, can3D } from './three';
import type { Artist, SeedTrack, Ev, Product, CatalogTrack, PlayableTrack } from './api';
import { playQueue, openYt, toast, enqueue, openPlaylistPicker, askName, askConfirm } from './player';
import { applyTone } from './colors';
import { bindHoverExpand, openContextMenu, bindTilt, bindDragReorder } from './interactions';
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
  return `<div class="shelf d3-stage">${cards.map((c) => `
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

/* ================= 홈 ================= */
export async function pageHome() {
  if (isPlay()) return pageHomePlay();
  const feat = seeds.find((s) => s.id === 't5') ?? seeds[0];
  root().innerHTML = `
    <section class="billboard" id="bb">
      <div class="bb-blur" id="bbBlur" data-parallax="0.34"></div>
      <div class="bb-stage" id="bbStage" aria-hidden="true"></div>
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
    <section class="sec"><div class="sec-head" data-d3="head"><h2>${t('artists')}</h2><a class="sec-link" href="#/artists">${t('more')} ${icon('i-chev-r', 'ic s')}</a></div><div id="hArtists"></div></section>
    <section class="sec"><div class="sec-head" data-d3="head"><h2>${t('chart.title')}</h2><a class="sec-link" href="#/chart">${t('chart.viewAll')} ${icon('i-chev-r', 'ic s')}</a></div><div id="hChart"></div></section>
    <section class="sec"><div class="sec-head" data-d3="head"><h2>무드로 듣기</h2></div><div class="mood-grid" id="hMoods"></div></section>
    <section class="sec"><div class="sec-head" data-d3="head"><h2>에디터 픽</h2><span class="sec-sub" id="hEdSub">Deezer 공식 에디토리얼 · 실시간</span></div><div id="hEditorial"></div></section>
    <section class="sec"><div class="sec-head" data-d3="head"><h2>${t('upcoming')}</h2><a class="sec-link" href="#/schedule">${t('more')} ${icon('i-chev-r', 'ic s')}</a></div><div id="hEvents" class="ev-shelf"></div></section>
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
        <section class="sec quick-sec"><div class="sec-head" data-d3="head"><h2>바로 가기</h2></div>
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

  /* 수집해 둔 차트를 쓴다.
     예전에는 /api/chart 가 요청마다 YouTube 조회수를 실시간으로 긁어와 2초 가까이 걸렸다. */
  $('#hChart').innerHTML = skRows(5);
  const chart = await loadChart(chCountry, 'combined').catch(() => null);
  if (chart?.list?.length) {
    const top = chart.list.slice(0, 5);
    $('#hChart').innerHTML = rankList(top);
    bindRank($('#hChart'), top);

    /* 히어로 3D — 차트 상위 앨범을 원통형으로 세워 돌린다.
       three.js 는 여기서 처음 필요해지므로 이 시점에 동적으로 불러온다. */
    const stage = document.getElementById('bbStage');
    if (stage && can3D()) {
      /* 벽 소스는 상품(아티스트 로스터 기반)을 쓴다.
         차트 원본 풀에는 한국 Apple 차트의 서구 아티스트가 섞여 있어
         '한일 팬덤 포털'의 첫 화면에 Justin Bieber가 걸리는 문제가 있었다.
         상품은 로스터에서 파생되므로 한일 아티스트만 남는다. */
      /* 아티스트별로 라운드로빈해 같은 팀이 연달아 걸리지 않게 한다 */
      const byArtist = new Map<string, typeof products>();
      for (const p of products) {
        if (!p.artwork) continue;
        if (!byArtist.has(p.brand)) byArtist.set(p.brand, []);
        byArtist.get(p.brand)!.push(p);
      }
      const buckets = [...byArtist.values()];
      const pool: typeof products = [];
      for (let round = 0; pool.length < 45 && round < 12; round++) {
        for (const b of buckets) {
          if (b[round]) pool.push(b[round]);
          if (pool.length >= 45) break;
        }
      }
      const items = pool.map((p) => ({
        title: p.name.replace(/ - (Single|EP)$/i, ''),
        artist: p.brand,
        artwork: p.artwork,
        href: `#/store/${p.id}`,
      }));
      document.body.classList.add('has-3d-hero');
      stage.insertAdjacentHTML('afterend', '<span class="stage-hint">드래그해서 넘겨보세요 · 재킷을 누르면 이동합니다</span>');
      // 재킷에 마우스를 얹으면 히어로 제목이 그 곡으로 바뀐다
      const hTitle = document.querySelector('.bb-title');
      const hMeta = document.querySelector('.bb-meta');
      const hTag = document.querySelector('.bb-tag');
      const orig = { t: hTitle?.textContent || '', m: hMeta?.textContent || '', g: hTag?.textContent || '' };
      stage.addEventListener('wall:hover', (ev) => {
        const d = (ev as CustomEvent).detail as { title: string; artist: string } | null;
        if (!hTitle || !hMeta) return;
        hTitle.textContent = d ? d.title : orig.t;
        hMeta.textContent = d ? d.artist : orig.m;
        if (hTag) hTag.textContent = d ? '차트 상위' : orig.g;
      });
      mountHero3D(stage, items).catch(() => document.body.classList.remove('has-3d-hero'));
    }
  }

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
    <a class="mood d3-tilt" href="#/search?q=${encodeURIComponent(m.q)}" style="--m:linear-gradient(135deg,${m.c})" data-d3-tilt="10" data-d3="rise">
      <span class="mood-k">${m.k}</span><span class="mood-sq" data-term="${esc(m.q)}"></span></a>`).join('');
  moods.forEach(async (m, i) => {
    const hit = await findCatalog(m.q === 'anime' ? seeds[0].searchTerm : m.q);
    const sq = document.querySelectorAll<HTMLElement>('#hMoods .mood-sq')[i];
    if (hit && sq) sq.style.backgroundImage = `url(${artUrl(hit, 200)})`;
  });

  /* 에디터 픽 — Deezer 공식 에디토리얼 (실시간 무료 API, 키 불필요)
     클릭하면 iTunes 카탈로그에서 원곡을 찾아 바로 재생한다 */
  api(`/api/editorial?country=${chCountry}`).then((ed: { label: string; editor: string; list: { title: string; artist: string; artwork: string | null }[] }) => {
    const host = document.getElementById('hEditorial');
    if (!host || !ed?.list?.length) return;
    const sub = document.getElementById('hEdSub');
    if (sub) sub.textContent = `${ed.label} · ${ed.editor} · 실시간`;
    host.innerHTML = shelf(ed.list.slice(0, 12).map((t) => ({
      title: t.title, sub: t.artist, art: t.artwork || undefined,
      href: `#/search?q=${encodeURIComponent(`${t.artist} ${t.title}`)}`,
      term: `${t.artist} ${t.title}`,
    })));
    // 카드 클릭 = 즉시 재생 (검색 이동 대신)
    host.querySelectorAll<HTMLElement>('.card').forEach((el) => {
      el.addEventListener('click', async (ev2) => {
        ev2.preventDefault();
        const hit = await findCatalog(el.dataset.term || '');
        if (hit) playQueue([toPlayable(hit)], 0, 'editorial');
        else location.hash = el.getAttribute('href')?.slice(1) || '/';
      });
    });
    bindTilt(host); bindHoverExpand(host);
  }).catch(() => { document.getElementById('hEditorial')?.closest('section')?.remove(); });

  /* '다가오는 일정'이므로 오늘 이후만, 가까운 순으로 고른다.
     예전에는 events 앞 4개를 그대로 써서 1982년 발매가 '종료' 배지와 함께 떴다. */
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcomingEvents = events
    .filter((e) => e.date >= todayStr)
    .sort((x, y) => x.date.localeCompare(y.date))
    .slice(0, 4);
  $('#hEvents').innerHTML = upcomingEvents.map((ev) => {
    const { d, txt } = dday(ev.date);
    // 수집 단계에서 확보한 아트워크를 우선 쓴다 (아티스트명 재조회는 중복·오매칭을 부른다)
    const art = ev.artwork ? `background-image:url(${esc(sized(ev.artwork, 400))})` : '';
    return `<a class="ev-card d3-tilt" href="#/schedule" data-d3-tilt="6" data-d3="rise">
      <div class="ev-bg" ${ev.artwork ? `style="${art}"` : `data-artist="${esc(ev.artist)}"`}></div><div class="ev-scrim"></div>
      <span class="ev-type">${esc(ev.type)}</span><span class="ev-dday ${d >= 0 && d <= 14 ? 'urgent' : ''}">${txt}</span>
      <div class="ev-body"><div class="ev-title">${esc(ev.title)}</div><div class="ev-info">${ev.date} · ${esc(ev.venue)}</div></div></a>`;
  }).join('') || `<p class="dim" style="padding:8px 0">예정된 일정이 없습니다</p>`;
  fillEventArts($('#hEvents'));

  $('#hStore').innerHTML = products.slice(0, 4).map(productCard).join('');
  bindTilt($('#hStore'));
}


/* ---- 플레이 모드 홈 (스포티파이 홈) ---- */
async function pageHomePlay() {
  const hour = new Date().getHours();
  const greet = hour < 6 ? '깊은 밤이에요' : hour < 12 ? '좋은 아침이에요' : hour < 18 ? '좋은 오후예요' : '좋은 저녁이에요';
  root().innerHTML = `
    <section class="sec home-play">
      <h1 class="greet">${greet}</h1>
      <div class="quick-grid" id="hQuick"></div>
    </section>
    <section class="sec"><div class="sec-head" data-d3="head"><h2>최근 재생</h2><a class="sec-link" href="#/library/history">${t('more')} ${icon('i-chev-r', 'ic s')}</a></div><div id="hRecent">${skCards(6)}</div></section>
    <section class="sec"><div class="sec-head" data-d3="head"><h2>오늘의 추천</h2><a class="sec-link" href="#/chart">${t('chart.viewAll')} ${icon('i-chev-r', 'ic s')}</a></div><div id="hPicks">${skCards(6)}</div></section>
    <section class="sec"><div class="sec-head" data-d3="head"><h2>${t('artists')}</h2><a class="sec-link" href="#/artists">${t('more')} ${icon('i-chev-r', 'ic s')}</a></div><div id="hArtists">${skCards(7, true)}</div></section>
    <section class="sec"><div class="sec-head" data-d3="head"><h2>무드로 듣기</h2></div><div class="mood-grid" id="hMoods"></div></section>`;

  const [lists, likes, hist] = await Promise.all([
    api('/api/playlists').catch(() => []), api('/api/likes').catch(() => []), api('/api/history').catch(() => []),
  ]);
  const quick = [
    ...(likes.length ? [{ name: t('lib.likes'), href: '#/library/likes', liked: true, art: '' }] : []),
    ...lists.slice(0, 5).map((p: { id: string; name: string; tracks: PlayableTrack[] }) => ({ name: p.name, href: `#/playlist/${p.id}`, liked: false, art: p.tracks[0]?.artwork || '' })),
  ].slice(0, 6);
  const qb = document.getElementById('hQuick');
  if (qb) qb.innerHTML = quick.length ? quick.map((q) => `
    <a class="quick" href="${q.href}">
      <span class="quick-art ${q.liked ? 'liked' : ''}" style="background-image:url(${esc(q.art)})">${q.liked ? icon('i-heart-f', 'ic s') : ''}</span>
      <b>${esc(q.name)}</b><span class="quick-play">${icon('i-play')}</span></a>`).join('')
    : `<p class="loading">플레이리스트를 만들면 여기에 표시됩니다</p>`;

  const recent: PlayableTrack[] = (hist as PlayableTrack[]).filter((h, i, arr) => arr.findIndex((x) => x.title === h.title) === i).slice(0, 6);
  const rb = document.getElementById('hRecent');
  if (rb) {
    if (recent.length) {
      rb.innerHTML = `<div class="shelf d3-stage">${recent.map((h, i) => `
        <a class="card" href="javascript:void 0" data-r="${i}" data-tilt="8" data-expand>
          <div class="cover"><img src="${esc(h.artwork || '')}" alt="" loading="lazy"/><span class="glare"></span>
            <button class="hover-play">${icon('i-play')}</button></div>
          <div class="c-title">${esc(h.title)}</div><div class="c-sub">${esc(h.artist)}</div></a>`).join('')}</div>`;
      rb.querySelectorAll<HTMLElement>('[data-r]').forEach((el) =>
        el.addEventListener('click', () => playQueue(recent, Number(el.dataset.r))));
    } else {
      rb.innerHTML = `<div class="empty-box sm">${icon('i-clock', 'ic eb')}<p>재생 기록이 없습니다</p></div>`;
    }
  }

  const hits = await Promise.all(seeds.slice(0, 6).map((s) => findCatalog(s.searchTerm)));
  const picks = hits.map((h, i) => (h ? toPlayable(h, seeds[i].youtubeId) : null)).filter(Boolean) as PlayableTrack[];
  const pb = document.getElementById('hPicks');
  if (pb) {
    pb.innerHTML = `<div class="shelf d3-stage">${picks.map((h, i) => `
      <a class="card" href="javascript:void 0" data-p="${i}" data-tilt="8" data-expand>
        <div class="cover"><img src="${esc(h.artwork || '')}" alt="" loading="lazy"/><span class="glare"></span>
          <button class="hover-play">${icon('i-play')}</button></div>
        <div class="c-title">${esc(h.title)}</div><div class="c-sub">${esc(h.artist)}</div></a>`).join('')}</div>`;
    pb.querySelectorAll<HTMLElement>('[data-p]').forEach((el) =>
      el.addEventListener('click', () => playQueue(picks, Number(el.dataset.p))));
  }

  const ab = document.getElementById('hArtists');
  if (ab) {
    ab.innerHTML = shelf(artists.map((a) => ({ title: a.name, sub: t('artists'), round: true, href: `#/artist/${a.id}`, term: a.searchTerm })));
    fillShelfArts(ab);
  }

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
      <a class="mood d3-tilt" href="#/search?q=${encodeURIComponent(m.q)}" style="--m:linear-gradient(135deg,${m.c})" data-d3-tilt="10" data-d3="rise">
        <span class="mood-k">${m.k}</span><span class="mood-sq"></span></a>`).join('');
    moods.forEach(async (m, i) => {
      const hit = await findCatalog(m.q === 'anime' ? seeds[0].searchTerm : m.q);
      const sq = document.querySelectorAll<HTMLElement>('#hMoods .mood-sq')[i];
      if (hit && sq) sq.style.backgroundImage = `url(${artUrl(hit, 200)})`;
    });
  }
}

/* ================= 차트 =================
   양국 모두 '현지 대표 2종 + 글로벌 스트리밍 + 영상' 구조로 5개 소스를 모은다.
     일본 : Billboard JAPAN HOT 100 / 오리콘 주간 싱글
     한국 : 멜론 TOP 100 / 지니 차트
     공통 : Apple Music 차트, Apple 공식 RSS, YouTube 공식 MV 조회수
   combined 는 위 순위를 정규화해 가중 합산한 Lilac 자체 집계다(공식 차트 아님). */
interface ChartRow {
  rank: number; title: string; artist: string; artwork?: string; appleUrl?: string;
  youtubeId?: string | null; ytViews?: number | null;
  appleRank?: number | null; youtubeRank?: number | null; sources?: string[]; score?: number;
  ranks?: Record<string, number>; move?: string; lastRank?: number | null;
}
/* 소스 구성은 서버가 국가별로 내려준다.
   화면에 쓰는 짧은 라벨만 여기서 관리한다. */
const SOURCE_LABEL: Record<string, string> = {
  combined: '통합',
  billboard: 'Billboard JAPAN',
  oricon: '오리콘',
  melon: '멜론',
  genie: '지니',
  apple: 'Apple Music',
  appleRss: 'Apple RSS',
  youtube: 'YouTube',
};
/** 국가별 사용 가능한 소스 — 차트를 불러오면 서버 응답으로 갱신된다 */
const chSources: Record<string, string[]> = {
  jp: ['combined', 'billboard', 'oricon', 'apple', 'appleRss', 'youtube'],
  kr: ['combined', 'melon', 'genie', 'apple', 'appleRss', 'youtube'],
};
const sourcesOf = (c: string) =>
  (chSources[c] || chSources.kr).map((k) => ({ k, label: SOURCE_LABEL[k] || k }));
const labelOf = (_c: string, k: string) => SOURCE_LABEL[k] || '통합';
const COUNTRY = [{ k: 'jp', label: '일본' }, { k: 'kr', label: '한국' }];
let chCountry = localStorage.getItem('lilac.chartCountry') || 'jp';

/* 통합 순위에서 각 곡이 어느 소스에 올랐는지 보여주는 배지 */
const RANK_BADGES: [string, string, string][] = [
  ['billboard', 'B', 'Billboard JAPAN'],
  ['oricon', 'O', '오리콘'],
  ['melon', 'M', '멜론'],
  ['genie', 'G', '지니'],
  ['apple', 'A', 'Apple Music'],
  ['appleRss', 'R', 'Apple 공식 RSS'],
  ['youtube', 'Y', 'YouTube 조회수'],
];
const viewsTxt = (n?: number | null) =>
  !n ? '' : n >= 1e8 ? `${(n / 1e8).toFixed(2)}억` : n >= 1e4 ? `${Math.round(n / 1e4).toLocaleString()}만` : n.toLocaleString();

function chartRowsHtml(list: ChartRow[], source: string) {
  return `<div class="rank-list big d3-stack">${list.map((e) => {
    const badges = source === 'combined'
      ? `<span class="rk-ranks">${RANK_BADGES.filter(([k]) => e.ranks?.[k])
          .map(([k, s, tt]) => `<span class="mini-rank ${k}" title="${tt} 순위">${s} ${e.ranks![k]}</span>`).join('')}</span>`
      : '';
    const move = e.move
      ? `<span class="rk-move ${e.move}">${e.move === 'new' ? 'NEW' : e.move === 'up' ? '▲' : '▼'}${e.lastRank && e.move !== 'new' ? ` ${Math.abs(e.lastRank - e.rank)}` : ''}</span>`
      : '';
    return `
    <div class="rk-row" data-i="${e.rank - 1}">
      <span class="rk-n">${e.rank}</span>
      <div class="rk-art">${e.artwork ? `<img src="${esc(sized(e.artwork, 120))}" loading="lazy" decoding="async" alt=""/>` : `<span class="rk-ph">${icon('i-chart')}</span>`}<span class="rk-ov">${icon('i-play')}</span></div>
      <div class="rk-meta">
        <div class="rk-t">${esc(e.title)}</div>
        <div class="rk-a">${esc(e.artist)}</div>
      </div>
      <div class="rk-side">
        ${badges}${move}
        ${e.ytViews ? `<span class="rk-views">${viewsTxt(e.ytViews)}회</span>` : ''}
        ${e.youtubeId ? `<button class="rk-mv" data-yt="${e.youtubeId}" title="뮤직비디오">${icon('i-ext')}</button>` : ''}
      </div>
    </div>`;
  }).join('')}</div>`;
}

const loadChart = async (country: string, source: string) => {
  const d = await api(`/api/charts?country=${country}&source=${source}`).catch(() => null);
  // 소스 구성은 수집 결과에 따라 달라지므로 서버 응답을 신뢰한다
  if (d?.sources?.length) {
    // 현지 대표 차트를 앞에, 글로벌 소스를 뒤에 둔다 (사용자가 먼저 찾는 순서)
    const PRIORITY = ['billboard', 'oricon', 'melon', 'genie', 'apple', 'appleRss', 'youtube'];
    const ordered = [...d.sources].sort((x: string, y: string) => PRIORITY.indexOf(x) - PRIORITY.indexOf(y));
    chSources[country] = ['combined', ...ordered];
  }
  return d;
};

async function chartPlayables(list: ChartRow[], from = 0, count = 20): Promise<PlayableTrack[]> {
  const out: PlayableTrack[] = [];
  for (const e of list.slice(from, from + count)) {
    const hit = await findCatalog(`${e.artist} ${e.title}`);
    out.push(hit ? toPlayable(hit, e.youtubeId) : { title: e.title, artist: e.artist, artwork: e.artwork, youtubeId: e.youtubeId });
  }
  return out;
}

function bindChartRows(container: HTMLElement, list: ChartRow[]) {
  container.querySelectorAll<HTMLButtonElement>('.rk-mv').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); openYt(b.dataset.yt!); }));
  container.querySelectorAll<HTMLElement>('.rk-row').forEach((row) =>
    row.addEventListener('click', async (e) => {
      if ((e.target as HTMLElement).closest('.rk-mv')) return;
      const i = Number(row.dataset.i);
      toast('재생 목록을 준비하는 중…');
      const tracks = await chartPlayables(list, Math.max(0, i - 2), 20);
      playQueue(tracks, Math.min(i, 2), `chart:${chCountry}`);
      container.querySelectorAll('.rk-row').forEach((r) => r.classList.remove('playing'));
      row.classList.add('playing');
    }));
}

function bindCountryToggle(rerender: () => void) {
  document.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) =>
    b.addEventListener('click', () => {
      chCountry = b.dataset.c!;
      localStorage.setItem('lilac.chartCountry', chCountry);
      // 국가에 없는 소스면 통합으로 되돌린다
      const seg = location.hash.split('/')[2] || 'combined';
      if (!sourcesOf(chCountry).some((s) => s.k === seg)) { location.hash = '#/chart/combined'; return; }
      rerender();
    }));
}

export async function pageChart(sub?: string) {
  if (isPlay()) return pageChartPlay(sub);
  const source = sub || 'combined';
  root().innerHTML = `
    <section class="chart-hero" id="chHero">
      <div class="ch-stage" id="chStage" aria-hidden="true"></div>
      <div class="ch-inner">
        <p class="sp-label">차트</p>
        <h1 class="ch-title">실시간 차트</h1>
        <p class="ch-desc" id="chDesc">불러오는 중…</p>
        <div class="ch-now" id="chNow" hidden>
          <span class="ch-now-rank"></span>
          <span class="ch-now-text"></span>
        </div>
        <div class="ch-controls">
          <div class="seg wrap">${sourcesOf(chCountry).map((s) => `<a class="seg-btn ${s.k === source ? 'on' : ''}" href="#/chart/${s.k}">${s.label}</a>`).join('')}</div>
          <div class="seg country">${COUNTRY.map((c) => `<button class="seg-btn ${c.k === chCountry ? 'on' : ''}" data-c="${c.k}">${c.label}</button>`).join('')}</div>
        </div>
      </div>
    </section>
    <section class="sec chart-body">
      <div class="ch-bar">
        <button class="play-big" id="chPlayAll">${icon('i-play')}</button>
        <button class="tbtn big-ghost" id="chShuffle">${icon('i-shuffle')}</button>
        <span class="ch-updated" id="chUpdated"></span>
      </div>
      <div id="chartBody">${skRows(10)}</div>
      <p class="ch-method" id="chMethod"></p>
    </section>`;
  bindCountryToggle(() => pageChart(source));

  const data = await loadChart(chCountry, source);
  const body = document.getElementById('chartBody');
  if (!data || !body) {
    if (body) body.innerHTML = `<div class="empty-box">${icon('i-chart', 'ic eb')}<p>차트를 불러오지 못했습니다</p><span>node backend/collect-charts.mjs 로 수집해 주세요</span></div>`;
    return;
  }
  const list = data.list as ChartRow[];
  $('#chDesc').textContent = `${data.countryLabel} · ${labelOf(chCountry, source)} · ${list.length}곡`;

  /* 차트 3D — 상위 곡을 앞뒤로 늘어세워 순위를 깊이로 표현한다.
     휠·드래그로 열을 따라 이동하고, 카드를 누르면 재생한다. */
  const stage = document.getElementById('chStage');
  if (stage && can3D()) {
    document.body.classList.add('has-3d-chart');
    const items = list.filter((e) => e.artwork).slice(0, 1).map((e) => ({
      rank: e.rank, title: e.title, artist: e.artist, artwork: e.artwork,
      onPick: async () => {
        // 3D 카드에서 바로 재생 — 카탈로그에서 원곡을 찾아 큐에 올린다
        const hit = await findCatalog(`${e.artist} ${e.title}`);
        playQueue([hit ? toPlayable(hit, e.youtubeId) : { title: e.title, artist: e.artist, artwork: e.artwork || undefined }], 0);
      },
    }));
    // 전시 중인 작품(1위) 정보를 배지에 고정 표시
    const first = list[0];
    const nowEl = document.getElementById('chNow');
    if (nowEl && first) {
      nowEl.hidden = false;
      nowEl.querySelector('.ch-now-rank')!.textContent = String(first.rank ?? 1);
      nowEl.querySelector('.ch-now-text')!.textContent = `${first.title} · ${first.artist}`;
    }
    stage.insertAdjacentHTML('afterend', '<span class="stage-hint">이번 주 1위 · 누르면 재생됩니다</span>');
    mountChart3D(stage, items).catch(() => document.body.classList.remove('has-3d-chart'));
  }
  // 실시간 소스(공식 피드 직접 조회)와 일일 수집 소스를 구분해 보여준다
  $('#chUpdated').innerHTML = data.live
    ? `<span class="live-badge on rt">실시간</span>조회 시점 데이터 · Apple 공식 피드`
    : `<span class="live-badge on">수집</span>${new Date(data.updated).toLocaleString()} 기준`;
  $('#chMethod').innerHTML = data.method + (data.weights ? `<br/>가중치: ${Object.entries(data.weights).map(([k, v]) => `${labelOf(chCountry, k)} ${Math.round(Number(v) * 100)}%`).join(' · ')}` : '');
  body.innerHTML = chartRowsHtml(list, source);
  bindChartRows(body, list);
  if (list[0]?.artwork) void applyTone(document.querySelector('.chart-hero'), list[0].artwork);

  const playFrom = async (shuffle: boolean) => {
    toast('재생 목록을 준비하는 중…');
    const tr = await chartPlayables(list, 0, 20);
    if (tr.length) playQueue(shuffle ? tr.sort(() => Math.random() - 0.5) : tr, 0, `chart:${chCountry}`);
  };
  $('#chPlayAll').addEventListener('click', () => playFrom(false));
  $('#chShuffle').addEventListener('click', () => playFrom(true));
}

/* ---- 플레이 모드 차트 (스포티파이 플리 구조) ---- */
async function pageChartPlay(sub?: string) {
  const source = sub || 'combined';
  root().innerHTML = `
    <section class="sp-page">
      <div id="chHead"></div>
      <div class="sp-actions">
        <button class="play-big" id="chPlayAll">${icon('i-play')}</button>
        <button class="tbtn big-ghost" id="chShuffle" title="셔플">${icon('i-shuffle')}</button>
        <div class="seg small wrap">${sourcesOf(chCountry).map((s) => `<a class="seg-btn ${s.k === source ? 'on' : ''}" href="#/chart/${s.k}">${s.label}</a>`).join('')}</div>
        <div class="seg small country">${COUNTRY.map((c) => `<button class="seg-btn ${c.k === chCountry ? 'on' : ''}" data-c="${c.k}">${c.label}</button>`).join('')}</div>
      </div>
      <div class="sp-body"><div id="chBody">${skRows(10)}</div><p class="ch-method" id="chMethod"></p></div>
    </section>`;
  bindCountryToggle(() => pageChartPlay(source));

  const data = await loadChart(chCountry, source);
  const head = document.getElementById('chHead');
  const body = document.getElementById('chBody');
  if (!data || !head || !body) {
    if (body) body.innerHTML = `<div class="empty-box">${icon('i-chart', 'ic eb')}<p>차트를 불러오지 못했습니다</p></div>`;
    return;
  }
  const list = data.list as ChartRow[];
  const covers = list.slice(0, 8).map((e) => e.artwork).filter(Boolean) as string[];
  head.innerHTML = spHeader({
    label: `${data.countryLabel} 차트`,
    title: `${labelOf(chCountry, source)} 차트`,
    meta: `<span class="live-badge on">수집</span>${list.length}곡<span class="sep">·</span>${new Date(data.updated).toLocaleDateString()} 기준`,
    mosaic: covers.length >= 4 ? covers.slice(0, 4) : undefined,
    cover: covers[0],
  });
  if (covers[0]) void applyTone(document.querySelector('.sp-head'), covers[0]);
  bindTilt(root());

  body.innerHTML = chartRowsHtml(list, source);
  bindChartRows(body, list);
  $('#chMethod').innerHTML = data.method + (data.weights ? `<br/>가중치: ${Object.entries(data.weights).map(([k, v]) => `${labelOf(chCountry, k)} ${Math.round(Number(v) * 100)}%`).join(' · ')}` : '');

  const playFrom = async (shuffle: boolean) => {
    toast('재생 목록을 준비하는 중…');
    const tr = await chartPlayables(list, 0, 20);
    if (tr.length) playQueue(shuffle ? tr.sort(() => Math.random() - 0.5) : tr, 0, `chart:${chCountry}`);
  };
  $('#chPlayAll').addEventListener('click', () => playFrom(false));
  $('#chShuffle').addEventListener('click', () => playFrom(true));
}

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
const SIZE_FILTERS = [
  { k: 'all', label: '전체' }, { k: 'limited', label: '한정반' },
  { k: 'album', label: '정규 앨범' }, { k: 'mini', label: '미니 앨범' }, { k: 'single', label: '싱글' },
];
let stFilterSize = 'all';
let stFilterArtist = 'all';
let stFilterOrigin = 'all';     // 전체 / jp(일본반) / kr(한국반)
let stSort: 'new' | 'low' | 'high' | 'name' = 'new';
let stPage = 1;
const PAGE_SIZE = 24;

function storeFiltered() {
  let list = products.slice();
  if (stFilterOrigin !== 'all') list = list.filter((p) => (p.origin || 'jp') === stFilterOrigin);
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
  return `<a class="p-card d3-tilt" href="#/store/${p.id}" data-d3-tilt="7" data-d3="rise">
    <div class="p-img">
      <img src="${esc(sized(p.artwork, 300))}" alt="" loading="lazy" decoding="async"/>
      <span class="p-badge ${hasLtd ? 'ltd' : ''}">${esc(p.badge)}</span>
      ${p.stock <= 10 ? `<span class="p-stock">잔여 ${p.stock}</span>` : ''}
    </div>
    <div class="p-brand"><span class="p-flag ${p.origin === 'kr' ? 'kr' : 'jp'}">${p.origin === 'kr' ? '한국반' : '일본반'}</span>${esc(p.brand)}</div>
    <div class="p-name">${esc(p.name)}</div>
    <div class="p-price">${money(p.price, p.priceCurrency)}</div>
    <div class="p-sub">${esc(p.releaseDate?.slice(0, 4) || '')} · ${p.trackCount}곡</div>
  </a>`;
}

const ORIGIN_FILTERS = [
  { k: 'all', label: '전체' },
  { k: 'jp', label: '일본반 → 한국' },
  { k: 'kr', label: '한국반 → 일본' },
];

function storeToolbar(dark: boolean) {
  // 선택된 원산지에 해당하는 아티스트만 칩으로 노출한다.
  // 44팀을 한 줄에 늘어놓으면 고를 수 없으므로 국가별로 묶는다.
  const scope = stFilterOrigin === 'all' ? products : products.filter((p) => (p.origin || 'jp') === stFilterOrigin);
  const byOrigin = new Map<string, Set<string>>();
  for (const p of scope) {
    const o = p.origin || 'jp';
    if (!byOrigin.has(o)) byOrigin.set(o, new Set());
    byOrigin.get(o)!.add(p.brand);
  }
  const group = (o: string, label: string) => {
    const names = [...(byOrigin.get(o) || [])].sort();
    if (!names.length) return '';
    return `<div class="chip-group"><span class="chip-group-label">${label}</span>${names
      .map((b) => `<button class="chip ${stFilterArtist === b ? 'on' : ''}" data-artist="${esc(b)}">${esc(b)}</button>`).join('')}</div>`;
  };
  return `
    <div class="st-filters">
      <div class="chips origin-chips">${ORIGIN_FILTERS.map((f) => `<button class="chip strong ${f.k === stFilterOrigin ? 'on' : ''}" data-origin="${f.k}">${f.label}</button>`).join('')}</div>
      <div class="chips">${SIZE_FILTERS.map((f) => `<button class="chip ${f.k === stFilterSize ? 'on' : ''}" data-size="${f.k}">${f.label}</button>`).join('')}</div>
      <div class="chips artist-chips">
        <button class="chip ${stFilterArtist === 'all' ? 'on' : ''}" data-artist="all">모든 아티스트</button>
        ${group('jp', 'J-POP')}${group('kr', 'K-POP')}
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
  document.querySelectorAll<HTMLButtonElement>('[data-origin]').forEach((b) =>
    b.addEventListener('click', () => {
      stFilterOrigin = b.dataset.origin!;
      stFilterArtist = 'all';        // 원산지가 바뀌면 아티스트 선택은 무효가 된다
      stPage = 1;
      // 아티스트 칩 목록이 원산지에 종속되므로 툴바를 통째로 다시 그린다
      const host = b.closest('.st-filters')?.parentElement;
      const dark = !!document.querySelector('.sp-wrap');
      if (host) {
        const bar = host.querySelector('.st-bar');
        const html = storeToolbar(dark);
        host.querySelector('.st-filters')?.remove();
        bar?.remove();
        const grid = host.querySelector('.store-grid, .sp-grid');
        grid?.insertAdjacentHTML('beforebegin', html);
        bindStoreToolbar(render);
      }
      render();
    }));
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
          <h2>양국 한정반,<br/>정식 루트로 받아보세요</h2>
          <p class="sh-sub">현지에서만 유통되는 반을 매입해 합배송으로 전달합니다.
            <b>일본반은 한국으로</b>, <b>한국반은 일본으로</b> 보냅니다.
            판매가는 <b>현지 정가 × 실시간 환율 + 대행 수수료 + 배송 분담</b>으로 자동 산출됩니다.</p>
          ${fx ? `<p class="fx-line">적용 환율 <b>1엔 = ${fx.jpyKrw ?? fx.rate}원</b> · <b>1원 = ${fx.krwJpy ?? '—'}엔</b> <span class="src-badge ${fx.live ? 'real' : 'demo'}">${fx.date} ${fx.live ? '실시간' : '폴백'}</span></p>` : ''}
        </div>
        <div class="sh-stats">
          <div><b>${products.filter((p) => (p.origin || 'jp') === 'jp').length}</b><span>일본반</span></div>
          <div><b>${products.filter((p) => p.origin === 'kr').length}</b><span>한국반</span></div>
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
      meta: `${products.length}개 상품<span class="sep">·</span>${fx ? `1엔 = ${fx.jpyKrw ?? fx.rate}원 <span class="src-badge real">실시간</span>` : ''}`,
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
        <div class="c-sub">${esc(p.brand)} · ${money(p.price, p.priceCurrency)}</div>
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
        <div class="pd-img"><img src="${esc(sized(p.artwork, 560))}" alt="" decoding="async"/><span class="p-badge ${p.editions.some((e) => e.id === 'limited') ? 'ltd' : ''}">${esc(p.badge)}</span></div>
        <div class="pd-info">
          <p class="p-brand">${esc(p.brand)} · ${esc(p.sizeLabel)}</p>
          <h2 class="pd-name">${esc(p.name)}</h2>
          <p class="pd-meta-line">${esc(p.releaseDate)} 발매 · ${p.trackCount}곡 · 재고 ${p.stock}개</p>
          <p class="pd-price" id="pdPrice">${money(p.editions[0].pricing.total, p.priceCurrency)}</p>
          <div class="pd-ed" id="pdEd">
            ${p.editions.map((e, i) => `
              <button class="ed ${i === 0 ? 'on' : ''}" data-e="${i}">
                <span class="ed-label">${esc(e.label)}${e.real ? ' <span class="src-badge real">Apple 실정가</span>' : ''}</span>
                <span class="ed-price">${money(e.pricing.total, e.pricing.buyerCurrency ?? p.priceCurrency)}</span>
                <span class="ed-jpy">현지 정가 ${e.localCurrency === 'KRW' || p.origin === 'kr' ? '₩' : '¥'}${(e.amount ?? e.jpy ?? 0).toLocaleString()}</span>
              </button>`).join('')}
          </div>
          <div class="pd-row"><span>${t('store.qty')}</span><input id="pdQty" type="number" min="1" max="${p.stock}" value="1" /></div>
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
  const realItems = merged.filter((e) => !e.isDemo);
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
    <section class="sec page-top">
      <div class="page-head" data-d3="head">
        <p class="sp-label">${t('nav.schedule')}</p>
        <h1 class="page-title">${t('schedule.title')}</h1>
        <p class="page-desc">다가오는 일정을 먼저 보여줍니다. 발매 일정은 <b>Apple Music 카탈로그 자동 수집 실데이터</b>(${realItems.length}건),
          공연·응모는 데모 데이터(${merged.length - realItems.length}건)입니다.</p>
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
      <p class="pd-note" style="margin-top:24px">발매 일정은 Apple Music 카탈로그에서 자동 수집한 실제 발매일입니다. 공연·응모 일정은 공식 티켓 데이터 계약 전이라 예시로 표시됩니다.</p>
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
                <span class="src-badge ${isDemo(e) ? 'demo' : 'real'}">${isDemo(e) ? '데모' : 'Apple 실데이터'}</span>
                <span class="sch-dday ${d >= 0 && d <= 14 ? 'urgent' : ''}">${txt}</span>
              </div>
              <div class="sch-title">${esc(e.artist)} · ${esc(e.title)}</div>
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
      <div class="ar-head">
        <div class="ar-portrait" id="arPortrait" aria-hidden="true"></div>
        <div class="ar-info">
          <p class="ar-verified">${icon('i-check', 'ic s')} 인증된 아티스트</p>
          <h1 class="ar-name">${esc(a.name)}</h1>
          <p class="ar-stats" id="arStats"><span class="stat-sk"></span>${artistSub(a) ? ` · ${esc(artistSub(a))}` : ''}</p>
        </div>
      </div>
    </section>
    <div class="ar-actionbar">
      <button class="play-big" id="arPlay">${icon('i-play')}</button>
      <button class="tbtn big-ghost ${following ? 'on' : ''}" id="arFollow">${following ? '팔로잉' : '팔로우'}</button>
      ${a.official ? `<a class="tbtn big-ghost" href="${esc(a.official)}" target="_blank" rel="noopener" title="공식 사이트">${icon('i-ext')}</a>` : ''}
      <span class="ar-op">${a.operator ? `${t('store.operator')} · ${esc(a.operator)}` : `${countryLabel(a.country)} · ${esc(a.genre)}`}</span>
    </div>
    <section class="sec"><div class="sec-head" data-d3="head"><h2>인기</h2></div><div id="arTracks">${skRows(5)}</div></section>
    <section class="sec" id="arDiscSec"><div class="sec-head" data-d3="head"><h2>디스코그래피</h2><span class="sec-sub">Apple Music 카탈로그</span></div><div id="arDisc">${skCards(6)}</div></section>
    <section class="sec" id="arEvSec" style="display:none"><div class="sec-head" data-d3="head"><h2>${t('schedule.title')}</h2><a class="sec-link" href="#/schedule">${t('more')} ${icon('i-chev-r', 'ic s')}</a></div><div class="ev-shelf" id="arEvents"></div></section>
    <section class="sec" id="arGoodsSec" style="display:none"><div class="sec-head" data-d3="head"><h2>${t('store.title')}</h2><a class="sec-link" href="#/store">${t('more')} ${icon('i-chev-r', 'ic s')}</a></div><div class="store-dark-grid" id="arGoods"></div></section>
    <section class="sec"><div class="sec-head" data-d3="head"><h2>비슷한 아티스트</h2></div><div id="arSimilar"></div></section>
    <section class="sec"><div class="sec-head" data-d3="head"><h2>정보</h2></div>
      <div class="ar-about">
        <div class="ar-about-img" id="arAboutImg"></div>
        <div class="ar-about-txt">
          <p class="ar-listeners" id="arListeners"><span class="stat-sk"></span></p>
          <p>${esc(a.name)}${artistSub(a) ? `(${esc(artistSub(a))})` : ''}는 ${countryLabel(a.country)}의 ${esc(a.genre)} 아티스트입니다.${a.operator ? ` 공식 운영사는 ${esc(a.operator)}이며,` : ''}
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
      if (st) st.innerHTML = `${esc(a.genre)}${artistSub(a) ? ` · ${esc(artistSub(a))}` : ''}`;
      if (ls) ls.innerHTML = `<span class="dim">공개 지표를 가져오지 못했습니다</span>`;
      return;
    }
    const txt = `YouTube 공식 MV 누적 <b>${fmtViews(s.totalViews)}회</b>`;
    if (st) st.innerHTML = `${txt.replace(/<\/?b>/g, '')}${artistSub(a) ? ` · ${esc(artistSub(a))}` : ''}`;
    if (ls) ls.innerHTML = `${txt} <span class="live-badge ${s.live ? 'on' : ''}">${s.live ? '실시간' : '캐시'}</span>
      <span class="dim" style="display:block;font-size:12px;margin-top:4px">${esc(s.source)} · 등록곡 ${s.trackCount}개 기준</span>`;
  }).catch(() => {
    const st = document.getElementById('arStats');
    if (st) st.textContent = `${a.genre}${artistSub(a) ? ` · ${artistSub(a)}` : ''}`;
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
    el.innerHTML = `<div class="shelf d3-stage">${use.map((al) => `
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

export async function pageLibrary(sub?: string) {
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
          <p class="sp-label">${t('nav.library')}</p>
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
    <section class="sec page-top">
      <div class="page-head" data-d3="head">
        <p class="sp-label">아티스트</p>
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
    <section class="sec page-top narrow">
      <div class="page-head" data-d3="head">
        <p class="sp-label">주문</p>
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
    <section class="sec page-top narrow">
      <a class="crumb" href="#/orders">${icon('i-chev-r', 'ic s flip')} 주문 내역</a>
      <div class="page-head" data-d3="head">
        <p class="sp-label">주문 상세</p>
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

function focusPostNative(message: Record<string, unknown>) {
  const bridge = (window as unknown as { webkit?: { messageHandlers?: { lilac?: { postMessage: (v: unknown) => void } } } }).webkit;
  bridge?.messageHandlers?.lilac?.postMessage(message);
}

function focusPlayerCommand(func: string, args: unknown[] = []) {
  const frame = document.getElementById('focusPlayer') as HTMLIFrameElement | null;
  frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube-nocookie.com');
}

function focusSetVolume(volume: number, restoreAfter = 0) {
  focusPlayerCommand('setVolume', [Math.max(0, Math.min(100, volume))]);
  document.querySelector('.focus-shell')?.classList.toggle('ducking', volume < 50);
  if (restoreAfter) window.setTimeout(() => {
    focusPlayerCommand('setVolume', [72]);
    document.querySelector('.focus-shell')?.classList.remove('ducking');
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
    focusSetVolume(18, 2600);
    toast('알림 중에는 18%로 낮추고 자동 복원합니다');
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
    else if (command.startsWith('duck:')) focusSetVolume(Number(command.split(':')[1]) || 18);
    else if (command === 'restore') focusSetVolume(72);
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
    <section class="sec page-top narrow">
      <div class="page-head" data-d3="head">
        <p class="sp-label">안내</p>
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
        <h3>데모 데이터 (실제가 아닙니다)</h3>
        <ul class="pd-ul">
          <li>피지컬 CD 정가: 일본 CD 시장 통상가 기준 <b>추정치</b>입니다.</li>
          <li>재고 수량 · 결제(크레딧) · 배송 상태: 데모 값이며 실제 거래가 일어나지 않습니다.</li>
          <li>공연 · 응모 일정 4건: 공개 API가 없어 예시로 넣은 데모입니다.</li>
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
      <section class="sec page-top">
        <div class="page-head" data-d3="head"><p class="sp-label">검색</p><h1 class="page-title">무엇을 찾으세요?</h1>
          <p class="page-desc">곡·아티스트·앨범·굿즈·일정을 한 번에 검색합니다.</p></div>
        <div class="mood-grid" id="srBrowse"></div>
      </section>`;
    const moods = [
      { k: '애니 타이업', c: '#8b5cf6,#4c1d95', q: 'anime' }, { k: '심야 시티팝', c: '#0ea5e9,#0c4a6e', q: 'city pop' },
      { k: 'J-ROCK', c: '#ef4444,#7f1d1d', q: 'j-rock' }, { k: '보컬로이드', c: '#22d3ee,#155e75', q: 'vocaloid' },
      { k: '발라드', c: '#f59e0b,#7c2d12', q: 'ballad' }, { k: '한정반', c: '#ec4899,#831843', q: '限定' },
    ];
    $('#srBrowse').innerHTML = moods.map((m) => `
      <a class="mood d3-tilt" href="#/search?q=${encodeURIComponent(m.q)}" style="--m:linear-gradient(135deg,${m.c})" data-d3-tilt="10" data-d3="rise">
        <span class="mood-k">${m.k}</span><span class="mood-sq"></span></a>`).join('');
    bindTilt(root());
    return;
  }

  root().innerHTML = `
    <section class="sec page-top">
      <div class="page-head" data-d3="head">
        <p class="sp-label">검색 결과</p>
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
    <a class="card round" href="#/artist/${a.id}" data-term="${esc(a.searchTerm)}" data-tilt="8">
      <div class="cover"><div class="ph">${esc(a.name[0])}</div><span class="glare"></span></div>
      <div class="c-title">${esc(a.name)}</div><div class="c-sub">${esc(a.genre)}</div></a>`).join('')}</div>`;

  const albumShelf = (list: typeof albums) => `<div class="shelf d3-stage">${list.map((al) => `
    <a class="card" href="${al.appleUrl}" target="_blank" rel="noopener" data-tilt="8">
      <div class="cover"><img src="${esc(al.artwork)}" alt="" loading="lazy" decoding="async"/><span class="glare"></span>
        <span class="card-badge">${al.trackCount}곡</span></div>
      <div class="c-title">${esc(al.title)}</div><div class="c-sub">${esc(al.year)} · ${esc(al.artist)}</div></a>`).join('')}</div>`;

  const productGrid = (list: Product[]) => `<div class="store-dark-grid">${list.map((p) => `
    <a class="p-card d3-tilt" href="#/store/${p.id}" data-d3-tilt="7" data-d3="rise">
      <div class="p-img"><img src="${esc(p.artwork)}" alt="" loading="lazy" decoding="async"/><span class="p-badge">${esc(p.badge)}</span></div>
      <div class="p-brand">${esc(p.brand)}</div><div class="p-name">${esc(p.name)}</div>
      <div class="p-price">₩${p.price.toLocaleString()}</div></a>`).join('')}</div>`;

  const eventList = (list: Ev[]) => `<div class="sch-rows">${list.map((e) => {
    const dd = Math.ceil((new Date(e.date).getTime() - Date.now()) / 864e5);
    return `<a class="sch-row" href="#/schedule">
      <div class="sch-date"><b>${new Date(e.date).getDate()}</b><span>${e.date.slice(5, 7)}월</span></div>
      <div class="sch-meta">
        <div class="sch-top"><span class="sch-type">${esc(e.type)}</span><span class="sch-dday ${dd >= 0 && dd <= 14 ? 'urgent' : ''}">${dd > 0 ? `D-${dd}` : dd === 0 ? 'D-DAY' : '종료'}</span></div>
        <div class="sch-title">${esc(e.artist)} · ${esc(e.title)}</div>
        <div class="sch-sub">${esc(e.venue)}</div>
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
  root().innerHTML = `<section class="sec page-top"><div class="page-head" data-d3="head"><h1 class="page-title">페이지를 찾을 수 없습니다</h1></div><a class="btn-pill" href="#/">${t('nav.home')}</a></section>`;
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
    <section class="sec page-top narrow">
      <div class="page-head" data-d3="head">
        <p class="sp-label">시스템</p>
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
