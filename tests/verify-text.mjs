/* 화면 문구 정리 규칙 — 굿즈 제목·형식·특전, 알라딘 발매일, 뉴스 매체명, 로마자 이름 일치(네트워크 없음).
 * 실행: node tests/verify-text.mjs */
import { tidyOffer, formatCode, parseAladinDate, relevance } from '../backend/lib/live/goods.mjs';
import { pickSiteName, publisherName, looksLikeDomain } from '../backend/lib/live/news.mjs';
import { halfwidth, nameInTitle } from '../backend/lib/live/http.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name} ${detail}`); } };

const a1 = tidyOffer({ store: 'aladin', title: 'Radwimps (라드윔프스) - あにゅ- (CD)', artist: 'Radwimps', format: 'CD' });
ok('알라딘: 아티스트 크레딧·형식 꼬리 제거', a1.title === 'あにゅ-' && a1.format === 'CD', JSON.stringify(a1));
const a2 = tidyOffer({ store: 'aladin', title: '(일본반) 에스파(aespa) - 일본 미니 1집 KISS N TELL [POSTER VER.]', artist: null, format: 'CD' });
ok('알라딘: (일본반)은 표시 필드로, 빈 아티스트는 크레딧에서', a2.title === '일본 미니 1집 KISS N TELL [POSTER VER.]' && a2.region === 'JP' && a2.artist === '에스파', JSON.stringify(a2));
const a3 = tidyOffer({ store: 'aladin', title: 'Mrs. Green Apple (미세스 그린 애플) - Pops (CD+Blu-ray) (초회한정반)', artist: 'Mrs. Green Apple', format: 'CD+Blu-ray' });
ok('알라딘: 정보가 더 있는 꼬리("(CD+Blu-ray)")는 유지', a3.title === 'Pops (CD+Blu-ray) (초회한정반)', a3.title);
const h1 = tidyOffer({ store: 'hmv', title: '《特典付》 Mrs.GREEN APPLE on “Harmony” (Blu-ray)', artist: 'Mrs. GREEN APPLE', format: 'Blu-ray Disc', bonus: null });
ok('HMV: 《特典付》은 특전 표시로, Blu-ray Disc → Blu-ray', h1.title === 'Mrs.GREEN APPLE on “Harmony”' && h1.bonus === 'bonus' && h1.format === 'Blu-ray', JSON.stringify(h1));
const h2 = tidyOffer({ store: 'hmv', title: '《4種セット》 2nd Album: LEMONADE (CAN Ver.)(SMART ALBUM)', format: 'グッズ' });
ok('HMV: 《4種セット》은 세트 수로, グッズ → Goods', h2.set === 4 && h2.format === 'Goods' && h2.title.startsWith('2nd Album'), JSON.stringify(h2));
ok('HMV: 옛 특전 문자열도 새 코드로', tidyOffer({ store: 'hmv', title: 'X', bonus: 'HMV 오리지널 특전' }).bonus === 'hmv');
ok('정리는 여러 번 거쳐도 같다', JSON.stringify(tidyOffer(tidyOffer({ store: 'aladin', title: 'Radwimps (라드윔프스) - 祈跡 (CD)', artist: 'Radwimps', format: 'CD' }))) === JSON.stringify(tidyOffer({ store: 'aladin', title: 'Radwimps (라드윔프스) - 祈跡 (CD)', artist: 'Radwimps', format: 'CD' })));
ok('형식 코드: CDシングル·アナログ', formatCode('CDシングル') === 'CD Single' && formatCode('アナログ') === 'LP' && formatCode('CD+DVD') === 'CD+DVD');
ok('알라딘 상세의 정확한 발매일', parseAladinDate('<meta itemprop="datePublished" content="2025-10-08">') === '2025-10-08' && parseAladinDate('<html></html>') === null);

ok('굿즈 관련도: 로마자 검색어는 단어 경계("aespa" ≠ "Viva Espana")', relevance({ title: '「Viva Musica ! Viva Espana !」', artist: null }, 'aespa') === 0 && relevance({ title: '2026 aespa WEEK MD', artist: null }, 'aespa') === 2);
ok('굿즈 관련도: 빈 아티스트는 가점 없음', relevance({ title: 'Unrelated', artist: '' }, 'RADWIMPS') === 0);

ok('반각 가운뎃점 → 전각(キム･キュジョン = キム・キュジョン)', halfwidth('キム･キュジョン') === 'キム・キュジョン');

ok('매체명: og:site_name 우선', pickSiteName('<meta property="og:site_name" content="스포츠경향"><title>스포츠경향 | 뉴스</title>') === '스포츠경향');
ok('매체명: 긴 사이트명이면 <title>의 짧은 토막', pickSiteName('<meta property="og:site_name" content="海外ドラマNAVI（ナビ）｜国内最大級！海外ドラマ専門メディア"><title>海外ドラマNAVI｜国内最大級！海外ドラマ専門メディア</title>') === '海外ドラマNAVI');
ok('도메인 판별', looksLikeDomain('sports.khan.co.kr') && !looksLikeDomain('스포츠경향'));
{
  const seen = [];
  const get = async (u) => { seen.push(u); if (u.includes('v.daum.net')) throw new Error('404'); return '<meta property="og:site_name" content="Daum">'; };
  ok('매체명: 홈이 없으면 상위 도메인으로(v.daum.net → daum.net)', (await publisherName('v.daum.net', { get })) === 'Daum' && seen.some((u) => u === 'https://daum.net/'), JSON.stringify(seen));
  const kr = []; await publisherName('sports.khan.co.kr', { get: async (u) => { kr.push(u); throw new Error('x'); } });
  ok('매체명: co.kr 같은 2단계 국가 도메인까지는 올라가지 않는다', kr.some((u) => u === 'https://khan.co.kr/') && !kr.some((u) => /\/\/co\.kr\//.test(u)), JSON.stringify(kr));
}

for (const [title, name, want] of [
  ['「Viva Musica ! Viva Espana !」', 'aespa', false], ['aespa LIVE TOUR', 'aespa', true], ['TWICE LIVE', 'IVE', false], ['IVE THE 1ST WORLD TOUR', 'IVE', true],
  ['Mrs.GREEN APPLE ARENA', 'Mrs. GREEN APPLE', true], ['EXO-SC', 'EXO', true], ['キム・キュジョン ライブ', 'キム・キュジョン', true], ['요네즈 켄시 내한', '요네즈켄시', true],
]) ok(`이름 일치: "${name}" in "${title}" = ${want}`, nameInTitle(title, name) === want);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
