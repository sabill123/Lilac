import { concertsInCountry } from './geography.mjs';
import { fetchArtwork, validateArtworkUrl } from './image-proxy.mjs';
import { attachStream } from './stream.mjs';
import { exposeMembership, matchesMembershipOwner } from './membership-policy.mjs';
/* 실시간 팬덤 정보 API — 에디션(한국·J-POP / 일본·K-POP / 전체)별로 공연·티켓·뉴스·굿즈·아티스트를 묶는다.
 *
 * 에디션 정의
 *   kr  = Lilac 코리아: 한국에 사는 J-POP 팬.  내한(일본 아티스트의 한국 공연) · 원정(일본 현지 공연) · 일본반 구매 · 한국어 뉴스
 *   jp  = Lilac 재팬:   일본에 사는 K-POP 팬.  来日(K-POP 일본 공연) · 渡韓(한국 현지 공연) · 한국반 구매 · 일본어 뉴스
 *   all = 두 방향 모두
 *
 * 모든 목록은 예매처·판매처·뉴스 원문에서 실시간으로 가져오며 cache.mjs 규칙(TTL + stale-while-revalidate + 실패 시 이전 값 유지)을 따른다.
 */
import { cached, initCache, KV, peek, revalidate, cacheEvents } from './cache.mjs';
import { fetchKrConcerts, fetchKrTicketOpens } from './tickets-kr.mjs';
import { fetchJpConcerts, searchJpConcerts } from './tickets-jp.mjs';
import { searchGoods, STORES } from './goods.mjs';
import { newsFeed } from './news.mjs';
import { deezerArtist, wikiSummary, classifyOrigin, performerCandidates, koreanNamesFor, japaneseNamesFor, checkAppleIdentity, koreanNameFits } from './artist-info.mjs';
import { todayKst } from './http.mjs';
import { fanclubFor, searchFanclub, fanclubFacts, searchEngine } from './fanclub.mjs';
import { eventPoster, ogImage } from './posters.mjs';
import { krFestivals, eplusFestivals, jpFestivals, groupFestivals, melonLineup, eplusLineup, melonNation, melonArtistResults, melonExactMatches, melonAgency, nameSearchNation, eplusOfficialSite, findFestivalSite } from './festivals.mjs';
import { fetchText } from './http.mjs';
import { concertDetail, PROVIDER_GUIDE } from './detail.mjs';
import { createHash } from 'node:crypto';

const MIN = 60e3;
const HOUR = 60 * MIN;
const JP_GENRE = /^(j-pop|j-rock|アニメ|anime|歌謡曲|演歌|enka|일본 만화 영화|ボーカロイド|vocaloid)/i;
const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s.・·'’"“”!?&＆_-]/g, '');

export function createLiveService({ dbDir, readJson, writeJson = null, rosterLock = null, getCharts }) {
  initCache(dbDir);
  const origins = new KV('origins');
  const photos = new KV('photos');
  const namePhotos = new KV('name-photos');
  const koNames = new KV('ko-names');
  const jaNames = new KV('ja-names');
  const fcClicks = new KV('fc-referrals');
  const fcSearch = new KV('fc-search');
  const appleCheck = new KV('apple-check');
  /* 공연 상세 페이지 대표 이미지(e+·팬클럽 투어 페이지 og:image) */
  const eventPosters = new KV('event-posters');
  const festLineups = new KV('fest-lineups');
  const melonNations = new KV('melon-nation');
  const melonByName = new KV('melon-name');
  const festSites = new KV('fest-sites');
  eventPosters.ready().catch(() => {});
  const posterQueue = [];
  let posterWorking = false;
  const siteOg = new Map();
  /* 페스티벌 공식 사이트 첫 화면: 사이트 공통 이미지가 곧 그 페스티벌 이미지다(비교 없이 받는다) */
  const officialUrls = new Set();
  const posterHost = (it) => { try { const h = new URL(it.url).host; return it.provider === 'fanclub' || /(^|\.)eplus\.jp$/.test(h) ? h : null; } catch { return null; } };
  function eventPosterOf(it) {
    if (!it?.url || it.posterKind === 'official' || !eventPosters.map || !posterHost(it)) return null;
    const v = eventPosters.get(it.url);
    if (v?.img && !/webclip|no_thumb|daitai|noimage/i.test(v.img)) return { poster: v.img, posterKind: 'event' };
    const stale = !v || Date.now() - v.at > (v.none ? 24 : 7 * 24) * 3600e3;
    if (stale && !posterQueue.includes(it.url) && posterQueue.length < 300) { posterQueue.push(it.url); pumpPosters().catch(() => {}); }
    return null;
  }
  async function pumpPosters() {
    if (posterWorking) return;
    posterWorking = true;
    try {
      await eventPosters.ready();
      const siteImage = async (origin) => { if (!siteOg.has(origin)) siteOg.set(origin, fetchText(`${origin}/`, { timeout: 9000, retries: 0, headers: { 'Accept-Language': 'ja' } }).then((h) => ogImage(h, origin)).catch(() => undefined)); return siteOg.get(origin); };
      while (posterQueue.length) {
        const url = posterQueue.shift();
        const r = await eventPoster(url, officialUrls.has(url) ? { body: false } : { siteImage, body: !/eplus\.jp/.test(url) });
        if (r?.img) {
          /* 서로 다른 공연 페이지 셋 이상이 같은 이미지를 주면 사이트 공통 이미지다(e+ webclip.png) — 모두 없음으로 */
          const same = [...eventPosters.map.entries()].filter(([u, v]) => v?.img === r.img && u !== url);
          if (same.length >= 2) { for (const [u] of same) eventPosters.set(u, { none: true, at: Date.now() }); eventPosters.set(url, { none: true, at: Date.now() }); }
          else eventPosters.set(url, { ...r, at: Date.now() });
        } else if (r) eventPosters.set(url, { ...r, at: Date.now() }); /* 받기 실패(null)는 저장하지 않는다 */
        await new Promise((res) => setTimeout(res, 400));
      }
    } finally { posterWorking = false; }
  }
  const photoQueue = [];
  let photoWorking = false;
  async function pumpPhotos() {
    if (photoWorking) return;
    photoWorking = true;
    try {
      while (photoQueue.length) {
        const n = photoQueue.shift();
        const had = namePhotos.get(norm(n));
        if (had && (had.photo || had.v === 2)) continue;
        const d = await deezerArtist([n]).catch(() => undefined);
        let photo = d?.pictureMedium || null;
        /* 디저에 없으면(한국 인디·팬미팅 출연자 등) 멜론에서 이름이 정확히 같은 아티스트의 프로필 사진 */
        if (!photo) {
          try {
            const hits = melonExactMatches(n, melonArtistResults(await fetchText(`https://www.melon.com/search/artist/index.htm?q=${encodeURIComponent(n)}`, { timeout: 9000, retries: 1 })));
            if (hits.length === 1) {
              const html = await fetchText(`https://www.melon.com/artist/detail.htm?artistId=${hits[0].id}`, { timeout: 9000, retries: 1 });
              const og = ogImage(html, 'https://www.melon.com/');
              if (og && !/default|noimage|no_img|blank/i.test(og)) photo = og;
            }
          } catch { /* 다음에 */ }
        }
        if (d !== undefined || photo) namePhotos.set(norm(n), { photo, v: 2, at: Date.now() });
        await new Promise((r) => setTimeout(r, 200));
      }
    } finally { photoWorking = false; }
  }
  const queue = [];
  const queued = new Set();
  let working = false;
  let classifiedVersion = 0;

  /* ---------- 아티스트 목록 ---------- */
  let rosterCache = null;
  let rosterAt = 0;
  async function roster() {
    if (rosterCache && Date.now() - rosterAt < 5 * MIN) return rosterCache;
    const raw = (await readJson('artists', [])) || [];
    await koNames.ready();
    await jaNames.ready();
    const seen = new Set();
    const out = [];
    /* 같은 Apple 아티스트가 이름만 달리 여러 번 들어 있다(米津玄師 / 요네즈 켄시). 하나로 합친다 */
    const byApple = new Map();
    for (const a of raw) {
      const k = a.appleArtistId ? `apple:${a.appleArtistId}` : `name:${norm(a.nameOriginal || a.name)}`;
      let prev = byApple.get(k);
      if (!prev) { byApple.set(k, { ...a, aliases: [...(a.aliases || [])] }); continue; }
      /* 같은 Apple ID인데 대표 이름(name·nameOriginal·nameJa)이 겹치지 않으면 한쪽이 잘못 수집된 행이다
         (星野源 행에 aespa의 Apple ID·별칭이 붙어 있었다). 차트 기록이 적은 쪽을 버린다 — 틀린 사진·곡을 보여주지 않게. */
      const prim = (x) => [x.name, x.nameOriginal, x.nameJa].filter(Boolean).map(norm);
      if (!prim(prev).some((n) => prim(a).includes(n))) {
        // 이름과 검색어가 일치하는 행이 제대로 수집된 행이다 (青木遥 행의 검색어는 BTS였다)
        const ok = (x) => prim(x).includes(norm(x.searchTerm));
        const better = ok(a) !== ok(prev) ? ok(a) : (a.chartHits || 0) > (prev.chartHits || 0);
        if (better) byApple.set(k, { ...a, aliases: [...(a.aliases || [])] });
        continue;
      }
      const keep = (a.chartHits || 0) > (prev.chartHits || 0) || (!prev.links && a.links) ? { ...a, aliases: [...(a.aliases || [])] } : prev;
      const other = keep === prev ? a : prev;
      keep.aliases = [...new Set([...(keep.aliases || []), ...(other.aliases || []), other.name, other.nameOriginal, other.nameJa].filter(Boolean))];
      keep.links = keep.links || other.links;
      keep.artwork = keep.artwork || other.artwork;
      keep.chartHits = Math.max(keep.chartHits || 0, other.chartHits || 0);
      keep.mergedIds = [...new Set([...(prev.mergedIds || [prev.id]), a.id])];
      byApple.set(k, keep);
    }
    for (const a of byApple.values()) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      let origin = a.country;
      if (JP_GENRE.test(a.appleGenre || '')) origin = 'jp';
      else if (/^k-pop$/i.test(a.appleGenre || '')) origin = 'kr';
      else if (/[぀-ヿ一-龯]/.test(a.nameOriginal || a.name) && !/[가-힣]/.test(a.nameOriginal || a.name)) origin = 'jp';
      /* 소리가 안 맞는 한국어 표기(SixTONES → 스톤즈)는 버린다 */
      const latinOf = [a.nameOriginal, a.name, a.appleArtistId ? a.searchTerm : null].filter((n) => n && /[A-Za-z]/.test(n));
      const ko = (koNames.get(a.id)?.names || []).filter((k) => koreanNameFits(k, latinOf));
      const names = [...new Set([a.name, a.nameOriginal, a.nameJa, ...(a.aliases || []), ...ko].filter(Boolean))];
      /* 한국 아티스트의 일본어 표기(위키백과 일본어판 제목) — 일본어 화면에서 한글 대신 */
      /* 일본어판 위키백과가 없으면 신원 확인을 거친 Apple 로마자 표기(HANRORO, TUIDE)를 일본어 화면 이름으로 — 한글만 보이지 않게 */
      const appleLatin = a.appleArtistId && a.appleFix?.status !== 'none' && /[A-Za-z]/.test(a.searchTerm || '') && !/[가-힣]/.test(a.searchTerm || '') ? a.searchTerm : null;
      const jaName = a.nameJa || jaNames.get(a.id)?.name || (/[가-힣]/.test(a.name || '') ? appleLatin : null) || null;
      out.push({ ...a, origin, names: jaName && !names.includes(jaName) ? [...names, jaName] : names, nameJa: jaName, nameKo: ko[0] || (/[가-힣]/.test(a.name) ? a.name : null) });
    }
    rosterCache = out;
    rosterAt = Date.now();
    return out;
  }

  function rosterMatch(list, name) {
    const k = norm(name);
    if (!k || k.length < 2) return null;
    return list.find((a) => a.names.some((n) => norm(n) === k)) || null;
  }

  /* ---------- 출신국 판정 큐 ---------- */
  async function pump() {
    if (working) return;
    working = true;
    await origins.ready();
    const list = await roster();
    try {
      while (queue.length) {
        const name = queue.shift();
        queued.delete(name);
        const prev = origins.get(norm(name));
        if (prev && !prev.retry && Date.now() - prev.at < (prev.origin === 'unknown' ? 3 : 30) * 24 * HOUR) continue;
        const r = await classifyOrigin(name, { roster: list }).catch((e) => ({ origin: 'unknown', source: 'error', retry: true, error: String(e.message || e) }));
        if (!r.retry) origins.set(norm(name), { ...r, name, at: Date.now() });
        classifiedVersion++;
        await new Promise((res) => setTimeout(res, 250));
      }
    } finally {
      working = false;
    }
  }

  function enqueue(name, priority = false) {
    const k = norm(name);
    if (!k || origins.get(k)) return;
    if (queued.has(name)) {
      if (priority) { const i = queue.indexOf(name); if (i > 0) { queue.splice(i, 1); queue.unshift(name); } }
      return;
    }
    queued.add(name);
    if (priority) queue.unshift(name); else queue.push(name);
  }

  /* 공연 목록에 출연자·출신국·아티스트 id를 붙인다 (캐시된 판정만 즉시 반영, 나머지는 큐에 넣는다) */
  async function annotate(items, { classify = true, limitQueue = 200, priority = false } = {}) {
    await origins.ready();
    await photos.ready();
    await namePhotos.ready();
    items = items.filter((x) => x.kind !== 'other');
    const list = await roster();
    let queuedNow = 0;
    const out = items.map((it) => {
      const cands = performerCandidates(it.title);
      let performer = cands[0] || null;
      let origin = null;
      let originSource = null;
      let originGenre = null;
      let artistId = null;
      for (const c of cands) {
        const r = rosterMatch(list, c);
        if (r) { artistId = r.id; performer = r.name; }
        const hit = origins.get(norm(c));
        if (hit && hit.origin === 'unknown' && !origin) { origin = 'unknown'; originSource = hit.source; continue; }
        if (hit && hit.origin !== 'unknown') {
          origin = hit.origin; originSource = hit.source; originGenre = hit.genre || null; performer = performer || c;
          if (!r) performer = c;
          break;
        }
        if (r && r.origin && !origin) { origin = r.origin; originSource = 'roster'; }
      }
      if (!origin && classify && queuedNow < limitQueue) {
        for (const c of [...cands].reverse()) { enqueue(c, priority); }
        queuedNow++;
      }
      let poster = it.poster;
      let posterKind = poster ? 'official' : null;
      if (!poster && artistId) {
        const ph = photos.get(artistId);
        const ra = list.find((x) => x.id === artistId);
        poster = ph?.medium || ph?.photo || ra?.artwork || null;
        posterKind = poster ? 'artist' : null;
      }
      if (!poster && performer && /[A-Za-z぀-ヿ一-龯가-힣]/.test(performer)) {
        const np = namePhotos.get(norm(performer));
        if (np?.photo) { poster = np.photo; posterKind = 'artist'; }
        else if ((!np || (!np.photo && np.v !== 2)) && !photoQueue.includes(performer)) photoQueue.push(performer);
      }
      return { ...it, poster, posterKind, performer, artistId, origin: origin || 'pending', originSource, originGenre };
    });
    if (queue.length) pump().catch(() => {});
    if (photoQueue.length) pumpPhotos().catch(() => {});
    return out;
  }

  /* 표시용 한국어 이름 */
  function withKo(it) {
    const a = it.artistId && rosterCache ? rosterCache.find((x) => x.id === it.artistId) : null;
    const ko = a?.nameKo && a.nameKo !== it.performer ? { ...it, performerKo: a.nameKo } : it;
    const ep = eventPosterOf(ko);
    return ep ? { ...ko, ...ep } : ko;
  }

  /* 같은 투어(같은 예매처·같은 공연명)의 날짜별 목록을 하나로 묶는다 */
  function groupTours(items, { byWindow = false } = {}) {
    const map = new Map();
    const out = [];
    for (const it of items) {
      const k = [it.provider, norm(it.title), it.direction || '', byWindow ? `${it.ticketOpenLabel || it.saleType || ''}|${it.closesAt || it.ticketOpenAt || ''}` : ''].join('|');
      const g = map.get(k);
      const show = { date: it.startDate, endDate: it.endDate, venue: it.venue, city: it.city, url: it.url, status: it.status };
      if (!g) {
        const row = { ...it, shows: [show] };
        map.set(k, row);
        out.push(row);
        continue;
      }
      g.shows.push(show);
      if (it.startDate && (!g.startDate || it.startDate < g.startDate)) g.startDate = it.startDate;
      const e = it.endDate || it.startDate;
      if (e && (!g.endDate || e > g.endDate)) g.endDate = e;
      if (!g.poster && it.poster) { g.poster = it.poster; g.posterKind = it.posterKind; }
    }
    const RANK = { onsale: 0, upcoming: 1, soldout: 2, closed: 3, unknown: 4 };
    for (const g of out) {
      g.showCount = g.shows.length;
      g.status = g.shows.map((x) => x.status || 'unknown').sort((a, b) => (RANK[a] ?? 5) - (RANK[b] ?? 5))[0] || g.status;
      const venues = [...new Set(g.shows.map((x) => x.venue).filter(Boolean))];
      g.venueCount = venues.length;
      if (venues.length > 1) g.venue = venues[0];
      g.shows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    }
    return out;
  }

  /* 일본 K-POP 팬에게 보여줄 한국 현지 공연 — K-POP이라는 근거가 있는 것만 */
  const isKpop = (x) => x.origin === 'kr' && x.country !== 'JP' && (
    (x.artistId && x.originSource?.startsWith('roster')) || x.originSource === 'roster' ||
    (x.originSource === 'itunes-genre' && /^k-pop$/i.test(x.originGenre || '')) ||
    (x.originSource === 'musicbrainz' && /^[A-Za-z0-9 &.'!:-]+$/.test(x.performer || '') && x.performer !== x.title));

  const upcomingOnly = (items) => {
    const today = todayKst();
    return items.filter((x) => !x.endDate || x.endDate >= today || (x.startDate && x.startDate >= today));
  };

  /* ---------- 원천 캐시 ---------- */
  /* 원천 수집 함수 — 요청 경로(cached)와 백그라운드 동기화(revalidate)가 같은 걸 쓴다 */
  const SRC_FN = {
    'kr-visiting': () => fetchKrConcerts({ category: 'visiting' }),
    'kr-domestic': () => fetchKrConcerts({ category: 'kpop' }),
    'kr-opens': () => fetchKrTicketOpens(),
    'jp-kpop': () => fetchJpConcerts({ category: 'kpop' }),
  };
  const src = {
    krVisiting: () => cached('kr-visiting', 60 * MIN, SRC_FN['kr-visiting'], { budgetMs: 12000 }),
    krDomestic: () => cached('kr-domestic', 90 * MIN, SRC_FN['kr-domestic'], { budgetMs: 15000 }),
    krOpens: () => cached('kr-opens', 30 * MIN, SRC_FN['kr-opens'], { budgetMs: 10000 }),
    jpKpop: () => cached('jp-kpop', 60 * MIN, SRC_FN['jp-kpop'], { budgetMs: 15000 }),
    eplusFor: (names) => cached(`eplus-search-${names.map(norm).join('_').slice(0, 80)}`, 3 * HOUR, () => searchJpConcerts(names), { budgetMs: 15000 }),
  };

  async function topArtists(origin, n = 12) {
    const list = await roster();
    const charts = await getCharts().catch(() => null);
    const country = origin === 'jp' ? 'jp' : 'kr';
    const combined = charts?.countries?.[country]?.combined || [];
    const order = [];
    for (const row of combined) {
      const r = rosterMatch(list, row.artist);
      if (r && r.origin === origin && !order.includes(r)) order.push(r);
      if (order.length >= n) break;
    }
    for (const a of list.filter((x) => x.origin === origin).sort((a, b) => (b.chartHits || 0) - (a.chartHits || 0))) {
      if (order.length >= n) break;
      if (!order.includes(a)) order.push(a);
    }
    return order.slice(0, n);
  }

  /* 원정(일본 현지) — 인기 일본 아티스트 이름으로 e+ 검색, 제목에 이름이 실제로 들어간 공연만 */
  async function jpAbroad() {
    await photos.ready();
    const artists = await topArtists('jp', 10);
    const names = artists.map((a) => /[A-Za-z぀-ヿ一-龯]/.test(a.nameOriginal || '') ? a.nameOriginal : a.name).filter(Boolean);
    const r = await src.eplusFor(names);
    const list = await roster();
    const items = concertsInCountry(r.items || [], 'JP').filter((it) => names.some((n) => norm(it.title).includes(norm(n))))
      .map((it) => {
        const a = artists.find((x) => [x.name, x.nameOriginal, x.nameJa].some((n) => n && norm(it.title).includes(norm(n))));
        const ph = a ? photos.get(a.id) : null;
        return { ...it, poster: it.poster || ph?.medium || a?.artwork || null, posterKind: it.poster ? 'official' : 'artist', performer: a?.name || it.title, artistId: a?.id || null, origin: 'jp', originSource: 'search-artist' };
      });
    void list;
    return { ...r, items };
  }

  /* 来日 티켓 일정 — 인기 K-POP 아티스트 이름으로 e+ 검색 (판매 시작 시각 포함) */
  async function krArtistsInJapanSales() {
    await photos.ready();
    const artists = await topArtists('kr', 10);
    const names = artists.map((a) => /[A-Za-z]/.test(a.nameOriginal || a.name) ? (a.nameOriginal || a.name) : (a.aliases || []).find((x) => /[A-Za-z]/.test(x)) || a.name);
    const r = await src.eplusFor(names);
    const items = concertsInCountry(r.items || [], 'JP').filter((it) => names.some((n) => norm(it.title).includes(norm(n))))
      .map((it) => {
        const a = artists.find((x) => [x.name, x.nameOriginal, ...(x.aliases || [])].some((n) => n && norm(it.title).includes(norm(n))));
        const ph = a ? photos.get(a.id) : null;
        return { ...it, poster: it.poster || ph?.medium || a?.artwork || null, posterKind: it.poster ? 'official' : 'artist', performer: a?.name || it.title, artistId: a?.id || null, origin: 'kr', originSource: 'search-artist' };
      });
    return { ...r, items };
  }

  /* ---------- 공연 ---------- */
  async function concerts({ edition = 'kr', scope = 'visiting', origin = 'default' } = {}) {
    const parts = [];
    const meta = [];
    const want = (e, s) => (edition === e || edition === 'all') && (scope === s || scope === 'all');

    if (want('kr', 'visiting')) {
      const r = await src.krVisiting();
      let items = await annotate(upcomingOnly(concertsInCountry(r.items || [], 'KR')), { priority: true });
      const total = items.length;
      const pendingItems = items.filter((x) => x.origin === 'pending' || x.origin === 'unknown');
      if (origin !== 'all') items = items.filter((x) => x.origin === 'jp');
      if (origin !== 'all' && pendingItems.length) parts.push(...pendingItems.map((x) => ({ ...x, direction: 'kr-visiting', unconfirmed: true })));
      parts.push(...items.map((x) => ({ ...x, direction: 'kr-visiting' })));
      meta.push({ key: 'kr-visiting', label: '내한', total, shown: items.length, pending: items.length === 0 && total > 0 ? total : 0, cache: r.cache, sources: r.sources });
    }
    if (want('kr', 'abroad')) {
      const r = await jpAbroad();
      const items = upcomingOnly(r.items || []);
      parts.push(...items.map((x) => ({ ...x, direction: 'kr-abroad' })));
      meta.push({ key: 'kr-abroad', label: '원정(일본 현지)', total: items.length, shown: items.length, cache: r.cache, sources: r.sources });
    }
    if (want('jp', 'visiting')) {
      const r = await src.jpKpop();
      const items = await annotate(upcomingOnly(concertsInCountry(r.items || [], 'JP')), { classify: false });
      parts.push(...items.map((x) => ({ ...x, origin: 'kr', direction: 'jp-visiting' })));
      meta.push({ key: 'jp-visiting', label: '来日', total: items.length, shown: items.length, cache: r.cache, sources: r.sources });
    }
    if (want('jp', 'abroad')) {
      const r = await src.krDomestic();
      const up = upcomingOnly(concertsInCountry(r.items || [], 'KR'));
      let items = await annotate(up, { limitQueue: 80 });
      const total = items.length;
      items = items.filter(isKpop);
      parts.push(...items.map((x) => ({ ...x, direction: 'jp-abroad' })));
      meta.push({ key: 'jp-abroad', label: '渡韓(한국 현지)', total, shown: items.length, cache: r.cache, sources: r.sources });
    }
    {
      // 팬클럽 선행·전용 공연: 예매처 목록에 없더라도 보여 준다. 방향은 공연장 나라로 정했다.
      const fcf = await fanclubFeed({ edition });
      const want = edition === 'kr'
        ? (scope === 'visiting' ? ['kr-visiting'] : scope === 'abroad' ? ['kr-abroad'] : ['kr-visiting', 'kr-abroad'])
        : edition === 'jp'
          ? (scope === 'visiting' ? ['jp-visiting'] : scope === 'abroad' ? [] : ['jp-visiting'])
          : ['kr-visiting', 'kr-abroad', 'jp-visiting'];
      const tours = fcf.tours.filter((t) => want.includes(t.direction));
      parts.push(...tours);
      meta.push({ key: 'fanclub', label: '팬클럽 선행·전용', total: tours.length, shown: tours.length });
    }
    const grouped = [...groupTours(parts.filter((x) => x.provider !== 'fanclub')), ...parts.filter((x) => x.provider === 'fanclub')];
    grouped.sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999'));
    return { items: grouped.map(withKo), groups: meta, classifying: queue.length, fetchedAt: new Date().toISOString() };
  }

  /* 판매 창: 앞으로 열리거나(오픈 예정) 지금 열려 있고 마감이 남은(접수 중) 것 */
  function saleWindow(x, now) {
    const sched = x.openSchedule || [];
    const nextOpen = [x.ticketOpenAt, ...sched.map((s) => s.at)].filter((a) => a && Date.parse(a) > now - 3 * HOUR).sort()[0] || null;
    const openNow = sched.find((s) => (!s.at || Date.parse(s.at) <= now) && s.endAt && Date.parse(s.endAt) > now) || null;
    if (!nextOpen && !(openNow && x.status === 'onsale')) return null;
    return { sortAt: nextOpen || openNow.endAt, closesAt: openNow?.endAt || null, opensAt: nextOpen };
  }

  /* ---------- 티켓 오픈 ---------- */
  async function tickets({ edition = 'kr', origin = 'default' } = {}) {
    const now = Date.now();
    const items = [];
    const groups = [];
    if (edition === 'kr' || edition === 'all') {
      const [opens, visiting] = await Promise.all([src.krOpens(), src.krVisiting()]);
      const pool = concertsInCountry([...(opens.items || []), ...(visiting.items || []).filter((x) => x.ticketOpenAt)], 'KR');
      let list = (await annotate(pool, { priority: true })).filter((x) => (x.ticketOpenAt && Date.parse(x.ticketOpenAt) > now - 3 * HOUR) || x.openTba);
      const total = list.length;
      if (origin !== 'all') list = list.filter((x) => x.origin === 'jp');
      items.push(...list.map((x) => ({ ...x, direction: 'kr-visiting' })));
      groups.push({ key: 'kr', total, shown: list.length, cache: opens.cache, sources: opens.sources });
      // 일본 원정: 인기 일본 아티스트 공연의 선행·抽選·일반 판매 창
      const ab = await jpAbroad();
      const win = (ab.items || []).map((x) => ({ x, w: saleWindow(x, now) })).filter((y) => y.w);
      items.push(...win.map(({ x, w }) => ({ ...x, direction: 'kr-abroad', saleSortAt: w.sortAt, closesAt: w.closesAt })));
      groups.push({ key: 'kr-abroad', total: win.length, shown: win.length, cache: ab.cache, sources: ab.sources });
    }
    if (edition === 'jp' || edition === 'all') {
      const r = await krArtistsInJapanSales();
      const list = (r.items || []).map((x) => ({ x, w: saleWindow(x, now) })).filter((y) => y.w).map(({ x, w }) => ({ ...x, saleSortAt: w.sortAt, closesAt: w.closesAt }));
      items.push(...list.map((x) => ({ ...x, direction: 'jp-visiting' })));
      const opens = await src.krOpens();
      const kr = (await annotate(concertsInCountry(opens.items || [], 'KR'))).filter((x) => isKpop(x) && x.ticketOpenAt && Date.parse(x.ticketOpenAt) > now - 3 * HOUR);
      items.push(...kr.map((x) => ({ ...x, direction: 'jp-abroad' })));
      groups.push({ key: 'jp', total: list.length + kr.length, shown: list.length + kr.length, cache: r.cache, sources: r.sources });
    }
    const fcf = await fanclubFeed({ edition });
    items.push(...fcf.windows);
    const seen = new Set();
    const dedup = items.filter((x) => (seen.has(x.id) ? false : seen.add(x.id)));
    const key = (x) => x.saleSortAt || x.ticketOpenAt || (x.openTba ? '9998' : '9999');
    // 같은 투어의 판매 창(회차별 선착·추첨)을 한 줄로: 가장 이른 창을 대표로, 나머지는 windows 로
    dedup.sort((a, b) => key(a).localeCompare(key(b)));
    // 팬클럽 접수는 창마다 조건(해외 거주자·동행자·일반)이 달라 합치지 않는다
    const grouped = [...groupTours(dedup.filter((x) => x.provider !== 'fanclub')), ...dedup.filter((x) => x.provider === 'fanclub')];
    for (const g of grouped) {
      if (g.provider === 'fanclub') continue;
      const members = dedup.filter((x) => x.provider === g.provider && norm(x.title) === norm(g.title) && (x.direction || '') === (g.direction || ''));
      g.windows = members.map((x) => ({ label: x.ticketOpenLabel || x.saleType || null, opensAt: x.ticketOpenAt || null, closesAt: x.closesAt || null, date: x.startDate, venue: x.venue, url: x.url })).slice(0, 20);
      g.windowCount = members.length;
    }
    grouped.sort((a, b) => key(a).localeCompare(key(b)));
    return { items: grouped.map(withKo), groups, fetchedAt: new Date().toISOString() };
  }

  /* ---------- 뉴스 ---------- */
  async function news({ edition = 'kr', artist = null, force = false } = {}) {
    const list = await roster();
    const lang = edition === 'jp' ? 'ja' : 'ko';
    if (artist) {
      const a = list.find((x) => x.id === artist || (x.mergedIds || []).includes(artist)) || null;
      const name = a ? a.name : artist;
      const alt = a ? [...(lang === 'ko' && a.nameKo ? [a.nameKo] : []), a.nameOriginal, a.nameJa, ...(a.aliases || [])].filter((x, i, arr) => x && norm(x) !== norm(name) && arr.indexOf(x) === i) : [];
      const q = [name, ...alt.slice(0, 2)].map((n) => `"${n}"`).join(' OR ');
      const key = `news-artist-${lang}-${norm(name)}`;
      const who = a ? [{ id: a.id, names: a.names }] : [{ id: artist, names: [artist] }];
      const script = lang === 'ko' ? /[가-힣]/ : /[぀-ヿ一-龯]/;
      return cached(key, 30 * MIN, () => newsFeed([q], { lang, artists: who, keep: (x) => x.artistIds.length > 0 && script.test(x.title) && !/Weverse/.test(x.source || '') }), { budgetMs: 8000 });
    }
    const parts = [];
    const eds = edition === 'all' ? ['kr', 'jp'] : [edition];
    for (const ed of eds) {
      const l = ed === 'jp' ? 'ja' : 'ko';
      const focus = await topArtists(ed === 'kr' ? 'jp' : 'kr', 8);
      const names = focus.map((a) => (ed === 'kr' ? a.nameKo || a.name : a.nameOriginal && /[A-Za-z]/.test(a.nameOriginal) ? a.nameOriginal : a.name));
      const base = ed === 'kr'
        ? ['J팝 내한', '일본 가수 내한 공연', '일본 밴드 내한', 'J-POP 신곡']
        : ['K-POP 来日', '韓国アイドル 来日公演', 'K-POP カムバック', 'K-POP 日本デビュー'];
      const queries = [...base, names.slice(0, 4).map((n) => `"${n}"`).join(' OR '), names.slice(4, 8).map((n) => `"${n}"`).join(' OR ')].filter(Boolean);
      const pool = list.filter((a) => a.origin === (ed === 'kr' ? 'jp' : 'kr')).map((a) => ({ id: a.id, names: a.names }));
      const strong = ed === 'kr' ? /J-?팝|제이팝|J-?POP|일본\s?(가수|밴드|아이돌|그룹|싱어송라이터|뮤지션)|日\s?(가수|밴드|듀오|아이돌)/i : /K-?POP|韓流|韓国(の)?(アイドル|グループ|歌手)|ボーイズグループ|ガールズグループ/i;
      const script = ed === 'kr' ? /[가-힣]/ : /[぀-ヿ]/;
      const r = await cached(`news-${ed}`, force ? 0 : 30 * MIN, () => newsFeed(queries, { lang: l, artists: pool, keep: (x) => script.test(x.title) && !/Weverse|EBiDAN|恵比寿学園/.test(x.source || '') && (x.artistIds.length > 0 || strong.test(x.title)) }), { budgetMs: 10000 });
      parts.push({ ed, r });
    }
    if (parts.length === 1) return parts[0].r;
    const items = parts.flatMap((p) => (p.r.items || []).map((x) => ({ ...x, edition: p.ed }))).sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
    return { items, sources: parts.flatMap((p) => p.r.sources || []), cache: parts[0].r.cache };
  }

  /* ---------- 굿즈 ---------- */
  async function goods({ q, market = 'kr' }) {
    const query = String(q || '').trim().slice(0, 60);
    if (!query) return { items: [], sources: [], stores: STORES };
    const key = `goods-${market}-${norm(query)}`;
    /* 최근에 누가 본 굿즈 검색은 백그라운드에서 계속 새로 받는다(가격·재고·예약 상태) */
    recentGoods.set(key, { query, market, at: Date.now() });
    if (recentGoods.size > 200) recentGoods.delete(recentGoods.keys().next().value);
    return cached(key, 30 * MIN, () => searchGoods(query, { market }), { budgetMs: 12000 });
  }

  /* ---------- 아티스트 ---------- */
  async function artist({ id, name, edition = 'kr' }) {
    const list = await roster();
    const a = id ? list.find((x) => x.id === id || (x.mergedIds || []).includes(id)) : rosterMatch(list, name);
    const display = a?.name || name;
    if (!display) return null;
    const names = [...new Set(a ? [a.nameOriginal, a.name, a.nameJa, a.nameKo, ...(a.aliases || [])].filter(Boolean) : [name])];
    const lang = edition === 'jp' ? 'ja' : 'ko';
    const ckey = a ? `id-${a.id}` : `name-${norm(display)}`;
    const [photo, wiki, originR] = await Promise.all([
      cached(`deezer-${ckey}`, 7 * 24 * HOUR, async () => ({ items: [], photo: await deezerArtist([...new Set([...names.filter((n) => /[A-Za-z]/.test(n)), ...names])], { knownTitles: a ? await titlesFor(a.id) : null }), sources: [{ provider: 'deezer', ok: true }] }), { budgetMs: 3000 }),
      cached(`wiki-${lang}-${ckey}`, 7 * 24 * HOUR, async () => ({ items: [], wiki: await wikiSummary([...new Set([...(lang === 'ko' ? names.filter((n) => /[가-힣]/.test(n)) : []), ...names])], lang) || (lang !== 'en' ? await wikiSummary(names, 'en') : null), sources: [{ provider: 'wikipedia', ok: true }] }), { budgetMs: 3000 }),
      (async () => {
        await origins.ready();
        if (a?.origin) return { origin: a.origin, source: 'roster' };
        const hit = origins.get(norm(display));
        if (hit) return hit;
        return classifyOrigin(display, { roster: list }).catch(() => ({ origin: 'unknown' }));
      })(),
    ]);
    const origin = originR?.origin === 'kr-hangul' ? 'kr' : originR?.origin || 'unknown';

    // 공연: 캐시된 전체 목록에서 이 아티스트 것만
    const pools = await Promise.all([src.krVisiting(), src.jpKpop(), src.krDomestic()]);
    let shows = [];
    for (const p of pools) shows.push(...(p.items || []));
    shows = await annotate(upcomingOnly(shows), { classify: false });
    const keys = names.map(norm).filter((k) => k.length >= 2);
    shows = shows.filter((s) => (a && s.artistId === a.id) || keys.some((k) => norm(s.performer) === k || norm(s.title).includes(k)));
    try {
      const jpName = names.find((n) => /[A-Za-z぀-ヿ一-龯]/.test(n)) || display;
      const e = await cached(`eplus-search-${norm(jpName)}`, 3 * HOUR, () => searchJpConcerts([jpName]), { budgetMs: 2500 });
      shows.push(...(e.items || []).filter((s) => s.provider === 'pia' || norm(s.title).includes(norm(jpName))).map((s) => ({ ...s, performer: display, artistId: a?.id || null })));
    } catch { /* e+ 실패는 무시 */ }
    const seen = new Set();
    await photos.ready();
    const fallbackPoster = (a && (photos.get(a.id)?.medium || photos.get(a.id)?.photo)) || photo?.photo?.pictureMedium || a?.artwork || null;
    shows = groupTours(upcomingOnly(shows).filter((s) => (seen.has(s.id) ? false : seen.add(s.id)))).map((s) => (s.poster ? s : { ...s, poster: fallbackPoster, posterKind: fallbackPoster ? 'artist' : null })).sort((x, y) => (x.startDate || '9999').localeCompare(y.startDate || '9999'));

    let fanclub = null;
    if (a) {
      const fc = await fanclubRaw(a, { budgetMs: 4000 }).catch(() => null);
      if (fc?.found) {
        const it = fcItems(a, fc);
        fanclub = { name: fc.facts?.name || null, entry: fc.entry, home: fc.home, platform: fc.platform || fc.facts?.platform || null, facts: fc.facts || null, windows: it.windows.map(withKo), trades: it.trades.map(withKo), tours: it.tours.map(withKo), checkedAt: fc.checkedAt, cache: fc.cache, official: fc.official };
      } else if (fc) fanclub = { found: false, official: fc.official };

    }
    return {
      fanclub,
      id: a?.id || null,
      name: display,
      names,
      origin,
      originSource: originR?.source || null,
      genre: a?.appleGenre || a?.genre || null,
      appleArtistId: a?.appleArtistId || null,
      artwork: a?.artwork || null,
      photo: photo?.photo?.picture ? photo.photo : (a && photos.get(a.id)?.photo ? { picture: photos.get(a.id).photo } : null),
      wiki: wiki?.wiki || null,
      links: a?.links || null,
      official: a?.official || null,
      operator: a?.operator || null,
      concerts: shows.map(withKo),
      fetchedAt: new Date().toISOString(),
    };
  }

  /* ---------- 일본 아티스트의 한국어 표기 (위키백과 언어 링크) ---------- */
  async function fillJaNames() {
    await jaNames.ready();
    const list = await roster();
    const todo = list.filter((a) => a.origin === 'kr' && /[가-힣]/.test(a.name) && !a.nameJa && !(jaNames.get(a.id) && Date.now() - jaNames.get(a.id).at < 30 * 24 * HOUR));
    if (!todo.length) return;
    const got = await japaneseNamesFor(todo.map((a) => a.name));
    for (const a of todo) if (got.checked?.has(a.name)) jaNames.set(a.id, { name: got.get(a.name) || null, at: Date.now() });
    rosterCache = null;
  }

  async function fillKoNames() {
    await koNames.ready();
    const list = await roster();
    const todo = list.filter((a) => a.origin === 'jp' && !a.names.some((n) => /[가-힣]/.test(n)) && !(koNames.get(a.id) && Date.now() - koNames.get(a.id).at < 30 * 24 * HOUR));
    if (!todo.length) return;
    const titleOf = (a) => a.nameJa || a.nameOriginal || a.name;
    const got = await koreanNamesFor(todo.map(titleOf));
    for (const a of todo) if (got.checked?.has(titleOf(a))) koNames.set(a.id, { names: got.get(titleOf(a)) || [], at: Date.now() });
    rosterCache = null;
  }

  /* ---------- 로스터 신원 확인 ----------
     차트 이름으로 iTunes 첫 결과를 붙이던 예전 수집 때문에 틀린 Apple 아티스트가 붙은 행이 있다
     (로제 → Pascal Rogé, 星野源 → aespa, NewJeans → NCT DREAM). Apple 이름이 우리 이름과 다른 행만 골라
     위키백과 영어 이름·로마자 비교로 확인하고, 틀렸으면 맞는 Apple 아티스트로 바꾸거나 연결을 끊는다.
     실패(레이트리밋 등)는 기록하지 않고 다음에 다시 한다. */
  const APPLE_URL = /music\.apple\.com|itunes\.apple\.com/;
  const KPOP_G = /K-Pop|케이팝|트로트|Korean/i;
  let repairing = false;
  async function repairRoster(opts = {}) {
    if (repairing) return { skipped: 'running' };
    repairing = true;
    try { return await repairRosterRun(opts); } finally { repairing = false; }
  }
  async function repairRosterRun({ max = 10, force = false, ids = null } = {}) {
    if (!writeJson) return { skipped: 'no-writer' };
    await appleCheck.ready();
    const raw = (await readJson('artists', [])) || [];
    const prim = (a) => [...new Set([a.name, a.nameOriginal, a.nameJa].filter(Boolean))];
    const sigOf = (a) => `${a.appleArtistId || ''}|${a.searchTerm || ''}`;
    const mismatch = (a) => !prim(a).some((n) => norm(n) === norm(a.searchTerm));
    const charting = (a) => (a.chartHits || 0) > 0 || a.bestRank != null;
    /* 이름이 다른 행 먼저, 그다음 이름은 같지만 한 번도 확인 안 한 차트 팀(동명이인 확인) */
    const todo = raw.filter((a) => {
      if (ids) return ids.includes(a.id) && (a.appleArtistId || a.appleFix?.status === 'none');
      const c = appleCheck.get(a.id);
      /* Apple 연결을 끊은 행도 3일마다(강제면 바로) 다시 찾아본다 — 확인 규칙이 나아지면 붙는다(제니 → JENNIE) */
      if (!a.appleArtistId) return a.appleFix?.status === 'none' && (!c || c.sig !== sigOf(a) || Date.now() - c.at > (force ? HOUR : 3 * 24 * HOUR));
      if (!a.searchTerm) return false;
      if (!force && c && c.sig === sigOf(a) && Date.now() - c.at < (c.status === 'unknown' ? 7 : 60) * 24 * HOUR) return false;
      if (force && c && c.sig === sigOf(a) && (c.status === 'ok' || Date.now() - c.at < HOUR)) return false;
      return mismatch(a) || (charting(a) && !c);
    }).sort((x, y) => Number(mismatch(y)) - Number(mismatch(x))).slice(0, max);
    const fixes = new Map();
    /* 어느 나라 차트에 올랐는지 — 로마자 이름(SPEED)은 행에 적힌 나라가 예전 오판일 수 있어 차트 쪽을 먼저 믿는다 */
    const chartsNow = await getCharts().catch(() => null);
    const chartCountry = new Map();
    for (const [cc, bucket] of Object.entries(chartsNow?.countries || {})) for (const list of Object.values(bucket || {})) if (Array.isArray(list)) for (const e of list) {
      const k = norm(String(e?.artist || '').replace(/&amp;/g, '&'));
      if (!k) continue;
      const set = chartCountry.get(k) || new Set(); set.add(cc); chartCountry.set(k, set);
    }
    for (const a of todo) {
      let r;
      try {
        const seenIn = [a.nameOriginal, a.name].map((n) => chartCountry.get(norm(n))).find((x) => x && x.size === 1);
        const country = seenIn ? [...seenIn][0] : JP_GENRE.test(a.appleGenre || '') || (/[぀-ヿ一-龯]/.test(a.nameOriginal || a.name) && !/[가-힣]/.test(a.nameOriginal || a.name)) ? 'jp' : a.country === 'jp' ? 'jp' : 'kr';
        r = await checkAppleIdentity({ names: prim(a), appleName: a.appleArtistId ? a.searchTerm : null, appleId: a.appleArtistId || null, appleGenre: a.appleArtistId ? a.appleGenre || null : null, country, charting: (a.chartHits || 0) > 0 || a.bestRank != null });
      } catch { continue; }
      if (r.status === 'fixed' || (r.status === 'none' && a.appleArtistId)) fixes.set(a.id, { ...r, sigBefore: sigOf(a), nameBefore: a.nameOriginal || a.name });
      else appleCheck.set(a.id, { status: r.status, via: r.via || null, sig: sigOf(a), at: Date.now() });
    }
    if (!fixes.size) return { checked: todo.length, fixed: 0 };
    /* 로스터 수집이 파일을 쓰는 중이면 끝날 때까지 기다린다(확인한 결과를 버리지 않게) */
    let unlock = rosterLock ? await rosterLock() : async () => {};
    for (let w = 0; w < 72 && !unlock; w++) { await new Promise((ok) => setTimeout(ok, 5000)); unlock = await rosterLock(); }
    if (!unlock) return { checked: todo.length, fixed: 0, skipped: 'locked' };
    const done = [];
    try {
      const cur = (await readJson('artists', [])) || [];
      for (const a of cur) {
        const r = fixes.get(a.id);
        if (!r) continue;
        /* 확인하는 동안 수집기가 이 행을 바꿨으면(이름 복구·새 Apple 연결) 옛 판단을 덮어쓰지 않는다 — 다음 차례에 다시 본다 */
        if (sigOf(a) !== r.sigBefore || (a.nameOriginal || a.name) !== r.nameBefore) continue;
        const from = { appleArtistId: a.appleArtistId, appleName: a.searchTerm };
        const wrong = norm(a.searchTerm);
        a.aliases = (a.aliases || []).filter((x) => norm(x) !== wrong);
        if (a.official && APPLE_URL.test(a.official)) a.official = r.status === 'fixed' ? r.official : null;
        if (r.status === 'fixed') {
          a.appleArtistId = r.appleArtistId; a.searchTerm = r.appleName; a.artwork = r.artwork || null; a.artworkSource = 'apple-verified';
          if (r.genre) {
            a.appleGenre = r.genre;
            if (JP_GENRE.test(r.genre)) { a.country = 'jp'; a.genre = 'J-POP'; } else if (KPOP_G.test(r.genre)) { a.country = 'kr'; a.genre = 'K-POP'; }
          }
        } else {
          a.appleArtistId = null; a.searchTerm = prim(a)[0]; a.artwork = null; a.artworkSource = null;
        }
        a.appleFix = { status: r.status, from, en: r.en || [], at: new Date().toISOString() };
        done.push(`${a.id}: ${from.appleName} → ${r.status === 'fixed' ? r.appleName : '(연결 해제)'}`);
        appleCheck.set(a.id, { status: r.status, sig: sigOf(a), at: Date.now() });
        await photos.ready();
        photos.set(a.id, { photo: null, medium: null, fans: null, at: 0 });
      }
      await writeJson('artists', cur);
    } finally { await unlock(); }
    rosterCache = null; catalogTitles = null;
    if (done.length) console.log(`[lilac] 로스터 신원 수정 ${done.length}건 — ${done.join(' · ')}`);
    return { checked: todo.length, fixed: done.length, done };
  }

  /* ---------- 아티스트 사진 (Deezer) — 목록 화면용, 백그라운드로 채운다 ---------- */
  let catalogTitles = null;
  async function titlesFor(id) {
    if (!catalogTitles) {
      const c = await readJson('catalog', null);
      catalogTitles = new Map(Object.entries(c?.artists || {}).map(([k, v]) => [k, (v.tracks || []).map((t) => t.title).slice(0, 200)]));
    }
    return catalogTitles.get(id) || null;
  }

  async function fillPhotos(limit = 200) {
    await photos.ready();
    const list = await roster();
    let n = 0;
    for (const a of list) {
      if (n >= limit) break;
      const prev = photos.get(a.id);
      if (prev && Date.now() - prev.at < (prev.photo ? 14 : 1) * 24 * HOUR) continue;
      const names = [...new Set([a.nameOriginal, a.name, a.nameJa, ...(a.aliases || [])].filter(Boolean))];
      const latin = names.filter((x) => /[A-Za-z]/.test(x));
      try {
        const d = await deezerArtist([...latin, ...names], { knownTitles: await titlesFor(a.id) });
        photos.set(a.id, { photo: d?.picture || null, medium: d?.pictureMedium || null, fans: d?.fans ?? null, at: Date.now() });
      } catch { /* 다음에 */ }
      n++;
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  async function publicArtist(a) {
    await photos.ready();
    const ph = photos.get(a.id);
    return {
      id: a.id, name: a.name, nameOriginal: a.nameOriginal || null, nameJa: a.nameJa || null, nameKo: a.nameKo || null,
      origin: a.origin, genre: a.appleGenre || a.genre || null,
      photo: ph?.medium || ph?.photo || null, artwork: a.artwork || null,
      chartHits: a.chartHits || 0, bestRank: a.bestRank ?? null,
    };
  }

  /* 커뮤니티 갤러리용 — id(합쳐진 옛 id 포함)로 아티스트 한 명 */
  async function artistBrief(id) {
    const list = await roster();
    const a = list.find((x) => x.id === id || (x.mergedIds || []).includes(id));
    return a ? publicArtist(a) : null;
  }

  async function artists({ edition = 'kr' } = {}) {
    const list = await roster();
    const want = edition === 'kr' ? ['jp'] : edition === 'jp' ? ['kr'] : ['jp', 'kr'];
    const rows = list.filter((a) => want.includes(a.origin)).sort((a, b) => (b.chartHits || 0) - (a.chartHits || 0));
    return { items: await Promise.all(rows.map(publicArtist)) };
  }

  /* ---------- 새 발매 ---------- */
  async function releases({ edition = 'kr', limit = 24 } = {}) {
    const raw = (await readJson('releases', [])) || [];
    const rows = Array.isArray(raw) ? raw : raw.releases || [];
    const want = edition === 'kr' ? ['jp'] : edition === 'jp' ? ['kr'] : ['jp', 'kr'];
    const today = todayKst();
    const from = new Date(Date.now() - 45 * 24 * HOUR).toISOString().slice(0, 10);
    const list = rows
      .filter((r) => want.includes(r.country) && r.releaseDate && r.releaseDate >= from && r.artwork !== undefined)
      .sort((a, b) => (a.releaseDate > today) === (b.releaseDate > today) ? b.releaseDate.localeCompare(a.releaseDate) : a.releaseDate > today ? -1 : 1)
      .slice(0, limit)
      .map((r) => ({
        id: r.id, tier: r.tier, artist: r.artist, artistKo: r.artistKo, artistId: r.artistId, title: r.title, titleKo: r.titleKo,
        country: r.country, type: r.type, releaseDate: r.releaseDate, artwork: r.artwork || null, appleUrl: r.appleUrl || null,
        trackCount: r.trackCount || null, offerCount: (r.offers || []).length, upcoming: r.releaseDate > today,
      }));
    return { items: list };
  }

  /* ---------- 홈 요약 ---------- */

  /* ---------- 페스티벌 (한국·일본) ---------- */
  async function fetchFestivals() {
    const [kr, jp] = await Promise.allSettled([krFestivals(), jpFestivals()]);
    const raw = [...(kr.status === 'fulfilled' ? kr.value.items : []), ...(jp.status === 'fulfilled' ? jp.value.items : [])];
    if (!raw.length) throw new Error('festival sources failed');
    const items = groupFestivals(raw);
    /* 라인업: 멜론 출연진·e+ 「出演」. 하루 안에 읽은 페이지는 다시 읽지 않는다. 받기 실패는 저장하지 않는다 */
    await festLineups.ready();
    let fetched = 0;
    /* 멜론(한국 페스티벌) 먼저 — 출연진과 국적을 함께 주는 소스다 */
    const hasMelon = (f) => (f.links.some((l) => l.provider === 'melon') ? 1 : 0);
    for (const f of [...items].sort((a, b) => hasMelon(b) - hasMelon(a))) {
      for (const l of f.links.filter((x) => x.provider === 'melon' || x.provider === 'eplus').slice(0, 2)) {
        const prev = festLineups.get(l.url);
        if (prev && Date.now() - prev.at < 24 * HOUR && (l.provider !== 'eplus' || 'official' in prev)) continue;
        if (fetched >= 150) break;
        try {
          const html = await fetchText(l.url, { timeout: 12000, retries: 1, headers: { 'Accept-Language': l.provider === 'eplus' ? 'ja' : 'ko' } });
          festLineups.set(l.url, { names: l.provider === 'melon' ? melonLineup(html) : eplusLineup(html).map((name) => ({ name })), official: l.provider === 'eplus' ? eplusOfficialSite(html) : null, at: Date.now() });
        } catch { /* 다음에 다시 */ }
        fetched++;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    /* 멜론 출연진은 멜론 아티스트 페이지의 국적으로 한국·일본을 가린다(로마자로 적힌 일본 아티스트: YUZU, natori …).
       국적은 바뀌지 않으므로 한 번 읽으면 계속 쓴다. 받기 실패는 저장하지 않는다 */
    await melonNations.ready();
    let nationFetched = 0;
    for (const f of items) for (const l of f.links) for (const e of festLineups.get(l.url)?.names || []) {
      if (!e?.melonId || melonNations.get(e.melonId) || nationFetched >= 200) continue;
      try {
        const html = await fetchText(`https://www.melon.com/artist/detail.htm?artistId=${e.melonId}`, { timeout: 9000, retries: 1 });
        const n = melonNation(html);
        melonNations.set(e.melonId, { nation: n || 'unknown', at: Date.now() });
      } catch { /* 다음에 다시 */ }
      nationFetched++;
      await new Promise((r) => setTimeout(r, 300));
    }
    /* 멜론 ID가 없는 출연자(e+ 라인업의 로마자 이름: CHANYEOL, WINNER …)는 멜론에서 이름이 정확히 같은 아티스트를 찾아 국적을 본다.
       같은 이름이 여럿이고 국적이 다르면(미국 밴드 Exile ↔ 일본 EXILE) 판정하지 않는다. 한 번 찾은 이름은 30일 동안 다시 찾지 않는다 */
    await melonByName.ready();
    const rosterList = await roster();
    let searched = 0;
    const infoOf = async (id) => {
      const known = melonNations.get(id);
      if (known && 'agency' in known) return known;
      const html = await fetchText(`https://www.melon.com/artist/detail.htm?artistId=${id}`, { timeout: 9000, retries: 1 });
      const v = { nation: melonNation(html) || 'unknown', agency: melonAgency(html), at: Date.now() };
      melonNations.set(id, v);
      await new Promise((r) => setTimeout(r, 300));
      return v;
    };
    for (const f of items) for (const l of f.links) for (const e of festLineups.get(l.url)?.names || []) {
      const name = typeof e === 'string' ? e : e?.name;
      if (!name || e?.melonId || searched >= 120) continue;
      if (/[぀-ヿ가-힣]/.test(name) || rosterMatch(rosterList, name)) continue;
      const prev = melonByName.get(norm(name));
      if (prev && prev.v === 2 && Date.now() - prev.at < 30 * 24 * HOUR) continue;
      try {
        const html = await fetchText(`https://www.melon.com/search/artist/index.htm?q=${encodeURIComponent(name)}`, { timeout: 9000, retries: 1 });
        const hits = melonExactMatches(name, melonArtistResults(html)).slice(0, 3);
        const infos = [];
        for (const h of hits) infos.push(await infoOf(h.id).catch(() => ({ nation: 'unknown', agency: null })));
        melonByName.set(norm(name), { nation: nameSearchNation(infos), ids: hits.map((h) => h.id), v: 2, at: Date.now() });
      } catch { /* 다음에 다시 */ }
      searched++;
      await new Promise((r) => setTimeout(r, 400));
    }
    /* 예매처 이미지가 없는 페스티벌: 검색으로 공식 사이트를 찾아(페이지 제목에 페스티벌 이름 조각이 있어야 인정) 대표 이미지를 쓴다.
       찾은 결과·못 찾은 결과는 7일 동안 다시 찾지 않는다 */
    await festSites.ready();
    let siteSearches = 0;
    for (const f of items) {
      if (f.poster || siteSearches >= 20) continue;
      const prev = festSites.get(f.id);
      if (prev && Date.now() - prev.at < 7 * 24 * HOUR) continue;
      const site = await findFestivalSite(f.title, { queryEngine: searchEngine, readPage: (u) => fetchText(u, { timeout: 10000, retries: 0, headers: { 'Accept-Language': 'ja,ko;q=0.8' } }), ogImageOf: ogImage }).catch(() => undefined);
      if (site !== undefined) festSites.set(f.id, { url: site?.url || null, image: site?.image ? site.image.replace(/^http:/, 'https:') : null, at: Date.now() });
      siteSearches++;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return {
      items,
      sources: [...(kr.status === 'fulfilled' ? kr.value.sources : [{ provider: 'kr:festival', ok: false }]), ...(jp.status === 'fulfilled' ? jp.value.sources : [{ provider: 'jp:festival', ok: false }])],
    };
  }

  async function festivals({ edition = 'kr', country = null, budgetMs = 12000 } = {}) {
    const r = await cached('festivals', 3 * HOUR, fetchFestivals, { budgetMs });
    await festLineups.ready();
    await eventPosters.ready();
    await festSites.ready();
    await photos.ready();
    await namePhotos.ready();
    await melonNations.ready();
    await melonByName.ready();
    await origins.ready();
    const list = await roster();
    let queuedNames = 0;
    const items = (r.items || []).map((f) => {
      const seenN = new Set();
      const entries = f.links.flatMap((l) => (festLineups.get(l.url)?.names || []).map((e) => (typeof e === 'string' ? { name: e } : e))).filter((e) => e?.name && !seenN.has(e.name) && seenN.add(e.name));
      const lineup = entries.map(({ name: n, melonId }) => {
        const a = rosterMatch(list, n);
        const mn = melonId ? melonNations.get(melonId)?.nation : null;
        /* 로스터·판정 캐시가 먼저. 아직 모르면 표기 문자로: 가나 → 일본, 한글 → 한국, 일본 페스티벌의 한자 이름 → 일본 */
        const script = /[぀-ヿ]/.test(n) ? 'jp' : /[가-힣]/.test(n) ? 'kr' : f.country === 'JP' && /^[一-龯々〆ヵヶ\s]+$/.test(n) ? 'jp' : null;
        /* 라인업의 나라는 믿을 수 있는 근거만: 로스터, 멜론 아티스트 국적, 표기 문자.
           이름 검색 기반 출신 판정은 무명 밴드를 엉뚱한 나라로 붙여(일본 인디 밴드가 K-POP으로) 쓰지 않는다 */
        const bn = melonByName.get(norm(n));
        const byName = bn?.v === 2 ? bn.nation : null;
        const o = a?.origin || (mn === 'jp' || mn === 'kr' ? mn : null) || script || (byName === 'jp' || byName === 'kr' ? byName : null);
        return { name: a ? a.name : n, artistId: a?.id || null, origin: o === 'jp' || o === 'kr' ? o : null };
      });
      /* 예매처 이미지가 없으면 공식 사이트의 대표 이미지(og:image) */
      let poster = f.poster, posterKind = f.posterKind;
      const site = festSites.get(f.id);
      if (!poster && site?.image) { poster = site.image; posterKind = 'official'; }
      if (!poster) {
        const off = f.links.map((l) => festLineups.get(l.url)?.official).find(Boolean);
        const ep = off ? eventPosters.get(off) : null;
        if (ep?.img && !/webclip|no_thumb|daitai|noimage/i.test(ep.img)) { poster = ep.img; posterKind = 'official'; }
        else if (off && (!ep || Date.now() - ep.at > 24 * HOUR) && !posterQueue.includes(off)) { posterQueue.push(off); officialUrls.add(off); pumpPosters().catch(() => {}); }
      }
      /* 그래도 없으면 라인업 첫 아티스트 사진(아티스트 사진임을 표시) */
      if (!poster) {
        for (const x of lineup) {
          const ph = x.artistId ? photos.get(x.artistId) : namePhotos.get(norm(x.name));
          const pic = ph?.medium || ph?.photo || null;
          if (pic) { poster = pic; posterKind = 'artist'; break; }
        }
        /* 사진이 아직 없으면 앞쪽 출연자 셋의 사진을 찾아 둔다(다음 응답부터 반영) */
        if (!poster) for (const x of lineup.slice(0, 3)) if (!x.artistId && !namePhotos.get(norm(x.name)) && !photoQueue.includes(x.name) && /[A-Za-z぀-ヿ一-龯]/.test(x.name)) photoQueue.push(x.name);
      }
      return withKo({ ...f, poster, posterKind, officialSite: site?.url || f.links.map((l) => festLineups.get(l.url)?.official).find(Boolean) || null, lineup, lineupJp: lineup.filter((x) => x.origin === 'jp').length, lineupKr: lineup.filter((x) => x.origin === 'kr').length });
    }).filter((f) => !country || f.country === country);
    if (queue.length) pump().catch(() => {});
    if (photoQueue.length) pumpPhotos().catch(() => {});
    /* 에디션에 맞는 순서: 한국 팬(kr)은 일본 아티스트가 많이 나오는 페스티벌·일본 페스티벌을 먼저 보지 않고 날짜순을 유지하되,
       라인업에서 반대편 나라 아티스트 수를 함께 내려 화면이 강조한다 */
    return { items, cache: r.cache || null, sources: r.sources || [], edition, fetchedAt: new Date().toISOString() };
  }

  async function home({ edition = 'kr' } = {}) {
    const charts = await getCharts().catch(() => null);
    const chartCountries = edition === 'kr' ? ['jp'] : edition === 'jp' ? ['kr'] : ['jp', 'kr'];
    const chart = chartCountries.map((c) => ({
      country: c,
      updated: charts?.updated || null,
      items: (charts?.countries?.[c]?.combined || []).slice(0, 10).map((e, i) => ({ rank: e.rank ?? i + 1, title: e.title, artist: e.artist, artwork: e.artwork || null, appleUrl: e.appleUrl || null })),
    }));
    const [t, v, a, n, rel, ar] = await Promise.all([
      tickets({ edition }),
      concerts({ edition, scope: 'visiting' }),
      concerts({ edition, scope: 'abroad' }),
      news({ edition }),
      releases({ edition, limit: 12 }),
      artists({ edition }),
    ]);
    const fx = await readJson('fx', null);
    const fcf = await fanclubFeed({ edition });
    const fest = await festivals({ edition, budgetMs: 1500 }).catch(() => ({ items: [] }));
    return {
      edition,
      fanclub: fcf.windows.filter((w) => !w.isPublic).slice(0, 8), fanclubTotal: fcf.windows.filter((w) => !w.isPublic).length,
      tickets: t.items.slice(0, 12), ticketsTotal: t.items.length,
      visiting: v.items.filter((x) => !x.unconfirmed).slice(0, 12), visitingTotal: v.items.filter((x) => !x.unconfirmed).length, visitingGroups: v.groups,
      abroad: a.items.slice(0, 8), abroadTotal: a.items.length,
      /* 홈: 한국 페스티벌의 J-POP·일본 페스티벌의 K-POP 출연이 많은 곳 먼저, 나머지는 날짜순 */
      festivals: [...fest.items].sort((x, y) => ((y.country === 'JP' ? y.lineupKr : y.lineupJp) || 0) - ((x.country === 'JP' ? x.lineupKr : x.lineupJp) || 0) || String(x.startDate).localeCompare(String(y.startDate))).slice(0, 16), festivalsTotal: fest.items.length,
      news: (n.items || []).slice(0, 8), newsTotal: (n.items || []).length, newsCache: n.cache || null,
      chart,
      releases: rel.items,
      artists: ar.items.slice(0, 16),
      fx,
      classifying: v.classifying || 0,
      fetchedAt: new Date().toISOString(),
    };
  }

  /* ---------- 통합 검색 ---------- */
  async function search({ q, edition = 'all' } = {}) {
    const query = String(q || '').trim().slice(0, 60);
    if (!query) return { artists: [], concerts: [], releases: [] };
    const k = norm(query);
    const list = await roster();
    const artistHits = list.filter((a) => a.names.some((n) => norm(n).includes(k) || (k.length >= 3 && k.includes(norm(n)) && norm(n).length >= 3)));
    const pools = await Promise.all([src.krVisiting(), src.jpKpop(), src.krDomestic()]);
    let shows = [];
    for (const p of pools) shows.push(...(p.items || []));
    shows = upcomingOnly(shows).filter((x) => norm(x.title).includes(k) || artistHits.some((a) => a.names.some((n) => norm(n).length >= 2 && norm(x.title).includes(norm(n)))));
    shows = await annotate(shows, { classify: false });
    const seen = new Set();
    shows = groupTours(shows.filter((x) => (seen.has(x.id) ? false : seen.add(x.id)))).sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999')).slice(0, 30);
    const raw = (await readJson('releases', [])) || [];
    const rows = Array.isArray(raw) ? raw : raw.releases || [];
    const rel = rows.filter((r) => [r.title, r.titleKo, r.artist, r.artistKo].some((x) => norm(x).includes(k)))
      .sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate))).slice(0, 12)
      .map((r) => ({ id: r.id, tier: r.tier, artist: r.artist, artistKo: r.artistKo, artistId: r.artistId, title: r.title, releaseDate: r.releaseDate, artwork: r.artwork || null, country: r.country }));
    return { q: query, artists: await Promise.all(artistHits.slice(0, 12).map(publicArtist)), concerts: shows, releases: rel };
  }

  /* ---------- 공연 상세: 예매처 상품 페이지 + 그 아티스트의 공식 팬클럽 ---------- */
  async function detail({ provider, url, artistId, performer }) {
    let d = null;
    if (PROVIDER_GUIDE[provider] && url) {
      const key = `detail-${createHash('sha1').update(url).digest('hex').slice(0, 16)}`;
      const r = await cached(key, 6 * HOUR, async () => ({ items: [], d: await concertDetail(provider, url), sources: [{ provider, ok: true }] }), { budgetMs: 9000 });
      d = r?.d ? { ...r.d, cache: r.cache } : null;
    }
    // 팬클럽: 아티스트 id가 있으면 그 팬클럽, 없으면 이름으로 로스터에서 찾는다
    let fanclub = null;
    const list = await roster();
    const a = (artistId && list.find((x) => x.id === artistId)) || (performer && list.find((x) => [x.name, x.nameOriginal, x.nameJa, ...(x.aliases || [])].some((y) => y && norm(y) === norm(performer)))) || null;
    if (a) {
      const fc = await fanclubRaw(a, { budgetMs: 3500 }).catch(() => null);
      if (fc?.found) {
        const it = fcItems(a, fc);
        fanclub = { artistId: a.id, name: fc.facts?.name || null, entry: fc.entry, home: fc.home, platform: fc.platform || fc.facts?.platform || null, fees: fc.facts?.fees || null, overseas: fc.facts?.overseas || 'unknown', payments: fc.facts?.payments || [], languages: fc.facts?.languages || [], residence: fc.facts?.residence || null, overseasJoin: fc.facts?.overseasJoin || null, image: fc.facts?.image || null, period: fc.facts?.period || null, saleOpen: fc.facts?.saleOpen ?? null, source: fc.facts?.feeSource || fc.facts?.url || fc.entry || null, checkedAt: fc.facts?.checkedAt || fc.checkedAt || null, cache: fc.cache || null, windows: it.windows.filter((w) => !w.isPublic).slice(0, 4).map((w) => ({ label: w.saleType, start: w.openSchedule?.[0]?.at || null, end: w.closesAt, url: w.url, fcOnly: w.fcOnly, overseasOk: w.overseasOk, noJpPhone: w.noJpPhone, companionMember: w.companionMember })) };
      }
    }
    return { detail: d, fanclub, guide: PROVIDER_GUIDE[provider] || null, artistId: a?.id || null };
  }

  /* ---------- 차트 순위 변동 (상승·새로 진입) — 이전 순위를 주는 차트만 ---------- */
  async function chartMoves({ country = 'jp' } = {}) {
    const charts = await readJson('charts', null);
    const c = charts?.countries?.[country] || {};
    const srcKey = Object.keys(c).find((k) => Array.isArray(c[k]) && c[k].filter((e) => e?.move || e?.lastRank != null).length >= 20);
    if (!srcKey) return { source: null, rising: [], entries: [] };
    const cat = await readJson('catalog', null);
    // 같은 제목의 다른 곡을 붙이지 않도록 제목과 아티스트가 모두 맞을 때만 재킷을 쓴다
    const tkey = (x) => norm(x).replace(/\(.*?\)|feat.*$/g, '');
    const byTitle = new Map();
    const add = (k, v) => { if (!byTitle.has(k)) byTitle.set(k, []); byTitle.get(k).push(v); };
    for (const v of Object.values(cat?.artists || {})) for (const t of v.tracks || []) add(tkey(t.title), { artist: v.name, artwork: t.artwork, appleUrl: t.appleUrl });
    for (const e of c.combined || []) if (e.artwork) add(tkey(e.title), { artist: e.artist, artwork: e.artwork, appleUrl: e.appleUrl });
    const sameArtist = (x, y) => { const a2 = norm(x), b2 = norm(y); return !!a2 && !!b2 && (a2.includes(b2) || b2.includes(a2)); };
    // 곡 재킷이 없으면 같은 아티스트의 사진(로스터)으로 — 곡이 아니라 아티스트 이미지임을 표시한다
    await photos.ready();
    const ros = await roster();
    const artistImg = (name) => {
      const n = norm(name.split(/[、,&×]| feat\.?| with /i)[0]);
      const a = ros.find((x) => [x.name, x.nameOriginal, x.nameJa, ...(x.aliases || [])].some((y) => y && norm(y) === n));
      if (!a) return null;
      const ph = photos.get(a.id);
      return ph?.medium || ph?.photo || a.artwork || null;
    };
    const fill = (e) => {
      const m = (byTitle.get(tkey(e.title)) || []).find((v) => sameArtist(v.artist, e.artist));
      const alt = m?.artwork ? null : artistImg(e.artist);
      return { rank: e.rank, lastRank: e.lastRank ?? null, move: e.move || null, title: e.title, artist: e.artist, artwork: m?.artwork || alt || null, artworkKind: m?.artwork ? 'track' : alt ? 'artist' : null, appleUrl: m?.appleUrl || null };
    };
    const list = c[srcKey];
    const entries = list.filter((e) => e.move === 'new').slice(0, 12).map(fill);
    const rising = list.filter((e) => e.lastRank && e.lastRank - e.rank >= 3).sort((a2, b2) => (b2.lastRank - b2.rank) - (a2.lastRank - a2.rank)).slice(0, 12).map(fill);
    const labels = { billboard: country === 'jp' ? 'Billboard JAPAN Hot 100' : 'Billboard', melon: 'Melon', oricon: 'Oricon' };
    return { source: srcKey, sourceLabel: labels[srcKey] || srcKey, updated: charts?.updated || charts?.countries?.[country]?.updated || null, rising, entries };
  }

  /* ---------- 공식 팬클럽 ---------- */
  const officialOf = (a) => {
    const u = a?.links?.official?.url || a?.official || null;
    return u && !/music\.apple\.com|spotify|wikipedia|youtube/.test(u) ? u : null;
  };
  /* 공식 사이트에서 찾은 가입 페이지가 엉뚱한 곳(무료 호스팅 등)이면 버린다 */
  const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
  const rootOf = (h) => h.split('.').slice(-2).join('.');
  function trusted(fc, official) {
    if (!fc?.found || !fc.entry) return !!fc?.found;
    const h = hostOf(fc.entry);
    if (/pages\.dev|github\.io|netlify\.app|vercel\.app|glitch\.me|linkofgod|blogspot|wixsite/.test(h)) return false;
    if (/weverse|plusmember\.jp|emtg\.jp|familyclub\.jp|starto|tobe-official|m-up\.co\.jp|bitfan|fanicon/.test(h)) return true;
    /* 가입 절차 주소(member/add·regist·signup …)면 팬클럽 전용 도메인으로 본다(nswerjapan.com/s/222/member/add) */
    try { if (/\/(member\/add|regist|signup|join|feature\/entry|membership)/i.test(new URL(fc.entry).pathname)) return true; } catch { /* 주소 오류 */ }
    return !official || rootOf(h) === rootOf(hostOf(official)) || /fc|club|member|fan/.test(h);
  }
  /* 검색은 한 줄로 세워 8초 간격으로, 결과는 저장(찾음 7일·없음 1일). 막히면 저장하지 않고 다음에 다시 */
  let searchChain = Promise.resolve();
  async function searchOnce(a, names, officialHost) {
    await fcSearch.ready();
    const prev = fcSearch.get(a.id);
    if (prev && Date.now() - prev.at < (prev.url ? 7 * 24 : 12) * HOUR) return prev.url ? { url: prev.url } : null;
    const run = searchChain.then(async () => { await new Promise((r) => setTimeout(r, 8000)); return searchFanclub(names, { officialHost, origin: a.origin }); });
    searchChain = run.catch(() => {});
    const hit = await run;
    fcSearch.set(a.id, { url: hit?.url || null, at: Date.now() });
    return hit;
  }
  async function findFanclub(a) {
    const r0 = await findFanclubRaw(a);
    /* Weverse 샵 주인이 이 아티스트가 아니면(로제 → BLACKPINK 샵의 BLINK 멤버십) 이 아티스트의 팬클럽이 아니다 */
    const nk = (x) => String(x || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9가-힣぀-ヿ一-龯]/g, '');
    const shopOwner = r0?.facts?.shopArtist;
    /* 별칭은 수집 과정에서 그룹 이름이 섞여 들어온 경우가 있어(로제 → BLACKPINK) 대표 이름·검색어를 먼저 쓰고,
       로마자 표기가 하나도 없을 때만 별칭을 본다 */
    const primary = [a.name, a.nameOriginal, a.nameJa, a.searchTerm].filter(Boolean);
    const ownNames = primary.some((n) => /[A-Za-z]/.test(n)) ? primary : [...primary, ...(a.aliases || [])];
    const r = r0?.found && shopOwner && !ownNames.some((n) => nk(n) === nk(shopOwner))
      ? { found: false, official: officialOf(a), rejected: r0.entry, reason: `weverse-shop-of-${shopOwner}`, checkedAt: new Date().toISOString() } : r0;
    const weakEntry = (x) => { try { const p = new URL(x.entry).pathname; return (p === '/' || p === '' || /\/management\/|\/artist\/[^/]+\/?$/.test(p)) && !x.facts?.name && !(x.facts?.fees && (x.facts.fees.annual || x.facts.fees.monthly || x.facts.fees.free)) && !/weverse|plusmember|familyclub/.test(x.entry); } catch { return false; } };
    /* 솔로 멤버에 그룹 팬클럽이 붙는 것(정국 → BTS JAPAN OFFICIAL FANCLUB): 팬클럽 제목에 다른 아티스트 이름만 있고 이 아티스트 이름은 없으면 버린다 */
    if (r?.found && r.facts) {
      const title = [r.facts.ogTitle, r.facts.title, r.facts.name].filter(Boolean).join(' ');
      const has = (n) => n && n.length >= 2 && new RegExp(`(^|[^A-Za-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i').test(title);
      const own = [a.name, a.nameOriginal, a.nameJa, ...(a.aliases || [])].filter(Boolean);
      if (title && !own.some(has)) {
        const others = (await roster()).filter((x) => x.id !== a.id && !(x.mergedIds || []).includes(a.id));
        const owner = others.find((x) => [x.nameOriginal, x.name].filter((n) => n && /[A-Za-z]/.test(n) && n.length >= 3).some(has));
        if (owner) return { found: false, official: officialOf(a), rejected: r.entry, reason: `fanclub-of-${owner.id}`, checkedAt: new Date().toISOString() };
      }
    }
    /* 검색으로 찾은 팬클럽은 팬클럽 쪽 표기(제목·이름·주소)에 이 아티스트 이름이 있어야 한다.
       솔로 멤버에 그룹 팬클럽이 붙는 것(SOYEON → i-dle「NEVERLAND JAPAN」)을 막는다. 제목을 못 읽은 경우(앱 안 멤버십 탭)는 판단하지 않는다 */
    if (r?.found && r.discoveredBy === 'search' && r.facts && (r.facts.title || r.facts.ogTitle || r.facts.name)) {
      const prim0 = [a.name, a.nameOriginal, a.nameJa, a.appleArtistId ? a.searchTerm : null].filter(Boolean);
      const own2 = prim0.some((n) => /[A-Za-z]/.test(n)) ? prim0 : [...prim0, ...(a.aliases || [])];
      const hit = matchesMembershipOwner(own2, [r.facts.ogTitle, r.facts.title, r.facts.name, r.entry, r.home, r.facts.shopArtist]);
      if (!hit) return { found: false, official: officialOf(a), rejected: r.entry, reason: 'fanclub-name-mismatch', checkedAt: new Date().toISOString() };
    }
    return r?.found && weakEntry(r) ? { found: false, official: officialOf(a), rejected: r.entry, reason: 'not-a-join-page', checkedAt: new Date().toISOString() } : r;
  }
  async function findFanclubRaw(a) {
    const r = await findFanclubRaw0(a);
    if (!r?.found && r?.__fetchErr) { const e = new Error(`official site unreachable: ${r.__fetchErr}`); e.retry = true; throw e; }
    if (r && '__fetchErr' in r) delete r.__fetchErr;
    return r;
  }
  async function findFanclubRaw0(a) {
    const url = officialOf(a);
    /* 공식 사이트가 잠깐 죽어 있으면(503·시간 초과) '팬클럽 없음'이 아니라 '나중에 다시'다. 끝까지 못 찾으면 던져서 이전 값을 지킨다 */
    let fetchErr = null;
    let fc = url ? await fanclubFor(url).catch((e) => { fetchErr = e; return null; }) : null;
    if (fc && !trusted(fc, url)) fc = { found: false, official: url, rejected: fc.entry, checkedAt: new Date().toISOString() };
    if (fc?.facts?.error && fc.facts.error !== 'weverse-generic-link') fetchErr = new Error(fc.facts.error);
    if (fc?.found && fc.facts?.error) fc = { found: false, official: url, rejected: fc.entry, reason: fc.facts.error, checkedAt: new Date().toISOString() };
    /* 가입 페이지가 아니라 공식 사이트 첫 화면·소속사 소개 화면을 가리키고, 요금·팬클럽 이름도 읽히지 않으면 찾은 것으로 치지 않는다
       (nmb48.com, topjrecords.jp, ldh.co.jp/eng/management/… 같은 경우) */
    const weak = (x) => { try { const p = new URL(x.entry).pathname; return (p === '/' || p === '' || /\/management\/|\/artist\/[^/]+\/?$/.test(p)) && !x.facts?.name && !(x.facts?.fees && (x.facts.fees.annual || x.facts.fees.monthly || x.facts.fees.free)) && !/weverse|plusmember|familyclub/.test(x.entry); } catch { return false; } };
    if (fc?.found && weak(fc)) fc = { found: false, official: url, rejected: fc.entry, reason: 'not-a-join-page', checkedAt: new Date().toISOString() };
    /* 한국 아티스트는 일본 팬이 가입할 일본 팬클럽·일본 멤버십을 찾는다.
       공식 링크가 Weverse 커뮤니티처럼 요금을 읽을 수 없는 곳이면 검색으로 한 번 더 */
    const noFees = (x) => !x?.facts?.fees || !(x.facts.fees.annual || x.facts.fees.monthly || x.facts.fees.free);
    /* 일본 아티스트도 찾은 곳이 소개·공지 글이라 요금이 없으면 검색으로 가입 페이지를 한 번 더 */
    if (fc?.found && noFees(fc) && !/familyclub\.jp/.test(fc.entry || '')) {
      const names = a.origin === 'kr'
        ? (() => { const pl = [a.nameOriginal, a.name, a.appleArtistId ? a.searchTerm : null].filter((n) => n && /[A-Za-z]/.test(n)); return [...new Set(pl.length ? pl : (a.aliases || []).filter((n) => /[A-Za-z]/.test(n)))].slice(0, 3); })()
        : [...new Set([a.nameJa, a.name, a.nameOriginal, ...(a.aliases || [])].filter(Boolean))].slice(0, 3);
      const hit = names.length ? await searchOnce(a, names, url ? hostOf(url) : null).catch(() => null) : null;
      if (hit) {
        const alt = await fanclubFor(hit.url).catch(() => null);
        if (alt?.found && !alt.facts?.error && trusted(alt, hit.url) && !noFees(alt)) return { ...alt, discoveredBy: 'search', searchHit: hit.url, community: fc.entry || fc.home };
        const facts = await fanclubFacts(hit.url).catch((e) => { fetchErr = e; return null; });
        if (facts && !facts.error && !noFees({ facts })) return { found: true, official: url, home: hit.url, entry: hit.url, platform: facts.platform || null, tourLinks: [], facts, pages: [], discoveredBy: 'search', community: fc.entry || fc.home, checkedAt: new Date().toISOString() };
      }
    }
    if (!fc?.found) {
      // 공식 링크가 없거나 낡았으면 검색 결과 중 이름·가입 문구가 확인되는 페이지로
      /* 한국 아티스트는 일본 검색에서 통하는 로마자 표기를 먼저("데이식스" 가 아니라 "DAY6") */
      /* 신원 확인을 거친 Apple 표기(제니 → JENNIE)도 검색어로 — 한글 이름만으로는 일본 검색에 안 걸린다 */
      /* 별칭에는 그룹 이름이 섞여 있다(로제 → BLACKPINK). 로마자 대표 이름이 있으면 별칭은 검색어로 쓰지 않는다 */
      const prim0 = [a.name, a.nameOriginal, a.appleArtistId ? a.searchTerm : null, a.nameJa].filter(Boolean);
      const all = prim0.some((n) => /[A-Za-z]/.test(n)) ? prim0 : [...prim0, ...(a.aliases || [])];
      const names = [...new Set(a.origin === 'kr' ? [...all.filter((n) => /[A-Za-z]/.test(n) && !/[가-힣]/.test(n)), ...all] : all)].slice(0, 4);
      const hit = await searchOnce(a, names, url ? hostOf(url) : null); // 검색이 막히면 여기서 던져 결과를 저장하지 않는다
      if (hit) {
        const viaSearch = await fanclubFor(hit.url).catch((e) => { fetchErr = e; return null; });
        if (viaSearch?.facts?.error && viaSearch.facts.error !== 'weverse-generic-link') fetchErr = new Error(viaSearch.facts.error);
        if (viaSearch?.found && !viaSearch.facts?.error && (trusted(viaSearch, url || hit.url) || trusted(viaSearch, hit.url))) return { ...viaSearch, discoveredBy: 'search', searchHit: hit.url };
        // 검색으로 찾은 페이지가 곧 가입 안내인 경우(이름·가입 문구 검증 통과)
        const facts = await fanclubFacts(hit.url).catch((e) => { fetchErr = e; return null; });
        /* 검색으로 찾은 페이지는 요금·팬클럽 이름·팬클럽 제목 중 하나는 있어야 인정한다(팬 아카이브·기사 페이지 거르기) */
        const fcLike = facts && ((facts.fees && (facts.fees.annual || facts.fees.monthly || facts.fees.free)) || facts.name || facts.platform || /OFFICIAL\s*FAN\s*CLUB|ファンクラブ|FANCLUB|MEMBERSHIP|メンバーシップ/i.test(`${facts.title || ''} ${facts.ogTitle || ''}`));
        /* 검색에 걸린 게 공지·기사 화면이고 요금을 다른 화면(팬클럽 안내)에서 읽었으면 그 화면을 입구로 */
        const newsLike = /\/(news|post|posts|topics|information|info|article|blog)\//i.test(hit.url);
        const entryUrl = newsLike && facts?.feeSource ? facts.feeSource : hit.url;
        if (facts && !facts.error && fcLike) return { found: true, official: url, home: entryUrl, entry: entryUrl, platform: facts.platform || null, tourLinks: [], facts, pages: [], discoveredBy: 'search', searchHit: hit.url, checkedAt: new Date().toISOString() };
      }
    }
    if (fetchErr && !fc?.found) return { ...(fc || { found: false, official: url }), __fetchErr: String(fetchErr?.message || fetchErr) };
    return fc;
  }
  async function fanclubRaw(a, { budgetMs = 2500, peekOnly = false } = {}) {
    if (peekOnly) { const pk = await peek(`fc-${a.id}`, { ttlMs: 6 * HOUR }); return pk?.fc ? exposeMembership({ ...pk.fc, cache: pk.cache }, a) : null; }
    const r = await cached(`fc-${a.id}`, 6 * HOUR, async () => ({ items: [], fc: await findFanclub(a), sources: [{ provider: 'official-site', ok: true }] }), { budgetMs });
    return r?.fc ? exposeMembership({ ...r.fc, cache: r.cache }, a) : null;
  }

  /* 팬클럽 선행·전용 접수 → 공연·티켓 목록과 같은 모양으로 */
  function fcItems(a, fc, { now = Date.now() } = {}) {
    if (!fc?.found) return { windows: [], tours: [], trades: [] };
    const photo = photos.get(a.id);
    const poster = photo?.medium || photo?.photo || a.artwork || null;
    const facts = fc.facts || {};
    const club = {
      name: facts.name || null, entry: fc.entry, home: fc.home, platform: fc.platform || facts.platform || null,
      overseas: facts.overseas || 'unknown', fees: facts.fees || null, languages: facts.languages || [],
    };
    // 공연장 나라 → 이 서비스의 방향. 일본 아티스트가 한국에서 하면 내한, 일본에서 하면 원정.
    const dirOf = (country) => {
      if (a.origin === 'kr') return country === 'JP' ? 'jp-visiting' : null;
      if (country === 'KR') return 'kr-visiting';
      if (country === 'JP') return 'kr-abroad';
      return null;
    };
    const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const clubLabel = club.name ? new RegExp(`^(OFFICIAL FAN CLUB|公式ファンクラブ|オフィシャルファンクラブ)?\\s*「?${reEsc(club.name)}」?\\s*`, 'i') : null;
    const cleanLabel = (l) => (clubLabel ? l.replace(clubLabel, '') : l).replace(/^OFFICIAL FAN CLUB\s*「[^」]*」\s*/i, '').replace(/\s*\[\s*/g, ' [').replace(/\s*\]\s*/g, ']').trim() || l;
    const vkey = (v) => String(v || '').normalize('NFKC').replace(/[\s()（）・·]/g, '').toLowerCase();
    const uniqVenues = (list) => { const m = new Map(); for (const x of list) if (!m.has(vkey(x.venue))) m.set(vkey(x.venue), x.venue); return [...m.values()]; };
    const windows = [];
    const trades = [];
    const tours = [];
    for (const page of fc.pages || []) {
      const upcoming = (page.shows || []).filter((x) => x.date >= todayKst());
      const live = (page.sales || []).filter((x) => x.end && Date.parse(x.end) > now && !x.ended);
      const byDir = new Map();
      for (const sh of upcoming) {
        const d = dirOf(sh.country);
        if (!d) continue;
        if (!byDir.has(d)) byDir.set(d, []);
        byDir.get(d).push(sh);
      }
      const mk = (dir, shows) => {
        const sorted = [...shows].sort((x, y) => x.date.localeCompare(y.date)).filter((x, i, arr) => arr.findIndex((y) => y.date === x.date && vkey(y.venue) === vkey(x.venue)) === i);
        const venues = uniqVenues(sorted);
        return {
          provider: 'fanclub', title: page.title, performer: a.name, artistId: a.id, origin: a.origin, originSource: 'roster',
          venue: venues[0] || null, venueCount: venues.length, city: null, country: dir === 'kr-visiting' ? 'KR' : 'JP',
          startDate: sorted[0]?.date || null, endDate: sorted[sorted.length - 1]?.date || null,
          shows: sorted.slice(0, 60).map((x) => ({ date: x.date, endDate: x.date, venue: x.venue, city: null, url: page.url })),
          showCount: sorted.length || null, poster, posterKind: 'artist', url: page.url, kind: 'concert',
          direction: dir, fanclub: club, fetchedAt: page.checkedAt,
        };
      };
      // 접수는 페이지의 대표 방향(공연이 가장 많은 쪽)에 붙인다. 공연을 못 읽은 페이지는 일본 공연으로 본다.
      const mainDir = [...byDir.entries()].sort((x, y) => y[1].length - x[1].length)[0]?.[0] || (a.origin === 'kr' ? 'jp-visiting' : 'kr-abroad');
      const base = mk(mainDir, byDir.get(mainDir) || []);
      for (const w of live) {
        const opens = Date.parse(w.start) > now;
        const label = cleanLabel(w.label);
        const item = {
          ...base,
          id: `fc:${createHash('sha1').update(`${a.id}|${w.start}|${w.end}|${w.trade ? 't' : ''}|${label}`).digest('hex').slice(0, 12)}`,
          ticketOpenAt: opens ? w.start : null, ticketOpenLabel: label, closesAt: w.end,
          openSchedule: [{ at: w.start, endAt: w.end, label }],
          saleType: label, saleSortAt: opens ? w.start : w.end,
          status: opens ? 'upcoming' : 'onsale',
          fcOnly: !!w.fcOnly, fcFirst: !!w.fcFirst, isPublic: !!w.isPublic, trade: !!w.trade, lottery: !!w.lottery,
          overseasOk: !!w.overseas || !!w.noJpPhone, noJpPhone: !!w.noJpPhone, condition: w.condition, ticketing: w.ticketing,
          joinDuringWindow: !!page.notes?.joinDuringWindow, faceId: !!page.notes?.faceId, companionMember: !!w.companion,
        };
        // 같은 접수가 투어 특설 페이지와 공지 페이지에 모두 실린다 — 기간이 같으면 하나로
        const list = w.trade ? trades : windows;
        const dup = list.find((x) => x.artistId === item.artistId && x.openSchedule[0].at === w.start && x.closesAt === w.end && x.isPublic === item.isPublic && x.overseasOk === item.overseasOk);
        if (dup) {
          if (label.length > dup.saleType.length && label.length < 60) { dup.saleType = label; dup.ticketOpenLabel = label; }
          dup.joinDuringWindow ||= item.joinDuringWindow;
          if ((item.showCount || 0) > (dup.showCount || 0)) Object.assign(dup, { shows: item.shows, showCount: item.showCount, venue: item.venue, venueCount: item.venueCount, startDate: item.startDate, endDate: item.endDate, url: item.url });
          continue;
        }
        list.push(item);
      }
      const hasFc = (page.sales || []).some((x) => (x.fcFirst || x.fcOnly) && !x.trade);
      if (!hasFc) continue;
      for (const [dir, shows] of byDir) {
        const t = mk(dir, shows);
        const fcSales = (page.sales || []).filter((x) => !x.trade);
        tours.push({
          ...t,
          id: `fc-tour:${createHash('sha1').update(`${page.url}|${dir}`).digest('hex').slice(0, 12)}`,
          status: live.some((w) => !w.trade && Date.parse(w.start) <= now) ? 'onsale' : live.some((w) => !w.trade) ? 'upcoming' : 'unknown',
          fcOnly: fcSales.length > 0 && fcSales.every((x) => x.fcOnly),
          fcFirst: true,
          overseasOk: fcSales.some((x) => x.overseas || x.noJpPhone),
          noJpPhone: fcSales.some((x) => x.noJpPhone),
          openSchedule: live.filter((w) => !w.trade).map((w) => ({ at: w.start, endAt: w.end, label: cleanLabel(w.label) })),
        });
      }
    }
    // 특설 페이지와 공지 페이지가 같은 투어의 다른 회차를 싣는다 — 같은 방향·비슷한 제목이면 합친다
    const nm = norm(a.name);
    const tkey = (x) => norm(x.title).replace(/[≪≫<>《》「」【】()（）]/g, '').split(nm).join('').replace(/officialfanclub.*$/, '').slice(0, 16);
    const toursDedup = [];
    for (const t of tours.sort((x, y) => (y.showCount || 0) - (x.showCount || 0))) {
      const u = toursDedup.find((v) => v.direction === t.direction && (tkey(v).includes(tkey(t)) || tkey(t).includes(tkey(v))));
      if (!u) { toursDedup.push(t); continue; }
      for (const sh of t.shows || []) if (!u.shows.some((x) => x.date === sh.date && (vkey(x.venue).includes(vkey(sh.venue)) || vkey(sh.venue).includes(vkey(x.venue))))) u.shows.push(sh);
      u.shows.sort((x, y) => String(x.date).localeCompare(String(y.date)));
      u.showCount = u.shows.length;
      u.startDate = u.shows[0]?.date || u.startDate;
      u.endDate = u.shows[u.shows.length - 1]?.date || u.endDate;
      u.venueCount = uniqVenues(u.shows).length;
      if (u.title.length > t.title.length) u.title = t.title;
      for (const o of t.openSchedule || []) if (!u.openSchedule.some((x) => x.at === o.at && x.endAt === o.endAt)) u.openSchedule.push(o);
      if (t.status === 'onsale') u.status = 'onsale';
      u.overseasOk ||= t.overseasOk;
      u.noJpPhone ||= t.noJpPhone;
    }
    // 창이 가리키는 공연의 제목도 짧은 쪽(합친 투어 제목)으로
    for (const w of windows) {
      const u = toursDedup.find((v) => tkey(v).includes(tkey(w)) || tkey(w).includes(tkey(v)));
      if (u) Object.assign(w, { title: u.title, tourId: u.id });
    }
    windows.sort((x, y) => String(x.saleSortAt).localeCompare(String(y.saleSortAt)));
    return { windows, tours: toursDedup, trades };
  }

  async function fanclubFeed({ edition = 'kr' } = {}) {
    await photos.ready();
    const origin = edition === 'jp' ? ['kr'] : edition === 'kr' ? ['jp'] : ['jp', 'kr'];
    const list = await roster();
    const top = [];
    for (const o of origin) top.push(...(await topArtists(o, 999)));
    const windows = [];
    const tours = [];
    for (const a of top) {
      const fc = await fanclubRaw(a, { peekOnly: true }).catch(() => null);
      if (!fc) continue;
      const r = fcItems(a, fc);
      windows.push(...r.windows);
      tours.push(...r.tours);
    }
    void list;
    windows.sort((x, y) => String(x.saleSortAt).localeCompare(String(y.saleSortAt)));
    tours.sort((x, y) => String(x.startDate || '9999').localeCompare(String(y.startDate || '9999')));
    return { windows: windows.map(withKo), tours: tours.map(withKo) };
  }

  /* 팬클럽 목록 — 요금·해외 가입·접수 중 선행을 한 표로 */
  async function fanclubList({ edition = 'kr' } = {}) {
    await photos.ready();
    const origins = edition === 'jp' ? ['kr'] : edition === 'kr' ? ['jp'] : ['jp', 'kr'];
    const out = [];
    for (const o of origins) {
      /* 로스터 전원(한국·일본 아티스트 모두). 아직 확인 안 한 팀은 warmFanclubs 가 차례로 채운다 */
      for (const a of await topArtists(o, 999)) {
        const fc = await fanclubRaw(a, { peekOnly: true }).catch(() => null);
        const ph = photos.get(a.id);
        const latinOf = (x) => x && /[A-Za-z]/.test(x) && !/[가-힣]/.test(x);
        const base = { artistId: a.id, artist: a.name, /* 별칭은 그룹 이름이 섞여 있어(로제 → BLACKPINK) 쓰지 않는다: 원어 표기 → 위키백과 일본어 제목 → Weverse 샵 이름 */
        artistLatin: (latinOf(a.nameOriginal) ? a.nameOriginal : null) || (a.nameJa && !/[가-힣]/.test(a.nameJa) ? a.nameJa : null) || (latinOf(fc?.facts?.shopArtist) ? fc.facts.shopArtist : null), artistKo: a.nameKo && a.nameKo !== a.name ? a.nameKo : null, origin: a.origin, photo: ph?.medium || ph?.photo || a.artwork || null, official: officialOf(a) };
        if (fc?.found) {
          const it = fcItems(a, fc);
          const open = it.windows.filter((w) => !w.isPublic);
          out.push({ ...base, found: true, name: fc.facts?.name || null, entry: fc.entry || fc.home, home: fc.home, platform: fc.platform || fc.facts?.platform || null, fees: fc.facts?.fees || null, overseas: fc.facts?.overseas || 'unknown', payments: fc.facts?.payments || [], languages: fc.facts?.languages || [], residence: fc.facts?.residence || null, overseasJoin: fc.facts?.overseasJoin || null, image: fc.facts?.image || null, period: fc.facts?.period || null, saleOpen: fc.facts?.saleOpen ?? null, source: fc.facts?.url || fc.entry, checkedAt: fc.checkedAt || null, cache: fc.cache || null, open: open.slice(0, 3).map((w) => ({ label: w.saleType, end: w.closesAt, start: w.openSchedule?.[0]?.at || null, url: w.url, fcOnly: w.fcOnly, overseasOk: w.overseasOk, noJpPhone: w.noJpPhone })) });
        } else {
          out.push({ ...base, found: false, status: fc ? 'not_found' : 'unverified', reason: fc?.reason || null, cache: fc?.cache || null });
        }
      }
    }
    /* 로스터에 같은 아티스트가 id만 달리 두 번 들어 있는 경우(ILLIT, 리센느)가 있다. 팬클럽을 찾은 쪽 하나만 */
    const nk = (x) => String(x || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    const best = new Map();
    const score = (x) => (x.found ? 2 : 0) + (x.fees && (x.fees.annual || x.fees.monthly || x.fees.free) ? 1 : 0);
    const key = (x) => nk(x.artistLatin || x.artist);
    for (const x of out) { const k = key(x); const prev = best.get(k); if (!prev || score(x) > score(prev)) best.set(k, x); }
    return { items: out.filter((x) => best.get(key(x)) === x) };
  }

  /* 로스터 전원을 차례로(한 번에 한 팀). 캐시가 살아 있는 팀은 건너뛰므로 두 번째부터는 금방 끝난다.
     한국·일본을 번갈아 돌려 한쪽만 먼저 채워지지 않게 한다 */
  let fcWarming = false;
  const fcProgress = { total: 0, done: 0, found: 0, startedAt: null, finishedAt: null };
  async function warmFanclubs() {
    if (fcWarming) return;
    fcWarming = true;
    try {
      const jp = await topArtists('jp', 999);
      const kr = await topArtists('kr', 999);
      const order = [];
      for (let i = 0; i < Math.max(jp.length, kr.length); i++) { if (jp[i]) order.push(jp[i]); if (kr[i]) order.push(kr[i]); }
      Object.assign(fcProgress, { total: order.length, done: 0, found: 0, startedAt: new Date().toISOString(), finishedAt: null });
      for (const a of order) {
        const fc = await fanclubRaw(a, { budgetMs: 90000 }).catch(() => null);
        fcProgress.done++;
        if (fc?.found) fcProgress.found++;
      }
      fcProgress.finishedAt = new Date().toISOString();
    } finally { fcWarming = false; }
  }

  /* ---------- 상태 ---------- */
  async function status() {
    const keys = ['kr-visiting', 'kr-opens', 'kr-domestic', 'jp-kpop', 'news-kr', 'news-jp'];
    const out = {};
    for (const k of keys) {
      const fns = { 'kr-visiting': src.krVisiting, 'kr-opens': src.krOpens, 'kr-domestic': src.krDomestic, 'jp-kpop': src.jpKpop };
      const r = fns[k] ? await fns[k]() : await news({ edition: k.endsWith('jp') ? 'jp' : 'kr' });
      out[k] = { count: (r.items || []).length, cache: r.cache, sources: r.sources };
    }
    await origins.ready();
    return { sources: out, originCache: origins.map.size, classifyQueue: queue.length, classifiedVersion, fanclubs: { ...fcProgress }, realtime: { clients: clients.size, jobs: syncState, topics: lastByTopic } };
  }

  /* ---------- 실시간 동기화 ----------
     예전: 요청이 올 때 TTL이 지났으면 갱신(45분마다 한 번 데우기). 화면은 새로고침해야 바뀌었다.
     지금: 원천마다 주기를 따로 두고 백그라운드에서 계속 다시 받는다. 내용이 바뀌면(해시 비교) SSE로 화면에 알린다.
     주기는 원천 사이트 부담과 변화 속도를 같이 본다 — 티켓 오픈 공지·뉴스 5분, 공연 목록 10~20분, 팬클럽 접수 30분. */
  const TOPIC_OF = (key) => (/^(kr-visiting|kr-domestic|jp-kpop|eplus-search-)/.test(key) ? 'concerts' : key === 'kr-opens' ? 'tickets' : /^news-/.test(key) ? 'news' : /^goods-/.test(key) ? 'goods' : /^fc-/.test(key) ? 'fanclubs' : null);
  const clients = new Set();
  const lastByTopic = {};
  const recentGoods = new Map();
  async function refreshRecentGoods() {
    const since = Date.now() - 6 * HOUR;
    const list = [...recentGoods].filter(([, v]) => v.at > since).sort((a, b) => b[1].at - a[1].at).slice(0, 15);
    for (const [key, v] of list) {
      await revalidate(key, () => searchGoods(v.query, { market: v.market })).catch(() => {});
      await new Promise((r) => setTimeout(r, 2000));
    }
    return list.length;
  }
  let pendingPush = new Map();
  let pushTimer = null;
  function flushPush() {
    const batch = [...pendingPush.values()];
    pendingPush = new Map();
    for (const ev of batch) {
      const data = `event: update\ndata: ${JSON.stringify(ev)}\n\n`;
      for (const res of clients) { try { if (res.destroyed || res.writableEnded || !res.write(data)) { clients.delete(res); res.destroy?.(); } } catch { clients.delete(res); res.destroy?.(); } }
    }
  }
  /* 같은 주제의 변화는 1.5초 모아서 한 번에(목록 여러 개가 연달아 갱신될 때 화면이 여러 번 깜빡이지 않게) */
  function publish(topic, info = {}) {
    const cur = pendingPush.get(topic) || { topic, added: 0, keys: [], byKey: {} };
    cur.at = Date.now();
    cur.added += info.added || 0;
    if (info.key && cur.keys.length < 8 && !cur.keys.includes(info.key)) cur.keys.push(info.key);
    /* 키별 새 항목 수 — 화면이 자기 에디션(한국·일본)에 해당하는 것만 센다 */
    if (info.key) cur.byKey[info.key] = (cur.byKey[info.key] || 0) + (info.added || 0);
    pendingPush.set(topic, cur);
    lastByTopic[topic] = { at: new Date(cur.at).toISOString(), added: cur.added };
    clearTimeout(pushTimer);
    pushTimer = setTimeout(flushPush, 1500);
    pushTimer.unref?.();
  }
  const onCacheChange = (e) => { const topic = TOPIC_OF(e.key); if (topic) publish(topic, { key: e.key, added: e.added || 0 }); };
  cacheEvents.on('change', onCacheChange);

  /* 팬클럽 선행·전용 접수가 열려 있거나 곧 열리는 팀은 30분마다 다시 본다(나머지는 6시간 캐시) */
  async function refreshFanclubWindows() {
    const list = [...await topArtists('jp', 999), ...await topArtists('kr', 999)];
    let n = 0;
    for (const a of list) {
      const pk = await peek(`fc-${a.id}`);
      const fc = pk?.fc;
      if (!fc?.found) continue;
      const now = Date.now();
      const live = (fc.pages || []).some((pg) => (pg.sales || []).some((w) => { const e = Date.parse(w.end || ''); const st = Date.parse(w.start || ''); return (!Number.isNaN(e) && e > now) || (!Number.isNaN(st) && st > now); }));
      if (!live) continue;
      await revalidate(`fc-${a.id}`, async () => ({ items: [], fc: await findFanclub(a), sources: [{ provider: 'official-site', ok: true }] })).catch(() => {});
      n++;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return n;
  }

  const SYNC = [
    { name: 'kr-opens', every: 5 * MIN, run: () => revalidate('kr-opens', SRC_FN['kr-opens']) },
    { name: 'news', every: 5 * MIN, run: async () => { await news({ edition: 'kr', force: true }); await news({ edition: 'jp', force: true }); } },
    { name: 'jp-kpop', every: 10 * MIN, run: () => revalidate('jp-kpop', SRC_FN['jp-kpop']) },
    { name: 'kr-visiting', every: 10 * MIN, run: () => revalidate('kr-visiting', SRC_FN['kr-visiting']) },
    { name: 'kr-domestic', every: 20 * MIN, run: () => revalidate('kr-domestic', SRC_FN['kr-domestic']) },
    { name: 'fanclub-windows', every: 30 * MIN, run: () => refreshFanclubWindows() },
    { name: 'goods', every: 20 * MIN, first: 3 * MIN, run: () => refreshRecentGoods() },
    { name: 'roster-identity', every: 15 * MIN, first: 60_000, run: () => repairRoster({ max: 8 }) },
    { name: 'photos', every: 30 * MIN, first: 5 * MIN, run: () => fillPhotos(40) },
  ];
  const syncState = {};
  let realtimeStarted = false;
  const syncTimers = new Set();
  const scheduleSync = (fn, delay) => { const t = setTimeout(() => { syncTimers.delete(t); fn(); }, delay); t.unref?.(); syncTimers.add(t); };
  function dispose() { realtimeStarted = false; for (const t of syncTimers) clearTimeout(t); syncTimers.clear(); clearTimeout(pushTimer); pendingPush.clear(); cacheEvents.off('change', onCacheChange); for (const res of clients) res.destroy?.(); clients.clear(); }
  function startRealtime() {
    if (realtimeStarted) return;
    realtimeStarted = true;
    SYNC.forEach((job, i) => {
      const st = (syncState[job.name] = { every: job.every / 1000, runs: 0, lastAt: null, lastMs: null, lastError: null, next: null });
      const tick = async () => {
        const t0 = Date.now();
        try { const r = await job.run(); st.lastResult = typeof r === 'number' ? r : r && typeof r === 'object' && !('value' in r) && !('items' in r) ? r : undefined; st.lastError = r?.lastError || r?.cache?.lastError || null; } catch (e) { st.lastError = String(e?.message || e); }
        st.runs++;
        st.lastAt = new Date().toISOString();
        st.lastMs = Date.now() - t0;
        const wait = job.every + Math.round(job.every * 0.1 * Math.random());
        st.next = new Date(Date.now() + wait).toISOString();
        if (realtimeStarted) scheduleSync(tick, wait);
      };
      const first = job.first ?? 30_000 + i * 7_000;
      st.next = new Date(Date.now() + first).toISOString();
      scheduleSync(tick, first);
    });
  }
  /* 서버의 다른 동기화(차트·환율·커뮤니티)도 같은 통로로 알린다 */
  function notify(topic, info = {}) { publish(topic, info); }

  /* 부팅 직후 미리 데워 둔다 — 첫 사용자가 빈 화면을 보지 않게 */
  async function warm() {
    try {
      await fillKoNames().catch(() => {});
      await fillJaNames().catch(() => {});
      await Promise.all([src.krVisiting(), src.krOpens(), src.jpKpop()]);
      await concerts({ edition: 'kr', scope: 'visiting' });
      await tickets({ edition: 'kr' });
      await news({ edition: 'kr' });
      await news({ edition: 'jp' });
      await src.krDomestic();
      await concerts({ edition: 'jp', scope: 'abroad' });
      await tickets({ edition: 'jp' });
      await concerts({ edition: 'kr', scope: 'abroad' });
      await festivals({ edition: 'kr' }).catch(() => {});
      await fillPhotos();
      await warmFanclubs();
    } catch (e) {
      console.warn('[live] warm 실패', e?.message || e);
    }
  }

  function register(app) {
    const ed = (v) => (['kr', 'jp', 'all'].includes(v) ? v : 'kr');
    const wrap = (fn) => async (req, res) => {
      try { res.json(await fn(req)); } catch (e) { res.status(502).json({ error: String(e?.message || e), code: 'UPSTREAM' }); }
    };
    app.get('/api/live/concerts', wrap((req) => concerts({ edition: ed(req.query.edition), scope: String(req.query.scope || 'visiting'), origin: String(req.query.origin || 'default') })));
    app.get('/api/live/tickets', wrap((req) => tickets({ edition: ed(req.query.edition), origin: String(req.query.origin || 'default') })));
    app.get('/api/live/news', wrap((req) => news({ edition: ed(req.query.edition), artist: req.query.artist ? String(req.query.artist).slice(0, 80) : null })));
    app.get('/api/live/goods', wrap((req) => goods({ q: req.query.q, market: ['kr', 'jp', 'all'].includes(req.query.market) ? req.query.market : 'kr' })));
    app.get('/api/live/artist', wrap(async (req) => (await artist({ id: req.query.id ? String(req.query.id) : null, name: req.query.name ? String(req.query.name).slice(0, 80) : null, edition: ed(req.query.edition) })) || { error: 'not found' }));
    app.get('/api/live/status', wrap(() => status()));
    app.get('/api/live/festivals', wrap((req) => festivals({ edition: ed(req.query.edition), country: ['KR', 'JP'].includes(String(req.query.country)) ? String(req.query.country) : null })));
    /* 팬클럽 다시 받기(로컬에서만): ?ids=a,b 또는 ?platform=familyclub */
    app.post('/api/live/admin/refresh-fc', async (req, res) => {
      const ip = req.ip || req.socket?.remoteAddress || '';
      if (!/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(ip)) return res.status(403).json({ error: 'local only', code: 'FORBIDDEN' });
      const list = await roster();
      const ids = String(req.query.ids || '').split(',').filter(Boolean);
      const plat = String(req.query.platform || '');
      const targets = [];
      for (const a of list) {
        if (ids.includes(a.id)) { targets.push(a); continue; }
        if (plat) { const pk = await peek(`fc-${a.id}`); if (pk?.fc?.entry && pk.fc.entry.includes(plat)) targets.push(a); }
      }
      (async () => { for (const a of targets) { await revalidate(`fc-${a.id}`, async () => ({ items: [], fc: await findFanclub(a), sources: [{ provider: 'official-site', ok: true }] })).catch((e) => console.warn('[lilac] refresh-fc', a.id, e?.message)); } console.log(`[lilac] refresh-fc ${targets.length}건 완료`); })();
      res.json({ ok: true, targets: targets.map((a) => a.id) });
    });
    /* 로스터 신원 확인을 지금 한 번(로컬에서만) — 백그라운드로 돌리고 바로 답한다 */
    app.post('/api/live/admin/repair-roster', (req, res) => {
      const ip = req.ip || req.socket?.remoteAddress || '';
      if (!/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(ip)) return res.status(403).json({ error: 'local only', code: 'FORBIDDEN' });
      const max = Math.min(Number(req.query.max) || 40, 200);
      const force = req.query.force === '1';
      const ids = req.query.ids ? String(req.query.ids).split(',').filter(Boolean).slice(0, 50) : null;
      /* 여섯 건씩 나눠 확인·저장한다(도중에 서버가 내려가도 고친 건 남게) */
      (async () => {
        let total = 0, fixed = 0;
        for (let i = 0; i < max; i += 6) {
          let r = await repairRoster({ max: ids ? 50 : 6, force, ids }).catch(() => null);
          for (let w = 0; w < 60 && r?.skipped === 'running'; w++) { await new Promise((ok) => setTimeout(ok, 5000)); r = await repairRoster({ max: ids ? 50 : 6, force, ids }).catch(() => null); }
          if (ids) { total += r?.checked || 0; fixed += r?.fixed || 0; break; }
          if (!r || r.skipped || !r.checked) { console.log('[lilac] repair-roster 멈춤', JSON.stringify(r)); break; }
          total += r.checked; fixed += r.fixed || 0;
        }
        console.log(`[lilac] repair-roster 확인 ${total}건 · 수정 ${fixed}건`);
      })();
      res.json({ ok: true, started: true, max });
    });
    /* 실시간 알림(Server-Sent Events) — 화면이 구독하고, 바뀐 주제만 다시 불러 그린다 */
    app.get('/api/live/stream', (req, res) => {
      res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.flushHeaders?.();
      attachStream(req, res, clients, `retry: 5000\nevent: hello\ndata: ${JSON.stringify({ at: new Date().toISOString(), topics: lastByTopic, jobs: Object.fromEntries(Object.entries(syncState).map(([k, v]) => [k, { every: v.every, lastAt: v.lastAt, next: v.next }])) })}\n\n`);
    });
    app.get('/api/live/home', wrap((req) => home({ edition: ed(req.query.edition) })));
    app.get('/api/live/search', wrap((req) => search({ q: req.query.q, edition: ed(req.query.edition) })));
    app.get('/api/live/artists', wrap((req) => artists({ edition: ed(req.query.edition) })));
    app.get('/api/live/releases', wrap((req) => releases({ edition: ed(req.query.edition), limit: Math.min(Number(req.query.limit) || 24, 60) })));
    app.get('/api/live/fx', wrap(async () => (await readJson('fx', null)) || {}));
    /* WebGL 텍스처용 이미지 중계 — CORS 헤더가 없는 예매처 이미지만. 허용한 호스트만, 메모리에 잠깐 보관 */
    const imgCache = new Map();
    const imgInflight = new Map();
    let imgCacheBytes = 0;
    app.get('/api/live/img', async (req, res) => {
      let u;
      try { u = validateArtworkUrl(String(req.query.u || '')); } catch (e) { return res.status(e.status || 400).end(); }
      const key = u.href;
      let hit = imgCache.get(key);
      if (!hit) {
        if (!imgInflight.has(key)) {
          if (imgInflight.size >= 4) return res.status(503).end();
          const pending = fetchArtwork(key).then(result => {
            imgCache.set(key, result); imgCacheBytes += result.buf.length;
            while (imgCache.size > 80 || imgCacheBytes > 48 * 1024 * 1024) {
              const oldest = imgCache.keys().next().value;
              imgCacheBytes -= imgCache.get(oldest).buf.length; imgCache.delete(oldest);
            }
            return result;
          }).finally(() => imgInflight.delete(key));
          imgInflight.set(key, pending);
        }
        try { hit = await imgInflight.get(key); } catch (e) { return res.status(e.status || 502).end(); }
      }
      res.set({ 'content-type': hit.type, 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=86400', 'access-control-allow-origin': '*' });
      res.send(hit.buf);
    });
    app.get('/api/live/detail', wrap((req) => detail({ provider: String(req.query.provider || ''), url: String(req.query.url || ''), artistId: String(req.query.artistId || '') || null, performer: String(req.query.performer || '') || null })));
    app.get('/api/live/chart-moves', wrap((req) => chartMoves({ country: req.query.country === 'kr' ? 'kr' : 'jp' })));
    app.get('/api/live/fanclub-list', wrap((req) => fanclubList({ edition: ed(req.query.edition) })));
    app.get('/api/live/fanclubs', wrap((req) => fanclubFeed({ edition: ed(req.query.edition) })));
    /* 팬클럽 가입·신청 유입 — 소속사에 보여줄 수 있는 숫자. 개인정보 없이 아티스트·날짜별 건수만 센다 */
    app.post('/api/live/fc-click', async (req, res) => {
      await fcClicks.ready();
      const id = String(req.body?.artistId || '').slice(0, 80);
      const kind = req.body?.kind === 'sale' ? 'sale' : 'join';
      if (!id) return res.status(400).json({ error: 'artistId required', code: 'INVALID_INPUT' });
      const day = todayKst();
      const cur = fcClicks.get(id) || { join: 0, sale: 0, byDay: {} };
      cur[kind] = (cur[kind] || 0) + 1;
      cur.byDay[day] = (cur.byDay[day] || 0) + 1;
      fcClicks.set(id, cur);
      res.json({ ok: true });
    });
    app.get('/api/live/fc-referrals', wrap(async () => { await fcClicks.ready(); return { items: [...fcClicks.map].map(([artistId, v]) => ({ artistId, ...v })).sort((a, b) => (b.join + b.sale) - (a.join + a.sale)) }; }));
  }

  return { register, warm, startRealtime, dispose, notify, repairRoster, concerts, tickets, news, goods, artist, status, home, festivals, search, artists, artistBrief, releases, fillPhotos, fanclubFeed };
}
