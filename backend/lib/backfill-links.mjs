/* 아티스트 공식 채널 보강.

   라일락의 역할은 파는 게 아니라 '공식 판매처로 보내는' 것이다.
   그러려면 팀마다 공식 사이트·유튜브·SNS·음반 구매처(타워레코드·HMV 아티스트 페이지)
   링크가 있어야 하는데, 지금은 애플 아티스트 URL 하나뿐이었다.

   MusicBrainz 는 아티스트-URL 관계를 공개 API 로 준다(예: aespa 57건).
   관계 타입이 정해져 있어 자동 분류가 된다:
     official homepage      → 공식 사이트
     youtube                → 유튜브 채널
     social network         → X / Instagram / Facebook / TikTok
     purchase for mail-order→ 타워레코드·HMV 아티스트 페이지 (음반 구매)
     purchase for download  → mora 등
     streaming / free streaming → Apple Music / Spotify
     fanpage                → 팬 사이트

   지키는 것:
   · 이름이 정확히 일치하는 아티스트만 (동명이인·트리뷰트 방지)
   · 출처(linksSource, mbid)를 남긴다
   · 사람이 넣은 링크(a.links.*.manual)는 덮지 않는다
   · 초당 1회 제한. 실패는 보류하고 기록만 남긴다 */

const UA = { 'User-Agent': 'Lilac/1.0 ( https://github.com/sabill123/Lilac )' };
const MB = 'https://musicbrainz.org/ws/2';
const RATE_MS = 1400;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function j(url, retry = 2) {
  const r = await fetch(url, { headers: UA });
  if (r.status === 503 && retry > 0) { await wait(4000); return j(url, retry - 1); }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function resolveMbid(a) {
  const cands = [...new Set([a.name, a.nameOriginal, a.nameJa, ...(a.aliases || []), a.searchTerm].filter(Boolean))];
  for (const c of cands) {
    for (const q of [`"${String(c).replace(/"/g, '\\"')}"`, c]) {
      let d; try { d = await j(`${MB}/artist?query=${encodeURIComponent(q)}&fmt=json&limit=5`); } catch { continue; }
      const hit = (d.artists || []).find((x) => norm(x.name) === norm(c) && (x.score ?? 0) >= 90);
      if (hit) return hit.id;
      await wait(RATE_MS);
    }
  }
  return null;
}

/** MusicBrainz url 관계 → 정규화된 링크 묶음 */
export function classifyUrls(rels) {
  const out = {};
  const put = (k, url) => { if (!out[k]) out[k] = url; };
  for (const r of rels) {
    const u = r.url?.resource; if (!u) continue;
    const t = r.type; const h = u.toLowerCase();
    if (t === 'official homepage') put('official', u);
    else if (t === 'youtube') put('youtube', u);
    else if (t === 'fanpage') put('fanpage', u);
    else if (t === 'social network') {
      if (/twitter\.com|x\.com/.test(h)) put('x', u);
      else if (/instagram\.com/.test(h)) put('instagram', u);
      else if (/facebook\.com/.test(h)) put('facebook', u);
      else if (/tiktok\.com/.test(h)) put('tiktok', u);
      else if (/weverse\.io/.test(h)) put('weverse', u);
    }
    else if (t === 'purchase for mail-order') {
      if (/tower\.jp/.test(h)) put('tower', u);
      else if (/hmv\.co\.jp/.test(h)) put('hmv', u);
      else if (/amazon\.co\.jp/.test(h)) put('amazonJp', u);
      else put('shop', u);
    }
    else if (t === 'streaming' || t === 'free streaming') {
      if (/music\.apple\.com/.test(h)) put('appleMusic', u);
      else if (/spotify\.com/.test(h)) put('spotify', u);
    }
    else if (t === 'wikidata') put('wikidata', u);
  }
  return out;
}

export async function backfillLinks(artists, { log = () => {}, recheckDays = 30 } = {}) {
  let filled = 0, missing = 0, failed = 0, skipped = 0;
  const now = Date.now();
  for (const a of artists) {
    if (a.linksCheckedAt && (now - Date.parse(a.linksCheckedAt)) / 864e5 < recheckDays) { skipped++; continue; }
    try {
      const mbid = a.mbid || a.operatorMbid || (await resolveMbid(a));
      await wait(RATE_MS);
      if (!mbid) { missing++; a.linksCheckedAt = new Date().toISOString(); log(`  · ${a.name} — MusicBrainz 미등록`); continue; }
      a.mbid = mbid;
      const d = await j(`${MB}/artist/${mbid}?inc=url-rels&fmt=json`);
      await wait(RATE_MS);
      const auto = classifyUrls((d.relations || []).filter((r) => r['target-type'] === 'url'));
      // 사람이 넣은 값은 유지, 자동 값은 덮어쓴다
      const manual = Object.fromEntries(Object.entries(a.links || {}).filter(([, v]) => v && typeof v === 'object' && v.manual));
      a.links = { ...Object.fromEntries(Object.entries(auto).map(([k, v]) => [k, { url: v, source: 'musicbrainz' }])), ...manual };
      a.linksSource = 'musicbrainz';
      a.linksCheckedAt = new Date().toISOString();
      const n = Object.keys(a.links).length;
      if (n) { filled++; log(`  ✓ ${a.name} — ${Object.keys(auto).join(', ')}`); }
      else { missing++; log(`  · ${a.name} — URL 관계 없음`); }
    } catch (e) {
      failed++; log(`  ✗ ${a.name} — ${e.message}`); await wait(3000);
    }
  }
  return { filled, missing, failed, skipped };
}
