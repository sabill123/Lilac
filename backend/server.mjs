// Lilac demo backend v0.3
// DB = 로컬 폴더(../db)의 JSON 파일. 데모용 단순 구현 (실서비스 보안 아님)
import express from 'express';
import { gzipSync } from 'node:zlib';
import cors from 'cors';
import { readFile, writeFile, mkdir, stat, rename, rm } from 'node:fs/promises';
import { randomUUID, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandQuery, phoneticMatch, phoneticKey, looseKey, editDistance, hasHangul, hangulToKatakana } from './lib/ko-ja.mjs';
import { buildIndex } from './build-index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { quote, PLANS, planOf, FEE_RATE } from './lib/pricing.mjs';
import { backfillArtwork } from './lib/backfill-artwork.mjs';
import { backfillReleaseArt } from './lib/backfill-release-art.mjs';
import { backfillOperator } from './lib/backfill-operator.mjs';
import { fetchFx, fxAgeHours } from './lib/fx.mjs';
import { acquire as acquireSyncLock } from './lib/sync-lock.mjs';
import { syncCatalog } from './lib/sync-catalog.mjs';
import { backfillLinks } from './lib/backfill-links.mjs';
import { MECHANICS, mechanicsFor } from './lib/fandom.mjs';
import { register as registerInstance, heartbeat as instanceHeartbeat, unregister as unregisterInstance } from './lib/instance.mjs';
import { syncReleases } from './lib/sync-releases.mjs';
import { createLiveService } from './lib/live/service.mjs';
import { createCommunity } from './lib/community.mjs';
import { createPersistence } from './lib/persist.mjs';
import { flushAllKv } from './lib/live/cache.mjs';
import { cp, access } from 'node:fs/promises';

const DB_DIR = process.env.LILAC_DB_DIR ? path.resolve(process.env.LILAC_DB_DIR) : path.join(__dirname, '..', 'db');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEMO_BILLING = !IS_PRODUCTION && process.env.LILAC_ENABLE_DEMO_BILLING === '1';
const PORT = process.env.PORT || 4600;

/* 첫 부팅 시드: 실시간 수집 캐시가 비어 있으면 저장소의 스냅숏으로 시작한다(무료 호스팅은 매번 빈 디스크로 시작).
   수집기가 곧 최신 값으로 덮어쓴다. 사용자 데이터는 시드에 없다. */
{
  const seedDir = path.join(__dirname, 'seed', 'live-cache');
  const liveDir = path.join(DB_DIR, 'live-cache');
  const exists = async (x) => access(x).then(() => true, () => false);
  if (await exists(seedDir) && !(await exists(liveDir))) {
    await mkdir(DB_DIR, { recursive: true });
    await cp(seedDir, liveDir, { recursive: true });
    console.log('[lilac] 실시간 캐시 시드 복원');
  }
}
/* 사용자 데이터 영속화(DATABASE_URL이 있을 때만). 서버가 파일을 읽기 전에 내려받는다 */
const persistence = createPersistence({ dbDir: DB_DIR, beforeCollected: flushAllKv });
if (persistence.enabled) {
  try { await persistence.hydrate(); persistence.start(); }
  catch (e) {
    /* 복원 없이 빈 사용자 데이터로 뜨면 다음 flush가 저장본을 덮어쓴다 — 뜨지 않는 편이 안전하다 */
    console.error('[persist] 복원 실패, 시작을 중단합니다:', e.message);
    process.exit(1);
  }
}

let shuttingDown = false;
const backgroundTimers = new Set();
const backgroundJobs = new Set();
function runBackground(fn) {
  if (shuttingDown) return Promise.resolve();
  const job = Promise.resolve().then(fn).catch((error) => console.error('[lilac] background task failed:', error?.message || error));
  backgroundJobs.add(job);
  job.finally(() => backgroundJobs.delete(job));
  return job;
}
function scheduleBackground(fn, ms, repeat = false) {
  if (shuttingDown) return null;
  const timer = (repeat ? setInterval : setTimeout)(() => {
    if (!repeat) backgroundTimers.delete(timer);
    runBackground(fn);
  }, ms);
  backgroundTimers.add(timer);
  timer.unref?.();
  return timer;
}
const app = express();
app.use((_req, res, next) => {
  if (shuttingDown) return res.status(503).set('Connection', 'close').json({ error: '서버가 종료 중입니다', code: 'SHUTTING_DOWN' });
  next();
});
app.disable('x-powered-by');
/* 프록시 뒤(Vercel → Render)에서는 실제 방문자 IP가 X-Forwarded-For에 있다. 믿을 프록시 홉 수만큼만 */
if (process.env.LILAC_TRUST_PROXY) app.set('trust proxy', Number(process.env.LILAC_TRUST_PROXY) || process.env.LILAC_TRUST_PROXY);
// Express 4 does not forward rejected async route handlers to the error middleware.
for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
  const register = app[method].bind(app);
  app[method] = (route, ...handlers) => register(route, ...handlers.map((fn) => typeof fn !== 'function' ? fn : (req, res, next) => {
    try { Promise.resolve(fn(req, res, next)).catch(next); } catch (error) { next(error); }
  }));
}
const securityPath = (req) => req.path.toLowerCase().replace(/\/+$/, '');
const allowedOrigins = new Set((process.env.LILAC_ALLOWED_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean));
const localHost = (host) => /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host || '');
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // Non-browser clients must still pass endpoint authorization.
  if (allowedOrigins.has(origin)) return true;
  try {
    const u = new URL(origin);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    if (!IS_PRODUCTION && localHost(u.host) && localHost(req.headers.host)) return true;
    return u.origin === req.protocol + '://' + req.headers.host;
  } catch { return false; }
}
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Cache-Control', 'no-store');
  if (!originAllowed(req) || (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['sec-fetch-site'] === 'cross-site' && !req.headers.origin)) {
    return res.status(403).json({ error: '허용되지 않은 요청 출처입니다', code: 'ORIGIN_FORBIDDEN' });
  }
  next();
});
const requestWindows = new Map();
app.use((req, res, next) => {
  if (!/^\/api\/(auth\/(signup|login)|contact|ai\/)/.test(securityPath(req))) return next();
  const key = (req.ip || req.socket.remoteAddress || 'unknown') + ':' + securityPath(req);
  const now = Date.now();
  if (requestWindows.size > 10000) for (const [k, v] of requestWindows) if (now - v.at > 60000) requestWindows.delete(k);
  const v = requestWindows.get(key);
  if (!v || now - v.at > 60000) requestWindows.set(key, { at: now, n: 1 });
  else if (++v.n > 20) { res.set('Retry-After', '60'); return res.status(429).json({ error: '요청이 너무 많습니다', code: 'RATE_LIMITED' }); }
  next();
});
app.use(cors({ origin: (origin, cb) => cb(null, origin || false), methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Lilac-Admin-Token'] }));
// Browser pages on arbitrary origins must not shut down or refresh a local daemon.
app.use((req, res, next) => {
  const admin = /^\/api\/(?:admin(?:\/|$)|live\/admin(?:\/|$)|index\/rebuild$|store\/sync$)/.test(securityPath(req));
  if (!admin) return next();
  const expected = process.env.LILAC_ADMIN_TOKEN || '';
  const actual = String(req.headers['x-lilac-admin-token'] || '');
  const validToken = expected.length >= 32 && Buffer.byteLength(actual) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  const localDev = !IS_PRODUCTION && /^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(req.socket.remoteAddress || '') && localHost(req.headers.host);
  if (!validToken && !localDev) return res.status(403).json({ error: '관리자 인증이 필요합니다', code: 'FORBIDDEN' });
  next();
});
app.use((req, res, next) => {
  if (!DEMO_BILLING && ((securityPath(req) === '/api/me' && req.method === 'PATCH') || /^(?:\/api\/orders|\/api\/membership\/(?:subscribe|cancel)|\/api\/groupbuys\/[^/]+\/(?:join|leave))$/.test(securityPath(req)))) {
    // Profile edits remain enabled; its action field is checked after JSON parsing below.
    if (securityPath(req) !== '/api/me' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return res.status(503).json({ error: '결제 서비스 준비 중입니다', code: 'BILLING_UNAVAILABLE' });
  }
  next();
});
/* 갤러리 글쓰기만 이미지(base64)를 받으므로 크게, 나머지는 기본 100kb */
const jsonSmall = express.json();
const jsonLarge = express.json({ limit: '24mb' });
app.use((req, res, next) => (req.method === 'POST' && /^\/api\/community\/b\/[^/]+$/.test(req.path) ? jsonLarge : jsonSmall)(req, res, next));

const readJson = async (name, fallback = null) => {
  try { return JSON.parse(await readFile(path.join(DB_DIR, `${name}.json`), 'utf-8')); }
  catch { return fallback; }
};

const writeJson = async (name, data) => {
  const p = path.join(DB_DIR, `${name}.json`);
  await mkdir(path.dirname(p), { recursive: true });
  /* 임시 파일에 쓰고 rename 으로 갈아끼운다.
     같은 파일에 직접 쓰다가 중간에 죽으면 잘린 JSON 이 남아
     그 컬렉션 전체를 못 읽게 된다. rename 은 원자적이다. */
  const tmp = `${p}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, p);
};

/* ---------- 쓰기 직렬화 ----------
   파일 기반 저장소라 read → 수정 → write 사이에 다른 요청이 끼어들 수 있다.
   Node 가 싱글 스레드여도 await 지점마다 양보하므로 lost update 가 실제로 난다.

   실측한 사고: 동시에 주문 5건을 보내면 5건 모두 성공 응답을 받는데
   저장된 주문은 2건, 크레딧은 1건분만 차감됐다 — 64,800원어치를 공짜로 가져갔다.

   그래서 같은 키에 대한 작업을 프로미스 체인으로 한 줄로 세운다. */
const locks = new Map();

function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  // 앞 작업이 실패해도 뒤 작업은 실행돼야 한다(성공/실패 양쪽에 같은 fn 을 건다)
  const run = prev.then(fn, fn);
  // 체인에는 실패를 삼킨 버전을 남겨 한 번의 오류가 뒤를 전부 막지 않게 한다
  locks.set(key, run.then(() => {}, () => {}));
  return run;
}

/** 원자적 read-modify-write. mutator 가 값을 돌려주면 그것을, 아니면 수정된 원본을 저장한다. */
async function updateJson(name, mutator, fallback = null) {
  return withLock(`file:${name}`, async () => {
    const current = await readJson(name, fallback);
    const next = await mutator(current);
    const toWrite = next === undefined ? current : next;
    await writeJson(name, toWrite);
    return toWrite;
  });
}
/** 콘텐츠 지문용 해시 — 비밀번호에는 절대 쓰지 않는다(아래 hashPassword 참조) */
const hash = (v) => createHash('sha256').update(v).digest('hex');

/* ---------- 비밀번호 ----------
   기존 방식은 솔트 없는 SHA-256 한 번이었다. 빠른 해시라 GPU 로 초당 수십억 번
   시도할 수 있고, 솔트가 없어 레인보우 테이블이 그대로 통한다.
   같은 비밀번호를 쓴 계정끼리 해시가 같아 한 명이 뚫리면 나머지도 같이 뚫린다.

   scrypt 로 바꾼다 — Node 기본 제공이라 의존성이 늘지 않고, 메모리 하드라
   병렬 공격 비용이 크다. 저장 형식: scrypt$N$r$p$saltHex$keyHex

   기존 계정을 잠그지 않으려고 옛 SHA-256 해시도 검증만은 받아준다.
   대신 로그인에 성공하면 그 자리에서 scrypt 로 다시 저장한다(투명 이관). */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const scryptAsync = (password, salt) => new Promise((resolve, reject) => {
  scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
    (err, key) => (err ? reject(err) : resolve(key)));
});

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(String(password), salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

/** 레거시(SHA-256) 여부 판별 — 이관 대상인지 알기 위해 */
const isLegacyHash = (stored) => typeof stored === 'string' && !stored.startsWith('scrypt$');

async function verifyPassword(password, stored) {
  if (!stored) return false;
  if (isLegacyHash(stored)) {
    // 옛 해시: 길이가 같을 때만 상수시간 비교
    const a = Buffer.from(createHash('sha256').update(String(password)).digest('hex'));
    const b = Buffer.from(stored);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  const [, N, r, pp, saltHex, keyHex] = stored.split('$');
  const key = await new Promise((resolve, reject) => {
    scrypt(String(password), Buffer.from(saltHex, 'hex'), Buffer.from(keyHex, 'hex').length,
      { N: Number(N), r: Number(r), p: Number(pp) },
      (err, k) => (err ? reject(err) : resolve(k)));
  });
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/* ---------- 인증 시도 제한 ----------
   로그인에 아무 제한이 없으면 비밀번호를 무한히 대입할 수 있다.
   IP+이메일 단위로 창을 두고, 창 안에서 실패가 쌓이면 잠시 막는다. */
const AUTH_WINDOW_MS = 10 * 60_000;
const AUTH_MAX_FAILS = 8;
const authFails = new Map();

function authKey(req, email) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return `${ip}|${String(email || '').toLowerCase()}`;
}
function authBlocked(key) {
  const rec = authFails.get(key);
  if (!rec) return 0;
  if (Date.now() - rec.at > AUTH_WINDOW_MS) { authFails.delete(key); return 0; }
  return rec.n >= AUTH_MAX_FAILS ? Math.ceil((AUTH_WINDOW_MS - (Date.now() - rec.at)) / 1000) : 0;
}
function noteAuthFail(key) {
  const rec = authFails.get(key);
  if (!rec || Date.now() - rec.at > AUTH_WINDOW_MS) authFails.set(key, { n: 1, at: Date.now() });
  else rec.n++;
}
const clearAuthFail = (key) => authFails.delete(key);

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
    scheduleBackground(() => refreshIndex(), 30_000);
  }
  // 이후 주기적 갱신
  scheduleBackground(() => refreshIndex(), INDEX_MAX_AGE_H * 36e5, true);
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

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'lilac-backend', version: '0.4', uptimeSec: Math.round(process.uptime()), rssMb: Math.round(process.memoryUsage().rss / 1048576) }));

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

app.post('/api/ai/focus-session', requireUser(async (req, res) => {
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
}));

/* ================= 공개 컬렉션 ================= */
const COLLECTIONS = new Set(['artists', 'tracks', 'events', 'products', 'fx', 'releases']);
app.get('/api/db/:name', async (req, res) => {
  if (!COLLECTIONS.has(req.params.name)) {
    return res.status(404).json({ error: 'unknown collection', code: 'NOT_FOUND' });
  }
  const data = await readJson(req.params.name, []);

  // 수집본이라 자주 바뀌지 않는다. 브라우저·프록시가 재활용하게 둔다.
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');

  /* 페이지네이션 — products 는 1MB 가 넘어 매 화면 전체를 내려보내면 낭비다.
     limit 이 없으면 기존 동작(전체 배열)을 그대로 유지해 호출부를 깨지 않는다. */
  if (Array.isArray(data) && req.query.limit) {
    const limit = Math.min(Math.max(Number(req.query.limit) || 0, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    return res.json({
      items: data.slice(offset, offset + limit),
      total: data.length,
      offset,
      limit,
      hasMore: offset + limit < data.length,
    });
  }
  res.json(data);
});

/* ================= 도입·제휴 문의 =================
   마케팅 페이지의 문의 폼이 보낸다.
   외부 SaaS 없이 로컬 파일에 붙인다 — 데모 단계에서는 그것만으로 충분하고,
   수신자 메일을 외부로 보내지 않으므로 개인정보 이전도 생기지 않는다. */
const CONTACT_TOPICS = new Set(['partnership', 'data', 'press', 'bug', 'etc']);

app.post('/api/contact', async (req, res) => {
  const b = req.body || {};
  const s = (v, max) => String(v ?? '').trim().slice(0, max);

  const name = s(b.name, 80);
  const email = s(b.email, 160);
  const org = s(b.org, 120);
  const message = s(b.message, 4000);
  const topic = CONTACT_TOPICS.has(b.topic) ? b.topic : 'etc';

  const errors = {};
  if (!name) errors.name = '이름을 입력해 주세요.';
  if (!email) errors.email = '이메일을 입력해 주세요.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = '올바른 이메일 형식이 아닙니다.';
  if (!org) errors.org = '소속을 입력해 주세요.';
  if (!message) errors.message = '문의 내용을 입력해 주세요.';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'invalid', code: 'INVALID_INPUT', errors });

  // 봇 방어 — 프론트와 같은 기준을 서버에서도 한 번 더 본다.
  // 클라이언트 검사만 믿으면 폼을 거치지 않는 직접 POST 에 무방비해진다.
  if (s(b.website, 200)) return res.json({ ok: true, id: null, skipped: 'honeypot' });
  if (Number(b.elapsedMs) > 0 && Number(b.elapsedMs) < 1500) {
    return res.json({ ok: true, id: null, skipped: 'too-fast' });
  }

  const entry = {
    id: `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    name, email, org, topic, message,
  };

  try {
    const list = await readJson('contacts', []);
    list.unshift(entry);
    await writeJson('contacts', list.slice(0, 500)); // 데모라 상한을 둔다
    console.log(`[lilac] 문의 접수 ${entry.id} · ${topic} · ${org}`);
    res.json({ ok: true, id: entry.id });
  } catch (e) {
    console.warn('[lilac] contact save failed:', e?.message || String(e));
    res.status(500).json({ error: 'save failed', code: 'INTERNAL' });
  }
});

/* ================= 환율 시계열 =================
   마케팅 페이지의 "최종가" 차트가 쓴다.
   frankfurter는 브라우저에서 직접 부르면 301 리다이렉트를 타고 CORS가 없다.
   기존 카탈로그·차트와 같은 이유로 서버가 프록시하고 메모리에 캐시한다.
   환율은 하루 한 번 갱신되므로 6시간 TTL이면 충분하다. */
const FX_TTL_MS = 6 * 60 * 60 * 1000;
let fxSeriesCache = null;

app.get('/api/fx/series', async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 90, 14), 365);
  const now = Date.now();
  if (fxSeriesCache && fxSeriesCache.days === days && now - fxSeriesCache.at < FX_TTL_MS) {
    return res.json(fxSeriesCache.body);
  }

  const start = new Date(now - days * 864e5).toISOString().slice(0, 10);
  const url = `https://api.frankfurter.app/${start}..?from=JPY&to=KRW`;
  try {
    const j = await fetchJsonRetry(url, 2);
    const rates = j?.rates || {};
    const points = Object.keys(rates)
      .sort()
      .map((date) => ({ date, jpyKrw: rates[date].KRW }))
      .filter((p) => Number.isFinite(p.jpyKrw));
    if (!points.length) throw new Error('empty series');

    const values = points.map((p) => p.jpyKrw);
    const body = {
      source: 'frankfurter.app',
      live: true,
      base: 'JPY',
      quote: 'KRW',
      days,
      points,
      min: Math.min(...values),
      max: Math.max(...values),
      latest: points[points.length - 1],
    };
    fxSeriesCache = { days, at: now, body };
    res.json(body);
  } catch (e) {
    // 외부 API가 죽어도 랜딩이 빈 차트로 남지 않게 스냅샷을 돌려준다.
    // 단, live:false 로 표시해 화면에서 "실시간 아님"을 밝힌다.
    console.warn('[lilac] fx series fallback:', e?.message || String(e));
    const snap = await readJson('fx', null);
    if (!snap?.jpyKrw) return res.status(502).json({ error: 'fx unavailable', code: 'UPSTREAM_UNAVAILABLE' });
    res.json({
      source: snap.source || 'snapshot', live: false, base: 'JPY', quote: 'KRW', days,
      points: [{ date: snap.date, jpyKrw: snap.jpyKrw }],
      min: snap.jpyKrw, max: snap.jpyKrw,
      latest: { date: snap.date, jpyKrw: snap.jpyKrw },
    });
  }
});

/* ================= Apple Music 카탈로그 프록시 ================= */
const ENTITIES = { song: 'song', album: 'album', artist: 'musicArtist' };
app.get('/api/catalog/search', async (req, res) => {
  const term = String(req.query.term || '').slice(0, 100);
  const country = /^[a-z]{2}$/i.test(String(req.query.country)) ? req.query.country : 'jp';
  const limit = Math.min(Number(req.query.limit) || 12, 25);
  const entity = ENTITIES[String(req.query.entity || 'song')] || 'song';
  if (!term) return res.status(400).json({ error: 'term required' , code: 'INVALID_INPUT' });
  try {
    // 한글이면 가타카나로 바꿔 질의 (일본 카탈로그는 일본어 표기로만 검색됨)
    const q2 = hasHangul(term) ? (hangulToKatakana(term) || term) : term;
    const url = `https://itunes.apple.com/search?media=music&entity=${entity}&country=${country}&limit=${limit}&term=${encodeURIComponent(q2)}`;
    const data = await fetchJsonRetry(url);
    if (!data) return res.status(502).json({ error: 'itunes unavailable' , code: 'UPSTREAM_UNAVAILABLE' });
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
  } catch (e) { res.status(502).json({ error: 'itunes upstream failed', code: 'UPSTREAM_UNAVAILABLE' }); }
});

// 아티스트 디스코그래피 (lookup)
app.get('/api/catalog/albums', async (req, res) => {
  const term = String(req.query.term || '').slice(0, 100);
  if (!term) return res.status(400).json({ error: 'term required' , code: 'INVALID_INPUT' });
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
  } catch (e) { res.status(502).json({ error: 'itunes upstream failed', code: 'UPSTREAM_UNAVAILABLE' }); }
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
  if (!cfg) return res.status(404).json({ error: 'unknown country' , code: 'NOT_FOUND' });
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

  /* 나이만 내려보내면 화면이 "묵었다"를 판단할 수 없다.
     서비스마다 허용 나이와 자동 갱신 주기를 함께 준다.
     (차트가 9일, 환율이 214시간 묵어 있었는데 그 사실이 어디에도 드러나지 않았다) */
  const mark = (svc, staleAfterH, refreshEveryH) => ({
    ...svc,
    staleAfterH,
    refreshEveryH,
    stale: svc.ageHours != null && staleAfterH != null ? svc.ageHours > staleAfterH : false,
  });

  const services = [
    mark({
      id: 'charts', name: '차트 수집', kind: '외부 수집 (자동)',
      ok: !!charts && chartSources.every((s) => s.ok),
      updatedAt: charts?.updated || null, ageHours: ageH(charts?.updated),
      detail: chartSources.length ? `${chartSources.length}개 소스 · ${chartSources.reduce((a, b) => a + b.count, 0)}건` : '수집 이력 없음',
      sources: chartSources,
      running: chartSync.running,
      lastError: chartSync.lastError,
    }, CHART_STALE_H * 2, CHART_INTERVAL_MS / 36e5),
    {
      id: 'products', name: '스토어 상품', kind: '외부 수집',
      ok: products.length > 0,
      updatedAt: fx?.collectedAt || null, ageHours: ageH(fx?.collectedAt),
      detail: `${products.length}건 (일본반 ${products.filter((p) => (p.origin || 'jp') === 'jp').length} · 한국반 ${products.filter((p) => p.origin === 'kr').length})`,
    },
    {
      id: 'artists', name: '아티스트 로스터', kind: '외부 수집 (자동)',
      ok: artists.length > 0,
      updatedAt: rosterSync.lastAt, ageHours: ageH(rosterSync.lastAt),
      running: rosterSync.running, lastError: rosterSync.lastError,
      detail: `${artists.length}팀 (J-POP ${artists.filter((a) => a.country === 'jp').length} · K-POP ${artists.filter((a) => a.country === 'kr').length})`,
    },
    {
      id: 'events', name: '일정', kind: '외부 수집',
      ok: events.length > 0, updatedAt: null, ageHours: null,
      detail: `${events.length}건 (발매 ${events.filter((e) => e.type === '발매').length} · 캠페인 마감 ${events.filter((e) => String(e.id || '').startsWith('camp-')).length})`,
    },
    {
      id: 'catalog', name: '곡 카탈로그', kind: '외부 수집 (자동)',
      ok: true, updatedAt: catalogSync.lastAt, ageHours: ageH(catalogSync.lastAt),
      running: catalogSync.running, lastError: catalogSync.lastError,
      detail: await (async () => { const c = await readCatalog(); const arts = Object.values(c.artists || {}); return `${arts.length}팀 · ${arts.reduce((s2, a) => s2 + (a.count || 0), 0).toLocaleString()}곡 (Apple, 상한 ${arts.filter((a) => a.capped).length}팀)`; })(),
    },
    mark({
      id: 'fx', name: '환율', kind: '실시간 API (자동)',
      ok: !!fx?.live, updatedAt: fx?.collectedAt || null, ageHours: ageH(fx?.collectedAt),
      detail: fx ? `1엔 = ${fx.jpyKrw ?? fx.rate}원 (${fx.source})` : '없음',
    }, FX_STALE_H, FX_INTERVAL_MS / 36e5),
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
  if (!q) return res.status(400).json({ error: 'q required' , code: 'INVALID_INPUT' });

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
  if (!ids.length) return res.status(400).json({ error: 'ids required' , code: 'INVALID_INPUT' });
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
  if (!a) return res.status(404).json({ error: 'artist not found' , code: 'NOT_FOUND' });

  /* 예전엔 db/tracks.json 의 시드 10곡에서만 곡을 찾았다.
     그래서 시드에 없는 아티스트(ILLIT·aespa·TWS·back number…)는
     화면에 "0회"가 찍혔다 — 조회수가 0이 아니라 우리가 안 갖고 있던 것이다.
     수집형 차트의 youtube 목록(국가별 70곡 안팎, 조회수 포함)도 함께 본다. */
  const charts = await readJson('charts', null);
  const fromCharts = [];
  const seenYt = new Set();
  for (const bucket of Object.values(charts?.countries || {})) {
    for (const t of bucket.youtube || []) {
      if (!t.youtubeId || seenYt.has(t.youtubeId)) continue;
      // 아티스트 표기가 스토어마다 달라 별칭까지 대조한다
      const names = [a.name, a.nameOriginal, a.nameJa, a.searchTerm, ...(a.aliases || [])]
        .filter(Boolean).map((n) => norm(n));
      if (!names.includes(norm(t.artist))) continue;
      seenYt.add(t.youtubeId);
      fromCharts.push({ title: t.title, artistId: a.id, youtubeId: t.youtubeId, ytViews: t.ytViews });
    }
  }
  const seedMine = tracks.filter((t) => t.artistId === a.id && t.youtubeId);
  for (const t of seedMine) if (!seenYt.has(t.youtubeId)) { seenYt.add(t.youtubeId); fromCharts.push(t); }
  const mine = fromCharts;
  const stats = await Promise.all(mine.map((t) => ytStat(t.youtubeId)));
  const totalViews = stats.reduce((s, x) => s + (x.views || 0), 0);
  const live = stats.some((x) => x.live);
  /* 해석된 MV 가 하나도 없으면 '0회'가 아니라 '집계 없음'이다.
     0 으로 찍으면 조회수가 0인 것처럼 읽힌다 — 실제로는 우리가 안 갖고 있는 것이다. */
  res.json({
    artistId: a.id, trackCount: mine.length, totalViews, live,
    hasData: mine.length > 0,
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
const rssInflight = { jp: null, kr: null };

async function liveAppleRss(country, budgetMs = 3500) {
  const c = rssLiveCache[country];
  if (c && Date.now() - c.at < RSS_TTL && c.list.length) return { list: c.list, fetchedAt: c.at, live: true };

  /* 외부 피드가 느려도 우리 응답을 막으면 안 된다.
     제한 시간 안에 못 받으면 수집본으로 넘기고, 갱신은 백그라운드에서 계속한다.
     (Apple이 도메인을 옮기며 리다이렉트가 끼자 콜드 캐시에서 20초가 걸렸다) */
  const toList = (j) => (j?.feed?.results || []).map((x, i) => ({
    rank: i + 1, title: x.name, artist: x.artistName,
    artwork: (x.artworkUrl100 || '').replace('100x100', '400x400'),
    appleUrl: x.url, youtubeId: null, ytViews: null,
  }));
  /* 같은 나라 요청이 이미 날아가 있으면 그걸 기다린다. 제한 시간을 넘겨 도착해도 캐시에 넣어 다음 요청부터 실시간으로 준다
     (예전엔 늦게 온 응답을 버려서, 피드가 늘 3.5초를 넘기는 환경에서는 영영 실시간이 되지 않았다) */
  if (!rssInflight[country]) {
    rssInflight[country] = fetchJsonRetry(`https://rss.marketingtools.apple.com/api/v2/${country}/music/most-played/50/songs.json`, 2)
      .then((j) => { const list = toList(j); if (list.length) rssLiveCache[country] = { at: Date.now(), list }; return list; })
      .catch(() => [])
      .finally(() => { rssInflight[country] = null; });
  }
  const list = await Promise.race([rssInflight[country], new Promise((r) => setTimeout(() => r(null), budgetMs))]);
  if (list?.length) return { list, fetchedAt: rssLiveCache[country].at, live: true };
  return null;   // 실패·지연 시 호출부가 수집본으로 폴백
}

let chartNames = { at: 0, map: new Map() };
async function chartArtistNames() {
  if (Date.now() - chartNames.at < 10 * 60_000) return chartNames.map;
  const list = await readJson('artists', []).catch(() => []);
  const map = new Map();
  for (const a of Array.isArray(list) ? list : list.artists || []) {
    for (const n of [a.name, a.nameOriginal, a.nameJa, ...(a.aliases || [])]) {
      if (!n || !/[A-Za-z]/.test(n)) continue;
      const k = norm(n);
      if (k && !map.has(k)) map.set(k, a.nameOriginal && /[A-Za-z]/.test(a.nameOriginal) ? a.nameOriginal : a.name);
    }
  }
  chartNames = { at: Date.now(), map };
  return map;
}
app.get('/api/charts', async (req, res) => {
  const data = await loadCharts();
  if (!data) return res.status(503).json({ error: 'charts not collected yet', hint: 'node backend/collect-charts.mjs' , code: 'ERROR' });
  const country = String(req.query.country || 'jp');
  const source = String(req.query.source || 'combined');
  const c = data.countries?.[country];
  if (!c) return res.status(404).json({ error: 'unknown country' , code: 'NOT_FOUND' });

  /* 전체를 그대로 내보내면 응답이 수백 KB가 되어 파싱만 2초 넘게 걸린다.
     화면이 실제로 쓰는 필드만, 요청한 개수만 보낸다. */
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
  /* 차트마다 같은 아티스트를 다르게 쓴다("Mrs.GREEN APPLE" ↔ "Mrs. GREEN APPLE"). 띄어쓰기·기호만 다르면 로스터 표기로 */
  const canon = await chartArtistNames();
  const slim = (e) => ({
    rank: e.rank, title: e.title, artist: canon.get(norm(e.artist)) || e.artist,
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
/* ---------- 세션 ----------
   이전 구조는 서버에 세션 파일이 하나뿐이라("db/user/session.json")
   "현재 사용자"가 서버 전역 싱글턴이었다. 그래서
     · 나중에 로그인한 사람이 앞사람의 세션을 덮어썼고
     · 발급한 토큰은 검증하지 않았으며
     · 모든 사용자가 같은 보관함·주문 파일을 봤다
   실제로 B 계정이 A 계정의 비공개 플레이리스트와 주문내역을 그대로 읽었다.

   토큰 → userId 매핑을 여러 개 보관하고, 요청마다 토큰으로 사용자를 찾는다. */
const SESSION_TTL_MS = 30 * 864e5;

async function readSessions() {
  const raw = await readJson('sessions', {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function bearerToken(req) {
  const h = String(req?.headers?.authorization || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  // 쿠키 폴백 — 브라우저가 헤더를 못 붙이는 경로(예: 링크 이동) 대비
  const c = String(req?.headers?.cookie || '').match(/(?:^|;\s*)lilac_token=([^;]+)/);
  try { return c ? decodeURIComponent(c[1]) : null; } catch { return null; }
}

async function currentUser(req) {
  const token = bearerToken(req);
  if (!token) return null;
  const sessions = await readSessions();
  const s = sessions[token];
  if (!s?.userId) return null;
  const issuedAt = Date.parse(s.at);
  if (!Number.isFinite(issuedAt) || issuedAt > Date.now() || Date.now() - issuedAt > SESSION_TTL_MS) return null;
  const users = await readJson('users', []);
  return users.find((u) => u.id === s.userId) || null;
}

async function issueSession(userId) {
  const token = randomUUID();
  await updateJson('sessions', (sessions) => {
    const now = Date.now();
    for (const [k, v] of Object.entries(sessions)) {
      const at = Date.parse(v?.at);
      if (!Number.isFinite(at) || now - at > SESSION_TTL_MS) delete sessions[k];
    }
    sessions[token] = { userId, at: new Date().toISOString() };
  }, {});
  return token;
}

/** 사용자별 데이터 경로. 전역 파일을 쓰던 것이 유출의 직접 원인이었다. */
const userPath = (userId, name) => `user/${userId}/${name}`;

/** 로그인 필수 엔드포인트용 가드 — 통과하면 req.user 가 채워진다 */
function requireUser(handler) {
  return async (req, res) => {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다', code: 'UNAUTHENTICATED' });
    req.user = user;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return withLock('request:user:' + user.id, () => handler(req, res));
    return handler(req, res);
  };
}
const publicUser = (u) => u && ({
  id: u.id, email: u.email, name: u.name, language: u.language,
  plan: u.plan, credits: u.credits, createdAt: u.createdAt,
  paymentMethods: u.paymentMethods, addresses: u.addresses,
});

app.post('/api/auth/signup', async (req, res) => withLock('file:users', async () => {
  const { password } = req.body || {};
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (typeof password !== 'string' || password.length > 256 || email.length > 254 || name.length > 60) return res.status(400).json({ error: '입력 형식을 확인해 주세요', code: 'INVALID_INPUT' });
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email/password/name required', code: 'INVALID_INPUT' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    return res.status(400).json({ error: '올바른 이메일 형식이 아닙니다', code: 'INVALID_INPUT' });
  }
  // 4자리는 대입으로 뚫린다. 최소 8자로 올린다(화면 안내도 같이 바꿨다).
  if (String(password).length < 8) {
    return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다', code: 'WEAK_PASSWORD' });
  }
  const users = await readJson('users', []);
  if (users.some((u) => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(409).json({ error: '이미 가입된 이메일입니다', code: 'CONFLICT' });
  }
  const user = {
    id: randomUUID(), email, name, pw: await hashPassword(password),
    language: 'ko', createdAt: new Date().toISOString(),
    plan: { tier: 'free', name: 'Free', renewsAt: null },
    credits: DEMO_BILLING ? 5000 : 0, // 실제 결제 연동 전에는 무상 잔액을 발급하지 않는다
    paymentMethods: [], addresses: [],
  };
  users.push(user);
  await writeJson('users', users);
  const token = await issueSession(user.id);
  res.json({ token, user: publicUser(user) });
}));
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 256) return res.status(400).json({ error: '입력 형식을 확인해 주세요', code: 'INVALID_INPUT' });
  const key = authKey(req, email);

  const waitSec = authBlocked(key);
  if (waitSec) {
    return res.status(429).json({
      error: `로그인 시도가 너무 많습니다. ${Math.ceil(waitSec / 60)}분 후 다시 시도해 주세요`,
      code: 'RATE_LIMITED', retryAfterSec: waitSec,
    });
  }

  const users = await readJson('users', []);
  const user = users.find((u) => u.email.toLowerCase() === String(email || '').trim().toLowerCase());
  const ok = user ? await verifyPassword(password || '', user.pw) : false;

  if (!ok) {
    noteAuthFail(key);
    // 계정 존재 여부를 알려주지 않는다 — 이메일 열거를 막는다
    return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다', code: 'UNAUTHENTICATED' });
  }
  clearAuthFail(key);

  /* 옛 SHA-256 해시로 통과했으면 지금 scrypt 로 다시 저장한다.
     사용자는 아무것도 하지 않아도 다음 로그인부터 안전한 해시를 쓴다. */
  if (isLegacyHash(user.pw)) {
    const upgraded = await hashPassword(password);
    await updateJson('users', (list) => {
      const u = (list || []).find((x) => x.id === user.id);
      if (u) u.pw = upgraded;
      return list;
    }, []);
    console.log(`[lilac] 비밀번호 해시 이관: ${user.email}`);
  }

  const token = await issueSession(user.id);
  res.json({ token, user: publicUser(user) });
});
app.post('/api/auth/logout', async (req, res) => {
  // 해당 토큰만 파기한다. 예전처럼 세션 파일을 통째로 비우면 다른 사람도 같이 로그아웃됐다.
  const token = bearerToken(req);
  if (token) {
    await updateJson('sessions', (sessions) => { delete sessions[token]; }, {});
  }
  res.json({ ok: true });
});
app.get('/api/me', async (req, res) => res.json({ user: publicUser(await currentUser(req)) }));
app.patch('/api/me', requireUser(async (req, res) => withLock('file:users', async () => {
  if (req.body?.action && !DEMO_BILLING) return res.status(503).json({ error: '결제 서비스 준비 중입니다', code: 'BILLING_UNAVAILABLE' });
  if (('name' in (req.body || {}) && (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.length > 60)) || ('language' in (req.body || {}) && !['ko', 'ja', 'en'].includes(req.body.language))) return res.status(400).json({ error: '입력 형식을 확인해 주세요', code: 'INVALID_INPUT' });
  if (req.body?.action === 'topup' && (!Number.isSafeInteger(req.body.amount) || req.body.amount < 1 || req.body.amount > 1000000)) return res.status(400).json({ error: '금액을 확인해 주세요', code: 'INVALID_INPUT' });
  const users = await readJson('users', []);
  const idx = users.findIndex((u) => u.id === req.user.id);
  if (idx < 0) return res.status(401).json({ error: '로그인이 필요합니다', code: 'UNAUTHENTICATED' });
  const allowed = ['name', 'language'];
  for (const k of allowed) if (k in (req.body || {})) users[idx][k] = req.body[k];
  // 데모 액션들
  if (req.body?.action === 'topup') { users[idx].credits += Number(req.body.amount) || 0; }
  if (req.body?.action === 'upgrade') { users[idx].plan = { tier: 'premium', name: 'Lilac Premium (데모)', renewsAt: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) }; }
  if (req.body?.action === 'addCard') { users[idx].paymentMethods.push({ id: randomUUID().slice(0, 8), brand: req.body.brand || 'CARD', last4: String(req.body.last4 || '0000').slice(-4), addedAt: new Date().toISOString() }); }
  await writeJson('users', users);
  res.json({ user: publicUser(users[idx]) });
})));

/* 비밀번호 변경: 현재 비밀번호 확인 → 새 해시 저장 → 이 기기 말고 다른 로그인은 모두 끊는다 */
app.post('/api/me/password', requireUser(async (req, res) => withLock('file:users', async () => {
  const { current, next } = req.body || {};
  if (typeof current !== 'string' || typeof next !== 'string' || current.length > 256 || next.length > 256) return res.status(400).json({ error: '입력 형식을 확인해 주세요', code: 'INVALID_INPUT' });
  if (next.length < 8) return res.status(400).json({ error: '새 비밀번호는 8자 이상이어야 합니다', code: 'WEAK_PASSWORD' });
  const key = authKey(req, req.user.email);
  const waitSec = authBlocked(key);
  if (waitSec) return res.status(429).json({ error: `시도가 너무 많습니다. ${Math.ceil(waitSec / 60)}분 후 다시 시도해 주세요`, code: 'RATE_LIMITED' });
  const users = await readJson('users', []);
  const u = users.find((x) => x.id === req.user.id);
  if (!u || !(await verifyPassword(current, u.pw))) { noteAuthFail(key); return res.status(403).json({ error: '현재 비밀번호가 올바르지 않습니다', code: 'WRONG_PASSWORD' }); /* 401이면 화면이 로그인을 풀어 버린다 */ }
  clearAuthFail(key);
  u.pw = await hashPassword(next);
  await writeJson('users', users);
  const keep = bearerToken(req);
  await updateJson('sessions', (sessions) => { for (const [k, v] of Object.entries(sessions)) if (v?.userId === u.id && k !== keep) delete sessions[k]; }, {});
  res.json({ ok: true });
})));

/* 회원 탈퇴: 비밀번호 확인 → 계정·모든 로그인·개인 데이터(팔로우·재생 기록·보관함) 삭제.
   커뮤니티 글·댓글은 게시판 기록으로 남는다(탈퇴 화면에서 미리 알린다). */
app.delete('/api/me', requireUser(async (req, res) => withLock('file:users', async () => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length > 256) return res.status(400).json({ error: '입력 형식을 확인해 주세요', code: 'INVALID_INPUT' });
  const key = authKey(req, req.user.email);
  const waitSec = authBlocked(key);
  if (waitSec) return res.status(429).json({ error: `시도가 너무 많습니다. ${Math.ceil(waitSec / 60)}분 후 다시 시도해 주세요`, code: 'RATE_LIMITED' });
  const users = await readJson('users', []);
  const u = users.find((x) => x.id === req.user.id);
  if (!u || !(await verifyPassword(password, u.pw))) { noteAuthFail(key); return res.status(403).json({ error: '비밀번호가 올바르지 않습니다', code: 'WRONG_PASSWORD' }); }
  clearAuthFail(key);
  await writeJson('users', users.filter((x) => x.id !== u.id));
  await updateJson('sessions', (sessions) => { for (const [k, v] of Object.entries(sessions)) if (v?.userId === u.id) delete sessions[k]; }, {});
  if (/^[0-9a-f-]{36}$/i.test(u.id)) await rm(path.join(DB_DIR, 'user', u.id), { recursive: true, force: true });
  res.json({ ok: true });
})));

/* ================= 사용자 데이터 (전부 로그인 필수 · 사용자별 격리) =================
   이 구간의 모든 파일은 db/user/{userId}/ 아래에 있다.
   예전처럼 db/user/likes.json 같은 전역 파일을 쓰면 계정이 서로의 데이터를 본다. */

/* ---- 오시(팔로우) ---- */
app.get('/api/oshi', requireUser(async (req, res) =>
  res.json(await readJson(userPath(req.user.id, 'oshi'), []))));

app.post('/api/oshi', requireUser(async (req, res) => {
  const { artistId, name } = req.body || {};
  if (!artistId) return res.status(400).json({ error: 'artistId required', code: 'INVALID_INPUT' });
  const key = userPath(req.user.id, 'oshi');
  const list = await readJson(key, []);
  const i = list.findIndex((o) => o.artistId === artistId);
  if (i >= 0) list.splice(i, 1);
  else list.push({ artistId, name, at: new Date().toISOString() });
  await writeJson(key, list);
  res.json(list);
}));

/* ---- 좋아요 ---- */
app.get('/api/likes', requireUser(async (req, res) =>
  res.json(await readJson(userPath(req.user.id, 'likes'), []))));

app.post('/api/likes', requireUser(async (req, res) => {
  const t = req.body?.track;
  if (!t?.title) return res.status(400).json({ error: 'track required', code: 'INVALID_INPUT' });
  const key = userPath(req.user.id, 'likes');
  const list = await readJson(key, []);
  const k = norm(t.title) + '|' + norm(t.artist || '');
  const i = list.findIndex((x) => x.key === k);
  if (i >= 0) list.splice(i, 1);
  else list.unshift({ key: k, ...t, likedAt: new Date().toISOString() });
  await writeJson(key, list);
  res.json(list);
}));

/* ---- 재생 기록 ---- */
app.get('/api/history', requireUser(async (req, res) =>
  res.json(await readJson(userPath(req.user.id, 'history'), []))));

app.post('/api/history', requireUser(async (req, res) => {
  const t = req.body?.track;
  if (!t?.title) return res.status(400).json({ error: 'track required', code: 'INVALID_INPUT' });
  const key = userPath(req.user.id, 'history');
  let list = await readJson(key, []);
  list.unshift({ ...t, playedAt: new Date().toISOString() });
  list = list.slice(0, 100);
  await writeJson(key, list);
  res.json({ ok: true });
}));

/* ---- 플레이리스트 ---- */
const plKey = (req) => userPath(req.user.id, 'playlists');

app.get('/api/playlists', requireUser(async (req, res) =>
  res.json(await readJson(plKey(req), []))));

app.post('/api/playlists', requireUser(async (req, res) => {
  const list = await readJson(plKey(req), []);
  const pl = {
    id: randomUUID().slice(0, 8),
    name: String(req.body?.name || '새 플레이리스트').slice(0, 60),
    createdAt: new Date().toISOString(), tracks: [],
  };
  list.unshift(pl);
  await writeJson(plKey(req), list);
  res.json(pl);
}));

app.post('/api/playlists/:id/tracks', requireUser(async (req, res) => {
  const list = await readJson(plKey(req), []);
  const pl = list.find((p) => p.id === req.params.id);
  if (!pl) return res.status(404).json({ error: 'playlist not found', code: 'NOT_FOUND' });
  const t = req.body?.track;
  if (!t?.title) return res.status(400).json({ error: 'track required', code: 'INVALID_INPUT' });
  pl.tracks.push({ ...t, addedAt: new Date().toISOString() });
  await writeJson(plKey(req), list);
  res.json(pl);
}));

app.delete('/api/playlists/:id/tracks/:idx', requireUser(async (req, res) => {
  const list = await readJson(plKey(req), []);
  const pl = list.find((p) => p.id === req.params.id);
  if (!pl) return res.status(404).json({ error: 'playlist not found', code: 'NOT_FOUND' });
  pl.tracks.splice(Number(req.params.idx), 1);
  await writeJson(plKey(req), list);
  res.json(pl);
}));

app.patch('/api/playlists/:id', requireUser(async (req, res) => {
  const list = await readJson(plKey(req), []);
  const pl = list.find((p) => p.id === req.params.id);
  if (!pl) return res.status(404).json({ error: 'playlist not found', code: 'NOT_FOUND' });
  if (req.body?.name) pl.name = String(req.body.name).slice(0, 60);
  if (typeof req.body?.desc === 'string') pl.desc = req.body.desc.slice(0, 200);
  await writeJson(plKey(req), list);
  res.json(pl);
}));

app.put('/api/playlists/:id/tracks', requireUser(async (req, res) => {
  const list = await readJson(plKey(req), []);
  const pl = list.find((p) => p.id === req.params.id);
  if (!pl) return res.status(404).json({ error: 'playlist not found', code: 'NOT_FOUND' });
  if (!Array.isArray(req.body?.tracks)) return res.status(400).json({ error: 'tracks array required', code: 'INVALID_INPUT' });
  pl.tracks = req.body.tracks;
  await writeJson(plKey(req), list);
  res.json(pl);
}));

app.delete('/api/playlists/:id', requireUser(async (req, res) => {
  let list = await readJson(plKey(req), []);
  if (!list.some((p) => p.id === req.params.id)) return res.status(404).json({ error: 'playlist not found', code: 'NOT_FOUND' });
  list = list.filter((p) => p.id !== req.params.id);
  await writeJson(plKey(req), list);
  res.json(list);
}));


/* ================= 릴리스 · 판매처 비교 =================
   지금까지 스토어는 앨범 메타데이터에 지어낸 가격을 얹고 판매처 "검색 결과"로
   링크만 걸었다. 그 상태로는 수수료가 발생하지 않고 정보 비대칭도 그대로다.

   실제 구매 결정 구조를 조사해보면(docs/bm-store-review.md) 한 장의 앨범이
   사양 5종 × 판매처 9종으로 갈리고, 판매처마다 특전이 전부 다르다.
   한국 팬이 그걸 비교할 방법이 없다는 것이 진짜 문제다.

   그래서 Release → Edition → Offer 로 모델을 바꾸고,
   여기서 "한국 팬이 실제로 낼 금액"으로 환산해 나란히 세운다. */

const RELEASE_COLLECTION = 'releases';

/** 릴리스 통화 → 구매자 통화 환산에 쓸 환율 */
async function fxRates() {
  const fx = await readJson('fx', null);
  return { jpyKrw: fx?.jpyKrw ?? 8.7, krwJpy: fx?.krwJpy ?? 0.115, date: fx?.date, source: fx?.source };
}

/**
 * 한 릴리스의 모든 (사양 × 판매처) 조합에 최종가를 매겨 돌려준다.
 * 가격 계산은 주문과 같은 pricing.quote() 를 쓴다 — 화면과 청구가 갈라지지 않게.
 */
/** 같은 사양 안에서의 최저가 대비 차액을 매긴다 */
function r_diff(rows, bucket) {
  rows.filter((r) => r.editionId === bucket.editionId)
    .forEach((r) => { r.diffFromCheapest = r.quote.total - bucket.min; });
}

async function buildComparison(release, planTier, buyerCountry) {
  const fx = await fxRates();
  const isJp = release.country === 'jp';
  // 일본반을 한국 팬이 사면 JPY→KRW. 한국반을 한국 팬이 사면 환산 없음.
  const rate = isJp && buyerCountry === 'kr' ? fx.jpyKrw : 1;
  const origin = isJp ? 'jp' : 'kr';

  const rows = [];
  for (const offer of release.offers || []) {
    for (const edId of offer.editions || []) {
      const ed = (release.editions || []).find((e) => e.id === edId);
      if (!ed) continue;
      const q = quote({
        localAmount: ed.listPrice,
        origin,
        feeKind: ed.feeKind || 'album',
        rate,
        qty: 1,
        planTier,
      });
      rows.push({
        editionId: ed.id,
        editionLabel: ed.label,
        catalogNo: ed.catalogNo || null,
        includes: ed.includes || [],
        exclusiveTo: ed.exclusiveTo || null,
        editionNote: ed.note || null,
        offerId: offer.id,
        store: offer.store,
        storeKo: offer.storeKo || offer.store,
        storeCountry: offer.country,
        url: offer.url,
        bonus: offer.bonus || null,
        bonusJa: offer.bonusJa || null,
        /* 캠페인 대상 여부 — MGA 의 GREEN CODE 처럼 "이 판매처에서 사야만"
           받는 응모권이 있다. 이게 특전보다 중요한 경우가 많다. */
        campaignEligible: release.campaign
          ? Boolean(offer.greenCode) && (release.campaign.eligibleEditions || []).includes(ed.id)
          : null,
        shipsDirect: buyerCountry === 'kr' ? Boolean(offer.shipsToKorea) : Boolean(offer.shipsToJapan),
        verified: offer.verified !== false,
        offerNote: offer.note || null,
        listPrice: ed.listPrice,
        listCurrency: release.currency,
        quote: q,
      });
    }
  }

  rows.sort((a, b) => a.quote.total - b.quote.total);

  /* 가격 폭은 반드시 "같은 사양 안에서" 재야 한다.
     사양을 섞어 최저~최고를 내면 통상반과 한정BOX를 비교하는 꼴이라 의미가 없다. */
  const byEdition = {};
  for (const r of rows) {
    const b = (byEdition[r.editionId] ||= { editionId: r.editionId, label: r.editionLabel, min: Infinity, max: -Infinity, stores: 0 });
    b.min = Math.min(b.min, r.quote.total);
    b.max = Math.max(b.max, r.quote.total);
    b.stores++;
  }
  for (const b of Object.values(byEdition)) {
    b.spread = b.max - b.min;
    r_diff(rows, b);
  }

  /* 일본 음반은 독점금지법 §24-2 의 재판매가격유지 예외 대상이라
     판매처가 달라도 정가가 같은 것이 원칙이다(서적·신문·음반 등 저작물).
     그래서 이 비교표의 실제 변수는 "가격"이 아니라 특전과 직배송 여부다.
     화면이 가격 비교인 척하면 사용자를 오도한다. */
  /* 빈 배열에 every() 는 true 다 — 비교할 판매처가 없는데
     "판매처가 달라도 가격은 같습니다"가 뜨면 거짓말이 된다. 행이 있을 때만 판정한다. */
  const priceFixed = rows.length > 0
    && release.country === 'jp'
    && Object.values(byEdition).every((b) => b.spread === 0);

  return {
    rate, fx,
    buyerCountry,
    planTier,
    rows,
    byEdition: Object.values(byEdition),
    priceFixed,
    decisiveFactors: priceFixed
      ? ['특전', '한국 직배송 여부', release.campaign ? release.campaign.name : null].filter(Boolean)
      : ['최종가', '특전', '한국 직배송 여부'],
  };
}

/* ---------- 릴리스 동기화 ----------
   Apple iTunes API 로 44팀의 신보를 주기적으로 훑는다.
   curated(사람이 특전까지 확인한 것)는 절대 덮어쓰지 않는다 —
   자동 수집이 확인된 특전 정보를 조용히 지워버리면 안 된다. */
const SYNC_INTERVAL_MS = 6 * 60 * 60_000;   // 6시간
let syncState = { running: false, lastAt: null, lastResult: null };

/* 릴리스의 캠페인(예약구매 특전 등)에서 실제 일정을 만든다.
   예전엔 events.json 에 "Mrs. GREEN APPLE 단독 내한 공연" 같은
   지어낸 일정 12건이 isDemo 로 들어 있었다. 팬이 그걸 보고 일정을 잡을 수 있어
   비어 있는 것보다 나쁘다. 출처가 있는 마감일만 남긴다. */
async function rebuildCampaignEvents() {
  const releases = await readJson(RELEASE_COLLECTION, []);
  const derived = [];
  for (const r of releases) {
    if (!r.campaign?.storeClosesAt) continue;
    derived.push({
      id: `camp-${r.id}`,
      type: '응모',
      title: `${r.campaign.name} 예약 마감`,
      artist: r.artistKo || r.artist,
      artistId: r.artistId,
      country: r.country,
      date: r.campaign.storeClosesAt,
      venue: '대상 점포·EC',
      note: r.campaign.desc?.slice(0, 80) || '',
      isDemo: false,
      source: r.source?.name || '레이블 공식',
      sourceUrl: r.source?.url || null,
      releaseId: r.id,
    });
  }

  const events = await readJson('events', []);
  // 지어낸 일정과 이전 파생분을 걷어내고 다시 만든다
  const kept = events.filter((e) => !e.isDemo && !String(e.id || '').startsWith('camp-'));
  const merged = [...kept, ...derived].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const removed = events.length - kept.length;
  await writeJson('events', merged);
  if (removed || derived.length) {
    console.log(`[lilac] 일정 정리 — 지어낸/구파생 ${removed}건 제거, 캠페인 파생 ${derived.length}건 생성`);
  }
}

/* ── 환율 자동 갱신 ────────────────────────────────────────
   환율은 collect-products.mjs 안에만 있어서 상품을 다시 수집할 때만 갱신됐다.
   실측 214시간(9일) 묵은 값으로 스토어 가격을 계산하고 있었고,
   실제 환율과 1.6% 어긋나 있었다. 화면 금액과 청구가 갈라지면 안 된다. */
const FX_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FX_STALE_H = 12;

async function refreshFx(reason = 'manual') {
  try {
    const prev = await readJson('fx', null);
    if (reason === 'boot' && prev && fxAgeHours(prev) < FX_STALE_H) {
      return { skipped: 'fresh', ageH: fxAgeHours(prev) };
    }
    const fx = await fetchFx(prev);
    await writeJson('fx', { ...fx, count: prev?.count });
    /* 환율이 실제로 바뀐 경우에만 화면에 알린다(ECB 기준 환율은 영업일마다 한 번 바뀐다) */
    if (!prev || prev.jpyKrw !== fx.jpyKrw || prev.date !== fx.date) live.notify('fx', { key: 'fx' });
    if (fx.live) {
      const delta = prev?.jpyKrw ? ((fx.jpyKrw - prev.jpyKrw) / prev.jpyKrw) * 100 : 0;
      console.log(`[lilac] 환율 갱신(${reason}) — 1엔 = ${fx.jpyKrw}원 (${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%)`);
    } else {
      console.warn(`[lilac] 환율 갱신 실패(${reason}) — 이전 값을 유지한다: ${fx.error || '알 수 없음'}`);
    }
    return fx;
  } catch (e) {
    console.warn('[lilac] 환율 갱신 오류:', e.message);
    return { error: e.message };
  }
}

/* ── 수집형 차트 자동 갱신 ─────────────────────────────────
   빌보드재팬·오리콘·멜론·지니는 collect-charts.mjs 가 모으는데
   사람이 손으로 돌릴 때만 실행됐다 — 실측 218시간(9일) 정체.
   화면은 "실시간 차트"라고 적혀 있었으니 표기와 실제가 달랐다.

   수집이 무겁고(여러 사이트 스크레이핑) 색인 재생성까지 하므로
   부팅을 막지 않게 백그라운드로 돌리고, 간격을 넉넉히 둔다. */
const CHART_INTERVAL_MS = 3 * 60 * 60 * 1000;
const CHART_STALE_H = 3;
let chartSync = { running: false, lastAt: null, lastError: null };

async function chartAgeHours() {
  const c = await readJson('charts', null);
  const t = Date.parse(c?.updated || '');
  return Number.isFinite(t) ? (Date.now() - t) / 36e5 : Infinity;
}

async function runChartCollect(reason = 'manual') {
  if (chartSync.running) return { skipped: 'already-running' };
  const age = await chartAgeHours();
  if (reason === 'boot' && age < CHART_STALE_H) {
    return { skipped: 'fresh', ageH: age };
  }
  const unlock = await acquireSyncLock(DB_DIR, 'chart-collect', { ttlMs: 30 * 60 * 1000 });
  if (!unlock) {
    console.log(`[lilac] 차트 수집 건너뜀(${reason}) — 다른 인스턴스가 수집 중`);
    return { skipped: 'locked-by-other-process' };
  }
  chartSync.running = true;
  const started = Date.now();
  try {
    const { collectCharts } = await import('./collect-charts.mjs');
    await collectCharts();
    chartSync.lastAt = new Date().toISOString();
    chartSync.lastError = null;
    console.log(`[lilac] 차트 수집(${reason}) — ${Date.now() - started}ms`);
    live.notify('charts', { key: 'charts' });
    return { ok: true, ms: Date.now() - started };
  } catch (e) {
    chartSync.lastError = e.message;
    console.warn(`[lilac] 차트 수집 실패(${reason}):`, e.message);
    return { error: e.message };
  } finally {
    await unlock();
    chartSync.running = false;
  }
}

/* ── 아티스트 로스터 자동 갱신 ─────────────────────────────
   로스터는 차트에서 파생되는데 사람이 손으로 돌릴 때만 갱신됐다.
   게다가 애플 레이트리밋에 걸린 팀이 "카탈로그 미확인"으로 조용히 빠져
   44팀에 묶여 있었다. 이제 실패는 보류로 남으므로, 주기 실행이
   애플이 풀린 시점에 알아서 채운다.

   차트 수집보다 뒤에 돌아야 한다(차트가 후보를 만든다). */
const ROSTER_INTERVAL_MS = 12 * 60 * 60 * 1000;
let rosterSync = { running: false, lastAt: null, lastError: null };

async function runRosterCollect(reason = 'manual') {
  if (rosterSync.running) return { skipped: 'already-running' };
  /* 재시작할 때마다 7분씩 애플을 두드리지 않게: 부팅 때는 로스터가 3시간 안에 갱신됐으면 건너뛴다 */
  if (reason === 'boot') {
    try { const st = await stat(path.join(DB_DIR, 'artists.json')); if (Date.now() - st.mtimeMs < 3 * 3600e3) { console.log('[lilac] 로스터 갱신 건너뜀(boot) — 3시간 안에 갱신됨'); return { skipped: 'fresh' }; } } catch { /* 처음 */ }
  }
  const unlock = await acquireSyncLock(DB_DIR, 'artist-roster', { ttlMs: 30 * 60 * 1000 });
  if (!unlock) {
    console.log(`[lilac] 로스터 갱신 건너뜀(${reason}) — 다른 인스턴스가 수집 중`);
    return { skipped: 'locked-by-other-process' };
  }
  rosterSync.running = true;
  const started = Date.now();
  const before = (await readJson('artists', [])).length;
  try {
    const { collectArtists } = await import('./collect-artists.mjs');
    await collectArtists();
    const after = (await readJson('artists', [])).length;
    rosterSync.lastAt = new Date().toISOString();
    rosterSync.lastError = null;
    console.log(`[lilac] 로스터 갱신(${reason}) — ${before}팀 → ${after}팀 · ${Date.now() - started}ms`);
    return { ok: true, before, after };
  } catch (e) {
    rosterSync.lastError = e.message;
    console.warn(`[lilac] 로스터 갱신 실패(${reason}):`, e.message);
    return { error: e.message };
  } finally {
    await unlock();
    rosterSync.running = false;
  }
}

/* ── 곡 카탈로그 동기화 ──────────────────────────────────────
   아티스트별 애플 전체 디스코그래피(스토어별 200곡 상한)를 저장한다.
   화면이 매번 애플을 부르지 않게 하고, 곡 데이터를 자산으로 쌓는다. */
const CATALOG_INTERVAL_MS = 24 * 60 * 60 * 1000;
let catalogSync = { running: false, lastAt: null, lastError: null };

async function runCatalogSync(reason = 'manual') {
  if (catalogSync.running) return { skipped: 'already-running' };
  const unlock = await acquireSyncLock(DB_DIR, 'catalog-sync', { ttlMs: 60 * 60 * 1000 });
  if (!unlock) { console.log(`[lilac] 카탈로그 동기화 건너뜀(${reason}) — 다른 인스턴스가 수집 중`); return { skipped: 'locked-by-other-process' }; }
  catalogSync.running = true;
  const started = Date.now();
  try {
    const artists = await readJson('artists', []);
    const prev = await readJson('catalog', { artists: {} });
    const r = await syncCatalog(artists, prev);
    await writeJson('catalog', r.catalog);
    catalogSync.lastAt = new Date().toISOString(); catalogSync.lastError = null;
    console.log(`[lilac] 카탈로그 동기화(${reason}) — 갱신 ${r.stats.updated} · 유지 ${r.stats.kept} · 실패 ${r.stats.failed} · 총 ${r.stats.artists}팀 ${r.stats.tracks}곡 · ${Date.now() - started}ms`);
    return r.stats;
  } catch (e) {
    catalogSync.lastError = e.message; console.warn(`[lilac] 카탈로그 동기화 실패(${reason}):`, e.message); return { error: e.message };
  } finally { await unlock(); catalogSync.running = false; }
}

async function runReleaseSync(reason = 'manual') {
  if (syncState.running) return { skipped: 'already-running' };

  /* 인스턴스가 여럿이면 하나만 돈다.
     프로세스 안의 withLock 은 같은 프로세스만 막는다. 실제로 백엔드 11개가
     동시에 애플을 두드려 레이트리밋에 걸렸고, 그 0건 응답이 릴리스 128건을
     덮어쓰는 사고로 이어졌다. */
  const unlock = await acquireSyncLock(DB_DIR, 'release-sync');
  if (!unlock) {
    console.log(`[lilac] 릴리스 동기화 건너뜀(${reason}) — 다른 인스턴스가 수집 중`);
    return { skipped: 'locked-by-other-process' };
  }

  syncState.running = true;
  const started = Date.now();
  try {
    const [artists, existing] = await Promise.all([
      readJson('artists', []),
      readJson(RELEASE_COLLECTION, []),
    ]);
    const out = await syncReleases({ artists, existing });

    if (out.skipped) {
      console.warn(
        `[lilac] 릴리스 동기화 보류(${out.skipped}) — 수집 ${out.stats.discovered}건, 오류 ${out.stats.errors}건. 기존 데이터를 유지한다`,
      );
    }
    await writeJson(RELEASE_COLLECTION, out.releases);

    // 변경 이력 — 무엇이 언제 바뀌었는지 남아야 화면의 "신보" 표시를 신뢰할 수 있다
    if (out.changes.length) {
      await updateJson('sync-log', (log) => {
        const cur = log || [];
        cur.unshift({
          at: out.at, reason, ms: Date.now() - started,
          stats: out.stats,
          changes: out.changes.slice(0, 50),
          errors: out.errors.slice(0, 10),
        });
        return cur.slice(0, 50);
      }, []);
    }

    /* 릴리스 커버 보강 — 새 릴리스가 들어와도 자동으로 채워지게 한다 */
    try {
      await updateJson(RELEASE_COLLECTION, async (rels) => {
        const r = await backfillReleaseArt(rels);
        if (r.filled) console.log(`[lilac] 릴리스 커버 보강 — ${r.filled}건`);
        if (r.dateConflicts?.length) {
          for (const c of r.dateConflicts) {
            console.warn(`[lilac] 발매일 불일치 ${c.id}: 저장 ${c.ours} vs 애플 ${c.apple} (덮어쓰지 않음)`);
          }
        }
        return rels;
      }, []);
    } catch (e) {
      console.warn('[lilac] 릴리스 커버 보강 실패:', e.message);
    }

    await rebuildCampaignEvents();

    /* 아티스트 아트워크 보강 — 새 아티스트가 들어와도 자동으로 채워지게 한다.
       손으로 채우면 다음에 추가되는 팀에서 또 빈다. */
    try {
      await updateJson('artists', async (arts) => {
        const r = await backfillArtwork(arts);
        if (r.filled) console.log(`[lilac] 아티스트 아트워크 보강 — ${r.filled}건`);
        /* 공식 운영사(레이블)도 같이 채운다. MusicBrainz 는 초당 1회 제한이라
           오래 걸리므로, 새로 추가된 아티스트만 대상이 되도록
           이미 값이 있으면 건너뛴다(backfillOperator 안에서 처리). */
        const o = await backfillOperator(arts);
        if (o.filled) console.log(`[lilac] 아티스트 운영사 보강 — ${o.filled}건`);
        /* 공식 채널 링크 — 같은 MusicBrainz 이므로 여기서 이어서 */
        const l = await backfillLinks(arts);
        if (l.filled) console.log(`[lilac] 아티스트 공식 채널 보강 — ${l.filled}건`);
        return arts;
      }, []);
    } catch (e) {
      console.warn('[lilac] 아트워크 보강 실패:', e.message);
    }

    syncState.lastAt = out.at;
    syncState.lastResult = { ...out.stats, changes: out.changes.length, ms: Date.now() - started };
    console.log(`[lilac] 릴리스 동기화(${reason}) — curated ${out.stats.curated} · discovered ${out.stats.discovered}`
      + ` · 변경 ${out.changes.length} · 오류 ${out.stats.errors} · ${Date.now() - started}ms`);
    return syncState.lastResult;
  } catch (e) {
    console.warn('[lilac] 릴리스 동기화 실패:', e?.message || e);
    syncState.lastResult = { error: String(e?.message || e).slice(0, 120) };
    return syncState.lastResult;
  } finally {
    await unlock();
    syncState.running = false;
  }
}

app.get('/api/store/sync', async (_req, res) => {
  res.json({
    ...syncState,
    intervalMs: SYNC_INTERVAL_MS,
    nextAt: syncState.lastAt
      ? new Date(new Date(syncState.lastAt).getTime() + SYNC_INTERVAL_MS).toISOString()
      : null,
    log: (await readJson('sync-log', [])).slice(0, 10),
  });
});

app.post('/api/store/sync', async (_req, res) => {
  // 데모라 인증 없이 열어두되, 동시 실행은 막는다(중복 외부 호출 방지)
  if (syncState.running) {
    return res.status(409).json({ error: '이미 동기화가 진행 중입니다', code: 'SYNC_RUNNING' });
  }
  const result = await runReleaseSync('manual');
  res.json({ result, at: syncState.lastAt });
});

app.get('/api/store/releases', async (req, res) => {
  let list = await readJson(RELEASE_COLLECTION, []);
  res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');

  // 135건까지 늘었다. 필터 없이 전부 내리면 화면이 감당하지 못한다.
  if (req.query.tier) list = list.filter((r) => (r.tier || 'curated') === req.query.tier);
  if (req.query.country) list = list.filter((r) => r.country === req.query.country);
  if (req.query.artistId) list = list.filter((r) => r.artistId === req.query.artistId);
  const total = list.length;
  const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const page = list.slice(offset, offset + limit);

  res.json({
    total, offset, limit, hasMore: offset + limit < total,
    releases: page.map((r) => ({
      id: r.id, artist: r.artist, artistKo: r.artistKo, artistId: r.artistId,
      title: r.title, titleKo: r.titleKo, country: r.country, type: r.type,
      releaseDate: r.releaseDate, currency: r.currency,
      // 등급을 숨기면 "특전 확인됨"과 "아직 확인 안 됨"이 화면에서 같아 보인다
      tier: r.tier || 'curated',
      artwork: r.artwork || null,
      // 커버가 없는 이유를 화면이 구분할 수 있게 — 아직 안 받은 것과
      // 레이블이 공개하지 않은 것은 다르다
      artworkStatus: r.artworkStatus || null,
      // 사람이 넣은 발매일과 애플이 말하는 발매일이 다르면 둘 다 내려보낸다
      appleReleaseDate: r.appleReleaseDate || null,
      editionCount: (r.editions || []).length,
      offerCount: (r.offers || []).length,
      hasCampaign: Boolean(r.campaign),
      source: r.source,
    })),
  });
});

app.get('/api/store/releases/:id', async (req, res) => {
  const list = await readJson(RELEASE_COLLECTION, []);
  const release = list.find((r) => r.id === req.params.id);
  if (!release) return res.status(404).json({ error: '릴리스를 찾을 수 없습니다', code: 'NOT_FOUND' });

  const user = await currentUser(req);
  const planTier = user?.plan?.tier || 'free';
  const buyerCountry = req.query.buyer === 'jp' ? 'jp' : 'kr';

  res.json({
    release: {
      id: release.id, artist: release.artist, artistKo: release.artistKo, artistId: release.artistId,
      title: release.title, titleKo: release.titleKo, country: release.country,
      type: release.type, releaseDate: release.releaseDate, currency: release.currency,
      tier: release.tier || 'curated', artwork: release.artwork || null, appleUrl: release.appleUrl || null,
      // 확인된 판매처가 없을 때 화면이 대안을 제시할 수 있게 함께 내려준다
      searchHints: release.searchHints || [],
      note: release.note, source: release.source, campaign: release.campaign || null,
      editions: release.editions,
    },
    comparison: await buildComparison(release, planTier, buyerCountry),
  });
});

/* ---- 감시(watch) ----
   링크가 못 하는 일이 이것이다. 예약 창은 닫히고 한정반은 재입고가 없다.
   MGA 의 GREEN CODE 예약 기간처럼 놓치면 끝나는 구간이 실재한다. */
app.get('/api/watches', requireUser(async (req, res) => {
  res.json(await readJson(userPath(req.user.id, 'watches'), []));
}));

app.post('/api/watches', requireUser(async (req, res) => {
  const { releaseId, offerId, editionId } = req.body || {};
  if (!releaseId) return res.status(400).json({ error: 'releaseId required', code: 'INVALID_INPUT' });
  const list = await readJson(RELEASE_COLLECTION, []);
  const release = list.find((r) => r.id === releaseId);
  if (!release) return res.status(404).json({ error: '릴리스를 찾을 수 없습니다', code: 'NOT_FOUND' });

  const key = userPath(req.user.id, 'watches');
  const saved = await updateJson(key, (arr) => {
    const cur = arr || [];
    const sig = `${releaseId}|${offerId || ''}|${editionId || ''}`;
    const i = cur.findIndex((w) => `${w.releaseId}|${w.offerId || ''}|${w.editionId || ''}` === sig);
    if (i >= 0) cur.splice(i, 1);          // 토글
    else cur.unshift({
      releaseId, offerId: offerId || null, editionId: editionId || null,
      artist: release.artist, title: release.titleKo || release.title,
      releaseDate: release.releaseDate,
      campaignClosesAt: release.campaign?.storeClosesAt || null,
      at: new Date().toISOString(),
    });
    return cur;
  }, []);
  res.json(saved);
}));

/** 마감 임박 감시 목록 — 알림 대상 계산 */
app.get('/api/watches/due', requireUser(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 90);
  const list = await readJson(userPath(req.user.id, 'watches'), []);
  const now = Date.now();
  const due = list
    .map((w) => {
      const dates = [w.campaignClosesAt, w.releaseDate].filter(Boolean).map((d) => new Date(d).getTime());
      const next = dates.filter((t) => t >= now).sort((a, b) => a - b)[0] ?? null;
      return next ? { ...w, nextAt: new Date(next).toISOString(), daysLeft: Math.ceil((next - now) / 864e5) } : null;
    })
    .filter((w) => w && w.daysLeft <= days)
    .sort((a, b) => a.daysLeft - b.daysLeft);
  res.json({ due, windowDays: days });
}));

/* ================= 멤버십 (Lilac Pass) =================
   BM 사다리에서 멤버십은 커머스 다음 칸이고, 지금까지 0% 구현 상태였다.
   혜택을 "중개 수수료 할인"으로 잡은 이유: 배송비를 깎으면 실제 원가가 나가지만
   수수료는 우리 몫이라 마진 안에서 조절할 수 있다. */
app.get('/api/plans', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ plans: Object.values(PLANS) });
});

app.post('/api/membership/subscribe', requireUser(async (req, res) => {
  const tier = String(req.body?.tier || '');
  if (!(tier in PLANS)) {
    return res.status(400).json({ error: '알 수 없는 요금제입니다', code: 'INVALID_INPUT' });
  }
  const plan = PLANS[tier];

  // 구독도 크레딧을 깎는다 — 주문과 같은 이유로 사용자 단위 락이 필요하다
  let u;
  try {
    u = await withLock(`user:${req.user.id}`, async () => {
      const users = await readJson('users', []);
      const me = users.find((x) => x.id === req.user.id);
      if (!me) throw Object.assign(new Error('계정을 찾을 수 없습니다'), { status: 404, code: 'NOT_FOUND' });
      if (plan.priceKrw > 0) {
        if (me.credits < plan.priceKrw) {
          throw Object.assign(
            new Error(`크레딧이 부족합니다 (보유 ${me.credits.toLocaleString()} / 필요 ${plan.priceKrw.toLocaleString()})`),
            { status: 402, code: 'INSUFFICIENT_CREDITS' },
          );
        }
        me.credits -= plan.priceKrw;
      }
      me.plan = {
        tier: plan.tier,
        name: plan.name,
        priceKrw: plan.priceKrw,
        renewsAt: plan.priceKrw > 0 ? new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) : null,
      };
      await writeJson('users', users);
      return me;
    });
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.status && e.status < 500 ? e.message : '구독 처리 실패', code: e?.status && e.status < 500 ? e.code : 'INTERNAL' });
  }

  // 구독 이력 — B2B 단계에서 팬 데이터로 쓰일 최소 단위
  const key = userPath(req.user.id, 'membership');
  const log = await readJson(key, []);
  log.unshift({ at: new Date().toISOString(), tier: plan.tier, chargedKrw: plan.priceKrw });
  await writeJson(key, log.slice(0, 100));

  res.json({ plan: u.plan, credits: u.credits, perks: plan.perks });
}));

app.post('/api/membership/cancel', requireUser(async (req, res) => {
  const users = await readJson('users', []);
  const u = users.find((x) => x.id === req.user.id);
  u.plan = { tier: 'free', name: 'Free', priceKrw: 0, renewsAt: null };
  await writeJson('users', users);
  res.json({ plan: u.plan });
}));

/* ================= 공동구매 =================
   해외 음반은 1인 물량으로는 배송비 분담이 안 된다.
   목표 수량에 도달하면 단가가 내려가는 구조가 커머스 사다리의 핵심 기전이다.
   (전매·양도 중개는 일본 부정전매금지법 때문에 사업 범위에서 제외한다 —
    여기서 다루는 건 공동 "구매"이지 재판매가 아니다) */

/** 달성률 → 할인율. 목표를 넘겨도 30%에서 멈춘다(pricing.quote 도 같은 상한). */
function groupTier(joined, target) {
  const r = target > 0 ? joined / target : 0;
  if (r >= 1) return 0.15;
  if (r >= 0.6) return 0.10;
  if (r >= 0.3) return 0.05;
  return 0;
}

/** 릴리스+사양으로 진행 중인 공동구매를 찾는다 */
async function findGroupBuy({ releaseId, editionId, productId }) {
  const list = await groupBuysWithState();
  return list.find((g) => {
    if (g.closed) return false;
    if (releaseId) return g.releaseId === releaseId && (!g.editionId || !editionId || g.editionId === editionId);
    if (productId) return g.productId === productId;
    return false;
  }) || null;
}

async function groupBuysWithState() {
  const list = await readJson('groupbuys', []);
  const now = Date.now();
  return list.map((g) => {
    const joined = (g.participants || []).reduce((n, p) => n + (p.qty || 1), 0);
    const closesAt = new Date(g.closesAt).getTime();
    const closed = now > closesAt;
    return {
      ...g,
      joined,
      progress: g.target > 0 ? Math.min(1, joined / g.target) : 0,
      discount: groupTier(joined, g.target),
      nextDiscount: joined >= g.target ? null
        : joined >= g.target * 0.6 ? { at: g.target, rate: 0.15 }
        : joined >= g.target * 0.3 ? { at: Math.ceil(g.target * 0.6), rate: 0.10 }
        : { at: Math.ceil(g.target * 0.3), rate: 0.05 },
      closed,
      msLeft: Math.max(0, closesAt - now),
    };
  });
}

app.get('/api/groupbuys', async (req, res) => {
  const user = await currentUser(req);
  const plan = planOf(user?.plan?.tier);
  const now = Date.now();
  const list = (await groupBuysWithState()).map((g) => {
    // 선행 참여 — 멤버십 등급에 따라 오픈 시각이 당겨진다
    const opensAt = new Date(g.opensAt).getTime();
    const myOpensAt = opensAt - plan.groupBuyEarlyMin * 60_000;
    return {
      ...g,
      openForMe: now >= myOpensAt,
      myOpensAt: new Date(myOpensAt).toISOString(),
      earlyAccessMin: plan.groupBuyEarlyMin,
    };
  });
  res.json({ groupBuys: list, planTier: plan.tier });
});

app.post('/api/groupbuys/:id/join', requireUser(async (req, res) => {
  const qty = Math.max(1, Math.min(Number(req.body?.qty) || 1, 5));
  const plan = planOf(req.user.plan?.tier);

  /* 여러 명이 동시에 참여하면 각자 같은 목록을 읽고 서로의 참여를 덮어쓴다.
     주문에서 실측한 lost update 와 같은 문제라 원자적 갱신으로 처리한다. */
  try {
    await updateJson('groupbuys', (list) => {
      const g = (list || []).find((x) => x.id === req.params.id);
      if (!g) throw Object.assign(new Error('공동구매를 찾을 수 없습니다'), { status: 404, code: 'NOT_FOUND' });

      const now = Date.now();
      if (now > new Date(g.closesAt).getTime()) {
        throw Object.assign(new Error('이미 마감된 공동구매입니다'), { status: 409, code: 'GROUPBUY_CLOSED' });
      }
      const myOpensAt = new Date(g.opensAt).getTime() - plan.groupBuyEarlyMin * 60_000;
      if (now < myOpensAt) {
        throw Object.assign(new Error('아직 참여 시간이 아닙니다'), {
          status: 409, code: 'GROUPBUY_NOT_OPEN', opensAt: new Date(myOpensAt).toISOString(),
        });
      }

      g.participants = g.participants || [];
      const mine = g.participants.find((p) => p.userId === req.user.id);
      if (mine) mine.qty = qty;
      else g.participants.push({ userId: req.user.id, qty, at: new Date().toISOString() });
      return list;
    }, []);
  } catch (e) {
    return res.status(e?.status || 500).json({
      error: e?.message || '참여 처리 실패', code: e?.code || 'INTERNAL',
      ...(e?.opensAt ? { opensAt: e.opensAt } : {}),
    });
  }
  // g 는 updateJson 클로저 안의 지역 변수라 여기선 보이지 않는다.
  // (리팩터링 때 이걸 놓쳐 서버가 ReferenceError 로 죽었다 — node --check 로는 안 잡힌다)
  const state = (await groupBuysWithState()).find((x) => x.id === req.params.id);
  res.json({ groupBuy: state });
}));

app.post('/api/groupbuys/:id/leave', requireUser(async (req, res) => {
  let missing = false;
  await updateJson('groupbuys', (list) => {
    const g = (list || []).find((x) => x.id === req.params.id);
    if (!g) { missing = true; return list; }
    g.participants = (g.participants || []).filter((p) => p.userId !== req.user.id);
    return list;
  }, []);
  if (missing) return res.status(404).json({ error: '공동구매를 찾을 수 없습니다', code: 'NOT_FOUND' });
  const state = (await groupBuysWithState()).find((x) => x.id === req.params.id);
  res.json({ groupBuy: state });
}));

/* ================= 견적 =================
   결제 전에 화면이 보여주는 금액과 실제로 빠지는 금액이 같아야 한다.
   그래서 주문과 같은 pricing.quote() 를 쓰는 견적 엔드포인트를 따로 둔다. */
/* 견적 — 두 가지 입력을 받는다.
   (a) releaseId + offerId + editionId : 실데이터(판매처 비교표에서 온 요청)
   (b) productId                        : 레거시 스토어(가격의 상당수가 추정치)
   둘 다 같은 pricing.quote() 를 거쳐 화면과 청구가 갈라지지 않게 한다. */
app.get('/api/quote', async (req, res) => {
  if (req.query.releaseId) {
    const releases = await readJson(RELEASE_COLLECTION, []);
    const release = releases.find((r) => r.id === req.query.releaseId);
    if (!release) return res.status(404).json({ error: '릴리스를 찾을 수 없습니다', code: 'NOT_FOUND' });
    const ed = (release.editions || []).find((e) => e.id === req.query.editionId) || release.editions?.[0];
    if (!ed) return res.status(404).json({ error: '사양을 찾을 수 없습니다', code: 'NOT_FOUND' });
    const offer = (release.offers || []).find((o) => o.id === req.query.offerId) || release.offers?.[0];
    if (!offer) return res.status(404).json({ error: '판매처를 찾을 수 없습니다', code: 'NOT_FOUND' });
    if (!(offer.editions || []).includes(ed.id)) {
      return res.status(409).json({ error: '이 판매처는 해당 사양을 취급하지 않습니다', code: 'OFFER_EDITION_MISMATCH' });
    }

    const user = await currentUser(req);
    const fx = await fxRates();
    const gb = await findGroupBuy({ releaseId: release.id, editionId: ed.id });
    const rate = release.country === 'jp' ? fx.jpyKrw : 1;

    return res.json({
      quote: quote({
        localAmount: ed.listPrice,
        origin: release.country === 'jp' ? 'jp' : 'kr',
        feeKind: ed.feeKind || 'album',
        rate,
        qty: Number(req.query.qty) || 1,
        planTier: user?.plan?.tier || 'free',
        groupDiscount: gb?.discount || 0,
      }),
      groupBuyId: gb?.id || null,
      release: { id: release.id, title: release.titleKo || release.title, artist: release.artistKo || release.artist },
      edition: { id: ed.id, label: ed.label },
      offer: { id: offer.id, store: offer.storeKo || offer.store, url: offer.url, bonus: offer.bonus || null },
      rateDate: fx.date,
    });
  }

  const products = await readJson('products', []);
  const product = products.find((p) => p.id === req.query.productId);
  if (!product) return res.status(404).json({ error: '상품을 찾을 수 없습니다', code: 'NOT_FOUND' });

  const edition = (product.editions || []).find(
    (e) => e.id === req.query.option || e.label === req.query.option,
  ) || product.editions?.[0];
  if (!edition) return res.status(404).json({ error: '사양을 찾을 수 없습니다', code: 'NOT_FOUND' });

  const user = await currentUser(req);
  const gb = (await groupBuysWithState()).find(
    (g) => g.productId === product.id && !g.closed,
  );

  res.json({
    quote: quote({
      localAmount: edition.pricing?.localAmount ?? edition.amount ?? edition.jpy ?? 0,
      origin: product.origin || 'jp',
      feeKind: edition.feeKind || 'album',
      rate: edition.pricing?.rate ?? product.rate,
      qty: Number(req.query.qty) || 1,
      planTier: user?.plan?.tier || 'free',
      groupDiscount: gb?.discount || 0,
    }),
    groupBuyId: gb?.id || null,
    rateDate: product.rateDate,
  });
});

/** 릴리스 기준 주문. 크레딧 확인·차감·적재를 사용자 락 안에서 한 덩어리로 처리한다. */
async function orderFromRelease(req, res) {
  const { releaseId, offerId, editionId, qty } = req.body || {};
  const releases = await readJson(RELEASE_COLLECTION, []);
  const release = releases.find((r) => r.id === releaseId);
  if (!release) return res.status(404).json({ error: '릴리스를 찾을 수 없습니다', code: 'NOT_FOUND' });

  const ed = (release.editions || []).find((e) => e.id === editionId);
  if (!ed) return res.status(404).json({ error: '사양을 찾을 수 없습니다', code: 'NOT_FOUND' });
  const offer = (release.offers || []).find((o) => o.id === offerId);
  if (!offer) return res.status(404).json({ error: '판매처를 찾을 수 없습니다', code: 'NOT_FOUND' });
  if (!(offer.editions || []).includes(ed.id)) {
    return res.status(409).json({ error: '이 판매처는 해당 사양을 취급하지 않습니다', code: 'OFFER_EDITION_MISMATCH' });
  }

  const fx = await fxRates();
  const gb = await findGroupBuy({ releaseId: release.id, editionId: ed.id });
  const rate = release.country === 'jp' ? fx.jpyKrw : 1;

  try {
    const result = await withLock(`user:${req.user.id}`, async () => {
      const users = await readJson('users', []);
      const u = users.find((x) => x.id === req.user.id);
      if (!u) throw Object.assign(new Error('계정을 찾을 수 없습니다'), { status: 404, code: 'NOT_FOUND' });

      const q = quote({
        localAmount: ed.listPrice,
        origin: release.country === 'jp' ? 'jp' : 'kr',
        feeKind: ed.feeKind || 'album',
        rate, qty,
        planTier: u.plan?.tier || 'free',
        groupDiscount: gb?.discount || 0,
      });
      const chargeKrw = q.currency === 'JPY' ? Math.round(q.total * fx.jpyKrw) : q.total;

      if (u.credits < chargeKrw) {
        throw Object.assign(
          new Error(`크레딧이 부족합니다 (보유 ${u.credits.toLocaleString()} / 필요 ${chargeKrw.toLocaleString()})`),
          { status: 402, code: 'INSUFFICIENT_CREDITS' },
        );
      }
      u.credits -= chargeKrw;
      await writeJson('users', users);

      const key = userPath(req.user.id, 'orders');
      const orders = await readJson(key, []);
      const order = {
        id: 'LO-' + Date.now().toString(36).toUpperCase() + '-' + randomUUID().slice(0, 4),
        kind: 'release',
        releaseId: release.id, editionId: ed.id, offerId: offer.id,
        name: `${release.titleKo || release.title} — ${ed.label}`,
        brand: release.artistKo || release.artist,
        store: offer.storeKo || offer.store,
        /* 특전은 주문 시점에 박아둔다. 나중에 판매처가 특전을 바꿔도
           "내가 무엇을 보고 샀는지"가 남아야 분쟁을 다룰 수 있다. */
        bonus: offer.bonus || null,
        campaignEligible: release.campaign
          ? Boolean(offer.greenCode) && (release.campaign.eligibleEditions || []).includes(ed.id)
          : null,
        option: ed.label, qty: q.qty,
        unit: Math.round(q.total / q.qty), total: q.total,
        buyerCurrency: q.currency, chargedKrw: chargeKrw,
        artwork: release.artwork || null,
        breakdown: { ...q, rateDate: fx.date },
        groupBuyId: gb?.id || null,
        sourceUrl: offer.url,
        status: '예약 접수', orderedAt: new Date().toISOString(),
      };
      orders.unshift(order);
      await writeJson(key, orders);
      return { order, credits: u.credits };
    });
    res.json(result);
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.status && e.status < 500 ? e.message : '주문 처리 실패', code: e?.status && e.status < 500 ? e.code : 'INTERNAL' });
  }
}

/* ================= 주문 (데모: 크레딧 차감) ================= */
app.get('/api/orders', requireUser(async (req, res) =>
  res.json(await readJson(userPath(req.user.id, 'orders'), []))));

app.post('/api/orders', requireUser(async (req, res) => {
  // 릴리스(실데이터) 주문 — 판매처 비교표에서 오는 경로
  if (req.body?.releaseId) return orderFromRelease(req, res);

  const { productId, option, qty } = req.body || {};
  const products = await readJson('products', []);
  const product = products.find((p) => p.id === productId);
  if (!product) return res.status(404).json({ error: '상품을 찾을 수 없습니다', code: 'NOT_FOUND' });

  const edition = (product.editions || []).find((e) => e.label === option || e.id === option)
    || product.editions?.[0];
  if (!edition) return res.status(404).json({ error: '사양을 찾을 수 없습니다', code: 'NOT_FOUND' });

  const gb = (await groupBuysWithState()).find((g) => g.productId === product.id && !g.closed);
  const fx = await readJson('fx', null);

  /* 크레딧 확인 → 차감 → 주문 적재를 한 덩어리로 묶는다.
     예전에는 이 셋이 각각 별도의 read/write 라, 동시에 들어온 주문들이
     같은 잔액을 읽고 서로의 결과를 덮어썼다(실측: 5건 중 2건만 저장, 1건분만 차감). */
  try {
    const result = await withLock(`user:${req.user.id}`, async () => {
      const users = await readJson('users', []);
      const u = users.find((x) => x.id === req.user.id);
      if (!u) throw Object.assign(new Error('계정을 찾을 수 없습니다'), { status: 404, code: 'NOT_FOUND' });

      const q = quote({
        localAmount: edition.pricing?.localAmount ?? edition.amount ?? edition.jpy ?? 0,
        origin: product.origin || 'jp',
        feeKind: edition.feeKind || 'album',
        rate: edition.pricing?.rate ?? product.rate,
        qty,
        planTier: u.plan?.tier || 'free',
        groupDiscount: gb?.discount || 0,
      });

      const chargeKrw = q.currency === 'JPY'
        ? Math.round(q.total * (fx?.jpyKrw ?? 8.7))
        : q.total;

      if (u.credits < chargeKrw) {
        throw Object.assign(
          new Error(`크레딧이 부족합니다 (보유 ${u.credits.toLocaleString()} / 필요 ${chargeKrw.toLocaleString()})`),
          { status: 402, code: 'INSUFFICIENT_CREDITS' },
        );
      }
      u.credits -= chargeKrw;
      await writeJson('users', users);

      const key = userPath(req.user.id, 'orders');
      const orders = await readJson(key, []);
      const order = {
        id: 'LO-' + Date.now().toString(36).toUpperCase() + '-' + randomUUID().slice(0, 4),
        productId, name: product.name, brand: product.brand,
        option: edition.label || option || '통상반',
        qty: q.qty, unit: Math.round(q.total / q.qty), total: q.total,
        buyerCurrency: q.currency, chargedKrw: chargeKrw,
        artwork: product.artwork,
        breakdown: { ...q, rateDate: product.rateDate },
        groupBuyId: gb?.id || null,
        status: '예약 접수', orderedAt: new Date().toISOString(),
      };
      orders.unshift(order);
      await writeJson(key, orders);
      return { order, credits: u.credits };
    });
    res.json(result);
  } catch (e) {
    const status = e?.status || 500;
    res.status(status).json({ error: e?.status && e.status < 500 ? e.message : '주문 처리 실패', code: e?.status && e.status < 500 ? e.code : 'INTERNAL' });
  }
}));




/* ---------- 1회성 마이그레이션 ----------
   예전엔 db/user/likes.json 처럼 전역 파일 하나를 모든 계정이 공유했다.
   그 데이터를 버리지 않고 첫 사용자(데모 계정) 폴더로 옮긴다.
   이미 옮겼으면 아무것도 하지 않는다(멱등). */
async function migrateLegacyUserData() {
  const LEGACY = ['likes', 'playlists', 'history', 'orders', 'oshi'];
  const users = await readJson('users', []);
  const seed = users[0];
  if (!seed) return;

  let moved = 0;
  for (const name of LEGACY) {
    const legacyPath = path.join(DB_DIR, 'user', `${name}.json`);
    const targetPath = path.join(DB_DIR, 'user', seed.id, `${name}.json`);
    try {
      await readFile(legacyPath, 'utf-8');
    } catch { continue; }               // 레거시 파일 없음
    try {
      await readFile(targetPath, 'utf-8');
      continue;                          // 이미 옮겨져 있음
    } catch { /* 옮길 차례 */ }
    const data = await readJson(`user/${name}`, null);
    if (data == null) continue;
    await writeJson(userPath(seed.id, name), data);
    // 원본은 .bak 으로 남긴다 — 되돌릴 여지를 지우지 않는다
    await rename(legacyPath, legacyPath + '.bak').catch(() => {});
    moved++;
  }
  // 전역 세션 파일도 더 이상 쓰지 않는다
  const legacySession = path.join(DB_DIR, 'user', 'session.json');
  await rename(legacySession, legacySession + '.bak').catch(() => {});

  if (moved) console.log(`[lilac] 사용자 데이터 ${moved}건을 ${seed.email} 계정으로 이관했습니다`);
}

/* 공동구매 시드 — 릴리스(실데이터) 기준.
   예전에는 products.json(가격의 75%가 지어낸 값)을 참조했다.
   공동구매는 실제 결제로 이어지므로 확인된 정가 위에서만 돌아야 한다. */
async function seedGroupBuys() {
  const existing = await readJson('groupbuys', null);
  // 레거시 시드(productId 기반)면 갈아엎는다
  const isLegacy = Array.isArray(existing) && existing.length && existing.every((g) => !g.releaseId);
  if (Array.isArray(existing) && existing.length && !isLegacy) return;

  const releases = await readJson(RELEASE_COLLECTION, []);
  if (!releases.length) return;
  const now = Date.now();

  const seeds = [];
  for (const [i, r] of releases.entries()) {
    // 가장 비싼 사양은 공동구매 효과가 크다 — 배송비 분담 여지가 큰 쪽을 고른다
    const ed = [...(r.editions || [])].sort((a, b) => b.listPrice - a.listPrice)[0];
    if (!ed) continue;
    seeds.push({
      id: `gb_${r.id}`,
      releaseId: r.id,
      editionId: ed.id,
      title: `${r.artistKo || r.artist} — ${ed.label} 공동구매`,
      target: [20, 30, 25][i] ?? 25,
      opensAt: new Date(now - 60 * 60_000).toISOString(),
      closesAt: new Date(now + (i + 3) * 24 * 60 * 60_000).toISOString(),
      participants: [],
      note: '목표 수량에 도달하면 단가가 내려갑니다. 전매·양도 중개는 취급하지 않습니다.',
    });
  }
  if (!seeds.length) return;
  await writeJson('groupbuys', seeds);
  console.log(`[lilac] 공동구매 시드 ${seeds.length}건 (릴리스 기준${isLegacy ? ', 레거시 교체' : ''})`);
}

/* ---------- 에러 규격 통일 ----------
   화면이 상황별로 다르게 반응하려면 오류에 기계가 읽을 코드가 있어야 한다.
   지금까지는 { error: '문자열' } 뿐이라 프론트가 메시지를 문자열 비교해야 했다. */
/* ================= 곡 카탈로그 · 공식 채널 · 팬덤 방식 ================= */

/* 아티스트 전체 곡 (저장된 애플 카탈로그). 실시간 호출이 아니라 레이트리밋과 무관하다. */
/* 카탈로그는 9MB 라 요청마다 파싱하면 무겁다. mtime 이 바뀔 때만 다시 읽는다. */
let catalogMem = { mtime: 0, data: { artists: {} } };
async function readCatalog() {
  try {
    const st = await stat(path.join(DB_DIR, 'catalog.json'));
    if (st.mtimeMs !== catalogMem.mtime) catalogMem = { mtime: st.mtimeMs, data: await readJson('catalog', { artists: {} }) };
  } catch { /* 없으면 빈 것 */ }
  return catalogMem.data;
}

app.get('/api/artist/:id/tracks', async (req, res) => {
  const cat = await readCatalog();
  const entry = cat.artists?.[req.params.id];
  if (!entry) return res.status(404).json({ error: '카탈로그가 아직 없습니다', code: 'NOT_FOUND' });
  const limit = Math.min(Number(req.query.limit) || 500, 500);
  const q = String(req.query.q || '').toLowerCase();
  let tracks = entry.tracks || [];
  if (q) tracks = tracks.filter((t) => `${t.title} ${t.album}`.toLowerCase().includes(q));
  /* '인기' 목록.
     카탈로그를 최신순으로 자르면 같은 곡이 JP/KR 스토어에서 trackId 만 다르게
     두 번 나오고(실제로 ILLIT 페이지에 "I Got Your Back" 이 4줄), 인기가 아니라
     최신이 된다. 차트에 오른 곡을 먼저, 그 다음 최신 순으로 채우되
     제목을 정규화해 중복을 걷어낸다. */
  const charts = await readJson('charts', null);
  const chartRank = new Map();   // norm(title) → 최고 순위(작을수록 좋음)
  for (const bucket of Object.values(charts?.countries || {})) {
    for (const list of Object.values(bucket)) {
      if (!Array.isArray(list)) continue;
      for (const t of list) {
        if (!t?.title) continue;
        const k = norm(t.title);
        const r = Number(t.rank) || 999;
        if (!chartRank.has(k) || chartRank.get(k) > r) chartRank.set(k, r);
      }
    }
  }
  const baseTitle = (t) => norm(String(t).replace(/\s*[\(\[（【].*$/, ''));   // 괄호 이후(버전 표기)는 뺀다
  const seenBase = new Set();
  /* 파생 버전(Sped Up·TV size·Orchestra ver.·inst.)은 원곡이 있으면 밀린다.
     같은 base 제목 안에서는 괄호가 없는 쪽(=원곡)이 먼저 온다. */
  const VARIANT = /sped up|tv size|orchestra|acoustic|piano ver|remix|inst\.|instrumental|off vocal|karaoke|ver\.\)|version\)/i;
  const rankOf = (t) => chartRank.get(norm(t.title)) ?? chartRank.get(baseTitle(t.title)) ?? 9999;
  const popular = [...(entry.tracks || [])]
    .filter((t) => t.preview)
    .sort((a, b) => {
      const ra = rankOf(a), rb = rankOf(b);
      if (ra !== rb) return ra - rb;
      const va = VARIANT.test(a.title) ? 1 : 0, vb = VARIANT.test(b.title) ? 1 : 0;
      if (va !== vb) return va - vb;                       // 원곡 먼저
      const pa = /[\(\[（【]/.test(a.title) ? 1 : 0, pb = /[\(\[（【]/.test(b.title) ? 1 : 0;
      if (pa !== pb) return pa - pb;                       // 괄호 없는 쪽 먼저
      return (b.releaseDate || '').localeCompare(a.releaseDate || '');
    })
    /* 같은 곡이 스토어마다 번역 제목으로 들어온다(あにゅー의 "ピアフ" ↔ Anew의 "Piaf"). 제목은 달라도 발매일과 길이(ms)가 같으면 같은 음원 */
    .filter((t) => {
      const k = baseTitle(t.title);
      const same = t.durationMs && t.releaseDate ? `${t.releaseDate}|${t.durationMs}` : null;
      if (seenBase.has(k) || (same && seenBase.has(same))) return false;
      seenBase.add(k); if (same) seenBase.add(same);
      return true;
    })
    .slice(0, 10)
    .map((t) => ({ ...t, charted: chartRank.has(norm(t.title)) || chartRank.has(baseTitle(t.title)) }));

  res.json({
    artistId: req.params.id, count: entry.count, capped: !!entry.capped, partial: !!entry.partial,
    fetchedAt: entry.fetchedAt, source: 'Apple Music 카탈로그 (일본·한국 스토어 합집합)',
    popular,
    albums: [...new Map(tracks.map((t) => [t.albumId, { id: t.albumId, title: t.album, artwork: t.artwork, releaseDate: t.releaseDate }])).values()],
    tracks: tracks.slice(0, limit),
  });
});

app.get('/api/catalog/status', async (_req, res) => {
  const cat = await readCatalog();
  const arts = Object.values(cat.artists || {});
  res.json({
    builtAt: cat.builtAt || null, artists: arts.length,
    tracks: arts.reduce((s, a) => s + (a.count || 0), 0),
    capped: arts.filter((a) => a.capped).length, partial: arts.filter((a) => a.partial).length,
  });
});

/* 아티스트 공식 채널 + 이 팀에 해당하는 팬덤 방식 */
app.get('/api/artist/:id/fandom', async (req, res) => {
  const [artists, releases] = await Promise.all([readJson('artists', []), readJson(RELEASE_COLLECTION, [])]);
  const a = artists.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'artist not found', code: 'NOT_FOUND' });
  res.json({
    links: a.links || {}, linksSource: a.linksSource || null, mbid: a.mbid || a.operatorMbid || null,
    ...mechanicsFor(a, releases),
  });
});

app.get('/api/fandom/mechanics', (_req, res) => res.json({ mechanics: MECHANICS }));

/* 개발용 종료 경로.
   로컬에서만 받는다. 여러 인스턴스가 남았을 때 스스로 물러나게 하는 수단이다.
   (환경에 따라 kill 이 막혀 있어 외부에서 정리할 방법이 없을 수 있다) */
app.post('/api/admin/shutdown', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || '';
  if (!/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(ip)) {
    return res.status(403).json({ error: 'local only', code: 'FORBIDDEN' });
  }
  res.once('finish', () => { void shutdown('admin'); });
  res.json({ ok: true, port: PORT, pid: process.pid });
});

/* 실시간 팬덤 정보 — 공연·티켓·뉴스·굿즈·아티스트 (backend/lib/live) */
const live = createLiveService({ dbDir: DB_DIR, readJson, writeJson, rosterLock: () => acquireSyncLock(DB_DIR, 'artist-roster', { ttlMs: 30 * 60 * 1000 }), getCharts: loadCharts });
live.register(app);
const community = createCommunity({
  dbDir: DB_DIR, readJson, writeJson, withLock, currentUser,
  onActivity: (info) => live.notify('community', info),
  artistBrief: (id) => live.artistBrief(id),
  artistsFor: async (edition) => (await live.artists({ edition })).items,
});
community.register(app);
const LIVE_WARM_MS = 45 * 60 * 1000;

app.use('/api', (req, res) => {
  res.status(404).json({ error: `알 수 없는 엔드포인트: ${req.method} ${req.path}`, code: 'NOT_FOUND' });
});

app.use((err, _req, res, _next) => {
  // JSON 파싱 실패(잘못된 본문)를 500 으로 흘려보내면 원인을 못 찾는다
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: '요청 본문이 너무 큽니다', code: 'PAYLOAD_TOO_LARGE' });
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '잘못된 JSON 본문입니다', code: 'INVALID_JSON' });
  }
  console.error('[lilac] 처리되지 않은 오류:', err?.message || err);
  res.status(500).json({ error: '서버 오류', code: 'INTERNAL' });
});

const server = app.listen(PORT, () => { void runBackground(async () => {
  console.log(`[lilac] backend v0.3 on http://localhost:${PORT}`);
  // Isolated regression tests must never launch collectors or migrate production data.
  if (process.env.LILAC_DISABLE_BACKGROUND === '1') return;

  /* 이미 떠 있는 인스턴스가 있으면 알린다.
     여럿이 같은 db 를 보며 같은 API 를 두드리면 레이트리밋과 데이터 손실로 이어진다. */
  try {
    const others = await registerInstance(DB_DIR, { port: PORT });
    if (others.length) {
      console.warn(
        `[lilac] ⚠ 다른 인스턴스 ${others.length}개가 이미 떠 있습니다 (${others.map((o) => ':' + o.port).join(', ')}).\n` +
        `        같은 db 를 공유하므로 외부 API 를 중복 호출합니다. 'npm run stop' 으로 정리하세요.`,
      );
    }
    if (!shuttingDown) backgroundTimers.add(instanceHeartbeat(DB_DIR, PORT));
  } catch (e) {
    console.warn('[lilac] 인스턴스 등록 실패:', e.message);
  }

  // Legacy files have no trustworthy owner identifier; never assign them to users[0] in production.
  if (!IS_PRODUCTION) await migrateLegacyUserData();

  if (shuttingDown) return;
  /* 실시간 공연·티켓·뉴스 — 기동 직후 데우고 45분마다 다시 데운다(캐시 TTL보다 짧게) */
  scheduleBackground(() => live.warm(), 1500);
  scheduleBackground(() => live.warm(), LIVE_WARM_MS, true);
  /* 원천별 주기 동기화 + SSE 알림 (티켓 오픈·뉴스 5분, 공연 10~20분, 팬클럽 접수 30분, 페스티벌 1시간) */
  live.startRealtime();

  /* 무료 호스팅(Render free)은 15분 동안 외부 요청이 없으면 잠들고, 잠들면 위 주기 수집이 모두 멈춘다.
     자기 공개 주소로 10분마다 요청해 깨어 있게 한다(Render 프록시를 거치므로 외부 요청으로 센다).
     GitHub Actions keepalive는 저장소가 60일 조용하면 꺼지므로 보조로만 둔다. */
  const selfUrl = process.env.LILAC_SELF_PING_URL || process.env.RENDER_EXTERNAL_URL;
  let selfPingLogged = false;
  if (IS_PRODUCTION && selfUrl && process.env.LILAC_SELF_PING !== '0') {
    scheduleBackground(async () => {
      try {
        const r = await fetch(`${selfUrl.replace(/\/$/, '')}/api/health`, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'lilac-self-ping' } });
        if (!selfPingLogged) { selfPingLogged = true; console.log(`[lilac] self-ping 동작 중 (HTTP ${r.status}, 10분 간격)`); }
      }
      catch (e) { console.warn('[lilac] self-ping 실패:', e?.message || e); }
    }, 10 * 60_000, true);
  }

  /* 릴리스 동기화 — 기동 직후 한 번, 이후 6시간마다.
     외부 API 를 44번 호출하므로 부팅을 막지 않도록 백그라운드로 돌린다. */
  runBackground(async () => { await runReleaseSync('boot'); if (DEMO_BILLING && !shuttingDown) await seedGroupBuys(); });
  scheduleBackground(() => runReleaseSync('interval'), SYNC_INTERVAL_MS, true);

  /* 환율 — 묵었으면 기동 직후 한 번, 이후 6시간마다 */
  runBackground(() => refreshFx('boot'));
  scheduleBackground(() => refreshFx('interval'), FX_INTERVAL_MS, true);

  /* 수집형 차트 — 묵었으면 기동 직후 한 번, 이후 3시간마다.
     끝나면 그 차트로 로스터를 갱신한다(차트가 후보를 만든다). */
  runBackground(async () => { await runChartCollect('boot'); if (!shuttingDown) await runRosterCollect('boot'); });
  scheduleBackground(() => runChartCollect('interval'), CHART_INTERVAL_MS, true);
  scheduleBackground(() => runRosterCollect('interval'), ROSTER_INTERVAL_MS, true);

  /* 곡 카탈로그 — 릴리스 동기화 뒤에 (아티스트 보강이 끝난 로스터 기준), 이후 24시간마다 */
  scheduleBackground(() => runCatalogSync('boot'), 90_000);
  scheduleBackground(() => runCatalogSync('interval'), CATALOG_INTERVAL_MS, true);
  // 기동 시엔 만들어 둔 색인을 읽기만 한다 (재구축은 외부 API 호출이라 1~2분 걸린다)
  const n = await loadIndex();
  if (n) console.log(`[lilac] 검색 색인 ${n}건 로드`);
  else { console.log('[lilac] 색인이 없어 새로 만듭니다...'); await refreshIndex(); }
  scheduleIndexRefresh();
}); });

// Stop accepting traffic, disconnect persistent SSE, then drain HTTP handlers and owned jobs.
// Idempotency matters when a supervisor sends a signal after the local admin request.
let shutdownPromise = null;
function shutdown(reason) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  console.log('[lilac] graceful shutdown:', reason);
  const deadline = setTimeout(async () => {
    console.error('[lilac] shutdown drain deadline exceeded');
    server.closeAllConnections?.();
    await Promise.race([saved, new Promise((r) => setTimeout(r, 5000))]);
    process.exit(1);
  }, 10_000);
  /* 사용자 데이터 저장을 가장 먼저 시작한다 — 수집기 정리가 늦어져 강제 종료되더라도 저장은 끝나 있게 */
  const saved = persistence.stop();
  shutdownPromise = (async () => {
    for (const timer of backgroundTimers) clearTimeout(timer);
    backgroundTimers.clear();
    await live.dispose();
    console.log('[lilac] live service disposed');
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections?.();
    });
    await Promise.allSettled([...backgroundJobs, ...locks.values()]);
    await saved;
    await unregisterInstance(DB_DIR, PORT);
    clearTimeout(deadline);
    console.log('[lilac] shutdown complete');
    process.exit(0);
  })().catch((error) => {
    console.error('[lilac] shutdown failed:', error?.message || error);
    clearTimeout(deadline);
    process.exit(1);
  });
  return shutdownPromise;
}
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
