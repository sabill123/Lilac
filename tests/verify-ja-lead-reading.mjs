/* 일본어 위키백과 첫머리 읽기(후리가나) — koreanNamesFor가 기존 langlinks 요청 하나에서 함께 뽑는다(오프라인, fetch 대체) */
import assert from 'node:assert/strict';
import { koreanNamesFor, jaLeadReading } from '../backend/lib/live/artist-info.mjs';

/* 순수 규칙 */
assert.equal(jaLeadReading({ title: '大森元貴', extract: '大森 元貴（おおもり もとき、1996年9月14日 - ）は、日本のミュージシャン、シンガーソングライター。' }), 'おおもり もとき');
assert.equal(jaLeadReading({ title: '大森元貴', extract: '大森 元貴（1996年9月14日 - ）は、日本のミュージシャン。' }), null, 'date only');
assert.equal(jaLeadReading({ title: '大森元貴', extract: '大森 元貴（おおもり もとき）は、日本の政治家。' }), null, 'not a musician');
assert.equal(jaLeadReading({ title: '大森元貴', extract: '若井 滉斗（わかい ひろと）は、日本のギタリスト。大森元貴とともに…' }), null, 'other person');
assert.equal(jaLeadReading({ title: '大森元貴', extract: '大森 元貴（英: Motoki Ohmori、おおもり もとき）は、日本の歌手。' }), null, 'first token not kana');
assert.equal(jaLeadReading({ title: '大森元貴', extract: '大森 元貴（おおもり もとき）は、日本の歌手。', disambiguation: true }), null, 'disambiguation');
assert.equal(jaLeadReading({ title: 'あいみょん', extract: 'あいみょん（1995年3月6日 - ）は、日本のシンガーソングライター。' }), null, 'kana title needs no reading');
assert.equal(jaLeadReading({ title: '乃木坂46', extract: '乃木坂46（のぎざかフォーティーシックス）は、日本の女性アイドルグループ。' }), 'のぎざかフォーティーシックス');

/* koreanNamesFor 배선: 새 문서도 자동, 추가 외부 호출 없음 */
const PAGES = {
  '新名歌手': { extract: '新名 歌手（しんめい かしゅ、2001年1月1日 - ）は、日本のシンガーソングライター。' },
  '日付歌手': { extract: '日付歌手（2001年1月1日 - ）は、日本の歌手。' },
  '山田太郎': { extract: '山田 太郎（やまだ たろう、1950年 - ）は、日本の政治家。' },
  '本人名': { extract: '本人名（ほんにん めい）は、日本の歌手。' },          // 別名義 → 本人名 리다이렉트
  '曖昧名': { extract: '曖昧名（あいまい めい）は、日本の歌手。', pageprops: { disambiguation: '' } },
  '韓国名歌手': { extract: '韓国名 歌手（かんこくめい かしゅ）は、日本のバンド。', langlinks: [{ lang: 'ko', '*': '한국명가수' }] },
};
const urls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => {
  urls.push(String(u));
  const url = new URL(String(u));
  if (url.hostname === 'ja.wikipedia.org') {
    const titles = url.searchParams.get('titles').split('|');
    const redirects = titles.includes('別名義') ? [{ from: '別名義', to: '本人名' }] : [];
    const pages = {};
    titles.map((t) => (t === '別名義' ? '本人名' : t)).forEach((t, i) => { pages[i + 1] = PAGES[t] ? { pageid: i + 1, ns: 0, title: t, ...PAGES[t] } : { ns: 0, title: t, missing: '' }; });
    return new Response(JSON.stringify({ query: { redirects, pages } }));
  }
  if (url.hostname === 'ko.wikipedia.org') return new Response(JSON.stringify({ type: 'standard', title: '한국명가수', description: '일본의 밴드', extract: '한국명가수는 일본의 밴드이다.', content_urls: { desktop: { page: 'https://ko.wikipedia.org/wiki/%ED%95%9C%EA%B5%AD%EB%AA%85%EA%B0%80%EC%88%98' } } }));
  throw new Error('unexpected host ' + url.hostname);
};
try {
  const titles = ['新名歌手', '日付歌手', '山田太郎', '別名義', '曖昧名', '韓国名歌手', '存在しない名'];
  const got = await koreanNamesFor(titles);
  const ja = urls.filter((u) => u.includes('ja.wikipedia.org'));
  assert.equal(ja.length, 1, 'one ja query for all titles');
  assert.match(ja[0], /prop=langlinks%7Cextracts%7Cpageprops/); assert.match(ja[0], /exintro=1/); assert.match(ja[0], /lllimit=max/);
  assert.equal(urls.length, 2, 'only the existing ko summary call for the one langlinked title');
  assert.deepEqual(got.readings.get('新名歌手'), { kana: 'しんめい かしゅ', title: '新名歌手', sourceUrl: 'https://ja.wikipedia.org/wiki/' + encodeURIComponent('新名歌手') });
  for (const t of ['日付歌手', '山田太郎', '別名義', '曖昧名', '存在しない名']) assert.equal(got.readings.has(t), false, t);
  assert.equal(got.readings.get('韓国名歌手').kana, 'かんこくめい かしゅ');
  assert.deepEqual(got.get('韓国名歌手'), ['한국명가수']);
  assert.equal(got.get('新名歌手'), undefined, 'reading never becomes a canonical name');
  assert.ok(titles.every((t) => got.checked.has(t)));
  console.log('PASS ja lead reading: verified musician lead kana only (date/英:/other-person/redirect-target/non-musician/disambiguation/kana-title rejected), automatic for new pages, same single ja query, never a canonical name');
} finally { globalThis.fetch = realFetch; }
