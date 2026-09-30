/* Lilac 앱 진입점 — 셸(헤더·에디션 전환·내비게이션·푸터) + 해시 라우터 */
import './app.css';
import './editorial.css';
import { state, setEdition, setLang, onChange, loadSession } from './state';
import type { Edition } from './state';
import { t, getLocale } from './i18n';
import { esc, icon, ago, toast, until, fmtTime } from './ui';
import { startLive, onLive, onLiveStatus, live, userBusy, relevance } from './live';
import type { LiveTopic } from './live';
import { initPlayer, markPlaying, localizePlayer } from './player';
import { openConcert } from './cards';
import { renderHome, leaveHome, refreshHome } from './pages/home';
import { renderFanclubPage } from './pages/fanclub';
import { renderFanclubProduct } from './pages/fcproduct';
import { renderGuide } from './pages/guide';
import { installFcTracking } from './fanclub';
import { renderConcerts } from './pages/concerts';
import { renderNews } from './pages/news';
import { renderGoods, renderRelease } from './pages/goods';
import { renderChart } from './pages/chart';
import { renderArtists, renderArtist } from './pages/artists';
import { renderSearch, renderMy, renderAuth } from './pages/misc';
import { renderCommunity } from './pages/community';
import { renderTrack, renderSharedConcert } from './pages/track';
import { ct } from './cm-i18n';
import { renderAbout } from './pages/about';
import { isSiteRoute, setSiteMode, SITE_TITLES } from '../site/routes';
import { loadAliases } from '../koja';

type SiteModule = typeof import('../site');
let sitePromise: Promise<SiteModule> | null = null;
const loadSite = () => (sitePromise ??= import('../site'));

const NAV = [
  { r: 'home', href: '#/', k: 'nav.home', ic: 'i-home' },
  { r: 'concerts', href: '#/concerts', k: 'nav.concerts', ic: 'i-ticket' },
  { r: 'fanclub', href: '#/fanclub', k: 'nav.fanclub', ic: 'i-heart' },
  { r: 'community', href: '#/community', k: 'cm.nav', ic: 'i-users' },
  { r: 'news', href: '#/news', k: 'nav.news', ic: 'i-news' },
  { r: 'goods', href: '#/goods', k: 'nav.goods', ic: 'i-bag' },
  { r: 'chart', href: '#/chart', k: 'nav.chart', ic: 'i-chart' },
  { r: 'artists', href: '#/artists', k: 'nav.artists', ic: 'i-mic' },
];
const MOBILE_NAV = ['home', 'concerts', 'community', 'fanclub', 'my'];
const navLabel = (k: string) => (k === 'cm.nav' ? ct('nav') : t(k));

const $ = (id: string) => document.getElementById(id)!;

function renderShell() {
  const skip = document.querySelector('.skip-link');
  if (skip) skip.textContent = getLocale() === 'ja' ? '本文へスキップ' : '본문으로 건너뛰기';
  $('mnav').setAttribute('aria-label', getLocale() === 'ja' ? 'メニュー' : '메뉴');
  localizePlayer();
  const ed = state.edition;
  const eds: Edition[] = ['kr', 'jp', 'all'];
  const menuWasOpen = !!document.querySelector('.ed-menu:not([hidden])');
  /* 한 줄 헤더(Weverse·음악 앱): 로고 · 주 메뉴 · 검색 · 나라 선택 · 언어 · 로그인. 나라(에디션)는 메뉴로 고른다 */
  $('hdr').innerHTML = `
    <div class="hdr-in">
      <a class="logo" href="#/" aria-label="Lilac">Lilac</a>
      <nav class="gnb" aria-label="${getLocale() === 'ja' ? 'メインメニュー' : '주 메뉴'}">
        ${NAV.filter((n) => n.r !== 'home').map((n) => `<a href="${n.href}" data-r="${n.r}">${navLabel(n.k)}</a>`).join('')}
      </nav>
      <form class="header-search" role="search"><label class="sr-only" for="headerQuery">${t('search.go')}</label>${icon('i-search')}<input id="headerQuery" name="q" type="search" maxlength="160" placeholder="${getLocale() === 'ja' ? 'アーティスト・公演を検索' : '아티스트·공연 검색'}" autocomplete="off"><button type="submit" aria-label="${t('search.go')}">${icon('i-chev-r', 'ic sm')}</button></form>
      <div class="hdr-tools">
        <a class="hdr-ic m-search" href="#/search" aria-label="${t('search.go')}">${icon('i-search')}</a>
        <div class="edp">
          <button type="button" class="ed-btn" id="edBtn" aria-haspopup="true" aria-expanded="false" aria-controls="edMenu" title="${esc(t('ed.label'))}">${icon('i-globe', 'ic sm')}<span>${esc(t(`ed.short.${ed}`))}</span></button>
          <div class="ed-menu" id="edMenu" hidden>
            <p class="ed-menu-h">${esc(t('ed.menu'))}</p>
            <div class="ed-links" role="radiogroup" aria-label="${t('ed.label')}">
              ${eds.map((e) => `<button type="button" role="radio" aria-checked="${e === ed}" data-ed="${e}" tabindex="${e === ed ? 0 : -1}"><b>${esc(t(`ed.${e}`))}</b><span>${esc(t(`ed.${e}.desc`))}</span></button>`).join('')}
            </div>
            <div class="ed-lang"><span>${esc(t('lang'))}</span><button type="button" id="langBtn" data-lang="ko" aria-pressed="${getLocale() === 'ko'}">한국어</button><button type="button" data-lang="ja" aria-pressed="${getLocale() === 'ja'}">日本語</button></div>
          </div>
        </div>
        ${state.me ? `<a class="hdr-me" href="#/my" aria-label="${t('nav.my')}"><span>${esc((state.me.name || '?').slice(0, 1))}</span></a>` : `<a class="hdr-login" href="#/login">${t('nav.login')}</a>`}
      </div>
    </div>
    <nav class="gnb-m" aria-label="${getLocale() === 'ja' ? 'メニュー' : '메뉴'}"><div class="gnb-m-in">${NAV.map((n) => `<a href="${n.href}" data-r="${n.r}">${navLabel(n.k)}</a>`).join('')}</div></nav>`;
  $('mnav').innerHTML = MOBILE_NAV.map((r) => {
    const n = NAV.find((x) => x.r === r) || { r: 'my', href: '#/my', k: 'nav.my', ic: 'i-user' };
    return `<a href="${n.href}" data-r="${n.r}">${icon(n.ic)}<span>${navLabel(n.k)}</span></a>`;
  }).join('');
  $('ftr').innerHTML = `<div class="ftr-in">
      <div class="ftr-brand"><b>Lilac</b><p>${t('foot.note')}</p></div>
      <nav class="ftr-links">
        <a href="#/guide">${t('nav.guide')}</a><a href="#/about">${t('foot.about')}</a><a href="#/faq">${t('foot.faq')}</a><a href="#/terms">${t('foot.terms')}</a>
        <a href="#/privacy">${t('foot.privacy')}</a><a href="#/contact">${t('foot.contact')}</a><a href="#/status">${t('foot.status')}</a>
      </nav>
    </div>`;

  const headerSearch = document.querySelector<HTMLFormElement>('.header-search');
  headerSearch?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = (headerSearch.querySelector('input') as HTMLInputElement).value.trim();
    location.hash = q ? `#/search?q=${encodeURIComponent(q)}` : '#/search';
  });
  const btn = $('edBtn') as HTMLButtonElement;
  const menu = $('edMenu');
  const openMenu = (on: boolean, focus = false) => {
    menu.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
    if (on && focus) menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  };
  btn.addEventListener('click', () => openMenu(menu.hidden, true));
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { openMenu(false); btn.focus(); } });
  menu.querySelectorAll<HTMLButtonElement>('[data-ed]').forEach((b) => {
    b.addEventListener('click', () => { openMenu(false); setEdition(b.dataset.ed as Edition); });
    b.addEventListener('keydown', (e) => {
      const order: Edition[] = ['kr', 'jp', 'all'];
      const i = order.indexOf(b.dataset.ed as Edition);
      const move = (k: number) => menu.querySelector<HTMLButtonElement>(`[data-ed="${order[k]}"]`)?.focus();
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move((i + 1) % 3); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move((i + 2) % 3); }
    });
  });
  if (menuWasOpen) openMenu(true, true);
  menu.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => b.addEventListener('click', () => { openMenu(false); setLang(b.dataset.lang as 'ko' | 'ja'); }));
  paintLive();
  markNav();
}

/* 실시간 표시: 연결 상태 + 마지막으로 바뀐 시각 */
function paintLive() {
  const el = document.getElementById('livePill');
  if (!el) return;
  const at = live.lastAt ? new Date(live.lastAt).toISOString() : null;
  el.className = `live-pill${live.connected ? ' is-on' : ''}`;
  el.innerHTML = live.connected
    ? `<i aria-hidden="true"></i><b>${esc(t('live.on'))}</b>${at ? `<span>${esc(t('live.upd', { t: ago(at) }))}</span>` : ''}`
    : `<i aria-hidden="true"></i><b>${esc(t('live.off'))}</b>`;
}

function seg() {
  return (location.hash.replace(/^#\/?/, '').split('?')[0] || '').split('/').map((part) => { try { return decodeURIComponent(part); } catch { return part; } });
}

function markNav() {
  const s = seg()[0] || 'home';
  const map: Record<string, string> = { release: 'goods', artist: 'artists', search: '', login: 'my', signup: 'my', guide: '', track: 'chart', e: 'concerts' };
  const cur = map[s] ?? s;
  document.querySelectorAll<HTMLAnchorElement>('.gnb a, .gnb-m a, #mnav a').forEach((a) => {
    const on = a.dataset.r === cur;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

const LEGACY: Record<string, string> = {
  store: '#/goods', releases: '#/goods', schedule: '#/concerts', library: '#/my', playlist: '#/my',
  account: '#/my', orders: '#/my', work: '#/', focus: '#/', help: '#/faq',
};

let gen = 0;
async function route() {
  const my = ++gen;
  const alive = () => my === gen;
  const [s, a, b] = seg();
  const root = $('page');

  /* 서비스 소개·FAQ는 앱 안의 도움말 문서로 (예전 마케팅 랜딩 대신) */
  if (s === 'about' || s === 'faq') {
    if (document.body.classList.contains('site-mode')) { (await loadSite()).leaveSite(); setSiteMode(false); }
    leaveHome();
    root.classList.remove('is-home');
    markNav();
    window.scrollTo({ top: 0 });
    renderAbout(root, s);
    document.title = `${s === 'faq' ? (getLocale() === 'ja' ? 'よくある質問' : '자주 묻는 질문') : getLocale() === 'ja' ? 'サービス紹介' : '서비스 소개'} · Lilac`;
    return;
  }
  if (s && isSiteRoute(s)) {
    const site = await loadSite();
    if (!alive()) return;
    setSiteMode(true);
    if (a) site.renderSiteNotFound(location.hash.slice(1));
    else site.renderSitePage(s);
    document.title = `${SITE_TITLES[s]} · Lilac`;
    return;
  }
  if (document.body.classList.contains('site-mode')) {
    (await loadSite()).leaveSite();
    setSiteMode(false);
  }
  if (s && LEGACY[s]) { location.replace(LEGACY[s]); return; }

  leaveHome();
  root.classList.toggle("is-home", !s);
  markNav();
  window.scrollTo({ top: 0 });
  root.classList.remove('is-ready');
  const titles: Record<string, string> = { '': t('nav.home'), concerts: t('nav.concerts'), news: t('nav.news'), fanclub: t('nav.fanclub'), guide: t('nav.guide'), goods: t('nav.goods'), chart: t('nav.chart'), artists: t('nav.artists'), artist: t('nav.artists'), my: t('nav.my'), login: t('auth.login'), signup: t('auth.signup'), search: t('search.go'), release: t('g.compare'), status: t('foot.status') };
  document.title = `${titles[s || ''] || 'Lilac'} · Lilac`;
  await renderInto(root, alive, s, a, b);
  if (alive()) { root.classList.add('is-ready'); markPlaying(); }
}

/* 경로 하나를 root에 그린다 — 보통 이동과 실시간 반영(화면 밖 그릇에 그린 뒤 바꿔 끼우기)이 같이 쓴다 */
async function renderInto(root: HTMLElement, alive: () => boolean, s: string, a: string, b: string) {
  try {
    switch (s || '') {
      case '': await renderHome(root, alive); break;
      case 'concerts': await renderConcerts(root, alive, a); break;
      case 'news': await renderNews(root, alive); break;
      case 'community': await renderCommunity(root, alive, a, b); break;
      case 'track': await renderTrack(root, alive, a); break;
      case 'e': await renderSharedConcert(root, alive, a); break;
      case 'fanclub': if (a) await renderFanclubProduct(root, alive, a); else await renderFanclubPage(root, alive); break;
      case 'guide': await renderGuide(root, a, b, alive); break;
      case 'goods': await renderGoods(root, alive); break;
      case 'release': await renderRelease(root, alive, a); break;
      case 'chart': await renderChart(root, alive, a, b); break;
      case 'artists': await renderArtists(root, alive); break;
      case 'artist':
        if (a === 'name' && b) await renderArtist(root, alive, { name: b });
        else await renderArtist(root, alive, { id: a });
        break;
      case 'search': await renderSearch(root, alive); break;
      case 'my': await renderMy(root, alive); break;
      case 'login': renderAuth(root, 'login'); break;
      case 'signup': renderAuth(root, 'signup'); break;
      case 'status': await renderStatus(root, alive); break;
      default:
        root.innerHTML = `<section class="page-head"><h1>404</h1><p class="lede">${esc(location.hash)}</p><a class="btn btn-solid" href="#/">${t('nav.home')}</a></section>`;
    }
  } catch (e) {
    console.error(e);
    if (alive()) root.innerHTML = `<div class="empty is-error"><p>${t('err.generic')}</p><button class="btn btn-line" onclick="location.reload()">${t('retry')}</button></div>`;
  }
}

/* 실시간 반영: 지금 보고 있는 화면과 관련된 주제가 바뀌면, 조작이 멈췄을 때 조용히 다시 그린다.
   화면 밖 그릇에 먼저 그려서(뼈대 깜빡임 없이) 통째로 바꿔 끼우고, 스크롤 위치는 그대로 둔다. */
const ROUTE_TOPICS: Record<string, LiveTopic[]> = {
  '': ['concerts', 'tickets', 'news', 'fanclubs', 'charts', 'community'],
  concerts: ['concerts', 'tickets', 'fanclubs'],
  news: ['news'],
  community: ['community'],
  fanclub: ['fanclubs', 'fx'],
  goods: ['goods', 'fx'],
  release: ['goods', 'fx'],
  chart: ['charts'],
  artists: ['charts'],
  artist: ['concerts', 'news', 'fanclubs', 'charts', 'community', 'goods'],
  status: ['concerts', 'tickets', 'news', 'fanclubs'],
};
let pendingLive: { topics: Set<LiveTopic>; added: number } | null = null;
let liveTimer: ReturnType<typeof setTimeout> | undefined;
function queueLive(topic: LiveTopic, added: number) {
  const [s, a, b] = seg();
  if (!(ROUTE_TOPICS[s || ''] || []).includes(topic)) return;
  if (s === 'community' && (a === 'write' || b === 'write')) return;
  pendingLive ??= { topics: new Set(), added: 0 };
  pendingLive.topics.add(topic);
  pendingLive.added += added || 0;
  tryApplyLive();
}
function tryApplyLive() {
  clearTimeout(liveTimer);
  if (!pendingLive) return;
  if (userBusy() || document.body.classList.contains('sheet-open') || document.body.classList.contains('site-mode')) { liveTimer = setTimeout(tryApplyLive, 3000); return; }
  const p = pendingLive;
  pendingLive = null;
  void softRoute().then((ok) => { if (ok && p.added > 0) toast(t('live.applied.n', { n: p.added })); });
}
/* Preserve only local read-only controls. Never replay submits, likes, or external actions. */
function captureLocalView(root: HTMLElement) {
  const inputs = ['fcQuery', 'cFind'].map((id) => ({ id, value: root.querySelector<HTMLInputElement>(`#${id}`)?.value })).filter((x) => x.value != null);
  const choices = ['data-f', 'data-month', 'data-kind', 'data-side', 'data-i'].map((attr) => {
    const el = root.querySelector<HTMLElement>(`[${attr}].on, [${attr}][aria-checked="true"]`);
    return { attr, value: el?.getAttribute(attr), label: attr === 'data-i' ? el?.querySelector('b')?.textContent : null };
  }).filter((x) => x.value != null);
  return (next: HTMLElement) => {
    for (const choice of choices) {
      const el = Array.from(next.querySelectorAll<HTMLButtonElement>(`[${choice.attr}]`)).find((x) => x.getAttribute(choice.attr) === choice.value && (!choice.label || x.querySelector('b')?.textContent === choice.label));
      if (el && !el.disabled) el.click();
    }
    for (const input of inputs) {
      const el = next.querySelector<HTMLInputElement>(`#${input.id}`);
      if (el) { el.value = input.value!; el.dispatchEvent(new Event('input', { bubbles: true })); }
    }
  };
}
let softGen = 0;
async function softRoute(): Promise<boolean> {
  let my = gen;
  const refresh = ++softGen;
  let discarded = false;
  const alive = () => !discarded && my === gen && refresh === softGen;
  const [s, a, b] = seg();
  const root = $('page');
  if (!s) { await refreshHome(root, alive); return alive(); }
  const restoreLocalView = captureLocalView(root);
  const box = document.createElement('div');
  box.className = 'live-view';
  try { await renderInto(box, alive, s, a, b); } catch { discarded = true; return false; }
  if (!alive() || userBusy()) { discarded = true; return false; }
  restoreLocalView(box);
  const y = window.scrollY;
  // Keep the renderer's root intact: listeners and delayed callbacks close over it.
  // Invalidate callbacks belonging to the replaced view only after the new one is ready.
  my = ++gen;
  root.replaceChildren(box);
  window.scrollTo({ top: y });
  markPlaying();
  return true;
}

/* 데이터 상태 — 사용자에게 보이는 페이지라 내부 키·ISO 시각·영문 상태를 그대로 내지 않는다 */
const ST_KEY: Record<string, [string, string]> = {
  'kr-visiting': ['내한 공연', '来韓公演'], 'kr-opens': ['티켓 오픈(한국)', 'チケット発売(韓国)'], 'kr-domestic': ['국내 공연', '韓国国内公演'],
  'jp-kpop': ['일본 K-POP 공연', '日本のK-POP公演'], 'news-kr': ['뉴스(한국)', 'ニュース(韓国)'], 'news-jp': ['뉴스(일본)', 'ニュース(日本)'],
  festivals: ['페스티벌', 'フェス'], news: ['뉴스', 'ニュース'], 'fanclub-windows': ['팬클럽 선행 접수', 'FC先行受付'], goods: ['앨범·굿즈 가격', 'CD・グッズ価格'],
  'roster-identity': ['아티스트 정보 보정', 'アーティスト情報の補正'], photos: ['아티스트 사진', 'アーティスト写真'],
};
const ST_PROV: Record<string, [string, string]> = {
  nol: ['NOL 티켓', 'NOLチケット'], melon: ['멜론티켓', 'メロンチケット'], yes24: ['YES24 티켓', 'YES24チケット'], ticketlink: ['티켓링크', 'チケットリンク'],
  eplus: ['e+', 'イープラス'], pia: ['티켓피아', 'チケットぴあ'], ltike: ['로치케', 'ローチケ'], 'google-news': ['Google 뉴스', 'Googleニュース'],
};
const ST_KIND: Record<string, [string, string]> = {
  concert: ['콘서트', 'コンサート'], fanmeeting: ['팬미팅', 'ファンミ'], visiting: ['내한', '来韓'], open: ['티켓 오픈', '発売'], 'open-fan': ['팬미팅 오픈', 'ファンミ発売'],
  overseas: ['해외 아티스트', '海外アーティスト'], 'k-pop': ['K-POP', 'K-POP'], festival: ['페스티벌', 'フェス'],
};
async function renderStatus(root: HTMLElement, alive: () => boolean) {
  const ja = getLocale() === 'ja';
  const L = (m: Record<string, [string, string]>, k: string) => m[k]?.[ja ? 1 : 0] || k;
  const provName = (p: string) => { const [a, ...rest] = p.split(':'); const b = rest.join(':').replace(/"/g, '').replace(/\s+OR\s+/g, ', ').trim(); return [L(ST_PROV, a), b ? L(ST_KIND, b) : ''].filter(Boolean).join(' · '); };
  const stateName = (st: string, err?: string) => (err ? (ja ? '更新失敗(前回の値を表示)' : '갱신 실패(이전 값 표시 중)') : st === 'fresh' ? (ja ? '正常' : '정상') : st === 'pending' ? (ja ? '収集中' : '수집 중') : st === 'stale' ? (ja ? '更新待ち' : '갱신 대기') : st);
  const every = (sec: number) => (sec >= 3600 ? (ja ? `${Math.round(sec / 3600)}時間` : `${Math.round(sec / 3600)}시간`) : ja ? `${Math.round(sec / 60)}分` : `${Math.round(sec / 60)}분`);
  const n = (v: number) => (ja ? `${v.toLocaleString('ja-JP')}件` : `${v.toLocaleString('ko-KR')}건`);
  root.innerHTML = `<section class="page-head"><h1>${t('foot.status')}</h1></section><div class="sk sk-block"></div>`;
  const [r, refs] = await Promise.all([
    fetch('/api/live/status').then((x) => x.json()).catch(() => null),
    fetch('/api/live/fc-referrals').then((x) => x.json()).catch(() => ({ items: [] })),
  ]);
  if (!alive()) return;
  if (!r) { root.innerHTML += `<p>${t('err.generic')}</p>`; return; }
  const H = ja ? ['データ', '件数', '最終更新', 'ソース別'] : ['데이터', '건수', '마지막 갱신', '출처별'];
  const J = ja ? ['処理', '周期', '前回', '次回', '回数', 'エラー'] : ['작업', '주기', '마지막 실행', '다음 실행', '실행 횟수', '오류'];
  root.innerHTML = `<section class="page-head"><h1>${t('foot.status')}</h1></section>
    <div class="table-wrap"><table class="tbl"><thead><tr>${H.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>
    ${Object.entries(r.sources as Record<string, { count: number; cache: { updatedAt: string; state: string; lastError?: string }; sources: { provider: string; ok: boolean; count: number; error?: string }[] }>).map(([k, v]) => `<tr><td>${esc(L(ST_KEY, k))}</td><td>${n(v.count || 0)}</td><td>${v.cache?.updatedAt ? esc(ago(v.cache.updatedAt)) : '-'} · ${esc(stateName(v.cache?.state || '', v.cache?.lastError))}</td><td>${(v.sources || []).map((s) => `${esc(provName(s.provider))} ${s.ok ? n(s.count || 0) : `<span class="bad">${ja ? '失敗' : '실패'}</span>`}`).join('<br>')}</td></tr>`).join('')}
    </tbody></table></div><p class="method">${ja ? `国籍判定キャッシュ ${r.originCache}件 · 判定待ち ${r.classifyQueue}件` : `국적 판정 저장 ${r.originCache}건 · 판정 대기 ${r.classifyQueue}건`}</p>
    ${r.realtime ? `<h2 class="day-h">${ja ? 'リアルタイム同期' : '실시간 동기화'}</h2><p class="method">${ja ? `接続中の画面 ${r.realtime.clients}` : `연결된 화면 ${r.realtime.clients}개`}</p>
    <div class="table-wrap"><table class="tbl"><thead><tr>${J.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>
    ${Object.entries(r.realtime.jobs as Record<string, { every: number; lastAt: string | null; next: string | null; runs: number; lastError: string | null; lastMs: number | null }>).map(([k, v]) => `<tr><td>${esc(L(ST_KEY, k))}</td><td>${every(v.every)}</td><td>${v.lastAt ? esc(ago(v.lastAt)) : '-'}${v.lastMs != null ? ` · ${(v.lastMs / 1000).toFixed(1)}${ja ? '秒' : '초'}` : ''}</td><td>${v.next ? esc(fmtTime(v.next)) : '-'}</td><td>${v.runs}</td><td>${v.lastError ? `<span class="bad">${ja ? '失敗' : '실패'}</span>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : ''}
    <h2 class="day-h">${t('st.fcRefs')}</h2><p class="method">${t('st.fcRefs.sub')}</p>
    ${(refs.items || []).length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>${ja ? 'アーティスト' : '아티스트'}</th><th>${t('st.fcJoin')}</th><th>${t('st.fcSale')}</th><th>${ja ? '直近7日' : '최근 7일'}</th></tr></thead><tbody>${(refs.items as { artistId: string; join: number; sale: number; byDay: Record<string, number> }[]).map((x) => { const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10); const d7 = Object.entries(x.byDay || {}).filter(([d]) => d >= since).reduce((m, [, v]) => m + v, 0); return `<tr><td>${esc(x.artistId)}</td><td>${x.join}</td><td>${x.sale}</td><td>${d7}</td></tr>`; }).join('')}</tbody></table></div>` : `<p class="note">${t('empty.generic')}</p>`}`;
}

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  /* 나라(에디션) 메뉴: 바깥을 누르면 닫는다 */
  const edMenu = document.getElementById('edMenu');
  if (edMenu && !edMenu.hidden && !target.closest('.edp')) { edMenu.hidden = true; document.getElementById('edBtn')?.setAttribute('aria-expanded', 'false'); }
  const el = target.closest<HTMLElement>('[data-open-concert]');
  if (el) { e.preventDefault(); openConcert(el.dataset.openConcert!); return; }
  // 모바일: 행 어디를 눌러도 상세 시트 (외부 링크 버튼은 숨김)
  const row = target.closest<HTMLElement>('[data-row-concert]');
  if (row && !target.closest('a') && window.matchMedia('(max-width: 760px)').matches) openConcert(row.dataset.rowConcert!);
});

onChange((w) => {
  if (w === 'edition' || w === 'locale') { renderShell(); route(); }
  if (w === 'auth') { renderShell(); if (['my', 'login', 'signup'].includes(seg()[0] || '')) route(); }
});

async function boot() {
  initPlayer();
  /* 고정 헤더의 실제 높이 — 상세 탭·앵커 스크롤이 헤더 밑에 가려지지 않게 */
  const hdrEl = document.querySelector<HTMLElement>('.hdr');
  if (hdrEl && 'ResizeObserver' in window) new ResizeObserver(() => document.documentElement.style.setProperty('--hdr-total', `${Math.round(hdrEl.getBoundingClientRect().height)}px`)).observe(hdrEl);
  document.querySelector('.skip-link')?.addEventListener('click', (e) => { e.preventDefault(); $('page').focus(); $('page').scrollIntoView({ block: 'start' }); });
  installFcTracking();
  renderShell();
  loadAliases().catch(() => {});
  window.addEventListener('hashchange', () => { pendingLive = null; void route(); });
  route();
  startLive();
  onLiveStatus(paintLive);
  onLive((u) => { const r = relevance(u, state.edition); if (r.hit) queueLive(u.topic, r.added); });
  setInterval(paintLive, 30000);
  /* 남은 시간("오픈 3시간 전")은 다시 그리지 않고 글자만 30초마다 고친다. 시각이 지나면 그 목록을 새로 그린다 */
  setInterval(() => {
    let passed = false;
    document.querySelectorAll<HTMLElement>('[data-until]').forEach((el) => {
      const at = el.dataset.until!;
      if (Date.parse(at) <= Date.now()) passed = true;
      el.textContent = t(el.dataset.untilK || 'c.soon', { t: until(at) });
    });
    if (passed) queueLive('tickets', 0);
  }, 30000);
  await loadSession().catch(() => {});
}
boot();
