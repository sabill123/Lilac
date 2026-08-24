// Lilac demo backend v0.3
// DB = 로컬 폴더(../db)의 JSON 파일. 데모용 단순 구현 (실서비스 보안 아님)
import express from 'express';
import { gzipSync } from 'node:zlib';
import cors from 'cors';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandQuery, phoneticMatch, phoneticKey, looseKey, editDistance, hasHangul, hangulToKatakana } from './lib/ko-ja.mjs';
import { buildIndex } from './build-index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, '..', 'db');
const PORT = process.env.PORT || 4600;

const app = express();
app.use(cors());
app.use(express.json());

const readJson = async (name, fallback = null) => {
  try { return JSON.parse(await readFile(path.join(DB_DIR, `${name}.json`), 'utf-8')); }
  catch { return fallback; }
};
const writeJson = async (name, data) => {
  const p = path.join(DB_DIR, `${name}.json`);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(data, null, 2));
};
const hash = (s) => createHash('sha256').update(s).digest('hex');

/* ---------- 한글 검색용 읽기 색인 ----------
   수집된 실데이터의 일본어 표기를 형태소 분석해 읽기를 만들어 둔 것.
   덕분에 「群青」을 '군조'로 쳐도 찾을 수 있다(장음 표기 차이를 음가로 흡수). */
let searchIndex = { entries: [] };

async function loadIndex() {
  searchIndex = await readJson('search-index', { entries: [] });
  return searchIndex.entries.length;
}

/** 색인 재구축 — 수집기가 돌 때나 수동 요청 시에만. 외부 API를 호출하므로 느리다(~20초) */
async function refreshIndex() {
  try {
    const r = await buildIndex();
    searchIndex = r;
    console.log(`[lilac] 검색 색인 ${r.count}건 재구축 완료`);
    return r.count;
  } catch (e) {
    console.error('[lilac] 색인 재구축 실패, 기존 색인 유지:', e.message);
    return searchIndex.entries?.length || 0;
  }
}

/** 한글 질의의 음가와 일치하는 일본어 원표기들을 색인에서 찾는다 */
function lookupIndex(q, limit = 3) {
  const qk = phoneticKey(q);
  const ql = looseKey(q);           // 영어 제목의 한글 음차 대응
  // 3글자 이하 음가는 변별력이 없어 엉뚱한 곡을 끌어온다("하루"→旅は道連れ 사례)
  if (qk.length < 4 && ql.length < 4) return [];
  /* 색인은 후보를 '확신할 때만' 내놓아야 한다.
     느슨하게 맞추면 1000건 넘는 색인에서 엉뚱한 곡이 상위 후보가 되어
     오히려 정확도가 떨어진다(실측: 느슨 16/28 → 엄격 상향). */
  const scored = [];
  for (const e of searchIndex.entries || []) {
    let best = 0;
    for (const k of e.keys) {
      if (k === qk || k === ql) { best = Math.max(best, 100); break; }
      // 접두 일치는 장음·조사 정도의 짧은 꼬리만 허용
      if (qk.length >= 4 && k.startsWith(qk) && k.length - qk.length <= 2) best = Math.max(best, 82);
      else if (ql.length >= 4 && k.startsWith(ql) && k.length - ql.length <= 2) best = Math.max(best, 80);
      // 편집거리는 긴 질의에서만 (영어 음차의 표기 흔들림 흡수)
      else if (ql.length >= 7 && Math.abs(k.length - ql.length) <= 2 && editDistance(k, ql) <= 2) {
        best = Math.max(best, 74);
      }
      else if (qk.length >= 6 && Math.abs(k.length - qk.length) <= 1 && editDistance(k, qk) === 1) {
        best = Math.max(best, 72);
      }
    }
    if (best >= 72) scored.push({ ja: e.ja, score: best });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.ja);
}

/** iTunes는 간헐적으로 빈/절단 응답을 준다 — 재시도 후 JSON 검증 */
async function fetchJsonRetry(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'lilac-demo/0.3' } });
      const txt = await r.text();
      if (txt.trim().startsWith('{')) return JSON.parse(txt);
    } catch { /* 다음 시도 */ }
    await new Promise((s) => setTimeout(s, 220 * (i + 1)));
  }
  return null;
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'lilac-backend', version: '0.3' }));

/* ================= 공개 컬렉션 ================= */
const COLLECTIONS = new Set(['artists', 'tracks', 'events', 'products', 'fx']);
app.get('/api/db/:name', async (req, res) => {
  if (!COLLECTIONS.has(req.params.name)) return res.status(404).json({ error: 'unknown collection' });
  res.json(await readJson(req.params.name, []));
});

/* ================= Apple Music 카탈로그 프록시 ================= */
const ENTITIES = { song: 'song', album: 'album', artist: 'musicArtist' };
app.get('/api/catalog/search', async (req, res) => {
  const term = String(req.query.term || '').slice(0, 100);
  const country = /^[a-z]{2}$/i.test(String(req.query.country)) ? req.query.country : 'jp';
  const limit = Math.min(Number(req.query.limit) || 12, 25);
  const entity = ENTITIES[String(req.query.entity || 'song')] || 'song';
  if (!term) return res.status(400).json({ error: 'term required' });
  try {
    // 한글이면 가타카나로 바꿔 질의 (일본 카탈로그는 일본어 표기로만 검색됨)
    const q2 = hasHangul(term) ? (hangulToKatakana(term) || term) : term;
    const url = `https://itunes.apple.com/search?media=music&entity=${entity}&country=${country}&limit=${limit}&term=${encodeURIComponent(q2)}`;
    const data = await fetchJsonRetry(url);
    if (!data) return res.status(502).json({ error: 'itunes unavailable' });
    res.json({
      term, country,
      tracks: (data.results || []).map((t) => ({
        id: t.trackId, title: t.trackName, artist: t.artistName, album: t.collectionName,
        artwork: (t.artworkUrl100 || '').replace('100x100', '400x400'),
        preview: t.previewUrl, appleUrl: t.trackViewUrl, genre: t.primaryGenreName,
        durationMs: t.trackTimeMillis || 0, releaseDate: t.releaseDate,
      })),
      albums: (data.results || []).filter((r) => r.wrapperType === 'collection').map((a) => ({
        id: a.collectionId, title: a.collectionName, artist: a.artistName,
        artwork: (a.artworkUrl100 || '').replace('100x100', '400x400'),
        year: (a.releaseDate || '').slice(0, 4), trackCount: a.trackCount, appleUrl: a.collectionViewUrl,
      })),
      artists: (data.results || []).filter((r) => r.wrapperType === 'artist').map((a) => ({
        id: a.artistId, name: a.artistName, genre: a.primaryGenreName, appleUrl: a.artistLinkUrl,
      })),
    });
  } catch (e) { res.status(502).json({ error: 'itunes upstream failed', detail: String(e) }); }
});

// 아티스트 디스코그래피 (lookup)
app.get('/api/catalog/albums', async (req, res) => {
  const term = String(req.query.term || '').slice(0, 100);
  if (!term) return res.status(400).json({ error: 'term required' });
  try {
    const url = `https://itunes.apple.com/search?media=music&entity=album&country=jp&limit=12&term=${encodeURIComponent(term)}`;
    const r = await fetch(url, { headers: { 'user-agent': 'lilac-demo/0.3' } });
    const data = await r.json();
    res.json({
      albums: (data.results || []).map((a) => ({
        id: a.collectionId, title: a.collectionName, artist: a.artistName,
        artwork: (a.artworkUrl100 || '').replace('100x100', '400x400'),
        year: (a.releaseDate || '').slice(0, 4), trackCount: a.trackCount, appleUrl: a.collectionViewUrl,
      })),
    });
  } catch (e) { res.status(502).json({ error: 'itunes upstream failed', detail: String(e) }); }
});


/* ================= 통합 검색 ================= */
// 곡(Apple 카탈로그) + 아티스트 + 상품 + 일정을 한 번에 찾는다.
app.post('/api/index/rebuild', async (_req, res) => {
  await refreshIndex();
  res.json({ ok: true, count: searchIndex.count || searchIndex.entries?.length || 0 });
});

app.get('/api/aliases', async (_req, res) => {
  const a = await readJson('aliases', { artists: {}, tracks: {} });
  res.json({ ...(a.artists || {}), ...(a.tracks || {}) });
});

/* 로컬 목록 필터(보관함·플레이리스트)용 역색인.
   음가 키 → 일본어 표기들. 클라이언트가 하드코딩 없이 한글 필터를 할 수 있게 한다. */
let readingsCache = null;   // { etag, gz }

app.get('/api/readings', async (req, res) => {
  // 색인이 커지면 응답도 커진다(수천 키) — 압축해서 캐시해 둔다
  if (readingsCache && readingsCache.builtFrom === (searchIndex.builtAt || '')) {
    if (req.headers['if-none-match'] === readingsCache.etag) return res.status(304).end();
    res.set({ 'content-type': 'application/json', 'content-encoding': 'gzip',
      etag: readingsCache.etag, 'cache-control': 'public, max-age=600' });
    return res.end(readingsCache.gz);
  }
  const rev = {};
  for (const e of searchIndex.entries || []) {
    for (const k of e.keys) {
      if (k.length < 2) continue;
      (rev[k] ||= []).push(e.ja);
    }
  }
  // 수동 예외도 같은 형태로 합친다
  const a = await readJson('aliases', { artists: {}, tracks: {} });
  for (const [ko, ja] of Object.entries({ ...(a.artists || {}), ...(a.tracks || {}) })) {
    const k = phoneticKey(ko);
    if (k.length >= 2) (rev[k] ||= []).push(ja);
  }
  const gz = gzipSync(Buffer.from(JSON.stringify(rev)));
  readingsCache = { gz, etag: '"' + hash(gz.toString('base64')).slice(0, 16) + '"', builtFrom: searchIndex.builtAt || '' };
  res.set({ 'content-type': 'application/json', 'content-encoding': 'gzip',
    etag: readingsCache.etag, 'cache-control': 'public, max-age=600' });
  res.end(readingsCache.gz);
});

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  if (!q) return res.status(400).json({ error: 'q required' });

  const [artists, products, events, tracks, aliasDb] = await Promise.all([
    readJson('artists', []), readJson('products', []), readJson('events', []),
    readJson('tracks', []), readJson('aliases', { artists: {}, tracks: {} }),
  ]);
  const allAliases = { ...(aliasDb.artists || {}), ...(aliasDb.tracks || {}) };

  /* 질의 확장 순서
     1) 수동 예외 사전 — 형태소 분석기가 틀리는 특수 읽기(晴る=ハル 등)를 바로잡는 최소한의 장치
     2) 자동 색인 — 수집된 실데이터의 읽기. 신곡은 여기로 자동 편입된다
     3) 가타카나 음역 — 색인에 없는 곡을 위한 실시간 경로
     4) 원 한글 질의 — 마지막 폴백 */
  const manual = Object.entries(allAliases)
    .filter(([ko]) => ko.trim().toLowerCase() === q.toLowerCase())
    .map(([, ja]) => ja);
  const indexHits = hasHangul(q) ? lookupIndex(q) : [];
  const expanded = expandQuery(q, allAliases);
  const queries = [...new Set([...manual, ...indexHits, ...expanded])].slice(0, 5);
  const ql = q.toLowerCase();

  /** 문자열이 질의와 맞는지 — 직접 포함 또는 음가 일치 */
  const match = (s) => {
    if (!s) return false;
    const t = String(s).toLowerCase();
    if (t.includes(ql)) return true;
    return queries.some((cand) => t.includes(String(cand).toLowerCase())) || phoneticMatch(s, q);
  };

  const artistHits = artists.filter((a) =>
    match(a.name) || match(a.nameJa) || match(a.searchTerm) || match(a.genre) ||
    (a.aliases || []).some((x) => match(x)));
  const productHits = products.filter((p) => match(p.name) || match(p.brand)).slice(0, 12);
  const eventHits = events.filter((e) => match(e.title) || match(e.artist) || match(e.type)).slice(0, 8);
  const seedHits = tracks.filter((t) => match(t.title) || match(t.artist) || match(t.tag)).slice(0, 8);

  // 외부 카탈로그: 확장 질의를 순차 시도해 합침
  const seen = new Set();
  const catalog = [];
  // 후보 하나가 결과를 독점하지 않도록 후보별 상한을 둔다
  const PER_CAND = 6;
  for (let ci = 0; ci < queries.length; ci++) {
    const cand = queries[ci];
    if (catalog.length >= 15) break;
    try {
      const j = await fetchJsonRetry(`https://itunes.apple.com/search?media=music&entity=song&country=jp&limit=${PER_CAND}&term=${encodeURIComponent(cand)}`);
      if (!j) continue;
      (j.results || []).slice(0, PER_CAND).forEach((t) => {
        if (seen.has(t.trackId)) return;
        seen.add(t.trackId);
        catalog.push({
          id: t.trackId, title: t.trackName, artist: t.artistName, album: t.collectionName,
          artwork: (t.artworkUrl100 || '').replace('100x100', '400x400'),
          preview: t.previewUrl, appleUrl: t.trackViewUrl, durationMs: t.trackTimeMillis || 0,
          matchedBy: cand === q ? 'direct' : 'transliterated', candIdx: ci, via: cand,
        });
      });
    } catch { /* 개별 질의 실패는 무시 */ }
  }

  // 원 질의와의 음가 유사도로 재정렬 — 후보 순서에 좌우되지 않도록
  // 수동 예외는 사람이 확인한 것이라 신뢰도가 높고, 색인 힌트는 추정이므로 가산점을 낮춘다
  const normJa = (x) => String(x).toLowerCase().replace(/\s*-\s*(single|ep|album)$/i, '').trim();
  const manualSet = new Set(manual.map(normJa));
  const indexSet = new Set(indexHits.map(normJa));
  const qk = phoneticKey(q);
  const score = (t) => {
    const tk = phoneticKey(t.title);
    const ak = phoneticKey(t.artist);
    let s = 0;
    if (tk === qk) s = 100;                          // 제목 정확 일치
    else if (ak === qk) s = 90;                      // 아티스트 정확 일치
    else if (qk.length >= 3 && tk.startsWith(qk)) s = 80;
    else if (qk.length >= 3 && tk.includes(qk)) s = 70;
    else if (qk.length >= 3 && ak.includes(qk)) s = 60;
    else if (tk.length >= 3 && qk.includes(tk)) s = 50;
    // 앞선 후보(별칭 사전·가타카나)로 찾은 결과에 가중치 — 동음이곡보다 우선
    // 앞선 후보(수동 예외 → 색인 → 가타카나 → 원문)일수록 신뢰도가 높다.
    // 한자 제목은 음가 계산이 안 되므로(晴る 등) 상위 후보에 충분한 가중을 준다.
    const ci = t.candIdx ?? queries.length;
    s += ci === 0 ? 130 : Math.max(0, (queries.length - ci)) * 20;
    // 확인된 표기와 제목이 일치하면 가산 — 동음이곡(風神 vs 婦人倶楽部)에서 실제 보유 곡을 고른다
    const tn = normJa(t.title);
    if (manualSet.has(tn)) s += 90;
    else if (indexSet.has(tn)) s += 40;
    return s;
  };
  catalog.sort((a, b) => score(b) - score(a));

  res.json({
    q,
    queries,                                   // 어떤 질의로 찾았는지 노출 (디버깅·UI 표기용)
    translated: hasHangul(q) ? hangulToKatakana(q) : null,
    counts: { tracks: catalog.length, artists: artistHits.length, products: productHits.length, events: eventHits.length },
    tracks: catalog.slice(0, 15),
    artists: artistHits,
    products: productHits,
    events: eventHits,
    seedTracks: seedHits,
  });
});

/* ================= YouTube 실시간 통계 ================= */
// 공개 watch 페이지에서 조회수·게시일을 읽는다 (API 키 불필요). 30분 캐시.
const ytCache = new Map(); // id -> { at, views, publishDate, title }
const YT_TTL = 30 * 60 * 1000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

async function ytStat(id) {
  const hit = ytCache.get(id);
  if (hit && Date.now() - hit.at < YT_TTL) return hit;
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: { 'user-agent': UA, 'accept-language': 'ja,en;q=0.8' } });
    const html = await r.text();
    const views = Number(html.match(/"viewCount":"(\d+)"/)?.[1] || 0);
    const publishDate = html.match(/"publishDate":"([^"]+)"/)?.[1] || html.match(/"uploadDate":"([^"]+)"/)?.[1] || null;
    const title = html.match(/<meta name="title" content="([^"]+)"/)?.[1] || null;
    const rec = { at: Date.now(), views, publishDate, title, live: views > 0 };
    if (views) ytCache.set(id, rec);
    return rec;
  } catch {
    return { at: Date.now(), views: 0, publishDate: null, title: null, live: false };
  }
}

app.get('/api/youtube/stats', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12);
  if (!ids.length) return res.status(400).json({ error: 'ids required' });
  const out = {};
  await Promise.all(ids.map(async (id) => { out[id] = await ytStat(id); }));
  res.json({ stats: out, cachedFor: '30m' });
});

/* ================= 실제 발매 일정 (iTunes releaseDate 기반) ================= */
let releaseCache = { at: 0, data: null };
app.get('/api/releases', async (_req, res) => {
  if (Date.now() - releaseCache.at < 60 * 60 * 1000 && releaseCache.data) return res.json(releaseCache.data);
  const artists = await readJson('artists', []);
  const out = [];
  await Promise.all(artists.map(async (a) => {
    try {
      const url = `https://itunes.apple.com/search?media=music&entity=album&country=jp&limit=6&term=${encodeURIComponent(a.searchTerm)}`;
      const r = await fetch(url, { headers: { 'user-agent': 'lilac-demo/0.3' } });
      const j = await r.json();
      (j.results || [])
        .filter((x) => x.artistName === a.searchTerm || x.artistName === a.name || x.artistName === a.nameJa)
        .forEach((x) => out.push({
          id: `rel-${x.collectionId}`, type: '발매', source: 'apple',
          title: x.collectionName, artist: a.name, artistId: a.id,
          date: (x.releaseDate || '').slice(0, 10),
          venue: `${x.trackCount}곡 · ${x.collectionPrice > 0 ? `¥${x.collectionPrice}` : '스트리밍'}`,
          note: 'Apple Music 카탈로그 기준 실제 발매일',
          artwork: (x.artworkUrl100 || '').replace('100x100', '400x400'),
          url: x.collectionViewUrl,
        }));
    } catch { /* skip */ }
  }));
  out.sort((x, y) => y.date.localeCompare(x.date));
  const data = { updated: new Date().toISOString(), count: out.length, releases: out.slice(0, 40) };
  releaseCache = { at: Date.now(), data };
  res.json(data);
});

/* ================= 아티스트 실제 지표 ================= */
app.get('/api/artist/:id/stats', async (req, res) => {
  const artists = await readJson('artists', []);
  const tracks = await readJson('tracks', []);
  const a = artists.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'artist not found' });
  const mine = tracks.filter((t) => t.artistId === a.id && t.youtubeId);
  const stats = await Promise.all(mine.map((t) => ytStat(t.youtubeId)));
  const totalViews = stats.reduce((s, x) => s + (x.views || 0), 0);
  const live = stats.some((x) => x.live);
  res.json({
    artistId: a.id, trackCount: mine.length, totalViews, live,
    source: 'YouTube 공식 MV 누적 조회수 합산',
    tracks: mine.map((t, i) => ({ title: t.title, youtubeId: t.youtubeId, views: stats[i].views, publishDate: stats[i].publishDate })),
  });
});

/* ================= 차트 (Apple 실시간 + YouTube 조회수 + 합산) ================= */
let appleChartCache = { at: 0, data: null };
async function fetchAppleChart() {
  if (Date.now() - appleChartCache.at < 10 * 60 * 1000 && appleChartCache.data) return appleChartCache.data;
  const r = await fetch('https://rss.marketingtools.apple.com/api/v2/jp/music/most-played/25/songs.json', {
    headers: { 'user-agent': 'lilac-demo/0.3' },
  });
  const j = await r.json();
  const list = (j.feed?.results || []).map((s, i) => ({
    rank: i + 1, title: s.name, artist: s.artistName,
    artwork: (s.artworkUrl100 || '').replace('100x100', '400x400'),
    appleUrl: s.url, source: 'apple',
  }));
  appleChartCache = { at: Date.now(), data: list };
  return list;
}
const norm = (s) => String(s).toLowerCase().replace(/[\s()\[\]『』「」【】・,.'’!?~-]/g, '');

/* 수집기(collect-charts.mjs)가 만든 3종 차트 — 국가별 */
app.get('/api/charts', async (req, res) => {
  const data = await readJson('charts', null);
  if (!data) return res.status(503).json({ error: 'charts not collected yet', hint: 'node backend/collect-charts.mjs' });
  const country = String(req.query.country || 'jp');
  const source = String(req.query.source || 'combined');
  const c = data.countries?.[country];
  if (!c) return res.status(404).json({ error: 'unknown country' });
  const list = c[source] || [];
  res.json({
    country, countryLabel: c.label, source, updated: data.updated, limit: data.limit,
    counts: { apple: c.apple?.length || 0, youtube: c.youtube?.length || 0, billboard: c.billboard?.length || 0, oricon: c.oricon?.length || 0, combined: c.combined?.length || 0 },
    weights: c.weights || null,
    method: source === 'combined'
      ? '공통 곡 풀(Apple Music 국가별 최다 재생)을 기준으로, Apple 순위와 공식 MV 조회수 순위를 각각 정규화해 50:50으로 합산합니다.'
      : source === 'apple' ? 'Apple Music 공식 최다 재생 차트입니다.'
      : source === 'billboard' ? 'Billboard JAPAN HOT 100 — 스트리밍·다운로드·CD·라디오·동영상·노래방을 합산한 일본 종합 차트입니다.'
      : source === 'oricon' ? '오리콘 주간 싱글 랭킹 — 일본 CD 판매량 기준 차트입니다.'
      : '같은 곡 풀을 공식 뮤직비디오 누적 조회수로 재정렬한 순위입니다.',
    list,
  });
});

app.get('/api/chart', async (req, res) => {
  const source = String(req.query.source || 'combined');
  const seeds = await readJson('tracks', []);
  // 실시간 조회수를 가져오고, 실패 시에만 시드값으로 폴백
  const liveStats = await Promise.all(seeds.map((t) => (t.youtubeId ? ytStat(t.youtubeId) : Promise.resolve({ views: 0, live: false }))));
  const anyLive = liveStats.some((s) => s.live);
  const withViews = seeds.map((t, i) => ({ ...t, views: liveStats[i].views || t.ytViews, live: liveStats[i].live }));
  const yt = withViews
    .slice().sort((a, b) => b.views - a.views)
    .map((t, i) => ({ rank: i + 1, title: t.title, artist: t.artist, ytViews: t.views, youtubeId: t.youtubeId, searchTerm: t.searchTerm, tag: t.tag, source: 'youtube', live: t.live }));
  try {
    if (source === 'youtube') return res.json({ source, updated: new Date().toISOString(), note: anyLive ? '공식 MV 누적 조회수 (YouTube 실시간 수집)' : '공식 MV 누적 조회수 (캐시된 마지막 값)', live: anyLive, list: yt });
    const apple = await fetchAppleChart();
    if (source === 'apple') return res.json({ source, updated: new Date(appleChartCache.at).toISOString(), note: 'Apple Music 일본 최다 재생 (실시간 공식 피드)', list: apple });
    // combined: 랭크 포인트 합산 (apple: 26-rank, youtube: (11-rank)*2), 곡 매칭은 정규화 문자열
    const score = new Map();
    const put = (key, entry, pts) => {
      const cur = score.get(key) || { entry, pts: 0, sources: [] };
      cur.pts += pts; cur.sources.push(entry.source);
      if (entry.source === 'apple') cur.entry = { ...cur.entry, ...entry }; // 아트워크 우선
      score.set(key, cur);
    };
    apple.forEach((e) => put(norm(e.title) + '|' + norm(e.artist).slice(0, 6), e, 26 - e.rank));
    yt.forEach((e) => {
      const key = [...score.keys()].find((k) => k.startsWith(norm(e.title).slice(0, 8))) || norm(e.title) + '|' + norm(e.artist).slice(0, 6);
      put(key, e, (11 - e.rank) * 2);
    });
    const list = [...score.values()]
      .sort((a, b) => b.pts - a.pts).slice(0, 20)
      .map((v, i) => ({ ...v.entry, rank: i + 1, pts: v.pts, sources: [...new Set(v.sources)] }));
    res.json({ source: 'combined', updated: new Date().toISOString(), note: 'Apple 순위 + YouTube 조회수 합산 (데모 알고리즘)', list });
  } catch (e) {
    res.json({ source: 'youtube', updated: new Date().toISOString(), note: 'Apple 피드 실패 — YouTube 기준으로 대체', list: yt });
  }
});

/* ================= 인증 (데모: 단일 로컬 유저 저장) ================= */
async function currentUser() {
  const session = await readJson('user/session');
  if (!session?.token) return null;
  const users = await readJson('users', []);
  return users.find((u) => u.id === session.userId) || null;
}
const publicUser = (u) => u && ({
  id: u.id, email: u.email, name: u.name, language: u.language,
  plan: u.plan, credits: u.credits, createdAt: u.createdAt,
  paymentMethods: u.paymentMethods, addresses: u.addresses,
});

app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) return res.status(400).json({ error: 'email/password/name required' });
  const users = await readJson('users', []);
  if (users.some((u) => u.email === email)) return res.status(409).json({ error: '이미 가입된 이메일입니다' });
  const user = {
    id: randomUUID(), email, name, pw: hash(password),
    language: 'ko', createdAt: new Date().toISOString(),
    plan: { tier: 'free', name: 'Free', renewsAt: null },
    credits: 5000, // 데모 웰컴 크레딧
    paymentMethods: [], addresses: [],
  };
  users.push(user);
  await writeJson('users', users);
  const token = randomUUID();
  await writeJson('user/session', { token, userId: user.id, at: new Date().toISOString() });
  res.json({ token, user: publicUser(user) });
});
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const users = await readJson('users', []);
  const user = users.find((u) => u.email === email && u.pw === hash(password || ''));
  if (!user) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' });
  const token = randomUUID();
  await writeJson('user/session', { token, userId: user.id, at: new Date().toISOString() });
  res.json({ token, user: publicUser(user) });
});
app.post('/api/auth/logout', async (_req, res) => { await writeJson('user/session', null); res.json({ ok: true }); });
app.get('/api/me', async (_req, res) => res.json({ user: publicUser(await currentUser()) }));
app.patch('/api/me', async (req, res) => {
  const users = await readJson('users', []);
  const session = await readJson('user/session');
  const idx = users.findIndex((u) => u.id === session?.userId);
  if (idx < 0) return res.status(401).json({ error: 'not logged in' });
  const allowed = ['name', 'language'];
  for (const k of allowed) if (k in (req.body || {})) users[idx][k] = req.body[k];
  // 데모 액션들
  if (req.body?.action === 'topup') { users[idx].credits += Number(req.body.amount) || 0; }
  if (req.body?.action === 'upgrade') { users[idx].plan = { tier: 'premium', name: 'Lilac Premium (데모)', renewsAt: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) }; }
  if (req.body?.action === 'addCard') { users[idx].paymentMethods.push({ id: randomUUID().slice(0, 8), brand: req.body.brand || 'CARD', last4: String(req.body.last4 || '0000').slice(-4), addedAt: new Date().toISOString() }); }
  await writeJson('users', users);
  res.json({ user: publicUser(users[idx]) });
});

/* ================= 팔로우 / 좋아요 / 히스토리 ================= */
app.get('/api/oshi', async (_req, res) => res.json(await readJson('user/oshi', [])));
app.post('/api/oshi', async (req, res) => {
  const { artistId, name } = req.body || {};
  if (!artistId) return res.status(400).json({ error: 'artistId required' });
  const list = await readJson('user/oshi', []);
  const i = list.findIndex((o) => o.artistId === artistId);
  if (i >= 0) list.splice(i, 1); else list.push({ artistId, name, at: new Date().toISOString() });
  await writeJson('user/oshi', list);
  res.json(list);
});

app.get('/api/likes', async (_req, res) => res.json(await readJson('user/likes', [])));
app.post('/api/likes', async (req, res) => {
  const t = req.body?.track;
  if (!t?.title) return res.status(400).json({ error: 'track required' });
  const list = await readJson('user/likes', []);
  const key = norm(t.title) + '|' + norm(t.artist || '');
  const i = list.findIndex((x) => x.key === key);
  if (i >= 0) list.splice(i, 1);
  else list.unshift({ key, ...t, likedAt: new Date().toISOString() });
  await writeJson('user/likes', list);
  res.json(list);
});

app.get('/api/history', async (_req, res) => res.json(await readJson('user/history', [])));
app.post('/api/history', async (req, res) => {
  const t = req.body?.track;
  if (!t?.title) return res.status(400).json({ error: 'track required' });
  let list = await readJson('user/history', []);
  list.unshift({ ...t, playedAt: new Date().toISOString() });
  list = list.slice(0, 100);
  await writeJson('user/history', list);
  res.json({ ok: true });
});

/* ================= 플레이리스트 ================= */
app.get('/api/playlists', async (_req, res) => res.json(await readJson('user/playlists', [])));
app.post('/api/playlists', async (req, res) => {
  const list = await readJson('user/playlists', []);
  const pl = { id: randomUUID().slice(0, 8), name: String(req.body?.name || '새 플레이리스트').slice(0, 60), createdAt: new Date().toISOString(), tracks: [] };
  list.unshift(pl);
  await writeJson('user/playlists', list);
  res.json(pl);
});
app.post('/api/playlists/:id/tracks', async (req, res) => {
  const list = await readJson('user/playlists', []);
  const pl = list.find((p) => p.id === req.params.id);
  if (!pl) return res.status(404).json({ error: 'playlist not found' });
  const t = req.body?.track;
  if (!t?.title) return res.status(400).json({ error: 'track required' });
  pl.tracks.push({ ...t, addedAt: new Date().toISOString() });
  await writeJson('user/playlists', list);
  res.json(pl);
});
app.delete('/api/playlists/:id/tracks/:idx', async (req, res) => {
  const list = await readJson('user/playlists', []);
  const pl = list.find((p) => p.id === req.params.id);
  if (!pl) return res.status(404).json({ error: 'playlist not found' });
  pl.tracks.splice(Number(req.params.idx), 1);
  await writeJson('user/playlists', list);
  res.json(pl);
});
// 이름 변경
app.patch('/api/playlists/:id', async (req, res) => {
  const list = await readJson('user/playlists', []);
  const pl = list.find((p) => p.id === req.params.id);
  if (!pl) return res.status(404).json({ error: 'playlist not found' });
  if (req.body?.name) pl.name = String(req.body.name).slice(0, 60);
  if (typeof req.body?.desc === 'string') pl.desc = req.body.desc.slice(0, 200);
  await writeJson('user/playlists', list);
  res.json(pl);
});
// 순서 저장 (드래그 정렬)
app.put('/api/playlists/:id/tracks', async (req, res) => {
  const list = await readJson('user/playlists', []);
  const pl = list.find((p) => p.id === req.params.id);
  if (!pl) return res.status(404).json({ error: 'playlist not found' });
  if (!Array.isArray(req.body?.tracks)) return res.status(400).json({ error: 'tracks array required' });
  pl.tracks = req.body.tracks;
  await writeJson('user/playlists', list);
  res.json(pl);
});
app.delete('/api/playlists/:id', async (req, res) => {
  let list = await readJson('user/playlists', []);
  list = list.filter((p) => p.id !== req.params.id);
  await writeJson('user/playlists', list);
  res.json(list);
});

/* ================= 주문 (데모: 크레딧 차감) ================= */
app.get('/api/orders', async (_req, res) => res.json(await readJson('user/orders', [])));
app.post('/api/orders', async (req, res) => {
  const { productId, option, qty } = req.body || {};
  const products = await readJson('products', []);
  const product = products.find((p) => p.id === productId);
  if (!product) return res.status(404).json({ error: 'product not found' });
  const user = await currentUser();
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다' });
  // 선택한 사양(에디션)의 가격으로 결제
  const edition = (product.editions || []).find((e) => e.label === option || e.id === option);
  const unit = edition?.pricing?.total ?? product.price;
  const total = unit * (Number(qty) || 1);
  const users = await readJson('users', []);
  const u = users.find((x) => x.id === user.id);
  if (u.credits < total) return res.status(402).json({ error: `크레딧이 부족합니다 (보유 ${u.credits.toLocaleString()} / 필요 ${total.toLocaleString()})` });
  u.credits -= total;
  await writeJson('users', users);
  const orders = await readJson('user/orders', []);
  const order = {
    id: 'LO-' + Date.now().toString(36).toUpperCase(), productId, name: product.name, brand: product.brand,
    option: edition?.label || option || '통상반', qty: Number(qty) || 1, unit, total,
    artwork: product.artwork,
    breakdown: edition?.pricing ? { ...edition.pricing, rateDate: product.rateDate } : null,
    status: '예약 접수', orderedAt: new Date().toISOString(),
  };
  orders.unshift(order);
  await writeJson('user/orders', orders);
  res.json({ order, credits: u.credits });
});

app.listen(PORT, async () => {
  console.log(`[lilac] backend v0.3 on http://localhost:${PORT}`);
  // 기동 시엔 만들어 둔 색인을 읽기만 한다.
  // 재구축은 수집기(collect-*.mjs)가 끝날 때 또는 /api/index/rebuild 로 수행한다.
  const n = await loadIndex();
  if (n) console.log(`[lilac] 검색 색인 ${n}건 로드`);
  else { console.log('[lilac] 색인이 없어 새로 만듭니다...'); await refreshIndex(); }
});
