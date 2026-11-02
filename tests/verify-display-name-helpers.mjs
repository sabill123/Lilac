/* 화면 표시 이름 헬퍼(cards.ts artistName · fcguide.ts displayName) — 화면 언어 기준, 확인된 nameKo/nameJa 우선, 라틴 브랜드 유지 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
/* 헬퍼 함수 원문만 꺼내(다른 화면 모듈은 불러오지 않는다) getLocale을 바꿔 가며 실행 */
function extract(src, sig) {
  const i = src.indexOf(sig); assert.ok(i >= 0, sig);
  let p = 1, q = i + sig.length;
  for (; p > 0; q++) { if (src[q] === '(') p++; else if (src[q] === ')') p--; }
  /* 기본값 \`= {}\`도 지나 본문 여는 괄호(줄 끝의 '{') */
  let depth = 0, j = src.indexOf('{\n', q);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1).replace(/^export /, ''); }
  throw new Error('unbalanced ' + sig);
}
const cards = await readFile(new URL('../frontend/src/app/cards.ts', import.meta.url), 'utf8');
const guide = await readFile(new URL('../frontend/src/app/fcguide.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(`let __loc = 'ko'; const getLocale = () => __loc; export const setLocale = (l: string) => { __loc = l; };\n${extract(cards, 'export function artistName(')}\n${extract(guide, 'export function displayName(')}\nexport { artistName, displayName };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { artistName, displayName, setLocale } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const hige = { name: 'Official髭男dism', nameOriginal: 'Official髭男dism', nameJa: 'Official髭男dism', nameKo: '오피셜히게단디즘' };
setLocale('ko');
assert.equal(artistName(hige), '오피셜히게단디즘');
assert.equal(artistName({ ...hige, nameKo: null }), 'Official髭男dism');           // 확인된 이름 없으면 원래 이름(지어내지 않음)
assert.equal(artistName({ ...hige, nameKo: 'Official HIGE' }), 'Official髭男dism'); // 한글 아닌 nameKo는 무시
assert.equal(artistName({ name: 'Mrs. GREEN APPLE', nameKo: '미세스 그린 애플' }), 'Mrs. GREEN APPLE'); // 라틴 브랜드 유지
assert.equal(artistName({ name: '볼빨간사춘기', nameJa: '赤頬思春期' }), '볼빨간사춘기');
assert.equal(displayName('乃木坂46', [], false, { nameKo: '노기자카46' }), '노기자카46');
assert.equal(displayName('乃木坂46', ['Nogizaka46'], false), '乃木坂46');
assert.equal(displayName('King Gnu', [], false, { nameKo: '킹 누' }), 'King Gnu');
setLocale('ja');
assert.equal(artistName({ name: '볼빨간사춘기', nameOriginal: 'BOL4', nameJa: '赤頬思春期' }), '赤頬思春期'); // nameJa 우선
assert.equal(artistName({ name: '볼빨간사춘기', nameOriginal: 'BOL4' }), 'BOL4');
assert.equal(artistName({ name: '아이묭', nameJa: 'あいみょん', nameKo: '아이묭' }), 'あいみょん');
assert.equal(artistName(hige), 'Official髭男dism');
assert.equal(artistName({ name: '임영웅' }), '임영웅');
assert.equal(displayName('볼빨간사춘기', ['BOL4'], true, { nameJa: '赤頬思春期' }), '赤頬思春期');
assert.equal(displayName('볼빨간사춘기', ['BOL4'], true), 'BOL4');
assert.equal(displayName('BTS', [], true, { nameJa: '防弾少年団' }), 'BTS');
console.log('PASS display-name helpers: locale (not edition) decides; verified nameKo for kana/kanji in KO, nameJa for hangul in JA; Latin brands unchanged; no fabrication');
