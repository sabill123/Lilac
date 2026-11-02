/** Kinetic ribbon: a decorative band of twisting editorial ribbons drawn with Three.js.
 *
 * Solid palette only (ink, lilac, pale lilac, lime). Each ribbon is a real triangle strip
 * whose cross-section turns around its own path, so the face colour flips between front
 * and back like folded paper. No glow, no gradients, no particles.
 *
 * Motion is bounded: a one-time draw-on intro, a spring toward the pointer (fine pointers
 * only) and a scroll-linked phase spring. When those settle the scene pauses and the
 * shared lifecycle stops requesting frames. Hidden tabs, off-screen hosts and reduced
 * motion are handled by createSceneLifecycle. Context loss is terminal: the caller
 * receives onFallback() and the DOM shows its static CSS line instead. */
import * as THREE from 'three';
import { createSceneLifecycle } from '../three/lifecycle';
import type { SceneHandle } from '../three/lifecycle';

export interface RibbonOptions {
  /** Element whose pointer movement bends the ribbons. The canvas itself never takes input. */
  pointerHost?: HTMLElement | null;
  onFallback?(): void;
  /** Test seam: deterministic wall clock for settling. */
  now?: () => number;
}
export interface RibbonHandle extends SceneHandle { readonly state: () => 'intro' | 'awake' | 'settled' | 'destroyed' }

type RibbonSpec = { front: number; back: number; width: number; hair?: boolean; amp: number; freq: number; phase: number; y: number; twist: number; z: number; delay: number };
/** width/amp/y are fractions of band height; hairlines use width in CSS px. */
export const RIBBONS: readonly RibbonSpec[] = [
  { front: 0xE3DAEE, back: 0xCDBCE3, width: 0.30, amp: 0.20, freq: 0.85, phase: 2.4, y: 0.06, twist: 1.25, z: 0, delay: 0 },
  { front: 0x7D5BA6, back: 0x573C7B, width: 0.15, amp: 0.24, freq: 1.05, phase: 0.9, y: -0.04, twist: 1.9, z: 1, delay: 0.12 },
  { front: 0xD7F26B, back: 0xB5D13F, width: 0.075, amp: 0.20, freq: 1.45, phase: 3.3, y: -0.12, twist: 2.6, z: 2, delay: 0.24 },
  { front: 0x211D29, back: 0x211D29, width: 1.25, hair: true, amp: 0.16, freq: 1.25, phase: 0.2, y: 0.02, twist: 0, z: 3, delay: 0.06 },
  { front: 0x211D29, back: 0x211D29, width: 1, hair: true, amp: 0.10, freq: 2.0, phase: 4.1, y: -0.22, twist: 0, z: 3, delay: 0.3 },
];
export const MAX_SEGMENTS = 120;
export const MIN_SEGMENTS = 40;
export const MAX_DPR = 1.75;
const INTRO_S = 1.25;
const AWAKE_AFTER_INPUT_MS = 900;
/** Hard bound for one continuous awake stretch, even under constant input. */
export const MAX_AWAKE_FRAMES = 360;
const COOLDOWN_MS = 1200;

export function segmentsFor(width: number) { return Math.max(MIN_SEGMENTS, Math.min(MAX_SEGMENTS, Math.round(width / 12))); }
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export function createKineticRibbon(host: HTMLElement, opts: RibbonOptions = {}): RibbonHandle | null {
  const clock = opts.now || (() => performance.now());
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true });
  } catch { return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('tabindex', '-1');
  canvas.style.pointerEvents = 'none';
  canvas.className = 'kx-ribbon-canvas';
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.name = 'kinetic-ribbon';
  const camera = new THREE.OrthographicCamera(0, 1, 0.5, -0.5, -10, 10);
  let W = 1, H = 1, segs = MIN_SEGMENTS;

  type Strip = { spec: RibbonSpec; mesh: THREE.Mesh; pos: Float32Array; col: Float32Array; front: THREE.Color; back: THREE.Color };
  const strips: Strip[] = [];
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: false, depthTest: false });
  const build = () => {
    for (const s of strips.splice(0)) { scene.remove(s.mesh); s.mesh.geometry.dispose(); }
    for (const spec of RIBBONS) {
      const n = (segs + 1) * 2;
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      const index: number[] = [];
      for (let i = 0; i < segs; i++) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setIndex(index);
      const mesh = new THREE.Mesh(geo, material);
      mesh.renderOrder = spec.z; mesh.frustumCulled = false; mesh.name = `ribbon-${spec.hair ? 'hair' : 'band'}`;
      scene.add(mesh);
      strips.push({ spec, mesh, pos, col, front: new THREE.Color(spec.front), back: new THREE.Color(spec.back) });
    }
  };

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const st = { intro: reduced.matches ? 1 : 0, flow: 0, flowTarget: 0, flowVel: 0, bend: 0, bendTarget: 0, bendVel: 0, px: 0.62, awakeUntil: clock() + INTRO_S * 1000 + 400, coolUntil: 0, frames: 0, settled: false, destroyed: false };
  const center = new Float32Array((MAX_SEGMENTS + 1) * 2);

  const draw = (elapsed: number, delta: number, moving: boolean) => {
    if (st.destroyed) return;
    if (!moving) st.intro = 1; // reduced motion or paused: the finished composition, static
    else st.intro = Math.min(1, st.intro + delta / INTRO_S);
    if (moving && delta > 0) {
      const k = 120, c = 2 * Math.sqrt(k); // critical damping: no bounce
      st.flowVel += (k * (st.flowTarget - st.flow) - c * st.flowVel) * delta; st.flow += st.flowVel * delta;
      st.bendVel += (k * (st.bendTarget - st.bend) - c * st.bendVel) * delta; st.bend += st.bendVel * delta;
    }
    const wave = elapsed * 0.55 + st.flow;
    for (const s of strips) {
      const { spec } = s;
      const reveal = easeOut((st.intro * INTRO_S - spec.delay) / (INTRO_S - 0.3));
      const count = Math.round(reveal * segs);
      s.mesh.geometry.setDrawRange(0, count * 6);
      for (let i = 0; i <= segs; i++) {
        const u = i / segs, x = u * W;
        const lift = st.bend * Math.exp(-Math.pow((u - st.px) / 0.2, 2)) * 0.22;
        center[i * 2] = x;
        center[i * 2 + 1] = H * (spec.y + spec.amp * Math.sin(Math.PI * 2 * spec.freq * u + spec.phase + wave * (0.7 + spec.z * 0.12)) + lift);
      }
      for (let i = 0; i <= segs; i++) {
        const a = Math.max(0, i - 1), b = Math.min(segs, i + 1);
        let tx = center[b * 2] - center[a * 2], ty = center[b * 2 + 1] - center[a * 2 + 1];
        const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
        const u = i / segs;
        const turn = spec.hair ? 1 : Math.cos(Math.PI * 2 * spec.twist * u + spec.phase + wave * 0.35);
        const half = spec.hair ? spec.width / 2 : (spec.width * H / 2) * Math.max(Math.abs(turn), 0.08);
        const nx = -ty * half, ny = tx * half;
        const cx = center[i * 2], cy = center[i * 2 + 1], o = i * 6;
        s.pos[o] = cx + nx; s.pos[o + 1] = cy + ny; s.pos[o + 2] = spec.z * 0.01;
        s.pos[o + 3] = cx - nx; s.pos[o + 4] = cy - ny; s.pos[o + 5] = spec.z * 0.01;
        const f = smooth(-0.12, 0.12, turn);
        const r = s.back.r + (s.front.r - s.back.r) * f, g = s.back.g + (s.front.g - s.back.g) * f, bl = s.back.b + (s.front.b - s.back.b) * f;
        s.col[o] = r; s.col[o + 1] = g; s.col[o + 2] = bl; s.col[o + 3] = r; s.col[o + 4] = g; s.col[o + 5] = bl;
      }
      (s.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (s.mesh.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
    renderer.render(scene, camera);
    if (!moving) return;
    st.frames++;
    const calm = Math.abs(st.flowTarget - st.flow) < 0.002 && Math.abs(st.flowVel) < 0.004 && Math.abs(st.bendTarget - st.bend) < 0.002 && Math.abs(st.bendVel) < 0.004;
    if (st.frames >= MAX_AWAKE_FRAMES) { st.coolUntil = clock() + COOLDOWN_MS; settle(); }
    else if (st.intro >= 1 && calm && clock() > st.awakeUntil) settle();
  };
  const resize = () => {
    W = Math.max(1, host.clientWidth); H = Math.max(1, host.clientHeight);
    renderer.setSize(W, H, false);
    camera.left = 0; camera.right = W; camera.top = H / 2; camera.bottom = -H / 2; camera.updateProjectionMatrix();
    const next = segmentsFor(W);
    if (next !== segs || !strips.length) { segs = next; build(); }
  };
  const life = createSceneLifecycle(host, draw, resize);
  const settle = () => { if (st.settled) return; st.settled = true; st.frames = 0; life.setPaused(true); };
  const wake = (ms = AWAKE_AFTER_INPUT_MS) => {
    if (st.destroyed || reduced.matches) return;
    // After the frame cap, input must rest before motion resumes (extended while input continues).
    if (clock() < st.coolUntil) { st.coolUntil = clock() + COOLDOWN_MS; return; }
    st.awakeUntil = clock() + ms;
    if (st.settled) { st.settled = false; st.frames = 0; life.setPaused(false); }
    else life.invalidate();
  };

  const ctrl = new AbortController();
  const signal = ctrl.signal;
  const pointerHost = opts.pointerHost || null;
  pointerHost?.addEventListener('pointermove', (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return; // touch scroll stays the page's
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    st.px = Math.min(1.1, Math.max(-0.1, (e.clientX - r.left) / r.width));
    const dy = (r.top + r.height / 2 - e.clientY) / Math.max(r.height, 1);
    st.bendTarget = Math.abs(dy) > 3 ? 0 : Math.max(-1, Math.min(1, dy));
    wake();
  }, { passive: true, signal });
  pointerHost?.addEventListener('pointerleave', () => { st.bendTarget = 0; wake(); }, { passive: true, signal });
  window.addEventListener('scroll', () => {
    const r = canvas.getBoundingClientRect();
    if (r.bottom < 0 || r.top > (window.innerHeight || 0)) return;
    st.flowTarget = (r.top / Math.max(window.innerHeight || 1, 1)) * 1.6;
    wake(600);
  }, { passive: true, signal });
  const onLost = () => { const fallback = opts.onFallback; handle.destroy(); fallback?.(); };
  canvas.addEventListener('webglcontextlost', onLost, { signal });

  const handle: RibbonHandle = {
    state: () => st.destroyed ? 'destroyed' : st.settled ? 'settled' : st.intro < 1 ? 'intro' : 'awake',
    setPaused(paused: boolean) { if (paused) settle(); else wake(); },
    destroy() {
      if (st.destroyed) return;
      st.destroyed = true;
      ctrl.abort(); life.destroy();
      for (const s of strips.splice(0)) { scene.remove(s.mesh); s.mesh.geometry.dispose(); }
      material.dispose(); renderer.dispose();
      canvas.remove();
    },
  };
  return handle;
}
