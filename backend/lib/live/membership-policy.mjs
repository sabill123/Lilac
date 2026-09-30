/* A community URL is not proof of paid membership. Shared by discovery and cached reads. */
export function weverseKind(value) {
  let u;
  try { u = new URL(value); } catch { return null; }
  if (u.protocol !== 'https:' || !/^(?:[a-z0-9-]+\.)?weverse\.io$/.test(u.hostname)) return null;
  if (u.hostname === 'shop.weverse.io' && /\/artists\/\d+\/(?:categories|sales)\/\d+(?:\/|$)/.test(u.pathname)) return 'shop';
  if (u.hostname === 'weverse.io' && /^\/[^/]+\/(?:membership(?:\/|$)|media(?:\/|$))/.test(u.pathname) && (/\/membership(?:\/|$)/.test(u.pathname) || /^[a-z]*membership$/i.test(u.searchParams.get('tab') || ''))) return 'membership';
  if (u.hostname === 'go.weverse.io') return 'shortlink';
  if (u.hostname === 'campaigns.weverse.io') return 'campaign';
  return 'generic';
}
export function membershipEvidence(fc) {
  if (!fc?.found || !fc.entry) return false;
  try { if (!/^https?:$/.test(new URL(fc.entry).protocol)) return false; } catch { return false; }
  const kind = weverseKind(fc.entry);
  if (kind === 'generic') return false;
  if (kind === 'shortlink' || kind === 'campaign') {
    const f = fc.facts;
    return !!(f && !f.error && (f.membershipVerified || (f.fees && (f.fees.annual || f.fees.monthly || f.fees.free)) || /MEMBERSHIP|メンバーシップ|멤버십/i.test(f.title || '')));
  }
  return !fc.facts?.error;
}
export function exposeMembership(fc, artist = null) {
  if (!fc?.found) return fc;
  let reason = membershipEvidence(fc) ? null : 'unverified-membership';
  if (!reason && artist && fc.facts) {
    const primary = [artist.name, artist.nameOriginal, artist.nameJa, artist.appleArtistId ? artist.searchTerm : null].filter(Boolean);
    const names = primary.some(n => /[A-Za-z]/.test(n)) ? primary : [...primary, ...(artist.aliases || [])];
    const key = v => String(v || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9가-힣぀-ヿ一-龯]/g, '');
    if (fc.facts.shopArtist && !names.some(n => key(n) === key(fc.facts.shopArtist))) reason = 'fanclub-owner-mismatch';
    if (!reason && fc.discoveredBy === 'search' && (fc.facts.title || fc.facts.ogTitle || fc.facts.name) && !matchesMembershipOwner(names, [fc.facts.title, fc.facts.ogTitle, fc.facts.name, fc.entry, fc.home, fc.facts.shopArtist])) reason = 'fanclub-name-mismatch';
  }
  if (!reason) return fc;
  return { found: false, official: fc.official, rejected: fc.entry, reason, checkedAt: fc.checkedAt, cache: fc.cache };
}

export function matchesMembershipOwner(names, fields) {
  const normalize = (v) => String(v || '').normalize('NFKC').toLowerCase().replace(/&amp;/g, '&');
  const compact = (v) => normalize(v).replace(/[^a-z0-9가-힣぀-ヿ一-龯]/g, '');
  const hay = fields.map(normalize).join(' ');
  const condensed = compact(hay);
  return names.filter(Boolean).some((name) => {
    const n = normalize(name), key = compact(n);
    if (key.length < 2) return false;
    // Match the real spelling first: punctuation is identity, not a separator
    // to delete before matching (M!LK -> 'mlk' would miss the official title).
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp('(^|[^a-z0-9])' + escaped + '([^a-z0-9]|$)', 'i').test(hay)) return true;
    // IU ≠ NiziU, ME ≠ membership: short Latin identities need token boundaries.
    if (/^[a-z0-9]{2,3}$/.test(key)) return new RegExp('(^|[^a-z0-9])' + key + '([^a-z0-9]|$)', 'i').test(hay);
    if (condensed.includes(key)) return true;
    const tokens = n.split(/[\s・·_-]+/).map(compact).filter((x) => x.length >= 2);
    return tokens.length > 1 && tokens.every((x) => condensed.includes(x));
  });
}
