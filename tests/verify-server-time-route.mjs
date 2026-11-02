#!/usr/bin/env node
/** Run: node tests/verify-server-time-route.mjs [--live-boot]
 * 1) 실제 backend/lib/server-time.mjs 핸들러를 express에 붙여 고정 시계로 응답 계약을 검사한다.
 * 2) --live-boot: 실제 backend/server.mjs를 격리된 임시 DB·백그라운드 작업 비활성(LILAC_DISABLE_BACKGROUND=1)으로
 *    별도 포트에 띄워 GET/HEAD /api/time을 확인하고 종료한다(운영 서버·실제 DB를 건드리지 않음). */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serverTimeHandler, serverTimePayload, kstIso } from '../backend/lib/server-time.mjs';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express');
let passed = 0;
const ok = (name) => { passed++; console.log(`PASS ${name}`); };

function checkContract(res, body, { exact } = {}) {
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') || '', /no-store/);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  assert.equal(body.ok, true);
  assert.equal(body.timeZone, 'Asia/Seoul');
  assert.equal(body.utcOffsetMinutes, 540);
  assert.ok(Number.isInteger(body.epochMs));
  assert.equal(body.iso, new Date(body.epochMs).toISOString());
  assert.equal(body.kst, kstIso(body.epochMs));
  assert.match(body.kst, /\+09:00$/);
  if (exact != null) assert.equal(body.epochMs, exact);
  assert.ok(JSON.stringify(body).length < 300, 'bounded payload');
}

// 1) 고정 시계 계약
{
  const fixed = Date.parse('2026-11-02T14:59:59.987Z');
  assert.equal(serverTimePayload(fixed).kst, '2026-11-02T23:59:59.987+09:00');
  assert.throws(() => serverTimePayload(NaN));
  const app = express();
  app.get('/api/time', serverTimeHandler({ now: () => fixed }));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const res = await fetch(`${base}/api/time?ignored=${'x'.repeat(2000)}`);
  checkContract(res, await res.json(), { exact: fixed });
  const head = await fetch(`${base}/api/time`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.match(head.headers.get('cache-control') || '', /no-store/);
  srv.close();
  ok('handler contract: Asia/Seoul +540, epoch/iso/kst consistent, no-store, query ignored, HEAD ok');
}

// 2) 실제 server.mjs 경로(격리 부팅)
if (process.argv.includes('--live-boot')) {
  const root = new URL('..', import.meta.url).pathname;
  const db = mkdtempSync(path.join(tmpdir(), 'lilac-time-db-'));
  const port = 5290 + Math.floor(Math.random() * 9);
  const child = spawn(process.execPath, ['backend/server.mjs'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'development', PORT: String(port), LILAC_DB_DIR: db, LILAC_DISABLE_BACKGROUND: '1' },
  });
  let log = '';
  child.stdout.on('data', (b) => { log += b; });
  child.stderr.on('data', (b) => { log += b; });
  try {
    const base = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 80 && !up; i++) {
      try { up = (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { await new Promise((r) => setTimeout(r, 250)); }
    }
    assert.ok(up, `isolated server did not boot:\n${log.slice(-2000)}`);
    const t0 = Date.now();
    const res = await fetch(`${base}/api/time`, { headers: { accept: 'application/json' } }); // 쿠키·인증 없음
    const t1 = Date.now();
    const body = await res.json();
    checkContract(res, body);
    assert.ok(body.epochMs >= t0 - 5 && body.epochMs <= t1 + 5, 'stamped within request window (same host clock)');
    const cross = await fetch(`${base}/api/time`, { headers: { origin: 'https://evil.example' } });
    assert.equal(cross.status, 403, 'existing origin guard still applies');
    ok(`live server.mjs (isolated port ${port}, temp DB, background off): authless GET /api/time contract`);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => { child.once('exit', r); setTimeout(r, 3000); });
    rmSync(db, { recursive: true, force: true });
  }
}
console.log(`\n${passed} route checks passed`);
