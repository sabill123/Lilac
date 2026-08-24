/**
 * 일본어 읽기(요미) 자동 생성
 *
 * 왜 필요한가
 *   「花に亡霊」을 "하나니보레이"로 검색하려면 한자의 읽기를 알아야 한다.
 *   별칭을 손으로 적으면 신곡·미등록곡은 영원히 검색되지 않는다.
 *   형태소 분석기로 읽기를 자동 생성하면 어떤 일본어 텍스트든 대응된다.
 */
import kuromoji from 'kuromoji';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIC = path.join(__dirname, '../../node_modules/kuromoji/dict');

let tokenizer = null;
let building = null;

/** 분석기는 무겁다(사전 로딩 ~1초) — 프로세스당 한 번만 만든다 */
export function initTokenizer() {
  if (tokenizer) return Promise.resolve(tokenizer);
  if (building) return building;
  building = new Promise((resolve) => {
    kuromoji.builder({ dicPath: DIC }).build((err, tk) => {
      if (err) { console.error('[readings] 형태소 분석기 로딩 실패:', err.message); resolve(null); return; }
      tokenizer = tk;
      resolve(tk);
    });
  });
  return building;
}

const hiraToKata = (s) => s.replace(/[ぁ-ん]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

/**
 * 일본어 텍스트 → 가타카나 읽기
 * 읽기를 못 찾은 토큰은 원문을 유지한다(영문·기호 등).
 */
export function toReading(text) {
  if (!tokenizer || !text) return '';
  try {
    return tokenizer.tokenize(String(text))
      .map((t) => t.reading || hiraToKata(t.surface_form))
      .join('');
  } catch { return ''; }
}

/**
 * 하나의 텍스트에서 나올 수 있는 읽기 후보들
 *  - 형태소 분석 읽기
 *  - 원문에 이미 들어있는 가나
 * 곡 제목은 사전과 다른 특수 읽기(晴る=ハル)가 흔해 후보를 여러 개 둔다.
 */
export function readingVariants(text) {
  const out = new Set();
  const r = toReading(text);
  if (r) out.add(r);
  const kanaOnly = String(text).replace(/[^ぁ-んァ-ヶー]/g, '');
  if (kanaOnly.length >= 2) out.add(hiraToKata(kanaOnly));
  return [...out];
}
