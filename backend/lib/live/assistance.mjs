/** Public, source-bound assistance, not a policy inference engine.
 * Caller MUST resolve url from an existing server-owned fanclub/goods record.
 * Never expose an arbitrary-URL proxy route. No cookies, auth, submits or images
 * are downloaded. Default transport pins validated DNS per HTTPS redirect hop.
 * deps.fetchImpl is a trusted test adapter (must honor redirect:'manual').
 */
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { isPublicAddress } from './image-proxy.mjs';
import { UA, unescapeHtml } from './http.mjs';

const MAX_BYTES = 1024 * 1024, TOTAL_MS = 12000;
const BAD_KEY = /password|passwd|secret|token|session|auth|credential|signature|api.?key|code|ticket|email|phone|address|access.?key/i;
const PAGE_KEYS = /^(?:id|page|p|lang|locale|product_id|product_no|goods_no|goodsno|goods_code|itemid|item_id|itemno|variant|category|type)$/i;
const IMAGE_KEYS = /^(?:v|w|h|width|height|format|fm|crop|fit|quality|q|auto|pad|bg)$/i;
const BAD_PATH = /(?:^|\/)(?:login|logout|signin|signout|oauth|authorize|callback|checkout|cart|payment|purchase|order|orders|account|mypage|admin|api|password|reset|verify|confirm|activate|unsubscribe)(?:\/|$)/i;
const FOLLOW_PATH = /(?:^|\/)(?:help|faq|guide|guides|user-guide|shopping-guide|entry|join|membership|delivery|shipping|payment-methods|利用案内|ご利用ガイド)(?:[/.\-_]|$)/i;
const SECRET_TEXT = /(?:password|passwd|secret|token|session|authorization|api.?key)\s*[=:]\s*\S+/i;
const error = (status, code) => Object.assign(new Error(code), { status, code });
const safeText = (s) => unescapeHtml(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const bounded = (s, n = 600) => safeText(s).slice(0, n);
const attrs = (s) => Object.fromEntries([...s.matchAll(/([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map(m => [m[1].toLowerCase(), unescapeHtml(m[2] ?? m[3] ?? m[4] ?? '')]));

function validateUrl(value, { base, origin, image = false } = {}) {
  let u;
  try {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0020\\]/.test(value) || (!base && !/^https:\/\/[^/]/i.test(value))) throw Error();
    u = base ? new URL(value, base) : new URL(value);
  } catch { throw error(400, 'invalid_url'); }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !host.includes('.') && !isIP(host) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(host) || host.endsWith('.') ||
      (isIP(host) && !isPublicAddress(host)) || (origin && u.origin !== origin)) throw error(403, 'unsafe_destination');
  if (/%(?:00|25|2f|5c)/i.test(u.pathname)) throw error(403, 'unsafe_path_encoding');
  if (!image && BAD_PATH.test(decodeURIComponentSafe(u.pathname))) throw error(403, 'nonpublic_path');
  for (const [key, val] of u.searchParams) {
    if (BAD_KEY.test(key) || !(image ? IMAGE_KEYS : PAGE_KEYS).test(key) || val.length > 120 || /[@\s]|https?:|[\r\n]/i.test(val)) throw error(403, 'unsafe_query');
  }
  u.hash = '';
  return u;
}
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { throw error(400, 'invalid_url'); } }
function raceAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(error(504, 'timeout'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
async function pinnedFetch(url, init) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET', agent: false, signal: init.signal, rejectUnauthorized: true,
      lookup: (_host, options, done) => done(null, options?.all ? [init.address] : init.address.address, init.address.family),
      headers: init.headers,
    }, res => {
      const headers = new Headers();
      for (const [key, val] of Object.entries(res.headers)) if (val != null) headers.set(key, Array.isArray(val) ? val.join(', ') : val);
      // Response cannot represent a body with these statuses.
      if ([204, 205, 304].includes(res.statusCode)) { res.destroy(); resolve(new Response(null, { status: res.statusCode, headers })); }
      else resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers }));
    });
    req.once('error', reject); req.end();
  });
}
async function readPage(start, ctx) {
  let current = validateUrl(start, { origin: ctx.origin });
  for (let hop = 0; hop <= 3; hop++) {
    const host = current.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await raceAbort(ctx.lookup(host, { all: true, verbatim: true }), ctx.signal);
    if (!addresses?.length || addresses.some(a => !isPublicAddress(a.address) || isIP(a.address) !== a.family)) throw error(403, 'private_dns');
    const res = await raceAbort(ctx.fetch(current.href, {
      method: 'GET', redirect: 'manual', credentials: 'omit', signal: ctx.signal,
      address: addresses.find(a => a.family === 4) || addresses[0],
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-encoding': 'identity', 'accept-language': 'ja,ko;q=0.9,en;q=0.7' },
    }), ctx.signal);
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      await res.body?.cancel();
      if (hop === 3 || !res.headers.get('location')) throw error(502, 'redirect_limit');
      try { current = validateUrl(res.headers.get('location'), { base: current.href, origin: ctx.origin }); }
      catch (e) {
        // Do not follow it here. Official-profile discovery may restart once on
        // a fully validated www/apex HTTPS variant; assistance stays same-origin.
        try {
          const candidate=new URL(res.headers.get('location'),current.href);
          if(candidate.protocol==='http:')candidate.protocol='https:';
          const safe=validateUrl(candidate.href);
          if(safe.hostname.replace(/^www\./,'')===current.hostname.replace(/^www\./,''))e.location=safe.href;
        } catch { /* Never attach credentialed/private/arbitrary redirect data. */ }
        throw e;
      }
      continue;
    }
    // Also reject a test/transport adapter that silently followed redirects.
    if (res.url && res.url !== current.href) { await res.body?.cancel(); throw error(403, 'unexpected_redirect'); }
    if (!res.ok) { await res.body?.cancel(); throw error(502, `upstream_http_${res.status}`); }
    const mime = res.headers.get('content-type') || '';
    if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(mime) || !['', 'identity'].includes(res.headers.get('content-encoding') || '')) {
      await res.body?.cancel(); throw error(502, 'unsupported_response');
    }
    const length = res.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || +length > ctx.maxBytes || +length > ctx.remaining)) { await res.body?.cancel(); throw error(413, 'page_too_large'); }
    const chunks = []; let bytes = 0;
    const reader = res.body?.getReader();
    if (!reader) throw error(502, 'empty_page');
    try {
      while (true) {
        const part = await raceAbort(reader.read(), ctx.signal);
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > ctx.maxBytes || bytes > ctx.remaining) throw error(413, 'page_too_large');
        chunks.push(Buffer.from(part.value));
      }
    } catch (e) { await reader.cancel().catch(() => {}); throw e; }
    finally { reader.releaseLock(); }
    ctx.remaining -= bytes;
    if (!bytes || (length && +length !== bytes)) throw error(502, 'incomplete_page');
    const charset = mime.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] || 'utf-8';
    let html;
    try { html = new TextDecoder(charset).decode(Buffer.concat(chunks)); } catch { throw error(502, 'unsupported_charset'); }
    return { html, url: current.href, bytes };
  }
}

const GLOSSARY = [
  ['email', /メール|이메일|전자\s*우편|e-?mail/i, '이메일', 'メールアドレス'],
  ['phone', /電話|携帯|휴대|전화|phone|mobile/i, '전화번호', '電話番号'],
  ['phoneticName', /フリガナ|ふりがな|カナ|가나|후리가나|phonetic/i, '이름 읽는 법', 'フリガナ'],
  ['postalCode', /郵便|우편|postal|zip/i, '우편번호', '郵便番号'],
  ['residence', /居住|国籍|국가|국적|거주|country|residen/i, '거주 국가·지역', '居住国・地域'],
  ['address', /住所|都道府県|市区町村|番地|주소|배송지|address|prefecture/i, '주소', '住所'],
  ['name', /氏名|お名前|姓|名|성명|이름|성\s*\*|name/i, '이름', '氏名'],
  ['birthDate', /生年月日|誕生日|생년|생일|birth/i, '생년월일', '生年月日'],
  ['payment', /支払|決済|クレジット|결제|지불|payment/i, '결제', '支払い'],
  ['delivery', /配送|発送|送料|受取|배송|수령|shipping|delivery/i, '배송·수령', '配送・受取'],
  ['signup', /入会|新規登録|会員登録|가입|회원\s*등록|sign.?up|registration/i, '가입', '入会・登録'],
];
function category(text) { return GLOSSARY.find(([, re]) => re.test(text))?.[0] || 'other'; }
function translation(key, locale) { const row = GLOSSARY.find(([k]) => k === key); return row ? row[locale === 'ja' ? 3 : 2] : null; }
function allowedText(text) { return text && !SECRET_TEXT.test(text) && !/[?&](?:token|password|secret|code|session|email|signature)=/i.test(text); }
function visible(html) {
  return html.replace(/<!--[\s\S]*?-->|<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<textarea\b[^>]*>[\s\S]*?<\/textarea\s*>|<input\b[^>]*>/gi, '')
    .replace(/<([a-z][\w:-]*)\b[^>]*(?:\s(?:hidden|inert)(?:\s|=|>)|aria-hidden\s*=\s*["']true["'])[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
}
function parsePage(html, sourceUrl, fetchedAt, locale) {
  const evidence = [], fields = [], images = [], guides = [];
  const stamp = (tag, index, verbatim) => ({ sourceUrl, fetchedAt, verbatim, location: { tag, index } });
  const image = (value, origin, index, alt = '') => {
    try {
      const url = validateUrl(value, { base: sourceUrl, image: true }).href;
      if (!images.some(x => x.url === url) && images.length < 20) images.push({ url, kind: origin, alt: bounded(alt, 180), ...stamp(origin, index, url) });
    } catch { /* A URL is never repaired into a guessed source. */ }
  };
  let title = bounded(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '', 240) || null;
  for (const [i, m] of [...html.matchAll(/<meta\b([^>]*)>/gi)].entries()) {
    const a = attrs(m[1]);
    if (/^(?:og:image(?::url)?|twitter:image(?::src)?)$/i.test(a.property || a.name || '')) image(a.content, 'meta', i);
    if (!title && /^(?:og:title)$/i.test(a.property || '')) title = bounded(a.content, 240);
  }
  for (const [i, m] of [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].entries()) {
    if (!/application\/ld\+json/i.test(attrs(m[1]).type || '')) continue;
    try {
      let nodes = 0;
      const walk = (v, depth = 0) => {
        if (++nodes > 2000 || depth > 12 || !v || typeof v !== 'object') return;
        if (Array.isArray(v)) { v.slice(0, 100).forEach(x => walk(x, depth + 1)); return; }
        const product = [].concat(v['@type'] || []).some(x => /^(Product|ProductGroup|ImageObject)$/i.test(x));
        if (product) for (const item of [].concat(v.image || (v['@type'] === 'ImageObject' ? v.contentUrl || v.url : []) || [])) {
          if (typeof item === 'string') image(item, 'jsonld', i);
          else if (item && typeof item === 'object') image(item.contentUrl || item.url, 'jsonld', i);
        }
        Object.values(v).forEach(x => walk(x, depth + 1));
      };
      walk(JSON.parse(m[2]));
    } catch { /* Invalid JSON-LD is not evidence. */ }
  }
  // Prefer the document's main content; newsletter/header fields are not signup requirements.
  const mainHtml = html.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1] || html;
  const contentHtml = mainHtml.replace(/<(head|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const publicHtml = visible(contentHtml);
  for (const [i, m] of [...publicHtml.matchAll(/<img\b([^>]*)>/gi)].entries()) {
    const a = attrs(m[1]);
    if (/product|商品|goods|グッズ|album|앨범|상품/i.test([a.class, a.alt, a.itemprop].join(' '))) image(a.src || a['data-src'], 'img', i, a.alt);
  }
  const labels = new Map();
  for (const m of publicHtml.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)) {
    const a = attrs(m[1]); if (a.for) labels.set(a.for, bounded(m[2], 220));
  }
  // Use original controls, but remove complete hidden/inert containers first.
  const controlsHtml = contentHtml.replace(/<!--[\s\S]*?-->|<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<([a-z][\w:-]*)\b[^>]*(?:\shidden(?:\s|=|>)|aria-hidden\s*=\s*["']true["'])[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  for (const [i, m] of [...controlsHtml.matchAll(/<(input|select|textarea)\b([^>]*)(?:>([\s\S]*?)<\/\1\s*>|\/?>)/gi)].entries()) {
    const a = attrs(m[2]), type = (a.type || (m[1].toLowerCase() === 'input' ? 'text' : m[1])).toLowerCase();
    if (['hidden', 'password', 'submit', 'button', 'reset', 'image', 'file'].includes(type) || 'hidden' in a || a['aria-hidden'] === 'true' || 'disabled' in a || 'readonly' in a || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.style || '')) continue;
    if (/password|passwd|token|secret|csrf|session|auth|cc-|credit.?card|card.?number|cvv|cvc/i.test([a.name, a.id, a.autocomplete].join(' '))) continue;
    const before = controlsHtml.slice(Math.max(0, m.index - 600), m.index);
    const labelStart = before.toLowerCase().lastIndexOf('<label');
    const wrap = labelStart > before.toLowerCase().lastIndexOf('</label>') ? before.slice(labelStart).match(/<label\b[^>]*>([\s\S]*)$/i) : null;
    const label = bounded(labels.get(a.id) || a['aria-label'] || (wrap && !/<\/label>/i.test(wrap[1]) ? wrap[1] : '') || '', 220);
    if (!allowedText(label) || /パスワード|비밀번호|password|token|トークン|인증\s*코드/i.test(label)) continue;
    const key = category(label);
    const choices = m[1].toLowerCase() === 'select' ? [...(m[3] || '').matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)].map(x => bounded(x[1], 120)).filter(allowedText).slice(0, 40) : [];
    const requiredBy = 'required' in a ? 'html-required' : a['aria-required'] === 'true' ? 'aria-required' : /必須|필수/.test(label) ? 'label' : null;
    const auto = (a.autocomplete || '').toLowerCase().trim();
    const autocomplete = /^(?:name|given-name|family-name|additional-name|email|tel(?:-[a-z-]+)?|street-address|address-line[123]|address-level[1-4]|country|country-name|postal-code|bday(?:-day|-month|-year)?|off|on)$/.test(auto) ? auto : null;
    fields.push({ label, category: key, translatedLabel: translation(key, locale), type, required: requiredBy ? true : null, requiredBy, autocomplete, choices, ...stamp(m[1], i, label), uncertainty: 'public_markup_only', formPurpose: 'not_verified_as_signup_or_checkout' });
    if (fields.length >= 60) break;
  }
  let index = 0;
  // Block endings preserve source phrasing without inventing steps or requirements.
  const blocks = publicHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|li|tr|dt|dd|h[1-6]|section|article)>/gi, '\n').replace(/<[^>]*>/g, ' ').split('\n');
  for (const block of blocks) {
    const text = safeText(block);
    if (text.length < 6 || text.length > 1000 || !allowedText(text)) continue;
    const topics = GLOSSARY.filter(([, re]) => re.test(text)).map(([key]) => key);
    if (topics.length && !evidence.some(x => x.verbatim === text)) evidence.push({ type: 'source_statement', topics, ...stamp('text-block', index, text), uncertainty: 'scope_not_inferred' });
    index++;
    if (evidence.length >= 50) break;
  }
  for (const [i, m] of [...publicHtml.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)].entries()) {
    const text = bounded(m[2], 300);
    if (allowedText(text) && evidence.length < 65) evidence.push({ type: 'heading', topics: [category(text)], ...stamp(m[1], i, text) });
  }
  for (const [i, m] of [...visible(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].entries()) {
    const a = attrs(m[1]), text = bounded(m[2], 220);
    if (!text || !/help|faq|guide|entry|join|shipping|payment|delivery|入会|登録|利用|ガイド|配送|支払|会員|ヘルプ|안내|가입|배송|결제|도움말/i.test(text)) continue;
    try {
      const url = validateUrl(a.href, { base: sourceUrl, origin: new URL(sourceUrl).origin });
      if (!guides.some(x => x.url === url.href) && guides.length < 20) guides.push({ url: url.href, title: text, followable: FOLLOW_PATH.test(decodeURIComponentSafe(url.pathname)) && !url.search, ...stamp('a', i, text) });
    } catch { /* Never expose an auth/signed link. */ }
  }
  return { title: allowedText(title) ? title : null, images, fields, evidence, guides };
}

/** @returns evidence with null/unknown rather than invented artist policies.
 * Invalid or unsafe initial URLs throw {status,code}; upstream failures yield
 * status:'unavailable'. Follow-page failures yield partial results + warnings.
 * fields.required=null means NOT verified, never optional. Images are unverified
 * public metadata URLs, not downloaded assets or licensed usage guarantees.
 */
export async function collectAssistance({ url, kind = 'fanclub', artistName = '', locale = 'ko' } = {}, deps = {}) {
  const initial = validateUrl(url);
  const timeoutMs = Math.max(10, Math.min(TOTAL_MS, Number(deps.timeoutMs) || TOTAL_MS));
  const maxBytes = Math.max(1, Math.min(MAX_BYTES, Number(deps.maxBytes) || MAX_BYTES));
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  const now = deps.now || (() => new Date());
  const timestamp = () => new Date(now()).toISOString();
  const fetchedAt = timestamp();
  const result = { version: 1, status: 'unavailable', url: initial.href, kind: kind === 'goods' ? 'goods' : 'fanclub', artistName: bounded(artistName, 160), locale: locale === 'ja' ? 'ja' : 'ko', title: null, fetchedAt, images: [], fields: [], evidence: [], guides: [], sources: [], warnings: [], unknowns: [] };
  const ctx = { origin: initial.origin, lookup: deps.lookup || dnsLookup, fetch: deps.fetchImpl || deps.fetch || pinnedFetch, signal: controller.signal, maxBytes, remaining: maxBytes * 3 };
  const queue = [initial.href], seen = new Set();
  const maxPages=Math.max(1,Math.min(3,Number(deps.maxPages)||3));
  try {
    while (queue.length && seen.size < maxPages && !controller.signal.aborted) {
      const target = queue.shift(); if (seen.has(target)) continue; seen.add(target);
      try {
        const page = await readPage(target, ctx), observedAt = timestamp();
        seen.add(page.url);
        const parsed = parsePage(page.html, page.url, observedAt, result.locale);
        result.sources.push({ sourceUrl: page.url, fetchedAt: observedAt, title: parsed.title, bytes: page.bytes });
        if (result.sources.length === 1) result.title = parsed.title;
        for (const key of ['images', 'fields', 'evidence', 'guides']) result[key].push(...parsed[key]);
        if (target === initial.href) queue.push(...parsed.guides.filter(x => x.followable && x.url !== page.url).slice(0, 2).map(x => x.url));
      } catch (e) { result.warnings.push({ sourceUrl: target, code: e.code || 'upstream_unavailable' }); }
    }
    if (controller.signal.aborted && !result.warnings.some(x => x.code === 'timeout')) result.warnings.push({ sourceUrl: initial.href, code: 'timeout' });
    result.status = result.sources.length ? result.warnings.length ? 'partial' : 'ok' : 'unavailable';
    for (const [key] of GLOSSARY) if (!result.evidence.some(x => x.type === 'source_statement' && x.topics.includes(key)) && !result.fields.some(x => x.category === key)) result.unknowns.push({ topic: key, reason: 'not_observed_in_fetched_public_pages', sourceUrl: initial.href, fetchedAt });
    result.unknowns.push({ topic: 'eligibility_and_mandatory_requirements', reason: 'public_evidence_is_not_account_or_residence_eligibility_confirmation', sourceUrl: initial.href, fetchedAt });
    return result;
  } finally { clearTimeout(timer); controller.abort(); }
}

/** Bounded anonymous public HTML for server-owned official sources.
 * Not an HTTP proxy route. Shares the assistance transport's DNS pinning and
 * same-origin redirect rules; never returns form values or sends credentials. */
export async function readPublicHtml(url, deps = {}) {
  const initial = validateUrl(url);
  const maxBytes = Math.max(1, Math.min(MAX_BYTES, Number(deps.maxBytes) || MAX_BYTES));
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (deps.signal?.aborted) controller.abort();
  else deps.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, Math.max(10, Math.min(TOTAL_MS, Number(deps.timeoutMs) || 6000)));
  try {
    return await readPage(initial.href, { origin: initial.origin, lookup: deps.lookup || dnsLookup, fetch: deps.fetchImpl || pinnedFetch, signal: controller.signal, maxBytes, remaining: maxBytes });
  } finally {
    clearTimeout(timer); controller.abort(); deps.signal?.removeEventListener('abort', abort);
  }
}
