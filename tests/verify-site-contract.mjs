/**
 * 마케팅·법무 레이어 계약 검증
 *
 * 레퍼런스 프로젝트의 tests/verify-*.ts 관행을 옮겨온 것이다.
 * 테스트 프레임워크 없이 node:assert 로 소스를 읽어 불변식을 확인한다.
 * 서버도 브라우저도 필요 없다 — 소스만 본다.
 *
 * 여기서 잡으려는 것은 "조용히 어긋나는" 종류의 회귀다.
 *   · 디자인 토큰이 원본에서 표류
 *   · 코드 스플리팅 경계가 깨져 앱 번들에 마케팅 코드가 다시 섞임
 *   · 화면에 쓰는 수수료·배송비가 실제 상품 데이터와 달라져 화면이 거짓말을 함
 *   · 라우트를 추가하고 제목/SEO/본문 분기 중 하나를 빠뜨림
 *   · 접근성·모션 최소화 처리가 신규 컴포넌트에서 누락
 *
 * 사용법: node tests/verify-site-contract.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'frontend/src/site');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/** 주석을 걷어낸 소스. 설명 문장에 걸리는 오탐을 막는다.
 *  (실제로 "og:image 를 쓰지 않는다"는 주석 때문에 검사가 오탐했다) */
const codeOf = (path) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const siteRead = (p) => readFileSync(join(SITE, p), 'utf8');

let pass = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failures.push({ name, err: String(e.message || e) });
    console.log(`  ❌ ${name}\n     ${String(e.message || e).split('\n')[0].slice(0, 160)}`);
  }
}

console.log('\n마케팅·법무 레이어 계약 검증\n');

/* ══════════════════════════════════════════════════
   1. 디자인 토큰 — 레퍼런스에서 옮긴 값이 표류하지 않아야 한다
   ══════════════════════════════════════════════════ */
console.log('[디자인 토큰]');
const css = siteRead('site.css');

check('앱과 사이트가 같은 시맨틱 팔레트를 사용한다', () => {
  const tokens=read('frontend/src/styles/tokens.css');
  const expected={'--bg':'#101114','--ink':'#f4f3f6','--ink-muted':'#a1a1ad','--accent':'#b7a1eb'};
  for(const [key,value] of Object.entries(expected)) assert.ok(tokens.includes(key+':'+value),key+' 기준값 불일치');
  for(const [key,ref] of Object.entries({'--st-background':'--page','--st-foreground':'--ink','--st-card':'--bg-raised','--st-muted-foreground':'--ink-muted'})) assert.match(css,new RegExp(key+':\\s*var\\('+ref+'\\)'));
  // WCAG contrast for normal labels and text, not merely matching color literals.
  const luminance=(hex)=>{const rgb=hex.slice(1).match(/../g).map(h=>parseInt(h,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
  for(const ink of ['#f4f3f6','#a1a1ad','#b7a1eb']) for(const bg of ['#101114','#191a20']) assert.ok((luminance(ink)+.05)/(luminance(bg)+.05)>=4.5,ink+' contrast fails on '+bg);
});

check('읽기 위계가 공통 타이포 토큰으로 연결된다', () => {
  const tokens=read('frontend/src/styles/tokens.css');
  for(const [name,px] of Object.entries({'--fs-xs':12,'--fs-sm':13,'--fs-base':15,'--fs-md':17,'--fs-xl':24,'--fs-2xl':32,'--fs-3xl':36})) assert.match(tokens,new RegExp(name+':\\s*'+px+'px'));
  for(const name of ['--st-text-caption','--st-text-sm','--st-text-body','--st-text-title','--st-text-headline','--st-text-display']) assert.match(css,new RegExp(name+':\\s*var\\(--fs-'));
});

check('사이트 모션이 공통 이징과 reduced-motion을 따른다', () => {
  assert.match(css,/--st-ease-standard:\s*var\(--ease-standard\)/);
  assert.match(css,/--st-ease-out:\s*var\(--ease-out\)/);
  assert.match(read('frontend/src/styles/tokens.css'),/--dur-base:\s*180ms/);
});

check('액센트가 공유 토큰을 사용한다', () => {
  assert.match(css,/--st-accent-savings:\s*var\(--accent\)/);
  const catalog=read('frontend/src/styles/catalog.css');
  assert.doesNotMatch(catalog,/#b7a1eb/i,'페이지에 액센트를 다시 하드코딩했다');
  assert.match(catalog,/var\(--accent\)/);
});

check('강조 텍스트 색상이 토큰으로만 존재한다', () => {
  const tokens=read('frontend/src/styles/tokens.css'); assert.match(tokens,/--accent-bright:\s*#c5b2ed/);
  for(const file of ['components.css','shell.css','home.css','catalog.css']) assert.doesNotMatch(read('frontend/src/styles/'+file),/#c5b2ed/i);
});

/* ══════════════════════════════════════════════════
   2. CSS 스코핑 — 앱 본체 스타일을 오염시키면 안 된다
   ══════════════════════════════════════════════════ */
console.log('\n[CSS 스코핑]');

check('사이트 CSS가 앱 전역을 건드리지 않는다', () => {
  // @media print 안에서는 앱 본체 요소(.skip-link, .toast)를 숨기는 게 맞다.
  // 그 둘은 .site-root 밖에 있어서 인쇄 시 본문에 겹쳐 찍히기 때문이다.
  // 화면용 규칙에만 스코핑을 강제하려고 print 블록은 잘라내고 검사한다.
  const printAt = css.indexOf('@media print');
  const screenCss = printAt >= 0 ? css.slice(0, printAt) + css.slice(css.indexOf('/* ==', printAt + 10)) : css;

  // 셀렉터만 뽑아 검사한다(선언 블록 안의 값은 제외).
  const selectors = screenCss
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map((b) => b.split('{')[0].trim())
    .filter(Boolean)
    .flatMap((s) => s.split(/,(?![^()]*\))/).map((x) => x.trim()))
    .filter((s) => s && !s.startsWith('@') && !s.startsWith('from') && !s.startsWith('to') && !/^\d+%/.test(s));

  // 사이트 전용 이름공간이거나 .site-root 로 가둔 셀렉터만 허용한다.
  // 약한 이름(.field, .btn 등)은 반드시 .site-root 아래에 있어야 한다 —
  // 지금 앱이 그 이름을 안 쓴다는 건 보장이 아니라 우연이다.
  const allowedRoots = [
    '.site-', '#siteRoot', ':root', 'html.site-mode', 'body.site-mode',
    '.legal-', '.faq-', '.contact-', '.demo-', '.marquee', '.uc-', '.fx-',
    '.pillar', '.chip', '.journey-', '.stat-', '.hairline-grid', '.split-grid',
    '.hero-fade', '.notfound', '.pain-',
  ];
  const bad = selectors.filter((s) => !allowedRoots.some((r) => s.includes(r)));
  assert.deepEqual(bad, [], `앱 전역을 건드리는 셀렉터: ${bad.slice(0, 5).join(' / ')}`);
});

/* ══════════════════════════════════════════════════
   3. 코드 스플리팅 경계
   ══════════════════════════════════════════════════ */
console.log('\n[코드 스플리팅]');
const mainTs = read('frontend/src/main.ts');

check('main.ts 는 마케팅 모듈을 정적 임포트하지 않는다', () => {
  // 정적으로 끌어오면 스플리팅이 무의미해진다. routes(가벼움)만 정적 허용.
  const staticImports = [...mainTs.matchAll(/^import\s[^;]*?from\s+'(\.\/site[^']*)'/gm)].map((m) => m[1]);
  const offenders = staticImports.filter((p) => p !== './site/routes');
  // 메시지에는 위반한 것만 담는다 — 전체 목록을 찍으면 허용된 것까지 범인처럼 보인다
  assert.deepEqual(offenders, [], `main.ts 가 정적 임포트하면 안 되는 모듈: ${offenders.join(', ')}`);
  assert.match(mainTs, /import\('\.\/site'\)/, 'main.ts 에 동적 import 가 없다');
});

check('routes.ts 는 CSS·무거운 모듈을 물지 않는다', () => {
  const routes = siteRead('routes.ts');
  assert.doesNotMatch(routes, /import\s+['"].*\.css['"]/, 'routes.ts 가 CSS 를 임포트한다');
  const imports = [...routes.matchAll(/^import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(imports, [], `routes.ts 는 임포트가 없어야 한다: ${imports.join(', ')}`);
});

check('site/index.ts 가 CSS 를 물고 있다(지연 청크에 포함)', () => {
  /* 랜딩 CSS 는 이 모듈이 물고 있어야 지연 청크로 갈라진다.
     레이어 래퍼(site-layer.css)를 거쳐도 같은 청크에 들어가므로 둘 다 허용한다.
     (site-layer.css 는 site.css 를 layer(site) 로 임포트한다) */
  assert.match(siteRead('index.ts'), /import\s+['"]\.\/site(-layer)?\.css['"]/, '랜딩 CSS 를 물고 있지 않다');
  if (/site-layer\.css/.test(siteRead('index.ts'))) {
    assert.match(siteRead('site-layer.css'), /@import url\('\.\/site\.css'\) layer\(site\)/, '래퍼가 site.css 를 담지 않는다');
  }
});

/* ══════════════════════════════════════════════════
   4. 가격 계수 일치 — 화면이 실제 데이터와 달라지면 거짓말이 된다
   ══════════════════════════════════════════════════ */
console.log('\n[가격 계수]');

check('차트의 수수료·배송비가 실제 상품 데이터와 일치', () => {
  const chart = siteRead('chart.ts');
  const feeRate = Number(chart.match(/feeRate:\s*([\d.]+)/)[1]);
  const shipping = Number(chart.match(/shippingKrw:\s*(\d+)/)[1]);

  const products = JSON.parse(read('db/products.json'));
  const realFeeRates = new Set();
  const realShipping = new Set();
  for (const p of products) {
    for (const e of p.editions || []) {
      if (e.pricing?.feeRate != null) realFeeRates.add(e.pricing.feeRate);
      if (e.pricing?.shipping != null) realShipping.add(e.pricing.shipping);
    }
  }
  assert.ok(
    realFeeRates.has(feeRate),
    `차트 수수료율 ${feeRate} 이 실제 데이터에 없다 (실제: ${[...realFeeRates].join(', ')})`,
  );
  assert.ok(
    realShipping.has(shipping),
    `차트 배송비 ${shipping} 이 실제 데이터에 없다 (실제: ${[...realShipping].join(', ')})`,
  );
});

check('차트 각주가 출처와 전제를 밝힌다', () => {
  const chart = siteRead('chart.ts');
  assert.match(chart, /환율 출처/, '환율 출처 표기가 없다');
  assert.match(chart, /관세/, '관세 미포함 고지가 없다');
  assert.match(chart, /예시 상품/, '예시 상품 기준임을 밝히지 않았다');
});

check('차트는 지어낸 경쟁사 수치를 쓰지 않는다', () => {
  // 레퍼런스는 "타사 대비 30% 절감" 가정치를 쓴다. 라일락엔 근거가 없으므로 금지.
  //
  // ⚠️ 반드시 주석을 걷어낸 뒤에 검사한다.
  //    첫 구현은 원문 그대로 훑어서, "타사 가정치를 쓰지 *않는다*"고 적어 둔
  //    설명 주석에 걸려 오탐을 냈다. 키워드가 맞았다고 그 문장이 그 주장을
  //    하는 건 아니다 — 매칭된 문맥까지 봐야 한다.
  const chart = siteRead('chart.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(chart, /타사|경쟁사|competitor/i, '검증 불가한 비교 대상이 들어갔다');
});

/* ══════════════════════════════════════════════════
   5. 라우트 완결성 — 하나 추가하고 다른 데를 빠뜨리는 실수 방지
   ══════════════════════════════════════════════════ */
console.log('\n[라우트 완결성]');
const routesSrc = siteRead('routes.ts');
const ROUTE_IDS = [...routesSrc.matchAll(/'([a-z]+)'/g)]
  .map((m) => m[1])
  .filter((v, i, a) => a.indexOf(v) === i)
  .filter((v) => routesSrc.includes(`${v}:`) || routesSrc.match(new RegExp(`SITE_ROUTES[^;]*'${v}'`, 's')));

check('SITE_ROUTES 가 비어 있지 않다', () => {
  assert.ok(ROUTE_IDS.length >= 6, `라우트가 너무 적다: ${ROUTE_IDS.join(', ')}`);
});

check('모든 라우트에 제목이 있다', () => {
  for (const r of ROUTE_IDS) {
    assert.match(routesSrc, new RegExp(`${r}:\\s*'`), `SITE_TITLES 에 ${r} 이 없다`);
  }
});

check('모든 라우트에 SEO 메타가 있다', () => {
  const seo = siteRead('seo.ts');
  for (const r of ROUTE_IDS) {
    assert.match(seo, new RegExp(`^\\s*${r}:\\s*\\{`, 'm'), `ROUTE_META 에 ${r} 이 없다`);
  }
});

check('모든 라우트가 본문 분기를 가진다', () => {
  const index = siteRead('index.ts');
  // legal 3종은 default 분기가 받는다
  const explicit = ['about', 'faq', 'contact'];
  for (const r of explicit) {
    assert.match(index, new RegExp(`case '${r}':`), `bodyFor 에 ${r} 분기가 없다`);
  }
  assert.match(index, /default:\s*\n\s*return legalHtml/, 'legal 문서를 받는 default 분기가 없다');
});

check('문의 페이지는 색인에서 제외된다', () => {
  const seo = siteRead('seo.ts');
  const contactBlock = seo.match(/contact:\s*\{[\s\S]*?\}/)[0];
  assert.match(contactBlock, /noindex:\s*true/, '문의 페이지에 noindex 가 없다');
});

/* ══════════════════════════════════════════════════
   6. 법무 문서
   ══════════════════════════════════════════════════ */
console.log('\n[법무 문서]');
const LEGAL_DIR = join(SITE, 'content/legal');
const LEGAL_FILES = ['terms-of-service.md', 'privacy-policy.md', 'subprocessors.md'];

check('법무 문서 3종이 존재한다', () => {
  for (const f of LEGAL_FILES) {
    assert.ok(existsSync(join(LEGAL_DIR, f)), `${f} 이 없다`);
  }
  const extra = readdirSync(LEGAL_DIR).filter((f) => !LEGAL_FILES.includes(f));
  assert.deepEqual(extra, [], `예상 밖 파일: ${extra.join(', ')}`);
});

check('각 문서가 h1 과 사업자 정보 표를 가진다', () => {
  for (const f of LEGAL_FILES) {
    const md = readFileSync(join(LEGAL_DIR, f), 'utf8');
    assert.match(md, /^#\s+\S/m, `${f} 에 h1 이 없다`);
    assert.ok(md.includes('|'), `${f} 에 표가 없다`);
  }
});

check('미확정 사업자 정보가 확정된 것처럼 쓰이지 않는다', () => {
  // 사업자등록번호 같은 값을 지어내면 약관에 허위 기재가 된다.
  for (const f of LEGAL_FILES) {
    const md = readFileSync(join(LEGAL_DIR, f), 'utf8');
    const bizNo = md.match(/사업자등록번호\s*\|\s*([^|\n]+)/);
    if (bizNo) {
      const v = bizNo[1].trim();
      assert.doesNotMatch(v, /^\d{3}-\d{2}-\d{5}$/, `${f} 에 지어낸 사업자등록번호가 있다: ${v}`);
    }
  }
});

check('데모 단계임을 각 문서가 밝힌다', () => {
  for (const f of LEGAL_FILES) {
    const md = readFileSync(join(LEGAL_DIR, f), 'utf8');
    assert.match(md, /데모 단계/, `${f} 에 데모 단계 고지가 없다`);
  }
});

check('문서의 날짜·사업자 정보가 config 단일 출처를 따른다', () => {
  // 시행일·상호·연락처를 문서에 직접 박으면 개정 때 반드시 한 군데를 빼먹는다.
  const cfg = siteRead('config.ts');
  const known = new Set(
    ['effectiveDate','updatedDate','legalName','ceo','bizNo','address','supportEmail','privacyOfficer','domain'],
  );
  for (const f of LEGAL_FILES) {
    const md = readFileSync(join(LEGAL_DIR, f), 'utf8');
    // 날짜 리터럴이 남아 있으면 단일 출처가 깨진 것
    assert.doesNotMatch(md, /\d{4}년\s*\d{1,2}월\s*\d{1,2}일/, `${f} 에 날짜가 직접 박혀 있다`);
    // 쓴 토큰은 전부 치환 가능해야 한다 (오타나면 화면에 {{...}} 가 그대로 노출)
    for (const m of md.matchAll(/\{\{(\w+)\}\}/g)) {
      assert.ok(known.has(m[1]), `${f} 의 토큰 {{${m[1]}}} 을 치환할 수 없다`);
    }
  }
  for (const k of known) {
    assert.ok(cfg.includes(`${k}:`), `config.ts 에 ${k} 가 없다`);
  }
});

check('렌더러가 모든 토큰을 처리한다', () => {
  const legal = siteRead('pages/legal.ts');
  assert.match(legal, /fillTokens/, '토큰 치환이 연결되지 않았다');
  const tokenBlock = legal.match(/const TOKENS[\s\S]*?\};/)[0];
  const used = new Set();
  for (const f of LEGAL_FILES) {
    const md = readFileSync(join(LEGAL_DIR, f), 'utf8');
    for (const m of md.matchAll(/\{\{(\w+)\}\}/g)) used.add(m[1]);
  }
  for (const k of used) {
    assert.ok(tokenBlock.includes(`${k}:`), `TOKENS 에 ${k} 가 없다`);
  }
});

check('약관의 조문 번호가 연속한다', () => {
  const md = readFileSync(join(LEGAL_DIR, 'terms-of-service.md'), 'utf8');
  const nums = [...md.matchAll(/^###\s+제(\d+)조/gm)].map((m) => Number(m[1]));
  assert.ok(nums.length > 10, `조문이 너무 적다: ${nums.length}`);
  nums.forEach((n, i) => {
    assert.equal(n, i + 1, `제${i + 1}조 자리에 제${n}조 가 있다 (번호 누락/중복)`);
  });
});

check('처리방침 목차가 실제 조문 수와 맞는다', () => {
  const md = readFileSync(join(LEGAL_DIR, 'privacy-policy.md'), 'utf8');
  const toc = [...md.matchAll(/^-\s+제(\d+)조/gm)].map((m) => Number(m[1]));
  const heads = [...md.matchAll(/^##\s+제(\d+)조/gm)].map((m) => Number(m[1]));
  assert.deepEqual(toc, heads, '목차와 실제 조문이 어긋난다');
});

/* ══════════════════════════════════════════════════
   7. 접근성 · 모션
   ══════════════════════════════════════════════════ */
console.log('\n[접근성·모션]');

check('스킵 링크가 있고 앱 것과 겹치지 않는다', () => {
  assert.match(siteRead('shell.ts'), /site-skip/, '셸에 스킵 링크가 없다');
  assert.ok(css.includes('.site-skip'), 'CSS 에 스킵 링크 스타일이 없다');
  // 앱 본체의 .skip-link 는 #page(사이트 모드에선 숨겨진 노드)를 가리킨다.
  // 안 숨기면 탭으로 아무 데도 안 가는 링크에 닿는다 — 실제 QA 에서 잡힌 건이다.
  const screen = css.slice(0, css.indexOf('@media print'));
  assert.match(screen, /body\.site-mode\s+\.skip-link\s*\{[^}]*display:\s*none/,
    '사이트 모드에서 앱 스킵 링크를 숨기지 않는다');
});

check('reduced-motion에서도 모든 콘텐츠가 보인다', () => {
  const at=css.search(/@media\s*\(prefers-reduced-motion:\s*reduce\)/); assert.ok(at>=0);
  const block=css.slice(at,css.indexOf('@media print',at));
  assert.match(block,/\.reveal-up\s*\{[^}]*opacity:\s*1/);
  assert.match(block,/\.site-root \*[^}]*animation:\s*none\s*!important/);
  assert.match(block,/transition:\s*none\s*!important/);
});

check('인쇄 스타일이 법무 문서를 다룬다', () => {
  // ⚠️ 주석을 걷어내고 본다. 이 블록에는 왜 .skip-link 를 숨기는지 적어 둔
  //    주석이 있어서, 원문 그대로 includes 하면 셀렉터를 지워도 주석에 걸려
  //    통과한다(실제로 변이 테스트에서 오탐 통과가 났다).
  const printAll = css.slice(css.indexOf('@media print'));
  const block = printAll.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(block.length > 200, '@media print 블록이 없다');
  // 어두운 배경을 그대로 인쇄하면 글자가 안 보인다
  assert.match(block, /background:\s*(?:#fff|white)/, '인쇄 배경을 흰색으로 되돌리지 않는다');
  // 앱 본체의 .skip-link 는 .site-root 밖에 있어 숨기지 않으면 본문에 겹친다
  for (const sel of ['.site-nav', '.site-footer', '.legal-toc', '.skip-link']) {
    // 셀렉터로 등장하는지 확인 (뒤에 , 또는 { 가 와야 한다)
    assert.match(block, new RegExp(`\\${sel}\\s*[,{]`), `인쇄에서 ${sel} 을 숨기지 않는다`);
  }
  // 표의 min-width 를 풀지 않으면 종이 폭을 넘어 잘린다
  assert.match(block, /min-width:\s*0/, '인쇄 시 표 min-width 를 풀지 않는다');
});

check('터치 타겟 최소 크기 규칙이 있다', () => {
  assert.match(css, /pointer:\s*coarse[\s\S]*?min-height:\s*44px/, '44px 최소 타겟 규칙이 없다');
});

check('모달에 포커스 트랩과 복귀가 있다', () => {
  const carousel = siteRead('carousel.ts');
  assert.match(carousel, /trapTab/, '포커스 트랩이 없다');
  assert.match(carousel, /lastFocused/, '포커스 복귀 대상 추적이 없다');
  // activeElement 만 믿으면 프로그램적 click 에서 body 로 떨어진다
  assert.match(carousel, /trigger\s*\?\?/, '트리거를 명시적으로 받지 않는다');
});

check('모바일 내비 토글이 있다', () => {
  const shell = siteRead('shell.ts');
  assert.match(shell, /data-nav-toggle/, '햄버거 토글이 없다');
  assert.match(shell, /aria-expanded/, 'aria-expanded 가 없다');
  assert.ok(css.includes('.site-drawer'), '드로어 스타일이 없다');
});

/* ══════════════════════════════════════════════════
   9. 문의 접수 — 프론트와 백엔드 계약
   ══════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════
   8. 수명주기 — 전역 리스너·옵저버 누수 방지
   ══════════════════════════════════════════════════ */
console.log('\n[수명주기]');

function siteSourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) out.push(p);
    }
  };
  walk(SITE);
  return out;
}

check('전역 리스너는 반드시 lifecycle 을 거친다', () => {
  // 측정으로 확인한 실제 누수였다: 사이트↔앱 3회 왕복에
  // window.resize +3 / window.scroll +3 / document.keydown +9 가 누적됐다.
  // innerHTML 을 갈아끼워도 window·document 리스너는 살아남기 때문이다.
  //
  // 직접 addEventListener 를 쓰더라도, 같은 파일에서 같은 핸들러를
  // removeEventListener 로 되돌리면 균형이 맞는다(모달 트랩이 그 경우다).
  // 그래서 "금지"가 아니라 "짝이 없는 등록"을 잡는다.
  const offenders = [];
  for (const f of siteSourceFiles()) {
    if (f.endsWith('lifecycle.ts')) continue; // 헬퍼 자신은 예외
    const body = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const m of body.matchAll(/\b(window|document)\.addEventListener\(\s*'([^']+)'\s*,\s*([A-Za-z_$][\w$]*)/g)) {
      const [, target, evt, handler] = m;
      const paired = new RegExp(`${target}\\.removeEventListener\\(\\s*'${evt}'\\s*,\\s*${handler}\\b`).test(body);
      if (!paired) offenders.push(`${f.replace(ROOT + '/', '')}:${target}.${evt}`);
    }
    // 인라인 화살표 핸들러는 애초에 해제가 불가능하므로 무조건 위반이다
    for (const m of body.matchAll(/\b(window|document)\.addEventListener\(\s*'([^']+)'\s*,\s*\(/g)) {
      offenders.push(`${f.replace(ROOT + '/', '')}:${m[1]}.${m[2]}(익명)`);
    }
  }
  assert.deepEqual(offenders, [], `해제되지 않는 전역 리스너: ${offenders.join(', ')}`);
});

check('옵저버는 해제가 예약된다', () => {
  const offenders = [];
  for (const f of siteSourceFiles()) {
    if (f.endsWith('lifecycle.ts') || f.endsWith('motion.ts')) continue;
    const body = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // 모든 옵저버 생성 지점을 찾아, 바로 앞이 observe( 인지 본다.
    // (앞서 `= observe(new X(` → `= (new X(` 변이가 안 잡혀서 규칙을 이렇게 바꿨다.
    //  "= new X" 형태만 노리면 괄호 하나로 빠져나간다)
    for (const m of body.matchAll(/new (IntersectionObserver|ResizeObserver|MutationObserver)\s*\(/g)) {
      const before = body.slice(Math.max(0, m.index - 40), m.index);
      if (!/observe\(\s*$/.test(before)) {
        offenders.push(`${f.replace(ROOT + '/', '')}:${m[1]}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `observe() 로 감싸지 않은 옵저버: ${offenders.join(', ')}`);
});

check('라우트 전환 시 정리가 실행된다', () => {
  const index = siteRead('index.ts');
  // 함수 단위로 확인한다. 파일 어딘가에 runCleanup 이 있기만 하면 통과하게 두면,
  // renderSitePage 쪽 호출을 지워도 leaveSite 것 때문에 조용히 통과한다(변이에서 확인).
  const fnBody = (name) => {
    const at = index.indexOf(`export function ${name}(`);
    assert.ok(at >= 0, `${name} 이 없다`);
    return index.slice(at, index.indexOf('\nexport ', at + 10) + 1 || undefined);
  };
  assert.match(fnBody('renderSitePage'), /runCleanup\(\)/, 'renderSitePage 가 정리를 호출하지 않는다');
  assert.match(fnBody('renderSiteNotFound'), /runCleanup\(\)/, 'renderSiteNotFound 가 정리를 호출하지 않는다');
  assert.match(fnBody('leaveSite'), /runCleanup\(\)/, '사이트 이탈 시 정리하지 않는다');
});

console.log('\n[문의 접수]');

check('문의 엔드포인트가 백엔드에 있다', () => {
  const be = read('backend/server.mjs');
  assert.match(be, /app\.post\('\/api\/contact'/, '/api/contact 핸들러가 없다');
});

check('서버도 봇 방어를 한다', () => {
  // 클라이언트 검사만 믿으면 폼을 거치지 않는 직접 POST 에 무방비해진다.
  const be = read('backend/server.mjs');
  const handler = be.slice(be.indexOf("app.post('/api/contact'"));
  assert.match(handler, /honeypot/, '서버에 허니팟 검사가 없다');
  assert.match(handler, /elapsedMs/, '서버에 제출 속도 검사가 없다');
});

check('프론트가 보내는 필드를 서버가 모두 읽는다', () => {
  const fe = siteRead('pages/contact.ts');
  const payload = fe.match(/const payload = \{([\s\S]*?)\};/)[1];
  const keys = [...payload.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  const be = read('backend/server.mjs');
  const handler = be.slice(be.indexOf("app.post('/api/contact'"));
  for (const k of keys) {
    // ⚠️ includes('b.org') 는 'b.organization' 에도 걸린다(부분 문자열 오탐).
    //    변이 테스트에서 b.org → b.organization 이 안 잡혀 드러난 문제라
    //    반드시 단어 경계까지 확인한다.
    assert.match(handler, new RegExp(`\\bb\\.${k}\\b`), `서버가 ${k} 를 읽지 않는다`);
  }
});

check('접수 데이터가 깃에 올라가지 않는다', () => {
  // 이름·이메일·소속이 담긴다. 커밋되면 그대로 공개 레포에 개인정보가 남는다.
  const ig = read('.gitignore');
  assert.match(ig, /^db\/contacts\.json$/m, '.gitignore 에 db/contacts.json 이 없다');
});

check('프론트가 서버 필드 오류를 화면에 되돌린다', () => {
  const fe = siteRead('pages/contact.ts');
  assert.match(fe, /r\.status === 400/, '400 응답 처리가 없다');
  assert.match(fe, /serverErrors/, '서버 오류를 필드에 매핑하지 않는다');
});

/* ══════════════════════════════════════════════════
   10. BM · 데이터 무결성
   ══════════════════════════════════════════════════ */
console.log('\n[BM·데이터 무결성]');

const be = read('backend/server.mjs');
const pricing = read('backend/lib/pricing.mjs');

check('사용자 데이터는 전역 파일을 쓰지 않는다', () => {
  // 실측으로 확인한 유출이었다: B 계정이 A 계정의 비공개 플레이리스트와
  // 주문내역을 그대로 읽었다. 원인은 db/user/likes.json 같은 전역 파일 공유.
  const bad = [...be.matchAll(/(?:read|write)Json\(\s*'user\/(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(bad, [], `전역 사용자 파일 접근: ${bad.join(', ')}`);
  assert.match(be, /const userPath = \(userId, name\)/, 'userPath 헬퍼가 없다');
});

check('사용자 엔드포인트는 전부 로그인을 요구한다', () => {
  // ⚠️ 라우트마다 핸들러가 여럿이다(GET/POST/DELETE...). 하나만 확인하면
  //    나머지가 무방비여도 통과한다 — 실제로 GET /api/orders 의 가드를 떼는
  //    변이가 POST 쪽 매칭 때문에 조용히 통과했다. 전수로 검사한다.
  const MUST_GUARD = ['/api/likes', '/api/history', '/api/playlists', '/api/orders', '/api/oshi'];
  const offenders = [];
  let found = 0;
  const re = /app\.(get|post|patch|put|delete)\('([^']+)',\s*([\s\S]{0,20})/g;
  let m;
  while ((m = re.exec(be))) {
    const [, method, route, after] = m;
    if (!MUST_GUARD.some((g) => route === g || route.startsWith(g + '/'))) continue;
    found++;
    if (!/^requireUser\b/.test(after.trim())) {
      offenders.push(`${method.toUpperCase()} ${route}`);
    }
  }
  assert.ok(found >= 12, `보호 대상 핸들러를 충분히 찾지 못했다: ${found}`);
  assert.deepEqual(offenders, [], `로그인 가드 없는 사용자 엔드포인트: ${offenders.join(', ')}`);
});

check('세션은 토큰으로 검증한다', () => {
  // 예전엔 세션 파일이 하나뿐이라 "현재 사용자"가 서버 전역 싱글턴이었다.
  assert.match(be, /function bearerToken/, '토큰 파서가 없다');
  assert.match(be, /async function currentUser\(req\)/, 'currentUser 가 요청을 받지 않는다');
  assert.doesNotMatch(be, /readJson\('user\/session'\)/, '전역 세션 파일을 아직 읽는다');
});

check('프론트가 토큰을 저장하고 실어 보낸다', () => {
  const apiTs = read('frontend/src/api.ts');
  assert.match(apiTs, /headers\.authorization = `Bearer/, 'Authorization 헤더를 붙이지 않는다');
  assert.match(apiTs, /localStorage\.setItem\(TOKEN_KEY/, '토큰을 저장하지 않는다');
  const pagesTs = read('frontend/src/pages.ts');
  const loginBlock = pagesTs.slice(pagesTs.indexOf("'/api/auth/login'"), pagesTs.indexOf("'/api/auth/login'") + 400);
  assert.match(loginBlock, /setToken\(/, '로그인 후 토큰을 저장하지 않는다');
});

check('가격 계수는 pricing.mjs 단일 출처를 쓴다', () => {
  // 같은 계수가 서버·수집기·프론트 세 곳에 흩어져 있으면
  // "화면에 보이는 값"과 "실제로 빠지는 값"이 어긋난다.
  assert.match(be, /from '\.\/lib\/pricing\.mjs'/, '서버가 pricing 모듈을 쓰지 않는다');
  // 주문 계산이 quote() 를 거치는지
  const orderBlock = be.slice(be.indexOf("app.post('/api/orders'"));
  assert.match(orderBlock.slice(0, 2000), /quote\(\{/, '주문이 quote() 를 쓰지 않는다');
});

check('견적과 주문이 같은 계산을 쓴다', () => {
  // 결제 금액이 화면과 다른 건 커머스에서 가장 나쁜 버그다.
  const q = be.slice(be.indexOf("app.get('/api/quote'"), be.indexOf("app.get('/api/orders'"));
  const o = be.slice(be.indexOf("app.post('/api/orders'"));
  for (const key of ['localAmount', 'origin', 'feeKind', 'rate', 'planTier', 'groupDiscount']) {
    assert.ok(q.includes(key), `견적에 ${key} 가 없다`);
    assert.ok(o.slice(0, 2500).includes(key), `주문에 ${key} 가 없다`);
  }
});

check('멤버십 요금이 BM 구간(₩4,900–7,900) 안에 있다', () => {
  const prices = [...pricing.matchAll(/priceKrw:\s*(\d+)/g)].map((m) => Number(m[1])).filter((n) => n > 0);
  assert.ok(prices.length >= 2, '유료 플랜이 2개 미만이다');
  for (const p of prices) {
    assert.ok(p >= 4900 && p <= 7900, `요금 ${p} 이 BM 구간을 벗어났다`);
  }
});

check('중개 수수료가 BM 마진 구간(5~15%) 안에 있다', () => {
  const rates = [...pricing.matchAll(/(?:single|album|limited):\s*([\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(rates.length === 3, `수수료 등급이 3개가 아니다: ${rates.length}`);
  for (const r of rates) {
    assert.ok(r >= 0.05 && r <= 0.15, `수수료율 ${r} 이 BM 구간(5~15%)을 벗어났다`);
  }
});

check('비밀번호를 빠른 해시로 저장하지 않는다', () => {
  // 솔트 없는 SHA-256 은 GPU 로 초당 수십억 번 시도 가능하고
  // 레인보우 테이블이 그대로 통한다. 같은 비밀번호면 해시도 같아
  // 한 명이 뚫리면 나머지도 같이 뚫린다.
  assert.match(be, /scrypt/, 'scrypt 를 쓰지 않는다');
  assert.match(be, /async function hashPassword/, 'hashPassword 가 없다');
  assert.match(be, /timingSafeEqual/, '상수시간 비교를 하지 않는다');
  // 저장 경로에서 빠른 해시를 직접 쓰지 않는지
  assert.doesNotMatch(be, /pw:\s*hash\(/, '가입 시 빠른 해시를 쓴다');
  assert.doesNotMatch(be, /u\.pw === hash\(/, '로그인 시 빠른 해시로 비교한다');
});

check('레거시 해시를 로그인 시 이관한다', () => {
  // 기존 계정을 잠그지 않으면서 옮기는 유일한 방법이다.
  assert.match(be, /isLegacyHash/, '레거시 판별이 없다');
  const loginBlock = be.slice(be.indexOf("app.post('/api/auth/login'"));
  assert.match(loginBlock.slice(0, 2500), /isLegacyHash\(user\.pw\)/, '로그인에서 이관하지 않는다');
});

check('로그인 시도를 제한한다', () => {
  // ⚠️ 함수가 "존재하는지"만 보면 안 된다. 정의는 그대로 두고 호출부만
  //    `const waitSec = 0` 으로 바꾸는 변이가 그대로 통과했다.
  //    로그인 핸들러 안에서 실제로 호출되는지까지 확인한다.
  const at = be.indexOf("app.post('/api/auth/login'");
  assert.ok(at >= 0, '로그인 핸들러가 없다');
  const loginBlock = be.slice(at, at + 1800);
  assert.match(loginBlock, /authBlocked\(\s*key\s*\)/, '로그인에서 차단 여부를 확인하지 않는다');
  assert.match(loginBlock, /noteAuthFail\(\s*key\s*\)/, '실패를 세지 않는다');
  assert.match(loginBlock, /clearAuthFail\(/, '성공 시 카운터를 비우지 않는다');
  assert.match(loginBlock, /RATE_LIMITED/, '429 응답 코드가 없다');
});

check('가입 시 비밀번호 강도를 검사한다', () => {
  const signup = be.slice(be.indexOf("app.post('/api/auth/signup'"));
  assert.match(signup.slice(0, 1500), /WEAK_PASSWORD/, '약한 비밀번호를 막지 않는다');
  const html = read('frontend/src/pages.ts');
  assert.doesNotMatch(html, /minlength="[1-7]"/, '화면이 8자 미만을 허용한다');
});

check('금액을 다루는 흐름이 원자적이다', () => {
  // 실측 사고: 동시 주문 5건이 모두 성공 응답을 받았는데 저장은 2건,
  // 차감은 1건분 — 64,800원어치를 공짜로 가져갔다.
  assert.match(be, /function withLock/, '쓰기 직렬화가 없다');
  assert.match(be, /async function updateJson/, '원자적 갱신 헬퍼가 없다');
  for (const [name, marker] of [
    ['주문', "app.post('/api/orders'"],
    ['구독', "app.post('/api/membership/subscribe'"],
  ]) {
    const block = be.slice(be.indexOf(marker), be.indexOf(marker) + 3000);
    assert.match(block, /withLock\(`user:/, `${name} 이 사용자 락 없이 크레딧을 만진다`);
  }
});

check('파일 쓰기가 원자적이다', () => {
  // 쓰는 도중 죽으면 잘린 JSON 이 남아 컬렉션 전체를 못 읽게 된다.
  const w = be.slice(be.indexOf('const writeJson'), be.indexOf('const writeJson') + 700);
  assert.match(w, /\.tmp/, '임시 파일을 쓰지 않는다');
  assert.match(w, /rename\(/, 'rename 으로 교체하지 않는다');
});

check('세션 토큰과 개인정보가 깃에 올라가지 않는다', () => {
  // sessions.json 은 사실상 자격증명이다. 커밋되면 누구나 남의 계정으로 요청할 수 있다.
  const ig = read('.gitignore');
  for (const pat of ['db/sessions.json', 'db/contacts.json']) {
    assert.ok(ig.split('\n').some((l) => l.trim() === pat), `.gitignore 에 ${pat} 이 없다`);
  }
});

/* ---- 판매처 비교 (링크만 걸던 구조의 대체) ---- */
const releases = JSON.parse(read('db/releases.json'));

check('릴리스가 판매처·사양 구조를 갖는다', () => {
  assert.ok(releases.length >= 3, `릴리스가 너무 적다: ${releases.length}`);
  for (const r of releases) {
    assert.ok((r.editions || []).length >= 1, `${r.id}: 사양이 없다`);
    // curated 만 판매처를 갖는다. discovered 는 상품 URL 을 모르므로
    // offers 를 비우고 searchHints 로 둔다(아래 별도 검사).
    if ((r.tier || 'curated') !== 'discovered') {
      assert.ok((r.offers || []).length >= 1, `${r.id}: curated 인데 판매처가 없다`);
    }
    // 가격은 사양에 있고, 특전은 판매처에 있다 — 이 모델의 존재 이유다
    for (const e of r.editions) assert.ok(typeof e.listPrice === 'number', `${r.id}/${e.id}: 정가 없음`);
    for (const o of r.offers) {
      assert.ok(o.url, `${r.id}/${o.id}: url 없음`);
      for (const edId of o.editions || []) {
        assert.ok(r.editions.some((e) => e.id === edId), `${r.id}/${o.id}: 없는 사양 참조 ${edId}`);
      }
    }
  }
});

check('모든 릴리스가 출처를 밝힌다', () => {
  // 지어낸 가격을 넣지 않기 위한 최소 장치다.
  for (const r of releases) {
    assert.ok(r.source?.url, `${r.id}: source.url 없음`);
    assert.ok(r.source?.collectedAt, `${r.id}: 수집일 없음`);
  }
});

check('판매처 링크가 검색 결과가 아니다', () => {
  // 기존 products.json 은 전 건이 tower.jp/search, aladin/search 였다.
  // 사용자를 일본어 검색 목록에 떨어뜨리는 건 아무것도 안 한 것과 같다.
  //
  // 자동 수집 단계에서는 상품 URL 을 알 수 없다. 그럴 땐 offers 를 비우고
  // searchHints(검색임을 이름에 박은 별도 필드)로 둔다 —
  // 검색 링크를 offer 로 위장하면 "판매처 N곳"으로 세어져 비교표가 거짓말을 한다.
  const bad = [];
  for (const r of releases) {
    for (const o of r.offers || []) {
      if (/\/search|wsearchresult|SearchWord=/i.test(o.url)) bad.push(`${r.id}/${o.id}`);
    }
  }
  assert.deepEqual(bad, [], `검색 결과 URL 이 offer 로 들어갔다: ${bad.slice(0, 5).join(', ')}`);
});

check('미확인 릴리스는 판매처 수를 부풀리지 않는다', () => {
  for (const r of releases) {
    if ((r.tier || 'curated') !== 'discovered') continue;
    assert.equal((r.offers || []).length, 0, `${r.id}: discovered 인데 offer 가 있다`);
  }
});

check('추정치와 확인값을 구분한다', () => {
  // products.json 은 editions 의 75%가 real:false 인데 화면에서 구분하지 않았다.
  for (const r of releases) {
    for (const o of r.offers || []) {
      assert.ok('verified' in o, `${r.id}/${o.id}: verified 플래그 없음`);
    }
  }
  const rel = read('frontend/src/release.ts');
  assert.match(rel, /rel-badge est/, '화면이 추정치를 표시하지 않는다');
});

check('일본반 정가 고정을 화면이 설명한다', () => {
  // 9개 판매처 가격이 같은 것은 버그가 아니라 법제도(독점금지법 §24-2) 때문이다.
  // 그걸 "가격 비교"인 척 보여주면 사용자를 오도한다.
  assert.match(be, /priceFixed/, '정가 고정 판정이 없다');
  const rel = read('frontend/src/release.ts');
  assert.match(rel, /제24조의2|재판매가격유지/, '화면이 이유를 설명하지 않는다');
});

check('가격 폭은 같은 사양 안에서 잰다', () => {
  // 사양을 섞어 최저~최고를 내면 통상반과 한정BOX를 비교하는 꼴이다.
  assert.match(be, /byEdition/, '사양별 집계가 없다');
  const fn = be.slice(be.indexOf('async function buildComparison'));
  assert.match(fn.slice(0, 3000), /byEdition\[r\.editionId\]/, '사양별로 묶지 않는다');
});

check('감시(watch)가 로그인 필요하고 사용자별이다', () => {
  const m = [...be.matchAll(/app\.(get|post)\('(\/api\/watches[^']*)',\s*(\w+)/g)];
  assert.ok(m.length >= 3, `watch 핸들러가 부족하다: ${m.length}`);
  for (const [, method, route, guard] of m) {
    assert.equal(guard, 'requireUser', `${method.toUpperCase()} ${route} 가 비보호`);
  }
  assert.match(be, /userPath\(req\.user\.id, 'watches'\)/, '감시가 사용자별로 저장되지 않는다');
});

/* ---- 동기화 ---- */
const sync = read('backend/lib/sync-releases.mjs');

check('동기화가 curated 를 덮어쓰지 않는다', () => {
  // 자동 수집이 사람이 확인한 특전 정보를 조용히 지우면
  // 이 제품의 유일한 차별점이 사라진다.
  assert.match(sync, /tier !== 'discovered'/, 'curated 를 분리하지 않는다');
  const fn = sync.slice(sync.indexOf('export async function syncReleases'));
  assert.match(fn, /\[\.\.\.curated,\s*\.\.\.fresh\]/, '병합에서 curated 를 보존하지 않는다');
});

check('discovered 는 미확인 상태를 데이터에 남긴다', () => {
  // 확인 안 된 것을 확인된 것처럼 내보내면 안 된다.
  assert.match(sync, /tier: 'discovered'/, '등급을 표시하지 않는다');
  assert.match(sync, /offers: \[\]/, 'discovered 가 offers 를 비우지 않는다');
  assert.match(sync, /searchHints/, '검색 링크를 별도 필드로 두지 않는다');
  // 실제 데이터에도 반영돼 있는지
  const dRel = JSON.parse(read('db/releases.json')).filter((r) => r.tier === 'discovered');
  assert.ok(dRel.length, 'discovered 릴리스가 없다');
  assert.ok(dRel.every((r) => (r.searchHints || []).length >= 1), 'searchHints 가 비어 있다');
  const rel = read('frontend/src/release.ts');
  assert.match(rel, /특전 확인 중/, '화면이 미확인 상태를 표시하지 않는다');
  assert.match(rel, /특전 확인됨/, '화면이 확인 상태를 표시하지 않는다');
});

check('같은 앨범을 중복 생성하지 않는다', () => {
  // 콜라보반은 여러 아티스트 카탈로그에 동시에 잡힌다.
  // 접지 않으면 목록에 중복이 뜨고, 같은 id 가 서로를 덮어써
  // 매 동기화마다 updated 로 잡혀 변경 이력이 무의미해진다(실측).
  // ⚠️ 식별자가 "존재하는지"만 보면 안 된다 — 변수명만 바꿔도 통과했다.
  //    실제로 중복 제거에 쓰이는지(값을 넣고, 결과를 쓰는지)까지 본다.
  assert.match(sync, /byCollection\.set\(/, 'collectionId 로 접지 않는다');
  assert.match(sync, /\[\.\.\.byCollection\.values\(\)\]/, '중복 제거 결과를 쓰지 않는다');
  assert.match(sync, /albumArtist/, '대표 아티스트 판정 근거가 없다');
  // 실제 데이터에 중복이 없어야 한다
  const ids = JSON.parse(read('db/releases.json')).map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, '릴리스 id 중복');
});

check('비교할 판매처가 없으면 정가 안내를 띄우지 않는다', () => {
  // 빈 배열에 every() 는 true 라, 판매처가 0곳인데 "가격이 같습니다"가 떴다(실측).
  const fn = be.slice(be.indexOf('async function buildComparison'));
  assert.match(fn.slice(0, 4000), /rows\.length > 0\s*\n?\s*&&\s*release\.country/, 'priceFixed 가 행 수를 보지 않는다');
});

check('동기화가 변경 이력을 남긴다', () => {
  assert.match(be, /updateJson\('sync-log'/, '동기화 이력을 저장하지 않는다');
  assert.match(be, /SYNC_RUNNING/, '동시 실행을 막지 않는다');
  assert.match(be, /scheduleBackground\(\(\) => runReleaseSync\('interval'\), SYNC_INTERVAL_MS, true\)/, '주기 실행이 없다');
});

check('지어낸 공연 일정을 만드는 코드가 없다', () => {
  /* events.json 에서 12건을 지웠어도 수집기에 생성기가 남아 있으면
     다음 수집 때 되살아난다. 실제로 남아 있었다:
       날짜 = 오늘 + (18 + i*15)일, 장소 = [...][i % 4] */
  const col = codeOf('backend/collect-events.mjs');
  assert.doesNotMatch(col, /demoEvents/, '데모 일정 생성기가 남아 있다');
  assert.doesNotMatch(col, /isDemo:\s*true/, '데모 플래그를 붙이는 코드가 남아 있다');
  const ev = JSON.parse(read('db/events.json'));
  assert.equal(ev.filter((e) => e.isDemo).length, 0, '데이터에 데모 일정이 남아 있다');
});

check('운영사를 출처와 함께 자동으로 채운다', () => {
  // 44팀 중 34팀이 비어 있었다. 애플은 레이블을 주지 않아 MusicBrainz 를 쓴다.
  const lib = codeOf('backend/lib/backfill-operator.mjs');
  // 이름이 정확히 일치하는 아티스트만 (동명이인·트리뷰트 방지)
  assert.match(lib, /norm\(a\.name\) === norm\(name\)/, '아티스트 이름을 정확히 대조하지 않는다');
  // 끝난 계약은 현재 운영사가 아니다
  assert.match(lib, /filter\(\(r\) => !r\.end\)/, '종료된 계약을 걸러내지 않는다');
  // 사람이 확인한 값은 덮지 않는다
  assert.match(lib, /if \(a\.operator\) continue/, '사람이 넣은 운영사를 덮어쓸 수 있다');
  // 출처를 남긴다
  assert.match(lib, /operatorSource = 'musicbrainz'/, '출처를 남기지 않는다');

  const be = codeOf('backend/server.mjs');
  assert.match(be, /await backfillOperator\(/, '동기화에 운영사 보강이 물려 있지 않다');

  /* 못 찾은 아티스트를 매 부팅마다 다시 조회하면 안 된다.
     MusicBrainz 초당 1회 제한 때문에 15팀 재조회로 부팅 동기화가 분 단위로
     늘어져 sync 가 running 상태에 오래 묶였다. */
  assert.match(lib, /operatorCheckedAt/, '조회 실패를 기록하지 않아 매번 다시 조회한다');
  assert.match(lib, /RECHECK_DAYS/, '재조회 간격이 없다');

  // 화면이 자동 수집분을 구분해 보여줘야 한다
  // (이 검사는 pagesTs 선언보다 앞에 있으므로 직접 읽는다)
  assert.match(read('frontend/src/pages.ts'), /operatorSource === 'musicbrainz'/, '화면이 출처를 구분하지 않는다');

  const arts = JSON.parse(read('db/artists.json'));
  const auto = arts.filter((a) => a.operatorSource === 'musicbrainz');
  for (const a of auto) assert.ok(a.operatorMbid, `${a.name} 에 추적 가능한 MBID 가 없다`);
});

check('인스턴스가 여럿이어도 하나만 수집한다', () => {
  /* 프로세스 안의 withLock 은 같은 프로세스만 막는다.
     실제로 백엔드 11개가 같은 db 를 보며 동시에 애플을 두드렸고
       · 애플이 빈 응답(레이트리밋)을 주기 시작했고
       · 그 0건을 "릴리스가 없다"로 읽어 128건을 덮어썼다.
     파일 락으로 프로세스 간에도 하나만 돌게 한다. */
  const lock = codeOf('backend/lib/sync-lock.mjs');
  // 배타 생성이어야 경쟁 상태에서 하나만 이긴다
  assert.match(lock, /flag: 'wx'/, '배타 생성이 아니라 경쟁에서 여러 개가 이긴다');
  // 죽은 프로세스가 남긴 락은 회수돼야 한다 (영구 정지 방지)
  assert.match(lock, /age > ttlMs/, '만료된 락을 회수하지 않는다');

  const be = codeOf('backend/server.mjs');
  assert.match(be, /acquireSyncLock\(DB_DIR, 'release-sync'\)/, '릴리스 동기화에 락이 없다');
  assert.match(be, /acquireSyncLock\(DB_DIR, 'chart-collect'/, '차트 수집에 락이 없다');
  // 락을 못 잡으면 그냥 넘어가야 한다
  assert.match(be, /skipped: 'locked-by-other-process'/, '락 실패 시 그대로 진행한다');
  // 끝나면 반드시 푼다
  const releases = (be.match(/await unlock\(\);/g) || []).length;
  assert.ok(releases >= 2, `락 해제가 ${releases}곳뿐이다 (릴리스·차트 둘 다 풀어야 한다)`);
});

check('차트와 환율이 자동으로 갱신된다', () => {
  /* 실측: charts.json 218시간(9일), fx.json 214시간 정체.
     릴리스·색인만 주기 갱신이 걸려 있었고 차트·환율은 사람이 손으로
     돌릴 때만 갱신됐다. 화면은 "실시간 차트"라고 적혀 있었으니
     표기와 실제가 달랐고, 환율은 실제와 1.6% 어긋나 있었다. */
  const be = codeOf('backend/server.mjs');
  assert.match(be, /scheduleBackground\(\(\) => refreshFx\('interval'\), FX_INTERVAL_MS, true\)/, '환율 주기 갱신이 없다');
  assert.match(be, /scheduleBackground\(\(\) => runChartCollect\('interval'\), CHART_INTERVAL_MS, true\)/, '차트 주기 갱신이 없다');
  /* 로스터도 자동으로 늘어야 한다.
     44팀에 묶여 있던 건 상한 탓만이 아니라 레이트리밋에 걸린 팀이
     매번 조용히 빠졌기 때문이다. 이제 보류로 남고 주기 실행이 다시 시도한다. */
  assert.match(be, /scheduleBackground\(\(\) => runRosterCollect\('interval'\), ROSTER_INTERVAL_MS, true\)/, '로스터 주기 갱신이 없다');
  const ca2 = codeOf('backend/collect-artists.mjs');
  assert.match(ca2, /export \{ main as collectArtists \}/, '로스터 수집기를 내보내지 않는다');
  assert.match(be, /refreshFx\('boot'\)/, '기동 시 환율을 확인하지 않는다');
  assert.match(be, /runChartCollect\('boot'\)/, '기동 시 차트를 확인하지 않는다');

  // 수집 모듈은 임포트만으로 실행되면 안 된다 (서버가 부를 수 없다)
  const cc = codeOf('backend/collect-charts.mjs');
  assert.match(cc, /export \{ main as collectCharts \}/, '차트 수집기를 내보내지 않는다');
  /* ⚠️ 가드 '패턴이 있는지'만 보면 안 된다.
        runDirectly = true 로 못 박은 변이가 통과했다.
        runDirectly 가 실제로 import.meta.url 비교 결과여야 한다. */
  const guard = cc.match(/const runDirectly\s*=\s*([\s\S]{0,160}?);/);
  assert.ok(guard, 'runDirectly 정의를 찾지 못했다');
  assert.match(guard[1], /import\.meta\.url/, 'CLI 직접 실행 가드가 무력화됐다');
  assert.doesNotMatch(guard[1], /^\s*true\b/, 'runDirectly 가 항상 참이다');

  // 환율 갱신이 실패하면 이전 값을 지키고 live:false 로 알린다
  const fx = codeOf('backend/lib/fx.mjs');
  assert.match(fx, /prev\?\.jpyKrw \?\? /, '실패 시 이전 환율을 유지하지 않는다');
});

check('조회 실패를 "없는 것"으로 처리하지 않는다', () => {
  /* iTunes 가 레이트리밋으로 빈 응답(0B)을 주면 getJson 이 null 을 돌려줬고,
     enrich 가 그걸 '결과 없음'과 똑같이 다뤄서
     BE:FIRST·ENHYPEN·Number_i 같은 팀이 "Apple 카탈로그 미확인"으로
     로스터에서 조용히 빠졌다. 실제로는 멀쩡히 존재하는 팀들이다. */
  const ca = codeOf('backend/collect-artists.mjs');
  assert.match(ca, /return \{ ok: false, data: null \}/, '요청 실패를 구분해 돌려주지 않는다');
  assert.match(ca, /anyRequestFailed \? \{ failed: true \} : \{ notFound: true \}/, '실패와 없음을 구분하지 않는다');
  assert.match(ca, /if \(meta\.failed\)/, '호출부가 실패를 따로 처리하지 않는다');
  assert.match(ca, /lookupFailures/, '실패를 집계해 보고하지 않는다');
});

check('상태 화면이 데이터가 묵었는지 알려준다', () => {
  // 나이(ageHours)만 내려보내면 화면이 '묵었다'를 판단할 수 없다.
  const be = codeOf('backend/server.mjs');
  assert.match(be, /staleAfterH/, '허용 나이 기준이 없다');
  assert.match(be, /refreshEveryH/, '자동 갱신 주기를 알려주지 않는다');
  assert.match(be, /stale: svc\.ageHours != null/, '묵음 판정이 없다');
});

check('로스터에 한·일 아티스트만 남는다', () => {
  /* Apple 은 스토어 언어로 장르를 준다. 그 신호만으로 국적을 정하면
     해당 스토어에 유통되는 외국 아티스트까지 들어온다.
     실제로 Lady Gaga 가 장르 "테크노" 하나로 country:kr / genre:K-POP 이 됐다. */
  const ca = codeOf('backend/collect-artists.mjs');
  assert.match(ca, /sure: false/, '현지어 장르 신호를 확정으로 다룬다');
  assert.match(ca, /async function verifyCountry/, '국적 확인 경로가 없다');
  assert.match(ca, /cc !== 'JP' && cc !== 'KR'/, '한·일이 아닌 국적을 걸러내지 않는다');

  const arts = JSON.parse(read('db/artists.json'));
  for (const a of arts) {
    assert.ok(a.country === 'jp' || a.country === 'kr', `${a.name} 의 country 가 ${a.country} 다`);
  }
});

check('없는 지표를 0 으로 보여주지 않는다', () => {
  /* 해석된 MV 가 없는 아티스트는 조회수가 0 인 게 아니라 우리가 안 갖고 있는 것이다.
     "0회"로 찍으면 인기가 없다는 뜻으로 읽힌다. */
  const be = codeOf('backend/server.mjs');
  assert.match(be, /hasData: mine\.length > 0/, '데이터 유무를 내려보내지 않는다');
  // 화면도 0 과 '없음'을 구분해야 한다
  const pg = read('frontend/src/pages.ts');
  assert.match(pg, /if \(!s\.totalViews\)/, '화면이 0 을 그대로 찍는다');
  assert.match(pg, /공개 지표를 가져오지 못했습니다/, '없을 때의 안내가 없다');
});

check('아티스트 통계가 시드에만 기대지 않는다', () => {
  /* db/tracks.json 의 시드 10곡에서만 곡을 찾아서, 시드에 없는 아티스트는
     화면에 "0회"가 찍혔다 — 조회수가 0이 아니라 우리가 안 갖고 있던 것이다. */
  const be = codeOf('backend/server.mjs');
  const i = be.indexOf("app.get('/api/artist/:id/stats'");
  assert.ok(i > 0, '아티스트 통계 엔드포인트를 찾지 못했다');
  const body = be.slice(i, i + 2200);
  assert.match(body, /readJson\('charts'/, '수집형 차트를 보지 않는다');
  assert.match(body, /bucket\.youtube/, '차트의 youtube 목록을 쓰지 않는다');
});

check('재수집이 기존 필드를 지우지 않는다', () => {
  /* 로스터를 다시 만들 때 필요한 필드만 골라 이어받고 있었다.
     그래서 목록에 안 적힌 값은 재수집 때마다 조용히 사라졌고,
     실제로 operatorSource / operatorMbid 가 날아가
     MusicBrainz 가 채운 팀이 '사람이 확인한 값'처럼 보였다.
     (화면은 operatorSource 로 '(자동 수집)' 표기를 결정한다) */
  const ca = codeOf('backend/collect-artists.mjs');
  assert.match(ca, /\.\.\.\(old \|\| \{\}\)/, '이전 레코드를 통째로 이어받지 않는다');

  // 자동 수집분은 추적 가능해야 한다
  const arts = JSON.parse(read('db/artists.json'));
  const auto = arts.filter((a) => a.operatorSource === 'musicbrainz');
  assert.ok(auto.length > 0, '자동 수집된 운영사가 하나도 없다');
  for (const a of auto) assert.ok(a.operatorMbid, `${a.name} 에 MBID 가 없다`);

  /* 반대 방향도 본다: 사람이 확인했다고 표시된 값이 실제로 그런가.
     자동 수집분이 출처를 잃으면 이 숫자가 부풀어 오른다. */
  const human = arts.filter((a) => a.operator && !a.operatorSource);
  for (const a of human) {
    assert.ok(!a.operatorMbid, `${a.name} 은 MBID 가 있는데 출처 표기가 없다 — 출처가 유실됐다`);
  }
});

check('부분 저장이 다른 나라 데이터를 지우지 않는다', () => {
  /* 차트 수집기가 빈 countries 로 시작해 나라별로 부분 저장했다.
     그래서 일본 수집이 끝나 저장되는 순간 한국 데이터가 파일에서 사라졌고,
     한국 수집이 끝날 때까지(수 분) /api/charts?country=kr 이 500 을 냈다.
     실패했을 때만 되살리는 catch 로는 이 구간을 못 막는다. */
  const cc = codeOf('backend/collect-charts.mjs');
  assert.match(cc, /countries:\s*\{\s*\.\.\.\(prev\.countries \|\| \{\}\)\s*\}/, '이전 데이터를 깔고 시작하지 않는다');

  const charts = JSON.parse(read('db/charts.json'));
  const codes = Object.keys(charts.countries || {});
  assert.ok(codes.includes('jp') && codes.includes('kr'), `국가가 ${codes.join(',')} 뿐이다`);
  for (const [code, c] of Object.entries(charts.countries)) {
    const lists = Object.entries(c).filter(([, v]) => Array.isArray(v));
    assert.ok(lists.length >= 3, `${code} 의 소스가 ${lists.length}개뿐이다`);
    assert.ok((c.combined || []).length >= 50, `${code} combined 가 ${(c.combined || []).length}곡뿐이다`);
  }
});

check('색인 재구축이 기존 색인을 무너뜨리지 않는다', () => {
  /* 색인의 주력 소스는 애플 디스코그래피다. 레이트리밋에 걸리면 빈 응답이 오는데
     그걸 그대로 덮어써서 실제로 6,453건이던 색인이 975건으로 주저앉았다.
     한글로 일본곡을 찾는 기능이 대부분 죽는다. */
  const bi = codeOf('backend/build-index.mjs');
  assert.match(bi, /prevCount > 200 && entries\.length < prevCount \* 0\.6/, '급감 시 보류하는 가드가 없다');
  assert.match(bi, /skipped: true/, '보류 상태를 알리지 않는다');

  const idx = JSON.parse(read('db/search-index.json'));
  assert.ok((idx.entries || []).length >= 2000, `색인이 ${(idx.entries || []).length}건뿐이다`);
});

/* ══════════════════════════════════════════════════
   곡 카탈로그 · 공식 채널 · 팬덤 방식
   엔터사 제휴 없이 갈 수 있는 데까지: 공개 API 로 곡을 넓히고,
   팔지 않고 공식 판매처·응모·팬클럽으로 보낸다.
   ══════════════════════════════════════════════════ */
check('곡 카탈로그가 아티스트 ID 로 저장돼 있다', () => {
  /* 아티스트 페이지가 매 조회마다 애플을 이름으로 검색해 10곡만 받았다.
     ID 기준으로 스토어별 200곡을 받아 저장하면 레이트리밋과 무관하고 동명이인이 안 섞인다. */
  const lib = codeOf('backend/lib/sync-catalog.mjs');
  assert.match(lib, /itunes\.apple\.com\/lookup\?id=\$\{appleArtistId\}&entity=song/, 'ID 로 조회하지 않는다');
  assert.doesNotMatch(lib, /itunes\.apple\.com\/search\?/, '이름 검색을 쓴다 (동명이인 위험)');
  // 못 받아온 것을 근거로 지우지 않는다
  assert.match(lib, /if \(!r\) \{[\s\S]{0,200}continue;/, '조회 실패 시 이전 카탈로그를 지운다');
  assert.match(lib, /r\.tracks\.length < old\.tracks\.length \* 0\.6/, '급감 시 보류하는 가드가 없다');
  // 200곡 상한을 전부인 척하지 않는다
  assert.match(lib, /capped/, '상한 여부를 남기지 않는다');

  const cat = JSON.parse(read('db/catalog.json'));
  const arts = Object.values(cat.artists || {});
  const total = arts.reduce((n, a) => n + (a.count || 0), 0);
  assert.ok(arts.length >= 50, `카탈로그 아티스트가 ${arts.length}팀뿐이다`);
  assert.ok(total >= 5000, `카탈로그 곡이 ${total}곡뿐이다`);
  for (const a of arts.slice(0, 20)) assert.ok(a.tracks.every((t) => t.id && t.title), `${a.name} 트랙에 id/title 이 없다`);

  const be = codeOf('backend/server.mjs');
  assert.match(be, /scheduleBackground\(\(\) => runCatalogSync\('interval'\), CATALOG_INTERVAL_MS, true\)/, '카탈로그 주기 동기화가 없다');
  assert.match(be, /acquireSyncLock\(DB_DIR, 'catalog-sync'/, '카탈로그 동기화에 락이 없다');
  // 화면이 저장본을 먼저 쓴다
  assert.match(read('frontend/src/pages.ts'), /\/api\/artist\/\$\{a\.id\}\/tracks/, '아티스트 페이지가 저장 카탈로그를 쓰지 않는다');
});

check('공식 채널이 출처와 함께 자동으로 붙는다', () => {
  /* 라일락은 팔지 않고 공식 판매처로 보낸다. 팀마다 공식·유튜브·SNS·타워/HMV
     링크가 있어야 하는데 애플 URL 하나뿐이었다. MusicBrainz url 관계로 채운다. */
  const lib = codeOf('backend/lib/backfill-links.mjs');
  assert.match(lib, /inc=url-rels/, 'MusicBrainz url 관계를 쓰지 않는다');
  assert.match(lib, /norm\(x\.name\) === norm\(c\)/, '아티스트 이름을 정확히 대조하지 않는다');
  assert.match(lib, /purchase for mail-order/, '음반 구매처(타워·HMV) 관계를 분류하지 않는다');
  assert.match(lib, /source: 'musicbrainz'/, '링크 출처를 남기지 않는다');
  // 사람이 넣은 링크는 덮지 않는다
  assert.match(lib, /v\.manual/, '수동 링크 보존 처리가 없다');

  const arts = JSON.parse(read('db/artists.json'));
  const withLinks = arts.filter((a) => a.links && Object.keys(a.links).length);
  assert.ok(withLinks.length >= arts.length * 0.7, `링크 보유가 ${withLinks.length}/${arts.length}팀뿐이다`);
  for (const a of withLinks) for (const [k, v] of Object.entries(a.links)) {
    assert.ok(v.url && /^https?:\/\//.test(v.url), `${a.name}.links.${k} 가 URL 이 아니다`);
    assert.ok(v.source || v.manual, `${a.name}.links.${k} 에 출처가 없다`);
  }
  const be = codeOf('backend/server.mjs');
  assert.match(be, /await backfillLinks\(/, '동기화에 링크 보강이 물려 있지 않다');
});

check('한일 팬덤 방식을 둘 다 다룬다', () => {
  /* 한국: 앨범 구매 응모·멤버십·선예매 / 일본: FC·FC선행·초회한정·점포특전·시리얼 응모.
     방식은 정의하되, 실제 캠페인 인스턴스는 지어내지 않는다. */
  const lib = codeOf('backend/lib/fandom.mjs');
  for (const id of ['kr-album-lottery', 'kr-membership', 'kr-fanclub-presale', 'jp-fc', 'jp-fc-presale', 'jp-first-press', 'jp-store-bonus', 'jp-serial-event']) {
    assert.match(lib, new RegExp(`id: '${id}'`), `방식 ${id} 가 없다`);
  }
  // 적용 판정은 '가진 데이터'(국적·릴리스 유통국)로만 한다 — 캠페인을 지어내지 않는다
  assert.match(lib, /r\.country === 'jp'/, '릴리스 유통국으로 교차 적용을 판정하지 않는다');
  assert.doesNotMatch(lib, /Math\.random|% \d/, '무작위·모듈로로 값을 만든다');
  // 화면에 노출
  const pg = read('frontend/src/pages.ts');
  assert.match(pg, /\/api\/artist\/\$\{a\.id\}\/fandom/, '아티스트 페이지가 팬덤 방식을 부르지 않는다');
  assert.match(pg, /fd-mech/, '방식 카드가 없다');
});

check('수집 실패가 기존 데이터를 지우지 않는다', () => {
  /* 실제로 릴리스 128건이 이 구멍으로 날아갔다.
     백엔드 여러 개가 같은 db 를 보며 동시에 애플을 두드리자 조회가 전부 막혔고,
     수집 0건을 "이제 릴리스가 하나도 없다"로 읽어 curated 3건만 남겼다.
     자동 수집은 자기가 못 받아온 것을 근거로 기존 데이터를 지우면 안 된다. */
  const lib = codeOf('backend/lib/sync-releases.mjs');
  assert.match(lib, /prevDiscovered/, '이전 discovered 를 보존하는 경로가 없다');
  assert.match(lib, /fresh\.length === 0/, '수집 0건을 구분하지 않는다');
  assert.match(lib, /skipped/, '보류 상태를 알리지 않는다');
  /* 서버가 보류를 눈에 보이게 남겨야 한다.
     ⚠️ 'out.skipped' 문자열이 있는지만 보면 안 된다 —
        if (out.skipped) 를 if (false) 로 바꾼 변이가 통과했다.
        조건문에 실제로 쓰이는지를 본다. */
  const be = codeOf('backend/server.mjs');
  assert.match(be, /if\s*\(\s*out\.skipped\s*\)/, '서버가 동기화 보류를 조건으로 다루지 않는다');
});

check('동기화 결과가 실제 데이터에 반영돼 있다', () => {
  const rel = JSON.parse(read('db/releases.json'));
  const tiers = rel.reduce((m, r) => { const t = r.tier || 'curated'; m[t] = (m[t] || 0) + 1; return m; }, {});
  assert.ok((tiers.curated || 0) >= 3, `curated 가 줄었다: ${tiers.curated}`);
  assert.ok((tiers.discovered || 0) >= 50, `discovered 가 너무 적다: ${tiers.discovered}`);
  // id 중복이 없어야 한다
  const ids = rel.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, '릴리스 id 가 중복된다');
});

check('공동구매가 실데이터(릴리스)를 참조한다', () => {
  // 공동구매는 실제 결제로 이어진다. 가격의 75%가 추정치인 products.json 위에서
  // 돌리면 확인 못 한 값으로 돈을 받는 꼴이 된다.
  const seed = be.slice(be.indexOf('async function seedGroupBuys'), be.indexOf('async function seedGroupBuys') + 2000);
  assert.match(seed, /RELEASE_COLLECTION/, '공동구매 시드가 릴리스를 쓰지 않는다');
  // ⚠️ 따옴표 종류를 고정하면 빠져나간다(변이 테스트에서 " 로 우회됐다)
  assert.doesNotMatch(seed, /readJson\(\s*['"`]products['"`]/, '공동구매 시드가 아직 products 를 읽는다');
});

check('릴리스 주문이 판매처×사양 정합성을 검사한다', () => {
  // 팬플리에서 위버스 독점반을 주문하는 식의 조합이 통과하면 안 된다.
  const fn = be.slice(be.indexOf('async function orderFromRelease'));
  assert.match(fn.slice(0, 1500), /OFFER_EDITION_MISMATCH/, '주문이 조합을 검증하지 않는다');
  const q = be.slice(be.indexOf("app.get('/api/quote'"), be.indexOf("app.get('/api/quote'") + 2500);
  assert.match(q, /OFFER_EDITION_MISMATCH/, '견적이 조합을 검증하지 않는다');
});

check('주문이 구매 맥락을 보존한다', () => {
  // 판매처가 나중에 특전을 바꿔도 "내가 무엇을 보고 샀는지"가 남아야 분쟁을 다룰 수 있다.
  const fn = be.slice(be.indexOf('async function orderFromRelease'));
  for (const k of ['bonus', 'store', 'sourceUrl', 'campaignEligible']) {
    assert.match(fn.slice(0, 3000), new RegExp(`\\b${k}:`), `주문에 ${k} 를 남기지 않는다`);
  }
});

check('추정 가격을 화면에서 추정이라고 표시한다', () => {
  // products.json 은 editions 의 75%가 real:false 다.
  // 상세 표 안쪽에만 적어두면 한눈에는 진짜 가격처럼 읽힌다.
  const pages = read('frontend/src/pages.ts');
  assert.match(pages, /src-badge demo">추정가/, '추정 가격에 배지가 없다');
});

check('전매·양도 중개를 취급하지 않는다고 명시한다', () => {
  // 일본은 2019년부터 티켓 부정전매를 형사처벌한다(부정전매금지법).
  // 공동"구매"와 재판매를 코드·문구 양쪽에서 구분해 둔다.
  assert.match(be, /전매/, '공동구매 코드에 전매 제외 명시가 없다');
});

check('공동구매 할인 상한이 계산과 일치한다', () => {
  // groupTier 가 주는 최대치와 quote() 의 상한이 어긋나면
  // 화면 할인율과 실제 청구가 달라진다.
  const tierMax = Math.max(...[...be.matchAll(/return 0\.(\d+);/g)].map((m) => Number('0.' + m[1])));
  const quoteCap = Number(pricing.match(/Math\.min\(Math\.max\(groupDiscount, 0\), ([\d.]+)\)/)[1]);
  assert.ok(tierMax <= quoteCap, `groupTier 최대 ${tierMax} 가 quote 상한 ${quoteCap} 을 넘는다`);
});

check('오류 응답에 기계가 읽을 코드가 있다', () => {
  // 프론트가 메시지를 문자열 비교하게 두면 문구만 바꿔도 분기가 깨진다.
  //
  // ⚠️ `\{([^}]*)\}` 로 본문을 뜨면 안 된다. 오류 메시지가 템플릿 리터럴이라
  //    `${...}` 안의 } 에서 끊겨 code 가 있는데도 없다고 잡는다(실제로 오탐이 났다).
  //    중괄호 깊이를 세어 객체 리터럴 끝까지 정확히 읽는다.
  const missing = [];
  const re = /res\.status\((4\d\d|5\d\d)\)\.json\(/g;
  let m;
  while ((m = re.exec(be))) {
    let i = be.indexOf('{', m.index + m[0].length - 1);
    if (i < 0) continue;
    let depth = 0;
    let end = i;
    for (; end < be.length; end++) {
      const ch = be[end];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) break; }
    }
    const body = be.slice(i, end + 1);
    if (!/\bcode:\s*'/.test(body)) missing.push(`${m[1]}:${body.slice(0, 40).replace(/\s+/g, ' ').trim()}`);
  }
  assert.deepEqual(missing, [], `code 없는 오류 응답: ${missing.slice(0, 4).join(' / ')}`);
});

/* ══════════════════════════════════════════════════
   11. 앱 화면
   ══════════════════════════════════════════════════ */
console.log('\n[앱 화면]');

const pagesTs = read('frontend/src/pages.ts');
const playerTs = read('frontend/src/player.ts');

check('좋아요 키가 서버와 같은 규칙이다', () => {
  // 클라이언트가 공백만, 서버가 구두점까지 지워서 키가 어긋났다.
  // 「好きすぎて滅!」 는 하트가 영영 안 채워지고 토스트도 반대로 떴다.
  const clientRe = playerTs.match(/const normKey = \(v: string\) =>\s*\n?\s*String\(v\)\.toLowerCase\(\)\.replace\(([^,]+),/);
  assert.ok(clientRe, '클라이언트 정규화 규칙을 찾지 못했다');
  const serverRe = be.match(/const norm = \(s\) => String\(s\)\.toLowerCase\(\)\.replace\(([^,]+),/);
  assert.ok(serverRe, '서버 정규화 규칙을 찾지 못했다');
  // 정규식 문자 클래스의 구성 문자가 같은지 (표기 차이는 무시)
  const chars = (re) => new Set(re.replace(/^\/|\/[gimsuy]*$/g, '').replace(/\\/g, '').split(''));
  const a = chars(clientRe[1].trim());
  const b = chars(serverRe[1].trim());
  const missing = [...b].filter((c) => !a.has(c));
  assert.deepEqual(missing, [], `클라이언트가 빠뜨린 문자: ${missing.join('')}`);
});

check('장식용 아이콘이 버튼으로 노출되지 않는다', () => {
  // <a> 안의 <button> 은 유효하지 않은 중첩이고,
  // 핸들러도 없는 장식이라 스크린리더에 이름 없는 버튼 56개가 읽혔다.
  assert.doesNotMatch(pagesTs, /<button class="hover-play"/, '장식 아이콘이 아직 button 이다');
  assert.match(pagesTs, /<span class="hover-play" aria-hidden="true"/, 'aria-hidden 처리가 없다');
});

check('기능 버튼에 접근 가능한 이름이 있다', () => {
  for (const [text, id] of [[pagesTs,'arPlay'],[read('frontend/src/discovery/index.ts'),'mdPlayChart'],[read('frontend/src/discovery/index.ts'),'mdShuffle']]) {
    const m = text.match(new RegExp('id="' + id + '"[^>]*'));
    assert.ok(m, id + ' 버튼이 없다'); assert.match(m[0], /aria-label=/);
  }
});

check('보관함이 비로그인 상태를 안내한다', () => {
  // 인증을 붙인 뒤 401 을 빈 배열로 삼켜 "플레이리스트 0"만 뜨는 빈 껍데기가 됐다.
  assert.match(pagesTs, /lib-guest/, '비로그인 안내가 없다');
  const fn = pagesTs.slice(pagesTs.indexOf('export async function pageLibrary'));
  assert.match(fn.slice(0, 900), /if \(!me\)/, '로그인 여부를 먼저 보지 않는다');
});

check('조회(GET) 401 은 로그인으로 튕기지 않는다', () => {
  // 화면을 그리려 배경에서 부르는 GET 까지 로그인 유도로 처리하면
  // 아티스트 목록 같은 공개 화면이 로그인으로 튕긴다(실제로 냈던 회귀).
  const apiTs = read('frontend/src/api.ts');
  assert.match(apiTs, /method !== 'GET'/, 'GET 을 구분하지 않는다');
  assert.match(apiTs, /lilac:auth-required/, '인증 필요 이벤트가 없다');
});

check('한국어 조사를 받침에 맞춰 고른다', () => {
  // "좋아요은 로그인 후..." 처럼 받침을 무시하면 바로 어색해진다.
  const i18n = read('frontend/src/i18n.ts');
  assert.match(i18n, /0xac00/i, '한글 음절 범위 판정이 없다');
  assert.match(i18n, /% 28/, '종성 계산이 없다');
  assert.match(read('frontend/src/main.ts'), /withParticle\(/, '조사 헬퍼를 쓰지 않는다');
});

check('커머스 테마가 목록 경계에만 적용된다', () => {
  // 실제 커머스 레퍼런스에 따른 밝은 상품 진열면. 앱 셸·음악 페이지는 유지한다.
  const css=read('frontend/src/store/store.css');
  assert.match(css,/\.commerce-store \{/);
  assert.match(css,/color-scheme: light; background: #fff/);
  assert.doesNotMatch(css,/^(?:body|\.p-card|\.store-wrap)\s*\{/m,'다른 페이지의 공통 카드를 덮어쓰면 안 된다');
  assert.match(read('frontend/src/styles/index.css'),/store\/store\.css/);
});

check('호버 확장이 카드 히트박스를 넘지 않는다', () => {
  // .card.expanded .cover 가 scale(1.14) 로 커지는데 히트박스인 .card 는
  // 그대로여서, 커버처럼 보이는데 카드가 아닌 띠가 생겼다.
  // 재생 버튼으로 커서를 옮기다 거길 밟으면 카드가 접히고 커서가 바뀌었다.
  // 게다가 .shelf 는 overflow-x:auto 라 커진 카드를 잘라냈고,
  // 가로 스크롤 시(실측 scrollLeft 15.5px) 패딩으로도 못 막는다.
  const css = read('frontend/src/style.css');
  // ⚠️ 고정 길이로 잘라내면 안 된다. 160자를 잘랐더니 바로 뒤에 오는
  //    .card.round.expanded .cover { transform: none } 까지 들어와서,
  //    정작 이 규칙을 scale(1.14) 로 되돌려도 통과했다. 블록만 정확히 뗀다.
  const last = css.lastIndexOf('.card.expanded .cover');
  assert.ok(last > 0, '확장 카드 규칙이 없다');
  const blk = css.slice(last, css.indexOf('}', last) + 1);
  assert.doesNotMatch(blk, /transform:\s*scale/, '아직 커버를 확대한다 — 히트박스와 어긋난다');
  assert.match(blk, /transform:\s*none/, '커버 확대를 명시적으로 끄지 않았다');
  // 대신 카드 자체를 옮긴다(transform 은 히트박스도 같이 옮긴다)
  assert.match(css.slice(css.lastIndexOf('.card.expanded {')), /^[^}]*translateY/, '카드 이동 처리가 없다');
});

check('홈 히어로가 다음 섹션을 가리지 않는다', () => {
  // 86vh(=774px@900) 라 뷰포트에 126px 만 남았고 그중 88px 을 플레이어 바가
  // 덮어, 다음 섹션 제목이 y=830 에서 바 뒤로 잘렸다.
  const css = read('frontend/src/style.css');
  // ⚠️ lastIndexOf 로 잡으면 뒤에 오는 ::after 규칙이 걸려 min-height 가 없다.
  //    min-height 를 실제로 가진 블록만 모아서 마지막 것을 본다.
  // ⚠️ 마지막 블록만 보면 안 된다 — @media 안의 값이 마지막이라
  //    기본 규칙을 86vh 로 되돌려도 통과했다. 모든 블록을 검사한다.
  const blocks = [...css.matchAll(/body\.has-3d-hero section\.billboard\s*\{[^}]*min-height:\s*min\((\d+)vh[^}]*\}/g)];
  assert.ok(blocks.length, 'min-height 를 가진 히어로 규칙을 못 찾았다');
  for (const b of blocks) {
    assert.ok(+b[1] <= 74, `히어로가 ${b[1]}vh 로 너무 크다 (플레이어 바 88px 를 감안해야 한다)`);
  }
});

check('홈 3D는 여백 안의 세 레코드이며 기존 앨범 벽을 재생성하지 않는다', () => {
  // 2026-09-06 요청으로 30장 벽의 BLEED 규격을 폐기했다.
  // 실제 물체·텍스처·모션·정리 동작은 verify-three.mjs가 검증한다.
  const hero = read('frontend/src/three/hero3d.ts');
  const homeCss = read('frontend/src/discovery/home-immersive.css');
  assert.match(hero, /const RECORD_COUNT = 3;/);
  assert.match(hero, /three-record-composition/);
  assert.doesNotMatch(hero, /const ROWS|const COL_W|const BLEED/);
  assert.match(homeCss, /100svh/);
  assert.match(homeCss, /\.music-discovery\.md-home\s*\{[^}]*max-width\s*:\s*none/);
});

check('릴리스 카드가 커버를 보여준다', () => {
  // 음반 스토어인데 카드가 글자만이었다. 131건 중 128건은 아트워크가 있다.
  const rel = read('frontend/src/release.ts');
  assert.match(rel, /rel-card-art/, '릴리스 카드에 커버 자리가 없다');
  assert.match(rel, /artUrl\(\{ artwork: x\.artwork \}/, '아트워크를 실제로 쓰지 않는다');
});

check('모르는 값을 0 으로 쓰지 않는다', () => {
  // 아직 수집 안 된 릴리스가 "판매처 0" 으로 나왔다.
  // 0곳이라는 뜻이 아니라 아직 모른다는 뜻이라 그대로 쓰면 거짓말이 된다.
  const rel = read('frontend/src/release.ts');
  // ⚠️ 문자열이 있느냐로 보면 안 된다 — 가드 안에 있어도 매치된다.
  //    "판매처 N" 을 쓰는 모든 자리가 offerCount > 0 가드 안에 있는지 본다.
  const uses = [...rel.matchAll(/판매처 \$\{x\.offerCount\}/g)];
  assert.ok(uses.length, '판매처 수를 아예 안 쓴다');
  for (const u of uses) {
    const before = rel.slice(Math.max(0, u.index - 160), u.index);
    assert.match(before, /if \(x\.offerCount > 0\)/, '판매처 수가 0 가드 밖에서 찍힌다');
  }
  // 무조건 찍던 옛 형태가 남아 있으면 안 된다
  assert.doesNotMatch(rel, /· \uD310\uB9E4\uCC98 \$\{x\.offerCount\}\$\{/, '옛 무조건 표기가 남아 있다');
});

check('홈이 손으로 넣은 시드가 아니라 실데이터를 쓴다', () => {
  const music=read('frontend/src/discovery/index.ts');
  assert.match(pagesTs, /pageHome\(\) \{ await renderMusicHome\(root\(\), \{ artists, products \}\)/);
  assert.match(music,/api\(\x60\/api\/charts\?country=/);
  assert.match(music,/chart\(country,'combined'\)/);
  assert.doesNotMatch(music,/\/api\/chart\?|\bseeds\b|db\/tracks/);
  assert.match(music,/safeList\(data\)/);
  assert.match(music,/차트를 불러오지 못했습니다/);
});

check('있는지 모르는 상품 구성을 만들지 않는다', () => {
  // 초회한정반의 '존재 여부'를 collectionId % 3 으로 정하고 있었다.
  // 450개 중 266개에 실제로 있는지 모르는 한정반과 가격이 붙었고,
  // 카드 배지와 스토어 통계 '한정반 266'도 여기서 나왔다.
  const col = codeOf('backend/collect-products.mjs');
  assert.doesNotMatch(col, /id % 3/, '아직 id 로 한정반 유무를 만든다');
  assert.doesNotMatch(col, /hasLimited/, '한정반 생성 로직이 남아 있다');
  const prods = JSON.parse(read('db/products.json'));
  const ltd = prods.flatMap((p) => p.editions || []).filter((e) => e.id === 'limited');
  assert.equal(ltd.length, 0, `지어낸 한정반이 ${ltd.length}건 남았다`);
  assert.equal(prods.filter((p) => p.badge === '한정반').length, 0, "'한정반' 배지가 남아 있다");
});

check('릴리스 커버를 자동으로 채우되 지어내지 않는다', () => {
  const server = read('backend/server.mjs');
  assert.match(server, /backfillReleaseArt\(/, '동기화에 커버 보강이 물려 있지 않다');
  const lib = codeOf('backend/lib/backfill-release-art.mjs');
  // 아티스트가 일치해야만 채운다 — 제목만 보면 커버곡/트리뷰트가 걸린다
  assert.match(lib, /names\.includes\(norm\(x\.artistName\)\)/, '아티스트 검증 없이 커버를 붙인다');
  // og:image 는 쓰지 않는다 (레이블 배너·샵 로고라 커버가 아니었다)
  assert.doesNotMatch(lib, /og:image|property="og/, 'og:image 를 커버로 쓴다');
  // 못 찾으면 비워 두고 상태를 남긴다
  assert.match(lib, /artworkStatus = 'unavailable'/, '못 찾았을 때 상태를 남기지 않는다');
});

check('출처끼리 다른 값을 조용히 덮어쓰지 않는다', () => {
  // 사람이 확인해 넣은 발매일과 애플의 발매일이 다른 릴리스가 실제로 2건 있다.
  // 자동 수집이 덮어쓰면 확인한 값이 사라진다. 병기하고 화면에 드러낸다.
  const lib = codeOf('backend/lib/backfill-release-art.mjs');
  assert.match(lib, /r\.appleReleaseDate = hit\.appleReleaseDate/, '애플 발매일을 따로 보관하지 않는다');
  assert.doesNotMatch(lib, /r\.releaseDate = hit\./, '저장된 발매일을 덮어쓴다');
  const rel = read('frontend/src/release.ts');
  assert.match(rel, /appleReleaseDate && x\.appleReleaseDate !== x\.releaseDate/, '화면이 불일치를 드러내지 않는다');
});

check('지어낸 재고를 표시하지 않는다', () => {
  /* stock 은 3 + (collectionId % 48) 로 만든 값이었다. 커머스에서 위험하다.
     ⚠️ 화면만 보면 안 된다. 수집기가 계속 써 넣으면 데이터엔 남고,
        화면을 되돌리는 순간 다시 새어 나온다. 세 곳을 다 본다. */
  assert.doesNotMatch(pagesTs, /\bp\.stock\b/, '아직 지어낸 재고를 화면에 쓴다');
  assert.doesNotMatch(pagesTs, /\uc7ac\uace0 \$\{/, '재고 값을 그대로 찍는 자리가 남았다');

  const col = codeOf('backend/collect-products.mjs');
  assert.doesNotMatch(col, /stock:/, '수집기가 아직 재고를 만들어 넣는다');

  const prods = JSON.parse(read('db/products.json'));
  const withStock = prods.filter((p) => 'stock' in p);
  assert.equal(withStock.length, 0, `데이터에 stock 필드가 ${withStock.length}건 남았다`);
});

check('지어낸 공연 일정을 넣지 않는다', () => {
  // "Mrs. GREEN APPLE 단독 내한 공연" 같은 실재하지 않는 일정 12건이 있었다.
  const ev = JSON.parse(read('db/events.json'));
  const demo = ev.filter((e) => e.isDemo === true);
  assert.equal(demo.length, 0, `아직 데모 일정이 ${demo.length}건 있다`);
  // 캠페인 파생 일정은 반드시 출처를 달고 있어야 한다
  const camp = ev.filter((e) => String(e.id || '').startsWith('camp-'));
  for (const c of camp) assert.ok(c.source, `${c.title} 에 출처가 없다`);
});

check('아티스트 아트워크가 자동으로 채워진다', () => {
  // 44팀 중 11팀이 비어 있었다. 손으로 채우면 다음 팀에서 또 빈다.
  const arts = JSON.parse(read('db/artists.json'));
  /* v14: 신원 확인에서 Apple 연결이 틀렸다고 판정돼 끊은 행(appleFix.status=none)은 비어 있는 게 맞다.
     예전엔 이 행들도 채워져 있었지만 다른 사람의 아트워크였다(로제 → Pascal Rogé, 星野源 → aespa). */
  const miss = arts.filter((a) => !a.artwork && a.appleFix?.status !== 'none');
  assert.equal(miss.length, 0, `아트워크 누락 ${miss.length}팀`);
  const unlinked = arts.filter((a) => a.appleFix?.status === 'none');
  assert.ok(unlinked.every((a) => !a.appleArtistId && !a.artwork), '연결을 끊은 행에 Apple 값이 남아 있다');
  const server = read('backend/server.mjs');
  assert.match(server, /backfillArtwork\(/, '동기화에 보강이 물려 있지 않다');
});

/* ══════════════════════════════════════════════════
   디자인 시스템 — 값의 단일 출처와 레이어 구조
   ══════════════════════════════════════════════════ */
check('스타일이 레이어로 쌓인다 (특정도 싸움 금지)', () => {
  /* style.css 에 4,000줄을 덧붙이며 특정도 싸움이 반복됐다(한 세션에 다섯 번).
     @layer 는 특정도보다 우선하므로, 옛 스타일을 legacy 레이어에 두면
     새 시스템은 단순한 선택자로도 반드시 이긴다. */
  const idx = read('frontend/src/styles/index.css');
  assert.match(idx, /@layer legacy,(?: site,)? tokens, base, components, pages, motion;/, '레이어 순서 선언이 없다');
  assert.match(idx, /@import url\('\.\.\/style\.css'\) layer\(legacy\)/, '옛 스타일이 legacy 레이어에 있지 않다');
  const main = read('frontend/src/main.ts');
  assert.match(main, /import '\.\/styles\/index\.css'/, '진입점이 레이어 파일을 임포트하지 않는다');
  assert.doesNotMatch(main, /import '\.\/style\.css'/, '옛 스타일을 직접 임포트한다 (레이어 밖 = 최우선이 된다)');
});

check('공용 크롬도 시스템을 따른다', () => {
  /* #page 만 정규화하고 톱바·플레이어·사이드바는 빠져 있었다.
     실측: 굵기 900 잔존, 라운드 12종. 크롬은 늘 보이는 영역이라
     여기가 어긋나면 앱 전체가 어긋나 보인다. */
  const comp = codeOf('frontend/src/styles/components.css');
  assert.match(comp, /\.topbar b, \.topbar strong/, '크롬의 굵기를 고정하지 않았다');
  assert.match(comp, /\.modal-box[^{]*\{[^}]*var\(--r-lg\)/, '모달 라운드가 토큰이 아니다');
  assert.match(comp, /\.pl-bar[^{]*\{[^}]*var\(--r-pill\)/, '플레이어 바 라운드가 토큰이 아니다');
});

check('굵기는 3단, 폰트 크기는 정수만 쓴다', () => {
  /* 실측: 홈에 폰트 15종·굵기 7단계(650·680·750·800)·라운드 11종.
     기준 제품(Apple Music·Spotify 웹)은 굵기 2~3단, 크기 3~6종이다. */
  for (const f of ['frontend/src/style.css', 'frontend/src/styles/components.css', 'frontend/src/styles/pages.css']) {
    const css = codeOf(f);
    const weights = new Set([...css.matchAll(/font(?:-weight)?:\s*(\d{3})\b/g)].map((m) => m[1]));
    for (const w of weights) assert.ok(['400', '600', '700'].includes(w), `${f} 에 굵기 ${w} 가 있다 (400/600/700 만 허용)`);
    const halves = [...css.matchAll(/font-size:\s*\d+\.5px/g)];
    assert.equal(halves.length, 0, `${f} 에 소수점 폰트 크기가 ${halves.length}곳 있다`);
  }
  const tokens = read('frontend/src/styles/tokens.css');
  for (const t of ['--fs-xs', '--fs-base', '--fs-xl', '--fs-3xl', '--fw-bold', '--r-sm', '--r-pill', '--ease-standard']) assert.match(tokens, new RegExp(t + ':'), `토큰 ${t} 가 없다`);
});

check('홈은 재생과 아트워크를 팬 활동보다 먼저 표시한다', () => {
  const music=read('frontend/src/discovery/index.ts'), css=read('frontend/src/discovery/discovery.css');
  assert.match(music,/md-static-art/);assert.match(music,/data-md-play/);
  assert.match(css,/\.md-jacket[^}]*aspect-ratio:1/);
  assert.match(music,/selections\.slice\(0,8\)/);
  assert.match(music,/href="#\/schedule"/);assert.match(music,/href="#\/releases"/);
  assert.ok(music.indexOf('class="md-hero"')<music.indexOf("section('최근 발매'"));
});

check('3D는 음악 아트워크에 한정되고 정적 대체 화면과 모션 제어가 있다', () => {
  const main=codeOf('frontend/src/main.ts'), music=read('frontend/src/discovery/index.ts');
  assert.doesNotMatch(main,/mountBackdrop\(|mountMotion3D\(|bindParallax\(/);
  assert.doesNotMatch(read('frontend/src/three/index.ts'),/can3D\(\): boolean \{ return false;/);
  assert.match(music,/mountHero3D/);assert.match(music,/mountChart3D/);
  assert.match(music,/md-static-art/);assert.match(music,/data-md-motion/);
  assert.match(music,/prefers-reduced-motion/);assert.match(music,/setSceneMotionPaused/);
  assert.match(main,/disposeDiscovery\(\)/);
});

check('인기 곡이 중복·파생 버전 없이 차트 순이다', () => {
  /* 카탈로그를 최신순으로 자르면 같은 곡이 JP/KR 스토어에서 두 번 나오고
     (실측 ILLIT "I Got Your Back" 4줄), Sped Up·TV size 가 원곡을 밀어냈다. */
  const be = codeOf('backend/server.mjs');
  assert.match(be, /const popular = /, 'popular 목록이 없다');
  assert.match(be, /seenBase\.has\(k\)/, '제목 중복 제거가 없다');
  assert.match(be, /VARIANT\.test/, '파생 버전을 뒤로 보내지 않는다');
  assert.match(be, /chartRank/, '차트 순위를 반영하지 않는다');
  const pg = read('frontend/src/pages.ts');
  assert.match(pg, /cat\.popular/, '화면이 popular 를 쓰지 않는다');
});

check('차트 행에서 좋아요할 수 있고 재생 동작과 분리된다', () => {
  const music=read('frontend/src/discovery/index.ts');
  assert.match(music,/data-md-like=/);assert.match(music,/hasAttribute\('data-md-like'\)/);
  assert.match(music,/needsLogin\('좋아요'\)/);assert.match(music,/api\('\/api\/likes'/);
  assert.match(music,/hasAttribute\('data-md-play'\)/);
  assert.doesNotMatch(music,/md-track-row[^\n]*addEventListener/);
});

check('같은 값을 두 곳에 적지 않는다 (타입 스케일)', () => {
  /* 랜딩과 앱의 타입 스케일이 실측 6개 값에서 정확히 같았다(13·15·17·24·32·44px).
     같은 값을 두 곳에 적어 두면 한쪽만 바뀌어 조용히 갈라진다.
     라운드·이징은 값이 달라 그대로 둔다 — 랜딩 고유의 결이다. */
  const site = read('frontend/src/site/site.css');
  const pairs = [['--st-text-caption', '--fs-sm'], ['--st-text-sm', '--fs-base'], ['--st-text-body', '--fs-md'],
                 ['--st-text-title', '--fs-xl'], ['--st-text-headline', '--fs-2xl'], ['--st-text-display', '--fs-3xl']];
  for (const [st, fs] of pairs) {
    assert.match(site, new RegExp(`${st}:\\s*var\\(${fs}\\)`), `${st} 가 ${fs} 를 가리키지 않는다 (값 중복)`);
  }
  // 레이아웃 폭도 한 곳에서
  const tokens = read('frontend/src/styles/tokens.css');
  assert.match(tokens, /--layout-max:\s*1240px/, '--layout-max 토큰이 없다');
  assert.match(site, /--st-max:\s*var\(--layout-max/, '랜딩이 레이아웃 폭을 따로 적는다');
  const pages = read('frontend/src/styles/pages.css');
  assert.doesNotMatch(pages, /calc\(\(100% - 1400px\)/, '앱이 폭을 하드코딩한다');
});

check('랜딩도 같은 레이어 체계 안에 있다', () => {
  /* site.css 는 앱과 별개로 자라 레이어 밖에 있었다. 레이어 밖 CSS 는
     레이어 안의 모든 규칙을 이기므로 두 체계가 조용히 갈라진다. */
  const idx = read('frontend/src/styles/index.css');
  assert.match(idx, /@layer legacy, site, tokens/, '레이어 순서에 site 가 없다');
  const wrap = read('frontend/src/site/site-layer.css');
  assert.match(wrap, /@import url\('\.\/site\.css'\) layer\(site\)/, '랜딩이 site 레이어에 있지 않다');
  const si = read('frontend/src/site/index.ts');
  assert.match(si, /import '\.\/site-layer\.css'/, '랜딩이 레이어 래퍼를 임포트하지 않는다');
  assert.doesNotMatch(si, /import '\.\/site\.css'/, '랜딩이 site.css 를 직접 임포트한다');
});

check('비로그인 보관함이 비어 있지 않다', () => {
  /* 안내 박스 하나만 있고 아래가 통째로 빈 화면이었다.
     로그인 전에도 할 수 있는 것(차트 인기·아티스트)을 보여준다. */
  const pg = read('frontend/src/pages.ts');
  /* ⚠️ 아이디 문자열 하나만 보면 안 된다 — 컨테이너와 채우는 코드가 짝이어야 한다.
        (한쪽만 바꾸는 변이가 통과했다) */
  for (const id of ['libGuestPicks', 'libGuestArtists']) {
    const uses = (pg.match(new RegExp(id, 'g')) || []).length;
    assert.ok(uses >= 2, `${id} 가 ${uses}곳뿐이다 (컨테이너 + 채우는 코드가 있어야 한다)`);
  }
  assert.match(pg, /\/api\/charts\?country=\$\{country\}&source=combined/, '비로그인 추천이 차트를 쓰지 않는다');
});

check('본문 색이 읽히는 대비를 갖는다', () => {
  /* 실측: --ink-faint(#706d77)가 페이지에서 4.00:1, 카드 위에서 3.93:1 로
     WCAG AA(4.5) 미달이었다. 차트 한 페이지에서만 171곳이 이 색이었다. */
  const css = read('frontend/src/style.css');
  const faints = [...css.matchAll(/--ink-faint:\s*#([0-9a-fA-F]{6})/g)].map((m) => m[1]);
  assert.ok(faints.length, '--ink-faint 를 찾지 못했다');
  for (const hex of faints) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    const L = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    // 카드 표면(대략 rgb(20,21,24)) 위에서도 4.5 를 넘어야 한다
    const Lbg = 0.2126 * f(20 / 255) + 0.7152 * f(21 / 255) + 0.0722 * f(24 / 255);
    const ratio = (Math.max(L, Lbg) + 0.05) / (Math.min(L, Lbg) + 0.05);
    assert.ok(ratio >= 4.5, `--ink-faint #${hex} 가 카드 위에서 ${ratio.toFixed(2)}:1 이다`);
  }
});

check('액센트를 읽는 글자색으로 쓰지 않는다', () => {
  /* --accent(#6D4A85)는 중간톤 보라라 페이지 위 글자로 2.86:1,
     채움 배경 + --accent-ink 조합으로도 2.76:1 이었다.
     읽어야 하는 자리에는 --accent-bright 를 쓴다. */
  const css = read('frontend/src/style.css');
  const strays = (css.match(/(?<!-)color:\s*var\(--accent\)(?!-)/g) || []).length;
  assert.equal(strays, 0, `--accent 를 글자색으로 쓰는 자리가 ${strays}곳 남았다`);
  const filled = (css.match(/background:\s*var\(--accent\);[^}]*color:\s*var\(--accent-ink\)/g) || []).length;
  assert.equal(filled, 0, `--accent 채움 + --accent-ink 글자 조합이 ${filled}곳 남았다`);
});

check('누르는 요소가 충분히 크다', () => {
  /* 실측: 플레이어 버튼 24~26px, 차트 MV 버튼 30px, 네비 링크 21px,
     국가 전환 29px. 손가락으로 누르기 어려운 크기다.
     보이는 크기는 두고 히트 영역만 넓힌 규칙이 있어야 한다. */
  /* ⚠️ @media 안의 모바일 전용 규칙이 같이 매치되면
        기본 규칙을 지워도 통과한다(실제로 그랬다). 미디어쿼리를 걷어내고 본다. */
  const stripMedia = (t) => t.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, ' ');
  const css = stripMedia(read('frontend/src/style.css'));
  for (const sel of ['.tbtn', '.rk-mv', '.seg-btn', '.chip', '.tb-link', '.footer-link']) {
    const esc = sel.replace('.', '\\.');
    const re = new RegExp(`${esc}[^{]*\\{[^}]*min-(?:width|height):\\s*3[2-9]px`);
    assert.match(css, re, `${sel} 에 최소 크기가 없다 (기본 규칙 기준)`);
  }
  const site = stripMedia(read('frontend/src/site/site.css'));
  assert.match(site, /\.site-nav a[\s\S]{0,120}min-height:\s*(?:3[2-9]|4[0-9])px/, '랜딩 네비에 최소 크기가 없다');
});

check('랜딩 텍스트에 그라데이션이나 투명 채우기를 쓰지 않는다', () => {
  const site=read('frontend/src/site/site.css').replace(/\/\*[\s\S]*?\*\//g,'');
  assert.doesNotMatch(site,/(?:-webkit-)?background-clip:\s*text/);
  assert.doesNotMatch(site,/-webkit-text-fill-color:\s*transparent/);
  assert.match(site,/\.accent-text\s*\{[^}]*color:\s*var\(--st-accent-savings\)/);
});

check('리스트 밀도가 상용 제품 수준이다', () => {
  // 측정: 차트 행 81px, 일정 행 97px 로 스포티파이(56)·애플뮤직(60) 대비 1.5배였다.
  // 한 화면에 3~5행밖에 안 보였다.
  const css = read('frontend/src/style.css');
  // 차트는 .rank-list.big 을 쓴다 — .rk-row 단독으로는 특정도가 모자라 값이 안 먹는다
  assert.match(css, /\.rank-list\.big \.rk-row \{[^}]*padding: 7px/, '차트 행 밀도 규칙이 특정도를 못 맞췄다');
  assert.match(css, /\.sch-row \{[^}]*padding: 10px 14px/, '일정 행 밀도 규칙이 없다');
});

check('초광폭에서 리스트가 벌어지지 않는다', () => {
  // 우측 메타(재생수·D-day)가 제목과 1,600px 떨어져 눈이 따라가지 못했다.
  const css = read('frontend/src/style.css');
  assert.match(css, /--list-max:/, '리스트 최대 폭이 없다');
  assert.match(css, /#chartBody[\s\S]{0,120}max-width: var\(--list-max\)/, '차트에 최대 폭이 안 걸렸다');
});

check('일정 제목에 아티스트가 중복되지 않는다', () => {
  // "back number · back number FC 선행 추첨 마감" 처럼 두 번 나왔다.
  assert.match(pagesTs, /function schTitle/, '중복 제거 헬퍼가 없다');
  assert.doesNotMatch(pagesTs, /sch-title">\$\{esc\(e\.artist\)\} · /, '아직 제목 앞에 아티스트를 붙인다');
});

check('차트 헤더가 상단 메뉴 뒤에 가려지지 않는다', () => {
  const page=read('frontend/src/styles/catalog.css');
  assert.match(page,/\.chart-hero,\.ar-hero,\.sp-head,\.mp-hero\{margin-top:0/);
  assert.match(page,/\.chart-hero \{[^}]*min-height: 0; height: auto/);
});

check('페이지마다 h1 이 하나 있다', () => {
  assert.match(read('frontend/src/store/index.ts'),/<h1>스토어<\/h1>/,'스토어에 주 제목이 있어야 한다');
  // 제목 계층이 h2 부터 시작하면 스크린리더가 페이지 주제를 못 잡는다.
  for (const marker of ['pd-name', 'auth-title']) {
    assert.match(pagesTs, new RegExp(`<h1[^>]*class="${marker}"`), `${marker} 이 h1 이 아니다`);
  }
});

/* ══════════════════════════════════════════════════
   12. 출처 위생 — 공개 레포에 사내 참조가 새면 안 된다
   ══════════════════════════════════════════════════ */
check('모바일 플레이어와 하단 메뉴가 겹치지 않는다', () => {
  const shell=read('frontend/src/styles/shell.css');
  assert.match(shell,/\.mnav\{display:grid;bottom:0;/);
  assert.match(shell,/\.player\{bottom:calc\(60px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(shell,/\.tb-search,\.tb-search:focus-within\{display:flex;grid-column:1\/-1/);
});
console.log('\n[출처 위생]');

// ⚠️ 아래 검사는 금지어를 목록으로 들고 있어야 성립한다.
//    즉 이 파일이 레포에서 그 이름들이 남아 있는 유일한 곳이다.
//    공개 레포에 그것조차 두기 싫다면 이 검사 하나를 지우면 된다
//    (다른 30개 검사는 영향받지 않는다). 지우면 회귀를 못 잡는 건 감수해야 한다.
check('사이트 레이어에 사내 레포·브랜드명이 없다', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(SITE);
  const hits = [];
  for (const f of files) {
    const body = readFileSync(f, 'utf8');
    for (const term of ['letsur', 'zcre', 'gw.letsur.ai']) {
      if (body.toLowerCase().includes(term)) hits.push(`${f.replace(ROOT + '/', '')}:${term}`);
    }
  }
  assert.deepEqual(hits, [], `사내 참조 발견: ${hits.join(', ')}`);
});

/* ══════════════════════════════════════════════════ */
console.log(`\n${'─'.repeat(52)}`);
if (failures.length) {
  console.log(`통과 ${pass} · 실패 ${failures.length}\n`);
  failures.forEach((f) => console.log(`  ❌ ${f.name}\n     ${f.err.split('\n')[0]}`));
  process.exit(1);
}
console.log(`통과 ${pass} · 실패 0\n`);
