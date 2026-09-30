/* Image-only outbound transport. Never use fetch's automatic redirects here.
 * Each hop is allowlisted, DNS-checked, and connected using a pinned lookup result.
 * The original hostname remains the HTTP Host / TLS SNI and certificate identity.
 * No proxy environment variables, DNS re-resolution, connection reuse, or SVG.
 * Limit: this is not an image decoder or an egress firewall. Public allowlisted
 * servers may serve unwanted raster content; deployment should also deny private
 * network egress. New legitimate CDN redirect domains require explicit review.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';

export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const HOSTS = /(^|\.)(pia\.jp|eplus\.jp|eplus\.co\.jp|interpark\.com|melon\.co\.kr|mzstatic\.com|dzcdn\.net|aladin\.co\.kr|hmv\.co\.jp|ktown4u\.com|wikimedia\.org|yanolja\.com|nol-universe\.com)$/i;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/apng', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/x-icon', 'image/vnd.microsoft.icon']);
const fail = (status, message) => Object.assign(new Error(message), { status });
export function validateArtworkUrl(value) {
  let u;
  try { u = new URL(value); } catch { throw fail(400, 'Invalid image URL'); }
  if (!/^https?:$/.test(u.protocol) || !HOSTS.test(u.hostname) || u.username || u.password || u.port) throw fail(403, 'Image destination not allowed');
  return u;
}
export function isPublicAddress(address) {
  if (typeof address !== 'string' || address.includes('%')) return false;
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6) return false;
  // Only native global-unicast IPv6; excludes mapped IPv4, loopback, ULA,
  // link-local, multicast, NAT64 and 6to4/tunneling/documentation ranges.
  const groups = address.toLowerCase().split(':');
  const first = parseInt(groups[0], 16), second = parseInt(groups[1] || '0', 16);
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 &&
    !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8)) &&
    !(first === 0x3fff && second <= 0x0fff);
}
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(fail(504, 'Image request timed out'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
const nativeRequest = (url, options, callback) => (url.protocol === 'https:' ? https : http).request(url, options, callback);
function responseFor(url, address, signal, request) {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'GET', agent: false, signal, rejectUnauthorized: true,
      // Pin the previously validated answer; never ask DNS a second time.
      lookup: (_host, opts, done) => done(null, opts?.all ? [address] : address.address, address.family),
      headers: { 'user-agent': 'Mozilla/5.0', accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif', 'accept-encoding': 'identity', referer: url.origin + '/' },
    }, resolve);
    req.once('error', reject);
    req.end();
  });
}
export async function fetchArtwork(value, { lookup = dnsLookup, request = nativeRequest, maxBytes = MAX_IMAGE_BYTES, timeoutMs = 8000, maxRedirects = 4 } = {}) {
  let url = validateArtworkUrl(value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    for (let hop = 0; ; hop++) {
      const addresses = await abortable(lookup(url.hostname, { all: true, verbatim: true }), controller.signal);
      if (!addresses?.length || addresses.some(x => !isPublicAddress(x.address) || isIP(x.address) !== x.family)) throw fail(403, 'Image DNS destination not allowed');
      const address = addresses.find(x => x.family === 4) || addresses[0];
      response = await abortable(responseFor(url, address, controller.signal, request), controller.signal);
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.destroy();
        if (!location || hop >= maxRedirects) throw fail(502, 'Image redirect limit');
        url = validateArtworkUrl(new URL(location, url).href);
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) throw fail(502, 'Image upstream failure');
      const type = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!TYPES.has(type) || !['', 'identity'].includes(String(response.headers['content-encoding'] || '').toLowerCase())) throw fail(502, 'Unsupported image response');
      const length = response.headers['content-length'];
      if (length != null && (!/^\d+$/.test(String(length)) || Number(length) > maxBytes)) throw fail(413, 'Image too large');
      const chunks = [];
      let size = 0;
      for await (const chunk of response) {
        size += chunk.length;
        if (size > maxBytes) throw fail(413, 'Image too large');
        chunks.push(chunk);
      }
      if (!size || (length != null && Number(length) !== size)) throw fail(502, 'Incomplete image response');
      return { type, buf: Buffer.concat(chunks, size) };
    }
  } catch (error) {
    response?.destroy();
    controller.abort();
    if (error.status) throw error;
    throw fail(error.name === 'AbortError' ? 504 : 502, 'Image upstream unavailable');
  } finally { clearTimeout(timer); }
}
