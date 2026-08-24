/**
 * 클라이언트 측 한글↔일본어 음가 매칭
 * 보관함·플레이리스트 같은 로컬 목록 필터에서 "라일락"으로 「ライラック」을 찾게 한다.
 * (외부 카탈로그 검색은 서버 backend/lib/ko-ja.mjs 가 담당)
 */

const CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const JONG = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'l', 'l', 'l', 'l', 'l', 'l', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
const SYL_EXCEPTION: Record<string, string> = {
  '츠': 'tsu', '쓰': 'tsu', '쯔': 'tsu', '치': 'chi', '시': 'shi', '지': 'ji',
  '후': 'fu', '즈': 'zu', '츄': 'chu', '샤': 'sha', '슈': 'shu', '쇼': 'sho',
};

const KANA_R: Record<string, string> = {
  'ア': 'a', 'イ': 'i', 'ウ': 'u', 'エ': 'e', 'オ': 'o', 'カ': 'ka', 'キ': 'ki', 'ク': 'ku', 'ケ': 'ke', 'コ': 'ko',
  'サ': 'sa', 'シ': 'shi', 'ス': 'su', 'セ': 'se', 'ソ': 'so', 'タ': 'ta', 'チ': 'chi', 'ツ': 'tsu', 'テ': 'te', 'ト': 'to',
  'ナ': 'na', 'ニ': 'ni', 'ヌ': 'nu', 'ネ': 'ne', 'ノ': 'no', 'ハ': 'ha', 'ヒ': 'hi', 'フ': 'fu', 'ヘ': 'he', 'ホ': 'ho',
  'マ': 'ma', 'ミ': 'mi', 'ム': 'mu', 'メ': 'me', 'モ': 'mo', 'ヤ': 'ya', 'ユ': 'yu', 'ヨ': 'yo',
  'ラ': 'ra', 'リ': 'ri', 'ル': 'ru', 'レ': 're', 'ロ': 'ro', 'ワ': 'wa', 'ヲ': 'o', 'ン': 'n',
  'ガ': 'ga', 'ギ': 'gi', 'グ': 'gu', 'ゲ': 'ge', 'ゴ': 'go', 'ザ': 'za', 'ジ': 'ji', 'ズ': 'zu', 'ゼ': 'ze', 'ゾ': 'zo',
  'ダ': 'da', 'ヂ': 'ji', 'ヅ': 'zu', 'デ': 'de', 'ド': 'do', 'バ': 'ba', 'ビ': 'bi', 'ブ': 'bu', 'ベ': 'be', 'ボ': 'bo',
  'パ': 'pa', 'ピ': 'pi', 'プ': 'pu', 'ペ': 'pe', 'ポ': 'po', 'ヴ': 'vu',
  'ッ': '', 'ー': '', 'ャ': 'ya', 'ュ': 'yu', 'ョ': 'yo', 'ァ': 'a', 'ィ': 'i', 'ゥ': 'u', 'ェ': 'e', 'ォ': 'o',
};

const hasHangul = (s: string) => /[가-힣]/.test(s);
const hasKana = (s: string) => /[ぁ-んァ-ヶ]/.test(s);

function hangulToRomaji(s: string): string {
  let out = '';
  for (const ch of s) {
    if (SYL_EXCEPTION[ch]) { out += SYL_EXCEPTION[ch]; continue; }
    const code = ch.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) { out += ch; continue; }
    out += CHO[Math.floor(code / 588)] + JUNG[Math.floor((code % 588) / 28)] + JONG[code % 28];
  }
  return out.toLowerCase();
}

function kanaToRomaji(s: string): string {
  const arr = [...s].map((c) => (/[ぁ-ん]/.test(c) ? String.fromCharCode(c.charCodeAt(0) + 0x60) : c));
  let out = '';
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i]; const nx = arr[i + 1];
    if (nx && 'ャュョ'.includes(nx) && KANA_R[c]) { out += KANA_R[c].replace(/i$/, '') + KANA_R[nx]; i++; continue; }
    out += KANA_R[c] ?? c;
  }
  return out.toLowerCase();
}

/** 언어 차이를 흡수한 음가 키 */
export function phoneticKey(s: string): string {
  let t = String(s || '');
  if (hasKana(t)) t = kanaToRomaji(t);
  else if (hasHangul(t)) t = hangulToRomaji(t);
  return t.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/gh/g, '')
    .replace(/sh/g, 's').replace(/ch/g, 'c').replace(/ts/g, 'c')
    .replace(/l/g, 'r').replace(/eu/g, 'u')
    .replace(/g/g, 'k').replace(/z/g, 's').replace(/d/g, 't').replace(/b/g, 'p').replace(/j/g, 'c')
    .replace(/(.)\1+/g, '$1')
    .replace(/[uo]$/, '');
}

/**
 * 별칭 사전 (한국 팬이 쓰는 검색어 → 일본어 원표기)
 * 한자 제목(하루→晴る)이나 영어 제목(킥백→KICK BACK)은 음역으로 못 잡으므로 사전이 필요하다.
 */
let ALIASES: Record<string, string> = {};

export async function loadAliases(): Promise<void> {
  try {
    const r = await fetch('/api/aliases');
    if (r.ok) ALIASES = await r.json();
  } catch { /* 사전 없이도 음역 매칭은 동작한다 */ }
}

/** 질의에 대응하는 일본어 표기들 */
function aliasFor(q: string): string[] {
  const key = q.trim().toLowerCase();
  const out: string[] = [];
  for (const [ko, ja] of Object.entries(ALIASES)) {
    const k = ko.toLowerCase();
    if (k === key || k.replace(/\s+/g, '') === key.replace(/\s+/g, '')) out.push(ja);
  }
  return out;
}

/**
 * 목록 필터용 매칭
 * 부분일치 → 별칭 사전 → 음가 순으로 확인한다.
 */
export function smartMatch(haystack: string, query: string): boolean {
  const q = String(query || '').trim();
  if (!q) return true;
  const h = String(haystack || '');
  const hl = h.toLowerCase();
  if (hl.includes(q.toLowerCase())) return true;
  // 별칭 사전 (한자·영어 제목 대응)
  for (const ja of aliasFor(q)) {
    if (hl.includes(ja.toLowerCase())) return true;
  }
  const qk = phoneticKey(q);
  if (qk.length < 2) return false;
  return phoneticKey(h).includes(qk);
}
