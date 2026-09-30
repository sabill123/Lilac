import { api } from '../../api';
import { state } from '../state';
import { t } from '../i18n';
import { esc, skeletonRows, errorState, emptyState, freshness } from '../ui';
import { newsRow, artistCard } from '../cards';
import type { News, ArtistLite } from '../cards';

const TOPICS = ['visit', 'ticket', 'release', 'live', 'chart'] as const;

export async function renderNews(root: HTMLElement, alive: () => boolean) {
  const ed = state.edition;
  root.innerHTML = `
    <section class="page-head"><h1>${t('n.title')}</h1></section>
    <div class="toolbar" id="nTools"></div>
    <div class="split wide-left">
      <section class="sec"><ul class="nlist" id="nList">${skeletonRows(10)}</ul></section>
      <aside class="sec" id="nSide"></aside>
    </div>
    <p class="method">${t('n.method')}</p>`;
  let items: News[] = [];
  let cache = null;
  let artists: ArtistLite[] = [];
  try {
    const [r, a] = await Promise.all([api(`/api/live/news?edition=${ed}`), api(`/api/live/artists?edition=${ed}`).catch(() => ({ items: [] }))]);
    items = r.items || [];
    cache = r.cache || null;
    artists = a.items || [];
  } catch {
    if (!alive()) return;
    root.querySelector('#nList')!.innerHTML = errorState(t('err.generic'));
    root.querySelector('[data-retry]')?.addEventListener('click', () => renderNews(root, alive));
    return;
  }
  if (!alive()) return;

  let topic = '';
  let artist = '';
  const counts = Object.fromEntries(TOPICS.map((k) => [k, items.filter((x) => x.topics.includes(k)).length]));
  const tools = root.querySelector<HTMLElement>('#nTools')!;
  tools.innerHTML = `<div class="chips">
      <button class="chip on" data-topic="">${t('n.all')} <span class="n">${items.length}</span></button>
      ${TOPICS.filter((k) => counts[k]).map((k) => `<button class="chip" data-topic="${k}">${t(`n.${k}`)} <span class="n">${counts[k]}</span></button>`).join('')}
    </div>${freshness(cache)}`;

  const byId = new Map(artists.map((a) => [a.id, a]));
  const mention = new Map<string, number>();
  for (const it of items) for (const id of it.artistIds || []) mention.set(id, (mention.get(id) || 0) + 1);
  const top = [...mention].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => ({ a: byId.get(id), n })).filter((x) => x.a);

  const side = root.querySelector<HTMLElement>('#nSide')!;
  side.innerHTML = top.length ? `<h2 class="side-h">${t('n.mentioned')}</h2><ul class="mention">${top.map(({ a, n }) => `<li><button data-artist="${esc(a!.id)}">${artistCard(a!).replace(/<a /, '<span ').replace(/<\/a>$/, '</span>')}<span class="n">${t('n.count', { n })}</span></button></li>`).join('')}</ul>` : '';

  const list = root.querySelector<HTMLElement>('#nList')!;
  const paint = () => {
    let rows = items;
    if (topic) rows = rows.filter((x) => x.topics.includes(topic));
    if (artist) rows = rows.filter((x) => x.artistIds.includes(artist));
    list.innerHTML = rows.length ? rows.map(newsRow).join('') : emptyState(t('empty.generic'));
  };
  paint();
  tools.querySelectorAll<HTMLButtonElement>('[data-topic]').forEach((b) => b.addEventListener('click', () => {
    topic = b.dataset.topic || '';
    tools.querySelectorAll('[data-topic]').forEach((x) => x.classList.toggle('on', x === b));
    paint();
  }));
  side.querySelectorAll<HTMLButtonElement>('[data-artist]').forEach((b) => b.addEventListener('click', () => {
    artist = artist === b.dataset.artist ? '' : b.dataset.artist!;
    side.querySelectorAll('[data-artist]').forEach((x) => x.classList.toggle('on', x === b && !!artist));
    paint();
  }));
}
