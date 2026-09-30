/* 실시간 동기화 규칙 검증
 *  - 같은 내용으로 다시 받으면 알림이 없다(화면이 괜히 깜빡이지 않게)
 *  - 내용이 바뀌면 알림 한 번, 새로 생긴 항목 수(added)를 함께
 *  - 수집이 실패하면 이전 값을 지키고 알림도 없다(점검·503을 '없음'으로 저장하지 않게)
 *  - 수집 시각 같은 휘발 필드만 달라진 건 변화로 치지 않는다 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initCache, revalidate, cached, cacheEvents } from '../backend/lib/live/cache.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name} ${detail}`); } };

const dir = await mkdtemp(path.join(tmpdir(), 'lilac-rt-'));
initCache(dir);
const events = [];
cacheEvents.on('change', (e) => events.push(e));

const key = 'kr-opens-test';
const v1 = { items: [{ id: 'a', title: 'A', fetchedAt: '2026-09-27T00:00:00Z' }], sources: [{ provider: 't', ok: true }] };
await revalidate(key, async () => v1);
ok('첫 수집은 알림(처음 생긴 데이터)', events.length === 1 && events[0].first === true, JSON.stringify(events));

await revalidate(key, async () => ({ ...v1, items: [{ ...v1.items[0], fetchedAt: '2026-09-27T00:05:00Z' }] }));
ok('수집 시각만 달라지면 알림 없음', events.length === 1, JSON.stringify(events));

await revalidate(key, async () => ({ ...v1, items: [...v1.items, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }] }));
ok('항목이 늘면 알림 한 번 + added=2', events.length === 2 && events[1].added === 2 && events[1].count === 3, JSON.stringify(events[1]));

await revalidate(key, async () => { throw new Error('HTTP 503'); });
const r = await cached(key, 60e3, async () => v1);
ok('수집 실패는 이전 값 유지 + 알림 없음', events.length === 2 && r.items.length === 3 && r.cache.lastError === 'HTTP 503', JSON.stringify({ n: events.length, items: r.items.length, err: r.cache.lastError }));

await revalidate(key, async () => ({ items: [], sources: [{ provider: 't', ok: false, error: 'timeout' }] }));
const r2 = await cached(key, 60e3, async () => v1);
ok('모든 원천이 실패해 0건이면 비우지 않는다', r2.items.length === 3 && events.length === 2, `${r2.items.length}`);

await rm(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
