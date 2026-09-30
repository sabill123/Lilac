/* 커뮤니티 — 팬 앱(Weverse 커뮤니티) 화면 + 디시 갤러리의 규칙(말머리·개념글·익명 ㅇㅇ·추천/비추)
   #/community              내 커뮤니티 · 커뮤니티 둘러보기 · 인기/최신 피드 · 종합 게시판
   #/community/list         전체 커뮤니티
   #/community/<id>         커버 · 탭(피드/개념글) · 말머리 칩 · 글쓰기 입력줄 · 피드 카드 · 더 보기
   #/community/<id>/<no>    글 상세(작성자 · 본문 · 추천/비추 · 공유 · 댓글)
   #/community/<id>/write   글쓰기 */
import { api } from '../../api';
import { state, sessionReady } from '../state';
import { t } from '../i18n';
import { esc, icon, img, toast, skeletonRows, errorState, params } from '../ui';
import { ct } from '../cm-i18n';
import type { CmKey } from '../cm-i18n';
import { artistName, posterCard } from '../cards';
import type { Concert } from '../cards';
import { bindComments, commentsHtml, when, linkify, openShare, shareUrl, loginHref, copyText, avatar } from '../social';
import type { Cmt } from '../social';

interface GArtist { id: string; name: string; nameOriginal?: string | null; nameKo?: string | null; nameJa?: string | null; origin?: string; photo?: string | null; artwork?: string | null; chartHits?: number }
interface Gal { id: string; kind: 'general' | 'artist'; artist?: GArtist }
interface Board extends Gal { heads: string[]; posts?: number; bestMin: number }
interface Thumb { src: string; w: number | null; h: number | null }
interface Row { board: string; no: number; head: string; title: string; nick: string; anon: boolean; tag: string | null; at: string; views: number; up: number; cmt: number; img: boolean; excerpt?: string; thumbs?: Thumb[]; imgCount?: number; gallery?: Gal }
interface Post extends Row { body: string; images: Thumb[]; down: number; mine: boolean }

const enc = encodeURIComponent;
const gname = (g: Gal | undefined) => !g ? '' : g.kind === 'general' ? ct(`g.${g.id}` as CmKey) : artistName(g.artist!);
const galHref = (id: string, q: Record<string, string | number | undefined> = {}) => {
  const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== 1 && v !== 'all').map(([k, v]) => [k, String(v)])).toString();
  return `#/community/${enc(id)}${s ? `?${s}` : ''}`;
};
const photoOf = (a?: GArtist) => a?.photo || a?.artwork || null;

export async function renderCommunity(root: HTMLElement, alive: () => boolean, a?: string, b?: string) {
  await Promise.race([sessionReady, new Promise((r) => setTimeout(r, 2500))]);
  if (!alive()) return;
  document.title = `${ct('hub.title')} · Lilac`;
  if (!a) return renderHub(root, alive);
  if (a === 'list') return renderDir(root, alive);
  if (b === 'write') return renderWrite(root, alive, a);
  if (b && /^\d+$/.test(b)) return renderPost(root, alive, a, Number(b));
  return renderBoard(root, alive, a);
}

/* ---------- 조각 ---------- */
const who = (x: { nick: string; anon: boolean; tag: string | null }) => `<b class="who-n">${esc(x.nick)}${x.tag ? `<em>(${esc(x.tag)})</em>` : ''}</b>`;

function media(thumbs: Thumb[] = [], count = 0) {
  if (!thumbs.length) return '';
  const n = Math.min(thumbs.length, 4);
  return `<div class="pc-media n${n}">${thumbs.slice(0, n).map((x, i) => `<span class="pc-img"><img src="${esc(x.src)}" alt="" loading="lazy" decoding="async">${i === n - 1 && count > n ? `<b>+${count - n}</b>` : ''}</span>`).join('')}</div>`;
}

function card(r: Row, { showGallery = false, bestMin = 3 } = {}) {
  const href = `#/community/${enc(r.board)}/${r.no}`;
  return `<article class="pc">
    ${showGallery && r.gallery ? `<a class="pc-gal" href="${galHref(r.board)}">${r.gallery.artist ? img(photoOf(r.gallery.artist), '', 'round', { ratio: '1/1', initial: r.gallery.artist.name }) : ''}<span>${esc(gname(r.gallery))}</span></a>` : ''}
    <div class="pc-top">${avatar(r.nick, r.anon)}<div class="pc-who">${who(r)}<span><time datetime="${esc(r.at)}">${esc(when(r.at))}</time> · ${esc(ct(`h.${r.head}` as CmKey))}</span></div>${r.up >= bestMin ? `<span class="pc-best">${ct('gal.best')}</span>` : ''}</div>
    <a class="pc-main" href="${href}">
      <h3>${esc(r.title)}</h3>
      ${r.excerpt ? `<p>${esc(r.excerpt)}</p>` : ''}
      ${media(r.thumbs, r.imgCount)}
    </a>
    <div class="pc-foot"><a href="${href}">${icon('i-up', 'ic')}<span>${r.up}</span></a><a href="${href}#cmts">${icon('i-comment', 'ic')}<span>${r.cmt}</span></a><span class="pc-views">${ct('post.views')} ${r.views}</span></div>
  </article>`;
}

function cover(b: Board, tab: 'feed' | 'best' | 'post' | 'write') {
  const a = b.artist;
  const ph = photoOf(a);
  return `<header class="cv${a ? ' is-artist' : ' is-general'}">
    <div class="cv-cover">${ph ? `<span class="cv-bg" style="background-image:url('${esc(ph).replace(/'/g, '%27')}')"></span>` : ''}</div>
    <div class="cv-bar">
      ${a ? img(ph, '', 'round cv-av', { ratio: '1/1', initial: a.name }) : `<span class="cv-av cv-g" aria-hidden="true">${esc(gname(b).slice(0, 1))}</span>`}
      <div class="cv-id">
        <h1><a href="${galHref(b.id)}">${esc(gname(b))}</a></h1>
        <p>${b.kind === 'general' ? esc(ct(`g.${b.id}.d` as CmKey)) : esc(ct('cv.kind'))}${typeof b.posts === 'number' ? ` · ${ct('gal.posts', { n: b.posts })}` : ''}</p>
      </div>
      <div class="cv-acts">
        <a class="btn btn-solid" href="#/community/${enc(b.id)}/write">${icon('i-pen', 'ic xs')}${ct('gal.write')}</a>
        <button type="button" class="btn btn-line icon-sq" data-copy-gal aria-label="${ct('gal.copy')}">${icon('i-link', 'ic')}</button>
        <button type="button" class="btn btn-line icon-sq" data-rules aria-label="${ct('gal.rules')}">${icon('i-info', 'ic')}</button>
      </div>
    </div>
    <nav class="cv-tabs" aria-label="${esc(gname(b))}">
      <a href="${galHref(b.id)}" class="${tab === 'feed' || tab === 'post' ? 'on' : ''}">${ct('cv.feed')}</a>
      <a href="${galHref(b.id, { mode: 'best' })}" class="${tab === 'best' ? 'on' : ''}">${ct('gal.best')}</a>
      ${a ? `<a href="#/artist/${enc(a.id)}">${ct('cv.artist')}</a><a href="#/fanclub/${enc(a.id)}">${t('nav.fanclub')}</a>` : ''}
    </nav>
  </header>`;
}

function bindCover(root: HTMLElement, b: Board) {
  root.querySelector('[data-copy-gal]')?.addEventListener('click', async () => { if (await copyText(shareUrl(galHref(b.id)))) toast(ct('gal.copied')); });
  root.querySelector('[data-rules]')?.addEventListener('click', () => openRules(b.bestMin));
}

function openRules(bestMin: number) {
  const d = document.createElement('dialog');
  d.className = 'rules';
  d.innerHTML = `<form method="dialog"><h2>${ct('rules.title')}</h2><ol>${(['rules.1', 'rules.2', 'rules.3', 'rules.4', 'rules.5', 'rules.6'] as CmKey[]).map((k) => `<li>${esc(ct(k, { n: bestMin }))}</li>`).join('')}</ol><button class="btn btn-solid">${t('close')}</button></form>`;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
}

/* 오른쪽 칸: 아티스트면 다가오는 공연·팬클럽 상품 카드, 종합이면 다른 게시판 */
async function fillSide(side: HTMLElement, b: Board, alive: () => boolean) {
  if (!b.artist) {
    side.innerHTML = `<section class="sbox"><h2>${ct('hub.general')}</h2><ul class="sbox-links">${['free', 'ticket', 'fanclub'].map((id) => `<li><a href="${galHref(id)}" class="${id === b.id ? 'on' : ''}"><b>${ct(`g.${id}` as CmKey)}</b><span>${ct(`g.${id}.d` as CmKey)}</span></a></li>`).join('')}</ul></section>
      <section class="sbox"><h2>${ct('side.guide')}</h2><ul class="sbox-links"><li><a href="#/guide/jp"><b>${esc(t('gd.tab.jp'))}</b></a></li><li><a href="#/guide/kr"><b>${esc(t('gd.tab.kr'))}</b></a></li><li><a href="#/guide/fc"><b>${esc(t('gd.tab.fc'))}</b></a></li></ul></section>`;
    return;
  }
  side.innerHTML = `<section class="sbox">${skeletonRows(3, 'sk-line')}</section>`;
  const p = await api(`/api/live/artist?id=${enc(b.artist.id)}&edition=${state.edition}`).catch(() => null);
  if (!alive()) return;
  const shows: Concert[] = (p?.concerts || []).slice(0, 2);
  const fc = p?.fanclub;
  const ff = fc?.facts || null;
  const ovs = ff?.residence?.overseas;
  const price = ovs?.annual ? (ovs.annual.cur === 'USD' ? `${ovs.annual.v} USD` : `¥${ovs.annual.v.toLocaleString()}`) : ff?.fees?.annual ? `¥${ff.fees.annual.toLocaleString()}` : '';
  side.innerHTML = `
    ${fc ? `<a class="sbox fc-mini" href="#/fanclub/${enc(b.artist.id)}">
      ${img(ff?.image || photoOf(b.artist), '', 'fc-mini-img', { ratio: '1/1', initial: fc.name || b.artist.name })}
      <span class="fc-mini-t"><em>${esc(t('fc.official'))}</em><b>${esc(fc.name || ff?.name || t('fc.official'))}</b>${price ? `<span>${esc(t('fc.annual'))} ${esc(price)}${ovs?.annual ? ` · ${esc(t('fcl.ovs'))}` : ''}</span>` : ''}${ff?.overseas === 'yes' ? `<span class="ok">${esc(t('fc.overseas.yes2'))}</span>` : ff?.overseas === 'no' ? `<span>${esc(t('fc.overseas.no2'))}</span>` : ''}</span>
    </a>` : ''}
    <section class="sbox"><h2>${ct('side.shows')}</h2>${shows.length ? `<ul class="side-shows">${shows.map((c) => `<li>${posterCard(c)}</li>`).join('')}</ul>` : `<p class="side-empty">${ct('side.none')}</p>`}</section>`;
}

/* ---------- 허브 ---------- */
async function renderHub(root: HTMLElement, alive: () => boolean) {
  const sort = params().get('sort') === 'new' ? 'new' : 'hot';
  root.innerHTML = `<div class="page cm cm-hub">
    <h1 class="sr-only">${ct('hub.title')}</h1>
    <section class="hub-mine" id="hubMine"></section>
    <section class="sec hub-explore"><div class="sec-head"><h2>${ct('hub.explore')}</h2><a class="more" href="#/community/list">${t('more')}</a></div><ul class="cm-grid" id="hubGrid">${'<li class="sk sk-square"></li>'.repeat(8)}</ul></section>
    <div class="cm-layout">
      <div class="feed">
        <div class="feed-head"><h2>${ct('hub.feed')}</h2><nav class="feed-sort"><a href="#/community" class="${sort === 'hot' ? 'on' : ''}">${ct('hub.hot')}</a><a href="#/community?sort=new" class="${sort === 'new' ? 'on' : ''}">${ct('hub.new')}</a></nav></div>
        <div id="hubFeed">${skeletonRows(4, 'sk-block')}</div>
      </div>
      <aside class="cm-side" id="hubSide"></aside>
    </div>
  </div>`;
  const [r, g] = await Promise.all([
    api(`/api/community/hub?edition=${state.edition}`).catch(() => null),
    api(`/api/community/galleries?edition=${state.edition}`).catch(() => null),
  ]);
  if (!alive()) return;
  const all: { id: string; artist: GArtist; posts: number; week: number }[] = g?.items || [];
  const mine = state.follows.filter((f) => !f.artistId.startsWith('name:'));
  const byId = new Map(all.map((x) => [x.id, x]));
  root.querySelector('#hubMine')!.innerHTML = `<h2>${ct('hub.mine')}</h2>${!state.me
    ? `<p class="hub-login"><a href="${loginHref()}">${ct('hub.mineLogin')}</a></p>`
    : mine.length
      ? `<ul class="av-row">${mine.slice(0, 14).map((f) => { const x = byId.get(f.artistId); return `<li><a href="${galHref(f.artistId)}">${img(photoOf(x?.artist), '', 'round', { ratio: '1/1', initial: f.name })}<span>${esc(x ? artistName(x.artist) : f.name)}</span></a></li>`; }).join('')}<li><a class="av-more" href="#/community/list"><span class="av-plus">${icon('i-plus')}</span><span>${ct('hub.add')}</span></a></li></ul>`
      : `<p class="hub-login"><a href="#/community/list">${ct('hub.mineEmpty')}</a></p>`}`;
  root.querySelector('#hubGrid')!.innerHTML = all.slice(0, 12).map((x) => `<li><a class="cg" href="${galHref(x.id)}">${img(photoOf(x.artist), '', 'cg-img', { ratio: '1/1', initial: x.artist.name })}<b>${esc(artistName(x.artist))}</b><span>${x.posts ? ct('gal.posts', { n: x.posts }) : ct('cv.kind')}</span></a></li>`).join('');
  const feed = root.querySelector('#hubFeed')!;
  if (!r) { feed.innerHTML = `<p class="cm-empty">${esc(t('err.generic'))}</p>`; return; }
  const rows: Row[] = sort === 'hot' ? (r.best?.length ? r.best : r.recent || []) : r.recent || [];
  feed.innerHTML = rows.length
    ? `${sort === 'hot' && !r.best?.length ? `<p class="feed-note">${esc(ct('hub.noBest', { n: r.bestMin }))}</p>` : ''}${rows.map((x) => card(x, { showGallery: true, bestMin: r.bestMin })).join('')}`
    : `<div class="feed-empty"><p>${ct('hub.noRecent')}</p><a class="btn btn-solid" href="${galHref('free')}/write">${icon('i-pen', 'ic xs')}${ct('gal.write')}</a></div>`;
  const general: { id: string; posts: number }[] = r.general || [];
  const ranked: (Gal & { week: number; posts: number })[] = r.ranked || [];
  root.querySelector('#hubSide')!.innerHTML = `
    <section class="sbox"><h2>${ct('hub.general')}</h2><ul class="sbox-links">${general.map((x) => `<li><a href="${galHref(x.id)}"><b>${ct(`g.${x.id}` as CmKey)}</b><span>${ct(`g.${x.id}.d` as CmKey)}</span></a><em>${x.posts}</em></li>`).join('')}</ul></section>
    <section class="sbox"><h2>${ct('hub.ranked')}</h2>${ranked.length ? `<ol class="sbox-rank">${ranked.slice(0, 8).map((x, i) => `<li><span class="rk">${i + 1}</span><a href="${galHref(x.id)}">${x.artist ? img(photoOf(x.artist), '', 'round', { ratio: '1/1', initial: x.artist.name }) : ''}<b>${esc(gname(x))}</b></a><em>${x.week}</em></li>`).join('')}</ol>` : `<p class="side-empty">${ct('hub.noRanked')}</p>`}</section>`;
}

/* ---------- 전체 커뮤니티 ---------- */
async function renderDir(root: HTMLElement, alive: () => boolean) {
  const q0 = params().get('q') || '';
  root.innerHTML = `<div class="page cm">
    <div class="dir-top"><h1>${ct('dir.title')}</h1>
      <label class="dir-find">${icon('i-search')}<input type="search" id="dirQ" value="${esc(q0)}" placeholder="${ct('dir.ph')}" aria-label="${ct('dir.ph')}" autocomplete="off"></label></div>
    <div class="dir-tools"><div class="chips" role="group"><button type="button" class="chip on" data-sort="hot">${ct('dir.hot')}</button><button type="button" class="chip" data-sort="name">${ct('dir.name')}</button></div><span class="count" id="dirN"></span></div>
    <ul class="cm-grid is-dir" id="dirList">${'<li class="sk sk-square"></li>'.repeat(12)}</ul>
  </div>`;
  const r = await api(`/api/community/galleries?edition=${state.edition}`).catch(() => null);
  if (!alive()) return;
  if (!r) {
    root.querySelector('#dirList')!.innerHTML = errorState(t('err.generic'));
    root.querySelector('[data-retry]')?.addEventListener('click', () => renderDir(root, alive));
    return;
  }
  const all: { id: string; artist: GArtist; posts: number; week: number }[] = r.items || [];
  let sort = 'hot';
  const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const paint = () => {
    const q = norm((root.querySelector<HTMLInputElement>('#dirQ')!.value || '').trim());
    let rows = q ? all.filter((x) => norm([x.artist.name, x.artist.nameOriginal, x.artist.nameKo, x.artist.nameJa].filter(Boolean).join(' ')).includes(q)) : all.slice();
    if (sort === 'name') rows = rows.sort((a, b) => artistName(a.artist).localeCompare(artistName(b.artist)));
    root.querySelector('#dirN')!.textContent = ct('dir.count', { n: rows.length });
    const general = !q ? ['free', 'ticket', 'fanclub'].map((id) => `<li><a class="cg is-general" href="${galHref(id)}"><span class="cg-img cg-g"><b>${esc(ct(`g.${id}` as CmKey))}</b></span><b>${esc(ct(`g.${id}` as CmKey))}</b><span>${esc(ct(`g.${id}.d` as CmKey))}</span></a></li>`).join('') : '';
    root.querySelector('#dirList')!.innerHTML = (!general && !rows.length ? `<li class="cm-empty">${esc(ct('empty.search'))}</li>` : general) + rows.map((x) => `<li><a class="cg" href="${galHref(x.id)}">${img(photoOf(x.artist), '', 'cg-img', { ratio: '1/1', initial: x.artist.name })}<b>${esc(artistName(x.artist))}</b><span>${x.posts ? ct('gal.posts', { n: x.posts }) : ct('cv.kind')}</span></a></li>`).join('');
  };
  paint();
  root.querySelector('#dirQ')!.addEventListener('input', paint);
  root.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    sort = b.dataset.sort!;
    root.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('on', x === b));
    paint();
  }));
}

/* ---------- 갤러리(커뮤니티) ---------- */
async function renderBoard(root: HTMLElement, alive: () => boolean, id: string) {
  const q = params();
  const head = q.get('head') || '';
  const mode = q.get('mode') === 'best' ? 'best' : 'all';
  const qq = q.get('q') || '';
  root.innerHTML = `<div class="page cm cm-board">${skeletonRows(6, 'sk-block')}</div>`;
  const load = (page: number) => api(`/api/community/b/${enc(id)}?${new URLSearchParams({ page: String(page), head, mode, q: qq, field: 'all' })}`);
  const r = await load(1).catch((e) => ({ error: e.message }));
  if (!alive()) return;
  if (r.error) { root.innerHTML = `<div class="page cm"><div class="feed-empty"><p>${esc(r.error)}</p><a class="btn btn-line" href="#/community">${ct('hub.title')}</a></div></div>`; return; }
  const b: Board = r.board;
  document.title = `${gname(b)} · ${ct('hub.title')} · Lilac`;
  const empty = mode === 'best' ? ct('empty.best', { n: b.bestMin }) : qq ? ct('empty.search') : ct('empty.board');
  root.innerHTML = `<div class="page cm cm-board">
    ${cover(b, mode === 'best' ? 'best' : 'feed')}
    <div class="cm-layout"><div class="feed">
      ${state.me ? `<a class="compose" href="#/community/${enc(b.id)}/write">${avatar(state.me.name, false, 40)}<span>${esc(ct('cv.compose', { name: gname(b) }))}</span>${icon('i-image', 'ic')}</a>` : `<a class="compose" href="${loginHref()}">${avatar('?', true, 40)}<span>${ct('wr.login')}</span></a>`}
      <div class="feed-filter">
        <div class="chips" role="group" aria-label="${ct('col.head')}">${['', ...b.heads].map((h) => `<a class="chip ${h === head ? 'on' : ''}" href="${galHref(b.id, { head: h, mode: mode === 'best' ? 'best' : undefined })}">${ct((h ? `h.${h}` : 'h.all') as CmKey)}</a>`).join('')}</div>
        <form class="feed-search" role="search"><input type="search" name="q" value="${esc(qq)}" placeholder="${ct('search.ph')}" aria-label="${ct('search.ph')}">${icon('i-search')}</form>
      </div>
      <div class="feed-list">${r.items.length ? r.items.map((x: Row) => card(x, { bestMin: b.bestMin })).join('') : `<div class="feed-empty"><p>${esc(empty)}</p>${mode !== 'best' && !qq ? `<a class="btn btn-solid" href="#/community/${enc(b.id)}/write">${icon('i-pen', 'ic xs')}${ct('gal.write')}</a>` : ''}</div>`}</div>
      ${r.page < r.pages ? `<button type="button" class="btn btn-line feed-more" data-next="2">${ct('cv.more')}</button>` : ''}
    </div><aside class="cm-side" id="galSide"></aside></div>
  </div>`;
  bindCover(root, b);
  root.querySelector<HTMLFormElement>('.feed-search')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = String(new FormData(e.target as HTMLFormElement).get('q') || '').trim();
    location.hash = galHref(b.id, { q: v, head, mode: mode === 'best' ? 'best' : undefined });
  });
  const more = root.querySelector<HTMLButtonElement>('.feed-more');
  more?.addEventListener('click', async () => {
    const pg = Number(more.dataset.next);
    more.disabled = true;
    const n = await load(pg).catch(() => null);
    more.disabled = false;
    if (!alive()) return;
    if (!n) { toast(t('err.generic')); return; }
    root.querySelector('.feed-list')!.insertAdjacentHTML('beforeend', n.items.map((x: Row) => card(x, { bestMin: b.bestMin })).join(''));
    if (n.page < n.pages) more.dataset.next = String(pg + 1); else more.remove();
  });
  void fillSide(root.querySelector('#galSide')!, b, alive);
}

/* ---------- 글 상세 ---------- */
function bodyHtml(body: string, images: Thumb[]) {
  const used = new Set<number>();
  const fig = (i: number) => {
    const im = images[i];
    if (!im || used.has(i)) return '';
    used.add(i);
    return `<figure class="pd-img"><img src="${esc(im.src)}" alt="" loading="lazy" decoding="async"${im.w && im.h ? ` width="${im.w}" height="${im.h}"` : ''}></figure>`;
  };
  const parts = String(body || '').split(/\[(?:사진|写真|img) ?(\d{1,2})\]/);
  let html = '';
  parts.forEach((part, i) => {
    if (i % 2 === 1) html += fig(Number(part) - 1);
    else if (part.trim()) html += `<p>${linkify(part.replace(/^\n+|\n+$/g, ''))}</p>`;
  });
  images.forEach((_, i) => { html += fig(i); });
  return html;
}

async function renderPost(root: HTMLElement, alive: () => boolean, id: string, no: number) {
  root.innerHTML = `<div class="page cm cm-board">${skeletonRows(6, 'sk-block')}</div>`;
  const [v, l] = await Promise.all([
    api(`/api/community/b/${enc(id)}/${no}`).catch((e) => ({ error: e.message })),
    api(`/api/community/b/${enc(id)}?page=1`).catch(() => null),
  ]);
  if (!alive()) return;
  if (v.error) { root.innerHTML = `<div class="page cm"><div class="feed-empty"><p>${esc(v.error)}</p><a class="btn btn-line" href="${galHref(id)}">${ct('post.list')}</a></div></div>`; return; }
  const b: Board = { ...v.board, posts: l?.board?.posts };
  const p: Post = v.post;
  let my: number = v.myVote || 0;
  document.title = `${p.title} · ${gname(b)}`;
  const others: Row[] = (l?.items || []).filter((x: Row) => x.no !== no).slice(0, 5);
  root.innerHTML = `<div class="page cm cm-board">
    ${cover(b, 'post')}
    <div class="cm-layout"><div class="feed">
      <article class="pd">
        <div class="pd-top">${avatar(p.nick, p.anon, 44)}<div class="pd-who">${who(p)}<span><time datetime="${esc(p.at)}">${esc(when(p.at, true))}</time> · ${ct('post.views')} ${p.views}</span></div>
          <span class="pd-head">${esc(ct(`h.${p.head}` as CmKey))}</span>
          <div class="pd-menu"><button type="button" class="icon-btn" data-menu aria-label="${ct('post.more')}" aria-haspopup="menu">${icon('i-dots', 'ic')}</button>
            <div class="pd-pop" role="menu" hidden><button type="button" role="menuitem" data-report>${ct('post.report')}</button>${p.mine ? `<button type="button" role="menuitem" data-del class="danger">${ct('post.del')}</button>` : ''}</div></div>
        </div>
        <h1 class="pd-title">${esc(p.title)}</h1>
        <div class="pd-body">${bodyHtml(p.body, p.images)}</div>
        <div class="pd-acts">
          <button type="button" class="vote" data-vote="1" aria-pressed="${my === 1}">${icon('i-up', 'ic')}<span>${ct('post.up')}</span><b>${p.up}</b></button>
          <button type="button" class="vote is-down" data-vote="-1" aria-pressed="${my === -1}">${icon('i-down', 'ic')}<span>${ct('post.down')}</span><b>${p.down}</b></button>
          <span class="sp"></span>
          <button type="button" class="vote is-plain" data-share>${icon('i-share', 'ic')}<span>${ct('post.share')}</span></button>
        </div>
      </article>
      <section class="pd-cmts" id="cmts">${commentsHtml()}</section>
      ${others.length ? `<section class="pd-more"><h2>${esc(ct('pd.more', { name: gname(b) }))}</h2>${others.map((x) => card(x, { bestMin: b.bestMin })).join('')}<a class="btn btn-line feed-more" href="${galHref(b.id)}">${ct('post.list')}</a></section>` : ''}
    </div><aside class="cm-side" id="galSide"></aside></div>
  </div>`;
  bindCover(root, b);
  const votes = root.querySelectorAll<HTMLButtonElement>('[data-vote]');
  let voting = false;
  votes.forEach((btn) => btn.addEventListener('click', async () => {
    if (!state.me) { toast(ct('vote.login')); location.hash = loginHref(); return; }
    if (voting) return;
    voting = true;
    votes.forEach((b) => { b.disabled = true; });
    const r = await api(`/api/community/b/${enc(id)}/${no}/vote`, { method: 'POST', body: JSON.stringify({ v: Number(btn.dataset.vote) }) }).catch((e) => { toast(e.message); return null; });
    voting = false;
    votes.forEach((b) => { b.disabled = false; });
    if (!r || !alive()) return;
    my = r.mine;
    votes[0].querySelector('b')!.textContent = String(r.up);
    votes[1].querySelector('b')!.textContent = String(r.down);
    votes[0].setAttribute('aria-pressed', String(my === 1));
    votes[1].setAttribute('aria-pressed', String(my === -1));
  }));
  root.querySelector<HTMLElement>('[data-share]')!.addEventListener('click', (e) => { e.stopPropagation(); openShare(e.currentTarget as HTMLElement, shareUrl(`#/community/${enc(id)}/${no}`), `${p.title} · ${gname(b)}`); });
  const menuBtn = root.querySelector<HTMLButtonElement>('[data-menu]')!;
  const pop = root.querySelector<HTMLElement>('.pd-pop')!;
  const closeMenu = () => { pop.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); };
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    menuBtn.setAttribute('aria-expanded', String(!pop.hidden));
    if (!pop.hidden) setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
  });
  root.querySelector('[data-report]')!.addEventListener('click', async () => {
    if (!state.me) { location.hash = loginHref(); return; }
    if (!confirm(ct('post.reportConfirm'))) return;
    await api(`/api/community/b/${enc(id)}/${no}/report`, { method: 'POST', body: JSON.stringify({}) }).then(() => toast(ct('post.reported'))).catch((e) => toast(e.message));
  });
  root.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!confirm(ct('post.delConfirm'))) return;
    await api(`/api/community/b/${enc(id)}/${no}`, { method: 'DELETE' }).then(() => { toast(ct('post.deleted')); location.hash = galHref(id); }).catch((e) => toast(e.message));
  });
  void bindComments(root.querySelector<HTMLElement>('#cmts .cmts')!, {
    allowAnon: true,
    load: async () => ((await api(`/api/community/b/${enc(id)}/${no}/comments`)).items || []) as Cmt[],
    add: (body, parent, anon) => api(`/api/community/b/${enc(id)}/${no}/comments`, { method: 'POST', body: JSON.stringify({ body, parent, anon }) }),
    remove: (cid) => api(`/api/community/b/${enc(id)}/${no}/comments/${cid}`, { method: 'DELETE' }),
  });
  if (location.hash.includes('#cmts')) root.querySelector('#cmts')?.scrollIntoView({ block: 'start' });
  void fillSide(root.querySelector('#galSide')!, b, alive);
}

/* ---------- 글쓰기 ---------- */
interface Pic { data: string; w: number; h: number; url: string }
const MAX_PICS = 6;
const MAX_BYTES = 3 * 1024 * 1024;

async function toPic(file: File): Promise<Pic> {
  const dims = (src: string) => new Promise<{ w: number; h: number }>((res, rej) => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = rej; im.src = src; });
  const readUrl = (f: Blob) => new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(f); });
  if (file.type === 'image/gif') {
    if (file.size > MAX_BYTES) throw new Error(ct('wr.tooBig'));
    const data = await readUrl(file);
    return { data, ...(await dims(data)), url: data };
  }
  /* 큰 사진은 긴 변 1600px JPEG 로 줄여 보낸다(휴대폰 원본 10MB도 받게) */
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  cv.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  let data = cv.toDataURL('image/jpeg', 0.86);
  if (data.length * 0.75 > MAX_BYTES) data = cv.toDataURL('image/jpeg', 0.7);
  if (data.length * 0.75 > MAX_BYTES) throw new Error(ct('wr.tooBig'));
  return { data, w, h, url: data };
}

async function renderWrite(root: HTMLElement, alive: () => boolean, id: string) {
  root.innerHTML = `<div class="page cm cm-board">${skeletonRows(4, 'sk-block')}</div>`;
  const r = await api(`/api/community/b/${enc(id)}?page=1`).catch((e) => ({ error: e.message }));
  if (!alive()) return;
  if (r.error) { root.innerHTML = `<div class="page cm"><div class="feed-empty"><p>${esc(r.error)}</p></div></div>`; return; }
  const b: Board = r.board;
  if (!state.me) {
    root.innerHTML = `<div class="page cm cm-board">${cover(b, 'write')}<div class="feed-empty"><p>${ct('wr.login')}</p><a class="btn btn-solid" href="${loginHref()}">${t('nav.login')}</a></div></div>`;
    bindCover(root, b);
    return;
  }
  const marker = (n: number) => `[${ct('wr.marker')}${n}]`;
  root.innerHTML = `<div class="page cm cm-board">
    ${cover(b, 'write')}
    <form class="wr" novalidate>
      <div class="wr-top">${avatar(state.me.name, false, 40)}<div><b>${esc(state.me.name)}</b><span>${esc(ct('cv.to', { name: gname(b) }))}</span></div></div>
      <fieldset class="wr-heads"><legend class="sr-only">${ct('wr.head')}</legend>${b.heads.map((h, i) => `<label class="chip-radio"><input type="radio" name="head" value="${h}" ${i === 0 ? 'checked' : ''}><span>${esc(ct(`h.${h}` as CmKey))}</span></label>`).join('')}</fieldset>
      <input class="wr-title" name="title" maxlength="60" placeholder="${ct('wr.titlePh')}" aria-label="${ct('wr.titlePh')}" required autocomplete="off">
      <textarea class="wr-body" name="body" rows="12" maxlength="8000" placeholder="${ct('wr.bodyPh')}" aria-label="${ct('wr.bodyPh')}"></textarea>
      <ul class="wr-pics" aria-live="polite"></ul>
      <div class="wr-bar">
        <label class="icon-btn wr-pick" aria-label="${ct('wr.photo')}">${icon('i-image', 'ic')}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden></label>
        <span class="wr-note">${ct('wr.photoNote')}</span>
        <span class="sp"></span>
        <label class="switch"><input type="checkbox" name="anon"><span class="switch-ui" aria-hidden="true"></span>${ct('wr.anonShort')}</label>
        <button class="btn btn-solid">${ct('wr.submit')}</button>
      </div>
      <p class="form-err" role="alert"></p>
    </form>
  </div>`;
  bindCover(root, b);
  const form = root.querySelector<HTMLFormElement>('.wr')!;
  const ta = form.querySelector<HTMLTextAreaElement>('textarea')!;
  const list = form.querySelector<HTMLElement>('.wr-pics')!;
  const err = form.querySelector<HTMLElement>('.form-err')!;
  const pics: Pic[] = [];
  let uploading = false;
  let sending = false;
  const paintPics = () => {
    list.innerHTML = pics.map((p, i) => `<li><img src="${esc(p.url)}" alt=""><span>${esc(marker(i + 1))}</span><button type="button" data-rm="${i}" aria-label="${ct('wr.remove')}">${icon('i-close', 'ic xs')}</button></li>`).join('');
    list.querySelectorAll<HTMLButtonElement>('[data-rm]').forEach((btn) => btn.addEventListener('click', () => {
      const i = Number(btn.dataset.rm);
      pics.splice(i, 1);
      /* 뺀 사진의 표시는 지우고, 뒤 번호는 하나씩 당긴다 */
      ta.value = ta.value.replace(/\[(?:사진|写真) ?(\d{1,2})\]\n?/g, (m, n) => { const k = Number(n) - 1; return k === i ? '' : k > i ? `${marker(k)}${m.endsWith('\n') ? '\n' : ''}` : m; });
      paintPics();
    }));
  };
  form.querySelector<HTMLInputElement>('input[type=file]')!.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    if (uploading || sending) return;
    uploading = true;
    input.disabled = true;
    const submit = form.querySelector<HTMLButtonElement>('button.btn-solid')!;
    submit.disabled = true;
    const files = Array.from(input.files || []);
    input.value = '';
    for (const f of files) {
      if (pics.length >= MAX_PICS) { toast(ct('wr.tooMany')); break; }
      try {
        if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) throw new Error(ct('wr.tooBig'));
        const p = await toPic(f);
        if (!alive()) break;
        pics.push(p);
        const at = ta.selectionStart ?? ta.value.length;
        const ins = `${at && ta.value[at - 1] !== '\n' ? '\n' : ''}${marker(pics.length)}\n`;
        ta.value = ta.value.slice(0, at) + ins + ta.value.slice(at);
        ta.selectionStart = ta.selectionEnd = at + ins.length;
      } catch (x) { toast((x as Error).message || ct('wr.tooBig')); }
    }
    uploading = false;
    input.disabled = false;
    submit.disabled = false;
    if (alive()) paintPics();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending || uploading) return;
    err.textContent = '';
    const f = new FormData(form);
    const title = String(f.get('title') || '').trim();
    const body = String(f.get('body') || '');
    if (!title) { err.textContent = ct('wr.titlePh'); form.querySelector<HTMLInputElement>('[name=title]')!.focus(); return; }
    if (!body.trim() && !pics.length) { err.textContent = ct('wr.bodyPh'); ta.focus(); return; }
    const btn = form.querySelector<HTMLButtonElement>('button.btn-solid')!;
    sending = true;
    btn.disabled = true; btn.textContent = ct('wr.sending');
    const res = await api(`/api/community/b/${enc(b.id)}`, { method: 'POST', body: JSON.stringify({ head: f.get('head'), title, body, anon: !!f.get('anon'), images: pics.map(({ data, w, h }) => ({ data, w, h })) }) }).catch((x) => { err.textContent = x.message; return null; });
    sending = false;
    btn.disabled = false; btn.textContent = ct('wr.submit');
    if (res?.no && alive()) location.hash = `#/community/${enc(b.id)}/${res.no}`;
  });
}
