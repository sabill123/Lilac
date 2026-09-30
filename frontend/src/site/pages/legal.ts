/* ============================================================
   법무 문서 페이지 — 원본 app/(marketing)/terms · privacy ·
   subprocessors + components/legal/legal-document.tsx 이식.

   원본은 서버에서 readLegalDoc()으로 마크다운을 읽어 react-markdown에
   넘긴다. 라일락은 Vite의 ?raw 임포트로 빌드 시 문자열을 인라인하고,
   자체 파서(md.ts)로 렌더한다. 결과 DOM 구조(.legal-content,
   .legal-table-wrap)는 원본과 같게 맞춰 CSS를 그대로 쓴다.
   ============================================================ */

import termsMd from '../content/legal/terms-of-service.md?raw';
import privacyMd from '../content/legal/privacy-policy.md?raw';
import subprocessorsMd from '../content/legal/subprocessors.md?raw';
import { renderMarkdown } from '../md';
import { brand } from '../config';
import { listen } from '../lifecycle';

/* ---- 단일 출처 치환 ----
   시행일·상호·연락처는 문서 3종에 걸쳐 10군데 넘게 나온다.
   그대로 박아두면 법인 설립·개정 때 반드시 한두 군데를 빼먹고,
   그게 하필 약관에서 발생한다. config.ts 한 곳만 고치면 전부 바뀜다.
   (미치환 토큰이 화면에 그대로 노출되는 걸 막기 위해 계약 테스트가 감시한다) */
const TOKENS: Record<string, string> = {
  effectiveDate: brand.legal.effectiveDate,
  updatedDate: brand.legal.updatedDate,
  legalName: brand.company.legalName,
  ceo: brand.company.ceo,
  bizNo: brand.company.bizNo,
  address: brand.company.address,
  supportEmail: brand.company.supportEmail,
  privacyOfficer: brand.company.privacyOfficer,
  domain: brand.site.domain,
};

function fillTokens(md: string): string {
  return md.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    key in TOKENS ? TOKENS[key] : whole,
  );
}

type LegalKey = 'terms' | 'privacy' | 'subprocessors';

const DOCS: Record<LegalKey, { title: string; lede: string; source: string }> = {
  terms: {
    title: '서비스 이용약관',
    lede: '라일락 서비스의 이용 조건과 회사·사용자의 권리·의무를 정합니다.',
    source: termsMd,
  },
  privacy: {
    title: '개인정보 처리방침',
    lede: '라일락이 어떤 개인정보를 어떤 목적으로 얼마나 보관하는지 안내합니다.',
    source: privacyMd,
  },
  subprocessors: {
    title: '개인정보 처리위탁 현황',
    lede: '개인정보 처리를 위탁하거나 국외로 이전하는 사업자 현황입니다.',
    source: subprocessorsMd,
  },
};

const TABS: { key: LegalKey; label: string }[] = [
  { key: 'terms', label: '이용약관' },
  { key: 'privacy', label: '개인정보 처리방침' },
  { key: 'subprocessors', label: '처리위탁 현황' },
];

/** 문서 본문의 h1 은 페이지 헤더가 대신하므로 제거한다(원본과 동일한 처리) */
function stripLeadingH1(md: string): string {
  return md.replace(/^#\s+.*\n+/, '');
}

/** 제목 텍스트 → 안정적인 앵커 id.
 *  한글이 대부분이라 slug화는 무의미하고, 조문 번호만 뜼면 문서간 충돌한다.
 *  문서 키 + 순번으로 고정한다. */
const anchorId = (key: LegalKey, i: number) => `${key}-s${i}`;

/** 렌더된 HTML 의 h2 에 id 를 주입하면서 목차 항목을 모은다 */
function withAnchors(html: string, key: LegalKey): { html: string; toc: { id: string; label: string }[] } {
  const toc: { id: string; label: string }[] = [];
  let i = 0;
  const out = html.replace(/<h2>([\s\S]*?)<\/h2>/g, (_m, inner: string) => {
    const id = anchorId(key, i++);
    const label = inner.replace(/<[^>]+>/g, '').trim();
    toc.push({ id, label });
    return `<h2 id="${id}">${inner}</h2>`;
  });
  return { html: out, toc };
}

export function legalHtml(key: LegalKey): string {
  const doc = DOCS[key];
  const { html, toc } = withAnchors(renderMarkdown(fillTokens(stripLeadingH1(doc.source))), key);

  return `
  <section class="legal-page">
    <header class="legal-head">
      <h1 class="heading-ko">${doc.title}</h1>
      <p>${doc.lede}</p>
      <nav class="legal-tabs" aria-label="법무 문서">
        ${TABS.map(
          (t) =>
            `<a href="#/${t.key}"${t.key === key ? ' aria-current="page"' : ''}>${t.label}</a>`,
        ).join('')}
      </nav>
    </header>

    <div class="legal-layout">
      ${
        toc.length > 2
          ? `<aside class="legal-toc" aria-label="목차">
        <p class="legal-toc-h">목차</p>
        <nav data-toc>
          ${toc.map((t) => `<a href="#${t.id}" data-toc-link="${t.id}">${t.label}</a>`).join('')}
        </nav>
      </aside>`
          : ''
      }
      <article class="legal-content" data-legal-body>${html}</article>
    </div>
  </section>`;
}

/** 목차 — 클릭 시 스무스 스크롤, 스크롤 시 현재 절을 강조.
 *  해시 라우터를 쓰므로 href="#id" 기본 동작은 라우트를 깨버린다. 직접 처리한다. */
export function mountLegal(root: HTMLElement) {
  const nav = root.querySelector<HTMLElement>('[data-toc]');
  if (!nav) return;
  const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>('[data-toc-link]'));
  const heads = links
    .map((a) => document.getElementById(a.dataset.tocLink!))
    .filter((el): el is HTMLElement => Boolean(el));

  nav.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('[data-toc-link]');
    if (!a) return;
    e.preventDefault(); // 해시 변경을 막아 라우터가 재렌더하지 않게 한다
    const target = document.getElementById(a.dataset.tocLink!);
    if (!target) return;
    const top = target.getBoundingClientRect().top + window.scrollY - 84; // sticky 네비 높이 보정
    window.scrollTo({ top, behavior: 'smooth' });
  });

  // 스크롤스파이 — 뷰포트 상단을 막 지난 절을 현재 항목으로 본다
  const spy = () => {
    const y = window.scrollY + 120;
    let cur = 0;
    heads.forEach((h, i) => {
      if (h.offsetTop <= y) cur = i;
    });
    links.forEach((a, i) => a.classList.toggle('on', i === cur));
  };
  spy();
  // window 에 건 스크롤스파이는 페이지를 떠나도 살아남는다.
  // 정리하지 않으면 약관 페이지를 볼 때마다 스크롤 핸들러가 하나씩 늘어
  // 스크롤 한 번에 죽은 핸들러가 전부 돌게 된다.
  listen(window, 'scroll', spy, { passive: true });
}

export type { LegalKey };
