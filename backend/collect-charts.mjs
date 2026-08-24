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

/* ---------- 한국 대표 차트 ---------- */

/** 멜론 TOP100 — 국내 최대 음원 플랫폼 실시간 차트 */
async function melonKR() {
  const html = await fetchText('https://www.melon.com/chart/index.htm');
  const titles = [...html.matchAll(/class="ellipsis rank01">\s*<span>\s*<a[^>]*>([^<]+)<\/a>/g)].map((m) => strip(m[1]));
  const artists = [...html.matchAll(/class="ellipsis rank02">\s*<a[^>]*>([^<]+)<\/a>/g)].map((m) => strip(m[1]));
  if (!titles.length) throw new Error('멜론 파싱 실패 — 마크업이 바뀌었을 수 있음');
  return titles.map((t, i) => ({
    rank: i + 1,
    title: decodeHtml(t),
    artist: decodeHtml(artists[i] || ''),
  })).filter((x) => x.title && x.artist);
}

/** 지니 TOP200 — 멜론과 이용자층이 달라 교차 검증에 쓴다 */
async function genieKR() {
  const html = await fetchText('https://www.genie.co.kr/chart/top200');
  const titles = [...html.matchAll(/class="title ellipsis"[^>]*>\s*([^<]+?)\s*</g)].map((m) => strip(m[1]));
  const artists = [...html.matchAll(/class="artist ellipsis"[^>]*>\s*([^<]+?)\s*</g)].map((m) => strip(m[1]));
  if (!titles.length) throw new Error('지니 파싱 실패 — 마크업이 바뀌었을 수 있음');
  return titles.map((t, i) => ({
    rank: i + 1,
    title: decodeHtml(t).replace(/^(TITLE|19금)\s*/i, ''),
    artist: decodeHtml(artists[i] || ''),
  })).filter((x) => x.title && x.artist);
}

/* ---------- 공용 ---------- */

/** Apple 공식 마케팅 RSS — 스크래핑이 아닌 정식 피드라 가장 안정적이다 */
async function appleRss(country, limit = 50) {
  const j = await fetchJson(`https://rss.applemarketingtools.com/api/v2/${country}/music/most-played/${limit}/songs.json`);
  return (j?.feed?.results || []).map((x, i) => ({
    rank: i + 1,
    title: x.name,
    artist: x.artistName,
    artwork: (x.artworkUrl100 || '').replace('100x100', '400x400'),
    appleUrl: x.url,
  }));
}

/* ---------- 일본 대표 차트 ---------- */
const strip = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

const HTML_ENT = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
const decodeHtml = (s) => String(s || '')
  .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, (m) => HTML_ENT[m])
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/\s+/g, ' ').trim();

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/** 재시도 포함 텍스트 요청 */
async function fetchText(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': BROWSER_UA, 'accept-language': 'ko,ja;q=0.8,en;q=0.6' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const t = await r.text();
      if (t.length > 500) return t;
      throw new Error(`응답이 너무 짧음(${t.length}B)`);
    } catch (e) { lastErr = e; await sleep(700 * (i + 1)); }
  }
  throw lastErr;
}

/** 재시도 포함 JSON 요청 */
async function fetchJson(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': BROWSER_UA } });
      const t = await r.text();
      if (t.trim().startsWith('{')) return JSON.parse(t);
      throw new Error('JSON 아님');
    } catch (e) { lastErr = e; await sleep(500 * (i + 1)); }
  }
  throw lastErr;
}

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
/* 종합 차트 가중치 — 양국 모두 '현지 대표 + 글로벌 스트리밍 + 영상' 구조로 맞춘다.
   현지 종합차트에 가장 큰 비중을 두고, 나머지를 균형 있게 배분한다. */
const WEIGHTS = {
  jp: { billboard: 0.30, apple: 0.20, appleRss: 0.15, youtube: 0.20, oricon: 0.15 },
  kr: { melon: 0.30, apple: 0.20, appleRss: 0.15, youtube: 0.20, genie: 0.15 },
};

/** 화면에 표기할 소스 이름 — 무엇을 근거로 만든 순위인지 숨기지 않는다 */
const SOURCE_LABELS = {
  jp: {
    billboard: 'Billboard JAPAN HOT 100', oricon: '오리콘 주간 싱글',
    apple: 'Apple Music 일본', appleRss: 'Apple 공식 RSS', youtube: 'YouTube 공식 MV 조회수',
  },
  kr: {
    melon: '멜론 TOP 100', genie: '지니 차트',
    apple: 'Apple Music 한국', appleRss: 'Apple 공식 RSS', youtube: 'YouTube 공식 MV 조회수',
  },
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

  // Apple 공식 RSS — 스크래핑이 아니라 가장 안정적인 소스
  const rss = await appleRss(c.code, 50).catch((e) => { console.log(`  Apple RSS 실패: ${e.message}`); return []; });
  console.log(`Apple RSS ${rss.length}곡 수집`);

  /* 현지 대표 차트 — 양국 대칭으로 2종씩 수집한다.
     일본: Billboard JAPAN(종합) + 오리콘(피지컬 판매)
     한국: 멜론(최대 음원 플랫폼) + 지니(이용자층이 달라 교차검증) */
  let local1 = [], local2 = [], local1Name = '', local2Name = '';
  if (c.code === 'jp') {
    local1Name = 'billboard'; local2Name = 'oricon';
    local1 = await billboardJP().catch((e) => { console.log(`  Billboard JAPAN 실패: ${e.message}`); return []; });
    console.log(`Billboard JAPAN HOT100 ${local1.length}곡 수집`);
    local2 = await oriconJP(3).catch((e) => { console.log(`  오리콘 실패: ${e.message}`); return []; });
    console.log(`오리콘 주간 싱글 ${local2.length}곡 수집`);
  } else {
    local1Name = 'melon'; local2Name = 'genie';
    local1 = await melonKR().catch((e) => { console.log(`  멜론 실패: ${e.message}`); return []; });
    console.log(`멜론 TOP100 ${local1.length}곡 수집`);
    local2 = await genieKR().catch((e) => { console.log(`  지니 실패: ${e.message}`); return []; });
    console.log(`지니 차트 ${local2.length}곡 수집`);
  }

  /* MV 해석 풀 = Apple ∪ RSS ∪ 현지차트 상위 (중복 제거)
     해석은 곡당 2초 안팎이 걸리므로 상한을 둔다 */
  const MV_POOL_MAX = Number(process.env.MV_POOL_MAX || 70);
  const poolMap = new Map();
  const addPool = (list, n) => list.slice(0, n).forEach((e) => {
    const k = keyOf(e.title, e.artist);
    if (!poolMap.has(k)) poolMap.set(k, { title: e.title, artist: e.artist, artwork: e.artwork || null, appleUrl: e.appleUrl || null });
  });
  addPool(apple, 50);
  addPool(rss, 50);
  addPool(local1, LIMIT);
  addPool(local2, 30);
  const pool = [...poolMap.values()].slice(0, MV_POOL_MAX);
  console.log(`MV 해석 풀 ${pool.length}곡 (상한 ${MV_POOL_MAX})`);

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
  const rssOut = withMV(rss);
  const local1Out = withMV(local1);
  const local2Out = withMV(local2);
  const weights = WEIGHTS[c.code] || WEIGHTS.kr;

  const sources = { apple: appleOut, appleRss: rssOut, youtube, [local1Name]: local1Out, [local2Name]: local2Out };
  const combined = buildCombined(sources, weights);

  return { ...sources, combined, weights, sourceLabels: SOURCE_LABELS[c.code] };
}

/** 색인 재구축 — 수집 완료 후에만 호출한다 */
async function rebuildIndex() {
  try {
    const mod = await import('./build-index.mjs');
    const r = await mod.buildIndex();
    console.log(`[index] 검색 색인 ${r.count}건 갱신`);
  } catch (e) { console.error('[index] 색인 갱신 실패:', e.message); }
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
    if (!d) continue;
    const counts = Object.entries(d).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${k} ${v.length}`).join(' / ');
    console.log(`  ${c.label}: ${counts}`);
    console.log(`    통합 1위: ${d.combined?.[0]?.artist} - ${d.combined?.[0]?.title} (score ${d.combined?.[0]?.score}, 소스 ${d.combined?.[0]?.sources?.join('+')})`);
  }

  // 수집이 끝난 뒤 색인을 다시 만든다 — 새 곡이 즉시 한글로 검색된다
  await rebuildIndex();
}

main().catch((e) => { console.error(e); process.exit(1); });


