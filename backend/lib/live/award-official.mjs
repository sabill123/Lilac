/* Official publisher notices only. No edition clock, performer roster, OCR, or
 * article inventory: discover links on the current publisher list/feed. */
import { createHash } from 'node:crypto';
import { awardNoticeKind as kind, awardNoticeKinds, latestAwardFirst as latestFirst } from './award-notice.mjs';
import { fetchText, clean } from './http.mjs';

const MMA_URL = 'https://newsroom.kakaoent.com/newsroom/media/';
const MAMA_URL = 'https://cjnews.cj.net/tag/mama/feed/';
const DEFINITIONS = [
  { id: 'mma', name: 'MMA · Melon Music Awards', url: MMA_URL, source: 'Kakao Entertainment Newsroom', host: 'newsroom.kakaoent.com' },
  { id: 'mama', name: 'MAMA AWARDS', url: MAMA_URL, source: 'CJ 뉴스룸', host: 'cjnews.cj.net' },
];
const text = (s) => clean(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
const attr = (s, name) => s.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
function officialUrl(value, def) {
  try {
    const u = new URL(text(value), def.url);
    if (u.protocol !== 'https:' || u.hostname !== def.host) return null;
    for (const key of [...u.searchParams.keys()]) if (/^utm_/i.test(key)) u.searchParams.delete(key);
    u.hash = '';
    return u.href;
  } catch { return null; }
}
function relevant(title, id) {
  if (/\b(?:UFC|fighter|fight|octagon)\b|격투|MAMA\s*밴드|밴드\s*MAMA/i.test(title)) return false;
  if (id === 'mma') return /\bMelon\s+Music\s+Awards\b|멜론\s*뮤직\s*어워[즈드]|\bMMA\s*20\d{2}\b|\b20\d{2}\s*MMA\b/i.test(title) || /\bMMA\b/i.test(title) && /시상|라인업|어워[즈드]|line[ -]?up|awards?|performers?/i.test(title);
  return /\bMAMA\s*AWARDS\b|마마\s*어워즈|\bMnet\s+Asian\s+Music\s+Awards\b/i.test(title) || /\b(?:20\d{2}\s*MAMA|MAMA\s*20\d{2})\b/i.test(title) && /시상|라인업|어워[즈드]|수상|후보|팬\s*페스타|슈퍼팬|line[ -]?up|awards?|performers?|fan\s*festa|super\s*fan/i.test(title);
}
function editionYear(title, id) {
  const aliases = id === 'mma' ? 'Melon\\s+Music\\s+Awards|멜론\\s*뮤직\\s*어워[즈드]|MMA' : 'MAMA\\s*AWARDS|마마\\s*어워즈|Mnet\\s+Asian\\s+Music\\s+Awards|MAMA';
  const years = new Set();
  const punctuation = `[\\s'"‘’“”「」『』【】()\\[\\]〈〉<>:：-]*`;
  for (const m of title.matchAll(new RegExp(`(?<![a-z])(?:${aliases})(?![a-z])`, 'gi'))) {
    const before = title.slice(0, m.index).match(new RegExp(`(?<!\\d)((?:19|20)\\d{2})(?:年|년)?${punctuation}$`));
    if (before) years.add(Number(before[1]));
    const tail = title.slice(m.index + m[0].length);
    const after = tail.match(new RegExp(`^${punctuation}((?:19|20)\\d{2})(?!\\d)`));
    if (after && !/^(?:[./-]\d|(?:年|년)\s*\d{1,2}\s*(?:月|월))/.test(tail.slice(after[0].length))) years.add(Number(after[1]));
  }
  return years.size === 1 ? [...years][0] : null;
}
function publication(value, provenance) {
  const raw = text(value);
  if (!raw) return null;
  // Validate day-only values without manufacturing a time or timezone.
  const day = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  const english = raw.match(/^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (day || english) {
    const y = Number(day?.[1] || english[3]);
    const mo = day ? Number(day[2]) : ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(english[1].slice(0, 3).toLowerCase()) + 1;
    const d = Number(day?.[3] || english[2]);
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
    return { publishedAt: date.toISOString().slice(0, 10), publishedAtSource: provenance };
  }
  // Missing timezone is not evidence for the server's local timezone. Preserve
  // an explicit ISO calendar day, but never manufacture its publication hour.
  const isoDay = raw.match(/^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}/)?.[1];
  if (isoDay && !publication(isoDay, provenance)) return null;
  if (!/(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC)\s*$/i.test(raw)) return isoDay ? publication(isoDay, provenance) : null;
  if (!/\b\d{4}\b/.test(raw) || !/\d{1,2}:\d{2}/.test(raw)) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? { publishedAt: new Date(ms).toISOString(), publishedAtSource: provenance } : null;
}
function htmlPublication(html, list = false) {
  if (!list) {
    for (const script of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const walk = (v) => {
          if (!v || typeof v !== 'object') return null;
          const own = publication(v.datePublished, 'official-jsonld-datePublished');
          if (own) return own;
          for (const x of Object.values(v)) { const found = walk(x); if (found) return found; }
          return null;
        };
        const found = walk(JSON.parse(script[1])); if (found) return found;
      } catch { /* Other explicit publication signals may still be present. */ }
    }
    for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
      if (/^(?:article:published_time|datePublished|pubdate)$/i.test(attr(m[0], 'property') || attr(m[0], 'name') || '')) {
        const found = publication(attr(m[0], 'content'), 'official-meta-published'); if (found) return found;
      }
    }
  }
  for (const m of html.matchAll(/<time\b([^>]*)>([\s\S]*?)<\/time>/gi)) {
    const found = publication(attr(m[1], 'datetime') || m[2], list ? 'official-list-date' : 'official-time'); if (found) return found;
  }
  for (const m of html.matchAll(/<(?:span|p)\b[^>]*class\s*=\s*["'][^"']*\bdate\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|p)>/gi)) {
    const found = publication(m[1], list ? 'official-list-date' : 'official-article-date'); if (found) return found;
  }
  return null;
}
function item(def, title, url, published) {
  return {
    id: `award:${def.id}:${createHash('sha256').update(url).digest('hex').slice(0, 24)}`,
    provider: `official:awards:${def.id}`, series: def.id, seriesName: def.name, country: 'KR',
    title, url, source: def.source, sourceUrl: new URL(def.url).origin + '/',
    publishedAt: published?.publishedAt || null, publishedAtSource: published?.publishedAtSource || null,
    kind: kind(title), kinds: awardNoticeKinds(title), editionYear: editionYear(title, def.id),
  };
}
async function collectMma(def, get) {
  const html = String(await get(def.url, { timeout: 15000 }));
  const found = new Map();
  let articleLinks = 0;
  const scan = (block, published = null) => {
    for (const a of block.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const url = officialUrl(attr(a[1], 'href'), def);
      if (!url || !new URL(url).pathname.startsWith('/news/')) continue;
      articleLinks++;
      const title = text(a[2].replace(/<img\b[^>]*>/gi, ''));
      if (!relevant(title, 'mma')) continue;
      const old = found.get(url);
      if (!old || !old.publishedAt && published) found.set(url, item(def, title, url, published));
    }
  };
  for (const block of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) scan(block[1], htmlPublication(block[1], true));
  scan(html); // Slider-only announcements are also discoverable; never overwrite dated cards.
  if (!articleLinks) throw new Error('Official MMA page has no readable article links (shell or malformed HTML)');
  const errors = [];
  const undated = [...found.values()].filter((x) => !x.publishedAt).slice(0, 4);
  // Sequential fallback keeps the source to at most five requests, with no fan-out.
  for (const row of undated) {
    try {
      const article = String(await get(row.url, { timeout: 15000 }));
      const published = htmlPublication(article);
      if (published) Object.assign(row, published);
      else errors.push(`No publication date in ${row.url}`);
    } catch (error) { errors.push(`${row.url}: ${error?.message || error}`); }
  }
  return { items: [...found.values()], errors };
}
async function collectMama(def, get) {
  const xml = String(await get(def.url, { timeout: 15000 }));
  if (!/<rss\b/i.test(xml) || !/<channel\b/i.test(xml) || !/<\/channel\s*>\s*<\/rss\s*>\s*$/i.test(xml)) throw new Error('Invalid official CJ RSS (shell or malformed feed)');
  const field = (block, name) => text(block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]);
  const items = new Map();
  const blocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  if ((xml.match(/<item\b/gi) || []).length !== blocks.length) throw new Error('Truncated official CJ RSS items');
  let valid = 0;
  for (const block of blocks) {
    const title = field(block[1], 'title');
    const url = officialUrl(field(block[1], 'link'), def);
    if (!title || !url) continue;
    valid++;
    if (!relevant(title, 'mama')) continue;
    items.set(url, item(def, title, url, publication(field(block[1], 'pubDate'), 'official-rss-pubDate')));
  }
  if (blocks.length && !valid) throw new Error('Official CJ RSS contains no valid title/link pairs');
  return { items: [...items.values()], errors: [] };
}

export async function fetchOfficialAwardNews({ get = fetchText, now = Date.now() } = {}) {
  const timestamp = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(timestamp)) throw new TypeError('Invalid official award collection time');
  const results = await Promise.all(DEFINITIONS.map(async (def) => {
    const provider = `official:awards:${def.id}`;
    try {
      const result = await (def.id === 'mma' ? collectMma(def, get) : collectMama(def, get));
      return { items: result.items, source: { provider, url: def.url, ok: !result.errors.length, count: result.items.length, ...(result.errors.length ? { error: result.errors.join('; ') } : {}) } };
    } catch (error) {
      return { items: [], source: { provider, url: def.url, ok: false, count: 0, error: String(error?.message || error) } };
    }
  }));
  return { items: results.flatMap((r) => r.items).sort(latestFirst), sources: results.map((r) => r.source) };
}
