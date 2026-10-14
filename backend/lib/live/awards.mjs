/* Source-linked award notices, not an inferred performer roster or edition database.
 * One bounded RSS query per series, with at most two requests in flight. Google News
 * is media coverage, not an exhaustive official feed: news.mjs excludes social feeds.
 * Official homes identify each series only; publisher URLs remain the article sources.
 * Cache/stale-source retention belongs to the caller, including partial source failure.
 */
import { createHash } from 'node:crypto';
import { awardNoticeKind, awardNoticeKinds, awardDateMillis, latestAwardFirst as latestFirst } from './award-notice.mjs';
export { awardNoticeKind, awardNoticeKinds } from './award-notice.mjs';
import { fetchOfficialAwardNews } from './award-official.mjs';
import { pool, clean, fetchText } from './http.mjs';

export const AWARD_SERIES = Object.freeze([
  { id: 'mama', name: 'MAMA AWARDS', country: 'KR', lang: 'ko', officialUrl: 'https://www.mnetplus.world/mama/en/2026/awards/main',
    aliases: ['MAMA AWARDS', 'Mnet Asian Music Awards', '마마 어워즈', '엠넷 아시안 뮤직 어워즈'] },
  { id: 'vmaj', name: 'MTV VMAJ', country: 'JP', lang: 'ja', officialUrl: 'https://www.mtvjapan.com/event/vmaj/',
    aliases: ['MTV VMAJ', 'VMAJ', 'MTV Video Music Awards Japan', 'MTV ビデオ ミュージック アワード ジャパン'] },
  { id: 'mma', name: 'MMA · Melon Music Awards', country: 'KR', lang: 'ko', officialUrl: 'https://www.melon.com/mma/info.htm',
    aliases: ['Melon Music Awards', '멜론 뮤직 어워드', '멜론 뮤직 어워즈'] },
  { id: 'maj', name: 'MUSIC AWARDS JAPAN', country: 'JP', lang: 'ja', officialUrl: 'https://www.musicawardsjapan.com/',
    aliases: ['MUSIC AWARDS JAPAN', 'ミュージック アワーズ ジャパン', 'ミュージック アワード ジャパン'] },
  { id: 'kma', name: '한국대중음악상', country: 'KR', lang: 'ko', officialUrl: 'https://koreanmusicawards.com/',
    aliases: ['한국대중음악상', 'Korean Music Awards'] },
  { id: 'golden-disc', name: 'Golden Disc Awards', country: 'KR', lang: 'ko', officialUrl: 'https://www.goldendisc.co.kr/ko',
    aliases: ['골든디스크', 'Golden Disc Awards', 'Golden Disk Awards', 'ゴールデンディスク アワード'] },
  { id: 'record-awards', name: '日本レコード大賞', country: 'JP', lang: 'ja', officialUrl: 'https://www.tbs.co.jp/recordaward/',
    aliases: ['日本レコード大賞', 'Japan Record Awards'] },
  { id: 'kohaku', name: 'NHK 紅白歌合戦', country: 'JP', lang: 'ja', officialUrl: 'https://www.nhk.or.jp/kouhaku/index.html',
    aliases: ['NHK 紅白歌合戦', '紅白歌合戦', 'NHK Kohaku', 'Kohaku Uta Gassen'] },
].map((series) => Object.freeze({ ...series, aliases: Object.freeze(series.aliases) })));

const normal = (s) => String(s || '').normalize('NFKC');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const gap = '[\\s・·]*';
function aliasPattern(alias) {
  // Full CJK aliases allow typographic spacing without accepting short fragments.
  return [...alias].map((c) => /\s/.test(c) ? '' : escapeRe(c)).filter(Boolean).join(gap);
}
const MATCHERS = new Map(AWARD_SERIES.map((series) => [series.id, series.aliases.map((alias) =>
  new RegExp(`(?<![a-z])${aliasPattern(alias)}(?![a-z])`, 'gi'))]));

function references(title, series) {
  const text = normal(title);
  const matches = [];
  for (const re of MATCHERS.get(series.id) || []) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) matches.push({ start: match.index, end: match.index + match[0].length });
  }
  if ((series.id === 'mama' || series.id === 'mma') && !/격투|UFC|fighter|fight|octagon|밴드\s*MAMA|MAMA\s*밴드/i.test(text) && /라인업|시상|어워드|어워즈|수상|후보|출연|line[ -]?up|awards?|nominees?|winners?|performers?/i.test(text)) {
    const acronym = series.id.toUpperCase();
    const contextual = new RegExp('(?<![a-z])(?:20\\d{2}\\s*' + acronym + '|' + acronym + '\\s*20\\d{2})(?![a-z0-9])', 'gi');
    for (const match of text.matchAll(contextual)) {
      const offset = match[0].toUpperCase().indexOf(acronym);
      matches.push({ start: match.index + offset, end: match.index + offset + acronym.length });
    }
  }
  return { text, matches };
}

export function awardRelevant(title, seriesId) {
  const series = AWARD_SERIES.find((s) => s.id === seriesId);
  return !!series && references(title, series).matches.length > 0;
}

/* Only years attached to this award's name in the title identify an edition.
 * A publication year, an unrelated artist anniversary, or 第N回 is not evidence.
 * Conflicting neighboring years remain unknown instead of selecting the current one.
 */
export function awardEditionYear(title, seriesId) {
  const series = AWARD_SERIES.find((s) => s.id === seriesId);
  if (!series) return null;
  const { text, matches } = references(title, series);
  const years = new Set();
  const punctuation = `[\\s'"‘’“”「」『』【】()\\[\\]〈〉<>:：-]*`;
  const before = new RegExp(`(?<!\\d)((?:19|20)\\d{2})(?:年|년)?${punctuation}$`);
  const after = new RegExp(`^${punctuation}((?:19|20)\\d{2})(?!\\d)`);
  for (const { start, end } of matches) {
    const left = text.slice(0, start).match(before);
    if (left) years.add(Number(left[1]));
    const rightText = text.slice(end);
    const right = rightText.match(after);
    // An adjacent full calendar date is not an edition label.
    if (right && !/^(?:[./-]\d|(?:年|년)\s*\d{1,2}\s*(?:月|월))/.test(rightText.slice(right[0].length))) {
      years.add(Number(right[1]));
    }
  }
  return years.size === 1 ? [...years][0] : null;
}

export function isAwardAnnouncement(title) {
  // A past award in an artist's biography is not a new awards announcement.
  if (/国歌独唱|国歌斉唱|始球式|파이널스테이지|국가\s*독창/i.test(title) && !/ライン[・\s]?(?:ナップ|アップ)|라인업|出演者発表|수상자\s*발표/i.test(title)) return false;
  return /발표|공개|라인업|후보|개최|확정|출연|나온다|수상|결과|시상|예매|티켓|일정|중계|모집|페스타|発表|開催|決定|候補|ノミネート|受賞|結果|出場|出演|ライン[・\s]?(?:ナップ|アップ)|授賞|チケット|放送|日程|announc|line[ -]?up|nomine|winner|results?|ceremony|ticket|schedul|perform|fan\s*festa/i.test(title);
}

const webUrl = (value) => {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; }
};

export async function fetchAwardNews({ get = fetchText, now = Date.now(), perSeriesLimit = 20 } = {}) {
  const timestamp = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(timestamp)) throw new TypeError('Invalid award collection time');
  const limit = Math.max(1, Math.min(50, Math.floor(Number(perSeriesLimit) || 20)));
  const results = await pool([...AWARD_SERIES, { id: 'official-vmaj' }], 2, async (series) => {
    if (series.id === 'official-vmaj') return collectOfficialVmaj({ get, now: timestamp, limit });
    const provider = `google-news:awards:${series.id}`;
    try {
      const query = series.aliases.map((alias) => `"${alias}"`).join(' OR ') + (['mama', 'mma'].includes(series.id) ? ` OR (${series.id.toUpperCase()} (라인업 OR 시상 OR 어워즈 OR 수상))` : '');
      let rows = await awardRss(query, { lang: series.lang, days: 120, limit: 100, now: timestamp, get });
      // Long OR queries occasionally return no indexed results even when the
      // simple current-edition query does. Retry without weakening relevance.
      if (['mama', 'mma'].includes(series.id) && !rows.some(row => awardRelevant(row.title, series.id))) {
        rows = await awardRss(`${series.id.toUpperCase()} ${new Date(timestamp).getUTCFullYear()}`, { lang: series.lang, days: 120, limit: 100, now: timestamp, get });
      }
      const seenUrls = new Set();
      const seenTitles = new Set();
      const items = [];
      for (const row of rows.sort(latestFirst)) {
        const url = webUrl(row.url);
        if (!url || !awardRelevant(row.title, series.id) || !isAwardAnnouncement(row.title)) continue;
        const titleKey = normal(row.title).toLowerCase().replace(/\s+/g, '');
        if (seenUrls.has(url) || seenTitles.has(titleKey)) continue;
        seenUrls.add(url); seenTitles.add(titleKey);
        items.push({
          id: `award:${series.id}:${createHash('sha256').update(url).digest('hex').slice(0, 24)}`,
          provider, series: series.id, seriesName: series.name, country: series.country,
          title: row.title, url, source: row.source, sourceUrl: webUrl(row.sourceUrl),
          publishedAt: row.publishedAt, publishedAtSource: row.publishedAtSource,
          kind: awardNoticeKind(row.title), kinds: awardNoticeKinds(row.title), editionYear: awardEditionYear(row.title, series.id),
        });
      }
      const accepted = items.slice(0, limit);
      return { items: accepted, source: { provider, ok: true, count: accepted.length } };
    } catch (error) {
      return { items: [], source: { provider, ok: false, count: 0, error: String(error?.message || error) } };
    }
  });
  // Run after the RSS pool so publisher fallbacks still respect concurrency 2.
  const official = await fetchOfficialAwardNews({ get, now: timestamp });
  const recentOfficial = official.items.filter(x => !x.publishedAt || (awardDateMillis(x.publishedAt) >= timestamp - 120 * 864e5 && awardDateMillis(x.publishedAt) <= timestamp + 864e5));
  return {
    items: [...results.flatMap((result) => result.items), ...recentOfficial].sort(latestFirst),
    sources: [...results.map((result) => result.source), ...official.sources.map(s => ({ ...s, count: recentOfficial.filter(x => x.provider === s.provider).length }))],
    checkedAt: new Date(timestamp).toISOString(),
  };
}

/* Self-contained RSS path so the award feature does not require a newer news.mjs
 * deployment. Same media-only coverage policy: social feeds and spam are omitted. */
async function awardRss(query, { lang, days, now, get }) {
  const gl = lang === 'ja' ? 'JP' : 'KR';
  const xml = await get(`https://news.google.com/rss/search?q=${encodeURIComponent(`(${query}) when:${days}d`)}&hl=${lang}&gl=${gl}&ceid=${gl}:${lang}`, { timeout: 9000, retries: 1 });
  if (!/<rss[\s>]/i.test(xml) || !/<channel[\s>]/i.test(xml) || !/<\/channel\s*>\s*<\/rss\s*>\s*$/i.test(xml)) throw new Error('Invalid Google News RSS response');
  const decode = (x) => clean(String(x || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
  const rows = [];
  const blocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  if ((xml.match(/<item\b/gi) || []).length !== blocks.length) throw new Error('Truncated Google News RSS items');
  let valid = 0;
  for (const match of blocks) {
    const body = match[1];
    const tag = (name) => decode((body.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`)) || [])[1]);
    const src = body.match(/<source\s+url=["']([^"']*)["'][^>]*>([\s\S]*?)<\/source>/);
    const source = src ? decode(src[2]) : null;
    const sourceUrl = src ? decode(src[1]) : null;
    const rawTitle = tag('title');
    const title = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;
    const url = tag('link');
    if (!title || !webUrl(url)) continue;
    valid++;
    if (/카지노|토토|바카라|슬롯|먹튀|대출|성인|오피사이트|casino|betting|カジノ|パチンコ/i.test(title + ' ' + source)) continue;
    if (/^(YouTube|youtu\.be|youtube\.com|m\.youtube\.com|TikTok|tiktok\.com|Instagram|instagram\.com|X|x\.com|Twitter|twitter\.com|Facebook|facebook\.com|note|note\.com|Hypebeast\.KR)$/i.test(source || '')) continue;
    const date = Date.parse(tag('pubDate'));
    if (Number.isFinite(date) && (date < now - days * 864e5 || date > now + 864e5)) continue;
    rows.push({ id: tag('guid') || url, title, url, source, sourceUrl,
      publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : null, publishedAtSource: 'google-news-rss' });
  }
  if (blocks.length && !valid) throw new Error('Google News RSS has no valid title/link pairs');
  return rows.sort(latestFirst); // Relevance filtering must precede the per-series cap.
}

// MTV's CDN varies the document by browser content negotiation. Generic requests
// can receive an unrelated React program-guide shell with HTTP200.
const VMAJ_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8', 'Accept-Language': 'ja,en;q=0.9', 'Cache-Control': 'no-cache' };
const VMAJ_ROOT = 'https://www.mtvjapan.com/event/vmaj/';
// Research-verified landing, not a clock-generated edition. Future edition links
// discovered on the official root take precedence; bootstrap is a coverage limit.
const VMAJ_BOOTSTRAP = 'https://www.mtvjapan.com/event/vmaj/2026/';
export function parseVmajNotices(html, { baseUrl = VMAJ_BOOTSTRAP, now = Date.now() } = {}) {
  const series = AWARD_SERIES.find((s) => s.id === 'vmaj');
  const items = [];
  for (const anchor of String(html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;
    try { url = new URL(anchor[1], baseUrl); } catch { continue; }
    if (url.protocol !== 'https:' || url.hostname !== 'www.mtvjapan.com' || url.username || url.password) continue;
    const date = url.pathname.match(/^\/event\/vmaj\/\d{4}\/news\/(\d{4}-\d{2}-\d{2})[^/]*\/$/);
    if (!date) continue;
    const stamp = awardDateMillis(date[1]);
    if (!Number.isFinite(stamp) || stamp < now - 120 * 864e5 || stamp > now + 864e5) continue;
    const heading = anchor[2].match(/<h[2-6]\b[^>]*>([\s\S]*?)<\/h[2-6]>/i);
    const title = clean(heading ? heading[1] : anchor[2]);
    if (!awardRelevant(title, 'vmaj')) continue;
    items.push({ id: `award:vmaj:${createHash('sha256').update(url.href).digest('hex').slice(0, 24)}`,
      provider: 'official:awards:vmaj', series: 'vmaj', seriesName: series.name, country: 'JP',
      title, url: url.href, source: 'MTV Japan', sourceUrl: VMAJ_ROOT,
      publishedAt: new Date(stamp).toISOString(), publishedAtSource: 'official-url-date',
      kind: awardNoticeKind(title), kinds: awardNoticeKinds(title), editionYear: awardEditionYear(title, 'vmaj') });
  }
  return [...new Map(items.sort(latestFirst).map((item) => [item.url, item])).values()];
}

async function collectOfficialVmaj({ get, now, limit }) {
  const provider = 'official:awards:vmaj';
  try {
    let root = '';
    try { root = await get(VMAJ_ROOT, { timeout: 9000, retries: 0, headers: VMAJ_HEADERS }); } catch { /* verified bootstrap below */ }
    const years = [...root.matchAll(/(?:https:\/\/www\.mtvjapan\.com)?\/event\/vmaj\/(\d{4})\//g)].map((m) => Number(m[1]));
    const landing = years.length ? `${VMAJ_ROOT}${Math.max(...years)}/` : VMAJ_BOOTSTRAP;
    const html = await get(landing, { timeout: 9000, retries: 1, headers: VMAJ_HEADERS });
    if (!/\/news\/\d{4}-\d{2}-\d{2}/.test(html)) throw new Error('Official VMAJ news links unavailable (bootstrap coverage, no inferred edition)');
    const items = parseVmajNotices(html, { baseUrl: landing, now }).slice(0, limit);
    return { items, source: { provider, ok: true, count: items.length } };
  } catch (error) {
    return { items: [], source: { provider, ok: false, count: 0, error: String(error?.message || error) } };
  }
}

/* Retain only failed providers, never successful-empty sources. Old untagged cache
 * rows cannot safely be associated with a provider and are deliberately not retained. */
export function mergeAwardFeed(next, previousItems = []) {
  const checked = Date.parse(next.checkedAt);
  const now = Number.isFinite(checked) ? checked : Date.now();
  const observedAt = new Date(now).toISOString();
  const failed = new Set((next.sources || []).filter((s) => !s.ok).map((s) => s.provider));
  const current = (next.items || []).map(item => ({ ...item, kinds: awardNoticeKinds(item.title), observedAt, stale: false }));
  const retained = previousItems.filter(item => {
    if (!failed.has(item.provider)) return false;
    // Undated notices need a real previous observation, not an invented date.
    const date = awardDateMillis(item.publishedAt || item.observedAt);
    return Number.isFinite(date) && date >= now - 120 * 864e5 && date <= now + 864e5;
  }).map(item => ({ ...item, kinds: awardNoticeKinds(item.title), stale: true }));
  const seen = new Set();
  // Current observations win even when a publisher corrected a date backwards.
  const items = [...current, ...retained].filter(item => {
    const key = `${item.provider}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort(latestFirst);
  return { ...next, items };
}

/* The shared cache can store retained rows even when every provider failed.
 * Do not label that write as a successful fresh source update. */
export function presentAwardFeed(result, now = Date.now()) {
  // Generic cache failure fallback can restore a previous value after merge
  // pruned it to empty. Enforce the same age limit at the response boundary.
  const items = (result.items || []).filter(item => {
    const age = awardDateMillis(item.publishedAt || item.observedAt || result.cache?.updatedAt);
    return Number.isFinite(age) && age >= now - 120 * 864e5 && age <= now + 864e5;
  }).map(item => ({ ...item, kinds: awardNoticeKinds(item.title) }));
  const allFailed = result.sources?.length > 0 && result.sources.every(source => !source.ok);
  if (!allFailed) return { ...result, items };
  const observations = items.map(item => Date.parse(item.observedAt)).filter(Number.isFinite);
  const observed = observations.length ? Math.max(...observations) : null;
  return { ...result, items: items.map(item => ({ ...item, stale: true })), cache: {
    ...result.cache, state: items.length ? 'stale' : 'error',
    updatedAt: observed == null ? null : new Date(observed).toISOString(),
    ageSec: observed == null ? null : Math.max(0, Math.round((now - observed) / 1000)),
    lastError: 'All award sources failed; retained information is not a successful refresh',
  } };
}
