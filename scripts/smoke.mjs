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

/* 사용자 데이터 엔드포인트는 로그인이 필요하다.
   예전엔 서버가 세션 하나를 전역으로 들고 있어 토큰 없이도 읽혔는데,
   그게 계정 간 데이터 유출의 원인이었다. 이제 스모크도 실제로 로그인한다. */
let AUTH = null;

async function getJson(path) {
  const r = await fetch(BASE + path, {
    headers: AUTH ? { authorization: `Bearer ${AUTH}` } : {},
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}`);
  return r.json();
}

async function postJson(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(AUTH ? { authorization: `Bearer ${AUTH}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status} ${path}`);
  return j;
}

/** 스모크 전용 계정으로 로그인(없으면 가입) */
async function ensureAuth() {
  const cred = { email: 'smoke@lilac.test', password: 'smoke-pw-1234', name: '스모크' };
  try {
    const j = await postJson('/api/auth/login', { email: cred.email, password: cred.password });
    AUTH = j.token;
  } catch {
    const j = await postJson('/api/auth/signup', cred);
    AUTH = j.token;
  }
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
await test('로그인', async () => {
  await ensureAuth();
  assert(AUTH, '토큰을 받지 못했다');
});
await test('비로그인은 401', async () => {
  const saved = AUTH; AUTH = null;
  const r = await fetch(BASE + '/api/playlists', { signal: AbortSignal.timeout(10000) });
  AUTH = saved;
  assert(r.status === 401, `보호되지 않음 (${r.status})`);
});
await test('주문 목록 + 통화 필드', async () => {
  const j = await getJson('/api/orders');
  assert(Array.isArray(j), '형태 이상');
  if (j.length) assert(j[0].total > 0, '금액 이상');
});
await test('플레이리스트', async () => {
  const j = await getJson('/api/playlists');
  assert(Array.isArray(j), '형태 이상');
});

/* ── BM ── */
console.log('[BM]');
await test('요금제', async () => {
  const j = await getJson('/api/plans');
  assert(Array.isArray(j.plans) && j.plans.length >= 3, '플랜이 부족하다');
  const paid = j.plans.filter((p) => p.priceKrw > 0);
  assert(paid.every((p) => p.priceKrw >= 4900 && p.priceKrw <= 7900), 'BM 요금 구간을 벗어남');
});
await test('공동구매 목록', async () => {
  const j = await getJson('/api/groupbuys');
  assert(Array.isArray(j.groupBuys), '형태 이상');
  for (const g of j.groupBuys) {
    assert(g.discount >= 0 && g.discount <= 0.3, '할인율 범위 이상');
    assert(typeof g.joined === 'number', '참여 수 없음');
  }
});
await test('릴리스 동기화 상태', async () => {
  const j = await getJson('/api/store/sync');
  assert(j.lastAt, '동기화가 한 번도 안 돌았다');
  assert(j.lastResult?.artistsQueried >= 40, `조회 아티스트가 적다: ${j.lastResult?.artistsQueried}`);
  assert(j.lastResult?.errors === 0, `동기화 오류 ${j.lastResult?.errors}건`);
});

await test('릴리스 목록 필터·페이지네이션', async () => {
  const all = await getJson('/api/store/releases?limit=1');
  assert(all.total >= 50, `릴리스가 너무 적다: ${all.total}`);
  const cur = await getJson('/api/store/releases?tier=curated&limit=1');
  const dis = await getJson('/api/store/releases?tier=discovered&limit=1');
  assert(cur.total + dis.total === all.total, '등급 합이 전체와 다르다');
  const p2 = await getJson('/api/store/releases?limit=5&offset=5');
  assert(p2.releases.length === 5 && p2.offset === 5, '페이지네이션 이상');
});

await test('릴리스 판매처 비교', async () => {
  // 판매처 비교는 사람이 특전을 확인한 발매(curated)에만 있다. 새로 동기화된 발매가 앞에 오면 releases[0]은 비교 행이 없다.
  const { releases } = await getJson('/api/store/releases?tier=curated');
  assert(releases.length >= 1, '릴리스가 없다');
  const d = await getJson(`/api/store/releases/${releases[0].id}`);
  assert(d.comparison.rows.length >= 1, '비교 행이 없다');
  // 판매처 링크가 검색 결과면 예전 구조로 되돌아간 것
  for (const r of d.comparison.rows) {
    assert(!/\/search|SearchWord=/i.test(r.url), `검색 URL: ${r.url}`);
  }
});

await test('공동구매 참여·해제 (런타임)', async () => {
  // 소스 검사로는 못 잡는 종류가 있다 — 클로저 밖 변수 참조로 서버가 죽은 적이 있다.
  const { groupBuys } = await getJson('/api/groupbuys');
  assert(groupBuys.length >= 1, '공동구매가 없다');
  // 마감 지난 공동구매로 참여를 시험하면 409가 정상이다 — 열린 것을 고른다
  const open = groupBuys.find((g) => !g.closesAt || Date.parse(g.closesAt) > Date.now()) || groupBuys.find((g) => g.status === 'open');
  if (!open) { console.log('     (열린 공동구매 없음 — 참여 시험 생략)'); return; }
  const id = open.id;
  const joined = await postJson(`/api/groupbuys/${id}/join`, { qty: 2 });
  assert(joined.groupBuy && joined.groupBuy.joined >= 2, '참여가 반영되지 않았다');
  const left = await postJson(`/api/groupbuys/${id}/leave`, {});
  assert(left.groupBuy, '해제 응답이 비었다');
});

await test('릴리스 주문 = 견적 (런타임)', async () => {
  const { releases } = await getJson('/api/store/releases?tier=curated');
  const d = await getJson(`/api/store/releases/${releases[0].id}`);
  const row = d.comparison.rows[0];
  const q = (await getJson(
    `/api/quote?releaseId=${releases[0].id}&offerId=${row.offerId}&editionId=${row.editionId}&qty=1`,
  )).quote;
  assert(q.total > 0, '견적 금액 이상');
  assert(q.total === row.quote.total, `비교표(${row.quote.total})와 견적(${q.total})이 다르다`);
});

await test('견적 = 주문 금액', async () => {
  const products = await getJson('/api/db/products');
  const p = products[0];
  const q = (await getJson(`/api/quote?productId=${p.id}&qty=1`)).quote;
  assert(q.total > 0, '견적 금액 이상');
  // 구성요소 합이 총액과 맞는지 (자리올림 오차 허용)
  const sum = q.base - q.groupOff + q.fee + q.shipping;
  assert(Math.abs(q.total - sum) < 200, `구성요소 합(${sum})과 총액(${q.total}) 불일치`);
});

/* ── 실시간 팬덤 정보 (v6) ── */
console.log('\n[실시간 공연·티켓·뉴스·굿즈]');
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
await test('내한 공연 — 예매처 실데이터, 지난 공연 없음, 상세는 검색 페이지가 아님', async () => {
  const j = await getJson('/api/live/concerts?edition=kr&scope=visiting&origin=all');
  assert(j.items.length >= 10, `내한 공연 ${j.items.length}건`);
  assert(j.items.every((x) => !x.endDate || x.endDate >= today || (x.startDate && x.startDate >= today)), '지난 공연이 섞였다');
  assert(j.items.every((x) => /^https:\/\//.test(x.url) && !/search/i.test(x.url)), '상세 URL이 검색 페이지다');
  assert((j.groups?.[0]?.sources || []).some((s) => s.ok), '예매처 응답 없음');
});
await test('내한(일본 아티스트) — 국적 판정 근거가 있다', async () => {
  const j = await getJson('/api/live/concerts?edition=kr&scope=visiting');
  const jp = j.items.filter((x) => !x.unconfirmed);
  assert(jp.every((x) => x.origin === 'jp' && x.originSource), '근거 없는 일본 판정');
});
await test('来日 K-POP 공연 (e+·ぴあ)', async () => {
  const j = await getJson('/api/live/concerts?edition=jp&scope=visiting');
  assert(j.items.length >= 10, `来日 ${j.items.length}건`);
  assert(j.items.every((x) => x.country === 'JP' || x.country === 'KR'), 'country 누락');
});
await test('티켓 오픈 — 9999 같은 자리표시 날짜가 없다', async () => {
  const j = await getJson('/api/live/tickets?edition=all&origin=all');
  assert(j.items.length >= 5, `티켓 ${j.items.length}건`);
  assert(j.items.every((x) => !String(x.ticketOpenAt || '').startsWith('9999')), '9999 날짜 노출');
});
await test('뉴스 — 한국어판은 한글 제목, 스팸 없음', async () => {
  const j = await getJson('/api/live/news?edition=kr');
  assert(j.items.length >= 5, `뉴스 ${j.items.length}건`);
  assert(j.items.every((x) => /[가-힣]/.test(x.title)), '한글 아닌 제목');
  assert(!j.items.some((x) => /카지노|토토|바카라|casino/i.test(x.title)), '스팸 노출');
});
await test('굿즈 — 실판매처 상품(가격·상세 URL)', async () => {
  const j = await getJson('/api/live/goods?q=YOASOBI&market=kr');
  assert(j.items.length >= 3, `상품 ${j.items.length}건`);
  assert(j.items.some((x) => x.price > 0), '가격 없음');
  assert(j.items.every((x) => !/search|wsearchresult|searchList/.test(x.url)), '상품 URL이 검색 페이지다');
});
await test('홈 요약 — 에디션별', async () => {
  for (const ed of ['kr', 'jp', 'all']) {
    const j = await getJson(`/api/live/home?edition=${ed}`);
    assert(Array.isArray(j.visiting) && Array.isArray(j.tickets) && Array.isArray(j.news) && j.chart.length >= 1, `${ed} 홈 형태 이상`);
    assert(Array.isArray(j.fanclub) && typeof j.fanclubTotal === 'number', `${ed} 홈에 팬클럽 선행 목록이 없다`);
  }
});
await test('팬클럽 선행 — 공식 페이지 원문 링크, 마감 전 접수만, 일반 선행과 구분', async () => {
  const j = await getJson('/api/live/fanclubs?edition=kr');
  const now = Date.now();
  for (const w of j.windows) {
    assert(/^https?:\/\//.test(w.url), `원문 링크 없음: ${w.title}`);
    assert(w.closesAt && Date.parse(w.closesAt) > now, `마감된 접수가 남아 있다: ${w.saleType}`);
    assert(!(w.isPublic && (w.fcOnly || w.fcFirst)), `일반 선행이 팬클럽 선행으로 표시됐다: ${w.saleType}`);
    assert(!w.trade, `회원 리세일이 선행 목록에 섞였다: ${w.saleType}`);
  }
  for (const t of j.tours) {
    assert(t.shows.every((s) => s.date >= new Date(now + 9 * 3600e3).toISOString().slice(0, 10)), `지난 회차가 남아 있다: ${t.title}`);
    assert(['kr-abroad', 'kr-visiting'].includes(t.direction), `한국판에 맞지 않는 방향: ${t.direction}`);
  }
});
await test('차트 순위 변동 — 이전 순위를 주는 차트만', async () => {
  const j = await getJson('/api/live/chart-moves?country=jp');
  if (!j.source) return;
  assert(j.rising.every((e) => e.lastRank > e.rank), '상승 목록에 상승하지 않은 곡이 있다');
  assert(j.entries.every((e) => e.move === 'new'), '새로 진입 목록에 기존 곡이 있다');
});

await test('커뮤니티 — 종합 갤러리 3개, 아티스트 갤러리 자동, 없는 갤러리 404, 비로그인 글쓰기 401', async () => {
  const hub = await getJson('/api/community/hub?edition=kr');
  assert(hub.general.map((g) => g.id).join() === 'free,ticket,fanclub', '종합 갤러리 구성이 다르다');
  const g = await getJson('/api/community/galleries?edition=kr');
  assert(g.items.length > 10 && g.items.every((x) => x.artist?.origin === 'jp'), '한국판 갤러리 목록에 일본 아티스트만 있어야 한다');
  const b = await getJson('/api/community/b/' + encodeURIComponent(g.items[0].id));
  assert(b.board.kind === 'artist' && Array.isArray(b.items), '아티스트 갤러리가 열리지 않는다');
  const nf = await fetch(BASE + '/api/community/b/__nope__', { signal: AbortSignal.timeout(8000) });
  assert(nf.status === 404, '없는 갤러리가 404가 아니다: ' + nf.status);
  const w = await fetch(BASE + '/api/community/b/free', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x', body: 'y' }), signal: AbortSignal.timeout(8000) });
  assert(w.status === 401, '비로그인 글쓰기가 막히지 않는다: ' + w.status);
});
await test('소셜 — 좋아요 수 조회는 공개, 좋아요는 로그인 필요', async () => {
  const r = await fetch(BASE + '/api/social/lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ kind: 'track', ref: 'a|b' }] }), signal: AbortSignal.timeout(8000) });
  const j = await r.json();
  assert(r.ok && /^t[a-f0-9]{15}$/.test(j.items[0].key), '조회 실패');
  const l = await fetch(BASE + '/api/social/like', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'track', ref: 'a|b', snap: { title: 'a' } }), signal: AbortSignal.timeout(8000) });
  assert(l.status === 401, '비로그인 좋아요가 막히지 않는다: ' + l.status);
});
await test('팬클럽 — 거주지별 요금(해외 코스)을 읽은 팬클럽이 있다', async () => {
  const j = await getJson('/api/live/fanclub-list?edition=kr');
  const withRes = j.items.filter((x) => x.residence?.overseas);
  assert(withRes.length >= 1, '해외 거주자 코스를 읽은 팬클럽이 없다');
  for (const x of withRes) assert(x.residence.overseas.payments.every((p) => !/コンビニ|d払い|auかんたん/.test(p)), '해외 코스에 일본 전용 결제가 섞였다: ' + x.artist);
});

await test('팬클럽 — 한국·일본 아티스트 전원을 목록에서 다룬다(상위 몇 팀만이 아니라)', async () => {
  for (const ed of ['kr', 'jp']) {
    const [fl, ar] = await Promise.all([getJson('/api/live/fanclub-list?edition=' + ed), getJson('/api/live/artists?edition=' + ed)]);
    const nk = (x) => String(x || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    const ids = new Set(fl.items.map((x) => x.artistId));
    const names = new Set(fl.items.flatMap((x) => [x.artist, x.artistLatin]).filter(Boolean).map(nk));
    /* 모든 아티스트가 목록에 있다(같은 아티스트가 id만 달리 두 번 있으면 하나로 합쳐진 것은 이름으로 확인) */
    const miss = ar.items.filter((a) => !ids.has(a.id) && ![a.name, a.nameOriginal, a.nameJa].filter(Boolean).some((n) => names.has(nk(n))));
    assert(!miss.length, ed + ' 에디션 팬클럽 목록에 빠진 아티스트: ' + miss.map((a) => a.name).join(', '));
  }
});
await test('팬클럽 — Weverse 멤버십은 상품 가격을 읽는다', async () => {
  const j = await getJson('/api/live/fanclub-list?edition=jp');
  const wv = j.items.filter((x) => x.found && x.platform === 'Weverse' && x.fees?.annual);
  assert(wv.length >= 1, 'Weverse 멤버십 가격을 읽은 팀이 없다');
  assert(wv.every((x) => x.fees.annual >= 1000 && x.fees.annual <= 20000), '멤버십 가격이 비정상: ' + wv.map((x) => x.fees.annual).join(','));
});

/* ── 결과 ── */
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (failures.length) {
  console.log('\n실패 상세:');
  failures.forEach((f) => console.log(`  · ${f.name}: ${f.err}`));
  process.exit(1);
}
console.log('전 엔드포인트 연결 정상\n');
