/* 공연 페이지 부품 — 티켓링크 PC 웹 구성요소를 옮긴 것(tl.css와 짝).
 * 상품 카드(product_grid_unit) · 히어로 배너(페이드 + 썸네일) · 탭 · 스켈레톤 · 위로 가기.
 * 카드는 공연 상세 페이지(#/concert/<id>)로 가는 진짜 링크다. */
import { esc, safeImage, icon, fmtRange, fmtDateTime, ddayOf, saleLabel } from './ui';
import { t, getLocale } from './i18n';
import { concertRegistry, providerName, cityName, placeOf, whenOf } from './cards';
import type { Concert } from './cards';

type Fest = Concert & { country?: string; lineup?: { name: string; origin: string | null }[]; lineupJp?: number; lineupKr?: number };

/* ---------- 상세 페이지로 가는 링크 ---------- */
const STASH = 'lilac.concert.';
export function concertHref(c: Concert) { return `#/concert/${encodeURIComponent(c.id)}`; }
export function stashConcert(c: Concert) {
  concertRegistry.set(c.id, c);
  try { sessionStorage.setItem(STASH + c.id, JSON.stringify(c)); } catch { /* 저장 공간 부족 — 목록 다시 불러오기로 */ }
}
export function unstashConcert(id: string): Concert | null {
  const hit = concertRegistry.get(id);
  if (hit) return hit;
  try { const raw = sessionStorage.getItem(STASH + id); return raw ? JSON.parse(raw) as Concert : null; } catch { return null; }
}
/* 카드 링크를 누르는 순간 그 공연을 세션에 남긴다 — 새로고침·공유해도 상세가 열리게 */
document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-concert]');
  if (!a) return;
  const c = concertRegistry.get(a.dataset.concert!);
  if (c) stashConcert(c);
}, true);

/* ---------- 이미지 ---------- */
export function tlImg(src: string | null | undefined, alt = '') {
  const u = safeImage(src);
  if (!u) return '';
  return `<img src="${esc(u)}" alt="${esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">`;
}
/* 포스터가 없을 때: 날짜·도시 칸(기존 카드와 같은 달력 모양) */
function dateFace(c: Concert) {
  const d = c.startDate && /^\d{4}-\d{2}-\d{2}$/.test(c.startDate) ? c.startDate : '';
  const ja = getLocale() === 'ja';
  const wd = d ? new Intl.DateTimeFormat(ja ? 'ja-JP' : 'ko-KR', { weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(`${d}T00:00:00+09:00`)) : '';
  const md = d ? `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}` : (ja ? '日程未定' : '일정 미정');
  const multi = c.endDate && c.endDate !== c.startDate && /^\d{4}-\d{2}-\d{2}$/.test(c.endDate) ? `~ ${Number(c.endDate.slice(5, 7))}.${Number(c.endDate.slice(8, 10))}` : '';
  return `<span class="datebox" aria-hidden="true"><em>${esc(d.slice(0, 4))}</em><b>${esc(md)}</b><span>${esc([wd, multi].filter(Boolean).join(' '))}</span><i>${esc(cityName(c.city) || c.venue || '')}</i></span>`;
}
/* 날짜 칸을 아래에 깔고 포스터를 위에 — 포스터가 깨지면(onerror로 지워지면) 날짜 칸이 보인다 */
export function posterFace(c: Concert) {
  return dateFace(c) + (safeImage(c.poster) ? tlImg(c.poster, '') : '');
}

/* ---------- 카드 위 배지(product_flag) — 사실만: 예매 상태·팬클럽·예매처 수·교차 출연 ---------- */
export function flagsOf(c: Concert, { withProvider = true, dday = '' } = {}) {
  const ja = getLocale() === 'ja';
  const f: string[] = [];
  /* 공연일 임박(7일 이내)만 — 먼 날짜의 D-숫자는 기간 줄로 충분하다 */
  const dn = /^D-(\d+)$/.exec(dday);
  if (dday && (!dn || Number(dn[1]) <= 7)) f.push(`<span class="tl-flag is-primary-bg">${esc(dday)}</span>`);
  const x = c as Fest & { isPublic?: boolean; exclusive?: boolean };
  if (c.provider === 'fanclub') {
    f.push(`<span class="tl-flag is-primary-bg">${esc(x.isPublic ? t('fc.tag.public') : c.fcOnly ? t('fc.tag.only') : t('fc.tag.first'))}</span>`);
    if (c.noJpPhone) f.push(`<span class="tl-flag is-clean">${esc(t('fc.tag.noPhone'))}</span>`);
    else if (c.overseasOk) f.push(`<span class="tl-flag is-clean">${esc(t('fc.tag.overseas'))}</span>`);
  } else {
    if (c.status === 'upcoming') f.push(`<span class="tl-flag is-primary">${esc(t('st.upcoming'))}</span>`);
    else if (c.status === 'soldout') f.push(`<span class="tl-flag is-ghost">${esc(t('st.soldout'))}</span>`);
    if (x.exclusive) f.push(`<span class="tl-flag is-primary-bg">${ja ? '独占販売' : '단독판매'}</span>`);
    if (withProvider) f.push(`<span class="tl-flag is-ghost">${esc(providerName(c))}</span>`);
    if (c.alsoAt?.length) f.push(`<span class="tl-flag is-blue">${ja ? `ほか${c.alsoAt.length}社` : `예매처 +${c.alsoAt.length}`}</span>`);
  }
  if (c.kind === 'festival') {
    const want = x.country === 'JP' ? 'kr' : 'jp';
    const n = want === 'jp' ? x.lineupJp || 0 : x.lineupKr || 0;
    if (n) f.push(`<span class="tl-flag is-green">${want === 'jp' ? 'J-POP' : 'K-POP'} ${n}${ja ? '組' : '팀'}</span>`);
    else if (x.lineup?.length) f.push(`<span class="tl-flag is-ghost">${ja ? '出演' : '라인업'} ${x.lineup.length}${ja ? '組' : '팀'}</span>`);
  }
  return f.length ? `<div class="tl-flags"><div class="tl-flag-area">${f.join('')}</div></div>` : '';
}

/* 지역 탭 — 티켓링크 지역 구분 그대로(서울 · 경기/인천 · 충청/강원 · 대구/경북 · 부산/경남 · 광주/전라 · 제주).
   일본은 같은 방식의 광역 구분(関東 · 関西 …). 도시를 모르면 탭에 넣지 않는다(전체에서만 보임) */
const KR_GROUPS: [string, RegExp][] = [
  ['서울', /^서울/], ['경기/인천', /^(경기|인천|수원|성남|고양|용인|부천|안산|안양|화성|파주|일산|김포|하남|의정부|광명|평택|가평|양평|포천)/],
  ['충청/강원', /^(충청|충북|충남|대전|세종|청주|천안|아산|강원|춘천|원주|강릉|속초|평창)/], ['대구/경북', /^(대구|경북|경상북|포항|구미|경주|안동)/],
  ['부산/경남', /^(부산|경남|경상남|울산|창원|김해|진주|거제|통영)/], ['광주/전라', /^(광주|전라|전북|전남|전주|여수|순천|목포|익산|군산)/], ['제주', /^제주/],
];
const JP_GROUPS: [string, string, RegExp][] = [
  ['北海道・東北', '홋카이도·도호쿠', /^(北海道|青森|岩手|宮城|秋田|山形|福島)/], ['関東', '간토', /^(東京|神奈川|埼玉|千葉|茨城|栃木|群馬)/],
  ['中部', '주부', /^(新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知)/], ['関西', '간사이', /^(大阪|京都|兵庫|奈良|和歌山|滋賀|三重)/],
  ['中国・四国', '주고쿠·시코쿠', /^(鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知)/], ['九州・沖縄', '규슈·오키나와', /^(福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)/],
];
const KR_JA = ['ソウル', '京畿/仁川', '忠清/江原', '大邱/慶北', '釜山/慶南', '光州/全羅', '済州'];
export const REGION_ORDER = [...KR_GROUPS.map((g) => g[0]), ...KR_JA, ...JP_GROUPS.map((g) => g[1]), ...JP_GROUPS.map((g) => g[0])];
export function regionGroup(c: Concert) {
  const city = cityName(c.city).trim();
  if (!city) return '';
  const kr = KR_GROUPS.find(([, re]) => re.test(city));
  if (kr) return getLocale() === 'ja' ? ({ 서울: 'ソウル', '경기/인천': '京畿/仁川', '충청/강원': '忠清/江原', '대구/경북': '大邱/慶北', '부산/경남': '釜山/慶南', '광주/전라': '光州/全羅', 제주: '済州' } as Record<string, string>)[kr[0]] : kr[0];
  const jp = JP_GROUPS.find(([, , re]) => re.test(city));
  if (jp) return getLocale() === 'ja' ? jp[0] : jp[1];
  return '';
}

/* 카드의 지역 표시: 한국은 시(서울·인천), 일본은 도도부현(東京都). 모르면 비운다 */
export function regionOf(c: Concert) {
  return cityName(c.city) || '';
}

/* ---------- 상품 카드 ---------- */
export function tlCard(c: Concert, { rank = 0, open = false, dday = true }: { rank?: number; open?: boolean; dday?: boolean } = {}) {
  concertRegistry.set(c.id, c);
  const photo = c.posterKind === 'artist';
  const dd = dday ? ddayOf(c.startDate) : '';
  let period = fmtRange(c.startDate, c.endDate).replace(/\s*–\s*/, ' ~ ');
  if ((c.showCount || 0) > 1) period += ` · ${t('c.shows', { n: c.showCount! })}`;
  if (open) {
    const now = Date.now();
    const at = [c.ticketOpenAt, ...(c.openSchedule || []).map((s) => s.at)].filter((a): a is string => !!a && Date.parse(a) > now).sort()[0];
    const closing = !at && c.closesAt && Date.parse(c.closesAt) > now ? c.closesAt : null;
    period = at ? `${fmtDateTime(at)} ${getLocale() === 'ja' ? '発売' : '오픈'}` : closing ? t('c.closesAt', { t: fmtDateTime(closing) }) : c.openTba ? t('c.tba') : t('st.onsale');
  }
  const label = open ? (c.provider === 'fanclub' ? (c.ticketOpenLabel || c.saleType || '') : saleLabel(c.ticketOpenLabel || c.saleType) || '') : '';
  const place = (c.venueCount || 0) > 1 ? placeOf(c) : c.venue || '';
  return `<li class="tl-card${open ? ' tl-open' : ''}">
    <a class="tl-card-link" href="${concertHref(c)}" data-concert="${esc(c.id)}">
      <div class="tl-imgbox${photo ? ' is-photo' : ''}">${posterFace(c)}${rank ? `<span class="tl-ranking"><span class="tl-rank">${rank}<span class="blind">${getLocale() === 'ja' ? '位' : '위'}</span></span></span>` : ''}</div>
      <div class="tl-info">
        ${rank ? '' : `<span class="tl-region">${esc(open ? label : regionOf(c)) || '&nbsp;'}</span>`}
        <span class="tl-title">${esc(c.title)}</span>
        <div class="tl-side">${place && !rank ? `<span class="tl-place">${esc(place)}</span>` : ''}<span class="tl-period">${esc(period)}</span></div>
        ${rank ? '' : flagsOf(c, { withProvider: !open, dday: dd })}
      </div>
    </a>
  </li>`;
}
export function tlGrid(list: Concert[], opts: { col5?: boolean; rank?: boolean; open?: boolean } = {}) {
  return `<ul class="tl-grid${opts.col5 ? ' col5' : ''}">${list.map((c, i) => tlCard(c, { rank: opts.rank ? i + 1 : 0, open: opts.open })).join('')}</ul>`;
}

/* ---------- 섹션 머리 ---------- */
export function secHead(title: string, { desc = '', more = '', moreHref = '', right = '' } = {}) {
  return `<div class="tl-sec-heading"><h2 class="tl-sec-title">${title}${desc ? `<span class="tl-sec-desc">${esc(desc)}</span>` : ''}</h2>${right}${moreHref ? `<a class="tl-link" href="${esc(moreHref)}">${esc(more || (getLocale() === 'ja' ? 'すべて見る' : '전체보기'))}</a>` : ''}</div>`;
}

/* ---------- 탭 ---------- */
export function capsules(items: [string, string, number?][], cur: string, attr: string) {
  return `<div class="tl-tabs" role="tablist">${items.map(([k, l, n]) => `<button type="button" role="tab" class="tl-cap${k === cur ? ' on' : ''}" aria-selected="${k === cur}" ${attr}="${esc(k)}">${esc(l)}${n != null ? `<small>${n}</small>` : ''}</button>`).join('')}</div>`;
}
export function dots(items: [string, string][], cur: string, attr: string) {
  return `<div class="tl-dots" role="tablist">${items.map(([k, l]) => `<button type="button" role="tab" class="tl-dot${k === cur ? ' on' : ''}" aria-selected="${k === cur}" ${attr}="${esc(k)}">${esc(l)}</button>`).join('')}</div>`;
}
/* 탭 한 묶음: 누르면 선택 표시를 옮기고 콜백 */
export function bindTabs(scope: HTMLElement, attr: string, onPick: (v: string) => void) {
  scope.querySelectorAll<HTMLButtonElement>(`[${attr}]`).forEach((b) => b.addEventListener('click', () => {
    scope.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); });
    onPick(b.getAttribute(attr) || '');
  }));
}

/* ---------- 스켈레톤 ---------- */
export function skelBanner() { return '<div class="tl-skel tl-skel-banner"></div>'; }
export function skelGrid(n = 8, col5 = false) {
  return `<ul class="tl-grid${col5 ? ' col5' : ''}">${Array.from({ length: n }, () => '<li><div class="tl-skel tl-skel-img"></div><span class="tl-skel tl-skel-txt"></span><span class="tl-skel tl-skel-txt s"></span></li>').join('')}</ul>`;
}

/* ---------- 히어로 배너 ----------
 * 티켓링크 장르 페이지의 1120x400 페이드 배너. 배너 이미지를 따로 만들지 않고, 포스터에서 뽑은 색을 바탕으로
 * 왼쪽에 제목(티켓링크 메인 배너 글자 체계: 제목 50/64 → 44/60, 부제 16/24 · 70% 투명도), 오른쪽에 포스터를 놓는다.
 * 약 5.4초마다 다음 장(300ms 페이드) — 실측한 티켓링크 자동 넘김 간격. 마우스를 올리면 멈춘다. */
export function heroHtml(list: Concert[], kicker: (c: Concert) => string[]) {
  if (!list.length) return '';
  const slides = list.map((c, i) => {
    concertRegistry.set(c.id, c);
    const sub = [whenOf(c), placeOf(c)].filter(Boolean).join(' · ');
    return `<li class="tl-hero-slide${i === 0 ? ' is-active' : ''}" data-i="${i}" aria-hidden="${i !== 0}">
      <a class="tl-hero-link" href="${concertHref(c)}" data-concert="${esc(c.id)}" data-poster="${esc(safeImage(c.poster))}" tabindex="${i === 0 ? 0 : -1}">
        <div class="tl-hero-text"><p class="tl-hero-kicker">${kicker(c).map((k, j) => (j === 0 ? `<b>${esc(k)}</b>` : `<span>${esc(k)}</span>`)).join('<span aria-hidden="true">·</span>')}</p>
          <strong class="tl-hero-title">${esc(c.title)}</strong><span class="tl-hero-sub">${esc(sub)}</span></div>
        ${safeImage(c.poster) ? `<div class="tl-hero-poster">${tlImg(c.poster, '')}</div>` : ''}
      </a></li>`;
  }).join('');
  const thumbs = list.map((c, i) => `<li class="tl-hero-thumb${i === 0 ? ' is-active' : ''}">${safeImage(c.poster) ? tlImg(c.poster, '') : `<span class="tl-hero-ph">${esc((c.performer || c.title).slice(0, 1))}</span>`}<button type="button" class="blind-btn" data-hero="${i}" aria-label="${esc(getLocale() === 'ja' ? `${i + 1}番目のバナーに切り替え` : `${i + 1}번째 배너로 변경`)}" style="position:absolute;inset:0;z-index:2"></button></li>`).join('');
  return `<div class="tl-hero" role="region" aria-roledescription="carousel"><ul>${slides}</ul>${list.length > 1 ? `<ul class="tl-hero-thumbs">${thumbs}</ul>` : ''}</div>`;
}
const HERO_MS = 5400;
export function bindHero(scope: HTMLElement, alive: () => boolean) {
  const hero = scope.querySelector<HTMLElement>('.tl-hero');
  if (!hero) return;
  const slides = Array.from(hero.querySelectorAll<HTMLElement>('.tl-hero-slide'));
  const thumbs = Array.from(hero.querySelectorAll<HTMLElement>('.tl-hero-thumb'));
  let cur = 0;
  let timer = 0;
  let paused = false;
  const go = (n: number) => {
    cur = (n + slides.length) % slides.length;
    slides.forEach((s, i) => { const on = i === cur; s.classList.toggle('is-active', on); s.setAttribute('aria-hidden', String(!on)); s.querySelector('a')?.setAttribute('tabindex', on ? '0' : '-1'); });
    thumbs.forEach((s, i) => s.classList.toggle('is-active', i === cur));
  };
  const tick = () => {
    clearTimeout(timer);
    if (!alive() || !hero.isConnected) return;
    timer = window.setTimeout(() => { if (!alive() || !hero.isConnected) return; if (!paused && !document.hidden) go(cur + 1); tick(); }, HERO_MS);
  };
  hero.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach((b) => b.addEventListener('click', () => { go(Number(b.dataset.hero)); tick(); }));
  hero.addEventListener('mouseenter', () => { paused = true; });
  hero.addEventListener('mouseleave', () => { paused = false; });
  hero.addEventListener('focusin', () => { paused = true; });
  hero.addEventListener('focusout', () => { paused = false; });
  if (slides.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) tick();
  /* 배너 바탕색: 포스터의 평균색(이미지 프록시를 거쳐 같은 출처로 읽는다). 못 읽으면 기본 진회색 */
  /* 이미지 프록시는 동시 4건까지 — 배너 순서대로 하나씩(지금 장 → 다음 장 …) */
  void (async () => {
    for (let k = 0; k < slides.length; k++) {
      if (!alive() || !hero.isConnected) return;
      const a = slides[k].querySelector<HTMLElement>('.tl-hero-link');
      const src = a?.dataset.poster;
      if (!a || !src) continue;
      const tone = await posterTone(src);
      if (tone) { a.style.setProperty('--c', tone.bg); a.classList.toggle('is-light', tone.light); }
    }
  })();
}

/* 포스터 평균색 → 배너 바탕. 흰 글자가 읽히게 너무 밝으면 어둡게 누른다(명도 상한) */
const toneCache = new Map<string, Promise<{ bg: string; light: boolean } | null>>();
export function posterTone(src: string, tries = 2): Promise<{ bg: string; light: boolean } | null> {
  if (!toneCache.has(src)) toneCache.set(src, new Promise<{ bg: string; light: boolean } | null>((resolve) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.decoding = 'async';
    im.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = 24; cv.height = 32;
        const ctx = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
        ctx.drawImage(im, 0, 0, 24, 32);
        const d = ctx.getImageData(0, 0, 24, 32).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        if (!n) return resolve(null);
        r /= n; g /= n; b /= n;
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const k = lum > 96 ? 96 / lum : 1; // 명도 상한 — 흰 글자 대비
        resolve({ bg: `rgb(${Math.round(r * k)} ${Math.round(g * k)} ${Math.round(b * k)})`, light: false });
      } catch { resolve(null); }
    };
    im.onerror = () => resolve(null);
    im.src = `/api/live/img?u=${encodeURIComponent(src)}`;
  }).then(async (tone) => {
    /* 실패(프록시 혼잡 503 등)는 기억하지 않는다 — 잠시 뒤 한 번 더 */
    if (tone) return tone;
    toneCache.delete(src);
    if (tries <= 1) return null;
    await new Promise((r) => setTimeout(r, 1200));
    return posterTone(src, tries - 1);
  }));
  return toneCache.get(src)!;
}

/* ---------- 위로 가기 버튼 ---------- */
export function bindTopButton(alive: () => boolean) {
  let btn = document.querySelector<HTMLButtonElement>('.tl-top');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tl-top';
    btn.setAttribute('aria-label', getLocale() === 'ja' ? 'ページの先頭へ' : '맨 위로');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 14l6-6 6 6"/></svg>';
    btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    const wrap = document.createElement('div');
    wrap.className = 'tl';
    wrap.style.cssText = 'position:static';
    wrap.appendChild(btn);
    document.body.appendChild(wrap);
  }
  const b = btn;
  const onScroll = () => {
    if (!alive()) { window.removeEventListener('scroll', onScroll); b.classList.remove('is-active'); return; }
    b.classList.toggle('is-active', window.scrollY > 400);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

export { icon };
