/* ============================================================
   마케팅 셸 — 원본 app/(marketing)/layout.tsx + landing-nav.tsx
   + landing-footer.tsx 이식.

   원본은 라우트 그룹으로 (app) 레이아웃과 분리돼 있다. 라일락은 단일
   SPA라 body.site-mode 로 앱 크롬(사이드바·톱바·플레이어)을 숨기고
   #siteRoot 를 대신 띄우는 방식으로 같은 분리를 만든다.
   ============================================================ */

import { brand } from './config';
import { SITE_TITLES, type SiteRoute } from './routes';
import { listen } from './lifecycle';

const NAV_LINKS: { href: string; label: string; route: SiteRoute }[] = [
  { href: '#/about', label: '서비스 소개', route: 'about' },
  { href: '#/faq', label: '자주 묻는 질문', route: 'faq' },
  { href: '#/terms', label: '약관·정책', route: 'terms' },
];

/** 약관 계열 3문서는 네비상 한 항목으로 묶어 표시한다 */
const isLegal = (r: SiteRoute) => r === 'terms' || r === 'privacy' || r === 'subprocessors';
const navActive = (link: SiteRoute, current: SiteRoute) =>
  link === current || (link === 'terms' && isLegal(current));

function navHtml(current: SiteRoute): string {
  return `
  <nav class="site-nav" aria-label="주 메뉴">
    <div class="site-nav-inner">
      <a class="site-nav-brand" href="#/about" aria-label="Lilac">
        <span class="mark" aria-hidden="true"></span>Lilac
      </a>
      <div class="site-nav-actions">
        <div class="site-nav-links">
          ${NAV_LINKS.map(
            (l) =>
              `<a href="${l.href}"${navActive(l.route, current) ? ' aria-current="page"' : ''}>${l.label}</a>`,
          ).join('')}
        </div>
        <a class="btn btn-ghost site-nav-contact" href="#/contact">제휴 문의</a>
        <a class="btn btn-primary site-nav-app" href="#/">Lilac 홈</a>

        <!-- 모바일 토글 — 900px 미만에서 링크가 전부 숨겨져 진입이 막힐던 구간을 메운다 -->
        <button type="button" class="site-nav-toggle" data-nav-toggle
          aria-label="메뉴 열기" aria-expanded="false" aria-controls="siteNavDrawer">
          <span class="bars" aria-hidden="true"><i></i><i></i></span>
        </button>
      </div>
    </div>

    <div class="site-drawer" id="siteNavDrawer" data-nav-drawer hidden>
      <nav class="site-drawer-links" aria-label="모바일 메뉴">
        ${NAV_LINKS.map(
          (l) =>
            `<a href="${l.href}"${navActive(l.route, current) ? ' aria-current="page"' : ''}>${l.label}</a>`,
        ).join('')}
        <a href="#/privacy"${current === 'privacy' ? ' aria-current="page"' : ''}>개인정보 처리방침</a>
        <a href="#/contact"${current === 'contact' ? ' aria-current="page"' : ''}>제휴 문의</a>
        <a href="#/">앱 열기</a>
      </nav>
    </div>
  </nav>`;
}

function footerHtml(): string {
  const { company, site } = brand;
  const year = new Date().getFullYear();
  return `
  <footer class="site-footer">
    <div class="site-footer-inner">
      <div class="site-footer-top">
        <div class="site-footer-brand">
          <b>Lilac</b>
          <p>${site.description}</p>
        </div>
        <nav class="site-footer-nav" aria-label="사이트 정보">
          <a href="#/about">서비스 소개</a>
          <span class="sep" aria-hidden="true">|</span>
          <a href="#/faq">자주 묻는 질문</a>
          <span class="sep" aria-hidden="true">|</span>
          <a href="#/terms">이용약관</a>
          <span class="sep" aria-hidden="true">|</span>
          <a href="#/privacy">개인정보 처리방침</a>
          <span class="sep" aria-hidden="true">|</span>
          <a href="#/subprocessors">처리위탁 현황</a><a href="#/contact">제휴 문의</a>
        </nav>
      </div>

      <div class="site-footer-legal">
        <p>
          <strong>${company.legalName}</strong>
          <span class="sep" aria-hidden="true">|</span>대표 ${company.ceo}
          <span class="sep" aria-hidden="true">|</span>사업자등록번호 ${company.bizNo}
        </p>
        <p>주소: ${company.address}</p>
        <p>고객문의: <a href="mailto:${company.supportEmail}">${company.supportEmail}</a></p>
        <p style="padding-top:0.5rem">&copy; ${year} ${site.copyrightHolder}. All rights reserved.</p>
        <p>미리듣기는 Apple Music 카탈로그 30초 프리뷰, MV는 YouTube 공식 임베드로 재생됩니다. 상품·일정 데이터는 데모입니다.</p>
      </div>
    </div>
  </footer>`;
}

/** 페이지 본문을 마케팅 셸로 감싸 #siteRoot 에 렌더 */
export function renderSiteShell(route: SiteRoute, bodyHtml: string): HTMLElement {
  const host = document.getElementById('siteRoot')!;
  host.innerHTML = `
    <div class="site-root">
      <a class="site-skip" href="#sitePage" data-skip>본문으로 건너뛰기</a>
      ${navHtml(route)}
      <main class="site-main" id="sitePage" tabindex="-1">${bodyHtml}</main>
      ${footerHtml()}
    </div>`;
  document.title = `${SITE_TITLES[route]} · Lilac`;
  bindNavToggle(host);

  // 해시 라우터라 href="#sitePage" 를 그대로 두면 라우트가 깨진다. 직접 포커스를 옮긴다.
  host.querySelector<HTMLAnchorElement>('[data-skip]')?.addEventListener('click', (e) => {
    e.preventDefault();
    const main = host.querySelector<HTMLElement>('#sitePage');
    main?.focus();
    main?.scrollIntoView({ block: 'start' });
  });

  return host.querySelector<HTMLElement>('#sitePage')!;
}

function bindNavToggle(host: HTMLElement) {
  const btn = host.querySelector<HTMLButtonElement>('[data-nav-toggle]');
  const drawer = host.querySelector<HTMLElement>('[data-nav-drawer]');
  if (!btn || !drawer) return;

  const setOpen = (open: boolean) => {
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
    drawer.hidden = !open;
    // hidden 을 벗긴 다음 프레임에 열림 클래스를 붙여야 전환이 생긴다
    if (open) requestAnimationFrame(() => drawer.classList.add('open'));
    else drawer.classList.remove('open');
  };

  btn.addEventListener('click', () => setOpen(drawer.hidden));
  // 링크를 누르면 닫는다 (해시 라우터라 페이지가 재렌더되지만, 같은 라우트 클릭은 안 된다)
  drawer.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a')) setOpen(false);
  });
  // document 에 거는 것은 셸이 교체돼도 남는다 — 해제를 예약한다
  listen(document, 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape' && !drawer.hidden) { setOpen(false); btn.focus(); }
  });
}
