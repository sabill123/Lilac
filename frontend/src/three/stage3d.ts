/** 홈 무대: 곡면 포스터 갤러리.
 *
 * 카메라가 원통 안쪽에 서 있고, 공연 포스터가 원통 안쪽 면을 따라 둘러선다.
 * 카드마다 정점 셰이더에서 원통 곡면으로 휘고(평면을 돌려 세운 것이 아니라 면 자체가 휜다),
 * 끌기·관성·스냅·자동 넘김, 속도에 따른 기울임과 색 번짐, 초점 카드만 선명한 명암, 바닥 반사를 넣었다.
 * DOM이 제목과 버튼을 맡는다. 이 모듈은 그림과 입력만 다룬다. */
import * as THREE from 'three';
import { createSceneLifecycle } from './lifecycle';
import type { SceneHandle } from './lifecycle';

export interface StageItem { image: string; label: string }
export interface StageHandle extends SceneHandle {
  go(delta: number): void;
  goTo(index: number): void;
  index(): number;
}
export interface StageOptions {
  onFocus?(index: number): void;
  onPick?(index: number): void;
  autoplayMs?: number;
  /* 바닥 반사 — 기본은 끈다(v14: 반사가 싸구려 무대처럼 보인다는 평가). 켜려면 true */
  reflect?: boolean;
}

const VERT = /* glsl */ `
uniform float uTheta;
uniform float uRadius;
uniform float uLift;
uniform float uVel;
uniform float uTime;
uniform float uIntro;
uniform float uY;
uniform float uFloor;
uniform float uReflect;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float a = uTheta + p.x / uRadius;
  float r = uRadius - uLift * 0.45;
  // 움직이는 동안 천처럼 살짝 물결치고, 진행 방향으로 기운다
  float wave = sin(a * 4.0 + uTime * 2.4 + p.y * 1.3) * uVel * 0.09;
  float y = p.y + wave;
  float skew = p.y * uVel * 0.05;
  // 등장: 아래에서 올라오며 펼쳐진다
  float intro = uIntro;
  y = mix(y * 0.6 - 2.4, y, intro);
  r = mix(r + 3.0, r, intro);
  float worldY = uY + y;
  if (uReflect > 0.5) worldY = 2.0 * uFloor - worldY;
  vec3 world = vec3(sin(a) * r + skew, worldY, -cos(a) * r);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uLoaded;
uniform float uImgAspect;
uniform float uCardAspect;
uniform float uFocus;
uniform float uVel;
uniform float uIntro;
uniform float uReflect;
uniform vec3 uBase;
varying vec2 vUv;
float box(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  vec2 size = vec2(uCardAspect, 1.0);
  float d = box((vUv - 0.5) * size, size * 0.5, 0.035);
  float edge = 1.0 - smoothstep(-0.0025, 0.0025, d);
  // 이미지 비율이 달라도 카드를 채운다(cover)
  vec2 s = vec2(1.0);
  if (uImgAspect > uCardAspect) s.x = uCardAspect / uImgAspect; else s.y = uImgAspect / uCardAspect;
  vec2 tuv = (vUv - 0.5) * s + 0.5;
  float shift = clamp(uVel, -2.0, 2.0) * 0.006;
  vec3 col = vec3(
    texture2D(uMap, tuv + vec2(shift, 0.0)).r,
    texture2D(uMap, tuv).g,
    texture2D(uMap, tuv - vec2(shift, 0.0)).b
  );
  col = mix(uBase, col, uLoaded);
  float g = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(g), col, 0.2 + 0.8 * uFocus);
  col *= 0.42 + 0.58 * uFocus;
  float alpha = edge * uIntro;
  if (uReflect > 0.5) alpha *= 0.16 * (1.0 - smoothstep(0.0, 0.5, vUv.y));
  gl_FragColor = vec4(col, alpha);
}`;

interface Card {
  mesh: THREE.Mesh; mirror: THREE.Mesh; mat: THREE.ShaderMaterial; mirrorMat: THREE.ShaderMaterial;
  tex: THREE.Texture | null; loaded: number; focus: number; lift: number; intro: number; theta: number;
}

const wrap = (v: number, n: number) => ((v % n) + n) % n;
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

export function createStage3D(host: HTMLElement, items: StageItem[], opts: StageOptions = {}): StageHandle | null {
  if (!items.length) return null;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true });
  } catch { return null; }
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // 텍스처를 그대로 내보내 원본 색을 지킨다
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:pan-y;cursor:grab';
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);

  // 카드가 7장보다 적으면 반복해 원이 비지 않게 한다
  const source = items.slice(0, 16);
  const list: number[] = [];
  while (list.length < Math.max(8, source.length)) for (let i = 0; i < source.length && list.length < 16; i++) list.push(i);
  const N = list.length;

  let W = 2.35, H = 3.2, R = 7.4, GAP = 0.42, step = (W + GAP) / R;
  const geo = new THREE.PlaneGeometry(1, 1, 48, 12);
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const texCache = new Map<number, Promise<THREE.Texture | null>>();
  const loadTex = (src: number) => {
    if (!texCache.has(src)) {
      texCache.set(src, new Promise((resolve) => {
        loader.load(source[src].image, (t) => { t.anisotropy = Math.min(8, maxAniso); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; resolve(t); }, undefined, () => resolve(null));
      }));
    }
    return texCache.get(src)!;
  };

  const baseUniforms = () => ({
    uMap: { value: null as THREE.Texture | null }, uLoaded: { value: 0 }, uImgAspect: { value: 0.75 }, uCardAspect: { value: W / H },
    uFocus: { value: 0 }, uVel: { value: 0 }, uTime: { value: 0 }, uIntro: { value: 0 }, uTheta: { value: 0 }, uRadius: { value: R },
    uLift: { value: 0 }, uY: { value: 0 }, uFloor: { value: 0 }, uReflect: { value: 0 }, uBase: { value: new THREE.Color(0x1d1d24) },
  });
  const cards: Card[] = list.map((src) => {
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: baseUniforms(), transparent: true, depthWrite: false });
    const mirrorMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: baseUniforms(), transparent: true, depthWrite: false, side: THREE.DoubleSide });
    mirrorMat.uniforms.uReflect.value = 1;
    const mesh = new THREE.Mesh(geo, mat);
    const mirror = new THREE.Mesh(geo, mirrorMat);
    mesh.frustumCulled = false; mirror.frustumCulled = false;
    mirror.visible = !!opts.reflect;
    scene.add(mirror); scene.add(mesh);
    const card: Card = { mesh, mirror, mat, mirrorMat, tex: null, loaded: 0, focus: 0, lift: 0, intro: 0, theta: 0 };
    void loadTex(src).then((t) => {
      if (destroyed || !t) return;
      card.tex = t;
      const img = t.image as { width?: number; height?: number } | undefined;
      const aspect = img?.width && img?.height ? img.width / img.height : 0.75;
      for (const m of [mat, mirrorMat]) { m.uniforms.uMap.value = t; m.uniforms.uImgAspect.value = aspect; }
      lifecycle?.invalidate();
    });
    return card;
  });

  let destroyed = false;
  let offset = -2.6; // 등장할 때 한 바퀴 반쯤 돌며 들어온다
  let target = 0;
  let vel = 0;
  let lastOffset = offset;
  let focused = -1;
  let hovered = -1;
  let dragging = false;
  let dragX = 0, dragOffset = 0, dragMoved = 0, lastMoveX = 0, lastMoveT = 0, flick = 0;
  let pxPerItem = 300;
  let introT = 0;
  let parX = 0, parY = 0, tParX = 0, tParY = 0;
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');

  let CAMZ = 2.9;
  const layout = () => {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    const mobile = w < 640;
    camera.aspect = w / h;
    camera.fov = mobile ? 38 : 30;
    R = mobile ? 6.0 : 7.6;
    CAMZ = mobile ? 1.6 : 2.9;
    // 카드 높이를 화면 높이의 비율로 정한다 — 아래쪽은 제목·버튼 자리
    const visH = 2 * (R + CAMZ) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    H = visH * (mobile ? 0.4 : 0.445);
    W = H * 0.74;
    GAP = H * (mobile ? 0.1 : 0.13);
    step = (W + GAP) / R;
    camera.position.set(0, 0, CAMZ);
    camera.lookAt(0, 0, -R);
    // 투영 중심을 위로 올려 카드 줄을 화면 위쪽 3분의 1 지점에 둔다(원근은 그대로)
    camera.setViewOffset(w, h, 0, h * (mobile ? 0.21 : 0.19), w, h);
    camera.updateProjectionMatrix();
    const g = new THREE.PlaneGeometry(W, H, 48, 12);
    for (const c of cards) { c.mesh.geometry = g; c.mirror.geometry = g; }
    geoRef.current?.dispose();
    geoRef.current = g;
    for (const c of cards) for (const m of [c.mat, c.mirrorMat]) {
      m.uniforms.uCardAspect.value = W / H; m.uniforms.uRadius.value = R; m.uniforms.uY.value = 0; m.uniforms.uFloor.value = -H / 2 - H * 0.03;
    }
    // 카드 한 장이 화면에서 차지하는 가로 픽셀 — 끌기 감도
    const pa = new THREE.Vector3(Math.sin(-step / 2) * R, 0, -Math.cos(step / 2) * R).project(camera);
    const pb = new THREE.Vector3(Math.sin(step / 2) * R, 0, -Math.cos(step / 2) * R).project(camera);
    pxPerItem = Math.max(120, Math.abs(pb.x - pa.x) / 2 * w);
  };
  const geoRef: { current: THREE.BufferGeometry | null } = { current: null };

  // 화면 좌표로 카드 모서리를 투영해 고른다(정점 셰이더에서 휘기 때문에 레이캐스트 대신)
  const project = (theta: number, x: number, y: number) => {
    const a = theta + x / R;
    return new THREE.Vector3(Math.sin(a) * R, y, -Math.cos(a) * R).project(camera);
  };
  const pick = (clientX: number, clientY: number) => {
    const rect = host.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    let best = -1, bestD = Infinity;
    cards.forEach((c, i) => {
      if (Math.cos(c.theta) < 0.2) return;
      const l = project(c.theta, -W / 2, 0), r = project(c.theta, W / 2, 0);
      const top = project(c.theta, 0, H / 2), bot = project(c.theta, 0, -H / 2);
      if (nx >= Math.min(l.x, r.x) && nx <= Math.max(l.x, r.x) && ny >= bot.y && ny <= top.y) {
        const d = Math.abs(c.theta);
        if (d < bestD) { bestD = d; best = i; }
      }
    });
    return best;
  };

  const rel = (i: number) => { const d = wrap(i - offset, N); return d > N / 2 ? d - N : d; };
  const current = () => wrap(Math.round(target), N);

  const draw = (_elapsed: number, delta: number, moving: boolean) => {
    const dt = moving ? delta : 1;
    if (!moving) { offset = target; introT = 10; }
    introT += dt;
    if (!dragging) offset = damp(offset, target, moving ? 5.2 : 50, dt);
    const v = dt > 0 ? (offset - lastOffset) / Math.max(dt, 1 / 120) : 0;
    lastOffset = offset;
    vel = damp(vel, moving ? Math.max(-3, Math.min(3, v)) : 0, 10, dt);
    parX = damp(parX, tParX, 3, dt); parY = damp(parY, tParY, 3, dt);
    camera.lookAt(parX * 0.9, parY * 0.35, -R);

    const f = wrap(Math.round(offset), N);
    if (f !== focused) { focused = f; opts.onFocus?.(list[f]); }
    let pending = false;
    cards.forEach((c, i) => {
      const d = rel(i);
      c.theta = d * step;
      const focusT = Math.max(0, 1 - Math.abs(d) * 0.85);
      c.focus = damp(c.focus, focusT, 10, dt);
      c.lift = damp(c.lift, i === hovered && !dragging ? 1 : 0, 9, dt);
      const delay = Math.min(1.2, Math.abs(Math.round(d)) * 0.09 + 0.1);
      const tIntro = Math.min(1, Math.max(0, (introT - delay) / 1.1));
      c.intro = moving ? 1 - Math.pow(1 - tIntro, 4) : 1;
      if (c.tex) c.loaded = damp(c.loaded, 1, 6, dt);
      if (c.intro < 1 || (c.tex && c.loaded < 0.995) || Math.abs(c.focus - focusT) > 0.002) pending = true;
      const hide = Math.abs(d) > N / 2 - 0.6 ? 0 : 1; // 원 뒤편에서 순간 이동하는 카드는 숨긴다
      for (const m of [c.mat, c.mirrorMat]) {
        const u = m.uniforms;
        u.uTheta.value = c.theta; u.uFocus.value = c.focus; u.uLift.value = c.lift; u.uVel.value = vel;
        u.uTime.value = _elapsed; u.uIntro.value = c.intro * hide; u.uLoaded.value = c.loaded;
      }
      // 먼 카드부터 그린다
      c.mesh.renderOrder = 100 - Math.round(Math.abs(d) * 10);
      c.mirror.renderOrder = c.mesh.renderOrder - 50;
    });
    renderer.render(scene, camera);
    if (moving && (pending || Math.abs(offset - target) > 0.0005 || Math.abs(vel) > 0.002 || dragging)) lifecycle?.invalidate();
  };

  const lifecycle = createSceneLifecycle(host, draw, layout);

  // 자동 넘김: 사용자가 만지지 않을 때만
  const autoplayMs = opts.autoplayMs ?? 5200;
  const auto = setInterval(() => {
    if (destroyed || dragging || hovered >= 0 || media.matches || document.hidden || !lifecycle.isMoving()) return;
    if (Date.now() - lastTouch < autoplayMs * 1.6) return;
    target += 1; lifecycle.invalidate();
  }, autoplayMs);
  let lastTouch = 0;
  const touch = () => { lastTouch = Date.now(); };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = true; touch();
    dragX = e.clientX; dragOffset = offset; dragMoved = 0; lastMoveX = e.clientX; lastMoveT = performance.now(); flick = 0;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    lifecycle.invalidate();
  };
  const onMove = (e: PointerEvent) => {
    const rect = host.getBoundingClientRect();
    tParX = ((e.clientX - rect.left) / rect.width - 0.5) * 0.35;
    tParY = -((e.clientY - rect.top) / rect.height - 0.5) * 0.25;
    if (dragging) {
      const dx = e.clientX - dragX;
      dragMoved = Math.max(dragMoved, Math.abs(dx));
      offset = dragOffset - dx / pxPerItem;
      const now = performance.now();
      if (now - lastMoveT > 0) flick = damp(flick, -(e.clientX - lastMoveX) / pxPerItem / ((now - lastMoveT) / 1000), 0.9, 1);
      lastMoveX = e.clientX; lastMoveT = now;
      target = offset;
      touch();
    } else if (e.pointerType === 'mouse') {
      const h = pick(e.clientX, e.clientY);
      if (h !== hovered) { hovered = h; canvas.style.cursor = h >= 0 ? 'pointer' : 'grab'; }
    }
    lifecycle.invalidate();
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = 'grab';
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* 이미 풀림 */ }
    if (dragMoved < 6) {
      const i = pick(e.clientX, e.clientY);
      if (i >= 0) {
        const d = Math.round(rel(i));
        if (d === 0) opts.onPick?.(list[i]);
        else target = Math.round(offset) + d;
      } else target = Math.round(offset);
    } else {
      // 튕긴 속도만큼 더 가서 가장 가까운 카드에 멈춘다
      const throwTo = offset + Math.max(-3, Math.min(3, flick * 0.28));
      target = Math.round(throwTo);
    }
    touch();
    lifecycle.invalidate();
  };
  const onLeave = () => { tParX = 0; tParY = 0; if (hovered >= 0) { hovered = -1; } lifecycle.invalidate(); };
  const onWheel = (e: WheelEvent) => {
    // 가로 스크롤(트랙패드 좌우)만 가로챈다. 세로 스크롤은 페이지에 돌려준다.
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    target += e.deltaX / pxPerItem;
    touch();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { target = Math.round(target); lifecycle.invalidate(); }, 140);
    lifecycle.invalidate();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const onLost = (e: Event) => { e.preventDefault(); handle.destroy(); host.dataset.scene3d = 'fallback'; };
  canvas.addEventListener('webglcontextlost', onLost);

  host.dataset.scene3d = 'ready';
  lifecycle.invalidate();

  const handle: StageHandle = {
    go(delta) { touch(); target = Math.round(target) + delta; lifecycle.invalidate(); },
    goTo(index) {
      touch();
      const cands = list.map((s, i) => (s === index ? i : -1)).filter((i) => i >= 0);
      if (!cands.length) return;
      const best = cands.map((i) => Math.round(rel(i))).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
      target = Math.round(offset) + best;
      lifecycle.invalidate();
    },
    index() { return list[current()]; },
    setPaused(p) { lifecycle.setPaused(p); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearInterval(auto);
      clearTimeout(wheelTimer);
      lifecycle.destroy();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('webglcontextlost', onLost);
      for (const c of cards) { c.mat.dispose(); c.mirrorMat.dispose(); }
      void Promise.all([...texCache.values()]).then((ts) => ts.forEach((t) => t?.dispose()));
      geo.dispose(); geoRef.current?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      delete host.dataset.scene3d;
    },
  };
  return handle;
}
