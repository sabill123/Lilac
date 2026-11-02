/* 서버 시각 기준점. 티켓 오픈 경계는 사용자의 PC 시계가 아니라 이 응답을 기준으로 계산한다.
   인증 불필요, 요청 본문/쿼리를 읽지 않으며 응답은 고정 크기다. 캐시 금지(no-store). */
export const SERVER_TIME_ZONE = 'Asia/Seoul';
export const SERVER_UTC_OFFSET_MINUTES = 540; // Asia/Seoul: 1988년 이후 일광절약시간 없음, UTC+09:00 고정

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

/** epoch ms → 'YYYY-MM-DDTHH:mm:ss.sss+09:00' (KST 벽시계 표기). */
export function kstIso(epochMs) {
  const d = new Date(epochMs + SERVER_UTC_OFFSET_MINUTES * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}+09:00`;
}

export function serverTimePayload(epochMs) {
  if (!Number.isFinite(epochMs)) throw new TypeError('epochMs must be finite');
  return {
    ok: true,
    epochMs: Math.trunc(epochMs),
    iso: new Date(epochMs).toISOString(),
    kst: kstIso(epochMs),
    timeZone: SERVER_TIME_ZONE,
    utcOffsetMinutes: SERVER_UTC_OFFSET_MINUTES,
    source: 'server-system-clock',
  };
}

/** Express 핸들러. now는 테스트용 주입 지점이며 기본은 서버 시스템 시계(NTP 동기는 호스트 책임). */
export function serverTimeHandler({ now = () => Date.now() } = {}) {
  return function serverTime(_req, res) {
    const body = serverTimePayload(now()); // 응답 직전에 찍어 처리 지연을 줄인다
    res.set('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.status(200).json(body);
  };
}
