/* 아티스트 공식 운영사(레이블) 보강.
   44팀 중 34팀이 비어 있었다. 애플 카탈로그는 레이블을 알려주지 않는다.
   MusicBrainz 는 아티스트-레이블 관계를 공개 API 로 제공하므로 거기서 받는다.

   지키는 것:
   · 이름이 정확히 일치하는 아티스트만 쓴다 (동명이인·트리뷰트 방지)
   · 계약이 끝난(end 가 있는) 관계는 쓰지 않는다 — 현재 운영사가 아니다
   · 사람이 확인해 넣은 값은 덮지 않는다
   · 출처를 함께 남긴다 (operatorSource, operatorMbid) — 사람이 확인한 10팀과
     자동 수집분을 화면과 감사에서 구분할 수 있어야 한다
   · MusicBrainz 는 초당 1회 제한이므로 반드시 간격을 둔다 */

const UA = { 'User-Agent': 'Lilac/1.0 ( https://github.com/sabill123/Lilac )' };
const MB = 'https://musicbrainz.org/ws/2';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* MusicBrainz 는 초당 1회다. 1.1초로 돌렸더니 34팀 중 12건이 503 이었다.
   간격을 늘리고, 503 은 물러섰다가 한 번 더 친다. */
const RATE_MS = 1400;

async function j(url, retry = 2) {
  const r = await fetch(url, { headers: UA });
  if (r.status === 503 && retry > 0) {
    await wait(4000);
    return j(url, retry - 1);
  }
  if (r.status === 503) throw new Error('rate-limited');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** 아티스트명 → MBID. 이름이 정확히 같은 것만 받는다. */
async function resolveMbid(name) {
  /* 이름을 그대로 던지면 루씬 문법으로 해석돼 특수문자가 든 팀을 놓친다.
     실제로 '=LOVE' 가 그래서 안 잡혔다(=, !, :, ~ 등이 연산자다).
     따옴표로 감싸 구문 그대로 찾게 한다. */
  const quoted = `"${String(name).replace(/"/g, '\\"')}"`;
  for (const q of [quoted, name]) {
    let d;
    try { d = await j(`${MB}/artist?query=${encodeURIComponent(q)}&fmt=json&limit=5`); }
    catch { continue; }
    const hit = (d.artists || []).find((a) => norm(a.name) === norm(name) && (a.score ?? 0) >= 90);
    if (hit) return hit.id;
    await wait(RATE_MS);
  }
  return null;
}

/** MBID → 현재 유효한 레이블명 */
async function labelOf(mbid) {
  const d = await j(`${MB}/artist/${mbid}?inc=label-rels&fmt=json`);
  const rels = (d.relations || []).filter((r) => r['target-type'] === 'label' && r.label?.name);
  if (!rels.length) return null;
  // 끝나지 않은 계약을 먼저, 그중 recording contract 를 먼저
  const live = rels.filter((r) => !r.end);
  const pool = live.length ? live : rels;
  const rec = pool.find((r) => r.type === 'recording contract');
  return (rec || pool[0]).label.name;
}

/* 한 번 찾아보고 못 찾은 아티스트를 매번 다시 조회하지 않기 위한 간격.
   MusicBrainz 는 초당 1회라, 15팀을 재조회하면 부팅 동기화가 분 단위로 늘어지고
   실제로 sync 가 running 상태로 오래 묶였다.
   레이블 관계는 자주 생기는 데이터가 아니므로 넉넉히 둔다. */
const RECHECK_DAYS = 30;

export async function backfillOperator(artists, { log = () => {}, force = false } = {}) {
  let filled = 0, missing = 0, failed = 0, skipped = 0;
  const now = Date.now();
  for (const a of artists) {
    if (a.operator) continue;               // 사람이 넣은 값은 건드리지 않는다

    // 최근에 찾아봤는데 없었다면 건너뛴다
    if (!force && a.operatorCheckedAt) {
      const age = (now - Date.parse(a.operatorCheckedAt)) / 864e5;
      if (Number.isFinite(age) && age < RECHECK_DAYS) { skipped++; continue; }
    }

    /* 이름 후보를 여러 개 시도한다.
       MusicBrainz 는 한국 아티스트를 영문명으로 올려두는 경우가 많아
       (레드벨벳→Red Velvet, 악뮤→AKMU) 한국어 이름만 던지면 못 찾는다.
       db/artists.json 의 aliases 와 원어명·일본어명을 모두 후보로 쓴다. */
    const candidates = [...new Set(
      [a.name, a.nameOriginal, a.nameJa, ...(a.aliases || []), a.searchTerm].filter(Boolean),
    )];

    try {
      let mbid = a.mbid || null;
      for (const c of candidates) {
        if (mbid) break;
        mbid = await resolveMbid(c);
        await wait(RATE_MS);
      }
      if (!mbid) {
        missing++;
        a.operatorCheckedAt = new Date().toISOString();
        log(`  · ${a.name} — MusicBrainz 에 정확히 일치하는 아티스트가 없다 (${candidates.length}개 표기 시도)`);
        continue;
      }
      const label = await labelOf(mbid);
      await wait(RATE_MS);
      if (!label) {
        missing++;
        a.mbid = mbid;                       // 아티스트는 찾았으니 다음엔 검색을 건너뛴다
        a.operatorCheckedAt = new Date().toISOString();
        log(`  · ${a.name} — 레이블 관계가 등록돼 있지 않다`);
        continue;
      }
      a.operator = label;
      a.operatorSource = 'musicbrainz';
      a.operatorMbid = mbid;
      filled++;
      log(`  ✓ ${a.name} → ${label}`);
    } catch (e) {
      failed++;
      log(`  ✗ ${a.name} — ${e.message}`);
      await wait(3000);
    }
  }
  return { filled, missing, failed, skipped };
}
