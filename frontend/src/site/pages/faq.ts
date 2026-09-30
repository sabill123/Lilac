/* ============================================================
   FAQ — 원본 레포에는 대응 페이지가 없다. 원본이 쓰는 규약
   (헤어라인 구분선 · reveal-up 진입 · Base UI accordion 동작:
   한 번에 하나만 열림 · 화살표 180° 회전 · grid-template-rows 0fr→1fr
   높이 전환)을 그대로 따라 새로 만들었다.

   검색·카테고리 필터는 원본 support 콘솔의 필터 UX를 축약한 것이다.
   ============================================================ */

import { esc } from '../../api';
import { bindSiteMotion } from '../motion';

type Faq = { cat: string; q: string; a: string };

const CATS = [
  { id: 'all', label: '전체' },
  { id: 'service', label: '서비스' },
  { id: 'play', label: '재생·음원' },
  { id: 'store', label: '구매·배송' },
  { id: 'account', label: '계정·데이터' },
];

const FAQS: Faq[] = [
  {
    cat: 'service',
    q: '라일락은 어떤 서비스인가요?',
    a: '한국의 J-POP 팬과 일본의 K-POP 팬을 위한 크로스보더 팬덤 서비스입니다. 한글로 일본 곡을 검색하고, 국가를 전환해 한국·일본 차트를 확인하며, 음반·굿즈 정보와 예상 비용을 둘러보는 데모입니다. 실제 결제·배송은 제공하지 않습니다.',
  },
  {
    cat: 'service',
    q: '지금 어느 단계인가요? 정식 서비스인가요?',
    a: '데모 단계입니다. 탐색·차트·일정·스토어 화면과 데이터 파이프라인은 동작하지만, 실제 결제와 배송은 아직 연결되어 있지 않습니다. 상품·일정 데이터의 일부는 데모 값입니다.',
  },
  {
    cat: 'service',
    q: '"요아소비"처럼 한글로 검색해도 일본 아티스트가 나오나요?',
    a: '네. 한자·가나·로마자·한글 음차를 서로 변환하는 표기 사전을 자동으로 만들어 두었습니다. 어떤 표기로 입력해도 같은 아티스트로 모입니다. 새 아티스트가 데이터에 들어와도 사람이 사전을 손으로 채워 넣지 않습니다.',
  },
  {
    cat: 'service',
    q: '한국 차트와 일본 차트를 어떻게 비교하나요?',
    a: '차트 화면에서 한국 또는 일본을 선택한 뒤 제공자별 순위를 확인할 수 있습니다. 두 나라의 순위를 동시에 나란히 비교하거나 개인 취향에 맞춰 순위를 추천하는 기능은 현재 제공하지 않습니다.',
  },
  {
    cat: 'play',
    q: '전곡을 다 들을 수 있나요?',
    a: '아닙니다. 미리듣기는 Apple Music 공식 카탈로그의 30초 프리뷰이고, 뮤직비디오는 YouTube 공식 임베드로 재생됩니다. 라일락은 음원 파일을 직접 보관하거나 전송하지 않습니다.',
  },
  {
    cat: 'play',
    q: '어떤 곡은 미리듣기가 안 됩니다.',
    a: '해당 곡이 카탈로그에 없거나, 지역 제한이 걸려 있거나, 권리자가 프리뷰를 제공하지 않는 경우입니다. 재생 가능 여부는 각 제공자의 정책을 따르며 라일락이 임의로 열 수 없습니다.',
  },
  {
    cat: 'play',
    q: 'Apple Music 계정을 연결하면 뭐가 달라지나요?',
    a: '현재 데모는 Apple Music 카탈로그의 30초 프리뷰만 제공하며, 계정 연결을 통한 전곡 재생은 활성화되어 있지 않습니다. MusicKit은 연동용 기본 구조만 마련된 상태입니다. 전곡 재생에는 정식 서비스의 MusicKit 재생 연동, 서버에서 발급한 유효한 개발자 토큰, 사용자 인증과 활성 Apple Music 구독이 모두 필요합니다.',
  },
  {
    cat: 'store',
    q: '표시된 가격에 배송비와 수수료가 포함되어 있나요?',
    a: '네. 정가에 조회 시점 환율, 중개 수수료, 배송비를 합산한 최종 예상 금액을 처음부터 함께 보여줍니다. 결제 직전에 부대비용이 튀어나오는 상황을 없애는 것이 이 화면의 핵심입니다.',
  },
  {
    cat: 'store',
    q: '관세는 따로 내야 하나요?',
    a: '수취 국가의 관세·부가세 등 공과금은 별도 고지가 없는 한 구매자가 부담합니다. 국가별 면세 한도가 다르므로 주문 전 확인을 권합니다.',
  },
  {
    cat: 'store',
    q: '환율은 언제 기준인가요?',
    a: '상품 화면에 표시된 환율은 조회 시점의 값입니다. 실제 결제 시점의 환율 및 카드사 적용 환율과 차이가 생길 수 있어, 화면에 조회 일자를 함께 표기합니다.',
  },
  {
    cat: 'store',
    q: '한국반을 일본으로 보낼 수도 있나요?',
    a: '현재는 실제 배송을 제공하지 않습니다. 상품 정보에서 일본반·한국반과 제공되는 배송 경로·예상 비용을 확인할 수 있지만, 주문은 데모 크레딧으로만 처리되며 실물은 발송되지 않습니다.',
  },
  {
    cat: 'store',
    q: '주문을 취소하거나 반품할 수 있나요?',
    a: '「전자상거래 등에서의 소비자보호에 관한 법률」에 따라 상품을 받은 날부터 7일 이내에 청약철회가 가능합니다. 단순 변심에 의한 반품의 국외 배송비는 구매자 부담입니다. 자세한 내용은 이용약관 제12조를 참고하세요.',
  },
  {
    cat: 'account',
    q: '계정 없이도 쓸 수 있나요?',
    a: '탐색·차트·일정 등 공개 기능은 계정 없이 이용할 수 있습니다. 좋아요·플레이리스트·팔로우 같은 보관함 기능과 주문에는 계정이 필요합니다.',
  },
  {
    cat: 'account',
    q: '탈퇴하면 플레이리스트는 어떻게 되나요?',
    a: '탈퇴 시 보관함·플레이리스트 등 개인화 데이터를 지체 없이 파기합니다. 다만 법령상 보존 의무가 있는 거래기록은 해당 기간 동안 분리 보관됩니다.',
  },
  {
    cat: 'account',
    q: '검색어나 재생 기록으로 광고를 하나요?',
    a: '하지 않습니다. 사용자 자료를 광고 목적의 프로파일링에 이용하지 않으며, 제3자 광고 추적 쿠키도 사용하지 않습니다. 서비스 개선 분석에는 개인을 식별할 수 없게 통계처리한 정보만 씁니다.',
  },
  {
    cat: 'account',
    q: '내 개인정보가 해외로 나가나요?',
    a: '곡 메타데이터 조회와 영상 재생은 국외 사업자의 서비스를 이용하지만, 이 과정에 회원 식별자나 계정 정보는 전송되지 않습니다. 국외 이전 현황 전체는 처리위탁 현황 문서에 공개해 두었습니다.',
  },
];

/** 구조화 데이터 — 검색 결과에 질문/답변이 그대로 노출될 수 있게.
 *  원본에는 없지만 FAQ 페이지에서 가장 확실한 SEO 이득이라 추가했다.
 *  schema.org/FAQPage 는 화면에 실제로 보이는 Q&A 만 넣어야 한다(정책). */
export function faqJsonLd(): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

export function faqHtml(): string {
  return `
  <section class="site-shell faq-hero">
    <div class="reveal-up">
      <h1 class="site-h2 heading-ko">
        <span>자주 묻는 질문</span>
      </h1>
      <p class="site-lede" style="margin-top:1rem">
        찾는 답이 없으면 <a href="#/contact" style="color:var(--st-accent-savings)">문의하기</a>로 남겨 주세요.
      </p>
      <div class="faq-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3" fill="none"/></svg>
        <input type="search" data-faq-search placeholder="질문 검색" aria-label="질문 검색" autocomplete="off" />
      </div>
      <div class="faq-cats" role="group" aria-label="질문 카테고리">
        ${CATS.map(
          (c) =>
            `<button type="button" class="faq-cat" data-cat="${c.id}" data-active="${c.id === 'all'}" aria-pressed="${c.id === 'all'}">${c.label}</button>`,
        ).join('')}
      </div>
    </div>
  </section>

  <section class="site-shell">
    <p class="sr-only" role="status" aria-live="polite" data-faq-count></p>
    <div class="faq-list reveal-up" data-delay="80" data-faq-list></div>
  </section>`;
}

export function mountFaq(root: HTMLElement) {
  bindSiteMotion(root);

  const list = root.querySelector<HTMLElement>('[data-faq-list]')!;
  const search = root.querySelector<HTMLInputElement>('[data-faq-search]')!;
  const countEl = root.querySelector<HTMLElement>('[data-faq-count]')!;
  let cat = 'all';
  let query = '';

  /** 검색어를 <mark> 로 감싼다.
   *  반드시 esc() 로 이스케이프한 뒤에 태그를 넣는다 — 순서가 바뀌면
   *  이스케이프가 <mark> 까지 먹어치워 태그가 글자로 보인다. */
  const mark = (text: string, q: string) => {
    const safe = esc(text);
    if (!q) return safe;
    // 정규식 메타문자를 중화해야 "(" 같은 입력에서 터지지 않는다
    const needle = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(needle, 'gi'), (m) => `<mark>${m}</mark>`);
  };

  const paint = () => {
    const q = query.trim().toLowerCase();
    const rows = FAQS.filter((f) => (cat === 'all' || f.cat === cat) && (!q || (f.q + f.a).toLowerCase().includes(q)));

    // 필터·검색 결과는 시각적으로만 바뀜다. 스크린리더에도 개수를 알린다.
    countEl.textContent = rows.length ? `질문 ${rows.length}개` : '조건에 맞는 질문이 없습니다';

    if (!rows.length) {
      list.innerHTML = `<p class="faq-empty">조건에 맞는 질문이 없습니다.</p>`;
      return;
    }
    list.innerHTML = rows
      .map(
        (f, i) => `
      <div class="faq-item" data-open="${q ? 'true' : 'false'}" data-i="${i}">
        <button type="button" class="faq-q heading-ko" aria-expanded="${q ? 'true' : 'false'}" aria-controls="faq-a-${i}" id="faq-q-${i}">
          <span>${mark(f.q, q)}</span>
          <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="faq-a" id="faq-a-${i}" role="region" aria-labelledby="faq-q-${i}"><div class="faq-a-inner"><div>${mark(f.a, q)}</div></div></div>
      </div>`,
      )
      .join('');
  };

  // 아코디언 — 한 번에 하나만 열린다(원본 Accordion 기본 동작)
  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.faq-q');
    if (!btn) return;
    const item = btn.closest<HTMLElement>('.faq-item')!;
    const willOpen = item.dataset.open !== 'true';
    list.querySelectorAll<HTMLElement>('.faq-item').forEach((el) => {
      el.dataset.open = 'false';
      el.querySelector('.faq-q')?.setAttribute('aria-expanded', 'false');
    });
    if (willOpen) {
      item.dataset.open = 'true';
      btn.setAttribute('aria-expanded', 'true');
    }
  });

  root.querySelectorAll<HTMLButtonElement>('.faq-cat').forEach((b) =>
    b.addEventListener('click', () => {
      cat = b.dataset.cat!;
      root.querySelectorAll<HTMLElement>('.faq-cat').forEach((x) => {
        x.dataset.active = String(x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
      paint();
    }),
  );

  let timer = 0;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      query = search.value;
      paint();
    }, 120);
  });

  paint();
}
