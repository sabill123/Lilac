/* 실시간 소스용 캐시 — 메모리 + 디스크(db/live-cache) 영속
 *
 * 규칙
 *  - 신선하면(ttl 이내) 바로 돌려준다.
 *  - 오래됐으면 오래된 값을 즉시 돌려주고 백그라운드에서 갱신한다(stale-while-revalidate).
 *  - 값이 아예 없으면 갱신을 기다리되 budgetMs를 넘기면 pending으로 응답하고 갱신은 계속한다.
 *  - "전부 실패"는 "결과 없음"이 아니다: 모든 소스가 실패해 0건이면 이전 값을 지키고 lastError만 기록한다.
 *  - 같은 키의 갱신은 동시에 하나만 돈다.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

/* 실시간 동기화: 갱신 결과가 이전과 달라졌을 때만 알린다(SSE로 화면에 밀어 준다) */
export const cacheEvents = new EventEmitter();
cacheEvents.setMaxListeners(50);
const VOLATILE = /^(checkedAt|fetchedAt|cache|ms|at|updated|updatedAt|ageSec)$/;
function sigOf(value) {
  try { return createHash('sha1').update(JSON.stringify(value, (k, v) => (VOLATILE.test(k) ? undefined : v))).digest('hex').slice(0, 16); } catch { return null; }
}
const idOf = (x) => (x && (x.id || x.url || x.link || x.key || x.title)) || null;
function added(prevVal, nextVal) {
  const a = new Set((prevVal?.items || []).map(idOf).filter(Boolean));
  return (nextVal?.items || []).filter((x) => { const k = idOf(x); return k && !a.has(k); }).length;
}

let DIR = null;
const mem = new Map();
const inflight = new Map();
const loaded = new Set();

export function initCache(dbDir) {
  DIR = path.join(dbDir, 'live-cache');
}

/* 키를 ASCII로 줄이면 한자·가나·한글 키가 모두 '_'로 뭉개져 서로 덮어쓴다(米津玄師 ↔ サカナクション).
   읽기 쉬운 접두어 + 원래 키의 해시로 파일명을 만든다. */
const fileOf = (key) => {
  const safe = key.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 80);
  const h = /^[a-zA-Z0-9_.-]+$/.test(key) && key.length <= 80 ? '' : `-${createHash('sha1').update(key).digest('hex').slice(0, 10)}`;
  return path.join(DIR, `${safe}${h}.json`);
};

async function load(key) {
  if (loaded.has(key) || !DIR) return mem.get(key) || null;
  loaded.add(key);
  try {
    const e = JSON.parse(await readFile(fileOf(key), 'utf8'));
    if (e && e.value) mem.set(key, e);
  } catch { /* 처음 */ }
  return mem.get(key) || null;
}

async function persist(key, entry) {
  if (!DIR) return;
  try {
    await mkdir(DIR, { recursive: true });
    const p = fileOf(key);
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(entry));
    await rename(tmp, p);
  } catch { /* 디스크 실패는 메모리 캐시로 계속 */ }
}

function allFailed(v) {
  const s = v?.sources || [];
  return s.length > 0 && s.every((x) => !x.ok);
}

/* 갱신 한 번의 상한. 원천 요청 하나가 끝나지 않으면(운영에서 굿즈 검색 하나가 수십 분 걸린 채 남았다) 그 키를 기다리는
   모든 요청과 주기 작업이 함께 멈춘다. 상한을 넘기면 실패로 처리하고 이전 값을 지킨 채 다음 요청에서 다시 받는다.
   가장 긴 정상 갱신(페스티벌 ~100초)보다 넉넉하게. */
export const REFRESH_DEADLINE_MS = Number(process.env.LILAC_REFRESH_DEADLINE_MS) || 240_000;
function withDeadline(p, ms, key) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`refresh timeout ${Math.round(ms / 1000)}s: ${key}`)), ms); t.unref?.(); })]).finally(() => clearTimeout(t));
}
async function refresh(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve().then(async () => {
    const prev = mem.get(key);
    const t0 = Date.now();
    try {
      const value = await withDeadline(Promise.resolve().then(fn), REFRESH_DEADLINE_MS, key);
      const empty = !value || (Array.isArray(value.items) && value.items.length === 0);
      if (empty && allFailed(value) && !prev?.value) {
        throw new Error((value.sources || []).map((s) => (s.provider || s.store) + ': ' + (s.error || 'unavailable')).join('; '));
      }
      if (prev && prev.value && empty && allFailed(value)) {
        const kept = { ...prev, checkedAt: Date.now(), lastError: (value.sources || []).map((s) => `${s.provider || s.store}: ${s.error}`).join('; ') };
        mem.set(key, kept);
        persist(key, kept);
        return kept;
      }
      const sig = sigOf(value);
      const entry = { value, at: Date.now(), checkedAt: Date.now(), ms: Date.now() - t0, lastError: null, sig };
      mem.set(key, entry);
      persist(key, entry);
      const prevSig = prev ? prev.sig || sigOf(prev.value) : null;
      if (sig && sig !== prevSig) cacheEvents.emit('change', { key, at: entry.at, count: Array.isArray(value?.items) ? value.items.length : null, added: prev ? added(prev.value, value) : null, first: !prev });
      return entry;
    } catch (e) {
      if (prev) {
        const kept = { ...prev, checkedAt: Date.now(), lastError: String(e?.message || e) };
        mem.set(key, kept);
        await persist(key, kept);
        return kept;
      }
      throw e;
    } finally {
      inflight.delete(key);
    }
  });
  inflight.set(key, p);
  return p;
}

function shape(entry, state) {
  return {
    ...entry.value,
    cache: { state: entry.lastError ? 'stale' : state, checkedAt: new Date(entry.checkedAt || entry.at).toISOString(), updatedAt: new Date(entry.at).toISOString(), ageSec: Math.round((Date.now() - entry.at) / 1000), lastError: entry.lastError || null },
  };
}

export async function cached(key, ttlMs, fn, { budgetMs = 9000, retryAfterMs = 30000, empty = { items: [], sources: [] } } = {}) {
  const entry = await load(key);
  if (entry && Date.now() - entry.at < ttlMs && (!entry.lastError || Date.now() - entry.checkedAt < retryAfterMs)) return shape(entry, 'fresh');
  if (entry) {
    refresh(key, fn).catch(() => {});
    return shape(entry, 'stale');
  }
  const p = refresh(key, fn);
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), budgetMs); });
  try {
    const got = await Promise.race([p, timeout]);
    if (got) return shape(got, 'fresh');
    p.catch(() => {});
    return { ...empty, cache: { state: 'pending', updatedAt: null, ageSec: null, lastError: null }, pending: true };
  } catch (e) {
    return { ...empty, cache: { state: 'error', updatedAt: null, ageSec: null, lastError: String(e?.message || e) }, error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

/* 신선도와 상관없이 지금 다시 받는다(백그라운드 동기화용). 같은 키가 이미 도는 중이면 그걸 기다린다 */
export async function revalidate(key, fn) {
  await load(key);
  return refresh(key, fn);
}

/* 캐시만 읽기 (갱신 안 함) */
export async function peek(key, { ttlMs = null } = {}) {
  const e = await load(key);
  return e ? shape(e, ttlMs == null ? 'peek' : Date.now() - e.at < ttlMs ? 'fresh' : 'stale') : null;
}

/* 영속 키-값 (출신국 판정 캐시 등) */
/* 모든 KV — 종료·백업 직전에 메모리의 변경분을 디스크로 내린다 */
const ALL_KV = new Set();
export async function flushAllKv() { await Promise.allSettled([...ALL_KV].map((k) => { clearTimeout(k.timer); return k.flush(); })); }
export class KV {
  constructor(name) { this.name = name; this.map = null; this.dirty = false; this.timer = null; ALL_KV.add(this); }
  async ready() {
    if (this.map) return this.map;
    this.map = new Map();
    try {
      const obj = JSON.parse(await readFile(fileOf(`kv-${this.name}`), 'utf8'));
      for (const [k, v] of Object.entries(obj)) this.map.set(k, v);
    } catch { /* 처음 */ }
    return this.map;
  }
  get(k) { return this.map?.get(k); }
  set(k, v) {
    this.map.set(k, v);
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 1500);
    this.timer.unref?.();
  }
  async flush() {
    if (!this.dirty || !DIR) return;
    this.dirty = false;
    await mkdir(DIR, { recursive: true });
    const p = fileOf(`kv-${this.name}`);
    const tmp = `${p}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(Object.fromEntries(this.map)));
    await rename(tmp, p);
  }
}
