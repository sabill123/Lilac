/* 뉴스(한국어 판 = 한국에서 본 J-POP) 범위·정확도·아티스트 중복 — 네트워크 없음.
 * Google 뉴스 RSS를 검색어별 고정 기사로 바꿔 실제 서비스(service.news)를 그대로 돌린다.
 *
 * 운영에서 본 문제(2026-10-22): 한국어 판이 한 달에 16건, 거의 米津玄師뿐이고, 옆 칸에 米津玄師가 두 줄로 나왔다.
 *  - 상위 8팀만, 그것도 한국어 기사에 안 쓰이는 표기(あいみょん, =LOVE)로 찾았다
 *  - 제목의 한글 표기 흔들림(요네즈 겐시), 조사(아도부터), 기사가 처음 소개한 표기(킹누(King Gnu))를 못 알아봤다
 *  - Apple ID가 갈라진 같은 사람(米津玄師 / kenshi)을 두 아티스트로 셌다
 * 실행: node tests/verify-news.mjs */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as news from '../backend/lib/live/news.mjs';
import { createLiveService } from '../backend/lib/live/service.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name} ${detail}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 이름 판정(순수 함수) ---------- */
const ADO = [{ id: 'ado', names: ['Ado', '아도'] }];
ok('조사 \'부터\'가 붙은 한글 이름', news.matchArtists("아도부터 FT아일랜드까지… 'XMF'서 펼쳐진 '음악 한일전'", ADO).includes('ado'));
ok('네 글자 이하 로마자 이름은 대소문자까지(Burger King ≠ KING)', news.matchArtists('Burger King 신메뉴 출시', [{ id: 'king', names: ['KING'] }]).length === 0);
ok('대문자 약칭은 그대로 잡는다(IVE)', news.matchArtists('IVE、新曲MV公開', [{ id: 'ive', names: ['IVE'] }]).includes('ive'));
ok('첫소리 흔들림 펼치기(켄시 → 겐시)', typeof news.hangulVariants === 'function' && news.hangulVariants('요네즈 켄시').includes('요네즈 겐시'));
ok('두 글자 이름은 펼치지 않는다', typeof news.hangulVariants === 'function' && news.hangulVariants('아도').length === 0);
const learned = typeof news.learnKoreanAliases === 'function'
  ? news.learnKoreanAliases(['日 인기 밴드 킹누(King Gnu), 첫 내한', '일본 밴드 미세스 그린 애플(Mrs. GREEN APPLE) 정규 6집'], [{ id: 'king-gnu', names: ['King Gnu'] }, { id: 'mga', names: ['Mrs. GREEN APPLE'] }])
  : new Map();
ok('기사 괄호에서 한글 표기 배우기(꾸밈말은 떼고)', JSON.stringify(learned.get('king-gnu')) === '["킹누"]' && (learned.get('mga') || []).includes('미세스 그린 애플'), JSON.stringify([...learned]));

/* ---------- 서비스 전체: 고정 로스터 + 고정 기사 ---------- */
const MB = '09d4a85c-4916-4b4e-bc96-c4cfcf371046';
const jp = (id, name, extra = {}) => ({ id, name, nameOriginal: name, country: 'jp', appleGenre: 'J-Pop', aliases: [], chartHits: 0, ...extra });
const ARTISTS = [
  /* 같은 사람: Apple ID는 갈라졌지만 MusicBrainz·Spotify는 같다(운영 데이터 그대로) */
  jp('米津玄師', '米津玄師', { nameJa: '米津玄師', appleArtistId: 1623628876, mbid: MB, links: { spotify: { url: 'https://open.spotify.com/artist/1snhtMLeb2DYoMOcVbb8iB' } }, chartHits: 13 }),
  { id: 'kenshi', name: '요네즈 켄시', nameJa: '米津玄師', country: 'jp', appleGenre: 'J-Pop', appleArtistId: 530814268, mbid: MB, links: { spotify: { url: 'https://open.spotify.com/artist/1snhtMLeb2DYoMOcVbb8iB' } }, aliases: ['요네즈켄시', '켄시', '米津玄師', 'Kenshi Yonezu'], chartHits: 0 },
  jp('あいみょん', 'あいみょん', { appleArtistId: 11, aliases: ['Aimyon'], chartHits: 12 }),
  jp('=love', '=LOVE', { appleArtistId: 12, chartHits: 11 }),
  jp('mrs-green-apple', 'Mrs. GREEN APPLE', { appleArtistId: 13, aliases: ['미세스 그린 애플'], chartHits: 10 }),
  jp('vaundy', 'Vaundy', { appleArtistId: 14, aliases: ['바운디'], chartHits: 9 }),
  jp('ado', 'Ado', { appleArtistId: 15, aliases: ['아도'], chartHits: 8 }),
  jp('yoasobi', 'YOASOBI', { appleArtistId: 16, aliases: ['요아소비'], chartHits: 7 }),
  jp('takara', 'Takara', { appleArtistId: 17, chartHits: 6 }),
  jp('radwimps', 'RADWIMPS', { appleArtistId: 18, aliases: ['라드윔프스'], chartHits: 5 }),
  jp('back-number', 'back number', { appleArtistId: 19, chartHits: 4 }),
  /* 차트 밖 아티스트 — 예전에는 아예 찾지 않았다(상위 8팀만) */
  jp('king-gnu', 'King Gnu', { appleArtistId: 20, chartHits: 0 }),
  jp('creepy-nuts', 'Creepy Nuts', { appleArtistId: 21, aliases: ['크리피 너츠'], chartHits: 0 }),
  { id: 'ive', name: 'IVE', nameOriginal: 'IVE', country: 'kr', appleGenre: 'K-Pop', appleArtistId: 30, aliases: [], chartHits: 5 },
];
const day = (n) => new Date(Date.now() - n * 864e5).toUTCString();
/* on: 이 말이 검색어에 들어 있으면 그 검색 결과로 나온다 */
const CORPUS = [
  { title: '요네즈 켄시 내한공연 3회 전석 매진…2027년 1월 인천 개최', source: '서울신문', d: 0, on: ['요네즈 켄시', '일본 가수 내한'], want: '米津玄師' },
  { title: '日 인기 싱어송라이터 요네즈 겐시, 내년 1월 내한 공연', source: '씨네플레이', d: 5, on: ['일본 가수 내한', 'J팝 내한'], want: '米津玄師' },
  { title: "Ado부터 데이식스·원오크록까지…'XMF 2026' 개막 D-10, 역대급 한일 라인업", source: '조선일보', d: 29, on: ['일본 밴드 내한'], want: 'ado' },
  { title: "아도부터 FT아일랜드까지… 'XMF'서 펼쳐진 '음악 한일전'", source: '한국일보', d: 18, on: ['"아도"', 'J팝 페스티벌'], want: 'ado' },
  { title: '日 밴드 킹누(King Gnu), 내년 2월 첫 단독 내한 확정', source: '스포츠경향', d: 9, on: ['"King Gnu"'], want: 'king-gnu' },
  { title: '킹누 내한 공연 티켓 오픈…예매 1분 만에 매진', source: '뉴스엔', d: 2, on: ['"King Gnu"'], want: 'king-gnu' },
  { title: '크리피 너츠, 12월 첫 단독 내한 공연', source: '연합뉴스', d: 3, on: ['"크리피 너츠"', '"Creepy Nuts"'], want: 'creepy-nuts' },
  { title: "日요아소비, NHK 드라마 '블라섬' 주제가 14일 발매", source: '문화일보', d: 15, on: ['"요아소비"'], want: 'yoasobi' },
  { title: "바운디(Vaundy), 3만 관객 홀린 압도적 라이브…J-팝 내한 열풍의 '화룡점정'", source: '뉴시스', d: 1, on: ['"바운디"', 'J-POP 내한 공연'], want: 'vaundy' },
  { title: '백넘버(back number), 첫 내한공연 성료…한국 팬들과 재회 기약', source: '스포츠경향', d: 8, on: ['"back number"'], want: 'back-number' },
  { title: '데뷔 20주년 日 국가대표 밴드 "한국어 노래 아름다워"', source: '조선일보', d: 3, on: ['日 밴드'], want: '' },
  /* 걸러야 하는 것 */
  { title: 'Christina Chang(Takara Bio) | 다카라 Trekker를 활용한 공간 멀티오믹스 웨비나', source: 'BRIC', d: 9, on: ['"Takara"', 'J팝 신곡 발매'], bad: true },
  { title: "아도 화상 '천년향' 도리사서 다시 피어나다", source: '현대불교', d: 19, on: ['"아도"', 'J팝 내한'], bad: true },
  { title: "8년 만 내한 '위켄드'…빈틈없는 보컬로 5만명 팬 달궜다", source: '중앙일보', d: 15, on: ['일본 가수 내한', 'J팝 내한'], bad: true },
  { title: "김남길, 일본서 걸그룹 노래에 흥 폭발 \"남길이는 어디 있어?\"", source: '텐아시아', d: 7, on: ['일본 아이돌 내한'], bad: true },
  { title: 'Love Again 신곡 발매…파우 데뷔 3주년', source: '전자신문', d: 11, on: ['LOVE'], bad: true },
  { title: '米津玄師、新曲MV公開', source: 'ナタリー', d: 1, on: ['米津玄師', '"Kenshi Yonezu"'], bad: true },
];
const rss = (items) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>t</title>${items.map((x, i) => `<item><title>${x.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')} - ${x.source}</title><link>https://news.google.com/rss/articles/fx${CORPUS.indexOf(x)}?oc=5</link><guid isPermaLink="false">fx${CORPUS.indexOf(x)}-${i}</guid><pubDate>${day(x.d)}</pubDate><description>x</description><source url="https://example.org">${x.source}</source></item>`).join('')}</channel></rss>`;

const dir = await mkdtemp(path.join(tmpdir(), 'lilac-news-'));
const origFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.hostname !== 'news.google.com') throw new Error(`offline fixture: ${u.hostname}`);
  const q = String(u.searchParams.get('q') || '').replace(/ when:\d+d$/, '');
  calls.push({ q, hl: u.searchParams.get('hl') });
  return new Response(rss(CORPUS.filter((x) => x.on.some((t) => q.includes(t)))), { status: 200, headers: { 'content-type': 'application/rss+xml' } });
};
const api = createLiveService({ dbDir: dir, readJson: async (k, fb) => (k === 'artists' ? structuredClone(ARTISTS) : fb), getCharts: async () => null });
/* 주기 작업처럼 force 로 한 번 갱신하고, 새 결과가 저장될 때까지 기다린다 */
let lastUpdated = null;
async function run(edition) {
  await sleep(5);
  let r = await api.news({ edition, force: true });
  for (let i = 0; i < 400 && (r.pending || !r.cache?.updatedAt || r.cache.updatedAt === lastUpdated); i++) { await sleep(10); r = await api.news({ edition }); }
  lastUpdated = r.cache?.updatedAt || null;
  return r;
}
try {
  /* 같은 사람이 두 줄로 나오지 않는다 */
  const krArtists = (await api.artists({ edition: 'kr' })).items;
  ok('Apple ID가 갈라진 같은 사람(米津玄師 / kenshi)은 한 명', krArtists.filter((a) => a.name === '米津玄師').length === 1, JSON.stringify(krArtists.filter((a) => /米津/.test(a.name)).map((a) => a.id)));
  ok('다른 아티스트는 그대로(합쳐지지 않음)', krArtists.length === ARTISTS.filter((a) => a.country === 'jp').length - 1, String(krArtists.length));

  /* 판 뉴스: 실행마다 몇 개씩 돌아가며 찾고 지난 결과와 합친다 */
  const perRun = [];
  let r;
  for (let i = 0; i < 4; i++) {
    const n0 = calls.length;
    r = await run('kr');
    perRun.push(calls.length - n0);
  }
  const krCalls = calls.filter((c) => c.hl === 'ko');
  const items = r.items || [];
  const all = items.flatMap((x) => [x, ...(x.related || []).map((y) => ({ ...y, artistIds: x.artistIds }))]);
  const titleOf = (t) => all.find((x) => x.title === t);
  ok('한 번에 원천 요청은 7개 이하', perRun.every((n) => n <= 7), JSON.stringify(perRun));
  const kanaName = /"[^"]*[぀-ヿ一-龯][^"]*"/;
  ok('한국어 판 검색어에 가나·한자 이름을 쓰지 않는다(あいみょん)', krCalls.every((c) => !kanaName.test(c.q)), JSON.stringify(krCalls.map((c) => c.q).filter((q) => kanaName.test(q))));
  ok('흔한 낱말 이름(=LOVE → LOVE)으로 찾지 않는다', krCalls.every((c) => !/"=?LOVE"/i.test(c.q)));
  ok('차트 밖 아티스트도 찾는다(크리피 너츠·King Gnu)', krCalls.some((c) => c.q.includes('크리피 너츠')) && krCalls.some((c) => c.q.includes('King Gnu')), JSON.stringify(krCalls.map((c) => c.q)));
  for (const x of CORPUS.filter((c) => !c.bad)) {
    const got = titleOf(x.title);
    ok(`남김: ${x.title.slice(0, 32)}${x.want ? ` → ${x.want}` : ''}`, !!got && (!x.want || got.artistIds.includes(x.want)), got ? JSON.stringify(got.artistIds) : 'missing');
  }
  for (const x of CORPUS.filter((c) => c.bad)) ok(`거름: ${x.title.slice(0, 32)}`, !titleOf(x.title));
  ok('뉴스에 합쳐진 옛 id(kenshi)가 나오지 않는다', all.every((x) => !(x.artistIds || []).includes('kenshi')));
  /* 옆 칸(많이 언급된 아티스트)은 artistIds를 그대로 센다 — 같은 사람이 두 id로 세어지면 두 줄이 된다 */
  const mention = new Map();
  for (const it of items) for (const id of it.artistIds || []) mention.set(id, (mention.get(id) || 0) + 1);
  const names = [...mention.keys()].map((id) => krArtists.find((a) => a.id === id)?.name).filter(Boolean);
  ok('옆 칸에 같은 이름이 두 번 나오지 않는다', names.length === new Set(names).size, JSON.stringify(names));
  const wants = [...new Set(CORPUS.map((x) => x.want).filter(Boolean))];
  ok(`기대한 아티스트 ${wants.length}팀이 모두 옆 칸에 나온다`, wants.every((id) => mention.has(id)), JSON.stringify([...mention]));
} finally {
  globalThis.fetch = origFetch;
  api.dispose?.();
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
console.log(`\nnews: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
