/* 이미지 재확인 규칙과 제한된 백그라운드 큐
 *
 * 왜: 홈·아티스트 응답은 '현재 공식 프로필 사진'을 24시간 안에 확인된 것만 낸다(배너 입장 조건).
 *     그런데 다시 확인하는 길이 프런트의 /api/live/portraits 호출뿐이라, 하루가 지나면 첫 응답에는 공식 사진이 비고
 *     (운영 격리DB 2026-11-02 08:09 UTC: 같은 홈 응답이 공식 0 → 20, 사진 16 → 27/59) Deezer 사진만 남았다.
 *     또 이름 기반 사진 캐시는 '없음' 판정(v2)을 영원히 다시 보지 않았다.
 * 규칙
 *   - 큐는 대기+실행 12개 상한, 같은 키는 하나로 합친다(대기·실행 중이면 다시 넣지 않는다), 동시 실행 상한을 둔다
 *   - 실패한 키는 15분 → 1시간 → 4시간 → 16시간 → 24시간(상한)으로 자동 쉬었다가 다시 시도한다. 성공하면 초기화
 *   - '없음' 판정은 규칙 버전(rule)과 TTL로 저장한다. 규칙이 올라가거나 TTL이 지나면 자동으로 다시 본다
 *   - 상태 출력은 개수·사유만(주소·자격증명·행 전체는 내지 않는다)
 */

export const FAILURE_COOLDOWN_BASE_MS = 15 * 60e3;
export const FAILURE_COOLDOWN_MAX_MS = 24 * 3600e3;

/** 연속 실패 n번째 뒤에 쉬는 시간 */
export function failureCooldownMs(failures) {
  const n = Math.max(1, Math.floor(Number(failures) || 1));
  return Math.min(FAILURE_COOLDOWN_MAX_MS, FAILURE_COOLDOWN_BASE_MS * 4 ** (n - 1));
}

/**
 * 저장된 사진 판정을 다시 볼 때인가.
 * prev: { photo?, at?, v? } — photo가 있으면 positiveMs, 없으면(없음 판정) 규칙 버전이 낮거나 negativeMs가 지났을 때
 */
export function recheckDue(prev, { rule, now = Date.now(), positiveMs, negativeMs }) {
  if (!prev || typeof prev !== 'object') return true;
  const age = now - (Number(prev.at) || 0);
  if (prev.photo) return age >= positiveMs;
  if ((Number(prev.v) || 1) < rule) return true;
  return age >= negativeMs;
}

/**
 * 제한된 백그라운드 큐.
 * run(payload) → { ok: boolean, reason?: string } (예외는 { ok:false, reason:'error' })
 * enqueue(key, payload) → 'queued' | 'duplicate' | 'cooldown' | 'full'
 */
export function createRefreshQueue({ run, max = 12, concurrency = 3, now = () => Date.now(), cooldown = failureCooldownMs, pauseMs = 0 } = {}) {
  if (typeof run !== 'function') throw new TypeError('run required');
  const pending = new Map();          // key → payload (삽입 순서 = 실행 순서)
  const active = new Set();
  const failures = new Map();         // key → { count, until, reason }
  const counts = { queued: 0, duplicate: 0, cooldown: 0, full: 0, ok: 0, failed: 0 };
  const reasons = {};
  let running = 0;
  let idleWaiters = [];

  function enqueue(key, payload) {
    if (typeof key !== 'string' || !key) throw new TypeError('key required');
    if (pending.has(key) || active.has(key)) { counts.duplicate++; return 'duplicate'; }
    const f = failures.get(key);
    if (f && now() < f.until) { counts.cooldown++; return 'cooldown'; }
    if (pending.size + active.size >= max) { counts.full++; return 'full'; }
    pending.set(key, payload);
    counts.queued++;
    pump();
    return 'queued';
  }

  function pump() {
    while (running < concurrency && pending.size) {
      const [key, payload] = pending.entries().next().value;
      pending.delete(key);
      active.add(key);
      running++;
      (async () => {
        let r;
        try { r = await run(payload); } catch { r = { ok: false, reason: 'error' }; }
        if (r?.ok) { failures.delete(key); counts.ok++; }
        else {
          const reason = typeof r?.reason === 'string' && r.reason.length <= 60 ? r.reason : 'unavailable';
          const prev = failures.get(key);
          const count = (prev?.count || 0) + 1;
          failures.set(key, { count, until: now() + cooldown(count), reason });
          counts.failed++;
          reasons[reason] = (reasons[reason] || 0) + 1;
        }
        if (pauseMs) await new Promise((res) => setTimeout(res, pauseMs));
      })().finally(() => {
        active.delete(key);
        running--;
        pump();
        if (!running && !pending.size) { const w = idleWaiters; idleWaiters = []; w.forEach((fn) => fn()); }
      });
    }
  }

  /** 테스트·종료용: 대기와 실행이 모두 끝날 때까지 */
  function idle() { return !running && !pending.size ? Promise.resolve() : new Promise((res) => idleWaiters.push(res)); }
  function failureOf(key) { const f = failures.get(key); return f ? { count: f.count, until: f.until, reason: f.reason } : null; }
  function stats() {
    const cooling = [...failures.values()].filter((f) => now() < f.until).length;
    return { pending: pending.size, active: active.size, coolingDown: cooling, max, concurrency, ...counts, reasons: { ...reasons } };
  }
  return { enqueue, idle, stats, failureOf };
}

/**
 * 일반 썸네일용 아티스트 사진 선택 — 현재 공식 프로필이 있으면 먼저, 없으면 기존 Deezer 아티스트 사진.
 * 출처를 정직하게 붙인다. 앨범 재킷(artwork)은 아티스트 사진이 아니므로 여기서 고르지 않는다.
 * portrait: currentPortrait 결과(24시간 안 확인, 같은 아티스트·공식 주소) 또는 null
 * deezer: photos KV 값 { photo, medium, at } 또는 null
 */
export function artistPhoto({ portrait = null, deezer = null } = {}) {
  if (portrait?.status === 'verified' && portrait.imageUrl) {
    return { url: portrait.imageUrl, large: portrait.imageUrl, kind: 'official-profile', sourceUrl: portrait.sourceUrl || null, checkedAt: portrait.checkedAt || null };
  }
  const medium = deezer?.medium || deezer?.photo || null;
  if (medium) {
    return { url: medium, large: deezer.photo || medium, kind: 'deezer-artist', sourceUrl: null, checkedAt: Number(deezer.at) ? new Date(Number(deezer.at)).toISOString() : null };
  }
  return null;
}

/** 공연 썸네일 대체: 아티스트 사진이 없을 때만 그 아티스트 자신의 음악 재킷. 종류를 분리해서 낸다 */
export function artistFallbackImage({ portrait = null, deezer = null, artwork = null } = {}) {
  const p = artistPhoto({ portrait, deezer });
  if (p) return { url: p.url, kind: p.kind, sourceUrl: p.sourceUrl };
  if (typeof artwork === 'string' && artwork) return { url: artwork, kind: 'album-cover', sourceUrl: null };
  return null;
}

/**
 * 포스터가 끝내 없는 공연의 사유(fail-closed). eventPoster: event-posters KV 값, queued: 지금 재확인 대기 중인지
 */
export function posterMissingReason({ eventPoster = undefined, eligible = false, queued = false } = {}) {
  if (!eligible) return 'no_image_source';
  if (eventPoster?.none) return 'event_page_has_no_image';
  if (queued || !eventPoster) return 'pending_event_page_check';
  return 'event_page_image_rejected';
}
