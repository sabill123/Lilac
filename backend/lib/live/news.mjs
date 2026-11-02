/* 뉴스 — Google 뉴스 RSS (키 없음)
 *
 *   GET https://news.google.com/rss/search?q={query}+when:{N}d&hl={ko|ja}&gl={KR|JP}&ceid={KR:ko|JP:ja}
 *   item: title("제목 - 매체"), link(news.google.com 리다이렉트), pubDate(RFC822), source(url 속성 = 매체 홈)
 *
 * 검색 결과에는 무관한 스팸(카지노 등)이 섞여 들어온다. 그래서
 *   1) 스팸 키워드·도메인 차단, 2) 아티스트명 또는 주제어가 제목에 실제로 들어간 기사만 남긴다.
 */
import { fetchText, clean } from './http.mjs';
import { romanSimilar } from './artist-info.mjs';

const SPAM = /카지노|토토|바카라|슬롯|잭팟|릴과 심벌|크림 사이트|casino|betting|slot|カジノ|オンラインカジノ|パチンコ|オンカジ|오피사이트|성인|출장|대출|먹튀|콜걸/i;

function decodeXml(s) {
  return clean(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
}

export async function googleNews(query, { lang = 'ko', days = 30, limit = 100 } = {}) {
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
    if (/^(YouTube|youtu\.be|youtube\.com|m\.youtube\.com|TikTok|tiktok\.com|Instagram|instagram\.com|X|x\.com|Twitter|twitter\.com|Facebook|facebook\.com|note|note\.com|Hypebeast\.KR)$/i.test(source || '')) continue;
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

/* 이름 바로 뒤에 붙는 조사 — '아도부터', '바운디까지'도 이름으로 본다 */
const KO_PARTICLE = '은|는|이|가|을|를|의|와|과|도|에|에서|에게|한테|로|으로|만|측|표|부터|까지|처럼|보다|와의|과의|에도|에서도|이랑|랑|이나|라는|이라는|만의';
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* 짧은 이름(두 글자 한글 '아도', 한 낱말 로마자 'Takara')은 보통 낱말·회사명과 겹친다(아도 화상, Takara Bio).
   confirm 이 주어지면 이런 이름만으로 잡힌 기사는 제목에 음악 맥락이 있을 때만 그 아티스트로 본다.
   연극·행사에도 쓰이는 말(공연·무대·티켓·투어)은 맥락으로 치지 않는다 — '아도가 남쪽으로 온 까닭은' 마당극 공연 */
export const MUSIC_KO = /노래|가수|음악|음원|앨범|싱글|신곡|발매|컴백|콘서트|라이브|페스티벌|떼창|차트|인기가요|뮤직|OST|주제가|주제곡|MV|뮤비|라인업|내한|日|일본|J-?팝|J-?POP|보컬|밴드|아이돌|직캠/i;
export const MUSIC_JA = /曲|歌|音楽|アルバム|シングル|リリース|配信|ライブ|コンサート|公演|ツアー|フェス|来日|ファン|MV|チャート|ビルボード|K-?POP|韓国|韓流|デビュー|カムバック|番組|出演|ステージ|グループ|メンバー|アイドル|ボーイズ|ガールズ/i;
/* 대문자 네 글자 이하 약칭(IVE·TWS·BTS)은 이미 대소문자까지 맞춰 보므로 약한 이름으로 치지 않는다 */
const weakName = (n) => (/^[가-힣]+$/.test(n) && n.length <= 2) || (/^[A-Za-z0-9]+$/.test(n) && n.length <= 6 && !(n.length <= 4 && n === n.toUpperCase()));

/* 제목에 들어간 아티스트 찾기. names: [{id, names:[...]}] */
export function matchArtists(title, artists, { confirm = null } = {}) {
  const raw = String(title);
  const t = raw.toLowerCase();
  const hits = [];
  const context = confirm ? confirm.test(raw) : true;
  for (const a of artists) {
    for (const n of a.names) {
      const orig = String(n || '').trim();
      const k = orig.toLowerCase();
      if (k.length < 2) continue;
      if (!context && weakName(orig)) continue;
      // 라틴 문자 이름은 단어 경계로 (ano, INI 같은 짧은 이름 오탐 방지)
      if (/^[a-z0-9 .&!'_-]+$/i.test(k)) {
        if (k.length < 3) continue;
        /* 네 글자 이하 로마자 이름(KING·HANA·LIT)은 흔한 낱말과 겹친다(Burger King, Hana Bank) — 대소문자까지 같을 때만 */
        const cs = orig.replace(/[^A-Za-z0-9]/g, '').length <= 4 && /[A-Z]/.test(orig);
        const re = cs ? new RegExp(`(^|[^A-Za-z0-9])${escRe(orig)}($|[^A-Za-z0-9])`) : new RegExp(`(^|[^a-z0-9])${escRe(k)}($|[^a-z0-9])`, 'i');
        if (re.test(cs ? raw : t)) { hits.push(a.id); break; }
      } else if (/[가-힣]/.test(k)) {
        // 한글 이름은 앞뒤 경계를 본다: '롤링스톤즈' 안의 '스톤즈', '아도니스' 안의 '아도'를 막는다
        const re = new RegExp(`(^|[^가-힣])${escRe(k)}($|[^가-힣]|(${KO_PARTICLE})(?![가-힣]))`);
        if (re.test(t)) { hits.push(a.id); break; }
      } else if (t.includes(k)) { hits.push(a.id); break; }
    }
  }
  return [...new Set(hits)];
}

/* ---------- 한글 표기 흔들림 ----------
   일본 이름의 한글 표기는 매체마다 첫소리가 갈린다(외래어 표기법은 예사소리: 요네즈 겐시 / 흔한 표기: 요네즈 켄시,
   기무라 다쿠야 / 타쿠야, 가지우라 / 카지우라). つ도 쓰/츠로 갈린다. 낱말 첫소리 ㄱ↔ㅋ·ㄷ↔ㅌ·ㅈ↔ㅊ, 쓰↔츠, 띄어쓰기 유무를
   규칙으로 펼친다 — 사람이 표기마다 별칭을 적지 않게. 두 글자 이하 이름은 펼치지 않는다(겹치는 낱말이 많다). */
const SWAP_CHO = { 0: 15, 15: 0, 3: 16, 16: 3, 12: 14, 14: 12 };
function swapInitial(syl) {
  const c = syl.charCodeAt(0) - 0xac00;
  if (c < 0 || c > 11171) return null;
  const to = SWAP_CHO[Math.floor(c / 588)];
  return to == null ? null : String.fromCharCode(0xac00 + to * 588 + (c % 588));
}
export function hangulVariants(name) {
  const s = String(name || '').trim().replace(/\s+/g, ' ');
  if (!/^[가-힣 ]+$/.test(s) || s.replace(/ /g, '').length < 3) return [];
  let acc = [''];
  for (const w of s.split(' ')) {
    const v = swapInitial(w[0]);
    const opts = v ? [w, v + w.slice(1)] : [w];
    acc = acc.flatMap((p) => opts.map((o) => (p ? `${p} ${o}` : o)));
  }
  const out = new Set();
  for (const v of acc) for (const x of [v, v.replace(/쓰/g, '츠'), v.replace(/츠/g, '쓰')]) { out.add(x); out.add(x.replace(/ /g, '')); }
  out.delete(s);
  return [...out].slice(0, 24);
}

/* ---------- 기사 제목에서 한글 표기 배우기 ----------
   한국 기사는 처음 소개할 때 "킹누(King Gnu)", "미세스 그린 애플(Mrs. GREEN APPLE)", "요네즈 켄시(米津玄師, Kenshi Yonezu)"처럼
   원어를 괄호로 붙인다. 괄호 안이 로스터 아티스트의 이름과 정확히 같고, 괄호 앞 한글이 그 아티스트의 로마자 이름과 소리가 맞을 때만
   (romanSimilar) 그 한글을 표기로 받는다. 괄호 앞 한글은 꾸밈말(日 싱어송라이터 …)이 붙어 있으니 꾸밈말을 뺀, 소리가 맞는 가장 긴 끝토막을 쓴다. */
const nameKey = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s.・·'’!_\-=≠]/g, '');
const latinNames = (a) => a.names.filter((n) => /[A-Za-z]/.test(n || '') && !/[가-힣]/.test(n));
function soundsLike(ko, a) {
  const flat = ko.replace(/\s+/g, '');
  return flat.length >= 2 && latinNames(a).some((l) => romanSimilar(flat, l));
}
/* 괄호 앞 꾸밈말(소개하는 말)로 시작하는 토막은 이름이 아니다 */
const DESCRIPTOR = /^(日|일본|한일|인기|가수|밴드|록밴드|그룹|걸그룹|보이그룹|아이돌|싱어송라이터|뮤지션|듀오|래퍼|보컬|보컬리스트|프로듀서|작곡가|신인|대세|국민|원조|레전드|첫|단독)$/;
export function learnKoreanAliases(titles, artists) {
  const byKey = new Map();
  for (const a of artists) for (const n of a.names) { const k = nameKey(n); if (k.length >= 2) byKey.set(k, [...new Set([...(byKey.get(k) || []), a.id])]); }
  const byId = new Map(artists.map((a) => [a.id, a]));
  const out = new Map();
  const add = (id, ko) => { if (!out.has(id)) out.set(id, new Set()); out.get(id).add(ko); };
  const owner = (s) => { const ids = byKey.get(nameKey(s)); return ids && ids.length === 1 ? byId.get(ids[0]) : null; };
  for (const title of titles) {
    const t = String(title);
    // 한글(원어, …)
    for (const m of t.matchAll(/([가-힣]+(?: [가-힣]+){0,4})\s?[(（]([^()（）]{2,60})[)）]/g)) {
      const words = m[1].split(' ');
      const who = [...new Set(m[2].split(/[,，、/]/).map((x) => owner(x.trim())).filter(Boolean))];
      if (who.length !== 1) continue;
      for (let k = words.length; k >= 1; k--) {
        const cand = words.slice(-k).join(' ');
        /* 두 글자 끝토막(켄시)은 바로 앞이 꾸밈말일 때만(밴드 킹누) — 이름의 일부만 떼어 배우지 않게 */
        if (DESCRIPTOR.test(words[words.length - k]) || (k < words.length && cand.replace(/ /g, '').length < 3 && !DESCRIPTOR.test(words[words.length - k - 1]))) continue;
        if (soundsLike(cand, who[0])) { add(who[0].id, cand); break; }
      }
    }
    // 원어(한글)
    for (const m of t.matchAll(/([A-Za-z0-9][A-Za-z0-9 .&!'_=≠-]{1,40}?)\s?[(（]([가-힣]+(?: [가-힣]+){0,3})[)）]/g)) {
      const who = owner(m[1].trim());
      if (who && soundsLike(m[2], who)) add(who.id, m[2]);
    }
  }
  return new Map([...out].map(([id, s]) => [id, [...s]]));
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

/* 여러 검색어를 모아 중복 제거·정렬
 *  previous: 지난 결과의 items. 판 뉴스는 아티스트 묶음을 돌아가며 찾으므로, 지난 결과를 같은 규칙으로 다시 판정해 기간(days) 안의 것을 이어 둔다.
 *  한국어 판은 제목의 "한글(원어)" 짝에서 배운 표기와 첫소리 흔들림(겐시/켄시)까지 이름으로 본다. */
export async function newsFeed(queries, { lang = 'ko', days = 30, artists = [], keep = null, perQuery = 100, previous = null, max = 400, now = Date.now() } = {}) {
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
  for (const h of previous || []) {
    if (!h?.title || !h?.url) continue;
    const { related = [], artistIds = [], topics, edition, ...head } = h;
    all.push(head);
    for (const r of related) if (r?.title && r?.url) all.push({ id: r.id || `gn:${r.url}`.slice(0, 200), title: r.title, source: r.source || null, sourceUrl: r.sourceUrl || null, url: r.url, publishedAt: r.publishedAt || null, lang: head.lang || lang, query: head.query || null });
  }
  const oldest = now - days * 864e5;
  const fresh = all.filter((it) => { const t = Date.parse(it.publishedAt || ''); return !Number.isFinite(t) || t >= oldest; });
  let pool = artists;
  if (lang === 'ko' && artists.length) {
    const learned = learnKoreanAliases(fresh.map((x) => x.title), artists);
    pool = artists.map((a) => {
      const names = [...new Set([...a.names, ...(learned.get(a.id) || [])])];
      return { ...a, names: [...new Set([...names, ...names.flatMap(hangulVariants)])] };
    });
  }
  const byKey = new Map();
  const seenUrl = new Set();
  for (const it of fresh) {
    const key = it.title.replace(/\s+/g, '').slice(0, 40);
    if (byKey.has(key) || seenUrl.has(it.url)) continue;
    const artistIds = matchArtists(it.title, pool, { confirm: lang === 'ko' ? MUSIC_KO : MUSIC_JA });
    const topics = topicsOf(it.title);
    const row = { ...it, artistIds, topics };
    if (keep && !keep(row)) continue;
    byKey.set(key, row);
    seenUrl.add(it.url);
  }
  const sorted = [...byKey.values()].sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
  return { items: cluster(sorted).slice(0, max), sources, fetchedAt: new Date().toISOString() };
}

/* ---------- 판(에디션) 뉴스 계획 ----------
 * 한국어 판 = 한국에서 본 J-POP, 일본어 판 = 일본에서 본 K-POP.
 * 예전에는 주제어 4개 + 상위 8팀 이름만 찾았고, 이름도 한국어 판에서 일본어 표기(あいみょん)·흔한 낱말(=LOVE → love)로 찾아
 * 대부분 버려졌다. 이제 로스터의 해당 출신 아티스트 전부를 그 판 언어로 쓰인 이름으로 묶어 돌아가며 찾는다. */
export const NEWS_TOPIC_QUERIES = {
  kr: ['J팝 내한', '일본 가수 내한', '일본 밴드 내한', 'J-POP 내한 공연', '일본 아이돌 내한', 'J팝 신곡 발매', 'J팝 페스티벌', 'J팝 콘서트', 'J팝 차트', '日 밴드'],
  jp: ['K-POP 来日', '韓国アイドル 来日公演', 'K-POP カムバック', 'K-POP 日本デビュー', 'K-POP 日本ツアー'],
};
/* 아티스트 이름이 제목에 없을 때 판 주제와 이어 주는 말(한국어 판: 일본 가수·밴드·J팝 …). 꾸밈말 한 낱말(日 인기 싱어송라이터)까지 */
export const NEWS_CONTEXT = {
  kr: /J-?팝|제이팝|J-?POP|J-?록|J-?ROCK|(?:일본|日)\s?(?:(?!(?:서|에서|에|의|과|와|은|는|이|가|로|으로|인|산|계|풍)\s)[가-힣]{1,4}\s?)?(?:가수|록\s?밴드|밴드|아이돌|걸\s?그룹|보이\s?그룹|싱어송라이터|뮤지션|음악인|음악가|듀오|보컬리스트|작곡가|음악감독)|(?:일본|日)\s?그룹/i,
  jp: /K-?POP|韓流|韓国(の)?(アイドル|グループ|歌手)|ボーイズグループ|ガールズグループ/i,
};
/* 검색에 쓸 이름: 한국어 판은 한글 표기 + 흔한 낱말과 겹치지 않는 로마자(5자 이상), 일본어 판은 일본어 표기 + 로마자.
   그 판 언어로 기사에 쓰이지 않는 표기(한국어 판의 가나·한자)는 검색어로 쓰지 않는다 */
export function searchNamesFor(a, lang) {
  const names = [...new Set([a.nameKo, a.name, a.nameOriginal, a.nameJa, ...(a.names || [])].filter(Boolean).map((n) => String(n).trim()))];
  const latinMin = lang === 'ko' ? 5 : 3;
  const latin = names.filter((n) => /[A-Za-z]/.test(n) && !/[가-힣぀-ヿ一-龯]/.test(n) && n.replace(/[^A-Za-z0-9]/g, '').length >= latinMin);
  const own = lang === 'ko'
    ? names.filter((n) => /^[가-힣 ]+$/.test(n) && n.replace(/ /g, '').length >= 2)
    : names.filter((n) => /[぀-ヿ一-龯]/.test(n) && !/[가-힣]/.test(n));
  const first = lang === 'ko' && a.nameKo && own.includes(a.nameKo) ? a.nameKo : own[0];
  return [first, latin[0]].filter(Boolean);
}
export function artistQueryBatches(artists, lang, { terms = 8 } = {}) {
  const batches = [];
  let cur = [];
  for (const a of artists) {
    const ns = searchNamesFor(a, lang);
    if (!ns.length) continue;
    if (cur.length + ns.length > terms) { batches.push(cur); cur = []; }
    cur.push(...ns);
  }
  if (cur.length) batches.push(cur);
  return batches.map((b) => b.map((n) => `"${n}"`).join(' OR '));
}
/* 한 번에 perRun 개씩, slot(실행 횟수)에 따라 차례로 — 주기 작업 몇 번이면 모든 검색어를 한 번씩 돈다 */
export function rotate(list, slot, perRun) {
  if (list.length <= perRun) return list;
  const start = (Math.max(0, Math.floor(slot)) * perRun) % list.length;
  return Array.from({ length: perRun }, (_, i) => list[(start + i) % list.length]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await newsFeed(process.argv.slice(2).length ? process.argv.slice(2) : ['J팝 내한', '일본 밴드 내한 공연'], { lang: 'ko' });
  for (const s of r.sources) console.log(s);
  for (const it of r.items.slice(0, 15)) console.log(it.publishedAt, '|', it.source, '|', it.title, '|', it.topics.join(','));
}

/* ---------- 매체 이름 ----------
   Google 뉴스는 일부 매체를 이름 대신 도메인(econovill.com, sports.khan.co.kr)으로 준다.
   매체 홈페이지의 공식 사이트명(og:site_name, 없으면 <title>의 첫 토막)을 읽어 바꾼다.
   홈이 없으면(v.daum.net) 상위 도메인(daum.net)으로 한 번 더. 끝내 못 찾으면 null — 도메인을 그대로 둔다. */
export const looksLikeDomain = (s) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(String(s || '').trim());
export function pickSiteName(html) {
  const dec = (x) => decodeXml(String(x || '')).replace(/\s+/g, ' ').trim();
  const og = dec((String(html).match(/<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']+)/i) || String(html).match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:site_name/i) || [])[1]);
  const title = dec((String(html).match(/<title[^>]*>([^<]*)/i) || [])[1]);
  const short = (x) => x && x.length <= 24 && !/^(home|top|index|トップ|홈)$/i.test(x) && !looksLikeDomain(x);
  if (short(og)) return og;
  const seg = title.split(/\s*[|｜—–:：]\s*|\s+-\s+/).map((x) => x.trim()).filter(short).sort((a, b) => a.length - b.length)[0];
  return seg || null;
}
export async function publisherName(domain, { get } = {}) {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '');
  if (!looksLikeDomain(d)) return null;
  const load = get || (async (u) => (await import('./http.mjs')).fetchText(u, { timeout: 9000, retries: 0 }));
  const tries = [d];
  const labels = d.split('.');
  if (labels.length > 2 && !/^(co|or|go|ne|ac)\.[a-z]{2}$/.test(labels.slice(-2).join('.'))) tries.push(labels.slice(1).join('.'));
  else if (labels.length > 3) tries.push(labels.slice(1).join('.'));
  for (const host of tries) {
    for (const scheme of ['https', 'http']) {
      try { const name = pickSiteName(await load(`${scheme}://${host}/`)); if (name) return name; break; } catch { /* 다음 */ }
    }
  }
  return null;
}
