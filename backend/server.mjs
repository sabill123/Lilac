// Lilac demo backend — 간단 API 서버
// DB = 로컬 폴더(../db)의 JSON 파일
import express from 'express';
import cors from 'cors';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, '..', 'db');
const PORT = process.env.PORT || 4600;

const app = express();
app.use(cors());
app.use(express.json());

const readJson = async (name, fallback = []) => {
  try {
    return JSON.parse(await readFile(path.join(DB_DIR, `${name}.json`), 'utf-8'));
  } catch {
    return fallback;
  }
};

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'lilac-backend' }));

// ---- 로컬 폴더 DB 읽기 (화이트리스트) ----
const COLLECTIONS = new Set(['artists', 'tracks', 'events', 'products']);
app.get('/api/db/:name', async (req, res) => {
  const { name } = req.params;
  if (!COLLECTIONS.has(name)) return res.status(404).json({ error: 'unknown collection' });
  res.json(await readJson(name));
});

// ---- iTunes Search API 프록시 (Apple Music 카탈로그 + 30초 프리뷰) ----
// 브라우저에서 직접 호출하면 CORS 이슈가 있어 서버에서 프록시
app.get('/api/catalog/search', async (req, res) => {
  const term = String(req.query.term || '').slice(0, 100);
  const country = /^[a-z]{2}$/i.test(String(req.query.country)) ? req.query.country : 'jp';
  const limit = Math.min(Number(req.query.limit) || 12, 25);
  if (!term) return res.status(400).json({ error: 'term required' });
  try {
    const url = `https://itunes.apple.com/search?media=music&entity=song&country=${country}&limit=${limit}&term=${encodeURIComponent(term)}`;
    const r = await fetch(url, { headers: { 'user-agent': 'lilac-demo/0.1' } });
    const data = await r.json();
    const tracks = (data.results || []).map((t) => ({
      id: t.trackId,
      title: t.trackName,
      artist: t.artistName,
      album: t.collectionName,
      artwork: (t.artworkUrl100 || '').replace('100x100', '400x400'),
      preview: t.previewUrl, // 30초 프리뷰 (m4a) — Apple 제공
      appleUrl: t.trackViewUrl,
      releaseDate: t.releaseDate,
      genre: t.primaryGenreName,
    }));
    res.json({ term, country, tracks });
  } catch (e) {
    res.status(502).json({ error: 'itunes upstream failed', detail: String(e) });
  }
});

// ---- 오시(최애) 저장: 로컬 폴더 DB에 기록 ----
app.get('/api/oshi', async (_req, res) => {
  res.json(await readJson('user/oshi'));
});
app.post('/api/oshi', async (req, res) => {
  const { artistId, name } = req.body || {};
  if (!artistId) return res.status(400).json({ error: 'artistId required' });
  await mkdir(path.join(DB_DIR, 'user'), { recursive: true });
  const list = await readJson('user/oshi');
  const exists = list.findIndex((o) => o.artistId === artistId);
  if (exists >= 0) list.splice(exists, 1); // 토글
  else list.push({ artistId, name, at: new Date().toISOString() });
  await writeFile(path.join(DB_DIR, 'user', 'oshi.json'), JSON.stringify(list, null, 2));
  res.json(list);
});

app.listen(PORT, () => console.log(`[lilac] backend on http://localhost:${PORT}`));
