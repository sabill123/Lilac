/* 좋아요 · 댓글 · 공유 — 공연·앨범·곡과 갤러리 글이 같은 부품을 쓴다 */
import { api } from '../api';
import { state, sessionReady } from './state';
import { esc, safeHref, icon, toast } from './ui';
import { ct } from './cm-i18n';
import { t } from './i18n';
import type { Concert, Release } from './cards';
import type { Track } from './player';

export type SocialKind = 'concert' | 'release' | 'track' | 'fanclub';
export interface Target { kind: SocialKind; ref: string; snap: Record<string, unknown> }

const targets = new Map<string, Target>();
let seq = 0;
const reg = (tg: Target) => { const id = `s${++seq}`; targets.set(id, tg); if (targets.size > 5000) targets.delete(targets.keys().next().value!); return id; };

export const concertTarget = (c: Concert): Target => ({ kind: 'concert', ref: c.url, snap: { ...c } as Record<string, unknown> });
export const releaseTarget = (r: Release): Target => ({ kind: 'release', ref: r.id, snap: { ...r } as Record<string, unknown> });
export const trackTarget = (tr: Track & { album?: string | null; artistId?: string | null; country?: string }): Target => ({ kind: 'track', ref: `${tr.title}|${tr.artist}`, snap: { ...tr } as Record<string, unknown> });

export const shareUrl = (hash: string) => `${location.origin}${location.pathname}${hash}`;
export const loginHref = () => `#/login?next=${encodeURIComponent(location.hash.slice(1) || '/')}`;

/* ---------- 좋아요 · 공유 버튼 ---------- */
export function likeBtn(tg: Target, cls = '') {
  return `<button type="button" class="soc-btn soc-like ${cls}" data-soc-like="${reg(tg)}" aria-pressed="false" aria-label="${ct('soc.like')}">${icon('i-heart', 'ic off')}${icon('i-heart-f', 'ic on')}<span class="n">0</span></button>`;
}
export function shareBtn(tg: Target | null, hash: string, title: string, cls = '') {
  const id = tg ? reg(tg) : '';
  return `<button type="button" class="soc-btn soc-share ${cls}" data-soc-share="${id}" data-hash="${esc(hash)}" data-title="${esc(title)}">${icon('i-share')}<span>${ct('soc.share')}</span></button>`;
}
export function cmtCount(tg: Target, href: string, cls = '') {
  return `<a class="soc-btn soc-cmt ${cls}" href="${esc(safeHref(href))}" data-soc-cmt="${reg(tg)}">${icon('i-comment')}<span class="n">0</span></a>`;
}

/* 곡처럼 따로 화면이 없는 대상: 누르면 스냅샷을 저장하고 그 대상의 화면(#/track/<key>)으로 간다 */
export function talkBtn(tg: Target, route: string, cls = '') {
  return `<button type="button" class="soc-btn soc-cmt ${cls}" data-soc-cmt="${reg(tg)}" data-route="${esc(route)}" aria-label="${ct('soc.cmt')}">${icon('i-comment')}<span class="n">0</span></button>`;
}

async function ensureKey(tg: Target) {
  // Reading an existing thread never creates a public record and is allowed for guests.
  const lookup = await api('/api/social/lookup', { method: 'POST', body: JSON.stringify({ items: [{ kind: tg.kind, ref: tg.ref }] }) });
  const existing = lookup.items?.[0]?.key;
  if (typeof existing === 'string' && existing) return existing;
  await sessionReady;
  if (!state.me) throw Object.assign(new Error(ct('soc.login')), { loginRequired: true });
  const r = await api('/api/social/target', { method: 'POST', body: JSON.stringify(tg) });
  if (!r?.key || typeof r.key !== 'string') throw new Error(ct('soc.login'));
  return r.key;
}

export async function bindSocial(root: HTMLElement) {
  const likes = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-soc-like]:not([data-bound])'));
  const cmts = Array.from(root.querySelectorAll<HTMLElement>('[data-soc-cmt]:not([data-bound])'));
  const shares = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-soc-share]:not([data-bound])'));
  const owned = new WeakMap<HTMLElement, Target>();
  for (const el of [...likes, ...cmts, ...shares]) {
    el.setAttribute('data-bound', '1');
    const id = el.dataset.socLike || el.dataset.socCmt || el.dataset.socShare || '';
    const tg = targets.get(id);
    if (tg) { owned.set(el, tg); targets.delete(id); }
  }
  const els = [...likes, ...cmts];
  // Bind immediately: a slow count lookup must not leave visible controls inert.
  if (els.length) void api('/api/social/lookup', { method: 'POST', body: JSON.stringify({ items: els.map((el) => { const tg = owned.get(el); return tg ? { kind: tg.kind, ref: tg.ref } : null; }) }) }).then((r) => {
    (r?.items || []).forEach((x: { likes: number; cmt: number; liked: boolean } | null, i: number) => {
      const el = els[i];
      if (!x || !el || el.dataset.socialTouched) return;
      const n = el.querySelector('.n');
      if (el.dataset.socLike) { if (n) n.textContent = String(x.likes); el.setAttribute('aria-pressed', String(x.liked)); }
      else if (n) n.textContent = String(x.cmt);
    });
  }).catch(() => {});
  likes.forEach((b) => b.addEventListener('click', async () => {
    if (b.disabled) return;
    if (!state.me) { toast(ct('soc.login')); location.hash = loginHref(); return; }
    const tg = owned.get(b);
    if (!tg) return;
    b.disabled = true; b.dataset.socialTouched = '1';
    const r = await api('/api/social/like', { method: 'POST', body: JSON.stringify(tg) }).catch((e) => { if (b.isConnected) toast(e.message); return null; });
    b.disabled = false;
    if (!r || !b.isConnected) return;
    b.setAttribute('aria-pressed', String(r.liked));
    const n = b.querySelector('.n'); if (n) n.textContent = String(r.likes);
    b.classList.remove('pop'); void b.offsetWidth; if (r.liked) b.classList.add('pop');
  }));
  cmts.forEach((b) => {
    if (b.tagName !== 'BUTTON') return;
    const btn = b as HTMLButtonElement;
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const tg = owned.get(btn); if (!tg) return;
      btn.disabled = true;
      const key = await ensureKey(tg).catch((e) => { if (btn.isConnected) { toast(e.message); if (e.loginRequired) location.hash = loginHref(); } return ''; });
      btn.disabled = false;
      const route = (btn.dataset.route || '').replace('{key}', encodeURIComponent(key));
      if (key && btn.isConnected && route.startsWith('#/')) location.hash = route;
    });
  });
  shares.forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (b.disabled) return;
    b.disabled = true;
    let hash = b.dataset.hash || '';
    const tg = owned.get(b);
    if (hash.includes('{key}') && tg) {
      const key = await ensureKey(tg).catch((e) => { if (b.isConnected) { toast(e.message); if (e.loginRequired) location.hash = loginHref(); } return ''; });
      if (!key) { b.disabled = false; return; }
      hash = hash.replace('{key}', encodeURIComponent(key));
    }
    b.disabled = false;
    if (b.isConnected && hash.startsWith('#/')) openShare(b, shareUrl(hash), b.dataset.title || document.title);
  }));
}

/* ---------- 공유 메뉴 (링크 복사 · X · LINE · 시스템 공유) ---------- */
let openPop: HTMLElement | null = null;
let popTimer: ReturnType<typeof setTimeout> | null = null;
function closePop() { if (popTimer) clearTimeout(popTimer); popTimer = null; openPop?.remove(); openPop = null; document.removeEventListener('click', onDoc, true); document.removeEventListener('keydown', onEsc); }
const onDoc = (e: Event) => { if (openPop && !openPop.contains(e.target as Node)) closePop(); };
const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') closePop(); };
export async function copyText(s: string) {
  try { await navigator.clipboard.writeText(s); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = s; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    try { return document.execCommand('copy'); } catch { return false; } finally { ta.remove(); }
  }
}
export function openShare(anchor: HTMLElement, url: string, title: string) {
  closePop();
  if (!safeHref(url, false) || !anchor.isConnected) return;
  const pop = document.createElement('div');
  pop.className = 'share-pop';
  pop.setAttribute('role', 'menu');
  const x = `https://x.com/intent/post?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;
  const line = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}`;
  pop.innerHTML = `<p class="share-url">${esc(url.replace(/^https?:\/\//, ''))}</p>
    <button type="button" role="menuitem" data-copy>${icon('i-link')}${ct('soc.copy')}</button>
    <a role="menuitem" href="${esc(x)}" target="_blank" rel="noopener"><b class="share-x" aria-hidden="true">X</b>X</a>
    <a role="menuitem" href="${esc(line)}" target="_blank" rel="noopener"><b class="share-line" aria-hidden="true">L</b>LINE</a>
    ${'share' in navigator ? `<button type="button" role="menuitem" data-native>${icon('i-share')}${ct('soc.more')}</button>` : ''}`;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
  const below = r.bottom + 8 + pop.offsetHeight < innerHeight;
  pop.style.left = `${left}px`;
  pop.style.top = `${below ? r.bottom + 8 : r.top - pop.offsetHeight - 8}px`;
  pop.querySelector('[data-copy]')?.addEventListener('click', async () => { if (await copyText(url)) toast(ct('soc.copied')); closePop(); });
  pop.querySelector('[data-native]')?.addEventListener('click', () => { void navigator.share({ title, url }).catch(() => {}); closePop(); });
  pop.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => closePop()));
  openPop = pop;
  popTimer = setTimeout(() => { if (openPop !== pop) return; document.addEventListener('click', onDoc, true); document.addEventListener('keydown', onEsc); }, 0);
  (pop.querySelector('[data-copy]') as HTMLElement)?.focus();
}

/* ---------- 댓글 ---------- */
export interface Cmt { id: string; parent: string | null; body?: string; nick?: string; anon?: boolean; tag?: string | null; at: string; mine?: boolean; del?: boolean }
export interface CmtAdapter {
  load(): Promise<Cmt[]>;
  add(body: string, parent: string | null, anon: boolean): Promise<{ item: Cmt; count: number }>;
  remove(id: string): Promise<{ count: number }>;
  allowAnon?: boolean;
  onCount?(n: number): void;
}

export function when(iso: string, full = false) {
  if (!Number.isFinite(Date.parse(iso))) return '';
  const d = new Date(Date.parse(iso) + 9 * 3600e3);
  const p = (n: number) => String(n).padStart(2, '0');
  const now = new Date(Date.now() + 9 * 3600e3);
  const hm = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  if (full) return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${hm}:${p(d.getUTCSeconds())}`;
  if (Date.now() - Date.parse(iso) < 60e3) return ct('time.now');
  if (d.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) return hm;
  if (d.getUTCFullYear() === now.getUTCFullYear()) return `${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}`;
  return `${String(d.getUTCFullYear()).slice(2)}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}`;
}
/* 기본 프로필: 회색 원 + 첫 글자(익명은 ㅇ). 색으로 사람을 구분하지 않는다 */
export function avatar(nick: string, anon: boolean, size = 36) {
  const ch = anon ? 'ㅇ' : (nick || '?').trim().slice(0, 1).toUpperCase();
  return `<span class="av${anon ? ' is-anon' : ''}" style="--s:${size}px" aria-hidden="true">${esc(ch)}</span>`;
}
export const nickHtml = (x: { nick?: string; anon?: boolean; tag?: string | null }) =>
  `<span class="nick${x.anon ? ' is-anon' : ''}">${esc(x.nick || '')}${x.tag ? `<em>(${esc(x.tag)})</em>` : ''}</span>`;

export function linkify(s: string) {
  return String(s).split(/(https?:\/\/[^\s<>"']+)/g).map((part, i) => {
    const url = i % 2 ? safeHref(part, false) : '';
    return url ? `<a href="${esc(url)}" target="_blank" rel="nofollow ugc noopener">${esc(part)}</a>` : esc(part);
  }).join('').replace(/\n/g, '<br>');
}

export function commentsHtml() {
  return `<div class="cmts"><div class="cmts-head"><b class="cmts-n"></b></div><ul class="cmt-list" aria-live="polite"></ul><div class="cmt-write"></div></div>`;
}

export async function bindComments(box: HTMLElement, ad: CmtAdapter) {
  if (box.dataset.commentsBound) return;
  box.dataset.commentsBound = '1';
  let mutating = false;
  const drafts = new Map<string, { body: string; anon: boolean }>();
  let items: Cmt[] = [];
  let replyTo: string | null = null;
  const head = box.querySelector<HTMLElement>('.cmts-n')!;
  const ul = box.querySelector<HTMLElement>('.cmt-list')!;
  const write = box.querySelector<HTMLElement>('.cmt-write')!;
  const row = (c: Cmt, child = false) => c.del
    ? `<li class="cmt is-del${child ? ' is-reply' : ''}">${avatar('', true, child ? 28 : 32)}<div class="cmt-c"><p class="cmt-body">${ct('cmt.deleted')}</p></div></li>`
    : `<li class="cmt${child ? ' is-reply' : ''}" data-id="${esc(c.id)}">${avatar(c.nick || '', !!c.anon, child ? 28 : 32)}<div class="cmt-c">
        <div class="cmt-meta">${nickHtml(c)}<time datetime="${esc(c.at)}">${esc(when(c.at))}</time></div>
        <p class="cmt-body">${linkify(c.body || '')}</p>
        <div class="cmt-act">${!child ? `<button type="button" data-reply>${ct('cmt.reply')}</button>` : ''}${c.mine ? `<button type="button" data-del>${ct('cmt.del')}</button>` : ''}</div>
      </div></li>`;
  const form = (parent: string | null) => state.me
    ? `<form class="cmt-form${parent ? ' is-reply' : ''}" data-parent="${esc(parent || '')}">
        <textarea name="body" maxlength="400" rows="3" placeholder="${ct('cmt.ph')}" aria-label="${ct('cmt.ph')}" required></textarea>
        <div class="cmt-form-foot">
          ${ad.allowAnon ? `<label class="chk"><input type="checkbox" name="anon"> ${ct('cmt.anon')}</label>` : `<span class="cmt-as">${esc(state.me.name)}</span>`}
          <span class="cmt-len">0/400</span>
          ${parent ? `<button type="button" class="btn btn-line sm" data-cancel>${ct('cmt.cancel')}</button>` : ''}
          <button class="btn btn-solid sm">${ct('cmt.submit')}</button>
        </div>
      </form>`
    : `<a class="cmt-login" href="${loginHref()}">${ct('cmt.login')}</a>`;
  function paint() {
    box.querySelectorAll<HTMLFormElement>('.cmt-form').forEach((f) => drafts.set(f.dataset.parent || '', { body: f.querySelector('textarea')!.value, anon: !!f.querySelector<HTMLInputElement>('[name=anon]')?.checked }));
    const live = items.filter((c) => !c.del).length;
    head.innerHTML = ct('cmt.all', { n: `<em>${live}</em>` });
    ad.onCount?.(live);
    const roots = items.filter((c) => !c.parent);
    ul.innerHTML = roots.length ? roots.map((c) => {
      const kids = items.filter((k) => k.parent === c.id);
      if (c.del && !kids.some((k) => !k.del)) return '';
      return row(c) + (kids.length ? `<li class="cmt-kids"><ul>${kids.map((k) => row(k, true)).join('')}${replyTo === c.id ? `<li class="cmt-replyform">${form(c.id)}</li>` : ''}</ul></li>` : replyTo === c.id ? `<li class="cmt-kids"><ul><li class="cmt-replyform">${form(c.id)}</li></ul></li>` : '');
    }).join('') : `<li class="cmt-none">${ct('cmt.none')}</li>`;
    write.innerHTML = form(null);
    box.querySelectorAll<HTMLFormElement>('.cmt-form').forEach(bindForm);
    ul.querySelectorAll<HTMLButtonElement>('[data-reply]').forEach((b) => b.addEventListener('click', () => {
      if (!state.me) { location.hash = loginHref(); return; }
      replyTo = b.closest<HTMLElement>('.cmt')!.dataset.id || null; paint();
      ul.querySelector<HTMLTextAreaElement>('.cmt-replyform textarea')?.focus();
    }));
    ul.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (mutating || !confirm(ct('cmt.delConfirm'))) return;
      mutating = true; b.disabled = true;
      const id = b.closest<HTMLElement>('.cmt')!.dataset.id!;
      const r = await ad.remove(id).catch((e) => { toast(e.message); return null; });
      mutating = false; b.disabled = false;
      if (!r || !box.isConnected) return;
      const c = items.find((x) => x.id === id); if (c) { c.del = true; delete c.body; }
      paint();
    }));
  }
  function bindForm(f: HTMLFormElement) {
    const ta = f.querySelector('textarea')!;
    const len = f.querySelector('.cmt-len')!;
    const draft = drafts.get(f.dataset.parent || '');
    if (draft) { ta.value = draft.body; const anon = f.querySelector<HTMLInputElement>('[name=anon]'); if (anon) anon.checked = draft.anon; }
    len.textContent = `${ta.value.length}/400`;
    ta.addEventListener('input', () => { len.textContent = `${ta.value.length}/400`; });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) f.requestSubmit(); });
    f.querySelector('[data-cancel]')?.addEventListener('click', () => { replyTo = null; paint(); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = ta.value.trim();
      if (!body || body.length > 400 || mutating) return;
      mutating = true;
      const btn = f.querySelector<HTMLButtonElement>('button:not([type=button])')!;
      btn.disabled = true;
      const anon = !!f.querySelector<HTMLInputElement>('[name=anon]')?.checked;
      const r = await ad.add(body, f.dataset.parent || null, anon).catch((err) => { toast(err.message); return null; });
      btn.disabled = false; mutating = false;
      if (!r || !box.isConnected) return;
      if (ta.value.trim() === body) { ta.value = ''; drafts.delete(f.dataset.parent || ''); }
      items.push(r.item);
      replyTo = null;
      paint();
    });
  }
  async function loadComments() {
    try {
      items = await ad.load();
      await Promise.race([sessionReady, new Promise((r) => setTimeout(r, 2500))]);
      paint();
    } catch {
      ul.innerHTML = `<li class="cmt-none"><button type="button" class="btn btn-line" data-cmt-retry>${esc(t('retry'))}</button></li>`;
      ul.querySelector<HTMLButtonElement>('[data-cmt-retry]')?.addEventListener('click', (e) => { (e.currentTarget as HTMLButtonElement).disabled = true; void loadComments(); });
    }
  }
  await loadComments();
}

export function targetAdapter(tg: Target, onCount?: (n: number) => void): CmtAdapter {
  let key: string | null = null;
  return {
    onCount,
    async load() {
      const r = await api('/api/social/lookup', { method: 'POST', body: JSON.stringify({ items: [{ kind: tg.kind, ref: tg.ref }] }) });
      key = r.items?.[0]?.key || null;
      if (!key || !r.items[0].cmt) return [];
      return (await api(`/api/social/t/${encodeURIComponent(key)}/comments`)).items || [];
    },
    async add(body, parent) { const r = await api('/api/social/comment', { method: 'POST', body: JSON.stringify({ ...tg, body, parent }) }); key = r.key; return r; },
    async remove(id) { return api(`/api/social/t/${encodeURIComponent(key || '')}/comments/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  };
}
