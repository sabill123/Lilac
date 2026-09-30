#!/usr/bin/env node
/** Run: node tests/verify-discovery-model.mjs
 * Executes real TS via the frontend's declared TypeScript dependency.
 * Pure fixtures only: no browser, network, catalog or private-state reads. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
const file = new URL('../frontend/src/discovery/model.ts', import.meta.url);
const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 }, reportDiagnostics: true,
});
assert.equal(compiled.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
const model = {};
vm.runInNewContext(compiled.outputText, { exports: model, URL, require(name) {
  assert.fail(`Discovery must not import state or external dependencies: ${name}`);
} }, { filename: file.pathname });
const { trackKey, sourceFamilies, rankMovement, risingTracks, newEntryTracks,
  spotlightTracks, selectArtists, rookieEvidence, chartFreshness } = model;
const track = (title, patch = {}) => ({ rank: 5, title, artist: 'Example Band', ...patch });
const names = list => Array.from(list, t => t.title);
const plain = object => JSON.parse(JSON.stringify(object));
let passed = 0;
const failures = [];
function check(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.stack}`); }
}
const now = Date.parse('2026-09-05T12:00:00Z');
const evidence = (patch = {}) => ({ artistId: 'rookie', date: '2025-09-05',
  sourceUrl: 'https://official.example/artist/debut', sourceLabel: '공식 데뷔 이력',
  verifiedAt: '2026-09-05', ...patch });

check('exact NFKC tuple keys retain full titles, punctuation and artist identity', () => {
  assert.equal(trackKey(track('ＢＬＵＥ', { artist: 'ＡＢＣ' })), trackKey(track(' blue ', { artist: 'abc' })));
  assert.notEqual(trackKey(track('Blue')), trackKey(track('Blue', { artist: 'Other Band' })));
  assert.notEqual(trackKey(track('Long song title first mix')), trackKey(track('Long song title second mix')));
  assert.notEqual(trackKey(track('A-B')), trackKey(track('AB')));
  assert.notEqual(trackKey(track('c', { artist: 'a|b' })), trackKey(track('b|c', { artist: 'a' })));
  for (const item of [null, undefined, {}, track(''), track('Name', { artist: '' }), track(5)]) assert.equal(trackKey(item), '');
});
check('provider rank movement accepts only flags consistent with positive integer ranks', () => {
  for (const [patch, expected] of [
    [{ move: 'up', lastRank: 15 }, { kind: 'up', delta: 10 }],
    [{ move: 'down', lastRank: 1 }, { kind: 'down', delta: 4 }],
    [{ move: 'same', lastRank: 5 }, { kind: 'same', delta: 0 }],
    [{ move: null, lastRank: 5 }, { kind: 'same', delta: 0 }],
    [{ move: '', lastRank: 5 }, { kind: 'same', delta: 0 }],
    [{ move: 'new', lastRank: null }, { kind: 'new', delta: null }],
  ]) assert.deepEqual(plain(rankMovement(track('A', patch))), expected);
  for (const patch of [
    { move: 'up', lastRank: 1 }, { move: 'down', lastRank: 15 }, { move: 'up', lastRank: 5 },
    { move: 'same', lastRank: 15 }, { move: 'new', lastRank: 1 }, { move: 'new', lastRank: 0 },
    { move: 'NEW' }, { move: 'mystery', lastRank: 5 }, { lastRank: 15 },
    { move: 'up', lastRank: 15, source: 'combined' }, { move: 'up', lastRank: 15, source: 'apple' },
  ]) assert.equal(rankMovement(track('A', patch)).kind, 'unknown');
  for (const invalid of [null, undefined, -1, 0, 1.5, '5', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(rankMovement(track('A', { rank: invalid, move: 'new' })).kind, 'unknown');
    assert.equal(rankMovement(track('A', { lastRank: invalid, move: 'up' })).kind, 'unknown');
  }
  assert.equal(rankMovement(null).kind, 'unknown');
  assert.equal(rankMovement(track('Combined', { ranks: { apple: 1, billboard: 5 } })).kind, 'unknown');
});
check('rising is consistent movement, not high rank, views or new entry; sorted and deduped', () => {
  const tracks = [track('Small', { move: 'up', lastRank: 6 }), track('Big', { move: 'up', lastRank: 25 }),
    track('New', { rank: 1, move: 'new' }), track('Bad', { move: 'up', lastRank: 1 }),
    track('Popular', { rank: 1, ytViews: 999999999 }), track('Big', { move: 'up', lastRank: 25 }),
    track('Tie', { rank: 2, move: 'up', lastRank: 22 }), null];
  assert.deepEqual(names(risingTracks(tracks)), ['Tie', 'Big', 'Small']);
  assert.deepEqual(names(risingTracks([...tracks].reverse(), 2)), ['Tie', 'Big']);
  assert.deepEqual(names(newEntryTracks(tracks)), ['New']);
});
check('families use valid ranks, dedupe Apple/RSS and ignore unknown or metadata-only sources', () => {
  assert.deepEqual(Array.from(sourceFamilies(track('A', { ranks: { apple: 1, appleRss: 2 } }))), ['apple']);
  assert.deepEqual(Array.from(sourceFamilies(track('A', { ranks: { apple: 1, appleRss: 2, billboard: 4, youtube: 8 } }))), ['apple', 'billboard']);
  for (const invalid of [null, undefined, 0, -1, 1.1, '1', NaN, Infinity]) {
    assert.deepEqual(Array.from(sourceFamilies(track('A', { ranks: { apple: invalid, billboard: invalid } }))), []);
  }
  assert.deepEqual(Array.from(sourceFamilies(track('A', { sources: ['apple', 'billboard'], ytViews: 5000 }))), []);
  assert.deepEqual(Array.from(sourceFamilies(track('A', { ranks: { unknown: 1, combined: 2, constructor: 3 } }))), []);
});
check('derived YouTube ranking cannot manufacture independent spotlight evidence', () => {
  const derived = track('Apple feeds plus derived views', { ranks: { apple: 1, appleRss: 2, youtube: 3 } });
  const independent = track('Billboard plus Apple', { ranks: { apple: 4, billboard: 5, youtube: 6 } });
  assert.deepEqual(Array.from(sourceFamilies(derived)), ['apple']);
  assert.deepEqual(Array.from(sourceFamilies(track('YouTube only', { ranks: { youtube: 1 } }))), []);
  assert.deepEqual(names(spotlightTracks([derived])), []);
  assert.deepEqual(names(spotlightTracks([derived, independent])), ['Billboard plus Apple']);
  assert.deepEqual(Array.from(sourceFamilies(independent)), ['apple', 'billboard']);
});
check('spotlight requires independent corroboration and sorts count then current rank', () => {
  const tracks = [track('Apple duplicate', { ranks: { apple: 1, appleRss: 1 } }),
    track('Two', { rank: 1, ranks: { apple: 1, billboard: 5 } }),
    track('Three', { rank: 20, ranks: { apple: 2, appleRss: 2, billboard: 2, oricon: 3 } }),
    track('Two later', { rank: 10, ranks: { melon: 2, genie: 3 } }),
    track('Invalid rank', { rank: -1, ranks: { melon: 2, genie: 3 } })];
  assert.deepEqual(names(spotlightTracks(tracks)), ['Three', 'Two', 'Two later']);
  assert.deepEqual(names(spotlightTracks([...tracks].reverse(), 2)), ['Three', 'Two']);
});
check('artist selection matches whole explicit aliases, never title, substring or phonetic guess', () => {
  const artists = [{ id: 'yoasobi', name: 'YOASOBI', nameJa: 'ヨアソビ', aliases: ['요아소비'] },
    { id: 'band', name: '미래 밴드', nameOriginal: 'Future Band', searchTerm: '未来バンド' },
    { id: 'none', name: 'No Charts' }];
  const tracks = [track('Official A', { artist: 'ＹＯＡＳＯＢＩ', rank: 3 }),
    track('Official B', { artist: '요아소비', rank: 8 }),
    track('Official C', { artist: 'Future Band', rank: 1 }),
    track('Official D', { artist: '未来バンド', rank: 5 }),
    track('YOASOBI', { artist: 'Unrelated Band', rank: 1 }),
    track('Misleading', { artist: 'YOASOBI Tribute', rank: 2 }),
    track('Misleading', { artist: 'You', rank: 2 }),
    track('Collaboration', { artist: 'YOASOBI & Future Band', rank: 2 })];
  const results = selectArtists(artists, tracks);
  assert.deepEqual(Array.from(results, r => [r.artist.id, r.bestRank, names(r.tracks)]), [
    ['band', 1, ['Official C', 'Official D']], ['yoasobi', 3, ['Official A', 'Official B']],
  ]);
  assert.equal(results[0].artist, artists[1]);
  assert.equal(selectArtists(artists, tracks, 1).length, 1);
  assert.equal(selectArtists([{ id: 'a', searchTerm: 'Alpha Beta' }], [track('Song', { artist: 'Alpha' })]).length, 0);
  assert.equal(selectArtists([{ id: 'a', aliases: ['Shared'] }, { id: 'b', aliases: ['Shared'] }], [track('A', { artist: 'Shared' })]).length, 0);
});
check('bilingual full-label pairs resolve automatically only to a unique shared owner', () => {
  const artists = [
    { id: 'cortis', name: '코르티스', aliases: ['CORTIS'] },
    { id: 'kiiikiii', name: 'KiiiKiii', aliases: ['키키'] },
    { id: 'other-kiki', name: 'Another Kiki', aliases: ['키키'] },
    { id: 'future-2040', name: 'Future Orbit', aliases: ['미래궤도'] },
  ];
  const rows = Object.freeze([
    Object.freeze(track('Future second', { rank: 8, artist: 'Ｆｕｔｕｒｅ Ｏｒｂｉｔ （미래궤도）' })),
    Object.freeze(track('Cortis song', { rank: 3, artist: 'CORTIS (코르티스)' })),
    Object.freeze(track('KiiiKiii song', { rank: 5, artist: 'KiiiKiii (키키)' })),
    Object.freeze(track('Future first', { rank: 1, artist: 'Future Orbit (미래궤도)' })),
    Object.freeze(track('Ambiguous bare alias', { rank: 2, artist: '키키' })),
  ]);
  const result = selectArtists(artists, rows);
  assert.deepEqual(Array.from(result, r => [r.artist.id, r.bestRank, names(r.tracks)]), [
    ['future-2040', 1, ['Future first', 'Future second']],
    ['cortis', 3, ['Cortis song']], ['kiiikiii', 5, ['KiiiKiii song']],
  ]);
  assert.equal(result[0].tracks[0], rows[3], 'Preserve original row object and rank');
  assert.equal(result[0].tracks[1], rows[0]);
  assert.equal(rows[0].rank, 8, 'Never reorder or rewrite the input');
});
check('bilingual matching rejects conflicts, unknown halves, ambiguous intersections and fuzzy syntax', () => {
  const artists = [{ id: 'a', name: 'KnownA', aliases: ['알파'] },
    { id: 'b', name: 'KnownB', aliases: ['베타'] },
    { id: 'shared-one', name: 'Shared', aliases: ['공유'] },
    { id: 'shared-two', name: 'Shared', aliases: ['공유'] }];
  for (const label of ['KnownA (KnownB)', 'KnownA (베타)', 'KnownA (Unknown)', 'Unknown (알파)',
    'Shared (공유)', 'KnownA ()', '(알파)', 'KnownA ((알파))', 'KnownA (알파) (알파)',
    'KnownA (알파) suffix', 'KnownA feat. KnownB (알파)', 'KnownA & KnownB (알파)', 'KnownA / 알파']) {
    assert.equal(selectArtists(artists, [track('Reject', { artist: label })]).length, 0, label);
  }
});
check('exact registered whole aliases take precedence and ambiguous registered labels stay rejected', () => {
  const paired = track('Exact first', { artist: 'KnownA (알파)' });
  const artists = [{ id: 'whole', name: 'KnownA (알파)' }, { id: 'parts', name: 'KnownA', aliases: ['알파'] }];
  assert.equal(selectArtists(artists, [paired])[0].artist.id, 'whole');
  assert.equal(selectArtists([...artists, { id: 'whole-two', aliases: ['KnownA (알파)'] }], [paired]).length, 0);
  // An explicitly registered parenthetical alias remains usable even when its
  // components aren't individually registered. No decomposition is necessary.
  assert.equal(selectArtists([{ id: 'literal', name: 'Registered (Stage Name)' }],
    [track('Literal', { artist: 'Registered (Stage Name)' })])[0].artist.id, 'literal');
});
check('rookie status requires matching explicit debut evidence, not new chart or release data', () => {
  const valid = evidence();
  assert.equal(rookieEvidence('rookie', [valid], now), valid);
  assert.equal(rookieEvidence('other', [valid], now), null);
  assert.equal(rookieEvidence('rookie', [], now), null);
  assert.equal(rookieEvidence('rookie', [track('A', { artistId: 'rookie', move: 'new' })], now), null);
  assert.equal(rookieEvidence('rookie', [{ ...valid, date: undefined, releaseDate: valid.date }], now), null);
  assert.equal(rookieEvidence('rookie', [{ ...valid, date: undefined, formationDate: valid.date }], now), null);
  assert.equal(newEntryTracks([track('Veteran', { move: 'new' })]).length, 1);
  assert.equal(rookieEvidence('veteran', [evidence({ artistId: 'veteran', date: '2001-01-01' })], now), null);
});
check('strict debut calendar dates, URL and verification reject malformed and future evidence', () => {
  const bad = ['2025-02-29', '2024-02-30', '2025-13-01', '2025-00-01', '2025-04-31', '2025-9-05',
    '2025-09-05T00:00:00Z', '0000-01-01', '', null, 2025];
  for (const date of bad) assert.equal(rookieEvidence('rookie', [evidence({ date })], now), null, String(date));
  for (const sourceUrl of ['http://official.example', 'javascript:alert(1)', '/debut', '', null, 'https://user:pass@official.example']) {
    assert.equal(rookieEvidence('rookie', [evidence({ sourceUrl })], now), null, String(sourceUrl));
  }
  for (const verifiedAt of ['bad', '2026-02-30', '2026-09-05T13:00:00Z', '2026-09-06',
    '2024-01-01', '2026-09-05T24:00:00Z', '2026-09-05T10:00:00', '2026-09-05T12:99:00Z']) {
    assert.equal(rookieEvidence('rookie', [evidence({ verifiedAt })], now), null, verifiedAt);
  }
  assert.equal(rookieEvidence('rookie', [evidence({ date: '2026-09-06' })], now), null);
  assert.equal(rookieEvidence('rookie', [evidence({ sourceLabel: ' ' })], now), null);
  for (const clock of [NaN, Infinity, 1e20, -1e20]) assert.equal(rookieEvidence('rookie', [evidence()], clock), null);
});
check('rookie 24-calendar-month boundary is inclusive by UTC day, including leap clamp', () => {
  const atBoundary = evidence({ date: '2024-09-05' });
  assert.equal(rookieEvidence('rookie', [atBoundary], now), atBoundary);
  assert.equal(rookieEvidence('rookie', [evidence({ date: '2024-09-04' })], now), null);
  assert.equal(rookieEvidence('rookie', [atBoundary], Date.parse('2026-09-06T00:00:00Z')), null);
  const leap = evidence({ date: '2024-02-29', verifiedAt: '2026-02-28' });
  assert.equal(rookieEvidence('rookie', [leap], Date.parse('2026-02-28T23:59:59Z')), leap);
  assert.equal(rookieEvidence('rookie', [leap], Date.parse('2026-03-01T00:00:00Z')), null);
  const sameDay = evidence({ date: '2026-09-05' });
  assert.equal(rookieEvidence('rookie', [sameDay], now), sameDay);
});
check('rookie newest eligible verification wins without mutating registry', () => {
  const older = Object.freeze(evidence({ verifiedAt: '2026-09-04' }));
  const newer = Object.freeze(evidence({ verifiedAt: '2026-09-05T09:00:00+09:00' }));
  const source = Object.freeze([older, newer]);
  assert.equal(rookieEvidence('rookie', source, now), newer);
  assert.equal(source[0], older);
});
check('freshness describes only collection age, ignores live, uses inclusive six hours', () => {
  for (const live of [true, false, null]) {
    const fresh = chartFreshness({ updated: '2026-09-05T06:00:00Z', live }, now);
    assert.equal(fresh.kind, 'recent'); assert.match(fresh.label, /수집.*2026-09-05 06:00 UTC/);
    assert.doesNotMatch(fresh.label, /실시간|차트 최신/);
    const stale = chartFreshness({ updated: '2026-09-05T05:59:59Z', live }, now);
    assert.equal(stale.kind, 'stale'); assert.match(stale.label, /수집.*2026-09-05/);
  }
  assert.equal(chartFreshness({ updated: '2026-09-05T15:00:00+09:00' }, now).kind, 'recent');
  assert.equal(chartFreshness({ updated: '2020-01-01T00:00:00Z', live: true }, now).kind, 'stale');
});
check('freshness rejects invalid, rolled-over, timezone-less, date-only and future timestamps', () => {
  for (const updated of [null, undefined, '', 'garbage', 0, '2026-02-30T01:00:00Z', '2026-09-05',
    '2026-09-05T06:00:00', '2026-09-05T24:00:00Z', '2026-09-05T12:00:00.001Z', '2026-09-06T00:00:00Z']) {
    assert.deepEqual(plain(chartFreshness({ updated }, now)), { kind: 'unknown', label: '수집 시각 미확인' });
  }
  assert.equal(chartFreshness(null, now).kind, 'unknown');
  for (const clock of [NaN, Infinity, 1e20, -1e20]) assert.equal(chartFreshness({ updated: '2026-09-05T06:00:00Z' }, clock).kind, 'unknown');
});
check('selectors tolerate nullable collections, invalid limits and frozen rows without mutation', () => {
  const rows = Object.freeze([Object.freeze(track('A', { move: 'up', lastRank: 10, ranks: Object.freeze({ apple: 1, billboard: 2 }) })),
    Object.freeze(track('B', { move: 'new' }))]);
  const before = JSON.stringify(rows);
  for (const fn of [risingTracks, newEntryTracks, spotlightTracks]) {
    for (const empty of [null, undefined, []]) assert.equal(fn(empty).length, 0);
    for (const limit of [0, -1, NaN, Infinity]) assert.equal(fn(rows, limit).length, 0);
    assert.ok(fn(rows).every(item => rows.includes(item)));
  }
  assert.equal(selectArtists(null, rows).length, 0);
  assert.equal(selectArtists([{ id: 'example', name: 'Example Band' }], rows).length, 1);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(rookieEvidence('rookie', null, now), null);
});
check('default limits are six tracks and eight artists, with deterministic ties', () => {
  const rows = Array.from({ length: 12 }, (_, i) => track(String(i).padStart(2, '0'), {
    artist: 'Band ' + i, rank: i + 1, move: 'up', lastRank: i + 11, ranks: { apple: 1, billboard: 2 },
  }));
  assert.equal(risingTracks(rows).length, 6);
  assert.equal(newEntryTracks(rows.map(r => ({ ...r, move: 'new', lastRank: null }))).length, 6);
  assert.equal(spotlightTracks(rows).length, 6);
  const artists = rows.map(r => ({ id: r.artist, name: r.artist }));
  assert.equal(selectArtists(artists, rows).length, 8);
  assert.equal(risingTracks(rows, 2.9).length, 2);
  const tied = [track('Z', { move: 'up', lastRank: 10 }), track('A', { move: 'up', lastRank: 10 })];
  assert.deepEqual(names(risingTracks(tied)), ['A', 'Z']);
  assert.deepEqual(names(risingTracks([...tied].reverse())), ['A', 'Z']);
});
console.log(`Discovery model checks: ${passed} passed, ${failures.length} failed (${passed + failures.length} groups).`);
if (failures.length) process.exitCode = 1;
