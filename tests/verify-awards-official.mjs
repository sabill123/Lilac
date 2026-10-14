import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchOfficialAwardNews } from '../backend/lib/live/award-official.mjs';

let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('PASS', name); };
const now = Date.parse('2026-10-14T12:00:00Z');
const mmaUrl = 'https://newsroom.kakaoent.com/newsroom/media/';
const mamaUrl = 'https://cjnews.cj.net/tag/mama/feed/';
const card = (slug, title, date = '') => `<article class="news-post-item"><a href="/news/${slug}/" class="img"><img alt="${title}" src="/wp-content/uploads/2099/12/no-publication.jpg"></a><div class="meta">${date ? `<span class="date">${date}</span>` : ''}</div><h3><a href="/news/${slug}/">${title}</a></h3><a href="/news/${slug}/">More +</a></article>`;
const rssItem = (title, slug, date = 'Fri, 28 Aug 2026 01:08:20 +0000') => `<item><title><![CDATA[${title}]]></title><link>https://cjnews.cj.net/${slug}/?utm_source=rss&#038;utm_medium=rss</link>${date ? `<pubDate>${date}</pubDate>` : ''}</item>`;
const rss = (...rows) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Mama – CJ 뉴스룸</title>${rows.join('')}</channel></rss>`;
const mmaHtml = [
  card('new-artists', 'Artists A and B: MMA2026 Welcomes More K-pop Acts', 'Oct 14, 2026'),
  card('earlier', 'Melon Music Awards 2025 lineup announced', 'Oct 12, 2026'),
  card('fallback', 'MMA2027 새로운 라인업'),
  card('unknown', 'Melon Music Awards fresh news'),
  card('unrelated', 'MMA2026 UFC fight lineup', 'Oct 14, 2026'),
  '<a href="https://attacker.example/news/false/">MMA2026 라인업</a>',
  '<a href="/news/new-artists/"><h3>Artists A and B: MMA2026 Welcomes More K-pop Acts</h3></a>',
].join('');
const mamaXml = rss(
  rssItem('2026 MAMA AWARDS, 팬 페스타 신설 및 슈퍼팬 모집', 'fanfesta'),
  rssItem('2026 MAMA AWARDS ceremony lineup announced', 'ceremony', 'Wed, 30 Sep 2026 10:00:00 +0900'),
  rssItem('2026 마마 어워즈 후보 발표', 'nominees', 'Wed, 30 Sep 2026 02:00:00 +0000'),
  rssItem('MAMA 밴드 새 노래', 'band'),
  rssItem('Artist sings MAMA', 'song'),
  rssItem('2027 MAMA 라인업 발표', 'next', 'bad date'),
  rssItem('2026 MAMA FAN FESTA performers lineup', 'fan-lineup'),
  rssItem('MAMA AWARDS 수상 결과', 'results', ''),
);
const requests = [];
const get = async (url) => {
  requests.push(url);
  if (url === mmaUrl) return mmaHtml;
  if (url === mamaUrl) return mamaXml;
  if (url.endsWith('/fallback/')) return '<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","datePublished":"2026-10-13T10:22:33+09:00","dateModified":"2026-10-14T12:00:00Z"}]}</script>';
  if (url.endsWith('/unknown/')) return '<article><img src="/2026/10/14.jpg"><p>The event is on November 20, 2026</p></article>';
  throw new Error('unexpected URL ' + url);
};
const feed = await fetchOfficialAwardNews({ get, now });
const mma = feed.items.filter((x) => x.series === 'mma');
const mama = feed.items.filter((x) => x.series === 'mama');
check('official providers stay separate and failures visible', () => {
  assert.deepEqual(feed.sources.map((x) => x.provider), ['official:awards:mma', 'official:awards:mama']);
  assert.equal(feed.sources[0].ok, false); // An undated fallback did not hide its missing evidence.
  assert.match(feed.sources[0].error, /No publication date/);
  assert.equal(feed.sources[0].count, 4);
  assert.equal(feed.sources[1].ok, true);
});
check('dynamic title anchors discovered, duplicates and foreign links rejected', () => {
  assert.equal(mma.length, 4);
  assert.equal(mma.filter((x) => x.url.endsWith('/new-artists/')).length, 1);
  assert.equal(mma.some((x) => x.url.includes('attacker')), false);
  assert.equal(mma.some((x) => /UFC/.test(x.title)), false);
});
check('card dates retain observed day precision and provenance', () => {
  const latest = mma.find((x) => x.url.endsWith('/new-artists/'));
  assert.equal(latest.publishedAt, '2026-10-14');
  assert.equal(latest.publishedAtSource, 'official-list-date');
  assert.equal(latest.kind, 'lineup');
  assert.equal(latest.editionYear, 2026);
});
check('publication year does not overwrite award edition', () => assert.equal(mma.find((x) => x.url.endsWith('/earlier/')).editionYear, 2025));
check('JSON-LD datePublished, not modified or collection time', () => {
  const row = mma.find((x) => x.url.endsWith('/fallback/'));
  assert.equal(row.publishedAt, '2026-10-13T01:22:33.000Z');
  assert.equal(row.publishedAtSource, 'official-jsonld-datePublished');
});
check('filename and event date never invent publication date', () => {
  const row = mma.find((x) => x.url.endsWith('/unknown/'));
  assert.equal(row.publishedAt, null);
  assert.equal(row.publishedAtSource, null);
  assert.equal(row.editionYear, null);
});
check('only undated articles fetched', () => assert.deepEqual(requests.filter((x) => ![mmaUrl, mamaUrl].includes(x)).sort(), ['https://newsroom.kakaoent.com/news/fallback/', 'https://newsroom.kakaoent.com/news/unknown/']));
check('CJ RSS explicit titles exclude bare MAMA music', () => {
  assert.equal(mama.length, 6);
  assert.equal(mama.some((x) => /밴드|sings/.test(x.title)), false);
});
check('RSS publication dates survive timezone normalization', () => {
  const row = mama.find((x) => x.url.endsWith('/ceremony/'));
  assert.equal(row.publishedAt, '2026-09-30T01:00:00.000Z');
  assert.equal(row.publishedAtSource, 'official-rss-pubDate');
});
check('fan announcements never silently become ceremony lineup', () => {
  for (const slug of ['fanfesta', 'fan-lineup']) assert.equal(mama.find((x) => x.url.endsWith(`/${slug}/`)).kind, 'news');
  assert.equal(mama.find((x) => x.url.endsWith('/ceremony/')).kind, 'lineup');
});
check('nominees/results distinguished, undated remains undated', () => {
  assert.equal(mama.find((x) => x.url.endsWith('/nominees/')).kind, 'nominees');
  assert.equal(mama.find((x) => x.url.endsWith('/results/')).kind, 'results');
  assert.equal(mama.find((x) => x.url.endsWith('/next/')).publishedAt, null);
});
check('news item schema has source attribution, no performer roster', () => {
  for (const row of feed.items) {
    for (const key of ['id','provider','series','seriesName','country','title','url','source','sourceUrl','publishedAt','publishedAtSource','kind','editionYear']) assert.ok(key in row, key);
    assert.equal(row.provider, `official:awards:${row.series}`);
    assert.equal(row.country, 'KR');
    assert.match(row.sourceUrl, /^https:\/\//);
    assert.equal('artists' in row, false);
    assert.equal(new URL(row.url).searchParams.has('utm_source'), false);
  }
});
check('all items sorted latest first with undated last', () => {
  assert.deepEqual(feed.items.map((x) => x.id), [...feed.items].sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')) || a.id.localeCompare(b.id)).map((x) => x.id));
  assert.equal(feed.items.at(-1).publishedAt, null);
});
const boundedCalls = [];
const bounded = await fetchOfficialAwardNews({ now, get: async (url) => {
  boundedCalls.push(url);
  if (url === mamaUrl) return rss();
  if (url === mmaUrl) return Array.from({length: 9}, (_, i) => card(`dynamic-${i}`, `MMA2028 라인업 ${i}`)).join('');
  return '<time datetime="2027-12-31T10:00:00Z">date</time>';
}});
check('at most four MMA article fallback requests, dynamic items not truncated', () => {
  assert.equal(boundedCalls.length, 6);
  assert.equal(bounded.items.length, 9);
  assert.equal(bounded.items.filter((x) => x.publishedAt).length, 4);
});
check('collection clock does not discard explicit publisher dates', () => assert.ok(bounded.items.some((x) => x.publishedAt === '2027-12-31T10:00:00.000Z')));
const shells = await fetchOfficialAwardNews({ now, get: async () => '<html><div id="root"></div></html>' });
check('HTML shells fail loudly for both providers, not healthy zero', () => {
  assert.equal(shells.items.length, 0);
  assert.ok(shells.sources.every((x) => x.ok === false && x.error));
});
const malformed = await fetchOfficialAwardNews({ now, get: async (url) => url === mamaUrl ? '<rss><channel><item><title>2026 MAMA AWARDS</title></channel></rss>' : mmaHtml });
check('truncated RSS source failure surfaced', () => assert.equal(malformed.sources.find((x) => x.provider.endsWith(':mama')).ok, false));
const offline = await fetchOfficialAwardNews({ now, get: async () => { throw new Error('offline test'); } });
check('transport failures not swallowed', () => assert.ok(offline.sources.every((x) => !x.ok && /offline test/.test(x.error))));
const partial = await fetchOfficialAwardNews({ now, get: async (url) => { if (url === mmaUrl) throw new Error('MMA offline'); return mamaXml; } });
check('one failing source does not erase successful other source', () => {
  assert.equal(partial.sources[0].ok, false);
  assert.equal(partial.sources[1].ok, true);
  assert.equal(partial.items.length, 6);
});
const changed = await fetchOfficialAwardNews({ now, get: async (url) => url === mmaUrl ? card('unseen', 'MMA2030 never-before-seen 라인업', 'Jan 02, 2029') : rss(rssItem('2030 MAMA AWARDS unseen nominees', 'unseen-mama', 'Tue, 02 Jan 2029 03:04:05 +0000')) });
check('unseen future titles and URLs require no maintained article mapping', () => {
  assert.equal(changed.items.length, 2);
  assert.ok(changed.items.every((x) => x.editionYear === 2030));
  assert.ok(changed.sources.every((x) => x.ok));
});
const moduleSource = await readFile(new URL('../backend/lib/live/award-official.mjs', import.meta.url), 'utf8');
check('collector has no current article slug/title and no awards circular import', () => {
  assert.equal(moduleSource.includes('mma2026-welcomes-more-k-pop-heavyweights'), false);
  assert.equal(moduleSource.includes('aespa'), false);
  assert.equal(/from\s+['"]\.\/awards\.mjs/.test(moduleSource), false);
});
await assert.rejects(fetchOfficialAwardNews({ now: 'invalid', get }), /Invalid official award collection time/);
console.log(`${checks} passed`);
