/* 프로세스 간 수집 락.

   왜 필요한가: 백엔드 인스턴스가 여럿 뜨면(개발 중엔 흔하다) 각자
   같은 db 를 보며 같은 외부 API 를 동시에 두드린다. 실제로 이 세션에서
   11개가 떠 있었고, 그 결과
     · 애플이 빈 응답(레이트리밋)을 주기 시작했고
     · syncReleases 가 그 0건을 "릴리스가 없다"로 읽어 128건을 덮어썼다.
   프로세스 안의 withLock 은 같은 프로세스만 막으므로 이 경우엔 소용이 없다.

   파일 하나를 배타 생성(wx)해서 잡는다. 죽은 프로세스가 남긴 락은
   TTL 이 지나면 회수한다 — 그래야 한 번 죽었다고 영원히 멈추지 않는다. */

import { writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export function lockPath(dbDir, name) {
  return path.join(dbDir, `.${name}.lock`);
}

/** 락을 잡으면 해제 함수를, 못 잡으면 null 을 준다. */
export async function acquire(dbDir, name, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const file = lockPath(dbDir, name);
  const body = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });

  const tryCreate = async () => {
    try {
      await writeFile(file, body, { flag: 'wx' });   // 이미 있으면 실패한다
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      return false;
    }
  };

  if (await tryCreate()) return () => release(file);

  // 이미 있다 — 죽은 프로세스가 남긴 것인지 본다
  try {
    const cur = JSON.parse(await readFile(file, 'utf-8'));
    const age = Date.now() - Date.parse(cur.at || 0);
    /* 락을 잡은 프로세스가 이미 없으면(재시작 도중 내려간 경우) TTL을 기다리지 않고 회수한다 */
    let dead = false;
    if (cur.pid && cur.pid !== process.pid) { try { process.kill(cur.pid, 0); } catch (e) { dead = e.code === 'ESRCH'; } }
    if (!(age > ttlMs) && !dead) return null;     // 아직 유효한 락
    await unlink(file).catch(() => {});           // 만료된 락 회수
    if (await tryCreate()) return () => release(file);
  } catch {
    // 락 파일이 깨졌으면 지우고 한 번 더
    await unlink(file).catch(() => {});
    if (await tryCreate()) return () => release(file);
  }
  return null;
}

async function release(file) {
  await unlink(file).catch(() => {});
}
