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
      const r = await fetch(url, { headers: { 'user-agent': UA } });
      const t = await r.text();
      if (t.trim().startsWith('{')) return JSON.parse(t);
    } catch { /* 재시도 */ }
    await sleep(600 * (i + 1) + Math.random() * 400);
  }
  return null;
}

/** "A & B", "A feat. B", "아이유 (IU)" 같은 표기에서 대표명만 뽑는다 */
function mainArtistName(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.split(/\s*(?:&|feat\.|ft\.|with|,|×|,)\s*/i)[0].trim();
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
function classify(genre, name, appleName) {
  const g = String(genre || '');
  const gl = g.toLowerCase();
  if (gl.includes('k-pop') || gl.includes('케이팝')) return 'kr';
  if (gl.includes('j-pop') || gl.includes('제이팝') || gl.includes('j-rock')) return 'jp';

  /* Apple은 각국 스토어의 언어로 장르를 준다.
     장르가 가나로 적혀 있으면(ロック, オルタナティブ) 일본 스토어의 일본 아티스트다.
     Mrs. GREEN APPLE·King Gnu·Vaundy처럼 이름이 로마자여도 이 신호로 잡힌다. */
  if (hasKana(g)) return 'jp';
  if (hasHangul(g)) return 'kr';

  const text = `${name} ${appleName || ''}`;
  if (hasHangul(text)) return 'kr';
  if (hasKana(text) || hasKanji(text)) return 'jp';
  return null;   // 판정 불가 → 대상 아님
}

/** Apple 카탈로그에서 아티스트 메타데이터를 채운다 (양국 스토어를 모두 조회) */
async function enrich(name, preferCountry) {
  const order = preferCountry === 'kr' ? ['kr', 'jp'] : ['jp', 'kr'];
  for (const cc of order) {
    const s = await getJson(`https://itunes.apple.com/search?media=music&entity=musicArtist&country=${cc}&limit=1&term=${encodeURIComponent(name)}`);
    const hit = s?.results?.[0];
    if (!hit?.artistId) { await sleep(400); continue; }
    // 대표곡 아트워크를 프로필 이미지로 쓴다 (아티스트 엔티티는 이미지를 주지 않는다)
    const t = await getJson(`https://itunes.apple.com/search?media=music&entity=song&country=${cc}&limit=1&term=${encodeURIComponent(name)}`);
    const track = t?.results?.[0];
    return {
      appleArtistId: hit.artistId,
      appleName: hit.artistName,
      genre: hit.primaryGenreName || '',
      official: hit.artistLinkUrl || null,
      artwork: (track?.artworkUrl100 || '').replace('100x100', '600x600') || null,
      foundIn: cc,
    };
  }
  return null;
}

async function main() {
  const charts = JSON.parse(await readFile(path.join(DB, 'charts.json'), 'utf-8'));
  let prev = [];
  try { prev = JSON.parse(await readFile(path.join(DB, 'artists.json'), 'utf-8')); } catch { /* 최초 실행 */ }
  const prevById = new Map(prev.map((a) => [a.id, a]));

  const collected = new Map();   // appleArtistId → 아티스트 (동일 팀의 표기 차이를 흡수)
  const quota = { jp: 0, kr: 0 };

  for (const [code, bucket] of Object.entries(charts.countries || {})) {
    const label = code === 'jp' ? '일본' : '한국';
    const ranked = rankArtists(bucket);
    console.log(`\n=== ${label}(${code}) 차트 아티스트 ${ranked.length}팀 ===`);

    for (const cand of ranked) {
      if (quota.jp >= PER_COUNTRY && quota.kr >= PER_COUNTRY) break;
      const { primary, secondary } = splitNames(cand.name);

      const meta = await enrich(primary, code);
      if (!meta) { console.log(`  [건너뜀] ${primary}: Apple 카탈로그 미확인`); continue; }

      // 같은 아티스트를 다른 표기로 이미 담았으면 차트 노출만 합산한다
      const dup = collected.get(meta.appleArtistId);
      if (dup) {
        dup.chartHits += cand.hits;
        dup.bestRank = Math.min(dup.bestRank ?? 999, cand.best);
        if (!dup.aliasNames.includes(primary)) dup.aliasNames.push(primary);
        continue;
      }

      // 국적 판정 — K-POP/J-POP이 아니면(서구 팝 등) 이 서비스의 대상이 아니다
      const country = classify(meta.genre, cand.name, meta.appleName);
      if (!country) { console.log(`  [제외] ${primary}: ${meta.genre || '장르 불명'} — 한·일 아티스트 아님`); await sleep(180); continue; }
      if (quota[country] >= PER_COUNTRY) { await sleep(150); continue; }

      quota[country]++;
      const id = slug(primary);
      const old = prevById.get(id);
      collected.set(meta.appleArtistId, {
        id,
        name: secondary || primary,               // 한국 사용자에게 익숙한 표기를 우선
        nameOriginal: primary,
        nameJa: old?.nameJa || (country === 'jp' ? primary : null),
        country,
        genre: country === 'jp' ? 'J-POP' : 'K-POP',
        appleGenre: meta.genre,
        searchTerm: meta.appleName || primary,
        appleArtistId: meta.appleArtistId,
        artwork: meta.artwork,
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
    out.push({ ...a, country: a.country || 'jp', chartHits: 0, retained: true });
    seen.add(a.id);
  }

  await writeFile(path.join(DB, 'artists.json'), JSON.stringify(out, null, 2));
  const byCountry = out.reduce((m, a) => ({ ...m, [a.country]: (m[a.country] || 0) + 1 }), {});
  console.log(`\n[완료] 아티스트 ${out.length}팀 저장`, byCountry);
}

main().catch((e) => { console.error(e); process.exit(1); });
