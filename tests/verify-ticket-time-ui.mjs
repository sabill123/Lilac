#!/usr/bin/env node
/** Run: node tests/verify-ticket-time-ui.mjs
 * 실제 frontend/src/app/ui.ts·cards.ts를 실행해 티켓 시각 표시가 주입된 서버시계(setTicketTimeSource)만 쓰는지 확인한다.
 * 고정 서버 시각을 명시적으로 주입하고, 로컬 Date.now는 일부러 7시간 틀리게 만든다. 미동기면 오픈/마감을 단정하지 않는다. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const read = (rel) => readFileSync(new URL(`../frontend/src/app/${rel}`, import.meta.url), 'utf8');
const SKEW = -7 * 3600_000;
class SkewedDate extends Date { constructor(...a) { if (a.length) super(...a); else super(Date.now() + SKEW); } static now() { return Date.now() + SKEW; } }
function load(rel, deps, source = read(rel)) {
  const ctx = vm.createContext({ console, Date: SkewedDate, URL, URLSearchParams, location: { hash: '' } });
  const exports = {};
  const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInContext(`(function(exports,require){${out}\n})`, ctx)(exports, (n) => { if(n==='./name-reading')return load('name-reading.ts',{}); if (n in deps) return deps[n]; if (n.endsWith('.css')) return {}; throw new Error(`${rel}: unexpected import ${n}`); });
  return exports;
}
let locale = 'ko';
const T = { 'c.soon': '{t} 후 오픈', 'c.closes': '접수 중 · 마감까지 {t}', 'c.closesAt': '{t} 마감', 'c.openedAgo': '오픈됨', 'st.onsale': '예매 중', 'st.closed': '판매 종료', 'c.today': '오늘', 'c.tomorrow': '내일', 'c.tba': '미정', 'c.open': '오픈', 'c.dday.today': 'c.dday.today' };
const i18n = { t: (k, v) => (T[k] ?? k).replace('{t}', v?.t ?? ''), getLocale: () => locale };

function build(uiSource) {
  const ui = load('ui.ts', { './i18n': i18n }, uiSource);
  const cards = load('cards.ts', {
    './ui': ui, './i18n': i18n, './fanclub': { withUtm: (x) => x },
    './state': { state: { edition: 'kr' }, isFollowing: () => false, toggleFollow() {} },
    './player': { keyOf: () => '' }, './social': { likeBtn: () => '', talkBtn: () => '', trackTarget: () => '' },
  });
  return { ui, cards };
}
const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const KST = (s) => Date.parse(s.replace(' ', 'T') + '+09:00');
const concert = (p) => ({ id: 'c1', provider: 'interpark', providerLabel: 'Interpark', title: 'Tour', venue: 'Hall', city: 'Seoul', country: 'KR', startDate: '2026-12-01', endDate: null, url: 'https://example.com', ...p });

let passed = 0; const failures = [];
function check(name, fn, mod) {
  try { fn(mod); passed++; if (!mod.quiet) console.log(`PASS ${name}`); } catch (e) { failures.push(name); if (!mod.quiet) console.error(`FAIL ${name}: ${e.stack}`); }
}
function run(mod) {
  const { ui, cards } = mod;
  check('unsynced: no source → null, no local fallback, no open/close claim', ({ ui, cards }) => {
    ui.setTicketTimeSource(null);
    assert.equal(ui.ticketNow(), null);
    assert.equal(ui.until('2026-11-03T20:00:00+09:00'), '서버 시간 동기화 중');
    assert.equal(ui.untilText('c.soon', '2026-11-03T20:00:00+09:00'), '서버 시간 동기화 중');
    const c = concert({ ticketOpenAt: '2026-11-03T20:00:00+09:00', closesAt: '2026-11-05T23:59:00+09:00' });
    const row = strip(cards.ticketRow(c));
    assert.match(row, /서버 시간 동기화 중/);
    assert.doesNotMatch(row, /예매 중|후 오픈|판매 종료|마감까지/);
    const card = strip(cards.openCard(c));
    assert.doesNotMatch(card, /예매 중|오늘|내일/);
    assert.doesNotMatch(cards.openCard(c), /is-live/);
    const board = cards.boardRow(c, 0);
    assert.doesNotMatch(board, /is-live|TODAY|D-\d/);
    assert.match(strip(board), /동기화 중/);
  }, mod);
  check('server time boundary exact: 1s before → upcoming, at open → on sale (local clock 7h off is ignored)', ({ ui, cards }) => {
    const open = '2026-11-03T20:00:00+09:00';
    let now = KST('2026-11-03 19:59:59');
    ui.setTicketTimeSource(() => now);
    const c = concert({ ticketOpenAt: open, closesAt: '2026-11-05T23:59:00+09:00' });
    assert.match(strip(cards.ticketRow(c)), /1초 후 오픈/);
    assert.equal(ui.until(open, KST('2026-11-03 19:58:01')), '2분'); // 1분 59초 남음 → 올림
    assert.equal(cards.ticketTiming(c).opensAt, open);
    now = KST('2026-11-03 20:00:00');
    const row = strip(cards.ticketRow(c));
    assert.match(row, /접수 중 · 마감까지 2일/);
    assert.equal(cards.ticketTiming(c).opensAt, null);
    assert.equal(cards.ticketTiming(c).closing, c.closesAt);
  }, mod);
  check('closed window is shown as 판매 종료, not 예매 중', ({ ui, cards }) => {
    ui.setTicketTimeSource(() => KST('2026-11-06 00:00:00'));
    const c = concert({ ticketOpenAt: '2026-11-03T20:00:00+09:00', closesAt: '2026-11-05T23:59:00+09:00' });
    assert.match(strip(cards.ticketRow(c)), /판매 종료/);
    assert.doesNotMatch(strip(cards.ticketRow(c)), /예매 중/);
    assert.match(strip(cards.openCard(c)), /판매 종료/);
    assert.doesNotMatch(cards.boardRow(c, 0), /is-live/);
  }, mod);
  check('KST today/tomorrow from server date across midnight', ({ ui, cards }) => {
    ui.setTicketTimeSource(() => KST('2026-11-02 23:59:59'));
    assert.equal(cards.openLabel('2026-11-03T20:00:00+09:00'), '내일 20:00');
    ui.setTicketTimeSource(() => KST('2026-11-03 00:00:00'));
    assert.equal(cards.openLabel('2026-11-03T20:00:00+09:00'), '오늘 20:00');
    ui.setTicketTimeSource(null);
    assert.doesNotMatch(cards.openLabel('2026-11-03T20:00:00+09:00'), /오늘|내일/);
  }, mod);
  check('zone-less timestamps are not trusted (no invented timezone)', ({ ui, cards }) => {
    ui.setTicketTimeSource(() => KST('2026-11-03 19:00:00'));
    assert.equal(ui.ticketInstant('2026-11-03T20:00:00'), null);
    assert.equal(ui.ticketInstant('2026-11-03'), null);
    assert.equal(ui.ticketInstant('2026-11-03T20:00:00+0900'), KST('2026-11-03 20:00:00'));
    assert.equal(ui.until('2026-11-03T20:00:00'), '');
    assert.equal(cards.ticketTiming(concert({ ticketOpenAt: '2026-11-03T20:00:00' })).opensAt, null);
  }, mod);
  check('untilText after boundary returns key-specific passed text, never wraps (no "오픈됨 후 오픈")', ({ ui }) => {
    const open = '2026-11-03T20:00:00+09:00', close = '2026-11-05T23:59:00+09:00';
    const after = KST('2026-11-06 00:00:00');
    assert.equal(ui.untilText('c.soon', open, after), '오픈됨');
    assert.equal(ui.untilText('c.closes', close, after), '판매 종료');
    assert.equal(ui.untilText('c.soon', open, KST('2026-11-03 20:00:00')), '오픈됨', 'exactly at boundary');
    for (const k of ['c.soon', 'c.closes', 'c.closesAt']) {
      const txt = ui.untilText(k, open, after);
      assert.doesNotMatch(txt, /후 오픈|마감까지|오픈됨 마감/, `${k}: ${txt}`);
    }
    assert.equal(ui.untilText('c.unknownKey', open, after), '');
    assert.equal(ui.untilText('c.soon', open, KST('2026-11-03 19:00:00')), '1시간 후 오픈');
  }, mod);
  check('opened with no confirmable close: no 예매 중 guess; raw status shown as collected-time note', ({ ui, cards }) => {
    ui.setTicketTimeSource(() => KST('2026-11-04 12:00:00'));
    const onsale = concert({ ticketOpenAt: '2026-11-03T20:00:00+09:00', status: 'onsale' });
    const other = concert({ ticketOpenAt: '2026-11-03T20:00:00+09:00', status: 'upcoming' });
    assert.equal(cards.ticketTiming(onsale).phase, 'unverified');
    for (const [c, note] of [[onsale, '원문 수집 시 접수 중'], [other, '접수 상태 원문 확인']]) {
      for (const html of [cards.ticketRow(c), cards.openCard(c), cards.boardRow(c, 0)]) {
        assert.match(strip(html), new RegExp(note));
        assert.doesNotMatch(strip(html), /예매 중|판매 종료/);
        assert.doesNotMatch(html, /is-live/);
      }
    }
    const none = concert({ status: 'onsale' });
    assert.doesNotMatch(strip(cards.ticketRow(none)) + strip(cards.openCard(none)) + strip(cards.boardRow(none, 0)), /예매 중/);
  }, mod);
  check('multi-window: zone-less end or open window without end → not closed; future window end → closing', ({ ui, cards }) => {
    ui.setTicketTimeSource(() => KST('2026-11-10 12:00:00'));
    const amb = concert({ ticketOpenAt: '2026-11-03T20:00:00+09:00', closesAt: '2026-11-05T23:59:00+09:00', status: 'onsale',
      openSchedule: [{ at: '2026-11-03T20:00:00+09:00', label: 'A', endAt: '2026-11-12T23:59:00' }] });
    const tm = cards.ticketTiming(amb);
    assert.equal(tm.ambiguous, true);
    assert.equal(tm.phase, 'unverified');
    assert.doesNotMatch(strip(cards.ticketRow(amb)), /판매 종료|예매 중/);
    const noEnd = concert({ ticketOpenAt: '2026-11-03T20:00:00+09:00', closesAt: '2026-11-05T23:59:00+09:00', openSchedule: [{ at: '2026-11-08T20:00:00+09:00', label: 'B' }] });
    assert.equal(cards.ticketTiming(noEnd).phase, 'unverified', 'window B opened with unknown end');
    const multi = concert({ ticketOpenAt: '2026-11-03T20:00:00+09:00', closesAt: '2026-11-05T23:59:00+09:00',
      openSchedule: [{ at: '2026-11-08T20:00:00+09:00', label: 'B', endAt: '2026-11-11T23:59:00+09:00' }] });
    assert.equal(cards.ticketTiming(multi).phase, 'closing');
    assert.match(strip(cards.ticketRow(multi)), /마감까지 35시간/);
    for (const html of [cards.ticketRow(multi), cards.openCard(multi), cards.boardRow(multi, 0)]) {
      assert.match(html, /data-ticket-close="2026-11-11T23:59:00\+09:00"/);
      assert.doesNotMatch(html, /data-ticket-open=/);
    }
    ui.setTicketTimeSource(() => KST('2026-11-07 12:00:00'));
    for (const html of [cards.ticketRow(multi), cards.openCard(multi), cards.boardRow(multi, 0)]) assert.match(html, /data-ticket-open="2026-11-08T20:00:00\+09:00"/);
    ui.setTicketTimeSource(null);
    assert.match(cards.ticketRow(multi), /data-ticket-open="2026-11-03T20:00:00\+09:00"/, 'unsynced: earliest notice time for first-sync judgment');
    ui.setTicketTimeSource(() => KST('2026-11-10 12:00:00'));
    const wins = concert({ ticketOpenAt: '2026-11-03T20:00:00+09:00', closesAt: '2026-11-05T23:59:00+09:00', windows: [{ opensAt: '2026-11-09T20:00:00', closesAt: null }] });
    assert.equal(cards.ticketTiming(wins).phase, 'unverified');
  }, mod);
  check('ddayOf uses server date; hidden when unsynced', ({ ui }) => {
    ui.setTicketTimeSource(null);
    assert.equal(ui.ddayOf('2026-11-05'), '');
    ui.setTicketTimeSource(() => KST('2026-11-02 23:59:59'));
    assert.equal(ui.ddayOf('2026-11-05'), 'D-3');
    ui.setTicketTimeSource(() => KST('2026-11-03 00:00:00'));
    assert.equal(ui.ddayOf('2026-11-05'), 'D-2');
    assert.equal(ui.ddayOf('2026-11-03'), 'c.dday.today');
  }, mod);
  check('throwing/NaN source treated as unsynced', ({ ui }) => {
    ui.setTicketTimeSource(() => NaN); assert.equal(ui.ticketNow(), null);
    ui.setTicketTimeSource(() => { throw new Error('x'); }); assert.equal(ui.ticketNow(), null);
    ui.setTicketTimeSource(null);
  }, mod);
}
run({ ...build() });
const main = passed;
// 음성 대조군: until이 로컬 시계를 쓰도록 되돌리면 경계 검사가 실패해야 한다
const uiSrc = read('ui.ts');
const from = 'export function until(iso?: string | null, now: number | null = ticketNow()) {';
assert.ok(uiSrc.includes(from));
const before = failures.length; passed = 0;
run({ ...build(uiSrc.replace(from, 'export function until(iso?: string | null, _n: number | null = ticketNow()) { const now = Date.now();')), quiet: true });
const caught = failures.length > before;
failures.splice(before);
if (caught) console.log('PASS negative control: local Date.now until() is caught');
else failures.push('negative control not caught');
{
  const before2 = failures.length;
  const fromU = "  if (at - now <= 0) return PASSED_KEY[key] ? t(PASSED_KEY[key]) : '';\n";
  assert.ok(uiSrc.includes(fromU));
  run({ ...build(uiSrc.replace(fromU, '')), quiet: true });
  const caught2 = failures.slice(before2).some((n) => n.startsWith('untilText after boundary'));
  failures.splice(before2);
  if (caught2) console.log('PASS negative control: wrapping untilText ("오픈됨 후 오픈") is caught');
  else failures.push('negative control untilText not caught');
}
{
  const before3 = failures.length;
  const cardsSrc = read('cards.ts');
  const fromC = ": c.openTba && !tm.firstAt ? t('c.tba') : ticketStatusNote(c);";
  assert.ok(cardsSrc.includes(fromC));
  const ui = load('ui.ts', { './i18n': i18n });
  const bad = load('cards.ts', { './ui': ui, './i18n': i18n, './fanclub': { withUtm: (x) => x }, './state': { state: { edition: 'kr' }, isFollowing: () => false, toggleFollow() {} }, './player': { keyOf: () => '' }, './social': { likeBtn: () => '', talkBtn: () => '', trackTarget: () => '' } }, cardsSrc.replace(fromC, ": c.openTba ? t('c.tba') : t('st.onsale');"));
  run({ ui, cards: bad, quiet: true });
  const caught3 = failures.slice(before3).some((n) => n.startsWith('opened with no confirmable close'));
  failures.splice(before3);
  if (caught3) console.log('PASS negative control: openCard 예매 중 guess is caught');
  else failures.push('negative control openCard not caught');
}
console.log(`\n${main} ticket UI checks passed${failures.length ? `, ${failures.length} failed` : ''}`);
if (failures.length) process.exit(1);
