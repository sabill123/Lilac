import type { DebutEvidence } from './model';

/** Evidence registry, not a hand-assigned rookie list. Eligibility expires after
 * 24 calendar months in rookieEvidence(). Unknown artists stay unclassified.
 * Formation dates, chart entries and earliest catalog tracks are not debut proof.
 * Add new records only with verified music-debut evidence and a verification date.
 */
export const DEBUT_EVIDENCE: readonly DebutEvidence[] = [
  { artistId: 'hana', date: '2025-04-02', sourceUrl: 'https://hana.b-rave.tokyo/music/rose/', sourceLabel: 'HANA 공식 · Debut Single ROSE / 2025.04.02 Digital Release', verifiedAt: '2026-09-06T07:15:00Z' },
  { artistId: 'hearts2hearts', date: '2025-02-24', sourceUrl: 'https://x.com/Hearts2Hearts/status/1893845058832740764', sourceLabel: 'Hearts2Hearts 공식 · 오늘 데뷔 / 첫 싱글 The Chase', verifiedAt: '2026-09-06T07:15:00Z' },
  { artistId: '코르티스', date: '2025-08-18', sourceUrl: 'https://weverse.io/cortis/artist/1-163118592?hl=ko', sourceLabel: 'CORTIS 공식 · 8월 18일 코르티스 데뷔', verifiedAt: '2026-09-06T07:15:00Z' },
  // KiiiKiii celebrates February 24 (pre-debut single) as its anniversary.
  // This registry uses formal debut, explicitly excluding that pre-debut period.
  { artistId: 'kiiikiii', date: '2025-03-24', sourceUrl: 'https://www.youtube.com/watch?v=XoRdiSGgIig&t=77', sourceLabel: 'KBS WORLD 아티스트 인터뷰 · 3월 24일 정식 데뷔 기준 (2월 24일 프리 데뷔·기념일과 구분)', verifiedAt: '2026-09-06T07:15:00Z' },
];
