/* 사용자 데이터 영속화 — 디스크가 초기화되는 무료 호스팅(Render free)용
 *
 * 왜: 앱은 JSON 파일(DB_DIR)을 읽고 쓴다. 무료 호스팅은 재시작·재배포 때 디스크가 비워져
 *     회원·세션·커뮤니티 글·좋아요가 사라진다. 공개 카탈로그·수집 데이터는 다시 만들 수 있지만
 *     사용자가 만든 데이터는 다시 만들 수 없다.
 * 방법: DATABASE_URL(Postgres)이 있으면
 *   1) 부팅 때 테이블의 파일들을 DB_DIR로 내려받는다(hydrate) — 서버가 파일을 읽기 전에
 *   2) 사용자 데이터 경로만 주기적으로 훑어 바뀐 파일(mtime·크기·해시)을 올린다(flush)
 *   3) 종료 신호 때 한 번 더 올린다
 * 파일 쓰기 경로를 하나하나 고치지 않고 디렉터리 단위로 동기화한다. 크래시 때 잃을 수 있는 건 마지막 주기(기본 10초)뿐이다.
 * DATABASE_URL이 없으면 아무것도 하지 않는다(로컬 개발).
 *
 * 수집 캐시(live-cache: 공연·페스티벌 목록, 포스터·사진·국적 판정 KV)도 따로 올린다.
 *   다시 만들 수는 있지만 사진·국적·공식 사이트 판정은 외부 검색 수백 번으로 조금씩 쌓인 결과라
 *   재시작마다 배포 시드로 되돌아가면 운영에서 쌓은 만큼이 사라진다.
 *   - 무료 Postgres(Neon)는 쿼리가 있을 때만 깨어 있는 시간을 쓰므로, 1시간마다(그리고 종료 때) 바뀐 파일만 묶어 올린다.
 *   - 복원은 덮어쓰기가 아니라 병합: 목록 캐시는 수집 시각(at)이 더 새로운 쪽, KV는 키마다 at이 더 새로운 쪽.
 *     그래서 새 배포 시드가 더 새로우면 시드가, 운영에서 더 최근에 모은 값이면 저장본이 이긴다. */
import { readFile, writeFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

/* 사용자가 만든 데이터만. 카탈로그·차트·실시간 수집 캐시는 다시 만들 수 있어 올리지 않는다 */
export const USER_PATHS = ['users.json', 'sessions.json', 'contacts.json', 'groupbuys.json', 'user', 'community', 'social', 'live-cache/kv-fc-referrals.json'];
const MAX_FILE = 20 * 1024 * 1024;
/* 수집 캐시: live-cache/*.json 중 사용자 데이터(팬클럽 추천 클릭)는 제외 */
export const COLLECTED_DIR = 'live-cache';
export const isCollected = (rel) => typeof rel === 'string' && rel.startsWith(`${COLLECTED_DIR}/`) && rel.endsWith('.json') && !USER_PATHS.includes(rel) && !rel.slice(COLLECTED_DIR.length + 1).includes('/');
const MAX_COLLECTED_FILE = 5 * 1024 * 1024;

/** 복원 병합: 디스크(배포 시드)와 저장본 중 무엇을 쓸지. 쓸 내용(문자열) 또는 null(디스크 유지) */
export function mergeCollected(rel, diskText, dbText) {
  if (diskText == null) return dbText;
  let a, b;
  try { b = JSON.parse(dbText); } catch { return null; }
  try { a = JSON.parse(diskText); } catch { return dbText; }
  const ts = (e) => Math.max(Number(e?.at) || 0, Number(e?.checkedAt) || 0);
  const plain = (o) => o && typeof o === 'object' && !Array.isArray(o);
  if (plain(a) && plain(b) && 'value' in a && 'value' in b) return ts(b) > ts(a) ? dbText : null;
  if (/\/kv-[^/]+\.json$/.test(rel) && plain(a) && plain(b)) {
    const out = { ...a };
    let changed = false;
    for (const [k, v] of Object.entries(b)) {
      const cur = out[k];
      if (cur === undefined || (Number(v?.at) || 0) > (Number(cur?.at) || 0)) { out[k] = v; changed = true; }
    }
    return changed ? JSON.stringify(out) : null;
  }
  return null; // 모르는 모양은 배포본 유지
}

export async function listCollectedFiles(root) {
  const out = [];
  await walk(root, COLLECTED_DIR, out);
  return out.filter((f) => isCollected(f.rel) && f.size <= MAX_COLLECTED_FILE);
}

async function walk(root, rel, out) {
  const abs = path.join(root, rel);
  let st;
  try { st = await stat(abs); } catch { return; }
  if (st.isDirectory()) {
    for (const name of await readdir(abs)) {
      if (name.startsWith('.') || name.endsWith('.tmp') || name.endsWith('.lock') || name.endsWith('.bak')) continue;
      await walk(root, path.join(rel, name), out);
    }
  } else if (st.isFile() && st.size <= MAX_FILE) out.push({ rel: rel.split(path.sep).join('/'), mtimeMs: st.mtimeMs, size: st.size });
}

export async function listUserFiles(root) {
  const out = [];
  for (const p of USER_PATHS) await walk(root, p, out);
  return out;
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
/* 저장소 밖으로 나가는 경로(../)나 절대 경로는 받지 않는다 */
const safeRel = (rel) => typeof rel === 'string' && rel.length < 400 && !rel.startsWith('/') && !rel.split('/').some((s) => s === '..' || s === '') && (USER_PATHS.some((p) => rel === p || rel.startsWith(`${p}/`)) || isCollected(rel));

export function createPersistence({ url = process.env.DATABASE_URL, dbDir, intervalMs = 10_000, collectedIntervalMs = Number(process.env.LILAC_CACHE_FLUSH_MS) || 60 * 60_000, beforeCollected = null, log = console, connect } = {}) {
  if (!url && !connect) return { enabled: false, hydrate: async () => ({ files: 0 }), start() {}, flush: async () => ({ uploaded: 0 }), flushCollected: async () => ({ uploaded: 0 }), stop: async () => {} };
  const seenCollected = new Map(); // rel → { mtimeMs, size, hash }
  let collectedTimer = null;
  let runningCollected = null;
  let pool = null;
  const seen = new Map(); // rel → { mtimeMs, size, hash }
  let timer = null;
  let running = null;

  async function db() {
    if (pool) return pool;
    if (connect) pool = await connect();
    else {
      const { default: pg } = await import('pg');
      pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000, ssl: /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false } });
      pool.on('error', (e) => log.warn('[persist] pool error:', e.message));
    }
    await pool.query(`CREATE TABLE IF NOT EXISTS lilac_files (
      path text PRIMARY KEY,
      body bytea NOT NULL,
      hash text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted boolean NOT NULL DEFAULT false
    )`);
    return pool;
  }

  /* 부팅: 저장된 사용자 파일을 디스크로. 서버가 파일을 읽기 전에 끝나야 한다 */
  async function hydrate() {
    const p = await db();
    const { rows } = await p.query('SELECT path, body, hash, deleted FROM lilac_files');
    let files = 0;
    let merged = 0;
    for (const r of rows) {
      if (!safeRel(r.path)) continue;
      const abs = path.join(dbDir, r.path);
      if (isCollected(r.path)) {
        if (r.deleted) continue;
        try {
          const dbText = Buffer.from(r.body).toString('utf8');
          const diskText = await readFile(abs, 'utf8').catch(() => null);
          const use = mergeCollected(r.path, diskText, dbText);
          if (use != null) { await mkdir(path.dirname(abs), { recursive: true }); await writeFile(abs, use); merged++; }
          /* 저장본과 같은 내용이 디스크에 있으면 기준선으로(다시 올리지 않게) */
          const st = await stat(abs).catch(() => null);
          if (st && (use === dbText || diskText === dbText)) seenCollected.set(r.path, { mtimeMs: st.mtimeMs, size: st.size, hash: r.hash });
        } catch (e) { log.warn('[persist] 수집 캐시 복원 실패', r.path, e.message); }
        continue;
      }
      if (r.deleted) { await unlink(abs).catch(() => {}); continue; }
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, r.body);
      /* 내려받은 파일만 기준선으로 — 곧바로 다시 올리지 않는다.
         저장소에 없던 디스크 파일은 기준선에 넣지 않아 첫 flush에서 올라간다 */
      const st = await stat(abs);
      seen.set(r.path, { mtimeMs: st.mtimeMs, size: st.size, hash: r.hash });
      files++;
    }
    log.log(`[persist] 사용자 데이터 ${files}개 파일 복원 · 수집 캐시 ${merged}개 병합`);
    return { files, merged };
  }

  /* 바뀐 파일만 올리고, 사라진 파일은 삭제 표시 */
  async function flush() {
    if (running) return running;
    running = (async () => {
      const p = await db();
      const now = await listUserFiles(dbDir);
      const present = new Set(now.map((f) => f.rel));
      let uploaded = 0, deleted = 0;
      for (const f of now) {
        const prev = seen.get(f.rel);
        if (prev && prev.mtimeMs === f.mtimeMs && prev.size === f.size) continue;
        const buf = await readFile(path.join(dbDir, f.rel)).catch(() => null);
        if (!buf) continue;
        const hash = sha(buf);
        if (prev && prev.hash === hash) { seen.set(f.rel, { ...f, hash }); continue; }
        await p.query(`INSERT INTO lilac_files (path, body, hash, updated_at, deleted) VALUES ($1, $2, $3, now(), false)
          ON CONFLICT (path) DO UPDATE SET body = EXCLUDED.body, hash = EXCLUDED.hash, updated_at = now(), deleted = false`, [f.rel, buf, hash]);
        seen.set(f.rel, { mtimeMs: f.mtimeMs, size: f.size, hash });
        uploaded++;
      }
      for (const rel of [...seen.keys()]) {
        if (present.has(rel)) continue;
        await p.query('UPDATE lilac_files SET deleted = true, updated_at = now() WHERE path = $1', [rel]);
        seen.delete(rel);
        deleted++;
      }
      return { uploaded, deleted };
    })().finally(() => { running = null; });
    return running;
  }

  /* 수집 캐시: 바뀐 파일만 묶어서(50개씩 한 쿼리) 올린다. 오래된 상세 페이지 캐시는 지운다 */
  async function flushCollected() {
    if (runningCollected) return runningCollected;
    runningCollected = (async () => {
      if (beforeCollected) await beforeCollected().catch(() => {});
      const now = await listCollectedFiles(dbDir);
      const batch = [];
      for (const f of now) {
        const prev = seenCollected.get(f.rel);
        if (prev && prev.mtimeMs === f.mtimeMs && prev.size === f.size) continue;
        const buf = await readFile(path.join(dbDir, f.rel)).catch(() => null);
        if (!buf) continue;
        try { JSON.parse(buf.toString('utf8')); } catch { continue; } // 쓰는 중인 파일은 다음에
        const hash = sha(buf);
        if (prev && prev.hash === hash) { seenCollected.set(f.rel, { mtimeMs: f.mtimeMs, size: f.size, hash }); continue; }
        batch.push({ f, buf, hash });
      }
      if (!batch.length) return { uploaded: 0 };
      const p = await db();
      /* KV는 올리기 전에 저장본과 키 단위로 합친다. Render 무중단 배포는 새 인스턴스를 먼저 띄우고 옛 인스턴스를 나중에 끄므로,
         옛 인스턴스가 종료 직전에 올린 키를 새 인스턴스의 파일 통째 업로드가 지우지 않게 */
      const kvs = batch.filter((x) => /\/kv-[^/]+\.json$/.test(x.f.rel));
      if (kvs.length) {
        const { rows } = await p.query('SELECT path, body FROM lilac_files WHERE path = ANY($1::text[]) AND deleted = false', [kvs.map((x) => x.f.rel)]);
        const byPath = new Map(rows.filter((r) => kvs.some((x) => x.f.rel === r.path)).map((r) => [r.path, Buffer.from(r.body).toString('utf8')]));
        for (const x of kvs) {
          const stored = byPath.get(x.f.rel);
          const merged = stored ? mergeCollected(x.f.rel, x.buf.toString('utf8'), stored) : null;
          if (merged != null && merged !== stored) x.upload = Buffer.from(merged);
        }
      }
      for (let i = 0; i < batch.length; i += 50) {
        const part = batch.slice(i, i + 50);
        await p.query(`INSERT INTO lilac_files (path, body, hash, updated_at, deleted)
          SELECT u.path, u.body, u.hash, now(), false FROM unnest($1::text[], $2::bytea[], $3::text[]) AS u(path, body, hash)
          ON CONFLICT (path) DO UPDATE SET body = EXCLUDED.body, hash = EXCLUDED.hash, updated_at = now(), deleted = false`,
        [part.map((x) => x.f.rel), part.map((x) => x.upload || x.buf), part.map((x) => (x.upload ? sha(x.upload) : x.hash))]);
        for (const x of part) seenCollected.set(x.f.rel, { mtimeMs: x.f.mtimeMs, size: x.f.size, hash: x.hash });
      }
      await p.query(`DELETE FROM lilac_files WHERE path LIKE 'live-cache/detail-%' AND updated_at < now() - interval '14 days'`).catch(() => {});
      return { uploaded: batch.length };
    })().finally(() => { runningCollected = null; });
    return runningCollected;
  }

  return {
    enabled: true,
    flushCollected,
    hydrate,
    flush,
    start() {
      if (timer) return;
      timer = setInterval(() => { flush().catch((e) => log.warn('[persist] flush 실패:', e.message)); }, intervalMs);
      timer.unref?.();
      const saveCollected = () => flushCollected().then((r) => log.log(`[persist] 수집 캐시 ${r.uploaded}개 저장`)).catch((e) => log.warn('[persist] 수집 캐시 저장 실패:', e.message));
      /* 첫 백업은 부팅 10분 뒤(부팅 수집이 끝날 즈음) — 첫 주기 전에 죽어도 기준본이 남게. 이후 1시간마다 */
      collectedTimer = setTimeout(() => {
        void saveCollected();
        collectedTimer = setInterval(saveCollected, collectedIntervalMs);
        collectedTimer.unref?.();
      }, Math.min(10 * 60_000, collectedIntervalMs));
      collectedTimer.unref?.();
    },
    async stop() {
      if (timer) clearInterval(timer);
      if (collectedTimer) { clearTimeout(collectedTimer); clearInterval(collectedTimer); }
      timer = null; collectedTimer = null;
      /* 사용자 데이터가 먼저 — 수집 캐시는 그다음(강제 종료되더라도 사용자 데이터는 저장돼 있게) */
      try { const r = await flush(); log.log(`[persist] 종료 전 저장 ${r.uploaded}개`); } catch (e) { log.warn('[persist] 종료 전 저장 실패:', e.message); }
      try { const r = await flushCollected(); log.log(`[persist] 종료 전 수집 캐시 ${r.uploaded}개`); } catch (e) { log.warn('[persist] 종료 전 수집 캐시 저장 실패:', e.message); }
      await pool?.end?.().catch(() => {});
    },
  };
}
