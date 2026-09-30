/** Local built-bundle verification server, not an Internet-facing production host.
 * node scripts/serve-dist.mjs --port 5241 --api http://localhost:4600
 * Loopback-only by default. Proxies cookies and streaming responses (including SSE).
 */
import http from 'node:http';
import https from 'node:https';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = fileURLToPath(new URL('../frontend/dist/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4' };
const SAFE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' };
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
function cleanHeaders(headers) {
  const extra = String(headers.connection || '').toLowerCase().split(',').map(s => s.trim());
  return Object.fromEntries(Object.entries(headers).filter(([k, v]) => v !== undefined && !HOP.has(k.toLowerCase()) && !extra.includes(k.toLowerCase())));
}
function send(res, status, body, type = 'text/plain; charset=utf-8', method = 'GET') {
  res.writeHead(status, { ...SAFE_HEADERS, 'content-type': type, 'cache-control': 'no-store' });
  res.end(method === 'HEAD' ? undefined : body);
}
export function createDistServer({ root = DEFAULT_ROOT, api = 'http://localhost:4600', maxBody = 1024 * 1024, upstreamTimeout = 15000 } = {}) {
  const origin = new URL(api);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('API must be an HTTP(S) origin without credentials');
  const base = path.resolve(root);
  return http.createServer(async (req, res) => {
    try {
      let decoded;
      try { decoded = decodeURIComponent((req.url || '/').split('?')[0]); } catch { return send(res, 400, 'Invalid path'); }
      if (!decoded.startsWith('/') || /[\\\0%]/.test(decoded) || decoded.split('/').some(x => x === '..' || x.startsWith('.')) || /^\/(?:db|server|backend|scripts|tests|docs|node_modules|logs|tmp|credentials)(?:\/|$)/.test(decoded)) return send(res, 404, 'Not found');
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        if (Number(req.headers['content-length']) > maxBody) return send(res, 413, 'Request too large');
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > maxBody) return send(res, 413, 'Request too large'); chunks.push(chunk); }
        if (res.destroyed) return;
        const headers = cleanHeaders(req.headers);
        headers.host = origin.host;
        const transport = origin.protocol === 'https:' ? https : http;
        const upstream = transport.request(new URL(url.pathname + url.search, origin), { method: req.method, headers }, up => {
          clearTimeout(deadline);
          res.writeHead(up.statusCode || 502, { ...SAFE_HEADERS, ...cleanHeaders(up.headers) });
          up.on('error', () => res.destroy());
          up.pipe(res); // Do not buffer SSE or collapse multiple Set-Cookie headers.
        });
        const deadline = setTimeout(() => upstream.destroy(new Error('Upstream timeout')), upstreamTimeout);
        upstream.on('error', () => { clearTimeout(deadline); if (!res.headersSent) send(res, 502, '{"error":"upstream unavailable"}', 'application/json'); else res.destroy(); });
        res.on('close', () => { clearTimeout(deadline); upstream.destroy(); });
        upstream.end(chunks.length ? Buffer.concat(chunks) : undefined);
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return send(res, 405, 'Method not allowed'); }
      let file = path.resolve(base, '.' + decoded);
      if (file !== base && !file.startsWith(base + path.sep)) return send(res, 404, 'Not found');
      if (decoded.endsWith('/')) file = path.join(file, 'index.html');
      const read = async target => {
        const [realBase, realFile] = await Promise.all([realpath(base), realpath(target)]);
        if (!realFile.startsWith(realBase + path.sep)) throw new Error('Outside build root');
        return readFile(realFile);
      };
      let buf;
      try { buf = await read(file); } catch {
        // Missing scripts/images must never receive HTML 200. SPA fallback is for navigation only.
        if (path.extname(decoded) || !String(req.headers.accept || '').includes('text/html')) return send(res, 404, 'Not found', undefined, req.method);
        file = path.join(base, 'index.html');
        try { buf = await read(file); } catch { return send(res, 503, 'Build unavailable', undefined, req.method); }
      }
      const immutable = /\/assets\/[^/]+-[a-zA-Z0-9_-]{8,}\.(?:js|css|woff2?|png|webp|svg)$/.test(file);
      res.writeHead(200, { ...SAFE_HEADERS, 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-length': buf.length, 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : buf);
    } catch { if (!res.headersSent) send(res, 500, 'Verification server unavailable'); else res.destroy(); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  const port = Number(arg('port', 5241)), host = arg('host', '127.0.0.1'), api = arg('api', 'http://localhost:4600');
  createDistServer({ api }).listen(port, host, () => console.log(`[serve-dist] http://${host}:${port} → api ${api}`));
}
