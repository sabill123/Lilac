/* 홈
 *  1) 무대(기본): 공연 포스터가 곡면으로 둘러선 3D 갤러리(three.js). 끌기·관성·자동 넘김, 제목과 버튼은 DOM.
 *  2) 다가오는 내한 공연 → 티켓 오픈·선행 접수 → 소식·차트 → 새 앨범 → 현지 공연 → 음악상 → 아티스트
 *     목록은 가로 선반(예매처·음악 앱과 같은 방식)으로, 섹션 설명 문구 없이 제목과 전체보기만. */
import { api } from '../../api';
import { state } from '../state';
import { t, getLocale } from '../i18n';
import { esc, icon, img, errorState, emptyState, ddayOf } from '../ui';
import { festCard, posterCard, openCard, newsRow, releaseCard, artistCard, chartRow, concertRegistry, openConcert, placeOf, whenOf, providerName, artistName } from '../cards';
import { ct } from '../cm-i18n';
import { when } from '../social';
import type { Concert, News, Release, ArtistLite, ChartEntry } from '../cards';
import { playList } from '../player';
import type { Track } from '../player';
import { mountStage3D, disposeScene } from '../../three';
import type { StageHandle } from '../../three/stage3d';
import { homeAwardsHtml, mountHomeAwards } from '../../awards';
import '../../awards/awards.css';

interface HomeData {
  edition: string;
  tickets: Concert[]; ticketsTotal: number;
  fanclub: Concert[]; fanclubTotal: number;
  visiting: Concert[]; visitingTotal: number;
  abroad: Concert[]; abroadTotal: number;
  festivals?: Concert[]; festivalsTotal?: number;
  news: News[]; newsTotal: number; newsCache: { state: string; updatedAt: string | null } | null;
  chart: { country: 'jp' | 'kr'; items: ChartEntry[] }[];
  releases: Release[]; artists: ArtistLite[];
  classifying: number;
}

interface Slide { image: string; label: string; c?: Concert; r?: Release }

let homeAbort: AbortController | null = null;
let secAbort: AbortController | null = null;

/* CORS 헤더를 주는 이미지 호스트는 바로, 아니면 백엔드 중계로(WebGL 텍스처는 교차 출처 허락이 필요하다) */
const CORS_OK = /(^|\.)(mzstatic\.com|dzcdn\.net|interpark\.com|melon\.co\.kr)$/i;
export function texUrl(u: string) {
  try { return CORS_OK.test(new URL(u).hostname) ? u : `/api/live/img?u=${encodeURIComponent(u)}`; } catch { return u; }
}

function slidesOf(d: HomeData): Slide[] {
  const ed = state.edition;
  const out: Slide[] = [];
  const seen = new Set<string>();
  const add = (c: Concert, label: string) => {
    if (!c.poster || c.unconfirmed) return;
    const k = `${c.performer || ''}|${c.title}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ image: c.poster, label, c });
  };
  for (const c of d.visiting) if (out.length < 9) add(c, t(`stage.visiting.${ed}`));
  for (const c of d.abroad) if (out.length < 12) add(c, t(`stage.abroad.${ed}`));
  for (const r of d.releases) if (out.length < 8 && r.artwork) out.push({ image: r.artwork, label: t('stage.release'), r });
  return out;
}

function slideInfo(s: Slide) {
  if (s.c) {
    const c = s.c;
    concertRegistry.set(c.id, c);
    const dd = ddayOf(c.startDate);
    const st = t(`st.${c.status}`);
    const name = c.performer || c.title;
    const ko = getLocale() === 'ko' && c.performerKo && c.performerKo !== name ? c.performerKo : '';
    return `<p class="stage-eyebrow"><span class="stage-label">${esc(s.label)}</span>${dd ? `<b class="stage-dday">${esc(dd)}</b>` : ''}${st ? `<span>${esc(st)}</span>` : ''}</p>
      <h2 class="stage-title${[...name].length > 16 ? ' is-long' : ''}">${esc(name)}${ko ? `<small>${esc(ko)}</small>` : ''}</h2>
      ${c.title !== name ? `<p class="stage-sub">${esc(c.title)}</p>` : ''}
      <p class="stage-meta">${esc([whenOf(c), placeOf(c)].filter(Boolean).join('  ·  '))}</p>
      <div class="stage-cta">
        <button type="button" class="sbtn sbtn-solid" data-open-concert="${esc(c.id)}">${t('stage.info')}</button>
        <a class="sbtn" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(providerName(c))}${icon('i-ext', 'ic xs')}</a>
      </div>`;
  }
  const r = s.r!;
  const href = r.tier === 'curated' ? `#/release/${encodeURIComponent(r.id)}` : `#/goods?q=${encodeURIComponent(r.artist)}`;
  return `<p class="stage-eyebrow"><span class="stage-label">${esc(s.label)}</span></p>
    <h2 class="stage-title${[...r.artist].length > 16 ? ' is-long' : ''}">${esc(r.artist)}</h2>
    <p class="stage-sub">${esc(r.title)}</p>
    <div class="stage-cta"><a class="sbtn sbtn-solid" href="${href}">${t('stage.album')}</a></div>`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/* 무대: 어두운 전폭 화면에 공연 포스터가 곡면으로 둘러선다(3D). WebGL이 없으면 같은 자리에서 평면 캐러셀 */
function stageHtml(slides: Slide[]) {
  const n = slides.length;
  return `<section class="stage" aria-roledescription="carousel" aria-label="${esc(t('stage.label'))}" tabindex="-1">
    <h1 class="sr-only">${esc(t(`home.title.${state.edition}`))}</h1>
    <div class="stage-canvas" data-stage aria-hidden="true"></div>
    <div class="stage-flat" aria-hidden="true">${slides.map((s, i) => `<button type="button" class="stage-flat-item" data-flat="${i}" tabindex="-1">${img(s.image, '', 'poster', { ratio: '3/4' })}</button>`).join('')}</div>
    <div class="stage-in">
      <div class="stage-info" aria-live="polite">${slides[0] ? slideInfo(slides[0]) : ''}</div>
      <div class="stage-nav">
        <span class="stage-position" aria-hidden="true"><b>01</b> / ${pad2(n)}</span>
        <div class="stage-bars" role="tablist" aria-label="${esc(t('stage.label'))}">${slides.map((s, i) => `<button type="button" role="tab" data-stage-to="${i}" aria-selected="${i === 0}" aria-label="${i + 1} / ${n} · ${esc(s.c?.performer || s.c?.title || s.r?.artist || s.label)}"></button>`).join('')}</div>
        <button type="button" class="stage-arrow" data-stage-go="-1" aria-label="${esc(t('stage.prev'))}">${icon('i-chev-l')}</button>
        <button type="button" class="stage-arrow" data-stage-go="1" aria-label="${esc(t('stage.next'))}">${icon('i-chev-r')}</button>
      </div>
    </div>
  </section>`;
}

function bindStage(root: HTMLElement, slides: Slide[], signal: AbortSignal) {
  const stage = root.querySelector<HTMLElement>('.stage');
  if (!stage || !slides.length) return;
  const host = stage.querySelector<HTMLElement>('[data-stage]')!;
  const info = stage.querySelector<HTMLElement>('.stage-info')!;
  const pos = stage.querySelector<HTMLElement>('.stage-position')!;
  const flats = Array.from(stage.querySelectorAll<HTMLElement>('[data-flat]'));
  const bars = Array.from(stage.querySelectorAll<HTMLButtonElement>('[data-stage-to]'));
  const n = slides.length;
  let cur = -1;
  let handle: StageHandle | null = null;
  let timer = 0;
  const show = (i: number) => {
    if (signal.aborted || i === cur) return;
    cur = i;
    info.innerHTML = slideInfo(slides[i]);
    info.classList.remove('is-in'); void info.offsetWidth; info.classList.add('is-in');
    pos.innerHTML = `<b>${pad2(i + 1)}</b> / ${pad2(n)}`;
    bars.forEach((b, k) => b.setAttribute('aria-selected', String(k === i)));
    flats.forEach((el, k) => {
      let d = k - i; if (d > n / 2) d -= n; if (d < -n / 2) d += n;
      el.style.setProperty('--d', String(d));
      el.classList.toggle('is-on', d === 0);
      el.hidden = Math.abs(d) > 2;
    });
  };
  const goTo = (i: number) => { const k = ((i % n) + n) % n; if (handle) handle.goTo(k); else show(k); };
  const go = (delta: number) => { if (handle) handle.go(delta); else goTo(cur + delta); };
  stage.querySelectorAll<HTMLButtonElement>('[data-stage-go]').forEach((b) => b.addEventListener('click', () => { go(Number(b.dataset.stageGo)); restartFlat(); }, { signal }));
  bars.forEach((b) => b.addEventListener('click', () => { goTo(Number(b.dataset.stageTo)); restartFlat(); }, { signal }));
  stage.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  }, { signal });
  const pick = (i: number) => {
    const s = slides[i];
    if (s.c) openConcert(s.c.id);
    else if (s.r) location.hash = s.r.tier === 'curated' ? `#/release/${encodeURIComponent(s.r.id)}` : `#/goods?q=${encodeURIComponent(s.r.artist)}`;
  };
  flats.forEach((el, k) => el.addEventListener('click', () => (k === cur ? pick(k) : goTo(k)), { signal }));
  /* 평면 캐러셀의 자동 넘김 — 3D는 자체 자동 넘김을 쓴다. 모션 줄이기면 멈춘다 */
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  function restartFlat() {
    clearInterval(timer);
    if (handle || reduce.matches || n < 2) return;
    timer = window.setInterval(() => { if (!document.hidden && !stage!.matches(':hover, :focus-within')) goTo(cur + 1); }, 5200);
  }
  show(0);
  stage.classList.add('is-loading');
  mountStage3D(host, slides.map((s) => ({ image: texUrl(s.image), label: s.label })), { onFocus: show, onPick: pick }).then((h) => {
    if (signal.aborted) { h?.destroy(); return; }
    handle = h;
    stage.classList.remove('is-loading');
    stage.classList.toggle('is-3d', !!h);
    stage.classList.toggle('is-flat', !h);
    if (h) { clearInterval(timer); if (cur > 0) h.goTo(cur); }
    else restartFlat();
  });
  signal.addEventListener('abort', () => { clearInterval(timer); disposeScene(); }, { once: true });
}

/* 가로 선반: 제목 · 전체보기 · 앞뒤 버튼 */
function shelf(id: string, title: string, href: string, body: string, cls: string) {
  return `<section class="sec shelf-sec" id="${id}">
    <div class="sec-head"><h2>${esc(title)}</h2><div class="sec-tools">${href ? `<a class="more" href="${href}">${t('more')}</a>` : ''}
      <button type="button" class="rail-btn" data-rail="-1" aria-label="${esc(t('shelf.prev'))}">${icon('i-chev-l', 'ic')}</button><button type="button" class="rail-btn" data-rail="1" aria-label="${esc(t('shelf.next'))}">${icon('i-chev-r', 'ic')}</button></div></div>
    <ul class="rail ${cls}">${body}</ul>
  </section>`;
}
function bindRails(root: HTMLElement, signal: AbortSignal) {
  root.querySelectorAll<HTMLElement>('.shelf-sec').forEach((sec) => {
    const rail = sec.querySelector<HTMLElement>('.rail');
    if (!rail) return;
    const btns = sec.querySelectorAll<HTMLButtonElement>('[data-rail]');
    const sync = () => {
      const max = rail.scrollWidth - rail.clientWidth - 2;
      btns[0].disabled = rail.scrollLeft <= 2;
      btns[1].disabled = rail.scrollLeft >= max;
      sec.classList.toggle('no-scroll', max <= 0);
    };
    btns.forEach((b) => b.addEventListener('click', () => rail.scrollBy({ left: Number(b.dataset.rail) * rail.clientWidth * 0.9, behavior: 'smooth' }), { signal }));
    rail.addEventListener('scroll', sync, { passive: true, signal });
    sync();
  });
}

export async function renderHome(root: HTMLElement, alive: () => boolean) {
  homeAbort?.abort();
  const ctrl = new AbortController();
  homeAbort = ctrl;
  const ed = state.edition;
  root.innerHTML = `<section class="home-loading" aria-busy="true"><span class="sk" style="width:36%;height:32px"></span><div class="sk" style="height:340px;margin-top:24px"></div></section>`;

  let d: HomeData;
  try {
    d = await api(`/api/live/home?edition=${ed}`);
  } catch {
    if (!alive()) return;
    root.innerHTML = errorState(t('err.generic'));
    root.querySelector('[data-retry]')?.addEventListener('click', () => renderHome(root, alive));
    return;
  }
  if (!alive() || ctrl.signal.aborted) return;

  const slides = slidesOf(d);
  root.innerHTML = `${slides.length ? stageHtml(slides) : `<h1 class="sr-only">${esc(t(`home.title.${ed}`))}</h1>`}${sectionsHtml(d)}`;
  secAbort?.abort();
  secAbort = new AbortController();
  bindSections(root, d, alive, secAbort.signal);
  bindStage(root, slides, ctrl.signal);

}

/* 실시간 반영: 무대(3D)는 그대로 두고 아래 목록만 새 데이터로 바꿔 끼운다 */
export async function refreshHome(root: HTMLElement, alive: () => boolean) {
  if (!homeAbort || homeAbort.signal.aborted) return;
  let d: HomeData;
  try { d = await api(`/api/live/home?edition=${state.edition}`); } catch { return; }
  if (!alive() || !homeAbort || homeAbort.signal.aborted) return;
  const box = document.createElement('div');
  box.innerHTML = sectionsHtml(d);
  secAbort?.abort();
  secAbort = new AbortController();
  Array.from(root.children).forEach((el) => { if (!el.classList.contains('stage') && !el.classList.contains('sr-only')) el.remove(); });
  root.append(...Array.from(box.childNodes));
  bindSections(root, d, alive, secAbort.signal);
}

function sectionsHtml(d: HomeData) {
  const ed = state.edition;
  const visList = d.visiting.filter((x) => !x.unconfirmed);
  const ch = d.chart[0];
  const opens = [...d.fanclub, ...d.tickets.filter((x) => x.provider !== 'fanclub')]
    .sort((a, b) => String(a.saleSortAt || a.ticketOpenAt || '').localeCompare(String(b.saleSortAt || b.ticketOpenAt || '')));
  const li = (html: string) => `<li>${html}</li>`;
  return `
    ${visList.length ? shelf('secVisiting', t(`home.visiting.${ed}`), '#/concerts/visiting', visList.slice(0, 16).map((c) => li(posterCard(c))).join(''), 'rail-posters')
      : `<section class="sec" id="secVisiting"><div class="sec-head"><h2>${esc(t(`home.visiting.${ed}`))}</h2></div>${emptyState(d.classifying ? t('c.classifying', { n: d.classifying }) : t('empty.generic'))}</section>`}
    ${opens.length ? shelf('secTickets', t('home.opens'), '#/concerts/tickets', opens.slice(0, 14).map(openCard).join(''), 'rail-opens') : ''}
    <div class="split">
      <section class="sec" id="secNews"><div class="sec-head"><h2>${esc(t('home.news'))}</h2><a class="more" href="#/news">${t('more')}</a></div>${d.news.length ? `<ul class="nlist">${d.news.slice(0, 8).map(newsRow).join('')}</ul>` : emptyState(t('empty.generic'))}</section>
      <section class="sec" id="secChart">${ch ? `<div class="sec-head"><h2>${esc(t(`home.chart.${ch.country}`))}</h2><a class="more" href="#/chart/${ch.country}">${t('more')}</a></div><ol class="clist compact">${ch.items.map((e, i) => chartRow(e, i, { compact: true })).join('')}</ol>` : ''}</section>
    </div>
    <div class="split" id="secTalkWrap">
      <section class="sec" id="secTalk"><div class="sec-head"><h2>${esc(ct('home.talk'))}</h2><a class="more" href="#/community">${t('more')}</a></div><div class="talk-body">${'<div class="sk sk-line"></div>'.repeat(5)}</div></section>
      <section class="sec" id="secGals"><div class="sec-head"><h2>${esc(ct('home.gals'))}</h2><a class="more" href="#/community/list">${t('more')}</a></div><ol class="gal-rank">${'<li class="sk sk-line"></li>'.repeat(5)}</ol></section>
    </div>
    ${d.releases.length ? shelf('secReleases', t('home.releases'), '#/goods', d.releases.slice(0, 16).map((r) => li(releaseCard(r))).join(''), 'rail-squares') : ''}
    ${d.festivals?.length ? shelf('secFest', getLocale() === 'ja' ? '韓国・日本の音楽フェス' : '한국·일본 음악 페스티벌', '#/concerts/festivals', d.festivals.slice(0, 16).map((c) => li(festCard(c))).join(''), 'rail-posters') : ''}
    ${d.abroad.length ? shelf('secAbroad', t(`home.abroad.${ed}`), '#/concerts/abroad', d.abroad.slice(0, 12).map((c) => li(posterCard(c))).join(''), 'rail-posters') : ''}
    <div class="awards-wrap">${homeAwardsHtml()}</div>
    ${shelf('secArtists', t('home.artists'), '#/artists', d.artists.slice(0, 18).map((a) => li(artistCard(a))).join(''), 'rail-artists')}`;
}

function bindSections(root: HTMLElement, d: HomeData, alive: () => boolean, signal: AbortSignal) {
  const ch = d.chart[0];
  if (ch) {
    const tracks: Track[] = ch.items.map((e) => ({ title: e.title, artist: e.artist, artwork: e.artwork, appleUrl: e.appleUrl }));
    root.querySelector('#secChart')?.querySelectorAll<HTMLElement>('[data-play]').forEach((b) => b.addEventListener('click', () => playList(tracks, Number(b.dataset.play)), { signal }));
  }
  void paintTalk(root, state.edition, () => alive() && !signal.aborted);
  bindRails(root, signal);
  const aw = root.querySelector<HTMLElement>('.awards-wrap');
  if (aw) mountHomeAwards(aw, signal);
}

/* 커뮤니티 — 개념글이 있으면 개념글, 없으면 새 글. 옆에는 활발한 갤러리 순위(글이 없으면 차트 순) */
async function paintTalk(root: HTMLElement, ed: string, alive: () => boolean) {
  const [hub, gals] = await Promise.all([
    api(`/api/community/hub?edition=${ed}`).catch(() => null),
    api(`/api/community/galleries?edition=${ed}`).catch(() => null),
  ]);
  if (!alive()) return;
  const box = root.querySelector('#secTalk .talk-body');
  const rank = root.querySelector('#secGals .gal-rank');
  if (!box || !rank) return;
  type R = { board: string; no: number; head: string; title: string; cmt: number; up: number; at: string; gallery?: { id: string; kind: string; artist?: { name: string; nameOriginal?: string | null } } };
  const best: R[] = hub?.best || [];
  const rows: R[] = (best.length >= 3 ? best : hub?.recent || []).slice(0, 8);
  if (best.length >= 3) root.querySelector('#secTalk h2')!.textContent = ct('home.talkBest');
  const gname = (g: R['gallery']) => (!g ? '' : g.kind === 'general' ? ct(`g.${g.id}` as never) : artistName(g.artist as { name: string }));
  box.innerHTML = rows.length
    ? `<ul class="mini-list">${rows.map((x) => `<li><a href="#/community/${encodeURIComponent(x.board)}/${x.no}"><span class="mh">${esc(gname(x.gallery))}</span><span class="mt">${esc(x.title)}</span>${x.cmt ? `<em class="rc">[${x.cmt}]</em>` : ''}</a><span class="mu">${x.up ? `${icon('i-up', 'ic xs')}${x.up}` : ''}</span><time>${esc(when(x.at))}</time></li>`).join('')}</ul>`
    : `<p class="cm-empty">${esc(ct('home.talkEmpty'))}</p>`;
  const top: { id: string; artist: { name: string; nameOriginal?: string | null; photo?: string | null; artwork?: string | null }; posts: number; week: number }[] = (gals?.items || []).slice(0, 8);
  rank.innerHTML = top.map((g, i) => `<li><span class="rk">${i + 1}</span><a href="#/community/${encodeURIComponent(g.id)}">${img(g.artist.photo || g.artist.artwork, '', 'round', { ratio: '1/1', initial: g.artist.name })}<b>${esc(artistName(g.artist))}</b></a><em>${g.posts ? esc(ct('gal.posts', { n: g.posts })) : ''}</em></li>`).join('');
}

export function leaveHome() {
  homeAbort?.abort();
  homeAbort = null;
  secAbort?.abort();
  secAbort = null;
}
