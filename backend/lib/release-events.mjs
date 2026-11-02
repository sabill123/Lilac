/* 릴리스(자동 동기화) → 발매 일정 */
/* 발매 일정: 예전엔 collect-events.mjs(수동 실행)로 만든 행만 있어 8월 12일 이후 발매가 하나도 없었다.
   릴리스 동기화(6시간)가 이미 Apple 카탈로그의 실제 발매를 모으므로, 거기서 발매 일정을 만든다.
   같은 앨범(Apple collectionId)이 예전 수동 행에도 있으면 새 행 하나만 남긴다. 발매일 없는 릴리스는 만들지 않는다. */
export function releaseEventsFrom(releases) {
  const out = [];
  for (const r of releases || []) {
    const date = String(r.releaseDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !r.title) continue;
    const apple = String(r.id || '').match(/^ap-(\d+)$/)?.[1] || String(r.appleUrl || '').match(/\/(\d+)(?:\?|$)/)?.[1] || null;
    out.push({
      id: apple ? `rel-${apple}` : `rel-${r.id}`,
      type: '발매',
      title: r.title,
      artist: r.artistKo || r.artist,
      artistId: r.artistId || null,
      country: r.country || null,
      date,
      venue: '전 플랫폼',
      artwork: r.artwork || null,
      appleUrl: r.appleUrl || null,
      trackCount: r.trackCount || 0,
      isDemo: false,
      source: r.source?.name || 'Apple iTunes API',
      releaseId: r.id,
    });
  }
  return out;
}
