/* 추가 예매처(티켓링크·YES24·로치케) 파서와 예매처 간 중복 묶기 — 실제 응답 모양으로 고정(네트워크 없음).
 * 실행: node tests/verify-vendors.mjs */
import { mapTicketlink, ticketlinkList, parseYes24List, yes24List, parseLtikeEvents, ltikeItem, parseLtikeFesPage, mergeVendors, titleKey, collapseLead, carryFailed } from '../backend/lib/live/vendors-extra.mjs';
import { parseYes24Detail, parseLtikeDetail } from '../backend/lib/live/detail.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name} ${detail}`); } };

const tl = mapTicketlink({ productId: 61609, productImagePath: '//image.toast.com/a/pst.jpg', productName: '2026 EDC KOREA', locationName: '인천', regionDomesticYn: 'Y', hallName: '인스파이어 엔터테인먼트 리조트', startDate: 1790953200000, endDate: 1791039600000, category2Name: '콘서트', productFlagInfo: [{ flagName: '청년패스' }] });
ok('티켓링크: 날짜(KST)·https 포스터·상세 주소', tl.startDate === '2026-10-03' && tl.endDate === '2026-10-04' && tl.poster === 'https://image.toast.com/a/pst.jpg' && tl.url === 'https://www.ticketlink.co.kr/product/61609' && tl.country === 'KR', JSON.stringify(tl));
{
  let calls = 0;
  const page = (ids) => ({ data: { result: ids.map((id) => ({ productId: id, productName: `p${id}`, startDate: 1790953200000 })) } });
  const got = await ticketlinkList(14, { get: async (u) => { calls++; const p = Number(new URL(u).searchParams.get('page')); return p === 1 ? page([1, 2]) : p === 2 ? page([3]) : page([1, 2]); } });
  ok('티켓링크: 새 id가 없는 쪽에서 멈춘다(쪽 크기로 판단하지 않음)', got.length === 3 && calls === 3, `${got.length} ${calls}`);
}

const yHtml = `<a style='cursor:pointer;' onclick='jsf_base_GoToPerfDetail(59771);' title='ELLEGARDEN ‘Bad For Education Tour II (2026)’'><div class='list-bigger-wrap'><img class='lazyload' data-src='//tkfile.yes24.com/upload2/PerfBlog/x.jpg/dims/quality/70/' /><div class='list-bigger-txt'><p class='list-b-tit1 v2'>ELLEGARDEN</p><p class='list-b-tit2 v2'>2026.11.28 ~ 2026.11.29</p><p class='list-b-tit2 v2'>YES24 LIVE</p></div></div></a>`;
const y = parseYes24List(yHtml);
ok('YES24 목록: 기간·장소·포스터·상세 주소', y.length === 1 && y[0].startDate === '2026-11-28' && y[0].endDate === '2026-11-29' && y[0].venue === 'YES24 LIVE' && /^https:\/\/tkfile\.yes24\.com\//.test(y[0].poster) && y[0].url === 'https://ticket.yes24.com/Perf/59771', JSON.stringify(y[0]));
{
  let calls = 0;
  const got = await yes24List(15456, 1, { get: async (u) => { calls++; return Number(new URL(u).searchParams.get('pCurPage')) <= 2 ? yHtml.replace('59771', String(59770 + Number(new URL(u).searchParams.get('pCurPage')))) : yHtml.replace('59771', '59771'); } });
  ok('YES24: 쪽마다 새 id가 없으면 멈춘다', got.length === 2 && calls === 3, `${got.length} ${calls}`);
}

const lt = `<script type="application/ld+json">[{"@context":"http://schema.org","@type":"Event","name":"ＮＣＴ　１２７","startDate":"2026-10-24","endDate":"2026-10-25","location":{"@type":"Place","name":"ベルーナドーム","address":{"@type":"PostalAddress","addressRegion":"埼玉県","addressCountry":"日本"}},"image":["https://img.hmv.co.jp/x/main.webp"],"offers":{"@type":"Offer","name":"指定席","price":"13200","priceCurrency":"JPY"}}]</script>`;
const ev = parseLtikeEvents(lt, 'https://l-tike.com/concert/mevent/?mid=482316');
const it = ltikeItem('482316', ev);
ok('로치케 JSON-LD: 반각 이름·장소·현·일본·이미지', it.title === 'NCT 127' && it.venue === 'ベルーナドーム' && it.city === '埼玉県' && it.country === 'JP' && it.startDate === '2026-10-24' && it.endDate === '2026-10-25' && /main\.webp/.test(it.poster), JSON.stringify(it));
const fes = parseLtikeFesPage('<a href="https://l-tike.com/concert/mevent/?mid=590440">布袋寅泰</a><a href="https://l-tike.com/concert/mevent/?mid=353506"><span>a-nation 2026（東京）10/3～4</span></a><a href="https://l-tike.com/concert/mevent/?mid=785211">XMF 2026（韓国）10/3～4</a>');
ok('로치케 페스 특집: “제목（현）날짜” 링크만 페스티벌', fes.size === 2 && fes.get('353506') === 'a-nation 2026' && !fes.has('590440'), JSON.stringify([...fes]));
const ld = parseLtikeDetail(lt, 'https://l-tike.com/concert/mevent/?mid=482316');
ok('로치케 상세: 기간·가격(offers)', ld.facts.period?.join() === '2026-10-24,2026-10-25' && ld.prices[0]?.price === 13200 && ld.prices[0]?.grade === '指定席', JSON.stringify(ld.prices));

const yd = parseYes24Detail('<dl><dt>등급</dt><dd>&nbsp;7세 이상 관람가</dd><dt>관람시간</dt><dd>&nbsp;90분 (인터미션 없음)</dd></dl><div>가격</div><ul><li><span>스탠딩석 </span><span>88,000</span><span>원</span></li><li><span>지정석 </span><span>99,000</span><span>원</span></li></ul><div>혜택</div><div>공연시간 안내</div><p>2026년 11월 28일(토) 오후 6시</p><p>본 상품은 일괄배송 상품으로 2026년 11월 06일부터 순차 배송됩니다.</p><div>배송정보</div><p>현장 수령만 가능</p>', 'https://ticket.yes24.com/Perf/59771');
ok('YES24 상세: 등급·관람시간·가격·공연시간(배송 안내 제외)', yd.facts.age === '7세 이상 관람가' && yd.facts.runningMin === 90 && yd.prices.map((p) => `${p.grade}:${p.price}`).join() === '스탠딩석:88000,지정석:99000' && yd.facts.times.join() === '2026년 11월 28일(토) 오후 6시' && yd.booking.delivery.join() === '현장수령', JSON.stringify({ f: yd.facts, p: yd.prices }));

ok('제목 키: 지역 머리표·기호·띄어쓰기 무시', titleKey('[서울] 2026 ELLEGARDEN ‘Bad For Education Tour II’') === titleKey('2026 ELLEGARDEN Bad For Education Tour II'));
const merged = mergeVendors([
  { id: 'nol:1', provider: 'nol', title: '2026 비 (RAIN) CONCERT [THE SMOKE]', startDate: '2026-12-05', endDate: '2026-12-05', poster: null, url: 'n' },
  { id: 'yes24:1', provider: 'yes24', providerLabel: 'YES24 티켓', title: '[서울] 2026 비 (RAIN) CONCERT [THE SMOKE]', startDate: '2026-12-05', endDate: '2026-12-06', poster: 'p', url: 'y' },
  { id: 'yes24:2', provider: 'yes24', title: '2026 비 (RAIN) CONCERT [THE SMOKE]', startDate: '2026-12-20', url: 'z' },
]);
ok('예매처 간 같은 공연(제목·시작일)은 하나로, 다른 예매처는 alsoAt', merged.length === 2 && merged[0].alsoAt?.[0]?.url === 'y' && merged[0].poster === 'p' && merged[0].endDate === '2026-12-06', JSON.stringify(merged));
ok('시작일이 다르면 다른 공연', merged[1].id === 'yes24:2');

const byPlace = mergeVendors([
  { provider: 'eplus', title: 'キム・キュジョン', startDate: '2026-10-10', venue: 'I’M A SHOW', url: 'e' },
  { provider: 'ltike', providerLabel: 'ローチケ', title: 'KIM KYUJONG(キム・キュジョン)', startDate: '2026-10-10', venue: "I'M A SHOW", url: 'l' },
  { provider: 'eplus', title: 'KwangSoo', startDate: '2026-10-11', venue: '浅草花劇場', url: 'e2' },
  { provider: 'pia', title: '#39PROJECT Vol.4 KwangSoo ALBUM LIVE [39]', startDate: '2026-10-11', venue: '浅草花劇場', url: 'p2' },
  { provider: 'pia', title: 'Other Artist Live', startDate: '2026-10-11', venue: '浅草花劇場', url: 'p3' },
]);
ok('표기가 달라도 같은 날·같은 공연장·이름 토큰 공유면 한 공연(따옴표 차이 무시)', byPlace.length === 3 && byPlace[0].alsoAt?.[0]?.url === 'l' && byPlace[1].alsoAt?.[0]?.url === 'p2' && !byPlace[2].alsoAt, JSON.stringify(byPlace.map((x) => [x.title, x.alsoAt])));
ok('제목 앞 이름 반복만 정리(원래 제목인 반복은 유지)', collapseLead('PENTAGON PENTAGON 10th Anniversary Tour') === 'PENTAGON 10th Anniversary Tour' && collapseLead('Baby Baby Tour') === 'Baby Baby Tour' && collapseLead('xikers xikers Live', 'xikers') === 'xikers Live');

{
  const now = { items: [{ id: 'nol:1', provider: 'nol' }], sources: [{ provider: 'nol:concert', ok: true }, { provider: 'ticketlink:concert', ok: false, error: 'source timeout 90s' }] };
  const prev = [{ id: 'nol:1', provider: 'nol' }, { id: 'nol:9', provider: 'nol' }, { id: 'ticketlink:5', provider: 'ticketlink' }];
  const r = carryFailed(now, prev);
  ok('실패한 소스(티켓링크)만 직전 항목 유지, 성공한 소스(NOL)의 사라진 항목은 되살리지 않음', r.items.map((x) => x.id).join() === 'nol:1,ticketlink:5' && r.carried === 1, JSON.stringify(r.items));
  ok('모두 성공하면 그대로', carryFailed({ items: [], sources: [{ provider: 'nol:x', ok: true }] }, prev).items.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
