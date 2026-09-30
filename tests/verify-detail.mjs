/* 공연 상세 파서 — 예매처 상품 페이지 배치를 합성 HTML로 고정한다(네트워크 없음).
 * 실행: node tests/verify-detail.mjs */
import { concertDetail } from '../backend/lib/live/detail.mjs';
import { formatOf, stripTags } from '../backend/lib/live/goods.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name} ${detail}`); } };
const serve = (html) => { globalThis.fetch = async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }); };
const orig = globalThis.fetch;

// NOL: Next.js RSC 조각 안의 JSON
const rsc = JSON.stringify(`x:{"goodsDetail":{"goodsName":"TEST LIVE","placeName":"홍대 감마홀","viewRateName":"전체관람가","runningTime":"120","interMissionTime":"20","playStartDate":"2026-10-02","playEndDate":"2026-10-02","bookingOpenTime":"2026-09-04 20:00:00","bookingEndTime":"2026-10-01 17:00:59","bookingEndTimeName":"관람전일 17시까지","cancelableTimeName":"전일 17:00","deliveryFee":3700,"bizName":"자코레코드"},"deliveryMethodName":"현장수령무료(배송불가)","playTimeInfo":"관객 입장 : 18시 30분\\r\\n공연 시작 : 19시","bizInfo":"주최 : 자코레코드\\r\\n문의 : 010-0000-0000","globalTypeList":["EN","JP","CN"],"prices":{"all":[{"seatGradeName":"스탠딩","priceGradeName":"일반","salesPrice":77000,"priceType":"basic"},{"seatGradeName":"스탠딩","priceGradeName":"일반","salesPrice":77000,"priceType":"basic"}]}}`);
serve(`<html><body><script>self.__next_f.push([1,${rsc}])</script><a href="https://world.nol.com/en/ticket/places/1/products/2">For international users</a></body></html>`);
{
  const d = await concertDetail('nol', 'https://nol.yanolja.com/ticket/products/2');
  ok('NOL: 관람 시간·인터미션·등급', d.facts.runningMin === 120 && d.facts.intermissionMin === 20 && d.facts.age === '전체관람가', JSON.stringify(d.facts));
  ok('NOL: 오픈·마감 시각(+09:00)', d.booking.openAt === '2026-09-04T20:00:00+09:00' && d.booking.endAt === '2026-10-01T17:00:00+09:00', `${d.booking.openAt} ${d.booking.endAt}`);
  ok('NOL: 가격(중복 제거)', d.prices.length === 1 && d.prices[0].price === 77000 && d.prices[0].grade === '스탠딩', JSON.stringify(d.prices));
  ok('NOL: 외국인 예매 연결과 언어', d.booking.global?.url.startsWith('https://world.nol.com/') && d.booking.global.langs.includes('JP'));
  ok('NOL: 수령 방법·입장 시각·문의', d.booking.delivery[0] === '현장수령무료(배송불가)' && d.facts.times.length === 2 && d.facts.contact === '010-0000-0000', JSON.stringify([d.booking.delivery, d.facts.times, d.facts.contact]));
}

// 멜론티켓: 표 형태 HTML
serve(`<html><body><a href="https://tkglobal.melon.com/performance/index.htm?langCd=EN&amp;prodId=1" class="btn_global"><span>Foreigner / 外國人</span></a><ul><li>단독판매</li><li>인증예매</li></ul>
<dl><dt>공연기간</dt><dd>2026.10.03 - 2026.10.05</dd><dt>관람시간</dt><dd>120분</dd><dt>공연장</dt><dd>고려대학교 화정체육관</dd><dt>관람등급</dt><dd>8세 이상</dd></dl>
<div>가격정보</div><div>SR</div><div>154,000원</div><div>R</div><div>143,000원</div><div>예매 공지사항</div>
<div>티켓 수령 방법 안내</div><div>현장수령</div><p>- 예매확인서와 예매자의 실물 신분증을 제출</p><div>배송</div></body></html>`);
{
  const d = await concertDetail('melon', 'https://ticket.melon.com/performance/index.htm?prodId=1');
  ok('멜론: 가격 등급', d.prices.map((p) => `${p.grade}:${p.price}`).join(',') === 'SR:154000,R:143000', JSON.stringify(d.prices));
  ok('멜론: 인증예매·단독·외국인 연결', d.booking.identityBooking && d.booking.exclusive && /tkglobal\.melon\.com/.test(d.booking.global?.url || ''));
  ok('멜론: 수령 방법·신분증 문구', d.booking.delivery.join(',') === '현장수령,배송' && d.booking.idCheck, JSON.stringify(d.booking.delivery));
}

// e+: 회차와 접수 목록(추첨/선착, 기간, 상태)
serve(`<html><body><div>2026/10/3(土)</div><div>開演：18:00～</div><div>(開場 17:00～)</div><div>大阪城ホール</div>
<div>抽選 &lt;10/3公演&gt;プレオーダー受付</div><div>受付期間:2026/6/2(火)12:00～2026/6/21(日)23:59</div><div>受付終了</div>
<div>先着 ★&lt;10/3公演&gt;一般発売</div><div>受付期間:2026/8/29(土)10:00～2026/9/12(土)18:00</div><div>予定枚数終了</div></body></html>`);
{
  const d = await concertDetail('eplus', 'https://eplus.jp/sf/detail/1');
  ok('e+: 開場·開演·会場', d.shows[0]?.open === '17:00' && d.shows[0]?.start === '18:00' && d.shows[0]?.venue === '大阪城ホール', JSON.stringify(d.shows));
  ok('e+: 추첨/선착과 기간·상태', d.sales.length === 2 && d.sales[0].type === 'lottery' && d.sales[0].end === '2026-06-21T23:59:00+09:00' && d.sales[1].type === 'first' && d.sales[1].status === '予定枚数終了', JSON.stringify(d.sales));
}

// 티켓피아: 가격·결제·수령·일본 휴대폰 조건
serve(`<html><body><div>●電子チケットはインターネット接続が可能な090、080、070で始まる日本国内で契約している携帯電話番号を持った、スマートフォンをお持ちの方のみご利用いただけます。</div>
<div>2026/10/3( 土 )</div><div>18:00 開演 ( 17:00 開場 )</div><div>会場：大阪城ホール (大阪府)</div><div>指定席 8,900円</div><div>立見 7,900円 ※整理番号順</div>
<div>利用可能な決済方法</div><div>ぴあカード</div><div>クレジットカード</div><div>決済方法の詳細はヘルプをご覧ください。</div>
<div>利用可能な引取方法</div><div>電子チケットで発券</div><div>引取方法の詳細はヘルプをご覧ください。</div><div>システム利用料:</div><div>ご購入のチケット1枚につき</div><div>330円</div></body></html>`);
{
  const d = await concertDetail('pia', 'https://ticket.pia.jp/pia/ticketInformation.do?eventCd=1');
  ok('피아: 좌석 등급별 가격', d.prices.map((p) => `${p.grade}:${p.price}`).join(',') === '指定席:8900,立見:7900', JSON.stringify(d.prices));
  ok('피아: 결제·수령(안내 문구 제외)·시스템 이용료', d.booking.payments.join(',') === 'ぴあカード,クレジットカード' && d.booking.delivery.join(',') === '電子チケットで発券' && d.booking.systemFee === 330, JSON.stringify(d.booking));
  ok('피아: 전자 티켓 일본 휴대폰 조건', d.booking.jpPhone === true);
}

// 허용하지 않은 호스트는 가져오지 않는다
try { await concertDetail('nol', 'https://evil.example.com/x'); ok('허용 호스트만', false); } catch { ok('허용 호스트만', true); }

globalThis.fetch = orig;

/* 음반 형식 · 알라딘 머리표 */
ok('[2LP]·아날로그盤은 LP(CD 아님)', formatOf('[수입] Vaundy - replica [2LP]') === 'LP' && formatOf('ヨルシカ / 盗作 【アナログ盤】') === 'LP');
ok('CD+Blu-ray / CD+DVD', formatOf('ANTENNA (CD+Blu-ray)') === 'CD+Blu-ray' && formatOf('狂言 (初回限定盤 CD+DVD)') === 'CD+DVD');
ok('형식 표기 없으면 CD', formatOf('BTS - PROOF') === 'CD');
ok('알라딘 머리표 제거', stripTags('[수입] [LP] Ado - 狂言') === 'Ado - 狂言' && stripTags('Ado - 狂言') === 'Ado - 狂言');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
