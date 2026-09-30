/** Local single-node production candidate. Never a deployment command.
 * NODE_ENV=production LILAC_DB_DIR=/existing/persistent/db \
 * LILAC_ALLOWED_ORIGINS=http://127.0.0.1:5241 LILAC_ADMIN_TOKEN=... node scripts/start-production.mjs
 * --check: read-only preflight. --smoke: isolated operational check, collectors disabled, then exit.
 */
import net from 'node:net';
import { spawn } from 'node:child_process';
import { stat, access, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const flag = name => process.argv.includes(name);

export async function preflight(env = process.env) {
  if (env.NODE_ENV !== 'production') throw new Error('NODE_ENV must be production');
  if (!env.LILAC_ADMIN_TOKEN || env.LILAC_ADMIN_TOKEN.length < 32 || /\s/.test(env.LILAC_ADMIN_TOKEN)) throw new Error('LILAC_ADMIN_TOKEN must be a supplied non-whitespace secret of at least 32 characters');
  const origins = String(env.LILAC_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!origins.length) throw new Error('LILAC_ALLOWED_ORIGINS must explicitly name trusted origins');
  for (const value of origins) {
    let u; try { u = new URL(value); } catch { throw new Error('Invalid LILAC_ALLOWED_ORIGINS entry'); }
    if (value !== u.origin || u.username || u.password || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))) throw new Error('Origins must be exact HTTPS origins, or HTTP loopback origins');
  }
  if (!env.LILAC_DB_DIR || !path.isAbsolute(env.LILAC_DB_DIR)) throw new Error('LILAC_DB_DIR must be an explicit existing absolute persistent directory');
  const db = path.resolve(env.LILAC_DB_DIR);
  if (db === path.join(ROOT, 'db')) throw new Error('Use a separately provisioned persistent DB, not this working checkout db');
  if (!(await stat(db)).isDirectory()) throw new Error('LILAC_DB_DIR is not a directory');
  await access(db, constants.R_OK | constants.W_OK);
  const html = await readFile(path.join(ROOT, 'frontend/dist/index.html'), 'utf8');
  if (!/src="\/assets\/.+\.js"/.test(html)) throw new Error('Build missing; run the frontend production build first');
  const frontendPort = Number(env.LILAC_PROD_PORT || 5241), backendPort = Number(env.LILAC_BACKEND_PORT || 4640);
  if (![frontendPort, backendPort].every(p => Number.isInteger(p) && p >= 1024 && p <= 65535) || frontendPort === backendPort) throw new Error('Use distinct unprivileged frontend/backend ports');
  if (env.LILAC_ENABLE_DEMO_BILLING === '1') throw new Error('Demo billing is forbidden for the production candidate');
  try {
    const instances = JSON.parse(await readFile(path.join(db, '.instances.json'), 'utf8'));
    if (Object.values(instances).some(x => Date.now() - Number(x.at || 0) < 120000)) throw new Error('Persistent DB reports a recent backend instance; stop it before starting this single-writer candidate');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { db, frontendPort, backendPort, origins };
}

async function backendWorker() {
  // The existing backend has no host argument. Constrain every TCP listener in this
  // dedicated subprocess at the Node boundary; clients/outgoing fetches are unaffected.
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    const cb = args.find(x => typeof x === 'function');
    const options = typeof args[0] === 'object' ? { ...args[0] } : { port: Number(args[0]) };
    if (!Number.isInteger(Number(options.port))) throw new Error('Candidate backend requires a TCP port');
    return listen.call(this, { ...options, host: '127.0.0.1' }, cb);
  };
  await import('../backend/server.mjs');
}
const freePort = port => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', () => reject(new Error(`Port ${port} is unavailable`))); s.listen(port, '127.0.0.1', () => s.close(resolve)); });
export async function startCandidate({ smoke = false, env = process.env } = {}) {
  const config = await preflight(env);
  await Promise.all([freePort(config.frontendPort), freePort(config.backendPort)]);
  const lock = path.join(config.db, '.production.lock');
  try { await mkdir(lock); } catch (error) { if (error.code === 'EEXIST') throw new Error('Production lock exists; verify no writer is running before removing a stale lock'); throw error; }
  await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const children = [];
  let stopping = false, failure = false, forced;
  let done;
  const finished = new Promise(resolve => { done = resolve; });
  const cleanup = async () => {
    if (children.some(c => c.exitCode === null && c.signalCode === null)) return;
    clearTimeout(forced);
    await rm(lock, { recursive: true, force: true });
    process.off('SIGINT', signalStop); process.off('SIGTERM', signalStop);
    done(failure ? 1 : 0);
  };
  const stop = (bad = false) => {
    failure ||= bad;
    if (stopping) return;
    stopping = true;
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    forced = setTimeout(() => { failure = true; for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 12000);
    void cleanup();
  };
  const signalStop = () => stop(false);
  process.on('SIGINT', signalStop); process.on('SIGTERM', signalStop);
  const childEnv = { ...env, NODE_ENV: 'production', LILAC_DB_DIR: config.db, PORT: String(config.backendPort), LILAC_DISABLE_BACKGROUND: smoke ? '1' : env.LILAC_DISABLE_BACKGROUND || '0' };
  const run = args => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: childEnv, stdio: ['ignore', 'inherit', 'inherit'] });
    children.push(child);
    child.on('error', () => { stop(true); void cleanup(); });
    child.on('exit', () => { if (!stopping) stop(true); void cleanup(); });
    return child;
  };
  try {
    run([SELF, '--backend-worker']);
    run([path.join(ROOT, 'scripts/serve-dist.mjs'), '--port', String(config.frontendPort), '--api', `http://127.0.0.1:${config.backendPort}`]);
    const base = `http://127.0.0.1:${config.frontendPort}`;
    const deadline = Date.now() + 20000;
    let ready = false;
    while (!stopping && Date.now() < deadline) {
      try {
        const r = await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) });
        const h = await r.json();
        if (r.ok && h.service === 'lilac-backend') { ready = true; break; }
      } catch { /* allow bounded startup */ }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    if (!ready) throw new Error('Candidate did not become healthy within startup deadline');
    const index = await fetch(base, { signal: AbortSignal.timeout(2000) });
    if (!index.ok || !(await index.text()).includes('id="page"')) throw new Error('Built frontend unavailable');
    console.log(`[candidate] ready on ${base}; loopback only, single persistent writer. Not public deployment approval.`);
    if (smoke) stop(false);
  } catch (error) { console.error('[candidate]', error.message); stop(true); }
  return finished;
}
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  try {
    if (flag('--backend-worker')) await backendWorker();
    else if (flag('--check')) { await preflight(); console.log('PASS local node candidate preflight (no processes started)'); }
    else process.exitCode = await startCandidate({ smoke: flag('--smoke') });
  } catch (error) { console.error('[candidate]', error.message); process.exitCode = 1; }
}
