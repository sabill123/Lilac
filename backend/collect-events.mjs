/**
 * 일정 수집 (한국 · 일본 양국)
 *
 * 두 종류를 명확히 구분해 만든다.
 *   실데이터 : Apple Music 카탈로그의 실제 발매일 (앞으로 나올 것 + 최근 나온 것)
 *   데모     : 공연·응모 일정. 공식 티켓 API 계약이 없으므로 예시로만 둔다.
 *
 * 화면에서 두 종류를 배지로 구분해 표기하므로, 여기서도 isDemo 를 반드시 채운다.
 *
 * 실행: node backend/collect-events.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(__dirname, '..', 'db');
const UA = 'lilac-collector/1.0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA } });
      const t = await r.text();
      if (t.trim().startsWith('{')) return JSON.parse(t);
    } catch { /* 재시도 */ }
    await sleep(500 * (i + 1));
  }
  return null;
}

const ymd = (d) => new Date(d).toISOString().slice(0, 10);

/** 아티스트 최신 발매작에서 발매 일정을 만든다 */
async function releasesOf(artist) {
  const country = artist.country || 'jp';
  const j = artist.appleArtistId
    ? await getJson(`https://itunes.apple.com/lookup?id=${artist.appleArtistId}&entity=album&limit=12&country=${country}`)
    : await getJson(`https://itunes.apple.com/search?media=music&entity=album&country=${country}&limit=8&term=${encodeURIComponent(artist.searchTerm || artist.name)}`);

  const albums = (j?.results || []).filter((x) => x.wrapperType === 'collection' && x.releaseDate);
  return albums.map((x) => ({
    id: `rel-${x.collectionId}`,
    type: '발매',
    title: x.collectionName,
    artist: artist.name,
    artistId: artist.id,
    country,
    date: ymd(x.releaseDate),
    venue: '전 플랫폼',
    artwork: (x.artworkUrl100 || '').replace('100x100', '400x400'),
    appleUrl: x.collectionViewUrl,
    trackCount: x.trackCount || 0,
    isDemo: false,
    source: 'Apple Music 카탈로그 발매일',
  }));
}

/** 공연·응모 일정 — 공식 티켓 데이터 계약 전이라 예시로만 둔다 */
function demoEvents(artists) {
  const jp = artists.filter((a) => a.country === 'jp').slice(0, 4);
  const kr = artists.filter((a) => a.country === 'kr').slice(0, 4);
  const base = Date.now();
  const plus = (d) => ymd(base + d * 864e5);

  const rows = [];
  jp.forEach((a, i) => {
    rows.push({
      id: `dm-jp-tour-${a.id}`, type: '내한', title: `${a.name} 단독 내한 공연`,
      artist: a.name, artistId: a.id, country: 'jp', date: plus(18 + i * 15),
      venue: ['올림픽공원 올림픽홀', '고려대 화정체육관', '무신사 개러지', 'YES24 라이브홀'][i % 4],
      note: '티켓 오픈 일정 미정', isDemo: true, source: '데모 데이터',
    });
    if (i < 2) rows.push({
      id: `dm-jp-fc-${a.id}`, type: '응모', title: `${a.name} FC 선행 추첨 마감`,
      artist: a.name, artistId: a.id, country: 'jp', date: plus(7 + i * 9),
      venue: 'FC 회원 한정', note: '응모 가이드 제공', isDemo: true, source: '데모 데이터',
    });
  });
  kr.forEach((a, i) => {
    rows.push({
      id: `dm-kr-tour-${a.id}`, type: '원정', title: `${a.name} 일본 투어`,
      artist: a.name, artistId: a.id, country: 'kr', date: plus(24 + i * 13),
      venue: ['도쿄돔', '오사카성홀', '사이타마 슈퍼아레나', '요코하마 아레나'][i % 4],
      note: '원정 패키지 알림 신청', isDemo: true, source: '데모 데이터',
    });
    if (i < 2) rows.push({
      id: `dm-kr-fs-${a.id}`, type: '응모', title: `${a.name} 팬사인회 응모 마감`,
      artist: a.name, artistId: a.id, country: 'kr', date: plus(5 + i * 11),
      venue: '음반 구매자 대상', note: '응모 가이드 제공', isDemo: true, source: '데모 데이터',
    });
  });
  return rows;
}

async function main() {
  const artists = JSON.parse(await readFile(path.join(DB, 'artists.json'), 'utf-8'));
  console.log(`[대상] 아티스트 ${artists.length}팀`);

  const releases = [];
  for (const a of artists) {
    try {
      const list = await releasesOf(a);
      releases.push(...list);
      console.log(`  [${a.country}] ${a.name}: 발매 ${list.length}건`);
    } catch (e) { console.log(`  [${a.name}] 실패: ${e.message}`); }
    await sleep(240);
  }

  // 중복 제거 후 날짜순
  const seen = new Set();
  const uniq = releases.filter((r) => {
    const k = `${r.artist}|${r.title}|${r.date}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const rows = [...uniq, ...demoEvents(artists)]
    .sort((a, b) => a.date.localeCompare(b.date));

  await writeFile(path.join(DB, 'events.json'), JSON.stringify(rows, null, 2));

  const today = ymd(Date.now());
  const upcoming = rows.filter((r) => r.date >= today);
  console.log(`\n[완료] 일정 ${rows.length}건 저장`);
  console.log(`  실데이터(발매) ${rows.filter((r) => !r.isDemo).length}건 / 데모(공연·응모) ${rows.filter((r) => r.isDemo).length}건`);
  console.log(`  다가오는 일정 ${upcoming.length}건`);
  console.log(`  국가별`, rows.reduce((m, r) => ({ ...m, [r.country]: (m[r.country] || 0) + 1 }), {}));
}

main().catch((e) => { console.error(e); process.exit(1); });
