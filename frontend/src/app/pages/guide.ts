/* 예매 가이드 — 예매처 공식 도움말·상품 페이지에서 확인한 것만 적는다. 문단마다 출처 링크.
 *  일본 공연: e+ 이용 가이드·FAQ, e+ 해외 FAQ(ib.eplus.jp), e+ 스마치케 안내, 티켓피아 전화번호 인증 도움말
 *  한국 공연: NOL·멜론티켓 상품 페이지의 외국인 예매 연결, 멜론티켓 수령 안내 */
import { state } from '../state';
import { t, getLocale } from '../i18n';
import { esc, icon } from '../ui';
import { api } from '../../api';
import { platformOf, guideSteps, stepsHtml, PLATFORM_NAME, CHECKED } from '../fcguide';
import type { PlatformId, GuideFacts } from '../fcguide';
import { PLATFORM_KNOW, prepCards, prepHtml, platformNotesHtml, KNOW_CHECKED } from '../fcknow';
import type { PlatKey } from '../fcknow';
import { safeExternal } from './_safety';

type Block = { h: string; items: string[]; src: [string, string][] };
type Tab = 'jp' | 'kr' | 'fc';

const KO: Record<Tab, { title: string; lead: string; blocks: Block[] }> = {
  jp: {
    title: '일본 공연 예매',
    lead: '일본 공연은 팬클럽 선행 → 예매처 선행 추첨 → 일반 발매 순서로 팔리는 경우가 많습니다. 추첨은 기간 안에 신청하면 되고, 일반 발매는 오픈 시각에 먼저 결제한 순서입니다.',
    blocks: [
      { h: '판매 방식', items: ['プレオーダー(추첨): 접수 기간 안에 신청 → 결과 발표 → 당첨되면 기한 안에 결제', '先着(선착): 오픈 시각부터 먼저 결제한 순서로 판매', '팬클럽 선행 등 예매처 사이트에서 검색되지 않는 접수도 있습니다'], src: [['e+ 이용 가이드', 'https://eplus.jp/sf/guide/service']] },
      { h: 'e+(イープラス) 가입', items: ['메일 인증 → 이름 등 입력 → 휴대폰 번호 입력 후 화면의 인증 번호로 전화를 걸면 가입 완료', 'e+는 원칙적으로 일본 국내용이라 가입할 때 일본 국내 휴대폰이 필요합니다', '해외 거주자는 해외용 사이트 eplus.tickets에서 살 수 있습니다(일부 공연만)', '해외용 사이트 결제: 해외 발급 VISA·Mastercard, Alipay'], src: [['e+ 해외 거주 FAQ', 'https://support-qa.eplus.jp/hc/ja/articles/360041176854'], ['e+ 해외용 FAQ', 'https://ib.eplus.jp/faq'], ['eplus.tickets', 'https://eplus.tickets/en/']] },
      { h: 'e+ 스마치케(전자 티켓)', items: ['신청할 때 수령 방법을 스마치케로 고르고, 안내 메일이 오면 e+ 앱에 티켓을 내려받습니다', 'iOS 16 이상, Android 10 이상 스마트폰. 해외 단말은 쓸 수 없는 경우가 있습니다', '입장할 때 앱 화면을 보여 줍니다. 스크린숏으로는 입장할 수 없습니다'], src: [['e+ 스마치케 안내', 'https://eplus.jp/sf/guide/spticket']] },
      { h: '티켓피아(チケットぴあ)', items: ['회원 가입 때, 그리고 아직 인증하지 않았다면 구매 때 전화번호 인증이 필요합니다(화면에 나온 번호로 전화를 걸어 확인)', '전자 티켓은 공연마다 조건이 다릅니다. Lilac 공연 상세에 그 공연의 조건(일본 휴대폰 번호 필요 등)을 따로 표시합니다'], src: [['티켓피아 전화번호 인증', 'https://t.pia.jp/guide/tel-auth.jsp']] },
    ],
  },
  kr: {
    title: '한국 공연 예매',
    lead: '한국 공연은 주로 NOL 티켓(인터파크)·멜론티켓·YES24 티켓·티켓링크에서 선착순으로 팝니다. 같은 공연을 여러 곳에서 팔면 Lilac 공연 상세의 "다른 예매처"에 함께 표시합니다. 외국인 예매 경로가 있는 공연은 상품 페이지에 따로 연결됩니다.',
    blocks: [
      { h: '외국인 예매', items: ['NOL 티켓: 상품 페이지의 "For international users" → NOL World(영어·일본어·중국어)', '멜론티켓: 상품 페이지의 "Foreigner / 外國人" → Melon Ticket Global', 'Lilac 공연 상세에서 그 공연에 외국인 예매 연결이 있는지 표시합니다'], src: [['NOL World', 'https://world.nol.com/'], ['Melon Ticket Global', 'https://tkglobal.melon.com/main/index.htm?langCd=EN']] },
      { h: '인증예매·수령', items: ['멜론티켓 "인증예매" 표시 공연은 본인 인증을 한 회원만 예매할 수 있습니다', '현장수령: 예매번호가 있는 예매확인서와 예매자 실물 신분증(사본·사진 불가)을 매표소에 제출', '배송: 배송이 시작된 뒤 취소하려면 티켓을 반송해야 합니다'], src: [['멜론티켓', 'https://ticket.melon.com/main/index.htm']] },
      { h: '취소 수수료', items: ['공연마다 다릅니다. NOL 티켓 상품은 관람일 기준으로 구간별 수수료가 붙고, Lilac 공연 상세에 그 공연의 규정을 옮겨 둡니다'], src: [['NOL 티켓', 'https://nol.yanolja.com/ticket']] },
    ],
  },
  fc: {
    title: '팬클럽 선행',
    lead: '일본 아티스트의 큰 공연은 공식 팬클럽 회원 선행이 1차 판매인 경우가 많습니다. 예매처에 올라오지 않는 접수도 있어 팬클럽 가입이 가장 확실한 경로입니다.',
    blocks: [
      { h: '가입과 신청', items: ['공식 팬클럽 가입 페이지(新規入会)에서 회원 ID를 만들고 연회비·월회비 코스를 결제', '팬클럽 사이트의 티켓 메뉴에서 접수 기간 안에 신청. 대부분 추첨이고 결과는 메일', '접수 기간 중에 가입해도 신청할 수 있는 팬클럽이 있습니다(공연 상세에 표시)'], src: [] },
      { h: '자주 붙는 조건', items: ['동행자도 회원이어야 하는 접수', '입장자 전원 얼굴 사진 사전 등록', '해외 거주자 전용 선행(일본 번호 없이 신청 가능)을 따로 여는 팬클럽도 있습니다'], src: [] },
    ],
  },
};
const JA: Record<Tab, { title: string; lead: string; blocks: Block[] }> = {
  kr: {
    title: '韓国公演のチケット',
    lead: '韓国の公演は主にNOLチケット(インターパーク)・メロンチケット・YES24チケット・チケットリンクで先着販売されます。複数のプレイガイドで扱う公演はLilacの公演詳細「ほかのプレイガイド」にまとめて表示します。海外向け予約がある公演は商品ページから専用サイトにつながります。',
    blocks: [
      { h: '海外からの予約', items: ['NOLチケット: 商品ページの「For international users」→ NOL World(英語・日本語・中国語)', 'メロンチケット: 商品ページの「Foreigner / 外國人」→ Melon Ticket Global', 'Lilacの公演詳細で、その公演に海外向け予約があるかを表示します'], src: [['NOL World', 'https://world.nol.com/'], ['Melon Ticket Global', 'https://tkglobal.melon.com/main/index.htm?langCd=EN']] },
      { h: '本人認証・受け取り', items: ['メロンチケットの「인증예매(認証予約)」公演は本人認証済みの会員のみ予約できます', '現地受け取り: 予約番号入りの予約確認書と予約者本人の身分証(原本)を提示'], src: [['メロンチケット', 'https://ticket.melon.com/main/index.htm']] },
    ],
  },
  jp: {
    title: '日本公演のチケット',
    lead: 'ファンクラブ先行 → プレイガイド先行(抽選)→ 一般発売の順が一般的です。',
    blocks: [
      { h: '販売方式', items: ['プレオーダー(抽選): 受付期間内に申込 → 当落発表 → 期限内に支払い', '先着: 発売時刻から先着順'], src: [['e+ ご利用ガイド', 'https://eplus.jp/sf/guide/service']] },
      { h: 'スマチケ', items: ['iOS16以降・Android10以降。スクリーンショットでは入場できません'], src: [['e+ スマチケ', 'https://eplus.jp/sf/guide/spticket']] },
    ],
  },
  fc: {
    title: 'ファンクラブ先行',
    lead: '大きな公演はファンクラブ会員先行が最初の販売であることが多いです。',
    blocks: [
      { h: '入会と申込', items: ['公式ファンクラブの新規入会でIDを作り、年会費・月会費コースを支払い', 'ファンクラブサイトのチケットメニューから受付期間内に申込(多くは抽選)'], src: [] },
    ],
  },
};

/* 도움말 문서 형태: 왼쪽 목차, 오른쪽 본문. 팬클럽 가입은 플랫폼별 실제 화면 캡처 가이드 */
const PLATS: PlatformId[] = ['plusmember', 'weverse', 'familyclub'];
interface FcRowLite { artistId: string; artist: string; artistLatin?: string | null; found: boolean; name?: string | null; entry?: string; home?: string; platform?: string | null; overseas?: string; languages?: string[]; payments?: string[]; fees?: GuideFacts['fees']; residence?: GuideFacts['residence']; overseasJoin?: string | null }

export async function renderGuide(root: HTMLElement, sub?: string, sub2?: string, alive: () => boolean = () => true) {
  const ja = getLocale() === 'ja';
  const order: Tab[] = state.edition === 'jp' ? ['kr', 'fc', 'jp'] : ['jp', 'fc', 'kr'];
  const plat = sub === 'fc' && PLATS.includes(sub2 as PlatformId) ? (sub2 as PlatformId) : null;
  const tab: Tab = sub === 'jp' || sub === 'kr' || sub === 'fc' ? sub : order[0];
  const D = ja ? JA : KO;
  const toc = `<nav class="doc-toc" aria-label="${t('nav.guide')}">
    <p class="doc-toc-h">${t('nav.guide')}</p>
    <ul>${order.map((k) => `<li><a href="#/guide/${k}" class="${k === tab && !plat ? 'on' : ''}"${k === tab && !plat ? ' aria-current="page"' : ''}>${esc(D[k].title)}</a></li>`).join('')}</ul>
    <p class="doc-toc-h">${ja ? 'ファンクラブ入会' : '팬클럽 가입 방법'}</p>
    <ul>${PLATS.map((p) => `<li><a href="#/guide/fc/${p}" class="${p === plat ? 'on' : ''}"${p === plat ? ' aria-current="page"' : ''}>${esc(PLATFORM_NAME[p])}</a></li>`).join('')}</ul>
  </nav>`;
  if (plat) {
    root.innerHTML = `<div class="doc">${toc}<article class="doc-body"><p class="doc-kicker">${ja ? 'ファンクラブ入会' : '팬클럽 가입 방법'}</p><h1>${esc(PLATFORM_NAME[plat])}</h1><div id="docPlat"><div class="sk sk-block"></div></div></article></div>`;
    const [list, fx] = await Promise.all([
      api(`/api/live/fanclub-list?edition=${state.edition === 'jp' ? 'jp' : state.edition}`).catch(() => ({ items: [] })),
      api('/api/live/fx').catch(() => null),
    ]);
    if (!alive()) return;
    const rows: FcRowLite[] = (list.items || []).filter((x: FcRowLite) => x.found && platformOf({ platform: x.platform, entry: x.entry, home: x.home }) === plat);
    /* 플랫폼 공통 흐름: 특정 팬클럽 값 없이. 금액·결제 수단은 팬클럽 상세에서 그 팬클럽 값으로 보여 준다 */
    const facts: GuideFacts = { name: null, platform: PLATFORM_NAME[plat], overseas: plat === 'familyclub' ? 'no' : 'yes', languages: ['한국어'], payments: [], fees: null, residence: null, overseasJoin: null };
    const club = ja ? 'ファンクラブ' : '팬클럽';
    const intro = plat === 'plusmember'
      ? (ja ? 'Fanplusが運営する会員システム。入会ページのURLが /feature/entry で終わるファンクラブの多くがこれです。' : 'Fanplus가 운영하는 일본 팬클럽 회원 시스템입니다. 가입 페이지 주소가 /feature/entry로 끝나는 팬클럽 대부분이 여기에 속합니다. 아래 순서는 모든 PLUS MEMBER 팬클럽에 공통인 흐름입니다. 팬클럽마다 다른 요금·해외 가입 여부·결제 수단은 각 팬클럽 상세 페이지에 그 팬클럽 안내 원문과 함께 있습니다.')
      : plat === 'familyclub'
        ? (ja ? 'STARTO ENTERTAINMENT所属アーティストのファンクラブ。' : 'STARTO ENTERTAINMENT 소속 아티스트(SixTONES, Snow Man 등)의 팬클럽입니다.')
        : (ja ? 'HYBE系などK-POPアーティストの公式メンバーシップ。' : 'K-POP 아티스트 공식 멤버십이 판매되는 Weverse Shop 기준입니다.');
    root.querySelector('#docPlat')!.innerHTML = `<p class="doc-lead">${esc(intro)}</p>
      ${rows.length ? `<p class="doc-who"><b>${ja ? 'このシステムのファンクラブ' : '이 시스템을 쓰는 팬클럽'}</b> ${rows.map((x) => `<a href="#/artist/${encodeURIComponent(x.artistId)}?fc=1">${esc(ja && x.artistLatin ? x.artistLatin : x.artist)}${x.name ? ` <small>${esc(x.name)}</small>` : ''}</a>`).join('')}</p>` : ''}
      ${stepsHtml(guideSteps(plat, facts, club, fx, { isExample: true, shared: true }))}
      ${platformNotesHtml((plat === 'plusmember' ? 'PLUS MEMBER' : plat === 'familyclub' ? 'FAMILY CLUB' : 'Weverse') as PlatKey)}
      <p class="src-note">${ja ? '確認日' : '확인한 날'} ${CHECKED.replace(/-/g, '.')}</p>`;
    return;
  }
  const doc = D[tab];
  root.innerHTML = `<div class="doc">${toc}<article class="doc-body">
    <p class="doc-kicker">${t('nav.guide')}</p>
    <h1>${esc(doc.title)}</h1>
    <p class="doc-lead">${esc(doc.lead)}</p>
    ${doc.blocks.map((b) => `<section class="doc-sec">
      <h2>${esc(b.h)}</h2>
      <ul class="doc-list">${b.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${b.src.length ? `<p class="doc-src">${t('guide.src')} ${b.src.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}${icon('i-ext', 'ic xs')}</a>`).join('')}</p>` : ''}
    </section>`).join('')}
    ${tab === 'fc' ? `<section class="doc-sec"><h2>${ja ? 'システム別の海外入会' : '팬클럽 시스템별 해외 가입'}</h2>
      <table class="pdp-table"><thead><tr><th scope="col">${ja ? 'システム' : '시스템'}</th><th scope="col">${ja ? '海外入会' : '한국에서 가입'}</th><th scope="col">${ja ? '内容' : '내용'}</th></tr></thead><tbody>
      ${(Object.keys(PLATFORM_KNOW) as PlatKey[]).filter((k) => PLATFORM_KNOW[k]?.overseas).map((k) => { const o = PLATFORM_KNOW[k]!.overseas!; return `<tr><th scope="row">${esc(k)}</th><td>${o.v === 'yes' ? (ja ? '可' : '가능') : o.v === 'no' ? (ja ? '不可' : '불가') : (ja ? 'クラブごと' : '팬클럽마다 다름')}</td><td>${esc(ja ? o.ja : o.ko)} <a href="${esc(safeExternal(o.src.url))}" target="_blank" rel="noopener">${esc(ja ? o.src.ja : o.src.ko)}${icon('i-ext', 'ic xs')}</a></td></tr>`; }).join('')}
      </tbody></table>
      <ul class="doc-list">${PLATS.map((p) => `<li><a href="#/guide/fc/${p}">${esc(PLATFORM_NAME[p])} ${ja ? '入会の流れ' : '가입 순서'}</a></li>`).join('')}</ul></section>
      ${ja ? '' : `<section class="doc-sec"><h2>한국에서 가입 전 준비</h2><p class="doc-lead">카드사·행정안전부·예매처 공식 안내로 정리했습니다(${KNOW_CHECKED.replace(/-/g, '.')} 확인).</p>${prepHtml(prepCards(null, null))}</section>`}` : ''}
  </article></div>`;
}
