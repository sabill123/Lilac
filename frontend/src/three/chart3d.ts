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
 *   · 순위가 바뀌면(다른 소스·국가) 작품을 교체하듯 페이드로 바꾼다
 *   · 나머지 순위는 아래 목록이 담당한다
 *
 * 즉 3D는 배경이고, 주인공은 데이터다.
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

export function createChart3D(host: HTMLElement, items: Chart3DItem[]): Handle | null {
  const top = items[0];
  if (!top?.artwork) return null;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;cursor:pointer';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 40);
  camera.position.set(0, 0.35, 6.2);
  camera.lookAt(0, -0.1, 0);

  /* 조명
     전시실 조명처럼 위에서 떨어지는 주광 하나와, 반대쪽에서 형태를 살리는 보조광.
     주광은 아주 느리게 좌우로 움직여 재킷 표면의 질감이 계속 바뀌게 한다. */
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xfff4e6, 1.45);
  key.position.set(-2.2, 4.2, 3.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xa78bfa, 0.65);
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
  art.position.y = 0.32;
  group.add(art);

  /* 받침대 — 미술관 좌대 */
  const baseGeo = new THREE.BoxGeometry(ART * 1.18, 0.16, 0.8);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x1b1c22, roughness: 0.78, metalness: 0.12 });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.set(0, 0.32 - ART / 2 - 0.08, 0.1);
  group.add(base);

  /* 바닥에 번지는 빛 — 좌대 아래 반사 */
  const glowGeo = new THREE.CircleGeometry(ART * 1.5, 48);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.055 });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.32 - ART / 2 - 0.17;
  group.add(glow);

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  let currentTex: THREE.Texture | null = null;

  /** 작품 교체 — 페이드 아웃 후 새 텍스처를 걸고 다시 페이드 인 */
  let fadeTarget = 1;
  let pendingUrl: string | null = null;

  const applyArtwork = (url: string) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        currentTex?.dispose();
        currentTex = tex;
        faceMat.map = tex;
        faceMat.color.set(0xffffff);
        faceMat.needsUpdate = true;
        fadeTarget = 1;
      },
      undefined,
      () => { fadeTarget = 0.16; },
    );
  };

  applyArtwork(top.artwork.replace(/\/\d+x\d+bb\./, '/600x600bb.'));

  /** 바깥에서 순위가 바뀌면 호출 */
  const swapTo = (item: Chart3DItem) => {
    if (!item?.artwork) return;
    pendingUrl = item.artwork.replace(/\/\d+x\d+bb\./, '/600x600bb.');
    fadeTarget = 0;      // 먼저 사라지고, 다 사라지면 교체한다
  };
  (host as HTMLElement & { __swapTop?: (i: Chart3DItem) => void }).__swapTop = swapTo;

  /* ---- 상호작용 ----
     마우스에 따라 아주 조금 기울기만 한다. 클릭하면 재생. */
  let tiltX = 0, tiltY = 0, tTX = 0, tTY = 0;
  const onMove = (e: PointerEvent) => {
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
  let frame = 0, visible = true;
  const t0 = performance.now();

  const resize = () => {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 작품과 좌대가 세로에 들어오는 거리
    const needH = (ART + 1.1) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    camera.position.z = Math.max(5.2, needH);
    camera.updateProjectionMatrix();
  };

  const tick = (now: number) => {
    const t = (now - t0) * 0.001;

    // 조명만 느리게 돈다 — 물체는 그대로 두고 빛이 표면을 훑는다
    key.position.set(Math.sin(t * 0.12) * 3.2 - 0.6, 4.2, Math.cos(t * 0.12) * 1.6 + 2.8);
    rim.position.set(Math.sin(t * 0.12 + Math.PI) * 3.4, 0.4, Math.cos(t * 0.12 + Math.PI) * 2.2 - 1.2);

    // 숨 쉬듯 아주 미세한 상하 움직임
    group.position.y = Math.sin(t * 0.5) * 0.028;

    tiltX += (tTX - tiltX) * 0.05;
    tiltY += (tTY - tiltY) * 0.05;
    group.rotation.x = tiltX;
    group.rotation.y = tiltY;

    // 페이드 및 교체 처리
    faceMat.opacity += (fadeTarget - faceMat.opacity) * 0.1;
    if (pendingUrl && faceMat.opacity < 0.06) {
      const url = pendingUrl;
      pendingUrl = null;
      applyArtwork(url);
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
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      renderer.domElement.removeEventListener('click', onClick);
      currentTex?.dispose();
      faceMat.dispose(); edgeMat.dispose();
      artGeo.dispose(); baseGeo.dispose(); baseMat.dispose();
      glowGeo.dispose(); glowMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
