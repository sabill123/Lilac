/* 사용자 데이터 영속화 — 무료 호스팅의 빈 디스크 재시작을 흉내 낸다.
 * 가짜 Postgres(메모리)로: 저장 → 디스크 삭제 → 복원 → 삭제 반영 → 경로 탈출 차단을 확인한다.
 * 실행: node tests/verify-persist.mjs */
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPersistence, listUserFiles, mergeCollected, listCollectedFiles } from '../backend/lib/persist.mjs';

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
      if (/^INSERT/.test(sql) && Array.isArray(params[0])) { writes++; params[0].forEach((rel, i) => rows.set(rel, { path: rel, body: Buffer.from(params[1][i]), hash: params[2][i], deleted: false })); return { rows: [] }; }
      if (/^DELETE/.test(sql)) return { rows: [] };
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

/* 수집 캐시(live-cache): 1시간 주기 묶음 저장 + 재시작 때 병합 복원 */
const env = (at, n) => JSON.stringify({ value: { items: Array.from({ length: n }, (_, i) => ({ id: i })) }, at, checkedAt: at });
ok('병합: 목록 캐시는 수집 시각이 더 새로운 쪽', mergeCollected('live-cache/kr-visiting.json', env(100, 1), env(200, 2)) === env(200, 2) && mergeCollected('live-cache/kr-visiting.json', env(300, 1), env(200, 2)) === null);
const kvMerged = JSON.parse(mergeCollected('live-cache/kv-name-photos.json', JSON.stringify({ a: { photo: 'seed', at: 5 }, b: { photo: 'seedB', at: 9 } }), JSON.stringify({ a: { photo: 'prod', at: 7 }, b: { photo: 'old', at: 1 }, c: { photo: 'new', at: 3 } })));
ok('병합: KV는 키마다 더 새로운 값, 양쪽 키 합집합', kvMerged.a.photo === 'prod' && kvMerged.b.photo === 'seedB' && kvMerged.c.photo === 'new', JSON.stringify(kvMerged));
ok('병합: 디스크에 없으면 저장본', mergeCollected('live-cache/x.json', null, '{"value":1}') === '{"value":1}');

const pg2 = fakePg();
const dirD = await mkdtemp(path.join(tmpdir(), 'lilac-persist-d-'));
await mkdir(path.join(dirD, 'live-cache'), { recursive: true });
await writeFile(path.join(dirD, 'live-cache', 'festivals.json'), env(1000, 3));
await writeFile(path.join(dirD, 'live-cache', 'kv-event-posters.json'), JSON.stringify({ u1: { img: 'i1', at: 10 } }));
await writeFile(path.join(dirD, 'live-cache', 'kv-fc-referrals.json'), '{"clicks":1}'); // 사용자 데이터 — 수집 캐시로 올리지 않는다
await writeFile(path.join(dirD, 'live-cache', 'half.json'), '{"value":'); // 쓰는 중인 파일
let kvFlushed = 0;
const d = createPersistence({ dbDir: dirD, connect: async () => pg2, log: quiet, beforeCollected: async () => { kvFlushed++; } });
await d.hydrate();
const c1 = await d.flushCollected();
ok('수집 캐시를 한 번에 묶어 올린다(사용자 파일·깨진 JSON 제외, 올리기 전 KV를 디스크로)', c1.uploaded === 2 && pg2.writes() === 1 && pg2.rows.has('live-cache/festivals.json') && !pg2.rows.has('live-cache/half.json') && kvFlushed === 1, JSON.stringify({ c1, keys: [...pg2.rows.keys()], w: pg2.writes() }));
ok('수집 캐시가 그대로면 다시 올리지 않는다', (await d.flushCollected()).uploaded === 0);
ok('사용자 데이터 경로 목록에 수집 캐시는 섞이지 않는다', (await listUserFiles(dirD)).every((f) => !/festivals|event-posters/.test(f.rel)) && (await listCollectedFiles(dirD)).every((f) => !/fc-referrals/.test(f.rel)));

/* 재시작: 새 배포 시드(더 오래된 목록 · 일부 KV)가 깔린 디스크 위로 병합 */
const dirE = await mkdtemp(path.join(tmpdir(), 'lilac-persist-e-'));
await mkdir(path.join(dirE, 'live-cache'), { recursive: true });
await writeFile(path.join(dirE, 'live-cache', 'festivals.json'), env(500, 1));
await writeFile(path.join(dirE, 'live-cache', 'kv-event-posters.json'), JSON.stringify({ u2: { img: 'seed2', at: 20 } }));
const e = createPersistence({ dbDir: dirE, connect: async () => pg2, log: quiet });
const he = await e.hydrate();
const fest = JSON.parse(await readFile(path.join(dirE, 'live-cache', 'festivals.json'), 'utf8'));
const posters = JSON.parse(await readFile(path.join(dirE, 'live-cache', 'kv-event-posters.json'), 'utf8'));
ok('재시작 복원: 더 새로운 저장본 목록 + 시드와 저장본 KV 합집합', fest.value.items.length === 3 && posters.u1?.img === 'i1' && posters.u2?.img === 'seed2' && he.merged === 2, JSON.stringify({ he, posters }));
const w0 = pg2.writes();
const ce = await e.flushCollected();
ok('병합으로 바뀐 KV만 다시 올린다(저장본과 같은 목록은 건너뜀)', ce.uploaded === 1 && pg2.writes() === w0 + 1 && JSON.parse(pg2.rows.get('live-cache/kv-event-posters.json').body.toString()).u2, JSON.stringify(ce));

/* 무중단 배포: 옛 인스턴스가 종료 직전 올린 키(u9)를, 그보다 먼저 복원한 새 인스턴스의 업로드가 지우지 않는다 */
const stored = JSON.parse(pg2.rows.get('live-cache/kv-event-posters.json').body.toString());
stored.u9 = { img: 'old-instance-last', at: 99 };
pg2.rows.set('live-cache/kv-event-posters.json', { path: 'live-cache/kv-event-posters.json', body: Buffer.from(JSON.stringify(stored)), hash: 'old', deleted: false });
await writeFile(path.join(dirE, 'live-cache', 'kv-event-posters.json'), JSON.stringify({ ...posters, u3: { img: 'new-instance', at: 50 } }));
const later2 = new Date(Date.now() + 9000);
await utimes(path.join(dirE, 'live-cache', 'kv-event-posters.json'), later2, later2);
await e.flushCollected();
const after = JSON.parse(pg2.rows.get('live-cache/kv-event-posters.json').body.toString());
ok('KV 업로드는 저장본과 키 단위 병합(옛 인스턴스 마지막 키 보존 + 새 키 추가)', after.u9?.img === 'old-instance-last' && after.u3?.img === 'new-instance' && after.u1 && after.u2, JSON.stringify(after));

for (const d of [dirA, dirB, dirC, dirD, dirE]) await rm(d, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
