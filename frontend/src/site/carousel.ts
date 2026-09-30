/* ============================================================
   유즈케이스 캐러셀 — 원본 usecase-carousel.tsx 이식.

   원본이 하는 일을 그대로 옮겼다.
   1) 클립 목록을 3벌 이어 붙여(SET_COUNT=3) 무한 루프처럼 보이게 한다.
   2) 스크롤 중 가운데 세트를 벗어나면 scrollLeft를 세트 폭만큼 조용히
      되돌린다(silent wrap). 사용자는 끊김을 못 느낀다.
   3) 활성 카드는 offsetLeft가 아니라 getBoundingClientRect 기준으로
      "화면 중앙에 가장 가까운 카드"를 고른다. transform이 걸린 카드에서
      offsetLeft를 쓰면 스냅 경계와 어긋나기 때문이다(원본 주석과 동일한 이유).
   4) 라벨은 활성 클립이 바뀔 때마다 y28px/blur8px 로 교체된다.
      원본은 framer-motion AnimatePresence, 여기서는 같은 값의 CSS 키프레임.
   ============================================================ */

import { esc } from '../api';
import { listen, onCleanup } from './lifecycle';

export interface Clip {
  id: string;
  categoryId: string;
  categoryLabel: string;
  caption: string;
  /** 카드 이미지. 런타임에 카탈로그에서 채우므로 비어 있을 수 있다. */
  image?: string;
  /** 아트워크 조회용 검색어 */
  term?: string;
  detail: { headline: string; body: string; points: string[] };
}

const SET_COUNT = 3;

function cardHtml(clip: Clip, setIdx: number): string {
  return `
  <div class="uc-slot" data-key="${setIdx}_${clip.id}" data-clip="${esc(clip.id)}" ${setIdx !== 1 ? 'aria-hidden="true"' : ''}>
    <button type="button" class="uc-card" data-clip="${esc(clip.id)}" data-active="false" ${setIdx !== 1 ? 'tabindex="-1"' : ''}>
      <span class="uc-card-frame">
        <span class="art-placeholder" aria-hidden="true">${esc(clip.term || clip.categoryLabel)}</span>
        <img data-term="${esc(clip.term || '')}" ${clip.image ? `src="${esc(clip.image)}"` : 'hidden'} alt="" loading="lazy" />
        <span class="uc-card-scrim"></span>
      </span>
      <span class="uc-card-meta">
        <span class="tag">${esc(clip.categoryLabel)}</span>
        <span class="cap">${esc(clip.caption)}</span>
        <span class="more">자세히 보기
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M17 7H8M17 7V16"/></svg>
        </span>
      </span>
    </button>
  </div>`;
}

export function carouselHtml(clips: Clip[], categories: { id: string; label: string }[]): string {
  const sets = Array.from({ length: SET_COUNT }, (_, i) => i);
  return `
  <div class="uc-carousel" data-uc>
    <div class="uc-head">
      <div class="uc-label" data-uc-label></div>
      <div class="uc-nav">
        <button type="button" class="uc-arrow prev" data-uc-step="-1" aria-label="이전 항목">
          <svg viewBox="0 0 24 24"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
        </button>
        <button type="button" class="uc-arrow next" data-uc-step="1" aria-label="다음 항목">
          <svg viewBox="0 0 24 24"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
        </button>
      </div>
    </div>

    <div class="uc-scroller" data-uc-scroller tabindex="0" role="region" aria-label="라일락 사용 사례">
      ${sets.map((s) => clips.map((c) => cardHtml(c, s)).join('')).join('')}
    </div>

    <div class="uc-dots" data-uc-dots>
      ${categories
        .map(
          (c) =>
            `<button type="button" class="uc-dot" data-cat="${esc(c.id)}" data-active="false" aria-label="${esc(c.label)}"><span class="bar"></span></button>`,
        )
        .join('')}
    </div>
  </div>

  <div class="uc-modal" data-uc-modal role="dialog" aria-modal="true" aria-label="사용 사례 상세">
    <div class="uc-modal-scrim" data-uc-close></div>
    <div class="uc-modal-panel">
      <button type="button" class="uc-modal-x" data-uc-close aria-label="닫기">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <div class="uc-modal-grid" data-uc-modal-body></div>
    </div>
  </div>`;
}

export function mountCarousel(root: ParentNode, clips: Clip[]) {
  const wrap = root.querySelector<HTMLElement>('[data-uc]');
  const scroller = root.querySelector<HTMLElement>('[data-uc-scroller]');
  const labelBox = root.querySelector<HTMLElement>('[data-uc-label]');
  const modal = root.querySelector<HTMLElement>('[data-uc-modal]');
  const modalBody = root.querySelector<HTMLElement>('[data-uc-modal-body]');
  if (!wrap || !scroller || !labelBox || !modal || !modalBody || !clips.length) return;

  const slots = Array.from(scroller.querySelectorAll<HTMLElement>('.uc-slot'));
  const initialId = clips[0].id;

  let activeId = initialId;
  let setWidth = 0;
  let middleOffset = 0;

  /* ---- 초기 중앙 정렬 + 세트 폭 측정 (원본 useLayoutEffect) ---- */
  let attempts = 0;
  const center = () => {
    const middleTarget = slots.find((s) => s.dataset.key === `1_${initialId}`);
    const middleFirst = slots.find((s) => s.dataset.key === `1_${clips[0].id}`);
    const lastFirst = slots.find((s) => s.dataset.key === `2_${clips[0].id}`);
    if (!middleTarget || !middleFirst || !lastFirst || !middleTarget.clientWidth) {
      if (attempts++ < 60) requestAnimationFrame(center);
      return;
    }
    setWidth = lastFirst.offsetLeft - middleFirst.offsetLeft;
    middleOffset = middleFirst.offsetLeft;
    scroller.scrollTo({
      left: middleTarget.offsetLeft - (scroller.clientWidth - middleTarget.clientWidth) / 2,
      behavior: 'auto',
    });
    update();
  };
  requestAnimationFrame(center);

  /* ---- 라벨 교체 (원본 AnimatePresence mode="wait") ---- */
  function paintLabel(clip: Clip, animate: boolean) {
    const next = document.createElement('h3');
    next.className = `heading-ko${animate ? ' enter' : ''}`;
    next.innerHTML = `${esc(clip.categoryLabel)}<span class="sub">· ${esc(clip.caption)}</span>`;
    const prev = labelBox!.firstElementChild as HTMLElement | null;
    if (prev && animate) {
      prev.classList.remove('enter');
      prev.classList.add('exit');
      prev.addEventListener('animationend', () => prev.remove(), { once: true });
      labelBox!.appendChild(next);
    } else {
      labelBox!.replaceChildren(next);
    }
  }

  function paintDots() {
    const clip = clips.find((c) => c.id === activeId);
    wrap!.querySelectorAll<HTMLElement>('.uc-dot').forEach((d) => {
      d.dataset.active = String(d.dataset.cat === clip?.categoryId);
    });
  }

  function paintCards() {
    scroller!.querySelectorAll<HTMLElement>('.uc-card').forEach((c) => {
      c.dataset.active = String(c.dataset.clip === activeId);
    });
  }

  /* ---- 스크롤 핸들러: silent wrap + 활성 카드 판정 (원본 update()) ---- */
  function update() {
    if (!setWidth || !middleOffset) return;

    const visibleCenter = scroller!.scrollLeft + scroller!.clientWidth / 2;
    const middleCenter = middleOffset + setWidth / 2;
    const halfSet = setWidth / 2;
    if (visibleCenter > middleCenter + halfSet) scroller!.scrollLeft -= setWidth;
    else if (visibleCenter < middleCenter - halfSet) scroller!.scrollLeft += setWidth;

    const viewportCenter = window.innerWidth / 2;
    let nearestId: string | null = null;
    let nearest = Number.POSITIVE_INFINITY;
    for (const slot of slots) {
      const rect = slot.getBoundingClientRect();
      const d = Math.abs(rect.left + rect.width / 2 - viewportCenter);
      if (d < nearest) {
        nearest = d;
        nearestId = slot.dataset.clip || null;
      }
    }
    if (nearestId && nearestId !== activeId) {
      activeId = nearestId;
      const clip = clips.find((c) => c.id === activeId)!;
      paintLabel(clip, true);
      paintCards();
      paintDots();
    } else if (!labelBox!.firstElementChild) {
      paintLabel(clips.find((c) => c.id === activeId)!, false);
      paintCards();
      paintDots();
    }
  }

  let raf = 0;
  scroller.addEventListener(
    'scroll',
    () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    },
    { passive: true },
  );
  // 스크롤러는 DOM 과 함께 사라지지만 예약된 rAF 는 남는다
  onCleanup(() => cancelAnimationFrame(raf));

  /* ---- 특정 클립으로 부드럽게 이동 (원본 scrollToClip) ---- */
  function scrollToClip(clipId: string) {
    const cur = scroller!.scrollLeft + scroller!.clientWidth / 2;
    let nearestEl: HTMLElement | null = null;
    let nearest = Number.POSITIVE_INFINITY;
    for (const slot of slots) {
      if (slot.dataset.clip !== clipId) continue;
      const d = Math.abs(slot.offsetLeft + slot.clientWidth / 2 - cur);
      if (d < nearest) {
        nearest = d;
        nearestEl = slot;
      }
    }
    if (!nearestEl) return;
    scroller!.scrollTo({
      left: nearestEl.offsetLeft - (scroller!.clientWidth - nearestEl.clientWidth) / 2,
      behavior: 'smooth',
    });
  }

  function step(delta: number) {
    const i = clips.findIndex((c) => c.id === activeId);
    const next = (i + delta + clips.length) % clips.length;
    scrollToClip(clips[next].id);
  }

  wrap.querySelectorAll<HTMLButtonElement>('[data-uc-step]').forEach((b) =>
    b.addEventListener('click', () => step(Number(b.dataset.ucStep))),
  );
  wrap.querySelectorAll<HTMLButtonElement>('.uc-dot').forEach((d) =>
    d.addEventListener('click', () => {
      const first = clips.find((c) => c.categoryId === d.dataset.cat);
      if (first) scrollToClip(first.id);
    }),
  );

  scroller.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openModal(activeId, scroller!.querySelector<HTMLElement>(`.uc-card[data-clip="${activeId}"]`));
    }
  });

  /* ---- 카드 클릭: 비활성이면 이동, 활성이면 상세 (원본 동작) ---- */
  scroller.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.uc-card');
    if (!card) return;
    const id = card.dataset.clip!;
    if (id === activeId) openModal(id, card);
    else scrollToClip(id);
  });

  /* ---- 상세 모달 ----
     원본은 Base UI Dialog 가 포커스 트랩·복귀를 대신해 준다.
     바닐라에선 직접 해야 탭 키가 모달 밖으로 새지 않는다. */
  let lastFocused: HTMLElement | null = null;
  /** trapTab 이 지금 document 에 붙어 있는지. 붙인 적 없는데 떼면
   *  동작은 무해하지만 리스너 수지 계산이 음수로 떨어져 누수 측정을 흐린다. */
  let trapped = false;
  const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

  function trapTab(e: KeyboardEvent) {
    if (e.key !== 'Tab' || !modal!.classList.contains('show')) return;
    const f = Array.from(modal!.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /** trigger 를 명시적으로 받는다.
   *  activeElement 에만 기대면 프로그램적 click() 이나 버튼에 포커스를 주지 않는
   *  브라우저(Safari)에서 포커스 복귀 대상이 body 가 되어 버린다. */
  function openModal(clipId: string, trigger?: HTMLElement | null) {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;
    lastFocused =
      trigger ??
      (document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : scroller!.querySelector<HTMLElement>(`.uc-card[data-clip="${clipId}"]`));
    modalBody!.innerHTML = `
      <div class="uc-modal-media"><img src="${esc(clip.image || '')}" alt="" /></div>
      <div class="uc-modal-body">
        <span class="tag">${esc(clip.categoryLabel)}</span>
        <h3 class="heading-ko">${esc(clip.detail.headline)}</h3>
        <p>${esc(clip.detail.body)}</p>
        <ul>${clip.detail.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      </div>`;
    modal!.classList.add('show');
    document.body.style.overflow = 'hidden';
    if (!trapped) { document.addEventListener('keydown', trapTab); trapped = true; }
    modal!.querySelector<HTMLElement>('.uc-modal-x')?.focus();
  }
  function closeModal() {
    modal!.classList.remove('show');
    document.body.style.overflow = '';
    if (trapped) { document.removeEventListener('keydown', trapTab); trapped = false; }
    lastFocused?.focus();
  }
  modal.querySelectorAll('[data-uc-close]').forEach((el) => el.addEventListener('click', closeModal));

  // document/window 에 거는 것은 DOM 이 사라져도 살아남는다 — 반드시 해제를 예약한다
  listen(document, 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape' && modal!.classList.contains('show')) closeModal();
  });
  listen(window, 'resize', () => {
    attempts = 0;
    requestAnimationFrame(center);
  });

  // 모달이 열린 채 라우트가 바뀌면 트랩과 스크롤 잠금이 남는다
  onCleanup(() => {
    if (trapped) { document.removeEventListener('keydown', trapTab); trapped = false; }
    document.body.style.overflow = '';
  });
}
