import { state } from '../state';
import {t,getLocale} from '../i18n';
import {esc,icon,img,ddayOf,safeHref} from '../ui';
import {concertRegistry,openConcert,whenOf,placeOf,providerName} from '../cards';
import type {Concert} from '../cards';
import {mountStage3D,disposeScene,setSceneMotionPaused,isSceneMotionPaused} from '../../three';
import type {StageHandle} from '../../three/stage3d';
const L=(ko:string,ja:string)=>getLocale()==='ja'?ja:ko;
interface HomeStageData {visiting:Concert[];abroad:Concert[]}
interface Slide { c: Concert; label: string }
function slidesOf(d: HomeStageData): Slide[] {
  const ed = state.edition;
  const out: Slide[] = [];
  const seen = new Set<string>();
  const add = (c: Concert, label: string) => {
    if (!c.poster || c.unconfirmed) return;
    const k = `${c.performer || ''}|${c.title}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ c, label });
  };
  for (const c of d.visiting) if (out.length < 8) add(c, t(`stage.visiting.${ed}`));
  for (const c of d.abroad) if (out.length < 12) add(c, t(`stage.abroad.${ed}`));
  return out;
}
const pad2 = (n: number) => String(n).padStart(2, '0');
/* CORS 헤더를 주는 이미지 호스트는 바로, 아니면 백엔드 중계로(WebGL 텍스처는 교차 출처 허락이 필요하다) */
const CORS_OK = /(^|\.)(mzstatic\.com|dzcdn\.net|interpark\.com|melon\.co\.kr)$/i;
export function texUrl(u: string) {
  try { return CORS_OK.test(new URL(u).hostname) ? u : `/api/live/img?u=${encodeURIComponent(u)}`; } catch { return u; }
}

/** 공연 사실은 그대로 두고 아티스트/투어, 일정/장소, 주 행동의 위계를 나눈다. */
export function homeStageInfoHtml(c: Concert, label: string) {
  concertRegistry.set(c.id, c);
  const dd = ddayOf(c.startDate), st = t(`st.${c.status}`);
  const name = c.performer || c.title;
  const ko = getLocale() === 'ko' && c.performerKo && c.performerKo !== name ? c.performerKo : '';
  const title = c.title?.trim() || '';
  // Exact repeated artist prefix only. Never translate or invent a tour name.
  const tour = title === name ? '' : title.startsWith(name + ' ') ? title.slice(name.length).trim() : title;
  const date = whenOf(c) || L('일정 미정', '日程未定'), venue = placeOf(c) || L('장소 미정', '会場未定');
  const sourceHref = safeHref(c.url, false);
  const source = providerName(c) || L('예매처 확인', '販売元を確認');
  const sourceLabel = c.provider === 'fanclub' ? L('공식 팬클럽', '公式ファンクラブ') : source;
  const clubName = c.provider === 'fanclub' ? c.fanclub?.name : null;
  return `<div class="h-stage-text">
      <p class="h-stage-status"><span>${esc(label)}</span>${st ? `<span class="h-stage-sale">${esc(st)}</span>` : ''}${dd ? `<span class="h-stage-countdown">${esc(dd)}</span>` : ''}</p>
      <h2 class="h-stage-name">${esc(name)}${ko ? `<small>${esc(ko)}</small>` : ''}</h2>
      ${tour ? `<p class="h-stage-tour">${esc(tour)}</p>` : ''}
      ${c.artistId ? `<a class="h-stage-artist" href="#/artist/${encodeURIComponent(c.artistId)}">${L('아티스트 홈', 'アーティスト')}${icon('i-chev-r', 'ic xs')}</a>` : ''}
    </div>
    <div class="h-stage-details">
      <dl class="h-stage-facts"><div><dt>${L('일정', '日程')}</dt><dd>${esc(date)}</dd></div><div><dt>${L('장소', '会場')}</dt><dd>${esc(venue)}</dd></div></dl>
      <div class="h-stage-cta">
        <button type="button" class="v2-btn h-stage-primary" data-open-concert="${esc(c.id)}">${t('stage.info')}${icon('i-chev-r', 'ic sm')}</button>
        ${sourceHref ? `<a class="h-stage-source" href="${esc(sourceHref)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(source)} · ${L('새 창에서 열기', '新しいタブで開く')}" title="${esc(source)}"><span>${esc(sourceLabel)}${clubName ? `<small>${esc(clubName)}</small>` : ''}</span>${icon('i-ext', 'ic xs')}</a>` : `<span class="h-stage-source">${L('예매처 링크 미확인', '販売元リンクは未確認')}</span>`}
      </div>
    </div>`;
}

/* 무대: 밝은 패널 안에서 포스터 리본(three.js). 패널 폭 안에서만 그리고 양끝은 부드럽게 사라진다.
   WebGL이 없으면 같은 자리에서 평면 커버 플로 */
function heroHtml(slides: Slide[]) {
  const n = slides.length;
  return `<section class="h-stage" aria-roledescription="carousel" aria-label="${esc(t('stage.label'))}" tabindex="-1">
    <div class="h-stage-heading"><span>${L('다가오는 무대', '次に会えるステージ')}</span><a href="#/concerts/visiting">${L('공연 전체', '公演一覧')}${icon('i-chev-r', 'ic xs')}</a></div>
    <div class="h-stage-view">
      <div class="h-stage-canvas" data-stage aria-hidden="true"></div>
      <div class="h-stage-flat" aria-hidden="true">${slides.map((s, i) => `<button type="button" class="h-stage-flat-item" data-flat="${i}" tabindex="-1">${img(s.c.poster, '', 'poster', { ratio: '3/4', initial: s.c.performer || s.c.title, text: true })}</button>`).join('')}</div>
    </div>
    <div class="h-stage-info" id="stageInfo" aria-live="off">${homeStageInfoHtml(slides[0].c, slides[0].label)}</div>
    <div class="h-stage-nav">
      <div class="h-stage-bars" role="tablist" aria-label="${esc(t('stage.label'))}">${slides.map((s, i) => `<button type="button" role="tab" data-stage-to="${i}" tabindex="${i === 0 ? 0 : -1}" aria-controls="stageInfo" aria-selected="${i === 0}" aria-label="${i + 1} / ${n} · ${esc(s.c.performer || s.c.title)}"><i></i></button>`).join('')}</div>
      <span class="h-stage-pos" aria-hidden="true"><b>01</b> / ${pad2(n)}</span>
      <button type="button" class="h-stage-btn" data-stage-go="-1" aria-label="${esc(t('stage.prev'))}">${icon('i-chev-l')}</button>
      <button type="button" class="h-stage-btn" data-stage-go="1" aria-label="${esc(t('stage.next'))}">${icon('i-chev-r')}</button>
      <button type="button" class="h-stage-btn" data-stage-motion aria-pressed="${isSceneMotionPaused()}" aria-label="${L('자동 넘김 일시정지', '自動再生を一時停止')}">${isSceneMotionPaused() ? icon('i-play') : icon('i-pause')}</button>
    </div>
  </section>`;
}

function bindHero(root: HTMLElement, slides: Slide[], signal: AbortSignal) {
  const stage = root.querySelector<HTMLElement>('.h-stage');
  if (!stage || !slides.length) return;
  const host = stage.querySelector<HTMLElement>('[data-stage]')!;
  const info = stage.querySelector<HTMLElement>('#stageInfo')!;
  const pos = stage.querySelector<HTMLElement>('.h-stage-pos')!;
  const flats = Array.from(stage.querySelectorAll<HTMLElement>('[data-flat]'));
  const bars = Array.from(stage.querySelectorAll<HTMLButtonElement>('[data-stage-to]'));
  const motion = stage.querySelector<HTMLButtonElement>('[data-stage-motion]')!;
  const n = slides.length;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let cur = -1;
  let handle: StageHandle | null = null;
  let timer = 0;
  let paused = isSceneMotionPaused();
  let inView = true;
  const syncMotion = () => {
    motion.disabled = reduce.matches;
    stage.classList.toggle('is-paused', paused || reduce.matches);
    motion.setAttribute('aria-pressed', String(paused || reduce.matches));
    motion.setAttribute('aria-label', reduce.matches ? L('기기의 모션 줄이기 설정 적용 중', '端末のモーション軽減設定を使用中') : paused ? L('자동 넘김 재개', '自動再生を再開') : L('자동 넘김 일시정지', '自動再生を一時停止'));
    motion.innerHTML = icon(paused || reduce.matches ? 'i-play' : 'i-pause');
  };
  motion.addEventListener('click', () => { paused = !paused; setSceneMotionPaused(paused); syncMotion(); restartFlat(); }, { signal });
  syncMotion();
  const visibility = new IntersectionObserver(([e]) => { inView = e.isIntersecting; });
  visibility.observe(stage);
  const show = (i: number) => {
    if (signal.aborted || i === cur) return;
    cur = i;
    info.innerHTML = homeStageInfoHtml(slides[i].c, slides[i].label);
    info.classList.remove('is-in'); void info.offsetWidth; info.classList.add('is-in');
    pos.innerHTML = `<b>${pad2(i + 1)}</b> / ${pad2(n)}`;
    bars.forEach((b, k) => { b.setAttribute('aria-selected', String(k === i)); b.tabIndex = k === i ? 0 : -1; });
    flats.forEach((el, k) => {
      let d = k - i; if (d > n / 2) d -= n; if (d < -n / 2) d += n;
      el.style.setProperty('--d', String(d));
      el.classList.toggle('is-on', d === 0);
      el.hidden = Math.abs(d) > 1;
    });
  };
  const goTo = (i: number) => { const k = ((i % n) + n) % n; if (handle) handle.goTo(k); else show(k); };
  const go = (delta: number) => { if (handle) handle.go(delta); else goTo(cur + delta); };
  stage.querySelectorAll<HTMLButtonElement>('[data-stage-go]').forEach((b) => b.addEventListener('click', () => { go(Number(b.dataset.stageGo)); restartFlat(); }, { signal }));
  bars.forEach((b) => b.addEventListener('click', () => { goTo(Number(b.dataset.stageTo)); restartFlat(); }, { signal }));
  stage.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : ((cur + (e.key === 'ArrowRight' ? 1 : -1) + n) % n);
      goTo(next);
      if ((e.target as HTMLElement).hasAttribute('data-stage-to')) bars[next].focus();
      restartFlat();
    }
  }, { signal });
  const pick = (i: number) => openConcert(slides[i].c.id);
  flats.forEach((el, k) => el.addEventListener('click', () => (k === cur ? pick(k) : goTo(k)), { signal }));
  function restartFlat() {
    clearInterval(timer);
    if (handle || paused || reduce.matches || n < 2) return;
    timer = window.setInterval(() => { if (inView && !document.hidden && !stage!.matches(':hover, :focus-within')) goTo(cur + 1); }, 5600);
  }
  reduce.addEventListener('change', () => { syncMotion(); restartFlat(); }, { signal });
  show(0);
  stage.classList.add('is-loading');
  const veil = getComputedStyle(stage).getPropertyValue('--stage-bg').trim() || '#F4F1F8';
  mountStage3D(host, slides.map((s) => ({ image: texUrl(s.c.poster!), label: s.label, title: s.c.performer || s.c.title, sub: s.c.title })), { veil, onFocus: show, onPick: pick, onFallback: () => {
    if (signal.aborted) return;
    handle = null; stage.classList.remove('is-3d'); stage.classList.add('is-flat'); restartFlat();
  } }).then((h) => {
    if (signal.aborted) { h?.destroy(); return; }
    handle = h;
    stage.classList.remove('is-loading');
    stage.classList.toggle('is-3d', !!h);
    stage.classList.toggle('is-flat', !h);
    if (h) { clearInterval(timer); if (cur > 0) h.goTo(cur); }
    else restartFlat();
  });
  signal.addEventListener('abort', () => { clearInterval(timer); visibility.disconnect(); disposeScene(); }, { once: true });
}


export function homeStageHtml(d:HomeStageData){const slides=slidesOf(d);return slides.length?heroHtml(slides):'';}
export function mountHomeStage(root:HTMLElement,d:HomeStageData,signal:AbortSignal){bindHero(root,slidesOf(d),signal);}
