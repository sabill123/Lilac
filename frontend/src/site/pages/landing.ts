/** Editorial product introduction. Interactive catalog, features and FX examples use the existing data paths. */
import { findCatalog, artUrl, esc } from '../../api';
import { carouselHtml, mountCarousel, type Clip } from '../carousel';
import { matchDemoHtml, mountMatchDemo } from '../matchdemo';
import { chartHtml, mountChart, PRICING } from '../chart';
import { onCleanup, listen, observe } from '../lifecycle';
import type { HeroItem } from '../../three/hero3d';
const CATEGORIES = [
  { id: 'discover', label: '탐색' },
  { id: 'chart', label: '차트' },
  { id: 'store', label: '스토어' },
  { id: 'schedule', label: '일정' },
];

const CLIPS: Clip[] = [
  {
    id: 'c1', categoryId: 'discover', categoryLabel: '탐색',
    caption: '익숙한 표기로 일본 곡 찾기', term: 'YOASOBI',
    detail: {
      headline: '한글 검색에서 일본 음악 카탈로그까지',
      body: '한글 음차와 원래 표기를 연결해 곡과 아티스트를 찾습니다. 검색 결과와 미리듣기 제공 여부는 카탈로그에 따라 달라집니다.',
      points: ['한글·일본어·로마자 검색', '카탈로그 곡명과 아트워크 확인', '제공되는 곡의 30초 미리듣기'],
    },
  },
  {
    id: 'c2', categoryId: 'chart', categoryLabel: '차트',
    caption: '한국·일본 차트를 오가며', term: 'Official髭男dism',
    detail: {
      headline: '국가를 바꾸면 달라지는 오늘의 차트',
      body: '한국과 일본을 선택하고 제공자별 차트를 둘러보세요. 국가 전환으로 각 차트를 확인하는 화면이며, 두 나라 순위를 동시에 비교하는 화면은 아닙니다.',
      points: ['한국·일본 국가 전환', '제공자별 차트 선택', '출처와 갱신 시점 확인'],
    },
  },
  {
    id: 'c3', categoryId: 'store', categoryLabel: '스토어',
    caption: '소장하고 싶은 한 장을 발견', term: 'Ado',
    detail: {
      headline: '상품 정보와 예상 비용부터 확인하세요',
      body: '음반과 굿즈의 상품 정보를 둘러보고, 제공되는 상품의 환율·수수료·배송비 내역을 확인할 수 있습니다. 주문은 데모 크레딧을 사용하며 실제 결제·배송이나 통합 장바구니는 제공하지 않습니다.',
      points: ['상품·에디션 정보 확인', '조회 시점 환율과 예상 비용', '공식 판매처 외부 링크'],
    },
  },
  {
    id: 'c4', categoryId: 'schedule', categoryLabel: '일정',
    caption: '발매와 응모 일정을 한곳에', term: 'King Gnu',
    detail: {
      headline: '다음 발매일, 캘린더에서 확인하세요',
      body: '수집된 발매·응모 일정을 월별 목록이나 캘린더로 확인합니다. 국가·유형별 필터를 제공하며, 팔로우 아티스트 전용 필터나 개인 알림은 현재 제공하지 않습니다. 공연 일정은 아직 수집하지 않습니다.',
      points: ['리스트·캘린더 보기 전환', '국가·일정 유형 필터', 'D-day와 제공된 출처 확인'],
    },
  },
  {
    id: 'c5', categoryId: 'discover', categoryLabel: '탐색',
    caption: '한 아티스트를 조금 더 깊게', term: 'Vaundy',
    detail: {
      headline: '좋아하는 이름에서 다음 앨범으로',
      body: '아티스트 페이지에서 인기곡과 디스코그래피를 살펴보고 제공되는 공식 채널로 이동할 수 있습니다. 듣기 기록을 분석하는 개인 맞춤 추천이 아니라 카탈로그를 직접 탐색하는 경험입니다.',
      points: ['인기곡과 앨범 탐색', '공식 사이트 링크', '계정으로 아티스트 팔로우'],
    },
  },
  {
    id: 'c6', categoryId: 'chart', categoryLabel: '차트',
    caption: '차트에서 미리듣기까지', term: 'LE SSERAFIM',
    detail: {
      headline: '순위 속 낯선 곡을 직접 들어보세요',
      body: '차트에서 발견한 곡을 카탈로그 미리듣기로 확인하고, 제공되는 공식 뮤직비디오를 열어볼 수 있습니다. 전곡 재생은 현재 활성화되어 있지 않습니다.',
      points: ['카탈로그 30초 프리뷰', 'YouTube 공식 MV 임베드', '계정으로 좋아요 저장'],
    },
  },
];

const PICKS = [
  { term: 'YOASOBI', label: 'YOASOBI', genre: 'J-POP' },
  { term: 'LE SSERAFIM', label: 'LE SSERAFIM', genre: 'K-POP' },
  { term: 'Vaundy', label: 'Vaundy', genre: 'J-POP' },
  { term: 'Ado', label: 'Ado', genre: 'J-POP' },
];

export function landingHtml(): string {
  return `
  <div class="li-landing">
  <section class="li-hero" aria-labelledby="li-title">
    <div class="li-heading">
      <h1 id="li-title"><span>J-POP</span><span class="li-title-second"><i aria-hidden="true">/</i> K-POP</span></h1>
    </div>
    <div class="li-scene" data-landing-scene aria-label="카탈로그 아트워크 3D. 아래 아티스트 링크로도 탐색할 수 있습니다.">
      <div class="li-records" aria-hidden="true">
        ${PICKS.slice(0, 3).map((p, i) => `<figure class="li-record li-record-${i + 1}">
          <div class="li-vinyl"><span></span></div>
          <div class="editorial-art-frame"><span class="art-placeholder">${esc(p.label)}</span><img data-term="${esc(p.term)}" alt="" hidden /></div>
        </figure>`).join('')}
      </div>
    </div>
    <div class="li-intro">
      <p class="site-lede">한국과 일본의 음악을 찾고,<br />좋아하는 아티스트를 더 알아가세요.</p>
      <div class="li-entry-actions"><a class="btn btn-primary li-enter" href="#/">라일락 둘러보기 <span aria-hidden="true">↗</span></a><a class="li-text-link" href="#/search">음악 검색 <span aria-hidden="true">↗</span></a></div>
      <p class="site-caption">무료 데모 · 제공되는 곡의 30초 미리듣기</p>
    </div>
    <div class="li-hero-bottom">
      <div class="li-stage-index" aria-label="3D 아트워크의 아티스트 검색">
        ${PICKS.slice(0, 3).map(p => `<a href="#/search?q=${encodeURIComponent(p.term)}" data-stage-artist="${esc(p.term)}">${esc(p.label)} <span aria-hidden="true">↗</span></a>`).join('')}
      </div>
      <button class="li-motion" type="button" data-landing-motion aria-pressed="false" disabled>3D 모션 준비 중</button>
    </div>
  </section>

  <section class="site-shell li-artists" aria-labelledby="li-artists-title">
    <div class="section-heading"><div><h2 class="site-h3" id="li-artists-title">아티스트</h2></div><p>곡과 앨범, 그리고 다음 발매까지.<br />아티스트를 검색하고 카탈로그를 둘러보세요.</p></div>
    <div class="li-artist-grid">
      ${PICKS.map(p => `<a class="li-artist" href="#/search?q=${encodeURIComponent(p.term)}">
        <div class="li-artist-art"><span class="art-placeholder">${esc(p.label)}</span><img data-term="${esc(p.term)}" alt="" loading="lazy" hidden /></div>
        <div class="li-artist-name"><h3>${esc(p.label)}</h3><span aria-hidden="true">↗</span></div>
        <p>${p.genre} <span>카탈로그 탐색</span></p>
      </a>`).join('')}
    </div>
    <p class="site-caption li-artwork-note">이미지는 검색된 곡의 카탈로그 아트워크입니다.</p>
  </section>

  ${matchDemoHtml()
    .replace('한글로 쳐도 <span class="accent-text">일본 곡이 잡힙니다.</span>', '요아소비도,<br />YOASOBI도.')
    .replace('아래는 설명이 아니라 실제 동작입니다. 입력한 한글 음차를 그대로 카탈로그에 질의한 결과입니다.', '익숙한 한글 표기로 검색해 보세요. 아래는 한글 음차로 조회한 실제 카탈로그 결과입니다. 제공되는 곡과 이미지는 카탈로그에 따라 달라집니다.')
    .replace('        </p>', '        </p><a class="li-text-link" href="#/search">직접 검색하기 <span aria-hidden="true">↗</span></a>')}

  <section class="site-section li-features" id="usecases" aria-labelledby="li-features-title">
    <div class="site-shell">
      <div class="section-heading"><div><h2 class="site-h3" id="li-features-title">차트와 발매 일정</h2></div><p>국가별 차트부터 발매·응모 일정까지.<br />각 화면에서 할 수 있는 일을 확인하세요.</p></div>
      ${carouselHtml(CLIPS, CATEGORIES)}
      <p class="site-caption">서비스의 이용 흐름을 소개합니다. 실제 결제·배송은 연결되어 있지 않으며 상품·일정의 일부는 데모 데이터입니다.</p>
      <nav class="li-paths" aria-label="더 둘러보기">
        <a href="#/chart/combined"><span>한국·일본 차트</span><span aria-hidden="true">↗</span></a>
        <a href="#/schedule"><span>발매·응모 일정</span><span aria-hidden="true">↗</span></a>
        <a href="#/store"><span>음반·굿즈</span><span aria-hidden="true">↗</span></a>
      </nav>
    </div>
  </section>

  <section class="site-section li-pricing" id="pricing" aria-labelledby="li-pricing-title">
    <div class="site-shell li-pricing-grid">
      <div class="li-pricing-copy"><h2 class="site-h3" id="li-pricing-title">상품별 예상 비용</h2><p class="site-lede">예시 상품 ¥${PRICING.jpyAmount.toLocaleString()} 기준으로 환율, 수수료, 배송비를 함께 보여드립니다.</p><p class="site-caption">환율에 따른 예상 비용 예시입니다. 관세 등 수취 국가 공과금은 별도이며, 실제 결제·배송은 제공하지 않습니다.</p><a class="li-text-link" href="#/store">상품 정보 둘러보기 <span aria-hidden="true">↗</span></a></div>
      ${chartHtml().replace('라일락 최종 결제액', '수수료·배송비 포함 예상액')}
    </div>
  </section>

  <section class="site-shell li-cta" aria-labelledby="li-cta-title">
    <h2 id="li-cta-title">어떤 음악을<br />찾고 있나요?</h2>
    <div class="li-cta-actions"><a class="btn btn-primary" href="#/search">음악 검색 <span aria-hidden="true">↗</span></a><a class="li-text-link" href="#/">라일락 둘러보기 <span aria-hidden="true">↗</span></a><a class="li-text-link li-contact" href="#/contact">아티스트·레이블 제휴 문의 <span aria-hidden="true">↗</span></a></div>
  </section>
  </div>`;
}

async function hydrateArtwork(root: HTMLElement): Promise<HeroItem[]> {
  let active = true;
  onCleanup(() => { active = false; });
  const items = new Map<string, HeroItem>();
  const terms = [...new Set([...PICKS.map(p => p.term), ...CLIPS.map(c => c.term).filter((t): t is string => Boolean(t))])];
  await Promise.all(terms.map(async term => {
    const hit = await findCatalog(term).catch(() => null);
    if (!active) return;
    const art = artUrl(hit, 600);
    if (!art) return;
    items.set(term, { title: hit?.title || term, artist: term, artwork: art, href: '#/search?q=' + encodeURIComponent(term) });
    CLIPS.filter(c => c.term === term).forEach(c => { c.image = art; });
    root.querySelectorAll<HTMLImageElement>('img[data-term]').forEach(img => {
      if (img.dataset.term !== term) return;
      img.onload = () => { if (!active) return; img.hidden = false; img.previousElementSibling?.classList.add('art-loaded'); };
      img.onerror = () => { if (!active) return; img.hidden = true; img.previousElementSibling?.classList.remove('art-loaded'); };
      img.src = art;
    });
  }));
  return PICKS.map(p => items.get(p.term)).filter((item): item is HeroItem => Boolean(item)).slice(0, 3);
}

function mountLandingScene(root: HTMLElement, artwork: Promise<HeroItem[]>) {
  const host = root.querySelector<HTMLElement & { __selectHero?: (index: number) => void }>('[data-landing-scene]');
  const toggle = root.querySelector<HTMLButtonElement>('[data-landing-motion]');
  if (!host || !toggle) return;
  let active = true;
  let enabled = localStorage.getItem('lilac.discovery.motion') !== 'off';
  let scene: typeof import('../../three') | undefined;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const syncMotion = () => {
    const paused = reduced.matches || Boolean(scene?.isSceneMotionPaused());
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.disabled = !scene || reduced.matches || host.dataset.scene3d === 'fallback';
    toggle.textContent = host.dataset.scene3d === 'fallback' ? '정적 아트워크' : reduced.matches ? '모션 줄이기 적용됨' : paused ? '3D 모션 재생' : '3D 모션 일시정지';
  };
  // Register teardown before either catalog or dynamic import resolves.
  onCleanup(() => { active = false; scene?.disposeScene(); });
  listen(toggle, 'click', () => {
    if (!scene) return;
    enabled = !enabled;
    localStorage.setItem('lilac.discovery.motion', enabled ? 'on' : 'off');
    scene.setSceneMotionPaused(!enabled);
    syncMotion();
  });
  listen(reduced, 'change', syncMotion);
  const stateObserver = observe(new MutationObserver(syncMotion));
  stateObserver.observe(host, { attributes: true, attributeFilter: ['data-scene3d'] });
  void Promise.all([import('../../three'), artwork]).then(async ([module, items]) => {
    if (!active || !host.isConnected) return;
    scene = module;
    scene.setSceneMotionPaused(!enabled);
    syncMotion();
    await scene.mountHero3D(host, items);
    if (!active) return;
    root.querySelectorAll<HTMLAnchorElement>('[data-stage-artist]').forEach(link => {
      const index = items.findIndex(item => item.artist === link.dataset.stageArtist);
      if (index < 0) return;
      const select = () => host.__selectHero?.(index);
      listen(link, 'pointerenter', select);
      listen(link, 'focus', select);
    });
    syncMotion();
  }).catch(() => {
    if (!active) return;
    host.dataset.scene3d = 'fallback';
    syncMotion();
  });
}

export function mountLanding(root: HTMLElement) {
  mountCarousel(root, CLIPS);
  mountMatchDemo(root);
  mountChart(root);
  mountLandingScene(root, hydrateArtwork(root));
}
