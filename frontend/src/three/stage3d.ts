/** 홈 무대 v2: 포스터 팬.
 *
 * 밝은 패널 안에 공연 포스터 3~5장을 담는다. 가운데 포스터가 앞으로 나오고
 * 양옆은 깊이 방향으로 물러나며 가운데를 향해 돈다(커버 플로). 크기·간격은 패널 폭과 높이에서
 * 매번 다시 계산한다 — 고정 픽셀이 없다.
 *
 * 움직임
 *  - 끌기·휠·화살표: 감쇠 스프링으로 정착. 빠르게 넘기면 그 속도만큼 카드 면이 휘고(정점 셰이더)
 *    간격이 살짝 벌어진다. 멈추면 평평하게 돌아온다.
 *  - 마우스를 올리면 가운데 포스터가 포인터 쪽으로 기울고, 표면에 옅은 반사광이 지나간다.
 *  - 포스터마다 부드러운 그림자 판이 깔려 밝은 바탕 위에서 떠 보인다.
 *  - 처음 한 번 가운데에서 양옆으로 짧게 펼쳐진다(모션 줄이기면 생략).
 * 원본 색을 보존한다(색 분리·채도 낮추기 없음). 뒤쪽 카드는 패널 색 안개로만 물러난다.
 * DOM이 제목과 버튼을 맡고, 이 모듈은 그림과 입력만 다룬다. */
import * as THREE from 'three';
import { createSceneLifecycle } from './lifecycle';
import type { SceneHandle } from './lifecycle';

export interface StageItem { image: string; label: string; title?: string; sub?: string }
export interface StageHandle extends SceneHandle {
  go(delta: number): void;
  goTo(index: number): void;
  index(): number;
}
export interface StageOptions {
  onFocus?(index: number): void;
  onPick?(index: number): void;
  autoplayMs?: number;
  /** Context loss is terminal; the DOM owner can expose its static carousel. */
  onFallback?(): void;
  /** 패널 바탕색 — 뒤쪽 카드가 이 색으로 옅어진다 */
  veil?: string;
  /** @deprecated 반사 바닥은 그리지 않는다 */
  reflect?: boolean;
}

const VERT = /* glsl */ `
uniform float uBend;
uniform float uCardW;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  // 넘기는 속도만큼 카드 면이 세로축을 따라 휜다(가장자리가 뒤로). 멈추면 0.
  float nx = p.x / (uCardW * 0.5);
  p.z -= uBend * nx * nx * uCardW * 0.5;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uLoaded;
uniform float uImgAspect;
uniform float uCardAspect;
uniform float uFocus;
uniform float uAlpha;
uniform float uGloss;
uniform vec2 uSheen;
uniform vec3 uVeil;
uniform vec3 uBase;
varying vec2 vUv;
float box(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  vec2 size = vec2(uCardAspect, 1.0);
  float d = box((vUv - 0.5) * size, size * 0.5, 0.035);
  float edge = 1.0 - smoothstep(-0.002, 0.002, d);
  // 이미지 비율이 달라도 카드를 채운다(cover)
  vec2 s = vec2(1.0);
  if (uImgAspect > uCardAspect) s.x = uCardAspect / uImgAspect; else s.y = uImgAspect / uCardAspect;
  vec2 tuv = (vUv - 0.5) * s + 0.5;
  vec3 col = mix(uBase, texture2D(uMap, tuv).rgb, uLoaded);
  // 뒤쪽 카드는 패널 색 안개로 물러난다(어둡게 하지 않는다)
  col = mix(uVeil, col, mix(0.8, 1.0, uFocus));
  // 포인터를 따라 지나가는 옅은 반사광(가운데 카드만)
  vec2 q = vUv - uSheen;
  float band = exp(-pow((q.x * 0.8 + q.y * 0.6) * 5.0, 2.0));
  col += vec3(1.0) * band * 0.09 * uGloss;
  gl_FragColor = vec4(col, edge * uAlpha);
  #include <colorspace_fragment>
}`;

const SHADOW_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float a = texture2D(uMap, vUv).a * uAlpha;
  gl_FragColor = vec4(vec3(0.16, 0.11, 0.24), a);
  #include <colorspace_fragment>
}`;
const SHADOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

interface Card {
  mesh: THREE.Mesh; shadow: THREE.Mesh; mat: THREE.ShaderMaterial; shadowMat: THREE.ShaderMaterial;
  tex: THREE.Texture | null; loaded: number; focus: number; lift: number;
}

const wrap = (v: number, n: number) => ((v % n) + n) % n;
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/* 포스터를 못 받았을 때의 글자 표지 — 밝은 라일락 톤, 3:4 */
function textPoster(it: StageItem): THREE.Texture | null {
  try {
    const c = document.createElement('canvas');
    c.width = 600; c.height = 800;
    const g = c.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#EDE6F6'; g.fillRect(0, 0, 600, 800);
    g.fillStyle = '#7D5BA6'; g.font = '600 24px "Geist Mono", ui-monospace, monospace';
    g.fillText((it.label || '').toUpperCase(), 56, 96);
    g.fillStyle = '#111113'; g.font = '900 68px "Archivo", "Pretendard Variable", Pretendard, sans-serif';
    const words = String(it.title || it.label || '').split(/(\s+)/);
    const lines: string[] = []; let cur = '';
    for (const w of words) { const next = cur + w; if (g.measureText(next).width > 488 && cur.trim()) { lines.push(cur.trim()); cur = w.trimStart(); } else cur = next; }
    if (cur.trim()) lines.push(cur.trim());
    lines.slice(0, 6).forEach((l, i) => g.fillText(l, 56, 600 - (Math.min(lines.length, 6) - 1 - i) * 78));
    if (it.sub) { g.fillStyle = 'rgba(17,17,19,.55)'; g.font = '500 28px "Pretendard Variable", Pretendard, sans-serif'; g.fillText(it.sub.slice(0, 28), 56, 712); }
    return new THREE.CanvasTexture(c);
  } catch { return null; }
}

/* 그림자 판 — 모서리가 둥근 사각형을 흐리게 그린 알파 텍스처 하나를 모든 카드가 함께 쓴다 */
function shadowTexture(): THREE.Texture | null {
  try {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 320;
    const g = c.getContext('2d');
    if (!g) return null;
    g.filter = 'blur(22px)';
    g.fillStyle = 'rgba(0,0,0,1)';
    const r = 18, x = 52, y = 54, w = 152, h = 214;
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill();
    return new THREE.CanvasTexture(c);
  } catch { return null; }
}

export function createStage3D(host: HTMLElement, items: StageItem[], opts: StageOptions = {}): StageHandle | null {
  if (!items.length) return null;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true });
  } catch { return null; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:pan-y;cursor:grab';
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 200);
  const veil = new THREE.Color(opts.veil || '#F4F1F8');

  // 카드가 적으면 반복해 양옆이 비지 않게 한다
  const source = items.slice(0, 16);
  const list: number[] = [];
  while (list.length < Math.max(8, source.length)) for (let i = 0; i < source.length && list.length < 16; i++) list.push(i);
  const N = list.length;

  let W = 2.4, H = 3.2, CAMZ = 12;
  let geo = new THREE.PlaneGeometry(1, 1, 24, 1);
  const shadowGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
  const shadowTex = shadowTexture();
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const texCache = new Map<number, Promise<THREE.Texture | null>>();
  const loadTex = (src: number) => {
    if (!texCache.has(src)) {
      texCache.set(src, new Promise((resolve) => {
        const done = (t: THREE.Texture) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, maxAniso); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; resolve(t); };
        loader.load(source[src].image, done, undefined, () => { const t = textPoster(source[src]); if (t) done(t); else resolve(null); });
      }));
    }
    return texCache.get(src)!;
  };

  const cards: Card[] = list.map((src) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, toneMapped: false,
      uniforms: {
        uMap: { value: null as THREE.Texture | null }, uLoaded: { value: 0 }, uImgAspect: { value: 0.75 }, uCardAspect: { value: 0.75 },
        uFocus: { value: 0 }, uAlpha: { value: 1 }, uGloss: { value: 0 }, uSheen: { value: new THREE.Vector2(0.5, 0.5) },
        uVeil: { value: veil }, uBase: { value: new THREE.Color('#E7E1F0') }, uBend: { value: 0 }, uCardW: { value: 1 },
      },
    });
    const shadowMat = new THREE.ShaderMaterial({
      vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG, transparent: true, depthWrite: false, toneMapped: false,
      uniforms: { uMap: { value: shadowTex }, uAlpha: { value: 0 } },
    });
    const mesh = new THREE.Mesh(geo, mat);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    mesh.userData.kind = 'card'; shadow.userData.kind = 'shadow';
    mesh.frustumCulled = false; shadow.frustumCulled = false;
    shadow.visible = !!shadowTex;
    scene.add(shadow); scene.add(mesh);
    const card: Card = { mesh, shadow, mat, shadowMat, tex: null, loaded: 0, focus: 0, lift: 0 };
    void loadTex(src).then((t) => {
      if (destroyed || !t) return;
      card.tex = t;
      const img = t.image as { width?: number; height?: number } | undefined;
      mat.uniforms.uMap.value = t;
      mat.uniforms.uImgAspect.value = img?.width && img?.height ? img.width / img.height : 0.75;
      lifecycle?.invalidate();
    });
    return card;
  });

  let destroyed = false;
  let offset = 0; // 첫 프레임부터 요청한 포스터에 초점(전체를 훑는 인트로 없음)
  let target = 0;
  let vel = 0; let prevOffset = 0;
  let focused = -1;
  let hovered = -1;
  let dragging = false;
  let pointerId: number | null = null;
  let axis: 'pending' | 'horizontal' | 'vertical' = 'pending';
  let dragX = 0, dragY = 0, dragOffset = 0, dragMoved = 0, lastMoveX = 0, lastMoveT = 0, flick = 0;
  let pxPerItem = 300;
  let fan = 0; // 처음 펼쳐짐 0→1
  let tiltX = 0, tiltY = 0, tTiltX = 0, tTiltY = 0, gloss = 0, tGloss = 0;
  const sheen = new THREE.Vector2(0.5, 0.5), tSheen = new THREE.Vector2(0.5, 0.5);
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* 좁은 패널은 세 장, 여유 있는 패널은 다섯 장. 중앙 포스터와 여백이 우선이다. */
  let radius = 1;
  let needsDraw = true;
  const layout = () => {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.set(0, 0, CAMZ);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const visH = 2 * CAMZ * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const visW = visH * camera.aspect;
    radius = w >= 540 && w / h >= 1.45 ? 2 : 1;
    H = visH * 0.74;
    W = Math.min(H * 0.75, visW / (radius === 1 ? 2.55 : 3.45));
    H = W / 0.75;
    const g = new THREE.PlaneGeometry(W, H, 24, 1);
    for (const c of cards) { c.mesh.geometry = g; c.mat.uniforms.uCardAspect.value = W / H; c.mat.uniforms.uCardW.value = W; }
    geo.dispose(); geo = g;
    pxPerItem = Math.max(72, W / visW * w * 0.75);
    needsDraw = true;
  };

  const rel = (i: number) => { const d = wrap(i - offset, N); return d > N / 2 ? d - N : d; };
  const current = () => wrap(Math.round(target), N);

  /* 끝 슬롯에서 페이드 후 재진입한다. 반복 카드가 패널 밖을 지나가는 벽은 없다. */
  const place = (d: number, k: number) => {
    const a = Math.min(Math.abs(d), radius), sg = Math.sign(d);
    const x = sg * W * (0.67 * Math.min(a, 1) + 0.52 * Math.max(a - 1, 0)) * k;
    const z = -W * 0.42 * a;
    return { x, y: -H * 0.035 * a, z, ry: -sg * 0.16 * Math.min(a, 1.5), rz: -sg * 0.045 * a, scale: 1 - 0.075 * a };
  };

  // 실제 정점 셰이더와 같은 휨을 적용한 뒤 투영한다. CSS 마스크 없이 모서리가
  // 안전 여백에 닿기 전에 카드 전체를 감춘다. 포인터 기울기·리사이즈에도 동일하다.
  const projected = new THREE.Vector3();
  const edgeAlpha = (mesh: THREE.Mesh, bend: number) => {
    mesh.updateMatrixWorld();
    const positions = mesh.geometry.getAttribute('position');
    let margin = 1;
    for (let j = 0; j < positions.count; j++) {
      projected.fromBufferAttribute(positions, j);
      const nx = projected.x / (W * 0.5);
      projected.z -= bend * nx * nx * W * 0.5;
      projected.applyMatrix4(mesh.matrixWorld).project(camera);
      margin = Math.min(margin, 1 - Math.abs(projected.x), 1 - Math.abs(projected.y));
    }
    return THREE.MathUtils.smoothstep(margin, 0.035, 0.12);
  };

  const draw = (_elapsed: number, delta: number, moving: boolean) => {
    if (!needsDraw) return;
    needsDraw = false;
    const dt = moving ? delta : 1;
    if (!moving) { offset = target; fan = 1; }
    fan = moving ? damp(fan, 1, 7, dt) : 1;
    if (fan > 0.995) fan = 1;
    if (!dragging) offset = damp(offset, target, 14, dt);
    if (Math.abs(offset - target) < 0.0008) offset = target;
    const v = dt > 0 ? (offset - prevOffset) / Math.max(dt, 1 / 120) : 0;
    prevOffset = offset;
    vel = moving ? damp(vel, v, 12, dt) : 0;
    if (Math.abs(vel) < 0.002 || (!dragging && offset === target)) vel = 0;
    const bend = clamp(vel * 0.045, -0.32, 0.32);
    const k = (1 + Math.min(Math.abs(vel) * 0.012, 0.035)) * (0.86 + 0.14 * fan);
    tiltX = damp(tiltX, moving ? tTiltX : 0, 7, dt); tiltY = damp(tiltY, moving ? tTiltY : 0, 7, dt);
    gloss = damp(gloss, moving ? tGloss : 0, 6, dt);
    sheen.x = damp(sheen.x, tSheen.x, 8, dt); sheen.y = damp(sheen.y, tSheen.y, 8, dt);

    const f = wrap(Math.round(offset), N);
    if (f !== focused) { focused = f; opts.onFocus?.(list[f]); }
    let pending = false;
    cards.forEach((c, i) => {
      const d = rel(i);
      const a = Math.abs(d);
      const focusT = Math.max(0, 1 - a);
      c.focus = moving ? damp(c.focus, focusT, 12, dt) : focusT;
      c.lift = moving ? damp(c.lift, i === hovered && !dragging ? 1 : 0, 9, dt) : 0;
      if (Math.abs(c.focus - focusT) < 0.002) c.focus = focusT;
      if (c.tex) c.loaded = 1;
      if (c.loaded > 0.995) c.loaded = 1;
      if ((c.tex && c.loaded < 1) || Math.abs(c.focus - focusT) > 0.002 || Math.abs(c.lift - (i === hovered && !dragging ? 1 : 0)) > 0.002) pending = true;
      const p = place(d, k);
      const center = c.focus;
      c.mesh.position.set(p.x, p.y, p.z + c.lift * W * 0.04 + center * W * 0.04);
      c.mesh.scale.setScalar(p.scale);
      c.mesh.rotation.set(tiltY * center * 0.09, p.ry + tiltX * center * 0.12, p.rz);
      const u = c.mat.uniforms;
      // 원 뒤편으로 넘어가는 카드는 서서히 감춘다(순간이동이 보이지 않게)
      const far = 1 - THREE.MathUtils.smoothstep(a, radius + 0.04, radius + 0.48);
      const cardBend = bend * (0.6 + 0.4 * (1 - center));
      u.uAlpha.value = far * (0.65 + 0.35 * fan) * (far > 0 ? edgeAlpha(c.mesh, cardBend) : 0);
      c.mesh.visible = u.uAlpha.value > 0.001;
      u.uFocus.value = c.focus; u.uLoaded.value = c.loaded;
      u.uBend.value = cardBend;
      u.uGloss.value = gloss * center; u.uSheen.value = sheen;
      // 그림자: 카드 조금 아래·뒤, 가운데일수록·들릴수록 진하게
      c.shadow.position.set(p.x, p.y - H * (0.035 + c.lift * 0.02), p.z - 0.035);
      c.shadow.rotation.set(0, p.ry, p.rz);
      c.shadow.visible = !!shadowTex && c.mesh.visible;
      c.shadow.scale.set(W * p.scale * 1.52, H * p.scale * 1.42, 1);
      c.shadowMat.uniforms.uAlpha.value = u.uAlpha.value * (0.12 + 0.16 * center + 0.1 * c.lift);
      c.mesh.renderOrder = 100 - Math.round(a * 10);
      c.shadow.renderOrder = c.mesh.renderOrder - 50;
    });
    renderer.render(scene, camera);
    if (moving && (pending || fan < 0.995 || Math.abs(offset - target) > 0.0005 || dragging || Math.abs(vel) > 0.002
      || Math.abs(tiltX - tTiltX) > 0.002 || Math.abs(tiltY - tTiltY) > 0.002 || Math.abs(gloss - tGloss) > 0.002)) lifecycle?.invalidate();
  };

  const scheduler = createSceneLifecycle(host, draw, layout);
  const lifecycle = { ...scheduler, invalidate() { needsDraw = true; scheduler.invalidate(); } };

  /* 고르기: 화면 좌표를 카드 평면에 쏜다. 앞에 있는(가운데에 가까운) 카드가 먼저 */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pick = (clientX: number, clientY: number) => {
    const rect = host.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    camera.updateMatrixWorld(); scene.updateMatrixWorld();
    ray.setFromCamera(ndc, camera);
    let best = -1, bestA = Infinity;
    cards.forEach((c, i) => {
      if ((c.mat.uniforms.uAlpha.value as number) < 0.2) return;
      if (ray.intersectObject(c.mesh, false).length) { const a = Math.abs(rel(i)); if (a < bestA) { bestA = a; best = i; } }
    });
    return best;
  };

  // 자동 넘김: 사용자가 만지지 않을 때만
  const autoplayMs = Math.max(3000, opts.autoplayMs ?? 6000);
  let lastTouch = 0;
  const touch = () => { lastTouch = Date.now(); };
  const auto = setInterval(() => {
    if (destroyed || pointerId !== null || hovered >= 0 || media.matches || document.hidden || !lifecycle.isMoving()) return;
    const rect = host.getBoundingClientRect();
    if (rect.top + rect.height <= 0 || rect.top >= window.innerHeight) return;
    if (host.closest('section')?.contains(document.activeElement)) return;
    if (Date.now() - lastTouch < autoplayMs * 1.6) return;
    target += 1; lifecycle.invalidate();
  }, autoplayMs);

  const release = (id: number) => { try { canvas.releasePointerCapture(id); } catch { /* no capture */ } };
  const resetPointer = () => {
    const id = pointerId;
    pointerId = null; dragging = false; axis = 'pending'; flick = 0;
    canvas.style.cursor = 'grab';
    if (id !== null) release(id);
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || pointerId !== null || e.isPrimary === false) return;
    pointerId = e.pointerId; axis = 'pending'; touch();
    dragX = e.clientX; dragY = e.clientY; dragOffset = offset; dragMoved = 0;
    lastMoveX = e.clientX; lastMoveT = performance.now(); flick = 0;
    // 터치는 가로 의도가 확인될 때까지 붙잡지 않는다(세로 스크롤은 브라우저 몫)
    if (e.pointerType === 'mouse') canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const rect = host.getBoundingClientRect();
    if (e.pointerType === 'mouse') {
      const px = (e.clientX - rect.left) / rect.width, py = (e.clientY - rect.top) / rect.height;
      tTiltX = (px - 0.5) * 2; tTiltY = (py - 0.5) * 2;
      tSheen.set(1 - px, 1 - py);
    }
    if (pointerId === e.pointerId) {
      const dx = e.clientX - dragX, dy = e.clientY - dragY;
      dragMoved = Math.max(dragMoved, Math.hypot(dx, dy));
      if (axis === 'pending' && dragMoved >= 8) {
        if (Math.abs(dy) > Math.abs(dx) * 1.15) axis = 'vertical';
        else if (Math.abs(dx) > Math.abs(dy) * 1.15) {
          axis = 'horizontal'; dragging = true;
          try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer ended */ }
          canvas.style.cursor = 'grabbing';
        }
      }
      if (axis === 'horizontal') {
        offset = dragOffset - dx / pxPerItem;
        const now = performance.now();
        const dt = (now - lastMoveT) / 1000;
        if (dt > 0) flick = damp(flick, -(e.clientX - lastMoveX) / pxPerItem / dt, 18, dt);
        lastMoveX = e.clientX; lastMoveT = now;
        target = offset; touch();
      }
    } else if (e.pointerType === 'mouse' && pointerId === null) {
      hovered = pick(e.clientX, e.clientY);
      tGloss = hovered >= 0 && Math.round(Math.abs(rel(hovered))) === 0 ? 1 : 0;
      canvas.style.cursor = hovered >= 0 ? 'pointer' : 'grab';
    }
    lifecycle.invalidate();
  };
  const onUp = (e: PointerEvent) => {
    if (pointerId !== e.pointerId) return;
    const wasHorizontal = axis === 'horizontal', wasTap = axis === 'pending' && dragMoved < 8;
    const velocity = performance.now() - lastMoveT < 100 ? flick : 0;
    resetPointer();
    if (wasTap) {
      const i = pick(e.clientX, e.clientY);
      if (i >= 0) {
        const d = Math.round(rel(i));
        if (d === 0) opts.onPick?.(list[i]);
        else target = Math.round(offset) + d;
      }
    } else if (wasHorizontal) {
      target = Math.round(offset + clamp(velocity * 0.18, -2, 2));
    }
    touch(); lifecycle.invalidate();
  };
  const onCancel = (e: PointerEvent) => {
    if (pointerId !== e.pointerId) return;
    resetPointer(); target = Math.round(offset); touch(); lifecycle.invalidate();
    // 브라우저가 가져간 세로 스크롤·잃어버린 캡처는 절대 포스터를 열지 않는다
  };
  const onLeave = () => { tTiltX = 0; tTiltY = 0; tGloss = 0; hovered = -1; lifecycle.invalidate(); };
  const onWheel = (e: WheelEvent) => {
    // 가로 스크롤(트랙패드 좌우)만 가로챈다. 세로 스크롤은 페이지에 돌려준다
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
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('lostpointercapture', onCancel);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const onLost = (e: Event) => { e.preventDefault(); handle.destroy(); host.dataset.scene3d = 'fallback'; opts.onFallback?.(); };
  canvas.addEventListener('webglcontextlost', onLost);

  host.dataset.scene3d = 'ready';
  lifecycle.invalidate();

  const notifyStatic = () => {
    if (!lifecycle.isMoving()) {
      offset = target;
      const f = current();
      if (f !== focused) { focused = f; opts.onFocus?.(list[f]); }
    }
    lifecycle.invalidate();
  };
  const handle: StageHandle = {
    go(delta) { if (destroyed || !Number.isFinite(delta)) return; touch(); target = Math.round(target) + Math.trunc(delta); notifyStatic(); },
    goTo(index) {
      if (destroyed || !Number.isInteger(index)) return;
      touch();
      const cands = list.map((s, i) => (s === index ? i : -1)).filter((i) => i >= 0);
      if (!cands.length) return;
      const base = Math.round(target);
      const best = cands.map((i) => { const d = wrap(i - base, N); return d > N / 2 ? d - N : d; }).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
      target = base + best;
      notifyStatic();
    },
    index() { return list[current()]; },
    setPaused(p) { if (!destroyed) { lifecycle.setPaused(p); if (p) notifyStatic(); } },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearInterval(auto);
      clearTimeout(wheelTimer);
      lifecycle.destroy();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('lostpointercapture', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('webglcontextlost', onLost);
      for (const c of cards) { c.mat.dispose(); c.shadowMat.dispose(); }
      for (const promise of texCache.values()) void promise.then((texture) => texture?.dispose());
      shadowTex?.dispose();
      geo.dispose(); shadowGeo.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      delete host.dataset.scene3d;
    },
  };
  return handle;
}
