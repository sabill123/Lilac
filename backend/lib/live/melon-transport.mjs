/* Melon public reads only. No curl/browser fallback or detached timeout race.
 * One deadline covers headers + body. An abort is awaited before returning.
 * Cache only valid successful documents, bounded in size and age. */
import { UA, clean } from './http.mjs';
/* Inspect the list fragment, not footer markup. A recognizable wrapper alone is
 * not evidence that every row, or the document, arrived intact. */
export function inspectMelonNotices(text) {
  const start = /<ul\b[^>]*class=["'][^"']*\blist_ticket_cont\b[^"']*["'][^>]*>/i.exec(text);
  if (!start) return { rows: [], errors: ['Melon unrecognized notice response'] };
  const tail = text.slice(start.index + start[0].length);
  const close = /<\/ul\s*>/i.exec(tail);
  const body = close ? tail.slice(0, close.index) : tail;
  const errors = close ? [] : ['Melon truncated notice list'];
  const rows = [];
  const chunks = [...body.matchAll(/<li\b[^>]*>([\s\S]*?)(?=<li\b|$)/gi)];
  const rowStarts = [...body.matchAll(/<li\b/gi)].length;
  if (rowStarts !== chunks.length) errors.push('Melon truncated notice row opening tag');
  for (const [index, chunk] of chunks.entries()) {
    const end = /<\/li\s*>/i.exec(chunk[1]);
    const html = end ? chunk[1].slice(0, end.index) : '';
    const id = /csoonId=(\d+)/.exec(html)?.[1];
    const title = clean(/<a\b(?=[^>]*\bclass=["'][^"']*\btit\b[^"']*["'])[^>]*>([\s\S]*?)<\/a>/i.exec(html)?.[1]);
    if (!end || !id || !title) { errors.push('Melon invalid notice row ' + (index + 1)); continue; }
    rows.push({ html, id, title });
  }
  // A closed empty wrapper is valid. Text/unknown markup cannot masquerade as empty.
  if (!chunks.length && clean(body)) errors.push('Melon unrecognized empty notice list');
  return { rows, errors };
}
export function createMelonTransport({ fetchImpl = (...args) => fetch(...args), ttlMs = 60_000, maxEntries = 32 } = {}) {
  const cache = new Map();
  return async function read(url, { timeout = 8000, json = false } = {}) {
    const key = `${json}:${url}`;
    const old = cache.get(key);
    if (old && Date.now() - old.at < ttlMs) return structuredClone(old.value);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error('Melon request deadline exceeded')), Math.max(1, timeout));
    try {
      const res = await fetchImpl(url, { signal: ac.signal, redirect: 'error', headers: { 'User-Agent': UA, Referer: 'https://ticket.melon.com/', Accept: json ? 'application/json' : 'text/html' } });
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`Melon HTTP ${res.status}`);
      }
      const text = await res.text();
      // Even an adapter that resolves concurrently with abort cannot cache late data.
      ac.signal.throwIfAborted();
      if (!text.trim()) throw new Error('Melon empty response');
      let value = text;
      if (json) {
        try { value = JSON.parse(text); } catch { throw new Error('Melon invalid JSON'); }
        if (!Array.isArray(value?.data) || value.data.some(row => !row?.prodId || typeof row.title !== 'string' || !row.title.trim()) || (value.result != null && Number(value.result) !== 0)) throw new Error('Melon invalid list response');
      } else {
        const parsed = inspectMelonNotices(text);
        if (parsed.errors.length) {
          const error = new Error(parsed.errors.join('; '));
          // Return salvageable rows through the collector, but never cache the page.
          error.partialHtml = text;
          throw error;
        }
      }
      cache.delete(key);
      cache.set(key, { value, at: Date.now() });
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      return structuredClone(value);
    } catch (e) {
      if (ac.signal.aborted) { const err = new Error('Melon request timeout'); err.code = 'MELON_TIMEOUT'; throw err; }
      throw e;
    } finally { clearTimeout(timer); }
  };
}
export const readMelon = createMelonTransport();
