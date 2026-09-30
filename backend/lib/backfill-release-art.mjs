/* 릴리스 커버 보강.
   131건 중 3건에 artwork 가 없었다. 전부 curated(사람이 특전까지 확인한) 릴리스라
   스토어에서 가장 눈에 띄는 자리인데 커버가 비어 있었다.

   출처 우선순위와, 쓰지 않기로 한 것:
   1) 애플 카탈로그에서 '제목과 아티스트가 정확히 일치'하는 앨범 — 채택
   2) 레이블 공식 사이트의 og:image — 채택하지 않는다.
      실제로 받아보니 유니버설은 「タイトル未発表」(제목 미발표) 배너였고
      위버스는 아티스트 샵 로고였다. 둘 다 앨범 커버가 아니다.
      커버처럼 보이게 걸면 없는 아트워크를 있는 것처럼 만드는 셈이다.
   3) 아무것도 못 찾으면 비워 둔다. 화면은 '커버 미공개'로 표시한다. */

const UA = { 'User-Agent': 'Lilac/1.0 (+https://github.com/sabill123/Lilac)' };
const j = async (u) => {
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

/** 비교용 정규화 — 표기 흔들림(전각/괄호/공백)을 흡수하되 단어는 남긴다 */
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[「」『』（）()\[\]'"’”“·・.,\-–—:：]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** 제목이 사실상 같은가. 한쪽이 다른 쪽을 온전히 포함하면 같다고 본다
 *  (애플은 "TWS 5th Mini Album 'NO TRAGEDY' - EP" 처럼 접미사를 붙인다) */
function titleMatches(mine, theirs) {
  const a = norm(mine), b = norm(theirs);
  if (!a || !b) return false;
  if (a === b) return true;
  const strip = (s) => s.replace(/\b(ep|single|album)\b/g, '').replace(/\s+/g, ' ').trim();
  const A = strip(a), B = strip(b);
  return A === B || (A.length > 6 && B.includes(A)) || (B.length > 6 && A.includes(B));
}

/** 아티스트명 → 애플 아티스트 ID (이름이 정확히 일치하는 것만) */
async function resolveArtistId(name, country) {
  try {
    const d = await j(
      `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=8&country=${country}`,
    );
    const hit = (d.results || []).find((a) => norm(a.artistName) === norm(name));
    return hit?.artistId || null;
  } catch {
    return null;
  }
}

export async function findReleaseArt(rel, { log = () => {} } = {}) {
  /* 자국 스토어를 먼저 보되 반대쪽도 본다.
     일본반이 KR 스토어에만, 한국반이 JP 스토어에만 올라온 경우가 실제로 있다. */
  const primary = rel.country === 'kr' ? 'kr' : 'jp';
  const country = primary;
  const term = `${rel.artist} ${rel.title}`.slice(0, 120);
  /* 검색만으로는 놓친다. 실제로 TWS 'NO TRAGEDY' 는 애플 검색 상위에 안 뜨고
     아티스트 lookup 으로 카탈로그를 훑어야 나왔다.
     그래서 아티스트 ID 를 먼저 찾아 카탈로그 전체를 받는 경로를 우선한다. */
  const tries = [];
  const artistId = rel.appleArtistId || (await resolveArtistId(rel.artist, country));
  if (artistId) {
    tries.push(`https://itunes.apple.com/lookup?id=${artistId}&entity=album&limit=60&country=${country}`);
  }
  tries.push(
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=12&country=${country}`,
    `https://itunes.apple.com/search?term=${encodeURIComponent(rel.artist)}&entity=album&limit=40&country=${country}`,
  );
  const other = primary === 'kr' ? 'jp' : 'kr';
  const otherId = await resolveArtistId(rel.artist, other);
  if (otherId) tries.push(`https://itunes.apple.com/lookup?id=${otherId}&entity=album&limit=60&country=${other}`);
  tries.push(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=12&country=${other}`);
  for (const url of tries) {
    let d;
    try { d = await j(url); } catch { continue; }
    for (const x of d.results || []) {
      if (!x.artworkUrl100) continue;
      /* 아티스트도 반드시 맞아야 한다 — 제목만 보면 커버곡/트리뷰트가 걸린다.
         단 애플은 스토어마다 현지명을 쓴다. 실제로 KR 스토어는 TWS 를
         '투어스' 로 표기해서, 영문명만 비교하면 같은 앨범을 놓쳤다.
         우리가 가진 표기(원어명·한국어명)를 모두 후보로 둔다. */
      const names = [rel.artist, rel.artistKo].filter(Boolean).map(norm);
      if (!names.includes(norm(x.artistName))) continue;
      if (!titleMatches(rel.title, x.collectionName)) continue;
      return {
        artwork: x.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.'),
        matchedTitle: x.collectionName,
        appleReleaseDate: (x.releaseDate || '').slice(0, 10),
        appleCollectionId: x.collectionId,
      };
    }
    await new Promise((r) => setTimeout(r, 260));
  }
  return null;
}

export async function backfillReleaseArt(releases, { log = () => {} } = {}) {
  let filled = 0, missing = 0;
  const dateConflicts = [];
  for (const r of releases) {
    if (r.artwork) continue;
    let hit = null;
    try { hit = await findReleaseArt(r, { log }); } catch (e) { log(`  ✗ ${r.id} — ${e.message}`); }
    if (!hit) {
      missing++;
      r.artworkStatus = 'unavailable';   // 화면이 '커버 미공개'로 표시할 근거
      log(`  · ${r.id} — 공개된 커버를 못 찾았다`);
      continue;
    }
    r.artwork = hit.artwork;
    r.artworkSource = 'apple-catalog';
    delete r.artworkStatus;
    filled++;
    log(`  ✓ ${r.id} ← ${hit.matchedTitle}`);
    /* 날짜가 어긋나면 덮어쓰지 않고 나란히 남긴다.
       사람이 확인해 넣은 값을 자동 수집이 조용히 갈아엎으면 안 된다. */
    if (hit.appleReleaseDate && hit.appleReleaseDate !== r.releaseDate) {
      r.appleReleaseDate = hit.appleReleaseDate;
      dateConflicts.push({ id: r.id, ours: r.releaseDate, apple: hit.appleReleaseDate });
    }
    await new Promise((s) => setTimeout(s, 260));
  }
  return { filled, missing, dateConflicts };
}
