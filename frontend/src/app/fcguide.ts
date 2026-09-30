/* 팬클럽 가입 안내 — 플랫폼별 실제 화면과 공식 안내로 쓴 단계
 *
 * 팬클럽은 몇 개 플랫폼 위에서 돈다. 같은 플랫폼이면 가입 화면·결제 흐름이 같으므로
 * 가이드는 플랫폼마다 한 번 쓰고, 아티스트는 가입 페이지 주소로 플랫폼을 자동 판별해 붙인다.
 * 금액·결제 수단·해외 가입 여부 같은 아티스트별 값은 가입 페이지에서 읽은 값(facts)을 끼워 넣는다.
 *
 * 캡처: 2026-09-27, Mrs. GREEN APPLE 「Ringo Jam」(PLUS MEMBER), SixTONES(FAMILY CLUB).
 * 다른 아티스트 화면에서는 "화면 예시"로 표기한다. */
import { esc, icon, money } from './ui';
import { getLocale } from './i18n';
import { approx } from './fanclub';
import { mailTargets, cleanPays } from './fcknow';

export type PlatformId = 'plusmember' | 'familyclub' | 'weverse' | 'generic';
export interface Amt { v: number; cur: 'JPY' | 'USD' }
export interface Course { annual: Amt | null; annualShip: Amt | null; monthly: Amt | null; joinFee: Amt | null; shipFee: Amt | null; payments: string[]; debitNg: boolean }
export interface Residence { jp: Course | null; overseas: Course; autoRenew: boolean; residenceLocked: boolean; realName: boolean; overseasLimits?: boolean }
export interface GuideFacts {
  name: string | null; url?: string; platform: string | null; overseas: string; languages: string[]; payments: string[];
  fees: { annual: number | null; monthly: number | null; joinFee: number | null; handlingFee?: number | null; free?: boolean; overseasAnnual: number | null; overseasAnnualUsd: number | null } | null;
  residence?: Residence | null; overseasJoin?: string | null;
  evidence?: Record<string, { quote: string; url: string; q?: string }[]> | null;
  verdict?: { overseas?: string | null; phoneJp?: boolean | null; debitNg?: boolean | null; autoRenew?: boolean | null; realName?: boolean | null } | null;
  globalSite?: { url: string; label: string } | null;
}

export const CHECKED = '2026-09-27';
const SRC = {
  rjEntry: { ko: 'Ringo Jam 입회 안내', ja: 'Ringo Jam 入会案内', url: 'https://mrsgreenapple.com/feature/entry' },
  rjHow: { ko: 'Ringo Jam FAQ: 입회 방법', ja: 'Ringo Jam FAQ: 入会方法', url: 'https://mrsgreenapple.com/faq/detail/12' },
  rjOvs: { ko: 'Ringo Jam FAQ: 해외 거주자 가입', ja: 'Ringo Jam FAQ: 海外在住の入会', url: 'https://mrsgreenapple.com/faq/detail/313' },
  rjCard: { ko: 'Ringo Jam FAQ: 카드 결제 오류', ja: 'Ringo Jam FAQ: カード決済エラー', url: 'https://mrsgreenapple.com/faq/detail/17' },
  rjOne: { ko: 'Ringo Jam FAQ: 1인 1계정', ja: 'Ringo Jam FAQ: 複数登録', url: 'https://mrsgreenapple.com/faq/detail/14' },
  rjTicket: { ko: 'Ringo Jam FAQ: 전자티켓 수령', ja: 'Ringo Jam FAQ: 電子チケット', url: 'https://mrsgreenapple.com/faq/detail/289' },
  rjPhone: { ko: 'Ringo Jam FAQ: 전화번호 인증', ja: 'Ringo Jam FAQ: 電話番号認証', url: 'https://mrsgreenapple.com/faq/detail/248' },
  famRule: { ko: 'FAMILY CLUB 회원 규약 제5조', ja: 'FAMILY CLUB 会員規約 第5条', url: 'https://www.familyclub.jp/join/index/f/ST' },
  famPay: { ko: 'FAMILY CLUB 특정상거래법 표기', ja: 'FAMILY CLUB 特定商取引法に基づく表記', url: 'https://www.fc-member.familyclub.jp/page/fc_commercial' },
  wvPay: { ko: 'Weverse 고객센터: 결제 수단', ja: 'Weverse ヘルプ: 決済手段', url: 'https://help.weverse.io/weverse/article?faq-id=000005482' },
  wvCard: { ko: 'Weverse 고객센터: 체크·신용카드', ja: 'Weverse ヘルプ: デビット・クレジットカード', url: 'https://help.weverse.io/weverse/article?faq-id=000005481' },
  wvMulti: { ko: 'Weverse 공지: 국가 샵별 멤버십', ja: 'Weverse お知らせ: 国別ショップのメンバーシップ', url: 'https://weverse.io/notice/17793?hl=ko' },
  wvAuto: { ko: '위버스샵 공지: 멤버십 자동 결제', ja: 'Weverse Shop お知らせ: 自動決済', url: 'https://shop.weverse.io/ko/notices/14202' },
  wvHelp: { ko: 'Weverse 고객센터: 멤버십', ja: 'Weverse ヘルプ: メンバーシップ', url: 'https://help.weverse.io/weverse/product?depth1=Membership' },
  wvCampaign: { ko: 'aespa 「MY-J」 입회 안내(Weverse)', ja: 'aespa「MY-J」入会案内(Weverse)', url: 'https://campaigns.weverse.io/WS266SX9B4' },
  bnOvs: { ko: 'back number FAQ: 해외 거주자 입회', ja: 'back number FAQ: 海外在住の入会', url: 'https://backnumber.info/faq/detail/182' },
  sakaEn: { ko: 'サカナクション 입회 안내(영문): ID 국가', ja: 'サカナクション 入会案内(英語)', url: 'https://sakanaction.jp/feature/entry?lang=en' },
  pmStore: { ko: 'PLUS MEMBER 공식 스토어 FAQ: 카드 결제', ja: 'PLUS MEMBER ストア FAQ: カード決済', url: 'https://store.plusmember.jp/nxt_mkt/user_data/faq.php' },
  tixGuide: { ko: 'チケプラ 전자티켓 앱 안내', ja: 'チケプラ 電子チケットアプリ', url: 'https://tixplus.jp/feature/eticketapp/guide.html' },
  tixFaq: { ko: 'チケプラ FAQ(영문)', ja: 'チケプラ FAQ(英語)', url: 'https://tixplus.jp/feature/emtg_faq/faq_en.html' },
  wvShop: { ko: 'Weverse Shop 멤버십 상품', ja: 'Weverse Shop メンバーシップ商品', url: 'https://shop.weverse.io/ja/shop/JPY/artists/133/sales/55255' },
};
type SrcKey = keyof typeof SRC;

export function platformOf(fc: { platform?: string | null; entry?: string | null; home?: string | null } | null): PlatformId {
  const u = `${fc?.entry || ''} ${fc?.home || ''}`;
  if (fc?.platform === 'Weverse' || /weverse/.test(u)) return 'weverse';
  if (/familyclub\.jp/.test(u)) return 'familyclub';
  if (fc?.platform === 'PLUS MEMBER' || /plusmember|\/feature\/entry|\/feature\/introduction_fc/.test(u)) return 'plusmember';
  return 'generic';
}
/* 팬클럽 이름: "IVE JAPAN OFFICIAL FANCLUB DIVE JAPAN" → "DIVE JAPAN", "ONEW OFFICIAL FANCLUB ＜JJINGGU JAPAN＞" → "JJINGGU JAPAN".
   뒤에 이름이 없으면("=LOVE Official Fan Club") 그대로 */
export function clubName(raw: string | null | undefined) {
  const n = String(raw || '').trim();
  const rest = n.replace(/^.*?OFFICIAL\s*FAN\s*CLUB\s*/i, '').replace(/^[＜<「『"]+|[＞>」』"]+$/g, '').trim();
  return rest.length >= 2 && rest !== n ? rest : n;
}
/* 일본어 화면에서는 한글 이름 대신 로마자 표기 */
export function displayName(name: string, others: (string | null | undefined)[] = [], ja = getLocale() === 'ja') {
  if (!ja || !/[가-힣]/.test(name)) return name;
  return others.find((x) => x && /[A-Za-z]/.test(x) && !/[가-힣]/.test(x)) || name;
}
export const PLATFORM_NAME: Record<PlatformId, string> = { plusmember: 'PLUS MEMBER', familyclub: 'FAMILY CLUB', weverse: 'Weverse', generic: '' };

interface Step { kind?: 'open' | 'fee' | 'join' | 'pay'; h: string; p: string[]; img?: { src: string; w: number; h: number; cap: string }; warn?: string; src?: SrcKey[]; links?: { label: string; url: string }[] }

/* 이 팬클럽 원문(evidence)에서 주제의 첫 문장이 나온 페이지 */
const evLink = (f: GuideFacts, topic: string, label: string) => { const x = f.evidence?.[topic]?.[0]; return x ? [{ label, url: x.url }] : []; };
const evDomains = (f: GuideFacts) => mailTargets(f.evidence?.['mail.domain']);
const evRenewDay = (f: GuideFacts) => { for (const x of f.evidence?.['renew.auto'] || []) { const m = x.quote.match(/(?:会員)?期限月の\s*(\d{1,2})\s*日/); if (m) return m[1]; } return null; };

const amt = (a: Amt | null | undefined, fx: { jpyKrw?: number } | null) => {
  if (!a) return '';
  if (a.cur === 'USD') return `${a.v} USD`;
  const w = approx(a.v, fx);
  return `${money(a.v, 'JPY')}${w ? ` (${w})` : ''}`;
};

/* 결제 수단 이름을 한국어로 */
const PAY_KO: [RegExp, string][] = [
  [/クレジット/, '신용카드'], [/コンビニ/, '일본 편의점 결제'], [/d払い/, 'd払い(NTT도코모)'], [/auかんたん/, 'au 간편결제(KDDI)'],
  [/ソフトバンク|ワイモバイル/, '소프트뱅크 통합결제'], [/PayPay/, 'PayPay'], [/PayPal/i, 'PayPal'], [/Pay-easy|ペイジー/, 'Pay-easy(일본 은행)'], [/App Store|Google Play|アプリ内課金/, '앱 내 결제'],
];
export function payKo(list: string[]) {
  if (getLocale() === 'ja') return list;
  const out: string[] = [];
  for (const x of list) { const m = PAY_KO.find(([re]) => re.test(x)); const v = m ? m[1] : x; if (!out.includes(v)) out.push(v); }
  return out;
}

function plusmemberSteps(f: GuideFacts, club: string, fx: { jpyKrw?: number } | null, isExample: boolean, sharedDoc = false): Step[] {
  /* 다른 팬클럽(Mrs. GREEN APPLE) 화면은 가이드 문서에서만. 팬클럽 상세에서는 그 팬클럽 자신의 캡처를 쓴다 */
  const showImg = !isExample || sharedDoc;
  const ja = getLocale() === 'ja';
  const ov = f.residence?.overseas;
  const ex = isExample ? (ja ? '画面例: Mrs. GREEN APPLE「Ringo Jam」' : '화면 예시: Mrs. GREEN APPLE 「Ringo Jam」') : (ja ? '画面' : '화면');
  const cap = (s: string) => `${ex} · ${s} · ${CHECKED.replace(/-/g, '.')}`;
  if (ja) {
    return [
      { h: '入会ページを開く', p: [`${club}の入会ページを開きます。画面右上の言語メニューで表示言語を切り替えられるファンクラブもあります。`], img: showImg ? { src: '/guides/plusmember/00-language.jpg', w: 1400, h: 700, cap: cap('言語メニュー') } : undefined },
      { h: '居住地のコースを選ぶ', p: ['「日本にお住まいの方」と「日本以外にお住まいの方」で会費・支払い方法が分かれています。', f.residence?.jp?.annual ? `日本在住: 年会費 ${amt(f.residence.jp.annual, null)}${f.residence.jp.monthly ? ` / 月会費 ${amt(f.residence.jp.monthly, null)}` : ''}` : ''].filter(Boolean), img: showImg ? { src: '/guides/plusmember/01-fee-japan.jpg', w: 1400, h: 1157, cap: cap('会費') } : undefined, warn: f.residence?.residenceLocked ? '居住地を誤って選ぶと退会しないとコース変更できず、返金もありません。' : undefined },
      { h: 'メールアドレスを登録', p: ['Plus member ID(チケプラIDと共通)を作成します。登録後に届くメールのURLから続けます。'], img: showImg ? { src: '/guides/plusmember/03-email.jpg', w: 1400, h: 875, cap: cap('メールアドレス登録') } : undefined, src: ['sakaEn'] },
      { h: '会員情報と支払い', p: ['名前・生年月日・性別・電話番号・住所・パスワードを登録し、会費を支払います。必ず本人名義で。登録した氏名はあとから自分で変更できません。'], src: ['tixFaq'] },
      { h: '先行申込と電子チケット', p: ['会員サイトの TICKET から先行受付に申し込みます。電子チケットはアプリでSMS認証のうえ受け取ります。家族や友人の番号で認証すると受け取れません。'], src: ['tixGuide', 'tixFaq'] },
    ];
  }
  const ovFees = ov ? [
    ov.annual ? `연회비 코스 ${amt(ov.annual, fx)}${ov.annualShip ? ` · 특전(회원증 등) 우편 발송을 원하면 ${amt(ov.annualShip, fx)}${ov.shipFee ? `(해외 배송료 ${amt(ov.shipFee, null)} 포함)` : ''}` : ''}` : '',
    ov.monthly ? `월회비 코스 ${amt(ov.monthly, fx)}` : '',
  ].filter(Boolean) : [];
  const flatFee = [f.fees?.annual ? `연회비 ${amt({ v: f.fees.annual, cur: 'JPY' }, fx)}` : '', f.fees?.monthly ? `월회비 ${amt({ v: f.fees.monthly, cur: 'JPY' }, fx)}` : '', f.fees?.joinFee ? `입회금 ${amt({ v: f.fees.joinFee, cur: 'JPY' }, fx)}` : ''].filter(Boolean).join(' · ');
  const ovPay = ov?.payments?.length ? payKo(ov.payments).join(' · ') : '';
  const pay = f.payments?.length ? payKo(cleanPays(f.payments)).join(' · ') : '';
  const doms = evDomains(f);
  const day = evRenewDay(f);
  const ovs = f.overseas === 'yes' || f.verdict?.overseas === 'yes';
  const shared = (s: string) => `PLUS MEMBER 공통 화면 · ${s} · ${isExample ? 'Mrs. GREEN APPLE 가입 화면에서 캡처' : CHECKED.replace(/-/g, '.')}`;
  return [
    {
      h: '가입 페이지 열고 언어 바꾸기',
      p: [f.languages?.includes('한국어')
        ? `${club} 가입 페이지를 엽니다. 오른쪽 위 언어 메뉴(지구본)에서 한국어를 고르면 요금표와 주의 사항이 한국어로 바뀝니다(자동 번역이라 원문은 일본어입니다).`
        : `${club} 가입 페이지를 엽니다. 이 팬클럽은 언어 메뉴가 없어 일본어로 진행합니다. 브라우저의 번역 기능을 켜면 읽기 편합니다.`],
      img: showImg && f.languages?.includes('한국어') ? { src: '/guides/plusmember/00-language.jpg', w: 1400, h: 700, cap: shared('오른쪽 위 언어 메뉴') } : undefined,
    },
    {
      h: ovs ? '"일본 이외에 거주하시는 분" 요금 고르기' : '요금과 코스 고르기',
      p: [
        ...(ovFees.length ? ['요금표가 일본 거주자와 해외 거주자로 나뉩니다. 한국에 살면 해외 거주자 쪽입니다.', ...ovFees]
          : [flatFee ? `가입 페이지에 적힌 요금: ${flatFee}. 거주지별로 나뉜 요금표는 없습니다.` : '가입 페이지에서 금액을 읽지 못했습니다. 아래 "요금·결제"에 읽은 값만 적었습니다.']),
      ],
      img: !isExample && ovFees.length ? { src: '/guides/plusmember/01-fee-overseas-ko.jpg', w: 1400, h: 1184, cap: cap('해외 거주자 요금표') } : undefined,
      warn: f.residence?.residenceLocked ? '거주지 코스를 잘못 고르면 탈퇴 후 다시 가입해야 하고, 낸 회비는 돌려받지 못한다고 적혀 있습니다.' : undefined,
    },
    ...(f.overseasJoin ? [{
      h: '해외 거주자용 "신규 입회" 버튼',
      p: ['회원 등록 칸의 버튼 두 개 중 "일본 이외에 거주하시는 분" 쪽 "신규 입회"를 누릅니다. 이 페이지 위의 "해외 거주자로 가입하기" 버튼이 같은 주소입니다.'],
      img: showImg ? { src: '/guides/plusmember/02-join-buttons-ko.jpg', w: 1400, h: 565, cap: shared('거주지별 회원 등록 버튼') } : undefined,
    }] : []),
    {
      h: 'Plus member ID 만들기(메일 주소)',
      p: [
        'Plus member ID는 PLUS MEMBER 팬클럽과 티켓 앱 チケプラ가 함께 쓰는 계정입니다. 다른 팬클럽이나 チケプラ를 써 봤다면 이미 있을 수 있으니 로그인해 보세요.',
        '예전에 "일본 거주"로 만든 ID는 해외로 바꿀 수 없습니다. 그런 ID가 있으면 다른 메일 주소로 새로 만드세요.',
        doms.length ? `메일 주소를 넣으면 가입 링크가 담긴 메일이 옵니다. ${doms.join(', ')} 에서 오는 메일을 받도록 설정해 두라고 안내합니다.` : '메일 주소를 넣고 등록 버튼을 누르면 가입 링크가 담긴 메일이 옵니다. 스팸함도 확인하세요.',
      ],
      img: showImg ? { src: '/guides/plusmember/03-email.jpg', w: 1400, h: 875, cap: shared('메일 주소 등록(일본어 화면)') } : undefined,
      src: ['sakaEn'],
      links: evLink(f, 'mail.domain', '이 팬클럽 FAQ: 메일 수신'),
    },
    {
      h: '회원 정보 입력',
      p: [
        '메일의 링크를 열고 이름, 생년월일, 성별, 전화번호, 주소, 비밀번호를 넣습니다.',
        ovs ? '국가는 목록에서 고릅니다. 해외 가입을 받는 팬클럽도 이 목록에 있는 나라에 사는 사람만 받습니다.' : '',
        '이름은 여권 영문 이름과 같게 넣습니다. 전자티켓 앱에 나오는 이름은 등록 뒤 스스로 바꿀 수 없습니다.',
        '전화번호는 +82를 고르고 010의 앞 0을 뺀 10-XXXX-XXXX로 넣습니다. 이 번호로 티켓 앱 SMS 인증을 받습니다.',
      ].filter(Boolean),
      src: ovs ? ['bnOvs', 'tixFaq'] : ['tixFaq'],
    },
    {
      h: '결제',
      p: [
        ovPay ? `해외 거주자 결제 수단: ${ovPay}.` : pay ? `결제 수단: ${pay}.` : '',
        (ovPay || pay) && /편의점|통신|d払い|au |소프트뱅크|PayPay|Pay-easy/.test(`${ovPay} ${pay}`) ? '일본 편의점·통신사·PayPay 결제는 일본 계좌·휴대폰이 필요해 한국에서는 신용카드로 냅니다.' : '',
        '카드 결제에는 3D Secure(카드사 본인 인증)가 필요하고, 대응하지 않는 카드는 결제되지 않습니다. 카드사 앱에서 해외 결제와 해외안심결제를 켜 두세요.',
        (ov?.debitNg || f.verdict?.debitNg) ? '체크카드·선불카드는 동작을 보증하지 않는다고 적혀 있습니다. 해외 결제 되는 신용카드를 쓰세요.' : '',
        (f.residence?.autoRenew || f.verdict?.autoRenew) ? `신용카드로 낸 회비는 자동 갱신됩니다.${day ? ` 끄려면 회원 기한이 끝나는 달 ${day}일까지 마이페이지에서 설정합니다.` : ''}` : '',
      ].filter(Boolean),
      src: ['pmStore'],
      links: [...evLink(f, 'pay.debitNg', '이 팬클럽 FAQ: 카드'), ...evLink(f, 'renew.auto', '이 팬클럽 안내: 자동 갱신')],
    },
    {
      h: '가입 뒤: 선행 신청과 전자티켓',
      p: [
        '팬클럽 사이트의 TICKET 메뉴에서 접수 기간에 선행을 신청합니다. 대부분 추첨이고 결과는 메일로 옵니다. 해외 회원이 신청할 수 있는 공연인지는 접수마다 조건에 적힙니다.',
        '전자티켓은 앱(팬클럽 공식 앱 또는 チケプラ)으로 받습니다. 로그인할 때 휴대폰 SMS 인증을 하고, 가족·친구 번호로 인증하면 티켓을 못 받습니다. 문자가 안 오면 해외 번호 문자 차단을 풀어 보세요.',
        f.verdict?.phoneJp ? '이 팬클럽은 일부 티켓 신청에 일본에서 개통한 전화번호가 필요하다고 적었습니다.' : '',
      ].filter(Boolean),
      src: ['tixGuide', 'tixFaq'],
      links: evLink(f, 'phone.jp', '이 팬클럽 FAQ: 일본 전화번호'),
    },
  ];
}

function familyclubSteps(): Step[] {
  const ja = getLocale() === 'ja';
  const cap = (s: string) => `${ja ? '画面' : '화면'}: FAMILY CLUB · ${s} · ${CHECKED.replace(/-/g, '.')}`;
  if (ja) return [
    { h: '日本在住が条件', p: ['会員規約第5条で「日本国内に居住し、国内郵便で配達可能な所在地に住所を持つこと」が会員の条件です。'], img: { src: '/guides/familyclub/02-residence-rule.jpg', w: 1400, h: 729, cap: cap('会員規約') }, src: ['famRule'] },
    { h: '入会手続き', p: ['メールアドレス入力 → 会員規約に同意 → 会員情報 → 入会金・年会費の支払い。支払いはクレジットカード・Pay-easy・コンビニ、事務手数料140円。'], img: { src: '/guides/familyclub/01-email.jpg', w: 1400, h: 875, cap: cap('新規入会 1/5') }, src: ['famPay'] },
  ];
  return [
    { h: '한국 거주자는 가입할 수 없습니다', p: ['FAMILY CLUB 회원 규약 제5조는 회원 조건으로 "일본 국내에 거주하고, 일본 국내 우편으로 받을 수 있는 주소가 있을 것"을 둡니다. 한국 주소로는 가입할 수 없습니다.', '한국 팬은 일반 예매(국내 공연은 국내 예매처, 일본 공연은 e+·ぴあ 일반 판매)를 이용하세요.'], img: { src: '/guides/familyclub/02-residence-rule.jpg', w: 1400, h: 729, cap: cap('회원 규약 제5조') }, src: ['famRule'] },
    { h: '일본에 사는 경우의 가입 순서', p: ['메일 주소 입력 → 회원 규약 동의 → 회원 정보 입력 → 입회금·연회비 결제(신용카드·Pay-easy·편의점, 사무 수수료 140엔) 순서입니다.'], img: { src: '/guides/familyclub/01-email.jpg', w: 1400, h: 875, cap: cap('신규 입회 1/5 단계') }, src: ['famPay'] },
  ];
}

function weverseSteps(f: GuideFacts, club: string, fx: { jpyKrw?: number } | null, isExample: boolean, shared = false): Step[] {
  const showImg = !isExample || shared;
  const ja = getLocale() === 'ja';
  const ex = isExample ? (ja ? '画面例: aespa「MY-J」MEMBERSHIP (JP)' : '화면 예시: aespa 「MY-J」 MEMBERSHIP (JP)') : (ja ? '画面' : '화면');
  const cap = (x: string) => `${ex} · ${x} · ${CHECKED.replace(/-/g, '.')}`;
  const fee = f.fees?.annual ? amt({ v: f.fees.annual, cur: 'JPY' }, fx) : '';
  const per = (f as GuideFacts & { period?: string | null }).period;
  if (ja) return [
    { h: '会費と会員期間を確認', p: [fee ? `${club}: 年会費 ${fee}${per ? ` · ${per}` : ''}` : '会費はWeverse Shopの商品ページに記載されています。', '同じアーティストでも GLOBAL / JAPAN などショップ別にメンバーシップがあり、特典が異なります。'], img: showImg ? { src: '/guides/weverse/01-fee.jpg', w: 1367, h: 1400, cap: cap('会費・期間') } : undefined, src: ['wvCampaign', 'wvMulti'] },
    { h: 'Weverse Accountを登録', p: ['メールアドレスはアカウント作成後に変更できません。キャリアメールではなく Gmail などPCメールでの登録が推奨されています。'], img: showImg ? { src: '/guides/weverse/02-steps.jpg', w: 1336, h: 1400, cap: cap('入会方法 STEP1・2') } : undefined, src: ['wvCampaign'] },
    { h: 'Weverse Shopで購入', p: ['商品ページの「購入する」から決済します。1つのアカウントで同じ地域のメンバーシップに重複入会はできません。購入後7日以内で特典未使用ならキャンセルできます。'], img: showImg ? { src: '/guides/weverse/03-shop.jpg', w: 1400, h: 825, cap: cap('Weverse Shop 商品ページ') } : undefined, src: ['wvShop'] },
    { h: '支払い', p: ['JAPANショップ(円): クレジットカード(JCB・VISA・Mastercard・AMEX・Diners)、コンビニ払い、PayPay・メルペイ・au PAY・楽天ペイ、PayPal、Weverse Shopキャッシュ。ブランドマーク付きデビットカードも利用可と案内されています。'], src: ['wvPay', 'wvCard'] },
    { h: 'ファンクラブサイトに情報を登録', p: ['購入したWeverse Accountでファンクラブサイトにログインし、お客様情報を登録します。登録しないと一部特典が受けられません。'], src: ['wvCampaign'] },
    { h: '更新と先行予約', p: ['更新は有効期限の60日前から期限後30日まで。先行予約は公演ごとのお知らせにある期限・方法に従って申し込みます。'], src: ['wvCampaign', 'wvHelp'] },
  ];
  return [
    { h: '요금과 회원 기간 확인', p: [fee ? `${club}: 연회비 ${fee}${per ? ` · ${per.replace(/入会日(?:より|から)\s*365\s*日/, '가입일부터 365일')}` : ''}` : '멤버십 가격은 Weverse Shop 상품 페이지에 나옵니다.', '같은 아티스트도 GLOBAL·JAPAN 등 국가 샵별로 멤버십이 따로 있고 혜택이 다릅니다. 2024년 3월 20일부터 한 계정으로 여러 국가 샵 멤버십을 가질 수 있습니다.'], img: showImg ? { src: '/guides/weverse/01-fee.jpg', w: 1367, h: 1400, cap: cap('회비·기간(일본어 화면)') } : undefined, src: ['wvCampaign', 'wvMulti'] },
    { h: 'Weverse 계정 만들기', p: ['계정 메일 주소는 만든 뒤 바꿀 수 없습니다. 통신사 메일보다 Gmail 같은 주소가 권장됩니다.'], img: showImg ? { src: '/guides/weverse/02-steps.jpg', w: 1336, h: 1400, cap: cap('입회 방법 STEP 1·2(일본어 화면)') } : undefined, src: ['wvCampaign'] },
    { h: 'Weverse Shop에서 구매', p: ['상품 페이지의 "구매하기"로 결제합니다. 한 계정으로 같은 국가 샵 멤버십을 두 번 살 수 없고, 구매 후 7일 이내·혜택 미사용이면 취소할 수 있습니다. 같은 샵에서 다른 멤버십을 새로 사면 기존 것은 없어집니다.'], img: showImg ? { src: '/guides/weverse/03-shop-ko.jpg', w: 1400, h: 825, cap: cap('Weverse Shop 상품 페이지') } : undefined, src: ['wvShop', 'wvMulti'] },
    { h: '결제', p: ['GLOBAL 샵(원화): 국내 체크·신용카드, 위버스카드, 카카오페이, 네이버페이, 토스페이 등. 해외 결제는 PayPal·Eximbay 등.', 'JAPAN 샵(엔화): 신용카드(JCB·VISA·Master·AMEX·Diners), 일본 편의점, PayPay 등. 한국에서 발급한 카드로 JAPAN 샵을 결제할 수 있다는 안내도, 안 된다는 안내도 Weverse 고객센터에는 없습니다. 카드가 거절되면 카드사 앱에서 해외 결제·해외안심결제가 켜져 있는지부터 보세요.'], src: ['wvPay', 'wvCard'] },
    { h: '팬클럽 사이트에 정보 등록', p: ['JAPAN 멤버십은 산 계정으로 팬클럽 사이트에 로그인해 회원 정보를 등록해야 일부 혜택을 받습니다. 배송이 필요한 특전은 일본 국내 주소가 있어야 합니다.'], src: ['wvCampaign', 'wvShop'] },
    { h: '갱신과 선예매', p: ['갱신은 유효 기간 만료 60일 전부터 만료 후 30일까지. 2026년 9월 3일부터 자동 결제도 고를 수 있습니다. 선예매는 공연마다 공지되는 멤버십 인증 기한과 방법을 따릅니다.'], src: ['wvCampaign', 'wvAuto', 'wvHelp'] },
  ];
}

function genericSteps(f: GuideFacts, club: string, fx: { jpyKrw?: number } | null): Step[] {
  const ja = getLocale() === 'ja';
  const fee = [f.fees?.annual ? `${ja ? '年会費' : '연회비'} ${amt({ v: f.fees.annual, cur: 'JPY' }, fx)}` : '', f.fees?.monthly ? `${ja ? '月会費' : '월회비'} ${amt({ v: f.fees.monthly, cur: 'JPY' }, fx)}` : '', f.fees?.joinFee ? `${ja ? '入会金' : '입회금'} ${amt({ v: f.fees.joinFee, cur: 'JPY' }, fx)}` : '', f.fees?.handlingFee ? `${ja ? '事務手数料' : '사무 수수료'} ${amt({ v: f.fees.handlingFee, cur: 'JPY' }, fx)}` : ''].filter(Boolean).join(' · ');
  const ov = f.overseas === 'yes' || f.verdict?.overseas === 'yes' ? 'yes' : f.overseas === 'no' || f.verdict?.overseas === 'no' ? 'no' : f.verdict?.overseas === 'limited' ? 'limited' : null;
  const doms = evDomains(f);
  const day = evRenewDay(f);
  if (ja) return [
    { h: '入会ページを開く', p: [`${club}の入会ページから始めます。`] },
    { h: '会費と支払い', p: [fee ? `会費: ${fee}` : '会費の記載を読み取れませんでした。', f.payments.length ? `支払い: ${f.payments.join('・')}` : ''].filter(Boolean) },
    { h: '先行申込', p: ['会員サイトのチケットメニューから受付期間中に申し込みます。'] },
  ];
  const pay = f.payments.length ? payKo(cleanPays(f.payments)) : [];
  return [
    {
      h: ov === 'no' ? '한국 거주자는 가입할 수 없습니다' : '가입 페이지 열기',
      p: [
        ov === 'no' ? `${club} 안내에 일본 국내 거주·일본 주소가 가입 조건으로 적혀 있습니다(위 "가입 조건"의 원문). 한국에서는 일반 예매(한국 공연은 국내 예매처, 일본 공연은 해외용 예매 사이트)를 이용하세요.`
          : ov === 'limited' ? `${club}은(는) 일본 국내용 서비스라 해외 이용은 동작을 보증하지 않는다고 적었습니다. 가입은 되더라도 결제·앱 문제는 스스로 해결해야 하고, 문의는 일본어로만 받습니다.`
            : `${club} 가입 페이지(新規入会·会員登録)에서 시작합니다. 일본어 화면이면 브라우저 번역을 켜세요.`,
        f.globalSite ? `해외 팬용 사이트가 따로 있습니다: ${f.globalSite.label || f.globalSite.url}` : '',
      ].filter(Boolean),
      links: [...evLink(f, ov === 'no' ? 'overseas.no' : ov === 'limited' ? 'overseas.unsupported' : 'overseas.yes', '이 팬클럽 원문'), ...(f.globalSite ? [{ label: '해외 팬용 사이트', url: f.globalSite.url }] : [])],
    },
    ...(ov === 'no' ? [] : [
      {
        h: '계정 만들기',
        p: [
          doms.length ? `메일 주소로 계정을 만듭니다. ${doms.join(', ')} 에서 오는 메일을 받을 수 있게 해 두라고 안내합니다.` : '메일 주소로 계정을 만들고, 받은 메일의 링크로 회원 정보를 입력합니다. 가입 메일이 스팸함으로 가는 경우가 많으니 함께 확인하세요.',
          '이름은 여권 영문 이름과 같게, 전화번호는 +82를 고르고 010의 앞 0을 뺀 10-XXXX-XXXX로 넣습니다.',
        ],
        links: evLink(f, 'mail.domain', '이 팬클럽 FAQ: 메일 수신'),
      },
      {
        h: '회비와 결제',
        p: [
          fee ? `회비: ${fee}.` : '가입 페이지에서 금액을 읽지 못했습니다.',
          pay.length ? `결제 수단: ${pay.join(' · ')}.` : '',
          pay.some((x) => /편의점|통신|d払い|au |소프트뱅크|PayPay|Pay-easy/.test(x)) ? '편의점·통신사·PayPay 결제는 일본 계좌·휴대폰이 필요해 한국에서는 신용카드로 냅니다.' : '',
          f.verdict?.debitNg ? '체크카드·선불카드는 동작을 보증하지 않는다고 적혀 있습니다.' : '',
          f.verdict?.autoRenew ? `카드로 낸 회비는 자동 갱신됩니다.${day ? ` 끄려면 회원 기한이 끝나는 달 ${day}일까지 설정합니다.` : ''}` : '',
        ].filter(Boolean),
        links: [...evLink(f, 'pay.debitNg', '이 팬클럽 FAQ: 카드'), ...evLink(f, 'renew.auto', '이 팬클럽 안내: 자동 갱신')],
      },
      {
        h: '선행 신청',
        p: ['회원 사이트의 티켓 메뉴에서 접수 기간에 신청합니다. 대부분 추첨이고 결과는 메일로 옵니다.', f.verdict?.phoneJp ? '일부 티켓 신청에는 일본에서 개통한 전화번호가 필요하다고 적혀 있습니다.' : ''].filter(Boolean),
        links: evLink(f, 'phone.jp', '이 팬클럽 FAQ: 전화번호'),
      },
    ]),
  ];
}

export function guideSteps(p: PlatformId, f: GuideFacts, club: string, fx: { jpyKrw?: number } | null, { isExample = true, shared = false } = {}): Step[] {
  if (p === 'plusmember') return plusmemberSteps(f, club, fx, isExample, shared);
  if (p === 'familyclub') return familyclubSteps();
  if (p === 'weverse') return weverseSteps(f, club, fx, isExample, shared);
  return genericSteps(f, club, fx);
}

export function srcLinks(keys: SrcKey[] = []) {
  const ja = getLocale() === 'ja';
  return keys.map((k) => ({ label: ja ? SRC[k].ja : SRC[k].ko, url: SRC[k].url }));
}

export function stepsHtml(steps: Step[]) {
  const ja = getLocale() === 'ja';
  return `<ol class="doc-steps">${steps.map((s, i) => `<li>
    <h4><span class="doc-n">${i + 1}.</span>${esc(s.h)}</h4>
    ${s.p.map((x) => `<p>${esc(x)}</p>`).join('')}
    ${s.warn ? `<p class="doc-warn">${esc(s.warn)}</p>` : ''}
    ${s.img ? `<figure class="doc-shot"><a href="${esc(s.img.src)}" target="_blank" rel="noopener"><img src="${esc(s.img.src)}" alt="${esc(s.h)}" width="${s.img.w}" height="${s.img.h}" loading="lazy" decoding="async"></a><figcaption>${esc(s.img.cap)}</figcaption></figure>` : ''}
    ${s.src?.length || s.links?.length ? `<p class="doc-src">${ja ? '出典' : '출처'} ${[...(s.links || []), ...srcLinks(s.src)].map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}${icon('i-ext', 'ic xs')}</a>`).join('')}</p>` : ''}
  </li>`).join('')}</ol>`;
}
