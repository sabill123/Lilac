/**
 * Lilac 차트 수집기
 *
 * 설계 의도
 *  - 세 차트가 "같은 곡 풀"을 공유해야 통합 순위가 수학적으로 성립한다.
 *  - 공통 풀 = Apple Music 국가별 최다 재생 차트(공식 실시간 피드) 상위 N곡
 *  - 각 곡의 공식 뮤직비디오를 YouTube에서 해석해 조회수를 실측한다.
 *
 * 산출물 (db/charts.json)
 *  - apple   : Apple Music 공식 순위
 *  - youtube : 같은 풀을 공식 MV 누적 조회수로 재정렬한 순위
 *  - combined: 두 순위를 정규화 점수로 합산한 Lilac 통합 순위
 *
 * 통합 점수 = 0.5 × appleScore + 0.5 × youtubeScore
 *   각 score = (N - rank + 1) / N   (1위 = 1.0, N위 = 1/N)
 *   두 소스 중 한쪽에만 존재하면 없는 쪽은 0점 처리하고 sources에 표시한다.
 *
 * 실행: node backend/collect-charts.mjs [--limit=50]
 */
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(__dirname, '..', 'db');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1]) || 50;
const COUNTRIES = [
  { code: 'jp', label: '일본', hl: 'ja' },
  { code: 'kr', label: '한국', hl: 'ko' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().replace(/[\s()\[\]『』「」【】・,.'’!?~\-–—/]/g, '');

/* ---------- Apple Music 공식 차트 ---------- */
async function appleChart(country) {
  const url = `https://rss.marketingtools.apple.com/api/v2/${country}/music/most-played/${LIMIT}/songs.json`;
  let j = null;
  for (let attempt = 0; attempt < 3 && !j; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'lilac-collector/1.0' } });
      const txt = await r.text();
      if (txt.trim().startsWith('{')) j = JSON.parse(txt);
      else { console.log(`  Apple 피드 비정상 응답(${r.status}) 재시도 ${attempt + 1}/3`); await sleep(1500 * (attempt + 1)); }
    } catch (e) { await sleep(1500 * (attempt + 1)); }
  }
  if (!j) throw new Error(`Apple 차트 수집 실패: ${country}`);
  return (j.feed?.results || []).map((s, i) => ({
    rank: i + 1,
    title: s.name,
    artist: s.artistName,
    artwork: (s.artworkUrl100 || '').replace('100x100', '400x400'),
    appleUrl: s.url,
    releaseDate: s.releaseDate || null,
  }));
}

/* ---------- YouTube 공식 MV 해석 ---------- */
function parseViews(text) {
  if (!text) return 0;
  const digits = String(text).replace(/[^\d]/g, '');
  return Number(digits) || 0;
}
// 해석 결과 캐시 (재실행 시 재조회 방지 + 차단 회복력)
const MV_CACHE_PATH = path.join(DB, 'mv-cache.json');
let mvCache = {};
async function loadCache() {
  try { mvCache = JSON.parse(await readFile(MV_CACHE_PATH, 'utf-8')); } catch { mvCache = {}; }
  console.log(`[cache] ${Object.keys(mvCache).length}건 로드`);
}
const saveCache = () => writeFile(MV_CACHE_PATH, JSON.stringify(mvCache, null, 2));

let blocked = 0;
async function resolveMV(artist, title, hl) {
  const ck = `${artist}|${title}`;
  if (mvCache[ck]) return mvCache[ck];   // 성공한 결과만 캐시에서 재사용

  const q = `${artist} ${title} official`;
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%3D%3D`;
  try {
    // 차단 시에는 ytInitialData는 있으나 검색 결과가 0건으로 온다 → 이를 차단 신호로 보고 백오프
    let items = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': `${hl},en;q=0.8` } });
      const h = await r.text();
      const m = h.match(/var ytInitialData = (\{.*?\});<\/script>/s);
      if (m) {
        const data = JSON.parse(m[1]);
        items = (data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [])
          .flatMap((s) => s?.itemSectionRenderer?.contents || [])
          .filter((x) => x.videoRenderer)
          .map((x) => ({
            id: x.videoRenderer.videoId,
            title: x.videoRenderer.title?.runs?.[0]?.text || '',
            channel: x.videoRenderer.ownerText?.runs?.[0]?.text || '',
            views: parseViews(x.videoRenderer.viewCountText?.simpleText),
          }));
      }
      if (items.length) break;
      blocked++;
      await sleep(4000 * (attempt + 1) + Math.random() * 2000);   // 4s → 8s → 12s
    }
    if (!items.length) return null;

    const na = norm(artist), nt = norm(title);
    // 채널이 아티스트와 일치하거나(공식 채널), 제목에 곡명+아티스트가 모두 있는 항목을 우선
    const scored = items.slice(0, 8).map((v) => {
      const nc = norm(v.channel), nvt = norm(v.title);
      let score = 0;
      if (nc.includes(na) || na.includes(nc)) score += 3;          // 공식 채널
      if (/vevo|official/i.test(v.channel)) score += 1;
      if (nvt.includes(nt)) score += 2;                             // 제목 일치
      if (/official|mv|music video|ミュージックビデオ/i.test(v.title)) score += 1;
      if (/cover|カバー|리액션|reaction|가사|lyrics|歌ってみた/i.test(v.title)) score -= 3;
      return { ...v, score };
    }).sort((a, b) => b.score - a.score || b.views - a.views);

    const best = scored[0];
    const out = best && best.score > 0 ? { ...best, confidence: best.score >= 4 ? 'high' : 'low' } : null;
    if (out) mvCache[ck] = out;          // 실패는 캐시하지 않음(다음 실행에서 재시도)
    return out;
  } catch {
    return null;
  }
}

/* ---------- 통합 ---------- */
function buildCombined(apple, youtube) {
  const N = Math.max(apple.length, youtube.length);
  const scoreOf = (rank) => (rank ? (N - rank + 1) / N : 0);
  const map = new Map();
  const key = (t, a) => `${norm(t).slice(0, 14)}|${norm(a).slice(0, 8)}`;

  apple.forEach((e) => {
    map.set(key(e.title, e.artist), { ...e, appleRank: e.rank, youtubeRank: null, sources: ['apple'] });
  });
  youtube.forEach((e) => {
    const k = key(e.title, e.artist);
    const cur = map.get(k);
    if (cur) { cur.youtubeRank = e.rank; cur.ytViews = e.ytViews; cur.youtubeId = e.youtubeId; cur.sources.push('youtube'); }
    else map.set(k, { ...e, appleRank: null, youtubeRank: e.rank, sources: ['youtube'] });
  });

  return [...map.values()]
    .map((e) => {
      const score = 0.5 * scoreOf(e.appleRank) + 0.5 * scoreOf(e.youtubeRank);
      return { ...e, score: Number(score.toFixed(5)) };
    })
    .sort((a, b) => b.score - a.score)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

async function buildCountry(c) {
  console.log(`\n=== ${c.label}(${c.code}) ===`);
  const apple = await appleChart(c.code);
  console.log(`Apple 차트 ${apple.length}곡 수집`);

  const resolved = [];
  for (let i = 0; i < apple.length; i++) {
    const s = apple[i];
    const mv = await resolveMV(s.artist, s.title, c.hl);
    resolved.push({ ...s, mv });
    if ((i + 1) % 10 === 0) {
      console.log(`  MV 해석 ${i + 1}/${apple.length} (매칭 ${resolved.filter((x) => x.mv).length}, 재시도 ${blocked})`);
      await saveCache();
    }
    await sleep(1600 + Math.random() * 900);   // 페이싱 + 지터 (차단 회피)
  }
  await saveCache();
  const matched = resolved.filter((x) => x.mv);
  console.log(`MV 매칭 ${matched.length}/${apple.length} (high ${matched.filter((x) => x.mv.confidence === 'high').length})`);

  const youtube = matched
    .map((x) => ({
      title: x.title, artist: x.artist, artwork: x.artwork, appleUrl: x.appleUrl,
      ytViews: x.mv.views, youtubeId: x.mv.id, ytTitle: x.mv.title, ytChannel: x.mv.channel,
      confidence: x.mv.confidence,
    }))
    .sort((a, b) => b.ytViews - a.ytViews)
    .map((x, i) => ({ ...x, rank: i + 1 }));

  const appleOut = resolved.map((x) => ({
    rank: x.rank, title: x.title, artist: x.artist, artwork: x.artwork, appleUrl: x.appleUrl,
    youtubeId: x.mv?.id || null, ytViews: x.mv?.views || null,
  }));

  return { apple: appleOut, youtube, combined: buildCombined(appleOut, youtube) };
}

async function main() {
  await loadCache();
  const out = { updated: new Date().toISOString(), limit: LIMIT, countries: {} };
  for (const c of COUNTRIES) {
    out.countries[c.code] = { label: c.label, ...(await buildCountry(c)) };
  }
  await writeFile(path.join(DB, 'charts.json'), JSON.stringify(out, null, 2));
  console.log('\n[완료] db/charts.json 저장');
  for (const c of COUNTRIES) {
    const d = out.countries[c.code];
    console.log(`  ${c.label}: apple ${d.apple.length} / youtube ${d.youtube.length} / combined ${d.combined.length}`);
    console.log(`    통합 1위: ${d.combined[0]?.artist} - ${d.combined[0]?.title} (score ${d.combined[0]?.score})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
