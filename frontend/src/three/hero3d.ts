/**
 * 홈 히어로 — 레코드 갤러리 월 (three.js)
 *
 * 레퍼런스: 벽에 선반을 달아 LP 재킷을 세워두는 진열 방식(The Vinyl Wall),
 *          그리고 작품이 벽에 걸린 갤러리.
 *
 * 회전하는 캐러셀은 시선을 흐트러뜨리고 정보가 읽히지 않는다.
 * 여기서는 앨범을 벽에 가지런히 걸고, 카메라가 아주 느리게 옆으로 흐르게 한다.
 * 움직임은 '조용한 드리프트' 수준으로만 두고, 재킷 자체가 주인공이 되게 한다.
 *
 * 성능
 *   · 지오메트리·머티리얼을 공유하고 인스턴스마다 텍스처만 교체
 *   · 화면 밖 / 백그라운드 탭이면 렌더 정지
 *   · 텍스처는 표시 크기에 맞춰 400px로 요청
 */
import * as THREE from 'three';

export interface HeroItem {
  title: string;
  artist: string;
  artwork: string;
  href?: string;
}

interface Handle { destroy(): void; }

/* 벽 구성 — 재킷 한 변 1.0 기준 */
const TILE = 1.0;
const GAP_X = 0.26;
const GAP_Y = 0.42;      // 선반 두께만큼 세로 간격을 더 준다
const ROWS = 3;
const COL_W = TILE + GAP_X;
const ROW_H = TILE + GAP_Y;

export function createHero3D(host: HTMLElement, items: HeroItem[]): Handle | null {
  if (!items.length) return null;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;cursor:grab';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  /* 카메라
     벽을 정면에서 보되 아주 살짝 각도를 줘 재킷의 두께와 그림자가 읽히게 한다. */
  const camera = new THREE.PerspectiveCamera(30, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 60);
  camera.position.set(0, 0, 7.4);
  camera.lookAt(0, 0, 0);

  /* 조명 — 갤러리 스포트 느낌.
     위에서 비스듬히 떨어지는 빛 하나 + 전체를 살짝 띄우는 환경광 */
  scene.add(new THREE.AmbientLight(0xffffff, 0.72));
  const spot = new THREE.DirectionalLight(0xffffff, 1.15);
  spot.position.set(-2.2, 4.4, 3.6);
  scene.add(spot);
  const fill = new THREE.DirectionalLight(0xa78bfa, 0.32);
  fill.position.set(3.4, -1.4, 2.2);
  scene.add(fill);

  const wall = new THREE.Group();
  scene.add(wall);

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');

  /* 재킷은 얇은 판이 아니라 살짝 두께가 있는 상자로 만든다.
     옆면이 보여야 '벽에 걸린 물건'처럼 읽힌다. */
  const tileGeo = new THREE.BoxGeometry(TILE, TILE, 0.045);
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x0d0e12, roughness: 0.9, metalness: 0 });

  /* 벽은 좌우로 이어져야 하므로 화면 폭보다 넉넉히 넓게 만든다.
     자료가 모자라면 앞에서부터 다시 걸어 반복시킨다(실제 진열장도 그렇게 채운다). */
  const MIN_COLS = 14;
  const cols = Math.max(MIN_COLS, Math.ceil(items.length / ROWS));
  const totalW = cols * COL_W;
  const filled: HeroItem[] = [];
  for (let i = 0; i < ROWS * cols; i++) filled.push(items[i % items.length]);

  interface TileData { mesh: THREE.Mesh; item: HeroItem; baseZ: number; }
  const tiles: TileData[] = [];

  filled.forEach((it, i) => {
    const col = Math.floor(i / ROWS);
    const row = i % ROWS;

    const faceMat = new THREE.MeshStandardMaterial({
      color: 0x16171c, roughness: 0.52, metalness: 0.04,
      transparent: true, opacity: 0.001,
    });
    // BoxGeometry 면 순서: +x, -x, +y, -y, +z(앞), -z
    const mats = [sideMat, sideMat, sideMat, sideMat, faceMat, sideMat];
    const mesh = new THREE.Mesh(tileGeo, mats);

    // 행마다 살짝 어긋나게 걸어 기계적인 격자를 피한다
    const stagger = (row % 2) * (COL_W * 0.34);
    mesh.position.set(
      col * COL_W - totalW / 2 + stagger,
      (ROWS - 1) / 2 * ROW_H - row * ROW_H,
      0,
    );
    mesh.userData = { item: it, faceMat };
    wall.add(mesh);
    tiles.push({ mesh, item: it, baseZ: 0 });

    const url = it.artwork?.replace(/\/\d+x\d+bb\./, '/400x400bb.');
    if (!url) { faceMat.opacity = 0.16; return; }
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

  /* 선반 — 각 행 아래에 얇은 판을 대 '걸려 있는' 느낌을 만든다 */
  const shelfGeo = new THREE.BoxGeometry(totalW + COL_W * 2, 0.045, 0.2);
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x2a2b33, roughness: 0.86, metalness: 0.05 });
  for (let r = 0; r < ROWS; r++) {
    const shelf = new THREE.Mesh(shelfGeo, shelfMat);
    shelf.position.set(0, (ROWS - 1) / 2 * ROW_H - r * ROW_H - TILE / 2 - 0.06, 0.08);
    wall.add(shelf);
  }

  /* 벽면 — 아주 어두운 판. 재킷 뒤로 공간이 있다는 걸 알려준다 */
  const backGeo = new THREE.PlaneGeometry(totalW + 14, ROWS * ROW_H + 10);
  const backMat = new THREE.MeshStandardMaterial({ color: 0x0a0b0e, roughness: 1, metalness: 0 });
  const back = new THREE.Mesh(backGeo, backMat);
  back.position.z = -0.6;
  wall.add(back);

  /* ---- 상호작용 ----
     느린 가로 드리프트 + 마우스에 따른 미세한 시차. 그 이상은 하지 않는다. */
  let driftX = 0;
  let targetX = 0;
  let curX = 0;
  let parX = 0, parY = 0, parTX = 0, parTY = 0;
  let dragging = false, lastPX = 0, dragMoved = 0;
  let hovered: THREE.Mesh | null = null;

  const loopW = cols * COL_W;   // 한 바퀴 폭 — 끝나면 이어 붙인다

  const onPointerDown = (e: PointerEvent) => {
    dragging = true; dragMoved = 0; lastPX = e.clientX;
    renderer.domElement.style.cursor = 'grabbing';
    renderer.domElement.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    parTX = ((e.clientX - r.left) / Math.max(1, r.width) - 0.5) * 0.5;
    parTY = ((e.clientY - r.top) / Math.max(1, r.height) - 0.5) * 0.32;
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    if (!dragging) return;
    const dx = e.clientX - lastPX;
    lastPX = e.clientX;
    dragMoved += Math.abs(dx);
    targetX -= dx * 0.011;
  };
  const onPointerUp = (e: PointerEvent) => {
    dragging = false;
    renderer.domElement.style.cursor = 'grab';
    try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* 무시 */ }
  };

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2(999, 999);

  const onClick = () => {
    if (dragMoved > 6) return;
    const href = hovered?.userData?.item?.href;
    if (href) location.hash = href;
  };

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('click', onClick);
  renderer.domElement.addEventListener('pointerleave', () => { ndc.set(999, 999); });

  /* ---- 렌더 루프 ---- */
  let frame = 0, visible = true;

  const resize = () => {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 세로가 짧으면 벽이 잘리므로 카메라를 뒤로 뺀다
    // 3행이 세로에 여유 있게 들어오도록 거리 계산 (위아래 약간의 여백 포함)
    const needH = (ROWS * ROW_H + 0.6) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    camera.position.z = Math.max(6.0, needH);
    camera.updateProjectionMatrix();
  };

  const tick = () => {
    if (!dragging) driftX += 0.0016;          // 아주 느린 흐름
    curX += ((targetX + driftX) - curX) * 0.06;

    // 벽을 무한히 이어 붙인다 — 끝에 다다르면 반대편에서 이어진다
    const shift = ((curX % loopW) + loopW) % loopW;
    wall.position.x = -shift;

    parX += (parTX - parX) * 0.05;
    parY += (parTY - parY) * 0.05;
    camera.position.x = parX;
    camera.position.y = parY;
    camera.lookAt(parX * 0.35, parY * 0.35, 0);

    // 마우스가 얹힌 재킷만 벽에서 살짝 떠오른다
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(tiles.map((t) => t.mesh), false)[0];
    const next = (hit?.object as THREE.Mesh) || null;
    if (next !== hovered) {
      hovered = next;
      renderer.domElement.style.cursor = hovered ? 'pointer' : 'grab';
      host.dispatchEvent(new CustomEvent('wall:hover', { detail: hovered?.userData?.item ?? null }));
    }

    for (const t of tiles) {
      const mat = t.mesh.userData.faceMat as THREE.MeshStandardMaterial;
      if (t.mesh.userData.ready) mat.opacity += (1 - mat.opacity) * 0.08;
      const lift = t.mesh === hovered ? 0.34 : 0;
      t.mesh.position.z += (lift - t.mesh.position.z) * 0.16;
      const s = t.mesh === hovered ? 1.045 : 1;
      t.mesh.scale.x += (s - t.mesh.scale.x) * 0.16;
      t.mesh.scale.y = t.mesh.scale.x;
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
      tiles.forEach((t) => {
        const mat = t.mesh.userData.faceMat as THREE.MeshStandardMaterial;
        mat.map?.dispose(); mat.dispose();
      });
      tileGeo.dispose(); sideMat.dispose();
      shelfGeo.dispose(); shelfMat.dispose();
      backGeo.dispose(); backMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
