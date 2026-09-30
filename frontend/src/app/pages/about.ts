/* 서비스 소개 · 자주 묻는 질문 — 예전 마케팅 랜딩(사이트 모드) 대신 앱 안의 도움말 문서로.
   지금 실제로 하는 일과 데이터 출처만 적는다(구매 대행·크레딧 같은 v5 데모 설명은 뺐다). */
import { getLocale } from '../i18n';
import { esc } from '../ui';

type Row = [string, string, string];
const KO = {
  about: {
    title: '서비스 소개',
    lead: 'Lilac은 한국의 J-POP 팬과 일본의 K-POP 팬이 바다 건너 공연·팬클럽·음반 정보를 확인하는 곳입니다. 예매와 결제는 각 공식 사이트에서 합니다.',
    does: ['내한·来日 공연과 현지 공연(원정), 티켓 오픈 시각을 예매처에서 실시간으로 모읍니다.', '공식 팬클럽의 회비·해외 가입 조건·선행 접수를 가입 페이지에서 읽고, 가입 순서를 실제 화면으로 안내합니다.', '앨범·굿즈는 실제 판매처 검색 결과를 보여 주고 구매는 판매처로 연결합니다.', '아티스트마다 갤러리(게시판)가 있고, 공연·앨범·곡에 좋아요와 댓글을 남길 수 있습니다.'],
    doesnt: ['티켓·상품을 직접 팔거나 대신 사 주지 않습니다.', '티켓 양도·재판매를 중개하지 않습니다. 일본은 입장권 부정 전매를 법으로 금지합니다(2019년 시행).', '못 읽은 값(요금·조건)은 추측해서 채우지 않고 "가입 페이지 기준", "원문 확인"으로 둡니다.'],
    editions: [['한국 · J-POP', '한국에 사는 J-POP 팬', '내한 공연, 일본 원정, 일본 팬클럽, 일본반 판매처, 일본 차트'], ['日本 · K-POP', '일본에 사는 K-POP 팬', '来日 공연, 渡韓, Weverse 멤버십, 한국반 판매처, 한국 차트'], ['전체', '양쪽을 다 보는 팬', '한국에서 열리는 공연 / 일본에서 열리는 공연으로 나눠 봄']] as Row[],
    sources: [['공연·티켓', 'NOL 티켓(인터파크), 멜론티켓, e+, チケットぴあ 목록·상품 페이지', '30~90분'], ['팬클럽', '각 아티스트 공식 사이트·팬클럽 가입 페이지', '6시간'], ['소식', 'Google 뉴스(한국어·일본어)', '30분'], ['앨범·굿즈', '알라딘, HMV&BOOKS online, Ktown4u 검색', '30분'], ['차트', 'Billboard JAPAN, Oricon, Melon 등 공개 차트, Apple Music 피드', '3시간'], ['아티스트', 'Deezer 사진, 위키백과, MusicBrainz, Apple Music', '7일']] as Row[],
    contact: '잘못된 정보나 제휴 문의는 문의 페이지로 보내 주세요.',
  },
  faq: [
    ['Lilac에서 티켓을 살 수 있나요?', '아니요. 공연 상세의 예매 버튼은 그 공연을 파는 예매처(NOL 티켓, 멜론티켓, e+, チケットぴあ, 팬클럽 사이트)의 상품 페이지로 연결됩니다. 결제와 취소는 그 사이트 규정을 따릅니다.'],
    ['팬클럽 가입은 어떻게 하나요?', '아티스트 화면의 "공식 팬클럽"에 해외 거주자 요금, 결제 수단, 가입 순서(실제 화면)가 있습니다. 팬클럽 메뉴에서 해외 가입 가능 여부로 모아 볼 수도 있습니다.'],
    ['한국 카드로 일본 팬클럽 회비를 낼 수 있나요?', '팬클럽마다 다릅니다. PLUS MEMBER 계열의 해외 거주자 코스는 신용카드 결제를 받고, 체크·선불카드는 동작을 보장하지 않는다고 안내합니다. FAMILY CLUB(STARTO 소속)은 일본 거주자만 가입할 수 있습니다.'],
    ['팬클럽 요금이 "가입 페이지 기준"으로 나옵니다.', '가입 페이지가 스크립트로 그려지거나 요금이 이미지로만 있어 읽지 못한 경우입니다. 틀린 숫자를 보여 주지 않으려고 비워 둡니다.'],
    ['공연 정보가 예매처와 다릅니다.', '예매처 목록은 30~90분마다 다시 읽습니다. 그 사이 바뀐 내용은 공연 상세의 "원문" 링크로 확인하세요.'],
    ['갤러리에 익명으로 쓸 수 있나요?', '로그인한 회원만 쓸 수 있고, 익명(ㅇㅇ)을 고르면 닉네임 대신 ㅇㅇ과 네 자리 기호가 붙습니다. 같은 사람이 같은 갤러리에서 쓰면 기호가 같습니다.'],
    ['추천을 누르면 어떻게 되나요?', '추천을 3개 이상 받은 글은 개념글이 되고 커뮤니티 첫 화면의 실시간 개념글에 올라갑니다. 한 글에 추천이나 비추 중 하나만 누를 수 있습니다.'],
    ['티켓 오픈 알림을 받을 수 있나요?', '아직 푸시·메일 알림은 없습니다. 아티스트를 팔로우하면 MY에서 그 아티스트의 티켓 오픈·공연·소식을 모아 볼 수 있습니다.'],
  ] as [string, string][],
};
const JA: typeof KO = {
  about: {
    title: 'サービス紹介',
    lead: 'Lilacは、日本のK-POPファンと韓国のJ-POPファンが、海の向こうの公演・ファンクラブ・CD情報をまとめて確認できるサービスです。予約と支払いは各公式サイトで行います。',
    does: ['来日・渡韓公演とチケット発売日時をプレイガイドから随時集めます。', '公式ファンクラブの会費・海外入会条件・先行受付を入会ページから読み取り、入会手順を実際の画面で案内します。', 'CD・グッズは実際の販売店の検索結果を表示し、購入は販売店へつなぎます。', 'アーティストごとのギャラリー(掲示板)と、公演・アルバム・曲へのいいね・コメント。'],
    doesnt: ['チケット・商品の販売や代理購入はしません。', 'チケットの譲渡・転売の仲介はしません(チケット不正転売禁止法)。', '読み取れなかった値は推測で埋めず「入会ページ参照」「原文を確認」と表示します。'],
    editions: [['한국 · J-POP', '韓国在住のJ-POPファン', '来韓公演、日本遠征、日本のファンクラブ、日本盤、日本チャート'], ['日本 · K-POP', '日本在住のK-POPファン', '来日公演、渡韓、Weverseメンバーシップ、韓国盤、韓国チャート'], ['전체', '両方を見るファン', '韓国開催/日本開催で分けて表示']] as Row[],
    sources: [['公演・チケット', 'NOLチケット、メロンチケット、e+、チケットぴあ', '30〜90分'], ['ファンクラブ', '各公式サイト・入会ページ', '6時間'], ['ニュース', 'Googleニュース(韓国語・日本語)', '30分'], ['CD・グッズ', 'アラジン、HMV&BOOKS online、Ktown4u', '30分'], ['チャート', 'Billboard JAPAN、オリコン、Melonなど公開チャート', '3時間'], ['アーティスト', 'Deezer、Wikipedia、MusicBrainz、Apple Music', '7日']] as Row[],
    contact: '誤った情報や提携のお問い合わせはお問い合わせページへ。',
  },
  faq: [
    ['Lilacでチケットを買えますか？', 'いいえ。公演詳細の購入ボタンは、その公演を販売するプレイガイドやファンクラブサイトの商品ページにつながります。'],
    ['ファンクラブの入会方法は？', 'アーティスト画面の「公式ファンクラブ」に会費・支払い方法・入会手順があります。'],
    ['ギャラリーに匿名で書けますか？', 'ログイン会員のみ投稿でき、匿名(ㅇㅇ)を選ぶとニックネームの代わりにㅇㅇと4桁の記号が付きます。'],
    ['発売通知は届きますか？', 'プッシュ・メール通知はまだありません。フォローしたアーティストの情報はマイページにまとまります。'],
  ],
};

export function renderAbout(root: HTMLElement, which: 'about' | 'faq') {
  const ja = getLocale() === 'ja';
  const D = ja ? JA : KO;
  const toc = `<nav class="doc-toc" aria-label="Lilac"><p class="doc-toc-h">Lilac</p><ul>
    <li><a href="#/about" class="${which === 'about' ? 'on' : ''}">${esc(D.about.title)}</a></li>
    <li><a href="#/faq" class="${which === 'faq' ? 'on' : ''}">${ja ? 'よくある質問' : '자주 묻는 질문'}</a></li>
    <li><a href="#/terms">${ja ? '利用規約' : '이용약관'}</a></li>
    <li><a href="#/privacy">${ja ? 'プライバシーポリシー' : '개인정보처리방침'}</a></li>
    <li><a href="#/contact">${ja ? 'お問い合わせ' : '문의'}</a></li>
    <li><a href="#/status">${ja ? 'データの状態' : '데이터 상태'}</a></li>
  </ul></nav>`;
  if (which === 'faq') {
    root.innerHTML = `<div class="doc">${toc}<article class="doc-body"><p class="doc-kicker">Lilac</p><h1>${ja ? 'よくある質問' : '자주 묻는 질문'}</h1>
      <div class="faq">${D.faq.map(([q, a]) => `<details class="faq-item"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>
    </article></div>`;
    return;
  }
  const a = D.about;
  const table = (head: string[], rows: Row[]) => `<table class="doc-table"><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`)).join('')}</tr>`).join('')}</tbody></table>`;
  root.innerHTML = `<div class="doc">${toc}<article class="doc-body">
    <p class="doc-kicker">Lilac</p><h1>${esc(a.title)}</h1>
    <p class="doc-lead">${esc(a.lead)}</p>
    <section class="doc-sec"><h2>${ja ? 'できること' : '하는 일'}</h2><ul class="doc-list">${a.does.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>
    <section class="doc-sec"><h2>${ja ? 'しないこと' : '하지 않는 일'}</h2><ul class="doc-list">${a.doesnt.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>
    <section class="doc-sec"><h2>${ja ? 'エディション' : '에디션'}</h2>${table(ja ? ['エディション', '対象', '中心になる情報'] : ['에디션', '대상', '주로 보는 것'], a.editions)}</section>
    <section class="doc-sec"><h2>${ja ? 'データの出典' : '데이터 출처'}</h2>${table(ja ? ['種類', '出典', '更新'] : ['종류', '출처', '다시 읽는 주기'], a.sources)}<p class="doc-src"><a href="#/status">${ja ? '各出典の現在の状態' : '출처별 현재 상태 보기'}</a></p></section>
    <section class="doc-sec"><h2>${ja ? '運営' : '운영'}</h2><ul class="doc-list"><li>${ja ? '個人プロジェクト · 代表 한재석' : '개인 프로젝트 · 대표 한재석 · 사업자등록번호 미등록'}</li><li>${esc(a.contact)} <a href="#/contact">${ja ? 'お問い合わせ' : '문의하기'}</a></li></ul></section>
  </article></div>`;
}
