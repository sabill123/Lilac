// 인터랙션 · 모션 유틸
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** 터치 기기: 호버 기반 인터랙션(틸트·확장·글레어)은 의미가 없고 성능만 먹는다 */
export const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
if (isTouch) document.documentElement.classList.add('touch');

/* ---------- 3D 틸트 (커서 추적 perspective) ---------- */
export function bindTilt(scope: ParentNode = document) {
  if (reduced || isTouch) return;
  scope.querySelectorAll<HTMLElement>('[data-tilt]:not([data-tilt-on])').forEach((el) => {
    el.dataset.tiltOn = '1';
    const max = Number(el.dataset.tilt) || 10;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty('--rx', `${(-py * max).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${(px * max * 1.2).toFixed(2)}deg`);
      el.style.setProperty('--mx', `${((px + 0.5) * 100).toFixed(1)}%`);
      el.style.setProperty('--my', `${((py + 0.5) * 100).toFixed(1)}%`);
      el.style.setProperty('--tz', '14px');
    });
    el.addEventListener('pointerleave', () => {
      el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); el.style.setProperty('--tz', '0px');
    });
  });
}

/* ---------- 리플 (머티리얼식 클릭 파동) ---------- */
export function initRipple() {
  document.addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.btn-pill, .play-big, .btn-play-w, .btn-buy, .chip, .seg-btn');
    if (!el || reduced) return;
    const r = el.getBoundingClientRect();
    const s = document.createElement('span');
    s.className = 'ripple';
    const size = Math.max(r.width, r.height) * 2;
    s.style.width = s.style.height = `${size}px`;
    s.style.left = `${e.clientX - r.left - size / 2}px`;
    s.style.top = `${e.clientY - r.top - size / 2}px`;
    el.appendChild(s);
    setTimeout(() => s.remove(), 620);
  });
}

/* ---------- 긴 텍스트 마퀴 (넘칠 때만) ---------- */
export function applyMarquee(el: HTMLElement | null) {
  if (!el) return;
  const parent = el.parentElement!;
  el.classList.remove('marquee');
  el.style.removeProperty('--mq');
  requestAnimationFrame(() => {
    const over = el.scrollWidth - parent.clientWidth;
    if (over > 4 && !reduced) {
      el.style.setProperty('--mq', `-${over + 8}px`);
      el.classList.add('marquee');
    }
  });
}

/* ---------- 히어로 패럴랙스 (스크롤 연동) ---------- */
export function bindParallax(scroller: HTMLElement) {
  if (reduced) return;
  let ticking = false;
  const run = () => {
    const y = scroller.scrollTop;
    scroller.querySelectorAll<HTMLElement>('[data-parallax]').forEach((el) => {
      const k = Number(el.dataset.parallax) || 0.3;
      el.style.transform = `translate3d(0, ${(y * k).toFixed(1)}px, 0) scale(${1 + Math.min(y, 400) / 3000})`;
      el.style.opacity = String(Math.max(0, 1 - y / 620));
    });
    ticking = false;
  };
  scroller.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(run); } }, { passive: true });
}

/* ---------- 스크롤 리빌 ---------- */
let io: IntersectionObserver | null = null;
export function bindReveal(scope: ParentNode = document, rootEl?: Element | null) {
  io ??= new IntersectionObserver((es) => {
    es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('on'); io!.unobserve(en.target); } });
  }, { threshold: 0.08, root: rootEl ?? null });
  scope.querySelectorAll('.reveal:not(.on)').forEach((el) => io!.observe(el));
}

/* ---------- 드래그 정렬 (포인터 기반 — 마우스·터치 모두 지원) ---------- */
export function bindDragReorder(container: HTMLElement, onMove: (from: number, to: number) => void, rowSel = '.q-row[data-i]') {
  container.querySelectorAll<HTMLElement>(rowSel).forEach((row) => {
    row.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const startY = e.clientY;
      let dragging = false;
      let target: HTMLElement | null = null;

      const move = (ev: PointerEvent) => {
        if (!dragging && Math.abs(ev.clientY - startY) < 6) return;
        if (!dragging) { dragging = true; row.classList.add('dragging'); document.body.style.userSelect = 'none'; }
        container.querySelectorAll('.drop-tgt').forEach((x) => x.classList.remove('drop-tgt'));
        target = null;
        container.querySelectorAll<HTMLElement>(rowSel).forEach((r) => {
          if (r === row) return;
          const b = r.getBoundingClientRect();
          if (ev.clientY >= b.top && ev.clientY <= b.bottom) { target = r; r.classList.add('drop-tgt'); }
        });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.style.userSelect = '';
        row.classList.remove('dragging');
        container.querySelectorAll('.drop-tgt').forEach((x) => x.classList.remove('drop-tgt'));
        if (dragging && target) onMove(Number(row.dataset.i), Number((target as HTMLElement).dataset.i));
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  });
}

/* ---------- 컨텍스트 메뉴 ---------- */
export function openContextMenu(x: number, y: number, items: { label: string; icon?: string; danger?: boolean; run: () => void }[]) {
  const menu = document.getElementById('ctxMenu')!;
  menu.innerHTML = items.map((it, i) => `<button class="ctx-i ${it.danger ? 'danger' : ''}" data-i="${i}">
    ${it.icon ? `<svg class="ic s"><use href="#${it.icon}"/></svg>` : ''}<span>${it.label}</span></button>`).join('');
  menu.style.left = `${Math.min(x, innerWidth - 230)}px`;
  menu.style.top = `${Math.min(y, innerHeight - items.length * 40 - 20)}px`;
  menu.classList.add('show');
  menu.querySelectorAll<HTMLButtonElement>('.ctx-i').forEach((b) =>
    b.addEventListener('click', () => { items[Number(b.dataset.i)].run(); menu.classList.remove('show'); }));
}
export function initContextMenu() {
  document.addEventListener('click', () => document.getElementById('ctxMenu')!.classList.remove('show'));
  document.addEventListener('scroll', () => document.getElementById('ctxMenu')!.classList.remove('show'), true);
}

/* ---------- 키보드 단축키 ---------- */
export function initKeyboard(handlers: {
  toggle: () => void; next: () => void; prev: () => void; seek: (d: number) => void;
  queue: () => void; lyrics: () => void; like: () => void;
}) {
  // 마우스로 누른 버튼에 포커스가 남으면 Space가 이중 발동하므로 해제
  document.addEventListener('pointerup', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (b) b.blur();
  });
  let lastToggle = 0;
  const toggleOnce = () => {
    const now = Date.now();
    if (now - lastToggle < 240) return;
    lastToggle = now;
    handlers.toggle();
  };
  document.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') (e.target as HTMLElement).blur();
      return;
    }
    switch (e.key) {
      case ' ': e.preventDefault(); toggleOnce(); break;
      case 'ArrowRight': if (e.shiftKey) handlers.next(); else handlers.seek(5); break;
      case 'ArrowLeft': if (e.shiftKey) handlers.prev(); else handlers.seek(-5); break;
      case 'q': case 'ㅂ': handlers.queue(); break;
      case 'l': case 'ㅣ': handlers.lyrics(); break;
      case 'h': case 'ㅗ': handlers.like(); break;
      case '/': e.preventDefault(); (document.getElementById('searchInput') as HTMLInputElement)?.focus(); break;
      case 'Escape': document.querySelectorAll('.modal.show, .np-full.show').forEach((m) => m.classList.remove('show')); break;
    }
  });
}

/* ---------- 넷플릭스식 호버 확장 ---------- */
export function bindHoverExpand(scope: ParentNode = document) {
  if (reduced || isTouch) return;
  scope.querySelectorAll<HTMLElement>('.card[data-expand]:not([data-exp-on])').forEach((el) => {
    el.dataset.expOn = '1';
    let timer: number;
    el.addEventListener('pointerenter', () => { timer = window.setTimeout(() => el.classList.add('expanded'), 380); });
    el.addEventListener('pointerleave', () => { clearTimeout(timer); el.classList.remove('expanded'); });
  });
}
