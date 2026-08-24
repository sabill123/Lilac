/**
 * three.js 씬 로더
 *
 * three.js 는 압축 후에도 130KB 가까이 된다. 그 비용을 아무에게나 물리지 않도록
 *   1) 이 파일을 거쳐 동적 import 로만 불러오고 (별도 청크로 분리된다)
 *   2) 메인 스레드가 한가해진 뒤에 로드하며 (초기 렌더를 막지 않는다)
 *   3) 3D를 켜도 되는 환경인지 먼저 판단한다.
 */

export interface SceneHandle { destroy(): void; }

interface NetInfo { effectiveType?: string; saveData?: boolean }

/** 3D 씬을 만들어도 되는 환경인가 */
export function can3D(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  // 좁은 화면에서는 3D가 읽기를 방해하고 배터리만 쓴다
  if (window.innerWidth <= 900) return false;
  if (navigator.maxTouchPoints > 0 && !window.matchMedia('(hover: hover)').matches) return false;
  // 저사양 기기 (코어 수는 대략적인 신호지만 실용적이다)
  if ((navigator.hardwareConcurrency || 8) <= 2) return false;

  // 느린 회선·데이터 절약 모드에서는 포기한다. 장식에 낼 비용이 아니다.
  const conn = (navigator as unknown as { connection?: NetInfo }).connection;
  if (conn?.saveData) return false;
  if (conn?.effectiveType && ['slow-2g', '2g', '3g'].includes(conn.effectiveType)) return false;

  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

/** 현재 페이지에 떠 있는 씬 */
let active: SceneHandle | null = null;
/** 라우팅이 바뀌면 대기 중이던 마운트를 무효화하기 위한 토큰 */
let mountToken = 0;

export function disposeScene(): void {
  mountToken++;
  active?.destroy();
  active = null;
}

/** 메인 스레드가 한가해질 때까지 기다린다 */
function whenIdle(fn: () => void): void {
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 2000 });
  else setTimeout(fn, 300);
}

type Mounter = (host: HTMLElement) => Promise<SceneHandle | null>;

function mountWhenIdle(host: HTMLElement, make: Mounter): Promise<void> {
  const token = ++mountToken;
  return new Promise((resolve, reject) => {
    whenIdle(async () => {
      // 그 사이 다른 페이지로 이동했으면 조용히 포기한다
      if (token !== mountToken || !host.isConnected) { resolve(); return; }
      try {
        const handle = await make(host);
        if (token !== mountToken || !host.isConnected) { handle?.destroy(); resolve(); return; }
        active?.destroy();
        active = handle;
        resolve();
      } catch (e) { reject(e); }
    });
  });
}

export function mountHero3D(host: HTMLElement, items: import('./hero3d').HeroItem[]): Promise<void> {
  if (!can3D() || !items.length) return Promise.resolve();
  return mountWhenIdle(host, async (h) => {
    const { createHero3D } = await import('./hero3d');
    return createHero3D(h, items);
  });
}

export function mountChart3D(host: HTMLElement, items: import('./chart3d').Chart3DItem[]): Promise<void> {
  if (!can3D() || !items.length) return Promise.resolve();
  return mountWhenIdle(host, async (h) => {
    const { createChart3D } = await import('./chart3d');
    return createChart3D(h, items);
  });
}
