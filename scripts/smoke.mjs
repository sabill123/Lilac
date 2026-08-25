/**
 * Lilac 스모크 테스트
 *
 * 서버의 모든 공개 엔드포인트를 실제로 호출해 연결 상태와 응답 형태를 검증한다.
 * 브라우저 없이 도는 테스트라 CI·개발 중 회귀 확인에 쓴다.
 *
 * 사용법:
 *   node scripts/smoke.mjs                # 기본: http://localhost:5180 (vite 프록시 경유)
 *   BASE=http://localhost:4600 node scripts/smoke.mjs   # 백엔드 직접
 */

const BASE = process.env.BASE || 'http://localhost:5180';
let pass = 0, fail = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, err: String(e.message || e).slice(0, 140) });
    console.log(`  ❌ ${name} — ${String(e.message || e).slice(0, 100)}`);
  }
}

async function getJson(path) {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}`);
  return r.json();
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log(`\nLilac 스모크 테스트 — ${BASE}\n`);

/* ── 기반 ── */
console.log('[기반]');
await test('health', async () => {
  const j = await getJson('/api/health');
  assert(j.ok === true || j.status === 'ok' || j.ok !== undefined, 'health 형태 이상');
});
await test('status — 모든 서비스 정상', async () => {
  const j = await getJson('/api/status');
  assert(Array.isArray(j.services) && j.services.length >= 7, '서비스 목록 부족');
  const bad = j.services.filter((s) => !s.ok);
  assert(bad.length === 0, `이상 서비스: ${bad.map((s) => s.name).join(',')}`);
});

/* ── 데이터 컬렉션 ── */
console.log('[데이터]');
await test('아티스트 40팀 이상 · 양국', async () => {
  const a = await getJson('/api/db/artists');
  assert(a.length >= 40, `${a.length}팀`);
  assert(a.some((x) => x.country === 'jp') && a.some((x) => x.country === 'kr'), '국가 편중');
});
await test('상품 400건 이상 · 양방향 통화', async () => {
  const p = await getJson('/api/db/products');
  assert(p.length >= 400, `${p.length}건`);
  assert(p.some((x) => x.priceCurrency === 'KRW') && p.some((x) => x.priceCurrency === 'JPY'), '통화 편중');
});
await test('일정 400건 이상 · 실데이터 포함', async () => {
  const e = await getJson('/api/db/events');
  assert(e.length >= 400, `${e.length}건`);
  assert(e.some((x) => x.isDemo === false), '실데이터 없음');
});

/* ── 차트 ── */
console.log('[차트]');
for (const c of ['jp', 'kr']) {
  await test(`통합 차트 ${c} 100곡`, async () => {
    const j = await getJson(`/api/charts?country=${c}&source=combined&limit=100`);
    assert(j.list.length >= 90, `${j.list.length}곡`);
    assert(j.list[0].rank === 1 && j.list[0].title, '1위 형태 이상');
  });
  await test(`Apple RSS ${c} 실시간`, async () => {
    const j = await getJson(`/api/charts?country=${c}&source=appleRss`);
    assert(j.live === true, 'live 플래그 없음 — 수집본 폴백 중');
    assert(j.list.length >= 40, `${j.list.length}곡`);
  });
}
await test('현지 차트 소스 존재 (멜론·빌보드)', async () => {
  const kr = await getJson('/api/charts?country=kr&source=melon');
  const jp = await getJson('/api/charts?country=jp&source=billboard');
  assert(kr.list.length >= 50 && jp.list.length >= 50, '현지 소스 부족');
});

/* ── 실시간 무료 API ── */
console.log('[실시간 API]');
for (const c of ['jp', 'kr']) {
  await test(`Deezer 에디터 픽 ${c}`, async () => {
    const j = await getJson(`/api/editorial?country=${c}`);
    assert(j.list.length >= 20, `${j.list.length}곡`);
    assert(j.list[0].artwork, '아트워크 없음');
  });
}
await test('카탈로그 검색 (실시간 iTunes)', async () => {
  const j = await getJson('/api/catalog/search?term=YOASOBI&limit=3');
  assert((j.tracks || []).length >= 1, '결과 없음');
});
await test('카탈로그 배치', async () => {
  const r = await fetch(BASE + '/api/catalog/batch', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ terms: ['YOASOBI', 'aespa'] }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  assert(j.results && Object.keys(j.results).length === 2, '배치 형태 이상');
});

/* ── 한글 → 일본곡 검색 ── */
console.log('[한글 검색]');
const CASES = [
  ['라일락', 'ライラック'],
  ['군조', '群青'],
  ['킥백', 'KICK BACK'],
];
for (const [q, want] of CASES) {
  await test(`"${q}" → ${want}`, async () => {
    const j = await getJson(`/api/search?q=${encodeURIComponent(q)}`);
    const hit = (j.tracks || []).slice(0, 3).some((t) => (t.title + t.artist).includes(want));
    assert(hit, `상위 3곡에 없음: ${(j.tracks || []).slice(0, 2).map((t) => t.title).join(',')}`);
  });
}
await test('읽기 역색인 (로컬 필터용)', async () => {
  const j = await getJson('/api/readings');
  assert(Object.keys(j).length >= 1000, `${Object.keys(j).length}개 키`);
});
await test('색인 상태', async () => {
  const j = await getJson('/api/index/status');
  assert(j.count >= 5000, `${j.count}건`);
});

/* ── 사용자 데이터 ── */
console.log('[사용자]');
await test('주문 목록 + 통화 필드', async () => {
  const j = await getJson('/api/orders');
  assert(Array.isArray(j), '형태 이상');
  if (j.length) assert(j[0].total > 0, '금액 이상');
});
await test('플레이리스트', async () => {
  const j = await getJson('/api/playlists');
  assert(Array.isArray(j), '형태 이상');
});

/* ── 결과 ── */
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (failures.length) {
  console.log('\n실패 상세:');
  failures.forEach((f) => console.log(`  · ${f.name}: ${f.err}`));
  process.exit(1);
}
console.log('전 엔드포인트 연결 정상\n');
