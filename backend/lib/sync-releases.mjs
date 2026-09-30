/**
 * 릴리스 동기화
 *
 * 무엇이 자동화되고 무엇이 안 되는지부터 정리한다 —
 * 이걸 섞으면 확인 안 된 값을 확인된 것처럼 내보내게 된다.
 *
 *   자동(실시간)  Apple iTunes API
 *     · 신보 발매 감지, 발매일, 곡수, 아트워크, 디지털 정가
 *     · 아티스트 44팀 전원이 appleArtistId 를 갖고 있어 전수 조회가 된다
 *
 *   자동 불가     실물 사양(초회한정반/통상반)과 판매처별 특전
 *     · 특전은 레이블 특설 사이트에만 있고 사이트마다 형식이 다르다
 *     · 타워레코드·HMV 는 JS 렌더링이라 서버에서 상품 목록을 못 읽는다
 *       (실측: tower.jp/artist/149554 의 HTML 에 상품 링크 1개, 가격 0개)
 *
 * 그래서 릴리스를 두 등급으로 나눈다.
 *   curated    사람이 특설 사이트를 확인해 사양·특전까지 넣은 것 → 판매처 비교 가능
 *   discovered 동기화가 발견한 것 → 메타데이터 + 판매처 진입점만. 특전은 "확인 중"
 *
 * 화면은 이 등급을 숨기지 않는다.
 */

const ITUNES = 'https://itunes.apple.com';
const UA = { 'user-agent': 'Lilac/0.3 (release-sync)' };

/** 아티스트 국가 → Apple 스토어프론트 */
const storefront = (country) => (country === 'kr' ? 'kr' : 'jp');

/* 판매처 "검색" 도우미.
   ⚠️ 이건 offers 가 아니다.
   진단서(docs/bm-store-review.md)에서 지적한 바로 그 문제가
   "검색 결과 페이지로 링크만 걸고 끝내는 것"이었다. 자동 수집 단계에서는
   상품 URL 을 알 수 없으므로, 판매처인 척하지 않고 검색 링크임을 이름과
   데이터 모양 양쪽으로 못 박는다. 특전·사양이 확인되면 그때 offers 가 생긴다. */
function searchHints(artist) {
  const q = encodeURIComponent(artist.name);
  if ((artist.country || 'jp') === 'jp') {
    return [
      { store: 'TOWER RECORDS', storeKo: '타워레코드', searchUrl: `https://tower.jp/artist/search?kwd=${q}` },
      { store: 'HMV&BOOKS online', storeKo: 'HMV', searchUrl: `https://www.hmv.co.jp/search/keyword_${q}/` },
      { store: 'Amazon.co.jp', storeKo: '아마존 재팬', searchUrl: `https://www.amazon.co.jp/s?k=${q}&i=popular` },
    ];
  }
  return [
    { store: 'Weverse Shop', storeKo: '위버스샵', searchUrl: 'https://shop.weverse.io/ko/home' },
    { store: '알라딘', storeKo: '알라딘', searchUrl: `https://www.aladin.co.kr/search/wsearchresult.aspx?SearchWord=${q}` },
  ];
}

async function fetchJson(url, timeout = 20000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** 한 아티스트의 최근 릴리스를 Apple 에서 가져온다 */
export async function fetchArtistReleases(artist, limit = 4) {
  const url = `${ITUNES}/lookup?id=${artist.appleArtistId}&entity=album&limit=${limit + 1}`
    + `&sort=recent&country=${storefront(artist.country)}`;
  const j = await fetchJson(url);
  return (j.results || [])
    .filter((x) => x.wrapperType === 'collection' && x.collectionName)
    .slice(0, limit)
    .map((a) => ({
      collectionId: a.collectionId,
      name: a.collectionName,
      // 콜라보반은 여러 아티스트 카탈로그에 동시에 잡힌다.
      // 누구 작품으로 볼지 판단하려면 앨범 자신의 아티스트명이 필요하다.
      albumArtist: a.artistName || '',
      releaseDate: (a.releaseDate || '').slice(0, 10),
      trackCount: a.trackCount,
      artwork: (a.artworkUrl100 || '').replace('100x100', '600x600'),
      appleUrl: a.collectionViewUrl,
      digitalPrice: typeof a.collectionPrice === 'number' && a.collectionPrice > 0 ? a.collectionPrice : null,
      genre: a.primaryGenreName,
    }));
}

/** 앨범 규모로 사양 성격을 추정한다 — 실물 사양이 아니라 "디지털 기준" 임을 이름에 박는다 */
function inferEdition(album, currency) {
  const size = album.trackCount >= 8 ? 'album' : album.trackCount >= 4 ? 'mini' : 'single';
  return {
    id: 'digital',
    label: '디지털 (실물 사양 확인 중)',
    listPrice: album.digitalPrice ?? 0,
    listCurrency: currency,
    feeKind: size === 'single' ? 'single' : 'album',
    includes: ['디지털 음원'],
    estimated: album.digitalPrice == null,
  };
}

/** Apple 앨범 → discovered 릴리스 레코드 */
export function toRelease(artist, album) {
  const country = artist.country || 'jp';
  const currency = country === 'jp' ? 'JPY' : 'KRW';
  return {
    id: `ap-${album.collectionId}`,
    tier: 'discovered',
    artistId: artist.id,
    artist: artist.name,
    artistKo: artist.name,
    title: album.name,
    titleKo: album.name,
    country,
    type: album.trackCount >= 8 ? 'album' : album.trackCount >= 4 ? 'mini' : 'single',
    releaseDate: album.releaseDate,
    currency,
    artwork: album.artwork,
    appleUrl: album.appleUrl,
    trackCount: album.trackCount,
    albumArtist: album.albumArtist || '',
    source: {
      name: 'Apple iTunes API',
      url: album.appleUrl,
      collectedAt: new Date().toISOString().slice(0, 10),
      auto: true,
    },
    note: '판매처와 특전은 아직 확인되지 않았습니다. 발매 정보만 자동 수집된 상태입니다.',
    editions: [inferEdition(album, currency)],
    /* 확인된 판매처가 없으면 offers 는 비운다.
       검색 링크를 offer 로 위장하면 "판매처 9곳"처럼 세어져 비교표가 거짓말을 한다. */
    offers: [],
    searchHints: searchHints(artist),
  };
}

/** 변경 감지용 지문 — 값이 바뀐 릴리스만 이력에 남긴다 */
export function fingerprint(r) {
  return JSON.stringify({
    a: r.artistId, t: r.title, d: r.releaseDate,
    e: (r.editions || []).map((x) => [x.id, x.listPrice]),
    o: (r.offers || []).map((x) => [x.id, x.bonus, x.url]),
  });
}

/**
 * 전체 동기화.
 * curated 레코드는 절대 덮어쓰지 않는다 — 사람이 확인한 값이 자동 수집으로 지워지면
 * 특전 정보가 조용히 사라진다.
 */
export async function syncReleases({ artists, existing, limitPerArtist = 3, concurrency = 4 }) {
  const curated = existing.filter((r) => r.tier !== 'discovered');
  const prevById = new Map(existing.map((r) => [r.id, r]));
  const curatedKeys = new Set(curated.map((r) => `${r.artistId}|${r.title}`));

  const targets = artists.filter((a) => a.appleArtistId);
  const discovered = [];
  const errors = [];

  for (let i = 0; i < targets.length; i += concurrency) {
    const slice = targets.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      slice.map(async (a) => {
        const albums = await fetchArtistReleases(a, limitPerArtist);
        return albums.map((al) => toRelease(a, al));
      }),
    );
    results.forEach((res, k) => {
      if (res.status === 'fulfilled') discovered.push(...res.value);
      else errors.push({ artist: slice[k].name, error: String(res.reason?.message || res.reason).slice(0, 80) });
    });
  }

  /* 같은 앨범이 여러 아티스트 카탈로그에 잡히는 경우가 있다.
     예: M!LK × EBiDAN 콜라보반은 두 팀 모두의 최신작으로 돌아온다.
     그대로 두면 (1) 목록에 중복이 뜨고 (2) 같은 id 가 서로를 덮어써
     매 동기화마다 "updated" 로 잡혀 변경 이력이 노이즈로 가득 찬다(실측).
     collectionId 로 접고, 앨범 자신의 아티스트명과 일치하는 쪽을 대표로 둔다. */
  const byCollection = new Map();
  for (const r of discovered) {
    const prev = byCollection.get(r.id);
    if (!prev) { byCollection.set(r.id, r); continue; }
    const matches = (x) => x.albumArtist && x.artist && x.albumArtist.toLowerCase().includes(x.artist.toLowerCase());
    if (matches(r) && !matches(prev)) byCollection.set(r.id, r);
  }
  const deduped = [...byCollection.values()];

  // curated 가 이미 다루는 작품은 discovered 로 중복 생성하지 않는다
  const fresh = deduped.filter((r) => !curatedKeys.has(`${r.artistId}|${r.title}`));

  // 변경 감지
  const changes = [];
  for (const r of fresh) {
    const prev = prevById.get(r.id);
    if (!prev) changes.push({ kind: 'added', id: r.id, artist: r.artist, title: r.title, releaseDate: r.releaseDate });
    else if (fingerprint(prev) !== fingerprint(r)) changes.push({ kind: 'updated', id: r.id, artist: r.artist, title: r.title });
  }
  const freshIds = new Set(fresh.map((r) => r.id));
  for (const prev of existing) {
    if (prev.tier === 'discovered' && !freshIds.has(prev.id)) {
      changes.push({ kind: 'removed', id: prev.id, artist: prev.artist, title: prev.title });
    }
  }

  /* ⚠️ 수집이 통째로 실패한 것과 '결과가 없는 것'을 구분해야 한다.

     실제로 이 구분이 없어서 릴리스 128건이 날아갔다.
     백엔드 여러 개가 같은 db 를 보며 동시에 애플을 두드리자 조회가 전부
     막혔고(fresh = 0), 그걸 "이제 discovered 릴리스가 하나도 없다"로 읽어
     curated 3건만 남기고 덮어썼다.

     자동 수집은 자기가 못 받아온 것을 근거로 기존 데이터를 지우면 안 된다.
     아무것도 못 받았거나 조회 대부분이 실패했으면 이전 discovered 를 그대로 둔다. */
  const prevDiscovered = existing.filter((r) => r.tier === 'discovered');
  const wipedOut = prevDiscovered.length > 0 && fresh.length === 0;
  const mostlyFailed = targets.length > 0 && errors.length >= Math.ceil(targets.length * 0.5);
  const unsafe = wipedOut || (mostlyFailed && fresh.length < prevDiscovered.length / 2);

  if (unsafe) {
    return {
      releases: [...curated, ...prevDiscovered].sort(
        (a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''),
      ),
      stats: {
        curated: curated.length,
        discovered: prevDiscovered.length,
        artistsQueried: targets.length,
        errors: errors.length,
        skipped: true,
      },
      changes: [],
      errors,
      skipped: wipedOut ? 'no-results' : 'mostly-failed',
      at: new Date().toISOString(),
    };
  }

  // 최신 발매 순
  const merged = [...curated, ...fresh].sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''));

  return {
    releases: merged,
    stats: {
      curated: curated.length,
      discovered: fresh.length,
      artistsQueried: targets.length,
      errors: errors.length,
    },
    changes,
    errors,
    at: new Date().toISOString(),
  };
}
