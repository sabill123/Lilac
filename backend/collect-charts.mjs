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

/* ---------- 일본 대표 차트 ---------- */
const strip = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/** Billboard JAPAN HOT 100 — 스트리밍·다운로드·CD·라디오·동영상·노래방 합산 종합 차트 */
async function billboardJP() {
  const r = await fetch('https://www.billboard-japan.com/charts/detail?a=hot100', {
    headers: { 'user-agent': UA, 'accept-language': 'ja,en;q=0.8' },
  });
  const h = await r.text();
  return h.split(/<tr class="rank\d+"/).slice(1).map((b) => {
    const rank = b.match(/class="rank_td[^"]*">\s*<span>(\d+)<\/span>/)?.[1] || b.match(/<p class="rank">(\d+)<\/p>/)?.[1];
    const title = strip(b.match(/<p class="musuc_title">([\s\S]*?)<\/p>/)?.[1]);
    const artist = strip(b.match(/<p class="artist_name">([\s\S]*?)<\/p>/)?.[1]);
    const last = b.match(/<span class="last">前回：([^<]*)<\/span>/)?.[1];
    const move = /class="up"/.test(b) ? 'up' : /class="down"/.test(b) ? 'down' : /class="new"/.test(b) ? 'new' : '';
    return rank && title ? { rank: +rank, title, artist, lastRank: Number(last) || null, move } : null;
  }).filter(Boolean);
}

/** オリコン 주간 싱글 랭킹 (CD 판매 기준, Shift_JIS)
 *  페이지네이션은 /rank/js/w/{날짜}/p/{n}/ 형식이라 1페이지에서 링크를 추출해 순회한다. */
async function oriconJP(maxPages = 5) {
  const get = async (u) => {
    const buf = await fetch(u, { headers: { 'user-agent': UA, 'accept-language': 'ja' } }).then((x) => x.arrayBuffer());
    return new TextDecoder('shift_jis').decode(buf);
  };
  const parse = (h) => h.split('box-rank-entry').slice(1).map((b) => {
    const rank = b.match(/<p class="num[^"]*">\s*(\d+)\s*<\/p>/)?.[1];
    const title = strip(b.match(/<h2 class="title"[^>]*>([\s\S]*?)<\/h2>/)?.[1]);
    const artist = strip(b.match(/<p class="name"[^>]*>([\s\S]*?)<\/p>/)?.[1]);
    return rank && title ? { rank: +rank, title, artist } : null;
  }).filter(Boolean);

  const out = [];
  const seen = new Set();
  const push = (rows) => rows.forEach((r) => { if (!seen.has(r.rank)) { seen.add(r.rank); out.push(r); } });

  try {
    const first = await get('https://www.oricon.co.jp/rank/js/w/');
    push(parse(first));
    const pageLinks = [...new Set([...first.matchAll(/href="(\/rank\/js\/w\/[\d-]+\/p\/\d+\/)"/g)].map((m) => m[1]))].slice(0, maxPages - 1);
    for (const p of pageLinks) {
      await sleep(500);
      push(parse(await get('https://www.oricon.co.jp' + p)));
    }
  } catch { /* 부분 수집 허용 */ }
  return out.sort((a, b) => a.rank - b.rank);
}

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

/* ---------- 통합 ----------
   가중치: 일본은 종합차트(Billboard)를 가장 높게, CD 판매(Oricon)는 팬덤 편중이 커서 낮게 둔다. */
const WEIGHTS = {
  jp: { billboard: 0.35, apple: 0.25, youtube: 0.25, oricon: 0.15 },
  kr: { apple: 0.5, youtube: 0.5 },
};
const keyOf = (t, a) => `${norm(t).slice(0, 12)}|${norm(a).slice(0, 6)}`;

function buildCombined(sources, weights) {
  const map = new Map();
  for (const [name, list] of Object.entries(sources)) {
    if (!list?.length || !weights[name]) continue;
    const N = list.length;
    list.forEach((e) => {
      const k = keyOf(e.title, e.artist);
      const cur = map.get(k) || {
        title: e.title, artist: e.artist, artwork: e.artwork || null, appleUrl: e.appleUrl || null,
        youtubeId: e.youtubeId || null, ytViews: e.ytViews || null,
        ranks: {}, sources: [], score: 0,
      };
      if (!cur.artwork && e.artwork) cur.artwork = e.artwork;
      if (!cur.appleUrl && e.appleUrl) cur.appleUrl = e.appleUrl;
      if (!cur.youtubeId && e.youtubeId) { cur.youtubeId = e.youtubeId; cur.ytViews = e.ytViews; }
      if (cur.ranks[name] !== undefined) { map.set(k, cur); return; }   // 동일 소스 중복 집계 방지
      cur.ranks[name] = e.rank;
      cur.sources.push(name);
      cur.score += weights[name] * ((N - e.rank + 1) / N);
      map.set(k, cur);
    });
  }
  return [...map.values()]
    .map((e) => ({ ...e, score: Number(e.score.toFixed(5)) }))
    .sort((a, b) => b.score - a.score)
    .map((e, i) => ({ ...e, rank: i + 1, appleRank: e.ranks.apple ?? null, youtubeRank: e.ranks.youtube ?? null }));
}

async function buildCountry(c) {
  console.log(`\n=== ${c.label}(${c.code}) ===`);
  const apple = await appleChart(c.code);
  console.log(`Apple 차트 ${apple.length}곡 수집`);

  // 일본은 현지 대표 차트를 추가 수집
  let billboard = [], oricon = [];
  if (c.code === 'jp') {
    billboard = await billboardJP().catch(() => []);
    console.log(`Billboard JAPAN HOT100 ${billboard.length}곡 수집`);
    oricon = await oriconJP(3).catch(() => []);
    console.log(`오리콘 주간 싱글 ${oricon.length}곡 수집`);
  }

  // MV 해석 풀 = Apple ∪ Billboard 상위 (중복 제거)
  const poolMap = new Map();
  apple.forEach((e) => poolMap.set(keyOf(e.title, e.artist), { title: e.title, artist: e.artist, artwork: e.artwork, appleUrl: e.appleUrl }));
  billboard.slice(0, LIMIT).forEach((e) => {
    const k = keyOf(e.title, e.artist);
    if (!poolMap.has(k)) poolMap.set(k, { title: e.title, artist: e.artist, artwork: null, appleUrl: null });
  });
  const pool = [...poolMap.values()];
  console.log(`MV 해석 풀 ${pool.length}곡 (Apple ${apple.length} + Billboard 추가 ${pool.length - apple.length})`);

  const resolved = [];
  for (let i = 0; i < pool.length; i++) {
    const s = pool[i];
    const mv = await resolveMV(s.artist, s.title, c.hl);
    resolved.push({ ...s, mv });
    if ((i + 1) % 10 === 0) {
      console.log(`  MV 해석 ${i + 1}/${pool.length} (매칭 ${resolved.filter((x) => x.mv).length}, 재시도 ${blocked})`);
      await saveCache();
    }
    await sleep(1600 + Math.random() * 900);
  }
  await saveCache();
  const matched = resolved.filter((x) => x.mv);
  console.log(`MV 매칭 ${matched.length}/${pool.length} (high ${matched.filter((x) => x.mv.confidence === 'high').length})`);

  const youtube = matched
    .map((x) => ({
      title: x.title, artist: x.artist, artwork: x.artwork, appleUrl: x.appleUrl,
      ytViews: x.mv.views, youtubeId: x.mv.id, ytTitle: x.mv.title, ytChannel: x.mv.channel,
      confidence: x.mv.confidence,
    }))
    .sort((a, b) => b.ytViews - a.ytViews)
    .map((x, i) => ({ ...x, rank: i + 1 }));

  // MV 정보를 각 차트 목록에 역주입
  const mvByKey = new Map(matched.map((x) => [keyOf(x.title, x.artist), x.mv]));
  const withMV = (list) => list.map((e) => {
    const mv = mvByKey.get(keyOf(e.title, e.artist));
    return { ...e, youtubeId: mv?.id || null, ytViews: mv?.views || null };
  });

  const appleOut = withMV(apple);
  const billboardOut = withMV(billboard);
  const oriconOut = withMV(oricon);
  const weights = WEIGHTS[c.code] || WEIGHTS.kr;
  const combined = buildCombined({ apple: appleOut, youtube, billboard: billboardOut, oricon: oriconOut }, weights);

  return { apple: appleOut, youtube, billboard: billboardOut, oricon: oriconOut, combined, weights };
}

async function main() {
  await loadCache();
  const out = { updated: new Date().toISOString(), limit: LIMIT, countries: {} };
  for (const c of COUNTRIES) {
    try {
      out.countries[c.code] = { label: c.label, ...(await buildCountry(c)) };
      await writeFile(path.join(DB, 'charts.json'), JSON.stringify(out, null, 2));   // 국가별 부분 저장
    } catch (e) {
      console.log(`  [${c.label}] 수집 실패 — 이전 데이터 유지: ${String(e).slice(0, 90)}`);
      try {
        const prev = JSON.parse(await readFile(path.join(DB, 'charts.json'), 'utf-8'));
        if (prev.countries?.[c.code]) out.countries[c.code] = prev.countries[c.code];
      } catch { /* 이전 데이터 없음 */ }
    }
  }
  await writeFile(path.join(DB, 'charts.json'), JSON.stringify(out, null, 2));
  console.log('\n[완료] db/charts.json 저장');
  for (const c of COUNTRIES) {
    const d = out.countries[c.code];
    console.log(`  ${c.label}: apple ${d.apple.length} / youtube ${d.youtube.length} / billboard ${d.billboard.length} / oricon ${d.oricon.length} / combined ${d.combined.length}`);
    console.log(`    통합 1위: ${d.combined[0]?.artist} - ${d.combined[0]?.title} (score ${d.combined[0]?.score}, 소스 ${d.combined[0]?.sources.join("+")})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
