import { ticketDay } from './_safety';
import { api } from '../../api';
import { state } from '../state';
import { t, getLocale } from '../i18n';
import { esc, skeletonCards, skeletonRows, errorState, emptyState, freshness, fmtDay } from '../ui';
import { posterCard, ticketRow } from '../cards';
import type { Concert } from '../cards';

function agendaDay(day: string, rows: string) {
  if (!day) return `<section class="agenda"><h3 class="ag-day is-tba"><b>-</b></h3><ul class="tlist">${rows}</ul></section>`;
  const d = new Date(`${day}T00:00:00+09:00`);
  const ja = getLocale() === 'ja';
  const wd = new Intl.DateTimeFormat(ja ? 'ja-JP' : 'ko-KR', { weekday: 'short', timeZone: 'Asia/Seoul' }).format(d);
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 33 * 3600e3).toISOString().slice(0, 10);
  const rel = day === today ? (ja ? '今日' : '오늘') : day === tomorrow ? (ja ? '明日' : '내일') : '';
  return `<section class="agenda${rel ? ' is-near' : ''}"><h3 class="ag-day" aria-label="${esc(fmtDay(day))}"><b>${Number(day.slice(8))}</b><span>${ja ? `${Number(day.slice(5, 7))}月` : `${Number(day.slice(5, 7))}월`} · ${esc(wd)}</span>${rel ? `<em>${rel}</em>` : ''}</h3><ul class="tlist">${rows}</ul></section>`;
}

type Tab = 'tickets' | 'visiting' | 'abroad';
interface Group { key: string; label: string; total: number; shown: number; cache?: { state: string; updatedAt: string | null } }

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const requests = new WeakMap<HTMLElement, number>();
let originMode: 'default' | 'all' = 'default';

export async function renderConcerts(root: HTMLElement, alive: () => boolean, sub?: string) {
  const version = (requests.get(root) || 0) + 1;
  requests.set(root, version);
  const routeAlive = alive;
  alive = () => routeAlive() && requests.get(root) === version;
  const tab: Tab = sub === 'tickets' || sub === 'abroad' ? sub : sub === 'visiting' ? 'visiting' : 'tickets';
  const ed = state.edition;
  const tabs: [Tab, string][] = [
    ['tickets', t('c.tab.tickets')],
    ['visiting', t(`c.tab.visiting.${ed}`)],
    ['abroad', t(`c.tab.abroad.${ed}`)],
  ];
  root.innerHTML = `
    <section class="page-head"><h1>${t('c.title')}</h1></section>
    <nav class="tabs" aria-label="${t('c.title')}">${tabs.map(([k, l]) => `<a href="#/concerts/${k}" class="${k === tab ? 'on' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${esc(l)}</a>`).join('')}</nav>
    <div class="toolbar" id="cTools"></div>
    <div id="cBody">${tab === 'tickets' ? `<ul class="tlist">${skeletonRows(6)}</ul>` : skeletonCards(12)}</div>
    <p class="method" id="cMethod"></p>`;

  const body = root.querySelector<HTMLElement>('#cBody')!;
  const tools = root.querySelector<HTMLElement>('#cTools')!;
  const method = root.querySelector<HTMLElement>('#cMethod')!;

  let items: Concert[] = [];
  let groups: Group[] = [];
  let classifying = 0;
  try {
    if (tab === 'tickets') {
      const r = await api(`/api/live/tickets?edition=${ed}&origin=${originMode}`);
      items = r.items; groups = r.groups || [];
    } else if (ed === 'all') {
      const r = await api(`/api/live/concerts?edition=all&scope=all&origin=${originMode}`);
      const wantDirs = tab === 'visiting' ? ['kr-visiting', 'jp-abroad'] : ['jp-visiting', 'kr-abroad'];
      items = r.items.filter((x: Concert) => wantDirs.includes(x.direction || ''));
      groups = r.groups || []; classifying = r.classifying || 0;
    } else {
      const r = await api(`/api/live/concerts?edition=${ed}&scope=${tab}&origin=${originMode}`);
      items = r.items; groups = r.groups || []; classifying = r.classifying || 0;
    }
  } catch {
    if (!alive()) return;
    body.innerHTML = errorState(t('err.generic'));
    body.querySelector('[data-retry]')?.addEventListener('click', () => renderConcerts(root, routeAlive, sub));
    return;
  }
  if (!alive()) return;

  const cache = groups.find((g) => g.cache)?.cache || null;
  const showOriginToggle = (ed === 'kr' || ed === 'all') && (tab === 'visiting' || tab === 'tickets');
  const tkey = (x: Concert) => x.saleSortAt || x.ticketOpenAt || x.openSchedule?.[0]?.at || '';
  const months = [...new Set(items.map((x) => (tab === 'tickets' ? tkey(x).slice(0, 7) : (x.startDate || '').slice(0, 7))).filter(Boolean))].sort();
  let month = '';
  let kind = '';
  let q = '';

  const kinds = ['concert', 'fanmeeting', 'festival'].filter((k) => items.some((x) => x.kind === k));

  tools.innerHTML = `
    ${showOriginToggle ? `<div class="seg" role="group">
      <button data-origin="default" class="${originMode === 'default' ? 'on' : ''}">${t('c.onlyJp')}</button>
      <button data-origin="all" class="${originMode === 'all' ? 'on' : ''}">${t('c.allVisiting')}</button></div>` : ''}
    <div class="chips" id="cMonths">
      <button class="chip on" data-month="">${t('c.filter.allDates')}</button>
      ${months.map((m) => `<button class="chip" data-month="${m}">${t('c.filter.month', { m: Number(m.slice(5)) })}</button>`).join('')}
    </div>
    ${tab !== 'tickets' && kinds.length > 1 ? `<div class="chips" id="cKinds"><button class="chip on" data-kind="">${t('c.filter.allKinds')}</button>${kinds.map((k) => `<button class="chip" data-kind="${k}">${t(`kind.${k}`)}</button>`).join('')}</div>` : ''}
    <label class="find"><input type="search" id="cFind" placeholder="${t('c.find')}" autocomplete="off"></label>
    <span class="count" id="cCount"></span>
    ${freshness(cache)}`;

  const paint = () => {
    let rows = items.slice();
    if (month) rows = rows.filter((x) => (tab === 'tickets' ? tkey(x) : x.startDate || '').startsWith(month));
    if (kind) rows = rows.filter((x) => x.kind === kind);
    if (q) rows = rows.filter((x) => norm(`${x.title} ${x.performer || ''} ${x.venue || ''}`).includes(norm(q)));
    root.querySelector('#cCount')!.textContent = t('c.count', { n: rows.filter((x) => !x.unconfirmed).length });
    if (!rows.length) {
      body.innerHTML = emptyState(classifying && tab === 'visiting' && originMode === 'default' ? t('c.classifying', { n: classifying }) : t('empty.generic'));
      return;
    }
    const unconfirmed = rows.filter((x) => x.unconfirmed);
    rows = rows.filter((x) => !x.unconfirmed);
    const tba = rows.filter((x) => x.openTba && !x.ticketOpenAt);
    if (tab === 'tickets') rows = rows.filter((x) => !(x.openTba && !x.ticketOpenAt));
    if (tab === 'tickets') {
      const byDay = new Map<string, Concert[]>();
      for (const r of rows) {
        const at = tkey(r);
        const k = ticketDay(at);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k)!.push(r);
      }
      /* 날짜 칸(왼쪽, 붙어 다님) + 그날의 오픈 목록(오른쪽) — 예매처 오픈 일정표처럼 한눈에 */
      body.innerHTML = [...byDay].map(([day, list]) => agendaDay(day, list.map((c) => ticketRow(c, { day })).join(''))).join('')
        + (tba.length ? `<section class="agenda"><h3 class="ag-day is-tba"><b>${t('c.tba')}</b></h3><ul class="tlist">${tba.map((c) => ticketRow(c)).join('')}</ul></section>` : '');
    } else {
      // 팬클럽 선행·전용 공연은 맨 위에 따로. 예매처에 없더라도 팬클럽에 가입하면 신청할 수 있다.
      const fcRows = rows.filter((x) => x.provider === 'fanclub');
      rows = rows.filter((x) => x.provider !== 'fanclub');
      const fcHtml = fcRows.length ? `<section class="fc-group"><div class="sec-head"><h2>${t('c.fcGroup')}</h2></div><div class="grid-posters">${fcRows.map(posterCard).join('')}</div></section>` : '';
      const byMonth = new Map<string, Concert[]>();
      for (const r of rows) {
        const k = (r.startDate || '').slice(0, 7);
        if (!byMonth.has(k)) byMonth.set(k, []);
        byMonth.get(k)!.push(r);
      }
      body.innerHTML = fcHtml + (rows.length || fcHtml ? '' : emptyState(t('empty.generic'))) + [...byMonth].map(([m, list]) => `<h3 class="day-h">${m ? (getLocale() === 'ja' ? `${m.slice(0, 4)}年${Number(m.slice(5))}月` : `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`) : '-'}</h3><div class="grid-posters">${list.map(posterCard).join('')}</div>`).join('');
    }
    if (unconfirmed.length) {
      body.insertAdjacentHTML('beforeend', `<details class="unconfirmed"><summary><b>${t('c.unconfirmed', { n: unconfirmed.length })}</b><span>${t('c.unconfirmed.sub')}</span></summary><div class="grid-posters">${unconfirmed.map(posterCard).join('')}</div></details>`);
    }
  };
  paint();

  tools.querySelectorAll<HTMLButtonElement>('[data-month]').forEach((b) => b.addEventListener('click', () => {
    month = b.dataset.month || '';
    tools.querySelectorAll('[data-month]').forEach((x) => x.classList.toggle('on', x === b));
    paint();
  }));
  tools.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    kind = b.dataset.kind || '';
    tools.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('on', x === b));
    paint();
  }));
  tools.querySelector<HTMLInputElement>('#cFind')!.addEventListener('input', (e) => { q = (e.target as HTMLInputElement).value.trim(); paint(); });
  tools.querySelectorAll<HTMLButtonElement>('[data-origin]').forEach((b) => b.addEventListener('click', () => {
    originMode = b.dataset.origin === 'all' ? 'all' : 'default';
    renderConcerts(root, routeAlive, tab);
  }));

  method.textContent = tab === 'tickets' ? t('c.method.tickets') : (ed === 'jp' && tab === 'visiting') || (ed === 'all' && tab === 'abroad') ? t('c.method.jp') : t('c.method.visiting');
}
