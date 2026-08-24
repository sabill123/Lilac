/**
 * 차트 3D 시각화 (three.js)
 *
 * 상위 곡을 앞뒤로 늘어선 카드 열로 배치한다.
 * 1위가 가장 앞에 크게 서고, 뒤로 갈수록 작아지며 멀어진다.
 * 스크롤·드래그로 열을 따라 이동하고, 카드를 누르면 재생한다.
 *
 * 성능 원칙은 hero3d 와 동일 — 동적 import, 화면 밖이면 정지, 좁은 화면은 미생성.
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

const GAP = 2.35;        // 카드 간 z 간격
const CARD = 2.0;

export function createChart3D(host: HTMLElement, items: Chart3DItem[]): Handle | null {
  if (!items.length) return null;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;cursor:grab';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0b0d, 8, 26);      // 뒤쪽이 자연스럽게 사라지도록

  const camera = new THREE.PerspectiveCamera(42, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 60);
  camera.position.set(2.1, 1.5, 6.4);

  scene.add(new THREE.AmbientLight(0xffffff, 1.3));
  const key = new THREE.DirectionalLight(0xa78bfa, 1.0);
  key.position.set(-4, 5, 5);
  scene.add(key);

  const group = new THREE.Group();
  scene.add(group);

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  const geo = new THREE.PlaneGeometry(CARD, CARD, 1, 1);
  const meshes: THREE.Mesh[] = [];

  const use = items.slice(0, 20);
  use.forEach((it, i) => {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x16171c, roughness: 0.6, metalness: 0.1,
      transparent: true, opacity: 0.001, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // 살짝 지그재그로 어긋나게 놓아 겹쳐 보이지 않게 한다
    mesh.position.set((i % 2 ? 0.42 : -0.42), 0, -i * GAP);
    mesh.rotation.y = (i % 2 ? -1 : 1) * 0.17;
    mesh.userData = { item: it, baseX: mesh.position.x, index: i };
    group.add(mesh);
    meshes.push(mesh);

    const url = it.artwork?.replace(/\/\d+x\d+bb\./, '/300x300bb.');
    if (!url) { mat.opacity = 0.2; return; }
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
        mesh.userData.ready = true;
      },
      undefined,
      () => { mat.opacity = 0.18; },
    );
  });

  // 카드가 놓인 바닥 라인 — 깊이감을 만든다
  const laneGeo = new THREE.PlaneGeometry(6, use.length * GAP + 6);
  const laneMat = new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.045 });
  const lane = new THREE.Mesh(laneGeo, laneMat);
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(0, -1.15, -(use.length * GAP) / 2 + 2);
  scene.add(lane);

  /* ---- 상호작용 ---- */
  let scrollZ = 0, targetZ = 0;
  let dragging = false, lastY = 0, dragMoved = 0;
  const maxZ = (use.length - 1) * GAP;

  const clamp = (v: number) => Math.max(0, Math.min(maxZ, v));

  const onWheel = (e: WheelEvent) => {
    // 열 방향 이동만 가로채고, 끝에 닿으면 페이지 스크롤에 넘긴다
    const next = clamp(targetZ + e.deltaY * 0.01);
    if (next !== targetZ) { targetZ = next; e.preventDefault(); }
  };
  const onPointerDown = (e: PointerEvent) => {
    dragging = true; dragMoved = 0; lastY = e.clientY;
    renderer.domElement.style.cursor = 'grabbing';
    renderer.domElement.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dy = e.clientY - lastY;
    lastY = e.clientY;
    dragMoved += Math.abs(dy);
    targetZ = clamp(targetZ - dy * 0.03);
  };
  const onPointerUp = (e: PointerEvent) => {
    dragging = false;
    renderer.domElement.style.cursor = 'grab';
    try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* 무시 */ }
  };

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const onClick = (e: MouseEvent) => {
    if (dragMoved > 6) return;
    const r = host.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(meshes, false)[0];
    (hit?.object as THREE.Mesh | undefined)?.userData?.item?.onPick?.();
  };

  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('click', onClick);

  /* ---- 현재 맨 앞 카드를 바깥에 알려준다 (제목 표시용) ---- */
  let lastFront = -1;
  const emitFront = (idx: number) => {
    if (idx === lastFront) return;
    lastFront = idx;
    host.dispatchEvent(new CustomEvent('chart3d:front', { detail: use[idx] }));
  };

  /* ---- 렌더 루프 ---- */
  let frame = 0, visible = true;

  const resize = () => {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const tick = () => {
    scrollZ += (targetZ - scrollZ) * 0.09;
    group.position.z = scrollZ;

    let frontIdx = 0, frontDist = Infinity;
    for (const m of meshes) {
      const z = m.position.z + scrollZ;          // 카메라 기준 상대 위치
      const dist = Math.abs(z);
      if (dist < frontDist) { frontDist = dist; frontIdx = m.userData.index; }

      const near = Math.max(0, 1 - dist / (GAP * 5));     // 앞에 가까울수록 1
      const mat = m.material as THREE.MeshStandardMaterial;
      if (m.userData.ready) mat.opacity += ((0.25 + near * 0.75) - mat.opacity) * 0.12;
      m.scale.setScalar(0.82 + near * 0.42);
      // 앞으로 올수록 정면을 보게 회전을 편다
      m.rotation.y += (((m.userData.index % 2 ? -1 : 1) * 0.17 * (1 - near)) - m.rotation.y) * 0.1;
      m.position.y = Math.sin((m.userData.index * 0.7) + scrollZ * 0.25) * 0.08;
    }
    emitFront(frontIdx);

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
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.map?.dispose(); mat.dispose();
      });
      geo.dispose(); laneGeo.dispose(); laneMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
