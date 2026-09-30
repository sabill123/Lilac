/** Lazy, progressive enhancement. Call disposeScene before replacing a route. */
import type { SceneHandle } from './lifecycle';
export type { SceneHandle } from './lifecycle';

let webglAvailable: boolean | undefined;
/** Three r185 requires WebGL2. Reduced motion still permits a static artwork view. */
export function can3D(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return false;
  if (webglAvailable !== undefined) return webglAvailable;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true, powerPreference: 'low-power' });
    webglAvailable = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { webglAvailable = false; }
  return webglAvailable;
}

let active: SceneHandle | null = null;
let mountToken = 0;
let cancelPending: (() => void) | null = null;
let motionPaused = false;

/** User preference survives route switches. OS reduced motion cannot be overridden. */
export function setSceneMotionPaused(paused: boolean): void {
  motionPaused = paused;
  active?.setPaused?.(paused);
}
export function isSceneMotionPaused(): boolean { return motionPaused; }

export function disposeScene(): void {
  mountToken++;
  cancelPending?.(); cancelPending = null;
  active?.destroy(); active = null;
}

type Mounter = (host: HTMLElement, valid: () => boolean) => Promise<SceneHandle | null>;
function mountWhenIdle(host: HTMLElement, make: Mounter): Promise<void> {
  disposeScene();
  const token = mountToken;
  host.dataset.scene3d = 'loading';
  return new Promise((resolve) => {
    let idle: number | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    let observer: IntersectionObserver | undefined;
    let settled = false, started = false;
    const valid = () => token === mountToken && host.isConnected;
    const finish = () => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) clearTimeout(timer);
      if (cancelPending === cancel) cancelPending = null;
      resolve();
    };
    const cancel = () => { if (host.dataset.scene3d === 'loading') delete host.dataset.scene3d; finish(); };
    cancelPending = cancel;
    const run = async () => {
      if (!valid()) { finish(); return; }
      try {
        const handle = await make(host, valid);
        if (!valid()) { handle?.destroy(); finish(); return; }
        active = handle;
        handle?.setPaused?.(motionPaused);
        if (!handle) host.dataset.scene3d = 'fallback';
      } catch {
        if (valid()) host.dataset.scene3d = 'fallback';
        // Keep the host's ordinary artwork and controls usable after a GPU/import failure.
      }
      finish();
    };
    const queue = () => {
      if (started || settled) return;
      started = true; observer?.disconnect();
      if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(() => { void run(); }, { timeout: 1500 });
      else timer = setTimeout(() => { void run(); }, 100);
    };
    if (typeof IntersectionObserver === 'undefined') queue();
    else {
      observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) queue(); }, { rootMargin: '160px' });
      observer.observe(host);
    }
  });
}

export function mountHero3D(host: HTMLElement, items: import('./hero3d').HeroItem[]): Promise<void> {
  if (!can3D() || !items.some(item => item.artwork)) { disposeScene(); host.dataset.scene3d = 'fallback'; return Promise.resolve(); }
  return mountWhenIdle(host, async (h, valid) => {
    const { createHero3D } = await import('./hero3d');
    return valid() ? createHero3D(h, items) : null;
  });
}

export function mountChart3D(host: HTMLElement, items: import('./chart3d').Chart3DItem[]): Promise<void> {
  if (!can3D() || !items[0]?.artwork) { disposeScene(); host.dataset.scene3d = 'fallback'; return Promise.resolve(); }
  return mountWhenIdle(host, async (h, valid) => {
    const { createChart3D } = await import('./chart3d');
    return valid() ? createChart3D(h, items) : null;
  });
}

/** 홈 무대(곡면 포스터 갤러리). 조작(이전·다음·선택)이 필요해 핸들을 돌려준다. */
export function mountStage3D(host: HTMLElement, items: import('./stage3d').StageItem[], opts: import('./stage3d').StageOptions = {}): Promise<import('./stage3d').StageHandle | null> {
  disposeScene();
  if (!can3D() || !items.length) { host.dataset.scene3d = 'fallback'; return Promise.resolve(null); }
  const token = mountToken;
  host.dataset.scene3d = 'loading';
  return import('./stage3d').then(({ createStage3D }) => {
    if (token !== mountToken || !host.isConnected) return null;
    const handle = createStage3D(host, items, opts);
    if (!handle) { host.dataset.scene3d = 'fallback'; return null; }
    active = handle;
    handle.setPaused?.(motionPaused);
    return handle;
  }).catch(() => { if (host.isConnected) host.dataset.scene3d = 'fallback'; return null; });
}
