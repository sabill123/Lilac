/* Lilac 인터랙션 레이어
   레퍼런스를 React 없이 옮겼다(값은 원본 그대로):
   - affectUI(MIT): Segmented Control(미끄러지는 표시·앞쪽 모서리가 먼저 가는 늘어남), Number Ticker(자리별 굴림·처음 보일 때 0부터),
     Text Reveal(단어마다 흐림에서 떠오름), Reaction Bar(톡 튀는 아이콘·한 자리씩 굴러가는 수), Cover Flow(3D 커버·스프링), Logo Marquee(끝없는 띠·멈춤·관성)
   - Inspora: Airport matrix time(출발 안내판), holo 3D card(포인터 따라 기우는 카드 — 반짝이는 빛 반사는 빼고 기울기·그림자만)
   화면 코드는 그대로 두고, 그려진 DOM을 보고 덧입힌다. 움직임 줄이기 설정이면 전부 끈다. */

import { getLocale } from './i18n';

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

let routeAt = performance.now();
/** 경로를 옮길 때만 제목·섹션 등장 효과를 쓴다(실시간 반영으로 다시 그릴 때 깜빡이지 않게) */
export function markRoute() { routeAt = performance.now(); }
const freshRoute = () => performance.now() - routeAt < 1600;

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
  if (box.dataset.fxGlide) return;
  box.dataset.fxGlide = kind;
  const bar = document.createElement('span');
  bar.className = `fx-glide fx-glide-${kind}`;
  bar.setAttribute('aria-hidden', 'true');
  box.append(bar); // 앞에 넣으면 기존 :first-child 규칙(첫 탭 왼쪽 여백 등)이 깨진다
  let lastX = -1;
  let first = true;
  const place = () => {
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
    if (first || reduce()) bar.style.transition = 'none';
    bar.style.left = `${x}px`;
    bar.style.right = `${Math.max(0, right)}px`;
    if (kind === 'line') { bar.style.top = ''; bar.style.height = ''; }
    else { bar.style.top = `${on.offsetTop}px`; bar.style.height = `${on.offsetHeight}px`; bar.style.borderRadius = getComputedStyle(on).borderRadius; }
    bar.style.opacity = '1';
    if (first) { void bar.offsetWidth; bar.style.transition = ''; first = false; }
    lastX = x;
  };
  place();
  new MutationObserver(() => requestAnimationFrame(place)).observe(box, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-selected', 'aria-current', 'hidden'], childList: true });
  new ResizeObserver(() => { first = true; place(); }).observe(box);
}

/* ---------- 2. 굴러가는 숫자 (Number Ticker) ---------- */
const easeOut4 = (t: number) => 1 - Math.pow(1 - t, 4);
const mod10 = (n: number) => ((n % 10) + 10) % 10;
/** 숫자 칸은 글자를 DOM에 넣지 않고(::before) 그린다 — textContent는 원래 글자 그대로라 다른 코드·검색이 깨지지 않는다 */
export function ticker(el: HTMLElement, { delay = 0, from0 = true } = {}) {
  const text = (el.textContent || '').trim();
  if (!/\d/.test(text) || el.dataset.fxTick === text || text.length > 16) return;
  /* 값이 바뀌면(좋아요 수 등) 화면 코드가 글자를 통째로 바꾼다 — 직전 값은 data-fx-tick에 남아 있어 거기서부터 굴린다 */
  const old = el.dataset.fxTick || '';
  const prevDigits = Array.from(old).filter((c) => c >= '0' && c <= '9').map(Number);
  el.dataset.fxTick = text;
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
    const t0 = performance.now();
    // 왼쪽 자리일수록 조금 늦게 — 안내판처럼 한 칸씩 넘어간다
    const deltas = to.map((v, i) => { const d = mod10(v - start[i]); return d === 0 && from0 && !prevDigits.length ? 10 : d; });
    const frame = (now: number) => {
      let done = true;
      stacks.forEach((s, i) => {
        const lag = (stacks.length - 1 - i) * 40;
        const t = Math.min(1, Math.max(0, (now - t0 - lag) / 900));
        if (t < 1) done = false;
        set(s, start[i] + deltas[i] * easeOut4(t));
      });
      if (!done) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    setTimeout(roll, delay);
  }, { threshold: 0.3 });
  io.observe(el);
}
const TICK_SEL = '.chip .n, .tl-cap small, .soc-like .n, #aCount, [data-tick]';

/* ---------- 3. 제목 등장 (Text Reveal) ---------- */
function reveal(h: HTMLElement) {
  if (h.dataset.fxRv) return;
  h.dataset.fxRv = '1';
  if (reduce() || !freshRoute()) return;
  let i = 0;
  for (const node of Array.from(h.childNodes)) {
    if (node.nodeType === 3) {
      const parts = (node.textContent || '').split(/(\s+)/);
      const frag = document.createDocumentFragment();
      for (const p of parts) {
        if (!p) continue;
        if (/^\s+$/.test(p)) { frag.append(p); continue; }
        const s = document.createElement('span');
        s.className = 'fx-rv';
        s.style.setProperty('--i', String(i++));
        s.textContent = p;
        frag.append(s);
      }
      node.replaceWith(frag);
    } else if (node instanceof HTMLElement) {
      node.classList.add('fx-rv');
      node.style.setProperty('--i', String(i++));
    }
  }
  requestAnimationFrame(() => h.classList.add('fx-rv-on'));
}
const REVEAL_SEL = '.page-head h1, .tl-page-title, .sec-head h2, .tl-sec-title';

/* 섹션이 화면에 들어올 때 살짝 떠오른다 — 경로를 옮긴 직후에 그려진 것만 */
let secIO: IntersectionObserver | null = null;
function riseIn(sec: HTMLElement) {
  if (sec.dataset.fxRise || reduce() || !freshRoute()) { sec.dataset.fxRise = '1'; return; }
  sec.dataset.fxRise = '1';
  const r = sec.getBoundingClientRect();
  if (r.top < innerHeight * 0.9) return; // 첫 화면은 바로 보이게
  sec.classList.add('fx-rise');
  secIO ??= new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('fx-rise-on'); secIO!.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  secIO.observe(sec);
  setTimeout(() => sec.classList.add('fx-rise-on'), 2600); // 관찰이 안 되는 환경에서도 결국 보이게
}

/* ---------- 4. 기우는 카드 (holo 3D card — 빛 반사 없이) ---------- */
export function tilt(el: HTMLElement, max = 7) {
  if (el.dataset.fxTilt || !fine() || reduce()) return;
  el.dataset.fxTilt = '1';
  el.classList.add('fx-tilt');
  let raf = 0;
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      el.classList.add('is-tilting');
      el.style.setProperty('--rx', `${(-py * max * 2).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${(px * max * 2).toFixed(2)}deg`);
    });
  });
  el.addEventListener('pointerleave', () => {
    cancelAnimationFrame(raf);
    el.classList.remove('is-tilting');
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  });
}
const TILT_SEL = '.tl-pd-imgbox, .pdp-img, [data-tilt]';

/* ---------- 5. 커버 플로 (Cover Flow) ---------- */
export type FlowItem = { id: string; image: string | null; title: string; sub: string; href?: string; initial?: string };
export function coverFlowHtml(items: FlowItem[], label: string) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return `<div class="fx-cf" tabindex="0" role="listbox" aria-label="${esc(label)}" data-fx-flow>
    <div class="fx-cf-stage">${items.map((it, i) => `<div class="fx-cf-card" role="option" aria-selected="false" data-cf="${i}" aria-label="${esc(it.title)}">
      <div class="fx-cf-face">${it.image ? `<img src="${esc(it.image)}" alt="" draggable="false" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span class="fx-cf-ph" aria-hidden="true">${esc((it.initial || it.title).slice(0, 1).toUpperCase())}</span></div>
      <div class="fx-cf-mirror" aria-hidden="true">${it.image ? `<img src="${esc(it.image)}" alt="" draggable="false" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</div>
    </div>`).join('')}</div>
    <div class="fx-cf-foot"><button type="button" class="fx-cf-btn" data-cf-step="-1" aria-label="${getLocale() === 'ja' ? '前へ' : '이전'}">‹</button><a class="fx-cf-cap" href="#"><b></b><span></span></a><button type="button" class="fx-cf-btn" data-cf-step="1" aria-label="${getLocale() === 'ja' ? '次へ' : '다음'}">›</button></div>
  </div>`;
}
export function bindCoverFlow(root: HTMLElement, items: FlowItem[], signal?: AbortSignal) {
  const box = root.querySelector<HTMLElement>('[data-fx-flow]');
  if (!box || box.dataset.bound) return;
  box.dataset.bound = '1';
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
    if (st.raf) return;
    st.t = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(now - st.t, 32) / 1000;
      st.t = now;
      const k = 190, c = 2 * Math.sqrt(k) * 0.92; // 임계 감쇠보다 살짝 아래 — 아주 조금만 출렁이고 멈춘다
      st.vel += (k * (st.target - st.pos) - c * st.vel) * dt;
      st.pos += st.vel * dt;
      if (Math.abs(st.target - st.pos) < 0.0006 && Math.abs(st.vel) < 0.002) { st.pos = st.target; st.vel = 0; st.raf = 0; paint(); return; }
      paint();
      st.raf = requestAnimationFrame(frame);
    };
    st.raf = requestAnimationFrame(frame);
  };
  const goTo = (i: number) => { st.target = Math.min(Math.max(Math.round(i), 0), last); if (reduce()) { st.pos = st.target; st.vel = 0; paint(); } else run(); };
  const fit = () => { st.scale = Math.min(1, Math.max(0.5, box.clientWidth / (W * 3.2))); box.style.setProperty('--cf-s', String(st.scale)); paint(); };
  new ResizeObserver(fit).observe(box);
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
    st.target = Math.min(Math.max(st.target + dx / (110 * st.scale * 1.4), -0.35), last + 0.35);
    run();
    clearTimeout(snap);
    snap = window.setTimeout(() => goTo(st.target + Math.sign(dx) * 0.3), 110);
  }, { passive: false, signal } as AddEventListenerOptions);
  // 끌기·튕기기: 손가락을 1:1로 따라오고 놓으면 속도만큼 더 간 뒤 가까운 커버에 선다
  let drag: { id: number; x: number; from: number; moved: boolean; hit: number | null; s: { x: number; t: number }[] } | null = null;
  const stage = box.querySelector<HTMLElement>('.fx-cf-stage')!;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-cf]');
    drag = { id: e.pointerId, x: e.clientX, from: st.pos, moved: false, hit: hit ? Number(hit.dataset.cf) : null, s: [{ x: e.clientX, t: performance.now() }] };
  }, { signal });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved) { if (Math.abs(dx) < 6) return; drag.moved = true; stage.setPointerCapture(e.pointerId); box.dataset.dragging = ''; }
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
    delete box.dataset.dragging;
    if (!d.moved) {
      if (d.hit === null) return;
      if (d.hit === Math.round(st.target)) { const h = items[d.hit]?.href; if (h) location.hash = h.replace(/^#/, ''); }
      else goTo(d.hit);
      return;
    }
    const a = d.s[0], b = d.s[d.s.length - 1];
    const v = -((b.x - a.x) / Math.max(b.t - a.t, 1)) * 1000 / (110 * st.scale);
    st.vel = reduce() ? 0 : v;
    let to = Math.round(st.pos + v * 0.18);
    if (Math.abs(v) > 0.8 && to === Math.round(d.from)) to += Math.sign(v);
    goTo(to);
  };
  stage.addEventListener('pointerup', up, { signal });
  stage.addEventListener('pointercancel', up, { signal });
  paint();
}

/* ---------- 6. 끝없는 띠 (Logo Marquee) ---------- */
export function bindMarquee(box: HTMLElement, signal?: AbortSignal, speed = 32) {
  const rows = Array.from(box.querySelectorAll<HTMLElement>('.fx-mq-row'));
  if (!rows.length || box.dataset.bound) return;
  box.dataset.bound = '1';
  const state = rows.map((row, i) => ({ row, x: 0, v: 0, dir: i % 2 ? 1 : -1, w: 0 }));
  const measure = () => state.forEach((s) => { s.w = (s.row.scrollWidth) / 2; });
  measure();
  new ResizeObserver(measure).observe(box);
  let hover = false, drag: { x: number; id: number; s: { x: number; t: number }[]; row: (typeof state)[number] } | null = null;
  box.addEventListener('pointerenter', () => { hover = true; }, { signal });
  box.addEventListener('pointerleave', () => { hover = false; }, { signal });
  box.addEventListener('focusin', () => { hover = true; }, { signal });
  box.addEventListener('focusout', () => { hover = false; }, { signal });
  box.addEventListener('pointerdown', (e) => {
    const row = state.find((s) => s.row.contains(e.target as Node));
    if (!row || e.button !== 0) return;
    drag = { x: e.clientX, id: e.pointerId, s: [{ x: e.clientX, t: performance.now() }], row };
  }, { signal });
  box.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 4) box.dataset.dragging = '';
    drag.row.x += dx; drag.x = e.clientX; drag.row.v = 0;
    drag.s.push({ x: e.clientX, t: performance.now() }); if (drag.s.length > 6) drag.s.shift();
  }, { signal });
  const up = (e: PointerEvent) => {
    if (!drag || drag.id !== e.pointerId) return;
    const a = drag.s[0], b = drag.s[drag.s.length - 1];
    drag.row.v = ((b.x - a.x) / Math.max(b.t - a.t, 1)) * 1000; // 놓을 때 속도로 관성
    drag = null;
    setTimeout(() => delete box.dataset.dragging, 0);
  };
  box.addEventListener('pointerup', up, { signal });
  box.addEventListener('pointercancel', up, { signal });
  // 끌다가 놓은 직후의 클릭은 링크로 넘어가지 않게
  box.addEventListener('click', (e) => { if (box.dataset.dragging !== undefined) e.preventDefault(); }, { capture: true, signal });
  if (reduce()) return;
  let t0 = performance.now(), raf = 0, visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(box);
  const frame = (now: number) => {
    if (signal?.aborted || !box.isConnected) return;
    const dt = Math.min(now - t0, 48) / 1000;
    t0 = now;
    if (visible && !document.hidden) {
      for (const s of state) {
        if (drag?.row === s) continue;
        const target = hover ? 0 : speed * s.dir;
        s.v += (target - s.v) * Math.min(1, dt * (Math.abs(s.v - target) > 120 ? 2.2 : 4));
        s.x += s.v * dt;
        if (s.w > 0) { while (s.x <= -s.w) s.x += s.w; while (s.x > 0) s.x -= s.w; }
        s.row.style.transform = `translate3d(${s.x.toFixed(2)}px,0,0)`;
      }
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  signal?.addEventListener('abort', () => cancelAnimationFrame(raf), { once: true });
}

/* ---------- 7. 출발 안내판 (Airport matrix time) — 시각은 한 칸씩 넘어가며 들어온다 ---------- */
export function bindBoard(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.fx-board [data-flap]').forEach((el, i) => {
    if (el.dataset.fxTick) return;
    ticker(el, { delay: 80 + i * 70 });
  });
}

/* ---------- 덧입히기 ---------- */
function enhance(scope: ParentNode) {
  for (const [sel, kind] of GLIDE) scope.querySelectorAll<HTMLElement>(sel).forEach((b) => glide(b, kind));
  scope.querySelectorAll<HTMLElement>(TICK_SEL).forEach((el) => ticker(el, { from0: freshRoute() }));
  scope.querySelectorAll<HTMLElement>(REVEAL_SEL).forEach(reveal);
  scope.querySelectorAll<HTMLElement>(TILT_SEL).forEach((el) => tilt(el));
  scope.querySelectorAll<HTMLElement>('#page > .sec, #page > section, #page .live-view > .sec, .tl-sec, .tl-region-sec').forEach(riseIn);
}
let queued = false;
export function installFx() {
  const run = () => { queued = false; enhance(document); };
  run();
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } }).observe(document.body, { childList: true, subtree: true });
}
