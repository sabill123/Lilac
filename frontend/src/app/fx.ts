/* Shared interaction feedback. Route content is readable immediately; page-owned
   cover flow and marquee retain their own controls and lifetime. */

import { getLocale } from './i18n';
import { installKinetic } from './kinetic-scene';

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

/** Public route hook retained; effects retire when their actual DOM leaves. */
export function markRoute() { sweepEffects(); }

/* ---------- 1. 미끄러지는 선택 표시 (Segmented Control) ---------- */
type GlideKind = 'invert' | 'raise' | 'line';
const GLIDE: [string, GlideKind][] = [
  ['.chips', 'invert'],
  ['.tl-tabs', 'invert'],
  ['.seg', 'raise'],
  ['.tabs', 'line'],
  ['.hdr .gnb', 'line'],
];
const ACTIVE = '.on, [aria-selected="true"], [aria-current="page"]';

function glide(box: HTMLElement, kind: GlideKind) {
  if (box.dataset.fxGlide || !box.isConnected) return;
  const life = flowLifetime(box);
  let raf = 0;
  box.dataset.fxGlide = kind;
  const bar = document.createElement('span');
  bar.className = `fx-glide fx-glide-${kind}`;
  bar.setAttribute('aria-hidden', 'true');
  box.append(bar); // 앞에 넣으면 기존 :first-child 규칙(첫 탭 왼쪽 여백 등)이 깨진다
  let lastX = -1;
  let first = true;
  const place = () => {
    if (!life.alive()) return;
    if (bar.parentNode !== box) box.append(bar); // 화면 코드가 안쪽을 다시 그리면 다시 붙인다
    const items = Array.from(box.children).filter((el) => el !== bar) as HTMLElement[];
    const on = items.find((el) => el.matches(ACTIVE)) || items.map((el) => el.querySelector<HTMLElement>(ACTIVE)).find(Boolean);
    if (!on || !on.offsetWidth) { bar.style.opacity = '0'; return; }
    /* 밑줄은 글자 폭에만(탭의 좌우 여백 제외) */
    const cs = kind === 'line' ? getComputedStyle(on) : null;
    const pl = cs ? parseFloat(cs.paddingLeft) || 0 : 0;
    const pr = cs ? parseFloat(cs.paddingRight) || 0 : 0;
    const x = on.offsetLeft + pl;
    const right = box.scrollWidth - (on.offsetLeft + on.offsetWidth) + pr;
    bar.dataset.dir = lastX < 0 || x === lastX ? '' : x > lastX ? 'right' : 'left';
    bar.style.transition = first || reduce() ? 'none' : '';
    bar.style.left = `${x}px`;
    bar.style.right = `${Math.max(0, right)}px`;
    if (kind === 'line') { bar.style.top = ''; bar.style.height = ''; }
    else { bar.style.top = `${on.offsetTop}px`; bar.style.height = `${on.offsetHeight}px`; bar.style.borderRadius = getComputedStyle(on).borderRadius; }
    bar.style.opacity = '1';
    if (first) { void bar.offsetWidth; first = false; }
    lastX = x;
  };
  place();
  const changed = new MutationObserver(() => {
    if (!life.alive() || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; place(); });
  });
  changed.observe(box, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-selected', 'aria-current', 'hidden'], childList: true });
  const sizing = new ResizeObserver(() => { first = true; place(); });
  sizing.observe(box);
  life.cleanup(() => { changed.disconnect(); sizing.disconnect(); cancelAnimationFrame(raf); bar.remove(); delete box.dataset.fxGlide; });
}

/* ---------- 2. 굴러가는 숫자 (Number Ticker) ---------- */
const easeOut4 = (t: number) => 1 - Math.pow(1 - t, 4);
const mod10 = (n: number) => ((n % 10) + 10) % 10;
/** 숫자 칸은 글자를 DOM에 넣지 않고(::before) 그린다 — textContent는 원래 글자 그대로라 다른 코드·검색이 깨지지 않는다 */
const ticks = new WeakMap<HTMLElement, () => void>();
export function ticker(el: HTMLElement, { delay = 0, from0 = false } = {}) {
  const text = (el.textContent || '').trim();
  if (!/\d/.test(text) || el.dataset.fxTick === text || text.length > 16) return;
  /* 값이 바뀌면(좋아요 수 등) 화면 코드가 글자를 통째로 바꾼다 — 직전 값은 data-fx-tick에 남아 있어 거기서부터 굴린다 */
  const old = el.dataset.fxTick || '';
  ticks.get(el)?.();
  const prevDigits = Array.from(old).filter((c) => c >= '0' && c <= '9').map(Number);
  el.dataset.fxTick = text;
  // First paint and reduced motion show the real value, without observers or rolling.
  if ((!old && !from0) || reduce() || !el.isConnected) return;
  const life = flowLifetime(el);
  let raf = 0, timer = 0;
  ticks.set(el, life.destroy);
  life.cleanup(() => { cancelAnimationFrame(raf); clearTimeout(timer); ticks.delete(el); });
  const chars = Array.from(text);
  const vis = chars.map((c) => (c >= '0' && c <= '9' ? `<span class="fx-nt-col"><span class="fx-nt-stack" data-v="${c}"></span></span>` : `<span class="fx-nt-c" data-c="${c === '"' ? '&quot;' : c.replace(/&/g, '&amp;').replace(/</g, '&lt;')}"></span>`)).join('');
  /* 원문은 투명하게 자리에 남겨 줄 높이·기준선·접근성 이름을 그대로 맡기고, 굴러가는 칸은 그 위에 겹친다 */
  el.innerHTML = `<span class="fx-tk"><span class="fx-ghost">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span><span class="fx-nt" aria-hidden="true">${vis}</span></span>`;
  const stacks = Array.from(el.querySelectorAll<HTMLElement>('.fx-nt-stack'));
  const to = stacks.map((s) => Number(s.dataset.v));
  const start = stacks.map((_, i) => (prevDigits.length ? prevDigits[prevDigits.length - stacks.length + i] ?? 0 : from0 ? 0 : to[i]));
  const set = (s: HTMLElement, p: number) => { s.style.transform = `translateY(${(-mod10(p) / 11) * 100}%)`; };
  if (reduce()) { stacks.forEach((s, i) => set(s, to[i])); return; }
  stacks.forEach((s, i) => set(s, start[i]));
  const roll = () => {
    if (!life.alive()) return;
    const t0 = performance.now();
    // 왼쪽 자리일수록 조금 늦게 — 안내판처럼 한 칸씩 넘어간다
    const deltas = to.map((v, i) => { const d = mod10(v - start[i]); return d === 0 && from0 && !prevDigits.length ? 10 : d; });
    const frame = (now: number) => {
      raf = 0;
      if (!life.alive()) return;
      let done = true;
      stacks.forEach((s, i) => {
        const lag = (stacks.length - 1 - i) * 12;
        const t = Math.min(1, Math.max(0, (now - t0 - lag) / 200));
        if (t < 1) done = false;
        set(s, start[i] + deltas[i] * easeOut4(t));
      });
      if (!done) raf = requestAnimationFrame(frame);
      else life.destroy();
    };
    raf = requestAnimationFrame(frame);
  };
  if (delay > 0) timer = window.setTimeout(roll, delay); else roll();
}
const TICK_SEL = '.chip .n, .tl-cap small, .soc-like .n, #aCount, [data-tick]';

/* ---------- 4. 기우는 카드 (holo 3D card — 빛 반사 없이) ---------- */
export function tilt(el: HTMLElement, max = 7) {
  if (el.dataset.fxTilt || !fine() || reduce() || !el.isConnected) return;
  const life = flowLifetime(el);
  const signal = life.signal;
  el.dataset.fxTilt = '1';
  el.classList.add('fx-tilt');
  let raf = 0;
  el.addEventListener('pointermove', (e) => {
    if (!life.alive() || reduce()) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!life.alive() || reduce()) return;
      el.classList.add('is-tilting');
      el.style.setProperty('--rx', `${(-py * max * 2).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${(px * max * 2).toFixed(2)}deg`);
    });
  }, { signal });
  el.addEventListener('pointerleave', () => {
    cancelAnimationFrame(raf);
    el.classList.remove('is-tilting');
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  }, { signal });
  life.cleanup(() => { cancelAnimationFrame(raf); el.classList.remove('fx-tilt', 'is-tilting'); el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); delete el.dataset.fxTilt; });
}
const TILT_SEL = '.tl-pd-imgbox, .pdp-img, [data-tilt]';

/* ---------- 5. 커버 플로 (Cover Flow) ---------- */
export type FlowItem = { id: string; image: string | null; title: string; sub: string; href?: string; initial?: string };
export function coverFlowHtml(items: FlowItem[], label: string) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return `<div class="fx-cf" tabindex="0" role="listbox" aria-label="${esc(label)}" data-fx-flow>
    <div class="fx-cf-stage">${items.map((it, i) => `<div class="fx-cf-card" data-content-original-label translate="no" role="option" aria-selected="false" data-cf="${i}" aria-label="${esc(it.title)}">
      <div class="fx-cf-face">${it.image ? `<img src="${esc(it.image)}" alt="" draggable="false" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span class="fx-cf-ph" aria-hidden="true">${esc((it.initial || it.title).slice(0, 1).toUpperCase())}</span></div>
      <div class="fx-cf-mirror" aria-hidden="true">${it.image ? `<img src="${esc(it.image)}" alt="" draggable="false" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</div>
    </div>`).join('')}</div>
    <div class="fx-cf-foot"><button type="button" class="fx-cf-btn" data-cf-step="-1" aria-label="${getLocale() === 'ja' ? '前へ' : '이전'}">‹</button><a class="fx-cf-cap" href="#"><b data-content-original-work translate="no"></b><span></span></a><button type="button" class="fx-cf-btn" data-cf-step="1" aria-label="${getLocale() === 'ja' ? '次へ' : '다음'}">›</button></div>
  </div>`;
}
/* All effects retire on removal, including standalone exported binders. */
const effects = new Set<{ box: HTMLElement; destroy: () => void }>();
let removalObserver: MutationObserver | null = null;
function sweepEffects() {
  for (const effect of effects) if (!effect.box.isConnected) effect.destroy();
}
function flowLifetime(box: HTMLElement, external?: AbortSignal) {
  const ctrl = new AbortController();
  const disposers: (() => void)[] = [];
  const entry = { box, destroy: () => destroy() };
  const destroy = () => {
    if (ctrl.signal.aborted) return;
    ctrl.abort();
    effects.delete(entry);
    if (!effects.size) { removalObserver?.disconnect(); removalObserver = null; }
    external?.removeEventListener('abort', destroy);
    disposers.splice(0).forEach((fn) => fn());
  };
  const alive = () => {
    if (!box.isConnected || external?.aborted) destroy();
    return !ctrl.signal.aborted;
  };
  if (external?.aborted || !box.isConnected) destroy();
  else {
    external?.addEventListener('abort', destroy, { once: true });
    effects.add(entry);
    if (!removalObserver) {
      removalObserver = new MutationObserver(sweepEffects);
      removalObserver.observe(document.body, { childList: true, subtree: true });
    }
  }
  return { signal: ctrl.signal, alive, destroy, cleanup(fn: () => void) { if (ctrl.signal.aborted) fn(); else disposers.push(fn); } };
}

export function bindCoverFlow(root: HTMLElement, items: FlowItem[], signal?: AbortSignal) {
  const box = root.querySelector<HTMLElement>('[data-fx-flow]');
  if (!box || box.dataset.bound || signal?.aborted || !box.isConnected) return;
  box.dataset.bound = '1';
  const life = flowLifetime(box, signal);
  signal = life.signal;
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const cards = Array.from(box.querySelectorAll<HTMLElement>('.fx-cf-card'));
  const cap = box.querySelector<HTMLAnchorElement>('.fx-cf-cap')!;
  const last = Math.max(items.length - 1, 0);
  const st = { pos: Math.min(3, last), target: Math.min(3, last), vel: 0, raf: 0, t: 0, active: -1, scale: 1 };
  const W = 240;
  const paint = () => {
    const s = st.scale, gap = W * 0.78 * s, step = W * 0.27 * s, depth = W * 0.7 * s;
    cards.forEach((el, i) => {
      const d = i - st.pos, ad = Math.abs(d);
      if (ad > 8) { el.style.visibility = 'hidden'; return; }
      const t = Math.min(ad, 1), dir = Math.sign(d);
      const x = dir * (t * gap + Math.max(ad - 1, 0) * step);
      const k = 1 - t * 0.08 - Math.min(Math.max(ad - 1, 0), 4) * 0.015;
      el.style.visibility = '';
      el.style.transform = `translate3d(${x.toFixed(1)}px,0,${(-t * depth).toFixed(1)}px) rotateY(${(-dir * t * 50).toFixed(2)}deg) scale(${k.toFixed(4)})`;
      el.style.zIndex = String(1000 - Math.round(ad * 10));
      el.style.setProperty('--t', t.toFixed(3));
    });
    const now = Math.round(Math.min(Math.max(st.pos, 0), last));
    if (now !== st.active) {
      st.active = now;
      cards.forEach((c, i) => c.setAttribute('aria-selected', String(i === now)));
      const it = items[now];
      if (it) {
        cap.querySelector('b')!.textContent = it.title;
        cap.querySelector('span')!.textContent = it.sub;
        cap.href = it.href || '#';
        cap.classList.remove('is-in'); void cap.offsetWidth; cap.classList.add('is-in');
      }
    }
  };
  const run = () => {
    if (!life.alive() || st.raf) return;
    st.t = performance.now();
    const frame = (now: number) => {
      st.raf = 0;
      if (!life.alive()) return;
      if (media.matches) { st.pos = st.target = Math.min(last, Math.max(0, Math.round(st.target))); st.vel = 0; paint(); return; }
      const dt = Math.min(now - st.t, 32) / 1000;
      st.t = now;
      const k = 190, c = 2 * Math.sqrt(k); // Critical damping: settle without a bounce.
      st.vel += (k * (st.target - st.pos) - c * st.vel) * dt;
      st.pos += st.vel * dt;
      if (Math.abs(st.target - st.pos) < 0.0006 && Math.abs(st.vel) < 0.002) { st.pos = st.target; st.vel = 0; st.raf = 0; paint(); return; }
      paint();
      st.raf = requestAnimationFrame(frame);
    };
    st.raf = requestAnimationFrame(frame);
  };
  const goTo = (i: number) => { if (!life.alive()) return; st.target = Math.min(Math.max(Math.round(i), 0), last); if (media.matches) { st.pos = st.target; st.vel = 0; paint(); } else run(); };
  const fit = () => { if (!life.alive()) return; st.scale = Math.min(1, Math.max(0.5, box.clientWidth / (W * 3.2))); box.style.setProperty('--cf-s', String(st.scale)); paint(); };
  const sizing = new ResizeObserver(fit); sizing.observe(box);
  life.cleanup(() => sizing.disconnect());
  fit();
  box.querySelectorAll<HTMLButtonElement>('[data-cf-step]').forEach((b) => b.addEventListener('click', () => goTo(st.target + Number(b.dataset.cfStep)), { signal }));
  box.addEventListener('keydown', (e) => {
    const map: Record<string, number> = { ArrowLeft: st.target - 1, ArrowRight: st.target + 1, Home: 0, End: last };
    if (e.key in map) { e.preventDefault(); goTo(map[e.key]); }
    else if (e.key === 'Enter' && e.target === box) { const h = items[Math.round(st.target)]?.href; if (h) location.hash = h.replace(/^#/, ''); }
  }, { signal });
  // 가로 스크롤(트랙패드)로 넘기기 — 세로 스크롤은 페이지에 그대로
  let snap = 0;
  box.addEventListener('wheel', (e) => {
    const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
    if (Math.abs(dx) <= Math.abs(e.deltaY) && !e.shiftKey) return;
    e.preventDefault();
    clearTimeout(snap);
    if (media.matches) { goTo(st.target + Math.sign(dx)); return; }
    st.target = Math.min(Math.max(st.target + dx / (110 * st.scale * 1.4), -0.35), last + 0.35);
    run();
    clearTimeout(snap);
    snap = window.setTimeout(() => goTo(st.target + Math.sign(dx) * 0.3), 110);
  }, { passive: false, signal } as AddEventListenerOptions);
  // 끌기·튕기기: 손가락을 1:1로 따라오고 놓으면 속도만큼 더 간 뒤 가까운 커버에 선다
  let drag: { id: number; x: number; y: number; from: number; moved: boolean; hit: number | null; s: { x: number; t: number }[] } | null = null;
  const stage = box.querySelector<HTMLElement>('.fx-cf-stage')!;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drag || !life.alive()) return;
    const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-cf]');
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, from: st.pos, moved: false, hit: hit ? Number(hit.dataset.cf) : null, s: [{ x: e.clientX, t: performance.now() }] };
  }, { signal });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.abs(dy) >= 8 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy) * 1.15) return;
      drag.moved = true; stage.setPointerCapture(e.pointerId); box.dataset.dragging = '';
    }
    cancelAnimationFrame(st.raf); st.raf = 0;
    let p = drag.from - dx / (110 * st.scale);
    if (p < 0) p *= 0.3;
    if (p > last) p = last + (p - last) * 0.3;
    st.pos = st.target = p; st.vel = 0;
    drag.s.push({ x: e.clientX, t: performance.now() }); if (drag.s.length > 6) drag.s.shift();
    paint();
  }, { signal });
  const up = (e: PointerEvent) => {
    const d = drag;
    if (!d || d.id !== e.pointerId) return;
    drag = null;
    if (stage.hasPointerCapture?.(d.id)) stage.releasePointerCapture(d.id);
    delete box.dataset.dragging;
    if (!d.moved) {
      if (d.hit === null) return;
      if (d.hit === Math.round(st.target)) { const h = items[d.hit]?.href; if (h) location.hash = h.replace(/^#/, ''); }
      else goTo(d.hit);
      return;
    }
    const a = d.s[0], b = d.s[d.s.length - 1];
    const v = -((b.x - a.x) / Math.max(b.t - a.t, 1)) * 1000 / (110 * st.scale);
    st.vel = media.matches ? 0 : v;
    let to = Math.round(st.pos + v * 0.18);
    if (Math.abs(v) > 0.8 && to === Math.round(d.from)) to += Math.sign(v);
    goTo(to);
  };
  stage.addEventListener('pointerup', up, { signal });
  const cancel = (e?: PointerEvent) => {
    if (e && (!drag || drag.id !== e.pointerId)) return;
    const d = drag; drag = null;
    if (d && stage.hasPointerCapture?.(d.id)) stage.releasePointerCapture(d.id);
    delete box.dataset.dragging;
    st.target = Math.min(last, Math.max(0, Math.round(st.pos))); st.vel = 0;
    if (life.alive()) goTo(st.target);
  };
  stage.addEventListener('pointercancel', cancel, { signal });
  stage.addEventListener('lostpointercapture', cancel, { signal });
  const onMotion = () => {
    clearTimeout(snap); snap = 0;
    cancelAnimationFrame(st.raf); st.raf = 0;
    cancel();
    st.pos = st.target; st.vel = 0; paint();
  };
  media.addEventListener('change', onMotion, { signal });
  life.cleanup(() => {
    clearTimeout(snap); cancelAnimationFrame(st.raf); st.raf = 0;
    const d = drag; drag = null;
    if (d && stage.hasPointerCapture?.(d.id)) stage.releasePointerCapture(d.id);
    delete box.dataset.dragging;
    delete box.dataset.bound;
  });
  paint();
}

/* ---------- 6. 끝없는 띠 (Logo Marquee) ---------- */
export function bindMarquee(box: HTMLElement, signal?: AbortSignal, speed = 32) {
  const rows = Array.from(box.querySelectorAll<HTMLElement>('.fx-mq-row'));
  if (!rows.length || box.dataset.bound || signal?.aborted || !box.isConnected) return;
  box.dataset.bound = '1';
  const life = flowLifetime(box, signal);
  signal = life.signal;
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const state = rows.map((row, i) => ({ row, x: 0, v: 0, dir: i % 2 ? 1 : -1, w: 0 }));
  const measure = () => { if (life.alive()) state.forEach((s) => { s.w = s.row.scrollWidth / 2; }); };
  let hover = false, visible = true, raf = 0, t0 = 0, blockedUntil = 0;
  let drag: { x: number; y: number; startX: number; moved: boolean; id: number; s: { x: number; t: number }[]; row: (typeof state)[number] } | null = null;
  const sizing = new ResizeObserver(measure); sizing.observe(box); measure();
  const paint = () => state.forEach(s => {
    // Modulo wrapping is bounded even after a long frame or a very fast fling.
    if (s.w > 0) s.x = ((s.x % s.w) + s.w) % s.w - s.w;
    s.row.style.transform = `translate3d(${s.x.toFixed(2)}px,0,0)`;
  });
  const stop = () => { cancelAnimationFrame(raf); raf = 0; t0 = 0; };
  const eligible = () => life.alive() && visible && !document.hidden && !media.matches;
  const frame = (now: number) => {
    raf = 0;
    if (!eligible()) return;
    const dt = t0 ? Math.min(now - t0, 48) / 1000 : 0; t0 = now;
    for (const s of state) {
      if (drag?.row === s) continue;
      const target = hover ? 0 : speed * s.dir;
      s.v += (target - s.v) * Math.min(1, dt * (Math.abs(s.v - target) > 120 ? 2.2 : 4));
      s.x += s.v * dt;
    }
    paint(); raf = requestAnimationFrame(frame);
  };
  const schedule = () => { if (eligible()) { if (!raf) raf = requestAnimationFrame(frame); } else stop(); };
  const visibility = new IntersectionObserver(([e]) => { visible = e.isIntersecting; schedule(); }); visibility.observe(box);
  box.addEventListener('pointerenter', () => { hover = true; }, { signal });
  box.addEventListener('pointerleave', () => { hover = box.contains(document.activeElement); }, { signal });
  box.addEventListener('focusin', () => { hover = true; }, { signal });
  box.addEventListener('focusout', () => { hover = box.matches(':hover'); }, { signal });
  box.addEventListener('pointerdown', (e) => {
    const row = state.find((s) => s.row.contains(e.target as Node));
    if (!row || e.button !== 0 || drag || !life.alive()) return;
    drag = { x: e.clientX, y: e.clientY, startX: e.clientX, moved: false, id: e.pointerId, s: [{ x: e.clientX, t: performance.now() }], row };
  }, { signal });
  box.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const totalX = e.clientX - drag.startX, totalY = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.abs(totalY) >= 8 && Math.abs(totalY) > Math.abs(totalX)) { drag = null; blockedUntil = performance.now() + 250; return; }
      if (Math.abs(totalX) < 8 || Math.abs(totalX) <= Math.abs(totalY) * 1.15) return;
      drag.moved = true; box.dataset.dragging = ''; box.setPointerCapture(e.pointerId);
    }
    drag.row.x += e.clientX - drag.x; drag.x = e.clientX; drag.row.v = 0;
    drag.s.push({ x: e.clientX, t: performance.now() }); if (drag.s.length > 6) drag.s.shift();
    paint();
  }, { signal });
  const finish = (e?: PointerEvent, cancelled = false) => {
    if (e && (!drag || drag.id !== e.pointerId)) return;
    const d = drag; drag = null;
    if (d && box.hasPointerCapture?.(d.id)) box.releasePointerCapture(d.id);
    if (d) {
      const a = d.s[0], b = d.s[d.s.length - 1];
      d.row.v = cancelled || media.matches || !d.moved ? 0 : Math.max(-1500, Math.min(1500, ((b.x - a.x) / Math.max(b.t - a.t, 1)) * 1000));
      if (d.moved || cancelled) blockedUntil = performance.now() + 250;
    }
    delete box.dataset.dragging;
  };
  box.addEventListener('pointerup', e => finish(e), { signal });
  box.addEventListener('pointercancel', e => finish(e, true), { signal });
  box.addEventListener('lostpointercapture', e => finish(e, true), { signal });
  box.addEventListener('click', e => { if (drag?.moved || performance.now() < blockedUntil) e.preventDefault(); }, { capture: true, signal });
  document.addEventListener('visibilitychange', schedule, { signal });
  media.addEventListener('change', () => { finish(undefined, true); state.forEach(s => { s.v = 0; }); schedule(); }, { signal });
  life.cleanup(() => { stop(); finish(undefined, true); sizing.disconnect(); visibility.disconnect(); delete box.dataset.bound; });
  paint(); schedule();
}

/* ---------- 7. 출발 안내판 — 시각은 처음부터 읽을 수 있다 ---------- */
export function bindBoard(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.fx-board [data-flap]').forEach((el) => {
    if (el.dataset.fxTick) return;
    ticker(el);
  });
}

/* ---------- 덧입히기 ---------- */
function enhance(scope: ParentNode) {
  for (const [sel, kind] of GLIDE) scope.querySelectorAll<HTMLElement>(sel).forEach((b) => glide(b, kind));
  scope.querySelectorAll<HTMLElement>(TICK_SEL).forEach((el) => ticker(el));
  scope.querySelectorAll<HTMLElement>(TILT_SEL).forEach((el) => tilt(el));
}
let installation: (() => void) | null = null;
export function installFx() {
  if (installation) return installation;
  let raf = 0;
  /* Staged reveal and the ribbon band ride this observer's ticks; they add no document observer. */
  const kinetic = installKinetic();
  const run = () => { raf = 0; sweepEffects(); enhance(document); kinetic.scan(document); };
  const observer = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(run); });
  const destroy = () => {
    observer.disconnect(); cancelAnimationFrame(raf); raf = 0;
    kinetic.destroy();
    for (const effect of [...effects]) effect.destroy();
    window.removeEventListener('pagehide', destroy);
    installation = null;
  };
  installation = destroy;
  run();
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('pagehide', destroy, { once: true });
  return destroy;
}
