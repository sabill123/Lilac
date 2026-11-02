/** Generic current official-profile portrait collector.
 *
 * Contract:
 * - Starts ONLY from a server-owned officialUrl (caller resolves it from its own
 *   artist record). No artist-specific URL tables, no guessed /profile paths.
 * - Follows only links actually observed on fetched pages, same origin, that look
 *   like profile/biography/about links (max 2 followed, max 3 pages total).
 * - Identity must be verified by normalized names in the page title, headings or
 *   artist JSON-LD (Person/MusicGroup); the chosen image must be bound to that
 *   identity (exact JSON-LD node image, or a main-content portrait whose alt or
 *   section name element names the artist).
 * - Homepage/OG images are never accepted as portraits. Logo, dummy, banner,
 *   jacket/album, goods, tour/poster, member-only and ambiguous picks are
 *   rejected. Linked-CSS-only portraits are reported unavailable (the shared
 *   transport is HTML-only; we do not fetch stylesheets).
 * - checkedAt is when WE observed the page. It is never a publication date.
 *   publication is filled only from an explicit JSON-LD date bound to the image.
 * - Images are NOT downloaded: imageUrl is a verified public reference only.
 */
import { readPublicHtml } from './assistance.mjs';
import { isPublicAddress } from './image-proxy.mjs';
import { unescapeHtml } from './http.mjs';
import { isIP } from 'node:net';

const MAX_PAGES = 3, MAX_FOLLOW = 2, MAX_BYTES = 1024 * 1024, TOTAL_MS = 15000, PAGE_MS = 6000;
const MAX_NODES = 40000, MAX_NAMES = 12;
const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);
const CHROME = new Set(['header', 'nav', 'footer', 'aside', 'form', 'button', 'dialog']);
const PRIVATE_PATH = /(?:^|\/)(?:login|logout|signin|signup|signout|oauth|authorize|callback|checkout|cart|payment|purchase|order|orders|account|accounts|mypage|my|admin|api|password|reset|verify|confirm|activate|unsubscribe|member-only|members-only|fc-only|wp-admin|wp-login\.php|preview|draft|private)(?:[/.]|$)/i;
const PAGE_QUERY = /^(?:lang|locale|hl)$/i;
const IMAGE_QUERY = /^(?:v|ver|var|rev|cb|_|version|updated|w|h|width|height|format|fm|q|quality|fit|crop|auto|t|ts|d|size|ext|dpr)$/i;
const PROFILE_SEG = /^(?:profile|profiles|biography|bio|bios|about|about-us|aboutus|artist-profile|artistprofile|artist-info|artistinfo|introduce|introduction|intro|prof|profil|プロフィール|プロフ|経歴|프로필|소개|바이오|바이오그래피)$/i;
const PROFILE_TEXT = /^(?:artist\s*)?(?:profile|biography|bio|about(?:\s+us)?|プロフィール|バイオグラフィー?|経歴|아티스트\s*소개|프로필|소개|바이오(?:그래피)?)(?:\s*[/|・·]\s*\S{1,20})?$/i;
const PROFILE_TITLE = /(?:^|[\s|｜\-–—:：/・])(?:profile|biography|bio|about|プロフィール|バイオグラフィー?|経歴|프로필|아티스트\s*소개|소개)(?:$|[\s|｜\-–—:：/・])/i;
// Tokens that disqualify an image or its containers. Matched against tokens, not substrings.
const EXCLUDE_TOKEN = /^(?:logo|logos|dummy|spacer|blank|placeholder|noimage|nophoto|transparent|banner|banners|bnr|jacket|jk|album|albums|disc|discography|single|singles|cd|dvd|bluray|blu|ray|goods|product|products|merch|merchandise|shop|store|tour|tours|live|poster|posters|flyer|ticket|tickets|icon|icons|sns|qr|badge|sprite|ad|ads|pr|campaign|release|releases|news|video|movie|mv|avatar|emblem|sponsor|sponsors|partner|partners)$/i;
const EXCLUDE_TEXT = /ロゴ|バナー|ジャケット|アルバム|グッズ|ツアー|ポスター|チケット|シングル|로고|배너|자켓|재킷|앨범|굿즈|투어|포스터|티켓|싱글/;
const MEMBER_TOKEN = /^(?:member|members|memberlist|member_item|メンバー|멤버)$/i;
const PORTRAIT_TOKEN = /^(?:artist|artists|photo|photos|profile|portrait|visual|mainvisual|kv|keyvisual|thumb|thumbnail|figure|image|img|pic|picture|asha|aphoto|group|groupphoto|hero|アー写|アーティスト写真|프로필사진)$/i;
const NAMEISH_TOKEN = /^(?:name|names|title|heading|ttl|headline|artistname)$/i;
const ARTIST_TYPE = /^(?:Person|MusicGroup|PerformingGroup|MusicArtist)$/i;
const GROUP_TYPE = /^(?:MusicGroup|PerformingGroup)$/i;

const fail = (code) => Object.assign(new Error(code), { code });
const decode = (s) => unescapeHtml(String(s ?? ''));
const text = (s) => decode(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const bounded = (s, n = 240) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const attrs = (s) => Object.fromEntries([...String(s).matchAll(/([^\s=<>/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map(m => [m[1].toLowerCase(), decode(m[2] ?? m[3] ?? m[4] ?? '')]));
const tokens = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
// Split camel/kebab/snake (e.g. "artist--detail__name", "logo--pmga.png") into tokens.
const classTokens = (s) => tokens(String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' '));
const decodeSafe = (s) => { try { return decodeURIComponent(s); } catch { throw fail('invalid_url'); } };

/* ---------- name normalization (ko / ja / latin variants) ---------- */
export function normalizeName(value) {
  let s = String(value ?? '').normalize('NFKC');
  // Strip Latin diacritics only (keep kana dakuten / Hangul syllables intact).
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').normalize('NFKC').toLowerCase();
  // Katakana -> hiragana so ミセス / みせす compare equal.
  s = s.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  return s;
}
const compact = (s) => normalizeName(s).replace(/[^\p{L}\p{N}]+/gu, '');
const isLatinName = (s) => /^[\p{Script=Latin}\p{N}]+$/u.test(s);
function makeMatcher(names) {
  const list = [];
  for (const raw of [].concat(names || []).slice(0, MAX_NAMES)) {
    if (typeof raw !== 'string' || raw.length > 120) continue;
    const c = compact(raw);
    if (c.length < 2 || list.some(x => x.c === c)) continue;
    list.push({ raw: bounded(raw, 120), c, latin: isLatinName(c) });
  }
  const match = (value) => {
    if (!value || !list.length) return null;
    const n = normalizeName(value);
    const whole = n.replace(/[^\p{L}\p{N}]+/gu, '');
    // Latin tokens only; boundaries are any non-Latin/number char (incl. CJK).
    const toks = n.match(/[\p{Script=Latin}\p{N}]+/gu) || [];
    for (const name of list) {
      if (!name.latin) { if (whole.includes(name.c)) return name.raw; continue; }
      // Whole-token window match: "Mrs. GREEN APPLE" == "MrsGreenApple", "IVE" != "LIVE".
      for (let i = 0; i < toks.length; i++) {
        let joined = '';
        for (let j = i; j < toks.length && joined.length < name.c.length; j++) {
          joined += toks[j];
          if (joined === name.c) return name.raw;
        }
      }
    }
    return null;
  };
  return { list, match };
}

/* ---------- URL safety ---------- */
function safeHost(u) {
  const host = u.hostname.replace(/^\[|\]$/g, '');
  return !(u.username || u.password || u.port || (!host.includes('.') && !isIP(host)) || host.endsWith('.') ||
    /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|corp|test|invalid|onion|example\.invalid)$/i.test(host) ||
    (isIP(host) && !isPublicAddress(host)));
}
function checkPageUrl(value, { base, origin } = {}) {
  let u;
  try {
    if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /[\u0000-\u0020\\]/.test(value.trim())) throw 0;
    u = base ? new URL(value.trim(), base) : new URL(value.trim());
  } catch { throw fail('invalid_url'); }
  if (u.protocol !== 'https:') throw fail('non_https');
  if (!safeHost(u)) throw fail('unsafe_destination');
  if (origin && u.origin !== origin) throw fail('cross_origin');
  if (/%(?:00|25|2f|5c)/i.test(u.pathname)) throw fail('unsafe_path_encoding');
  if (PRIVATE_PATH.test(decodeSafe(u.pathname))) throw fail('nonpublic_path');
  for (const [k, v] of u.searchParams) if (!PAGE_QUERY.test(k) || v.length > 20 || !/^[\w-]*$/.test(v)) throw fail('unsafe_query');
  u.hash = '';
  return u;
}
function checkImageUrl(value, base) {
  let u;
  try {
    if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /^\s*data:/i.test(value) || /[\u0000-\u001f\\]/.test(value.trim())) throw 0;
    u = new URL(value.trim(), base);
  } catch { throw fail('invalid_image_url'); }
  if (u.protocol !== 'https:') throw fail('non_https_image');
  if (!safeHost(u)) throw fail('unsafe_image_host');
  if (/%(?:00|2f|5c)/i.test(u.pathname)) throw fail('unsafe_image_path');
  if (/\.(?:gif|svg|ico|cur|bmp)$/i.test(u.pathname)) throw fail('non_photo_format');
  // Allowed: rendering params and cache-busters (?v=..., ?var=..., bare ?1789712661789).
  for (const [k, v] of u.searchParams) if (!(IMAGE_QUERY.test(k) || (/^\d{1,16}$/.test(k) && !v)) || v.length > 40 || /[@\s:/]/.test(v)) throw fail('unsafe_image_query');
  u.hash = '';
  return u;
}

/* ---------- tiny HTML tree (bounded) ---------- */
function stripNonContent(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe|object|canvas|select|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
}
function parseTree(html) {
  const root = { tag: '#root', a: {}, children: [], parent: null };
  let cur = root, count = 0;
  const re = /<(\/?)([a-zA-Z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  for (const m of stripNonContent(html).matchAll(re)) {
    if (++count > MAX_NODES) break;
    if (m[4] != null) { const t = m[4]; if (t.trim()) cur.children.push({ tag: '#text', text: t }); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      let n = cur; while (n && n.tag !== tag) n = n.parent;
      if (n && n.parent) cur = n.parent;
      continue;
    }
    if ((tag === 'li' && cur.tag === 'li') || (tag === 'p' && cur.tag === 'p')) cur = cur.parent;
    const node = { tag, a: attrs(m[3]), children: [], parent: cur };
    cur.children.push(node);
    if (!VOID.has(tag) && !/\/\s*$/.test(m[3])) cur = node;
  }
  return root;
}
function nodeText(node, cap = 4000) {
  let out = '';
  const walk = (n) => {
    if (out.length > cap) return;
    if (n.tag === '#text') { out += ' ' + n.text; return; }
    if (n.tag === 'br') out += ' ';
    for (const c of n.children || []) walk(c);
  };
  walk(node);
  return text(out).slice(0, cap);
}
function* walkNodes(node) {
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (n.tag !== '#text') yield n;
    for (let i = (n.children?.length || 0) - 1; i >= 0; i--) stack.push(n.children[i]);
  }
}
const ancestors = (n) => { const out = []; for (let p = n.parent; p && p.tag !== '#root'; p = p.parent) out.push(p); return out; };
const isHidden = (n) => 'hidden' in n.a || n.a['aria-hidden'] === 'true' || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(n.a.style || '');
const nodeTokens = (n) => classTokens([n.a.class, n.a.id].join(' '));

/* ---------- page analysis ---------- */
function jsonLdNodes(html) {
  const out = [];
  for (const m of String(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/application\/ld\+json/i.test(attrs(m[1]).type || '')) continue;
    let data; try { data = JSON.parse(m[2]); } catch { continue; }
    let seen = 0;
    const walk = (v, depth) => {
      if (++seen > 2000 || depth > 10 || !v || typeof v !== 'object') return;
      if (Array.isArray(v)) { v.slice(0, 100).forEach(x => walk(x, depth + 1)); return; }
      const types = [].concat(v['@type'] || []).filter(x => typeof x === 'string');
      if (types.some(t => ARTIST_TYPE.test(t))) out.push({ types, node: v, script: out.length });
      for (const [k, x] of Object.entries(v)) if (k !== 'image') walk(x, depth + 1);
    };
    walk(data, 0);
    if (out.length > 200) break;
  }
  return out;
}
function jsonLdImages(node) {
  const out = [];
  for (const item of [].concat(node.image || []).slice(0, 10)) {
    if (typeof item === 'string') out.push({ url: item, publication: null });
    else if (item && typeof item === 'object') {
      const url = typeof item.contentUrl === 'string' ? item.contentUrl : typeof item.url === 'string' ? item.url : null;
      const date = [item.datePublished, item.uploadDate, item.dateCreated].find(d => typeof d === 'string' && !Number.isNaN(Date.parse(d)));
      if (url) out.push({ url, publication: date ? { date: new Date(Date.parse(date)).toISOString(), source: 'json-ld-image', field: item.datePublished === date ? 'datePublished' : item.uploadDate === date ? 'uploadDate' : 'dateCreated' } : null, caption: bounded(item.caption || item.name || '', 200) });
    }
  }
  return out;
}
function excludedBy(values) {
  for (const v of values) {
    if (!v) continue;
    const hit = classTokens(v).find(t => EXCLUDE_TOKEN.test(t));
    if (hit) return hit;
    if (EXCLUDE_TEXT.test(v)) return 'text';
  }
  return null;
}
function isProfileUrl(u) {
  return decodeSafe(u.pathname).split('/').filter(Boolean).some(seg => {
    const s = seg.replace(/\.(?:html?|php|aspx?|jsp|do)$/i, '');
    return PROFILE_SEG.test(s) || /^(?:profile|biography)[_-][\p{L}\p{N}]{1,12}$/iu.test(s);
  });
}
// Site root or a bare language root: section headings there are teasers, not a profile page.
function isSiteRoot(u) {
  const segs = decodeSafe(u.pathname).split('/').filter(Boolean);
  return !segs.length || (segs.length === 1 && (/^index\.\w+$/i.test(segs[0]) || /^(?:ja|jp|jpn|en|eng|ko|kr|kor|zh|cn|tw)$/i.test(segs[0])));
}
const sameDoc = (a, b) => {
  const norm = (u) => { const x = new URL(u); x.hash = ''; let p = x.pathname; try { p = decodeURIComponent(p); } catch {} return x.origin.toLowerCase() + p.replace(/\/+$/, '').replace(/\/index\.\w+$/i, '') + x.search; };
  try { return norm(a) === norm(b); } catch { return false; }
};
const PLACEHOLDER_SRC = /dummy|blank|spacer|placeholder|lazy|loading|transparent|noimage|no-image|1x1|pixel|\.gif(?:$|\?)|\.svg(?:$|\?)/i;
const PLACEHOLDER_ALT = /^(?:\(?\s*(?:eng|kor|jpn|ko|ja|en|kr|jp)\s*\)?\s*)?alt(?:\s*(?:tag|text))?$|^(?:image|img|photo|picture|thumbnail|thumb|写真|画像|이미지|사진|\d+)$/i;
const SITE_ALT = /official|公式|오피셜|공식|site|サイト|사이트|web/i;
const BG_TOKEN = /^(?:bg|background|backdrop|pattern|texture|overlay|deco|decoration)$/i;
const RESPONSIVE_TOKEN = /^(?:pc|sp|mobile|mob|desktop|tablet|is|only|show|hide|hidden|block|inline|flex|none|md|lg|sm|xl|xs|2xl)$/i;
const PROFILE_HEAD = /^(?:artist\s*)?(?:profile|biography|bio|about|introduce|introduction|プロフィール|バイオグラフィー?|経歴|프로필|소개|아티스트\s*소개|바이오(?:그래피)?)$/i;
const HEADLIKE_TOKEN = /^(?:tit|ttl|title|subtitle|heading|headline|sectiontitle|sectiontit|hd)$/i;
const ACTIVE_TOKEN = /^(?:on|active|current|selected|is|now|cur)$/i;
const smallBox = (n) => {
  const cls = n.a.class || '';
  for (const m of cls.matchAll(/(?:^|\s)(?:[\w-]+:)?(?:max-)?[wh]-\[(\d+(?:\.\d+)?)(px|rem)\]/g)) if ((m[2] === 'rem' ? +m[1] * 16 : +m[1]) < 200) return true;
  const st = /(?:^|;)\s*(?:max-)?(?:width|height)\s*:\s*(\d+(?:\.\d+)?)px/i.exec(n.a.style || '');
  return !!(st && +st[1] < 200);
};

function analyzePage(page, matcher, { profileHint }) {
  const { html, url } = page;
  const nameTokenSet = new Set(matcher.list.flatMap(x => classTokens(normalizeName(x.raw))));
  const withoutNames = (alt) => classTokens(alt).filter(t => !nameTokenSet.has(t)).join(' ');
  const tree = parseTree(html);
  const title = bounded(text(String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || ''), 300);
  const all = [...walkNodes(tree)];
  const mains = all.filter(n => n.tag === 'main' || n.a.role === 'main');
  const inChrome = (n) => [n, ...ancestors(n)].some(a => CHROME.has(a.tag) || ['navigation', 'banner', 'contentinfo'].includes(a.a.role));
  const scopeOk = (n) => {
    const anc = ancestors(n);
    if (isHidden(n) || anc.some(a => CHROME.has(a.tag) || a.a.role === 'navigation' || a.a.role === 'banner' || a.a.role === 'contentinfo' || isHidden(a))) return false;
    return mains.length ? anc.some(a => mains.includes(a)) || mains.includes(n) : true;
  };
  const pageUrl = new URL(url);
  const root = isSiteRoot(pageUrl);
  const headingNodes = all.filter(n => /^h[1-6]$/.test(n.tag) && !inChrome(n));
  const headingTexts = headingNodes.map(n => ({ tag: n.tag, text: bounded(nodeText(n, 300), 300) })).filter(h => h.text);
  const identity = [];
  const titleMatch = matcher.match(title);
  if (titleMatch) identity.push({ kind: 'title', text: title, matched: titleMatch });
  for (const h of headingTexts) { const m = matcher.match(h.text); if (m) identity.push({ kind: 'heading', tag: h.tag, text: h.text, matched: m }); }
  // Site brand: the page-level <h1> wordmark in the header (text, sr-only text or image alt).
  for (const n of all.filter(x => x.tag === 'h1' && inChrome(x)).slice(0, 4)) {
    const t = bounded([nodeText(n, 200), ...[...walkNodes(n)].filter(d => d.tag === 'img').map(d => d.a.alt || '')].join(' '), 200);
    const m = t && matcher.match(t);
    if (m) { identity.push({ kind: 'site-brand', tag: 'h1', text: t, matched: m }); break; }
  }
  // Main-content artist name elements (e.g. <p class="artist--detail__name">), never member items.
  let nameEls = 0;
  for (const n of all) {
    if (nameEls >= 20 || /^h[1-6]$/.test(n.tag) || !nodeTokens(n).some(t => NAMEISH_TOKEN.test(t))) continue;
    if (!scopeOk(n) || [n, ...ancestors(n)].some(a => nodeTokens(a).some(t => MEMBER_TOKEN.test(t)))) continue;
    const t = bounded(nodeText(n, 300), 300); nameEls++;
    const m = t && matcher.match(t);
    if (m) identity.push({ kind: 'name-element', tag: n.tag, class: bounded(n.a.class || '', 120), text: t, matched: m });
  }
  // Multi-artist company pages: the site's own navigation marks THIS page as the artist
  // (active item linking to this exact URL) AND main content names the artist. URL alone never counts.
  if (!identity.length) {
    const contentText = nodeText(mains[0] || tree, 20000);
    const mention = matcher.match(contentText);
    if (mention) {
      for (const a of all) {
        if (a.tag !== 'a' || !a.a.href || /^\s*(?:#|javascript:)/i.test(a.a.href)) continue;
        let target; try { target = new URL(a.a.href, url).href; } catch { continue; }
        if (!sameDoc(target, url)) continue;
        const marked = a.a['aria-current'] && a.a['aria-current'] !== 'false' || [a, a.parent].some(x => x && nodeTokens(x).some(t => ACTIVE_TOKEN.test(t) && t !== 'is'));
        const t = bounded(nodeText(a, 120), 120), m = marked && t && matcher.match(t);
        if (m && compact(t) === compact(m)) { identity.push({ kind: 'active-nav', text: t, matched: m, contentMention: mention }); break; }
      }
    }
  }
  // Structured data.
  const ld = jsonLdNodes(html);
  const ldMatched = [], ldConflicts = [];
  for (const entry of ld) {
    const names = [entry.node.name, ...[].concat(entry.node.alternateName || [])].filter(x => typeof x === 'string').slice(0, 10);
    const hit = names.map(n => matcher.match(n)).find(Boolean);
    if (hit) { ldMatched.push(entry); identity.push({ kind: 'json-ld', type: entry.types.join(','), text: bounded(names[0], 200), matched: hit }); }
    else ldConflicts.push({ type: entry.types.join(','), name: bounded(names[0] || '', 200) });
  }
  const groupConflict = ld.some(e => e.types.some(t => GROUP_TYPE.test(t))) && !ldMatched.length;
  const profileHeading = (n) => {
    const isHead = /^h[1-6]$/.test(n.tag) || nodeTokens(n).some(t => HEADLIKE_TOKEN.test(t));
    if (!isHead) return null;
    const t = bounded(nodeText(n, 80), 80).replace(/^[■□●◆◇・\s]+/, '');
    return PROFILE_HEAD.test(t) ? t : null;
  };
  const titleProfile = PROFILE_TITLE.test(title);
  const headingProfile = !root && all.some(n => scopeOk(n) && profileHeading(n));
  const profileSignal = isProfileUrl(pageUrl) ? 'path' : titleProfile ? 'title' : headingProfile ? 'heading' : profileHint && !root ? 'observed-link-text' : null;
  const base = { title, identity, profileSignal, ldConflicts: ldConflicts.slice(0, 10) };
  // A non-profile page (e.g. homepage) never supplies a portrait, whatever its og:image.
  if (!profileSignal) return { ...base, reason: 'not_profile_page' };
  if (groupConflict) return { ...base, reason: 'identity_conflict' };
  if (!identity.length) return { ...base, reason: ldConflicts.length ? 'identity_conflict' : 'identity_not_verified' };

  const rejections = [];
  // 1) Exact artist JSON-LD image.
  const ldCandidates = [];
  for (const entry of ldMatched) {
    for (const img of jsonLdImages(entry.node)) {
      try {
        const u = checkImageUrl(img.url, url);
        const ex = excludedBy([u.pathname.split('/').pop(), img.caption]);
        if (ex) { rejections.push({ imageUrl: u.href, reason: `excluded_${ex === 'text' ? 'label' : ex}` }); continue; }
        if (!ldCandidates.some(c => c.imageUrl === u.href)) ldCandidates.push({ imageUrl: u.href, publication: img.publication, location: { kind: 'json-ld', type: entry.types.join(','), name: bounded(entry.node.name || '', 200) } });
      } catch (e) { rejections.push({ imageUrl: bounded(img.url, 300), reason: e.code || 'invalid_image_url' }); }
    }
  }
  // 2) Main-content portrait (img or inline background-image).
  const bound = [], unbound = [];
  let cssOnlyPortrait = false;
  let imgIndex = -1;
  const linkedCss = /<link\b[^>]*rel\s*=\s*["']?stylesheet/i.test(html);
  for (const n of all) {
    const inline = /background(?:-image)?\s*:[^;]*url\(\s*(['"]?)([^'")]+)\1\s*\)/i.exec(n.a.style || '');
    if (n.tag !== 'img' && !inline) {
      if (!cssOnlyPortrait && n.tag !== 'main' && nodeTokens(n).some(t => /^(?:photo|portrait|asha|aphoto|visual|mainvisual|kv|keyvisual|pic|picture)$/.test(t)) &&
          ![...walkNodes(n)].some(d => d.tag === 'img') && scopeOk(n)) cssOnlyPortrait = true;
      continue;
    }
    if (n.tag === 'img') imgIndex++;
    if (!scopeOk(n)) continue;
    let kind = n.tag === 'img' ? 'main-img' : 'inline-style';
    let src;
    if (n.tag === 'img') {
      const lazy = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'data-echo'].map(k => n.a[k]).find(v => v && !PLACEHOLDER_SRC.test(v));
      src = lazy || n.a.src;
      if ((!src || /^\s*data:/i.test(src) || PLACEHOLDER_SRC.test(src)) && inline && !PLACEHOLDER_SRC.test(inline[2])) { src = inline[2]; kind = 'img-inline-style'; }
    } else src = inline[2];
    const loc = { kind, index: imgIndex };
    const anc = ancestors(n);
    let alt = bounded(n.a.alt || n.a['aria-label'] || n.a.title || '', 240);
    if (PLACEHOLDER_ALT.test(alt)) alt = '';
    let imageUrl;
    try { imageUrl = checkImageUrl(src, url).href; } catch (e) { rejections.push({ imageUrl: bounded(src || '', 300), reason: e.code || 'invalid_image_url', location: loc }); continue; }
    const reject = (reason) => rejections.push({ imageUrl, reason, location: loc });
    const fileName = decodeSafe(new URL(imageUrl).pathname.split('/').pop() || '');
    const ex = excludedBy([n.a.class, n.a.id, fileName, withoutNames(alt)]) || excludedBy(anc.slice(0, 8).map(a => [a.a.class, a.a.id].join(' ')));
    if (ex) { reject(`excluded_${ex === 'text' ? 'label' : ex}`); continue; }
    // Decorative backgrounds: checked only on the image itself and its direct parent
    // (utility classes such as "bg-white" on outer wrappers must not exclude content).
    if ([...classTokens([n.a.class, n.a.id, fileName.replace(/\.\w+$/, '')].join(' ')), ...(anc[0] ? classTokens([anc[0].a.id, anc[0].a.class].join(' ')).filter(t => t !== 'bg' || anc[0].a.id === 'bg') : [])].some(t => BG_TOKEN.test(t))) { reject('excluded_background'); continue; }
    if (anc.some(a => /^h[1-6]$/.test(a.tag))) { reject('heading_wordmark'); continue; }
    const link = anc.find(a => a.tag === 'a');
    if (link && link.a.href && !/^\s*(?:#|javascript:)/i.test(link.a.href)) {
      let target = null; try { target = new URL(link.a.href, url).href; } catch {}
      if (target && !sameDoc(target, url) && !/\.(?:jpe?g|png|webp|avif)(?:$|\?)/i.test(new URL(target).pathname)) { reject('linked_teaser'); continue; }
    }
    if (anc.slice(0, 8).some(a => nodeTokens(a).some(t => MEMBER_TOKEN.test(t))) || nodeTokens(n).some(t => MEMBER_TOKEN.test(t))) { reject('member_only_context'); continue; }
    const w = Number(n.a.width), h = Number(n.a.height);
    if ((w && w < 160) || (h && h < 160) || smallBox(n) || anc.slice(0, 2).some(smallBox)) { reject('too_small'); continue; }
    if (w && h && (w / h > 3.2 || h / w > 3.2)) { reject('banner_aspect'); continue; }
    const altMatch = alt ? matcher.match(alt) : null;
    if (alt && !altMatch && !SITE_ALT.test(alt)) { reject('alt_not_artist'); continue; }
    const section = anc.find(a => a.tag === 'section' || a.tag === 'article') || anc.find(a => a.tag === 'main' || a.a.role === 'main') || null;
    let sectionName = null, sectionHeadingConflict = null;
    if (section) {
      for (const d of walkNodes(section)) {
        if (d === n) continue;
        const isHeading = /^h[1-6]$/.test(d.tag), nameish = nodeTokens(d).some(t => NAMEISH_TOKEN.test(t)) && !ancestors(d).some(a => nodeTokens(a).some(t => MEMBER_TOKEN.test(t)));
        if (!isHeading && !nameish) continue;
        const t = bounded(nodeText(d, 300), 300); if (!t) continue;
        const m = matcher.match(t);
        if (m && !sectionName) sectionName = { tag: d.tag, class: bounded(d.a.class || '', 120), text: t, matched: m };
        if (isHeading && !m && !sectionHeadingConflict && !PROFILE_TITLE.test(` ${t} `) && !PROFILE_HEAD.test(t)) sectionHeadingConflict = t;
      }
    }
    if (!altMatch && !sectionName && sectionHeadingConflict) { reject('section_identity_conflict'); continue; }
    const container = n.tag === 'img' ? anc.slice(0, 4).find(a => a.tag === 'figure' || nodeTokens(a).some(t => PORTRAIT_TOKEN.test(t))) : (nodeTokens(n).some(t => PORTRAIT_TOKEN.test(t)) ? n : null);
    // Responsive pair (pc/sp, isPc/isMobile, hidden md:block) in the same slot = one picture.
    const slot = (anc[0] ? anc.indexOf(anc[0]) + ':' : '') + classTokens(n.a.class).filter(t => !RESPONSIVE_TOKEN.test(t)).join('.');
    const cand = {
      imageUrl, publication: null, node: n, parent: anc[0], slot,
      location: { kind, index: imgIndex, tag: n.tag, alt, container: container ? { tag: container.tag, class: bounded(container.a.class || '', 120) } : null, section: section ? { tag: section.tag, class: bounded(section.a.class || '', 120) } : null },
      binding: { alt: altMatch, sectionName },
    };
    if (altMatch || sectionName) {
      if (!container && !altMatch) { reject('not_portrait_container'); continue; }
      if (!bound.some(c => c.imageUrl === imageUrl)) bound.push(cand);
    } else if (!unbound.some(c => c.imageUrl === imageUrl)) unbound.push(cand);
    if (bound.length + unbound.length > 40) break;
  }
  const collapse = (list) => {
    const out = [];
    for (const c of list) {
      const twin = out.find(o => o.parent && o.parent === c.parent && o.slot === c.slot);
      if (!twin) { out.push(c); continue; }
      const desk = (x) => classTokens(x.node.a.class).some(t => /^(?:pc|desktop)$/.test(t)) || /(?:^|\s)(?:md|lg):block/.test(x.node.a.class || '');
      if (desk(c) && !desk(twin)) out[out.indexOf(twin)] = c;
    }
    return out;
  };
  // Repeated list/grid items (member grids, teaser lists, sliders): an element whose parent
  // holds >=2 same-tag same-class siblings that each contain a picture.
  const hasImg = (x) => x.tag === 'img' || [...walkNodes(x)].some(d => d.tag === 'img' || /url\(/i.test(d.a.style || ''));
  const repeatedItem = (c) => ancestors(c.node).slice(0, 5).some(a => a.parent && a.parent.tag !== '#root' &&
    a.parent.children.filter(sib => sib.tag === a.tag && (sib.a.class || '') === (a.a.class || '') && !(sib.a.id && a.a.id && sib.a.id !== a.a.id) &&
      ((a.a.class || '').trim() !== '' || ['li', 'figure', 'article', 'dd'].includes(a.tag)) && hasImg(sib)).length >= 2);
  const domBound = collapse(bound).filter(c => !repeatedItem(c) || (rejections.push({ imageUrl: c.imageUrl, reason: 'repeated_list_item', location: c.location }), false));
  const domUnbound = collapse(unbound).filter(c => !repeatedItem(c) || (rejections.push({ imageUrl: c.imageUrl, reason: 'repeated_list_item', location: c.location }), false));
  const ldIds = new Set(ldCandidates.map(c => c.imageUrl));
  const clean = (c) => ({ imageUrl: c.imageUrl, publication: c.publication, location: c.location, binding: c.binding, corroboratedByMainContent: c.corroboratedByMainContent });
  let pick = null, reason = null;
  if (ldCandidates.length === 1) pick = { ...ldCandidates[0], corroboratedByMainContent: domBound.concat(domUnbound).some(c => ldIds.has(c.imageUrl)) };
  else if (ldCandidates.length > 1) {
    const both = ldCandidates.filter(c => domBound.some(d => d.imageUrl === c.imageUrl));
    if (both.length === 1) pick = { ...both[0], corroboratedByMainContent: true }; else reason = 'ambiguous_portrait';
  } else if (domBound.length === 1) pick = clean(domBound[0]);
  else if (domBound.length > 1) reason = 'ambiguous_portrait';
  else if (domUnbound.length) {
    // Profile-section fallback: page identity verified (not URL), and exactly ONE unbound
    // content picture sits under a dedicated profile heading/container, outside any
    // repeated list (member grids, teaser lists). Anything else stays unavailable.
    const profileContext = (c) => {
      for (const a of ancestors(c.node).slice(0, 10)) {
        if (!scopeOk(a) && !mains.includes(a) && mains.length) break;
        if (classTokens([a.a.class, a.a.id].join(' ')).some(t => /^(?:profile|biography|bio|about|introduce)$/.test(t))) return { container: bounded([a.tag, a.a.id && '#' + a.a.id, a.a.class && '.' + a.a.class].filter(Boolean).join(''), 160) };
        for (const d of walkNodes(a)) { if (d === c.node) continue; const t = profileHeading(d); if (t) return { heading: t, tag: d.tag }; }
      }
      return null;
    };
    const strong = identity.filter(x => x.kind !== 'active-nav' || x.contentMention);
    if (domUnbound.length > 1) reason = 'ambiguous_portrait';
    else {
      const ctx = profileContext(domUnbound[0]);
      if (ctx && strong.length) pick = { ...clean(domUnbound[0]), binding: { profileSection: ctx, pageIdentity: strong.slice(0, 3).map(x => ({ kind: x.kind, text: bounded(x.text, 120) })) } };
      else { rejections.push({ imageUrl: domUnbound[0].imageUrl, reason: 'portrait_not_bound_to_artist', location: domUnbound[0].location }); reason = 'no_bound_portrait'; }
    }
  }
  if (!pick && !reason) reason = rejections.some(x => x.reason === 'section_identity_conflict') ? 'section_identity_conflict' : cssOnlyPortrait && linkedCss ? 'portrait_in_linked_css_not_fetched' : 'no_bound_portrait';
  if (!pick && reason === 'ambiguous_portrait') for (const c of (domBound.length > 1 ? domBound : domUnbound).slice(0, 5)) rejections.push({ imageUrl: c.imageUrl, reason: 'ambiguous_candidate', location: c.location });
  return { ...base, pick, reason: pick ? null : reason, rejections: rejections.slice(0, 30), candidates: ldCandidates.length + domBound.length + domUnbound.length };
}

function sameSiteRedirect(location, from) {
  let to, f;
  try { f = new URL(from); to = new URL(location, from); } catch { return null; }
  if (!/^https?:$/.test(to.protocol) || to.username || to.password || (to.port && to.port !== '443')) return null;
  const bare = (h) => h.toLowerCase().replace(/^www\./, '');
  if (bare(to.hostname) !== bare(f.hostname)) return null;
  to.protocol = 'https:'; to.port = '';
  try { return checkPageUrl(to.href); } catch { return null; }
}

function discoverLinks(html, pageUrl, origin) {
  const out = [];
  for (const m of stripNonContent(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const a = attrs(m[1]);
    if (!a.href || /^\s*(?:#|javascript:|mailto:|tel:)/i.test(a.href)) continue;
    const label = bounded(text(m[2]) || a['aria-label'] || a.title || '', 120);
    let u; try { u = checkPageUrl(a.href, { base: pageUrl, origin }); } catch { continue; }
    if (u.href === new URL(pageUrl).href.replace(/#.*$/, '')) continue;
    const byPath = isProfileUrl(u), byText = PROFILE_TEXT.test(label);
    if (!byPath && !byText) continue;
    const rank = (byPath ? 2 : 0) + (byText ? 1 : 0) + (/profile|プロフィール|프로필/i.test(label + u.pathname) ? 1 : 0);
    if (!out.some(x => x.url === u.href)) out.push({ url: u.href, text: label, rank, byPath, byText, order: out.length });
    if (out.length >= 40) break;
  }
  return out.sort((x, y) => y.rank - x.rank || x.order - y.order);
}

/** collectOfficialPortrait({artistId, officialUrl, names}, deps)
 * deps.read(url, {signal,timeoutMs,maxBytes,lookup,fetchImpl}) -> {html,url,bytes}
 *   trusted fixture transport; defaults to assistance.readPublicHtml.
 * deps.now, deps.timeoutMs (total), deps.maxBytes (per page).
 */
export async function collectOfficialPortrait({ artistId, officialUrl, names = [] } = {}, deps = {}) {
  const now = deps.now || (() => new Date());
  const checkedAt = new Date(now()).toISOString();
  const matcher = makeMatcher(names);
  const evidence = { officialUrl: null, names: matcher.list.map(x => x.raw), pages: [], links: [], identity: [], image: null, rejections: [], warnings: [] };
  const result = { artistId: bounded(artistId ?? '', 120) || null, status: 'unavailable', imageUrl: null, sourceUrl: null, checkedAt, method: 'official-profile', evidence, reason: null, publication: null };
  const done = (reason) => { result.reason = reason; return result; };
  let start;
  try { start = checkPageUrl(officialUrl); } catch (e) { evidence.warnings.push({ code: e.code || 'invalid_url' }); return done('invalid_official_url'); }
  evidence.officialUrl = start.href;
  if (!matcher.list.length) return done('no_artist_names');
  const read = deps.read || readPublicHtml;
  const maxBytes = Math.max(1, Math.min(MAX_BYTES, Number(deps.maxBytes) || MAX_BYTES));
  const totalMs = Math.max(10, Math.min(TOTAL_MS, Number(deps.timeoutMs) || TOTAL_MS));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), totalMs);
  const deadline = Date.now() + totalMs;
  const queue = [{ url: start.href, role: 'start', hint: null }];
  const seen = new Set();
  let followed = 0, best = null, origin = start.origin, restarted = false;
  const priority = ['identity_conflict', 'section_identity_conflict', 'ambiguous_portrait', 'portrait_in_linked_css_not_fetched', 'no_bound_portrait', 'identity_not_verified', 'not_profile_page'];
  const note = (r) => { if (r && (!best || priority.indexOf(r) !== -1 && (priority.indexOf(best) === -1 || priority.indexOf(r) < priority.indexOf(best)))) best = r; };
  try {
    while (queue.length && evidence.pages.length < MAX_PAGES && !controller.signal.aborted) {
      const item = queue.shift();
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      let page;
      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw fail('timeout');
        const p = read(item.url, { signal: controller.signal, timeoutMs: Math.min(PAGE_MS, remaining), maxBytes, lookup: deps.lookup, fetchImpl: deps.fetchImpl });
        page = await new Promise((resolve, reject) => {
          const onAbort = () => reject(fail('timeout'));
          if (controller.signal.aborted) return onAbort();
          controller.signal.addEventListener('abort', onAbort, { once: true });
          Promise.resolve(p).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', onAbort));
        });
        if (!page || typeof page.html !== 'string') throw fail('invalid_page');
        const finalUrl = checkPageUrl(String(page.url || item.url), { origin }).href;
        const bytes = Number(page.bytes) || Buffer.byteLength(page.html);
        if (bytes > maxBytes || Buffer.byteLength(page.html) > maxBytes) throw fail('page_too_large');
        page = { html: page.html, url: finalUrl, bytes };
      } catch (e) {
        evidence.pages.push({ url: item.url, role: item.role, ok: false, code: e.code || 'upstream_unavailable' });
        // Same-site redirect the transport refused (www<->apex, http->https on the same host):
        // only when the transport reports the observed Location; restart once from it.
        const loc = item.role === 'start' && !restarted && typeof (e.location || e.redirectLocation) === 'string' ? sameSiteRedirect(e.location || e.redirectLocation, item.url) : null;
        if (loc && !seen.has(loc.href)) {
          restarted = true; origin = loc.origin;
          evidence.warnings.push({ code: 'same_site_redirect_restart', from: item.url, to: loc.href });
          queue.unshift({ url: loc.href, role: 'start', hint: null });
          continue;
        }
        if (item.role === 'start' && !queue.length) note(e.code === 'timeout' ? 'timeout' : 'official_page_unavailable');
        continue;
      }
      seen.add(page.url);
      if (item.role === 'followed') followed++;
      const analysis = analyzePage(page, matcher, { profileHint: item.hint });
      evidence.pages.push({ url: page.url, requestedUrl: item.url !== page.url ? item.url : undefined, role: item.role, ok: true, bytes: page.bytes, observedAt: new Date(now()).toISOString(), title: analysis.title, profileSignal: analysis.profileSignal, outcome: analysis.pick ? 'verified' : analysis.reason });
      evidence.identity.push(...analysis.identity.map(x => ({ ...x, sourceUrl: page.url })).slice(0, 10));
      if (analysis.ldConflicts?.length) evidence.warnings.push({ code: 'json_ld_other_artist_nodes', sourceUrl: page.url, nodes: analysis.ldConflicts });
      if (analysis.rejections) evidence.rejections.push(...analysis.rejections.map(x => ({ ...x, sourceUrl: page.url })));
      if (analysis.pick) {
        result.status = 'verified';
        result.imageUrl = analysis.pick.imageUrl;
        result.sourceUrl = page.url;
        result.publication = analysis.pick.publication || null;
        evidence.image = { sourceUrl: page.url, imageUrl: analysis.pick.imageUrl, imageOrigin: new URL(analysis.pick.imageUrl).origin === origin ? 'same-origin' : 'cross-origin', ...analysis.pick.location, binding: analysis.pick.binding || { jsonLd: true }, corroboratedByMainContent: analysis.pick.corroboratedByMainContent, downloaded: false };
        evidence.rejections = evidence.rejections.slice(0, 30);
        return done(null);
      }
      note(analysis.reason);
      // Discovery: only links observed on this page; never fabricate candidates.
      if (followed + queue.filter(q => q.role === 'followed').length < MAX_FOLLOW) {
        for (const link of discoverLinks(page.html, page.url, origin)) {
          if (seen.has(link.url) || queue.some(q => q.url === link.url)) continue;
          if (followed + queue.filter(q => q.role === 'followed').length >= MAX_FOLLOW) break;
          queue.push({ url: link.url, role: 'followed', hint: link.byText ? link.text : null });
          evidence.links.push({ fromUrl: page.url, url: link.url, text: link.text, by: [link.byPath && 'path', link.byText && 'text'].filter(Boolean) });
        }
      }
    }
    if (controller.signal.aborted && !best) note('timeout');
    if (!best || best === 'not_profile_page') {
      best = evidence.links.length ? 'profile_page_unavailable' : evidence.pages.some(p => p.ok) ? 'no_profile_link' : best || 'official_page_unavailable';
    }
    evidence.rejections = evidence.rejections.slice(0, 30);
    return done(best);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
