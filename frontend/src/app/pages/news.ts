import { api } from '../../api';
import { state } from '../state';
import { t, getLocale } from '../i18n';
import { esc, skeletonRows, errorState, emptyState, freshness } from '../ui';
import { newsRow, artistCard } from '../cards';
import type { News, ArtistLite } from '../cards';

const TOPICS = ['visit', 'ticket', 'release', 'live', 'chart'] as const;

export async function renderNews(root: HTMLElement, alive: () => boolean) {
  const ed = state.edition;
  root.innerHTML = `
    <section class="page-head"><h1>${t('n.title')}</h1></section>
    <div class="toolbar browse-news-tools" id="nTools"></div>
    <div class="split wide-left">
      <section class="sec"><p id="nCount" class="news-result" role="status" aria-live="polite"></p><ul class="nlist" id="nList">${skeletonRows(10)}</ul><div class="news-more"><button type="button" class="btn btn-line" id="nMore" hidden></button></div></section>
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
  let shown = 8;
  const counts = Object.fromEntries(TOPICS.map((k) => [k, items.filter((x) => x.topics.includes(k)).length]));
  const tools = root.querySelector<HTMLElement>('#nTools')!;
  tools.innerHTML = `<div class="chips" role="group" aria-label="${esc(t('n.title'))}">
      <button type="button" class="chip on" data-topic="" aria-pressed="true">${t('n.all')} <span class="n">${items.length}</span></button>
      ${TOPICS.filter((k) => counts[k]).map((k) => `<button type="button" class="chip" data-topic="${k}" aria-pressed="false">${t(`n.${k}`)} <span class="n">${counts[k]}</span></button>`).join('')}
    </div><button type="button" class="btn btn-line browse-reset" id="nReset" disabled>${getLocale() === 'ja' ? '条件をリセット' : '조건 초기화'}</button>${freshness(cache)}`;

  const byId = new Map(artists.map((a) => [a.id, a]));
  const mention = new Map<string, number>();
  for (const it of items) for (const id of it.artistIds || []) mention.set(id, (mention.get(id) || 0) + 1);
  const top = [...mention].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => ({ a: byId.get(id), n })).filter((x) => x.a);

  const side = root.querySelector<HTMLElement>('#nSide')!;
  side.innerHTML = top.length ? `<h2 class="side-h">${t('n.mentioned')}</h2><ul class="mention">${top.map(({ a, n }) => `<li><button type="button" data-artist="${esc(a!.id)}" aria-pressed="false">${artistCard(a!).replace(/<a /, '<span ').replace(/<\/a>$/, '</span>')}<span class="n">${t('n.count', { n })}</span></button></li>`).join('')}</ul>` : '';

  const list = root.querySelector<HTMLElement>('#nList')!;
  const more = root.querySelector<HTMLButtonElement>('#nMore')!;
  const count = root.querySelector<HTMLElement>('#nCount')!;
  const paint = () => {
    let rows = items;
    if (topic) rows = rows.filter((x) => x.topics.includes(topic));
    if (artist) rows = rows.filter((x) => x.artistIds.includes(artist));
    list.innerHTML = rows.length ? rows.slice(0, shown).map(newsRow).join('') : emptyState(getLocale() === 'ja' ? (topic || artist ? '条件に合うニュースがありません。条件をリセットして確認してください。' : '表示できるニュースはまだありません。') : (topic || artist ? '조건에 맞는 소식이 없습니다. 조건을 초기화해 전체 소식을 확인하세요.' : '아직 표시할 소식이 없습니다.'), !topic && !artist ? `<a class="btn btn-line" href="#/artists">${getLocale() === 'ja' ? 'アーティストを見る' : '아티스트 둘러보기'}</a>` : '');
    const n = Math.min(shown, rows.length);
    const activeArtist = artist ? byId.get(artist) : null;
    const artistLabel = activeArtist ? (getLocale() === 'ja' ? activeArtist.name : activeArtist.nameKo || activeArtist.name) : '';
    const active = [topic ? t(`n.${topic}`) : t('n.all'), artistLabel].filter(Boolean).join(' · ');
    count.textContent = getLocale() === 'ja' ? `${active} · ${rows.length}件中 ${n}件を表示` : `${active} · 소식 ${rows.length}건 중 ${n}건 표시`;
    const reset = root.querySelector<HTMLButtonElement>('#nReset');
    if (reset) reset.disabled = !topic && !artist;
    more.hidden = n >= rows.length;
    more.textContent = getLocale() === 'ja' ? 'ニュースをもっと見る' : '소식 더 보기';
  };
  paint();
  root.querySelector('#nReset')?.addEventListener('click', () => {
    topic = ''; artist = ''; shown = 8;
    tools.querySelectorAll<HTMLButtonElement>('[data-topic]').forEach((b) => { const on = !b.dataset.topic; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    side.querySelectorAll<HTMLButtonElement>('[data-artist]').forEach((b) => { b.classList.toggle('on', false); b.setAttribute('aria-pressed', 'false'); });
    paint();
  });
  more.addEventListener('click', () => { shown += 8; paint(); });
  tools.querySelectorAll<HTMLButtonElement>('[data-topic]').forEach((b) => b.addEventListener('click', () => {
    topic = b.dataset.topic || '';
    shown = 8;
    tools.querySelectorAll('[data-topic]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    paint();
  }));
  side.querySelectorAll<HTMLButtonElement>('[data-artist]').forEach((b) => b.addEventListener('click', () => {
    artist = artist === b.dataset.artist ? '' : b.dataset.artist!;
    shown = 8;
    side.querySelectorAll('[data-artist]').forEach((x) => { const on = x === b && !!artist; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
    paint();
  }));
}
