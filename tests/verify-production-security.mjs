/** Runtime regressions against an isolated temporary DB. Never contacts the running user server. */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
const root = await mkdtemp(path.join(tmpdir(), 'lilac-security-'));
const sock = net.createServer(); sock.listen(0, '127.0.0.1'); await once(sock, 'listening');
const port = sock.address().port; await new Promise((r) => sock.close(r));
let child = spawn(process.execPath, ['backend/server.mjs'], { env: { ...process.env, PORT: String(port), NODE_ENV: 'production', LILAC_DB_DIR: root, LILAC_DISABLE_BACKGROUND: '1', LILAC_ADMIN_TOKEN: 'fixture-admin-token-not-a-real-secret-123456', LILAC_ALLOWED_ORIGINS: 'https://app.example.test' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stdout.on('data', (x) => log += x); child.stderr.on('data', (x) => log += x);
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('PASS', name); };
async function request(route, { method = 'GET', body, token, headers = {}, raw } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { ...(body !== undefined || raw ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, headers: res.headers, data };
}
try {
  for (let n = 0; n < 100; n++) { try { if ((await request('/api/health')).status === 200) break; } catch {} if (child.exitCode != null) throw Error(log); await new Promise((r) => setTimeout(r, 100)); }
  check('isolated startup healthy', () => assert.match(log, /backend v/));
  const badOrigin = await request('/api/auth/signup', { method: 'POST', body: {}, headers: { Origin: 'https://evil.example' } });
  check('cross-origin browser writes denied', () => assert.equal(badOrigin.status, 403));
  const allowed = await request('/api/health', { headers: { Origin: 'https://app.example.test' } });
  check('explicit CORS allowlist', () => assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.example.test'));
  for (const url of ['/api/admin/shutdown', '/api/live/admin/refresh-fc', '/api/index/rebuild', '/api/store/sync', '/api/INDEX/REBUILD/', '/api/LIVE/ADMIN/refresh-fc']) {
    const r = await request(url, { method: 'POST', body: {} }); check('production admin denied: ' + url, () => assert.equal(r.status, 403));
  }
  const adminAllowed = await request('/api/admin/nonexistent-security-probe', { headers: { 'X-Lilac-Admin-Token': 'fixture-admin-token-not-a-real-secret-123456' } });
  check('valid admin token reaches route layer', () => assert.equal(adminAllowed.status, 404));
  const cookie = await request('/api/me', { headers: { Cookie: 'lilac_token=%zz' } });
  check('malformed cookie does not crash/leak', () => { assert.equal(cookie.status, 200); assert.equal(cookie.data.user, null); });
  const invalid = await request('/api/auth/signup', { method: 'POST', body: { email: 'x@x.test', password: 'passwordxx', name: { html: 'x' } } });
  check('signup rejects non-string names', () => assert.equal(invalid.status, 400));
  const signup = (email) => request('/api/auth/signup', { method: 'POST', body: { email, name: 'Security fixture', password: 'isolated-password-1234' } });
  const accounts = await Promise.all([signup('A@example.test'), signup('B@example.test')]);
  check('concurrent signup retains both accounts', () => accounts.forEach((r) => assert.equal(r.status, 200)));
  const [a, b] = accounts.map((r) => r.data.token);
  const me = await Promise.all([request('/api/me', { token: a }), request('/api/me', { token: b })]);
  check('concurrent session issuance retains both tokens', () => { assert.equal(me[0].data.user.email, 'a@example.test'); assert.equal(me[1].data.user.email, 'b@example.test'); });
  check('private response disables caches and hides password', () => { assert.equal(me[0].headers.get('cache-control'), 'no-store'); assert.equal(me[0].data.user.pw, undefined); });
  const duplicate = await Promise.all([signup('same@example.test'), signup('same@example.test')]);
  check('concurrent duplicate signup prevented', () => assert.deepEqual(duplicate.map((r) => r.status).sort(), [200, 409]));
  const pl = await request('/api/playlists', { method: 'POST', token: a, body: { name: 'A-private' } });
  const own = await request('/api/playlists', { token: a }); const other = await request('/api/playlists', { token: b });
  check('playlist account isolation', () => { assert.equal(own.data.length, 1); assert.equal(other.data.length, 0); });
  await Promise.all([1, 2, 3].map((i) => request('/api/playlists', { method: 'POST', token: a, body: { name: 'concurrent-' + i } })));
  const allPlaylists = await request('/api/playlists', { token: a });
  check('concurrent library mutations do not lose updates', () => assert.equal(allPlaylists.data.length, 4));
  const steal = await request('/api/playlists/' + pl.data.id, { method: 'DELETE', token: b });
  check('other user cannot delete playlist', () => assert.equal(steal.status, 404));
  const ownerBefore = await request('/api/playlists', { token: a });
  for (const [method, suffix, body] of [
    ['PATCH', '', { name: 'stolen', userId: me[0].data.user.id }],
    ['POST', '/tracks', { track: { title: 'intruder' } }],
    ['PUT', '/tracks', { tracks: [{ title: 'intruder' }] }],
    ['DELETE', '/tracks/0', undefined],
  ]) {
    const r = await request('/api/playlists/' + pl.data.id + suffix, { method, body, token: b });
    check('cross-account playlist ID rejected: ' + method + suffix, () => assert.equal(r.status, 404));
  }
  const ownerAfter = await request('/api/playlists', { token: a });
  check('rejected cross-account writes leave owner data unchanged', () => assert.deepEqual(ownerAfter.data, ownerBefore.data));
  for (const [route, body] of [
    ['/api/likes', { track: { title: 'A-only-liked-track', artist: 'fixture' } }],
    ['/api/history', { track: { title: 'A-only-history', artist: 'fixture' } }],
    ['/api/oshi', { artistId: 'A-only-follow', name: 'fixture' }],
  ]) {
    await request(route, { method: 'POST', token: a, body });
    const ownList = await request(route, { token: a });
    const foreignList = await request(route + '?userId=' + me[0].data.user.id, { token: b, headers: { 'X-User-Id': me[0].data.user.id } });
    check('private collection ignores supplied foreign user ID: ' + route, () => { assert.equal(ownList.data.length, 1); assert.deepEqual(foreignList.data, []); });
  }
  // Seed only the throwaway DB: production billing endpoints intentionally cannot create orders.
  const fixtureUserDir = path.join(root, 'user', me[0].data.user.id);
  await mkdir(fixtureUserDir, { recursive: true });
  for (const collection of ['orders', 'watches']) {
    await writeFile(path.join(fixtureUserDir, collection + '.json'), JSON.stringify([{ id: 'A-private-' + collection }]));
    const mine = await request('/api/' + collection, { token: a });
    const theirs = await request('/api/' + collection + '?userId=' + me[0].data.user.id, { token: b });
    check('private fixture collection isolated: ' + collection, () => { assert.equal(mine.data[0].id, 'A-private-' + collection); assert.deepEqual(theirs.data, []); });
  }
  const unauth = await request('/api/likes'); check('personal API requires login', () => assert.equal(unauth.status, 401));
  const topup = await request('/api/me', { method: 'PATCH', token: a, body: { action: 'topup', amount: 999999 } });
  check('free-money demo action disabled in production', () => assert.equal(topup.status, 503));
  const order = await request('/api/ORDERS/', { method: 'POST', token: a, body: {} });
  check('unbacked demo checkout disabled', () => assert.equal(order.status, 503));
  const ai = await request('/api/ai/focus-session', { method: 'POST', body: {} });
  check('paid AI path requires authentication', () => assert.equal(ai.status, 401));
  const badJson = await request('/api/auth/login', { method: 'POST', raw: '{' });
  check('malformed JSON has controlled response', () => { assert.equal(badJson.status, 400); assert.equal(badJson.data.code, 'INVALID_JSON'); });
  const large = await request('/api/contact', { method: 'POST', body: { message: 'x'.repeat(110000) } });
  check('oversized request returns 413 not server error', () => assert.equal(large.status, 413));
  const traversal = await request('/api/community/b/x%2F..%2F..%2Fusers/1/comments');
  check('encoded board traversal blocked', () => assert.equal(traversal.status, 400));
  const no = await request('/api/community/b/free/NaN/comments');
  check('invalid post number blocked', () => assert.equal(no.status, 400));
  const target = await request('/api/social/target', { method: 'POST', body: { kind: 'track', ref: 'fixture', snap: { title: 'fixture' } } });
  check('unauthenticated social storage mutation blocked', () => assert.equal(target.status, 401));
  const posts = await Promise.all([1, 2].map((i) => request('/api/community/b/free', { method: 'POST', token: a, body: { title: 'fixture ' + i, body: 'temp data only' } })));
  check('parallel posts cannot bypass cooldown', () => assert.deepEqual(posts.map((r) => r.status).sort(), [200, 429]));
  const post = posts.find((r) => r.status === 200).data.no;
  const deleted = await request('/api/community/b/free/' + post, { method: 'DELETE', token: b });
  check('community ownership enforced', () => assert.equal(deleted.status, 403));
  const sessions = JSON.parse(await readFile(path.join(root, 'sessions.json'), 'utf8')); sessions[a].at = 'invalid'; await writeFile(path.join(root, 'sessions.json'), JSON.stringify(sessions));
  const expired = await request('/api/me', { token: a });
  check('invalid session date fails closed', () => assert.equal(expired.data.user, null));
  await request('/api/auth/logout', { method: 'POST', token: b });
  const logout = await request('/api/me', { token: b });
  check('logout revokes token', () => assert.equal(logout.data.user, null));
  const limit = await Promise.all(Array.from({ length: 22 }, (_, i) => request('/api/auth/login', { method: 'POST', body: { email: 'nobody'+i+'@example.test', password: 'bad' }, headers: { 'X-Forwarded-For': '1.2.3.'+i } })));
  check('spoofed forwarded IP does not evade request limit', () => assert.ok(limit.some((r) => r.status === 429)));
  // Keep SSE connected while stopping each isolated process. Closing the client first
  // would hide the shutdown bug this regression is intended to catch.
  for (const reason of ['SIGTERM', 'SIGINT', 'admin']) {
    const stream = await fetch('http://127.0.0.1:' + port + '/api/live/stream');
    const reader = stream.body.getReader();
    await reader.read();
    const closed = reader.read().then((value) => value.done, () => true);
    const exited = once(child, 'exit');
    const started = Date.now();
    if (reason === 'admin') {
      const stop = await request('/api/admin/shutdown', { method: 'POST', headers: { 'X-Lilac-Admin-Token': 'fixture-admin-token-not-a-real-secret-123456' } });
      check('authorized admin shutdown responds before draining', () => assert.equal(stop.status, 200));
    } else child.kill(reason);
    let watchdog;
    const result = await Promise.race([exited, new Promise((_, reject) => { watchdog = setTimeout(() => reject(Error('shutdown hung: ' + reason)), 5000); })]).finally(() => clearTimeout(watchdog));
    check(reason + ' exits cleanly with SSE attached', () => { assert.equal(result[0], 0); assert.equal(result[1], null); assert.ok(Date.now() - started < 5000); });
    check(reason + ' disposes live service and closes stream', () => { assert.match(log, /live service disposed/); assert.match(log, /shutdown complete/); });
    assert.equal(await closed, true);
    if (reason !== 'admin') {
      log = '';
      child = spawn(process.execPath, ['backend/server.mjs'], { env: { ...process.env, PORT: String(port), NODE_ENV: 'production', LILAC_DB_DIR: root, LILAC_DISABLE_BACKGROUND: '1', LILAC_ADMIN_TOKEN: 'fixture-admin-token-not-a-real-secret-123456' }, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', (x) => log += x); child.stderr.on('data', (x) => log += x);
      for (let n = 0; n < 100; n++) { try { if ((await request('/api/health')).status === 200) break; } catch {} if (child.exitCode != null) throw Error(log); await new Promise((r) => setTimeout(r, 50)); }
    }
  }
  console.log(`\n${passed} passed, 0 failed (isolated temporary DB)`);
} finally {
  if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill('SIGKILL'); await stopped; }
  await rm(root, { recursive: true, force: true });
}
