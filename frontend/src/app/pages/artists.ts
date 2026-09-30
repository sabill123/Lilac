import { safeExternal } from './_safety';
import { api } from '../../api';
import { state, buyerCurrency } from '../state';
import { t, getLocale } from '../i18n';
import { esc, icon, img, skeletonRows, skeletonCards, errorState, emptyState, genreLabel } from '../ui';
import { artistCard, posterCard, newsRow, goodsCard, followButton, bindFollow } from '../cards';
import type { ArtistLite, Concert, News, Offer } from '../cards';
import { playList, markPlaying, keyOf } from '../player';
import { fanclubSection } from '../fanclub';
import type { Fanclub } from '../fanclub';
import { params } from '../ui';
import type { Track } from '../player';
import { ct } from '../cm-i18n';
import { displayName } from '../fcguide';
import type { CmKey } from '../cm-i18n';
import { nickHtml, when } from '../social';

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

export async function renderArtists(root: HTMLElement, alive: () => boolean) {
  const ed = state.edition;
  root.innerHTML = `
    <section class="page-head"><h1>${t('a.title')}</h1></section>
    <div class="toolbar"><label class="find"><input type="search" id="aFind" placeholder="${t('a.find')}" autocomplete="off"></label><span class="count" id="aCount"></span></div>
    <div class="grid-artists" id="aGrid">${skeletonRows(18, 'sk-round')}</div>`;
  let items: ArtistLite[] = [];
  try {
    items = (await api(`/api/live/artists?edition=${ed}`)).items || [];
  } catch {
    if (!alive()) return;
    root.querySelector('#aGrid')!.innerHTML = errorState(t('err.generic'));
    root.querySelector('[data-retry]')?.addEventListener('click', () => renderArtists(root, alive));
    return;
  }
  if (!alive()) return;
  const grid = root.querySelector<HTMLElement>('#aGrid')!;
  const paint = (q = '') => {
    const rows = q ? items.filter((a) => norm(`${a.name} ${a.nameOriginal || ''}`).includes(norm(q))) : items;
    root.querySelector('#aCount')!.textContent = String(rows.length);
    grid.innerHTML = rows.length ? rows.map(artistCard).join('') : emptyState(t('empty.generic'));
  };
  paint();
  root.querySelector<HTMLInputElement>('#aFind')!.addEventListener('input', (e) => paint((e.target as HTMLInputElement).value.trim()));
}

interface Profile {
  id: string | null; name: string; names: string[]; origin: string; originSource: string | null; genre: string | null;
  appleArtistId: number | null; artwork: string | null; photo: { picture?: string; url?: string; fans?: number } | null;
  wiki: { title: string; extract: string; url: string; description: string | null; lang: string } | null;
  links: Record<string, { url: string }> | null; official: string | null; operator: string | null;
  concerts: Concert[];
  fanclub: Fanclub | null;
}

const LINK_LABEL: Record<string, string> = { official: '공식 사이트', x: 'X', twitter: 'X', instagram: 'Instagram', youtube: 'YouTube', spotify: 'Spotify', tiktok: 'TikTok', weverse: 'Weverse', appleMusic: 'Apple Music', apple: 'Apple Music', amazonJp: 'Amazon' };

export async function renderArtist(root: HTMLElement, alive: () => boolean, key: { id?: string; name?: string }) {
  const ed = state.edition;
  root.innerHTML = `<div class="sk sk-block"></div><div class="sec">${skeletonCards(4)}</div>`;
  const qs = key.id ? `id=${encodeURIComponent(key.id)}` : `name=${encodeURIComponent(key.name || '')}`;
  let p: Profile;
  try {
    p = await api(`/api/live/artist?${qs}&edition=${ed}`);
    if ((p as unknown as { error?: string }).error) throw new Error('nf');
  } catch {
    if (!alive()) return;
    root.innerHTML = errorState(t('err.generic'));
    root.querySelector('[data-retry]')?.addEventListener('click', () => renderArtist(root, alive, key));
    return;
  }
  const fx = await api('/api/live/fx').catch(() => null);
  if (!alive()) return;
  document.title = `${p.name} · Lilac`;
  const followId = p.id || `name:${p.name}`;
  const origin = p.origin === 'jp' || p.origin === 'kr' ? t(`a.origin.${p.origin}`) : p.origin === 'other' ? t('a.origin.other') : '';
  const links = Object.entries(p.links || {}).filter(([k, v]) => v?.url && LINK_LABEL[k]).slice(0, 7);
  const photo = p.photo?.picture || p.artwork;
  root.innerHTML = `<div class="artist-page">
    <section class="artist-head">
      <span class="artist-head-bg" aria-hidden="true"${photo ? ` style="background-image:url('${esc(photo).replace(/'/g, '%27')}')"` : ''}></span>
      ${img(photo, '', 'round xl', { ratio: '1/1', initial: p.name })}
      <div class="artist-id">
        <p class="kicker">${esc([origin, genreLabel(p.genre), p.operator].filter(Boolean).join(' · '))}</p>
        <h1>${esc(displayName(p.name, p.names))}</h1>
        ${p.names.filter((n) => n !== p.name).length ? `<p class="muted">${esc([...new Set(p.names.filter((n) => n !== p.name))].slice(0, 3).join(' · '))}</p>` : ''}
        <div class="artist-actions">${followButton(followId, p.name, '')}${p.id ? `<a class="alink is-gal" href="#/community/${encodeURIComponent(p.id)}">${icon('i-users', 'ic xs')}${esc(ct('gal', { name: '' }).trim())}</a>` : ''}
          ${links.map(([k, v]) => `<a class="alink" href="${esc(safeExternal(v.url))}" target="_blank" rel="noopener">${esc(k === 'official' && getLocale() === 'ja' ? '公式サイト' : LINK_LABEL[k])}${icon('i-ext', 'ic xs')}</a>`).join('')}
        </div>
      </div>
    </section>
    ${fanclubSection(p.fanclub, { id: p.id, name: p.name, photo }, fx)}
    ${p.wiki ? `<section class="sec about"><h2 class="side-h">${t('a.about')}</h2><p>${esc(p.wiki.extract)}</p><a class="muted small" href="${esc(safeExternal(p.wiki.url))}" target="_blank" rel="noopener">${t('a.wiki')}${icon('i-ext', 'ic xs')}</a></section>` : ''}
    <section class="sec"><div class="sec-head"><h2>${t('a.shows')}</h2></div>${p.concerts.length ? `<div class="grid-posters">${p.concerts.map(posterCard).join('')}</div>` : emptyState(t('a.noShows'))}</section>
    ${p.id ? `<section class="sec" id="arGal"><div class="sec-head"><h2>${esc(ct('gal', { name: p.name }))}</h2><a class="more" href="#/community/${encodeURIComponent(p.id)}">${ct('art.galleryGo')}${icon('i-chev-r', 'ic xs')}</a></div><div class="ar-gal">${skeletonRows(4, 'sk-line')}</div></section>` : ''}
    <div class="split">
      <section class="sec" id="arTracks"><div class="sec-head"><h2>${t('a.tracks')}</h2></div><ol class="clist compact">${skeletonRows(6, 'sk-line')}</ol></section>
      <section class="sec" id="arNews"><div class="sec-head"><h2>${t('a.news')}</h2></div><ul class="nlist">${skeletonRows(5)}</ul></section>
    </div>
    <section class="sec" id="arGoods"><div class="sec-head"><h2>${t('a.goods')}</h2><a class="more" href="#/goods?q=${encodeURIComponent(p.names.find((n) => /[A-Za-z]/.test(n)) || p.name)}">${t('more')}${icon('i-chev-r', 'ic xs')}</a></div><div class="grid-goods">${skeletonRows(6, 'sk-square')}</div></section></div>`;
  bindFollow(root);
  if (p.id) {
    const gid = p.id;
    api(`/api/community/b/${encodeURIComponent(gid)}?page=1`).then((r: { items: { no: number; head: string; title: string; nick: string; anon: boolean; tag: string | null; at: string; up: number; cmt: number; views: number }[] }) => {
      if (!alive()) return;
      const box = root.querySelector('#arGal .ar-gal');
      if (!box) return;
      const rows = (r.items || []).slice(0, 6);
      box.innerHTML = (rows.length ? `<ul class="mini-list">${rows.map((x) => `<li><a href="#/community/${encodeURIComponent(gid)}/${x.no}"><span class="mh">${esc(ct(`h.${x.head}` as CmKey))}</span><span class="mt">${esc(x.title)}</span>${x.cmt ? `<em class="rc">[${x.cmt}]</em>` : ''}</a>${nickHtml(x)}<time>${esc(when(x.at))}</time></li>`).join('')}</ul>` : `<p class="cm-empty">${ct('art.galleryEmpty')}</p>`) + `<p class="ar-gal-act"><a class="btn btn-solid sm" href="#/community/${encodeURIComponent(gid)}/write">${icon('i-pen', 'ic xs')}${ct('gal.write')}</a></p>`;
    }).catch(() => { if (alive()) { const box = root.querySelector('#arGal .ar-gal'); if (box) box.innerHTML = emptyState(t('err.generic')); } });
  }
  if (params().get('fc')) root.querySelector('#fanclub')?.scrollIntoView({ block: 'start' });

  // 인기곡 — 목록 아티스트는 저장된 카탈로그, 아니면 Apple 검색
  const tracksP = (p.id ? api(`/api/artist/${encodeURIComponent(p.id)}/tracks`).then((r) => r.popular || []) : Promise.reject())
    .catch(() => api(`/api/catalog/search?term=${encodeURIComponent(p.names.find((n) => /[A-Za-z぀-ヿ一-龯]/.test(n)) || p.name)}&country=${p.origin === 'kr' ? 'kr' : 'jp'}&limit=12`).then((r) => (r.tracks || []).filter((x: Track) => norm(x.artist).includes(norm(p.names.find((n) => /[A-Za-z぀-ヿ一-龯]/.test(n)) || p.name)) || p.names.some((n) => norm(x.artist) === norm(n)))))
    .catch(() => []);
  tracksP.then((list: (Track & { album?: string })[]) => {
    if (!alive()) return;
    const box = root.querySelector('#arTracks')!;
    const tracks: Track[] = list.slice(0, 10).map((x) => ({ title: x.title, artist: x.artist || p.name, artwork: x.artwork, preview: x.preview, appleUrl: x.appleUrl }));
    box.innerHTML = `<div class="sec-head"><h2>${t('a.tracks')}</h2></div>` + (tracks.length ? `<ol class="clist compact">${tracks.map((tr, i) => `<li class="crow" data-track-key="${esc(keyOf(tr))}"><span class="crow-rank">${i + 1}</span><button class="crow-art" data-play="${i}" aria-label="${esc(tr.title)}">${img(tr.artwork, tr.title, 'square', { ratio: '1/1' })}<span class="crow-play">${icon('i-play')}</span><span class="crow-eq"><i></i><i></i><i></i></span></button><div class="crow-main"><b>${esc(tr.title)}</b><span>${esc(tr.artist)}</span></div></li>`).join('')}</ol>` : emptyState(t('empty.generic')));
    box.querySelectorAll<HTMLElement>('[data-play]').forEach((b) => b.addEventListener('click', () => playList(tracks, Number(b.dataset.play))));
    markPlaying();
  });

  api(`/api/live/news?edition=${ed}&artist=${encodeURIComponent(p.id || p.name)}`).then((r: { items: News[] }) => {
    if (!alive()) return;
    const items = (r.items || []).slice(0, 8);
    root.querySelector('#arNews')!.innerHTML = `<div class="sec-head"><h2>${t('a.news')}</h2></div>` + (items.length ? `<ul class="nlist">${items.map(newsRow).join('')}</ul>` : emptyState(t('empty.generic')));
  }).catch(() => { if (alive()) root.querySelector('#arNews')!.innerHTML = `<div class="sec-head"><h2>${t('a.news')}</h2></div>` + emptyState(t('err.generic')); });

  const goodsQ = p.names.find((n) => /[A-Za-z]/.test(n)) || p.name;
  const market = p.origin === 'kr' ? 'jp' : 'kr';
  Promise.all([api(`/api/live/goods?q=${encodeURIComponent(goodsQ)}&market=${ed === 'all' ? market : ed}`), api('/api/live/fx').catch(() => null)]).then(([r, fx]: [{ items: Offer[] }, { jpyKrw?: number } | null]) => {
    if (!alive()) return;
    const items = (r.items || []).slice(0, 8);
    root.querySelector('#arGoods')!.innerHTML = `<div class="sec-head"><h2>${t('a.goods')}</h2><a class="more" href="#/goods?q=${encodeURIComponent(goodsQ)}">${t('more')}${icon('i-chev-r', 'ic xs')}</a></div>` + (items.length ? `<div class="grid-goods">${items.map((g) => goodsCard(g, fx, buyerCurrency())).join('')}</div>` : emptyState(t('g.noResult')));
  }).catch(() => { if (alive()) { const box = root.querySelector('#arGoods .grid-goods'); if (box) box.innerHTML = emptyState(t('err.generic')); } });
}
