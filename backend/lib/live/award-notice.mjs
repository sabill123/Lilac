/* Shared notice semantics. Facets describe the announcement, never a performer
 * roster. Day-only dates use the KR/JP day boundary solely for sorting. */
export function awardNoticeKinds(value) {
  const title = String(value || '').normalize('NFKC');
  // A fan event lineup is not the ceremony lineup.
  if (/팬\s*페스타|fan\s*festa|슈퍼\s*팬|super\s*fan/i.test(title)) return ['news'];
  const kinds = [];
  if (/후보|노미네이트|ノミネート|候補|\bnomine(?:e|es|ated|ation|ations)\b/i.test(title)) kinds.push('nominees');
  if (/수상|결과|受賞|結果|特別賞|\b(?:winners?|wins|won|results)\b/i.test(title)) kinds.push('results');
  const appearance = /\bVTR\b|ゲストセレブリティ|ゲスト出演|\bMC\b|司会|진행자|게스트|\bhost(?:s|ing)?\b|\bguests?\b/i.test(title);
  const live = /\bLIVE\s+ACTS?\b|ライブアクト/i.test(title);
  // An explicitly announced lineup is independent of a separately announced MC.
  // A lineup qualified as VTR/guest/host, however, is not live-act evidence.
  const qualifier = String.raw`(?:\b(?:VTR|MC|hosts?|guests?(?:\s+celebrit(?:y|ies))?)\b|게스트|진행자|ゲスト(?:セレブリティ)?|司会)`;
  const roster = String.raw`(?:라인업|ライン[・\s]?(?:ナップ|アップ)|line[ -]?up|performers?)`;
  const appearanceWord = String.raw`(?:出演(?:アーティスト|者)?|출연(?:진)?|appearances?)`;
  const independentLineup = title
    .replace(new RegExp(roster + '\\s*(?:of|:|：)\\s*' + qualifier + '(?:\\s*' + appearanceWord + ')?(?:\\s*' + roster + ')?', 'gi'), '')
    .replace(new RegExp(qualifier + '\\s*(?:' + appearanceWord + '\\s*)?[:：-]?\\s*' + roster, 'gi'), '')
    .replace(new RegExp(qualifier + '\\s*' + appearanceWord, 'gi'), '');
  if (live || /라인업|ライン[・\s]?(?:ナップ|アップ)|\b(?:line[ -]?up|performers?)\b|출연|나온다|出演|出場|welcomes?\b.*\b(?:artists?|acts?|k-pop|heavyweights)\b|brings?\b.*\bstage\b/i.test(independentLineup)) kinds.push('lineup');
  if (appearance) kinds.push('appearance');
  if (/개최|일정|방송|예매|티켓|開催|日程|放送|チケット|\b(?:schedule|scheduled|dates?|venue|tickets?)\b/i.test(title)) kinds.push('schedule');
  return kinds.length ? kinds : ['news'];
}
export const awardNoticeKind = title => {
  const first = awardNoticeKinds(title)[0];
  // Preserve the existing primary enum for old clients; new clients use facets.
  return first === 'appearance' ? 'news' : first;
};
export function awardDateMillis(value) {
  if (typeof value !== 'string' || !value.trim()) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const day = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value) return NaN;
    return Date.parse(value + 'T00:00:00+09:00');
  }
  return Date.parse(value);
}
export function latestAwardFirst(a, b) {
  const left = awardDateMillis(a.publishedAt), right = awardDateMillis(b.publishedAt);
  const x = Number.isFinite(left) ? left : -Infinity, y = Number.isFinite(right) ? right : -Infinity;
  return x === y ? String(a.id || '').localeCompare(String(b.id || '')) : x > y ? -1 : 1;
}
