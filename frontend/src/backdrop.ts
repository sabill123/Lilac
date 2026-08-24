/**
 * 도트 매트릭스 배경 (ThreeUI의 DotMatrixBackground 셰이더를 이식)
 *
 * 원본은 React + three.js 구현이라 번들이 700KB 넘게 늘어난다.
 * 배경 효과 하나에 그만한 비용을 낼 이유가 없어 같은 프래그먼트 셰이더를
 * 순수 WebGL로 다시 구현했다. (출처: MengTo/threeui, MIT)
 *
 * 동작 원칙
 *   - 화면에 안 보이거나 탭이 백그라운드면 렌더 루프를 멈춘다
 *   - 저사양/모션 최소화 설정에서는 아예 그리지 않는다
 *   - WebGL을 못 쓰면 조용히 포기한다 (배경이므로 없어도 무방)
 */

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform float uTime;
uniform vec2  uResolution;
uniform vec2  uMouse;
uniform float uGridScale;
uniform float uMouseAmount;
uniform float uPulseSpeed;
uniform float uRadius;
uniform float uOpacity;
uniform vec3  uColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.xy;
  float aspect = uResolution.x / uResolution.y;
  uv.x *= aspect;
  uv += uMouse * uMouseAmount;

  vec2 grid = fract(uv * uGridScale);
  vec2 id   = floor(uv * uGridScale);
  float dist = length(grid - vec2(0.5));

  float pulse  = sin(uTime * uPulseSpeed + id.x * 0.05 + id.y * 0.05) * 0.5 + 0.5;
  float radius = 0.08 + pulse * uRadius;
  float alpha  = smoothstep(radius, radius - 0.05, dist);

  vec2 center = vec2(0.5 * aspect, 0.5);
  float depthFade = smoothstep(1.2, 0.1, length(uv - center));

  gl_FragColor = vec4(uColor * pulse, alpha * depthFade * uOpacity);
}
`;

interface BackdropOptions {
  speed: number; gridScale: number; mouseAmount: number;
  pulseSpeed: number; radius: number; opacity: number;
  color: [number, number, number];
}

const DEFAULTS: BackdropOptions = {
  speed: 0.34,
  gridScale: 76,
  mouseAmount: 0.022,
  pulseSpeed: 0.2,
  radius: 0.1,
  opacity: 0.24,
  color: [0.655, 0.545, 0.98],   // 라일락 (#a78bfa)
};

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { gl.deleteShader(sh); return null; }
  return sh;
}

let started = false;

export function mountBackdrop(opts: Partial<BackdropOptions> = {}): void {
  if (started) return;
  const host = document.getElementById('backdrop');
  if (!host) return;

  // 모션 최소화를 켠 사용자에게는 움직이는 배경을 주지 않는다
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  // 좁은 화면·터치 기기는 배터리와 발열 부담이 커서 생략한다
  if (window.innerWidth <= 900 || navigator.maxTouchPoints > 0) return;

  const o = { ...DEFAULTS, ...opts };
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);

  const gl = (canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false })
    || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
  if (!gl) { host.remove(); return; }

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { host.remove(); return; }

  const prog = gl.createProgram();
  if (!prog) { host.remove(); return; }
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { host.remove(); return; }
  gl.useProgram(prog);

  // 화면 전체를 덮는 삼각형 2개
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const u = (n: string) => gl.getUniformLocation(prog, n);
  const uTime = u('uTime'), uRes = u('uResolution'), uMouse = u('uMouse');
  gl.uniform1f(u('uGridScale'), o.gridScale);
  gl.uniform1f(u('uMouseAmount'), o.mouseAmount);
  gl.uniform1f(u('uPulseSpeed'), o.pulseSpeed);
  gl.uniform1f(u('uRadius'), o.radius);
  gl.uniform1f(u('uOpacity'), o.opacity);
  gl.uniform3f(u('uColor'), o.color[0], o.color[1], o.color[2]);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
  };

  let mx = 0, my = 0, tx = 0, ty = 0, frame = 0, visible = true;
  const onPointer = (e: PointerEvent) => {
    tx = (e.clientX / window.innerWidth) * 2 - 1;
    ty = -((e.clientY / window.innerHeight) * 2 - 1);
  };

  const start = performance.now();
  const draw = (now: number) => {
    mx += (tx - mx) * 0.05; my += (ty - my) * 0.05;
    gl.uniform1f(uTime, (now - start) * 0.001 * o.speed);
    gl.uniform2f(uMouse, mx, my);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    frame = visible && !document.hidden ? requestAnimationFrame(draw) : 0;
  };

  const resume = () => { if (!frame && visible && !document.hidden) frame = requestAnimationFrame(draw); };
  new ResizeObserver(resize).observe(host);
  new IntersectionObserver(([e]) => {
    visible = e?.isIntersecting ?? true;
    if (visible) resume();
    else if (frame) { cancelAnimationFrame(frame); frame = 0; }
  }).observe(host);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && frame) { cancelAnimationFrame(frame); frame = 0; } else resume();
  });
  window.addEventListener('pointermove', onPointer, { passive: true });

  resize();
  started = true;
  frame = requestAnimationFrame(draw);
}
