// Lilac demo backend v0.3
// DB = 로컬 폴더(../db)의 JSON 파일. 데모용 단순 구현 (실서비스 보안 아님)
import express from 'express';
import { gzipSync } from 'node:zlib';
import cors from 'cors';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
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

const INDEX_MAX_AGE_H = Number(process.env.INDEX_MAX_AGE_H || 24);

/**
 * 색인 자동 갱신
 *  신곡은 발매 후 차트에 오르고, 차트가 갱신되면 색인 대상 아티스트도 바뀐다.
 *  하루 한 번 다시 만들어 두면 사람 손을 타지 않고도 최신 곡이 한글로 검색된다.
 */
function scheduleIndexRefresh() {
  const ageH = searchIndex.builtAt
    ? (Date.now() - new Date(searchIndex.builtAt).getTime()) / 36e5
    : Infinity;

  if (ageH > INDEX_MAX_AGE_H) {
    // 기동 직후엔 요청 처리를 우선하고, 잠시 뒤 백그라운드로 재구축
    console.log(`[lilac] 색인이 ${ageH === Infinity ? '없음' : Math.round(ageH) + '시간 경과'} — 곧 갱신합니다`);
    setTimeout(() => { refreshIndex().catch(() => {}); }, 30_000).unref?.();
  }
  // 이후 주기적 갱신
  setInterval(() => { refreshIndex().catch(() => {}); }, INDEX_MAX_AGE_H * 36e5).unref?.();
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

/* ================= Focus Desk / AI 큐레이터 =================
   YouTube ID는 사람이 확인한 허용 목록만 사용한다. LLM은 URL을 만들지 않고
   이 목록 안에서 세션에 맞는 믹스를 고르는 역할만 한다. */
const FOCUS_MIXES = [
  {
    id: 'lilac-lofi', title: 'Best of Lofi Hip Hop', creator: 'Lofi Girl',
    videoId: 'n61ULEU7CO0', tone: 'calm', energy: 32, vocal: false,
    bestFor: ['문서 작성', '코딩', '독서'], color: '#b58cff',
  },
  {
    id: 'night-drive', title: 'Chillhop Essentials · Spring', creator: 'Chillhop Music',
    videoId: 'HFQibg2OJkU', tone: 'drive', energy: 68, vocal: false,
    bestFor: ['반복 작업', '디자인', '야간 작업'], color: '#7c5cff',
  },
  {
    id: 'asian-focus', title: 'Flow of Time · Japanese Lofi', creator: 'Deebu',
    videoId: 'EtD7_8kCMHA', tone: 'soft', energy: 44, vocal: false,
    bestFor: ['기획', '리서치', '메일 정리'], color: '#d39af7',
  },
];

function localFocusSession({ task = '', mode = 'balanced', minutes = 45 } = {}) {
  const q = `${task} ${mode}`.toLowerCase();
  const mix = /디자인|design|반복|야간|에너지|drive|high/.test(q)
    ? FOCUS_MIXES[1]
    : /기획|리서치|메일|research|admin|soft/.test(q)
      ? FOCUS_MIXES[2]
      : FOCUS_MIXES[0];
  const total = Math.max(15, Math.min(Number(minutes) || 45, 120));
  return {
    mixId: mix.id,
    title: task ? `${String(task).slice(0, 28)} 집중 세션` : `${total}분 집중 세션`,
    reason: `${mix.title}은(는) 보컬 간섭이 적고 ${mix.bestFor.slice(0, 2).join('·')} 흐름에 맞습니다.`,
    plan: [
      { minute: 0, label: '작업 범위 한 줄로 고정' },
      { minute: Math.max(10, Math.round(total * 0.55)), label: '진행 상태 빠르게 확인' },
      { minute: Math.max(14, total - 3), label: '마무리와 다음 행동 기록' },
    ],
  };
}

app.get('/api/focus/mixes', (_req, res) => res.json({
  mixes: FOCUS_MIXES,
  aiConfigured: Boolean(process.env.LETSUR_API_KEY),
  model: process.env.LETSUR_MODEL_CODE || 'gpt-5.4',
}));

app.post('/api/ai/focus-session', async (req, res) => {
  const task = String(req.body?.task || '').trim().slice(0, 240);
  const mode = ['deep', 'balanced', 'energy'].includes(req.body?.mode) ? req.body.mode : 'balanced';
  const minutes = Math.max(15, Math.min(Number(req.body?.minutes) || 45, 120));
  const fallback = localFocusSession({ task, mode, minutes });
  const apiKey = process.env.LETSUR_API_KEY;
  if (!apiKey) return res.json({ session: fallback, source: 'local', model: null });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const catalog = FOCUS_MIXES.map(({ id, title, tone, energy, bestFor }) => ({ id, title, tone, energy, bestFor }));
    const upstream = await fetch('https://gw.letsur.ai/v1/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.LETSUR_MODEL_CODE || 'gpt-5.4',
        temperature: 0.35,
        max_tokens: 520,
        messages: [
          {
            role: 'system',
            content: 'You are Lilac Focus Curator. Pick exactly one mixId from the supplied catalog. Never invent music, artists, URLs, or IDs. Return JSON only with keys mixId, title, reason, plan. plan is an array of 3 objects with integer minute and short Korean label.',
          },
          {
            role: 'user',
            content: JSON.stringify({ task, mode, minutes, catalog }),
          },
        ],
      }),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) throw new Error(data?.error?.message || data?.detail || `Letsur ${upstream.status}`);
    const raw = String(data?.choices?.[0]?.message?.content || '');
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('invalid AI response');
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const selected = FOCUS_MIXES.find((m) => m.id === parsed.mixId);
    if (!selected) throw new Error('AI selected unknown mix');
    const plan = Array.isArray(parsed.plan) ? parsed.plan.slice(0, 3).map((p) => ({
      minute: Math.max(0, Math.min(Number(p.minute) || 0, minutes)),
      label: String(p.label || '').slice(0, 60),
    })) : fallback.plan;
    res.json({
      session: {
        mixId: selected.id,
        title: String(parsed.title || fallback.title).slice(0, 80),
        reason: String(parsed.reason || fallback.reason).slice(0, 240),
        plan,
      },
      source: 'letsur', model: data.model || process.env.LETSUR_MODEL_CODE || 'gpt-5.4',
    });
  } catch (error) {
    console.warn('[lilac] Focus AI fallback:', error?.message || String(error));
    res.json({ session: fallback, source: 'local-fallback', model: null });
  } finally { clearTimeout(timer); }
});

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
/* ---------- 서비스 상태 ----------
   무엇이 살아 있고 무엇이 낡았는지 숨기지 않고 보여준다.
   외부 소스에 의존하는 서비스라 '언제 수집한 데이터인가'가 신뢰의 핵심이다. */
/* 여러 검색어를 한 번에 처리한다.
   홈 화면은 아트워크를 채우려고 60번 가까이 개별 요청을 보내고 있었다.
   요청 수 자체가 병목이라 배치로 묶는다. */
const catalogMemo = new Map();   // term → { at, hit }
const CATALOG_TTL = 30 * 60 * 1000;

async function lookupOne(term) {
  const key = term.toLowerCase();
  const c = catalogMemo.get(key);
  if (c && Date.now() - c.at < CATALOG_TTL) return c.hit;
  const q = hasHangul(term) ? (hangulToKatakana(term) || term) : term;
  const j = await fetchJsonRetry(`https://itunes.apple.com/search?media=music&entity=song&country=jp&limit=3&term=${encodeURIComponent(q)}`, 2);
  const t = (j?.results || [])[0];
  const hit = t ? {
    id: t.trackId, title: t.trackName, artist: t.artistName, album: t.collectionName,
    artwork: (t.artworkUrl100 || '').replace('100x100', '400x400'),
    preview: t.previewUrl, appleUrl: t.trackViewUrl, durationMs: t.trackTimeMillis || 0,
  } : null;
  catalogMemo.set(key, { at: Date.now(), hit });
  return hit;
}

app.post('/api/catalog/batch', async (req, res) => {
  const terms = Array.isArray(req.body?.terms) ? req.body.terms.slice(0, 40) : [];
  if (!terms.length) return res.json({ results: {} });
  // 캐시된 것은 즉시, 나머지만 병렬로 (동시 6개까지)
  const results = {};
  const pending = [];
  for (const term of terms) {
    const c = catalogMemo.get(String(term).toLowerCase());
    if (c && Date.now() - c.at < CATALOG_TTL) results[term] = c.hit;
    else pending.push(term);
  }
  const CONCURRENCY = 6;
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const slice = pending.slice(i, i + CONCURRENCY);
    const hits = await Promise.all(slice.map((t) => lookupOne(t).catch(() => null)));
    slice.forEach((t, k) => { results[t] = hits[k]; });
  }
  res.json({ results });
});

/* ── Deezer 에디토리얼 (무료 · 키 불필요) ──
   Deezer 국가 차트는 한일 이용자가 적어 품질이 무너져 있음을 실측으로 확인했다
   (Top South Korea에 D'Angelo가 뜬다). 대신 Deezer 공식 에디터가 관리하는
   장르 플레이리스트(Top K-Pop / Top J-Pop)는 품질이 검증되어 이를 쓴다.
   '차트'가 아니라 '에디터 픽'으로 정확히 라벨링한다. */
const DEEZER_EDITORIAL = {
  kr: { id: 4096400722, label: 'Top K-Pop', editor: 'Deezer K-Pop Editor' },
  jp: { id: 6049895724, label: 'Top J-Pop', editor: 'Deezer Japan Editor' },
};
const editorialCache = { kr: { at: 0, list: [] }, jp: { at: 0, list: [] } };
const EDITORIAL_TTL = 30 * 60 * 1000;

app.get('/api/editorial', async (req, res) => {
  const country = String(req.query.country || 'jp');
  const cfg = DEEZER_EDITORIAL[country];
  if (!cfg) return res.status(404).json({ error: 'unknown country' });
  const cache = editorialCache[country];
  if (cache.list.length && Date.now() - cache.at < EDITORIAL_TTL) {
    return res.json({ country, ...cfg, live: true, fetchedAt: new Date(cache.at).toISOString(), list: cache.list });
  }
  try {
    const j = await fetchJsonRetry(`https://api.deezer.com/playlist/${cfg.id}/tracks?limit=30`, 2);
    const list = (j?.data || []).map((t, i) => ({
      rank: i + 1, title: t.title, artist: t.artist?.name || '',
      artwork: t.album?.cover_medium || t.album?.cover || null,
      deezerUrl: t.link || null,
    })).filter((x) => x.title && x.artist);
    if (list.length) { editorialCache[country] = { at: Date.now(), list }; }
    res.json({ country, ...cfg, live: true, fetchedAt: new Date().toISOString(), list });
  } catch {
    res.json({ country, ...cfg, live: false, fetchedAt: new Date(cache.at || 0).toISOString(), list: cache.list });
  }
});

app.get('/api/status', async (_req, res) => {
  const now = Date.now();
  const ageH = (iso) => (iso ? Math.round(((now - new Date(iso).getTime()) / 36e5) * 10) / 10 : null);
  const [charts, products, artists, events, fx] = await Promise.all([
    readJson('charts', null), readJson('products', []), readJson('artists', []),
    readJson('events', []), readJson('fx', null),
  ]);

  const chartSources = [];
  for (const [code, c] of Object.entries(charts?.countries || {})) {
    for (const [k, v] of Object.entries(c)) {
      if (!Array.isArray(v)) continue;
      chartSources.push({ country: code, source: k, count: v.length, ok: v.length > 0 });
    }
  }

  const services = [
    {
      id: 'charts', name: '차트 수집', kind: '외부 수집',
      ok: !!charts && chartSources.every((s) => s.ok),
      updatedAt: charts?.updated || null, ageHours: ageH(charts?.updated),
      detail: chartSources.length ? `${chartSources.length}개 소스 · ${chartSources.reduce((a, b) => a + b.count, 0)}건` : '수집 이력 없음',
      sources: chartSources,
    },
    {
      id: 'products', name: '스토어 상품', kind: '외부 수집',
      ok: products.length > 0,
      updatedAt: fx?.collectedAt || null, ageHours: ageH(fx?.collectedAt),
      detail: `${products.length}건 (일본반 ${products.filter((p) => (p.origin || 'jp') === 'jp').length} · 한국반 ${products.filter((p) => p.origin === 'kr').length})`,
    },
    {
      id: 'artists', name: '아티스트 로스터', kind: '외부 수집',
      ok: artists.length > 0, updatedAt: null, ageHours: null,
      detail: `${artists.length}팀 (J-POP ${artists.filter((a) => a.country === 'jp').length} · K-POP ${artists.filter((a) => a.country === 'kr').length})`,
    },
    {
      id: 'events', name: '일정', kind: '외부 수집 + 데모',
      ok: events.length > 0, updatedAt: null, ageHours: null,
      detail: `${events.length}건 (실발매 ${events.filter((e) => !e.isDemo).length} · 데모 ${events.filter((e) => e.isDemo).length})`,
    },
    {
      id: 'fx', name: '환율', kind: '실시간 API',
      ok: !!fx?.live, updatedAt: fx?.collectedAt || null, ageHours: ageH(fx?.collectedAt),
      detail: fx ? `1엔 = ${fx.jpyKrw ?? fx.rate}원 (${fx.source})` : '없음',
    },
    {
      id: 'search-index', name: '한글 검색 색인', kind: '자동 생성',
      ok: (searchIndex.entries?.length || 0) > 0,
      updatedAt: searchIndex.builtAt || null, ageHours: ageH(searchIndex.builtAt),
      detail: `${(searchIndex.entries?.length || 0).toLocaleString()}개 표기`,
    },
    {
      id: 'catalog', name: 'Apple 카탈로그 검색', kind: '실시간 API',
      ok: true, updatedAt: null, ageHours: null, detail: '요청 시 조회 (캐시 없음)',
    },
    {
      id: 'apple-rss', name: 'Apple 공식 RSS 차트', kind: '실시간 API',
      ok: true, updatedAt: null, ageHours: null, detail: '요청 시 조회 · 10분 캐시 (키 불필요)',
    },
    {
      id: 'deezer', name: 'Deezer 에디터 픽', kind: '실시간 API',
      ok: true, updatedAt: null, ageHours: null,
      detail: 'Top K-Pop · Top J-Pop 공식 에디토리얼 (키 불필요, 30분 캐시)',
    },
    {
      id: 'spotify', name: 'Spotify Web API', kind: '선택 통합',
      ok: true, updatedAt: null, ageHours: null,
      detail: process.env.SPOTIFY_CLIENT_ID
        ? '키 설정됨'
        : '미설정: SPOTIFY_CLIENT_ID/SECRET 등록 시 활성화 (무료)',
    },
  ];

  res.json({
    now: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    healthy: services.every((s) => s.ok),
    services,
  });
});

app.get('/api/index/status', (_req, res) => {
  const ageH = searchIndex.builtAt ? (Date.now() - new Date(searchIndex.builtAt).getTime()) / 36e5 : null;
  res.json({
    count: searchIndex.entries?.length || 0,
    builtAt: searchIndex.builtAt || null,
    ageHours: ageH === null ? null : Math.round(ageH * 10) / 10,
    maxAgeHours: INDEX_MAX_AGE_H,
  });
});

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
/* 차트 파일은 256KB가 넘는다. 매 요청마다 읽고 파싱하면 그 자체가 병목이라
   파일 수정 시각을 키로 메모리에 캐시한다. */
let chartCache = { mtime: 0, data: null };
async function loadCharts() {
  try {
    const p = path.join(DB_DIR, 'charts.json');
    const { mtimeMs } = await stat(p);
    if (chartCache.data && chartCache.mtime === mtimeMs) return chartCache.data;
    const data = JSON.parse(await readFile(p, 'utf-8'));
    chartCache = { mtime: mtimeMs, data };
    return data;
  } catch { return null; }
}

/* ── 실시간 소스 ──
   Apple 공식 마케팅 RSS는 스크래핑이 아닌 정식 JSON 피드라
   요청 시점에 직접 가져와도 안전하다. 10분 TTL 캐시만 두고 실시간 서빙한다.
   (멜론·지니·오리콘·빌보드는 공개 API가 없어 여전히 일일 수집에 의존한다) */
const rssLiveCache = { jp: { at: 0, list: [] }, kr: { at: 0, list: [] } };
const RSS_TTL = 10 * 60 * 1000;

async function liveAppleRss(country, budgetMs = 3500) {
  const c = rssLiveCache[country];
  if (c && Date.now() - c.at < RSS_TTL && c.list.length) return { list: c.list, fetchedAt: c.at, live: true };

  /* 외부 피드가 느려도 우리 응답을 막으면 안 된다.
     제한 시간 안에 못 받으면 수집본으로 넘기고, 갱신은 백그라운드에서 계속한다.
     (Apple이 도메인을 옮기며 리다이렉트가 끼자 콜드 캐시에서 20초가 걸렸다) */
  const j = await Promise.race([
    fetchJsonRetry(`https://rss.marketingtools.apple.com/api/v2/${country}/music/most-played/50/songs.json`, 2),
    new Promise((r) => setTimeout(() => r(null), budgetMs)),
  ]);
  const list = (j?.feed?.results || []).map((x, i) => ({
    rank: i + 1, title: x.name, artist: x.artistName,
    artwork: (x.artworkUrl100 || '').replace('100x100', '400x400'),
    appleUrl: x.url, youtubeId: null, ytViews: null,
  }));
  if (list.length) { rssLiveCache[country] = { at: Date.now(), list }; return { list, fetchedAt: Date.now(), live: true }; }
  return null;   // 실패 시 호출부가 수집본으로 폴백
}

app.get('/api/charts', async (req, res) => {
  const data = await loadCharts();
  if (!data) return res.status(503).json({ error: 'charts not collected yet', hint: 'node backend/collect-charts.mjs' });
  const country = String(req.query.country || 'jp');
  const source = String(req.query.source || 'combined');
  const c = data.countries?.[country];
  if (!c) return res.status(404).json({ error: 'unknown country' });

  /* 전체를 그대로 내보내면 응답이 수백 KB가 되어 파싱만 2초 넘게 걸린다.
     화면이 실제로 쓰는 필드만, 요청한 개수만 보낸다. */
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
  const slim = (e) => ({
    rank: e.rank, title: e.title, artist: e.artist,
    artwork: e.artwork || null, appleUrl: e.appleUrl || null,
    youtubeId: e.youtubeId || null, ytViews: e.ytViews || null,
    ranks: e.ranks || null, sources: e.sources || null, score: e.score,
    move: e.move || null, lastRank: e.lastRank ?? null,
  });
  let full = c[source] || [];
  let liveInfo = null;
  if (source === 'appleRss' && (country === 'jp' || country === 'kr')) {
    const live = await liveAppleRss(country).catch(() => null);
    if (live) { full = live.list; liveInfo = live; }
  }
  const list = full.slice(0, limit).map(slim);

  // 국가마다 소스 구성이 다르다(일본: 빌보드·오리콘 / 한국: 멜론·지니)
  const counts = {};
  for (const [k, v] of Object.entries(c)) if (Array.isArray(v)) counts[k] = v.length;

  /** 각 소스가 무엇을 근거로 만든 순위인지 그대로 밝힌다 */
  const METHOD = {
    combined: '국가별 5개 소스를 각각 순위 정규화한 뒤 가중 합산한 Lilac 자체 집계입니다. 공식 차트가 아닙니다.',
    apple: 'Apple Music 국가별 최다 재생 차트입니다.',
    appleRss: 'Apple 공식 마케팅 RSS 피드의 인기곡 순위입니다.',
    youtube: '같은 곡 풀을 공식 뮤직비디오 누적 조회수로 재정렬한 순위입니다.',
    billboard: 'Billboard JAPAN HOT 100 — 스트리밍·다운로드·CD·라디오·동영상·노래방을 합산한 일본 종합 차트입니다.',
    oricon: '오리콘 주간 싱글 랭킹 — 일본 CD 판매량 기준 차트입니다.',
    melon: '멜론 TOP100 — 국내 최대 음원 플랫폼의 실시간 차트입니다.',
    genie: '지니 차트 — 멜론과 이용자층이 달라 교차 검증에 사용합니다.',
  };

  res.json({
    country, countryLabel: c.label, source,
    updated: liveInfo ? new Date(liveInfo.fetchedAt).toISOString() : data.updated,
    live: !!liveInfo,
    limit, total: full.length,
    counts,
    sources: Object.keys(counts).filter((k) => k !== 'combined'),
    sourceLabels: c.sourceLabels || null,
    weights: c.weights || null,
    method: METHOD[source] || METHOD.combined,
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

  /* 크레딧은 원화 기준이다.
     한국반 주문은 엔화 가격이므로 환율로 환산해 차감한다.
     (그동안 ¥1,990을 크레딧 1,990으로 1:1 차감하던 버그가 있었다) */
  const buyerCurrency = edition?.pricing?.buyerCurrency
    ?? (product.priceCurrency ?? (product.origin === 'kr' ? 'JPY' : 'KRW'));
  let chargeKrw = total;
  if (buyerCurrency === 'JPY') {
    const fxData = await readJson('fx', null);
    const jpyKrw = fxData?.jpyKrw ?? 8.7;
    chargeKrw = Math.round(total * jpyKrw);
  }
  const users = await readJson('users', []);
  const u = users.find((x) => x.id === user.id);
  if (u.credits < chargeKrw) return res.status(402).json({ error: `크레딧이 부족합니다 (보유 ${u.credits.toLocaleString()} / 필요 ${chargeKrw.toLocaleString()})` });
  u.credits -= chargeKrw;
  await writeJson('users', users);
  const orders = await readJson('user/orders', []);
  const order = {
    id: 'LO-' + Date.now().toString(36).toUpperCase(), productId, name: product.name, brand: product.brand,
    option: edition?.label || option || '통상반', qty: Number(qty) || 1, unit, total,
    buyerCurrency, chargedKrw: chargeKrw,
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
  // 기동 시엔 만들어 둔 색인을 읽기만 한다 (재구축은 외부 API 호출이라 1~2분 걸린다)
  const n = await loadIndex();
  if (n) console.log(`[lilac] 검색 색인 ${n}건 로드`);
  else { console.log('[lilac] 색인이 없어 새로 만듭니다...'); await refreshIndex(); }
  scheduleIndexRefresh();
});
