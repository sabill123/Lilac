/* ============================================================
   요금제 — Lilac Pass

   BM 사다리에서 멤버십은 커머스 다음 칸이고, 오랫동안 0% 구현 상태였다.
   이 화면은 그 값을 지어내지 않는다: 요금·혜택·수수료 할인율을
   /api/plans 에서 그대로 받아 그린다. 서버의 pricing.mjs 가 단일 출처다.

   레이아웃은 원본 레퍼런스의 hairline 격자 + reveal 규약을 따른다.
   ============================================================ */

import { api, esc } from '../../api';
import { bindSiteMotion } from '../motion';

interface Plan {
  tier: string;
  name: string;
  priceKrw: number;
  feeDiscount: number;
  groupBuyEarlyMin: number;
  perks: string[];
}

/** 비교표에 쓰는 예시 — 실제 계산은 서버가 한다. 여기선 축 이름만 고정한다. */
const COMPARE_ROWS = [
  { key: 'fee', label: '중개 수수료' },
  { key: 'early', label: '공동구매 선행 참여' },
  { key: 'alert', label: '발매·응모 마감 알림' },
  { key: 'coupon', label: '배송비 쿠폰' },
];

export function pricingHtml(): string {
  return `
  <section class="site-section" aria-label="요금제">
    
    <div class="site-shell">
      <div class="reveal-up">
        <h1 class="site-h2 heading-ko" >
          <span>팬질에 드는 비용을</span>
          <span class="accent-text">낮추는 쪽으로.</span>
        </h1>
        <p class="site-lede" style="margin-top:1rem">
          라일락은 상품값에 마진을 얹지 않습니다. 중개 수수료로 운영하고,
          멤버십은 그 수수료를 깎아 돌려주는 구조입니다.
        </p>
      </div>

      <div class="reveal-up" data-delay="120">
        <div class="plan-grid" data-plan-grid>
          <div class="plan-loading">요금제를 불러오는 중…</div>
        </div>
      </div>

      <div class="reveal-up" data-delay="200">
        <div class="plan-compare" data-plan-compare hidden></div>
      </div>

      <div class="reveal-up" data-delay="260">
        <p class="plan-note">
          결제는 데모 크레딧으로 이뤄지며 실제 청구는 발생하지 않습니다.
          수수료 할인은 상품 원가가 아니라 <strong>중개 수수료</strong>에 적용됩니다.
          배송비와 정가는 그대로입니다.
        </p>
      </div>
    </div>
  </section>`;
}

const won = (n: number) => `₩${n.toLocaleString('ko-KR')}`;

function planCard(p: Plan, featured: boolean): string {
  return `
  <div class="plan-card${featured ? ' featured' : ''}">
    ${featured ? '<span class="plan-badge">Lilac Pass</span>' : ''}
    <p class="plan-name">${esc(p.name)}</p>
    <p class="plan-price">
      ${p.priceKrw === 0 ? '무료' : won(p.priceKrw)}
      ${p.priceKrw === 0 ? '' : '<span class="per">/월</span>'}
    </p>
    <p class="plan-headline">
      ${p.feeDiscount >= 1
        ? '중개 수수료 <b>전액 면제</b>'
        : p.feeDiscount > 0
          ? `중개 수수료 <b>${Math.round(p.feeDiscount * 100)}% 할인</b>`
          : '정가 수수료'}
    </p>
    <ul class="plan-perks">
      ${p.perks.map((k) => `<li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg><span>${esc(k)}</span></li>`).join('')}
    </ul>
    <a class="${featured ? 'btn btn-primary' : 'btn btn-outline'} plan-cta" href="#/account">
      ${p.priceKrw === 0 ? '기본 제공' : '앱에서 구독하기'}
    </a>
  </div>`;
}

function compareTable(plans: Plan[]): string {
  const cell = (p: Plan, key: string) => {
    switch (key) {
      case 'fee':
        return p.feeDiscount >= 1 ? '면제' : p.feeDiscount > 0 ? `${Math.round(p.feeDiscount * 100)}% 할인` : '정가';
      case 'early':
        return p.groupBuyEarlyMin > 0 ? `${p.groupBuyEarlyMin}분 먼저` : '—';
      case 'alert':
        return p.tier === 'free' ? '—' : '있음';
      case 'coupon':
        return p.tier === 'passPlus' ? '월 2장' : p.tier === 'pass' ? '월 1장' : '—';
      default:
        return '—';
    }
  };
  return `
  <div class="legal-table-wrap">
    <table class="plan-table">
      <thead>
        <tr><th>혜택</th>${plans.map((p) => `<th>${esc(p.name)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${COMPARE_ROWS.map((r) => `
        <tr>
          <td>${r.label}</td>
          ${plans.map((p) => `<td>${cell(p, r.key)}</td>`).join('')}
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

export function mountPricing(root: HTMLElement) {
  bindSiteMotion(root);
  const grid = root.querySelector<HTMLElement>('[data-plan-grid]');
  const cmp = root.querySelector<HTMLElement>('[data-plan-compare]');
  if (!grid || !cmp) return;

  void (async () => {
    try {
      const { plans } = (await api('/api/plans')) as { plans: Plan[] };
      if (!plans?.length) throw new Error('empty');
      grid.innerHTML = plans.map((p) => planCard(p, p.tier === 'pass')).join('');
      cmp.innerHTML = compareTable(plans);
      cmp.hidden = false;
    } catch {
      grid.innerHTML = `<p class="plan-loading">요금제를 불러오지 못했습니다.</p>`;
    }
  })();
}
