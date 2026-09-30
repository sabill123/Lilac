/* 뉴스 — Google 뉴스 RSS (키 없음)
 *
 *   GET https://news.google.com/rss/search?q={query}+when:{N}d&hl={ko|ja}&gl={KR|JP}&ceid={KR:ko|JP:ja}
 *   item: title("제목 - 매체"), link(news.google.com 리다이렉트), pubDate(RFC822), source(url 속성 = 매체 홈)
 *
 * 검색 결과에는 무관한 스팸(카지노 등)이 섞여 들어온다. 그래서
 *   1) 스팸 키워드·도메인 차단, 2) 아티스트명 또는 주제어가 제목에 실제로 들어간 기사만 남긴다.
 */
import { fetchText, clean } from './http.mjs';

const SPAM = /카지노|토토|바카라|슬롯|잭팟|릴과 심벌|크림 사이트|casino|betting|slot|カジノ|オンラインカジノ|パチンコ|オンカジ|오피사이트|성인|출장|대출|먹튀|콜걸/i;

function decodeXml(s) {
  return clean(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
}

export async function googleNews(query, { lang = 'ko', days = 30, limit = 40 } = {}) {
  const gl = lang === 'ja' ? 'JP' : 'KR';
  const q = `${query} when:${days}d`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${lang}&gl=${gl}&ceid=${gl}:${lang}`;
  const xml = await fetchText(url, { timeout: 9000, retries: 1 });
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const rawTitle = decodeXml((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
    const link = decodeXml((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
    const pub = decodeXml((it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]);
    const srcM = it.match(/<source url="([^"]*)">([\s\S]*?)<\/source>/);
    const source = srcM ? decodeXml(srcM[2]) : null;
    const sourceUrl = srcM ? srcM[1] : null;
    const title = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle.replace(/\s+-\s+[^-]+$/, '');
    const guid = decodeXml((it.match(/<guid[^>]*>([\s\S]*?)<\/guid>/) || [])[1]);
    if (!title || !link) continue;
    if (SPAM.test(title) || SPAM.test(source || '')) continue;
    if (/^(YouTube|TikTok|Instagram|X|Twitter|Facebook|note|Hypebeast\.KR)$/i.test(source || '')) continue;
    const t = Date.parse(pub);
    items.push({
      id: `gn:${guid || link}`.slice(0, 200),
      title,
      source,
      sourceUrl,
      url: link,
      publishedAt: Number.isFinite(t) ? new Date(t).toISOString() : null,
      lang,
    });
    if (items.length >= limit) break;
  }
  return items;
}

const TOPIC_RULES = [
  { id: 'visit', re: /내한|방한|来日|来韓|訪日|渡韓|월드\s?투어|아시아\s?투어|ワールドツアー|アジアツアー|in SEOUL|in JAPAN|IN KOREA|서울 공연|日本公演|ジャパンツアー|JAPAN TOUR/i },
  { id: 'ticket', re: /티켓|예매|선예매|매진|추가\s?공연|チケット|先行|抽選|一般発売|完売|追加公演|ticket/i },
  { id: 'release', re: /컴백|발매|앨범|싱글|신곡|음원|뮤직비디오|MV|カムバック|リリース|アルバム|シングル|新曲|配信|ミュージックビデオ/i },
  { id: 'live', re: /콘서트|공연|페스티벌|팬미팅|ライブ|コンサート|公演|フェス|ファンミーティング|ツアー/i },
  { id: 'chart', re: /차트|1위|오리콘|빌보드|멜론|チャート|オリコン|ビルボード|1位/i },
];

export function topicsOf(title) {
  return TOPIC_RULES.filter((r) => r.re.test(title)).map((r) => r.id);
}

/* 제목에 들어간 아티스트 찾기. names: [{id, names:[...]}] */
export function matchArtists(title, artists) {
  const t = String(title).toLowerCase();
  const hits = [];
  for (const a of artists) {
    for (const n of a.names) {
      const k = String(n || '').toLowerCase().trim();
      if (k.length < 2) continue;
      // 라틴 문자 이름은 단어 경계로 (ano, INI 같은 짧은 이름 오탐 방지)
      if (/^[a-z0-9 .&!'_-]+$/i.test(k)) {
        if (k.length < 3) continue;
        const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`, 'i');
        if (re.test(t)) { hits.push(a.id); break; }
      } else if (/[가-힣]/.test(k)) {
        // 한글 이름은 앞뒤 경계를 본다: '롤링스톤즈' 안의 '스톤즈', '아도니스' 안의 '아도'를 막는다
        const e = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(^|[^가-힣])${e}($|[^가-힣]|(은|는|이|가|을|를|의|와|과|도|에|에서|로|으로|만|측|표)(?![가-힣]))`);
        if (re.test(t)) { hits.push(a.id); break; }
      } else if (t.includes(k)) { hits.push(a.id); break; }
    }
  }
  return [...new Set(hits)];
}

/* 같은 사건을 다룬 기사 묶기 — 제목 글자 2-gram 겹침(Jaccard)이 크고 3일 이내면 하나로 */
function grams(t) {
  const s = String(t).toLowerCase().replace(/[\s'"‘’“”…·,.!?()[\]「」『』<>〈〉-]/g, '');
  const g = new Set();
  for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
  return g;
}
function jaccard(a, b) {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n || 1);
}
function cluster(items) {
  const heads = [];
  for (const it of items) {
    const g = grams(it.title);
    const t = Date.parse(it.publishedAt || '') || 0;
    const h = heads.find((x) => {
      const sameWho = x.artistIds.length && it.artistIds.length ? x.artistIds.some((id) => it.artistIds.includes(id)) : true;
      return sameWho && Math.abs(x._t - t) < 3 * 864e5 && jaccard(x._g, g) >= (x.artistIds.length && it.artistIds.length ? 0.22 : 0.4);
    });
    if (h) { h.related.push({ title: it.title, source: it.source, url: it.url, publishedAt: it.publishedAt }); continue; }
    heads.push({ ...it, related: [], _g: g, _t: t });
  }
  return heads.map(({ _g, _t, ...rest }) => rest);
}

/* 여러 검색어를 모아 중복 제거·정렬 */
export async function newsFeed(queries, { lang = 'ko', days = 30, artists = [], keep = null, perQuery = 30 } = {}) {
  const sources = [];
  const all = [];
  for (const q of queries) {
    const t0 = Date.now();
    try {
      const items = await googleNews(q, { lang, days, limit: perQuery });
      sources.push({ provider: `google-news:${q}`, ok: true, count: items.length, ms: Date.now() - t0 });
      all.push(...items.map((x) => ({ ...x, query: q })));
    } catch (e) {
      sources.push({ provider: `google-news:${q}`, ok: false, count: 0, ms: Date.now() - t0, error: String(e?.message || e) });
    }
  }
  const byKey = new Map();
  for (const it of all) {
    const key = it.title.replace(/\s+/g, '').slice(0, 40);
    if (byKey.has(key)) continue;
    const artistIds = matchArtists(it.title, artists);
    const topics = topicsOf(it.title);
    const row = { ...it, artistIds, topics };
    if (keep && !keep(row)) continue;
    byKey.set(key, row);
  }
  const sorted = [...byKey.values()].sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
  return { items: cluster(sorted), sources, fetchedAt: new Date().toISOString() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await newsFeed(process.argv.slice(2).length ? process.argv.slice(2) : ['J팝 내한', '일본 밴드 내한 공연'], { lang: 'ko' });
  for (const s of r.sources) console.log(s);
  for (const it of r.items.slice(0, 15)) console.log(it.publishedAt, '|', it.source, '|', it.title, '|', it.topics.join(','));
}
