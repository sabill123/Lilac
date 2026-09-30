/* 팬클럽 가입 근거 문장 분류 — 실제 공식 페이지에서 본 문장으로 규칙을 고정한다.
 * 실행: node tests/verify-fc-evidence.mjs */
import { classify, verdicts, followLinks, globalSite, siteKey, sentences } from '../backend/lib/live/fc-evidence.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name} ${detail}`); } };
const run = (body, url = 'https://fc.example.jp/') => { const ev = classify([{ url, html: `<html><body>${body}</body></html>` }]); return { ev, v: verdicts(ev) }; };

let r = run('<p>※会員様向けの発送特典やサービスは、日本国内に居住の方に限ります。</p>');
ok('발송 특전 국내 한정은 가입 불가가 아니다(CLUB GNU)', r.v.overseas === null && r.v.shipOverseasNo === true, JSON.stringify(r.v));

r = run('<p>当サービスは、商品・特典物等の引渡し先が日本国内に限られる場合があります。</p>');
ok('규약의 "경우가 있습니다"는 국내 배송 한정 판정이 아니다', r.v.shipOverseasNo === null, JSON.stringify(r.v));

r = run('<p>本クラブの会員は、日本国内に居住し、国内郵便で配達可能な所在地に住所を有する方に限ります。</p>');
ok('일본 국내 거주 조건은 가입 불가(FAMILY CLUB 규약형)', r.v.overseas === 'no', JSON.stringify(r.v));

r = run('<p>海外在住の方はご入会いただけません。</p>');
ok('해외 거주자 입회 불가 문장', r.v.overseas === 'no', JSON.stringify(r.v));

r = run('<p>日本以外にお住まいの方もご入会いただけます。</p>');
ok('해외 거주자 입회 가능 문장', r.v.overseas === 'yes', JSON.stringify(r.v));

r = run('<p>海外在住の方もご入会いただけます。</p><p>海外在住の方はご入会いただけません。</p>');
ok('가능·불가가 함께 있으면 불가가 이긴다', r.v.overseas === 'no', JSON.stringify(r.v));

r = run('<p>万一、会員がこの保証に違反した場合、会員又は法定代理人は、法定代理人の同意を得ていないことを理由として当該申し込みの取り消しを行うことはできません。</p>');
ok('미성년자 법정대리인 조항은 대리 가입 금지가 아니다', r.v.noProxy === null && r.v.realName === null, JSON.stringify(r.v));

r = run('<p>入会代行業者を利用したご入会は禁止しております。</p>');
ok('입회 대행 금지 문장', r.v.noProxy === true, JSON.stringify(r.v));

r = run('<dt>Q. アプリの電話番号認証は必要ですか?</dt>');
ok('FAQ 질문 문장은 답으로 쓰지 않는다', r.v.sms === null, JSON.stringify(r.v));

r = run('<li>2026.08.31 【Stand By You】継続特典2026 発送のお知らせ(7月継続の方)</li>');
ok('날짜로 시작하는 공지 제목은 규칙이 아니다', !r.ev['card.ship'], JSON.stringify(r.ev));

r = run('<p>※デビットカードは動作保証外です。</p><p>※クレジットカード決済は、自動継続となります。</p>');
ok('체크카드 보증 외·자동 갱신', r.v.debitNg === true && r.v.autoRenew === true, JSON.stringify(r.v));

r = run('<p>SMS認証には日本国内の携帯電話番号が必要です。</p>');
ok('일본 휴대폰 번호 필요', r.v.phoneJp === true && r.v.sms === true, JSON.stringify(r.v));

r = run('<p>海外発行のクレジットカードもご利用いただけます。</p>');
ok('해외 발행 카드 언급', r.v.overseasCard === true, JSON.stringify(r.v));

r = run('<dt>会員登録は海外からも出来ますか?</dt><dd>Spitzbergenへのご登録は日本国内の住所に限らせていただきます。</dd>');
ok('등록을 일본 주소로 한정하면 가입 불가(スピッツ)', r.v.overseas === 'no', JSON.stringify(r.v));

r = run('<p>自動更新などはございませんので予めご了承ください。</p>');
ok('자동 갱신이 없다는 문장은 자동 갱신 근거가 아니다', r.v.autoRenew === false, JSON.stringify(r.v));

ok('등록 도메인: co.jp는 세 마디', siteKey('www.sonymusic.co.jp') === 'sonymusic.co.jp' && siteKey('faq.bokunchi.radwimps.jp') === 'radwimps.jp');
const links = followLinks('<a href="https://faq.bokunchi.radwimps.jp/">FAQ</a><a href="/login">ログイン</a><a href="https://other.example.com/faq">FAQ</a><a href="/overseas">海外の方へ</a>', 'https://bokunchi.radwimps.jp/');
ok('FAQ 하위 도메인은 따라가고 로그인·다른 사이트는 버린다, 해외 안내가 먼저', links.length === 2 && /overseas/.test(links[0].url) && /faq\.bokunchi/.test(links[1].url), JSON.stringify(links));
const g = globalSite('<a href="https://global.clubgnu.com/">GLOBAL</a>', 'https://clubgnu.com/');
ok('해외 팬용 global 사이트', g && /global\.clubgnu\.com/.test(g.url), JSON.stringify(g));
ok('다른 회사의 global 도메인은 해외 사이트로 보지 않는다', globalSite('<a href="https://global.example.com/">GLOBAL</a>', 'https://clubgnu.com/') === null);
ok('문장 자르기: 메뉴 조각은 버린다', sentences('<li>TOP</li><p>会員証は入会月の翌月下旬頃に発送いたします。会費は年額です。</p>').length === 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
