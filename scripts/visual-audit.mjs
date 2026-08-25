/**
 * 시각 감사 — 헤드리스 크롬으로 전 페이지 스크린샷 + 오류 수집
 *
 * 브라우저 자동화 브리지가 없어도 돌 수 있도록 CDP를 직접 쓴다.
 *   1) 헤드리스 크롬을 디버그 포트로 띄우고
 *   2) 페이지마다 이동 → 대기 → 스크린샷 저장 → 콘솔 오류·레이아웃 지표 수집
 *
 * 사용법: node scripts/visual-audit.mjs [출력디렉터리]
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:5180';
const OUT = process.argv[2] || '/tmp/lilac-audit';
const PORT = 9223;

const PAGES = [
  ['home', '#/'],
  ['chart', '#/chart'],
  ['chart-rss', '#/chart/appleRss'],
  ['store', '#/store'],
  ['product', '#/store/it-6800756978'],
  ['schedule', '#/schedule'],
  ['work', '#/work'],
  ['library', '#/library'],
  ['artists', '#/artists'],
  ['artist-jp', '#/artist/m-lk'],
  ['artist-kr', '#/artist/aespa'],
  ['orders', '#/orders'],
  ['help', '#/help'],
  ['status', '#/status'],
  ['account', '#/account'],
  ['search', '#/search?q=%EB%9D%BC%EC%9D%BC%EB%9D%BD'],
  ['login', '#/login'],
];

/* ── 최소 CDP 클라이언트 ── */
let msgId = 0;
const pending = new Map();
let ws;

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, 20000);
  });
}

const events = [];
function onMessage(raw) {
  const m = JSON.parse(raw.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(m.error.message));
    else resolve(m.result);
  } else if (m.method) {
    events.push(m);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await mkdir(OUT, { recursive: true });

  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=/tmp/lilac-chrome-profile',
    '--window-size=1440,900',
    '--hide-scrollbars',
    '--no-first-run',
    '--disable-gpu-sandbox',
    'about:blank',
  ], { stdio: 'ignore', detached: true });
  chrome.unref();

  // 디버그 포트 대기
  let target = null;
  for (let i = 0; i < 30; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch { /* 아직 */ }
    await sleep(500);
  }
  if (!target) { console.error('크롬 디버그 포트 연결 실패'); process.exit(1); }

  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = onMessage;
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  await send('Page.enable');
  await send('Runtime.enable');

  // 온보딩·모드 초기화 (첫 이동 전에 심는다)
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(2500);
  await send('Runtime.evaluate', { expression: "localStorage.setItem('lilac.onboarded','1');localStorage.setItem('lilac.mode','browse');" });

  const report = [];

  for (const [name, hash] of PAGES) {
    const errs = [];
    const errStart = events.length;

    await send('Page.navigate', { url: `${BASE}/?a=${Date.now()}${hash}` });
    await sleep(name === 'home' || name.startsWith('chart') ? 9000 : 4500);

    // 레이아웃 지표
    const { result } = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const t = (document.getElementById('page')?.innerText || '').trim();
        return {
          is404: /찾을 수 없/.test(t),
          empty: t.length < 40,
          nullish: (t.match(/\\b(null|undefined|NaN)\\b/g) || []).length,
          ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          brokenImgs: [...document.querySelectorAll('#page img')].filter((i) => i.complete && i.naturalWidth === 0).length,
          canvas: document.querySelectorAll('canvas').length,
        };
      })()`,
    });
    const metrics = result.value || {};

    // 이 페이지에서 발생한 콘솔 오류
    for (const ev of events.slice(errStart)) {
      if (ev.method === 'Runtime.exceptionThrown') {
        errs.push(ev.params?.exceptionDetails?.exception?.description?.slice(0, 120) || 'exception');
      }
    }

    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 74 });
    const file = `${OUT}/${name}.jpg`;
    await writeFile(file, Buffer.from(shot.data, 'base64'));

    const bad = metrics.is404 || metrics.empty || metrics.nullish > 0 || metrics.ovf > 2 || metrics.brokenImgs > 2 || errs.length > 0;
    report.push({ name, bad, ...metrics, errs: errs.slice(0, 2) });
    console.log(`${bad ? '❌' : '✅'} ${name.padEnd(11)} 404:${metrics.is404 ? 1 : 0} 빈:${metrics.empty ? 1 : 0} null:${metrics.nullish} ovf:${metrics.ovf} 깨진img:${metrics.brokenImgs} err:${errs.length}`);
  }

  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  const bad = report.filter((r) => r.bad);
  console.log(`\n스크린샷 ${report.length}장 → ${OUT}`);
  console.log(bad.length ? `이상 ${bad.length}건: ${bad.map((b) => b.name).join(', ')}` : '지표상 이상 없음 (시각 검사는 스크린샷으로)');

  try { process.kill(-chrome.pid); } catch { try { chrome.kill(); } catch { /* 무시 */ } }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
