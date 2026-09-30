import { artUrl, esc, icon } from '../api';
import type { DiscoveryTrack } from './model';

type SelectableStage = HTMLElement & { __selectHero?: (index: number) => void };
export interface HomeRecord { track: DiscoveryTrack; playKey: string; }
const href = (r: DiscoveryTrack) => '#/search?q=' + encodeURIComponent(`${r.artist} ${r.title}`);

/** One source order for the DOM controls and the three record objects. */
export function homeRecordControls(records: HomeRecord[], current?: DiscoveryTrack): string {
  return `<nav class="li-home-record-links" aria-label="레코드 곡 찾기">${records.map(({track:r}, i) => `<div class="li-record-option">
    <button type="button" data-home-record="${i}" aria-pressed="${r === current}" aria-label="${esc(r.title+' · '+r.artist)} 선택">
      <img src="${esc(artUrl(r,100))}" alt="" width="48" height="48" decoding="async">
      <span class="li-record-label"><strong>${esc(r.title)}</strong><small>${esc(r.artist)}</small></span>
      <span class="li-record-rank">${r.rank}</span>
    </button>
    <a href="${href(r)}" aria-label="${esc(r.title+' · '+r.artist)} 곡 찾기">${icon('i-chev-r','ic s')}</a>
  </div>`).join('')}</nav>`;
}

/** Selection never autoplays. Playback keeps the existing exact-identity resolver. */
export function bindHomeRecords(host: HTMLElement, records: HomeRecord[], signal: AbortSignal, invalidatePlayback: () => void) {
  const controls = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-home-record]'));
  const stage = host.querySelector<SelectableStage>('.md-scene');
  const title = host.querySelector<HTMLElement>('[data-home-title]');
  const artist = host.querySelector<HTMLElement>('[data-home-artist]');
  const rank = host.querySelector<HTMLElement>('[data-home-rank]');
  const play = host.querySelector<HTMLButtonElement>('.li-home-play');
  const info = host.querySelector<HTMLAnchorElement>('[data-home-info]');
  if (!play || !title || !artist || !rank) return;
  let selected = Number(host.dataset.homeRecord ?? 0);
  const applyScene = () => { if (!signal.aborted) stage?.__selectHero?.(selected); };
  for (const button of controls) button.addEventListener('click', () => {
    const index = Number(button.dataset.homeRecord), entry = records[index];
    if (!Number.isInteger(index) || !entry || signal.aborted) return;
    invalidatePlayback(); selected = index; host.dataset.homeRecord = String(index);
    const r = entry.track;
    title.textContent = r.title; artist.textContent = r.artist; rank.textContent = `${r.rank}위`;
    play.dataset.mdPlay = entry.playKey;
    play.setAttribute('aria-label', `${r.title} · ${r.artist} 30초 미리듣기`);
    if (info) { info.href = href(r); info.setAttribute('aria-label', `${r.title} · ${r.artist} 곡 찾기`); }
    controls.forEach(c => c.setAttribute('aria-pressed', String(c === button)));
    applyScene();
  }, { signal });
  // A quick selection can precede the lazy Three mount. Reapply only once it is ready.
  if (stage && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(applyScene);
    observer.observe(stage, { attributes: true, attributeFilter: ['data-scene3d'] });
    signal.addEventListener('abort', () => observer.disconnect(), { once: true });
  }
  applyScene();
}
