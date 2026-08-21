import './style.css';
import { me, refreshMe } from './api';
import { initPlayer, loadLikes, toast } from './player';
import { t, setLocale, getLocale, LOCALES } from './i18n';
import type { Locale } from './i18n';
import { loadData, pageHome, pageChart, pageStore, pageProduct, pageSchedule, pageArtist, pageLibrary, pagePlaylist, pageLogin, pageSignup, pageAccount, pageSearch, page404 } from './pages';
import { initMusicKitIfConfigured } from './musickit';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

/* ---------- GNB 렌더 ---------- */
function renderGnb() {
  $('#gnbMenu').innerHTML = `
    <a href="#/" class="gnb-item" data-r="home">${t('nav.home')}</a>
    <a href="#/chart" class="gnb-item" data-r="chart">${t('nav.chart')}</a>
    <a href="#/store" class="gnb-item" data-r="store">${t('nav.store')}</a>
    <a href="#/schedule" class="gnb-item" data-r="schedule">${t('nav.schedule')}</a>
    <a href="#/library" class="gnb-item" data-r="library">${t('nav.library')}</a>`;
  ($('#searchInput') as HTMLInputElement).placeholder = t('search.ph');
  $('#connectApple').textContent = $('#connectApple').classList.contains('connected') ? t('connected') : t('connect');
  const acct = $('#gnbAcct');
  if (me) {
    acct.innerHTML = `<a class="gnb-user" href="#/account" title="${t('account')}"><span class="gnb-avatar">${me.name[0]}</span><span class="gnb-credits">${me.credits.toLocaleString()}C</span></a>`;
  } else {
    acct.innerHTML = `<a class="gnb-item" href="#/login">${t('login')}</a><a class="gnb-signup" href="#/signup">${t('signup')}</a>`;
  }
  markActive();
}
function markActive() {
  const r = (location.hash.split('/')[1] || 'home').split('?')[0] || 'home';
  document.querySelectorAll('[data-r]').forEach((el) =>
    el.classList.toggle('on', (el as HTMLElement).dataset.r === r));
}

/* ---------- 지구본 언어 메뉴 ---------- */
function initGlobe() {
  const menu = $('#localeMenu');
  menu.innerHTML = LOCALES.map((l) => `<button data-l="${l.id}" class="${l.id === getLocale() ? 'on' : ''}">${l.label}</button>`).join('');
  $('#btnGlobe').addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('show'); });
  document.addEventListener('click', () => menu.classList.remove('show'));
  menu.querySelectorAll<HTMLButtonElement>('button').forEach((btn) =>
    btn.addEventListener('click', async () => {
      setLocale(btn.dataset.l as Locale);
      menu.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
      menu.classList.remove('show');
      if (me) await fetch('/api/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language: btn.dataset.l }) }).catch(() => {});
      renderGnb();
      route();
    }));
}

/* ---------- 라우터 ---------- */
async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [seg, sub] = hash.split('?')[0].split('/');
  const qs = new URLSearchParams(hash.split('?')[1] || '');
  window.scrollTo({ top: 0 });
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
}

/* ---------- 부트 ---------- */
async function boot() {
  initPlayer();
  initGlobe();

  $('#connectApple').addEventListener('click', async () => {
    const kit = await initMusicKitIfConfigured();
    if (kit) { $('#connectApple').classList.add('connected'); renderGnb(); }
    else $('#appleModal').classList.add('show');
  });
  $('#appleClose').addEventListener('click', () => $('#appleModal').classList.remove('show'));
  $('#appleDemoOk').addEventListener('click', () => {
    $('#appleModal').classList.remove('show');
    $('#connectApple').classList.add('connected');
    renderGnb();
    toast('데모 모드: 30초 미리듣기로 재생됩니다');
  });

  let debounce: number;
  $('#searchInput').addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      const q = ($('#searchInput') as HTMLInputElement).value.trim();
      if (q.length >= 2) location.hash = `#/search?q=${encodeURIComponent(q)}`;
    }, 500);
  });

  // GNB 스크롤 반응 (상단에서는 투명, 내리면 불투명)
  const onScroll = () => document.querySelector('.gnb')!.classList.toggle('scrolled', window.scrollY > 10);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  document.addEventListener('lilac:me', renderGnb);
  window.addEventListener('hashchange', () => { route().then(onScroll); });

  await Promise.all([loadData(), refreshMe(), loadLikes()]);
  renderGnb();
  await route();
}

boot().catch((e) => { console.error(e); toast('백엔드 연결 실패 — npm run dev로 실행해 주세요'); });
