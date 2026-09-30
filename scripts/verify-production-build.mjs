/** Offline build/proxy verification. No real account, backend writes, or upstream network.
 * npm run build && node scripts/verify-production-build.mjs
 * --release additionally fails if the configured Vercel backend cannot serve this app.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, mkdir, rm, symlink, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDistServer } from './serve-dist.mjs';
import { preflight, startCandidate } from './start-production.mjs';
import { createPublicHandler } from '../server/public/handler.mjs';
let passed = 0;
function check(label, condition) { assert.ok(condition, label); passed++; console.log('PASS', label); }
const listen = s => new Promise(resolve => s.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${s.address().port}`)));
const close = s => new Promise(resolve => { s.closeAllConnections?.(); s.close(resolve); });
const root = await mkdtemp(path.join(os.tmpdir(), 'lilac-dist-qc-'));
let seen = 0;
const upstream = http.createServer((req, res) => {
  seen++;
  if (req.url === '/api/session') { res.writeHead(302, { 'set-cookie': ['session=fixture; HttpOnly; SameSite=Lax', 'other=fixture; SameSite=Lax'], location: '/#/my', 'cache-control': 'no-store' }); res.end(); }
  else if (req.url === '/api/stream') { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.write('data: first\n\n'); const timer = setTimeout(() => res.end('data: end\n\n'), 1500); res.on('close', () => clearTimeout(timer)); }
  else if (req.url === '/api/slow') { /* timeout fixture */ }
  else { let body = ''; req.on('data', c => body += c); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ method: req.method, cookie: req.headers.cookie, body })); }); }
});
let server;
try {
  await mkdir(path.join(root, 'assets'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Fixture</title>');
  await writeFile(path.join(root, 'assets/app-abcdefgh.js'), 'export const ready=true;');
  await symlink(path.resolve('package.json'), path.join(root, 'leak.json'));
  const up = await listen(upstream);
  server = createDistServer({ root, api: up, maxBody: 32, upstreamTimeout: 700 });
  const base = await listen(server);
  let r = await fetch(base);
  check('index serves built HTML', r.status === 200 && (await r.text()).includes('Fixture'));
  check('HTML revalidates', r.headers.get('cache-control') === 'no-cache');
  check('nosniff and clickjacking headers', r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('x-frame-options') === 'DENY');
  r = await fetch(base + '/assets/app-abcdefgh.js');
  check('hashed assets have immutable cache and JS MIME', r.headers.get('cache-control').includes('immutable') && r.headers.get('content-type').includes('javascript'));
  r = await fetch(base + '/', { method: 'HEAD' });
  check('HEAD returns metadata without body', r.status === 200 && (await r.text()) === '' && Number(r.headers.get('content-length')) > 0);
  for (const route of ['/missing.js', '/missing.png', '/.env', '/db/users.json', '/server/public/data/snapshot.json', '/leak.json', '/apiculture']) {
    r = await fetch(base + route);
    check(`protected or missing path is 404: ${route}`, r.status === 404);
  }
  r = await fetch(base + '/app/artist', { headers: { accept: 'text/html' } });
  check('HTML navigation alone receives SPA fallback', r.status === 200 && (await r.text()).includes('Fixture'));
  r = await fetch(base + '/app/artist', { headers: { accept: 'application/json' } });
  check('non-navigation missing resource remains 404', r.status === 404);
  const raw = p => new Promise((resolve, reject) => { const q = http.get(base + '/', { path: p }, x => { x.resume(); x.on('end', () => resolve(x.statusCode)); }); q.on('error', reject); });
  check('malformed percent path is 400 without crashing', await raw('/%E0%A4%A') === 400);
  check('encoded traversal is blocked', await raw('/%2e%2e/package.json') === 404);
  r = await fetch(base + '/', { method: 'POST', body: 'x' });
  check('static mutations are 405', r.status === 405 && r.headers.get('allow') === 'GET, HEAD');
  r = await fetch(base + '/api/session', { redirect: 'manual' });
  check('proxy preserves redirect status/location', r.status === 302 && r.headers.get('location') === '/#/my');
  check('proxy preserves both Set-Cookie headers', r.headers.getSetCookie().length === 2);
  r = await fetch(base + '/api/echo', { method: 'POST', headers: { cookie: 'qa=fixture', 'content-type': 'application/json' }, body: '{"x":1}' });
  const echo = await r.json();
  check('proxy forwards body/method/cookie', echo.method === 'POST' && echo.body === '{"x":1}' && echo.cookie === 'qa=fixture');
  const before = seen;
  r = await fetch(base + '/api/echo', { method: 'POST', body: 'x'.repeat(33) });
  check('oversized body blocked before upstream', r.status === 413 && seen === before);
  const abort = new AbortController(), start = Date.now();
  r = await fetch(base + '/api/stream', { signal: abort.signal });
  const reader = r.body.getReader();
  const first = await reader.read();
  check('SSE first chunk streams without buffering entire response', Date.now() - start < 1200 && new TextDecoder().decode(first.value).includes('first'));
  abort.abort(); await reader.cancel().catch(() => {});
  r = await fetch(base + '/api/slow');
  check('upstream header timeout bounded with generic 502', r.status === 502 && (await r.text()) === '{"error":"upstream unavailable"}');
  r = await fetch(base);
  check('server remains healthy after invalid paths/timeouts', r.status === 200);
} finally { if (server) await close(server); await close(upstream); await rm(root, { recursive: true, force: true }); }

const dist = path.resolve('frontend/dist');
const html = await readFile(path.join(dist, 'index.html'), 'utf8');
check('build uses compiled entry rather than source TS', !html.includes('/src/') && /type="module"[^>]*src="\/assets\//.test(html));
const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(m => m[1]);
for (const ref of refs) check(`built entry asset exists: ${ref}`, (await readFile(path.join(dist, ref))).length > 0);
const assetNames = await readdir(path.join(dist, 'assets'));
check('production build does not publish source maps', !assetNames.some(name => name.endsWith('.map')));
const target = process.argv.find(x => x.startsWith('--target='))?.split('=')[1] || 'vercel';
if (!['node', 'vercel'].includes(target)) throw new Error('Use --target=node or --target=vercel');
if (target === 'node') {
  const db = await mkdtemp(path.join(os.tmpdir(), 'lilac-node-candidate-'));
  const reserve = async () => { const s = http.createServer(); await listen(s); const port = s.address().port; await close(s); return port; };
  const frontendPort = await reserve(), backendPort = await reserve();
  const env = { ...process.env, NODE_ENV: 'production', LILAC_DB_DIR: db, LILAC_ALLOWED_ORIGINS: 'http://127.0.0.1:' + frontendPort, LILAC_ADMIN_TOKEN: 'isolated-test-only-not-a-deployment-secret', LILAC_PROD_PORT: String(frontendPort), LILAC_BACKEND_PORT: String(backendPort), LILAC_ENABLE_DEMO_BILLING: '0' };
  try {
    await assert.rejects(preflight({ ...env, NODE_ENV: 'development' }), /NODE_ENV/); check('node preflight rejects non-production environment', true);
    await assert.rejects(preflight({ ...env, LILAC_ADMIN_TOKEN: '' }), /ADMIN_TOKEN/); check('node preflight rejects missing admin token', true);
    await assert.rejects(preflight({ ...env, LILAC_ALLOWED_ORIGINS: '*' }), /ORIGINS/); check('node preflight rejects wildcard origin', true);
    await assert.rejects(preflight({ ...env, LILAC_DB_DIR: '' }), /DB_DIR/); check('node preflight requires explicit persistent DB directory', true);
    const config = await preflight(env); check('node preflight accepts isolated existing DB and explicit security config', config.db === db);
    const result = await startCandidate({ smoke: true, env }); check('actual backend and built frontend start and shut down cleanly against isolated DB', result === 0);
    check('candidate removes ownership lock after shutdown', !(await readdir(db)).includes('.production.lock'));
    const running = startCandidate({ env: { ...env, LILAC_DISABLE_BACKGROUND: '1' } });
    let healthy = false;
    for (let i = 0; i < 100; i++) { try { const h = await fetch('http://127.0.0.1:' + frontendPort + '/api/health', { signal: AbortSignal.timeout(200) }); if (h.ok) { healthy = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
    check('second isolated candidate becomes healthy', healthy);
    const quit = await fetch('http://127.0.0.1:' + frontendPort + '/api/admin/shutdown', { method: 'POST', headers: { 'X-Lilac-Admin-Token': env.LILAC_ADMIN_TOKEN }, signal: AbortSignal.timeout(2000) });
    check('isolated authenticated backend exit is accepted', quit.ok);
    check('unexpected child exit stops candidate with failure status', await running === 1);
    let closed = false;
    try { await fetch('http://127.0.0.1:' + frontendPort, { signal: AbortSignal.timeout(300) }); } catch { closed = true; }
    check('frontend sibling no longer accepts traffic after backend exit', closed);
    check('failure cleanup releases ownership lock', !(await readdir(db)).includes('.production.lock'));
  } finally { await rm(db, { recursive: true, force: true }); }
  console.log('Node candidate checks passed. External TLS/domain, backup recovery, rights and operational release gates remain unverified.');
}
// Execute the actually configured protected-preview adapter, not a source-string heuristic.
const handler = createPublicHandler({ data: {} });
const required = ['/api/live/home?edition=kr', '/api/live/fanclub-list?edition=kr', '/api/community/hub?edition=kr'];
const unavailable = [];
for (const url of required) {
  let status = 0;
  await handler({ method: 'GET', url, headers: {} }, { setHeader() {}, set statusCode(v) { status = v; }, end() {} });
  if (status !== 200) unavailable.push(`${url} -> ${status}`);
}
console.log(`\n${passed} build/proxy assertions passed.`);
if (unavailable.length) {
  console.error((target === 'node' ? 'VERCEL PREVIEW LIMITATION (not node target): ' : 'RELEASE BLOCKER: ') + 'vercel.json targets the legacy read-only adapter; current app endpoints are unsupported:\n' + unavailable.join('\n'));
  if (target === 'vercel' && process.argv.includes('--release')) process.exitCode = 1;
}
