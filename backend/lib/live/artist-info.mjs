/* 아티스트 프로필 보강 — 사진(Deezer) · 소개(Wikipedia) · 출신국(MusicBrainz / Apple 장르)
 *
 *   Deezer      GET https://api.deezer.com/search/artist?q={name}     picture_xl(1000px), nb_fan
 *   Wikipedia   GET https://{ko|ja|en}.wikipedia.org/api/rest_v1/page/summary/{title}   extract, description, content_urls
 *   MusicBrainz GET https://musicbrainz.org/ws/2/artist?query=artist:"{name}"&fmt=json   country (1 req/s 제한)
 *   iTunes      GET https://itunes.apple.com/search?term={name}&entity=musicArtist&country=jp&limit=5   primaryGenreName
 *
 * 출신국 판정은 "이 공연이 일본 아티스트의 내한인가 / K-POP 아티스트의 공연인가"를 목록에서 자동으로 거르기 위한 것이다.
 * 사람이 적어 둔 목록이 아니라, 새 이름이 들어와도 위 공개 데이터로 판정한다. 판정 근거(originSource)를 함께 남긴다.
 */
import { fetchJson, sleep } from './http.mjs';
import { hangulToRomaji, phoneticMatch } from '../ko-ja.mjs';

const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s.・·'’"“”!?&＆-]/g, '');

/* ---------- Deezer 사진 ----------
 * 동명이인(HANA, King, LIT …)이 많아 이름만으로는 틀린 사진이 붙는다.
 * knownTitles(우리 카탈로그의 곡명)가 있으면 Deezer 인기곡 15곡과 겹치는 곡이 있을 때만 받는다. */
const tnorm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\(.*?\)|\[.*?\]|feat\..*$/g, '').replace(/[\s.・·'’"“”!?&＆_~〜-]/g, '');
const segs = (t) => [t, ...String(t || '').split(/\s[-–]\s|\s?[-–]\s|[(（\[]|[)）\]]|\/|,\s/)].map(tnorm).filter((x) => x.length >= 3);
export async function deezerArtist(names, { knownTitles = null } = {}) {
  const known = knownTitles ? new Set(knownTitles.flatMap(segs)) : null;
  /* Deezer는 요청이 몰리면 200 + {error:{code:4, Quota limit exceeded}}를 준다. 이걸 '사진 없음'으로 저장하면 안 된다 */
  let failed = 0;
  const dz = async (u) => { const j = await fetchJson(u, { timeout: 7000 }); if (j?.error) throw new Error(`deezer ${j.error.code || ''} ${j.error.message || ''}`); return j; };
  for (const n of names.filter(Boolean)) {
    try {
      const j = await dz(`https://api.deezer.com/search/artist?q=${encodeURIComponent(n)}&limit=5`);
      const data = j.data || [];
      const exact = data.filter((a) => norm(a.name) === norm(n));
      // 한자·가나·한글로 찾으면 Deezer는 로마자 표기로 돌려준다(米津玄師 → Kenshi Yonezu) — 첫 결과를 후보로
      const byFans = (a, b) => (b.nb_fan || 0) - (a.nb_fan || 0);
      const pool = known ? [...exact.sort(byFans), ...data.slice(0, 3)] : exact.length ? exact.sort(byFans) : /[぀-ヿ一-龯가-힣]/.test(n) && data[0] ? [data[0]] : [];
      const cands = pool.filter((a, i) => pool.findIndex((b) => b.id === a.id) === i);
      for (const best of cands.slice(0, 3)) {
        if (!best?.picture_xl || /d41d8cd98f00b204e9800998ecf8427e|\/artist\/\//.test(best.picture_xl)) continue;
        if (known && known.size) {
          const top = await dz(`https://api.deezer.com/artist/${best.id}/top?limit=15`).catch(() => { failed++; return null; });
          await sleep(250);
          const hit = (top?.data || []).some((t) => [...segs(t.title), ...segs(t.title_short)].some((x) => known.has(x)));
          if (!hit) continue;
        } else if (!exact.length && (best.nb_fan || 0) < 5000) continue;
        return { id: best.id, name: best.name, picture: best.picture_xl, pictureMedium: best.picture_big || best.picture_medium, fans: best.nb_fan ?? null, url: best.link, verified: !!known };
      }
    } catch { failed++; /* 다음 이름 */ }
    await sleep(250);
  }
  if (failed) throw new Error(`deezer lookup failed x${failed}`);
  return null;
}

/* ---------- Wikipedia 소개 ---------- */
export async function wikiSummary(titles, lang = 'ko') {
  for (const t of titles.filter(Boolean)) {
    try {
      const j = await fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}?redirect=true`, { timeout: 7000 });
      if (j.type === 'disambiguation' || !j.extract) continue;
      // 음악가 문서인지 대략 확인 (동명이인·일반명사 방지)
      if (!/(가수|밴드|그룹|음악|아이돌|싱어|래퍼|듀오|유닛|歌手|バンド|グループ|アイドル|ミュージシャン|シンガー|ユニット|音楽|singer|band|group|musician|duo|rapper)/i.test(`${j.description || ''} ${j.extract}`)) continue;
      return {
        title: j.title,
        description: j.description || null,
        extract: j.extract,
        url: j.content_urls?.desktop?.page || null,
        lang,
        thumbnail: j.thumbnail?.source && !/Replace_this_image|No_image/.test(j.thumbnail.source) ? j.thumbnail.source : null,
      };
    } catch { /* 다음 제목 */ }
  }
  return null;
}

/* ---------- 출신국 ---------- */

const JP_GENRES = /^(j-pop|j-rock|アニメ|anime|歌謡曲|kayokyoku|enka|演歌|ボーカロイド|vocaloid|japanese|アイドル)/i;
const KR_GENRES = /^(k-pop|korean|트로트)/i;
let mbLast = 0;
let itLast = 0;

class RetryLater extends Error {}

/* 한국 인명 로마자(성 + 한국식 이름 음절) — "PARK JINYOUNG", "KIM MINJU".
 * Apple이 일본 발매작 때문에 J-Pop으로 적어 둔 한국 가수를 일본 아티스트로 오판하지 않게 쓴다. */
const KR_SURNAME = /^(kim|lee|yi|park|pak|choi|choe|jung|jeong|chung|kang|cho|jo|yoon|yun|jang|chang|lim|im|han|oh|seo|suh|shin|kwon|hwang|ahn|an|song|yoo|yu|hong|jeon|jun|ko|go|moon|mun|yang|son|bae|baek|heo|nam|sim|noh|roh|ha|kwak|sung|cha|joo|woo|min|ryu|na|jin|ji|um|chae|won|bang|gong|hyun|byun|yeo|do|seok|ma|wang|ok|tak|eun)$/i;
const KR_SYLL = /(eo|eu|yeo|young|yeon|hyun|hyuk|seok|seung|jae|joon|jun|woo|hee|min|soo|sung|won|jin|ho|hoon|kyung|ji|eun|ah|yeong|chan|bin)/i;
export function looksKoreanRomanized(name) {
  const parts = String(name).trim().split(/[\s-]+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return false;
  const [sur, ...given] = parts;
  return KR_SURNAME.test(sur) && given.join('').length >= 3 && KR_SYLL.test(given.join(''));
}

/* Apple Search API는 분당 호출 수 제한이 있다(초과 시 200이 아닌 'Rate limit…' 본문). 호출 간격을 둔다. */
async function itunes(url) {
  const wait = 3100 - (Date.now() - itLast);
  if (wait > 0) await sleep(wait);
  itLast = Date.now();
  try {
    return await fetchJson(url, { timeout: 8000, retries: 0 });
  } catch (e) {
    throw new RetryLater(String(e?.message || e));
  }
}

async function musicBrainzCountry(name) {
  const wait = 1150 - (Date.now() - mbLast);
  if (wait > 0) await sleep(wait);
  mbLast = Date.now();
  const q = `artist:"${name.replace(/"/g, '')}"`;
  let j;
  try {
    j = await fetchJson(`https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(q)}&fmt=json&limit=5`, {
      timeout: 8000, headers: { 'User-Agent': 'Lilac/0.9 (cross-border fandom demo)' },
    });
  } catch (e) { throw new RetryLater(String(e?.message || e)); }
  const exact = (j.artists || []).filter((a) => a.score >= 85 && (norm(a.name) === norm(name) || (a.aliases || []).some((x) => norm(x.name) === norm(name))));
  const withCountry = exact.map((a) => a.country || (a.area?.['iso-3166-1-codes'] || [])[0] || null).filter(Boolean);
  if (!withCountry.length) return null;
  const uniq = [...new Set(withCountry)];
  return { country: uniq[0], ambiguous: uniq.length > 1, all: uniq };
}

/* 두 스토어(jp·kr)에서 이름이 정확히 같은 아티스트의 장르 */
async function itunesGenres(name) {
  const out = [];
  for (const store of ['jp', 'kr']) {
    const j = await itunes(`https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&country=${store}&limit=5`);
    for (const a of j.results || []) if (norm(a.artistName) === norm(name) && a.primaryGenreName) out.push({ store, genre: a.primaryGenreName, name: a.artistName });
  }
  return out;
}

async function fromCountry(name) {
  const mb = await musicBrainzCountry(name);
  if (!mb) return null;
  if (mb.ambiguous) return { origin: 'unknown', source: 'musicbrainz-ambiguous', countries: mb.all };
  if (mb.country === 'JP') return { origin: 'jp', source: 'musicbrainz' };
  if (mb.country === 'KR') return { origin: 'kr', source: 'musicbrainz' };
  return { origin: 'other', source: 'musicbrainz', country: mb.country };
}

/* name → { origin: 'jp'|'kr'|'other'|'kr-hangul'|'unknown', source, retry? }
 * retry:true 결과는 캐시하지 않는다 — 막힌 것(레이트리밋·타임아웃)과 "없음"은 다르다. */
export async function classifyOrigin(name, { roster = [] } = {}) {
  const n = String(name || '').trim();
  if (!n) return { origin: 'unknown', source: 'empty' };
  try {
    // 1) 문자 체계: 가나/한자만 있으면 일본
    if (/[぀-ヿ]/.test(n) && !/[가-힣]/.test(n)) return { origin: 'jp', source: 'script' };
    // 2) 아티스트 목록 — Apple 장르가 일본/한국 고유 장르인 경우만 신뢰
    const hit = roster.find((a) => [a.name, a.nameOriginal, a.nameJa, ...(a.aliases || [])].some((x) => x && norm(x) === norm(n)));
    if (hit?.appleGenre) {
      if (JP_GENRES.test(hit.appleGenre)) return { origin: 'jp', source: 'roster-genre', genre: hit.appleGenre, artistId: hit.id };
      if (KR_GENRES.test(hit.appleGenre)) return { origin: 'kr', source: 'roster-genre', genre: hit.appleGenre, artistId: hit.id };
    }

    if (/[가-힣]/.test(n)) {
      // 3a) 한국어 위키백과 설명 — "일본의 싱어송라이터"
      try {
        const w = await fetchJson(`https://ko.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(n.replace(/ /g, '_'))}?redirect=true`, { timeout: 7000 });
        const d = `${w.description || ''} ${(w.extract || '').slice(0, 160)}`;
        if (/(가수|밴드|그룹|싱어|음악|뮤지션|아이돌|래퍼|듀오|트리오|작곡가|피아니스트|연주자)/.test(d)) {
          if (/일본어:|일본의|일본 [가-힣]+(현|도|부|시) 출신|일본 출신|일본인/.test(d) && !/대한민국의/.test(d)) return { origin: 'jp', source: 'wikipedia-ko' };
          if (/대한민국의|한국의|대한민국 출신/.test(d)) return { origin: 'kr', source: 'wikipedia-ko' };
          return { origin: 'other', source: 'wikipedia-ko' };
        }
      } catch (e) {
        if (!/HTTP 404/.test(String(e?.message))) throw new RetryLater(String(e?.message || e));
      }
      // 3b) 일본식 로마자로 바꿔 Apple 일본 스토어에서 발음이 같은 아티스트 찾기 — 칸호 야쿠시지 → Kanho Yakushiji
      const romaji = hangulToRomaji(n);
      if (romaji && romaji.replace(/\s/g, '').length >= 4) {
        const j = await itunes(`https://itunes.apple.com/search?term=${encodeURIComponent(romaji)}&entity=musicArtist&country=jp&limit=5`);
        const m = (j.results || []).find((a) => /^[A-Za-z .'-]+$/.test(a.artistName) && phoneticMatch(a.artistName, n));
        if (m) {
          const c = await fromCountry(m.artistName).catch(() => null);
          if (c && c.origin !== 'unknown') return { ...c, source: `romaji+${c.source}`, matched: m.artistName };
          if (JP_GENRES.test(m.primaryGenreName || '')) return { origin: 'jp', source: 'romaji+itunes-genre', matched: m.artistName };
          // 발음만 비슷한 서양 이름(키퍼→Kiefer)일 수 있다 — 국적 근거가 없으면 판정하지 않는다
          return { origin: 'unknown', source: 'romaji-uncorroborated', matched: m.artistName };
        }
      }
      if (!/[a-z]/i.test(n)) return { origin: 'kr-hangul', source: 'script' };
    }

    // 4) 라틴 이름: MusicBrainz 국적이 한 나라로 정해지면 그걸 쓴다 (호출 1회)
    const c = await fromCountry(n);
    if (c && c.origin !== 'unknown') return c;
    // 5) 국적이 없거나 동명이인 충돌이면 Apple 두 스토어(jp·kr)의 장르를 대조
    const g = await itunesGenres(n);
    const jp = g.some((x) => JP_GENRES.test(x.genre));
    // 한국 스토어는 국내 아티스트 장르를 한국어로 적는다(록·댄스·발라드) — J-Pop이 아니면 한국 쪽 근거로 본다
    const krLocal = (x) => x.store === 'kr' && /[가-힣]/.test(x.genre) && !/제이팝|J-?팝|일본|애니/.test(x.genre);
    const kr = g.some((x) => KR_GENRES.test(x.genre) || krLocal(x));
    if (kr && !jp) return { origin: 'kr', source: 'itunes-genre', genre: g.find((x) => KR_GENRES.test(x.genre) || krLocal(x)).genre };
    if (jp && !kr && looksKoreanRomanized(n)) return { origin: 'unknown', source: 'itunes-jp-but-korean-name' };
    if (jp && !kr) return { origin: 'jp', source: 'itunes-genre', genre: g.find((x) => JP_GENRES.test(x.genre)).genre };
    if (jp && kr) return { origin: 'unknown', source: 'itunes-ambiguous' };
    // MusicBrainz에 같은 이름이 여러 나라로 있을 때(NEE: JP·NL) — Apple 일본 스토어에만 있고 K-Pop이 아니면 일본으로 본다
    if (c?.source === 'musicbrainz-ambiguous' && c.countries?.includes('JP') && g.some((x) => x.store === 'jp') && !kr) return { origin: 'jp', source: 'musicbrainz-ambiguous+itunes-jp' };
    return c || { origin: 'unknown', source: 'no-match' };
  } catch (e) {
    if (e instanceof RetryLater) return { origin: 'unknown', source: 'error', retry: true, error: e.message };
    return { origin: 'unknown', source: 'error', retry: true, error: String(e?.message || e) };
  }
}

/* 공연 제목에서 출연자 이름 후보 뽑기 */
export function performerCandidates(title) {
  let t = String(title || '').normalize('NFKC');
  const cands = [];
  // 괄호 안 라틴 이름: "카키 내한공연 (Khaki ONE-MAN Live in Seoul)", "위켄드(The Weeknd)", "키퍼 (Kiefer) 내한공연"
  for (const m of t.matchAll(/[(（]([^)）]+)[)）]/g)) {
    const inner = m[1].trim();
    if (/^[A-Za-z0-9 .&'’!_-]+$/.test(inner) && inner.length <= 40) cands.push(cut(inner));
  }
  t = t.replace(/^\s*[\[［【(（][^\]］】)）]*[\]］】)）]\s*/, '');            // [서울] ［Global］
  t = t.replace(/^\s*(\d{4}(-\d{2})?|제\s*\d+\s*회)\s*/, '');               // 2026 / 2026-27
  t = t.replace(/^(현대카드\s*슈퍼콘서트\s*\d+|NOL\s*FESTIVAL\s*:?)\s*/i, '');
  const main = cut(t);
  const latinFirst = cands.length && /[가-힣]/.test(main);
  if (latinFirst) cands.push(main); else cands.unshift(main);
  const hang = main.match(/^[가-힣]+(?:\s[가-힣]+)?/);
  if (hang && hang[0] !== main) cands.push(hang[0]);
  return [...new Set(cands.map((c) => c.trim()).filter((c) => c && c.length >= 2 && c.length <= 40))].slice(0, 3);
}

function cut(s) {
  const r = s
    .split(/\s*(?:첫\s*)?(?:단독\s*)?내한\s*공연|\s+(?:첫\s*)?내한|\s+(?:LIVE|Live|live)\b|\s+(?:ONE-?MAN|ONEMAN)\b|\s+(?:\d+(?:ST|ND|RD|TH))\b|\s+(?:WORLD|ASIA|JAPAN|KOREA|ARENA|DOME|FAN|FANCON|CONCERT|TOUR|SHOWCASE|SPECIAL|ENCORE|SOLO)\b|\s+(?:in|IN)\s+[A-Z]|\s+(?:콘서트|단독|팬미팅|전국투어|투어|쇼케이스|앙코르|월드|아시아|재팬|코리아|팬콘|라이브)|\s*[〈<「『［\[“"‘'〔:：|｜]|\s+-\s+|\s+(?:20\d{2})\b|\s+(?:ツアー|ライブ|ワンマン|ファンミーティング)/i)[0]
    .replace(/[\s,.·]+$/, '')
    .trim();
  // "PENTAGON PENTAGON" 처럼 같은 이름이 두 번 붙은 제목
  const w = r.split(/\s+/);
  if (w.length % 2 === 0 && w.length >= 2) {
    const h = w.length / 2;
    if (w.slice(0, h).join(' ').toLowerCase() === w.slice(h).join(' ').toLowerCase()) return w.slice(0, h).join(' ');
  }
  return r;
}

/* ---------- 한국어 표기 자동 해석 ----------
 * 한국 기사는 일본 아티스트를 한글 음차로 쓴다(요네즈 켄시, 미세스 그린 애플). 사람이 별칭을 적어 두지 않고
 *  1) 일본어 위키백과 → 한국어 문서 제목(langlinks, 20건씩 묶어서)
 *  2) 한국어 문서 제목이 라틴 문자면 그 문서 첫 문장 괄호 안의 한글 "Mrs. GREEN APPLE(미세스 그린 애플, …)"
 * 로 한글 표기를 얻는다. 위키백과 API는 UA 없는 대량 요청을 막으므로 UA를 붙이고 순차 호출한다. */
const WIKI_UA = { 'User-Agent': 'Lilac/0.9 (cross-border fandom demo)' };

export async function koreanNamesFor(titles) {
  const out = new Map();
  const checked = new Set();
  for (let i = 0; i < titles.length; i += 20) {
    const chunk = titles.slice(i, i + 20);
    const url = `https://ja.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(chunk.join('|'))}&prop=langlinks&lllang=ko&redirects=1&format=json`;
    let j;
    try { j = await fetchJson(url, { timeout: 9000, headers: WIKI_UA }); } catch { await sleep(2500); continue; }
    for (const t of chunk) checked.add(t);
    const back = new Map();
    for (const r of j.query?.normalized || []) back.set(r.to, r.from);
    for (const r of j.query?.redirects || []) back.set(r.to, back.get(r.from) || r.from);
    for (const p of Object.values(j.query?.pages || {})) {
      const src = back.get(p.title) || p.title;
      const koRaw = p.langlinks?.[0]?.['*'];
      if (!koRaw) continue;
      const ko = koRaw.replace(/\s*\([^)]*\)\s*$/, '');
      try {
        await sleep(250);
        const s = await fetchJson(`https://ko.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(koRaw.replace(/ /g, '_'))}`, { timeout: 8000, headers: WIKI_UA });
        // 같은 이름의 다른 문서(언어·숫자·동음이의)로 연결된 경우를 거른다 — 음악가 문서만
        const about = `${s.description || ''} ${String(s.extract || '').slice(0, 200)}`;
        if (s.type === 'disambiguation' || !/(가수|밴드|그룹|아이돌|싱어|음악|듀오|유닛|뮤지션|래퍼|보컬|프로듀서|작곡가)/.test(about)) continue;
        if (/[가-힣]/.test(ko)) { out.set(src, [ko]); continue; }
        const par = String(s.extract || '').match(/^[^(（]{0,80}[(（]([^)）]{1,120})[)）]/);
        if (par) {
          const tokens = par[1].split(/[,，;、]/).map((x) => x.trim());
          const pick = tokens.map((x) => (/^한국어\s*:/.test(x) ? x.replace(/^한국어\s*:\s*/, '') : /:/.test(x) ? '' : x))
            .find((x) => /^[가-힣][가-힣 ·]*[가-힣]$/.test(x));
          if (pick) out.set(src, [pick]);
        }
      } catch { /* 없음 */ }
    }
    await sleep(400);
  }
  out.checked = checked;
  return out;
}

/* 한국 아티스트의 일본어 표기 — 한국어 위키백과 문서의 일본어판 제목(볼빨간사춘기 → 赤頬思春期, 아이유 → IU).
   같은 이름의 다른 문서로 이어지는 것을 막으려고 일본어판 요약이 음악가 문서일 때만 쓴다. */
export async function japaneseNamesFor(titles, { second = true } = {}) {
  const out = new Map();
  const checked = new Set();
  for (let i = 0; i < titles.length; i += 20) {
    const chunk = titles.slice(i, i + 20);
    const url = `https://ko.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(chunk.join('|'))}&prop=langlinks&lllang=ja&redirects=1&format=json`;
    let j;
    try { j = await fetchJson(url, { timeout: 9000, headers: WIKI_UA }); } catch { await sleep(2500); continue; }
    for (const t of chunk) checked.add(t);
    const back = new Map();
    for (const r of j.query?.normalized || []) back.set(r.to, r.from);
    for (const r of j.query?.redirects || []) back.set(r.to, back.get(r.from) || r.from);
    for (const p of Object.values(j.query?.pages || {})) {
      const src = back.get(p.title) || p.title;
      const jaRaw = p.langlinks?.[0]?.['*'];
      if (!jaRaw) continue;
      try {
        await sleep(300);
        const sum = await fetchJson(`https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(jaRaw.replace(/ /g, '_'))}`, { timeout: 8000, headers: WIKI_UA });
        const about = `${sum.description || ''} ${String(sum.extract || '').slice(0, 200)}`;
        if (sum.type === 'disambiguation' || !/(歌手|グループ|バンド|アイドル|ユニット|ラッパー|シンガー|音楽|ミュージシャン|デュオ|ボーカル|作曲家|プロデューサー)/.test(about)) continue;
        const ja = jaRaw.replace(/\s*[(（][^)）]*[)）]\s*$/, '').trim();
        if (ja && !/[가-힣]/.test(ja)) out.set(src, ja);
      } catch {
        /* 요약을 못 받은 건 "없음"이 아니라 "다음에 다시" — 확인한 것으로 치지 않는다 */
        checked.delete(src);
      }
    }
    await sleep(500);
  }
  /* 같은 이름의 다른 문서(동음이의)에 막힌 이름은 "이름 (가수)" 문서로 한 번 더(정국·제니·헤이즈) */
  if (second) {
    const rest = titles.filter((t) => checked.has(t) && !out.has(t) && !/\(가수\)$/.test(t));
    if (rest.length) {
      const r2 = await japaneseNamesFor(rest.map((t) => `${t} (가수)`), { second: false });
      for (const t of rest) {
        const v = r2.get(`${t} (가수)`);
        if (v) out.set(t, v);
        if (!r2.checked.has(`${t} (가수)`)) checked.delete(t);
      }
    }
  }
  out.checked = checked;
  return out;
}

/* ---------- Apple 아티스트 신원 확인 ----------
 * 차트 이름으로 iTunes를 검색해 첫 결과를 그대로 쓰면 동명이인·다른 팀이 붙는다
 * (로제 → Pascal Rogé, 제니 → Gavy NJ, 星野源 → aespa, NewJeans → NCT DREAM).
 * 규칙: Apple 이름이 (1) 우리 이름과 같거나 (2) 위키백과 영어판 제목과 같거나 (3) 한글 이름의 로마자 자음 뼈대와 비슷해야 인정한다.
 * 확인이 안 되면 위키백과 영어 이름으로 다시 찾고, 그래도 없으면 Apple 연결을 끊는다(틀린 사진·곡을 보여주지 않게). */
/* ≠·= 는 이름의 일부다(≠ME ≠ ME, =LOVE ≠ LOVE) — 지우지 않고 Apple이 쓰는 영어 표기(Not Equal Me)와 맞춘다 */
const loose = (s) => String(s || '').replace(/≠/g, 'notequal').replace(/[=＝]/g, 'equal').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').normalize('NFKC').toLowerCase().replace(/\s*[(（][^)）]*[)）]\s*/g, ' ').replace(/[^a-z0-9가-힣぀-ヿ一-龯]/g, '');
const skel = (s) => loose(s).replace(/ch/g, 'j').replace(/th/g, 't').replace(/[aeiouyw]/g, '').replace(/[gq]/g, 'k').replace(/c/g, 'k').replace(/z/g, 'j').replace(/d/g, 't').replace(/b/g, 'p').replace(/v/g, 'p').replace(/f/g, 'p').replace(/r/g, 'l').replace(/x/g, 'ks').replace(/h/g, '');
function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bg = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; };
  const A = bg(a), B = bg(b);
  let inter = 0;
  for (const [k, v] of A) inter += Math.min(v, B.get(k) || 0);
  const tot = Math.max(1, a.length - 1) + Math.max(1, b.length - 1);
  return (2 * inter) / tot;
}
export function romanSimilar(hangul, latin) {
  if (!/[가-힣]/.test(hangul) || !/[A-Za-z]/.test(latin)) return false;
  const k = skel(hangulToRomaji(hangul)), l = skel(latin);
  if (!k || !l) return false;
  /* 짧은 이름은 같거나 한쪽이 다른 쪽에 한 글자만 더 붙은 경우만(리도어 lt ↔ Redoor ltl) */
  if (k.length <= 2 || l.length <= 2) return k === l || (Math.abs(k.length - l.length) <= 1 && (k.startsWith(l) || l.startsWith(k)));
  return dice(k, l) >= 0.6;
}

/* 한국어·일본어 위키백과의 영어판 제목 — "로제 (가수)" → "Rosé (singer)" → "Rosé". 실패는 RetryLater(없음과 구분) */
export async function englishNamesFor(name, { country = null } = {}) {
  /* 글자로 언어를 정하고, 기호가 섞인 로마자 이름(≠ME)은 나라 위키백과에서 찾는다 */
  const lang = /[가-힣]/.test(name) ? 'ko' : /[぀-ヿ一-龯]/.test(name) ? 'ja' : /[^A-Za-z0-9\s.'&-]/.test(name) && country ? (country === 'jp' ? 'ja' : 'ko') : null;
  if (!lang) return [];
  const suffix = lang === 'ko' ? ['', ' (가수)', ' (음악가)', ' (밴드)'] : ['', ' (歌手)', ' (バンド)', ' (音楽グループ)'];
  const titles = suffix.map((s) => name + s);
  let j;
  try {
    j = await fetchJson(`https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles.join('|'))}&prop=langlinks|pageprops&lllang=en&redirects=1&format=json`, { timeout: 9000, headers: WIKI_UA });
  } catch (e) { throw new RetryLater(String(e?.message || e)); }
  const out = [];
  for (const p of Object.values(j.query?.pages || {})) {
    if (p.pageprops && 'disambiguation' in p.pageprops) continue;
    const en = p.langlinks?.[0]?.['*'];
    if (en) out.push(en.replace(/\s*\([^)]*\)\s*$/, '').trim());
  }
  /* 동음이의 문서뿐이면(제니 → "제니 (1996년)") "이름 가수"로 검색해 제목이 이름으로 시작하는 문서만 본다 */
  if (!out.length) {
    try {
      const sr = await fetchJson(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`${name} ${lang === 'ko' ? '가수' : '歌手'}`)}&srlimit=5&format=json`, { timeout: 9000, headers: WIKI_UA });
      const hits = (sr.query?.search || []).map((x) => x.title).filter((t) => t === name || t.startsWith(`${name} (`)).slice(0, 2);
      if (hits.length) {
        const j2 = await fetchJson(`https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(hits.join('|'))}&prop=langlinks|pageprops&lllang=en&redirects=1&format=json`, { timeout: 9000, headers: WIKI_UA });
        for (const p of Object.values(j2.query?.pages || {})) {
          if (p.pageprops && 'disambiguation' in p.pageprops) continue;
          const en = p.langlinks?.[0]?.['*'];
          if (en) out.push(en.replace(/\s*\([^)]*\)\s*$/, '').trim());
        }
      }
    } catch (e) { throw new RetryLater(String(e?.message || e)); }
  }
  return [...new Set(out)];
}

let itLastApple = 0;
/* iTunes 검색 API는 분당 약 20회. 이 프로세스의 모든 iTunes 호출(수집기 포함)이 이 줄을 같이 선다 */
let itChain = Promise.resolve();
export function itunesThrottle(gap = 3100) {
  const run = itChain.then(async () => { const wait = gap - (Date.now() - itLastApple); if (wait > 0) await sleep(wait); itLastApple = Date.now(); });
  itChain = run.catch(() => {});
  return run;
}
async function itunesArtists(term, country) {
  await itunesThrottle();
  let j;
  try { j = await fetchJson(`https://itunes.apple.com/search?media=music&entity=musicArtist&country=${country}&limit=8&term=${encodeURIComponent(term)}`, { timeout: 9000, retries: 2 }); } catch (e) { throw new RetryLater(String(e?.message || e)); }
  return j.results || [];
}
async function itunesLatest(artistId, country) {
  await itunesThrottle();
  try {
    const j = await fetchJson(`https://itunes.apple.com/lookup?id=${artistId}&entity=album&limit=10&sort=recent&country=${country}`, { timeout: 9000, retries: 1 });
    const ds = (j.results || []).filter((x) => x.wrapperType === 'collection' && x.releaseDate).map((x) => x.releaseDate).sort();
    return ds.length ? ds[ds.length - 1] : null;
  } catch { return null; }
}
async function itunesArtwork(artistId, country) {
  try {
    await itunesThrottle();
    const j = await fetchJson(`https://itunes.apple.com/lookup?id=${artistId}&entity=album&limit=3&country=${country}`, { timeout: 9000, retries: 1 });
    const al = (j.results || []).find((x) => x.wrapperType === 'collection' && x.artworkUrl100);
    return al ? al.artworkUrl100.replace('100x100', '600x600') : null;
  } catch { return null; }
}

/* names: 우리 쪽 대표 이름들(이름·원어 표기·일본어 표기). appleName: 지금 붙어 있는 Apple 이름 */
export async function checkAppleIdentity({ names, appleName = null, appleId = null, appleGenre = null, country = 'kr', enNames = null, charting = false }) {
  const prim = [...new Set(names.filter(Boolean))];
  const L = new Set(prim.map(loose).filter(Boolean));
  const ok = (n) => n && (L.has(loose(n)) || prim.some((p) => romanSimilar(p, n)));
  const ORIGIN_G = country === 'jp' ? /J-Pop|J-Rock|アニメ|Anime|歌謡曲|演歌|Enka|ボーカロイド|Vocaloid|애니메이션|일본/i : /K-Pop|케이팝|트로트|Korean|한국/i;
  const FOREIGN_G = /프랑스|이스라엘|라틴|브라질|독일|아랍|인도|터키|러시아|만다린|칸토|중국|French|Israeli|Latin|Brazil|German|Arabic|Indian|Turkish|Russian|Mandarin|Canto|클래식|Classical|크리스천|Christian|컨트리|Country|레게|Reggae|오페라|Opera|월드|World/i;
  /* 이름이 같아도 동명이인일 수 있다(제니 → 2009년 싱글 하나뿐인 "제니"). 차트에 오른 팀인데 3년 넘게 음반이 없으면 다시 찾는다 */
  let stale = false;
  if (appleName && prim.some((p) => loose(p) === loose(appleName))) {
    /* 이름은 같은데 장르가 K-Pop·J-Pop이 아니면(BIGBANG ↔ 힙합 'Big Bang') 같은 이름의 K-Pop·J-Pop 팀이 있는지 본다 */
    if (appleGenre && !ORIGIN_G.test(appleGenre)) {
      const same = [];
      for (const cc of country === 'jp' ? ['jp', 'kr'] : ['kr', 'jp']) { for (const r of await itunesArtists(appleName, cc)) if (loose(r.artistName) === loose(appleName) && ORIGIN_G.test(r.primaryGenreName || '') && !same.some((x) => x.artistId === r.artistId)) same.push({ ...r, cc }); if (same.length) break; }
      if (same.length && !same.some((r) => String(r.artistId) === String(appleId))) {
        let best = same[0];
        if (same.length > 1 && charting) { let bl = ''; for (const r of same) { const l = (await itunesLatest(r.artistId, r.cc)) || ''; if (l > bl) { bl = l; best = r; } } }
        return { status: 'fixed', appleArtistId: best.artistId, appleName: best.artistName, genre: best.primaryGenreName || null, official: best.artistLinkUrl || null, artwork: await itunesArtwork(best.artistId, best.cc), en: [], reason: 'genre' };
      }
    }
    if (!charting || !appleId) return { status: 'ok', via: 'name' };
    const latest = await itunesLatest(appleId, country);
    if (!latest || Date.now() - Date.parse(latest) < 3 * 365 * 24 * 3600e3) return { status: 'ok', via: 'name', latest };
    stale = true;
  }
  const en = enNames || (await (async () => { const out = []; for (const p of prim.filter((x) => /[가-힣぀-ヿ一-龯]|[^A-Za-z0-9\s.'&-]/.test(x)).slice(0, 2)) out.push(...await englishNamesFor(p, { country })); return [...new Set(out)]; })());
  for (const e of en) L.add(loose(e));
  if (appleName && !stale && L.has(loose(appleName))) return { status: 'ok', via: 'wikipedia-en', en };
  /* 위키백과 영어 이름이 없을 때만 로마자 뼈대 비교를 믿는다(헤이즈 ↔ Heize, 한요한 ↔ Han Yo Han) */
  if (appleName && !stale && !en.length && prim.some((p) => romanSimilar(p, appleName))) return { status: 'ok', via: 'romanization' };
  /* 다시 찾기: 영어 이름 → 로마자 이름 → 원어 이름 순서, 이름이 정확히 같은 결과만.
     같은 이름이 여럿이면 장르(K-Pop·J-Pop)가 맞는 쪽, 차트에 오른 팀이면 최근 3년 안에 낸 음반이 있는 쪽 */
  const terms = [...new Set([...en, ...prim.filter((x) => /[A-Za-z]/.test(x)), ...prim])];
  const stores = country === 'jp' ? ['jp', 'kr'] : ['kr', 'jp'];
  const seen = new Map();
  outer: for (const t of terms.slice(0, 4)) {
    for (const cc of stores) {
      const rs = await itunesArtists(t, cc);
      /* 이름이 같거나, 영어 이름을 모를 때는 한글 이름의 로마자와 비슷한 결과(리도어 ↔ Redoor)도 후보로 */
      for (const r of rs) if ((L.has(loose(r.artistName)) || (!en.length && prim.some((p) => romanSimilar(p, r.artistName)))) && !seen.has(r.artistId)) seen.set(r.artistId, { ...r, cc });
      if ([...seen.values()].some((r) => ORIGIN_G.test(r.primaryGenreName || ''))) break outer;
    }
  }
  const scored = [];
  for (const r of seen.values()) {
    const g = r.primaryGenreName || '';
    /* 장르가 먼저(K-Pop·J-Pop이면 크게), 최근 음반은 같은 장르끼리 가르는 데만(BIGBANG처럼 쉬고 있는 팀을 다른 'Big Bang'에 뺏기지 않게) */
    let sc = ORIGIN_G.test(g) ? 10 : FOREIGN_G.test(g) ? -10 : 1;
    if (charting && sc > -10) {
      const latest = await itunesLatest(r.artistId, r.cc);
      if (latest) sc += Date.now() - Date.parse(latest) < 3 * 365 * 24 * 3600e3 ? 2 : -1;
    }
    scored.push({ r, sc });
  }
  scored.sort((x, y) => y.sc - x.sc);
  const best = scored[0];
  if (best && best.sc >= 1) {
    const hit = best.r;
    if (appleName && String(hit.artistId) === String(appleId || '')) return { status: 'ok', via: 'search', en };
    return { status: 'fixed', appleArtistId: hit.artistId, appleName: hit.artistName, genre: hit.primaryGenreName || null, official: hit.artistLinkUrl || null, artwork: await itunesArtwork(hit.artistId, hit.cc), en };
  }
  if (!appleName) return { status: 'none', en };
  /* 영어 이름이 있는데 Apple 이름과 다르고, 다시 찾아도 없으면 지금 연결은 틀린 것으로 본다 */
  if (stale) return { status: 'none', en, reason: 'stale-homonym' };
  if (en.length || prim.some((p) => /[가-힣]/.test(p))) return ok(appleName) ? { status: 'ok', via: 'loose', en } : { status: 'none', en };
  return { status: 'unknown', en };
}

/* 위키백과에서 가져온 한국어 표기가 로마자 이름과 소리가 맞는지(SixTONES ↔ "스톤즈"는 틀린 표기, 米津玄師 ↔ "요네즈 켄시"는 Apple "Kenshi Yonezu"와 낱말 순서만 다르다).
   로마자 이름이 하나도 없으면 판단하지 않고 통과시킨다 */
export function koreanNameFits(ko, latinNames) {
  const lat = (latinNames || []).filter((n) => /[A-Za-z]/.test(n || ''));
  if (!lat.length || !/[가-힣]/.test(ko || '')) return true;
  const kt = String(ko).split(/\s+/).filter(Boolean);
  return lat.some((n) => {
    if (romanSimilar(ko.replace(/\s+/g, ''), n)) return true;
    const lt = String(n).split(/[\s・·_-]+/).filter(Boolean);
    return kt.length > 1 && kt.every((k) => lt.some((l) => romanSimilar(k, l)));
  });
}
