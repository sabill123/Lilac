/**
 * 홈 히어로 3D 앨범 캐러셀 (three.js)
 *
 * 실제 차트 상위 앨범 아트를 원통형으로 배치해 천천히 회전시킨다.
 * 마우스를 따라 시점이 기울고, 클릭하면 해당 곡으로 이동한다.
 *
 * 성능 원칙
 *   · three.js 는 이 모듈에서만 쓰고 동적 import 로 불러온다
 *     → 홈에 들어가지 않으면 다운로드조차 하지 않는다
 *   · 화면 밖 / 백그라운드 탭에서는 렌더 루프를 멈춘다
 *   · 모션 최소화 · 좁은 화면 · WebGL 미지원이면 아예 만들지 않는다
 *   · 텍스처는 200px 로 받아 GPU 메모리를 아낀다
 */
import * as THREE from 'three';

export interface HeroItem {
  title: string;
  artist: string;
  artwork: string;
  href?: string;
}

interface Handle { destroy(): void; }

/* 구도
   원통 반지름을 키우고 카메라를 뒤로 빼면 한 번에 더 많은 앨범이 보인다.
   카메라를 살짝 위에서 내려다보게 두면 바닥 원판과 함께 깊이가 산다. */
const RADIUS = 5.6;
const CARD_W = 1.72;
const CARD_H = 1.72;

export function createHero3D(host: HTMLElement, items: HeroItem[]): Handle | null {
  if (!items.length) return null;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;cursor:grab';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 100);
  camera.position.set(0, 1.5, 13.4);
  camera.lookAt(0, -0.15, 0);

  // 은은한 조명 — 앨범 아트 자체가 밝으므로 과하지 않게
  scene.add(new THREE.AmbientLight(0xffffff, 1.25));
  const key = new THREE.DirectionalLight(0xc9b6ff, 0.9);
  key.position.set(3, 4, 6);
  scene.add(key);

  const group = new THREE.Group();
  scene.add(group);

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');

  const use = items.slice(0, 16);
  const meshes: THREE.Mesh[] = [];
  const geo = new THREE.PlaneGeometry(CARD_W, CARD_H, 1, 1);

  use.forEach((it, i) => {
    const angle = (i / use.length) * Math.PI * 2;
    // 텍스처가 도착하기 전에도 자리를 잡도록 먼저 판을 세운다
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a1b20, roughness: 0.62, metalness: 0.08,
      transparent: true, opacity: 0.001,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(Math.sin(angle) * RADIUS, 0, Math.cos(angle) * RADIUS);
    mesh.lookAt(0, 0, 0);
    mesh.rotateY(Math.PI);              // 바깥을 보게 뒤집는다
    mesh.userData = { index: i, angle, item: it };
    group.add(mesh);
    meshes.push(mesh);

    const url = it.artwork?.replace(/\/\d+x\d+bb\./, '/300x300bb.');
    if (!url) return;
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
        // 도착한 순서대로 부드럽게 나타나게 한다
        mesh.userData.fadeIn = true;
      },
      undefined,
      () => { mat.opacity = 0.14; mat.color.set(0x2a2b33); },
    );
  });

  // 바닥 반사 느낌의 은은한 원판
  const floorGeo = new THREE.CircleGeometry(RADIUS + 1.6, 48);
  const floorMat = new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.05 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.35;
  scene.add(floor);

  /* ---- 상호작용 ---- */
  let targetRotY = 0;      // 드래그·스크롤로 조정되는 목표 회전
  let curRotY = 0;
  let autoSpin = 0.0016;
  let tiltX = 0, tiltTargetX = 0;
  let dragging = false, lastX = 0, dragMoved = 0;

  const onPointerDown = (e: PointerEvent) => {
    dragging = true; dragMoved = 0; lastX = e.clientX;
    renderer.domElement.style.cursor = 'grabbing';
    renderer.domElement.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    tiltTargetX = ((e.clientY - r.top) / Math.max(1, r.height) - 0.5) * 0.34;
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    dragMoved += Math.abs(dx);
    targetRotY += dx * 0.006;
  };
  const onPointerUp = (e: PointerEvent) => {
    dragging = false;
    renderer.domElement.style.cursor = 'grab';
    try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* 무시 */ }
  };

  // 클릭(드래그가 아닌 경우)한 앨범으로 이동
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const onClick = (e: MouseEvent) => {
    if (dragMoved > 6) return;                 // 드래그였으면 무시
    const r = host.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(meshes, false)[0];
    const href = (hit?.object as THREE.Mesh | undefined)?.userData?.item?.href;
    if (href) location.hash = href;
  };

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('click', onClick);

  /* ---- 렌더 루프 ---- */
  let frame = 0;
  let visible = true;

  const resize = () => {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const tick = () => {
    curRotY += (targetRotY - curRotY) * 0.08;
    if (!dragging) targetRotY += autoSpin;
    tiltX += (tiltTargetX - tiltX) * 0.06;

    group.rotation.y = curRotY;
    group.rotation.x = tiltX;

    // 앞쪽에 온 앨범을 살짝 키우고 또렷하게
    for (const m of meshes) {
      const world = new THREE.Vector3();
      m.getWorldPosition(world);
      const front = (world.z + RADIUS) / (RADIUS * 2);      // 0(뒤) ~ 1(앞)
      const mat = m.material as THREE.MeshStandardMaterial;
      const targetOpacity = mat.map ? 0.34 + front * 0.66 : mat.opacity;
      if (m.userData.fadeIn) mat.opacity += (targetOpacity - mat.opacity) * 0.12;
      const s = 0.8 + front * 0.4;
      m.scale.setScalar(s);
    }

    renderer.render(scene, camera);
    frame = visible && !document.hidden ? requestAnimationFrame(tick) : 0;
  };

  const resume = () => { if (!frame && visible && !document.hidden) frame = requestAnimationFrame(tick); };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  const io = new IntersectionObserver(([e]) => {
    visible = e?.isIntersecting ?? true;
    if (visible) resume();
    else if (frame) { cancelAnimationFrame(frame); frame = 0; }
  }, { threshold: 0.01 });
  io.observe(host);
  const onVis = () => { if (document.hidden && frame) { cancelAnimationFrame(frame); frame = 0; } else resume(); };
  document.addEventListener('visibilitychange', onVis);

  resize();
  frame = requestAnimationFrame(tick);

  return {
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('click', onClick);
      meshes.forEach((m) => {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.map?.dispose();
        mat.dispose();
      });
      geo.dispose(); floorGeo.dispose(); floorMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
