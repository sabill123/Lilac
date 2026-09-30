/* 외부 사이트 호출 공통 도우미.
 *
 * - 데스크톱 Chrome UA (일부 사이트는 UA에 따라 마크업이 달라진다)
 * - 요청마다 타임아웃 (AbortController)
 * - 인코딩 지정 가능 (Shift_JIS / EUC-KR 페이지는 arrayBuffer → TextDecoder)
 * - 200이지만 본문이 잘린 응답을 한 번 재시도한다 (iTunes 등에서 관측)
 */
import { execFile } from 'node:child_process';

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

/* 봇 차단(Akamai 등)이 Node fetch(HTTP/1.1, 브라우저답지 않은 헤더)만 403으로 막는 사이트가 있다.
   FAMILY CLUB이 그렇다: 같은 주소를 HTTP/2 + 브라우저 헤더로 부르면 200이 온다.
   403을 받으면 시스템 curl로 한 번 더 부른다. 로그인·결제가 필요한 화면은 부르지 않는다(공개 안내 페이지만). */
const CURL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const CURL_HEADERS = [
  'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language: ja,ko;q=0.9,en;q=0.8',
  'sec-ch-ua: "Chromium";v="140", "Google Chrome";v="140", "Not;A=Brand";v="99"',
  'sec-ch-ua-mobile: ?0',
  'sec-ch-ua-platform: "macOS"',
  'Sec-Fetch-Dest: document',
  'Sec-Fetch-Mode: navigate',
  'Sec-Fetch-Site: none',
  'Sec-Fetch-User: ?1',
  'Upgrade-Insecure-Requests: 1',
];
export function fetchViaCurl(url, { timeout = 15000, encoding = 'utf-8' } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-s', '-L', '--max-redirs', '5', '--http2', '--compressed', '-o', '-', '-w', '\n__LILAC_STATUS__%{http_code}',
      '--max-time', String(Math.ceil(timeout / 1000)), '-A', CURL_UA, ...CURL_HEADERS.flatMap((h) => ['-H', h]), url];
    execFile('curl', args, { maxBuffer: 30e6, encoding: 'buffer', timeout: timeout + 3000 }, (err, out) => {
      if (err) return reject(new Error(`curl ${err.code || ''} ${err.message}`.trim()));
      const buf = Buffer.from(out);
      const tail = buf.subarray(Math.max(0, buf.length - 40)).toString('latin1');
      const m = tail.match(/\n__LILAC_STATUS__(\d{3})$/);
      const status = m ? Number(m[1]) : 0;
      const body = buf.subarray(0, m ? buf.length - m[0].length : buf.length);
      if (status < 200 || status >= 300) return reject(new Error(`HTTP ${status || 'curl'}`));
      const text = new TextDecoder(encoding).decode(body);
      if (!text) return reject(new Error('empty body'));
      resolve(text);
    });
  });
}

export async function fetchText(url, { timeout = 9000, headers = {}, encoding = 'utf-8', method = 'GET', body, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(url, {
        method,
        body,
        signal: ac.signal,
        redirect: 'follow',
        headers: { 'User-Agent': UA, 'Accept-Language': 'ko,ja;q=0.9,en;q=0.8', ...headers },
      });
      if (res.status === 403 && method === 'GET' && !body) {
        // 봇 차단일 수 있다: 브라우저와 같은 방식(HTTP/2)으로 한 번 더
        try { return await fetchViaCurl(url, { timeout: Math.max(timeout, 12000), encoding }); } catch { /* 원래 오류로 */ }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const text = new TextDecoder(encoding).decode(buf);
      if (!text) throw new Error('empty body');
      return text;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 + attempt * 900 + Math.random() * 300));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export async function fetchJson(url, opts = {}) {
  const txt = await fetchText(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  const t = txt.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) throw new Error('non-JSON response');
  return JSON.parse(t);
}

/* HTML 엔티티·태그 정리 */
export function clean(s) {
  if (s == null) return '';
  return String(s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* 전각 영숫자·기호 → 반각 (티켓 사이트 제목에 전각이 섞여 있다) */
export function halfwidth(s) {
  return String(s || '')
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

/* 작업을 동시에 n개까지만 */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: e }; }
    }
  });
  await Promise.all(workers);
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 'YY.MM.DD' / 'YYYY.MM.DD' / 'YYYY/M/D' → 'YYYY-MM-DD' */
export function normDate(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{2,4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (!m) return null;
  let y = Number(m[1]);
  if (y < 100) y += 2000;
  const mo = String(Number(m[2])).padStart(2, '0');
  const d = String(Number(m[3])).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

export function todayKst() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}
