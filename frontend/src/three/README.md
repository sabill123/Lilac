# Sculptural artwork enhancement

Public imports from `./three` remain `can3D`, `mountHero3D`, `mountChart3D`,
`disposeScene`, and `SceneHandle`. Existing mount signatures still return
`Promise<void>`. Scenes are single-active: mount replaces/cancels the previous
scene. Always call `disposeScene()` **before removing/replacing route markup**.
A mount waits for near-viewport intersection and idle time. Its promise settles
on mount attempt or cancellation, not on artwork download; do not await it before
rendering the page. Dynamic imports are checked again before scene creation.

## Container contract

- Provide a sized, positioned, clipped host. Keep normal artwork, titles, ranks,
  links and play controls in the DOM, independently usable without WebGL.
- The inserted canvas is decorative (`aria-hidden=true`) and is hidden until an
  artwork loads. `host.dataset.scene3d` is `loading`, `ready`, or `fallback`.
  Use `[data-scene3d="ready"]` to visually conceal an underlying fallback image
  if needed, without hiding accessible controls. Do not remove fallback content.
- Keep the enhancement inside its sized hero/chart stage, not a page-wide fixed backdrop.
- Existing `wall:hover` event detail is `HeroItem | null`. Hero pointer picking
  supports in-app routes (`#/…` or `/…`, excluding `//…`) only, via `location.hash`.
  Each click raycasts its own coordinates rather than using stale hover state. Picking
  also works while motion is paused. Touch scrolling is left to the page.
- Existing chart `host.__swapTop(item: Chart3DItem)` remains supported. It updates
  artwork **and** click action immediately; latest texture request wins. It is
  removed on destroy. With missing/failed artwork, the fallback remains visible.
- Canvas clicks are optional pointer shortcuts, never the only way to navigate
  or play. Supply ordinary keyboard-accessible DOM links/buttons alongside them.

## Accessible motion toggle

```ts
import { setSceneMotionPaused, isSceneMotionPaused } from './three';
// Toggle button meaning: "Pause artwork motion"; aria-pressed = user pause state.
button.setAttribute('aria-pressed', String(isSceneMotionPaused()));
button.addEventListener('click', () => {
  setSceneMotionPaused(!isSceneMotionPaused());
  button.setAttribute('aria-pressed', String(isSceneMotionPaused()));
});
```

User pause state persists across routes within the current page session, not
across reloads. `isSceneMotionPaused()` reports this user preference, not OS or
visibility state. Reduced motion always wins, including preference changes while
mounted. Paused/reduced scenes render only on lifecycle/resize/artwork/selection invalidation; there
is no continuous animation or pointer tilt. Offscreen, hidden, zero-size and
disconnected hosts do not render. Resume does not advance animation by hidden time.
Direct `createHero3D`/`createChart3D` handles also expose `setPaused(boolean)`.

## Budget and fallback

WebGL2 is probed once with `failIfMajorPerformanceCaveat`; the temporary probe
context is released. Data Saver skips the enhancement; reduced motion uses a
static scene instead of rejecting 3D. Renderer construction failures and context
loss fall back to DOM artwork. Lost contexts are disposed, not repeatedly retried.
Re-entering the route can try again. No device-memory/CPU/viewport guesswork gates
otherwise-capable devices.

Hero: exactly three coherent floating vinyl-and-sleeve sculptures, shared bevelled
vinyl geometry with a spindle hole, 44 delicate concentric groove lines per record,
a shared shallow-cut annular mesh whose sloping normals produce physical highlights,
clear-coated graphite vinyl, artwork paper labels and tactile sleeve edges. The
annulus has 128 angular by 88 radial segments and uses no additional texture requests. The first three items with artwork
are used; fewer items repeat without extra downloads. At most three normalized
artwork URLs, 600px iTunes requests, URL-level texture/material deduplication and
anonymous CORS. Lighting uses a warm key, cool rim and hemisphere fill, with a
single 1024px shadow map for object-on-object shadows and texture-free soft
contact shadows. No environment downloads, extra dependencies, particles, glow,
wall, shelves, grid, clones, drag carousel, or scroll interception.
Chart: one 600px artwork jacket and a contact shadow, unchanged. DPR is capped at
1.5 for both scenes.
All observers/listeners/frames/GPU resources are disposed; late texture callbacks
are ignored and their textures disposed. Three TextureLoader image requests
cannot be aborted, so already-started network downloads may finish after teardown.

## Hero framing and selection

- The default layout leaves approximately the **left 40% quiet for DOM featured
  copy**, with the selected vinyl-and-sleeve pair in front on the right and two
  smaller pairs receding behind it. Use a full-width, positioned/clipped stage
  with a warm off-white background; the canvas is transparent.
- At host widths **600px or less**, the cluster becomes a compact centered
  triangle, with two small pairs above the foreground pair. Aspect ratio alone
  does not switch desktop/tablet to mobile. Framing adapts to the host dimensions.
- For About or a text-free stage, set `host.dataset.heroLayout = 'center'`
  **before mounting**. It centers the selected record on desktop without changing
  the three-item identity or mobile layout. Runtime layout-attribute changes are
  picked up at the next resize or selection, not through a MutationObserver.
- Typography, featured metadata, numbered selectors, motion buttons and navigation
  remain DOM-owned. Use ordinary keyboard-accessible buttons to select a record;
  selection is separate from navigation. Canvas clicks still navigate the exact
  clicked artwork, including while paused, and never select via stale hover.
- Optional local host hook (no facade/import changes):

```ts
const stage = host as HTMLElement & { __selectHero?: (index: number) => void };
// After the lazy mount attempt, use the same first-three artwork-bearing items
// for the DOM controls. Keep the DOM functional if WebGL is unavailable.
stage.__selectHero?.(1);
```

  The integer index refers to the original first-three artwork-bearing input
  order, **not** the current visual depth order. Initial selection is 0. Invalid
  indices and repeated selection are no-ops. With fewer than three inputs the
  visible repeats retain the original item, without manufacturing extra source
  identities. `data-hero-selected` reports the accepted index while mounted.
  The hook and dataset field are removed on teardown; a retained hook is inert.
- Selection promotes that original pair to the front, extracts/turns its vinyl,
  opens the sleeve angle and tucks the previous pair into a smaller rear slot.
  The original item, material, texture and navigation identity never swap.
  Motion-enabled changes use frame-rate-independent exponential damping and can
  be interrupted by another selection. Paused/reduced-motion selection commits
  its transform immediately and invalidates one static frame. Pausing or enabling
  reduced motion during a transition settles the selected pose at the next frame.
- The entrance rises and unfolds in a short stagger only once artwork is ready.
  Paused/reduced-motion mounts skip the entrance. Thereafter there is restrained
  independent bob/tilt, slow vinyl rotation and pointer parallax; hover slightly
  lifts a pair and extracts its vinyl further. Paused picking/cursor/events remain
  active without pointer animation. No particles, glow, endless camera orbit,
  scroll listeners, scroll interception, pointer capture or extra animation loop.
- Direct contract remains
  `createHero3D(host: HTMLElement, items: HeroItem[]): SceneHandle | null`, where
  `HeroItem` has `title`, `artist`, `artwork`, and optional `href`. The facade
  mount contract, idle/intersection scheduling and Data Saver policy are unchanged.
- Canvas stays hidden/loading until artwork succeeds. All failed requests or
  context loss restore fallback; partial success stays ready. Missing artwork
  returns `null` without creating a renderer. Keep DOM fallback mounted and do
  not equate the resolved mount promise with artwork readiness.

## Verification

`node frontend/src/three/verify-three.mjs` executes actual TypeScript via the
repo-local TypeScript dependency, actual Three geometry/materials, and a mocked
DOM/GPU. It verifies scheduling, pause/reduced motion, visibility/intersection,
teardown, request races, texture deduplication, chart action swaps, context loss,
WebGL probing, Data Saver and pending mount cancellation. Hero-specific checks
add the exact three-sculpture/download budget, solid record/groove geometry,
transparent stage, real paused raycast picking, unsafe-link rejection, autonomous
rotation, mobile/desktop/center projection, entrance progression, physical groove
normals, hover extraction, stable source identities, paused/reduced selection,
interrupted damped transitions, selected-record navigation, invalid indices,
hook cleanup, partial/all failures and GPU resource disposal.
It is not a GPU visual
test. Run `npm run build` for full frontend typecheck/production bundling.
