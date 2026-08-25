#!/usr/bin/env node
/**
 * 렌더된 화면을 정적 HTML로 떠낸다.
 *
 * anti-slop 탐지기는 .html만 읽는다. 우리 앱은 TS가 런타임에 DOM을 그리는
 * SPA라, 소스를 그대로 넘기면 아무것도 검사되지 않는다. 그래서 실제로
 * 그려진 DOM과 적용된 CSS를 한 파일로 합쳐 내보낸다.
 *
 * CSS를 인라인하는 이유: 탐지기가 externalStylesheets > 0이면 스타일 관련
 * 판정을 "하한선"으로만 취급한다고 명시한다. 링크로 남겨두면 색·그림자·
 * 타이포 규칙이 통째로 무력해진다.
 *
 * 사용:
 *   node scripts/export-html.mjs [출력디렉터리] [베이스URL]
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = process.argv[2] || 'tmp/html-export';
const BASE = process.argv[3] || 'http://localhost:5180';

export const ROUTES = [
  ['landing', '/landing.html', 3000],
  ['home', '/#/', 11000],
  ['chart', '/#/chart', 7000],
  ['store', '/#/store', 6000],
  ['product', '/#/store/it-6800756978', 6000],
  ['schedule', '/#/schedule', 5000],
  ['work', '/#/work', 5500],
  ['library', '/#/library', 5000],
  ['artists', '/#/artists', 5000],
  ['artist-jp', '/#/artist/m-lk', 6000],
  ['artist-kr', '/#/artist/aespa', 6000],
  ['orders', '/#/orders', 4500],
  ['help', '/#/help', 4000],
  ['status', '/#/status', 5000],
  ['account', '/#/account', 4500],
  ['search', '/#/search?q=%EB%9D%BC%EC%9D%BC%EB%9D%BD', 7000],
  ['login', '/#/login', 4000],
];

/** 문서에 적용된 모든 스타일시트를 한 덩어리 텍스트로 모은다. */
const COLLECT_CSS = `() => {
  const out = [];
  for (const sheet of Array.from(document.styleSheets)) {
    // 폰트 서비스 등 교차 출처 시트는 cssRules 접근이 막힌다. 건너뛴다.
    try {
      const href = sheet.href || '';
      if (/fonts\\.(googleapis|gstatic)\\.com/.test(href)) continue;
      out.push(Array.from(sheet.cssRules).map((r) => r.cssText).join('\\n'));
    } catch { /* 접근 불가 시트는 무시 */ }
  }
  return out.join('\\n');
}`;

export async function exportRoute(page, name, route, wait, outDir, base) {
  await page.goto(base + route, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(wait);

  // 온보딩 오버레이는 첫 방문에만 뜬다. 화면 판정을 가리므로 제거한다.
  await page.evaluate(() => {
    localStorage.setItem('lilac.onboarded', '1');
    document.getElementById('onboard')?.remove();
  });
  await page.waitForTimeout(250);

  const css = await page.evaluate(COLLECT_CSS);
  const html = await page.evaluate(
    ([cssText]) => {
      const doc = document.documentElement.cloneNode(true);
      // 외부 시트 링크와 스크립트를 걷어내고, 수집한 CSS를 본문에 심는다.
      doc.querySelectorAll('link[rel="stylesheet"], style, script').forEach((n) => n.remove());
      const style = document.createElement('style');
      style.textContent = cssText;
      doc.querySelector('head')?.appendChild(style);
      return '<!DOCTYPE html>\n' + doc.outerHTML;
    },
    [css],
  );

  const file = path.join(outDir, name + '.html');
  await fs.writeFile(file, html);
  return { name, file, bytes: html.length };
}

async function main() {
  const outDir = path.resolve(OUT);
  await fs.mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const done = [];
  for (const [name, route, wait] of ROUTES) {
    try {
      const r = await exportRoute(page, name, route, wait, outDir, BASE);
      done.push(r);
      console.log(`  ${name.padEnd(12)} ${(r.bytes / 1024).toFixed(0)}KB`);
    } catch (e) {
      console.log(`  ${name.padEnd(12)} 실패: ${e.message}`);
    }
  }

  await browser.close();
  console.log(`\n${done.length}/${ROUTES.length} → ${outDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
