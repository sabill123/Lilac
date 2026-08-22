import './style.css';
import { api, me, refreshMe, esc, icon } from './api';
import { initPlayer, loadLikes, toast, playerActions } from './player';
import { t, setLocale, getLocale, LOCALES } from './i18n';
import type { Locale } from './i18n';
import { loadData, pageHome, pageChart, pageStore, pageProduct, pageSchedule, pageArtist, pageLibrary, pagePlaylist, pageLogin, pageSignup, pageAccount, pageSearch, page404 } from './pages';
import { initMusicKitIfConfigured } from './musickit';
import { initRipple, initKeyboard, initContextMenu, bindParallax, bindReveal, bindTilt, bindHoverExpand } from './interactions';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const NAV = [
  { r: 'home', href: '#/', k: 'nav.home', ic: 'i-home' },
  { r: 'chart', href: '#/chart', k: 'nav.chart', ic: 'i-chart' },
  { r: 'store', href: '#/store', k: 'nav.store', ic: 'i-bag' },
  { r: 'schedule', href: '#/schedule', k: 'nav.schedule', ic: 'i-cal' },
];

/* ---------- 사이드바 ---------- */
async function renderSidebar() {
  $('#sbNav').innerHTML = NAV.map((n) =>
    `<a class="sb-item" data-r="${n.r}" href="${n.href}"><svg class="ic"><use href="#${n.ic}"/></svg><span>${t(n.k)}</span></a>`).join('');
  $('#sbLibLabel').textContent = t('nav.library');
  $('#sbChips').innerHTML = `
    <a class="sb-chip" data-r="library" href="#/library/playlists">${t('lib.playlists')}</a>
    <a class="sb-chip" href="#/library/likes">${t('lib.likes')}</a>
    <a class="sb-chip" href="#/library/follows">${t('lib.follows')}</a>`;
  const [lists, likes] = await Promise.all([api('/api/playlists').catch(() => []), api('/api/likes').catch(() => [])]);
  $('#sbList').innerHTML = `
    <a class="sb-row" href="#/library/likes">
      <span class="sb-cover liked">${icon('i-heart-f', 'ic s')}</span>
      <span class="sb-meta"><b>${t('lib.likes')}</b><i>플레이리스트 · ${likes.length}곡</i></span></a>
    ${lists.map((p: { id: string; name: string; tracks: { artwork?: string }[] }) => `
      <a class="sb-row" href="#/playlist/${p.id}" data-pl="${p.id}">
        <span class="sb-cover" style="background-image:url(${esc(p.tracks[0]?.artwork || '')})">${p.tracks[0]?.artwork ? '' : icon('i-queue', 'ic s')}</span>
        <span class="sb-meta"><b>${esc(p.name)}</b><i>플레이리스트 · ${p.tracks.length}곡</i></span></a>`).join('')}`;
  markActive();
}

/* ---------- 모드 (브라우즈 / 플레이) ---------- */
type Mode = 'browse' | 'play';
const PLAY_ROUTES = new Set(['library', 'playlist']);
const BROWSE_ONLY = new Set(['login', 'signup', 'account']); // 계정 화면은 항상 브라우즈
const LIGHT_ROUTES = new Set(['store']);                      // 화이트 배경 페이지
let userMode: Mode = (localStorage.getItem('lilac.mode') as Mode) || 'browse';
function currentSeg() { return (location.hash.split('/')[1] || 'home').split('?')[0] || 'home'; }
function applyMode() {
  const seg = currentSeg();
  const mode: Mode = BROWSE_ONLY.has(seg) ? 'browse' : PLAY_ROUTES.has(seg) ? 'play' : userMode;
  document.body.classList.toggle('play-mode', mode === 'play');
  document.body.classList.toggle('light-page', LIGHT_ROUTES.has(seg));
  $('#btnMode').classList.toggle('on', mode === 'play');
  $('#btnMode').title = mode === 'play' ? '브라우즈 모드로' : '플레이 모드로';
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
  ($('#searchInput') as HTMLInputElement).placeholder = t('search.ph');
  $('#connectApple').textContent = $('#connectApple').classList.contains('connected') ? t('connected') : t('connect');
  const acct = $('#gnbAcct');
  acct.innerHTML = me
    ? `<a class="tb-user" href="#/account" title="${t('account')}"><span class="tb-avatar">${esc(me.name[0])}</span><span class="tb-credits">${me.credits.toLocaleString()}C</span></a>`
    : `<a class="tb-link" href="#/login">${t('login')}</a><a class="tb-signup" href="#/signup">${t('signup')}</a>`;
  $('#mnav').innerHTML = [...NAV, { r: 'library', href: '#/library', k: 'nav.library', ic: 'i-lib' }]
    .map((n) => `<a data-r="${n.r}" href="${n.href}"><svg class="ic"><use href="#${n.ic}"/></svg><span>${t(n.k)}</span></a>`).join('');
  markActive();
}
function markActive() {
  const r = (location.hash.split('/')[1] || 'home').split('?')[0] || 'home';
  document.querySelectorAll('[data-r]').forEach((el) =>
    el.classList.toggle('on', (el as HTMLElement).dataset.r === r));
  document.querySelectorAll<HTMLElement>('.sb-row[data-pl]').forEach((el) =>
    el.classList.toggle('on', location.hash === `#/playlist/${el.dataset.pl}`));
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

/* ---------- 라우터 ---------- */
let navDepth = 0;
async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [seg, sub] = hash.split('?')[0].split('/');
  const qs = new URLSearchParams(hash.split('?')[1] || '');
  const panel = $('#mainPanel');
  panel.scrollTo({ top: 0 });
  applyMode();
  markActive();
  try {
    switch (seg || 'home') {
      case 'home': await pageHome(); break;
      case 'chart': await pageChart(sub); break;
      case 'store': sub ? await pageProduct(sub) : await pageStore(); break;
      case 'schedule': await pageSchedule(); break;
      case 'artist': await pageArtist(sub); break;
      case 'library': await pageLibrary(sub); break;
      case 'playlist': await pagePlaylist(sub); break;
      case 'login': pageLogin(); break;
      case 'signup': pageSignup(); break;
      case 'account': await pageAccount(); break;
      case 'search': await pageSearch(qs.get('q') || ''); break;
      default: page404();
    }
  } catch (e) { console.error(e); page404(); }
  // 페이지 렌더 후 인터랙션 바인딩
  bindTilt(panel); bindHoverExpand(panel); bindReveal(panel, panel);
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
  initRipple();
  initContextMenu();
  const panel = $('#mainPanel');
  panel.addEventListener('scroll', onScroll, { passive: true });
  bindParallax(panel);

  // 히스토리 네비게이션
  $('#navBack').addEventListener('click', () => history.back());
  $('#navFwd').addEventListener('click', () => history.forward());
  $('#btnMode').addEventListener('click', toggleMode);

  $('#sbAdd').addEventListener('click', async () => {
    const name = prompt(t('lib.newPlaylist'), 'My Mix');
    if (!name) return;
    const pl = await api('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) });
    await renderSidebar();
    location.hash = `#/playlist/${pl.id}`;
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

  document.addEventListener('lilac:me', () => { renderTopbar(); void renderSidebar(); });
  document.addEventListener('lilac:playlists', () => { void renderSidebar(); });
  window.addEventListener('hashchange', () => { navDepth++; route(); });

  applyMode();
  await Promise.all([loadData(), refreshMe(), loadLikes()]);
  renderTopbar();
  await renderSidebar();
  await route();
}

boot().catch((e) => { console.error(e); toast('백엔드 연결 실패 — npm run dev로 실행해 주세요'); });
