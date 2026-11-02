/* Lilac 서버시계 — 티켓 오픈 경계와 화면의 KST 시계를 사용자 PC 시계가 아니라 GET /api/time 기준으로 맞춘다.
   - 오프셋 추정: 요청 왕복(RTT)의 중간점(NTP 방식), 여러 표본 중 RTT가 가장 짧은 것을 채택
   - 경과 시간: performance.now()(단조 시계)만 사용. Date.now()는 절전/시계 변경 감지에만 쓰고 표시에 쓰지 않는다
   - 동기화 실패 시 시각을 지어내지 않는다: now()는 null, 화면은 '미동기화' 또는 '마지막 동기화 N분 전'
   - 이 모듈은 외부 import가 없다(테스트가 실제 소스를 그대로 실행한다). */

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const SERVER_TIME_ZONE = 'Asia/Seoul';

export type ClockStatus = 'unsynced' | 'syncing' | 'synced' | 'stale' | 'error';

export interface ClockSnapshot {
  status: ClockStatus;
  /** 서버 시각 추정의 최대 오차(ms, RTT/2). 미동기면 null */
  uncertaintyMs: number | null;
  rttMs: number | null;
  /** 마지막 성공 동기화 이후 경과(단조 시계 기준 ms). 한 번도 없으면 null */
  lastSyncAgeMs: number | null;
  lastError: string | null;
  refreshing: boolean;
}

interface FetchLike {
  (url: string, init: { cache: string; credentials: string; headers: Record<string, string>; signal: AbortSignal }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
}
interface EventTargetLike {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}
export interface ClockDeps {
  fetch: FetchLike;
  perfNow: () => number;
  /** 절전·시계 점프 감지 전용. 표시·경계 계산에는 쓰지 않는다. */
  wallNow: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
  doc: (EventTargetLike & { visibilityState?: string }) | null;
  win: EventTargetLike | null;
}
export interface ClockOptions {
  url?: string;
  /** 화면이 보이는 동안 재동기 주기. 기본 60초 */
  resyncMs?: number;
  /** 요청 1건 제한 시간. 기본 4초 */
  timeoutMs?: number;
  /** 동기화 1회당 표본 수. 기본 3 */
  samples?: number;
  /** 이보다 긴 RTT 표본은 정밀도가 낮아 버린다. 기본 3초 */
  maxRttMs?: number;
  /** 마지막 성공 후 이 시간이 지나면 'stale'. 기본 3분 */
  staleAfterMs?: number;
  /** 단조 시계와 벽시계 경과 차이가 이보다 크면(절전 등) 기준점을 버리고 재동기. 기본 2초 */
  jumpToleranceMs?: number;
  signal?: AbortSignal;
  deps?: Partial<ClockDeps>;
  autoStart?: boolean;
}

export interface ServerClock {
  /** 서버 epoch ms 추정. 동기화 기준점이 없으면 null(로컬 시계로 대체하지 않음) */
  now(): number | null;
  state(): ClockSnapshot;
  sync(): Promise<ClockSnapshot>;
  start(): void;
  destroy(): void;
  onChange(cb: (s: ClockSnapshot) => void, opts?: { signal?: AbortSignal }): () => void;
  /** 절대 시각 목록의 경계 통과 시 배치당 1회 호출. 등록 시점(또는 첫 동기화 시점)에 이미 지난 값은 발화하지 않고, 한 번 발화한 값은 다시 발화하지 않는다. */
  watch(targets: readonly number[], cb: (crossed: number[]) => void, opts?: { signal?: AbortSignal }): () => void;
  /** KST 날짜가 바뀌면 새 날짜('YYYY-MM-DD')로 호출 */
  onDayChange(cb: (kstDate: string) => void, opts?: { signal?: AbortSignal }): () => void;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function kstParts(epochMs: number) {
  const d = new Date(epochMs + KST_OFFSET_MS);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), ms: d.getUTCMilliseconds() };
}
export function kstDateKey(epochMs: number): string {
  const p = kstParts(epochMs);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}
export function formatKstTime(epochMs: number): string {
  const p = kstParts(epochMs);
  return `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}
export function kstIso(epochMs: number): string {
  const p = kstParts(epochMs);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}.${pad(p.ms, 3)}+09:00`;
}
/** epochMs 이후 처음 오는 KST 자정(epoch ms) */
export function nextKstMidnight(epochMs: number): number {
  const day = Math.floor((epochMs + KST_OFFSET_MS) / 86_400_000);
  return (day + 1) * 86_400_000 - KST_OFFSET_MS;
}

/** /api/time 응답 검증. 시간대가 Asia/Seoul(+540분)로 명시되지 않으면 거부한다. */
export function parseServerTimePayload(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { epochMs?: unknown; timeZone?: unknown; utcOffsetMinutes?: unknown };
  if (typeof b.epochMs !== 'number' || !Number.isFinite(b.epochMs) || b.epochMs <= 0) return null;
  if (b.timeZone !== SERVER_TIME_ZONE || b.utcOffsetMinutes !== 540) return null;
  return b.epochMs;
}

interface Anchor { serverMs: number; perf: number; wall: number; rtt: number }
interface Watch { pending: Set<number>; armed: boolean; cb: (crossed: number[]) => void }

export function createServerClock(options: ClockOptions = {}): ServerClock {
  const g = globalThis as unknown as {
    fetch: FetchLike; performance: { now(): number }; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void;
    document?: ClockDeps['doc']; window?: EventTargetLike; AbortController: typeof AbortController;
  };
  const d: ClockDeps = {
    fetch: (u, i) => g.fetch(u, i),
    perfNow: () => g.performance.now(),
    wallNow: () => Date.now(),
    setTimeout: (fn, ms) => g.setTimeout(fn, ms),
    clearTimeout: (h) => g.clearTimeout(h),
    doc: g.document ?? null,
    win: g.window ?? null,
    ...options.deps,
  };
  const url = options.url ?? '/api/time';
  const resyncMs = Math.max(5_000, options.resyncMs ?? 60_000);
  const timeoutMs = options.timeoutMs ?? 4_000;
  const samples = Math.max(1, Math.min(5, options.samples ?? 3));
  const maxRttMs = options.maxRttMs ?? 3_000;
  const staleAfterMs = options.staleAfterMs ?? 180_000;
  const jumpTol = options.jumpToleranceMs ?? 2_000;

  let anchor: Anchor | null = null;
  let everSynced = false;
  let lastError: string | null = null;
  let failures = 0;
  let inflight: Promise<ClockSnapshot> | null = null;
  let inflightCtl: AbortController | null = null;
  let resyncTimer: unknown = null;
  let checkTimer: unknown = null;
  let started = false;
  let destroyed = false;
  let lastDay: string | null = null;
  let lastStatus: ClockStatus | null = null;
  const changeCbs = new Set<(s: ClockSnapshot) => void>();
  const dayCbs = new Set<(day: string) => void>();
  const watches = new Set<Watch>();

  const visible = () => !d.doc || d.doc.visibilityState !== 'hidden';

  function now(): number | null {
    if (!anchor) return null;
    return anchor.serverMs + (d.perfNow() - anchor.perf);
  }
  function status(): ClockStatus {
    if (!anchor) return inflight ? 'syncing' : everSynced || lastError ? 'error' : 'unsynced';
    return d.perfNow() - anchor.perf > staleAfterMs ? 'stale' : 'synced';
  }
  function state(): ClockSnapshot {
    return {
      status: status(),
      uncertaintyMs: anchor ? anchor.rtt / 2 : null,
      rttMs: anchor ? anchor.rtt : null,
      lastSyncAgeMs: anchor ? Math.max(0, d.perfNow() - anchor.perf) : null,
      lastError,
      refreshing: !!inflight,
    };
  }
  function emit() {
    const s = state();
    lastStatus = s.status;
    for (const cb of [...changeCbs]) { try { cb(s); } catch { /* 소비자 오류가 시계를 멈추지 않게 */ } }
  }

  /** 절전 등으로 단조 시계가 멈췄던 경우: 기준점이 틀렸으므로 버리고 재동기 */
  function detectJump(): boolean {
    if (!anchor) return false;
    const drift = (d.wallNow() - anchor.wall) - (d.perfNow() - anchor.perf);
    if (Math.abs(drift) <= jumpTol) return false;
    anchor = null;
    lastError = 'clock_jump';
    clearCheck();
    emit();
    void sync();
    return true;
  }

  function armWatches(n: number) {
    for (const w of watches) {
      if (w.armed) continue;
      for (const t of [...w.pending]) if (t <= n) w.pending.delete(t); // 처음 관측 시 이미 지난 경계: 통과가 아니라 늦은 관측
      w.armed = true;
    }
  }

  function clearCheck() { if (checkTimer != null) { d.clearTimeout(checkTimer); checkTimer = null; } }

  function check() {
    clearCheck();
    if (destroyed || !anchor) return;
    if (detectJump()) return;
    const n = now() as number;
    armWatches(n);
    for (const w of [...watches]) {
      if (!watches.has(w)) continue;
      const crossed = [...w.pending].filter((t) => t <= n).sort((a, b) => a - b);
      if (!crossed.length) continue;
      for (const t of crossed) w.pending.delete(t);
      try { w.cb(crossed); } catch { /* ignore */ }
    }
    const day = kstDateKey(n);
    if (lastDay !== null && day !== lastDay) for (const cb of [...dayCbs]) { try { cb(day); } catch { /* ignore */ } }
    lastDay = day;
    const s = status();
    if (s !== lastStatus) emit();
    if (!visible()) return; // 숨김 상태에서는 타이머를 걸지 않는다(보이면 즉시 재검사)
    let next = nextKstMidnight(n);
    for (const w of watches) for (const t of w.pending) if (t < next) next = t;
    if (s === 'synced' && anchor) next = Math.min(next, anchor.serverMs + staleAfterMs + 1);
    const delay = Math.max(0, Math.min(next - n, 30_000)); // 긴 대기는 30초 단위로 쪼개 절전 감지 기회를 둔다
    checkTimer = d.setTimeout(check, delay + 1);
  }

  async function sampleOnce(outer: AbortSignal): Promise<Anchor> {
    const ctl = new g.AbortController();
    const onAbort = () => ctl.abort();
    outer.addEventListener('abort', onAbort);
    const to = d.setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const t0 = d.perfNow();
      let res;
      try {
        res = await d.fetch(url, { cache: 'no-store', credentials: 'omit', headers: { accept: 'application/json' }, signal: ctl.signal });
      } catch (e) {
        throw new Error(outer.aborted ? 'aborted' : ctl.signal.aborted ? 'timeout' : 'network');
      }
      const t1 = d.perfNow(); // 헤더 도착 시점(서버는 응답 직전에 시각을 찍는다)
      if (!res.ok) throw new Error(`http_${res.status}`);
      let body: unknown;
      try { body = await res.json(); } catch { throw new Error(ctl.signal.aborted ? 'timeout' : 'bad_payload'); }
      if (ctl.signal.aborted) throw new Error(outer.aborted ? 'aborted' : 'timeout');
      const epochMs = parseServerTimePayload(body);
      if (epochMs == null) throw new Error('bad_payload');
      const rtt = t1 - t0;
      if (!(rtt >= 0)) throw new Error('bad_rtt');
      if (rtt > maxRttMs) throw new Error('rtt_too_high');
      // 중간점: 서버가 찍은 시각은 요청~응답 왕복의 가운데에 해당한다고 본다(최대 오차 RTT/2)
      return { serverMs: epochMs + rtt / 2, perf: t1, wall: d.wallNow(), rtt };
    } finally {
      d.clearTimeout(to);
      outer.removeEventListener('abort', onAbort);
    }
  }

  function scheduleResync() {
    if (resyncTimer != null) { d.clearTimeout(resyncTimer); resyncTimer = null; }
    if (destroyed || !started || !visible()) return;
    const delay = failures ? Math.min(resyncMs, 5_000 * 2 ** (failures - 1)) : resyncMs;
    resyncTimer = d.setTimeout(() => { resyncTimer = null; void sync(); }, delay);
  }

  function sync(): Promise<ClockSnapshot> {
    if (destroyed) return Promise.resolve(state());
    if (inflight) return inflight;
    const ctl = new g.AbortController();
    inflightCtl = ctl;
    inflight = (async () => {
      let best: Anchor | null = null;
      let err: string | null = null;
      for (let i = 0; i < samples && !ctl.signal.aborted; i++) {
        try {
          const a = await sampleOnce(ctl.signal);
          if (!best || a.rtt < best.rtt) best = a;
        } catch (e) { err = (e as Error).message; if (err === 'aborted') break; }
      }
      return { best, err };
    })().then(({ best, err }) => {
      inflight = null;
      inflightCtl = null;
      if (destroyed || ctl.signal.aborted) return state();
      if (best) {
        // 여러 표본의 기준 시점을 가장 좋은 표본에 맞춘다(단조 시계 기준이므로 표본 간 경과는 정확)
        anchor = best;
        everSynced = true;
        lastError = null;
        failures = 0;
      } else {
        lastError = err || 'unknown';
        failures++;
      }
      emit();
      check();
      scheduleResync();
      return state();
    });
    emit();
    return inflight;
  }

  const onVisibility = () => {
    if (destroyed) return;
    if (visible()) { check(); void sync(); } else { clearCheck(); if (resyncTimer != null) { d.clearTimeout(resyncTimer); resyncTimer = null; } }
  };
  const onOnline = () => { if (!destroyed) void sync(); };

  function start() {
    if (started || destroyed) return;
    started = true;
    d.doc?.addEventListener('visibilitychange', onVisibility);
    d.win?.addEventListener('online', onOnline);
    void sync();
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    inflightCtl?.abort();
    clearCheck();
    if (resyncTimer != null) d.clearTimeout(resyncTimer);
    resyncTimer = null;
    d.doc?.removeEventListener('visibilitychange', onVisibility);
    d.win?.removeEventListener('online', onOnline);
    changeCbs.clear(); dayCbs.clear(); watches.clear();
  }
  function bindSignal(signal: AbortSignal | undefined, off: () => void) {
    if (!signal) return off;
    if (signal.aborted) { off(); return off; }
    signal.addEventListener('abort', off, { once: true });
    return off;
  }

  const clock: ServerClock = {
    now, state, sync, start, destroy,
    onChange(cb, opts) {
      changeCbs.add(cb);
      return bindSignal(opts?.signal, () => { changeCbs.delete(cb); });
    },
    watch(targets, cb, opts) {
      const w: Watch = { pending: new Set(targets.filter((t) => typeof t === 'number' && Number.isFinite(t))), armed: false, cb };
      if (opts?.signal?.aborted) return () => {};
      watches.add(w);
      const n = now();
      if (n != null) { armWatches(n); check(); }
      return bindSignal(opts?.signal, () => { watches.delete(w); });
    },
    onDayChange(cb, opts) {
      dayCbs.add(cb);
      if (anchor) check();
      return bindSignal(opts?.signal, () => { dayCbs.delete(cb); });
    },
  };
  if (options.signal) bindSignal(options.signal, destroy);
  if (options.autoStart) start();
  return clock;
}

let shared: ServerClock | null = null;
/** 앱 전체에서 하나만 쓰는 서버시계(헤더·홈이 같은 기준점과 요청을 공유). */
export function sharedServerClock(): ServerClock {
  if (!shared) shared = createServerClock({ autoStart: true });
  return shared;
}

/* ---------------- 티켓 판매 구간 (순수 함수) ---------------- */

const ABS_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|[+-]\d{2}:?\d{2})$/i;

/** 절대 시각(Z 또는 ±HH:MM 명시)만 받는다. 날짜만 있거나 시간대가 없는 문자열은 null(시간대를 추측하지 않음). epoch ms 숫자는 절대 시각으로 허용. */
export function parseAbsoluteInstant(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = ABS_RE.exec(v.trim());
  if (!m) return null;
  const [y, mo, da, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const s = m[6] ? Number(m[6]) : 0;
  const frac = m[7] ? Number(`0.${m[7]}`) * 1000 : 0;
  if (mo < 1 || mo > 12 || da < 1 || h > 23 || mi > 59 || s > 59) return null;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (da > dim) return null;
  let offMin = 0;
  const z = m[8].toUpperCase();
  if (z !== 'Z') {
    const sign = z[0] === '-' ? -1 : 1;
    const digits = z.slice(1).replace(':', '');
    const oh = Number(digits.slice(0, 2)); const om = Number(digits.slice(2, 4));
    if (oh > 14 || om > 59) return null;
    offMin = sign * (oh * 60 + om);
  }
  return Date.UTC(y, mo - 1, da, h, mi, s) + Math.floor(frac) - offMin * 60_000;
}

export type TicketPhase = 'unknown' | 'upcoming' | 'open' | 'closed';
export interface TicketSaleInput { opensAt?: string | number | null; closesAt?: string | number | null }
export interface TicketSaleState {
  phase: TicketPhase;
  reason: 'clock_unsynced' | 'no_schedule' | 'ambiguous_time' | 'invalid_window' | 'open_time_unknown' | 'before_open' | 'within_window' | 'after_close';
  opensAtMs: number | null;
  closesAtMs: number | null;
  msUntilOpen: number | null;
  msUntilClose: number | null;
  nextBoundaryMs: number | null;
  /** 현재 시각이 경계와 동기화 오차(uncertaintyMs) 이내 */
  boundaryUncertain: boolean;
  /** 판매 구간만 판단한다. 잔여석·구매 가능 여부는 예매처에서만 확인 가능 */
  availability: 'unconfirmed';
}

export function ticketSaleState(input: TicketSaleInput, serverNowMs: number | null, opts: { uncertaintyMs?: number | null } = {}): TicketSaleState {
  const openGiven = input.opensAt != null && input.opensAt !== '';
  const closeGiven = input.closesAt != null && input.closesAt !== '';
  const o = openGiven ? parseAbsoluteInstant(input.opensAt) : null;
  const c = closeGiven ? parseAbsoluteInstant(input.closesAt) : null;
  const base = { opensAtMs: o, closesAtMs: c, msUntilOpen: null, msUntilClose: null, nextBoundaryMs: null, boundaryUncertain: false, availability: 'unconfirmed' as const };
  const out = (phase: TicketPhase, reason: TicketSaleState['reason'], extra: Partial<TicketSaleState> = {}): TicketSaleState => ({ ...base, phase, reason, ...extra });
  if ((openGiven && o == null) || (closeGiven && c == null)) return out('unknown', 'ambiguous_time');
  if (o == null && c == null) return out('unknown', 'no_schedule');
  if (o != null && c != null && c <= o) return out('unknown', 'invalid_window');
  if (serverNowMs == null || !Number.isFinite(serverNowMs)) return out('unknown', 'clock_unsynced');
  const n = serverNowMs;
  const u = Math.max(0, opts.uncertaintyMs ?? 0);
  const near = (t: number | null) => t != null && Math.abs(t - n) <= u;
  const boundaryUncertain = near(o) || near(c);
  if (o != null && n < o) return out('upcoming', 'before_open', { msUntilOpen: o - n, msUntilClose: c != null ? c - n : null, nextBoundaryMs: o, boundaryUncertain });
  if (c != null && n >= c) return out('closed', 'after_close', { boundaryUncertain });
  if (o == null) return out('unknown', 'open_time_unknown', { msUntilClose: (c as number) - n, nextBoundaryMs: c, boundaryUncertain });
  return out('open', 'within_window', { msUntilClose: c != null ? c - n : null, nextBoundaryMs: c, boundaryUncertain });
}

/** clock.watch()에 넘길 경계 목록(시간대가 명시된 값만, 중복 제거·정렬) */
export function ticketBoundaries(windows: readonly TicketSaleInput[]): number[] {
  const set = new Set<number>();
  for (const w of windows) for (const v of [w.opensAt, w.closesAt]) {
    const t = parseAbsoluteInstant(v);
    if (t != null) set.add(t);
  }
  return [...set].sort((a, b) => a - b);
}

/* ---------------- 화면 시계 ---------------- */

export interface ServerClockLabels { title: string; unsynced: string; syncing: string; error: string; stale: (ageMin: number) => string; precision: (sec: string) => string; hint: string }
export const SERVER_CLOCK_LABELS: Record<'ko' | 'ja', ServerClockLabels> = {
  ko: {
    title: '서버시간 KST', unsynced: '미동기화', syncing: '동기화 중', error: '서버시간 확인 실패',
    stale: (m) => `마지막 동기화 ${m}분 전`, precision: (s) => `오차 ±${s}초`,
    hint: 'Lilac 서버(Asia/Seoul) 기준 시각입니다. 예매처 서버 시각과 다를 수 있습니다.',
  },
  ja: {
    title: 'サーバー時刻 KST', unsynced: '未同期', syncing: '同期中', error: 'サーバー時刻を取得できません',
    stale: (m) => `最終同期 ${m}分前`, precision: (s) => `誤差 ±${s}秒`,
    hint: 'Lilacサーバー(Asia/Seoul)基準の時刻です。販売サイトのサーバー時刻とは異なる場合があります。',
  },
};

export function mountServerClock(host: HTMLElement, clock: ServerClock, opts: { signal?: AbortSignal; labels?: Partial<ServerClockLabels>; compact?: boolean } = {}): { destroy(): void } {
  const L: ServerClockLabels = { ...SERVER_CLOCK_LABELS.ko, ...opts.labels };
  const doc = host.ownerDocument;
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  const root = doc.createElement('div');
  root.className = 'lc-server-clock' + (opts.compact ? ' is-compact' : '');
  root.title = L.hint;
  const label = doc.createElement('span'); label.className = 'lc-sc-label'; label.textContent = L.title;
  const time = doc.createElement('time'); time.className = 'lc-sc-time';
  const note = doc.createElement('span'); note.className = 'lc-sc-note';
  root.append(label, time, note);
  host.append(root);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dead = false;
  const setT = (fn: () => void, ms: number) => (win ? win.setTimeout(fn, ms) : setTimeout(fn, ms)) as ReturnType<typeof setTimeout>;
  const clrT = (h: ReturnType<typeof setTimeout>) => (win ? win.clearTimeout(h) : clearTimeout(h));

  function render() {
    if (timer != null) { clrT(timer); timer = null; }
    if (dead) return;
    const s = clock.state();
    const n = clock.now();
    root.dataset.state = s.status;
    if (n == null) {
      time.textContent = '';
      time.removeAttribute('datetime');
      time.hidden = true;
      note.textContent = s.status === 'syncing' ? L.syncing : s.status === 'error' ? L.error : L.unsynced;
      return; // 시각을 모르면 표시하지 않는다(로컬 시계로 대체 금지)
    }
    time.hidden = false;
    time.textContent = formatKstTime(n);
    time.dateTime = kstIso(n);
    if (s.status === 'stale') note.textContent = L.stale(Math.max(1, Math.floor((s.lastSyncAgeMs ?? 0) / 60_000)));
    else note.textContent = s.uncertaintyMs != null ? L.precision((Math.max(0.1, Math.ceil(s.uncertaintyMs / 100) / 10)).toFixed(1)) : '';
    if (doc.visibilityState === 'hidden') return;
    timer = setT(render, 1000 - (((n % 1000) + 1000) % 1000) + 5); // 서버 기준 초 경계에 맞춰 갱신
  }
  const onVis = () => render();
  const offChange = clock.onChange(() => render());
  doc.addEventListener('visibilitychange', onVis);
  render();
  const destroy = () => {
    if (dead) return;
    dead = true;
    if (timer != null) clrT(timer);
    offChange();
    doc.removeEventListener('visibilitychange', onVis);
    root.remove();
  };
  if (opts.signal) { if (opts.signal.aborted) destroy(); else opts.signal.addEventListener('abort', destroy, { once: true }); }
  return { destroy };
}
