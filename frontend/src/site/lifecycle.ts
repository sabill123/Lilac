/* ============================================================
   마케팅 페이지 수명주기 정리.

   왜 필요한가.
   이 레이어는 SPA 안에서 innerHTML 을 갈아끼우는 방식으로 페이지를 바꾼다.
   DOM 노드는 그때 사라지지만, window·document 에 직접 건 리스너와
   IntersectionObserver / ResizeObserver 는 살아남는다. 그러면
   · 스크롤 한 번에 죽은 스크롤스파이 핸들러가 N개씩 돌고
   · 사라진 DOM 을 잡은 클로저가 회수되지 않는다.

   실제로 측정했다. 사이트↔앱 3회 왕복에
     window.resize +3 / window.scroll +3 / document.keydown +9
   가 그대로 누적됐다.

   그래서 전역에 무언가를 걸었으면 반드시 여기에 해제 함수를 등록하고,
   라우트가 바뀔 때 renderSitePage 가 일괄 정리한다.
   ============================================================ */

type Teardown = () => void;

let teardowns: Teardown[] = [];

/** 해제 함수를 등록한다. 다음 라우트 전환 때 호출된다. */
export function onCleanup(fn: Teardown) {
  teardowns.push(fn);
}

/** window/document 리스너를 걸면서 해제까지 한 번에 등록하는 헬퍼 */
export function listen<T extends EventTarget>(
  target: T,
  type: string,
  handler: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions,
) {
  target.addEventListener(type, handler, options);
  onCleanup(() => target.removeEventListener(type, handler, options));
}

/** 옵저버를 등록하고 해제까지 예약한다 */
export function observe<T extends { disconnect(): void }>(observer: T): T {
  onCleanup(() => observer.disconnect());
  return observer;
}

/** 라우트 전환·사이트 이탈 시 호출 */
export function runCleanup() {
  const list = teardowns;
  teardowns = [];
  for (const fn of list) {
    try {
      fn();
    } catch {
      /* 정리 중 하나가 실패해도 나머지는 계속 정리한다 */
    }
  }
}

/** 테스트·진단용 — 현재 대기 중인 해제 함수 수 */
export function pendingCleanups() {
  return teardowns.length;
}
