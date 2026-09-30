/* 검색 · MY · 로그인/가입 */
import { api } from '../../api';
import { state, login, signup, logout, onChange, forgetSession, refreshMe2 } from '../state';
import { getLocale } from '../i18n';
import { t } from '../i18n';
import { esc, img, icon, skeletonRows, emptyState, errorState, params, toast } from '../ui';
import { ct } from '../cm-i18n';
import { artistCard, posterCard, ticketRow, newsRow, releaseCard } from '../cards';
import type { ArtistLite, Concert, Release, News } from '../cards';

export async function renderSearch(root: HTMLElement, alive: () => boolean) {
  const q = (params().get('q') || '').trim();
  root.innerHTML = `<form class="bigsearch" id="sForm" role="search">${icon('i-search')}<input type="search" name="q" value="${esc(q)}" placeholder="${t('search.ph')}" autocomplete="off" aria-label="${t('search.ph')}"${q ? '' : ' autofocus'}><button class="btn btn-solid">${t('search.go')}</button></form>
    ${q ? `<section class="page-head search-head"><h1>${esc(t('s.title', { q }))}</h1></section>` : ''}<div id="sBody">${q ? skeletonRows(6) : ''}</div>`;
  const form = root.querySelector<HTMLFormElement>('#sForm')!;
  form.addEventListener('submit', (e) => { e.preventDefault(); const v = String(new FormData(form).get('q') || '').trim(); if (v) location.hash = `#/search?q=${encodeURIComponent(v)}`; });
  if (!q) {
    (form.querySelector('input') as HTMLInputElement).focus();
    const a = await api(`/api/live/artists?edition=${state.edition}`).catch(() => ({ items: [] }));
    if (!alive()) return;
    root.querySelector('#sBody')!.innerHTML = `<section class="sec"><div class="sec-head"><h2>${t('home.artists')}</h2></div><div class="grid-artists">${(a.items || []).slice(0, 12).map(artistCard).join('')}</div></section>`;
    return;
  }
  let r: { artists: ArtistLite[]; concerts: Concert[]; releases: Release[] };
  try {
    r = await api(`/api/live/search?q=${encodeURIComponent(q)}&edition=${state.edition}`);
  } catch {
    if (!alive()) return;
    root.querySelector('#sBody')!.innerHTML = errorState(t('err.generic'));
    root.querySelector('[data-retry]')?.addEventListener('click', () => renderSearch(root, alive));
    return;
  }
  if (!alive()) return;
  const body = root.querySelector<HTMLElement>('#sBody')!;
  const none = !r.artists.length && !r.concerts.length && !r.releases.length;
  body.innerHTML = `
    ${none ? emptyState(t('s.none', { q })) : ''}
    ${r.artists.length ? `<section class="sec"><div class="sec-head"><h2>${t('s.artists')}</h2></div><div class="grid-artists">${r.artists.map(artistCard).join('')}</div></section>` : ''}
    ${r.concerts.length ? `<section class="sec"><div class="sec-head"><h2>${t('s.concerts')}</h2></div><div class="grid-posters">${r.concerts.map(posterCard).join('')}</div></section>` : ''}
    ${r.releases.length ? `<section class="sec"><div class="sec-head"><h2>${t('s.releases')}</h2></div><div class="grid-squares">${r.releases.map(releaseCard).join('')}</div></section>` : ''}
    <section class="sec more-links">
      <a class="btn btn-line" href="#/goods?q=${encodeURIComponent(q)}">${icon('i-bag', 'ic xs')}${t('s.goods')}</a>
      <a class="btn btn-line" href="#/artist/name/${encodeURIComponent(q)}">${icon('i-mic', 'ic xs')}${esc(q)} — ${t('a.title')}</a>
    </section>`;
}

export async function renderMy(root: HTMLElement, alive: () => boolean) {
  if (!state.me) {
    root.innerHTML = `<section class="page-head"><h1>${t('my.title')}</h1><p class="lede">${t('my.guest')}</p></section>
      <div class="auth-cta"><a class="btn btn-solid" href="#/login?next=%2Fmy">${t('auth.login')}</a><a class="btn btn-line" href="#/signup?next=%2Fmy">${t('auth.signup')}</a></div>`;
    return;
  }
  const follows = state.follows;
  root.innerHTML = `
    <section class="page-head my-head"><div><h1>${esc(state.me.name)}</h1><p class="muted">${esc(state.me.email)}</p></div><button class="btn btn-ghost" id="myOut">${t('my.logout')}</button></section>
    <section class="sec"><div class="sec-head"><h2>${t('my.follows')}</h2><a class="more" href="#/artists">${t('my.findArtists')}${icon('i-chev-r', 'ic xs')}</a></div>
      ${follows.length ? `<div class="chips">${follows.map((f) => `<a class="chip" href="${f.artistId.startsWith('name:') ? `#/artist/name/${encodeURIComponent(f.artistId.slice(5))}` : `#/artist/${encodeURIComponent(f.artistId)}`}">${esc(f.name || f.artistId)}</a>`).join('')}</div>` : emptyState(t('my.noFollows'), `<a class="btn btn-solid" href="#/artists">${t('my.findArtists')}</a>`)}
    </section>
    <section class="sec" id="myLikes"><div class="sec-head"><h2>${ct('mine.likes')}</h2></div><ul class="like-list">${skeletonRows(2, 'sk-line')}</ul></section>
    <section class="sec" id="myTickets"><div class="sec-head"><h2>${t('my.tickets')}</h2></div><ul class="tlist">${skeletonRows(3)}</ul></section>
    <section class="sec" id="myShows"><div class="sec-head"><h2>${t('my.shows')}</h2></div></section>
    <section class="sec" id="myNews"><div class="sec-head"><h2>${t('my.news')}</h2></div></section>
    ${accountHtml()}`;
  bindAccount(root);
  root.querySelector('#myOut')!.addEventListener('click', async () => { try { await logout(); location.hash = '#/'; } catch { toast(t('err.generic')); } });
  api('/api/social/mine').then((r: { items: { key: string; kind: 'concert' | 'release' | 'track' | 'fanclub'; ref: string; snap: { title: string; artist?: string; performer?: string; poster?: string; artwork?: string; image?: string; id?: string } }[] }) => {
    if (!alive()) return;
    const box = root.querySelector('#myLikes .like-list');
    if (!box) return;
    const href = (x: typeof r.items[number]) => (x.kind === 'concert' ? `#/e/${encodeURIComponent(x.key)}` : x.kind === 'release' ? `#/release/${encodeURIComponent(x.ref)}` : x.kind === 'fanclub' ? `#/fanclub/${encodeURIComponent(x.ref)}` : `#/track/${encodeURIComponent(x.key)}`);
    box.innerHTML = r.items.length ? r.items.map((x) => `<li><a href="${href(x)}">${img(x.snap.poster || x.snap.artwork || x.snap.image, '', x.kind === 'concert' ? 'poster' : 'square', { ratio: x.kind === 'concert' ? '3/4' : '1/1', initial: x.snap.title })}<span><em>${ct(`kind.${x.kind}`)}</em><b>${esc(x.snap.title)}</b><small>${esc(x.snap.performer || x.snap.artist || '')}</small></span></a></li>`).join('') : `<li class="cm-empty">${ct('mine.none')}</li>`;
  }).catch(() => { if (alive()) { const box = root.querySelector('#myLikes .like-list'); if (box) box.innerHTML = `<li class="cm-empty">${esc(t('err.generic'))}</li>`; } });
  if (!follows.length) {
    ['#myTickets', '#myShows', '#myNews'].forEach((s) => root.querySelector(s)?.remove());
    return;
  }
  const keys = follows.map((f) => ({ id: f.artistId, k: (f.name || f.artistId.replace(/^name:/, '')).normalize('NFKC').toLowerCase().replace(/\s+/g, '') }));
  const mine = (c: Concert) => keys.some((x) => (c.artistId && c.artistId === x.id) || (x.k.length >= 2 && `${c.title} ${c.performer || ''}`.normalize('NFKC').toLowerCase().replace(/\s+/g, '').includes(x.k)));
  const [tk, cs, ...news] = await Promise.all([
    api('/api/live/tickets?edition=all&origin=all').catch(() => ({ items: [] })),
    api('/api/live/concerts?edition=all&scope=all&origin=all').catch(() => ({ items: [] })),
    ...follows.slice(0, 6).map((f) => api(`/api/live/news?edition=${state.edition}&artist=${encodeURIComponent(f.artistId.startsWith('name:') ? f.artistId.slice(5) : f.artistId)}`).catch(() => ({ items: [] }))),
  ]);
  if (!alive()) return;
  const tItems: Concert[] = (tk.items || []).filter(mine);
  const cItems: Concert[] = (cs.items || []).filter(mine);
  const nItems: News[] = news.flatMap((n: { items: News[] }) => (n.items || []).slice(0, 5)).sort((a: News, b: News) => String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0, 12);
  root.querySelector('#myTickets')!.innerHTML = `<div class="sec-head"><h2>${t('my.tickets')}</h2></div>` + (tItems.length ? `<ul class="tlist">${tItems.map((c) => ticketRow(c)).join('')}</ul>` : emptyState(t('empty.generic')));
  root.querySelector('#myShows')!.innerHTML = `<div class="sec-head"><h2>${t('my.shows')}</h2></div>` + (cItems.length ? `<div class="grid-posters">${cItems.map(posterCard).join('')}</div>` : emptyState(t('a.noShows')));
  root.querySelector('#myNews')!.innerHTML = `<div class="sec-head"><h2>${t('my.news')}</h2></div>` + (nItems.length ? `<ul class="nlist">${nItems.map(newsRow).join('')}</ul>` : emptyState(t('empty.generic')));
}

/* 계정 설정: 이름 · 비밀번호 변경 · 탈퇴 */
function accountHtml() {
  const ja = getLocale() === 'ja';
  return `<section class="sec acct" id="myAccount"><div class="sec-head"><h2>${ja ? 'アカウント設定' : '계정 설정'}</h2></div>
    <form class="acct-form" id="acName"><h3>${ja ? '表示名' : '표시 이름'}</h3><div class="acct-row"><input name="name" maxlength="60" required value="${esc(state.me?.name || '')}" aria-label="${ja ? '表示名' : '표시 이름'}"><button class="btn btn-line">${ja ? '保存' : '저장'}</button></div><p class="form-err" role="alert"></p></form>
    <form class="acct-form" id="acPw"><h3>${ja ? 'パスワード変更' : '비밀번호 변경'}</h3>
      <label>${ja ? '現在のパスワード' : '현재 비밀번호'}<input name="current" type="password" autocomplete="current-password" required></label>
      <label>${ja ? '新しいパスワード(8文字以上)' : '새 비밀번호(8자 이상)'}<input name="next" type="password" autocomplete="new-password" minlength="8" required></label>
      <label>${ja ? '新しいパスワード(確認)' : '새 비밀번호 확인'}<input name="next2" type="password" autocomplete="new-password" minlength="8" required></label>
      <p class="form-err" role="alert"></p><button class="btn btn-line">${ja ? '変更' : '변경'}</button>
      <p class="muted small">${ja ? '変更すると、この端末以外のログインはすべて解除されます。' : '바꾸면 이 기기 말고 다른 기기의 로그인은 모두 풀립니다.'}</p></form>
    <details class="acct-danger"><summary>${ja ? '退会' : '회원 탈퇴'}</summary>
      <form class="acct-form" id="acDel"><p>${ja ? 'アカウント・ログイン・フォロー・いいね・再生履歴が削除され、元に戻せません。掲示板に書いた投稿とコメントは残ります。' : '계정·로그인·팔로우·좋아요·재생 기록이 지워지고 되돌릴 수 없습니다. 커뮤니티에 쓴 글과 댓글은 남습니다.'}</p>
        <label>${ja ? 'パスワード' : '비밀번호'}<input name="password" type="password" autocomplete="current-password" required></label>
        <p class="form-err" role="alert"></p><button class="btn btn-danger">${ja ? '退会する' : '탈퇴하기'}</button></form>
    </details>
  </section>`;
}
function bindAccount(root: HTMLElement) {
  const ja = getLocale() === 'ja';
  const run = (id: string, fn: (f: FormData, form: HTMLFormElement) => Promise<void>) => {
    const form = root.querySelector<HTMLFormElement>(id);
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button')!;
      const err = form.querySelector('.form-err')!;
      if (btn.disabled || !form.reportValidity()) return;
      err.textContent = '';
      btn.disabled = true;
      try { await fn(new FormData(form), form); } catch (ex) { err.textContent = (ex as Error).message || t('err.generic'); } finally { btn.disabled = false; }
    });
  };
  run('#acName', async (f) => {
    await api('/api/me', { method: 'PATCH', body: JSON.stringify({ name: String(f.get('name')).trim() }) });
    await refreshMe2();
    const h = root.querySelector('.my-head h1'); if (h) h.textContent = state.me?.name || '';
    toast(ja ? '保存しました' : '저장했습니다');
  });
  run('#acPw', async (f, form) => {
    if (f.get('next') !== f.get('next2')) throw new Error(ja ? '新しいパスワードが一致しません' : '새 비밀번호가 서로 다릅니다');
    await api('/api/me/password', { method: 'POST', body: JSON.stringify({ current: f.get('current'), next: f.get('next') }) });
    form.reset();
    toast(ja ? 'パスワードを変更しました' : '비밀번호를 바꿨습니다');
  });
  run('#acDel', async (f) => {
    if (!confirm(ja ? '本当に退会しますか?元に戻せません。' : '정말 탈퇴할까요? 되돌릴 수 없습니다.')) return;
    await api('/api/me', { method: 'DELETE', body: JSON.stringify({ password: f.get('password') }) });
    forgetSession();
    toast(ja ? '退会しました' : '탈퇴했습니다');
    location.hash = '#/';
  });
}

export function renderAuth(root: HTMLElement, mode: 'login' | 'signup') {
  const next = params().get('next') || '/';
  root.innerHTML = `
    <section class="auth">
      <h1>${t(mode === 'login' ? 'auth.login' : 'auth.signup')}</h1>
      <form id="authForm">
        ${mode === 'signup' ? `<label>${t('auth.name')}<input name="name" autocomplete="name" required></label>` : ''}
        <label>${t('auth.email')}<input name="email" type="email" autocomplete="email" required></label>
        <label>${t('auth.pw')}<input name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" minlength="8" required aria-describedby="pwHint"><span class="hint" id="pwHint">${t('auth.pw.hint')}</span></label>
        <p class="form-err" id="authErr" role="alert"></p>
        <button class="btn btn-solid block">${t(mode === 'login' ? 'auth.login' : 'auth.signup')}</button>
      </form>
      <a class="muted" href="#/${mode === 'login' ? 'signup' : 'login'}?next=${encodeURIComponent(next)}">${t(mode === 'login' ? 'auth.toSignup' : 'auth.toLogin')}</a>
    </section>`;
  const form = root.querySelector<HTMLFormElement>('#authForm')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.querySelector<HTMLButtonElement>('button')!.disabled || !form.reportValidity()) return;
    const f = new FormData(form);
    const err = root.querySelector('#authErr')!;
    err.textContent = '';
    const btn = form.querySelector('button')!;
    btn.disabled = true;
    try {
      if (mode === 'login') await login(String(f.get('email')).trim(), String(f.get('password')));
      else await signup(String(f.get('email')).trim(), String(f.get('password')), String(f.get('name')).trim());
      toast(state.me ? `${state.me.name}` : '');
      location.hash = `#${next.startsWith('/') ? next : '/' + next}`;
    } catch (ex) {
      err.textContent = (ex as Error).message || t('auth.fail');
    } finally {
      btn.disabled = false;
    }
  });
}

void onChange;
