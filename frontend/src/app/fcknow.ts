/* 팬클럽 가입 지식 — "해외에서 가입되나, 한국 카드가 되나, 일본 번호가 있어야 하나"
 *
 * 세 층으로 답한다.
 *  1) 이 팬클럽이 직접 쓴 문장(백엔드 fc-evidence: 가입 안내·FAQ·규약에서 주제별 원문)
 *  2) 같은 플랫폼 공통 규칙(PLUS MEMBER, FAMILY CLUB, TOBE, BMSG, Weverse …) — 공식 도움말·FAQ에서 확인한 것
 *  3) 한국에서 결제·가입할 때 공통 준비물(카드사·행정안전부·예매처 공식 안내)
 * 원문이 없으면 "안내 없음"이라고 쓰고, 우리가 어떤 페이지를 읽었는지 밝힌다. 추측으로 채우지 않는다.
 * 확인: 2026-09-29 */
import { esc, icon, money } from './ui';
import { getLocale } from './i18n';
import { safeExternal } from './pages/_safety';

export const KNOW_CHECKED = '2026-09-29';

export interface EvItem { quote: string; url: string; q?: string }
export type Evidence = Record<string, EvItem[]>;
export interface Verdict {
  overseas: 'yes' | 'no' | 'limited' | null; phoneJp: true | null; sms: true | null; overseasCard: true | null; debitNg: true | null;
  threeDS: true | null; autoRenew: boolean | null; digitalCard: true | null; shipOverseasNo: true | null; noProxy: true | null; noResale: true | null; realName: true | null;
}
export interface Src { ko: string; ja: string; url: string }
interface PFact { ko: string; ja: string; src: Src }

const S = {
  bnOvs: { ko: 'back number FAQ: 해외 거주자 입회', ja: 'back number FAQ: 海外在住の入会', url: 'https://backnumber.info/faq/detail/182' },
  sakaEn: { ko: 'サカナクション NF member 입회 안내(영문)', ja: 'サカナクション NF member 入会案内(英語)', url: 'https://sakanaction.jp/feature/entry?lang=en' },
  pmStore: { ko: 'PLUS MEMBER 공식 스토어 FAQ', ja: 'PLUS MEMBER 公式ストア FAQ', url: 'https://store.plusmember.jp/nxt_mkt/user_data/faq.php' },
  tixGuide: { ko: 'チケプラ 전자티켓 앱 이용 안내', ja: 'チケプラ 電子チケットアプリ ガイド', url: 'https://tixplus.jp/feature/eticketapp/guide.html' },
  tixFaq: { ko: 'チケプラ FAQ(영문)', ja: 'チケプラ FAQ(英語)', url: 'https://tixplus.jp/feature/emtg_faq/faq_en.html' },
  famRule: { ko: 'FAMILY CLUB 회원 규약', ja: 'FAMILY CLUB 会員規約', url: 'https://www.familyclub.jp/page/fc_Agree' },
  famFaq: { ko: 'FAMILY CLUB FAQ: 해외 주소', ja: 'FAMILY CLUB FAQ: 海外住所', url: 'https://contact.fc-member.familyclub.jp/s/fcinq/faq/15319242459929?ima=0000&link=ROBO004' },
  tobeOvs: { ko: 'TOBE FAQ: 해외에서 가입', ja: 'TOBE FAQ: 海外からの入会', url: 'https://faq.tobe-community.jp/%E6%B5%B7%E5%A4%96%E3%81%AB%E4%BD%8F%E3%82%93%E3%81%A7%E3%81%84%E3%81%A6%E3%82%82%E3%83%95%E3%82%A1%E3%83%B3%E3%82%AF%E3%83%A9%E3%83%96%E3%81%AB%E5%85%A5%E4%BC%9A%E3%81%A7%E3%81%8D%E3%81%BE%E3%81%99%E3%81%8B%EF%BC%9F-64753a30ebaf56001b544528' },
  tobePay: { ko: 'TOBE FAQ: 결제 수단 변경', ja: 'TOBE FAQ: 支払方法の変更', url: 'https://faq.tobe-community.jp/%E3%83%95%E3%82%A1%E3%83%B3%E3%82%AF%E3%83%A9%E3%83%96%E3%81%B8%E3%81%AE%E4%BC%9A%E5%93%A1%E7%99%BB%E9%8C%B2%E3%82%92%E7%94%B3%E3%81%97%E8%BE%BC%E3%82%93%E3%81%A0%E5%BE%8C%E3%81%A7%E3%82%82%E3%80%81%E5%85%A5%E4%BC%9A%E9%87%91%E3%81%AE%E6%94%AF%E6%89%95%E6%96%B9%E6%B3%95%E3%82%92%E5%A4%89%E6%9B%B4%E3%81%A7%E3%81%8D%E3%81%BE%E3%81%99%E3%81%8B%EF%BC%9F-64753a31ebaf56001b544555' },
  tobeAcc: { ko: 'Number_i 팬클럽 입회 안내', ja: 'Number_i ファンクラブ 入会案内', url: 'https://tobe-community.jp/fc/number_i/account?auto_welcome=true' },
  bmsg: { ko: 'BE:FIRST 팬클럽 안내(BMSG)', ja: 'BE:FIRST ファンクラブ案内(BMSG)', url: 'https://bmsg.shop/pages/befirst-fc-members' },
  wvCampaign: { ko: 'aespa 「MY-J」 입회 안내(Weverse)', ja: 'aespa「MY-J」入会案内(Weverse)', url: 'https://campaigns.weverse.io/WS266SX9B4' },
  wvPay: { ko: 'Weverse 고객센터: 결제 수단', ja: 'Weverse ヘルプ: 決済手段', url: 'https://help.weverse.io/weverse/article?faq-id=000005482' },
  wvAuto: { ko: '위버스샵 공지: 멤버십 자동 결제', ja: 'Weverse Shop お知らせ: 自動決済', url: 'https://shop.weverse.io/ko/notices/14202' },
  wvAutoJa: { ko: '위버스샵 공지(일본어): 자동 결제·결제 통화', ja: 'Weverse Shop お知らせ: 自動決済', url: 'https://shop.weverse.io/ja/notices/14202' },
  wvMulti: { ko: 'Weverse 공지: 국가 샵별 멤버십', ja: 'Weverse お知らせ: 国別ショップのメンバーシップ', url: 'https://weverse.io/notice/17793?hl=ko' },
  shinhanBlock: { ko: '신한카드: 해외 결제 차단 해제', ja: '新韓カード: 海外決済ブロック解除', url: 'https://www.shinhancard.com/pconts/html/helpdesk/guide/CONFM90017/CONFM90017R04.html' },
  shinhanFee: { ko: '신한카드: 해외 이용 수수료', ja: '新韓カード: 海外利用手数料', url: 'https://www.shinhancard.com/pconts/html/helpdesk/guide/CONFM90017/CONFM90017R02.html' },
  kb3ds: { ko: 'KB국민카드: 해외안심결제(3D Secure) FAQ', ja: 'KB国民カード: 3Dセキュア FAQ', url: 'https://mapps.kbcard.com/SVC/DVIEW/MSDMCXHIASVCD0032' },
  kbDecline: { ko: 'KB국민카드: 해외 온라인 결제 승인 거절 사유', ja: 'KB国民カード: 海外オンライン決済の承認拒否', url: 'https://m.kbcard.com/SVC/DVIEW/MSDMCXHIASVCD0028?mainCC=a' },
  samsungAddr: { ko: '삼성카드: 해외 온라인 거래 영문 주소 등록', ja: 'サムスンカード: 英文住所の登録', url: 'https://www.samsungcard.com/personal/customer-service/overseas/e-commerce/UHPPCC0374M0.jsp' },
  dcc: { ko: 'iM뱅크: 해외 원화결제(DCC) 안내', ja: 'iMバンク: DCC案内', url: 'https://www.imbank.co.kr/cms/fnm/card/sda_15/sda_151/sda_1517/1210701_4541.html' },
  jcb: { ko: 'JCB: J/Secure', ja: 'JCB: J/Secure', url: 'https://www.global.jcb/en/products/security/jsecure/index.html' },
  juso: { ko: '주소정보누리집(행정안전부)', ja: '住所情報ヌリジプ(韓国 行政安全部)', url: 'https://www.juso.go.kr' },
  furigana: { ko: '일본 법무성: 이름의 フリガナ', ja: '法務省: 氏名のフリガナ', url: 'https://www.moj.go.jp/MINJI/furigana/index.html' },
  eplusOvs: { ko: 'e+ FAQ: 해외 거주자 신청', ja: 'e+ FAQ: 海外在住の申込', url: 'https://support-qa.eplus.jp/hc/ja/articles/360041176854' },
  eplusTickets: { ko: 'eplus.tickets FAQ', ja: 'eplus.tickets FAQ', url: 'https://support-qa.eplus.tickets/hc/en-us/articles/33332437839641-I-m-Japanese-but-can-I-purchase-ticket-in-your-site' },
  piaTel: { ko: '티켓피아: 전화번호 인증', ja: 'チケットぴあ: 電話番号認証', url: 'https://t.pia.jp/guide/tel-auth.jsp' },
  bunka: { ko: '일본 문화청: 티켓 부정전매 금지법 Q&A', ja: '文化庁: チケット不正転売禁止法 Q&A', url: 'https://www.bunka.go.jp/seisaku/bunka_gyosei/ticket_resale_ban/pdf/ticket-resale-qa-customer.pdf' },
} satisfies Record<string, Src>;

/* 플랫폼 공통 규칙 — 팬클럽 개별 안내가 없을 때 쓴다. 주제별로 하나 */
export type PlatKey = 'PLUS MEMBER' | 'FAMILY CLUB' | 'TOBE' | 'BMSG' | 'Weverse' | 'Sony Music Solutions' | 'SKIYAKI';
interface PlatKnow { about: { ko: string; ja: string }; overseas?: PFact & { v: 'yes' | 'no' | 'depends' }; pay?: PFact[]; phone?: PFact[]; card?: PFact[]; other?: PFact[] }

export const PLATFORM_KNOW: Partial<Record<PlatKey, PlatKnow>> = {
  'PLUS MEMBER': {
    about: { ko: '여러 일본 아티스트 팬클럽이 함께 쓰는 회원 시스템입니다. 계정(Plus member ID)은 티켓 앱 チケプラ와 같은 ID라서 한 번 만들면 다른 팬클럽에도 씁니다.', ja: '複数のアーティストが共通で使う会員システム。Plus member ID はチケプラと共通です。' },
    overseas: { v: 'depends', ko: '해외 가입 여부는 팬클럽마다 다릅니다. 해외 가입을 받는 팬클럽은 회원 정보 화면에서 고를 수 있는 나라에 사는 사람만 받습니다.', ja: '海外入会の可否はファンクラブごとに異なります。会員情報登録画面で選べる国にお住まいの方のみ入会できます。', src: S.bnOvs },
    pay: [
      { ko: '카드 결제에는 3D Secure(본인 인증)가 필요합니다. 3D Secure에 대응하지 않는 카드는 "이 카드는 3D 세큐어에 대응하지 않아 쓸 수 없다"는 오류가 납니다.', ja: 'クレジットカードは3Dセキュア(本人認証サービス)に対応している必要があります。', src: S.pmStore },
      { ko: 'VISA·Mastercard·JCB·Diners·AMEX 로고가 있어도 체크카드·선불카드는 거절될 수 있습니다.', ja: 'デビット・プリペイドカードは対応ブランドでも利用できない場合があります。', src: S.pmStore },
    ],
    phone: [
      { ko: '전자티켓 앱 チケプラ는 로그인할 때 휴대폰 번호로 SMS 인증번호를 받습니다. 가족·친구 번호로 인증하면 티켓을 받을 수 없습니다.', ja: 'チケプラアプリはSMS認証が必要。家族や友人の番号で認証するとチケットを受け取れません。', src: S.tixGuide },
      { ko: 'SMS가 안 오면 휴대폰 설정에서 "모르는 번호·해외 번호 문자 차단"을 풀라고 안내합니다. 한국 번호를 막는다는 문구는 없습니다.', ja: 'SMSが届かない場合は、不明・海外番号からのSMSを拒否していないか確認するよう案内されています。', src: S.tixFaq },
    ],
    other: [
      { ko: '예전에 일본 거주로 만든 Plus member ID는 해외로 바꿀 수 없습니다. 다른 메일 주소로 새 ID를 만들어야 합니다.', ja: '日本在住で登録したIDは海外に変更できません。別のメールアドレスで新規登録が必要です。', src: S.sakaEn },
      { ko: '전자티켓 앱에 표시되는 이름은 한 번 등록하면 스스로 바꿀 수 없습니다. 여권과 같은 이름으로 넣으세요.', ja: '登録した氏名は自分で変更できません。', src: S.tixFaq },
      { ko: 'チケプラ의 유료 "프리미엄 회원"은 일본 거주자 전용입니다. 팬클럽 가입과는 다른 서비스라 가입하지 않아도 됩니다.', ja: 'チケプラの有料プレミアム会員は日本在住者のみ。ファンクラブ入会とは別サービスです。', src: S.tixFaq },
      { ko: '공식 굿즈샵은 일본 국내 배송만 하고, 해외로 받으려면 배송대행 서비스를 쓰라고 안내합니다.', ja: '公式ストアは国内配送のみ。海外へは転送サービスの利用が案内されています。', src: S.pmStore },
    ],
  },
  'FAMILY CLUB': {
    about: { ko: 'STARTO ENTERTAINMENT 소속 아티스트(SixTONES, Snow Man 등)의 팬클럽 시스템입니다.', ja: 'STARTO ENTERTAINMENT所属アーティストのファンクラブ。' },
    overseas: { v: 'no', ko: '회원 규약이 "일본 국내에 거주하고 국내 우편으로 받을 수 있는 주소(법인·주소 대행 서비스 주소 제외)"를 회원 조건으로 둡니다. FAQ도 해외 주소로는 가입할 수 없다고 답합니다. 배송대행지 주소도 조건에 맞지 않습니다.', ja: '会員規約で「日本国内に居住し、国内郵便で配達可能な住所(法人・住所サービス不可)」が条件です。', src: S.famRule },
    other: [{ ko: 'FAQ: 해외 주소로는 가입할 수 없습니다.', ja: 'FAQ: 海外住所では入会できません。', src: S.famFaq }],
  },
  TOBE: {
    about: { ko: 'TOBE 소속 아티스트(Number_i 등)의 팬클럽입니다. 무료 공통 계정 TOBE ID를 먼저 만듭니다.', ja: 'TOBE所属アーティストのファンクラブ。まず無料のTOBE IDを作成します。' },
    overseas: { v: 'yes', ko: '70개 이상 나라에서 가입할 수 있고, TOBE ID를 만들 때 거주 국가를 일본 외로 고르면 됩니다.', ja: '70以上の国・地域から入会でき、TOBE ID登録時に居住国を選びます。', src: S.tobeOvs },
    pay: [{ ko: '가입 신청 뒤에는 결제 수단을 바꿀 수 없습니다(카드는 즉시 결제). 바꾸려면 처음부터 다시 신청해야 합니다.', ja: '申込後は支払方法を変更できません。', src: S.tobePay }],
    card: [{ ko: '회원증은 디지털로만 나옵니다. 실물 카드 발송이 없어 한국에서도 똑같이 받습니다.', ja: '会員証はデジタルのみ。', src: S.tobeAcc }],
  },
  BMSG: {
    about: { ko: 'BMSG 소속(BE:FIRST, HANA, TAKARA 등) 팬클럽입니다. 가입과 결제가 BMSG 공식 샵(bmsg.shop)에서 이뤄집니다.', ja: 'BMSG所属アーティストのファンクラブ。入会・決済はBMSG公式ショップで行います。' },
    overseas: { v: 'yes', ko: '해외 거주자도 가입할 수 있고, 환율에 따라 회비가 달라질 수 있다고 안내합니다.', ja: '海外在住の方も入会でき、為替により会費が変動します。', src: S.bmsg },
    pay: [{ ko: '결제는 신용카드 또는 일본 편의점 결제입니다. 편의점 결제는 1년 일시불이고 자동 갱신이 되지 않아 매년 다시 결제합니다.', ja: 'クレジットカードまたはコンビニ決済。コンビニ決済は自動更新されません。', src: S.bmsg }],
  },
  Weverse: {
    about: { ko: 'K-POP 아티스트의 일본 공식 멤버십은 Weverse Shop JAPAN에서 삽니다. 같은 아티스트도 GLOBAL·JAPAN 등 샵마다 멤버십이 따로 있습니다.', ja: 'K-POPアーティストのJAPANメンバーシップはWeverse Shop JAPANで購入します。' },
    pay: [
      { ko: '결제 통화가 엔화(JPY)인 JAPAN 멤버십은 신용카드로 결제합니다. 원화(KRW)인 GLOBAL 멤버십은 한국에서 발행한 카드로 결제합니다. 한국 발행 카드로 JAPAN 멤버십을 결제할 수 있는지는 공지에 적혀 있지 않습니다.', ja: '決済通貨が円(JPY)のJAPANメンバーシップはクレジットカードで決済します。', src: S.wvAutoJa },
      { ko: '2026년 9월 3일부터 자동 결제를 고를 수 있습니다. 해지해도 남은 기간은 유지되고 환불은 없습니다.', ja: '2026年9月3日から自動決済を選べます。解除しても期限まで有効、返金なし。', src: S.wvAuto },
    ],
    other: [
      { ko: '구매는 Weverse 계정 만들기 → Weverse Shop에서 구매 → 팬클럽 사이트에 회원 정보 등록 순서입니다. 정보 등록을 안 하면 일부 혜택을 못 받습니다.', ja: 'Weverse Account作成 → Weverse Shopで購入 → ファンクラブサイトに情報登録。', src: S.wvCampaign },
      { ko: '갱신은 만료 60일 전부터 만료 후 30일까지 할 수 있습니다.', ja: '更新は有効期限の60日前から期限後30日まで。', src: S.wvCampaign },
      { ko: '2024년 3월 20일부터 한 계정으로 여러 나라 샵의 멤버십을 함께 가질 수 있습니다.', ja: '2024年3月20日から1アカウントで複数ショップのメンバーシップを保有できます。', src: S.wvMulti },
      { ko: '티켓 우선 신청 특전은 대상 공연에만 있습니다. 멤버십이 있어도 모든 공연에 선행이 열리지는 않습니다.', ja: 'チケット先行などの特典は対象イベントのみです。', src: S.wvCampaign },
    ],
  },
  'Sony Music Solutions': { about: { ko: 'Sony Music Solutions가 운영하는 팬클럽 사이트입니다(King Gnu, YOASOBI, NMIXX 일본 팬클럽 등).', ja: 'Sony Music Solutionsが運営するファンクラブサイト。' } },
  SKIYAKI: { about: { ko: 'SKIYAKI(Bitfan)가 운영하는 팬클럽 사이트입니다(ONEW, ATEEZ 일본 팬클럽 등).', ja: 'SKIYAKI(Bitfan)が運営するファンクラブサイト。' } },
};

export function platKey(platform: string | null | undefined, entry = ''): PlatKey | null {
  const p = String(platform || '');
  if (/PLUS MEMBER/i.test(p)) return 'PLUS MEMBER';
  if (/FAMILY CLUB/i.test(p) || /familyclub\.jp/.test(entry)) return 'FAMILY CLUB';
  if (/TOBE/i.test(p) || /tobe-community\.jp/.test(entry)) return 'TOBE';
  if (/bmsg\.shop/.test(entry)) return 'BMSG';
  if (/Weverse/i.test(p) || /weverse/.test(entry)) return 'Weverse';
  if (/Sony Music Solutions/i.test(p)) return 'Sony Music Solutions';
  if (/SKIYAKI|Bitfan/i.test(p)) return 'SKIYAKI';
  return null;
}

/* ── 가입 가능성 요약: 주제마다 상태 + 한 줄 설명 + 원문 ── */
export type Tone = 'ok' | 'ng' | 'warn' | 'none';
export interface Row { key: string; label: string; tone: Tone; status: string; text: string; ev: EvItem[]; src?: Src[] }

/* 메일 주소가 있으면 주소 그대로, 없으면 도메인 */
export function mailTargets(items: EvItem[] | undefined) {
  const out: string[] = [];
  for (const x of items || []) {
    const mails: string[] = x.quote.match(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi) || [];
    out.push(...mails);
    let rest = x.quote;
    for (const m of mails) rest = rest.replace(m, ' ');
    out.push(...(rest.match(/@?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:jp|com|info|net|tokyo|io)\b/gi) || []).map((d) => d.replace(/^@/, '')));
  }
  return [...new Set(out)].slice(0, 4);
}

/* 결제 수단 목록에서 문장 조각("(メインのカード番号…", "【WEB決済】")은 뺀다 */
export const cleanPays = (l: string[]) => l.filter((x) => x && x.length <= 24 && !/[【】]|番号|すぐ|右側|ください/.test(x) && (x.match(/[(（]/g) || []).length === (x.match(/[)）]/g) || []).length);

const firstMatch = (items: EvItem[] | undefined, re: RegExp) => { for (const x of items || []) { const m = x.quote.match(re); if (m) return m; } return null; };

export function summaryRows(o: {
  evidence: Evidence | null; verdict: Verdict | null; overseas: string; platform: PlatKey | null;
  payments: string[]; payKo: (l: string[]) => string[]; residence?: { autoRenew?: boolean; overseas?: { debitNg?: boolean; annualShip?: unknown } } | null;
  pagesRead?: string[]; club: string; entry?: string | null;
}): Row[] {
  const ja = getLocale() === 'ja';
  const ev = o.evidence || {};
  const v = o.verdict;
  const pk = o.platform ? PLATFORM_KNOW[o.platform] : undefined;
  const L = (ko: string, jaS: string) => (ja ? jaS : ko);
  const n = o.pagesRead?.length || 0;
  const readNote = n ? L(`공식 가입 안내·FAQ·규약 ${n}페이지에 관련 문구가 없습니다.`, `公式の入会案内・FAQ・規約 ${n}ページに記載がありません。`) : L('공식 안내에 관련 문구가 없습니다.', '公式案内に記載がありません。');
  const rows: Row[] = [];

  /* 1. 해외 거주자 가입 */
  {
    const st = o.overseas === 'yes' || v?.overseas === 'yes' ? 'yes' : o.overseas === 'no' || v?.overseas === 'no' ? 'no' : v?.overseas === 'limited' ? 'limited' : null;
    const e = [...(ev['overseas.no'] || []), ...(ev['overseas.yes'] || []), ...(ev['overseas.unsupported'] || [])];
    if (st === 'yes') rows.push({ key: 'ovs', label: L('한국에서 가입', '海外からの入会'), tone: 'ok', status: L('가능', '可'), text: L(`${o.club}은(는) 해외 거주자도 가입할 수 있다고 안내합니다.${o.residence ? ' 가입 페이지 요금표가 일본 거주자와 해외 거주자로 나뉘어 있습니다.' : ''}`, `${o.club}は海外在住の方も入会できると案内しています。`), ev: e.filter((x) => (ev['overseas.yes'] || []).includes(x)), src: !(ev['overseas.yes'] || []).length && o.entry ? [{ ko: '이 팬클럽 가입 페이지', ja: '入会ページ', url: o.entry }] : !(ev['overseas.yes'] || []).length && pk?.overseas?.v === 'yes' ? [pk.overseas.src] : undefined });
    else if (st === 'no') rows.push({ key: 'ovs', label: L('한국에서 가입', '海外からの入会'), tone: 'ng', status: L('불가', '不可'), text: L('일본에 살고 일본 주소가 있어야 가입할 수 있습니다. 한국 주소로는 가입할 수 없습니다.', '日本国内に居住し、国内の住所が必要です。'), ev: ev['overseas.no'] || [], src: !(ev['overseas.no'] || []).length && pk?.overseas?.v === 'no' ? [pk.overseas.src] : undefined });
    else if (st === 'limited') rows.push({ key: 'ovs', label: L('한국에서 가입', '海外からの入会'), tone: 'warn', status: L('지원 안 함', 'サポート外'), text: L('일본 국내용 서비스라 해외에서 쓰는 것은 동작을 보증하지 않는다고 적혀 있습니다. 가입은 막지 않지만, 결제나 앱이 안 될 때 도움을 받기 어렵고 문의도 일본어만 됩니다.', '日本国内向けサービスのため、海外からの利用は動作保証外です。'), ev: ev['overseas.unsupported'] || [] });
    else if (pk?.overseas) rows.push({ key: 'ovs', label: L('한국에서 가입', '海外からの入会'), tone: pk.overseas.v === 'yes' ? 'ok' : pk.overseas.v === 'no' ? 'ng' : 'warn', status: pk.overseas.v === 'yes' ? L('가능', '可') : pk.overseas.v === 'no' ? L('불가', '不可') : L('가입 화면에서 결정', '登録画面で判定'), text: `${ja ? pk.overseas.ja : pk.overseas.ko} ${L(`이 팬클럽 안내에는 해외 거주자에 관한 문장이 따로 없어 플랫폼 공통 규칙을 적었습니다. 회원 정보 화면의 국가 목록에 韓国(한국)이 있으면 가입할 수 있습니다.`, '')}`.trim(), ev: [], src: [pk.overseas.src] });
    else rows.push({ key: 'ovs', label: L('한국에서 가입', '海外からの入会'), tone: 'none', status: L('안내 없음', '記載なし'), text: `${readNote} ${L('가입을 막는 문장도, 허용하는 문장도 없습니다. 가입 화면에서 주소 국가를 일본으로만 고를 수 있으면 한국에서는 가입할 수 없습니다.', '')}`.trim(), ev: [] });
  }

  /* 2. 결제 */
  {
    const pay = o.payKo(cleanPays(o.payments || []));
    const debit = v?.debitNg || o.residence?.overseas?.debitNg;
    const parts: string[] = [];
    if (pay.length) parts.push(L(`결제 수단: ${pay.join(' · ')}.`, `支払い: ${pay.join('・')}。`));
    if (!ja && pay.some((x) => /편의점|Pay-easy|d払い|au |소프트뱅크|PayPay/.test(x))) parts.push('편의점·통신사·PayPay 결제는 일본 계좌·휴대폰이 있어야 하니 한국에서는 신용카드를 씁니다.');
    if (debit) parts.push(L('체크카드·선불카드는 동작을 보증하지 않는다고 적혀 있어 신용카드가 안전합니다.', 'デビット・プリペイドカードは動作保証外です。'));
    if (v?.threeDS) parts.push(L('카드 결제 때 3D Secure(카드사 본인 인증) 창이 뜹니다.', '3Dセキュア認証があります。'));
    const src = [...(pk?.pay || [])].slice(0, 2);
    if (!parts.length && src.length) parts.push(...src.map((f) => (ja ? f.ja : f.ko)));
    rows.push({ key: 'pay', label: L('결제', '支払い'), tone: parts.length ? (debit ? 'warn' : 'ok') : 'none', status: parts.length ? (debit ? L('신용카드 권장', 'クレジット推奨') : pay.some((x) => /신용카드|クレジット/.test(x)) ? L('신용카드 가능', 'クレジット可') : o.platform === 'Weverse' ? L('신용카드', 'クレジット') : L('안내 있음', '記載あり')) : L('안내 없음', '記載なし'), text: parts.join(' ') || readNote, ev: [...(ev['pay.debitNg'] || []), ...(ev['pay.overseasCard'] || []), ...(ev['pay.3ds'] || [])].slice(0, 3), src: parts.length && pk?.pay && !(ev['pay.debitNg'] || []).length ? pk.pay.map((f) => f.src) : undefined });
  }

  /* 3. 일본 전화번호·SMS */
  {
    if (v?.phoneJp) rows.push({ key: 'phone', label: L('일본 전화번호', '日本の電話番号'), tone: 'ng', status: L('필요', '必要'), text: L('티켓 신청이나 앱 인증에 일본에서 개통한 휴대폰 번호가 필요하다고 적혀 있습니다. 한국 번호만 있으면 선행 신청을 못 할 수 있습니다.', '日本国内で契約した電話番号が必要と案内されています。'), ev: ev['phone.jp'] || [] });
    else if (v?.sms || pk?.phone) rows.push({ key: 'phone', label: L('일본 전화번호', '日本の電話番号'), tone: 'warn', status: L('SMS 인증', 'SMS認証'), text: pk?.phone ? pk.phone.map((f) => (ja ? f.ja : f.ko)).join(' ') : L('휴대폰 SMS 인증이 있습니다. 한국 번호를 막는다는 문장은 없습니다.', 'SMS認証があります。'), ev: ev['phone.sms'] || [], src: pk?.phone?.map((f) => f.src) });
    else rows.push({ key: 'phone', label: L('일본 전화번호', '日本の電話番号'), tone: 'none', status: L('안내 없음', '記載なし'), text: L('일본 번호가 필요하다는 문장은 없습니다. 다만 이 팬클럽 선행을 일본 예매처(e+·티켓피아)로 받는 공연이면, 그 예매처 가입에 일본 휴대폰 번호가 필요합니다.', '日本の番号が必要という記載はありません。'), ev: [], src: ja ? undefined : [S.eplusOvs, S.piaTel] });
  }

  /* 4. 회원증·특전 배송 */
  {
    const jpOnly = v?.shipOverseasNo;
    const digital = v?.digitalCard || (o.platform === 'TOBE');
    const ship = !!o.residence?.overseas?.annualShip;
    const txt = [
      digital ? L('회원증은 앱·웹의 디지털 회원증입니다.', 'デジタル会員証があります。') : '',
      ship ? L('해외 거주자도 "특전 우편 발송" 코스를 고르면 회원증·특전을 해외로 받습니다.', '海外会員は「特典発送あり」コースで海外発送されます。') : '',
      jpOnly && !ship ? L('우편으로 보내는 특전·굿즈는 일본 국내 주소로만 보냅니다. 한국에서는 받을 수 없거나 배송대행이 필요합니다.', '発送特典・グッズは日本国内のみです。') : '',
    ].filter(Boolean);
    rows.push({ key: 'ship', label: L('회원증·특전 배송', '会員証・特典の発送'), tone: jpOnly && !ship ? 'warn' : txt.length ? 'ok' : 'none', status: jpOnly && !ship ? L('일본 국내만', '国内のみ') : ship ? L('해외 발송 코스', '海外発送あり') : digital ? L('디지털', 'デジタル') : L('안내 없음', '記載なし'), text: txt.join(' ') || readNote, ev: [...(ship ? [] : [...(ev['ship.jpOnly'] || []), ...(ev['ship.overseasNo'] || [])]), ...(ev['card.digital'] || [])].slice(0, 3), src: digital && o.platform === 'TOBE' ? PLATFORM_KNOW.TOBE?.card?.map((f) => f.src) : undefined });
  }

  /* 5. 자동 갱신과 해지 */
  {
    const auto = v?.autoRenew || o.residence?.autoRenew;
    const dl = firstMatch(ev['renew.auto'], /(?:会員)?期限月の\s*(\d{1,2})\s*日/);
    const text = auto
      ? L(`신용카드로 내면 매년(월회비는 매달) 자동으로 결제됩니다.${dl ? ` 멈추려면 회원 기한이 끝나는 달 ${dl[1]}일까지 마이페이지에서 자동 갱신을 끄세요.` : ' 멈추는 방법과 기한은 원문에 있습니다.'}`, `クレジットカードは自動継続です。${dl ? `停止は会員期限月の${dl[1]}日までにマイページで。` : ''}`)
      : o.platform === 'Weverse' && pk?.pay?.[1] ? (ja ? pk.pay[1].ja : pk.pay[1].ko) : readNote;
    if (v?.autoRenew === false && !o.residence?.autoRenew) { rows.push({ key: 'renew', label: L('자동 갱신', '自動継続'), tone: 'ok', status: L('없음', 'なし'), text: L('자동 갱신이 없습니다. 기한이 끝나기 전에 직접 갱신해야 회원이 이어집니다.', '自動更新はありません。期限内にご自身で継続手続きをしてください。'), ev: ev['renew.none'] || [] }); }
    else rows.push({ key: 'renew', label: L('자동 갱신', '自動継続'), tone: auto ? 'warn' : o.platform === 'Weverse' ? 'ok' : 'none', status: auto ? L('카드는 자동', 'カードは自動') : o.platform === 'Weverse' ? L('선택', '選択制') : L('안내 없음', '記載なし'), text, ev: ev['renew.auto'] || [], src: !auto && o.platform === 'Weverse' ? [S.wvAuto] : undefined });
  }

  /* 6. 이름·본인 확인 */
  {
    const has = v?.realName;
    rows.push({ key: 'name', label: L('이름·본인 확인', '氏名・本人確認'), tone: has ? 'warn' : 'none', status: has ? L('신분증 확인', '本人確認あり') : L('안내 없음', '記載なし'), text: has ? L('공연장에서 신분증으로 본인을 확인할 수 있다고 적혀 있습니다. 가입할 때 이름을 여권 영문 이름과 똑같이 넣으세요.', '会場で身分証による本人確認があります。') : L('본인 확인에 관한 문장은 없습니다. 그래도 이름은 여권 영문 이름과 똑같이 넣는 것이 안전합니다(카드 명의와 달라도 결제가 거절될 수 있습니다).', '本人確認の記載はありません。'), ev: ev['rule.realName'] || [], src: has || ja ? undefined : [S.kbDecline] });
  }

  /* 7. 메일 수신 */
  {
    const doms = mailTargets(ev['mail.domain']);
    if (doms.length || ev['mail.domain']?.length) rows.push({ key: 'mail', label: L('메일 수신', 'メール受信'), tone: 'warn', status: L('도메인 허용', 'ドメイン許可'), text: doms.length ? L(`가입 메일이 스팸함으로 가거나 막히지 않게 ${doms.join(', ')} 에서 오는 메일을 받도록 설정하세요.`, `${doms.join('、')} からのメールを受信できるよう設定してください。`) : L('가입 메일을 받을 수 있게 수신 설정을 하라고 안내합니다.', '受信設定をしてください。'), ev: ev['mail.domain'] || [] });
  }

  /* 8. 양도·대리 가입 */
  if (v?.noResale || v?.noProxy) rows.push({ key: 'rule', label: L('양도·대리 가입', '譲渡・代行'), tone: 'ng', status: L('금지', '禁止'), text: L('회원 자격과 팬클럽으로 산 티켓은 남에게 넘기거나 되팔 수 없습니다. 대리 가입·구매 대행으로 받은 티켓은 입장을 거부당할 수 있습니다.', '会員資格・チケットの譲渡、転売はできません。'), ev: [...(ev['rule.noProxy'] || []), ...(ev['rule.noResale'] || [])].slice(0, 2), src: ja ? undefined : [S.bunka] });
  return rows;
}

const TONE_ICON: Record<Tone, string> = { ok: 'i-check', ng: 'i-close', warn: 'i-info', none: 'i-info' };

export function summaryHtml(rows: Row[]) {
  const ja = getLocale() === 'ja';
  return `<div class="fck">${rows.map((r) => `<div class="fck-row tone-${r.tone}">
    <div class="fck-k"><span class="fck-ic">${icon(TONE_ICON[r.tone], 'ic xs')}</span><b>${esc(r.label)}</b><em>${esc(r.status)}</em></div>
    <div class="fck-v"><p>${esc(r.text)}</p>
      ${r.ev.length ? `<details class="fck-ev"><summary>${ja ? '公式の原文' : '공식 원문 보기'} ${r.ev.length}</summary>${r.ev.map((e) => `<blockquote>${e.q ? `<small>Q. ${esc(e.q)}</small>` : ''}<p lang="ja">${esc(e.quote)}</p><a href="${esc(safeExternal(e.url))}" target="_blank" rel="noopener">${esc(e.url.replace(/^https?:\/\//, '').slice(0, 64))}${icon('i-ext', 'ic xs')}</a></blockquote>`).join('')}</details>` : ''}
      ${r.src?.length ? `<p class="fck-src">${ja ? '出典' : '출처'} ${r.src.map((s) => `<a href="${esc(safeExternal(s.url))}" target="_blank" rel="noopener">${esc(ja ? s.ja : s.ko)}${icon('i-ext', 'ic xs')}</a>`).join('')}</p>` : ''}
    </div>
  </div>`).join('')}</div>`;
}

/* ── 한국에서 가입 전 준비(한국어 화면 전용) ── */
export interface PrepCard { h: string; items: string[]; src: Src[] }
export function prepCards(fee: { v: number; per: 'y' | 'm'; cur?: 'JPY' | 'USD' } | null, fx: { jpyKrw?: number } | null): PrepCard[] {
  const won = (yen: number, rate: number) => (fx?.jpyKrw ? `${Math.round((yen * fx.jpyKrw * (1 + rate)) / 10) * 10}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '');
  const bill = fee?.cur === 'USD' ? [`해외 회비 ${fee.v} USD${fee.per === 'm' ? '(월)' : ''}는 달러로 결제됩니다. 카드 청구액에는 국제 브랜드 수수료(VISA·Mastercard 1%, JCB 없음)와 해외 서비스 수수료(신용 0.18%)가 더해집니다.`] : fee && fx?.jpyKrw ? [
    `회비 ${money(fee.v, 'JPY')}${fee.per === 'm' ? '(월)' : ''}을 신용카드로 내면 카드 청구액은 대략 VISA·Mastercard ${won(fee.v, 0.0118)}원, JCB ${won(fee.v, 0.0018)}원입니다. 국제 브랜드 수수료(VISA·Mastercard 1%, JCB 없음)와 해외 서비스 수수료(신용 0.18%)를 더한 값이고, 실제 환율은 결제일 기준입니다.`,
  ] : [];
  return [
    {
      h: '카드: 해외 결제 켜고 엔화로 결제',
      items: [
        '카드사 앱에서 "해외 결제 차단"이 켜져 있으면 일본 사이트 결제가 거절됩니다. 결제 전에 해제하세요.',
        'PLUS MEMBER 팬클럽과 티켓피아 등은 카드 결제에 3D Secure(카드사 본인 인증)를 요구합니다. 카드사 앱의 "해외안심결제·안심클릭"을 등록해 두세요.',
        '결제 화면에서 원화(KRW)로 낼지 물으면 엔화(JPY)를 고르세요. 원화로 내면 3~8%의 수수료가 더 붙습니다.',
        '체크카드·선불카드는 많은 팬클럽이 "동작 보증 외"라고 적습니다. 해외 결제 되는 신용카드가 가장 확실합니다.',
        '카드에 적힌 영문 이름과 입력한 이름 순서가 다르면(성·이름이 바뀌는 등) 승인이 거절될 수 있습니다.',
        ...bill,
      ],
      src: [S.shinhanBlock, S.kb3ds, S.pmStore, S.dcc, S.kbDecline, S.shinhanFee],
    },
    {
      h: '주소: 영문 도로명 주소',
      items: [
        '주소정보누리집(juso.go.kr)에서 집 주소를 검색하고 "영문" 버튼을 누르면 공식 영문 주소와 우편번호가 나옵니다.',
        '주소 칸의 국가는 韓国(Korea)를 고르고, 우편번호는 영문 주소 끝의 5자리 숫자를 넣습니다.',
        '일부 해외 결제는 카드사에 등록한 영문 주소와 같아야 승인됩니다. 삼성카드는 영문 주소를 10개까지 등록할 수 있습니다.',
      ],
      src: [S.juso, S.samsungAddr],
    },
    {
      h: '이름: 漢字·フリガナ·로마자',
      items: [
        'フリガナ는 이름을 "어떻게 읽는지"를 가타카나로 쓰는 칸입니다. 예: 김민지 → キム ミンジ.',
        '팬클럽 앱에 한 번 등록한 이름은 스스로 바꿀 수 없는 곳이 많습니다. 여권 영문 이름과 똑같이 넣으세요.',
      ],
      src: [S.furigana, S.tixFaq],
    },
    {
      h: '전화번호: +82, 앞의 0 빼기',
      items: [
        '국가 번호를 고르는 칸이 있으면 +82(Korea)를 고르고 010-1234-5678은 10-1234-5678로 앞의 0을 빼고 넣습니다.',
        'SMS 인증번호가 안 오면 휴대폰의 "해외 발신·모르는 번호 문자 차단"을 풀어 보세요.',
        '일본 예매처 e+는 가입에 일본 휴대폰 번호가 필요합니다. 해외 거주자는 해외용 사이트 eplus.tickets를 씁니다(해외 발급 카드 전용). 티켓피아도 가입·신청 때 전화번호 인증이 있습니다.',
      ],
      src: [S.tixFaq, S.eplusOvs, S.eplusTickets, S.piaTel],
    },
    {
      h: '양도·대리 구매 주의',
      items: [
        '일본에는 티켓 부정전매 금지법이 있습니다. 정가보다 비싸게, 반복해서 되파는 것이 불법입니다.',
        '정가 양도라도 주최 측 규약이 "구매자 본인만 입장"이면 입장을 거부당할 수 있습니다. 대리 가입·구매 대행으로 산 티켓은 특히 위험합니다.',
      ],
      src: [S.bunka],
    },
  ];
}

export function prepHtml(cards: PrepCard[]) {
  return `<div class="fck-prep">${cards.map((c, i) => `<details class="fck-card"${i === 0 ? ' open' : ''}><summary><span>${String(i + 1).padStart(2, '0')}</span>${esc(c.h)}${icon('i-chev-r', 'ic xs')}</summary>
    <ul>${c.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <p class="fck-src">출처 ${c.src.map((s) => `<a href="${esc(safeExternal(s.url))}" target="_blank" rel="noopener">${esc(s.ko)}${icon('i-ext', 'ic xs')}</a>`).join('')}</p>
  </details>`).join('')}</div>`;
}

export function platformNotesHtml(pk: PlatKey | null) {
  const k = pk ? PLATFORM_KNOW[pk] : null;
  if (!k) return '';
  const ja = getLocale() === 'ja';
  const facts = [...(k.other || [])];
  if (!facts.length) return `<p class="fck-about">${esc(ja ? k.about.ja : k.about.ko)}</p>`;
  return `<p class="fck-about">${esc(ja ? k.about.ja : k.about.ko)}</p><ul class="fck-plat">${facts.map((f) => `<li>${esc(ja ? f.ja : f.ko)} <a href="${esc(safeExternal(f.src.url))}" target="_blank" rel="noopener">${esc(ja ? f.src.ja : f.src.ko)}${icon('i-ext', 'ic xs')}</a></li>`).join('')}</ul>`;
}
