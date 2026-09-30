/* 떠 있는 로컬 서버를 정리한다.

   왜 필요한가: 개발 중 포트를 바꿔가며 띄우다 보면 이전 프로세스가 그대로 남는다.
   이 저장소에서 실제로 113개가 동시에 떠 있었고, 백엔드들이 각자 주기 수집을 돌려
     · 애플이 레이트리밋을 걸어 아티스트 로스터가 못 자랐고
     · 그 빈 응답을 "결과 없음"으로 읽어 릴리스 128건이 날아갔다.

   kill 이 막힌 환경(샌드박스 등)을 위해 서버가 스스로 내려가는
   /api/admin/shutdown 을 부른다. 그 엔드포인트가 없는 옛 프로세스는
   정리할 수 없으므로, 몇 개가 왜 남았는지 정확히 알려준다. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db');
const TIMEOUT = 500;

const req = async (url, init) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT);
  try { return await fetch(url, { ...init, signal: c.signal }); }
  finally { clearTimeout(t); }
};

/** 백엔드인지 정적 프록시인지 구분한다.
 *  정적 서버(serve-dist)는 /api 를 백엔드로 넘기므로 health 만으로는 못 가른다.
 *  루트가 HTML 이면 정적 서버다. */
async function probe(port) {
  try {
    const h = await req(`http://localhost:${port}/api/health`);
    if (!h.ok) return null;
  } catch { return null; }
  try {
    const r = await req(`http://localhost:${port}/`);
    const ct = r.headers.get('content-type') || '';
    return ct.includes('text/html') ? 'static' : 'backend';
  } catch { return 'backend'; }
}

const ports = new Set();
try {
  const j = JSON.parse(await readFile(path.join(DB, '.instances.json'), 'utf-8'));
  for (const p of Object.keys(j)) ports.add(Number(p));
} catch { /* 없어도 스캔한다 */ }
for (let p = 4000; p <= 8000; p += 1) ports.add(p);

console.log('스캔 중…');
const found = { backend: [], static: [] };
const all = [...ports];
for (let i = 0; i < all.length; i += 64) {
  const batch = all.slice(i, i + 64);
  const kinds = await Promise.all(batch.map(probe));
  batch.forEach((p, k) => { if (kinds[k]) found[kinds[k]].push(p); });
}

console.log(`백엔드 ${found.backend.length}개 · 정적 서버 ${found.static.length}개`);
if (!found.backend.length && !found.static.length) process.exit(0);

let stopped = 0;
const stubborn = [];
for (const p of found.backend) {
  try {
    const r = await req(`http://localhost:${p}/api/admin/shutdown`, { method: 'POST' });
    if (r.ok) { stopped++; continue; }
  } catch { /* 무응답 */ }
  stubborn.push(p);
}
await new Promise((r) => setTimeout(r, 900));

const still = [];
for (const p of found.backend) if (await probe(p)) still.push(p);

console.log(`\n백엔드 종료 ${found.backend.length - still.length}개 · 남음 ${still.length}개`);
if (still.length) {
  console.log(`  남은 포트: ${still.slice(0, 20).map((p) => ':' + p).join(' ')}${still.length > 20 ? ` … (총 ${still.length})` : ''}`);
  console.log('  종료 엔드포인트가 없는 옛 버전입니다. 터미널에서 정리하세요:');
  console.log('    pkill -f "backend/server.mjs"');
}
if (found.static.length) {
  console.log(`\n정적 서버 ${found.static.length}개는 종료 수단이 없습니다:`);
  console.log('    pkill -f "scripts/serve-dist.mjs"');
}
