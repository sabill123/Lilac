/* 아티스트 아트워크 보강.
   44팀 중 11팀에 artwork 가 비어 있었다. 전부 appleArtistId 는 있으므로
   애플 lookup 으로 최신 앨범 커버를 가져와 채운다.
   화면에서 빈 자리를 회색 박스로 두는 것보다, 있는 출처를 쓰는 게 맞다. */
const UA = { 'User-Agent': 'Lilac/1.0 (+https://github.com/sabill123/Lilac)' };

async function j(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** 애플 아티스트 ID → 최신 앨범 커버 URL */
export async function artworkFor(appleId, country = 'jp') {
  // entity=album, sort 없이 받아 releaseDate 로 최신을 고른다
  const d = await j(
    `https://itunes.apple.com/lookup?id=${appleId}&entity=album&limit=25&country=${country}`,
  );
  const albums = (d.results || []).filter((x) => x.wrapperType === 'collection' && x.artworkUrl100);
  if (!albums.length) return null;
  albums.sort((a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')));
  // 100x100 으로 오므로 큰 판으로 바꿔 저장한다
  return albums[0].artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.');
}

export async function backfillArtwork(artists, { log = () => {} } = {}) {
  let filled = 0;
  let failed = 0;
  for (const a of artists) {
    if (a.artwork) continue;
    const id = a.appleArtistId || a.appleId;
    if (!id) { failed++; continue; }
    try {
      const url = await artworkFor(id, a.country === 'kr' ? 'kr' : 'jp');
      if (url) {
        a.artwork = url;
        a.artworkSource = 'apple-lookup';
        filled++;
        log(`  ✓ ${a.name} → ${url.slice(0, 62)}…`);
      } else {
        failed++;
        log(`  · ${a.name} — 앨범 없음`);
      }
    } catch (e) {
      failed++;
      log(`  ✗ ${a.name} — ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 260)); // 애플 레이트리밋 존중
  }
  return { filled, failed };
}
