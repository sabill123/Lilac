/* 30초 미리듣기 플레이어 — Apple Music 공개 미리듣기
 * 재생 중일 때만 하단에 나타난다. 목록에서 누른 곡을 먼저 재생하고, 나머지 곡의 미리듣기는 순서대로 찾는다. */
import { findCatalog } from '../api';
import { esc, icon, toast } from './ui';
import { t } from './i18n';

export interface Track { title: string; artist: string; artwork?: string | null; preview?: string | null; appleUrl?: string | null }

const audio = new Audio();
audio.preload = 'none';
let queue: Track[] = [];
let idx = -1;
let token = 0;

const $ = (id: string) => document.getElementById(id);

export function initPlayer() {
  const bar = $('player')!;
  bar.innerHTML = `
    <div class="pl-inner">
      <span class="pl-art" id="plArt"></span>
      <div class="pl-meta"><b id="plTitle"></b><span id="plArtist"></span></div>
      <div class="pl-ctrl">
        <button class="icon-btn" id="plPrev" aria-label="${t('p.prev')}">${icon('i-prev')}</button>
        <button class="icon-btn pl-main" id="plToggle" aria-label="${t('p.play')}">${icon('i-play')}</button>
        <button class="icon-btn" id="plNext" aria-label="${t('p.next')}">${icon('i-next')}</button>
      </div>
      <div class="pl-time"><div class="pl-bar"><i id="plProg"></i></div><span id="plLabel">${t('p.nowPlaying')} 0:00 / 0:30</span></div>
      <a class="icon-btn pl-apple" id="plApple" target="_blank" rel="noopener" aria-label="Apple Music">${icon('i-ext')}</a>
      <button class="icon-btn" id="plClose" aria-label="${t('p.close')}">${icon('i-close')}</button>
    </div>`;
  $('plToggle')!.addEventListener('click', () => (audio.paused ? audio.play().catch(() => {}) : audio.pause()));
  $('plPrev')!.addEventListener('click', () => go(idx - 1));
  $('plNext')!.addEventListener('click', () => go(idx + 1));
  $('plClose')!.addEventListener('click', () => { audio.pause(); bar.hidden = true; document.body.classList.remove('has-player'); markPlaying(); });
  audio.addEventListener('play', sync);
  audio.addEventListener('pause', sync);
  audio.addEventListener('ended', () => go(idx + 1));
  audio.addEventListener('timeupdate', () => {
    const d = audio.duration || 30;
    const p = Math.min(1, audio.currentTime / d);
    $('plProg')!.style.transform = `scaleX(${p})`;
    const f = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    $('plLabel')!.textContent = `${t('p.nowPlaying')} ${f(audio.currentTime)} / ${f(d)}`;
  });
}

export function localizePlayer() {
  $('plPrev')?.setAttribute('aria-label', t('p.prev'));
  $('plNext')?.setAttribute('aria-label', t('p.next'));
  $('plClose')?.setAttribute('aria-label', t('p.close'));
  sync();
}

function sync() {
  const b = $('plToggle');
  if (b) { b.innerHTML = icon(audio.paused ? 'i-play' : 'i-pause'); b.setAttribute('aria-label', t(audio.paused ? 'p.play' : 'p.pause')); }
  markPlaying();
}

/* 화면에서 지금 재생 중인 곡에 표시 */
export function markPlaying() {
  const cur = queue[idx];
  const key = cur ? keyOf(cur) : '';
  document.querySelectorAll<HTMLElement>('[data-track-key]').forEach((el) => {
    const on = !!key && el.dataset.trackKey === key && !audio.paused;
    el.classList.toggle('is-playing', on);
  });
}

export const keyOf = (tr: Track) => `${tr.title}|${tr.artist}`.toLowerCase();

async function resolve(tr: Track): Promise<Track | null> {
  if (tr.preview) return tr;
  const hit = await findCatalog(`${tr.title} ${tr.artist}`);
  if (!hit?.preview) return null;
  return { ...tr, preview: hit.preview, artwork: tr.artwork || hit.artwork, appleUrl: tr.appleUrl || hit.appleUrl };
}

async function go(i: number) {
  if (!queue.length) return;
  if (i < 0 || i >= queue.length) return;
  const my = ++token;
  idx = i;
  const tr = await resolve(queue[i]);
  if (my !== token) return;
  if (!tr) {
    toast(t('p.noPreview'));
    if (i + 1 < queue.length) return go(i + 1);
    return;
  }
  queue[i] = tr;
  const bar = $('player')!;
  bar.hidden = false;
  document.body.classList.add('has-player');
  $('plArt')!.innerHTML = tr.artwork ? `<img src="${esc(tr.artwork)}" alt="" referrerpolicy="no-referrer">` : '';
  $('plTitle')!.textContent = tr.title;
  $('plArtist')!.textContent = tr.artist;
  const apple = $('plApple') as HTMLAnchorElement;
  if (tr.appleUrl) { apple.href = tr.appleUrl; apple.hidden = false; } else apple.hidden = true;
  audio.src = tr.preview!;
  audio.play().catch(() => sync());
  sync();
}

/* 같은 곡을 다시 누르면 일시정지/재개 */
export function playList(list: Track[], i = 0) {
  const cur = queue[idx];
  if (cur && list[i] && keyOf(cur) === keyOf(list[i]) && audio.src) {
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
    return;
  }
  queue = list.slice();
  go(i);
}
