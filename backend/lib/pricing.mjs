/**
 * 가격 계산 단일 출처
 *
 * 왜 모듈로 뺐나.
 * 같은 계수가 세 군데에 흩어져 있었다 —
 *   · collect-products.mjs 의 FEE / shipping (상품 데이터를 굽는 쪽)
 *   · server.mjs 의 주문 결제 계산
 *   · 프론트 마케팅 차트의 PRICING 상수
 * 하나만 바뀌어도 "화면에 보이는 값"과 "실제로 빠지는 값"이 어긋난다.
 * 결제 금액이 화면과 다른 건 커머스에서 가장 나쁜 종류의 버그라 한 곳으로 모았다.
 *
 * BM 근거: 커머스 마진 5~15% 구간. 상품 성격별로 아래처럼 둔다.
 *   싱글 10% / 앨범 12% / 한정반 15%
 * 멤버십(Lilac Pass)은 이 수수료를 깎아주는 방식으로 가치를 만든다 —
 * 배송비를 깎으면 실제 원가가 나가지만 수수료는 우리 몫이라 조절 가능하다.
 */

/** 상품 성격별 기본 중개 수수료율 */
export const FEE_RATE = { single: 0.10, album: 0.12, limited: 0.15 };

/** 배송 경로별 기본 배송비 (구매자 통화 기준) */
export const SHIPPING = {
  /** 일본 → 한국 (구매자 KRW 결제) */
  jp: { currency: 'KRW', shipping: 3500, unit: 100 },
  /** 한국 → 일본 (구매자 JPY 결제) */
  kr: { currency: 'JPY', shipping: 2800, unit: 10 },
};

/**
 * 멤버십 등급별 혜택.
 * BM 사다리에서 멤버십은 ₩4,900–7,900/월 구간이고 Laftel(₩9,900) 아래를 노린다.
 * 혜택은 "수수료 할인 + 공동구매 우선참여"로 잡는다 — 둘 다 우리가 통제 가능한 레버다.
 */
export const PLANS = {
  free: {
    tier: 'free',
    name: 'Free',
    priceKrw: 0,
    /** 중개 수수료 할인율 (0 = 정가) */
    feeDiscount: 0,
    /** 공동구매 선행 참여(분) */
    groupBuyEarlyMin: 0,
    perks: ['탐색·차트·일정 전체 이용', '30초 미리듣기'],
  },
  pass: {
    tier: 'pass',
    name: 'Lilac Pass',
    priceKrw: 4900,
    feeDiscount: 0.5,
    groupBuyEarlyMin: 60,
    perks: [
      '중개 수수료 50% 할인',
      '공동구매 1시간 선행 참여',
      '발매·응모 마감 알림',
      '월 배송비 쿠폰 1장',
    ],
  },
  passPlus: {
    tier: 'passPlus',
    name: 'Lilac Pass+',
    priceKrw: 7900,
    feeDiscount: 1,
    groupBuyEarlyMin: 180,
    perks: [
      '중개 수수료 100% 면제',
      '공동구매 3시간 선행 참여',
      '한정반 우선 배정',
      '월 배송비 쿠폰 2장',
    ],
  },
};

export const planOf = (tier) => PLANS[tier] || PLANS.free;

/** 자리올림 — 잔돈이 남지 않게 통화 단위로 맞춘다 */
export const roundUp = (n, unit) => Math.ceil(n / unit) * unit;

/**
 * 한 건의 최종가를 계산한다.
 *
 * @param {object} o
 * @param {number} o.localAmount  현지 통화 정가 (일본반이면 JPY, 한국반이면 KRW)
 * @param {'jp'|'kr'} o.origin    발송 국가
 * @param {'single'|'album'|'limited'} o.feeKind
 * @param {number} o.rate         현지→구매자 통화 환율 (jp면 JPY→KRW)
 * @param {number} [o.qty=1]
 * @param {string} [o.planTier='free']
 * @param {number} [o.groupDiscount=0] 공동구매 달성 할인율 (0~1)
 * @returns {object} 구성요소가 전부 드러난 내역
 */
export function quote({
  localAmount, origin = 'jp', feeKind = 'album', rate,
  qty = 1, planTier = 'free', groupDiscount = 0,
}) {
  const cfg = SHIPPING[origin] || SHIPPING.jp;
  const plan = planOf(planTier);
  const n = Math.max(1, Number(qty) || 1);

  // 1) 정가 환산
  const base = localAmount * rate * n;

  // 2) 공동구매 할인 — 상품 원가에만 적용한다(수수료·배송비에는 적용하지 않는다)
  const groupOff = base * Math.min(Math.max(groupDiscount, 0), 0.3);
  const discountedBase = base - groupOff;

  // 3) 중개 수수료 — 멤버십 할인 적용
  const baseFeeRate = FEE_RATE[feeKind] ?? FEE_RATE.album;
  const effectiveFeeRate = baseFeeRate * (1 - plan.feeDiscount);
  const fee = discountedBase * effectiveFeeRate;

  // 4) 배송비 — 수량이 늘어도 합포장이라 1회분만 받는다
  const shipping = cfg.shipping;

  const total = roundUp(discountedBase + fee + shipping, cfg.unit);

  return {
    qty: n,
    currency: cfg.currency,
    rate,
    localAmount,
    base: Math.round(base),
    groupDiscount: Math.min(Math.max(groupDiscount, 0), 0.3),
    groupOff: Math.round(groupOff),
    baseFeeRate,
    feeRate: effectiveFeeRate,
    feeDiscount: plan.feeDiscount,
    fee: Math.round(fee),
    shipping,
    total,
    /** 정가 대비 절약분 — 멤버십·공동구매 가치를 화면에서 그대로 보여주기 위해 */
    savedVsFree: Math.round(groupOff + discountedBase * (baseFeeRate - effectiveFeeRate)),
    planTier: plan.tier,
  };
}
