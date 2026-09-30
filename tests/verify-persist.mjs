/* 사용자 데이터 영속화 — 무료 호스팅의 빈 디스크 재시작을 흉내 낸다.
 * 가짜 Postgres(메모리)로: 저장 → 디스크 삭제 → 복원 → 삭제 반영 → 경로 탈출 차단을 확인한다.
 * 실행: node tests/verify-persist.mjs */
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPersistence, listUserFiles } from '../backend/lib/persist.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name} ${detail}`); } };

/* 테이블 하나짜리 메모리 Postgres */
function fakePg() {
  const rows = new Map();
  let writes = 0;
  return {
    rows, writes: () => writes,
    async query(sql, params = []) {
      if (/^CREATE TABLE/.test(sql)) return { rows: [] };
      if (/^SELECT/.test(sql)) return { rows: [...rows.values()] };
      if (/^INSERT/.test(sql)) { writes++; rows.set(params[0], { path: params[0], body: Buffer.from(params[1]), hash: params[2], deleted: false }); return { rows: [] }; }
      if (/^UPDATE/.test(sql)) { writes++; const r = rows.get(params[0]); if (r) r.deleted = true; return { rows: [] }; }
      throw new Error(`unexpected sql ${sql}`);
    },
    async end() {},
  };
}
const quiet = { log() {}, warn() {} };

const pg = fakePg();
const dirA = await mkdtemp(path.join(tmpdir(), 'lilac-persist-a-'));
await mkdir(path.join(dirA, 'user', 'u1'), { recursive: true });
await mkdir(path.join(dirA, 'community', 'img'), { recursive: true });
await writeFile(path.join(dirA, 'users.json'), JSON.stringify([{ id: 'u1', email: 'a@example.com' }]));
await writeFile(path.join(dirA, 'user', 'u1', 'likes.json'), '[1,2]');
await writeFile(path.join(dirA, 'community', 'img', 'x.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
await writeFile(path.join(dirA, 'charts.json'), '{"public":true}'); // 다시 만들 수 있는 공개 데이터 — 올리지 않는다
await writeFile(path.join(dirA, 'users.json.tmp'), 'partial');

const a = createPersistence({ dbDir: dirA, connect: async () => pg, log: quiet });
await a.hydrate();
const r1 = await a.flush();
ok('사용자 데이터만 올린다(공개 카탈로그·임시 파일 제외)', r1.uploaded === 3 && !pg.rows.has('charts.json') && !pg.rows.has('users.json.tmp'), JSON.stringify([...pg.rows.keys()]));
const r2 = await a.flush();
ok('바뀌지 않았으면 다시 올리지 않는다', r2.uploaded === 0 && r2.deleted === 0, JSON.stringify(r2));

await writeFile(path.join(dirA, 'users.json'), JSON.stringify([{ id: 'u1' }, { id: 'u2' }]));
const later = new Date(Date.now() + 5000);
await utimes(path.join(dirA, 'users.json'), later, later);
const r3 = await a.flush();
ok('바뀐 파일만 다시 올린다', r3.uploaded === 1 && JSON.parse(pg.rows.get('users.json').body.toString()).length === 2, JSON.stringify(r3));

await rm(path.join(dirA, 'user', 'u1', 'likes.json'));
const r4 = await a.flush();
ok('지운 파일은 삭제로 표시한다', r4.deleted === 1 && pg.rows.get('user/u1/likes.json').deleted === true, JSON.stringify(r4));

/* 재시작: 빈 디스크에서 복원 */
const dirB = await mkdtemp(path.join(tmpdir(), 'lilac-persist-b-'));
const b = createPersistence({ dbDir: dirB, connect: async () => pg, log: quiet });
const h = await b.hydrate();
const users = JSON.parse(await readFile(path.join(dirB, 'users.json'), 'utf8'));
const img = await readFile(path.join(dirB, 'community', 'img', 'x.png'));
const likesGone = await readFile(path.join(dirB, 'user', 'u1', 'likes.json')).then(() => false, () => true);
ok('빈 디스크에서 사용자·이미지를 그대로 복원', h.files === 2 && users.length === 2 && img.length === 7 && img[0] === 0x89, JSON.stringify(h));
ok('삭제 표시된 파일은 복원하지 않는다', likesGone);
const before = pg.writes();
const r5 = await b.flush();
ok('복원 직후에는 다시 올리지 않는다', r5.uploaded === 0 && pg.writes() === before, JSON.stringify(r5));

/* 저장소 밖 경로가 들어 있어도 쓰지 않는다 */
pg.rows.set('../escape.json', { path: '../escape.json', body: Buffer.from('x'), hash: 'h', deleted: false });
pg.rows.set('charts.json', { path: 'charts.json', body: Buffer.from('{"evil":1}'), hash: 'h', deleted: false });
const dirC = await mkdtemp(path.join(tmpdir(), 'lilac-persist-c-'));
const c = createPersistence({ dbDir: dirC, connect: async () => pg, log: quiet });
await c.hydrate();
const escaped = await readFile(path.join(path.dirname(dirC), 'escape.json')).then(() => true, () => false);
const chartWritten = await readFile(path.join(dirC, 'charts.json')).then(() => true, () => false);
ok('경로 탈출·허용 목록 밖 파일은 복원하지 않는다', !escaped && !chartWritten);

ok('DATABASE_URL이 없으면 꺼진다', createPersistence({ dbDir: dirA, url: '' }).enabled === false);
ok('목록 함수는 허용 경로만', (await listUserFiles(dirA)).every((f) => !/charts|\.tmp$/.test(f.rel)));

for (const d of [dirA, dirB, dirC]) await rm(d, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
