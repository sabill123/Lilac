/* 페스티벌 수집 규칙 — 실제 예매처 화면에서 본 배치로 고정한다(네트워크 없음).
 * 실행: node tests/verify-festivals.mjs */
import { melonAgency, nameSearchNation, melonArtistResults, melonExactMatches, parseEplusFestivalList, eplusLineup, melonLineup, melonNation, groupFestivals, festivalKey, festivalTitle } from '../backend/lib/live/festivals.mjs';
import { ogImage, eventPoster } from '../backend/lib/live/posters.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name} ${detail}`); } };

const list = `<a class="ticket-item ticket-item--sub" href="/sf/detail/0818440001-P0030008"> <section class="ticket-item__inner"> <div class="ticket-item__left"> <p class="ticket-item__date"><span class="ticket-item__yyyy">2026/</span><span class="ticket-item__mmdd">10/2(金)</span></p><p class="ticket-item__date"><span class="ticket-item__yyyy">2026/</span><span class="ticket-item__mmdd">10/4(日)</span></p> </div> <div class="ticket-item__right"> <div class="ticket-item__image" style="background-image: url('/s/image/081844/0001/000/list/0818440001_7.png');">&nbsp;</div> <header class="ticket-item__header"> <h4 class="ticket-item__title">GO OUT CAMP vol.22 &lt;入場券のみ&gt;</h4> </header> <div class="ticket-item__content"> <div class="ticket-item__venue"> <p>ふもとっぱら（静岡県）</p> </div></div></div></section></a>
<a class="ticket-item ticket-item--sub" href="/sf/detail/0818440001-P0030009"> <section class="ticket-item__inner"> <div class="ticket-item__left"> <p class="ticket-item__date"><span class="ticket-item__yyyy">2026/</span><span class="ticket-item__mmdd">10/2(金)</span></p> </div> <div class="ticket-item__right"> <header class="ticket-item__header"> <h4 class="ticket-item__title">GO OUT CAMP vol.22 【駐車券】</h4> </header> <div class="ticket-item__content"> <div class="ticket-item__venue"> <p>ふもとっぱら（静岡県）</p> </div></div></div></section></a>`;
const jp = parseEplusFestivalList(list);
ok('e+ 페스티벌 목록: 기간·장소·현·큰 이미지', jp.length === 2 && jp[0].startDate === '2026-10-02' && jp[0].endDate === '2026-10-04' && jp[0].venue === 'ふもとっぱら' && jp[0].city === '静岡県' && /\/0818440001_7\.png$/.test(jp[0].poster) && !/\/list\//.test(jp[0].poster), JSON.stringify(jp[0]));

const g = groupFestivals([...jp, { provider: 'melon', title: 'WONDERLIVET 2026 (원더리벳 2026)', url: 'https://ticket.melon.com/performance/index.htm?prodId=1', startDate: '2026-11-20', endDate: '2026-11-22', venue: 'KINTEX', country: 'KR', poster: 'p' },
  { provider: 'nol', title: '그랜드 민트 페스티벌 2026', url: 'u1', startDate: '2026-10-17', endDate: '2026-10-18', venue: '올림픽공원', country: 'KR', poster: 'a', status: 'onsale' },
  { provider: 'nol', title: '그랜드 민트 페스티벌 2026 - 우선입장권', url: 'u2', startDate: '2026-10-17', endDate: '2026-10-18', venue: '올림픽공원', country: 'KR', poster: 'b', status: 'upcoming' },
  { provider: 'nol', title: '연희 상설 공연 〈연희판판〉', url: 'u3', startDate: '2026-04-04', endDate: '2026-10-31', venue: '국립국악원 연희마당', country: 'KR' },
  { provider: 'nol', title: 'a-nation 2025', url: 'u4', startDate: '2025-08-30', endDate: '2025-08-31', venue: 'x', country: 'JP' },
], { today: '2026-09-30' });
const titles = g.map((x) => x.title);
ok('대체 썸네일(img_no_thumb)은 포스터로 쓰지 않는다', parseEplusFestivalList(list.replace("/s/image/081844/0001/000/list/0818440001_7.png", "/s/eplus/img/daitai/img_no_thumb.png"))[0].poster === null);
ok('권종별 상품(입장권·주차권·우선입장권)은 하나로 묶는다', g.filter((x) => /GO OUT/.test(x.title)).length === 1 && g.filter((x) => /그랜드 민트/.test(x.title)).length === 1, JSON.stringify(titles));
ok('묶인 페스티벌은 본 상품을 대표 링크로', g.find((x) => /그랜드 민트/.test(x.title)).url === 'u1' && g.find((x) => /그랜드 민트/.test(x.title)).links.length === 2);
ok('국악·지난 페스티벌 제외', !titles.some((t) => /연희|a-nation 2025/.test(t)), JSON.stringify(titles));
ok('날짜순', g.map((x) => x.startDate).join() === [...g.map((x) => x.startDate)].sort().join());
ok('다른 공연장 조각 제목은 같은 페스티벌', festivalKey('국제 인디 음악 페스티벌 〈바다를 건너는 노래〉/몬스터펍') === festivalKey('국제 인디 음악 페스티벌 〈바다를 건너는 노래〉/어쿠스틱홀릭'));
ok('꼬리 권종(2日通し入場券·青春18入場券)도 같은 페스티벌', festivalKey('氣志團万博2026 ~房総爆音リゾート~ 2日通し入場券') === festivalKey('氣志團万博2026 ~房総爆音リゾート~ 青春18入場券') && festivalTitle('氣志團万博2026 ~房総爆音リゾート~ 1日入場券') === '氣志團万博2026 ~房総爆音リゾート~');
ok('표시 제목에서 권종 표기를 뗀다', festivalTitle('GO OUT CAMP vol.22 <入場券のみ>') === 'GO OUT CAMP vol.22' && festivalTitle('원웨이 페스티벌 2026 - 슈퍼얼리버드') === '원웨이 페스티벌 2026');

const epd = `<div><dt>出演</dt><dd>10月10日(土)<br>くるり/indigo la End/Suchmos/マカロニえんぴつ<br>10月11日(日)<br>くるり/ASIAN KUNG-FU GENERATION/羊文学/milet and more...<br>オフィシャルサイト:<br>https://kyotoonpaku.net/</dd></div>`;
const lu = eplusLineup(epd);
ok('e+ 出演: 날짜 줄 건너뛰고 중복 없이', lu.join('|') === 'くるり|indigo la End|Suchmos|マカロニえんぴつ|ASIAN KUNG-FU GENERATION|羊文学|milet', lu.join('|'));
ok('스테이지 머리·날짜 표시 떼고, 주의사항 전에서 끊는다', eplusLineup('<dt>出演</dt><dd>■10月3日(土)<br>MAIN STAGE:EXILE / 超特急 / NCT WISH and more...<br>曲目・演目<br>★ご来場の際の注意事項★</dd>').join('|') === 'EXILE|超特急|NCT WISH', eplusLineup('<dt>出演</dt><dd>■10月3日(土)<br>MAIN STAGE:EXILE / 超特急 / NCT WISH and more...<br>曲目・演目</dd>').join('|'));
ok('「公式サイトを参照」은 라인업이 아니다', eplusLineup('<dt>出演</dt><dd>出演者は公式サイトを参照ください</dd>').length === 0);
ok('출연 블록이 없으면 빈 목록', eplusLineup('<p>公演概要</p>').length === 0);

const mel = `<a href="/artist/index.htm?artistId=3611925" class="txt_name">\n <strong class="singer">THE ORAL CIGARETTES</strong> <img src="x.jpg"></a><a href="/artist/index.htm?artistId=1" class="txt_name">한로로
  <img src="y.jpg"></a><a href="/artist/index.htm?artistId=3611925" class="txt_name"> THE ORAL CIGARETTES <img src="x.jpg"></a>`;
ok('멜론 출연진: 이름만, 중복 제거', melonLineup(mel).map((x) => x.name).join('|') === 'THE ORAL CIGARETTES|한로로' && melonLineup(mel)[0].melonId === '3611925', JSON.stringify(melonLineup(mel)));
ok('멜론 마지막 출연자 뒤 설명문을 끌어오지 않는다', melonLineup('<a href="/artist/index.htm?artistId=9" class="txt_name">Midnight Grand Orchestra\n  </a><div>더보기</div><p>공연시간 2026년</p><img src="z.jpg">').map((x) => x.name).join('|') === 'Midnight Grand Orchestra');
ok('멜론 국적', melonNation('<dt>국적</dt><dd>일본</dd>') === 'jp' && melonNation('<dt>국적</dt>\n<dd>대한민국</dd>') === 'kr');

{
  const res = melonArtistResults('<a href="javascript:goArtistDetail(\'672857\')" class="x">찬열 ( CHANYEOL )</a><a href="javascript:goArtistDetail(\'724619\')">EXO</a><a href="javascript:goArtistDetail(\'2739460\')">세훈&amp;찬열</a>');
  ok('멜론 검색: 괄호 속 로마자 이름은 같은 사람', melonExactMatches('CHANYEOL', res).map((x) => x.id).join() === '672857', JSON.stringify(melonExactMatches('CHANYEOL', res)));
  const kf = [{ id: '1', name: 'KickFlip (킥플립)' }, { id: '2', name: '동현 ( KickFlip )' }, { id: '3', name: 'DJ Kickflip' }];
  /* '동현 ( KickFlip )'(멤버)는 문법으로 '찬열 ( CHANYEOL )'(본인)과 구별되지 않는다. 멤버와 그룹은 국적이 같아 국적 판정에는 영향이 없다 */
  ok('멜론 검색: 다른 이름(DJ Kickflip)은 제외', !melonExactMatches('KickFlip', kf).some((x) => x.id === '3') && melonExactMatches('KickFlip', kf).some((x) => x.id === '1'), JSON.stringify(melonExactMatches('KickFlip', kf)));
  ok('멜론 검색: 동명 결과가 여럿이면 모두 돌려준다(호출자가 국적 충돌을 판단)', melonExactMatches('EXILE', [{ id: 'a', name: 'Exile' }, { id: 'b', name: 'Exile' }]).length === 2);
}
ok('소속사 추출', melonAgency('<dt>소속사</dt>\n<dd>(주)SM엔터테인먼트</dd>') === '(주)SM엔터테인먼트');
ok('이름 검색 판정: 한국 법인 소속이면 KR', nameSearchNation([{ nation: 'other', agency: '(주)SM엔터테인먼트' }]) === 'kr');
ok('이름 검색 판정: 소속사 없는 동명이인은 모름(AsIs)', nameSearchNation([{ nation: 'kr', agency: null }]) === null);
ok('이름 검색 판정: 그룹과 멤버가 같은 소속이면 KR(KickFlip)', nameSearchNation([{ nation: 'unknown', agency: '(주)JYP엔터테인먼트' }, { nation: 'unknown', agency: '(주)JYP엔터테인먼트' }]) === 'kr');
ok('이름 검색 판정: 국적이 갈리면 모름(Exile)', nameSearchNation([{ nation: 'jp', agency: null }, { nation: 'other', agency: 'Warner (주)' }]) === null);
ok('og:image 절대 경로', ogImage('<meta property="og:image" content="/s/image/1_13.jpg">', 'https://eplus.jp/sf/detail/1') === 'https://eplus.jp/s/image/1_13.jpg');
const html = (og, body = '') => `<html><head>${og ? `<meta property="og:image" content="${og}">` : ''}</head><body><header><img src="/logo.png"></header>${body}</body></html>`;
let r = await eventPoster('https://ini-official.com/feature/tour', { read: async () => html('https://ini-official.com/ogp.jpg', '<img src="/img/btn_join.png"><img src="https://cdn.example.com/info/notice_cd.jpg"><img src="https://cdn.example.com/specialsite/kv.jpg">') });
ok('사이트 공통 OGP면 본문 대표 이미지(버튼·공지 이미지 제외)', r?.img === 'https://cdn.example.com/specialsite/kv.jpg', JSON.stringify(r));
r = await eventPoster('https://a.jp/feature/x', { read: async () => html('https://a.jp/f/x.jpg'), siteImage: async () => 'https://a.jp/f/x.jpg', body: false });
ok('사이트 첫 화면과 같은 이미지는 공연 이미지가 아니다', r?.none === true, JSON.stringify(r));
r = await eventPoster('https://a.jp/x', { read: async () => { throw new Error('503'); } });
ok('받기 실패는 null(없음으로 저장하지 않음)', r === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
