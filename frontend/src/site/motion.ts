/* ============================================================
   모션 프리미티브 — 원본(사내 레퍼런스 프로젝트)의
   use-in-view-once / SectionReveal / CounterAnimation 이식.

   원본은 React 훅이라 "한 번만 관찰하고 unobserve"를 useEffect가 맡는다.
   라일락은 문자열 렌더 후 바인딩하는 구조라, 같은 규칙을 DOM 속성으로
   옮겼다. 이미 발화한 노드는 data-visible로 표시해 재바인딩 시
   중복 관찰되지 않는다.
   ============================================================ */

const REVEAL_MARGIN = '100px';
const COUNTER_MARGIN = '50px';

let revealIO: IntersectionObserver | null = null;
let counterIO: IntersectionObserver | null = null;

/** 원본 SectionReveal — .reveal-up 요소를 1회 노출 시 data-visible=true 로 전환 */
export function bindReveal(scope: ParentNode = document) {
  // reduced-motion 환경에서는 애니메이션 없이 즉시 노출한다(원본과 동일한 결론).
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    scope.querySelectorAll<HTMLElement>('.reveal-up').forEach((el) => {
      el.dataset.visible = 'true';
    });
    return;
  }

  revealIO ??= new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        (en.target as HTMLElement).dataset.visible = 'true';
        revealIO!.unobserve(en.target);
      });
    },
    { rootMargin: REVEAL_MARGIN },
  );

  scope.querySelectorAll<HTMLElement>('.reveal-up:not([data-visible="true"])').forEach((el) => {
    const delay = Number(el.dataset.delay || 0);
    if (delay > 0) el.style.transitionDelay = `${delay}ms`;
    revealIO!.observe(el);
  });
}

/** 원본 CounterAnimation — 화면에 들어올 때 0 → target 을 easeOutCubic 으로 센다 */
export function bindCounters(scope: ParentNode = document) {
  const run = (el: HTMLElement) => {
    const target = Number(el.dataset.counter || 0);
    const duration = Number(el.dataset.duration || 1200);
    const decimals = Number(el.dataset.decimals || 0);
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduce) {
      el.textContent = `${prefix}${target.toFixed(decimals)}${suffix}`;
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // 원본과 동일한 easeOutCubic
      el.textContent = `${prefix}${(eased * target).toFixed(decimals)}${suffix}`;
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  counterIO ??= new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const el = en.target as HTMLElement;
        el.dataset.counted = 'true';
        counterIO!.unobserve(el);
        run(el);
      });
    },
    { rootMargin: COUNTER_MARGIN },
  );

  scope.querySelectorAll<HTMLElement>('[data-counter]:not([data-counted])').forEach((el) => {
    counterIO!.observe(el);
  });
}

/** 마퀴 트랙을 2배로 복제 — 원본 DOUBLED = [...HERO_IMAGES, ...HERO_IMAGES] */
export function doubled<T>(items: T[]): T[] {
  return [...items, ...items];
}

/** 페이지 렌더 후 한 번에 거는 진입점 */
export function bindSiteMotion(scope: ParentNode = document) {
  bindReveal(scope);
  bindCounters(scope);
}
