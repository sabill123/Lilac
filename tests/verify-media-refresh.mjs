/* 썸네일·데이터 갱신 회귀 — 운영 2026-10-22 관측을 고정한다(네트워크 없음, 가짜 fetch).
 *  1) Billboard JAPAN 0곡: 원인이 남지 않았고(HTTP·타임아웃·0행 모두 빈 목록), 이전 주간 목록도 버렸다
 *  2) 오리콘 재킷: 버려져서 CD 신곡이 통합 차트에서 글자 자리표시였다(일본 79곡 중 29곡)
 *  3) 깨진 og:image('/' 빠진 호스트)와 한 번 받은 포스터를 다시 확인하지 않던 문제
 *  4) 팬클럽 포스터 호스트가 이미지 중계 허용 목록에 없어 홈 3D 무대가 403 → 글자 대체(Vaundy)
 *  5) 아티스트 사진: Deezer 인기곡이 지역 제한으로 비면 대조가 늘 실패해 '없음'으로 굳고, 작업은 결과를 안 남겼다
 *  6) 발매 일정이 수동 수집본(8/12)에서 멈춰 있던 문제
 * 실행: node tests/verify-media-refresh.mjs */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { parseBillboardHot100, billboardJP, settleWeeklySource, WEEKLY_CARRY_MAX_MS, parseOriconRank, oriconArtwork, buildCombined } from '../backend/collect-charts.mjs';
import { ogImage, repairJoinedOrigin, eventPoster, posterNeedsCheck } from '../backend/lib/live/posters.mjs';
import { validateArtworkUrl, fetchArtwork } from '../backend/lib/live/image-proxy.mjs';
import { deezerArtist } from '../backend/lib/live/artist-info.mjs';
import { releaseEventsFrom } from '../backend/lib/release-events.mjs';
import { initCache } from '../backend/lib/live/cache.mjs';
import { createLiveService } from '../backend/lib/live/service.mjs';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
const realFetch = globalThis.fetch;
const offline = () => { globalThis.fetch = async (u) => { throw Error(`offline fixture must not access network: ${u}`); }; };
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
offline();

/* Billboard JAPAN 표 행 — 2026-09-30 수집 때 파서가 100곡을 읽은 마크업 형태 */
const bbRow = (rank, title, artist, extra = '') => `<tr class="rank${rank}"><td class="rank_td"><span>${rank}</span></td><td><p class="musuc_title">${title}</p><p class="artist_name"><a href="/artists/detail/1">${artist}</a></p><span class="last">前回：${rank + 1}</span>${extra}</td></tr>`;
const bbPage = `<html><body><table>${bbRow(1, '愛MUST BE', '櫻坂46', '<span class="up"></span>')}${bbRow(2, 'Yes! 東京 (feat. 超特急)', 'EBiDAN')}${bbRow(3, 'ブルーアンバー', 'back number', '<span class="new"></span>')}</table>${'x'.repeat(600)}</body></html>`;

try {
  await test('Billboard: 표 행을 순위·곡·아티스트·이동으로 읽는다', () => {
    const rows = parseBillboardHot100(bbPage);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], { rank: 1, title: '愛MUST BE', artist: '櫻坂46', lastRank: 2, move: 'up' });
    assert.equal(rows[2].move, 'new');
  });

  await test('Billboard: 실패 이유(HTTP·0행·타임아웃)를 던지고, 빈 목록을 성공처럼 돌려주지 않는다', async () => {
    const calls = [];
    const http403 = async (u) => { calls.push(u); return new Response('<html>Forbidden</html>', { status: 403 }); };
    await assert.rejects(billboardJP({ fetchImpl: http403 }), (e) => /HTTP 403/.test(e.message) && /\?a=hot100/.test(e.message));
    assert.equal(calls.length, 2, '두 주소 표기를 모두 시도');
    const blank = async () => new Response(`<html>${'y'.repeat(2000)}</html>`, { status: 200 });
    await assert.rejects(billboardJP({ fetchImpl: blank }), (e) => /0곡 파싱/.test(e.message) && /rank 행 0개/.test(e.message));
    /* AbortSignal.timeout 타이머는 unref 라 이벤트 루프를 붙잡아 둔다 */
    const keep = setTimeout(() => {}, 2000);
    const hang = async (_u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)));
    await assert.rejects(billboardJP({ fetchImpl: hang, timeoutMs: 30 }), (e) => /timeout/.test(e.message));
    clearTimeout(keep);
    const refused = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
    await assert.rejects(billboardJP({ fetchImpl: refused }), (e) => /ECONNREFUSED/.test(e.message));
  });

  await test('Billboard: 첫 주소가 실패하면 슬래시 주소로 받는다', async () => {
    const seen = [];
    const rows = await billboardJP({ fetchImpl: async (u) => { seen.push(u); return u.includes('/detail/?') ? new Response(bbPage) : new Response('', { status: 500 }); } });
    assert.equal(rows.length, 3); assert.equal(seen.length, 2);
  });

  await test('주간 차트: 8일 안의 이전 목록은 이유와 함께 이어 쓰고, 그보다 오래되면 비운다', () => {
    const now = Date.parse('2026-10-22T14:00:00Z');
    const prevCountry = { billboard: [{ rank: 1, title: 'a', artist: 'b' }], sourceMeta: { billboard: { ok: true, count: 1, collectedAt: '2026-10-21T02:00:00Z' } } };
    const carried = settleWeeklySource('billboard', [], prevCountry, { now, error: 'timeout 20s' });
    assert.equal(carried.list.length, 1); assert.equal(carried.meta.ok, false);
    assert.equal(carried.meta.carriedFrom, '2026-10-21T02:00:00Z'); assert.equal(carried.meta.error, 'timeout 20s');
    const old = settleWeeklySource('billboard', [], { ...prevCountry, sourceMeta: { billboard: { collectedAt: new Date(now - WEEKLY_CARRY_MAX_MS - 1).toISOString() } } }, { now });
    assert.equal(old.list.length, 0); assert.equal(old.meta.ok, false);
    /* 받은 날짜를 모르는 예전 목록은 이어 쓰지 않는다(몇 주 묵었는지 알 수 없다) */
    assert.equal(settleWeeklySource('billboard', [], { billboard: [{ rank: 1 }] }, { now }).list.length, 0);
    const fresh = settleWeeklySource('billboard', [{ rank: 1, title: 'n', artist: 'm' }], prevCountry, { now });
    assert.equal(fresh.meta.ok, true); assert.equal(fresh.meta.collectedAt, new Date(now).toISOString());
  });

  await test('오리콘: 재킷 사진을 아트워크로 읽고(대체 그림은 버림) 통합 차트 행에 실린다', () => {
    const entry = (n, title, name, img) => `<section class="box-rank-entry"><p class="num ">${n}</p><div class="inner"><a href="/prof/1/"><p class="image"><span><img src="${img}" alt="${title}"></span></p><div class="wrap-text"><h2 class="title" itemprop="name">${title}</h2><p class="name">${name}</p></div></a></div></section>`;
    const html = entry(1, '愛MUST BE', '櫻坂46', 'https://m.media-amazon.com/images/I/41kP9TY3T-L._SL160_.jpg') + entry(2, 'はつ恋ONDO', 'iiONDO', '/img/noimage_160.gif');
    const rows = parseOriconRank(html);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].artwork, 'https://m.media-amazon.com/images/I/41kP9TY3T-L._SL500_.jpg');
    assert.equal(rows[1].artwork, undefined, 'noimage는 아트워크가 아니다');
    assert.equal(oriconArtwork('<p class="image"><img src="javascript:alert(1)"></p>'), null);
    const combined = buildCombined({ oricon: rows, youtube: [{ rank: 1, title: '愛MUST BE', artist: '櫻坂46', youtubeId: 'v' }] }, { oricon: 0.15, youtube: 0.2 });
    assert.equal(combined.find((r) => r.title === '愛MUST BE').artwork, rows[0].artwork);
    assert.equal(combined.find((r) => r.title === 'はつ恋ONDO').artwork, null);
  });

  await test('og:image: 호스트 뒤 "/" 빠진 주소를 고치고, 정상 다른 도메인은 건드리지 않는다', async () => {
    const page = 'https://candytune.asobisystem.com/news/detail/43700';
    const html = '<meta property="og:image" content="https://candytune.asobisystem.comstatic2/prod/public/fcopen/contents/information/666/3de5659545f8c61652cfc6e3834f0ee6.jpeg" />';
    assert.equal(ogImage(html, page), 'https://candytune.asobisystem.com/static2/prod/public/fcopen/contents/information/666/3de5659545f8c61652cfc6e3834f0ee6.jpeg');
    assert.equal(repairJoinedOrigin('https://foo.com/a.jpg', 'https://foo.co/x'), 'https://foo.com/a.jpg');
    assert.equal(repairJoinedOrigin('https://cdn.example.com/a.jpg', 'https://example.com/x'), 'https://cdn.example.com/a.jpg');
    const r = await eventPoster(page, { read: async () => html, body: false });
    assert.match(r.img, /asobisystem\.com\/static2\//);
  });

  await test('포스터 재확인: 받아 둔 이미지도 7일 뒤 다시 확인, "없음"은 하루 뒤', () => {
    const now = Date.parse('2026-10-22T14:00:00Z');
    assert.equal(posterNeedsCheck({ img: 'https://x/a.jpg', at: now - 8 * 24 * 3600e3 }, now), true, '예전 코드는 이미지가 있으면 영영 다시 묻지 않았다');
    assert.equal(posterNeedsCheck({ img: 'https://x/a.jpg', at: now - 3600e3 }, now), false);
    assert.equal(posterNeedsCheck({ none: true, at: now - 25 * 3600e3 }, now), true);
    assert.equal(posterNeedsCheck({ none: true, at: now - 3600e3 }, now), false);
    assert.equal(posterNeedsCheck(undefined, now), true);
  });

  await test('이미지 중계: 서버가 저장한 포스터 주소만 고정 목록 밖에서 통과, 다른 호스트로의 리다이렉트는 막는다', async () => {
    const poster = 'https://member.vaundy.jp/static/vaundy/fanclub/feature/asiatour2026/ogp_7Ssg4Ew4LS.jpg';
    assert.throws(() => validateArtworkUrl(poster), (e) => e.status === 403);
    const trusted = (h) => h === poster;
    assert.equal(validateArtworkUrl(poster, { trusted }).href, poster);
    assert.throws(() => validateArtworkUrl('https://member.vaundy.jp/other.jpg', { trusted }), (e) => e.status === 403);
    assert.throws(() => validateArtworkUrl('https://member.vaundy.jp:8443/x.jpg', { trusted: () => true }), (e) => e.status === 403);
    const fixture = (responses) => {
      const calls = [];
      const request = (url, options, done) => { const req = new EventEmitter(); req.end = () => queueMicrotask(() => { calls.push(url.href); const spec = responses[calls.length - 1]; if (!spec) return req.emit('error', Error('unexpected')); const body = Readable.from([Buffer.from([255, 216, 255])]); body.statusCode = spec.status || 200; body.headers = spec.headers || { 'content-type': 'image/jpeg' }; done(body); }); return req; };
      return { calls, request, lookup: async () => [{ address: '93.184.216.34', family: 4 }] };
    };
    const ok = fixture([{}]);
    const img = await fetchArtwork(poster, { ...ok, trusted });
    assert.equal(img.type, 'image/jpeg'); assert.equal(ok.calls.length, 1);
    const sameHost = fixture([{ status: 302, headers: { location: '/static/vaundy/moved.jpg' } }, {}]);
    await fetchArtwork(poster, { ...sameHost, trusted });
    assert.equal(sameHost.calls.length, 2);
    for (const location of ['https://evil.example/x.jpg', 'http://127.0.0.1/', 'https://member.vaundy.jp.evil.example/x.jpg']) {
      const f = fixture([{ status: 302, headers: { location } }]);
      await assert.rejects(fetchArtwork(poster, { ...f, trusted }), (e) => e.status === 403);
    }
  });

  await test('Deezer 사진: 인기곡이 지역 제한으로 비면 앨범명으로 대조, 동명이인은 여전히 거른다', async () => {
    const calls = [];
    const dz = (routes) => async (u) => { calls.push(String(u)); for (const [re, body] of routes) if (re.test(String(u))) return json(body); throw Error(`unexpected ${u}`); };
    globalThis.fetch = dz([
      [/search\/artist/, { data: [{ id: 14307405, name: 'M!LK', nb_fan: 425, picture_xl: 'https://cdn-images.dzcdn.net/images/artist/165a/1000x1000.jpg', picture_big: 'https://cdn-images.dzcdn.net/images/artist/165a/500x500.jpg' }] }],
      [/artist\/14307405\/top/, { data: [] }],
      [/artist\/14307405\/albums/, { data: [{ title: 'LOVE ENG!NE' }, { title: 'Jewel' }] }],
    ]);
    const d = await deezerArtist(['M!LK'], { knownTitles: ['爆裂愛してる', 'LOVE ENG!NE'] });
    assert.equal(d?.id, 14307405, '예전 코드는 top 0곡이면 null');
    assert.ok(calls.some((u) => /albums/.test(u)));
    globalThis.fetch = dz([
      [/search\/artist/, { data: [{ id: 4988996, name: 'Snow Man', nb_fan: 541, picture_xl: 'https://cdn-images.dzcdn.net/images/artist/b76e/1000x1000.jpg' }] }],
      [/artist\/4988996\/top/, { data: [] }],
      [/artist\/4988996\/albums/, { data: [{ title: 'Beat Library II' }, { title: 'Money Answer' }] }],
    ]);
    assert.equal(await deezerArtist(['Snow Man'], { knownTitles: ['ブラザービート', 'THE BEST 2020 - 2025'] }), null);
    /* 인기곡이 있는데 안 겹치면 앨범으로 넘어가지 않는다(대조 기준을 느슨하게 만들지 않는다) */
    calls.length = 0;
    globalThis.fetch = dz([
      [/search\/artist/, { data: [{ id: 7, name: 'HANA', nb_fan: 9000, picture_xl: 'https://cdn-images.dzcdn.net/images/artist/h/1000x1000.jpg' }] }],
      [/artist\/7\/top/, { data: [{ title: 'Other Song' }] }],
    ]);
    assert.equal(await deezerArtist(['HANA'], { knownTitles: ['Blue Jeans'] }), null);
    assert.ok(!calls.some((u) => /albums/.test(u)));
    offline();
  });

  await test('사진 작업: 예전 규칙의 "없음"을 다시 보고, 결과를 남기고, 확인된 사진은 대조 실패로 지우지 않는다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lilac-media-'));
    try {
      initCache(dir);
      await mkdir(path.join(dir, 'live-cache'), { recursive: true });
      const hourAgo = Date.now() - 3600e3;
      await writeFile(path.join(dir, 'live-cache', 'kv-photos.json'), JSON.stringify({
        'm-lk': { photo: null, medium: null, fans: null, at: hourAgo },                 // v1 규칙으로 '없음' — 예전 코드는 하루 동안 건너뛴다
        'snow-man': { photo: null, medium: null, fans: null, at: hourAgo, v: 2 },       // 새 규칙으로 이미 '없음' — 하루 안엔 다시 안 본다
        'vaundy': { photo: 'https://cdn-images.dzcdn.net/images/artist/v/1000x1000.jpg', medium: 'https://cdn-images.dzcdn.net/images/artist/v/500x500.jpg', fans: 1, at: Date.now() - 15 * 24 * 3600e3 },
      }));
      const artists = [
        { id: 'm-lk', name: 'M!LK', nameOriginal: 'M!LK', country: 'jp', appleArtistId: 1356706755, chartHits: 12 },
        { id: 'snow-man', name: 'Snow Man', nameOriginal: 'Snow Man', country: 'jp', appleArtistId: 2, chartHits: 1 },
        { id: 'vaundy', name: 'Vaundy', nameOriginal: 'Vaundy', country: 'jp', appleArtistId: 3, chartHits: 30 },
      ];
      const catalog = { artists: { 'm-lk': { tracks: [{ title: '爆裂愛してる', album: 'LOVE ENG!NE' }] }, vaundy: { tracks: [{ title: '怪獣の花唄', album: 'strobo' }] } } };
      const readJson = async (k, fallback) => (k === 'artists' ? artists : k === 'catalog' ? catalog : fallback);
      const api = createLiveService({ dbDir: dir, readJson, getCharts: async () => ({}) });
      const asked = [];
      globalThis.fetch = async (u) => {
        const s = String(u); asked.push(s);
        if (/search\/artist\?q=M!LK|search\/artist\?q=M%21LK/.test(s)) return json({ data: [{ id: 14307405, name: 'M!LK', nb_fan: 425, picture_xl: 'https://cdn-images.dzcdn.net/images/artist/165a/1000x1000.jpg', picture_big: 'https://cdn-images.dzcdn.net/images/artist/165a/500x500.jpg' }] });
        if (/artist\/14307405\/top/.test(s)) return json({ data: [] });
        if (/artist\/14307405\/albums/.test(s)) return json({ data: [{ title: 'LOVE ENG!NE' }] });
        if (/search\/artist\?q=Vaundy/.test(s)) return json({ error: { code: 4, message: 'Quota limit exceeded' } });
        throw Error(`unexpected ${s}`);
      };
      try {
        const st = await api.fillPhotos(40, { pauseMs: 0 });
        assert.ok(st && typeof st === 'object', '예전 fillPhotos 는 아무것도 돌려주지 않았다(상태 화면 lastResult 없음)');
        assert.equal(st.checked, 2, JSON.stringify(st));        // m-lk(규칙 변경) + vaundy(14일 지남)
        assert.equal(st.found, 1); assert.equal(st.failed, 1); assert.equal(st.fresh, 1);
        assert.ok(!asked.some((u) => /Snow/.test(u)), '새 규칙의 최근 "없음"은 다시 묻지 않는다');
        const out = await api.artists({ edition: 'kr' });
        const by = Object.fromEntries(out.items.map((a) => [a.id, a]));
        assert.equal(by['m-lk'].photo, 'https://cdn-images.dzcdn.net/images/artist/165a/500x500.jpg');
        assert.equal(by.vaundy.photo, 'https://cdn-images.dzcdn.net/images/artist/v/500x500.jpg', '쿼터 실패로 확인된 사진을 지우지 않는다');
        assert.equal(by['snow-man'].photo, null, '모르는 사진은 지어내지 않는다');
      } finally { api.dispose(); offline(); }
    } finally {
      await new Promise((r) => setTimeout(r, 1700));   // KV flush 타이머가 끝난 뒤 지운다
      await rm(dir, { recursive: true, force: true });
    }
  });

  await test('발매 일정: 자동 동기화되는 릴리스에서 만들고, 발매일 없는 것은 만들지 않는다', () => {
    const rows = releaseEventsFrom([
      { id: 'ap-6805447309', artist: 'imase', artistKo: 'imase', artistId: 'imase', title: 'Hatena', country: 'jp', releaseDate: '2026-10-02', artwork: 'https://is1-ssl.mzstatic.com/a.jpg', appleUrl: 'https://music.apple.com/jp/album/hatena/6805447309?uo=4', trackCount: 8, source: { name: 'Apple iTunes API' } },
      { id: 'curated-1', artist: 'X', title: 'No date', releaseDate: null },
      { id: 'curated-2', artist: 'Y', title: 'Single', releaseDate: '2026-11-05', appleUrl: 'https://music.apple.com/jp/album/single/123456' },
    ]);
    assert.deepEqual(rows.map((r) => [r.id, r.date, r.type]), [['rel-6805447309', '2026-10-02', '발매'], ['rel-123456', '2026-11-05', '발매']]);
    assert.equal(rows[0].isDemo, false); assert.equal(rows[0].source, 'Apple iTunes API');
  });
} finally {
  globalThis.fetch = realFetch;
}
console.log(`\n${passed} passed, 0 failed`);
