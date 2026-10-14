import assert from 'node:assert/strict';
import { createMelonTransport } from '../backend/lib/live/melon-transport.mjs';
import { melonList, melonTicketOpens, fetchKrTicketOpens } from '../backend/lib/live/tickets-kr.mjs';
let passed = 0;
const test = async (name, fn) => { await fn(); console.log('PASS', name); passed++; };
const document = (id) => `<ul class="list_ticket_cont"><li><a href="detail.htm?csoonId=${id}" class="tit">공연</a></li></ul>`;
const response = (text) => ({ ok: true, text: async () => text });
function hanging({ body = false } = {}) {
  const state = { calls: 0, active: 0, peak: 0, aborted: 0 };
  const fetchImpl = async (_url, { signal }) => {
    state.calls++; state.active++; state.peak = Math.max(state.peak, state.active);
    const pending = () => new Promise((_resolve, reject) => {
      const abort = () => { state.aborted++; state.active--; reject(signal.reason); };
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    });
    return body ? { ok: true, text: pending } : pending();
  };
  return { state, read: createMelonTransport({ fetchImpl, ttlMs: 0 }) };
}
await test('real header/body deadline fires, aborts work and never caches failure', async () => {
  for (const body of [false, true]) {
    const h = hanging({ body });
    for (let i = 0; i < 2; i++) await assert.rejects(h.read('https://ticket.melon.com/test', { timeout: 15 }), /timeout/);
    assert.equal(h.state.calls, 2); assert.equal(h.state.aborted, 2); assert.equal(h.state.active, 0);
  }
});
await test('notice source has bounded calls, concurrency, elapsed budget and no orphan work', async () => {
  const h = hanging(); const start = Date.now();
  const items = await melonTicketOpens({ pages: 999, read: h.read, budgetMs: 35, requestMs: 1000, concurrency: 99 });
  assert.equal(items.sourceMeta.ok, false); assert.equal(items.length, 0); assert.equal(items.sourceMeta.partial, false);
  assert.match(items.sourceMeta.error, /timeout/); assert(h.state.calls <= 3); assert.equal(h.state.peak, 2); assert.equal(h.state.active, 0); assert(h.state.aborted >= 2);
  assert(Date.now() - start < 500); const calls = h.state.calls;
  await new Promise(r => setTimeout(r, 30)); assert.equal(h.state.calls, calls); assert.equal(h.state.active, 0);
});
await test('fast page survives slow sibling, with explicit partial metadata and null unknown facts', async () => {
  const h = hanging();
  const read = (url, opts) => url.includes('pageIndex=1&') ? Promise.resolve(document(1)) : h.read(url, opts);
  const items = await melonTicketOpens({ read, budgetMs: 40, requestMs: 20 });
  assert.equal(items.length, 1); assert.equal(items.sourceMeta.ok, false); assert.equal(items.sourceMeta.partial, true); assert.equal(items.sourceMeta.completedPages, 1);
  for (const key of ['venue', 'city', 'startDate', 'endDate', 'ticketOpenAt']) assert.equal(items[0][key], null);
  assert.equal(h.state.active, 0);
});
await test('valid empty lists differ from malformed/blocked/error documents', async () => {
  for (const text of ['{"result":0}', '{"result":1,"data":[]}', '{"result":0,"data":[{}]}', '<html>Access denied</html>', '<ul>blocked</ul>']) {
    const read = createMelonTransport({ fetchImpl: async () => response(text) });
    await assert.rejects(read('https://ticket.melon.com/test', { json: text[0] === '{' }));
  }
  const read = createMelonTransport({ fetchImpl: async () => response('{"result":0,"data":[]}') });
  assert.deepEqual(await melonList('GENRE_CON_ALL', { read }), []);
});
await test('success cache is isolated, bounded and errors do not use stale-as-healthy fallback', async () => {
  let calls = 0;
  const read = createMelonTransport({ maxEntries: 1, fetchImpl: async () => { calls++; return response('{"result":0,"data":[]}'); } });
  (await read('a', { json: true })).data.push('mutated');
  assert.deepEqual((await read('a', { json: true })).data, []); assert.equal(calls, 1);
  await read('b', { json: true }); await read('a', { json: true }); assert.equal(calls, 3);
  let healthy = true;
  const expires = createMelonTransport({ ttlMs: 5, fetchImpl: async () => { if (!healthy) throw new Error('offline'); return response('{"result":0,"data":[]}'); } });
  await expires('stale', { json: true }); healthy = false;
  await new Promise(r => setTimeout(r, 10));
  await assert.rejects(expires('stale', { json: true }), /offline/);
  let cancelled = false;
  const blocked = createMelonTransport({ fetchImpl: async () => ({ ok: false, status: 403, body: { cancel: async () => { cancelled = true; } } }) });
  await assert.rejects(blocked('x'), /HTTP 403/); assert.equal(cancelled, true);
});
await test('aggregate source serializes partial/error distinction rather than healthy zero', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => url.includes('ticket.melon.com') ? new Response('<html>blocked</html>') : new Response('empty');
  try {
    const result = await fetchKrTicketOpens();
    const sources = result.sources.filter(s => s.provider.startsWith('melon:'));
    assert.equal(sources.length, 2);
    assert(sources.every(s => !s.ok && s.count === 0 && s.error));
  } finally { globalThis.fetch = original; }
});
await test('mixed valid/broken notice rows retain good data, fail source and never populate cache', async () => {
  const brokenRows = [
    '<li class="broken"',
    '<li><a class="tit">missing id</a></li>',
    '<li><a href="detail.htm?csoonId=2">missing title class</a></li>',
    '<li><a class="tit" href="detail.htm?csoonId=2"></a></li>',
    '<li><a class="tit" href="detail.htm?csoonId=2">unclosed title</li>',
    '<li><a class="tit" href="detail.htm?csoonId=2">unclosed row</a>',
  ];
  for (const broken of brokenRows) {
    const html = document(1).replace('</ul>', broken + '</ul>'); let calls = 0;
    const read = createMelonTransport({ fetchImpl: async () => { calls++; return response(html); } });
    for (let n = 0; n < 2; n++) {
      const items = await melonTicketOpens({ pages: 1, read });
      assert.deepEqual(items.map(row => row.id), ['melon-open:1']);
      assert.equal(items.sourceMeta.ok, false); assert.equal(items.sourceMeta.partial, true);
      assert.equal(items.sourceMeta.completedPages, 0); assert.match(items.sourceMeta.error, /invalid notice row|truncated notice row opening tag/);
    }
    assert.equal(calls, 2, 'malformed page must be fetched again, not cached');
  }
});
await test('missing list closure and truncated last row report parsing loss, not healthy partial documents', async () => {
  for (const html of [document(1).replace('</ul>', ''), document(1).replace('</ul>', '<li><a href="detail.htm?csoonId=2" class="tit">truncated')]) {
    let calls = 0;
    const read = createMelonTransport({ fetchImpl: async () => { calls++; return response(html); } });
    for (let n = 0; n < 2; n++) {
      const items = await melonTicketOpens({ pages: 1, read });
      assert.deepEqual(items.map(row => row.id), ['melon-open:1']);
      assert.equal(items.sourceMeta.ok, false); assert.equal(items.sourceMeta.partial, true);
      assert.match(items.sourceMeta.error, /truncated notice list/);
    }
    assert.equal(calls, 2);
  }
  const items = await melonTicketOpens({ pages: 1, read: async () => '<ul class="list_ticket_cont"><li><a' });
  assert.equal(items.length, 0); assert.equal(items.sourceMeta.ok, false); assert.equal(items.sourceMeta.partial, false);
});
await test('closed empty notice wrapper remains healthy and cacheable, unknown text is not empty', async () => {
  let calls = 0;
  const read = createMelonTransport({ fetchImpl: async () => { calls++; return response('<ul class="list_ticket_cont">  </ul>'); } });
  for (let n = 0; n < 2; n++) {
    const items = await melonTicketOpens({ pages: 1, read });
    assert.equal(items.length, 0); assert.equal(items.sourceMeta.ok, true); assert.equal(items.sourceMeta.completedPages, 1);
  }
  assert.equal(calls, 1);
  const bad = await melonTicketOpens({ pages: 1, read: async () => '<ul class="list_ticket_cont">Access denied</ul>' });
  assert.equal(bad.sourceMeta.ok, false); assert.equal(bad.sourceMeta.partial, false);
});
await test('aggregate exposes parse-loss partial status while retaining valid notice rows', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(url.includes('ticket.melon.com') ? document(1).replace('</ul>', '<li>broken</li></ul>') : 'empty');
  try {
    const result = await fetchKrTicketOpens();
    const sources = result.sources.filter(s => s.provider.startsWith('melon:'));
    assert(sources.every(s => !s.ok && s.partial && s.count === 1 && /invalid notice row/.test(s.error)));
    assert(result.items.some(row => row.id === 'melon-open:1'));
  } finally { globalThis.fetch = original; }
});
console.log(`${passed} passed, 0 failed`);
