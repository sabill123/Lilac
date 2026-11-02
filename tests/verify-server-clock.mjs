#!/usr/bin/env node
/** Run: node tests/verify-server-clock.mjs
 * 실제 frontend/src/app/server-clock.ts 소스를 TypeScript로 변환해 가짜 시계·타이머·fetch·DOM으로 실행한다.
 * 네트워크·브라우저 없음. 마지막에 소스를 일부러 망가뜨린 변형(음성 대조군)이 같은 검사에서 실패하는지 확인한다. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const file = new URL('../frontend/src/app/server-clock.ts', import.meta.url);
const SOURCE = readFileSync(file, 'utf8');

function load(source) {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 }, reportDiagnostics: true });
  assert.equal(compiled.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports, AbortController, AbortSignal, console,
    require(name) { assert.fail(`server-clock must not import anything: ${name}`); },
  }, { filename: file.pathname });
  return exports;
}

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

/** 가짜 환경: perf(단조), wall(로컬 벽시계, 일부러 틀리게 설정 가능), 타이머 큐, 서버 */
function env({ serverBase = Date.parse('2026-11-02T14:59:50.000Z'), wallSkew = -7 * 3600_000 } = {}) {
  const e = { perf: 1000, wallSkew, sleeping: false, timers: [], nextId: 1, requests: [], listeners: { doc: new Map(), win: new Map() } };
  e.serverNow = () => serverBase + e.perf; // 진짜 서버 시각
  e.wall = () => serverBase + e.perf + e.wallSkew; // 로컬 PC 시계(7시간 틀림)
  e.route = { up: 50, down: 50, status: 200, body: null, hang: false, fail: false };
  e.setTimeout = (fn, ms) => { const id = e.nextId++; e.timers.push({ id, at: e.perf + Math.max(0, ms), fn }); return id; };
  e.clearTimeout = (id) => { e.timers = e.timers.filter((t) => t.id !== id); };
  const target = (map) => ({
    addEventListener(type, fn) { if (!map.has(type)) map.set(type, new Set()); map.get(type).add(fn); },
    removeEventListener(type, fn) { map.get(type)?.delete(fn); },
  });
  e.doc = { visibilityState: 'visible', ...target(e.listeners.doc) };
  e.win = target(e.listeners.win);
  e.dispatch = (which, type) => { for (const fn of [...(e.listeners[which].get(type) || [])]) fn(); };
  e.count = (which, type) => e.listeners[which].get(type)?.size || 0;
  e.fetch = (url, init) => new Promise((resolve, reject) => {
    const r = { ...e.route };
    e.requests.push({ url, init, at: e.perf });
    init.signal.addEventListener('abort', () => reject(new Error('AbortError')));
    if (r.fail) { e.setTimeout(() => reject(new TypeError('Failed to fetch')), 5); return; }
    if (r.hang) return;
    let stamped = null;
    e.setTimeout(() => { stamped = e.serverNow(); }, r.up);
    e.setTimeout(() => {
      if (init.signal.aborted) return;
      const body = r.body ?? { ok: true, epochMs: stamped, timeZone: 'Asia/Seoul', utcOffsetMinutes: 540 };
      resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => (typeof body === 'function' ? body(stamped) : body) });
    }, r.up + r.down);
  });
  e.advance = async (ms) => {
    const end = e.perf + ms;
    for (;;) {
      await flush();
      e.timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const t = e.timers[0];
      if (!t || t.at > end) break;
      e.timers.shift();
      e.perf = Math.max(e.perf, t.at);
      t.fn();
    }
    e.perf = end;
    await flush();
  };
  e.deps = () => ({ fetch: e.fetch, perfNow: () => e.perf, wallNow: () => e.wall(), setTimeout: e.setTimeout, clearTimeout: e.clearTimeout, doc: e.doc, win: e.win });
  return e;
}

function fakeDom(e) {
  const mk = (tag) => {
    const el = { tagName: tag, className: '', textContent: '', title: '', hidden: false, dateTime: '', dataset: {}, children: [], parent: null, attrs: {},
      append(...xs) { for (const x of xs) { x.parent = el; el.children.push(x); } },
      remove() { if (el.parent) el.parent.children = el.parent.children.filter((c) => c !== el); el.parent = null; },
      removeAttribute(n) { if (n === 'datetime') el.dateTime = ''; } };
    return el;
  };
  const doc = { createElement: mk, defaultView: { setTimeout: e.setTimeout, clearTimeout: e.clearTimeout }, get visibilityState() { return e.doc.visibilityState; },
    addEventListener: e.doc.addEventListener, removeEventListener: e.doc.removeEventListener };
  const host = mk('div'); host.ownerDocument = doc;
  return host;
}

function suite(mod, { quiet = false } = {}) {
  const results = [];
  const check = async (name, run) => {
    try { await run(); results.push([name, true]); if (!quiet) console.log(`PASS ${name}`); }
    catch (err) { results.push([name, false]); if (!quiet) console.error(`FAIL ${name}: ${err.stack}`); }
  };
  const { createServerClock, ticketSaleState, ticketBoundaries, parseAbsoluteInstant, mountServerClock, formatKstTime, kstDateKey, parseServerTimePayload } = mod;
  return { results, run: async () => {
    await check('midpoint offset: asymmetric RTT stays within RTT/2, local Date skew ignored', async () => {
      const e = env();
      e.route = { ...e.route, up: 30, down: 170 };
      const c = createServerClock({ deps: e.deps(), samples: 1 });
      c.start();
      assert.equal(c.now(), null, 'no time before first sync');
      await e.advance(250);
      const s = c.state();
      assert.equal(s.status, 'synced');
      assert.equal(s.rttMs, 200);
      assert.equal(s.uncertaintyMs, 100);
      const err = c.now() - e.serverNow();
      assert.ok(Math.abs(err) <= 100, `error ${err} within RTT/2`);
      assert.equal(err, -70, 'midpoint estimate: stamp at +30 of 200ms RTT → -70ms');
      assert.ok(Math.abs(c.now() - e.wall()) > 6 * 3600_000, 'did not follow the 7h-skewed local clock');
      c.destroy();
    });
    await check('symmetric delayed response is exact; best (min-RTT) sample chosen', async () => {
      const e = env();
      let n = 0;
      const base = e.fetch;
      e.fetch = (u, i) => { n++; e.route = n === 2 ? { ...e.route, up: 20, down: 20 } : { ...e.route, up: 400, down: 900 }; return base(u, i); };
      const c = createServerClock({ deps: { ...e.deps(), fetch: e.fetch }, samples: 3 });
      c.start();
      await e.advance(4000);
      assert.equal(c.state().rttMs, 40);
      assert.equal(c.now() - e.serverNow(), 0);
      assert.equal(e.requests.length, 3);
      assert.equal(e.requests[0].init.cache, 'no-store');
      assert.equal(e.requests[0].init.credentials, 'omit');
      assert.equal(e.requests[0].url, '/api/time');
      c.destroy();
    });
    await check('monotonic elapsed: later now() advances with performance clock, not local Date jumps under tolerance', async () => {
      const e = env();
      const c = createServerClock({ deps: e.deps(), samples: 1 });
      c.start();
      await e.advance(200);
      e.wallSkew += 1500; // NTP 미세 보정 수준(허용 범위 2초 이내)
      await e.advance(10_000);
      assert.equal(c.now() - e.serverNow(), 0);
      assert.equal(c.state().status, 'synced');
      c.destroy();
    });
    await check('timeout → honest error, no fabricated time; UI hides time and shows failure', async () => {
      const e = env();
      e.route = { ...e.route, hang: true };
      const c = createServerClock({ deps: e.deps(), samples: 2, timeoutMs: 1000 });
      const host = fakeDom(e);
      const ui = mountServerClock(host, c);
      c.start();
      const root = host.children[0];
      assert.equal(root.dataset.state, 'syncing');
      await e.advance(2100);
      assert.equal(c.now(), null);
      assert.equal(c.state().status, 'error');
      assert.equal(c.state().lastError, 'timeout');
      assert.equal(root.dataset.state, 'error');
      assert.equal(root.children[1].hidden, true);
      assert.equal(root.children[1].textContent, '');
      assert.match(root.children[2].textContent, /실패/);
      assert.match(root.title, /예매처 서버 시각과 다를 수 있습니다/);
      ui.destroy();
      assert.equal(host.children.length, 0);
      c.destroy();
    });
    await check('invalid payload (non-Seoul zone / missing offset) rejected', async () => {
      assert.equal(parseServerTimePayload({ epochMs: 1, timeZone: 'UTC', utcOffsetMinutes: 0 }), null);
      assert.equal(parseServerTimePayload({ epochMs: 1, timeZone: 'Asia/Seoul' }), null);
      assert.equal(parseServerTimePayload({ epochMs: '1', timeZone: 'Asia/Seoul', utcOffsetMinutes: 540 }), null);
      const e = env();
      e.route = { ...e.route, body: (t) => ({ epochMs: t, timeZone: 'UTC', utcOffsetMinutes: 0 }) };
      const c = createServerClock({ deps: e.deps(), samples: 1 });
      c.start();
      await e.advance(200);
      assert.equal(c.now(), null);
      assert.equal(c.state().lastError, 'bad_payload');
      c.destroy();
    });
    await check('stale: resync failures keep last anchor, labelled with last-sync age', async () => {
      const e = env();
      const c = createServerClock({ deps: e.deps(), samples: 1, resyncMs: 60_000, staleAfterMs: 180_000 });
      const host = fakeDom(e);
      mountServerClock(host, c);
      c.start();
      await e.advance(200);
      e.route = { ...e.route, fail: true };
      await e.advance(185_000);
      const s = c.state();
      assert.equal(s.status, 'stale');
      assert.equal(s.lastError, 'network');
      assert.ok(c.now() != null);
      const root = host.children[0];
      assert.equal(root.dataset.state, 'stale');
      assert.match(root.children[2].textContent, /마지막 동기화 3분 전/);
      e.route = { ...e.route, fail: false };
      await e.advance(60_500);
      assert.equal(c.state().status, 'synced');
      c.destroy();
    });
    await check('visibility: hidden stops polling, visible resyncs immediately; online resyncs', async () => {
      const e = env();
      const c = createServerClock({ deps: e.deps(), samples: 1, resyncMs: 60_000 });
      c.start();
      await e.advance(200);
      assert.equal(e.requests.length, 1);
      e.doc.visibilityState = 'hidden'; e.dispatch('doc', 'visibilitychange');
      await e.advance(10 * 60_000);
      assert.equal(e.requests.length, 1, 'no polling while hidden');
      assert.equal(e.timers.length, 0, 'no timers while hidden');
      e.doc.visibilityState = 'visible'; e.dispatch('doc', 'visibilitychange');
      await e.advance(200);
      assert.equal(e.requests.length, 2);
      e.dispatch('win', 'online');
      await e.advance(200);
      assert.equal(e.requests.length, 3);
      await e.advance(60_000);
      assert.equal(e.requests.length, 4, '60s visible resync');
      c.destroy();
    });
    await check('sleep / clock jump: performance paused while wall advanced → anchor dropped then resynced', async () => {
      const e = env();
      const c = createServerClock({ deps: e.deps(), samples: 1 });
      c.start();
      await e.advance(200);
      e.wallSkew += 3_600_000; // 1시간 절전: 벽시계만 진행
      c.watch([e.serverNow() + 3_600_000 + 5_000], () => {});
      await e.advance(31_000); // 다음 점검 타이머(최대 30초)에서 감지
      assert.equal(e.requests.length >= 2, true, 'resync requested after jump');
      assert.equal(c.state().status, 'synced');
      c.destroy();
    });
    await check('boundaries: batch once, already-past not fired (no refetch loop), no refire after backward resync', async () => {
      const e = env();
      const c = createServerClock({ deps: e.deps(), samples: 1 });
      c.start();
      await e.advance(200);
      const n = e.serverNow();
      const calls = [];
      c.watch([n - 1000, n + 3000, n + 3000, n + 3002, n + 60_000], (x) => calls.push([...x]));
      const hb = [];
      c.watch([n + 30_000, n + 40_000], (x) => hb.push([...x]));
      await e.advance(100);
      assert.equal(calls.length, 0, 'past boundary at registration is observed-late, not a crossing');
      await e.advance(3_100);
      assert.equal(JSON.stringify(calls), JSON.stringify([[n + 3000], [n + 3002]]), 'exact per-instant firing, duplicates collapsed');
      // 숨김 상태에서 여러 경계를 지나면 보이는 순간 한 번의 배치로 전달
      e.doc.visibilityState = 'hidden'; e.dispatch('doc', 'visibilitychange');
      await e.advance(60_000);
      e.doc.visibilityState = 'visible'; e.dispatch('doc', 'visibilitychange');
      await e.advance(10);
      assert.equal(calls.length, 3, 'one batch after background');
      assert.equal(JSON.stringify(hb), JSON.stringify([[n + 30_000, n + 40_000]]), 'two crossings while hidden → single batch');
      assert.equal(JSON.stringify(calls[2]), JSON.stringify([n + 60_000]));
      // 부모가 콜백에서 다시 가져온 데이터에 같은(이미 지난) 경계가 있어도 루프가 생기지 않는다
      const again = [];
      c.watch([n + 3000, n + 3002], (x) => again.push(x));
      await e.advance(1000);
      assert.equal(again.length, 0);
      // 서버 시각이 뒤로 보정되어도 이미 발화한 값은 다시 발화하지 않는다
      e.route = { ...e.route, body: (t) => ({ epochMs: t - 10_000, timeZone: 'Asia/Seoul', utcOffsetMinutes: 540 }) };
      void c.sync();
      await e.advance(200);
      await e.advance(8_000);
      assert.equal(calls.length, 3, 'no refire after backward correction');
      c.destroy();
    });
    await check('boundaries registered before first sync: past ones at first observation do not fire', async () => {
      const e = env();
      const c = createServerClock({ deps: e.deps(), samples: 1 });
      const n = e.serverNow();
      const calls = [];
      c.watch([n + 50, n + 2_000], (x) => calls.push([...x]));
      c.start();
      await e.advance(200);
      assert.equal(calls.length, 0);
      await e.advance(2_000);
      assert.equal(JSON.stringify(calls), JSON.stringify([[n + 2_000]]));
      c.destroy();
    });
    await check('KST date rollover fires once (server KST midnight, not local)', async () => {
      const e = env(); // 서버 14:59:50Z = 23:59:50 KST
      const c = createServerClock({ deps: e.deps(), samples: 1 });
      const days = [];
      c.onDayChange((d) => days.push(d));
      c.start();
      await e.advance(200);
      assert.equal(kstDateKey(c.now()), '2026-11-02');
      assert.equal(formatKstTime(c.now()), '23:59:51');
      await e.advance(11_000);
      assert.deepEqual(days, ['2026-11-03']);
      await e.advance(60_000);
      assert.deepEqual(days, ['2026-11-03']);
      c.destroy();
    });
    await check('abort signal: clock + watches + UI cleaned, in-flight request aborted, no timers left', async () => {
      const e = env();
      e.route = { ...e.route, hang: true };
      const ac = new AbortController();
      const c = createServerClock({ deps: e.deps(), samples: 1, signal: ac.signal, timeoutMs: 60_000 });
      const host = fakeDom(e);
      mountServerClock(host, c, { signal: ac.signal, compact: true });
      const calls = [];
      c.watch([e.serverNow() + 5_000], (x) => calls.push(x), { signal: ac.signal });
      c.start();
      await e.advance(10);
      ac.abort();
      await e.advance(100);
      assert.equal(host.children.length, 0);
      assert.equal(e.count('doc', 'visibilitychange'), 0);
      assert.equal(e.count('win', 'online'), 0);
      assert.equal(e.timers.length, 0);
      await e.advance(120_000);
      assert.equal(calls.length, 0);
      // 개별 watch 해제
      const e2 = env();
      const c2 = createServerClock({ deps: e2.deps(), samples: 1 });
      c2.start(); await e2.advance(200);
      const ac2 = new AbortController(); const got = [];
      c2.watch([e2.serverNow() + 1000], (x) => got.push(x), { signal: ac2.signal });
      ac2.abort();
      await e2.advance(2000);
      assert.equal(got.length, 0);
      c2.destroy();
    });
    await check('UI: synced shows KST HH:mm:ss + precision, ticks on server-second boundary', async () => {
      const e = env();
      const c = createServerClock({ deps: e.deps(), samples: 1 });
      const host = fakeDom(e);
      mountServerClock(host, c);
      const root = host.children[0];
      assert.equal(root.dataset.state, 'unsynced');
      assert.equal(root.children[1].hidden, true);
      assert.equal(root.children[2].textContent, '미동기화');
      c.start();
      await e.advance(200);
      assert.equal(root.dataset.state, 'synced');
      assert.equal(root.children[1].textContent, formatKstTime(c.now()));
      assert.match(root.children[1].dateTime, /\+09:00$/);
      assert.equal(root.children[2].textContent, '오차 ±0.1초');
      await e.advance(1000);
      assert.equal(root.children[1].textContent, formatKstTime(e.serverNow()));
      c.destroy();
    });
    await check('ticket helper: strict absolute timestamps, unknown when ambiguous/unsynced, availability unconfirmed', () => {
      const open = '2026-11-03T20:00:00+09:00';
      const close = '2026-11-05T23:59:00+09:00';
      assert.equal(parseAbsoluteInstant(open), Date.parse('2026-11-03T11:00:00Z'));
      assert.equal(parseAbsoluteInstant('2026-11-03T11:00:00.250Z'), Date.parse('2026-11-03T11:00:00.250Z'));
      assert.equal(parseAbsoluteInstant('2026-11-03T20:00+0900'), Date.parse('2026-11-03T11:00:00Z'));
      for (const bad of ['2026-11-03T20:00:00', '2026-11-03', '2026/11/03 20:00', '11월 3일 20시', '2026-02-30T10:00:00Z', '2026-11-03T24:00:00Z', '', null, undefined, NaN])
        assert.equal(parseAbsoluteInstant(bad), null, `reject ${bad}`);
      const at = (iso) => Date.parse(iso);
      const s0 = ticketSaleState({ opensAt: open, closesAt: close }, null);
      assert.equal(s0.phase, 'unknown'); assert.equal(s0.reason, 'clock_unsynced');
      const s1 = ticketSaleState({ opensAt: open, closesAt: close }, at('2026-11-03T10:59:59Z'));
      assert.equal(s1.phase, 'upcoming'); assert.equal(s1.msUntilOpen, 1000); assert.equal(s1.nextBoundaryMs, at('2026-11-03T11:00:00Z'));
      const s2 = ticketSaleState({ opensAt: open, closesAt: close }, at('2026-11-03T11:00:00Z'));
      assert.equal(s2.phase, 'open', 'opens exactly at boundary'); assert.equal(s2.availability, 'unconfirmed');
      assert.equal(ticketSaleState({ opensAt: open, closesAt: close }, at('2026-11-05T14:59:00Z')).phase, 'closed');
      assert.equal(ticketSaleState({ opensAt: '2026-11-03T20:00:00', closesAt: close }, at('2026-11-04T00:00:00Z')).reason, 'ambiguous_time');
      assert.equal(ticketSaleState({ opensAt: close, closesAt: open }, at('2026-11-04T00:00:00Z')).reason, 'invalid_window');
      assert.equal(ticketSaleState({}, at('2026-11-04T00:00:00Z')).reason, 'no_schedule');
      const onlyClose = ticketSaleState({ closesAt: close }, at('2026-11-04T00:00:00Z'));
      assert.equal(onlyClose.phase, 'unknown'); assert.equal(onlyClose.reason, 'open_time_unknown');
      assert.equal(ticketSaleState({ opensAt: open }, at('2026-11-03T10:59:59.950Z'), { uncertaintyMs: 100 }).boundaryUncertain, true);
      for (const s of [s0, s1, s2]) assert.equal(s.availability, 'unconfirmed');
      assert.equal(JSON.stringify(ticketBoundaries([{ opensAt: open, closesAt: close }, { opensAt: open }, { opensAt: '2026-11-03T20:00:00' }])), JSON.stringify([at('2026-11-03T11:00:00Z'), at('2026-11-05T14:59:00Z')]));
    });
  } };
}

const main = suite(load(SOURCE));
await main.run();
const failed = main.results.filter(([, ok]) => !ok);

// 음성 대조군: 핵심 동작을 망가뜨린 소스는 해당 검사에서 반드시 실패해야 한다
const mutations = [
  ['no midpoint (anchor at response arrival)', ['epochMs + rtt / 2', 'epochMs'], 'midpoint offset'],
  ['naive timestamp fallback (guesses local zone)', ['if (!m) return null;', 'if (!m) { const t = Date.parse(String(v)); return Number.isFinite(t) ? t : null; }'], 'ticket helper'],
  ['fires observed-late boundaries', ['if (t <= n) w.pending.delete(t); //', '//'], 'boundaries: batch once'],
  ['keeps polling while hidden', ['} else { clearCheck(); if (resyncTimer != null) { d.clearTimeout(resyncTimer); resyncTimer = null; } }', '} else { clearCheck(); }'], 'visibility'],
  ['falls back to local Date when unsynced', ['if (!anchor) return null;\n    return', 'if (!anchor) return d.wallNow();\n    return'], 'timeout'],
];
let controls = 0;
for (const [label, [from, to], target] of mutations) {
  assert.ok(SOURCE.includes(from), `mutation anchor missing: ${label}`);
  const m = suite(load(SOURCE.replace(from, to)), { quiet: true });
  await m.run();
  const hit = m.results.find(([n]) => n.startsWith(target));
  if (hit && !hit[1]) { controls++; console.log(`PASS negative control: ${label} → "${target}" fails`); }
  else { failed.push([`negative control ${label}`, false]); console.error(`FAIL negative control: ${label} was not caught`); }
}
console.log(`\n${main.results.length - main.results.filter(([, ok]) => !ok).length}/${main.results.length} checks, ${controls}/${mutations.length} negative controls`);
if (failed.length) process.exit(1);
