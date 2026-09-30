/** Shared scheduling for decorative artwork scenes. No Three.js import in this module. */
export interface SceneHandle {
  destroy(): void;
  setPaused?(paused: boolean): void;
}

export function createSceneLifecycle(
  host: HTMLElement,
  draw: (elapsed: number, delta: number, moving: boolean) => void,
  resize: () => void,
) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = false, destroyed = false, frame = 0, elapsed = 0, previous = 0;
  let visible = typeof IntersectionObserver === 'undefined';
  let dirty = true;
  const moving = () => !paused && !media.matches;
  const eligible = () => !destroyed && host.isConnected && visible && !document.hidden
    && host.clientWidth > 0 && host.clientHeight > 0;
  const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; previous = 0; };
  const schedule = () => {
    if (!eligible()) { stop(); return; }
    if (!frame && (dirty || moving())) frame = requestAnimationFrame(tick);
  };
  const tick = (now: number) => {
    frame = 0;
    if (!eligible()) { previous = 0; return; }
    const delta = moving() && previous ? Math.min((now - previous) / 1000, 0.05) : 0;
    previous = moving() ? now : 0;
    elapsed += delta;
    dirty = false;
    draw(elapsed, delta, moving());
    schedule();
  };
  const invalidate = () => { dirty = true; schedule(); };
  const onResize = () => { if (!destroyed) { resize(); invalidate(); } };
  const onMotion = () => { stop(); invalidate(); };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
  ro?.observe(host);
  if (!ro) window.addEventListener('resize', onResize);
  const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false;
    schedule();
  }, { threshold: 0.01 }) : null;
  io?.observe(host);
  document.addEventListener('visibilitychange', schedule);
  media.addEventListener('change', onMotion);
  onResize();
  return {
    invalidate,
    isMoving: moving,
    setPaused(value: boolean) { paused = value; onMotion(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop(); ro?.disconnect(); io?.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', schedule);
      media.removeEventListener('change', onMotion);
    },
  };
}
