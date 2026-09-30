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
 * DATABASE_URL이 없으면 아무것도 하지 않는다(로컬 개발). */
import { readFile, writeFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

/* 사용자가 만든 데이터만. 카탈로그·차트·실시간 수집 캐시는 다시 만들 수 있어 올리지 않는다 */
export const USER_PATHS = ['users.json', 'sessions.json', 'contacts.json', 'groupbuys.json', 'user', 'community', 'social', 'live-cache/kv-fc-referrals.json'];
const MAX_FILE = 20 * 1024 * 1024;

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
const safeRel = (rel) => typeof rel === 'string' && rel.length < 400 && !rel.startsWith('/') && !rel.split('/').some((s) => s === '..' || s === '') && USER_PATHS.some((p) => rel === p || rel.startsWith(`${p}/`));

export function createPersistence({ url = process.env.DATABASE_URL, dbDir, intervalMs = 10_000, log = console, connect } = {}) {
  if (!url && !connect) return { enabled: false, hydrate: async () => ({ files: 0 }), start() {}, flush: async () => ({ uploaded: 0 }), stop: async () => {} };
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
    for (const r of rows) {
      if (!safeRel(r.path)) continue;
      const abs = path.join(dbDir, r.path);
      if (r.deleted) { await unlink(abs).catch(() => {}); continue; }
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, r.body);
      /* 내려받은 파일만 기준선으로 — 곧바로 다시 올리지 않는다.
         저장소에 없던 디스크 파일은 기준선에 넣지 않아 첫 flush에서 올라간다 */
      const st = await stat(abs);
      seen.set(r.path, { mtimeMs: st.mtimeMs, size: st.size, hash: r.hash });
      files++;
    }
    log.log(`[persist] 사용자 데이터 ${files}개 파일 복원`);
    return { files };
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

  return {
    enabled: true,
    hydrate,
    flush,
    start() {
      if (timer) return;
      timer = setInterval(() => { flush().catch((e) => log.warn('[persist] flush 실패:', e.message)); }, intervalMs);
      timer.unref?.();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      try { const r = await flush(); log.log(`[persist] 종료 전 저장 ${r.uploaded}개`); } catch (e) { log.warn('[persist] 종료 전 저장 실패:', e.message); }
      await pool?.end?.().catch(() => {});
    },
  };
}
