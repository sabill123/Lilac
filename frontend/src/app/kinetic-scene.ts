/** Kinetic layer: staged scroll reveal + one decorative Three.js ribbon band.
 *
 * Owned by installFx: it calls scan() on every DOM-change tick it already observes, so this
 * module adds no document-wide MutationObserver of its own. Everything here is decorative:
 * - Reveal never touches headings' text, never hides anything that is on screen or above it,
 *   and is skipped entirely under reduced motion. Only blocks still below the viewport wait.
 * - The ribbon band is aria-hidden, pointer-events:none, lazily created when visible, and
 *   torn down when its host leaves the DOM, on teardown, or after WebGL context loss.
 * Three.js is loaded with a dynamic import so it never enters the entry bundle. */
import './kinetic-scene.css';
import type { RibbonHandle } from './kinetic-ribbon';

const reducedQuery = () => window.matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- Staged reveal ---------- */
/** Blocks that enter in sequence on public pages (70ms CSS stagger, capped). Headings and page heads are excluded. */
export const REVEAL_SEL = [
  '#page .sec > .sec-head', '#page .v2-grid > *', '#page .v2-rail', '#page .grid-posters > *', '#page .grid-goods > *',
  '#page .grid-squares > *', '#page .grid-artists > *', '#page .cm-grid > *', '#page .clist', '#page .nlist', '#page .tlist',
].join(', ');
const STAGGER_MAX = 6;

/* ---------- Ribbon placement ---------- */
/** Home artist section first, else the public page head. One WebGL context at a time. */
export const RIBBON_HOSTS: readonly { sel: string; anchor: string | null; variant: 'section' | 'head' }[] = [
  { sel: '#page #secArtists', anchor: ':scope > .sec-head', variant: 'section' },
  { sel: '#page .page-head', anchor: null, variant: 'head' },
];

export interface KineticRibbonMount { readonly el: HTMLElement; readonly host: HTMLElement; destroy(): void }
type Loader = () => Promise<{ createKineticRibbon: typeof import('./kinetic-ribbon').createKineticRibbon }>;
let loadRibbon: Loader = () => import('./kinetic-ribbon');
/** Test seam: replace the dynamic import with a deterministic module. */
export function setRibbonLoader(loader: Loader | null) { loadRibbon = loader || (() => import('./kinetic-ribbon')); }

let webgl: boolean | undefined;
function canWebGL2() {
  if (webgl !== undefined) return webgl;
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return (webgl = false);
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext?.('webgl2', { failIfMajorPerformanceCaveat: true, powerPreference: 'low-power' }) ?? null) as WebGL2RenderingContext | null;
    webgl = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { webgl = false; }
  return webgl;
}
/** Test seam for environments without a GPU. */
export function setWebGLAvailable(value: boolean | undefined) { webgl = value; }

/** Mounts a ribbon band inside host (after anchor when given). Safe to call on any element. */
export function mountKineticRibbon(host: HTMLElement, opts: { anchor?: Element | null; variant?: 'section' | 'head' } = {}): KineticRibbonMount {
  const el = document.createElement('div');
  el.className = `kx-ribbon kx-ribbon--${opts.variant || 'section'}`;
  el.setAttribute('aria-hidden', 'true');
  el.dataset.kxScene = 'idle';
  if (opts.anchor && opts.anchor.parentNode === host) host.insertBefore(el, opts.anchor.nextSibling);
  else host.appendChild(el);
  let handle: RibbonHandle | null = null, io: IntersectionObserver | null = null, done = false, started = false;
  const fallback = () => { if (el.isConnected) el.dataset.kxScene = 'fallback'; };
  const start = () => {
    if (started || done) return;
    started = true; io?.disconnect(); io = null;
    if (!canWebGL2()) { fallback(); return; }
    el.dataset.kxScene = 'loading';
    loadRibbon().then(({ createKineticRibbon }) => {
      if (done || !el.isConnected) return;
      handle = createKineticRibbon(el, { pointerHost: host, onFallback: () => { handle = null; fallback(); } });
      if (!handle) fallback(); else el.dataset.kxScene = 'ready';
    }).catch(() => { if (!done) fallback(); });
  };
  if (typeof IntersectionObserver === 'undefined') start();
  else { io = new IntersectionObserver((entries) => { if (entries.some(e => e.isIntersecting)) start(); }, { rootMargin: '120px' }); io.observe(el); }
  return {
    el, host,
    destroy() {
      if (done) return;
      done = true; io?.disconnect(); io = null;
      handle?.destroy(); handle = null;
      el.remove();
    },
  };
}

export interface KineticInstall { scan(scope?: ParentNode): void; destroy(): void; readonly ribbon: () => KineticRibbonMount | null; readonly waiting: () => number }
let installed: KineticInstall | null = null;

export function installKinetic(): KineticInstall {
  if (installed) return installed;
  const media = reducedQuery();
  const ctrl = new AbortController();
  const waiting = new Set<HTMLElement>();
  let io: IntersectionObserver | null = null;
  let ribbon: KineticRibbonMount | null = null;
  let destroyed = false;

  const show = (el: HTMLElement) => { el.dataset.kx = 'shown'; el.style.removeProperty('--kx-i'); };
  const revealAll = () => { for (const el of waiting) { io?.unobserve(el); show(el); } waiting.clear(); };
  const enter = (entries: IntersectionObserverEntry[]) => {
    const due = entries.filter(e => e.isIntersecting).map(e => e.target as HTMLElement);
    due.forEach((el, i) => {
      io?.unobserve(el);
      if (!waiting.delete(el)) return;
      el.style.setProperty('--kx-i', String(Math.min(i, STAGGER_MAX)));
      el.dataset.kx = 'in';
    });
  };
  const stage = (scope: ParentNode) => {
    for (const el of waiting) if (!el.isConnected) { io?.unobserve(el); waiting.delete(el); }
    if (media.matches) return;
    const vh = window.innerHeight || document.documentElement?.clientHeight || 0;
    scope.querySelectorAll<HTMLElement>(REVEAL_SEL).forEach((el) => {
      if (el.dataset.kx) return;
      const r = el.getBoundingClientRect();
      // On screen, above, or not laid out: never hidden.
      if (!vh || r.top < vh || (!r.width && !r.height)) { el.dataset.kx = 'shown'; return; }
      el.dataset.kx = 'wait';
      waiting.add(el);
      io ||= new IntersectionObserver(enter, { rootMargin: '0px 0px -6% 0px', threshold: 0.01 });
      io.observe(el);
    });
  };

  const placeRibbon = () => {
    if (ribbon && (!ribbon.el.isConnected || !ribbon.host.isConnected)) { ribbon.destroy(); ribbon = null; }
    if (ribbon) return;
    for (const spot of RIBBON_HOSTS) {
      const host = document.querySelector<HTMLElement>(spot.sel);
      if (!host || host.dataset.kxScene === 'off') continue;
      if (host.querySelector(':scope > .kx-ribbon')) return;
      const anchor = spot.anchor ? host.querySelector(spot.anchor) : null;
      if (spot.anchor && !anchor) continue;
      ribbon = mountKineticRibbon(host, { anchor, variant: spot.variant });
      return;
    }
  };

  media.addEventListener('change', () => { if (media.matches) revealAll(); }, { signal: ctrl.signal });

  installed = {
    scan(scope: ParentNode = document) {
      if (destroyed) return;
      stage(scope);
      placeRibbon();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ctrl.abort();
      revealAll(); io?.disconnect(); io = null;
      ribbon?.destroy(); ribbon = null;
      installed = null;
    },
    ribbon: () => ribbon,
    waiting: () => waiting.size,
  };
  return installed;
}
