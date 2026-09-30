/* 한일 팬덤 방식(mechanic) 택소노미.

   라일락은 팔지 않고 '공식 판매처·응모·팬클럽으로 보내는' 서비스다.
   그러려면 한국과 일본의 구매·응모 구조가 다르다는 걸 화면이 알아야 한다.
     한국: 앨범 구매 수량 → 팬사인회 응모(추첨), 멤버십(위버스 등) → 선예매
     일본: FC 가입 → FC선행 추첨, 初回限定盤/通常盤, 店舗特典(판매처별 특전), 시리얼 응모

   여기 있는 것은 '방식'의 정의다. 실제 캠페인 인스턴스(어느 팀이 언제 어디서)는
   공개 API 가 없어 자동 수집이 안 된다 — releases[].campaign 에 사람이 확인해 넣고,
   각 캠페인은 여기 mechanic id 를 가리킨다.

   지어내지 않는다: 팀별 적용 여부는 국적·릴리스 유통국 같은 '가진 데이터'로만 판정하고,
   그 판정을 '일반적으로 해당' 수준으로만 표기한다. */

export const MECHANICS = [
  /* ── 한국 ── */
  { id: 'kr-album-lottery', country: 'kr', name: '앨범 구매 응모 (팬사인회·영상통화)',
    what: '지정 판매처에서 지정 기간에 앨범을 사면 구매 수량만큼 응모권이 생기고, 추첨으로 팬사인회(대면·영상통화) 참여자를 뽑습니다.',
    how: ['공식 X·위버스 공지에서 판매처와 기간을 확인', '해당 판매처에서 기간 내 구매 (판매처마다 응모 방식이 다름)', '추첨 결과는 판매처가 개별 통보'],
    links: ['x', 'weverse', 'official'], note: '해외 배송 주문은 응모 대상에서 빠지는 경우가 많습니다. 판매처 공지의 배송지 조건을 먼저 확인하세요.' },
  { id: 'kr-membership', country: 'kr', name: '공식 멤버십 · 팬클럽',
    what: '위버스 멤버십, 공식 팬카페 등급, 버블 등. 가입하면 선예매 자격, 독점 콘텐츠, 팬미팅 응모 자격이 생깁니다.',
    how: ['소속사가 쓰는 플랫폼(위버스·팬카페·버블) 확인', '가입 후 등급 조건(인증·가입 시점) 충족', '선예매·응모는 멤버십 회원 대상 공지로 진행'],
    links: ['weverse', 'official', 'fanpage'] },
  { id: 'kr-fanclub-presale', country: 'kr', name: '팬클럽 선예매',
    what: '콘서트 티켓을 일반 예매 전에 멤버십 회원에게 먼저 엽니다. 인터파크·멜론티켓·예스24 등에서 회원 인증 후 진행됩니다.',
    how: ['멤버십 가입(선예매 자격 등급)', '예매처에서 멤버십 인증', '선예매 → 일반예매 순'],
    links: ['weverse', 'official'] },
  { id: 'kr-official-goods', country: 'kr', name: '공식 굿즈 (소속사 공식몰)',
    what: '위버스샵, SM타운앤스토어, YG셀렉트, JYP샵 등 소속사 공식몰에서 판매합니다. 라일락은 링크만 안내합니다.',
    how: ['공식몰에서 해외 배송 가능 여부 확인', '한정·예약 상품은 판매 기간이 짧음'],
    links: ['weverse', 'official', 'shop'] },
  { id: 'kr-preorder-bonus', country: 'kr', name: '예약판매 특전',
    what: '예약 기간에 사면 포토카드·포스터 같은 특전이 붙고, 판매처마다 특전이 다릅니다.',
    how: ['공지에서 판매처별 특전 확인', '예약 기간 내 구매'],
    links: ['x', 'weverse'] },

  /* ── 일본 ── */
  { id: 'jp-fc', country: 'jp', name: '오피셜 팬클럽 (FC)',
    what: '연회비를 내고 가입하면 회보·FC선행 추첨·이벤트 응모 자격이 생깁니다. 일본 주소·결제수단이 필요한 경우가 대부분입니다.',
    how: ['공식 사이트의 FC 안내에서 가입 조건 확인', '연회비 결제 (일본 신용카드·편의점 결제 등)', '회원번호로 선행 응모'],
    links: ['official', 'fanpage'], note: '해외 거주자는 가입이 막히거나 대행이 필요한 경우가 많습니다. 라일락은 대행을 중개하지 않습니다.' },
  { id: 'jp-fc-presale', country: 'jp', name: 'FC 선행 추첨',
    what: '콘서트 티켓을 FC 회원 대상 추첨으로 먼저 엽니다. 당첨되면 결제하고, 이후 プレイガイド 선행(e+·ぴあ·ローチケ) → 일반발매 순으로 남은 표가 풀립니다.',
    how: ['FC 회원 → 선행 응모 기간에 신청', '추첨 결과 확인 후 기한 내 결제', '낙선 시 プレイガイド 선행·일반발매 도전'],
    links: ['official'] },
  { id: 'jp-first-press', country: 'jp', name: '初回限定盤 / 通常盤',
    what: '같은 음반이 초회한정반(DVD/BD·포토북·시리얼 동봉)과 통상반으로 나뉩니다. 초회반은 재생산이 없어 예약이 중요합니다.',
    how: ['사양별 동봉물 확인', '초회반은 예약 마감 전에 주문'],
    links: ['tower', 'hmv', 'amazonJp'] },
  { id: 'jp-store-bonus', country: 'jp', name: '店舗特典 (판매처별 특전)',
    what: '타워레코드·HMV·츠타야·아마존 등 판매처마다 특전(포스터·포토카드·클리어파일)이 다릅니다. 같은 음반이라도 어디서 사느냐가 다릅니다.',
    how: ['라일락 판매처 비교에서 사양 × 판매처 특전 확인', '원하는 특전이 있는 판매처에서 예약'],
    links: ['tower', 'hmv', 'amazonJp'], lilac: 'releases' },
  { id: 'jp-serial-event', country: 'jp', name: '시리얼 응모 이벤트 (握手会·お渡し会·オンライン)',
    what: '초회반 등에 동봉된 시리얼 코드로 악수회·お渡し会·온라인 대화회 등에 응모합니다. 일본 내 거주 제한이 흔합니다.',
    how: ['시리얼 동봉 사양 확인', '응모 사이트에서 기간 내 등록', '추첨 후 당첨 통보'],
    links: ['official'], note: '응모 페이지가 일본 전화번호·주소를 요구하는 경우가 많습니다.' },
  { id: 'jp-general-sale', country: 'jp', name: '一般発売',
    what: '선행이 끝난 뒤 남은 티켓을 선착순으로 팝니다. e+·ぴあ·ローソンチケット에서 진행됩니다.',
    how: ['일반발매 일시 확인', '선착순이라 시작 시각에 접속'],
    links: ['official'] },
];

export const MECHANIC_BY_ID = Object.fromEntries(MECHANICS.map((m) => [m.id, m]));

/** 소속사 → 멤버십·공식몰 플랫폼 (공개된 회사 단위 사실만) */
const OPERATOR_PLATFORMS = [
  { match: /hybe|belift|source music|pledis|bighit|ador|koz/i, membership: { name: 'Weverse', url: 'https://weverse.io' }, shop: { name: 'Weverse Shop', url: 'https://shop.weverse.io' } },
  { match: /sm entertainment/i, membership: { name: 'Weverse', url: 'https://weverse.io' }, shop: { name: 'SMTOWN &STORE', url: 'https://smtownandstore.com' } },
  { match: /yg entertainment/i, membership: { name: 'Weverse', url: 'https://weverse.io' }, shop: { name: 'YG SELECT', url: 'https://ygselect.com' } },
  { match: /jyp/i, membership: { name: 'JYP Fans (Bubble)', url: 'https://www.jype.com' }, shop: { name: 'JYP SHOP', url: 'https://www.jypshop.com' } },
  { match: /universal music japan|emi/i, shop: { name: 'UNIVERSAL MUSIC STORE', url: 'https://store.universal-music.co.jp' } },
  { match: /sony music/i, shop: { name: 'Sony Music Shop', url: 'https://www.sonymusicshop.jp' } },
];

/** 아티스트에 해당하는 방식 목록을 '가진 데이터'로 판정한다 */
export function mechanicsFor(artist, releases = []) {
  const mine = releases.filter((r) => r.artistId === artist.id);
  const jpRel = mine.some((r) => r.country === 'jp');
  const krRel = mine.some((r) => r.country === 'kr');
  const applies = new Set();
  if (artist.country === 'kr' || krRel) for (const m of MECHANICS) if (m.country === 'kr') applies.add(m.id);
  if (artist.country === 'jp' || jpRel) for (const m of MECHANICS) if (m.country === 'jp') applies.add(m.id);

  const basis = [];
  if (artist.country === 'kr') basis.push('한국 아티스트');
  if (artist.country === 'jp') basis.push('일본 아티스트');
  if (artist.country === 'kr' && jpRel) basis.push('일본 유통 릴리스 있음 → 일본 방식도 해당');
  if (artist.country === 'jp' && krRel) basis.push('한국 유통 릴리스 있음 → 한국 방식도 해당');

  const platform = OPERATOR_PLATFORMS.find((p) => p.match.test(artist.operator || '')) || null;

  return {
    artistId: artist.id,
    basis,
    platform: platform ? { membership: platform.membership || null, shop: platform.shop || null, source: `소속사(${artist.operator}) 기준 일반 사례` } : null,
    mechanics: MECHANICS.filter((m) => applies.has(m.id)).map((m) => ({
      ...m,
      // 이 팀에서 실제로 쓸 수 있는 링크만 붙인다
      resolvedLinks: m.links.map((k) => artist.links?.[k]?.url ? { key: k, url: artist.links[k].url } : null).filter(Boolean),
    })),
  };
}
