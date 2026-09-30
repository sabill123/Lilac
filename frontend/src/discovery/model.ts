/** Pure public-chart discovery rules. No network, storage, private user state or
 * inferred debut dates. Nullable API fields remain nullable, not fabricated. */
export type DiscoveryTrack = {
  rank?: number | null;
  title?: string | null;
  artist?: string | null;
  artwork?: string | null;
  appleUrl?: string | null;
  youtubeId?: string | null;
  ytViews?: number | null;
  ranks?: Readonly<Record<string, number | null | undefined>> | null;
  sources?: readonly string[] | null;
  score?: number | null;
  move?: string | null;
  lastRank?: number | null;
  /** Optional envelope provenance when supplied by the caller. */
  source?: string | null;
};
export type ChartSnapshot = {
  country?: string | null;
  countryLabel?: string | null;
  source?: string | null;
  updated?: string | null;
  live?: boolean | null;
  method?: string | null;
  sources?: readonly string[] | null;
  weights?: Readonly<Record<string, number | null>> | null;
  list?: readonly (DiscoveryTrack | null | undefined)[] | null;
};
export type DiscoveryArtist = {
  id: string;
  name?: string | null;
  nameJa?: string | null;
  nameOriginal?: string | null;
  searchTerm?: string | null;
  aliases?: readonly string[] | null;
  country?: string | null;
  artwork?: string | null;
};
export type DebutEvidence = {
  artistId: string;
  /** Actual artist debut only, YYYY-MM-DD; not formation, announcement or a
   * recent release. Caller owns source verification in the public registry. */
  date: string;
  sourceUrl: string;
  sourceLabel: string;
  verifiedAt: string;
};
type Tracks = readonly (DiscoveryTrack | null | undefined)[] | null | undefined;
type Movement = { kind: 'up' | 'down' | 'new' | 'same' | 'unknown'; delta: number | null };
const text = (value: unknown): string => typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : '';
const validRank = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const take = (limit: number) => Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;

/** Exact whole artist + whole title after NFKC, edge trim and case normalization.
 * No punctuation stripping, phonetic expansion, substring or title-only keys.
 * Empty string means missing identity; JSON tuple encoding prevents collisions. */
export function trackKey(track: DiscoveryTrack | null | undefined): string {
  const artist = text(track?.artist), title = text(track?.title);
  return artist && title ? JSON.stringify([artist, title]) : '';
}

/** Positive ranks only, never links, view counts or a claimed sources array.
 * Apple Music and its RSS feed are ONE family. The API's YouTube ranking only
 * reorders the existing song pool by cumulative MV views, so it contributes NO
 * independent entry evidence. Only known independent provider families count;
 * unknown keys cannot manufacture independent corroboration. */
export function sourceFamilies(track: DiscoveryTrack | null | undefined): string[] {
  const families: Record<string, string> = {
    apple: 'apple', appleRss: 'apple', billboard: 'billboard',
    oricon: 'oricon', melon: 'melon', genie: 'genie',
  };
  if (!track?.ranks || typeof track.ranks !== 'object' || Array.isArray(track.ranks)) return [];
  return [...new Set(Object.entries(track.ranks)
    .filter(([key, rank]) => Object.hasOwn(families, key) && validRank(rank))
    .map(([key]) => families[key]))].sort(compare);
}

/** Source-reported previous-rank change, NOT a real-time trend or comparison of
 * local fetches. Raw /api/charts Billboard rows omit source; if provenance is
 * supplied it must be billboard. Combined rows must never borrow movement.
 * delta is a positive magnitude for up/down, 0 for same, null for new/unknown.
 * The provider uses an empty/null flag for same; equal valid ranks confirm it. */
export function rankMovement(track: DiscoveryTrack | null | undefined): Movement {
  const unknown: Movement = { kind: 'unknown', delta: null };
  if (!track || !validRank(track.rank) || (track.source != null && track.source !== 'billboard')) return unknown;
  const flag = track.move;
  if (flag === 'new') return track.lastRank == null ? { kind: 'new', delta: null } : unknown;
  if (!validRank(track.lastRank)) return unknown;
  const delta = track.lastRank - track.rank;
  if (flag === 'up' && delta > 0) return { kind: 'up', delta };
  if (flag === 'down' && delta < 0) return { kind: 'down', delta: -delta };
  if ((flag == null || flag === '' || flag === 'same') && delta === 0) return { kind: 'same', delta: 0 };
  return unknown;
}
const rankOrder = (a: DiscoveryTrack, b: DiscoveryTrack) => (a.rank! - b.rank!) || compare(trackKey(a), trackKey(b));
function ranked(list: Tracks): DiscoveryTrack[] {
  return Array.isArray(list) ? list.filter((t): t is DiscoveryTrack => !!t && validRank(t.rank) && !!trackKey(t)) : [];
}
function unique(list: DiscoveryTrack[]): DiscoveryTrack[] {
  const seen = new Set<string>();
  return list.filter(t => { const key = trackKey(t); if (seen.has(key)) return false; seen.add(key); return true; });
}
/** Consistent provider-reported upward changes, largest magnitude first; then
 * current rank and exact key. All selectors copy arrays, preserve row objects. */
export function risingTracks(list: Tracks, limit = 6): DiscoveryTrack[] {
  return unique(ranked(list).filter(t => rankMovement(t).kind === 'up')
    .sort((a, b) => rankMovement(b).delta! - rankMovement(a).delta! || rankOrder(a, b))).slice(0, take(limit));
}
/** New chart entries are NOT rookie artists. Sorted by reported current rank. */
export function newEntryTracks(list: Tracks, limit = 6): DiscoveryTrack[] {
  return unique(ranked(list).filter(t => rankMovement(t).kind === 'new').sort(rankOrder)).slice(0, take(limit));
}
/** Cross-source chart presence, not editorial endorsement or audience growth.
 * Require >=2 independent known families; sort by family count then rank/key. */
export function spotlightTracks(list: Tracks, limit = 6): DiscoveryTrack[] {
  return unique(ranked(list).filter(t => sourceFamilies(t).length >= 2)
    .sort((a, b) => sourceFamilies(b).length - sourceFamilies(a).length || rankOrder(a, b))).slice(0, take(limit));
}
/** Whole-name/alias matching with trackKey's NFKC/trim/case rules. Registered
 * whole aliases take precedence; ambiguous registered labels stay rejected.
 * Otherwise a single full-string X (Y) label may resolve only when BOTH halves
 * are registered aliases and their owner intersection contains exactly one ID.
 * No nested/multiple parentheses, substring, collaborator or feat expansion.
 * searchTerm is ONE candidate, never split into guessed aliases.
 * Only artists with chart evidence are returned, ordered by best rank then ID. */
export function selectArtists<A extends DiscoveryArtist>(artists: readonly (A | null | undefined)[] | null | undefined,
  tracks: Tracks, limit = 8): { artist: A; tracks: DiscoveryTrack[]; bestRank: number }[] {
  if (!Array.isArray(artists)) return [];
  const byId = new Map<string, A>();
  for (const artist of artists) if (artist && typeof artist.id === 'string' && artist.id.trim() && !byId.has(artist.id)) byId.set(artist.id, artist);
  const owners = new Map<string, Set<string>>();
  for (const artist of byId.values()) {
    const aliases = [artist.name, artist.nameJa, artist.nameOriginal, artist.searchTerm,
      ...(Array.isArray(artist.aliases) ? artist.aliases : [])];
    for (const alias of aliases.map(text).filter(Boolean)) {
      const ids = owners.get(alias) || new Set<string>(); ids.add(artist.id); owners.set(alias, ids);
    }
  }
  const ownerOf = (label: unknown): string | null => {
    const normalized = text(label), exact = owners.get(normalized);
    if (exact) return exact.size === 1 ? [...exact][0] : null;
    const pair = /^([^()]+)\(([^()]+)\)$/.exec(normalized);
    if (!pair) return null;
    const left = owners.get(text(pair[1])), right = owners.get(text(pair[2]));
    if (!left || !right) return null;
    const shared = [...left].filter(id => right.has(id));
    return shared.length === 1 ? shared[0] : null;
  };
  const chart = unique(ranked(tracks).sort(rankOrder));
  const matchedOwners = new Map(chart.map(row => [row, ownerOf(row.artist)]));
  return [...byId.values()].map(artist => ({ artist, tracks: chart.filter(t => matchedOwners.get(t) === artist.id) }))
    .filter(item => item.tracks.length > 0)
    .map(item => ({ ...item, bestRank: item.tracks[0].rank! }))
    .sort((a, b) => a.bestRank - b.bestRank || compare(a.artist.id, b.artist.id)).slice(0, take(limit));
}

// Date-only values are UTC civil days. Reject JS Date's rollover normalization.
function civilDate(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}
function timestamp(value: unknown, allowDate = false): number | null {
  if (typeof value !== 'string') return null;
  if (allowDate && /^\d{4}-\d{2}-\d{2}$/.test(value)) return civilDate(value);
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || civilDate(match[1]) === null || +match[2] > 23 || +match[3] > 59 || +match[4] > 59) return null;
  if (match[5] !== 'Z' && (+match[5].slice(1, 3) > 23 || +match[5].slice(4, 6) > 59)) return null;
  const time = Date.parse(value); return Number.isFinite(time) ? time : null;
}

/** Registry evidence only. No chart 'new', album release, age or artist-name
 * inference. HTTPS is structural validation, not proof of a page's contents.
 * Date must be actual debut confirmed by the registry maintainer. Verification
 * must be on/after debut and <=now. Window includes the UTC anniversary civil
 * day 24 calendar months later (Feb 29 clamps to Feb 28), not 730 fixed days.
 * Multiple eligible records choose newest verification; return original record. */
export function rookieEvidence(artistId: string, evidence: readonly DebutEvidence[] | null | undefined,
  now = Date.now()): DebutEvidence | null {
  if (typeof artistId !== 'string' || !artistId.trim() || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime()) || !Array.isArray(evidence)) return null;
  const today = civilDate(new Date(now).toISOString().slice(0, 10));
  if (today === null) return null;
  const matches = evidence.filter(e => {
    if (!e || e.artistId !== artistId || typeof e.sourceLabel !== 'string' || !e.sourceLabel.trim()) return false;
    const debut = civilDate(e.date), verified = timestamp(e.verifiedAt, true);
    if (debut === null || verified === null || debut > now || verified > now || verified < debut) return false;
    try {
      const url = new URL(e.sourceUrl);
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return false;
    } catch { return false; }
    const end = new Date(debut), month = end.getUTCMonth();
    end.setUTCFullYear(end.getUTCFullYear() + 2);
    if (end.getUTCMonth() !== month) end.setUTCDate(0);
    return today <= end.getTime();
  });
  matches.sort((a, b) => timestamp(b.verifiedAt, true)! - timestamp(a.verifiedAt, true)! || compare(a.sourceUrl, b.sourceUrl));
  return matches[0] || null;
}

/** Collection-age status only. updated is NOT the source chart's issue date,
 * and live never proves issue freshness. <=6h means recent collection; invalid,
 * missing, timezone-less, date-only or future timestamps remain unknown.
 * Labels are concise Korean with an explicit UTC collection time. */
export function chartFreshness(snapshot: ChartSnapshot | null | undefined, now = Date.now()): {
  kind: 'recent' | 'stale' | 'unknown'; label: string;
} {
  const updated = timestamp(snapshot?.updated);
  if (updated === null || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime()) || updated > now) return { kind: 'unknown', label: '수집 시각 미확인' };
  const time = new Date(updated).toISOString().slice(0, 16).replace('T', ' ');
  return now - updated <= 6 * 60 * 60 * 1000
    ? { kind: 'recent', label: `최근 수집 · ${time} UTC` }
    : { kind: 'stale', label: `수집 지연 · ${time} UTC` };
}
