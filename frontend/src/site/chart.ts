/* ============================================================
   예상 총액 차트 — 원본 pricing-comparison-chart.tsx 이식.

   원본에서 가져온 것(메커니즘 전부):
   · Catmull-Rom → 3차 베지에 변환으로 매끄러운 곡선 path 생성
   · pathLength=1 + strokeDashoffset 로 곡선을 "그려 넣는" 진입 애니메이션
   · 두 곡선 사이를 닫아 만든 절감/차액 영역 (아래 곡선을 역방향으로 이어 Z)
   · 날짜별 세로 밴드 hover → 활성 인덱스 전환
   · 활성 포인트를 따라다니는 플로팅 툴팁, 상단 여백 부족 시 아래로 flip
   · 좁은 화면(compact)에서는 툴팁을 좌상단 고정
   · 활성 수치 count-up (최초 0→값 긴 트윈, 이후 현재값→새값 짧은 트윈)
   · ResizeObserver 기반 반응형 재계산

   바꾼 것(데이터):
   원본은 타사 대비 자사 요금이라는 가정치를 쓴다. 라일락에는 비교할
   "타사"의 검증된 수치가 없다. 대신 실제로 가진 데이터만 쓴다.
   · X축: /api/fx/series 가 반환한 실제 관측 날짜 (단일 날짜는 스냅숏)
   · 회색 곡선: 환율만 반영한 정가 환산액
   · 액센트 곡선: 라일락 예상 총액 (= 환산액 + 수수료 + 배송비)
   · 두 곡선 사이 영역: 수수료 + 배송비, 즉 "보통 결제 직전에 튀어나오는 금액"
   수수료율·배송비는 db/products.json 이 실제로 쓰는 값과 동일하다.
   ============================================================ */

import { listen, observe, onCleanup } from './lifecycle';

const EASE_DRAW = 'var(--st-ease-standard)';
const EASE_OUT = 'var(--st-ease-out)';

/** db/products.json 의 pricing 과 동일한 계수 — 두 곳이 어긋나면 화면이 거짓말을 한다 */
export const PRICING = {
  /** 예시 상품: 통상반 CD 싱글 정가 */
  jpyAmount: 3300,
  feeRate: 0.1,
  shippingKrw: 3500,
} as const;

export interface FxPoint { date: string; jpyKrw: number }
export interface FxSeries {
  source: string; live: boolean; days: number;
  points: FxPoint[]; min: number; max: number; latest: FxPoint;
}

type Pt = { x: number; y: number };

/** One observation per calendar date; the last supplied value wins without rounding. */
function observedPoints(points: FxPoint[]): FxPoint[] {
  if (!Array.isArray(points) || !points.length) throw new Error('empty');
  const dates = new Map<string, FxPoint>();
  for (const point of points) {
    if (!point || !/^\d{4}-\d{2}-\d{2}$/.test(point.date) ||
        !Number.isFinite(Date.parse(point.date)) ||
        new Date(point.date).toISOString().slice(0, 10) !== point.date ||
        !Number.isFinite(point.jpyKrw) || point.jpyKrw <= 0) throw new Error('invalid observation');
    dates.set(point.date, point);
  }
  return [...dates.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Catmull-Rom → cubic Bézier (원본 smoothPath 그대로) */
function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return pts.length ? `M ${pts[0].x} ${pts[0].y}` : '';
  const d = [`M ${pts[0].x} ${pts[0].y}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    // Uneven calendar gaps must not make the curve backtrack across dates.
    const clampX = (x: number) => Math.max(Math.min(p1.x, p2.x), Math.min(Math.max(p1.x, p2.x), x));
    d.push(
      `C ${clampX(p1.x + (p2.x - p0.x) / 6)} ${p1.y + (p2.y - p0.y) / 6}, ` +
        `${clampX(p2.x - (p3.x - p1.x) / 6)} ${p2.y - (p3.y - p1.y) / 6}, ${p2.x} ${p2.y}`,
    );
  }
  return d.join(' ');
}

const won = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;

export function chartHtml(): string {
  return `
  <div class="fx-chart" data-fx-chart>
    <div class="fx-legend">
      <span class="fx-dot muted"></span><span class="fx-legend-l">환율만 반영한 정가 환산액</span>
      <span class="fx-dot accent"></span><span class="fx-legend-l">라일락 예상 총액</span>
      <span class="fx-badge" data-fx-badge>환율 확인 중</span>
    </div>
    <div class="fx-stage" data-fx-stage>
      <div class="fx-loading" data-fx-loading>환율 데이터를 불러오는 중…</div>
    </div>
    <p class="fx-note" data-fx-note></p>
  </div>`;
}

export function mountChart(root: ParentNode) {
  const wrap = root.querySelector<HTMLElement>('[data-fx-chart]');
  const stage = root.querySelector<HTMLElement>('[data-fx-stage]');
  const note = root.querySelector<HTMLElement>('[data-fx-note]');
  const badge = root.querySelector<HTMLElement>('[data-fx-badge]');
  if (!wrap || !stage || !note || !badge) return;

  let series: FxSeries | null = null;
  let disposed = false;
  const controller = new AbortController();
  let active = 0;
  let inView = false;
  let size = { w: 0, h: 0 };
  // count-up 상태 (원본 useCountUp)
  let countFrom = 0;
  let countStarted = false;
  let countRaf = 0;

  // 옵저버는 DOM 이 사라져도 살아남는다 — 등록과 동시에 해제를 예약한다
  const io = observe(
    new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          inView = true;
          io.unobserve(en.target);
          render();
        });
      },
      { rootMargin: '-60px' },
    ),
  );
  io.observe(wrap);

  const ro = observe(
    new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      size = { w: r.width, h: r.height };
      render();
    }),
  );
  ro.observe(stage);

  // 진행 중인 count-up rAF 가 남으면 사라진 노드를 계속 만진다
  onCleanup(() => {
    disposed = true;
    controller.abort();
    cancelAnimationFrame(countRaf);
  });

  void (async () => {
    try {
      const r = await fetch('/api/fx/series?days=90', { signal: controller.signal });
      if (!r.ok) throw new Error(String(r.status));
      const payload: FxSeries = await r.json();
      if (disposed) return;
      series = { ...payload, points: observedPoints(payload?.points) };
      active = series.points.length - 1; // 원본 DEFAULT_INDEX = 마지막 지점
      render();
    } catch {
      if (disposed) return;
      series = null;
      badge.textContent = '환율 확인 불가';
      badge.dataset.live = 'false';
      note.textContent = '환율 데이터를 확인할 수 없어 예상 총액을 표시하지 않습니다.';
      stage.innerHTML = `<p class="fx-loading">환율 데이터를 불러오지 못했습니다.</p>`;
    }
  })();

  const finalOf = (rate: number) => {
    const base = PRICING.jpyAmount * rate;
    return { base, fee: base * PRICING.feeRate, total: base * (1 + PRICING.feeRate) + PRICING.shippingKrw };
  };

  function runCountUp(target: number, el: HTMLElement) {
    cancelAnimationFrame(countRaf);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      countFrom = target;
      el.textContent = won(target);
      return;
    }
    const from = countFrom;
    const duration = countStarted ? 420 : 900;
    countStarted = true;
    let start = 0;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min(1, (ts - start) / duration);
      const v = from + (target - from) * ease(p);
      countFrom = v;
      el.textContent = won(v);
      if (p < 1) countRaf = requestAnimationFrame(tick);
    };
    countRaf = requestAnimationFrame(tick);
  }

  function render() {
    if (disposed || !series || !size.w || !size.h) return;
    const pts = series.points;
    const single = pts.length === 1;
    const observedRange = single ? pts[0].date : `${pts[0].date} ~ ${pts[pts.length - 1].date}`;
    const coverage = single ? `${observedRange} 기준 스냅숏 추정` : `${observedRange} · ${pts.length}개 관측`;
    const { w, h } = size;
    const compact = w < 520;
    const pad = { top: 40, right: 20, bottom: 58, left: compact ? 58 : 74 };
    const innerW = Math.max(0, w - pad.left - pad.right);
    const innerH = Math.max(0, h - pad.top - pad.bottom);

    const totals = pts.map((p) => finalOf(p.jpyKrw).total);
    const bases = pts.map((p) => finalOf(p.jpyKrw).base);
    // Y축은 0부터 그리지 않는다. 환율 변동 폭이 총액의 몇 %라 0 기준이면 두 선이 붙어버린다.
    const lo = Math.min(...bases) * 0.985;
    const hi = Math.max(...totals) * 1.015;
    const yOf = (v: number) => pad.top + innerH - ((v - lo) / (hi - lo)) * innerH;
    const firstDate = Date.parse(pts[0].date);
    const dateSpan = Date.parse(pts[pts.length - 1].date) - firstDate;
    const xOf = (i: number) => pad.left + (single ? innerW / 2 :
      innerW * (Date.parse(pts[i].date) - firstDate) / dateSpan);

    const basePts = bases.map((v, i) => ({ x: xOf(i), y: yOf(v) }));
    const totalPts = totals.map((v, i) => ({ x: xOf(i), y: yOf(v) }));
    const baseD = smoothPath(basePts);
    const totalD = smoothPath(totalPts);
    // 차액 영역 — 위 곡선(예상 총액) → 아래 곡선(환산액) 역방향으로 닫는다 (원본 areaD)
    const last = basePts[basePts.length - 1];
    const revBase = smoothPath([...basePts].reverse()).replace(/^M\s*[-\d.]+\s+[-\d.]+/, '');
    const areaD = `${totalD} L ${last.x} ${last.y} ${revBase} Z`;

    // Y 그리드 4단
    const grid = Array.from({ length: 4 }, (_, i) => lo + ((hi - lo) * i) / 3);
    // Never repeat a date to fill the axis when only a few observations exist.
    const labelCount = Math.min(5, pts.length);
    const labelIdx = Array.from({ length: labelCount }, (_, i) =>
      labelCount === 1 ? 0 : Math.round((i * (pts.length - 1)) / (labelCount - 1)));

    const a = pts[active];
    const av = finalOf(a.jpyKrw);
    const aY = yOf(av.total);
    const baseY = yOf(av.base);
    const TIP_GAP = 16, TIP_H = 168;
    const flipBelow = aY - TIP_GAP - TIP_H < 4;
    const tipLeft = compact ? pad.left : xOf(active);
    const tipTop = compact ? pad.top - 6 : flipBelow ? baseY + TIP_GAP : aY - TIP_GAP;
    const tipShiftX = compact ? '0%' : single ? '-50%' : active === 0 ? '0%' : active === pts.length - 1 ? '-100%' : '-50%';
    const tipShiftY = compact ? '0%' : flipBelow ? '0%' : '-100%';

    const on = inView;
    stage.innerHTML = `
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="fx-svg" role="img"
      aria-label="${coverage}. JPY-KRW 환율에 따른 ¥${PRICING.jpyAmount.toLocaleString()} 상품의 정가 환산액과 라일락 예상 총액 비교">
      <defs>
        <linearGradient id="fxArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--st-accent-savings)" stop-opacity="0.34"/>
          <stop offset="100%" stop-color="var(--st-accent-savings)" stop-opacity="0.02"/>
        </linearGradient>
        <linearGradient id="fxLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="var(--st-accent-savings)" stop-opacity="0.7"/>
          <stop offset="100%" stop-color="var(--st-accent-savings)" stop-opacity="1"/>
        </linearGradient>
      </defs>

      ${grid
        .map((v, i) => {
          const gy = yOf(v);
          return `<g>
            <line x1="${pad.left}" x2="${w - pad.right}" y1="${gy}" y2="${gy}"
              stroke="var(--st-foreground)" stroke-opacity="${i === 0 ? 0.16 : 0.06}" stroke-width="1"/>
            <text x="${pad.left - 12}" y="${gy}" text-anchor="end" dominant-baseline="middle" class="fx-ytick">${won(v)}</text>
          </g>`;
        })
        .join('')}

      ${labelIdx
        .map(
          (i) =>
            `<text x="${xOf(i)}" y="${h - pad.bottom + 26}" text-anchor="middle"
              class="fx-xtick${i === active ? ' on' : ''}">${single ? pts[i].date : pts[i].date.slice(5)}</text>`,
        )
        .join('')}
      <text x="${pad.left + innerW / 2}" y="${h - 12}" text-anchor="middle" class="fx-axis-cap">${single ? '단일 날짜 · 예상 총액' : coverage}</text>

      <line x1="${xOf(active)}" x2="${xOf(active)}" y1="${pad.top - 6}" y2="${h - pad.bottom}"
        stroke="var(--st-foreground)" stroke-opacity="0.14" stroke-dasharray="2 5" stroke-width="1"
        style="opacity:${on ? 1 : 0};transition:opacity .4s ${EASE_OUT} 1.1s"/>

      ${single ? '' : ` <path d="${areaD}" fill="url(#fxArea)" style="opacity:${on ? 1 : 0};transition:opacity .9s ${EASE_OUT} .9s"/>

      <path d="${baseD}" fill="none" stroke="var(--st-muted-foreground)" stroke-opacity="0.55"
        stroke-width="2" stroke-linecap="round" pathLength="1"
        style="stroke-dasharray:1;stroke-dashoffset:${on ? 0 : 1};transition:stroke-dashoffset 1.3s ${EASE_DRAW} .05s"/>

      <path d="${totalD}" fill="none" stroke="url(#fxLine)" stroke-width="3" stroke-linecap="round" pathLength="1"
        style="stroke-dasharray:1;stroke-dashoffset:${on ? 0 : 1};transition:stroke-dashoffset 1.5s ${EASE_DRAW} .35s"/>`}

      <g style="opacity:${on ? 1 : 0};transition:opacity .5s ${EASE_OUT} 1.15s">
        <circle cx="${xOf(active)}" cy="${baseY}" r="4.5" fill="var(--st-background)"
          stroke="var(--st-muted-foreground)" stroke-width="2"/>
        <circle cx="${xOf(active)}" cy="${aY}" r="12" fill="var(--st-accent-savings)" opacity="0.18"/>
        <circle cx="${xOf(active)}" cy="${aY}" r="6" fill="var(--st-accent-savings)"
          stroke="var(--st-background)" stroke-width="2.5"/>
      </g>

      ${pts
        .map((_, i) => {
          const left = i === 0 ? pad.left : (xOf(i - 1) + xOf(i)) / 2;
          const right = i === pts.length - 1 ? w - pad.right : (xOf(i) + xOf(i + 1)) / 2;
          return `<rect x="${left}" y="0" width="${right - left}" height="${h}" fill="transparent"
            style="cursor:pointer" data-band="${i}"/>`;
        })
        .join('')}
    </svg>

    <div class="fx-tip" style="left:${tipLeft}px;top:${tipTop}px;transform:translate(${tipShiftX},${tipShiftY});
      opacity:${on ? 1 : 0};transition:opacity .4s ${EASE_OUT} 1.2s">
      <div class="fx-tip-box">
        <div class="fx-tip-date">${a.date} · 1엔 = ${a.jpyKrw.toFixed(4)}원</div>
        <div class="fx-row"><span class="k">정가 환산</span><span class="v muted">${won(av.base)}</span></div>
        <div class="fx-row"><span class="k">수수료 ${Math.round(PRICING.feeRate * 100)}%</span><span class="v muted">+${won(av.fee)}</span></div>
        <div class="fx-row"><span class="k">배송비</span><span class="v muted">+${won(PRICING.shippingKrw)}</span></div>
        <div class="fx-tip-foot">
          <div class="fx-tip-foot-h"><span>예상 총액</span><span class="fx-tip-chip">결제 아님</span></div>
          <p class="fx-tip-total" data-fx-total>${won(av.total)}</p>
        </div>
      </div>
    </div>`;

    stage.querySelectorAll<HTMLElement>('[data-band]').forEach((b) => {
      const i = Number(b.dataset.band);
      const set = () => { if (i !== active) { active = i; render(); } };
      b.addEventListener('pointerenter', set);
      b.addEventListener('pointerdown', set);
    });

    const totalEl = stage.querySelector<HTMLElement>('[data-fx-total]');
    if (on && totalEl) runCountUp(av.total, totalEl);

    badge.textContent = single ? `${observedRange} 스냅숏` : series.live ? '관측 환율' : '저장된 관측 환율';
    badge.dataset.live = String(series.live);
    note.textContent =
      `${coverage}. 예시 상품 ¥${PRICING.jpyAmount.toLocaleString()} 기준 예상 총액이며 실제 결제·배송은 제공하지 않습니다. 환율 출처 ${series.source}, ` +
      `수수료 ${Math.round(PRICING.feeRate * 100)}% · 배송비 ${won(PRICING.shippingKrw)}는 서비스가 실제 상품 가격 계산에 쓰는 값입니다. ` +
      `관세 등 수취 국가 공과금은 포함되지 않습니다.${series.live ? '' : ' 저장된 환율이며 실시간 데이터가 아닙니다.'}`;
  }

  listen(stage, 'pointerleave', () => {
    if (!series) return;
    active = series.points.length - 1;
    render();
  });
}
