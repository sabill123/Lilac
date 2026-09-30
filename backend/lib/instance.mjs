/* 인스턴스 등록/정리.

   왜 필요한가: 개발 중 포트를 바꿔가며 서버를 띄우다 보면 이전 인스턴스가
   그대로 남는다. 이 세션에서 실제로 17개가 동시에 떠 있었고, 각자
   6시간·3시간 주기로 같은 외부 API 를 두드려
     · 애플이 레이트리밋을 걸었고 (아티스트 로스터가 못 자랐다)
     · 그 빈 응답을 "결과 없음"으로 읽어 릴리스 128건이 날아갔다.

   프로세스를 강제로 죽이는 건 환경에 따라 막혀 있으므로,
   여기서는 '누가 떠 있는지'를 파일로 남기고 스스로 물러날 수단을 준다. */

import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

const FILE = (dbDir) => path.join(dbDir, '.instances.json');
const STALE_MS = 2 * 60 * 1000;          // 이 시간 넘게 갱신 없으면 죽은 것으로 본다

async function readAll(dbDir) {
  try { return JSON.parse(await readFile(FILE(dbDir), 'utf-8')); } catch { return {}; }
}

/** 기동 시 등록하고, 살아있는 다른 인스턴스 목록을 돌려준다. */
export async function register(dbDir, { port, pid = process.pid }) {
  const all = await readAll(dbDir);
  const now = Date.now();
  const others = Object.entries(all)
    .filter(([p, v]) => Number(p) !== port && now - (v.at || 0) < STALE_MS)
    .map(([p, v]) => ({ port: Number(p), pid: v.pid }));
  all[port] = { pid, at: now };
  // 오래된 항목은 정리한다
  for (const [p, v] of Object.entries(all)) if (now - (v.at || 0) > STALE_MS * 5) delete all[p];
  await writeFile(FILE(dbDir), JSON.stringify(all, null, 2));
  return others;
}

/** 살아있음을 계속 알린다 */
export function heartbeat(dbDir, port, everyMs = 30_000) {
  const t = setInterval(async () => {
    try {
      const all = await readAll(dbDir);
      all[port] = { pid: process.pid, at: Date.now() };
      await writeFile(FILE(dbDir), JSON.stringify(all, null, 2));
    } catch { /* 파일 경합은 무시 */ }
  }, everyMs);
  t.unref?.();
  return t;
}

export async function unregister(dbDir, port) {
  try {
    const all = await readAll(dbDir);
    delete all[port];
    await writeFile(FILE(dbDir), JSON.stringify(all, null, 2));
  } catch { /* 무시 */ }
}

export async function list(dbDir) {
  const all = await readAll(dbDir);
  const now = Date.now();
  return Object.entries(all)
    .map(([p, v]) => ({ port: Number(p), pid: v.pid, ageS: Math.round((now - (v.at || 0)) / 1000) }))
    .filter((x) => x.ageS < STALE_MS / 1000)
    .sort((a, b) => a.port - b.port);
}
