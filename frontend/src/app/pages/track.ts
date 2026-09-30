import { safeExternal } from './_safety';
/* 곡 화면(#/track/<key>)과 공유된 공연(#/e/<key>)
   둘 다 소셜 대상 스냅샷(처음 좋아요·댓글·공유할 때 저장된 정보)으로 연다. */
import { api } from '../../api';
import { t } from '../i18n';
import { esc, icon, img, skeletonRows } from '../ui';
import { ct } from '../cm-i18n';
import { concertRegistry, openConcert, posterCard } from '../cards';
import type { Concert } from '../cards';
import { playList, markPlaying } from '../player';
import type { Track } from '../player';
import { likeBtn, shareBtn, bindSocial, commentsHtml, bindComments, targetAdapter, trackTarget } from '../social';

interface Snap { title: string; artist?: string; artistId?: string; artwork?: string; preview?: string; appleUrl?: string; album?: string; country?: string }

export async function renderTrack(root: HTMLElement, alive: () => boolean, key?: string) {
  root.innerHTML = `<div class="page">${skeletonRows(6, 'sk-line')}</div>`;
  const r = key ? await api(`/api/social/t/${encodeURIComponent(key)}`).catch(() => null) : null;
  if (!alive()) return;
  if (!r || r.kind !== 'track') { root.innerHTML = `<div class="page"><p class="cm-empty big">${esc(t('empty.generic'))}</p></div>`; return; }
  const s: Snap = r.snap;
  const tr: Track & { album?: string; artistId?: string } = { title: s.title, artist: s.artist || '', artwork: s.artwork, preview: s.preview, appleUrl: s.appleUrl, album: s.album, artistId: s.artistId };
  const tg = trackTarget(tr);
  const artistHref = s.artistId ? `#/artist/${encodeURIComponent(s.artistId)}` : `#/artist/name/${encodeURIComponent(s.artist || '')}`;
  document.title = `${s.title} · ${s.artist || ''} · Lilac`;
  root.innerHTML = `<div class="page song-page">
    <section class="song">
      <div class="song-art">${img(s.artwork, '', 'square', { ratio: '1/1', initial: s.title })}</div>
      <div class="song-info">
        <p class="song-kind">${ct('kind.track')}</p>
        <h1>${esc(s.title)}</h1>
        <dl class="song-meta"><dt>${ct('track.artist')}</dt><dd><a href="${artistHref}">${esc(s.artist || '')}</a></dd>${s.album ? `<dt>${ct('track.album')}</dt><dd>${esc(s.album)}</dd>` : ''}</dl>
        <div class="song-acts">
          <button type="button" class="btn btn-solid" data-play>${icon('i-play', 'ic xs')}${ct('track.play')}</button>
          ${likeBtn(tg, 'is-box')}
          ${shareBtn(null, `#/track/${r.key}`, `${s.title} · ${s.artist || ''}`, 'is-box')}
          ${s.appleUrl ? `<a class="btn btn-line" href="${esc(safeExternal(s.appleUrl))}" target="_blank" rel="noopener">${ct('track.apple')}${icon('i-ext', 'ic xs')}</a>` : ''}
        </div>
      </div>
    </section>
    <section class="sec song-cmts">${commentsHtml()}</section>
    ${s.artistId ? `<p class="song-gal"><a class="more" href="#/community/${encodeURIComponent(s.artistId)}">${esc(ct('track.gallery', { name: s.artist || '' }))}${icon('i-chev-r', 'ic xs')}</a></p>` : ''}
  </div>`;
  root.querySelector('[data-play]')!.addEventListener('click', () => { playList([tr], 0); markPlaying(); });
  void bindSocial(root);
  void bindComments(root.querySelector<HTMLElement>('.song-cmts .cmts')!, targetAdapter(tg));
}

export async function renderSharedConcert(root: HTMLElement, alive: () => boolean, key?: string) {
  root.innerHTML = `<div class="page">${skeletonRows(4, 'sk-line')}</div>`;
  const r = key ? await api(`/api/social/t/${encodeURIComponent(key)}`).catch(() => null) : null;
  if (!alive()) return;
  if (!r || r.kind !== 'concert') { root.innerHTML = `<div class="page"><p class="cm-empty big">${ct('ev.missing')}</p><a class="btn btn-line" href="#/concerts">${esc(t('nav.concerts'))}</a></div>`; return; }
  const c = { ...r.snap, id: r.snap.id || `shared-${r.key}`, url: r.ref } as Concert;
  concertRegistry.set(c.id, c);
  root.innerHTML = `<div class="page"><section class="page-head"><h1>${ct('ev.title')}</h1></section><div class="grid-posters">${posterCard(c)}</div><p class="sec"><a class="more" href="#/concerts">${esc(t('nav.concerts'))}${icon('i-chev-r', 'ic xs')}</a></p></div>`;
  openConcert(c.id);
}
