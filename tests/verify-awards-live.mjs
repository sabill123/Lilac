import assert from 'node:assert/strict';
import { AWARD_SERIES, fetchAwardNews, presentAwardFeed, awardNoticeKinds, isAwardAnnouncement, awardRelevant, awardEditionYear, awardNoticeKind, parseVmajNotices, mergeAwardFeed } from '../backend/lib/live/awards.mjs';
import { latestAwardFirst, awardDateMillis } from '../backend/lib/live/award-notice.mjs';
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('PASS', name); };
const now = Date.parse('2026-10-14T12:00:00Z');
const positive = ['2025 MAMA AWARDS 라인업', 'MTV VMAJ 2026 LIVE ACT発表', '멜론뮤직어워드 2025 후보 발표', 'MUSIC AWARDS JAPAN 2026 受賞結果', '2026 한국대중음악상 수상자', '2026 골든디스크 개최', '2025 日本レコード大賞 受賞作品', '第77回 NHK 紅白歌合戦 出場者'];
const negative = ['MAMA 밴드 신곡 발매', 'MTV Video Music Awards 2026 US VMAs winners', 'MMA 2026 UFC 격투기', 'Japan music band awards', '한국 대중음악 신보 발표', '日本ゴールドディスク大賞', '레코드 신보 추천', '紅白の新曲'];
AWARD_SERIES.forEach((series, i) => {
  check(`${series.id} full-series identity`, () => assert.equal(awardRelevant(positive[i], series.id), true));
  check(`${series.id} unrelated names rejected`, () => assert.equal(awardRelevant(negative[i], series.id), false));
});
check('contextual year-acronyms accepted, generic and fighting rejected',()=>{assert.equal(awardRelevant('2026 MAMA 첫 라인업','mama'),true);assert.equal(awardEditionYear('MMA2026 라인업','mma'),2026);assert.equal(awardRelevant('MMA2026 UFC fight lineup','mma'),false);assert.equal(awardRelevant('MAMA 밴드 2026 라인업','mama'),false);});
check('fullwidth Japanese Latin identity', () => assert.equal(awardRelevant('ＭＴＶ ＶＭＡＪ ２０２６', 'vmaj'), true));
check('Latin identity does not match embedded word', () => assert.equal(awardRelevant('XVMAJ news', 'vmaj'), false));
for (const [title, series, year] of [
  ['2025 MAMA AWARDS 라인업', 'mama', 2025],
  ['MAMA AWARDS 2025 수상', 'mama', 2025],
  ['2026년 신보, 2025 MAMA AWARDS 수상자', 'mama', 2025],
  ['2026년 신보 MAMA AWARDS 수상자', 'mama', null],
  ['MAMA AWARDS, 2026년 10월 개최', 'mama', null],
  ['MAMA AWARDS 2026年10月開催', 'mama', null],
  ['MAMA AWARDS 2026-10-14 발표', 'mama', null],
  ['2025 MAMA AWARDS 2026', 'mama', null],
  ['第77回NHK紅白歌合戦', 'kohaku', null],
  ['「MTV VMAJ 2026」出演発表', 'vmaj', 2026],
]) check(`edition association: ${title}`, () => assert.equal(awardEditionYear(title, series), year));
check('notice categories do not extract artist names', () => {
  assert.equal(awardNoticeKind('MAMA AWARDS 후보 발표'), 'nominees');
  assert.equal(awardNoticeKind('MTV VMAJ 特別賞 & VTR出演発表'), 'results');
  assert.equal(awardNoticeKind('MTV VMAJ VTR出演発表'), 'news');
  assert.equal(awardNoticeKind('MTV VMAJ MC発表'), 'news');
  assert.equal(awardNoticeKind('MAMA AWARDS 라인업 발표'), 'lineup');
  assert.equal(awardNoticeKind('MAMA AWARDS 개최 일정'), 'schedule');
});
const xmlItem = (title, date='2026-10-14T08:00:00Z', source='매체', id=title) => `<item><title><![CDATA[${title} - ${source}]]></title><link>https://news.google.com/articles/${encodeURIComponent(id)}</link><guid>${id}</guid><pubDate>${date}</pubDate><source url="https://publisher.example">${source}</source></item>`;
const rss = (rows) => `<rss version="2.0"><channel>${rows.join('')}</channel></rss>`;
const notice = (year, date, text) => `<a href="/event/vmaj/${year}/news/${date}-notice/"><h3>${text}</h3><p>詳細はこちら</p></a>`;
let active=0, maxActive=0;
const requests=[];
const get = async (url) => {
  active++; maxActive=Math.max(maxActive,active); requests.push(url);
  try {
    await new Promise((resolve) => setTimeout(resolve, 2));
    if (!url.includes('news.google.com')) {
      if (url.endsWith('/event/vmaj/')) return '<a href="/event/vmaj/2027/">Next edition</a>';
      assert.ok(url.endsWith('/2027/'), 'landing discovered, not clock-generated');
      return notice(2027,'2026-10-14','MTV VMAJ 2027 開催発表');
    }
    const parsed = new URL(url);
    assert.match(parsed.searchParams.get('q'), /when:120d$/);
    const lang = parsed.searchParams.get('hl');
    const query=parsed.searchParams.get('q');
    const series=AWARD_SERIES.find((s) => query.includes(`"${s.aliases[0]}"`));
    assert.equal(lang,series.lang);
    if (series.id === 'kma') throw new Error('upstream unavailable');
    if (series.id === 'mma') return '<html>blocked</html>';
    if (series.id === 'mama') return rss([
      ...Array.from({length:40},(_,i)=>xmlItem(`MAMA 밴드 ${i}`)),
      xmlItem('2025 MAMA AWARDS 지난 수상','2026-10-12T08:00:00Z'),
      xmlItem('2025 MAMA AWARDS 오늘 라인업'),
      xmlItem('MAMA AWARDS 후보 발표','bad'),
      xmlItem('MAMA AWARDS 너무 옛날','2025-01-01'),
      xmlItem('MAMA AWARDS 미래','2027-01-01'),
      xmlItem('MAMA AWARDS 유튜브','2026-10-14','YouTube'),
    ]);
    return rss([xmlItem(positive[AWARD_SERIES.indexOf(series)])]);
  } finally { active--; }
};
const feed=await fetchAwardNews({ get, now, perSeriesLimit:2 });
check('bounded concurrency including official discovery',()=>assert.equal(maxActive,2));
check('exactly eight RSS queries and three official sources',()=>{assert.equal(requests.filter((u)=>u.includes('news.google.com')).length,8);assert.equal(feed.sources.length,11);});
check('filter relevance before limiting and sort by publisher date',()=>{const rows=feed.items.filter((x)=>x.series==='mama');assert.equal(rows.length,2);assert.match(rows[0].title,/오늘/);assert.match(rows[1].title,/지난/);});
check('2025 editions not overwritten by current 2026',()=>assert.ok(feed.items.filter((x)=>x.series==='mama').every((x)=>x.editionYear===2025)));
check('failure is not healthy empty, including HTML block response',()=>{for(const id of ['kma','mma']){const s=feed.sources.find((s)=>s.provider===`google-news:awards:${id}`);assert.equal(s.ok,false);assert.ok(s.error);}});
check('dates retain explicit provenance and no performer array',()=>{assert.equal(feed.checkedAt,'2026-10-14T12:00:00.000Z');for(const item of feed.items){assert.ok(item.provider);assert.ok(item.sourceUrl);assert.ok(['google-news-rss','official-url-date'].includes(item.publishedAtSource));assert.equal('artists' in item,false);}});
const official=parseVmajNotices(notice(2026,'2026-10-14','「MTV VMAJ 2026」特別賞 &amp; VTR出演発表'),{now});
check('official URL date with Japan date boundary, never fetchedAt',()=>assert.equal(official[0].publishedAt,'2026-10-13T15:00:00.000Z'));
check('VTR notice is not live lineup',()=>assert.equal(official[0].kind,'results'));
const shell=await fetchAwardNews({now,get:async(url)=>url.includes('news.google.com')?rss([]):'<html><div id="root"></div></html>'});
check('official React shell is failure, not healthy zero',()=>assert.equal(shell.sources.find((s)=>s.provider==='official:awards:vmaj').ok,false));
const merged=mergeAwardFeed(shell,[{id:'old-official',provider:'official:awards:vmaj',publishedAt:'2026-10-01'}, {id:'old-rss',provider:'google-news:awards:mama',publishedAt:'2026-10-02'}]);
check('only failed-provider cache preserved and marked stale',()=>{assert.equal(merged.items.length,1);assert.equal(merged.items[0].stale,true);});
const allFailed=await fetchAwardNews({now,get:async()=>{throw new Error('offline');}});
check('all failed sources remain visible to parent cache',()=>{assert.equal(allFailed.items.length,0);assert.ok(allFailed.sources.every((s)=>!s.ok));});
const undated=await fetchAwardNews({now,get:async(url)=>url.includes('news.google.com')?rss([xmlItem('MAMA AWARDS 日程未定','bad'),xmlItem('2025 MAMA AWARDS 라인업')]):'<html/>'});
check('undated notices sort last and do not receive current year',()=>{assert.equal(undated.items.at(-1).publishedAt,null);assert.equal(undated.items.at(-1).editionYear,null);});


check('past award biography is not new ceremony announcement',()=>{assert.equal(isAwardAnnouncement('2024年日本レコード大賞新人賞の歌手が国歌独唱'),false);assert.equal(isAwardAnnouncement('MTV VMAJ 2026 VTR出演アーティスト発表'),true);});

const negotiated=await fetchAwardNews({now,get:async(url,options)=>{if(url.includes('mtvjapan.com')){assert.match(options.headers.Accept,/text\/html/);assert.match(options.headers['User-Agent'],/Chrome/);return notice(2026,'2026-10-14','MTV VMAJ 2026 VTR出演発表');}return rss([]);}});
check('official transport requests real HTML rather than a successful shell',()=>assert.equal(negotiated.sources.find(s=>s.provider==='official:awards:vmaj').ok,true));

check('mixed official awards and live acts match both facets',()=>assert.deepEqual(awardNoticeKinds('MTV VMAJ 2026 特別賞発表！LIVE ACT追加、チケット受付'),['results','lineup','schedule']));
check('VTR and hosts remain distinct from the live lineup facet',()=>{assert.deepEqual(awardNoticeKinds('MTV VMAJ 2026 特別賞 & VTR出演発表'),['results','appearance']);assert.deepEqual(awardNoticeKinds('MAMA AWARDS MC 발표'),['appearance']);assert.equal(awardNoticeKinds('MAMA Fan Festa lineup announcement')[0],'news');});
check('day-only KR JP dates share a boundary without inventing precision',()=>{const rows=[{id:'day',publishedAt:'2026-10-14'},{id:'timed',publishedAt:'2026-10-13T16:00:00Z'},{id:'unknown',publishedAt:null}].sort(latestAwardFirst);assert.deepEqual(rows.map(x=>x.id),['timed','day','unknown']);assert.ok(Number.isNaN(awardDateMillis('2026-02-30')));});
check('one malformed official anchor cannot discard valid notices',()=>{const html='<a href="http://[">invalid</a>'+notice(2026,'2026-10-14','MTV VMAJ 2026 LIVE ACT発表');assert.equal(parseVmajNotices(html,{now}).length,1);assert.equal(parseVmajNotices(notice(2026,'2026-09-31','MTV VMAJ 2026 LIVE ACT発表'),{now}).length,0);});
const longFeed=await fetchAwardNews({now,get:async(url)=>url.includes('news.google.com')?rss([...Array.from({length:120},(_,i)=>xmlItem(`unrelated new music ${i}`)),xmlItem('MAMA AWARDS 2026 라인업','2026-10-13')]):'<html/>'});
check('relevance filtering still precedes limiting after 100 unrelated rows',()=>assert.equal(longFeed.items.filter(x=>x.series==='mama').length,1));
for(const bad of ['<rss><channel>','<rss><channel><item></channel></rss>','<rss><channel><item><title>missing URL</title></item></channel></rss>']){
  const broken=await fetchAwardNews({now,get:async(url)=>url.includes('news.google.com')?bad:'<html/>'});
  check('malformed RSS cannot evict previous records as healthy empty',()=>assert.ok(broken.sources.filter(x=>x.provider.startsWith('google-news:')).every(x=>!x.ok)));
}
const failedSource={provider:'official:awards:vmaj',ok:false};
const nextPartial={checkedAt:new Date(now).toISOString(),sources:[failedSource],items:[{id:'same',provider:failedSource.provider,title:'MTV VMAJ LIVE ACT発表',publishedAt:'2026-10-10'}]};
const corrected=mergeAwardFeed(nextPartial,[{id:'same',provider:failedSource.provider,title:'old',publishedAt:'2026-10-12'}]);
check('current corrected date wins over newer-looking stale duplicate',()=>{assert.equal(corrected.items.length,1);assert.equal(corrected.items[0].title,'MTV VMAJ LIVE ACT発表');assert.equal(corrected.items[0].stale,false);assert.equal(corrected.items[0].observedAt,nextPartial.checkedAt);});
const expired=mergeAwardFeed({...nextPartial,items:[]},[{id:'expired',provider:failedSource.provider,publishedAt:'2025-01-01'},{id:'legacy-unknown',provider:failedSource.provider,publishedAt:null},{id:'observed',provider:failedSource.provider,publishedAt:null,observedAt:'2026-10-13T00:00:00Z'}]);
check('failed source cannot retain expired or untraceably undated rows forever',()=>assert.deepEqual(expired.items.map(x=>x.id),['observed']));
const staleView=presentAwardFeed({...expired,cache:{state:'fresh',updatedAt:new Date(now).toISOString(),checkedAt:new Date(now).toISOString()}},now);
check('all-provider failure is not disguised by a cache write as fresh',()=>{assert.equal(staleView.cache.state,'stale');assert.equal(staleView.cache.updatedAt,'2026-10-13T00:00:00.000Z');assert.ok(staleView.cache.lastError);assert.equal(staleView.cache.checkedAt,new Date(now).toISOString());assert.ok(staleView.items.every(x=>x.stale));});
check('all-provider empty failure is error, not no-announcements success',()=>assert.equal(presentAwardFeed({...nextPartial,items:[]}).cache.state,'error'));


check('lineup plus MC retains both independent facets',()=>{assert.deepEqual(awardNoticeKinds('MAMA AWARDS 라인업 및 MC 발표'),['lineup','appearance']);assert.deepEqual(awardNoticeKinds('MTV VMAJ VTR出演アーティスト ラインナップ発表'),['appearance']);assert.deepEqual(awardNoticeKinds('MAMA AWARDS guest lineup announced'),['appearance']);});
// Cache has no initialized disk directory in this test: exercise real fallback
// logic without writes, network or a production cache key.
const { revalidate, peek } = await import('../backend/lib/live/cache.mjs');
{
  const cacheKey='award-retention-test-'+process.pid;
  await revalidate(cacheKey,async()=>({items:[{id:'expired',provider:failedSource.provider,publishedAt:'2025-01-01'}],sources:[{...failedSource,ok:true}]}));
  await revalidate(cacheKey,async()=>mergeAwardFeed({...nextPartial,items:[]},[{id:'expired',provider:failedSource.provider,publishedAt:'2025-01-01'}]));
  const fallback=await peek(cacheKey);
  check('actual generic cache fallback cannot reintroduce expired records',()=>{assert.equal(fallback.items.length,1);assert.equal(fallback.cache.state,'stale');assert.equal(presentAwardFeed(fallback,now).items.length,0);});
}


check('independent performers survive host mentions but guest rosters stay non-live',()=>{assert.deepEqual(awardNoticeKinds('MAMA AWARDS performers and hosts announced'),['lineup','appearance']);assert.deepEqual(awardNoticeKinds('MTV VMAJ ゲストセレブリティ ラインアップ発表'),['appearance']);assert.deepEqual(awardNoticeKinds('MTV VMAJ VTR performers announced'),['appearance']);assert.deepEqual(awardNoticeKinds('MTV VMAJ lineup of VTR performers announced'),['appearance']);});
console.log(`${checks} passed`);
