// Lilac demo backend v0.3
// DB = 로컬 폴더(../db)의 JSON 파일. 데모용 단순 구현 (실서비스 보안 아님)
import express from 'express';
import cors from 'cors';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'lilac-backend', version: '0.3' }));

/* ================= 공개 컬렉션 ================= */
const COLLECTIONS = new Set(['artists', 'tracks', 'events', 'products']);
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
    const url = `https://itunes.apple.com/search?media=music&entity=${entity}&country=${country}&limit=${limit}&term=${encodeURIComponent(term)}`;
    const r = await fetch(url, { headers: { 'user-agent': 'lilac-demo/0.3' } });
    const data = await r.json();
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
  const total = product.price * (Number(qty) || 1);
  const users = await readJson('users', []);
  const u = users.find((x) => x.id === user.id);
  if (u.credits < total) return res.status(402).json({ error: `크레딧이 부족합니다 (보유 ${u.credits.toLocaleString()} / 필요 ${total.toLocaleString()})` });
  u.credits -= total;
  await writeJson('users', users);
  const orders = await readJson('user/orders', []);
  const order = {
    id: 'LO-' + Date.now().toString(36).toUpperCase(), productId, name: product.name, brand: product.brand,
    option: option || product.options?.[0], qty: Number(qty) || 1, total,
    status: '예약 접수', orderedAt: new Date().toISOString(),
  };
  orders.unshift(order);
  await writeJson('user/orders', orders);
  res.json({ order, credits: u.credits });
});

app.listen(PORT, () => console.log(`[lilac] backend v0.3 on http://localhost:${PORT}`));
