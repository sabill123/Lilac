/* 화면 언어별 아티스트 표시 이름 (GET /api/live/display-names)
 *
 * 규칙
 *  - 입력은 로스터 id뿐이다(임의 문자열·URL 없음). 찾는 제목은 로스터 행에서만 만든다.
 *  - 그 언어 화면에서 읽을 수 있는 이름이 로스터에 이미 있으면 바로 쓴다(method:'roster').
 *      ko: 가나·한자가 없는 이름(Mrs. GREEN APPLE·아이묭·BTS)은 그대로, 있으면 로스터의 한글 표기(nameKo)
 *      ja: 한글이 없는 이름은 그대로, 있으면 nameJa → nameOriginal(한글 없는 것)
 *    라틴 브랜드명은 번역·음차하지 않는다.
 *  - 없으면 위키백과 언어 링크(ja→ko / ko→ja)와 음악가 문서 확인으로 찾는다(method:'wikipedia-langlink').
 *    본문 괄호에서 뽑은 한글(via:'lead')은 로마자 이름과 소리가 맞을 때만(SixTONES ↔ 스톤즈 거름).
 *  - "없음"(링크 없음·음악가 문서 아님)과 "실패"(네트워크·레이트리밋)를 나눈다. 없음·찾음만 디스크(KV)에 남기고,
 *    실패는 메모리에서 쉬었다가(1분 → 5분 → 30분 → 6시간) 다시 한다.
 *  - 캐시 키 = 언어 + 규칙 버전 + id + 신원(찾는 제목·Apple id·출신국 해시). 로스터 행이 바뀌면 다시 찾는다.
 *  - 대기열 최대 20건, 같은 키는 하나로 합친다, 언어마다 한 번에 한 묶음(최대 20제목, 위키백과 요청 1회 + 문서 확인).
 *  - 한국어 화면용 읽기(readingKana): 한국어판 링크가 없어도 일본어판 음악가 문서 첫머리 괄호의 가나(大森元貴 → おおもり もとき)를
 *    같은 요청에서 받아 둔다(artist-info.mjs jaLeadReading). name을 만들지 않는다 — 음역은 화면이 출처와 함께 따로 표시.
 *  - 처음 묻는 요청은 최대 waitMs(4초)만 기다리고, 아직 찾는 중이면 status:'pending'을 돌려준다(같은 요청을 다시 하면 된다).
 */
import { createHash } from 'node:crypto';
import { koreanNamesFor, japaneseNamesFor, koreanNameFits } from './artist-info.mjs';

/* 2: 일본어판 첫머리 읽기(readingKana) 추가 — 규칙 1의 없음(unknown) 기록은 읽기를 몰랐으니 버리고 다시 찾는다 */
export const DISPLAY_NAME_RULE = 2;
export const DISPLAY_NAME_MAX_IDS = 20;
const DAY = 24 * 3600e3;
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/;
const JA_SCRIPT = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\u3005\u3006\uff66-\uff9f]/;
const str = (x) => (typeof x === 'string' ? x.trim() : '');
const PURE_KANA = /^[\u3041-\u3096\u309d\u309e\u30a1-\u30fa\u30fc\u30fb\u30fd\u30fe ]+$/;
const JA_WIKI = /^https:\/\/ja\.wikipedia\.org\/wiki\/[^\s]+$/;
const NO_READING = { readingKana: null, readingMethod: null };
const readingOf = (rec) => (rec?.readingKana ? { readingKana: rec.readingKana, readingMethod: 'ja-wikipedia-lead', readingSourceUrl: rec.readingSourceUrl } : NO_READING);

/* 그 언어 화면에서 로스터 값만으로 보여 줄 수 있는 이름 */
export function rosterDisplayName(a, locale) {
  const name = str(a?.name);
  if (locale === 'ko') {
    if (name && !JA_SCRIPT.test(name)) return name;
    const ko = str(a?.nameKo);
    if (ko && HANGUL.test(ko) && !JA_SCRIPT.test(ko)) return ko;
    return null;
  }
  if (locale === 'ja') {
    if (name && !HANGUL.test(name)) return name;
    for (const x of [a?.nameJa, a?.nameOriginal]) if (str(x) && !HANGUL.test(x)) return str(x);
    return null;
  }
  return null;
}

/* 위키백과에서 찾을 제목: ko는 일본어판 문서 제목(가나·한자가 있는 이름), ja는 한국어판 문서 제목(한글 이름) */
export function lookupTitle(a, locale) {
  if (locale === 'ko') return [a?.nameJa, a?.nameOriginal, a?.name].map(str).find((x) => x && JA_SCRIPT.test(x) && !HANGUL.test(x)) || null;
  if (locale === 'ja') return [a?.name, a?.nameKo].map(str).find((x) => x && HANGUL.test(x)) || null;
  return null;
}

const latinNames = (a) => [a?.nameOriginal, a?.name, a?.appleArtistId ? a?.searchTerm : null].filter((n) => n && /[A-Za-z]/.test(n));
export const displayNameIdentity = (a, title) => createHash('sha1').update(JSON.stringify([title, String(a?.appleArtistId || ''), a?.origin || a?.country || ''])).digest('hex').slice(0, 16);

export function createDisplayNameResolver({
  kv,
  collectors = { ko: koreanNamesFor, ja: japaneseNamesFor },
  fits = koreanNameFits,
  waitMs = 4000,
  maxQueue = 20,
  batchSize = 20,
  foundTtlMs = 30 * DAY,
  unknownTtlMs = 7 * DAY,
  cooldownsMs = [60e3, 5 * 60e3, 30 * 60e3, 6 * 3600e3],
  now = () => Date.now(),
  log = (...x) => console.warn(...x),
} = {}) {
  const queued = { ko: new Map(), ja: new Map() };   // key → job (아직 묶음에 안 들어감)
  const running = new Map();                          // key → job (지금 묶음 안)
  const failures = new Map();                         // key → { count, until, error }
  const langCooldown = { ko: { count: 0, until: 0 }, ja: { count: 0, until: 0 } };
  const workers = { ko: null, ja: null };
  const stats = { batches: 0, collectorCalls: 0, titles: 0, found: 0, unknown: 0, failed: 0, busy: 0 };
  const coolFor = (n) => cooldownsMs[Math.min(n, cooldownsMs.length) - 1] || cooldownsMs[cooldownsMs.length - 1];
  const keyOf = (locale, id, identity) => `${locale}|r${DISPLAY_NAME_RULE}|${id}|${identity}`;
  const fresh = (rec) => rec && rec.rule === DISPLAY_NAME_RULE && now() - rec.at < (rec.status === 'found' ? foundTtlMs : unknownTtlMs);
  const size = () => queued.ko.size + queued.ja.size + running.size;

  function settle(job, rec) {
    if (rec) { kv.set(job.key, rec); failures.delete(job.key); }
    else {
      const f = failures.get(job.key) || { count: 0 };
      f.count += 1; f.until = now() + coolFor(f.count); f.error = job.error || 'lookup failed';
      failures.set(job.key, f);
    }
    running.delete(job.key);
    for (const r of job.waiters) r();
  }

  async function runBatch(locale, jobs) {
    stats.batches++; stats.collectorCalls++; stats.titles += jobs.length;
    const titles = [...new Set(jobs.map((j) => j.title))];
    let got = null;
    try { got = await collectors[locale](titles); } catch (e) { got = null; for (const j of jobs) j.error = String(e?.message || e).slice(0, 160); }
    const checked = got?.checked instanceof Set ? got.checked : new Set();
    let anyChecked = false;
    for (const job of jobs) {
      if (!got || !checked.has(job.title)) { stats.failed++; job.error = job.error || 'not checked (network or rate limit)'; settle(job, null); continue; }
      anyChecked = true;
      const raw = got.get(job.title);
      const name = str(Array.isArray(raw) ? raw[0] : raw);
      const meta = got.meta?.get(job.title) || null;
      /* 읽기는 수집기가 검증한 것만, 한 번 더 형태를 확인한다(순수 가나 · 일본어판 위키백과 URL) */
      const rd = locale === 'ko' ? got.readings?.get(job.title) : null;
      const kana = str(rd?.kana);
      const reading = kana && PURE_KANA.test(kana) && kana.replace(/[ \u30fb]/g, '').length >= 2 && kana.length <= 60 && typeof rd?.sourceUrl === 'string' && JA_WIKI.test(rd.sourceUrl)
        ? { readingKana: kana, readingSourceUrl: rd.sourceUrl } : { readingKana: null };
      const base = { id: job.id, identity: job.identity, locale, rule: DISPLAY_NAME_RULE, title: job.title, at: now(), ...reading };
      let rec;
      const scriptOk = name && (locale === 'ko' ? HANGUL.test(name) && !JA_SCRIPT.test(name) : !HANGUL.test(name));
      if (!scriptOk) rec = { ...base, status: 'none', name: null, reason: name ? 'wrong-script' : 'no-langlink-or-not-musician' };
      else if (locale === 'ko' && meta?.via !== 'title' && !fits(name, job.latin)) rec = { ...base, status: 'none', name: null, reason: 'latin-mismatch', rejected: name };
      else rec = { ...base, status: 'found', name, sourceUrl: typeof meta?.url === 'string' && /^https:\/\/(ko|ja)\.wikipedia\.org\//.test(meta.url) ? meta.url : null, via: meta?.via || null };
      stats[rec.status === 'found' ? 'found' : 'unknown']++;
      settle(job, rec);
    }
    /* 묶음 전체가 실패면(위키백과가 막힘) 그 언어를 잠시 쉰다 */
    const lc = langCooldown[locale];
    if (anyChecked) { lc.count = 0; lc.until = 0; }
    else { lc.count += 1; lc.until = now() + coolFor(lc.count); log(`[lilac] display-names ${locale} batch failed x${lc.count}`); }
  }

  function kick(locale) {
    if (workers[locale]) return;
    workers[locale] = (async () => {
      try {
        while (queued[locale].size && now() >= langCooldown[locale].until) {
          const jobs = [...queued[locale].values()].slice(0, batchSize);
          for (const j of jobs) { queued[locale].delete(j.key); running.set(j.key, j); }
          await runBatch(locale, jobs);
        }
        /* 언어 쉬는 중이면 남은 대기는 실패로 돌려 기다리는 요청을 풀어 준다 */
        for (const j of [...queued[locale].values()]) { queued[locale].delete(j.key); running.set(j.key, j); j.error = 'source cooling down'; settle(j, null); }
      } finally { workers[locale] = null; }
    })();
  }

  function evaluate(locale, a) {
    const base = { id: a.id, locale };
    const rn = rosterDisplayName(a, locale);
    if (rn) return { item: { ...base, name: rn, method: 'roster', status: 'resolved', ...NO_READING } };
    const title = lookupTitle(a, locale);
    if (!title) return { item: { ...base, name: null, method: null, status: 'not-applicable', ...NO_READING } };
    const identity = displayNameIdentity(a, title);
    const key = keyOf(locale, a.id, identity);
    const rec = kv.get(key);
    if (fresh(rec) && rec.identity === identity && rec.title === title) {
      if (rec.status === 'found') return { item: { ...base, name: rec.name, method: 'wikipedia-langlink', status: 'resolved', ...(rec.sourceUrl ? { sourceUrl: rec.sourceUrl } : {}), ...readingOf(rec) } };
      /* 이름은 없어도(unknown) 검증된 읽기는 낸다 — name은 null 그대로 */
      return { item: { ...base, name: null, method: null, status: 'unknown', ...readingOf(rec) } };
    }
    const job = running.get(key) || queued[locale].get(key);
    if (job) return { item: { ...base, name: null, method: null, status: 'pending', ...NO_READING }, job };
    const f = failures.get(key);
    const until = Math.max(f?.until || 0, langCooldown[locale].until);
    if (until > now()) return { item: { ...base, name: null, method: null, status: 'unavailable', retryAfterMs: until - now(), ...NO_READING } };
    return { item: { ...base, name: null, method: null, status: 'pending', ...NO_READING }, need: { key, id: a.id, identity, title, latin: latinNames(a) } };
  }

  /* artists: 로스터 행(이미 소유 확인된 것). 돌려줄 때는 id만 쓰고 원문 입력은 쓰지 않는다 */
  async function resolve({ locale, artists }) {
    if (!['ko', 'ja'].includes(locale)) throw Object.assign(new Error('invalid locale'), { status: 400 });
    await kv.ready();
    const waits = [];
    for (const a of artists) {
      const { need, job } = evaluate(locale, a);
      if (job) waits.push(new Promise((r) => job.waiters.push(r)));
      if (!need) continue;
      if (size() >= maxQueue) { stats.busy++; continue; }
      const j = { ...need, waiters: [] };
      queued[locale].set(need.key, j);
      waits.push(new Promise((r) => j.waiters.push(r)));
    }
    for (const l of ['ko', 'ja']) if (queued[l].size) kick(l);
    if (waits.length && waitMs > 0) {
      let t;
      await Promise.race([Promise.all(waits), new Promise((r) => { t = setTimeout(r, waitMs); t.unref?.(); })]);
      clearTimeout(t);
    }
    const items = artists.map((a) => {
      const { item } = evaluate(locale, a);
      /* 대기열이 꽉 차 넣지 못한 것도 pending — 같은 요청을 다시 하면 된다 */
      return item;
    });
    const retry = items.filter((x) => x.status === 'pending' || x.status === 'unavailable').map((x) => x.retryAfterMs || 1500);
    return { locale, rule: DISPLAY_NAME_RULE, items, pending: items.some((x) => x.status === 'pending'), retryAfterMs: retry.length ? Math.min(...retry) : null };
  }

  return {
    resolve,
    stats: () => ({ ...stats, queued: queued.ko.size + queued.ja.size, running: running.size, failures: failures.size }),
    idle: async () => { while (workers.ko || workers.ja) await Promise.all([workers.ko, workers.ja]); },
  };
}
