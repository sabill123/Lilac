/* 회원 흐름 — 실제 백엔드를 임시 저장소로 띄워 가입·로그인·비밀번호 변경·로그아웃·탈퇴·대입 제한을 확인한다.
 * 실행: node tests/verify-account.mjs */
import { spawn } from 'node:child_process';
import { mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = await mkdtemp(path.join(tmpdir(), 'lilac-acct-'));
for (const f of ['artists.json', 'charts.json', 'search-index.json', 'fx.json']) await cp(path.join(root, 'db', f), path.join(dir, f)).catch(() => {});
const PORT = 4700 + Math.floor(Math.random() * 200);
const ADMIN = 'a'.repeat(40);
const B = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, [path.join(root, 'backend/server.mjs')], { env: { ...process.env, PORT: String(PORT), LILAC_DB_DIR: dir, NODE_ENV: 'production', LILAC_DISABLE_BACKGROUND: '1', LILAC_ADMIN_TOKEN: ADMIN, DATABASE_URL: '' }, stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${B}/api/health`)).ok) break; } catch { /* 아직 */ } await new Promise((r) => setTimeout(r, 250)); }

const j = async (p, init = {}, tok) => { const r = await fetch(B + p, { ...init, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(init.headers || {}) } }); let b = null; try { b = await r.json(); } catch {} return { s: r.status, b }; };
const out = [];
const t = (name, cond, d = '') => out.push(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + d}`);
const email = 'flow@example.com';
let r = await j('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email: 'bad', password: 'x', name: 'a' }) }); t('잘못된 이메일 거절', r.s === 400, r.s);
r = await j('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, password: 'short', name: 'a' }) }); t('짧은 비밀번호 거절', r.s === 400 && r.b.code === 'WEAK_PASSWORD', JSON.stringify(r.b));
r = await j('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email: 'Flow@Example.com ', password: 'Passw0rd!!', name: '  흐름  ' }) }); t('가입(대소문자·공백 정리)', r.s === 200 && r.b.user.email === email && r.b.user.name === '흐름', JSON.stringify(r.b));
const tok1 = r.b?.token;
t('응답에 비밀번호 해시 없음', !JSON.stringify(r.b).includes('pw') || !r.b.user.pw);
r = await j('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, password: 'Passw0rd!!', name: 'b' }) }); t('중복 가입 409', r.s === 409, r.s);
r = await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'wrong-pass' }) }); t('틀린 비밀번호 401', r.s === 401, r.s);
r = await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'FLOW@example.com', password: 'Passw0rd!!' }) }); t('로그인(대문자 이메일)', r.s === 200, r.s); const tok2 = r.b?.token;
r = await j('/api/me', {}, tok2); t('내 정보', r.b?.user?.email === email);
r = await j('/api/me', { method: 'PATCH', body: JSON.stringify({ name: '새이름' }) }, tok2); t('이름 변경', r.s === 200 && r.b.user.name === '새이름', r.s);
r = await j('/api/oshi', { method: 'POST', body: JSON.stringify({ artistId: 'vaundy', name: 'Vaundy' }) }, tok2); t('팔로우', r.s === 200);
r = await j('/api/me/password', { method: 'POST', body: JSON.stringify({ current: 'nope-nope', next: 'NewPassw0rd!' }) }, tok2); t('비밀번호 변경: 현재 비번 틀림 403(로그아웃 안 됨)', r.s === 403 && r.b.code === 'WRONG_PASSWORD', r.s);
r = await j('/api/me', {}, tok2); t('403 뒤에도 로그인 유지', r.b?.user?.email === email);
r = await j('/api/me/password', { method: 'POST', body: JSON.stringify({ current: 'Passw0rd!!', next: 'short' }) }, tok2); t('새 비번 짧으면 거절', r.s === 400);
r = await j('/api/me/password', { method: 'POST', body: JSON.stringify({ current: 'Passw0rd!!', next: 'NewPassw0rd!' }) }, tok2); t('비밀번호 변경', r.s === 200, r.s);
r = await j('/api/me', {}, tok1); t('다른 기기 로그인(tok1)은 풀림', r.b?.user === null, JSON.stringify(r.b));
r = await j('/api/me', {}, tok2); t('이 기기(tok2)는 유지', r.b?.user?.email === email);
r = await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'Passw0rd!!' }) }); t('옛 비밀번호로 로그인 안 됨', r.s === 401);
r = await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'NewPassw0rd!' }) }); t('새 비밀번호로 로그인', r.s === 200); const tok3 = r.b?.token;
r = await j('/api/auth/logout', { method: 'POST' }, tok3); r = await j('/api/me', {}, tok3); t('로그아웃하면 그 토큰 무효', r.b?.user === null);
r = await j('/api/me', { method: 'DELETE', body: JSON.stringify({ password: 'wrong' }) }, tok2); t('탈퇴: 비번 틀림 403', r.s === 403);
r = await j('/api/me', { method: 'DELETE', body: JSON.stringify({ password: 'NewPassw0rd!' }) }, tok2); t('탈퇴', r.s === 200, r.s);
r = await j('/api/me', {}, tok2); t('탈퇴 후 세션 없음', r.b?.user === null);
r = await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'NewPassw0rd!' }) }); t('탈퇴 후 로그인 불가', r.s === 401);
r = await j('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, password: 'Passw0rd!!', name: 're' }) }); t('같은 이메일로 다시 가입 가능', r.s === 200);
let limited = false; for (let i = 0; i < 12; i++) { const x = await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'bad' + i }) }); if (x.s === 429) { limited = true; break; } }
t('로그인 무차별 대입 제한(429)', limited);


await fetch(`${B}/api/admin/shutdown`, { method: 'POST', headers: { 'X-Lilac-Admin-Token': ADMIN } }).catch(() => {});
await new Promise((r) => setTimeout(r, 500)); srv.kill('SIGKILL');
await rm(dir, { recursive: true, force: true });
for (const l of out) console.log('  ' + l);
const failed = out.filter((l) => l.startsWith('FAIL')).length;
console.log(`\n${out.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
