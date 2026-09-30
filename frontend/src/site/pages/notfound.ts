/* ============================================================
   404 — 마케팅 셸 안에서의 없는 주소.

   앱 본체에도 page404()가 있지만 그건 앱 크롬(사이드바·플레이어)
   안에서 렌더된다. 마케팅 구역에서 잘못된 주소를 만났을 때 앱 레이아웃으로
   튕기면 맥락이 끊기므로, 셸을 유지한 채 안내한다.
   ============================================================ */

import { esc } from '../../api';

export function notFoundHtml(path: string): string {
  return `
  <section class="site-shell notfound">
    <div class="reveal-up">
      <p class="notfound-code">404</p>
      <h1 class="site-h2 heading-ko">
        <span>이 주소에는</span>
        <span class="muted-text">아무것도 없습니다.</span>
      </h1>
      <p class="site-lede" style="margin-top:1rem">
        요청하신 경로 <code>${esc(path)}</code> 를 찾지 못했습니다.
        주소가 바뀌었거나 잘못 입력되었을 수 있습니다.
      </p>
      <div class="notfound-links">
        <a class="pill-cta" href="#/about">
          <span>서비스 소개로</span>
          <span class="arrow" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M17 7H8M17 7V16"/></svg>
          </span>
        </a>
        <a class="btn btn-outline" href="#/">앱 열기</a>
        <a class="btn btn-outline" href="#/faq">자주 묻는 질문</a>
      </div>
    </div>
  </section>`;
}
