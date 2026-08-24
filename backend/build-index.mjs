/**
 * 검색 색인 자동 구축
 *
 * 수집된 실데이터(차트·상품·카탈로그·아티스트)에 들어있는 모든 일본어 표기를
 * 형태소 분석기로 읽어 가나 읽기와 음가 키를 만들어 둔다.
 * 손으로 별칭을 적지 않아도 새 곡이 수집되는 즉시 한글로 검색된다.
 *
 * 실행: node backend/build-index.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initTokenizer, readingVariants } from './lib/readings.mjs';
import { phoneticKey, looseKey } from './lib/ko-ja.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(__dirname, '../db');

const readJson = async (name, fallback) => {
  try { return JSON.parse(await fs.readFile(path.join(DB, name), 'utf-8')); }
  catch { return fallback; }
};

const hasJa = (s) => /[ぁ-んァ-ヶ一-龥]/.test(String(s || ''));

/** iTunes는 간헐적으로 빈 응답을 준다 */
async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'lilac-index/1.0' } });
      const t = await r.text();
      if (t.trim().startsWith('{')) return JSON.parse(t);
    } catch { /* 재시도 */ }
    await new Promise((s) => setTimeout(s, 300 * (i + 1)));
  }
  return null;
}

/**
 * 색인 대상 아티스트를 정한다.
 *  고정 목록이 아니라 차트에 실제로 오른 아티스트를 따라간다.
 *  인기 아티스트가 바뀌면 색인 대상도 자동으로 바뀐다.
 */
function resolveArtistTerms(artists, charts, max = 60) {
  const freq = new Map();
  for (const bucket of Object.values(charts.countries || {})) {
    if (!bucket || typeof bucket !== 'object') continue;
    for (const list of Object.values(bucket)) {
      if (!Array.isArray(list)) continue;
      for (const e of list) {
        const name = String(e?.artist || '').trim();
        if (!name || name.length > 40) continue;
        // "A & B", "A feat. B" 같은 합작 표기는 대표명만 남긴다
        const main = name.split(/\s*(?:&|feat\.|ft\.|,|×|x )\s*/i)[0].trim();
        if (main.length < 2) continue;
        freq.set(main, (freq.get(main) || 0) + 1);
      }
    }
  }
  const tracked = artists.map((a) => a.searchTerm || a.nameJa || a.name).filter(Boolean);
  const fromChart = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  // 추적 아티스트는 항상 포함, 나머지는 차트 노출 순
  const seen = new Set();
  const out = [];
  for (const t of [...tracked, ...fromChart]) {
    const k = t.toLowerCase().replace(/\s+/g, '');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 아티스트 전체 디스코그래피를 가져온다.
 * 색인 커버리지를 결정하는 가장 중요한 소스 — 신곡이 발매되면 다음 실행에서 자동 편입된다.
 * 아티스트 ID는 캐시해 재조회를 피한다.
 */
async function fetchDiscographies(terms) {
  const idCachePath = path.join(DB, 'artist-ids.json');
  let idCache = {};
  try { idCache = JSON.parse(await fs.readFile(idCachePath, 'utf-8')); } catch { /* 최초 실행 */ }

  const out = [];
  let ok = 0, skipped = 0;
  for (const term of terms) {
    try {
      let artistId = idCache[term];
      if (artistId === undefined) {
        const s = await getJson(`https://itunes.apple.com/search?media=music&entity=musicArtist&country=jp&limit=1&term=${encodeURIComponent(term)}`);
        artistId = s?.results?.[0]?.artistId ?? null;
        idCache[term] = artistId;          // null 도 캐시해 매번 재시도하지 않는다
        await new Promise((s2) => setTimeout(s2, 200));
      }
      if (!artistId) { skipped++; continue; }
      const d = await getJson(`https://itunes.apple.com/lookup?id=${artistId}&entity=song&limit=200&country=jp`);
      const tracks = (d?.results || []).filter((x) => x.wrapperType === 'track');
      for (const t of tracks) out.push({ title: t.trackName, artist: t.artistName });
      if (tracks.length) ok++;
      await new Promise((s2) => setTimeout(s2, 300));
    } catch (e) { console.warn(`  [실패] ${term}: ${e.message}`); }
  }
  await fs.writeFile(idCachePath, JSON.stringify(idCache, null, 2));
  console.log(`  아티스트 ${ok}팀 / 곡 ${out.length}건 (ID 미확인 ${skipped}팀)`);
  return out;
}

export async function buildIndex() {
  await initTokenizer();

  const [charts, products, tracks, artists, events] = await Promise.all([
    readJson('charts.json', {}), readJson('products.json', []),
    readJson('tracks.json', []), readJson('artists.json', []),
    readJson('events.json', []),
  ]);

  /** ja 표기 → 항목 */
  const map = new Map();
  const add = (ja, type, extra = {}) => {
    const key = String(ja || '').trim();
    // 영문 제목(KICK BACK, Subtitle)도 한국 팬은 '킥백','서브타이틀'로 검색한다.
    // 일본어 여부로 거르지 않고, 의미 없는 짧은 문자열만 제외한다.
    if (!key || key.length < 2) return;
    if (map.has(key)) { map.get(key).types.add(type); return; }
    map.set(key, { ja: key, types: new Set([type]), ...extra });
  };

  // 차트 (국가 × 5개 소스 전부)
  for (const bucket of Object.values(charts.countries || {})) {
    if (!bucket || typeof bucket !== 'object') continue;
    for (const list of Object.values(bucket)) {
      if (!Array.isArray(list)) continue;
      for (const e of list) {
        if (!e) continue;
        add(e.title, 'track', { artist: e.artist });
        add(e.artist, 'artist');
      }
    }
  }
  // 상품
  for (const p of products) { add(p.name, 'product', { id: p.id }); add(p.brand, 'artist'); }
  // 추적 아티스트 디스코그래피 (색인의 주력 소스)
  if (process.env.SKIP_DISCO !== '1') {
    const terms = resolveArtistTerms(artists, charts, Number(process.env.INDEX_ARTISTS || 60));
    console.log(`[index] 디스코그래피 수집 (${terms.length}팀)...`);
    for (const t of await fetchDiscographies(terms)) {
      add(t.title, 'track', { artist: t.artist });
      add(t.artist, 'artist');
    }
  }
  // 시드 트랙 · 아티스트 · 일정
  for (const t of tracks) { add(t.title, 'track', { artist: t.artist }); add(t.artist, 'artist'); }
  for (const a of artists) { add(a.nameJa, 'artist', { id: a.id }); add(a.name, 'artist', { id: a.id }); }
  for (const e of events) { add(e.title, 'event', { id: e.id }); add(e.artist, 'artist'); }

  // 읽기·음가 키 생성
  const entries = [];
  for (const item of map.values()) {
    const variants = readingVariants(item.ja);
    const keys = new Set();
    // 원문 자체의 음가 (가타카나 제목·영문 제목 대응)
    const own = phoneticKey(item.ja);
    if (own.length >= 2) keys.add(own);
    const loose = looseKey(item.ja);   // 영어 제목의 한글 음차 대응 (KICK BACK ↔ 킥백)
    if (loose.length >= 3) keys.add(loose);
    for (const v of variants) {
      const k = phoneticKey(v);
      if (k.length >= 2) keys.add(k);
      const lk = looseKey(v);
      if (lk.length >= 3) keys.add(lk);
    }
    if (!keys.size) continue;
    entries.push({
      ja: item.ja,
      type: [...item.types][0],
      artist: item.artist || undefined,
      readings: variants,
      keys: [...keys],
    });
  }

  const out = { builtAt: new Date().toISOString(), count: entries.length, entries };
  await fs.writeFile(path.join(DB, 'search-index.json'), JSON.stringify(out));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await buildIndex();
  console.log(`[index] ${r.count}개 표기 색인 완료`);
  const sample = r.entries.filter((e) => /[一-龥]/.test(e.ja)).slice(0, 12);
  for (const s of sample) console.log(`  ${s.ja.padEnd(18)} → ${s.readings.join(' / ')}`);
}
