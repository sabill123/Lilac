import { publicPreview, configurePublicPreview, probeDeploymentHealth, previewAccountPage, previewNoticeHtml, PREVIEW_NOTICE } from './public-preview';
import { disposeDiscovery } from './discovery';
import './styles/index.css';
import { smartMatch, loadAliases } from './koja';
import { api, me, refreshMe, esc, icon, findCatalog } from './api';
import { initPlayer, loadLikes, toast, playerActions, getQueueContext, askName } from './player';
import { t, setLocale, getLocale, LOCALES, withParticle } from './i18n';
import type { Locale } from './i18n';
import { loadData, pageHome, pageChart, pageStore, pageProduct, pageSchedule, pageFocus, pageArtist, pageArtists, pageLibrary, pagePlaylist, pageLogin, pageSignup, pageAccount, pageOrders, pageOrderDetail, pageHelp, pageSearch, page404, pageRenderError , pageStatus } from './pages';
import { initMusicKitIfConfigured } from './musickit';
import { initKeyboard, initContextMenu } from './interactions';
import { disposeScene } from './three';
import { pageRelease, pageReleases } from './release';
import { isSiteRoute, setSiteMode, SITE_TITLES } from './site/routes';

/* 마케팅 레이어는 지연 로드한다 — 랜딩 섹션·법무 마크다운·전용 CSS가
   앱 번들에 섞이면 약관을 볼 일 없는 사용자까지 그 비용을 물게 된다.
   한 번 받으면 모듈이 캐시되므로 프로미스를 재사용한다. */
type SiteModule = typeof import('./site');
let sitePromise: Promise<SiteModule> | null = null;
let resolvedSiteModule: SiteModule | null = null;
const loadSite = () => (sitePromise ??= import('./site'));

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const NAV = [
  { r: 'home', href: '#/', k: 'nav.home', ic: 'i-home' },
  { r: 'chart', href: '#/chart', k: 'nav.chart', ic: 'i-chart' },
  { r: 'store', href: '#/store', k: 'nav.store', ic: 'i-bag' },
  { r: 'schedule', href: '#/schedule', k: 'nav.schedule', ic: 'i-cal' },
];

/* ---------- 사이드바 ---------- */
type SbItem = { id: string; kind: 'likes' | 'playlist' | 'artist'; name: string; sub: string; art: string; href: string; at: string; n: number };
let sbItems: SbItem[] = [];
let sbFilter = 'all';
let sbQuery = '';
let sbSortMode: 'recent' | 'name' = 'recent';

async function renderSidebar() {
  $('#sbNav').innerHTML = NAV.map((n) =>
    `<a class="sb-item" data-r="${n.r}" href="${n.href}" title="${t(n.k)}"><svg class="ic"><use href="#${n.ic}"/></svg><span>${t(n.k)}</span></a>`).join('');
  $('#sbLibLabel').textContent = t('nav.library');
  const CHIPS = [
    { k: 'all', label: '전체' },
    { k: 'playlist', label: t('lib.playlists') },
    { k: 'artist', label: t('lib.follows') },
  ];
  $('#sbChips').innerHTML = CHIPS.map((c) => `<button class="sb-chip ${c.k === sbFilter ? 'on' : ''}" data-f="${c.k}">${c.label}</button>`).join('');
  $('#sbChips').querySelectorAll<HTMLButtonElement>('.sb-chip').forEach((b) =>
    b.addEventListener('click', () => { sbFilter = b.dataset.f!; renderSidebar(); }));

  if (publicPreview) {
    sbItems = []; $('#sbList').innerHTML = '<div class="sb-empty"><p>계정 저장이 없는 미리보기입니다.</p><a href="#/library">미리보기 안내</a></div>'; return;
  }
  const [lists, likes, oshi] = await Promise.all([
    api('/api/playlists').catch(() => []), api('/api/likes').catch(() => []), api('/api/oshi').catch(() => []),
  ]);
  sbItems = [
    ...(likes.length ? [{ id: 'likes', kind: 'likes' as const, name: t('lib.likes'), sub: `플레이리스트 · ${likes.length}곡`, art: '', href: '#/library/likes', at: likes[0]?.likedAt || new Date().toISOString(), n: likes.length }] : []),
    ...lists.map((p: { id: string; name: string; createdAt: string; tracks: { artwork?: string }[] }) => ({
      id: p.id, kind: 'playlist' as const, name: p.name, sub: `플레이리스트 · ${p.tracks.length}곡`,
      art: p.tracks[0]?.artwork || '', href: `#/playlist/${p.id}`, at: p.createdAt, n: p.tracks.length,
    })),
    ...oshi.map((o: { artistId: string; name: string; at: string }) => ({
      id: o.artistId, kind: 'artist' as const, name: o.name, sub: '아티스트',
      art: '', href: `#/artist/${o.artistId}`, at: o.at, n: 0,
    })),
  ];
  paintSbList();
}

function paintSbList() {
  let rows = sbItems.filter((i) => (sbFilter === 'all' ? true : i.kind === sbFilter || (sbFilter === 'playlist' && i.kind === 'likes')));
  if (sbQuery) rows = rows.filter((i) => smartMatch(i.name, sbQuery));
  rows.sort((a, b) => (sbSortMode === 'name' ? a.name.localeCompare(b.name) : (b.at || '').localeCompare(a.at || '')));

  const box = $('#sbList');
  if (!rows.length) {
    box.innerHTML = `<div class="sb-empty">${icon('i-lib', 'ic')}<p>${sbQuery ? '검색 결과가 없습니다' : '항목이 없습니다'}</p>
      ${sbQuery ? '' : `<button class="sb-empty-btn" id="sbEmptyNew">${t('lib.newPlaylist')}</button>`}</div>`;
    document.getElementById('sbEmptyNew')?.addEventListener('click', () => $('#sbAdd').click());
    return;
  }
  const ctx = getQueueContext();
  box.innerHTML = rows.map((i) => `
    <a class="sb-row ${i.kind === 'artist' ? 'round' : ''} ${ctx === `${i.kind}:${i.id}` ? 'playing' : ''}" href="${i.href}" data-key="${i.kind}:${i.id}" data-term="${i.kind === 'artist' ? esc(i.name) : ''}">
      <span class="sb-cover ${i.kind === 'likes' ? 'liked' : ''}" ${i.art ? `style="background-image:url(${esc(i.art)})"` : ''}>
        ${i.kind === 'likes' ? icon('i-heart-f', 'ic s') : i.art ? '' : icon(i.kind === 'artist' ? 'i-mic' : 'i-queue', 'ic s')}
        <span class="sb-play">${icon('i-play')}</span>
      </span>
      <span class="sb-meta"><b>${esc(i.name)}</b><i>${esc(i.sub)}</i></span>
      <span class="sb-eq"><span class="np-eq"><i></i><i></i><i></i></span></span>
    </a>`).join('');

  // 아티스트 커버 보충
  box.querySelectorAll<HTMLElement>('.sb-row[data-term]').forEach(async (el) => {
    if (!el.dataset.term) return;
    const a = ARTIST_TERMS.get(el.dataset.term);
    if (!a) return;
    const hit = await findCatalog(a);
    const cov = el.querySelector<HTMLElement>('.sb-cover');
    if (hit && cov) cov.style.backgroundImage = `url(${hit.artwork.replace('400x400', '200x200')})`;
  });
  markActive();
}

const ARTIST_TERMS = new Map<string, string>();

/* ---------- 모드 (브라우즈 / 플레이) ---------- */
type Mode = 'browse' | 'play';
const PLAY_ROUTES = new Set(['library', 'playlist']);
const BROWSE_ONLY = new Set(['login', 'signup', 'account', 'orders', 'help', 'work', 'focus']); // 계정·워크 화면은 항상 브라우즈
/* 전역 라이트 테마는 사용하지 않는다. 스토어의 밝은 상품 진열면은
   store/store.css의 .commerce-store 안에서만 소유한다. */
const LIGHT_ROUTES = new Set<string>([]);
let userMode: Mode = (localStorage.getItem('lilac.mode') as Mode) || 'browse';
function currentSeg() { return (location.hash.split('/')[1] || 'home').split('?')[0] || 'home'; }
function applyMode() {
  const seg = currentSeg();
  const onWork = seg === 'work' || seg === 'focus';
  const mode: Mode = BROWSE_ONLY.has(seg) ? 'browse' : PLAY_ROUTES.has(seg) ? 'play' : userMode;
  document.body.classList.toggle('play-mode', mode === 'play');
  document.body.classList.toggle('light-page', LIGHT_ROUTES.has(seg));
  document.body.classList.toggle('work-page', onWork);
  document.body.classList.toggle('immersive-home', seg === 'home');
  const workLinks = [$('#tbWorkMode') as HTMLAnchorElement, $('#mWorkMode') as HTMLAnchorElement];
  workLinks.forEach((link) => {
    link.href = onWork ? '#/' : '#/work';
    link.dataset.r = onWork ? 'home' : 'work';
    link.querySelector('span')!.textContent = onWork ? 'J‑POP 둘러보기' : t('nav.focus');
  });
  $('#btnMode').classList.toggle('on', mode === 'play');
  $('#btnMode').title = mode === 'play' ? '브라우즈 모드로' : '플레이 모드로';
  $('#btnMode').setAttribute('aria-label', $('#btnMode').title);
}
export function toggleMode() {
  const onPlayRoute = PLAY_ROUTES.has(currentSeg());
  userMode = userMode === 'play' ? 'browse' : 'play';
  localStorage.setItem('lilac.mode', userMode);
  applyMode();
  toast(userMode === 'play' ? '플레이 모드' : '브라우즈 모드');
  // 모드마다 페이지 레이아웃이 다르므로 다시 렌더링
  if (onPlayRoute && userMode === 'browse') location.hash = '#/';
  else route();
}

/* ---------- 톱바 ---------- */
function renderTopbar() {
  $('#tbMenu').innerHTML = NAV.map((n) =>
    `<a class="tb-item" data-r="${n.r}" href="${n.href}">${t(n.k)}</a>`).join('')
    + `<a class="tb-item" data-r="library" href="#/library">${t('nav.library')}</a>`;
  $('#tbWorkMode').querySelector('span')!.textContent = t('nav.focus');
  $('#mWorkMode').querySelector('span')!.textContent = t('nav.focus');
  ($('#searchInput') as HTMLInputElement).placeholder = t('search.ph');
  $('#connectApple').textContent = $('#connectApple').classList.contains('connected') ? t('connected') : t('connect');
  $('#connectApple').hidden = publicPreview;
  const acct = $('#gnbAcct');
  acct.innerHTML = publicPreview ? '<a class="tb-link" href="#/login">미리보기 안내</a>' : me
    ? `<a class="tb-user" href="#/account" title="${t('account')}"><span class="tb-avatar">${esc(me.name[0])}</span><span class="tb-credits">${me.credits.toLocaleString()}C</span></a>`
    : `<a class="tb-link" href="#/login">${t('login')}</a><a class="tb-signup" href="#/signup">${t('signup')}</a>`;
  const mobileNav = [...NAV, { r: 'library', href: '#/library', k: 'nav.library', ic: 'i-lib' }];
  $('#mnav').innerHTML = mobileNav
    .map((n) => `<a data-r="${n.r}" href="${n.href}"><svg class="ic"><use href="#${n.ic}"/></svg><span>${t(n.k)}</span></a>`).join('');
  markActive();
}
function markActive() {
  const r = (location.hash.split('/')[1] || 'home').split('?')[0] || 'home';
  document.querySelectorAll('[data-r]').forEach((el) => {
    const active = (el as HTMLElement).dataset.r === r;
    el.classList.toggle('on', active);
    if (el.matches('a')) { if(active) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current'); }
  });
  document.querySelectorAll<HTMLElement>('.sb-row[data-key]').forEach((el) => {
    const [kind, id] = (el.dataset.key || '').split(':');
    const target = kind === 'playlist' ? `#/playlist/${id}` : kind === 'artist' ? `#/artist/${id}` : '#/library/likes';
    el.classList.toggle('on', location.hash === target);
  });
}

/* ---------- 지구본 ---------- */
function initGlobe() {
  const menu = $('#localeMenu');
  const paint = () => { menu.innerHTML = LOCALES.map((l) => `<button data-l="${l.id}" class="${l.id === getLocale() ? 'on' : ''}">${l.label}</button>`).join(''); };
  paint();
  $('#btnGlobe').addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('show'); });
  document.addEventListener('click', () => menu.classList.remove('show'));
  menu.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-l]');
    if (!btn) return;
    setLocale(btn.dataset.l as Locale);
    paint(); menu.classList.remove('show');
    if (me) await fetch('/api/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language: btn.dataset.l }) }).catch(() => {});
    renderTopbar(); void renderSidebar(); route();
  });
}


/* ---------- 페이지 타이틀 ---------- */
const TITLES: Record<string, string> = {
  home: '홈', chart: '차트', store: '스토어', schedule: '일정', artist: '아티스트',
  work: '워크 모드', focus: '워크 모드', status: '서비스 상태',
  artists: '아티스트', library: '보관함', playlist: '플레이리스트', account: '계정',
  orders: '주문 내역', help: '서비스 안내', search: '검색', login: '로그인', signup: '가입',
  release: '판매처 비교',
  releases: '판매처 비교',
  ...SITE_TITLES,
};
function setTitle(seg: string) {
  const base = TITLES[seg] || '';
  document.title = base ? `${base} · Lilac` : 'Lilac';
  const h = document.getElementById('srAnnounce');
  if (h) h.textContent = `${base} 페이지로 이동했습니다`;
}

/* ---------- 스크롤 위치 복원 ---------- */
const scrollMem = new Map<string, number>();
let lastHash = location.hash;
function rememberScroll() {
  const p = document.querySelector('.main-panel');
  if (p) scrollMem.set(lastHash, p.scrollTop);
}
function restoreScroll(hash: string) {
  const p = document.querySelector('.main-panel');
  if (!p) return;
  const y = scrollMem.get(hash);
  p.scrollTo({ top: y ?? 0 });
}

/* ---------- 첫 방문 온보딩 ---------- */
function maybeOnboard() {
  if (localStorage.getItem('lilac.onboarded')) return;
  /* 마케팅·법무 페이지에서는 띄우지 않는다.
     "Lilac은 두 가지 모드로 씁니다"는 앱 사용법 안내라, 요금제나 약관을 보러 온
     사람에게는 맥락이 어긋나고 본문을 가리기만 한다.
     (딥링크로 #/pricing 에 바로 들어온 첫 방문자가 이 화면부터 만났다) */
  if (document.body.classList.contains('site-mode')) return;
  const el = document.getElementById('onboard');
  if (!el) return;
  el.classList.add('show');
  const close = () => { el.classList.remove('show'); localStorage.setItem('lilac.onboarded', '1'); };
  el.querySelector('#obStart')?.addEventListener('click', close);
  el.querySelector('#obSkip')?.addEventListener('click', close);
  el.querySelector('#obPlay')?.addEventListener('click', () => {
    localStorage.setItem('lilac.mode', 'play');
    close();
    location.reload();
  });
}

/* ---------- 모달 포커스 트랩 ---------- */
function initFocusTrap() {
  const SEL = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const open = document.querySelector<HTMLElement>('.modal.show, .np-full.show, .onboard.show');
    if (!open) return;
    const f = Array.from(open.querySelectorAll<HTMLElement>(SEL)).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  // 모달이 열리면 첫 요소로 포커스 이동
  const mo = new MutationObserver((ms) => {
    ms.forEach((m) => {
      const t = m.target as HTMLElement;
      if (t.classList?.contains('show') && (t.classList.contains('modal') || t.classList.contains('np-full') || t.classList.contains('onboard'))) {
        setTimeout(() => t.querySelector<HTMLElement>(SEL)?.focus(), 60);
      }
    });
  });
  document.querySelectorAll('.modal, .np-full, .onboard').forEach((m) =>
    mo.observe(m, { attributes: true, attributeFilter: ['class'] }));
}

/* ---------- 라우터 ---------- */
let navDepth = 0;
let routeGeneration = 0;

/* View Transitions —
   라우트 전환을 브라우저가 이전/다음 화면 스냅숙으로 부드럽게 이어준다.
   사이트 라우트와 앱 라우트가 같은 동작을 공유하도록 헬퍼로 뽑았다.
   미지원 브라우저·모션 최소화·첫 로드에서는 즉시 렌더로 떨어진다. */
type ViewTransition = {
  finished: Promise<void>;
  ready?: Promise<void>;
  updateCallbackDone?: Promise<void>;
  skipTransition?: () => void;
};
type VTDoc = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => ViewTransition;
};
function canTransition() {
  return (
    Boolean((document as VTDoc).startViewTransition) &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    Boolean(lastHash)
  );
}
async function runTransition(cb: () => void | Promise<void>) {
  const vt = (document as VTDoc).startViewTransition?.bind(document);
  if (!canTransition() || !vt) { await cb(); return; }

  const t = vt(cb);
  /* 전환 객체는 finished 말고도 ready·updateCallbackDone 을 준다.
     빠르게 라우트를 갈아치우면 앞 전환이 취소되면서 이 세 개가 전부 reject 되는데,
     finished 만 await 하면 나머지 둘이 미처리 거부로 남아
     "AbortError: Transition was skipped" 가 콘솔에 쌓인다.
     (실제로 라우트 연속 이동 QA 에서 잡혔다) 전부 삼켜준다. */
  t.ready?.catch(() => {});
  t.updateCallbackDone?.catch(() => {});
  try {
    await t.finished;
  } catch { /* 전환 실패는 무시 — 렌더 자체는 이미 끝났다 */ }
}

/** 실제 페이지 렌더 — route()와 분리해 View Transition 콜백으로 쓸 수 있게 한다 */
async function renderRoute(seg: string, sub: string | undefined, qs: URLSearchParams) {
  $('#page').dataset.page = seg || 'home';
  if (previewAccountPage(seg)) { $('#page').innerHTML=previewNoticeHtml(); return; }
  try {
    switch (seg || 'home') {
      case 'home': await pageHome(); break;
      case 'chart': await pageChart(sub); break;
      case 'store': sub ? await pageProduct(sub) : await pageStore(); break;
      case 'release': await pageRelease(sub); break;
      case 'releases': await pageReleases(); break;
      case 'schedule': await pageSchedule(); break;
      case 'work': await pageFocus(); break;
      case 'artist': await pageArtist(sub); break;
      case 'artists': await pageArtists(); break;
      case 'orders': sub ? await pageOrderDetail(sub) : await pageOrders(); break;
      case 'status': pageStatus(); break;
      case 'help': pageHelp(); break;
      case 'library': await pageLibrary(sub); break;
      case 'playlist': await pagePlaylist(sub); break;
      case 'login': pageLogin(); break;
      case 'signup': pageSignup(); break;
      case 'account': await pageAccount(); break;
      case 'search': await pageSearch(qs.get('q') || ''); break;
      default: page404();
    }
  } catch (e) {
    // 404(없는 주소)와 렌더 실패(백엔드·네트워크)는 원인이 다르다.
    // 같은 화면으로 뭉뚱그리면 사용자가 엉뚱한 곳을 고치게 된다.
    console.error(e);
    pageRenderError(e instanceof Error ? e.message : undefined);
  }
  // Music surfaces own bounded WebGL motion; content never depends on a reveal observer.
  $('#page').querySelectorAll<HTMLElement>('.rk-row[data-i]').forEach((row) => {
    row.tabIndex = 0; row.setAttribute('role', 'group'); row.setAttribute('aria-label', (row.querySelector('.rk-t')?.textContent || '곡') + ' 미리듣기');
    if (!row.hasAttribute('data-keyboard-bound')) { row.setAttribute('data-keyboard-bound','1'); row.addEventListener('keydown', (e) => { if (!e.defaultPrevented && e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); row.click(); } }); }
  });
}

async function route() {
  const generation = ++routeGeneration;
  const routeHash = location.hash;
  // Imports and queued transitions may finish after another navigation, even to the same hash.
  const isCurrent = () => generation === routeGeneration && location.hash === routeHash;
  const hash = routeHash.replace(/^#\/?/, '');
  const [seg, sub] = hash.split('?')[0].split('/');
  const qs = new URLSearchParams(hash.split('?')[1] || '');
  if (seg === 'focus') { location.replace('#/work'); return; }

  /* 마케팅·법무 라우트 —
     원본(사내 레퍼런스 프로젝트)에서 (marketing) 라우트 그룹이
     (app) 레이아웃을 쓰지 않듯, 이 구간은 앱 크롬(사이드바·톱바·플레이어)을
     끄고 자체 셸로 렌더한다. 소개 랜딩은 독립적으로 3D 씬을 관리한다. */
  if (isSiteRoute(seg)) {
    rememberScroll();
    disposeDiscovery();
    disposeScene();
    document.body.classList.remove('has-3d-hero', 'has-3d-chart', 'play-mode', 'light-page', 'work-page', 'immersive-home');

    /* 모듈을 먼저 기다린 뒤에 모드를 바꿈다.
       site.css 가 같은 청크로 딴려오므로 먼저 클래스를 걸면
       CSS 도착 전 한 프레임 동안 앱 크롬이 번처럼 보인다. */
    const site = await loadSite();
    resolvedSiteModule = site;
    if (!isCurrent()) return;

    /* 하위 경로가 붙은 주소(#/terms/foo)는 존재하지 않는다.
       조용히 약관을 보여주면 사용자가 오타를 모른다. 404 로 밝힌다. */
    const unknownSub = Boolean(sub);
    await runTransition(() => {
      if (!isCurrent()) return;
      setSiteMode(true);
      if (unknownSub) site.renderSiteNotFound(`#/${seg}/${sub}`);
      else site.renderSitePage(seg);
    });

    if (!isCurrent()) return;
    lastHash = routeHash;
    return;
  }
  if (document.body.classList.contains('site-mode')) {
    setSiteMode(false);
    // Clean up synchronously: a deferred leave could dispose the next site's scene and metadata.
    resolvedSiteModule?.leaveSite();
  }

  rememberScroll();
  // 이전 페이지의 3D 씬을 정리한다 (GPU 리소스·렌더 루프 누수 방지)
  disposeDiscovery();
  disposeScene();
  document.body.classList.remove('has-3d-hero', 'has-3d-chart');
  applyMode();
  markActive();
  setTitle(seg || 'home');

  /* View Transitions —
     라우트 전환을 브라우저가 이전/다음 화면 스냅숏으로 부드럽게 이어준다.
     톱바·사이드바·플레이어는 view-transition-name 으로 고정해
     '내용만 넘어가는' 앱다운 전환이 된다.
     미지원 브라우저·모션 최소화에서는 기존 즉시 렌더로 동작한다. */
  if (canTransition()) {
    await runTransition(() => {
      if (!isCurrent()) return;
      return renderRoute(seg, sub, qs);
    });
  } else {
    await renderRoute(seg, sub, qs);
  }

  if (!isCurrent()) return;
  restoreScroll(routeHash);
  lastHash = routeHash;
  onScroll();
}
function onScroll() {
  const panel = $('#mainPanel');
  $('#topbar').classList.toggle('scrolled', panel.scrollTop > 12);
}

/* ---------- 부트 ---------- */
async function boot() {
  initPlayer();
  initGlobe();
  initContextMenu();
  const panel = $('#mainPanel');
  panel.addEventListener('scroll', onScroll, { passive: true });

  // 히스토리 네비게이션
  $('#navBack').addEventListener('click', () => history.back());
  $('#navFwd').addEventListener('click', () => history.forward());
  $('#btnMode').addEventListener('click', toggleMode);

  $('#sbAdd').addEventListener('click', async () => {
    if (publicPreview) { toast(PREVIEW_NOTICE); return; }
    const name = await askName(t('lib.newPlaylist'), 'My Mix');
    if (!name) return;
    const pl = await api('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) });
    await renderSidebar();
    location.hash = `#/playlist/${pl.id}`;
  });
  // 사이드바 접기 / 검색 / 정렬
  $('#sbCollapse').addEventListener('click', () => {
    const c = document.body.classList.toggle('sb-collapsed');
    localStorage.setItem('lilac.sbCollapsed', c ? '1' : '0');
  });
  if (localStorage.getItem('lilac.sbCollapsed') === '1') document.body.classList.add('sb-collapsed');
  $('#sbFindBtn').addEventListener('click', () => {
    document.querySelector('.sb-tools')!.classList.add('open');
    ($('#sbFind') as HTMLInputElement).focus();
  });
  $('#sbFind').addEventListener('input', (e) => { sbQuery = (e.target as HTMLInputElement).value; paintSbList(); });
  $('#sbFind').addEventListener('blur', () => {
    if (!sbQuery) document.querySelector('.sb-tools')!.classList.remove('open');
  });
  $('#sbSort').addEventListener('click', () => {
    sbSortMode = sbSortMode === 'recent' ? 'name' : 'recent';
    $('#sbSort').firstChild!.textContent = sbSortMode === 'recent' ? '최근 순 ' : '이름순 ';
    paintSbList();
  });

  $('#connectApple').addEventListener('click', async () => {
    const kit = await initMusicKitIfConfigured();
    if (kit) { $('#connectApple').classList.add('connected'); renderTopbar(); }
    else $('#appleModal').classList.add('show');
  });
  $('#appleClose').addEventListener('click', () => $('#appleModal').classList.remove('show'));
  $('#appleDemoOk').addEventListener('click', () => {
    $('#appleModal').classList.remove('show');
    $('#connectApple').classList.add('connected');
    renderTopbar();
    toast('데모 모드: 30초 미리듣기로 재생됩니다');
  });

  let debounce: number;
  $('#searchInput').addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      const q = ($('#searchInput') as HTMLInputElement).value.trim();
      if (q.length >= 2) location.hash = `#/search?q=${encodeURIComponent(q)}`;
    }, 480);
  });

  initKeyboard({
    toggle: () => playerActions.toggle(),
    next: () => playerActions.next(),
    prev: () => playerActions.prev(),
    seek: (d) => playerActions.seek(d),
    queue: () => $('#btnQueue').click(),
    lyrics: () => $('#btnLyrics').click(),
    like: () => $('#btnLike').click(),
  });

  // 사이드바 재생 중 표시
  document.addEventListener('lilac:context', (e) => {
    const ctx = (e as CustomEvent<string>).detail;
    document.querySelectorAll<HTMLElement>('.sb-row[data-key]').forEach((el) =>
      el.classList.toggle('playing', !!ctx && el.dataset.key === ctx));
  });
  document.addEventListener('lilac:me', () => { renderTopbar(); void renderSidebar(); });

  /* 인증 필요 안내 — 한 곳에서 처리한다.
     호출부마다 try/catch 를 넣게 두면 반드시 빠뜨리는 데가 생긴다(실제로 그랬다). */
  let authToastAt = 0;
  document.addEventListener('lilac:auth-required', (e) => {
    const now = Date.now();
    if (now - authToastAt < 1500) return;   // 연쇄 401 로 토스트가 도배되지 않게
    authToastAt = now;
    if (publicPreview) { toast(PREVIEW_NOTICE); return; }
    const action = (e as CustomEvent<{ action?: string }>).detail?.action || '이 기능';
    toast(`${withParticle(action, '은는')} 로그인 후 이용할 수 있습니다`);
    // 이미 로그인 화면이면 굳이 옮기지 않는다
    if (!/^#\/(login|signup)/.test(location.hash)) {
      setTimeout(() => { if (!me) location.hash = '#/login'; }, 900);
    }
  });
  document.addEventListener('lilac:playlists', () => { void renderSidebar(); });
  window.addEventListener('hashchange', () => { navDepth++; route(); });

  applyMode();
  // 백엔드 연결 확인 (실패 시 재시도 안내 화면)
  try {
    configurePublicPreview(await probeDeploymentHealth());
  } catch {
    showBackendError();
    return;
  }
  await Promise.all([loadData(), refreshMe(), publicPreview ? Promise.resolve() : loadLikes()]);
  (await api('/api/db/artists').catch(() => [])).forEach((a: { name: string; searchTerm: string }) => ARTIST_TERMS.set(a.name, a.searchTerm));
  renderTopbar();
  await renderSidebar();
  await route();
  initFocusTrap();
  if (!publicPreview) maybeOnboard();
}

/* ---------- 백엔드 장애 화면 ---------- */
function showBackendError() {
  document.body.classList.remove('play-mode');
  $('#page').innerHTML = `
    <div class="fatal">
      <svg class="ic fatal-ic"><use href="#i-info"/></svg>
      <h2>서버에 연결할 수 없습니다</h2>
      <p>Lilac 백엔드가 응답하지 않습니다. 터미널에서 <code>npm run dev</code>로 서버를 실행한 뒤 다시 시도해 주세요.</p>
      <div class="fatal-actions">
        <button class="btn-pill" id="fatalRetry">다시 시도</button>
      </div>
      <p class="fatal-hint">재시도 중에도 계속 안 되면 프록시 포트(vite.config.ts)와 백엔드 포트가 같은지 확인해 주세요.</p>
    </div>`;
  $('#sbList').innerHTML = '';
  $('#fatalRetry').addEventListener('click', async () => {
    const btn = $('#fatalRetry') as HTMLButtonElement;
    btn.textContent = '확인 중…'; btn.disabled = true;
    try { await probeDeploymentHealth(); location.reload(); }
    catch { btn.textContent = '다시 시도'; btn.disabled = false; toast('아직 응답이 없습니다'); }
  });
}

loadAliases();

boot().catch((e) => { console.error(e); showBackendError(); });
