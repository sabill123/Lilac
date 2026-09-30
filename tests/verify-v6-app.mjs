/* v6 앱 계약 검사 — 새 셸(frontend/src/app)이 실제로 쓰는 코드만 본다.
 * 기존 test:ui 묶음은 더 이상 마운트되지 않는 레거시 모듈(pages.ts 등)을 검사하므로 v6의 근거가 되지 않는다.
 *
 *   node tests/verify-v6-app.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FE = path.join(ROOT, 'frontend');
const APP = path.join(FE, 'src', 'app');
const read = (p) => readFileSync(p, 'utf8');
const appFiles = [];
(function walk(d) {
  for (const f of readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(ts|css)$/.test(f.name)) appFiles.push(p);
  }
})(APP);
const all = appFiles.map((p) => ({ p, s: read(p) }));
const css = read(path.join(APP, 'app.css'));
const html = read(path.join(FE, 'index.html'));
const i18n = read(path.join(APP, 'i18n.ts'));

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('\nv6 앱 계약\n');

check('index.html은 새 앱 진입점만 불러온다', /src="\/src\/app\/main\.ts"/.test(html) && !/src="\/src\/main\.ts"/.test(html));
check('셸 구성요소(헤더·본문·푸터·모바일 탭·플레이어·상세 시트·사이트 루트)', ['id="hdr"', 'id="page"', 'id="ftr"', 'id="mnav"', 'id="player"', 'id="sheet"', 'id="siteRoot"'].every((x) => html.includes(x)));

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;
const withEmoji = all.filter(({ s }) => EMOJI.test(s)).map(({ p }) => path.relative(ROOT, p));
check('화면 코드에 장식 이모지 없음', withEmoji.length === 0, withEmoji.join(', '));

check('AI 느낌 장식 없음: 그라디언트 텍스트·글로우·배경 그라디언트', !/background-clip:\s*text|-webkit-background-clip|linear-gradient|radial-gradient|text-shadow/.test(css));
// v14: 채도 높은 자홍 보라(#AC37E6)를 채도 낮춘 라일락(#7D5BA6)으로. 정의는 :root 한 곳
check('브랜드 라일락은 :root 한 곳에서만, 흔한 템플릿 보라(#7A5AF8·#8B5CF6·#7C3AED·#6366F1) 없음', (css.match(/--brand: #/g) || []).length === 1 && /--brand: #7D5BA6/.test(css) && (css.match(/#7D5BA6/gi) || []).length === 1 && !/#7A5AF8|#8B5CF6|#7C3AED|#6366F1/i.test(css));
// v14: 푸른 기가 도는 회색(#F7F8FA 계열)을 순수 무채색으로 — 라일락·빨강과 부딪히지 않게
check('뉴트럴은 무채색: 글자 #111214·보조 #7B7F86·선 #EBEBED/#DADBDE·면 #F6F6F7', ['--ink: #111214', '--ink-3: #7B7F86', '--line: #EBEBED', '--line-2: #DADBDE', '--bg-2: #F6F6F7'].every((v) => css.includes(v)));
check('주 버튼은 검정(색은 사진이 만든다)', /\.btn-solid \{ background: var\(--ink\)/.test(css));
check('아티스트별 추출색으로 띠·버튼을 칠하지 않는다', !/has-mood/.test(css) && !existsSync(path.join(APP, 'mood.ts')));
check('굵기 800은 큰 제목·가격·날짜 숫자에만(본문 없음)', (css.match(/font-weight: 800/g) || []).length <= 18 && !/body \{[^}]*font: 800/.test(css));

const main = read(path.join(APP, 'main.ts'));
check('에디션 전환 3종(kr·jp·all)이 헤더에 있다', /\['kr', 'jp', 'all'\]/.test(main) && /role="radiogroup"/.test(main));
const state = read(path.join(APP, 'state.ts'));
check('에디션이 언어를 따라 바꾼다 (kr→ko, jp→ja)', /e === 'kr' && getLocale\(\) !== 'ko'\) setLang\('ko'/.test(state) && /e === 'jp' && getLocale\(\) !== 'ja'\) setLang\('ja'/.test(state));
check('레거시 경로는 새 화면으로 보낸다 (store·schedule·library·account)', ['store:', 'schedule:', 'library:', 'account:'].every((k) => main.includes(k)));

// 번역 누락: ko 사전의 키가 ja 사전에도 있어야 한다 (TS 타입으로도 강제되지만 소스로 한 번 더)
const koBlock = i18n.slice(i18n.indexOf('const ko = {'), i18n.indexOf('type Dict'));
const jaBlock = i18n.slice(i18n.indexOf('const ja: Dict = {'), i18n.indexOf('export type Key'));
const keys = (b) => [...b.matchAll(/^\s*'([a-zA-Z0-9_.-]+)':/gm)].map((m) => m[1]);
const missing = keys(koBlock).filter((k) => !keys(jaBlock).includes(k));
check('일본어 사전이 한국어 사전의 모든 키를 가진다', missing.length === 0, missing.join(', '));

// 지어낸 데이터 금지: 프런트에 공연·가격 하드코딩이 없어야 한다 (모든 목록은 /api/live 에서 온다)
const pages = all.filter(({ p }) => /pages\//.test(p));
const hard = pages.filter(({ s }) => /\b20\d\d-\d\d-\d\d\b/.test(s) || /₩\d|¥\d/.test(s)).map(({ p }) => path.relative(ROOT, p));
check('화면 코드에 날짜·가격 하드코딩 없음', hard.length === 0, hard.join(', '));
check('모든 화면 데이터는 /api/live·/api/charts·/api/store 에서 온다', pages.every(({ s }) => !/fetch\('https?:/.test(s)));

// 외부 이미지는 referrer 없이 (예매처 CDN 핫링크 차단 회피) + 실패 시 대체 표시
const ui = read(path.join(APP, 'ui.ts'));
check('외부 이미지: referrerpolicy=no-referrer + 실패 대체', /referrerpolicy="no-referrer"/.test(ui) && /onerror=/.test(ui));
check('외부 링크는 새 창 + noopener', all.every(({ s }) => !/target="_blank"(?![^>]*rel="[^"]*\bnoopener\b[^"]*")/.test(s)));

// 접근성
check('모바일 하단 탭·에디션 라디오 키보드 이동', /ArrowRight/.test(main) && /ArrowLeft/.test(main));
check('상세 시트: role=dialog, aria-modal, Esc 닫기', /role="dialog" aria-modal="true"/.test(read(path.join(APP, 'cards.ts'))) && /Escape/.test(read(path.join(APP, 'cards.ts'))));
check('reduced-motion 존중', /prefers-reduced-motion: reduce/.test(css));

// 홈 합치기: 이전 홈의 레코드 무대·음악상 무대 + 새 정보 순서
const home = read(path.join(APP, 'pages', 'home.ts'));
const order = ['secVisiting', 'secTickets', 'secNews', 'secChart', 'secReleases', 'secAbroad', 'awards-wrap', 'secArtists'].map((k) => Math.max(home.indexOf(`'${k}'`), home.indexOf(`id="${k}"`), home.indexOf(`class="${k}"`)));
check('홈 순서: 무대 → 내한 → 티켓 오픈·선행 → 소식·차트 → 새 앨범 → 현지 공연 → 음악상 → 아티스트', home.indexOf('stageHtml(slides)') > 0 && order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), order.join(','));
const stage3d = read(path.join(FE, 'src', 'three', 'stage3d.ts'));
check('홈 무대: three.js 곡면 갤러리(정점 셰이더 휘기·끌기·관성·자동 넘김·반사) + 평면 대체', /mountStage3D/.test(home) && /uRadius/.test(stage3d) && /pointerdown/.test(stage3d) && /flick/.test(stage3d) && /autoplayMs/.test(stage3d) && /uReflect/.test(stage3d) && /stage-flat/.test(home));
check('홈 무대: 텍스처·렌더러 해제와 화면 밖·탭 숨김 시 정지', /dispose\(\)/.test(stage3d) && /forceContextLoss/.test(stage3d) && /createSceneLifecycle/.test(stage3d));
check('섹션 설명 부제·방법 설명 상자 없이', !/sec-sub/.test(home) && !/class="note/.test(home) && /\.sec-sub \{ display: none; \}/.test(css));
const awardsCss = read(path.join(FE, 'src', 'awards', 'awards.css'));
check('음악상 무대 CSS에도 그라디언트·글로우 없음', !/linear-gradient|radial-gradient|text-shadow|background-clip:\s*text/.test(awardsCss));
// 제목 옆 이미지는 장식: 복사할 때 제목이 두 번 붙지 않게 alt=""
const cardsSrc = read(path.join(APP, 'cards.ts'));
const altDup = (cardsSrc.match(/img\((?:c\.poster|g\.image|r\.artwork|a\.photo \|\| a\.artwork|e\.artwork), (?!'')/g) || []);
check('카드 이미지는 alt="" (제목 중복 복사 방지)', altDup.length === 0, altDup.join(' '));
// 팬클럽: 가입·신청 링크는 utm_source=lilac + 클릭 기록, 모르는 값은 원문 확인 안내
const fc = read(path.join(APP, 'fanclub.ts'));
check('팬클럽 링크는 utm_source=lilac', /utm_source', 'lilac'/.test(fc) && (cardsSrc.match(/withUtm\(c\.url, 'fanclub_sale'\)/g) || []).length >= 2);
check('팬클럽 가입·신청 클릭을 문서 단위로 기록', /installFcTracking/.test(main) && /data-fc-track/.test(fc) && /fc-click/.test(fc));
const pdp = read(path.join(APP, 'pages', 'fcproduct.ts'));
check('팬클럽 요금·해외 가입 여부를 모르면 추정하지 않고 원문 확인 안내', /seePage/.test(pdp) && /fc\.overseas\.unknown2/.test(pdp) && /fcp\.seePage/.test(fc));
check('팬클럽 가입 안내는 상품 상세(이미지·가격·거주지/코스 옵션·가입 버튼·고정 탭)', /case 'fanclub': if \(a\) await renderFanclubProduct/.test(main) && ['pdp-img', 'pdp-price', 'data-side', 'pdp-course', 'pdpJoin', 'pdp-tabs', 'psteps'].every((k) => pdp.includes(k)));

// 헤더: 예매처 사이트 구조(작은 글자 줄 → 로고·검색·아이콘 → 카테고리 글자 메뉴). 알약 전환기·태그라인 없음
// v14: 3단 헤더(회색 줄·로고와 큰 검색·20px 메뉴 226px)를 한 줄 64px로. 나라(에디션)는 라디오 메뉴
check('헤더: 한 줄(로고·주 메뉴·도구), 나라 선택은 라디오 메뉴, 태그라인·알약 전환기 없음', /class="hdr-in"/.test(main) && /class="ed-links" role="radiogroup"/.test(main) && /aria-haspopup/.test(main) && !/class="util"/.test(main) && !/logo-sub|brand\.sub/.test(main) && !/\.edition \{/.test(css));
// v14: 실시간 동기화 — 서버 주기 수집 + 바뀐 것만 SSE로 알림 + 화면이 조용히 다시 그림
const svc = read(path.join(ROOT, 'backend', 'lib', 'live', 'service.mjs'));
const cacheSrc = read(path.join(ROOT, 'backend', 'lib', 'live', 'cache.mjs'));
const liveSrc = read(path.join(APP, 'live.ts'));
check('실시간: 원천별 주기 동기화 + /api/live/stream(SSE)', /const SYNC = \[/.test(svc) && /text\/event-stream/.test(svc) && /\/api\/live\/stream/.test(svc) && /cacheEvents\.emit\('change'/.test(cacheSrc));
check('실시간: 내용이 바뀔 때만 알림(해시 비교), 실패는 이전 값 유지', /sig !== prevSig/.test(cacheSrc) && /__fetchErr/.test(svc));
check('실시간: 화면은 EventSource로 구독하고 조작 중이면 미룬다', /new EventSource\('\/api\/live\/stream'\)/.test(liveSrc) && /userBusy/.test(main) && /softRoute/.test(main) && /refreshHome/.test(home));
// v14 색: 옅은 보라·초록 배지 없음, 급한 것만 빨강
check('색: 채도 높은 옛 보라(#AC37E6) 토큰이 마지막 규칙에서 바뀐다', css.lastIndexOf('--brand: #7D5BA6') > css.lastIndexOf('--brand: #AC37E6') && /--hot:/.test(css));
check('헤더: 카테고리 메뉴에 팬클럽, 작은 글자 줄에 예매 가이드', /r: 'fanclub'/.test(main) && /#\/guide/.test(main));
// 공연 상세: 예매처 상품 페이지 값(가격·관람 시간·수령·외국인 예매) + 팬클럽 회비를 불러온다
const cardsSrc2 = read(path.join(APP, 'cards.ts'));
const detailSrc = read(path.join(APP, 'detail.ts'));
check('공연 상세가 예매처 상품 정보와 팬클럽을 불러온다', /\/api\/live\/detail/.test(cardsSrc2) && /sdPrice/.test(detailSrc) && /sdHow/.test(detailSrc) && /sdFc/.test(detailSrc));
check('예매 방법은 보는 사람(에디션·언어)과 예매처에 따라 다르다', /state\.edition === 'jp'/.test(detailSrc) && /provider === 'eplus'/.test(detailSrc) && /provider === 'pia'/.test(detailSrc));
const guideSrc = read(path.join(APP, 'pages', 'guide.ts'));
const guideLinks = (guideSrc.match(/https:\/\/[^'\s]+/g) || []);
check('예매 가이드의 모든 문단은 공식 출처 링크를 단다(팬클럽 일반 안내 제외)', guideLinks.length >= 8 && guideLinks.every((u) => /eplus|pia\.jp|nol|melon/.test(u)));
check('팬클럽 회비표: 모르는 칸은 비우지 않고 "가입 페이지 기준"', /fcp\.seePage/.test(read(path.join(APP, 'pages', 'fanclub.ts'))));

// v10: 커뮤니티 · 소셜 · 팬클럽 가입 안내
const cards = read(path.join(APP, 'cards.ts'));
const guide = read(path.join(APP, 'fcguide.ts'));
check('커뮤니티·곡·공유 공연 라우트', /case 'community'/.test(main) && /case 'track'/.test(main) && /case 'e'/.test(main));
check('공연 상세: 좋아요·공유·댓글', /likeBtn\(tg/.test(cards) && /shareBtn\(tg/.test(cards) && /sdTalk/.test(cards));
check('차트 행: 좋아요·댓글', /crow-soc/.test(cards));
const shots = [...guide.matchAll(/src: '(\/guides\/[^']+)'/g)].map((m) => m[1]);
check(`가입 안내 캡처 ${shots.length}장이 실제 파일로 있다`, shots.length >= 6 && shots.every((p) => existsSync(path.join(FE, 'public', p))));
check('가입 안내 단계마다 공식 출처', (guide.match(/src: \[/g) || []).length >= 10);
check('원형 번호 스테퍼 없음', !/\.(fc|guide|sd)-steps/.test(css) && !/class="n">/.test(cards + guide));
check('서비스 소개는 앱 안 문서(예전 마케팅 랜딩 아님)', /renderAbout\(root, s\)/.test(main));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
