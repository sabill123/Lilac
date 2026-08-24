/**
 * 한글 ↔ 일본어 음역 유틸
 *
 * 왜 필요한가
 *   한국 팬은 「ライラック」을 "라일락", 「ケセラセラ」를 "케세라세라"로 검색한다.
 *   Apple 카탈로그는 일본어 표기로만 검색되므로, 한글 질의를 가나로 바꿔 함께 조회해야 한다.
 *
 * 전략
 *   1) 한글 → 로마자 → 가타카나 로 변환해 외부 검색에 추가 질의로 사용
 *   2) 로컬 데이터(아티스트·상품·일정)는 음가 키(phoneticKey)로 퍼지 매칭
 *   3) 한자 제목·영어 제목처럼 음역으로 안 되는 건 별칭 사전(db/aliases.json)으로 보완
 */

const CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const JONG = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'l', 'l', 'l', 'l', 'l', 'l', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];

export const hasHangul = (s) => /[가-힣]/.test(String(s));
export const hasKana = (s) => /[ぁ-んァ-ヶ]/.test(String(s));

/** 일본어 음가에 직결되는 한글 음절 예외 */
const SYL_EXCEPTION = {
  '츠': 'tsu', '쓰': 'tsu', '쯔': 'tsu', '치': 'chi', '시': 'shi', '지': 'ji',
  '후': 'fu', '즈': 'zu', '츄': 'chu', '샤': 'sha', '슈': 'shu', '쇼': 'sho',
  '쟈': 'ja', '쥬': 'ju', '죠': 'jo', '챠': 'cha', '쵸': 'cho',
};

/** 한글 → 로마자 */
export function hangulToRomaji(s) {
  let out = '';
  for (const ch of String(s)) {
    if (SYL_EXCEPTION[ch]) { out += SYL_EXCEPTION[ch]; continue; }
    const code = ch.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) { out += ch; continue; }
    out += CHO[Math.floor(code / 588)] + JUNG[Math.floor((code % 588) / 28)] + JONG[code % 28];
  }
  return out.toLowerCase();
}

const KANA_R = {
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
/** 가나(카타카나·히라가나) → 로마자 */
export function kanaToRomaji(s) {
  const arr = [...String(s)].map((c) => (/[ぁ-ん]/.test(c) ? String.fromCharCode(c.charCodeAt(0) + 0x60) : c));
  let out = '';
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i], nx = arr[i + 1];
    if (nx && 'ャュョ'.includes(nx) && KANA_R[c]) { out += KANA_R[c].replace(/i$/, '') + KANA_R[nx]; i++; continue; }
    out += KANA_R[c] ?? c;
  }
  return out.toLowerCase();
}

const R2K = {
  // 한국어 로마자화에서 나오는 y-계열 (슈=syu, 쟈=jya 등)
  sya: 'シャ', syu: 'シュ', syo: 'ショ', sye: 'シェ',
  jya: 'ジャ', jyu: 'ジュ', jyo: 'ジョ', jye: 'ジェ',
  tya: 'チャ', tyu: 'チュ', tyo: 'チョ',
  chya: 'チャ', chyu: 'チュ', chyo: 'チョ',
  kya: 'キャ', kyu: 'キュ', kyo: 'キョ', sha: 'シャ', shu: 'シュ', sho: 'ショ', cha: 'チャ', chu: 'チュ', cho: 'チョ',
  nya: 'ニャ', nyu: 'ニュ', nyo: 'ニョ', hya: 'ヒャ', hyu: 'ヒュ', hyo: 'ヒョ', mya: 'ミャ', myu: 'ミュ', myo: 'ミョ',
  rya: 'リャ', ryu: 'リュ', ryo: 'リョ', gya: 'ギャ', gyu: 'ギュ', gyo: 'ギョ', ja: 'ジャ', ju: 'ジュ', jo: 'ジョ',
  bya: 'ビャ', byu: 'ビュ', byo: 'ビョ', pya: 'ピャ', pyu: 'ピュ', pyo: 'ピョ',
  ka: 'カ', ki: 'キ', ku: 'ク', ke: 'ケ', ko: 'コ', sa: 'サ', shi: 'シ', si: 'シ', su: 'ス', se: 'セ', so: 'ソ',
  ta: 'タ', chi: 'チ', ti: 'チ', tsu: 'ツ', tu: 'ツ', te: 'テ', to: 'ト', na: 'ナ', ni: 'ニ', nu: 'ヌ', ne: 'ネ', no: 'ノ',
  ha: 'ハ', hi: 'ヒ', fu: 'フ', hu: 'フ', he: 'ヘ', ho: 'ホ', ma: 'マ', mi: 'ミ', mu: 'ム', me: 'メ', mo: 'モ',
  ya: 'ヤ', yu: 'ユ', yo: 'ヨ', ra: 'ラ', ri: 'リ', ru: 'ル', re: 'レ', ro: 'ロ', wa: 'ワ', wo: 'ヲ',
  ga: 'ガ', gi: 'ギ', gu: 'グ', ge: 'ゲ', go: 'ゴ', za: 'ザ', ji: 'ジ', zi: 'ジ', zu: 'ズ', ze: 'ゼ', zo: 'ゾ',
  da: 'ダ', de: 'デ', do: 'ド', ba: 'バ', bi: 'ビ', bu: 'ブ', be: 'ベ', bo: 'ボ',
  pa: 'パ', pi: 'ピ', pu: 'プ', pe: 'ペ', po: 'ポ', va: 'ヴァ', vi: 'ヴィ', vu: 'ヴ', ve: 'ヴェ', vo: 'ヴォ',
  a: 'ア', i: 'イ', u: 'ウ', e: 'エ', o: 'オ', n: 'ン',
};
/** 로마자 → 가타카나 */
export function romajiToKatakana(r) {
  let s = String(r).toLowerCase().replace(/[^a-z]/g, '')
    .replace(/l/g, 'r')     // 한국어 ㄹ → ラ행
    .replace(/eu/g, 'u')    // 으 삽입 흡수
    .replace(/rr/g, 'r').replace(/nn/g, 'n');
  let out = '', i = 0;
  while (i < s.length) {
    let matched = false;
    for (const len of [3, 2, 1]) {
      const p = s.slice(i, i + len);
      if (R2K[p]) { out += R2K[p]; i += len; matched = true; break; }
    }
    if (matched) continue;
    if (s[i] === s[i + 1] && !'aeiou'.includes(s[i])) { out += 'ッ'; i++; continue; }
    const solo = R2K[s[i] + 'u'];
    if (solo) { out += solo; i++; continue; }
    i++;
  }
  return out;
}

/** 한글 → 가타카나 */
export const hangulToKatakana = (s) => romajiToKatakana(hangulToRomaji(s));

/** 언어 차이를 흡수한 음가 키 (매칭 비교용) */
export function phoneticKey(s) {
  let t = String(s || '');
  if (hasKana(t)) t = kanaToRomaji(t);
  else if (hasHangul(t)) t = hangulToRomaji(t);
  return t.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/gh/g, '')
    .replace(/sh/g, 's').replace(/ch/g, 'c').replace(/ts/g, 'c')
    .replace(/l/g, 'r')
    .replace(/eu/g, 'u')
    // 한국어와 일본어는 어두 유·무성 구분이 흐리다(가나데 ↔ かなで) → 무성으로 통일
    .replace(/g/g, 'k').replace(/z/g, 's').replace(/d/g, 't').replace(/b/g, 'p').replace(/j/g, 'c')
    .replace(/(.)\1+/g, '$1')
    .replace(/[uo]$/, '');
}

/**
 * 영어 제목의 한글 표기용 느슨한 키
 *  "킥백" ↔ "KICK BACK" 처럼 한국어가 영어를 음차한 경우를 맞춘다.
 *  한국어는 자음 뒤에 '으'를 넣고(브랜드=brand), ㅐ/ㅔ로 a를 받는다.
 */
export function looseKey(s) {
  let t = String(s || '');
  if (hasKana(t)) t = kanaToRomaji(t);
  else if (hasHangul(t)) t = hangulToRomaji(t);
  return t.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/ck/g, 'k').replace(/gh/g, '').replace(/ph/g, 'f')
    .replace(/sh/g, 's').replace(/ch/g, 'c').replace(/ts/g, 'c')
    .replace(/eu/g, '')        // 한국어 삽입 모음 제거 (브랜드 → brand)
    .replace(/eo/g, 'u')       // ㅓ가 영어 schwa/u를 받는다 (서브 → sub)
    .replace(/ae/g, 'a')       // ㅐ → a
    .replace(/l/g, 'r')
    .replace(/g/g, 'k').replace(/z/g, 's').replace(/d/g, 't').replace(/b/g, 'p').replace(/j/g, 'c')
    .replace(/(.)\1+/g, '$1')
    .replace(/[aeiou]+$/, '');
}

/** 편집 거리 (근사 매칭용) */
export function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** 두 문자열이 언어가 달라도 같은 발음인지 */
export function phoneticMatch(a, b) {
  const ka = phoneticKey(a), kb = phoneticKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  return short.length >= 3 && long.includes(short);
}

/**
 * 검색 질의 확장
 *  한글 질의면 가타카나·로마자 형태를 함께 만들어 외부 검색에 사용한다.
 *  aliases: { "라일락": "ライラック", ... } 형태의 별칭 사전
 */
export function expandQuery(q, aliases = {}) {
  const key = String(q).trim().toLowerCase();
  const exact = [];   // 별칭 정확 일치 — 가장 신뢰도 높음
  const fuzzy = [];   // 음가 일치 별칭
  for (const [ko, ja] of Object.entries(aliases)) {
    if (ko.toLowerCase() === key) exact.push(ja);
    else if (phoneticMatch(ko, q)) fuzzy.push(ja);
  }

  if (!hasHangul(q)) return [...new Set([q, ...exact, ...fuzzy])].slice(0, 4);

  // 한글 질의는 일본어 표기를 먼저 시도해야 한다.
  // (한글 그대로 일본 카탈로그를 치면 한국 곡·커버가 상위를 차지한다)
  const roma = hangulToRomaji(q).replace(/\s+/g, ' ').trim();
  const kata = romajiToKatakana(roma);
  // 한국어는 어두 ㄱ/ㄷ/ㅂ/ㅈ의 유무성이 흐려서(가나데=カナデ) 무성 변형도 후보에 넣는다
  const devoiced = roma.replace(/^g/, 'k').replace(/^d/, 't').replace(/^b/, 'p').replace(/^j/, 'ch');
  const kataDev = devoiced !== roma ? romajiToKatakana(devoiced) : '';

  const out = [...exact];
  if (kata && kata.length >= 2) out.push(kata);
  if (kataDev && kataDev.length >= 2) out.push(kataDev);
  out.push(...fuzzy);
  if (roma && roma.length >= 3) out.push(roma);
  out.push(q);   // 원 한글 질의는 마지막 폴백
  return [...new Set(out)].slice(0, 5);
}
