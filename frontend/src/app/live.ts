/* 실시간 동기화 — 서버가 원천(예매처·뉴스·팬클럽·차트·커뮤니티)을 주기적으로 다시 받고,
 * 내용이 바뀌면 /api/live/stream(SSE)으로 알린다. 화면은 지금 보고 있는 페이지와 관련된 주제만 조용히 다시 그린다.
 *
 * 다시 그리는 조건: 탭이 보이고, 입력 중이 아니고, 상세 시트·메뉴가 닫혀 있고, 2.5초 동안 조작이 없을 때.
 * 그 전에 온 알림은 모아 뒀다가 조건이 맞으면 한 번만 반영한다. 스크롤 위치는 지킨다. */
export type LiveTopic = 'concerts' | 'tickets' | 'news' | 'fanclubs' | 'charts' | 'community' | 'goods' | 'fx';
export interface LiveUpdate { topic: LiveTopic; at: number; added: number; keys: string[]; byKey?: Record<string, number> }

/* 원천 키 → 그 데이터를 보는 에디션. 목록에 없는 키(팬클럽·차트·커뮤니티 등)는 모든 에디션에 해당 */
const KEY_EDITIONS: [RegExp, string[]][] = [
  [/^news-kr$/, ['kr', 'all']],
  [/^news-jp$/, ['jp', 'all']],
  [/^kr-visiting$|^eplus-search-/, ['kr', 'all']],
  [/^jp-kpop$|^kr-domestic$/, ['jp', 'all']],
];
const keyFor = (key: string, edition: string) => { const m = KEY_EDITIONS.find(([re]) => re.test(key)); return !m || m[1].includes(edition); };
/* 이 에디션에 해당하는 변화인지, 해당하면 새 항목 몇 건인지 */
export function relevance(u: LiveUpdate, edition: string): { hit: boolean; added: number } {
  if (!u.keys?.length) return { hit: true, added: u.added || 0 };
  const keys = u.keys.filter((k) => keyFor(k, edition));
  if (!keys.length) return { hit: false, added: 0 };
  const added = u.byKey ? keys.reduce((n, k) => n + (u.byKey![k] || 0), 0) : keys.length === u.keys.length ? u.added || 0 : 0;
  return { hit: true, added };
}

const listeners = new Set<(u: LiveUpdate) => void>();
const statusListeners = new Set<() => void>();
export const live = { connected: false, lastAt: 0, since: 0 };

export const onLive = (fn: (u: LiveUpdate) => void) => { listeners.add(fn); return () => listeners.delete(fn); };
export const onLiveStatus = (fn: () => void) => { statusListeners.add(fn); return () => statusListeners.delete(fn); };
const tell = () => statusListeners.forEach((fn) => { try { fn(); } catch (e) { console.error('Live status listener failed', e); } });

let es: EventSource | null = null;
export function startLive() {
  if (es || typeof EventSource === 'undefined') return;
  es = new EventSource('/api/live/stream');
  es.addEventListener('hello', (e) => {
    live.connected = true;
    live.since = Date.now();
    try {
      const d = JSON.parse((e as MessageEvent).data);
      const ts = Object.values((d.topics || {}) as Record<string, { at: string }>).map((x) => Date.parse(x.at)).filter((n) => !Number.isNaN(n));
      if (ts.length) live.lastAt = Math.max(live.lastAt, ...ts);
    } catch { /* 형식 오류 무시 */ }
    tell();
  });
  es.addEventListener('update', (e) => {
    let u: LiveUpdate;
    try { u = JSON.parse((e as MessageEvent).data); } catch { return; }
    if (!u || !['concerts', 'tickets', 'news', 'fanclubs', 'charts', 'community', 'goods', 'fx'].includes(u.topic) || !Array.isArray(u.keys) || !u.keys.every((k) => typeof k === 'string') || !Number.isFinite(u.at) || !Number.isFinite(u.added)) return;
    live.lastAt = Math.max(live.lastAt, u.at || Date.now());
    tell();
    listeners.forEach((fn) => { try { fn(u); } catch (e) { console.error('Live update listener failed', e); } });
  });
  // EventSource는 끊기면 스스로 다시 붙는다(retry 5s). 상태 표시만 바꾼다
  es.onerror = () => { live.connected = false; tell(); };
  es.onopen = () => { live.connected = true; tell(); };
}

/* 사용자가 조작 중인지 */
let lastInput = 0;
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true });
export function userBusy() {
  if (document.visibilityState !== 'visible') return true;
  if (Date.now() - lastInput < 2500) return true;
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return true;
  if (document.querySelector('.sheet.open, .sheet[open], dialog[open], .modal.open, .menu.open, [aria-expanded="true"][data-keep]')) return true;
  return false;
}
