/* ============================================================
   마케팅·법무 레이어 — 지연 로드되는 무거운 쪽.

   main.ts 는 이 모듈을 동적 import 한다. 여기서 site.css 와 법무
   마크다운, 랜딩 섹션이 전부 딸려오므로 앱 본체 번들에서 분리된다.
   라우트 판별 자체는 ./routes 가 맡는다(정적, 가벼움).
   ============================================================ */

import './site-layer.css';
import { SITE_TITLES, type SiteRoute } from './routes';
import { renderSiteShell } from './shell';
import { landingHtml, mountLanding } from './pages/landing';
import { faqHtml, mountFaq, faqJsonLd } from './pages/faq';
import { pricingHtml, mountPricing } from './pages/pricing';
import { contactHtml, mountContact } from './pages/contact';
import { legalHtml, mountLegal, type LegalKey } from './pages/legal';
import { notFoundHtml } from './pages/notfound';
import { bindSiteMotion } from './motion';
import { applySeo, clearSeo } from './seo';
import { runCleanup } from './lifecycle';

export { setSiteMode, isSiteRoute } from './routes';
export type { SiteRoute };

/** 앱 라우트로 돌아갈 때 마케팅 메타와 전역 리스너를 걷어낸다 */
export function leaveSite() {
  runCleanup();
  clearSeo();
}

export function renderSitePage(route: SiteRoute) {
  // 이전 페이지가 window/document 에 건 것과 옵저버를 먼저 정리한다.
  // 이게 없으면 라우트를 오갈 때마다 resize·scroll·keydown 가 누적된다.
  runCleanup();
  const page = renderSiteShell(route, bodyFor(route));

  switch (route) {
    case 'about':
      mountLanding(page);
      break;
    case 'pricing':
      mountPricing(page);
      break;
    case 'faq':
      mountFaq(page);
      break;
    case 'contact':
      mountContact(page);
      break;
    default:
      bindSiteMotion(page);
      mountLegal(page);
  }

  applySeo(route, route === 'faq' ? faqJsonLd() : undefined);

  // 라우트 전환 시 항상 문서 최상단부터 보여준다
  window.scrollTo({ top: 0, behavior: 'auto' });

  /* 접근성 — SPA 라우트 전환은 문서 이동이 아니라 스크린리더가 바뀐 것을 모른다.
     새 본문으로 포커스를 옮기고 이동 사실을 알린다. */
  page.focus({ preventScroll: true });
  const live = document.getElementById('srAnnounce');
  if (live) live.textContent = `${SITE_TITLES[route]} 페이지로 이동했습니다`;
}

/** 알 수 없는 하위 경로(예: #/terms/foo)를 위한 404 — 마케팅 셸은 유지한다 */
export function renderSiteNotFound(path: string) {
  runCleanup();
  const page = renderSiteShell('about', notFoundHtml(path));
  bindSiteMotion(page);
  document.title = '페이지를 찾을 수 없습니다 · Lilac';
  window.scrollTo({ top: 0, behavior: 'auto' });
  page.focus({ preventScroll: true });
}

function bodyFor(route: SiteRoute): string {
  switch (route) {
    case 'about':
      return landingHtml();
    case 'pricing':
      return pricingHtml();
    case 'faq':
      return faqHtml();
    case 'contact':
      return contactHtml();
    default:
      return legalHtml(route as LegalKey);
  }
}
