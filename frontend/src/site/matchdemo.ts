/* ============================================================
   표기 매칭 데모 — 원본 demo-section.tsx 자리를 대체한다.

   원본은 /videos/demo.mp4 를 재생하고 전체화면 버튼을 얹는다.
   라일락에는 그런 녹화 자산이 없다. 대신 제품의 핵심 주장을
   화면에서 실제로 실행해 보인다.

   "한글로 쳐도 일본 곡이 잡힌다"를 말로 쓰는 대신,
   한글 음차를 한 글자씩 타이핑해 실제 카탈로그 API에 질의하고
   돌아온 진짜 결과(아트워크·원표기·곡명)를 보여준다.
   백엔드가 한글→가타카나 변환 후 질의하는 경로를 그대로 탄다.

   원본에서 유지한 것: 섹션 배치, 리빌 진입, 라운드 프레임 +
   ring/shadow 표면 처리, 좌하단 캡션 오버레이의 무게감.
   ============================================================ */

import { findCatalog, artUrl, esc, type CatalogTrack } from '../api';
import { observe, onCleanup } from './lifecycle';

/** 한글 음차 → 실제 일본 아티스트. 전부 카탈로그에서 확인된 조합만 넣는다. */
const CASES = [
  { typed: '요아소비', note: '가타카나 표기' },
  { typed: '요네즈 켄시', note: '한자 표기' },
  { typed: '히게단', note: '줄임말 → 정식명' },
  { typed: '츠유', note: '가타카나 표기' },
  { typed: '스피츠', note: '가타카나 표기' },
];

const TYPE_MS = 110;
const HOLD_MS = 2600;

export function matchDemoHtml(): string {
  return `
  <section class="site-section" id="demo" aria-label="표기 매칭 데모">
    <div class="site-shell">
      <div class="reveal-up">
        <h2 class="site-h3 heading-ko" style="margin-bottom:1rem;color:#fff">
          한글로 쳐도 <span class="accent-text">일본 곡이 잡힙니다.</span>
        </h2>
        <p class="site-lede" style="margin-bottom:2.5rem">
          아래는 설명이 아니라 실제 동작입니다. 입력한 한글 음차를 그대로 카탈로그에 질의한 결과입니다.
        </p>
      </div>

      <div class="reveal-up" data-delay="120">
        <div class="demo-shell" data-match-demo>
          <div class="demo-bar">
            <span class="demo-dots"><i></i><i></i><i></i></span>
            <span class="demo-url">lilac · 통합 검색</span>
          </div>

          <div class="demo-body">
            <div class="demo-input">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3" fill="none"/></svg>
              <span class="demo-typed" data-typed></span><span class="demo-caret" aria-hidden="true"></span>
            </div>

            <div class="demo-result" data-result aria-live="polite">
              <div class="demo-skel"><span></span><span></span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

export function mountMatchDemo(root: ParentNode) {
  const host = root.querySelector<HTMLElement>('[data-match-demo]');
  const typedEl = root.querySelector<HTMLElement>('[data-typed]');
  const resultEl = root.querySelector<HTMLElement>('[data-result]');
  if (!host || !typedEl || !resultEl) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let stopped = false;
  let idx = 0;

  // 화면 밖이면 루프를 돌리지 않는다 (보이지도 않는 애니메이션에 API를 쓰지 않는다)
  let visible = false;
  const io = observe(
    new IntersectionObserver(
      (entries) => entries.forEach((en) => { visible = en.isIntersecting; }),
      { threshold: 0.15 },
    ),
  );
  io.observe(host);

  // 라우트가 바뀌면 타이핑 루프를 끊는다.
  // 이걸 안 하면 사라진 노드를 보며 카탈로그 API 를 계속 부른다.
  onCleanup(() => { stopped = true; });

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  function paint(hit: CatalogTrack | null, caseNote: string) {
    if (!hit) {
      resultEl!.innerHTML = `<p class="demo-empty">결과 없음</p>`;
      return;
    }
    resultEl!.innerHTML = `
      <div class="demo-hit">
        <img src="${esc(artUrl(hit, 160))}" alt="" loading="lazy" />
        <div class="demo-hit-meta">
          <span class="demo-hit-tag">${esc(caseNote)}</span>
          <b>${esc(hit.artist)}</b>
          <i>${esc(hit.title)}</i>
        </div>
        <span class="demo-hit-ok" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
        </span>
      </div>`;
  }

  async function cycle() {
    while (!stopped) {
      if (!visible) { await sleep(500); continue; }

      const c = CASES[idx % CASES.length];
      idx++;

      // 타이핑
      typedEl!.textContent = '';
      resultEl!.innerHTML = `<div class="demo-skel"><span></span><span></span></div>`;
      if (reduce) {
        typedEl!.textContent = c.typed;
      } else {
        for (const ch of c.typed) {
          if (stopped) return;
          typedEl!.textContent += ch;
          await sleep(TYPE_MS);
        }
      }

      // 실제 질의
      const hit = await findCatalog(c.typed).catch(() => null);
      if (stopped) return;
      paint(hit, c.note);

      await sleep(reduce ? HOLD_MS * 2 : HOLD_MS);
    }
  }

  void cycle();
}
