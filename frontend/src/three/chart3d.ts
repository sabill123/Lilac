/**
 * 차트 — 1위 전시 (three.js)
 *
 * 앞서 캐러셀·복도·전시벽을 차례로 시도했지만 전부 실패했다.
 * 원인은 구도가 아니라 전제였다. 차트는 '순위를 읽는 페이지'인데
 * 화면 가득한 3D가 그 일을 방해했다. 움직이는 것이 많을수록 정보는 덜 읽힌다.
 *
 * 그래서 전시물을 하나로 줄였다.
 *   · 1위 앨범 한 점만 받침대 위에 올린다
 *   · 물체는 돌리지 않는다. 조명만 아주 느리게 돌아 재킷 표면을 훑는다
 *   · 순위가 바뀌면(다른 소스·국가) 새 아트워크를 로드해 교체한다
 *   · 나머지 순위는 아래 목록이 담당한다
 *
 * 즉 3D는 배경이고, 주인공은 데이터다.
 */
import * as THREE from 'three';
import { createSceneLifecycle } from './lifecycle';
import type { SceneHandle } from './lifecycle';

export interface Chart3DItem {
  rank: number;
  title: string;
  artist: string;
  artwork?: string | null;
  onPick?: () => void;
}



export function createChart3D(host: HTMLElement, items: Chart3DItem[]): SceneHandle | null {
  let top = items[0];
  if (!top?.artwork) return null;

  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true }); }
  catch { host.dataset.scene3d = 'fallback'; return null; }
  let destroyed = false, requestId = 0;
  let lifecycle: ReturnType<typeof createSceneLifecycle> | undefined;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;cursor:pointer';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.style.visibility = 'hidden';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 40);
  camera.position.set(0, 0.2, 6.2);
  camera.lookAt(0, -0.05, 0);

  /* 조명
     전시실 조명처럼 위에서 떨어지는 주광 하나와, 반대쪽에서 형태를 살리는 보조광.
     주광은 아주 느리게 좌우로 움직여 재킷 표면의 질감이 계속 바뀌게 한다. */
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xfff4e6, 1.45);
  key.position.set(-2.2, 4.2, 3.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xcba6d8, 0.6);
  rim.position.set(3.4, 0.4, -1.8);
  scene.add(rim);

  const group = new THREE.Group();
  scene.add(group);

  /* 작품 — 재킷을 두께 있는 판으로 세운다 */
  const ART = 2.5;
  const artGeo = new THREE.BoxGeometry(ART, ART, 0.09);
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.88, metalness: 0.05 });
  const faceMat = new THREE.MeshStandardMaterial({
    color: 0x16171c, roughness: 0.42, metalness: 0.06,
    transparent: true, opacity: 0.001,
  });
  const art = new THREE.Mesh(artGeo, [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, edgeMat]);
  art.position.y = 0.08;
  group.add(art);

  /* 접지 그림자 — 카메라 각도에서 넓은 판은 회색 띠로 보여 지저분했다.
     재킷 바로 아래 작은 그라데이션 원 하나로 '떠 있음'만 표현한다. */
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const sg = shadowCanvas.getContext('2d');
  if (sg) {
  const grad = sg.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.5)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  sg.fillStyle = grad;
  sg.fillRect(0, 0, 128, 128);
  }
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  const shadowGeo = new THREE.PlaneGeometry(ART * 1.1, ART * 0.34);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.75, depthWrite: false });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -ART / 2 - 0.18;
  group.add(shadow);

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  let currentTex: THREE.Texture | null = null;

  /** Latest request wins; late callbacks dispose their textures instead of reviving a scene. */
  const applyArtwork = (item: Chart3DItem) => {
    const id = ++requestId;
    renderer.domElement.style.visibility = 'hidden';
    host.dataset.scene3d = 'loading';
    if (!item.artwork) { host.dataset.scene3d = 'fallback'; return; }
    loader.load(
      item.artwork.replace(/\/\d+x\d+bb\./, '/600x600bb.'),
      (tex) => {
        if (destroyed || id !== requestId) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        currentTex?.dispose(); currentTex = tex;
        faceMat.map = tex;
        faceMat.color.set(0xffffff);
        faceMat.emissiveMap = tex;
        faceMat.emissive.set(0xffffff);
        faceMat.emissiveIntensity = 0.35;
        faceMat.opacity = 1;
        faceMat.needsUpdate = true;
        renderer.domElement.style.visibility = '';
        host.dataset.scene3d = 'ready';
        lifecycle?.invalidate();
      },
      undefined,
      () => { if (!destroyed && id === requestId) host.dataset.scene3d = 'fallback'; },
    );
  };
  applyArtwork(top);
  const swapTo = (item: Chart3DItem) => {
    if (destroyed || !item) return;
    top = item;
    applyArtwork(item);
  };
  const swapHost = host as HTMLElement & { __swapTop?: (item: Chart3DItem) => void };
  swapHost.__swapTop = swapTo;

  /* ---- 상호작용 ----
     마우스에 따라 아주 조금 기울기만 한다. 클릭하면 재생. */
  let tiltX = 0, tiltY = 0, tTX = 0, tTY = 0;
  const onMove = (e: PointerEvent) => {
    if (!lifecycle?.isMoving() || e.pointerType === 'touch') return;
    const r = host.getBoundingClientRect();
    tTY = ((e.clientX - r.left) / Math.max(1, r.width) - 0.5) * 0.26;
    tTX = ((e.clientY - r.top) / Math.max(1, r.height) - 0.5) * 0.16;
  };
  const onLeave = () => { tTX = 0; tTY = 0; };
  const onClick = () => top.onPick?.();

  host.addEventListener('pointermove', onMove, { passive: true });
  host.addEventListener('pointerleave', onLeave);
  renderer.domElement.addEventListener('click', onClick);

  /* ---- 렌더 루프 ---- */

  const resize = () => {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 작품과 좌대가 세로에 들어오는 거리
    const needH = (ART + 0.5) / (2 * Math.tan((camera.fov * Math.PI) / 360));   /* 여백을 줄여 작품이 무대를 채운다 */
    camera.position.z = Math.max(4.2, needH, needH / camera.aspect);
    camera.updateProjectionMatrix();
  };

  const tick = (t: number, delta: number, moving: boolean) => {
    if (moving) {
      const blend = 1 - Math.pow(0.95, delta * 60);

      // 조명만 느리게 돈다 — 물체는 그대로 두고 빛이 표면을 훑는다
      key.position.set(Math.sin(t * 0.12) * 3.2 - 0.6, 4.2, Math.cos(t * 0.12) * 1.6 + 2.8);
      rim.position.set(Math.sin(t * 0.12 + Math.PI) * 3.4, 0.4, Math.cos(t * 0.12 + Math.PI) * 2.2 - 1.2);

      // 숨 쉬듯 아주 미세한 상하 움직임
      group.position.y = Math.sin(t * 0.5) * 0.028;

      tiltX += (tTX - tiltX) * blend;
      tiltY += (tTY - tiltY) * blend;
      group.rotation.x = tiltX;
      group.rotation.y = tiltY;

    }

    renderer.render(scene, camera);
  };

  lifecycle = createSceneLifecycle(host, tick, resize);
  const onContextLost = (event: Event) => { event.preventDefault(); destroy(); host.dataset.scene3d = 'fallback'; };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  function destroy() {
      if (destroyed) return;
      destroyed = true; requestId++;
      lifecycle?.destroy();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      renderer.domElement.removeEventListener('click', onClick);
      if (swapHost.__swapTop === swapTo) delete swapHost.__swapTop;
      currentTex?.dispose();
      faceMat.dispose(); edgeMat.dispose();
      artGeo.dispose();
      shadowGeo.dispose(); shadowMat.dispose(); shadowTex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      delete host.dataset.scene3d;
  }
  return { destroy, setPaused: paused => lifecycle?.setPaused(paused) };
}
