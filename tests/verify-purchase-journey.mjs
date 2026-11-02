#!/usr/bin/env node
/** Real-user purchase/fanclub journey regressions found by browsing official pages (2026-11-02).
 * Uses the actual assistance module. No network, no personal data. Fixture text mirrors the observed
 * public-page *shapes* (store help shipping section, unreadable short-link fanclub entry), not their facts. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const read = (p) => readFileSync(new URL('../frontend/src/app/' + p, import.meta.url), 'utf8');
const api = {};
vm.runInNewContext(ts.transpileModule(read('assistance.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText,
  { exports: api, require(name) { if (name === './i18n') return { getLocale: () => 'ko' }; return {}; }, URL, URLSearchParams });

// 1) Overseas shipping / customs lines must not be buried behind navigation labels and headings.
const src = 'https://store.example/pages/help';
const ev = (text, type = 'source_statement', topics = ['delivery']) => ({ verbatim: text, type, topics, sourceUrl: src });
const payload = {
  status: 'ok', url: src, title: 'Help', fetchedAt: '2026-11-02T08:11:03.623Z', sources: [{ sourceUrl: src }],
  evidence: [
    ev('配送に関する注意事項'), ev('複数商品をご注文の場合、発送時期が一番最後の商品に合わせて全ての商品が出荷されます。'),
    ev('配送について'), ev('ご希望のお支払い方法を選択してください。', 'source_statement', ['payment']),
    ev('2.商品選択', 'heading', ['other']), ev('Birthday Mail', 'source_statement', ['birthDate']),
    ev('よくある質問はありますか？'), ev('メールアドレスを入力して、送信ボタンを押してください。', 'source_statement', ['email']),
    ev('配送状況の確認'), ev('ご注文確認メールをもって領収書に代えさせていただきます。', 'source_statement', ['email']),
    ev('日本国外への配送'),
    ev('国際貨物の受取人は、輸入税、手数料、関税などの費用が課せられます。'),
    ev('1回の注文につき全国一律 送料 550円（税込）'),
  ],
  fields: [], images: [], unknowns: [], warnings: [],
};
const html = api.assistanceSourcesHtml(payload);
const visible = html.split('<details class="assist-more">')[0];
assert.match(visible, /関税/, 'customs/duty line is in the first visible block');
assert.match(visible, /日本国外への配送/, 'overseas shipping heading-statement is visible');
assert.match(visible, /送料 550円/, 'shipping fee is visible');
assert.ok(visible.indexOf('関税') < visible.indexOf('配送に関する注意事項') || !visible.includes('配送に関する注意事項'), 'overseas cost line outranks generic heading');
assert.doesNotMatch(visible, /2\.商品選択|Birthday Mail/, 'navigation labels and short headings move to "more"');
assert.match(html, /data-overseas/, 'overseas statements are flagged');
assert.ok(api.evidencePriority(ev('よくある質問はありますか？')) < api.evidencePriority(ev('送料は無料です。')), 'bare FAQ question ranks below a cost statement');

// 1b) Help-page conditions often sit after 40+ product-page lines; ranking must see them (was sliced to 40 first).
const long = { ...payload, evidence: [...Array.from({ length: 60 }, (_, i) => ev(`商品説明の文章です、番号${i}。`)), ev('配送先の国・地域によって、許可・規制・通関規則が異なります。返金はできません。')] };
assert.match(api.assistanceSourcesHtml(long).split('<details class="assist-more">')[0], /通関規則/, 'late overseas condition reaches the visible block');

// 2) Nothing read (e.g. redirecting short link rejected): unknowns are "not checked", not "not found in source".
const unread = api.assistanceSourcesHtml({
  status: 'unavailable', url: 'https://go.example/short', fetchedAt: '2026-11-02T08:10:06.319Z', sources: [], evidence: [], fields: [], images: [],
  warnings: [{ sourceUrl: 'https://go.example/short', code: 'unsafe_destination' }],
  unknowns: [{ topic: 'residence', reason: 'not_observed_in_fetched_public_pages' }, { topic: 'payment', reason: 'not_observed_in_fetched_public_pages' }],
});
assert.match(unread, /data-assist-unread/);
assert.match(unread, /공식 원문을 읽지 못했습니다/);
assert.match(unread, /모두 미확인/);
assert.match(unread, /거주 국가·지역 · 결제 안내/);
assert.doesNotMatch(unread, /확인한 공개 원문에서 찾지 못했습니다/, 'must not claim the source was read');
assert.doesNotMatch(unread, /unsafe_destination/, 'reason code is not exposed raw');

// 3) Store links: which page does the button actually open? (URL + this release's own catalog numbers only)
const eds = [{ id: 'box', label: 'BOX', catalogNo: 'UPCH-29510' }, { id: 'ltd', label: 'Limited', catalogNo: 'UPCH-29512' }, { id: 'reg', label: 'Regular', catalogNo: 'UPCH-20726' }];
const prod = api.offerLinkInfo('https://store.example/products/upch29512', eds);
assert.equal(prod.kind, 'product'); assert.equal(prod.edition.catalogNo, 'UPCH-29512');
assert.equal(api.offerLinkInfo('https://www.store.example/', eds).kind, 'home');
assert.equal(api.offerLinkInfo('https://store.example/artist/149554', eds).kind, 'listing');
assert.equal(api.offerLinkInfo('https://store.example/products/abc', eds).kind, 'product');
assert.equal(api.offerLinkInfo('https://store.example/products/abc', eds).edition, null);
assert.equal(api.offerLinkInfo('https://store.example/products/upch2072', [{ catalogNo: 'UPCH-20726' }]).edition, null, 'catalog prefix is not a match');
assert.equal(api.offerLinkInfo('javascript:alert(1)', eds).kind, 'invalid');

// 4) Fanclub detail source contracts (consumer renders checked in a real browser separately).
const fc = read('pages/fcproduct.ts');
assert.match(fc, /res\?\.realName && !f\.verdict\?\.realName/, 'realName from the entry page overrides a contradictory "no notice" row');
assert.match(fc, /taxIncl === true/, 'tax state is shown from collected data with an unknown state');
assert.doesNotMatch(fc, /f\.languages\?\.includes\('한국어'\) \? L\.langKo : L\.langJa/, 'missing language data is not shown as Japanese');
console.log('PASS purchase journey: overseas/cost evidence first, unread source stays unchecked, store link target labelled by catalog number, fanclub realName/tax/language honesty');

// 5) Backend source-bound extractors (fixtures shaped like the observed official HTML; no network).
const fanclub = await import('../backend/lib/live/fanclub.mjs');
// Overseas table: annual block, its own 注意事項, then a separate 月会費コース block before 会員登録.
const flat = '日本にお住まいの方 ¶ 年会費コース ¶ 年会費 ¶ 6,050 ¶ 円 ¶ （税込） ¶ 月会費コース ¶ 月会費 ¶ 550円（税込） ¶ お支払い方法 ¶ ・クレジットカード決済 ¶ ・コンビニ決済 ¶ '
  + '日本以外にお住まいの方 ¶ 年会費コース ¶ 特典の発送をご希望の方 ¶ 7,150 ¶ 円 ¶ ※6,050円(税込) ＋ 海外配送料 1,100円(税込) ¶ 特典の発送が不要な方 ¶ 6,050 ¶ 円 ¶ （税込） ¶ お支払い方法 ¶ ・クレジットカード決済 ¶ ※デビットカードは動作保証外です。 ¶ '
  + '注意事項 ¶ ・会員情報登録画面にて選択できる国にお住まいの方のみ、ご入会いただけます。 ¶ 月会費コース ¶ 月会費 ¶ 550 ¶ 円 ¶ （税込） ¶ お支払い方法 ¶ ・クレジットカード決済 ¶ 注意事項 ¶ ・同上 ¶ 会員登録 ¶ 日本にお住まいの方 ¶ 新規入会はこちら';
const res = fanclub.parseResidence(flat);
assert.deepEqual(res.overseas.monthly, { v: 550, cur: 'JPY' }, 'overseas monthly after its annual block notes is read');
assert.deepEqual(res.overseas.annual, { v: 6050, cur: 'JPY' });
assert.deepEqual(res.overseas.monthlyPayments, ['クレジットカード決済']);
assert.equal(fanclub.parseResidence(flat.replace(/注意事項 ¶ ・会員情報[\s\S]*?会員登録 ¶/, '会員登録 ¶')).overseas.monthly, null, 'no monthly block → stays unknown (null)');
assert.equal(fanclub.feeTaxState('年会費 ¶ 6,050 ¶ 円 ¶ （税込）'), true);
assert.equal(fanclub.feeTaxState('年会費 5,500円（税抜）'), false);
assert.equal(fanclub.feeTaxState('年会費 5,500円'), null, 'no tax notation → unknown');
assert.equal(fanclub.feeTaxState('6,050円（税込） / 500円（税別）'), null, 'conflicting notation → unknown');
// Weverse membership product page: sales-policy quote + seller identity from the same page, no residency verdict.
const wvHtml = '<dl><dt>商号名/代表者</dt><dd class="x">Seller Japan Inc. / NAME</dd></dl><dl><dt>所在地</dt><dd class="x">1-1 Minato-Ku, Tokyo, Japan</dd></dl><dd>当該商品は、販売者が属する国・地域にお住いのお客様に販売されます。当該商品については…</dd>';
const sp = fanclub.parseWeverseSalesPolicy(wvHtml, 'https://shop.weverse.io/ja/shop/JPY/artists/1/sales/2');
assert.equal(sp.quote, '当該商品は、販売者が属する国・地域にお住いのお客様に販売されます。');
assert.equal(sp.seller, 'Seller Japan Inc.'); assert.equal(sp.sellerAddress, '1-1 Minato-Ku, Tokyo, Japan');
assert.equal(fanclub.parseWeverseSalesPolicy('<p>no policy</p>', 'https://x.example/'), null);
assert.match(fc, /판매 대상 제한 문구 있음/, 'fanclub UI quotes the sales-policy line instead of "no notice"');
// Curated MGA official-store offer: per-edition URLs bound to their own catalog numbers; shipping claim carries its source.
const rel = JSON.parse(readFileSync(new URL('../db/releases.json', import.meta.url), 'utf8')).find((x) => x.id === 'mga-6th-album');
const mo = rel.offers.find((x) => x.id === 'mga-official');
for (const ed of rel.editions) {
  const u = mo.editionUrls?.[ed.id];
  assert.ok(u, `edition ${ed.id} has its own verified url`);
  assert.equal(api.offerLinkInfo(u, rel.editions).edition?.catalogNo, ed.catalogNo, `${ed.id} url points to its own catalog number`);
}
assert.equal(mo.shipsToKorea, true);
assert.match(mo.shippingSource.url, /^https:\/\/mga-officialstore\.com\/pages\/help$/);
assert.match(mo.shippingSource.dutyQuote, /関税/);
console.log('PASS backend extractors: late overseas monthly block, tax notation tri-state, Weverse sales policy quote, curated per-edition MGA URLs + sourced overseas shipping');
