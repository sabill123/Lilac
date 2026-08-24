/**
 * 3D 모션 레이어
 *
 * 성능 원칙
 *   1) 스크롤 연동 효과는 CSS scroll-driven animation 이 담당한다.
 *      이 파일은 클래스만 붙이고, 프레임마다 도는 JS는 두지 않는다.
 *   2) 포인터 틸트만 JS가 처리하되, 계산 결과는 CSS 변수로만 넘긴다.
 *      스타일 변경이 transform 한 줄로 끝나므로 레이아웃·페인트가 발생하지 않는다.
 *   3) 포인터 이벤트는 rAF 로 한 프레임에 한 번만 반영한다.
 *   4) 터치 기기·모션 최소화 설정에서는 아무것도 하지 않는다.
 */

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
/* 3D를 적용하지 않을 환경
   좁은 화면은 폭으로 판단한다. 에뮬레이터나 일부 기기에서 hover 미디어쿼리가
   실제 입력 방식과 다르게 보고되는 경우가 있어 폭 기준이 더 안전하다. */
const isTouch = () =>
  (navigator.maxTouchPoints > 0 && !window.matchMedia('(hover: hover)').matches)
  || window.innerWidth <= 900;

/** 스크롤 연동 애니메이션을 브라우저가 직접 처리할 수 있는가 */
const hasScrollTimeline = () => CSS.supports('animation-timeline: view()');

interface TiltOptions {
  max?: number;      // 최대 기울기(도)
  lift?: number;     // 앞으로 나오는 정도(px)
  glare?: boolean;   // 광택 레이어 사용 여부
}

/**
 * 포인터 틸트 바인딩
 * 요소당 리스너를 달지 않고 컨테이너에 위임해 리스너 수를 억제한다.
 */
export function bindTilt3D(scope: ParentNode, opts: TiltOptions = {}): void {
  if (reduceMotion() || isTouch()) return;
  const { max = 8, lift = 12, glare = true } = opts;

  const targets = scope.querySelectorAll<HTMLElement>('[data-d3-tilt]');
  if (!targets.length) return;

  targets.forEach((el) => {
    if (el.dataset.d3Bound === '1') return;
    el.dataset.d3Bound = '1';
    el.classList.add('d3-tilt');

    if (glare && !el.querySelector('.d3-glare')) {
      const g = document.createElement('span');
      g.className = 'd3-glare';
      g.setAttribute('aria-hidden', 'true');
      el.appendChild(g);
    }

    let raf = 0;
    let px = 0, py = 0;

    const apply = () => {
      raf = 0;
      const strength = Number(el.dataset.d3Tilt) || max;
      el.style.setProperty('--rx', `${(0.5 - py) * strength}deg`);
      el.style.setProperty('--ry', `${(px - 0.5) * strength}deg`);
      el.style.setProperty('--tz', `${lift}px`);
      el.style.setProperty('--gx', `${px * 100}%`);
      el.style.setProperty('--gy', `${py * 100}%`);
    };

    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      px = (e.clientX - r.left) / r.width;
      py = (e.clientY - r.top) / r.height;
      if (!raf) raf = requestAnimationFrame(apply);
    }, { passive: true });

    el.addEventListener('pointerenter', () => el.classList.add('is-tilting'), { passive: true });
    el.addEventListener('pointerleave', () => {
      el.classList.remove('is-tilting');
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
      el.style.setProperty('--tz', '0px');
    }, { passive: true });
  });
}

/* scroll-driven animation 을 지원하지 않는 브라우저용 폴백.
   IntersectionObserver 로 한 번만 클래스를 붙인다(프레임마다 도는 코드 없음). */
let fallbackIO: IntersectionObserver | null = null;
function ensureFallbackIO() {
  if (fallbackIO) return fallbackIO;
  fallbackIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('d3-shown');
      fallbackIO!.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.06 });
  return fallbackIO;
}

/**
 * 스크롤 진입 3D 등장 효과를 붙인다.
 * 지원 브라우저에서는 CSS가 알아서 처리하므로 클래스만 붙이면 끝난다.
 */
export function applyScrollMotion(scope: ParentNode): void {
  if (reduceMotion() || isTouch()) return;

  const rise = scope.querySelectorAll<HTMLElement>('[data-d3="rise"]');
  const slide = scope.querySelectorAll<HTMLElement>('[data-d3="slide"]');
  const head = scope.querySelectorAll<HTMLElement>('[data-d3="head"]');
  const hero = scope.querySelectorAll<HTMLElement>('[data-d3="hero"]');

  rise.forEach((el) => el.classList.add('d3-rise'));
  slide.forEach((el) => el.classList.add('d3-slide'));
  head.forEach((el) => el.classList.add('d3-head'));
  hero.forEach((el) => el.classList.add('d3-hero'));

  if (hasScrollTimeline()) return;   // 브라우저가 처리한다
  const io = ensureFallbackIO();
  [rise, slide, head].forEach((list) => Array.prototype.forEach.call(list, (el: Element) => io.observe(el)));
}

/**
 * 페이지 전환 시 한 번 재생되는 3D 진입 효과.
 * 매번 노드를 새로 그리므로 애니메이션이 자동으로 초기화된다.
 */
export function playEnter(el: HTMLElement | null): void {
  if (!el || reduceMotion() || isTouch()) return;
  el.classList.remove('d3-enter');
  void el.offsetWidth;               // 리플로우 강제 — 애니메이션 재시작용
  el.classList.add('d3-enter');
}

/* 페이지 내용이 비동기로 채워지는 경우가 많다.
   (예: 스토어 그리드는 페이지 셸을 그린 뒤 데이터가 오면 채워진다)
   라우팅 직후 한 번만 적용하면 나중에 추가된 카드는 효과를 못 받으므로
   DOM 변화를 감시해 새로 들어온 노드에도 적용한다. */
let motionObserver: MutationObserver | null = null;
let pendingApply = 0;

function scheduleApply(scope: ParentNode) {
  if (pendingApply) return;
  pendingApply = requestAnimationFrame(() => {
    pendingApply = 0;
    applyScrollMotion(scope);
    bindTilt3D(scope);
  });
}

/** 페이지 렌더 후 적용 + 이후 추가되는 노드까지 관찰 */
export function mountMotion3D(scope: ParentNode): void {
  applyScrollMotion(scope);
  bindTilt3D(scope);

  if (reduceMotion() || isTouch()) return;
  const target = (scope as Element).nodeType === 1 ? (scope as Element) : document.body;

  motionObserver?.disconnect();
  motionObserver = new MutationObserver((records) => {
    // 효과 대상이 실제로 추가됐을 때만 다시 훑는다
    for (const r of records) {
      for (const n of Array.from(r.addedNodes)) {
        if (n.nodeType !== 1) continue;
        const el = n as Element;
        if (el.matches?.('[data-d3], [data-d3-tilt]') || el.querySelector?.('[data-d3], [data-d3-tilt]')) {
          scheduleApply(scope);
          return;
        }
      }
    }
  });
  motionObserver.observe(target, { childList: true, subtree: true });
}
