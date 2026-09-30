/* 공연·티켓 — 티켓링크 장르 페이지(ticketlink.co.kr/performance/14) 구성을 그대로:
 *   페이지 제목 + 하위 분류 탭(linebox) → 히어로 배너(페이드 + 썸네일) → 랭킹(회색 띠, 캡슐·점 탭, 큰 순위 숫자)
 *   → 추천(4열) → 지역(회색 띠, 지역 캡슐 탭, 4열 격자).
 * 티켓 오픈 탭은 티켓링크 메인의 "티켓오픈"(5열, 오픈 시각을 강조색으로) 카드를 날짜별로 묶는다. */
import { ticketDay } from './_safety';
import { api } from '../../api';
import { state } from '../state';
import { t, getLocale } from '../i18n';
import { esc, freshness } from '../ui';
import type { Concert } from '../cards';
import { tlGrid, secHead, capsules, dots, bindTabs, skelBanner, skelGrid, heroHtml, bindHero, bindTopButton, regionGroup, REGION_ORDER } from '../tl';

type Tab = 'tickets' | 'visiting' | 'abroad' | 'festivals';
interface Group { key: string; label: string; total: number; shown: number; cache?: { state: string; updatedAt: string | null } }
type Fest = Concert & { country?: string; lineup?: { name: string; origin: string | null }[]; lineupJp?: number; lineupKr?: number };

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const requests = new WeakMap<HTMLElement, number>();
let originMode: 'default' | 'all' = 'default';
const PAGE = 24;
const ja = () => getLocale() === 'ja';
const monthLabel = (m: string) => (ja() ? `${Number(m.slice(5))}月` : `${Number(m.slice(5))}월`);
const todayKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const ddayText = (c: Concert) => {
  const d = c.startDate || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const n = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${todayKst()}T00:00:00Z`)) / 864e5);
  return n === 0 ? t('c.dday.today') : n > 0 ? `D-${n}` : '';
};
const SEARCH = () => `<label class="tl-search"><span class="blind">${esc(t('c.find'))}</span><input type="search" id="cFind" placeholder="${esc(t('c.find'))}" autocomplete="off"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg></label>`;

/* 랭킹의 근거: Lilac 차트 순위(아티스트 최고 순위 → 차트 진입 곡 수). 순위가 없는 아티스트의 공연은 넣지 않는다 */
let popP: Promise<Map<string, { best: number; hits: number }>> | null = null;
function popularity() {
  popP ||= api('/api/live/artists?edition=all').then((r: { items: { id: string; bestRank?: number | null; chartHits?: number }[] }) => {
    const m = new Map<string, { best: number; hits: number }>();
    for (const a of r.items || []) if (a.bestRank || a.chartHits) m.set(a.id, { best: a.bestRank || 999, hits: a.chartHits || 0 });
    return m;
  }).catch(() => { popP = null; return new Map(); });
  return popP;
}

function titleSection(tab: Tab) {
  const ed = state.edition;
  const tabs: [Tab, string][] = [
    ['tickets', t('c.tab.tickets')],
    ['visiting', t(`c.tab.visiting.${ed}`)],
    ['abroad', t(`c.tab.abroad.${ed}`)],
    ['festivals', ja() ? 'フェス' : '페스티벌'],
  ];
  return `<section class="tl-sec">
    <div class="tl-page-heading"><h1 class="tl-page-title">${esc(t('c.title'))}</h1></div>
    <nav class="tl-tab-linebox" aria-label="${esc(t('c.title'))}">${tabs.map(([k, l]) => `<div class="${k === tab ? 'is-active' : ''}"><a href="#/concerts/${k}" ${k === tab ? 'aria-current="page"' : ''}>${esc(l)}</a></div>`).join('')}</nav>
  </section>`;
}

export async function renderConcerts(root: HTMLElement, alive: () => boolean, sub?: string) {
  const version = (requests.get(root) || 0) + 1;
  requests.set(root, version);
  const routeAlive = alive;
  alive = () => routeAlive() && requests.get(root) === version;
  const tab: Tab = sub === 'tickets' || sub === 'abroad' || sub === 'festivals' || sub === 'visiting' ? sub : 'tickets';
  root.innerHTML = `<div class="tl">${titleSection(tab)}
    <div id="cBody">${tab === 'tickets' ? `<section class="tl-sec">${skelGrid(10, true)}</section>` : `<section class="tl-sec">${skelBanner()}</section><section class="tl-sec tl-rec-sec">${skelGrid(8)}</section>`}</div>
    <section class="tl-sec"><p class="tl-note" id="cMethod"></p></section></div>`;
  bindTopButton(alive);
  const body = root.querySelector<HTMLElement>('#cBody')!;
  const method = root.querySelector<HTMLElement>('#cMethod')!;
  if (tab === 'festivals') return renderFestivals(root, alive, body, method);
  if (tab === 'tickets') return renderTickets(root, alive, body, method, routeAlive);
  return renderShows(root, alive, body, method, tab, routeAlive);
}

function failState(body: HTMLElement, retry: () => void) {
  body.innerHTML = `<section class="tl-sec"><div class="tl-empty"><p>${esc(t('err.generic'))}</p><div class="tl-more"><button type="button" class="tl-btn ghost md" data-retry>${esc(t('retry'))}</button></div></div></section>`;
  body.querySelector('[data-retry]')?.addEventListener('click', retry);
}
function bindOrigin(scope: HTMLElement, root: HTMLElement, routeAlive: () => boolean, tab: Tab) {
  scope.querySelectorAll<HTMLButtonElement>('[data-origin]').forEach((b) => b.addEventListener('click', () => {
    const next = b.dataset.origin === 'all' ? 'all' : 'default';
    if (next === originMode) return;
    originMode = next;
    renderConcerts(root, routeAlive, tab);
  }));
}

/* ---------- 내한 · 원정 ---------- */
async function renderShows(root: HTMLElement, alive: () => boolean, body: HTMLElement, method: HTMLElement, tab: 'visiting' | 'abroad', routeAlive: () => boolean) {
  const ed = state.edition;
  let items: Concert[] = [];
  let groups: Group[] = [];
  let classifying = 0;
  try {
    if (ed === 'all') {
      const r = await api(`/api/live/concerts?edition=all&scope=all&origin=${originMode}`);
      const want = tab === 'visiting' ? ['kr-visiting', 'jp-abroad'] : ['jp-visiting', 'kr-abroad'];
      items = r.items.filter((x: Concert) => want.includes(x.direction || ''));
      groups = r.groups || []; classifying = r.classifying || 0;
    } else {
      const r = await api(`/api/live/concerts?edition=${ed}&scope=${tab}&origin=${originMode}`);
      items = r.items; groups = r.groups || []; classifying = r.classifying || 0;
    }
  } catch {
    if (!alive()) return;
    return failState(body, () => renderConcerts(root, routeAlive, tab));
  }
  if (!alive()) return;
  const pop = await popularity();
  if (!alive()) return;

  const cache = groups.find((g) => g.cache)?.cache || null;
  const unconfirmed = items.filter((x) => x.unconfirmed);
  const confirmed = items.filter((x) => !x.unconfirmed);
  const fc = confirmed.filter((x) => x.provider === 'fanclub');
  const shows = confirmed.filter((x) => x.provider !== 'fanclub').sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999'));
  const dirLabel = (c: Concert) => (c.direction ? t(`dir.${c.direction}`) : t(`kind.${c.kind || 'concert'}`));

  const heroList = shows.filter((x) => x.poster && x.posterKind !== 'artist').slice(0, 12);
  const ranked = (list: Concert[]) => list.filter((x) => x.artistId && pop.has(x.artistId))
    .sort((a, b) => { const pa = pop.get(a.artistId!)!, pb = pop.get(b.artistId!)!; return pa.best - pb.best || pb.hits - pa.hits || (a.startDate || '').localeCompare(b.startDate || ''); })
    .filter((x, i, arr) => arr.findIndex((y) => y.artistId === x.artistId) === i);
  const kinds = ['concert', 'fanmeeting', 'festival'].filter((k) => shows.some((x) => x.kind === k));
  const soon = shows.filter((x) => x.startDate && x.startDate >= todayKst()).slice(0, 8);
  const showOrigin = (ed === 'kr' || ed === 'all') && tab === 'visiting';
  /* 순위 근거(차트 순위가 있는 아티스트)가 3팀 미만이면 랭킹 대신 같은 띠에 '곧 열리는 공연'을 순위 숫자 없이 */
  const hasRank = ranked(shows).length >= 3;

  body.innerHTML = `
    ${heroList.length ? `<section class="tl-sec tl-hero-sec">${heroHtml(heroList, (c) => [dirLabel(c), ddayText(c)].filter(Boolean))}</section>` : ''}
    <section class="tl-band tl-ranking-sec" id="cRank"></section>
    ${fc.length ? `<section class="tl-sec tl-rec-sec">${secHead(esc(t('c.fcGroup')), { desc: ja() ? 'FC会員が先に申し込める公演' : '팬클럽 회원이 먼저 신청하는 공연' })}${tlGrid(fc.slice(0, 8))}</section>` : ''}
    ${soon.length && hasRank ? `<section class="tl-sec tl-rec-sec">${secHead(ja() ? 'もうすぐ開催' : '곧 열리는 공연')}${tlGrid(soon)}</section>` : ''}
    <section class="tl-band tl-region-sec" id="cAll"></section>`;
  bindHero(body, alive);

  /* 랭킹 */
  const rankBox = body.querySelector<HTMLElement>('#cRank')!;
  let rKind = '';
  let rWin = 'all';
  const inWin = (c: Concert) => {
    if (rWin === 'all') return true;
    const lim = new Date(Date.now() + 9 * 3600e3 + (rWin === 'month' ? 31 : 92) * 864e5).toISOString().slice(0, 10);
    return (c.startDate || '9999') <= lim;
  };
  const paintRank = () => {
    const list = ranked(shows.filter((x) => (!rKind || x.kind === rKind) && inWin(x))).slice(0, 5);
    rankBox.querySelector('#cRankGrid')!.innerHTML = list.length ? tlGrid(list, { col5: true, rank: true }) : `<div class="tl-empty">${esc(t('empty.generic'))}</div>`;
  };
  if (!hasRank) {
    if (soon.length) rankBox.innerHTML = `<div class="tl-inner">${secHead(ja() ? 'もうすぐ開催' : '곧 열리는 공연', { desc: ja() ? '開催日が近い順' : '공연일이 가까운 순' })}${tlGrid(soon.slice(0, 5), { col5: true })}</div>`;
    else rankBox.remove();
  } else {
    rankBox.innerHTML = `<div class="tl-inner">${secHead(ja() ? 'ランキング' : '랭킹', { desc: ja() ? 'Lilacチャートの順位が高いアーティストの公演' : 'Lilac 차트 순위가 높은 아티스트의 공연' })}
      <div class="tl-ranking-filter">${kinds.length > 1 ? capsules([['', ja() ? 'すべて' : '전체'], ...kinds.map((k) => [k, t(`kind.${k}`)] as [string, string])], '', 'data-rkind') : '<span></span>'}${dots([['month', ja() ? '1か月' : '한 달'], ['quarter', ja() ? '3か月' : '3개월'], ['all', ja() ? '全期間' : '전체']], 'all', 'data-rwin')}</div>
      <div id="cRankGrid"></div></div>`;
    bindTabs(rankBox, 'data-rkind', (v) => { rKind = v; paintRank(); });
    bindTabs(rankBox, 'data-rwin', (v) => { rWin = v; paintRank(); });
    paintRank();
  }

  /* 지역 — 전체 공연 */
  const allBox = body.querySelector<HTMLElement>('#cAll')!;
  const regionCount = (r: string) => shows.filter((x) => regionGroup(x) === r).length;
  const ord = (r: string) => { const i = REGION_ORDER.indexOf(r); return i < 0 ? 99 : i; };
  const regions = [...new Set(shows.map((x) => regionGroup(x)).filter(Boolean))].sort((a, b) => ord(a) - ord(b));
  const months = [...new Set(shows.map((x) => (x.startDate || '').slice(0, 7)).filter(Boolean))].sort();
  let region = '';
  let month = '';
  let kind = '';
  let q = '';
  let shown = PAGE;
  allBox.innerHTML = `<div class="tl-inner">
    ${secHead(`${ja() ? '全公演' : '전체 공연'} <span class="tl-hl num" id="cCount"></span>`, { right: showOrigin ? dots([['default', t('c.onlyJp')], ['all', t('c.allVisiting')]], originMode, 'data-origin') : '' })}
    <div class="tl-filter">${capsules([['', ja() ? 'すべて' : '전체', shows.length], ...regions.map((r) => [r, r, regionCount(r)] as [string, string, number])], '', 'data-region')}</div>
    <div class="tl-filter">
      ${dots([['', t('c.filter.allDates')], ...months.map((m) => [m, monthLabel(m)] as [string, string])], '', 'data-month')}
      ${kinds.length > 1 ? dots([['', t('c.filter.allKinds')], ...kinds.map((k) => [k, t(`kind.${k}`)] as [string, string])], '', 'data-kind') : ''}
      ${SEARCH()}
    </div>
    <div id="cGrid"></div>
    ${unconfirmed.length ? `<details class="tl-details"><summary>${esc(t('c.unconfirmed', { n: unconfirmed.length }))}<span>${esc(t('c.unconfirmed.sub'))}</span></summary>${tlGrid(unconfirmed)}</details>` : ''}
    <div class="tl-note">${freshness(cache)}</div>
  </div>`;
  const paint = () => {
    const rows = shows.filter((x) => (!region || regionGroup(x) === region) && (!month || (x.startDate || '').startsWith(month)) && (!kind || x.kind === kind) && (!q || norm(`${x.title} ${x.performer || ''} ${x.venue || ''}`).includes(norm(q))));
    allBox.querySelector('#cCount')!.textContent = String(rows.length);
    const grid = allBox.querySelector<HTMLElement>('#cGrid')!;
    if (!rows.length) {
      grid.innerHTML = `<div class="tl-empty">${esc(classifying && originMode === 'default' && tab === 'visiting' ? t('c.classifying', { n: classifying }) : t('empty.generic'))}</div>`;
      return;
    }
    grid.innerHTML = tlGrid(rows.slice(0, shown)) + (rows.length > shown ? `<div class="tl-more"><button type="button" class="tl-btn ghost md" id="cMore">${ja() ? 'もっと見る' : '더보기'} <span class="num">${Math.min(shown, rows.length)}/${rows.length}</span></button></div>` : '');
    grid.querySelector('#cMore')?.addEventListener('click', () => { shown += PAGE; paint(); });
  };
  bindTabs(allBox, 'data-region', (v) => { region = v; shown = PAGE; paint(); });
  bindTabs(allBox, 'data-month', (v) => { month = v; shown = PAGE; paint(); });
  bindTabs(allBox, 'data-kind', (v) => { kind = v; shown = PAGE; paint(); });
  allBox.querySelector<HTMLInputElement>('#cFind')!.addEventListener('input', (e) => { q = (e.target as HTMLInputElement).value.trim(); shown = PAGE; paint(); });
  bindOrigin(allBox, root, routeAlive, tab);
  paint();
  method.textContent = (ed === 'jp' && tab === 'visiting') || (ed === 'all' && tab === 'abroad') ? t('c.method.jp') : t('c.method.visiting');
}

/* ---------- 티켓 오픈 ---------- */
async function renderTickets(root: HTMLElement, alive: () => boolean, body: HTMLElement, method: HTMLElement, routeAlive: () => boolean) {
  const ed = state.edition;
  let items: Concert[] = [];
  let groups: Group[] = [];
  try {
    const r = await api(`/api/live/tickets?edition=${ed}&origin=${originMode}`);
    items = r.items; groups = r.groups || [];
  } catch {
    if (!alive()) return;
    return failState(body, () => renderConcerts(root, routeAlive, 'tickets'));
  }
  if (!alive()) return;
  const cache = groups.find((g) => g.cache)?.cache || null;
  const tkey = (x: Concert) => x.saleSortAt || x.ticketOpenAt || x.openSchedule?.[0]?.at || '';
  const now = Date.now();
  const upcoming = (x: Concert) => [x.ticketOpenAt, ...(x.openSchedule || []).map((s) => s.at)].some((a) => a && Date.parse(a) > now);
  const soonList = items.filter((x) => !x.unconfirmed && upcoming(x) && Date.parse(tkey(x)) - now < 48 * 3600e3).sort((a, b) => tkey(a).localeCompare(tkey(b)));
  const months = [...new Set(items.map((x) => tkey(x).slice(0, 7)).filter(Boolean))].sort();
  let side = '';
  let month = '';
  let q = '';
  const sides: [string, string, number][] = [
    ['', ja() ? 'すべて' : '전체', items.length],
    ['vendor', ja() ? 'プレイガイド' : '예매처', items.filter((x) => x.provider !== 'fanclub').length],
    ['fanclub', ja() ? 'ファンクラブ先行' : '팬클럽 선행', items.filter((x) => x.provider === 'fanclub').length],
  ];
  const showOrigin = ed === 'kr' || ed === 'all';
  body.innerHTML = `
    ${soonList.length >= 3 && items.length > 15 ? `<section class="tl-sec tl-open-sec">${secHead(`${ja() ? 'まもなく発売' : '곧 오픈'} <span class="tl-hl num">${soonList.length}</span>`, { desc: ja() ? '48時間以内に始まる販売' : '48시간 안에 시작하는 예매' })}${tlGrid(soonList.slice(0, 10), { col5: true, open: true })}</section>` : ''}
    <section class="tl-band tl-region-sec" id="tAll"><div class="tl-inner">
      ${secHead(`${ja() ? '販売スケジュール' : '예매 일정'} <span class="tl-hl num" id="cCount"></span>`, { right: showOrigin ? dots([['default', t('c.onlyJp')], ['all', t('c.allVisiting')]], originMode, 'data-origin') : '' })}
      <div class="tl-filter">${capsules(sides.filter((s) => s[2] > 0 || s[0] === ''), '', 'data-side')}</div>
      <div class="tl-filter">${dots([['', t('c.filter.allDates')], ...months.map((m) => [m, monthLabel(m)] as [string, string])], '', 'data-month')}${SEARCH()}</div>
      <div id="tDays"></div>
      <div class="tl-note">${freshness(cache)}</div>
    </div></section>`;
  const box = body.querySelector<HTMLElement>('#tAll')!;
  const dayTitle = (day: string) => {
    if (!day) return esc(t('c.tba'));
    const d = new Date(`${day}T00:00:00+09:00`);
    const wd = new Intl.DateTimeFormat(ja() ? 'ja-JP' : 'ko-KR', { weekday: 'short', timeZone: 'Asia/Seoul' }).format(d);
    const tomorrow = new Date(Date.now() + 33 * 3600e3).toISOString().slice(0, 10);
    const rel = day === todayKst() ? (ja() ? '今日' : '오늘') : day === tomorrow ? (ja() ? '明日' : '내일') : '';
    return `<span class="num">${Number(day.slice(5, 7))}.${Number(day.slice(8))}</span>(${esc(wd)})${rel ? ` <span class="tl-hl">${rel}</span>` : ''}`;
  };
  const paint = () => {
    const rows = items.filter((x) => !x.unconfirmed && (!side || (side === 'fanclub' ? x.provider === 'fanclub' : x.provider !== 'fanclub')) && (!month || tkey(x).startsWith(month)) && (!q || norm(`${x.title} ${x.performer || ''} ${x.venue || ''}`).includes(norm(q))));
    box.querySelector('#cCount')!.textContent = String(rows.length);
    const tba = rows.filter((x) => x.openTba && !x.ticketOpenAt);
    const dated = rows.filter((x) => !(x.openTba && !x.ticketOpenAt));
    /* 적으면 오픈 시각순 한 격자(티켓링크 메인 "티켓오픈"), 많으면 날짜별 묶음 */
    if (rows.length <= 15) {
      const sorted = dated.slice().sort((a, b) => tkey(a).localeCompare(tkey(b)));
      box.querySelector('#tDays')!.innerHTML = rows.length ? tlGrid([...sorted, ...tba], { col5: true, open: true }) : `<div class="tl-empty">${esc(t('empty.generic'))}</div>`;
      return;
    }
    const byDay = new Map<string, Concert[]>();
    for (const r of dated) { const k = ticketDay(tkey(r)); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k)!.push(r); }
    const out = [...byDay].map(([day, list]) => `<section class="tl-open-sec">${secHead(`${dayTitle(day)} <span class="tl-sec-desc num">${list.length}${ja() ? '件' : '건'}</span>`)}${tlGrid(list, { col5: true, open: true })}</section>`);
    if (tba.length) out.push(`<section class="tl-open-sec">${secHead(esc(t('c.tba')))}${tlGrid(tba, { col5: true, open: true })}</section>`);
    box.querySelector('#tDays')!.innerHTML = out.join('') || `<div class="tl-empty">${esc(t('empty.generic'))}</div>`;
  };
  bindTabs(box, 'data-side', (v) => { side = v; paint(); });
  bindTabs(box, 'data-month', (v) => { month = v; paint(); });
  box.querySelector<HTMLInputElement>('#cFind')!.addEventListener('input', (e) => { q = (e.target as HTMLInputElement).value.trim(); paint(); });
  bindOrigin(box, root, routeAlive, 'tickets');
  paint();
  method.textContent = t('c.method.tickets');
}

/* ---------- 페스티벌 ---------- */
async function renderFestivals(root: HTMLElement, alive: () => boolean, body: HTMLElement, method: HTMLElement) {
  const ed = state.edition;
  let r: { items: Fest[]; cache?: { state: string; updatedAt: string | null } | null; pending?: boolean };
  try { r = await api(`/api/live/festivals?edition=${ed}`); }
  catch {
    if (!alive()) return;
    return failState(body, () => renderConcerts(root, alive, 'festivals'));
  }
  if (!alive()) return;
  const cn = (c: string) => (c === 'JP' ? (ja() ? '日本' : '일본') : ja() ? '韓国' : '한국');
  const cross = (f: Fest) => (f.country === 'JP' ? f.lineupKr || 0 : f.lineupJp || 0) > 0;
  const all = r.items.slice().sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999'));
  const heroList = all.filter((x) => x.poster && x.posterKind !== 'artist' && (ed !== 'jp' || x.country === 'JP')).slice(0, 12);
  const crossList = all.filter(cross);
  let country = ed === 'jp' ? 'JP' : '';
  let month = '';
  let q = '';
  let shown = PAGE;
  const months = [...new Set(all.map((x) => (x.startDate || '').slice(0, 7)).filter(Boolean))].sort();
  body.innerHTML = `
    ${heroList.length ? `<section class="tl-sec tl-hero-sec">${heroHtml(heroList, (f) => [`${cn((f as Fest).country || 'KR')} ${ja() ? 'フェス' : '페스티벌'}`, ddayText(f)].filter(Boolean))}</section>` : ''}
    ${crossList.length ? `<section class="tl-band tl-ranking-sec"><div class="tl-inner">${secHead(`${ja() ? '日韓クロス出演' : '한일 교차 출연'} <span class="tl-hl num">${crossList.length}</span>`, { desc: ja() ? '韓国フェスのJ-POP・日本フェスのK-POP出演' : '한국 페스티벌의 J-POP · 일본 페스티벌의 K-POP 출연' })}${tlGrid(crossList.slice(0, 10), { col5: true })}</div></section>` : ''}
    <section class="${crossList.length ? 'tl-sec tl-rec-sec' : 'tl-band tl-region-sec'}" id="fAll"><div class="${crossList.length ? '' : 'tl-inner'}">
      ${secHead(`${ja() ? '全フェス' : '전체 페스티벌'} <span class="tl-hl num" id="cCount"></span>`)}
      <div class="tl-filter">${capsules([['', ja() ? 'すべて' : '전체', all.length], ['KR', cn('KR'), all.filter((x) => x.country === 'KR').length], ['JP', cn('JP'), all.filter((x) => x.country === 'JP').length]], country, 'data-region')}</div>
      <div class="tl-filter">${dots([['', t('c.filter.allDates')], ...months.map((m) => [m, monthLabel(m)] as [string, string])], '', 'data-month')}${SEARCH()}</div>
      <div id="fGrid"></div>
      <div class="tl-note">${freshness(r.cache || null)}</div>
    </div></section>`;
  bindHero(body, alive);
  const box = body.querySelector<HTMLElement>('#fAll')!;
  const paint = () => {
    const rows = all.filter((x) => (!country || x.country === country) && (!month || (x.startDate || '').startsWith(month)) && (!q || norm(`${x.title} ${x.venue || ''} ${(x.lineup || []).map((l) => l.name).join(' ')}`).includes(norm(q))));
    box.querySelector('#cCount')!.textContent = String(rows.length);
    const grid = box.querySelector<HTMLElement>('#fGrid')!;
    if (!rows.length) { grid.innerHTML = `<div class="tl-empty">${esc(r.pending ? (ja() ? 'フェス情報を集めています。少し後にもう一度ご覧ください。' : '페스티벌 정보를 모으는 중입니다. 잠시 뒤 다시 확인해 주세요.') : t('empty.generic'))}</div>`; return; }
    grid.innerHTML = tlGrid(rows.slice(0, shown)) + (rows.length > shown ? `<div class="tl-more"><button type="button" class="tl-btn ghost md" id="fMore">${ja() ? 'もっと見る' : '더보기'} <span class="num">${Math.min(shown, rows.length)}/${rows.length}</span></button></div>` : '');
    grid.querySelector('#fMore')?.addEventListener('click', () => { shown += PAGE; paint(); });
  };
  bindTabs(box, 'data-region', (v) => { country = v; shown = PAGE; paint(); });
  bindTabs(box, 'data-month', (v) => { month = v; shown = PAGE; paint(); });
  box.querySelector<HTMLInputElement>('#cFind')!.addEventListener('input', (e) => { q = (e.target as HTMLInputElement).value.trim(); shown = PAGE; paint(); });
  paint();
  method.textContent = ja() ? '情報提供 NOLチケット・メロンチケット・YES24チケット・チケットリンク・イープラス・ローチケ · 出演は各プレイガイドの公演ページから' : '정보 제공 NOL 티켓 · 멜론티켓 · YES24 티켓 · 티켓링크 · 이플러스 · 로치케 · 라인업은 각 예매처 상품 페이지에서';
}
