/* ============================================================
   마케팅 라우트 테이블 — 코드 스플리팅 경계.

   왜 파일을 나눴나.
   앱 본체(#/, 차트, 스토어…)가 라일락의 주 진입점이다. 그런데 마케팅
   레이어는 랜딩 섹션 + 법무 마크다운 3종(약 38KB) + 전용 CSS까지 물고
   있어서, 한 덩어리로 묶으면 약관을 볼 일 없는 사용자까지 그 비용을
   내려받는다.

   그래서 "이 세그먼트가 마케팅 라우트인가?"를 판단하는 데 필요한
   최소한만 여기 두고(정적 임포트), 실제 렌더링 모듈은 main.ts 가
   동적 import 로 가져온다. 이 파일은 CSS도 무거운 모듈도 임포트하지
   않는다 — 그러면 스플리팅이 깨진다.
   ============================================================ */

export const SITE_ROUTES = ['about', 'pricing', 'faq', 'terms', 'privacy', 'subprocessors', 'contact'] as const;
export type SiteRoute = (typeof SITE_ROUTES)[number];

export const SITE_TITLES: Record<SiteRoute, string> = {
  about: '서비스 소개',
  pricing: '요금제',
  faq: '자주 묻는 질문',
  terms: '서비스 이용약관',
  privacy: '개인정보 처리방침',
  subprocessors: '개인정보 처리위탁 현황',
  contact: '도입·제휴 문의',
};

const SET = new Set<string>(SITE_ROUTES);

export function isSiteRoute(seg: string): seg is SiteRoute {
  return SET.has(seg);
}

/** 사이트 모드 진입/이탈 — 앱 크롬 표시 여부를 클래스로 제어.
 *  앱은 html/body 를 100vh 로 고정해 .main-panel 안에서 스크롤하므로
 *  루트에도 같은 클래스를 걸어 문서 스크롤 잠금을 푼다. */
export function setSiteMode(on: boolean) {
  document.body.classList.toggle('site-mode', on);
  document.documentElement.classList.toggle('site-mode', on);
  if (!on) {
    const host = document.getElementById('siteRoot');
    if (host) host.innerHTML = '';
    document.body.style.overflow = '';
  }
}
