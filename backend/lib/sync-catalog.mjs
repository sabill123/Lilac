/* 곡 카탈로그 동기화.

   왜 필요한가: 아티스트 페이지가 매 조회마다 애플을 실시간으로 불렀다
   (term 검색 10곡 + 앨범 12개). 레이트리밋에 그대로 노출되고, 이름 검색이라
   동명 아티스트가 섞일 수 있으며, 곡이 10곡에서 끝났다.

   엔터사 제휴 없이 곡 데이터를 넓히려면 공개 카탈로그를 '저장'해야 한다.
   애플 lookup 은 아티스트 ID 로 스토어별 최대 200곡을 30초 프리뷰·아트워크·
   발매일과 함께 준다(키 불필요). 일본·한국 스토어를 합쳐 한 팀당 카탈로그를 만든다.

   지키는 것:
   · 아티스트 ID 로만 조회한다 (이름 검색 금지 — 동명이인 방지)
   · 못 물어본 것과 결과가 없는 것을 구분한다. 실패하면 이전 카탈로그를 유지한다
   · 200곡 상한에 걸린 팀은 capped:true 로 남긴다 — 전부인 척하지 않는다
   · 애플 레이트리밋을 존중한다 (호출 간격, 빈 응답 재시도) */

const UA = { 'User-Agent': 'Lilac/1.0 (+https://github.com/sabill123/Lilac)' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const LIMIT = 200;

/** 실패(null) / 성공(JSON) 을 구분해 돌려준다 */
async function lookup(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      const t = await r.text();
      if (t.trim().startsWith('{')) return JSON.parse(t);
    } catch { /* 재시도 */ }
    await wait(700 * (i + 1));
  }
  return null;
}

function toTrack(x, store) {
  return {
    id: x.trackId,
    title: x.trackName,
    album: x.collectionName,
    albumId: x.collectionId,
    releaseDate: (x.releaseDate || '').slice(0, 10),
    artwork: (x.artworkUrl100 || '').replace('100x100', '600x600'),
    preview: x.previewUrl || null,
    appleUrl: x.trackViewUrl || null,
    durationMs: x.trackTimeMillis || null,
    genre: x.primaryGenreName || null,
    disc: x.discNumber || 1,
    no: x.trackNumber || null,
    stores: [store],
  };
}

/** 한 아티스트의 카탈로그. 실패면 null, 없으면 { tracks: [] } */
export async function fetchArtistCatalog(appleArtistId, { stores = ['jp', 'kr'] } = {}) {
  const byId = new Map();
  let anyFailed = false;
  let capped = false;
  for (const cc of stores) {
    const d = await lookup(`https://itunes.apple.com/lookup?id=${appleArtistId}&entity=song&limit=${LIMIT}&country=${cc}`);
    await wait(350);
    if (!d) { anyFailed = true; continue; }
    const songs = (d.results || []).filter((x) => x.wrapperType === 'track' && x.trackId);
    if (songs.length >= LIMIT) capped = true;
    for (const s of songs) {
      const cur = byId.get(s.trackId);
      if (cur) { if (!cur.stores.includes(cc)) cur.stores.push(cc); continue; }
      byId.set(s.trackId, toTrack(s, cc));
    }
  }
  // 두 스토어 모두 실패 → 못 물어본 것
  if (anyFailed && byId.size === 0) return null;
  const tracks = [...byId.values()].sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''));
  return { tracks, capped, partial: anyFailed };
}

export async function syncCatalog(artists, prev = { artists: {} }, { log = () => {}, maxAgeH = 24 * 7, force = false } = {}) {
  const out = { builtAt: new Date().toISOString(), artists: { ...(prev.artists || {}) } };
  let updated = 0, kept = 0, failed = 0, skipped = 0;
  const now = Date.now();
  for (const a of artists) {
    /* 신원 확인에서 Apple 연결이 끊긴 행은 예전(틀린) 곡 목록도 지운다 */
    if (!a.appleArtistId) { if (out.artists[a.id]?.appleArtistId) delete out.artists[a.id]; skipped++; continue; }
    const old = out.artists[a.id];
    /* Apple 아티스트가 바뀌었으면(신원 수정) 신선도와 상관없이 다시 받는다 */
    const changed = old && String(old.appleArtistId) !== String(a.appleArtistId);
    if (!force && !changed && old?.fetchedAt && (now - Date.parse(old.fetchedAt)) / 36e5 < maxAgeH) { kept++; continue; }
    const r = await fetchArtistCatalog(a.appleArtistId);
    if (!r) {
      failed++;
      log(`  ✗ ${a.name} — 조회 실패 (이전 카탈로그 ${old ? old.tracks.length + '곡 유지' : '없음'})`);
      continue;                                  // 못 받아온 것을 근거로 지우지 않는다
    }
    // 새 결과가 이전보다 크게 적으면(부분 실패 의심) 이전 것을 지킨다
    if (old && !changed && r.partial && r.tracks.length < old.tracks.length * 0.6) {
      failed++;
      log(`  · ${a.name} — 부분 실패(${r.tracks.length}곡 < 이전 ${old.tracks.length}곡) 이전 유지`);
      continue;
    }
    out.artists[a.id] = {
      name: a.name, appleArtistId: a.appleArtistId, fetchedAt: new Date().toISOString(),
      capped: r.capped, partial: r.partial, count: r.tracks.length, tracks: r.tracks,
    };
    updated++;
    log(`  ✓ ${a.name} — ${r.tracks.length}곡${r.capped ? ' (상한)' : ''}`);
  }
  return { catalog: out, stats: { updated, kept, failed, skipped, artists: Object.keys(out.artists).length,
    tracks: Object.values(out.artists).reduce((s, x) => s + (x.count || 0), 0) } };
}
