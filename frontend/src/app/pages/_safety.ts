/* API-supplied URLs are data, never executable navigation. Escaping HTML alone is insufficient. */
export function safeExternal(value: unknown): string {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return '';
  try {
    const u = new URL(value);
    return /^(https?:)$/.test(u.protocol) && !u.username && !u.password ? u.href : '';
  } catch { return ''; }
}

/* Same-page section links must not replace the SPA's route fragment. */
export function bindSectionLink(link: Element | null, target: Element | null) {
  link?.addEventListener('click', (e) => { e.preventDefault(); target?.scrollIntoView({ block: 'start' }); });
}

/* Ticket date grouping must not crash the whole listing for one malformed source row. */
export function ticketDay(value: unknown): string {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? new Date(ms + 9 * 3600e3).toISOString().slice(0, 10) : '';
}
