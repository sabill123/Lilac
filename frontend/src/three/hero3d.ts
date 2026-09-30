/** Three floating records, not a tiled backdrop. DOM owns typography and controls. */
import * as THREE from 'three';
import { createSceneLifecycle } from './lifecycle';
import type { SceneHandle } from './lifecycle';

export interface HeroItem {
  title: string;
  artist: string;
  artwork: string;
  href?: string;
}

const RECORD_COUNT = 3;
const RECORD_RADIUS = 1.18;

export function createHero3D(host: HTMLElement, items: HeroItem[]): SceneHandle | null {
  const artworkItems = items.filter(item => item.artwork).slice(0, RECORD_COUNT);
  if (!artworkItems.length) return null;

  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true }); }
  catch { host.dataset.scene3d = 'fallback'; return null; }
  let destroyed = false;
  let lifecycle: ReturnType<typeof createSceneLifecycle> | undefined;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  if (renderer.shadowMap) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  const canvas = renderer.domElement;
  canvas.style.cssText = 'width:100%;height:100%;display:block;cursor:default';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.visibility = 'hidden';
  canvas.style.touchAction = 'pan-y';
  host.dataset.scene3d = 'loading';
  host.appendChild(canvas);

  // Transparent canvas leaves typography in the accessible DOM, separate from the sculptures.
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x78766e, 2.2));
  const key = new THREE.DirectionalLight(0xfffaf0, 4.5);
  key.position.set(-3, 6, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -8; key.shadow.camera.right = 8;
  key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
  key.shadow.normalBias = 0.035;
  key.shadow.bias = -0.0002;
  key.shadow.radius = 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xd2dcff, 3.2);
  rim.position.set(6, 1, 4); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 1.2);
  fill.position.set(-5, -3, 2); scene.add(fill);

  const composition = new THREE.Group();
  composition.name = 'three-record-composition';
  scene.add(composition);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const geometry = <T extends THREE.BufferGeometry>(value: T): T => { geometries.push(value); return value; };
  const material = <T extends THREE.Material>(value: T): T => { materials.push(value); return value; };

  // Bevelled solid vinyl with a real spindle hole, plus fine concentric cut grooves.
  const shape = new THREE.Shape();
  shape.absarc(0, 0, RECORD_RADIUS, 0, Math.PI * 2, false);
  const hole = new THREE.Path(); hole.absarc(0, 0, 0.045, 0, Math.PI * 2, true); shape.holes.push(hole);
  const vinylGeometry = geometry(new THREE.ExtrudeGeometry(shape, {
    depth: 0.055, bevelEnabled: true, bevelSegments: 2, steps: 1,
    bevelSize: 0.008, bevelThickness: 0.008, curveSegments: 96,
  }));
  const vinylMaterial = material(new THREE.MeshPhysicalMaterial({
    color: 0x111419, metalness: 0.62, roughness: 0.24, clearcoat: 0.9, clearcoatRoughness: 0.18,
  }));
  const groovePoints: number[] = [];
  for (let ring = 0; ring < 44; ring++) {
    const radius = 0.44 + ring * 0.016;
    for (let segment = 0; segment < 128; segment++) {
      const a = segment / 128 * Math.PI * 2, b = (segment + 1) / 128 * Math.PI * 2;
      groovePoints.push(Math.cos(a) * radius, Math.sin(a) * radius, 0.065, Math.cos(b) * radius, Math.sin(b) * radius, 0.065);
    }
  }
  const grooveGeometry = geometry(new THREE.BufferGeometry());
  grooveGeometry.setAttribute('position', new THREE.Float32BufferAttribute(groovePoints, 3));
  const grooveMaterial = material(new THREE.LineBasicMaterial({ color: 0xa4a9b2, transparent: true, opacity: 0.045 }));
  // Actual shallow-cut surface normals catch the key/rim light as the vinyl tilts.
  // One shared annulus, not 88 individual meshes or a painted radial highlight.
  const cutGeometry = geometry(new THREE.RingGeometry(0.43, 1.15, 128, 88));
  const cutPosition = cutGeometry.getAttribute('position');
  for (let i = 0; i < cutPosition.count; i++) {
    const band = Math.floor(i / 129);
    cutPosition.setZ(i, 0.064 + (band % 2 ? 0.0018 : 0));
  }
  cutGeometry.computeVertexNormals();
  const cutMaterial = material(new THREE.MeshPhysicalMaterial({
    color: 0x15191e, metalness: 0.72, roughness: 0.27,
    clearcoat: 0.85, clearcoatRoughness: 0.2,
  }));
  const sleeveGeometry = geometry(new THREE.BoxGeometry(2.17, 2.17, 0.085));
  const paperMaterial = material(new THREE.MeshStandardMaterial({ color: 0xe7e3d9, roughness: 0.86 }));
  const labelGeometry = geometry(new THREE.RingGeometry(0.045, 0.38, 64));
  // RingGeometry's planar UVs crop the same artwork into the record's paper label.
  const labelUV = labelGeometry.getAttribute('uv');
  const labelPosition = labelGeometry.getAttribute('position');
  for (let i = 0; i < labelUV.count; i++) labelUV.setXY(i, labelPosition.getX(i) / 0.76 + 0.5, labelPosition.getY(i) / 0.76 + 0.5);

  // Texture-free soft grounding shadows. The key light also casts real object-on-object shadows.
  const shadowGeometry = geometry(new THREE.PlaneGeometry(3.7, 1.3));
  const shadowMaterial = material(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { opacity: { value: 0.13 } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec2 vUv; uniform float opacity; void main(){float d=length((vUv-.5)*2.0); float a=pow(max(0.0,1.0-d),2.8)*opacity; gl_FragColor=vec4(.16,.15,.13,a);}',
  }));

  interface Sculpture { group: THREE.Group; record: THREE.Group; sleeve: THREE.Mesh; shadow: THREE.Mesh; item: HeroItem; base: THREE.Vector3; tilt: THREE.Euler; scale: number; }
  const sculptures: Sculpture[] = [];
  const pickable: THREE.Object3D[] = [];
  const faces = new Map<string, THREE.MeshStandardMaterial>();
  for (let i = 0; i < RECORD_COUNT; i++) {
    const item = artworkItems[i % artworkItems.length];
    const url = item.artwork.replace(/\/\d+x\d+bb\./, '/600x600bb.');
    let face = faces.get(url);
    if (!face) {
      face = material(new THREE.MeshStandardMaterial({ color: 0xf0ece2, roughness: 0.65, metalness: 0.02 }));
      faces.set(url, face);
    }
    const group = new THREE.Group(); group.name = `record-sculpture-${i}`;
    // A partially withdrawn record stays a coherent pair rather than becoming loose tiles.
    const sleeve = new THREE.Mesh(sleeveGeometry, [paperMaterial, paperMaterial, paperMaterial, paperMaterial, face, paperMaterial]);
    sleeve.name = 'artwork-sleeve';
    sleeve.position.set(-0.4, -0.14, -0.13); sleeve.rotation.z = -0.065;
    sleeve.castShadow = true; sleeve.receiveShadow = true;
    group.add(sleeve);
    const record = new THREE.Group(); record.name = 'vinyl-record'; record.position.set(0.4, 0.13, 0.02);
    const vinyl = new THREE.Mesh(vinylGeometry, vinylMaterial);
    vinyl.castShadow = true; vinyl.receiveShadow = true;
    const grooves = new THREE.LineSegments(grooveGeometry, grooveMaterial);
    const label = new THREE.Mesh(labelGeometry, face); label.position.z = 0.068;
    const cuts = new THREE.Mesh(cutGeometry, cutMaterial); cuts.name = 'physical-groove-surface';
    cuts.receiveShadow = true;
    record.add(vinyl, cuts, grooves, label); group.add(record);
    for (const mesh of [sleeve, vinyl, label]) { mesh.userData.item = item; pickable.push(mesh); }
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial); shadow.position.z = -1.2;
    composition.add(shadow, group);
    sculptures.push({ group, record, sleeve, shadow, item, base: new THREE.Vector3(), tilt: new THREE.Euler(), scale: 1 });
  }

  const selectionHost = host as HTMLElement & { __selectHero?: (index: number) => void };
  let selected = 0, hoveredIndex = -1, entranceTime = 0, entranceDone = false, posePending = true, wasMoving = true;
  let parX = 0, parY = 0, targetX = 0, targetY = 0;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered: HeroItem | null = null;
  const setHover = (item: HeroItem | null) => {
    if (item === hovered) return;
    hovered = item;
    hoveredIndex = item ? sculptures.findIndex(sculpture => sculpture.item === item) : -1;
    canvas.style.cursor = item?.href ? 'pointer' : 'default';
    host.dispatchEvent(new CustomEvent('wall:hover', { detail: item }));
  };
  const pick = (event: MouseEvent): HeroItem | null => {
    if (canvas.style.visibility === 'hidden' || destroyed) return null;
    const rect = host.getBoundingClientRect();
    ndc.set((event.clientX - rect.left) / Math.max(1, rect.width) * 2 - 1, -(event.clientY - rect.top) / Math.max(1, rect.height) * 2 + 1);
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(pickable, false)[0]?.object.userData.item ?? null;
  };
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    setHover(pick(event));
    if (!lifecycle?.isMoving()) return;
    targetX = ndc.x * 0.16; targetY = ndc.y * 0.12;
  };
  const onLeave = () => { targetX = 0; targetY = 0; setHover(null); };
  const onClick = (event: MouseEvent) => {
    // Re-raycast at the click, never navigate using a stale hover or a moving object's old position.
    const href = pick(event)?.href;
    if (typeof href === 'string' && (href.startsWith('#/') || (href.startsWith('/') && !href.startsWith('//')))) location.hash = href;
  };
  canvas.addEventListener('pointermove', onPointerMove, { passive: true });
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('click', onClick);

  const frameLayout = () => {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    camera.aspect = w / h;
    const mobile = w <= 600;
    const viewHeight = mobile ? Math.max(8.4, 7.4 / camera.aspect) : 7.6;
    const viewWidth = viewHeight * camera.aspect;
    camera.position.set(0, 0, viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
    camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
    const centered = host.dataset.heroLayout === 'center';
    // Home reserves the left 40% for DOM copy. Center is opt-in for About.
    const fit = mobile ? 1 : Math.min(1, viewWidth / (centered ? 10 : 16));
    const origin = mobile || centered ? 0 : viewWidth * 0.22;
    const layouts = mobile
      ? [[0.15, -0.65, 0.65, 1.55, -0.18, -0.30, -0.18], [-1.85, 2.15, -1, 0.78, 0.22, 0.42, 0.28], [2.05, 2.55, -1.4, 0.70, -0.3, -0.4, -0.32]]
      : [[0, -0.35, 0.85, 1.65, -0.16, -0.32, -0.18], [-2.1, 1.75, -1.1, 0.82, 0.3, 0.42, 0.30], [2.65, 1.55, -1.55, 0.80, -0.25, -0.46, -0.28]];
    sculptures.forEach((sculpture, i) => {
      const slot = (i - selected + RECORD_COUNT) % RECORD_COUNT;
      const [x, y, z, scale, rx, ry, rz] = layouts[slot];
      sculpture.base.set(origin + x * fit, y * fit, z * fit);
      sculpture.tilt.set(rx, ry, rz); sculpture.scale = scale * fit;
    });
  };
  const applyPose = (elapsed: number, delta: number, moving: boolean, snap = false) => {
    const blend = snap ? 1 : 1 - Math.exp(-delta * 5.4);
    sculptures.forEach((sculpture, i) => {
      const active = i === selected;
      const slot = (i - selected + RECORD_COUNT) % RECORD_COUNT;
      const phase = elapsed * 0.36 + i * 2.1;
      const hover = moving && hoveredIndex === i ? 1 : 0;
      const reveal = entranceDone ? 1 : THREE.MathUtils.smoothstep(entranceTime - slot * 0.16, 0, 1.35);
      const lift = (1 - reveal) * (active ? 2.2 : 1.4);
      const bob = moving ? Math.sin(phase) * 0.075 : 0;
      const damp = (from: number, to: number) => from + (to - from) * blend;
      const { group, record, sleeve, shadow, base, tilt } = sculpture;
      group.position.set(damp(group.position.x, base.x + (1 - reveal) * (slot === 1 ? -0.8 : 0.6)),
        damp(group.position.y, base.y - lift + bob + hover * 0.15),
        damp(group.position.z, base.z - (1 - reveal) * 1.5 + hover * 0.25));
      group.rotation.set(damp(group.rotation.x, tilt.x + (moving ? Math.sin(phase * 0.7) * 0.05 : 0) - hover * 0.06),
        damp(group.rotation.y, tilt.y + (moving ? Math.sin(phase * 0.85) * 0.08 : 0) + (1 - reveal) * 0.65 - hover * 0.12),
        damp(group.rotation.z, tilt.z + (1 - reveal) * (slot === 1 ? 0.24 : -0.22)));
      group.scale.setScalar(damp(group.scale.x, sculpture.scale * (1 + hover * 0.025)));
      // The selected sleeve opens into the foreground while the other pairs tuck away.
      record.position.x = damp(record.position.x, (active ? 0.66 : 0.18) + hover * 0.12 - (1 - reveal) * 0.36);
      record.position.y = damp(record.position.y, active ? 0.20 : 0.08);
      record.position.z = damp(record.position.z, active ? 0.20 : 0.02);
      record.rotation.y = damp(record.rotation.y, active ? -0.09 : 0.04);
      record.rotation.z = damp(record.rotation.z, (active ? 0.16 : -0.10) + elapsed * (i === 1 ? -0.022 : 0.018));
      sleeve.position.x = damp(sleeve.position.x, active ? -0.48 : -0.28);
      sleeve.rotation.z = damp(sleeve.rotation.z, active ? -0.12 : 0.015);
      shadow.position.set(group.position.x, base.y - sculpture.scale * 1.7, -1.8);
      shadow.scale.setScalar(sculpture.scale * (0.85 + reveal * 0.15));
    });
    posePending = false;
  };
  const resize = () => {
    renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight), false);
    frameLayout();
    // Resize must fit even a paused scene; it is not an animation restart.
    applyPose(0, 0, false, true);
    posePending = true;
  };
  const selectHero = (index: number) => {
    if (destroyed || !Number.isInteger(index) || index < 0 || index >= artworkItems.length || index === selected) return;
    selected = index; host.dataset.heroSelected = String(index);
    setHover(null); frameLayout(); posePending = true;
    // Selection is content state, not optional animation. Commit immediately when paused/reduced.
    if (!lifecycle?.isMoving()) {
      entranceDone = true; applyPose(0, 0, false, true);
    }
    lifecycle?.invalidate();
  };
  selectionHost.__selectHero = selectHero;
  host.dataset.heroSelected = '0';
  const tick = (elapsed: number, delta: number, moving: boolean) => {
    if (moving) {
      if (host.dataset.scene3d === 'ready') entranceTime += delta;
      if (entranceTime >= 1.8) entranceDone = true;
      const blend = 1 - Math.exp(-delta * 3);
      parX += (targetX - parX) * blend; parY += (targetY - parY) * blend;
      composition.rotation.set(-parY * 0.3, parX * 0.3, 0);
      applyPose(elapsed, delta, true);
    } else if (posePending || !entranceDone || wasMoving) {
      entranceDone = true; applyPose(elapsed, 0, false, true);
    }
    wasMoving = moving;
    renderer.render(scene, camera);
  };
  lifecycle = createSceneLifecycle(host, tick, resize);
  const onContextLost = (event: Event) => { event.preventDefault(); destroy(); host.dataset.scene3d = 'fallback'; };
  canvas.addEventListener('webglcontextlost', onContextLost);

  // Build the complete deduplicated request set before starting loads. Synchronous failures
  // cannot confuse "all failed" with "first failed"; cancelled late successes release textures.
  const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
  let failedTextures = 0;
  faces.forEach((face, url) => loader.load(url, tex => {
    if (destroyed) { tex.dispose(); return; }
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    face.map = tex; face.color.set(0xffffff); face.needsUpdate = true;
    canvas.style.visibility = '';
    host.dataset.scene3d = 'ready';
    lifecycle?.invalidate();
  }, undefined, () => {
    if (destroyed) return;
    failedTextures++;
    if (failedTextures === faces.size) { destroy(); host.dataset.scene3d = 'fallback'; }
    else lifecycle?.invalidate();
  }));

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    lifecycle?.destroy();
    if (selectionHost.__selectHero === selectHero) delete selectionHost.__selectHero;
    delete host.dataset.heroSelected;
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('click', onClick);
    setHover(null);
    faces.forEach(face => face.map?.dispose());
    geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose());
    key.shadow.dispose();
    renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    delete host.dataset.scene3d;
  }
  return { destroy, setPaused: paused => { targetX = 0; targetY = 0; if (paused) posePending = true; lifecycle?.setPaused(paused); } };
}
