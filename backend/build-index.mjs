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
 * 추적 중인 아티스트의 전체 디스코그래피를 가져온다.
 * 색인 커버리지를 결정하는 가장 중요한 소스 — 신곡이 발매되면 다음 실행에서 자동 편입된다.
 */
async function fetchDiscographies(artists) {
  const out = [];
  for (const a of artists) {
    const term = a.searchTerm || a.nameJa || a.name;
    if (!term) continue;
    try {
      let artistId = a.appleArtistId;
      if (!artistId) {
        const s = await getJson(`https://itunes.apple.com/search?media=music&entity=musicArtist&country=jp&limit=1&term=${encodeURIComponent(term)}`);
        artistId = s?.results?.[0]?.artistId;
      }
      if (!artistId) { console.warn(`  [skip] ${term}: 아티스트 ID 없음`); continue; }
      const d = await getJson(`https://itunes.apple.com/lookup?id=${artistId}&entity=song&limit=200&country=jp`);
      const tracks = (d?.results || []).filter((x) => x.wrapperType === 'track');
      for (const t of tracks) out.push({ title: t.trackName, artist: t.artistName });
      console.log(`  ${term}: ${tracks.length}곡`);
      await new Promise((s) => setTimeout(s, 350));   // 예의상 간격
    } catch (e) { console.warn(`  [실패] ${term}: ${e.message}`); }
  }
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
    console.log('[index] 디스코그래피 수집...');
    for (const t of await fetchDiscographies(artists)) {
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
