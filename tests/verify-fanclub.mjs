/* 팬클럽 선행 파서 — 네트워크 없이 합성 HTML로 규칙을 고정한다.
 * 실제 공식 사이트에서 본 배치 세 가지(공연장 먼저 표 / 날짜 먼저 표 / 한 줄)와
 * 이번에 잡은 오류(판매 장소·중지 공지·다른 표의 공연장 끌어오기, 일반 선행을 팬클럽 선행으로 표시)를 재현한다.
 * 실행: node tests/verify-fanclub.mjs */
import { parseSalesPage, fanclubFacts, parseResidence, parseWeverseShop, _parseFactsForTest } from '../backend/lib/live/fanclub.mjs';
import { romanSimilar, koreanNameFits } from '../backend/lib/live/artist-info.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name} ${detail}`); } };
const page = (body, title = 'TOUR 2026') => `<html><head><title>${title}</title></head><body>${body}</body></html>`;
const now = new Date('2026-09-26T12:00:00+09:00');

// (다) 투어 특설 페이지: 지역 → 공연장 → 날짜들 → 문의처. 그 아래 티켓 섹션에 접수 기간.
const venueFirst = page(`
<div>Kagawa</div><div>あなぶきアリーナ香川</div><div>9.30 Wed</div><div>Open 17:00 / Start 18:00</div><div>10.1 Thu</div><div>Open 17:00 / Start 18:00</div><div>デューク高松</div><div>087-822-2520</div>
<div>Tokyo</div><div>国立代々木競技場 第一体育館</div><div>10.28 Wed</div><div>Open 17:00 / Start 18:00</div><div>SOGO TOKYO</div><div>03-3405-9999</div>
<div>TICKET</div><div>OFFICIAL FAN CLUB「Ringo Jam」全会員先行</div><div>受付期間</div><div>2026年9月24日(木)12:00 〜 2026年9月30日(水)5:00</div>
<div>申し込み条件</div><div>申込者・同行者ともにOFFICIAL FAN CLUB「Ringo Jam」の会員さま</div>
<div>グッズ販売</div><div>9月30日(水) 販売場所:あなぶきアリーナ香川 西側</div>`);
const a = parseSalesPage(venueFirst, 'https://example.jp/feature/tour', { fcName: 'Ringo Jam', now });
ok('공연장 먼저 표: 날짜마다 바로 위 공연장', a.shows.some((s) => s.date === '2026-09-30' && /あなぶき/.test(s.venue)) && a.shows.some((s) => s.date === '2026-10-28' && /代々木/.test(s.venue)), JSON.stringify(a.shows));
ok('공연장 먼저 표: 문의처·판매 장소를 공연으로 읽지 않음', !a.shows.some((s) => /販売|場所|SOGO|デューク/.test(s.venue)) && a.shows.length === 3, JSON.stringify(a.shows));
ok('영문 도(都)·현 제목으로 일본 판정', a.shows.every((s) => s.country === 'JP'));
const w = a.sales[0];
ok('팬클럽 전용·동행자 회원 조건', w && w.fcOnly && w.fcFirst && w.companion && !w.isPublic, JSON.stringify(w));
ok('접수 기간(+09:00)', w && w.start === '2026-09-24T12:00:00+09:00' && w.end === '2026-09-30T05:00:00+09:00', JSON.stringify(w));

// (나) 날짜 먼저 표 + 아시아 투어: 도시 제목 아래 날짜, 몇 줄 뒤 공연장. INFO 열 제목이 도시를 지우면 안 된다.
const dateFirst = page(`
<div>SEOUL</div><div>DATE</div><div>OPEN / START</div><div>VENUE</div><div>INFO</div>
<div>2026 11.21 sat</div><div>15:00 / 17:00</div><div>※現地時間</div><div>INSPIRE ARENA</div><div>NOL Ticket</div>
<div>TAIPEI</div><div>DATE</div><div>VENUE</div><div>INFO</div><div>2026 12.05 sat</div><div>18:00 / 19:00</div><div>Taipei Arena</div>
<div>FUKUOKA</div><div>2026 10.24 sat</div><div>16:00 / 17:00</div><div>北九州メッセ</div>
<div>「TOUR」上海公演中止のお知らせ</div><div>2026年11月14日(土)・15日(日)に開催を予定しておりました上海公演につきまして、中止させていただくこととなりました。</div>
<div>VAWS(海外在住)先行</div><div>受付期間</div><div>2026年9月20日(日)12:00 〜 2026年10月4日(日)23:59</div><div>申込条件</div><div>海外在住のVAWS会員</div>
<div>セブン‐イレブン抽選先行</div><div>受付期間</div><div>2026年10月5日(月)12:00 〜 2026年10月18日(日)23:59</div><div>申込条件</div><div>どなたでもお申し込みが可能</div>`);
const b = parseSalesPage(dateFirst, 'https://example.jp/feature/asia', { fcName: 'VAWS', now });
const byDate = Object.fromEntries(b.shows.map((s) => [s.date, s]));
ok('날짜 먼저 표: 서울 공연은 KR', byDate['2026-11-21']?.country === 'KR' && /INSPIRE/.test(byDate['2026-11-21']?.venue || ''), JSON.stringify(b.shows));
ok('타이베이는 TW, 후쿠오카는 JP', byDate['2026-12-05']?.country === 'TW' && byDate['2026-10-24']?.country === 'JP', JSON.stringify(b.shows));
ok('중지 공지 문장을 공연으로 읽지 않음', !b.shows.some((s) => s.date === '2026-11-14'), JSON.stringify(b.shows));
const ovs = b.sales.find((x) => /海外在住/.test(x.label));
const pub = b.sales.find((x) => /セブン/.test(x.label));
ok('해외 거주자 선행은 팬클럽 선행 + 해외 가능', ovs && ovs.fcFirst && ovs.overseas && !ovs.isPublic, JSON.stringify(ovs));
ok('누구나 신청 가능한 선행은 팬클럽 선행이 아님', pub && pub.isPublic && !pub.fcFirst && !pub.fcOnly, JSON.stringify(pub));

// (가) 한 줄: 날짜 + 도·현・공연장
const oneLine = page(`<div>▼対象公演</div><div>10月28日(水) 東京都・国立代々木競技場 第一体育館</div><div>11月4日(水) 佐賀県・SAGAアリーナ</div>`);
const c = parseSalesPage(oneLine, 'https://example.jp/news/1', { now });
ok('한 줄 배치: 도·현 접두어를 떼고 일본 판정', c.shows.length === 2 && c.shows[0].venue.startsWith('国立代々木') && c.shows.every((s) => s.country === 'JP'), JSON.stringify(c.shows));

// 가입 정보: 없는 값은 null (추정하지 않는다)
const factsHtml = page(`<h1>OFFICIAL FAN CLUB「Test Club」</h1><div>年会費 5,500円(税込)</div><div>お支払い方法</div><div>クレジットカード決済</div>`, 'Test Club｜入会案内');
const origFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(factsHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
try {
  const f = await fanclubFacts('https://example.jp/feature/entry');
  ok('연회비 추출', f.fees?.annual === 5500, JSON.stringify(f.fees));
  ok('없는 값은 null(월회비·해외 요금)', f.fees?.monthly == null && f.fees?.overseasAnnual == null, JSON.stringify(f.fees));
  ok('해외 가입 여부를 모르면 unknown', f.overseas === 'unknown', f.overseas);
} catch (e) {
  ok('fanclubFacts 오프라인 실행', false, String(e));
} finally {
  globalThis.fetch = origFetch;
}

// 요금 표기 변형: 실제 공식 페이지에서 본 배치들
const feeCases = [
  ['기간 슬래시(코스 이름이 월회비여도 12개월이면 연)', '<div>月会費まとめ払いコース</div><div>会費6,600円（税込）／12ヶ月</div><div>月会費コース</div><div>550円（税込）／1ヶ月</div>', { annual: 6600, monthly: 550 }],
  ['괄호 기간', '<p>年額プラン 会費：550円 （1ヶ月・税込） 会費：6,600円 （12ヶ月・税込）</p>', { annual: 6600, monthly: 550 }],
  ['태그 사이 줄바꿈(원문 줄바꿈은 공백)', '<p class="price">\n 4,840\n <span class="unit">円</span>\n</p>\n<p>(税込)／年 (12か月)</p><p>月会費コース 440 円 (税込)／月</p>', { annual: 4840, monthly: 440 }],
  ['다른 수수료가 줄 끝에 있어도 월회비로 오해하지 않음', '<div>※コンビニ決済手数料275円（税込）</div><div>月会費コース</div><div>月会費 550 円 （税込）</div>', { monthly: 550 }],
  ['무료 회원', '<div>無料会員：0円（税込）</div>', { free: true }],
];
for (const [label, body, want] of feeCases) {
  globalThis.fetch = async () => new Response(page(body, 'FC｜入会案内'), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  try {
    const f = await fanclubFacts('https://example.jp/feature/entry');
    const got = Object.fromEntries(Object.keys(want).map((k) => [k, f.fees?.[k]]));
    ok(`요금: ${label}`, Object.entries(want).every(([k, v]) => got[k] === v), JSON.stringify(f.fees));
  } catch (e) { ok(`요금: ${label}`, false, String(e)); }
}
globalThis.fetch = origFetch;

// 다른 팬클럽 이름을 나열한 공통 ID 안내 페이지에서 엉뚱한 이름을 고르지 않는다
globalThis.fetch = async () => new Response(page('<ul><li>超特急オフィシャルファンクラブ「夢の青春8きっぷ」に登録している方</li><li>オフィシャルファンクラブ「SUPER」に登録している方</li></ul>', 'IDサービスの案内'), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
try { const f = await fanclubFacts('https://example.jp/feature/entry'); ok('여러 팬클럽이 나열된 페이지에서는 이름을 비운다', f.name === null, String(f.name)); } catch (e) { ok('이름 고르기', false, String(e)); }
globalThis.fetch = origFetch;

/* 거주지별 코스 (PLUS MEMBER 입회 페이지 두 가지 서식) */
{
  const rj = '※【日本以外にお住まいの方】で「特典の発送をご希望の方」への発送は2か月 ¶ 日本にお住まいの方 ¶ 年会費コース ¶ 入会金 ¶ 0 ¶ 円 ¶ 月会費コースより ¶ 1か月分お得! ¶ 年会費 ¶ 6,050 ¶ 円 ¶ （税込） ¶ お支払い方法 ¶ ・クレジットカード決済 ¶ ・コンビニ決済 ¶ ※自動継続 ¶ 月会費コース ¶ 月会費 ¶ 550 ¶ 円 ¶ お支払い方法 ¶ ・クレジットカード決済 ¶ ・d払い ¶ 日本以外にお住まいの方 ¶ 年会費コース ¶ 特典の発送をご希望の方 ¶ 7,150 ¶ 円 ¶ ※6,050円(税込) ＋ 海外配送料 1,100円(税込) ¶ 特典の発送が不要な方 ¶ 6,050 ¶ 円 ¶ お支払い方法 ¶ ・クレジットカード決済 ¶ ※デビットカードは動作保証外です。 ¶ 注意事項 ¶ ・日本にお住まいの方が誤って【日本以外にお住まいの方】としてご入会された場合、退会いただかないとコース変更を行うことができません。';
  const r = parseResidence(rj);
  ok('해외 코스: 특전 발송 없음 6,050엔 · 있음 7,150엔 · 배송료 1,100엔', r?.overseas.annual?.v === 6050 && r.overseas.annualShip?.v === 7150 && r.overseas.shipFee?.v === 1100, JSON.stringify(r?.overseas));
  ok('문장 속 【日本以外にお住まいの方】で… 언급은 코스 머리로 안 본다', r?.jp?.annual?.v === 6050 && r.jp.monthly?.v === 550, JSON.stringify(r?.jp));
  ok('해외 결제는 신용카드만, 체크카드 동작 보장 안 됨', r?.overseas.payments.join() === 'クレジットカード決済' && r.overseas.debitNg === true && r.jp.payments.includes('d払い'), JSON.stringify(r?.overseas.payments));
  ok('거주지 코스를 잘못 고르면 변경 불가 경고', r?.residenceLocked === true);
  const ini = '▼日本にお住まいの方 ¶ 01 ¶ 月会費まとめて払いコース ¶ 新規入会 ¶ 会費6,600円（税込）／12ヶ月 ¶ お支払い方法 ¶ クレジットカード決済／コンビニ払い／d払いに対応 ¶ 02 ¶ 月会費コース ¶ 550円（税込）／1ヶ月 ¶ 日本以外にお住まいの方 ¶ 01 ¶ 月会費まとめて払いコース ¶ 新規入会 ¶ 60 USD(tax-exclusive)／12ヶ月 ¶ お支払い方法 ¶ クレジットカード決済 ¶ 02 ¶ 月会費コース ¶ 新規入会 ¶ 5 USD(tax-exclusive)／1ヶ月';
  const r2 = parseResidence(ini);
  ok('「月会費まとめて払い … ／12ヶ月」는 연회비, 달러 표기', r2?.jp?.annual?.v === 6600 && r2.overseas.annual?.v === 60 && r2.overseas.annual.cur === 'USD' && r2.overseas.monthly?.v === 5, JSON.stringify(r2));
  ok('거주지 구분이 없는 페이지는 null', parseResidence('年会費 ¶ 5,500円 ¶ お支払い方法 ¶ クレジットカード') === null);
}

/* 연도 없는 공연일 — 페이지 제목의 연도, 없으면 지난 날짜는 다음 해 */
{
  const html = '<title>【2027】SPITZ JAMBOREE TOUR 2027 | SPITZ</title><body><p>3月6日(土) 横浜アリーナ</p><p>3月7日(日) 横浜アリーナ</p></body>';
  const r = parseSalesPage(html, 'https://spitz-web.com/live/202701/', { now: new Date('2026-09-27T12:00:00+09:00') });
  ok('제목에 2027이 있으면 연도 없는 3/6은 2027-03-06', r.shows?.[0]?.date === '2027-03-06', JSON.stringify(r.shows));
  const r2 = parseSalesPage('<title>LIVE</title><body><h1>SCHEDULE</h1><p>3月6日(土) 横浜アリーナ</p><p>10月12日(月) 日本武道館</p></body>', 'https://example.jp/live/', { now: new Date('2026-09-27T12:00:00+09:00') });
  ok('연도 힌트가 없으면 지난 3/6은 다음 해, 다가오는 10/12는 올해', r2.shows?.find((x) => x.venue.includes('横浜'))?.date === '2027-03-06' && r2.shows?.find((x) => x.venue.includes('武道館'))?.date === '2026-10-12', JSON.stringify(r2.shows));
}

/* Weverse Shop 멤버십 — 서버가 실어 보내는 상품 카드에서 멤버십만 */
{
  const data = { props: { pageProps: { $dehydratedState: { queries: [{ state: { data: { productCards: [
    { saleId: 1, name: 'GLLIT MEMBERSHIP (JP)', price: { originalPrice: 6500, salePrice: 6500 }, status: 'SALE', thumbnailImageUrl: 'https://cdn/x.png' },
    { saleId: 2, name: 'ILLIT HOODIE', price: { salePrice: 9900 }, status: 'SALE' },
  ] } } }] } } } };
  const html = '<html><script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(data) + '</script></html>';
  const r = parseWeverseShop(html, 'https://shop.weverse.io/ja/shop/JPY/artists/120/categories/4583');
  ok('Weverse Shop: 멤버십 상품만, 판매가·상품 주소', r.length === 1 && r[0].price === 6500 && r[0].url === 'https://shop.weverse.io/ja/shop/JPY/artists/120/sales/1', JSON.stringify(r));
  ok('Weverse Shop: 데이터가 없으면 빈 목록', parseWeverseShop('<html></html>', 'https://shop.weverse.io/').length === 0);
}

{
  /* FAMILY CLUB 상세 안내(/join/detail/f/XX) — Node fetch는 403(봇 차단), HTTP/2 브라우저 방식 요청으로 받은 화면 구조 */
  const fam = `<html><head><title>SixTONES 新規入会｜FAMILY CLUB</title></head><body><h2>会費</h2><dl><dt>入会金</dt><dd>1,000円</dd><dt>年会費</dt><dd>4,000円</dd><dt>会員資格有効期間</dt><dd>当社が入会を承認した日の翌月1日から1年間</dd></dl><p>別途事務手数料140円が必要となります。</p><h3>STEP 4 お支払い手続き</h3><p>お支払い方法はクレジットカード・Pay-easy・コンビニ支払いより、お選びいただけます。</p><ul><li>Pay-easy(ペイジー)</li><li>クレジットカード</li><li>コンビニ支払い</li><li>お支払い期限</li><li>お支払い手続きガイド</li></ul></body></html>`;
  const f = _parseFactsForTest(fam, 'https://www.familyclub.jp/join/detail/f/ST');
  ok('FAMILY CLUB: 입회금·연회비·사무 수수료', f.fees.annual === 4000 && f.fees.joinFee === 1000 && f.fees.handlingFee === 140, JSON.stringify(f.fees));
  ok('FAMILY CLUB: 회원 기간', /翌月1日から1年間/.test(f.period || ''), f.period);
  ok('결제 수단에 "お支払い期限·手続きガイド" 같은 안내 문구가 섞이지 않고 중복 없음', f.payments.includes('クレジットカード') && !f.payments.some((x) => /期限|ガイド/.test(x)) && f.payments.filter((x) => /Pay-easy/.test(x)).length === 1, f.payments.join('|'));
}
{
  /* 월정액 사이트의 연간 결제(CLUB GNU): "12ヵ月まとめ払い 5,280円(税込)" 는 연회비 */
  const gnu = '<html><head><title>King Gnuオフィシャルファンクラブ「CLUB GNU」</title></head><body><h3>料金</h3><dl><dt>年額会員</dt><dd>料金 12ヵ月まとめ払い 5,280円(税込)</dd><dt>決済方法</dt><dd>・クレジットカード決済 ・コンビニ・銀行振込(Pay-easy)</dd><dt>月額会員</dt><dd>料金 440円(税込)</dd></dl></body></html>';
  const g = _parseFactsForTest(gnu, 'https://clubgnu.com/s/n90/page/about');
  ok('CLUB GNU: 12개월 일괄 결제 5,280엔을 연회비로', g.fees.annual === 5280, JSON.stringify(g.fees));
  ok('CLUB GNU: 팬클럽 이름은 제목의 「」', g.name === 'CLUB GNU', g.name);
  /* BMSG(BE:FIRST「BESTY」): 상점 도메인의 팬클럽 안내 화면, 해외 거주자 가입 가능 문구 */
  const besty = '<html><head><title>BE:FIRST Official Fan Club「BESTY」 – BMSG</title></head><body><p>ファンクラブに入会 年会費 6,000 円</p><p>決済方法 クレジットカード コンビニ決済</p><p>※ 海外在住の方が入会する場合は、為替レートにより会費が変動します。</p></body></html>';
  const b = _parseFactsForTest(besty, 'https://bmsg.shop/pages/befirst-fc-members');
  ok('BESTY: 연회비 6,000엔 · 해외 거주자 가입 가능 · 이름', b.fees.annual === 6000 && b.overseas === 'yes' && b.name === 'BESTY', JSON.stringify({ fees: b.fees.annual, ov: b.overseas, name: b.name }));
}
{
  /* Weverse Shop 멤버십: 세금 별도 표시(isTaxIncluded=false)와 이미지 배열(thumbnailImageUrls) */
  const nd = { props: { pageProps: { list: [{ saleId: 54601, name: 'JENNIE MEMBERSHIP', status: 'SALE', thumbnailImageUrls: ['https://cdn-contents.weverseshop.io/x.png'], price: { originalPrice: 3102, salePrice: 3102, isTaxIncluded: false } }, { saleId: 54605, name: 'JENNIE MEMBERSHIP KIT', status: 'SOLD_OUT', price: { salePrice: 3723 } }] } } };
  const html = '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(nd) + '</script>';
  const items = parseWeverseShop(html, 'https://shop.weverse.io/ja/shop/JPY/artists/209/categories/4622');
  ok('Weverse Shop: 세금 별도·이미지 배열·키트 구분', items.length === 2 && items[0].taxIncluded === false && items[0].image === 'https://cdn-contents.weverseshop.io/x.png' && items[0].price === 3102, JSON.stringify(items[0]));
}
{
  /* 로스터 신원 확인: 한글 이름과 Apple 로마자 표기 비교(위키백과 영어 이름이 없을 때만 쓰는 보조 규칙) */
  ok('로마자 비교: 헤이즈 ↔ Heize, 한요한 ↔ Han Yo Han, 임영웅 ↔ Lim Young Woong', romanSimilar('헤이즈', 'Heize') && romanSimilar('한요한', 'Han Yo Han') && romanSimilar('임영웅', 'Lim Young Woong'));
  ok('로마자 비교: 로제 ≠ Pascal Rogé, 제니 ≠ Gavy NJ, 양홍원 ≠ Leellamarz', !romanSimilar('로제', 'Pascal Rogé') && !romanSimilar('제니', 'Gavy NJ') && !romanSimilar('양홍원', 'Leellamarz'));
}

{
  /* 위키백과 한국어 표기 검증: 소리가 안 맞는 표기는 버리고, 낱말 순서만 다른 표기는 인정 */
  ok('한국어 표기: SixTONES ≠ 스톤즈, SKE48 ≠ 에스케이이포티에이트', !koreanNameFits('스톤즈', ['SixTONES']) && !koreanNameFits('에스케이이포티에이트', ['SKE48']));
  ok('한국어 표기: 요네즈 켄시 ↔ Kenshi Yonezu, 사카낙션 ↔ sakanaction', koreanNameFits('요네즈 켄시', ['Kenshi Yonezu']) && koreanNameFits('사카낙션', ['sakanaction']));
}

{
  /* 회원 규약에만 회비가 있는 팬클럽(V.I.P (JP)): "第9条（会費等）… 会費 5,200円" + "会員とは、日本に居住する者" */
  const kiyaku = '<html><head><title>BIGBANG/V.I.P (JP)</title></head><body><p>第5条（会員） 本規約における会員とは、日本に居住する者で、当会への入会申込を行い、本規約所定の会費を納入の上、当社が入会を承認した者をいいます。</p><p>第9条（会費等） 1.当会の会費は次条で定める有効期間に対し、以下の通りとします。 会費 5,200円（税込）</p><p>当該会員が当該事由の生じた契約年度に支払った年会費を限度とします。</p></body></html>';
  const k = _parseFactsForTest(kiyaku, 'https://vip.fc.avex.jp/agree/memberKiyaku/');
  ok('회원 규약: 회비 5,200엔 · 일본 거주자만', k.fees.annual === 5200 && k.overseas === 'no', JSON.stringify({ a: k.fees.annual, ov: k.overseas }));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
