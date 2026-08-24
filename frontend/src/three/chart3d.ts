/**
 * 차트 — 갤러리 복도 (three.js)
 *
 * 레퍼런스: 미술관 복도. 양쪽 벽에 작품이 걸려 있고 관람객이 안쪽으로 걸어 들어간다.
 *
 * 순위를 '깊이'로 표현한다. 1위가 입구 정면에 크게 걸리고,
 * 그 뒤 순위들이 좌우 벽을 따라 안쪽으로 이어진다.
 * 스크롤·드래그로 복도를 따라 이동한다.
 *
 * 회전이나 흔들림은 넣지 않는다. 걸어 들어가는 움직임 하나만 둔다.
 */
import * as THREE from 'three';

export interface Chart3DItem {
  rank: number;
  title: string;
  artist: string;
  artwork?: string | null;
  onPick?: () => void;
}

interface Handle { destroy(): void; }

const HALL_W = 5.6;        // 복도 폭
const SPACING = 3.2;       // 작품 간 간격
const ART = 2.05;          // 작품 한 변
const HERO_ART = 3.3;      // 1위 작품 크기

export function createChart3D(host: HTMLElement, items: Chart3DItem[]): Handle | null {
  if (!items.length) return null;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;cursor:grab';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x050608, 9, 34);

  const camera = new THREE.PerspectiveCamera(48, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 60);
  camera.position.set(0, 0.1, 6.2);
  camera.lookAt(0, 0, -10);

  scene.add(new THREE.AmbientLight(0xffffff, 0.62));
  // 복도 천장을 따라 흐르는 빛
  const l1 = new THREE.DirectionalLight(0xffffff, 0.95);
  l1.position.set(0, 5, 4);
  scene.add(l1);
  const l2 = new THREE.DirectionalLight(0xa78bfa, 0.4);
  l2.position.set(-4, 1, -6);
  scene.add(l2);

  const hall = new THREE.Group();
  scene.add(hall);

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');

  const frameGeo = new THREE.BoxGeometry(ART, ART, 0.06);
  const heroGeo = new THREE.BoxGeometry(HERO_ART, HERO_ART, 0.08);
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x0c0d11, roughness: 0.9, metalness: 0 });

  const meshes: THREE.Mesh[] = [];
  const use = items.slice(0, 21);

  use.forEach((it, i) => {
    const faceMat = new THREE.MeshStandardMaterial({
      color: 0x14151a, roughness: 0.5, metalness: 0.03,
      transparent: true, opacity: 0.001,
    });
    const isHero = i === 0;
    const mats = [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, edgeMat];
    const mesh = new THREE.Mesh(isHero ? heroGeo : frameGeo, mats);

    if (isHero) {
      // 1위는 복도 정면에 정면으로 건다
      mesh.position.set(0, 0.15, -1.2);
    } else {
      // 나머지는 좌우 벽에 번갈아 걸고, 안쪽을 향해 살짝 돌린다
      const idx = i - 1;
      const side = idx % 2 === 0 ? -1 : 1;
      const depth = -3.4 - Math.floor(idx / 2) * SPACING;
      mesh.position.set(side * (HALL_W / 2), 0.05, depth);
      mesh.rotation.y = side * -0.42;
    }
    mesh.userData = { item: it, faceMat, index: i, isHero };
    hall.add(mesh);
    meshes.push(mesh);

    const url = it.artwork?.replace(/\/\d+x\d+bb\./, '/400x400bb.');
    if (!url) { faceMat.opacity = 0.14; return; }
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        faceMat.map = tex;
        faceMat.color.set(0xffffff);
        faceMat.needsUpdate = true;
        mesh.userData.ready = true;
      },
      undefined,
      () => { faceMat.opacity = 0.12; },
    );
  });

  /* 복도 — 바닥과 양쪽 벽 */
  const deep = 3.4 + Math.ceil(use.length / 2) * SPACING + 6;
  const floorGeo = new THREE.PlaneGeometry(HALL_W + 2.4, deep + 14);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.82, metalness: 0.06 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -1.65, -deep / 2 + 4);
  hall.add(floor);

  const wallGeo = new THREE.PlaneGeometry(deep + 14, 6);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x0a0b0e, roughness: 1, metalness: 0 });
  [-1, 1].forEach((s) => {
    const w = new THREE.Mesh(wallGeo, wallMat);
    w.rotation.y = s * -Math.PI / 2;
    w.position.set(s * (HALL_W / 2 + 0.6), 1.2, -deep / 2 + 4);
    hall.add(w);
  });

  /* ---- 이동 ---- */
  let travel = 0, target = 0;
  const maxTravel = Math.max(0, deep - 12);
  const clamp = (v: number) => Math.max(0, Math.min(maxTravel, v));
  let dragging = false, lastY = 0, dragMoved = 0;
  let hovered: THREE.Mesh | null = null;

  const onWheel = (e: WheelEvent) => {
    const next = clamp(target + e.deltaY * 0.012);
    if (next !== target) { target = next; e.preventDefault(); }
  };
  const onPointerDown = (e: PointerEvent) => {
    dragging = true; dragMoved = 0; lastY = e.clientY;
    renderer.domElement.style.cursor = 'grabbing';
    renderer.domElement.setPointerCapture(e.pointerId);
  };
  const ndc = new THREE.Vector2(999, 999);
  const onPointerMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    if (!dragging) return;
    const dy = e.clientY - lastY;
    lastY = e.clientY;
    dragMoved += Math.abs(dy);
    target = clamp(target - dy * 0.028);
  };
  const onPointerUp = (e: PointerEvent) => {
    dragging = false;
    renderer.domElement.style.cursor = 'grab';
    try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* 무시 */ }
  };
  const onClick = () => {
    if (dragMoved > 6) return;
    hovered?.userData?.item?.onPick?.();
  };

  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('click', onClick);
  renderer.domElement.addEventListener('pointerleave', () => ndc.set(999, 999));

  /* 현재 눈앞의 작품을 바깥에 알린다 */
  let lastFront = -1;
  const ray = new THREE.Raycaster();

  let frame = 0, visible = true;

  const resize = () => {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const tick = () => {
    travel += (target - travel) * 0.07;
    hall.position.z = travel;

    // 카메라 정면에 가장 가까운 작품 찾기
    let frontIdx = 0, best = Infinity;
    for (const m of meshes) {
      const z = m.position.z + travel;
      const d = Math.abs(z + 1.5);
      if (d < best) { best = d; frontIdx = m.userData.index; }
    }
    if (frontIdx !== lastFront) {
      lastFront = frontIdx;
      host.dispatchEvent(new CustomEvent('chart3d:front', { detail: use[frontIdx] }));
    }

    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(meshes, false)[0];
    const next = (hit?.object as THREE.Mesh) || null;
    if (next !== hovered) {
      hovered = next;
      renderer.domElement.style.cursor = hovered ? 'pointer' : 'grab';
    }

    for (const m of meshes) {
      const mat = m.userData.faceMat as THREE.MeshStandardMaterial;
      if (m.userData.ready) mat.opacity += (1 - mat.opacity) * 0.09;
      // 마우스를 얹으면 벽에서 살짝 앞으로
      const lift = m === hovered ? 1.03 : 1;
      m.scale.x += (lift - m.scale.x) * 0.16;
      m.scale.y = m.scale.x;
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
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('click', onClick);
      meshes.forEach((m) => {
        const mat = m.userData.faceMat as THREE.MeshStandardMaterial;
        mat.map?.dispose(); mat.dispose();
      });
      frameGeo.dispose(); heroGeo.dispose(); edgeMat.dispose();
      floorGeo.dispose(); floorMat.dispose();
      wallGeo.dispose(); wallMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
