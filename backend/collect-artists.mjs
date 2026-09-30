/**
 * 아티스트 로스터 자동 생성 (한국 · 일본 양국)
 *
 * 왜 자동인가
 *   손으로 고른 10팀에 묶어두면 신인·역주행 아티스트를 영원히 놓친다.
 *   차트에 실제로 오른 아티스트를 노출 빈도순으로 채택하면 로스터가 스스로 갱신된다.
 *
 * 실행: node backend/collect-artists.mjs [--per=20]
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAppleIdentity, itunesThrottle } from './lib/live/artist-info.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(__dirname, '../db');
const PER_COUNTRY = Number(process.argv.find((a) => a.startsWith('--per='))?.split('=')[1]) || 20;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* iTunes는 짧은 시간에 요청이 몰리면 빈 응답을 준다.
   실패를 '없는 아티스트'로 오판하면 로스터가 텅 비므로 넉넉히 재시도한다. */
async function getJson(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      if (/itunes\.apple\.com/.test(url)) await itunesThrottle();
      const r = await fetch(url, { headers: { 'user-agent': UA } });
      const t = await r.text();
      if (t.trim().startsWith('{')) return { ok: true, data: JSON.parse(t) };
    } catch { /* 재시도 */ }
    await sleep(600 * (i + 1) + Math.random() * 400);
  }
  /* ⚠️ null 을 돌려주면 호출부가 '응답은 왔는데 결과가 없다'와 구분하지 못한다.
     실제로 그래서 BE:FIRST·ENHYPEN·Number_i 같은 팀이 "Apple 카탈로그 미확인"으로
     로스터에서 조용히 빠졌다. 확인해 보니 iTunes 가 빈 응답(0B)을 주는
     레이트리밋이었고, 아티스트는 멀쩡히 존재했다. */
  return { ok: false, data: null };
}

/** "A & B", "A feat. B", "아이유 (IU)" 같은 표기에서 대표명만 뽑는다 */
/* "&" 는 협업 표시일 수도, 팀 이름의 일부일 수도 있다(King & Prince, Hey! Say! JUMP & …).
   알려진 팀 이름(TEAM_WITH_AMP)이나 "A & B"가 한 팀으로 차트에 반복해 나오면 자르지 않는다 — 수집기가 Apple에서 이름이 정확히 같은 팀을 확인한다. */
const TEAM_WITH_AMP = new Set();
const AMP_ORIGINAL = new Map(); // 소문자 → 차트 표기
function mainArtistName(raw) {
  let s = String(raw || '').replace(/&amp;/g, '&').trim();
  if (!s) return '';
  s = s.split(/\s*(?:feat\.|ft\.|\bwith\b|,|×|、)\s*/i)[0].trim();
  if (/\s&\s/.test(s) && !TEAM_WITH_AMP.has(s.toLowerCase())) s = s.split(/\s*&\s*/)[0].trim();
  return s.replace(/\s+/g, ' ').slice(0, 40);
}

/** 괄호 안 한글/영문 병기에서 검색에 유리한 쪽을 고른다 (예: "BIGBANG (빅뱅)") */
function splitNames(raw) {
  const m = String(raw || '').match(/^(.+?)\s*[（(]\s*([^)）]+)\s*[)）]\s*$/);
  if (!m) return { primary: raw.trim(), secondary: null };
  return { primary: m[1].trim(), secondary: m[2].trim() };
}

const slug = (s) => String(s).toLowerCase()
  .replace(/[^a-z0-9가-힣ぁ-んァ-ヶ一-龥]+/g, '-')
  .replace(/^-+|-+$/g, '').slice(0, 32) || 'artist';

/** 차트에서 아티스트를 노출 빈도순으로 뽑는다 */
function rankArtists(bucket) {
  const freq = new Map();
  /* "A & B" 가 여러 차트·여러 곡에 그대로 나오면 한 팀 이름으로 본다(협업은 곡마다 조합이 바뀐다) */
  const amp = new Map();
  for (const list of Object.values(bucket || {})) if (Array.isArray(list)) for (const e of list) { const a = String(e?.artist || '').replace(/&amp;/g, '&').trim(); if (/^[^,×]+\s&\s[^,×]+$/.test(a) && !/feat\.|ft\./i.test(a)) amp.set(a.toLowerCase(), (amp.get(a.toLowerCase()) || 0) + 1); }
  for (const [k, n] of amp) if (n >= 2) TEAM_WITH_AMP.add(k);
  for (const list of Object.values(bucket || {})) if (Array.isArray(list)) for (const e of list) { const a = String(e?.artist || '').replace(/&amp;/g, '&').trim(); if (TEAM_WITH_AMP.has(a.toLowerCase()) && !AMP_ORIGINAL.has(a.toLowerCase())) AMP_ORIGINAL.set(a.toLowerCase(), a); }
  for (const [src, list] of Object.entries(bucket || {})) {
    if (!Array.isArray(list)) continue;
    // 통합 차트는 다른 소스의 합이라 이중 계산이 된다
    if (src === 'combined') continue;
    for (const e of list) {
      const name = mainArtistName(e?.artist);
      if (!name || name.length < 2) continue;
      const cur = freq.get(name) || { name, hits: 0, best: 999, artwork: null };
      cur.hits += 1;
      cur.best = Math.min(cur.best, e.rank || 999);
      cur.artwork = cur.artwork || e.artwork || null;
      freq.set(name, cur);
    }
  }
  // 노출 횟수 우선, 같으면 최고 순위가 높은 쪽
  return [...freq.values()].sort((a, b) => b.hits - a.hits || a.best - b.best);
}

const hasHangul = (s) => /[가-힣]/.test(String(s));
const hasKana = (s) => /[ぁ-んァ-ヶ]/.test(String(s));
const hasKanji = (s) => /[一-龥]/.test(String(s));

/**
 * 아티스트 국적 판정
 *  Apple의 장르(K-Pop / J-Pop)를 1순위 근거로 쓰고,
 *  장르가 애매하면(록·트로트 등) 표기 문자로 판정한다.
 *  둘 다 해당 없으면 서구 아티스트로 보고 제외한다.
 */
/* 국적 판정.
   반환: { country, sure } — sure=false 면 추가 검증이 필요하다는 뜻이다. */
function classify(genre, name, appleName) {
  const g = String(genre || '');
  const gl = g.toLowerCase();
  if (gl.includes('k-pop') || gl.includes('케이팝')) return { country: 'kr', sure: true };
  if (gl.includes('j-pop') || gl.includes('제이팝') || gl.includes('j-rock')) return { country: 'jp', sure: true };

  const text = `${name} ${appleName || ''}`;
  if (hasHangul(text)) return { country: 'kr', sure: true };
  if (hasKana(text) || hasKanji(text)) return { country: 'jp', sure: true };

  /* Apple은 각국 스토어의 언어로 장르를 준다.
     ⚠️ 이 신호만으로 판정하면 안 된다. 해당 스토어에 유통되는 '외국' 아티스트도
        현지어 장르를 받기 때문이다. 실제로 Lady Gaga 가 장르 "테크노" 하나로
        country:kr / genre:K-POP 으로 로스터에 들어와 있었다.
        이름이 로마자인 경우(Mrs. GREEN APPLE·King Gnu 처럼 진짜 일본 팀일 수도,
        Lady Gaga 처럼 외국 팀일 수도 있다)는 확정하지 않고 넘긴다. */
  if (hasKana(g)) return { country: 'jp', sure: false };
  if (hasHangul(g)) return { country: 'kr', sure: false };
  return { country: null, sure: true };   // 판정 불가 → 대상 아님
}

/** MusicBrainz 로 국적을 확인한다 (애매한 경우에만 부른다) */
async function verifyCountry(name) {
  try {
    const r = await fetch(
      `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`"${name}"`)}&fmt=json&limit=3`,
      { headers: { 'user-agent': 'Lilac/1.0 ( https://github.com/sabill123/Lilac )' } },
    );
    if (!r.ok) return null;                       // 못 물어봤다 — 판정하지 않는다
    const d = await r.json();
    const hit = (d.artists || []).find(
      (a) => String(a.name).toLowerCase() === String(name).toLowerCase() && (a.score ?? 0) >= 90,
    );
    if (!hit) return null;
    const cc = hit.country || hit.area?.['iso-3166-1-codes']?.[0] || null;
    return cc ? cc.toUpperCase() : null;
  } catch {
    return null;
  }
}

/** Apple 카탈로그에서 아티스트 메타데이터를 채운다 (양국 스토어를 모두 조회) */
/** 조회 결과는 세 가지다: 찾음 / 정말 없음 / 못 물어봄(실패).
 *  셋을 뭉뚱그리면 레이트리밋이 '존재하지 않는 아티스트'로 둔갑한다. */
async function enrich(name, preferCountry) {
  const order = preferCountry === 'kr' ? ['kr', 'jp'] : ['jp', 'kr'];
  let anyRequestFailed = false;
  for (const cc of order) {
    const s = await getJson(`https://itunes.apple.com/search?media=music&entity=musicArtist&country=${cc}&limit=5&term=${encodeURIComponent(name)}`);
    if (!s.ok) { anyRequestFailed = true; await sleep(800); continue; }
    /* ⚠️ 첫 결과를 그대로 쓰면 동명이인·다른 팀이 붙는다(로제 → Pascal Rogé, 星野源 → aespa).
       이름이 같은 결과를 먼저, 없으면 첫 결과를 위키백과 영어 이름·로마자 비교로 확인한다. */
    const results = s.data?.results || [];
    const lo = (x) => String(x || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9가-힣぀-ヿ一-龯]/g, '');
    const first = results.find((r) => lo(r.artistName) === lo(name)) || results[0] || null;
    let hit = null;
    let v = null;
    if (first) {
      try { v = await checkAppleIdentity({ names: [name], appleName: first.artistName, appleId: first.artistId, appleGenre: first.primaryGenreName || null, country: preferCountry === 'kr' ? 'kr' : 'jp', charting: true }); } catch { anyRequestFailed = true; await sleep(800); continue; }
      if (v.status === 'ok' || v.status === 'unknown') hit = first;
      else if (v.status === 'fixed') hit = { artistId: v.appleArtistId, artistName: v.appleName, primaryGenreName: v.genre, artistLinkUrl: v.official };
      else { await sleep(400); continue; }
    }
    if (!hit?.artistId) { await sleep(400); continue; }
    /* 프로필 이미지: 그 아티스트(ID)의 최근 음반 표지. 예전엔 이름으로 곡을 검색해 첫 곡 표지를 써서 다른 가수 표지가 붙기도 했다 */
    const t = v?.artwork ? null : await getJson(`https://itunes.apple.com/lookup?id=${hit.artistId}&entity=album&limit=3&sort=recent&country=${cc}`);
    const album = t?.ok ? (t.data?.results || []).find((x) => x.wrapperType === 'collection' && x.artworkUrl100) : null;
    return {
      found: true,
      appleArtistId: hit.artistId,
      appleName: hit.artistName,
      genre: hit.primaryGenreName || '',
      official: hit.artistLinkUrl || null,
      artwork: v?.artwork || (album?.artworkUrl100 || '').replace('100x100', '600x600') || null,
      foundIn: cc,
    };
  }
  return anyRequestFailed ? { failed: true } : { notFound: true };
}

async function main() {
  const charts = JSON.parse(await readFile(path.join(DB, 'charts.json'), 'utf-8'));
  let prev = [];
  try { prev = JSON.parse(await readFile(path.join(DB, 'artists.json'), 'utf-8')); } catch { /* 최초 실행 */ }
  const prevById = new Map(prev.map((a) => [a.id, a]));

  const collected = new Map();   // appleArtistId → 아티스트 (동일 팀의 표기 차이를 흡수)
  const quota = { jp: 0, kr: 0 };
  const lookupFailures = [];     // 못 물어본 팀 — '없는 팀'과 구분해 보고한다

  for (const [code, bucket] of Object.entries(charts.countries || {})) {
    const label = code === 'jp' ? '일본' : '한국';
    const ranked = rankArtists(bucket);
    console.log(`\n=== ${label}(${code}) 차트 아티스트 ${ranked.length}팀 ===`);

    for (const cand of ranked) {
      if (quota.jp >= PER_COUNTRY && quota.kr >= PER_COUNTRY) break;
      let { primary, secondary } = splitNames(cand.name);

      let meta = await enrich(primary, code);
      /* "A & B"를 한 팀으로 찾았는데 Apple에 그런 팀이 없으면 협업이다 — 앞 이름으로 다시 */
      if (meta.notFound && /\s&\s/.test(primary)) {
        primary = primary.split(/\s*&\s*/)[0].trim();
        meta = await enrich(primary, code);
      }
      if (meta.failed) {
        lookupFailures.push(primary);
        console.log(`  [보류] ${primary}: 조회 실패(레이트리밋 등) — 다음 실행에서 재시도`);
        await sleep(900);
        continue;
      }
      if (meta.notFound) { console.log(`  [건너뜀] ${primary}: Apple 카탈로그에 없음`); continue; }

      // 같은 아티스트를 다른 표기로 이미 담았으면 차트 노출만 합산한다
      const dup = collected.get(meta.appleArtistId);
      if (dup) {
        dup.chartHits += cand.hits;
        dup.bestRank = Math.min(dup.bestRank ?? 999, cand.best);
        if (!dup.aliasNames.includes(primary)) dup.aliasNames.push(primary);
        continue;
      }

      // 국적 판정 — K-POP/J-POP이 아니면(서구 팝 등) 이 서비스의 대상이 아니다
      const verdict = classify(meta.genre, cand.name, meta.appleName);
      let country = verdict.country;
      if (!country) { console.log(`  [제외] ${primary}: ${meta.genre || '장르 불명'} — 한·일 아티스트 아님`); await sleep(180); continue; }

      /* 현지어 장르만으로 짐작한 경우는 MusicBrainz 국적으로 확인한다.
         (Lady Gaga 가 "테크노" 하나로 K-POP 이 되던 자리) */
      if (!verdict.sure) {
        const cc = await verifyCountry(meta.appleName || primary);
        await sleep(1200);                       // MusicBrainz 초당 1회
        if (cc && cc !== 'JP' && cc !== 'KR') {
          console.log(`  [제외] ${primary}: MusicBrainz 국적 ${cc} — 한·일 아티스트 아님`);
          continue;
        }
        if (cc === 'JP' || cc === 'KR') country = cc.toLowerCase();
        // cc 가 null(못 물어봤거나 등록 없음)이면 장르 신호를 그대로 쓴다
      }
      if (quota[country] >= PER_COUNTRY) { await sleep(150); continue; }

      quota[country]++;
      /* 예전에 "&" 앞부분만으로 만든 행(King & Prince → king)이 있으면 그 id를 이어 쓴다(팬클럽·커뮤니티가 그 id를 쓴다) */
      const firstSlug = /\s&\s/.test(primary) ? slug(primary.split(/\s*&\s*/)[0]) : null;
      const id = prevById.has(slug(primary)) || !firstSlug || !prevById.has(firstSlug) ? slug(primary) : firstSlug;
      const old = prevById.get(id);
      /* 서버 신원 확인(repairRoster)이 고친 Apple 연결은, 같은 이름으로 다시 수집될 때만 지킨다 */
      const keepFix = !!(old?.appleFix && old.nameOriginal === primary && String(old.appleArtistId || '') !== String(meta.appleArtistId));
      collected.set(meta.appleArtistId, {
        /* ⚠️ 이전 레코드를 통째로 깔고 시작한다.
           예전엔 필요한 필드만 골라 이어받아서, 여기 안 적힌 값은 재수집 때마다
           조용히 사라졌다. 실제로 operatorSource / operatorMbid 가 날아가
           MusicBrainz 가 채운 19팀 중 8팀이 '사람이 확인한 값'처럼 보였다.
           (화면은 operatorSource 로 '(자동 수집)' 표기를 결정한다)
           보존이 기본, 덮어쓰기는 아래에 명시한 것만. */
        ...(old || {}),
        id,
        name: secondary || primary,               // 한국 사용자에게 익숙한 표기를 우선
        nameOriginal: primary,
        nameJa: (id === firstSlug ? null : old?.nameJa) || (country === 'jp' ? primary : null),
        country,
        genre: country === 'jp' ? 'J-POP' : 'K-POP',
        appleGenre: meta.genre,
        /* 신원 확인(서버 repairRoster)이 고친 행은 그 결과를 지킨다 */
        searchTerm: keepFix ? old.searchTerm : meta.appleName || primary,
        appleArtistId: keepFix ? old.appleArtistId : meta.appleArtistId,
        // 아트워크는 새로 받은 게 있으면 갱신하되, 없으면 기존 값을 지키지 않는다
        artwork: keepFix ? old.artwork : meta.artwork || (id === firstSlug ? null : old?.artwork) || null,
        ...(id === firstSlug ? { aliases: [], appleFix: undefined } : {}),
        official: old?.official || meta.official,
        operator: old?.operator || null,
        chartHits: cand.hits,
        bestRank: cand.best === 999 ? null : cand.best,
        aliases: old?.aliases || [],
        aliasNames: [primary, secondary].filter(Boolean),
      });
      console.log(`  [${country}] ${primary}${secondary ? ` (${secondary})` : ''} — ${meta.genre}, 차트 ${cand.hits}회, 최고 ${cand.best}위`);
      await sleep(420);
    }
  }

  const out = [...collected.values()].map((a) => {
    // 표기 변형은 검색 별칭으로 흡수한다
    const extra = a.aliasNames.filter((n) => n && n !== a.name);
    return { ...a, aliases: [...new Set([...a.aliases, ...extra])], aliasNames: undefined };
  });
  const seen = new Set(out.map((a) => a.id));

  // 기존 아티스트 중 차트에서 빠진 팀도 유지한다 (상품·플레이리스트가 참조하고 있다)
  for (const a of prev) {
    if (seen.has(a.id)) continue;
    /* 예전 수집이 "&"에서 잘라 만든 행(King & Prince → King): 차트에 "King & Prince"가 팀 이름으로 있으면 이름을 되돌리고
       Apple 연결은 비워서 서버 신원 확인이 다시 찾게 한다(잘린 이름으로 붙은 Nat "King" Cole 같은 연결을 버린다) */
    const cut = String(a.nameOriginal || a.name || '').toLowerCase();
    const full = [...TEAM_WITH_AMP].find((t) => t.split(/\s*&\s*/)[0] === cut && t !== cut);
    if (full) {
      const orig = AMP_ORIGINAL.get(full) || full;
      console.log(`  [이름 복구] ${a.name} → ${orig}`);
      Object.assign(a, { name: orig, nameOriginal: orig, nameJa: a.country === 'jp' ? orig : a.nameJa, searchTerm: orig, appleArtistId: null, artwork: null, artworkSource: null, aliases: [], appleFix: { status: 'none', reason: 'amp-split', from: { appleArtistId: a.appleArtistId || null, appleName: a.searchTerm || null }, at: new Date().toISOString() } });
    }
    out.push({ ...a, country: a.country || 'jp', chartHits: 0, retained: true });
    seen.add(a.id);
  }

  await writeFile(path.join(DB, 'artists.json'), JSON.stringify(out, null, 2));
  const byCountry = out.reduce((m, a) => ({ ...m, [a.country]: (m[a.country] || 0) + 1 }), {});
  console.log(`\n[완료] 아티스트 ${out.length}팀 저장`, byCountry);
  if (lookupFailures.length) {
    console.warn(
      `[주의] 조회 실패 ${lookupFailures.length}팀 — 로스터에서 빠진 게 아니라 못 물어본 것이다.` +
      `\n        ${lookupFailures.slice(0, 12).join(', ')}${lookupFailures.length > 12 ? ' …' : ''}` +
      `\n        잠시 뒤 다시 실행하면 채워진다.`,
    );
  }
}

/* 서버가 주기적으로 부를 수 있게 내보낸다.
   로스터가 44팀에 머물러 있던 건 상한(--per) 탓만이 아니라,
   애플 레이트리밋으로 조회가 실패한 팀이 매번 그대로 빠졌기 때문이다.
   이제 실패는 '보류'로 남고, 주기 실행이 알아서 다시 시도한다. */
export { main as collectArtists };

const runDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (runDirectly) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
