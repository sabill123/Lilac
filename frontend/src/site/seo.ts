/* ============================================================
   SEO — 원본 lib/seo.ts + 각 page.tsx 의 `export const metadata`
   + (marketing)/page.tsx 의 JSON-LD 를 이식.

   Next.js는 메타데이터를 서버에서 문서에 박아준다. 라일락은 해시 라우터
   SPA라 그 자리가 없다. 라우트가 바뀔 때마다 head의 태그를 직접
   갱신하는 방식으로 같은 결과를 만든다.

   ⚠️ 해시 라우팅 SPA라 크롤러가 라우트별 메타를 읽지 못할 수 있다.
   정식 도메인이 정해지고 SSR/프리렌더를 붙일 때 이 모듈의 값들을
   그대로 서버 메타로 옮기면 된다.
   ============================================================ */

import { brand } from './config';
import type { SiteRoute } from './routes';

const ORIGIN = `https://${brand.site.domain}`;

export const SEO = {
  siteName: 'Lilac',
  title: 'Lilac — 한국과 일본의 팬덤을 한 곳에서',
  description: brand.site.description,
  keywords: [
    'Lilac', '라일락', 'J-POP', 'K-POP', '제이팝', '케이팝',
    '일본 음악', '한일 차트', '일본반 구매', '해외 음반 직구', '크로스보더 팬덤',
  ],
} as const;

type Meta = { title: string; description: string; noindex?: boolean };

const ROUTE_META: Record<SiteRoute, Meta> = {
  about: {
    title: 'Lilac — 한국과 일본의 팬덤을 한 곳에서',
    description:
      '한글로 일본 곡을 찾고, 국가별 차트와 발매 일정을 확인하며, 음반·굿즈 정보와 예상 비용을 둘러보는 크로스보더 팬덤 데모.',
  },
  pricing: {
    title: '요금제 — Lilac Pass',
    description:
      '라일락은 상품값에 마진을 얹지 않습니다. 중개 수수료로 운영하고, 멤버십은 그 수수료를 깎아 돌려줍니다.',
  },
  faq: {
    title: '자주 묻는 질문 — Lilac',
    description:
      '검색·미리듣기·환율·배송·계정까지, 라일락 이용 중 자주 나오는 질문과 답변을 모았습니다.',
  },
  terms: {
    title: '서비스 이용약관 — Lilac',
    description: '라일락 서비스의 이용 조건과 회사·사용자의 권리·의무를 정한 약관입니다.',
  },
  privacy: {
    title: '개인정보 처리방침 — Lilac',
    description: '라일락이 처리하는 개인정보의 항목·목적·보유기간과 정보주체의 권리를 안내합니다.',
  },
  subprocessors: {
    title: '개인정보 처리위탁 현황 — Lilac',
    description: '라일락이 개인정보 처리를 위탁하거나 국외로 이전하는 사업자 현황입니다.',
  },
  contact: {
    title: '도입·제휴 문의 — Lilac',
    description: '한일 동시 활동 아티스트·레이블·유통사 대상 제휴 문의를 받습니다.',
    // 원본 contact/page.tsx 와 동일하게 색인에서 제외한다
    noindex: true,
  },
};

/** name= 또는 property= 메타 태그를 만들거나 갱신 */
function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function setLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
}

const LD_ID = 'lilac-jsonld';

/** 원본 (marketing)/page.tsx 의 jsonLd 3종 (Organization / WebSite / SoftwareApplication)
 *  + 라우트별 추가 스키마(FAQPage 등)를 받아 함께 붙인다. */
function setJsonLd(route: SiteRoute, extra?: object) {
  document.getElementById(LD_ID)?.remove();

  if (route !== 'about') {
    if (!extra) return;
    const only = document.createElement('script');
    only.id = LD_ID;
    only.type = 'application/ld+json';
    only.textContent = JSON.stringify(extra);
    document.head.appendChild(only);
    return;
  }

  const ld: object[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: SEO.siteName,
      url: `${ORIGIN}/`,
      description: SEO.description,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SEO.siteName,
      url: `${ORIGIN}/`,
      inLanguage: 'ko-KR',
      description: SEO.description,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: SEO.siteName,
      applicationCategory: 'EntertainmentApplication',
      operatingSystem: 'Web',
      url: `${ORIGIN}/`,
      description: SEO.description,
    },
  ];

  if (extra) ld.push(extra);

  const s = document.createElement('script');
  s.id = LD_ID;
  s.type = 'application/ld+json';
  s.textContent = JSON.stringify(ld);
  document.head.appendChild(s);
}

export function applySeo(route: SiteRoute, extraJsonLd?: object) {
  const m = ROUTE_META[route];
  document.title = m.title;

  setMeta('name', 'description', m.description);
  setMeta('name', 'keywords', SEO.keywords.join(', '));
  setMeta('name', 'robots', m.noindex ? 'noindex, follow' : 'index, follow');

  setMeta('property', 'og:type', 'website');
  setMeta('property', 'og:site_name', SEO.siteName);
  setMeta('property', 'og:title', m.title);
  setMeta('property', 'og:description', m.description);
  setMeta('property', 'og:url', `${ORIGIN}/#/${route}`);
  setMeta('property', 'og:locale', 'ko_KR');

  setMeta('name', 'twitter:card', 'summary_large_image');
  setMeta('name', 'twitter:title', m.title);
  setMeta('name', 'twitter:description', m.description);

  setLink('canonical', `${ORIGIN}/#/${route}`);
  setJsonLd(route, extraJsonLd);
}

/** 앱(비마케팅) 라우트로 돌아갈 때 마케팅 메타를 걷어낸다 */
export function clearSeo() {
  document.getElementById(LD_ID)?.remove();
  setMeta('name', 'robots', 'index, follow');
}
