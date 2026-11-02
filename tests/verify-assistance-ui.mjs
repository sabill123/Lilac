#!/usr/bin/env node
/** Actual assistance module, controlled DOM/Translator/fetch only. No network, storage or real personal data. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
const source = readFileSync(new URL('../frontend/src/app/assistance.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
class Node extends EventTarget {
  textContent = ''; value = ''; disabled = false; innerHTML = ''; dataset = {}; lang = '';
  click() { this.dispatchEvent(new Event('click')); }
  input(value) { this.value = value; this.dispatchEvent(new Event('input')); }
}
class Host extends Node {
  nodes = new Map(); sources = []; translations = new Map(); images = [];
  constructor() { super(); for (const key of ['collect','fetch-status','sources','direction','activate','cancel','translate-sources','translation-status','input','output','copy','format','format-input','format-run','format-output','format-copy']) this.nodes.set(key, new Node()); this.nodes.get('direction').value = 'ja'; this.nodes.get('format').value = 'KR'; }
  matches(selector) { return selector === '[data-assistance]'; }
  querySelector(selector) { const key = selector.match(/^\[data-a="([^"]+)"\]$/)?.[1]; if (key) return this.nodes.get(key); const id = selector.match(/^\[data-source-translation="(\d+)"\]$/)?.[1]; return this.translations.get(id) || null; }
  querySelectorAll(selector) { return selector === '[data-assistance-image]' ? this.images : selector === '[data-source-text]' ? this.sources : selector === '[data-source-translation]' ? [...this.translations.values()] : []; }
  at(key) { return this.nodes.get(key); }
}
function harness({ translator = true, available = 'downloadable' } = {}) {
  const api = {}, timers = new Map(), creates = [], calls = [], requests = [], writes = []; let locale = 'ko', id = 0;
  const factory = {
    availability: async () => available,
    create(options) { const gate = deferred(); creates.push({ gate, options }); options.monitor({ addEventListener(type, listener) { assert.equal(type, 'downloadprogress'); creates.at(-1).progress = listener; } }); return gate.promise; },
  };
  const context = vm.createContext({ exports: api, require(name) { if (name === './i18n') return { getLocale: () => locale }; if (name === './assistance.css') return {}; throw new Error(name); }, URL, URLSearchParams, AbortController, console,
    setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearTimeout(key) { timers.delete(key); },
    fetch(url, options) { const gate = deferred(); requests.push({ url, options, gate }); return gate.promise; },
    navigator: { clipboard: { writeText: async text => writes.push(text) } },
    ...(translator ? { Translator: factory } : {}),
  });
  vm.runInContext(compiled, context);
  const makeInstance = () => ({ destroyed: 0, translate(text) { const gate = deferred(); calls.push({ text, gate }); return gate.promise; }, destroy() { this.destroyed++; } });
  return { api, creates, calls, requests, writes, makeInstance, locale(value) { locale = value; }, tick() { for (const [key, timer] of [...timers]) if (timer.ms === 300) { timers.delete(key); timer.fn(); } } };
}
const ctx = { kind: 'fanclub', artistId: 'group & name', artistName: '<artist>', title: 'Member "Guide"', url: 'https://official.example/membership' };
const h = harness();
assert.equal(h.api.assistanceEndpoint(ctx), '/api/live/assistance?kind=fanclub&locale=ko&artistId=group+%26+name');
assert.equal(new URLSearchParams(h.api.assistanceEndpoint({ ...ctx, kind: 'purchase', url: 'https://official.example/item?a=1&b=2' }).split('?')[1]).get('url'), 'https://official.example/item?a=1&b=2');
for (const unsafe of ['javascript:alert(1)','https://user:pass@example.com/','//evil.example/','https://a.example/\n','data:text/html,x']) assert.equal(h.api.assistanceUrl(unsafe), '');
assert.equal(h.api.assistanceUrl('https://official.example/'), 'https://official.example/');
assert.match(h.api.assistanceHtml(ctx), /&lt;artist&gt;/);
assert.match(h.api.assistanceHtml(ctx), /비밀번호/);
h.locale('ja'); assert.match(h.api.assistanceHtml(ctx), /端末内リアルタイム翻訳/); h.locale('ko');
assert.match(h.api.fieldHint('フリガナ'), /임의로 음역하지/);
assert.match(h.api.fieldHint('Unknown label'), /알 수 없습니다/);
assert.match(h.api.fieldHint('郵便番号','ja'), /海外住所/);
assert.equal(h.api.normalizePhone('000', 'KR'), null);
assert.equal(h.api.normalizePhone('abc', 'JP'), null);
assert.equal(h.api.normalizePhone('+81 00 0000 0000', 'KR'), null);
assert.equal(h.api.normalizePhone('０００－００００－００００', 'JP'), '+810000000000'); // Deliberately non-personal synthetic digits.
assert.equal(h.api.formatKana('ｶﾞｯﾂﾎﾟｰｽﾞ', 'full'), 'ガッツポーズ');
assert.equal(h.api.formatKana('ガッツポーズ', 'half'), 'ｶﾞｯﾂﾎﾟｰｽﾞ');
assert.equal(h.api.formatKana('한글 ABC', 'half'), '한글 ABC');
const literalCalls=[];
const literalText='登録前に【 @mga-officialstore.com 】を許可。 help@store.example 商品 UPCH-29510 https://shop.example/a?item=1';
const literalResult=await h.api.translatePublicText(literalText,{translate:async text=>{literalCalls.push(text);return `訳(${text})`;}});
for(const literal of ['@mga-officialstore.com','help@store.example','UPCH-29510','https://shop.example/a?item=1']) { assert.ok(literalResult.includes(literal),'Original literal retained exactly'); assert.ok(!literalCalls.some(text=>text.includes(literal)),'Literal never sent to model'); }
assert.ok(literalCalls.length>0,'Surrounding prose is really translated');
let literalCurrent=true;
await assert.rejects(h.api.translatePublicText('文章 @store.example 後半',{translate:async()=>{literalCurrent=false;return 'first';}},()=>literalCurrent),/superseded/);
assert.match(h.api.assistanceHtml(ctx),/부정 표현을 잘못/);
const rendered = h.api.assistanceSourcesHtml({ url: ctx.url, fetchedAt: '2026-10-25T00:00:00Z', fields: [{ label:'フリガナ', type:'text', required:null },{ label:'<x>', required:true, options:['<a>'] }], evidence:[{ category:'fee', verbatim:'<script>not executable</script>', sourceUrl:ctx.url }], unknowns:['海外入会は未確認'] });
assert.match(rendered, /&lt;script&gt;/); assert.doesNotMatch(rendered, /<script>/); assert.match(rendered, /필수 여부 미확인/); assert.match(rendered, /원문상 필수/); assert.match(rendered, /海外入会は未確認/);
assert.match(h.api.assistanceSourcesHtml({ fields:[{label:'name', required:true}],evidence:[{text:'unsourced'}] }), /조건을 확인하지 못했습니다/);
const photoHtml = h.api.assistanceSourcesHtml({url:ctx.url,fetchedAt:'2026-10-25T00:00:00Z',images:[{url:'https://images.example/album.jpg',kind:'jsonld',sourceUrl:ctx.url,alt:'<photo>'},{url:'https://images.example/album.jpg',kind:'meta',sourceUrl:ctx.url},{url:'javascript:alert(1)',sourceUrl:ctx.url},{url:'https://images.example/cover.jpg',kind:'meta',sourceUrl:ctx.url}],fields:[{label:'サイズ',choices:['A','B'],required:null}],unknowns:[{topic:'phone',reason:'not_observed_in_fetched_public_pages'},{topic:'eligibility_and_mandatory_requirements',reason:'public_evidence_is_not_account_or_residence_eligibility_confirmation'}],warnings:[{code:'upstream_http_403'},{code:'timeout'},{code:'unexpected_backend_code'}]});
assert.equal((photoHtml.match(/data-assistance-image src=/g)||[]).length,2,'Safe deduplicated actual source images');
assert.match(photoHtml,/JSON-LD/); assert.match(photoHtml,/OG \/ Twitter/); assert.match(photoHtml,/상품 사진인지·사용 권한은 미확인/); assert.match(photoHtml,/loading="lazy"/); assert.match(photoHtml,/data-assistance-image-error hidden/); assert.match(photoHtml,/&lt;photo&gt;/); assert.match(photoHtml,/A \/ B/); assert.match(photoHtml,/전화번호 조건은/); assert.doesNotMatch(photoHtml,/not_observed_in|unexpected_backend_code|upstream_http/); assert.doesNotMatch(photoHtml,/javascript:/);
assert.match(h.api.assistanceIssueText({code:'timeout'}),/응답 시간이/); h.locale('ja'); assert.match(h.api.assistanceIssueText({topic:'phone',reason:'not_observed_in_fetched_public_pages'}),/電話番号/); h.locale('ko');
const root = new Host(); const cleanup = h.api.mountAssistance(root, ctx); await flush();
assert.equal(root.at('activate').disabled, false); assert.equal(h.creates.length, 0, 'No model creation before user activation');
root.at('input').input('公開案内'); h.tick(); await flush(); assert.equal(h.calls.length, 0, 'No translation before activation');
root.at('activate').click(); assert.equal(h.creates.length, 1, 'create is synchronous within click');
h.creates[0].progress({loaded:0.5}); assert.match(root.at('translation-status').textContent, /50%/);
const first = h.makeInstance(); h.creates[0].gate.resolve(first); await flush();
assert.equal(h.calls[0].text, '公開案内'); h.calls[0].gate.resolve('공개 안내'); await flush(); assert.equal(root.at('output').textContent,'공개 안내');
root.at('input').input('old'); h.tick(); await flush();
root.at('input').input('new'); h.tick(); await flush();
h.calls[2].gate.resolve('new result'); await flush(); h.calls[1].gate.resolve('stale result'); await flush(); assert.equal(root.at('output').textContent,'new result','Old input cannot overwrite latest');
root.at('copy').click(); await flush(); assert.deepEqual(h.writes,['new result']);
const sourceNode = new Node(); sourceNode.textContent = '原文'; sourceNode.dataset.sourceText = '0'; root.sources.push(sourceNode); root.translations.set('0',new Node());
root.at('translate-sources').click(); await flush(); assert.equal(h.calls.at(-1).text,'原文'); h.calls.at(-1).gate.resolve('원문'); await flush(); assert.equal(root.translations.get('0').textContent,'원문');
const imageNode=new Node(), imageFailure=new Node(); imageFailure.hidden=true; imageNode.hidden=false; imageNode.complete=false; imageNode.parentElement={querySelector:()=>imageFailure}; root.images.push(imageNode);
root.at('collect').click(); assert.equal(h.requests.length,1); assert.equal(h.requests[0].options.credentials,'omit');
h.requests[0].gate.resolve({ok:true,json:async()=>({url:ctx.url,evidence:[{verbatim:'public only'}]})}); await flush(); assert.match(root.at('sources').innerHTML,/public only/); imageNode.dispatchEvent(new Event('error')); assert.equal(imageNode.hidden,true); assert.equal(imageFailure.hidden,false,'Broken source images have an honest visible failure message');
root.at('direction').value='ko'; root.at('direction').dispatchEvent(new Event('change')); await flush(); assert.equal(first.destroyed,1); assert.equal(root.at('output').textContent,'');
root.at('activate').click(); const stale = h.creates.at(-1); root.at('cancel').click(); await flush(); assert.equal(stale.options.signal.aborted,true); const staleInstance=h.makeInstance(); stale.gate.resolve(staleInstance); await flush(); assert.equal(staleInstance.destroyed,1,'Cancelled creation is destroyed even if API resolves late');
root.at('activate').click(); const last=h.creates.at(-1); const lastInstance=h.makeInstance(); last.gate.resolve(lastInstance); await flush();
root.at('input').input('pending'); h.tick(); await flush(); const oldCall=h.calls.at(-1); cleanup(); oldCall.gate.resolve('must not render'); await flush(); assert.equal(root.at('output').textContent,''); assert.equal(root.at('input').value,''); assert.equal(lastInstance.destroyed,1); assert.equal(last.options.signal.aborted,true); cleanup();
root.at('collect').click(); assert.equal(h.requests.length,1,'Cleanup removes listeners');
const unsupported=harness({translator:false}); const unsupportedRoot=new Host(); const unsupportedCleanup=unsupported.api.mountAssistance(unsupportedRoot,ctx); await flush(); assert.equal(unsupportedRoot.at('activate').disabled,true); assert.match(unsupportedRoot.at('translation-status').textContent,/지원하지 않습니다/); unsupportedCleanup();
const unavailable=harness({available:'unavailable'}); const unavailableRoot=new Host(); unavailable.api.mountAssistance(unavailableRoot,ctx)(); await flush(); assert.equal(unavailable.creates.length,0);
const external=harness(); const externalRoot=new Host(); const abort=new AbortController(); external.api.mountAssistance(externalRoot,ctx,{signal:abort.signal}); await flush(); externalRoot.at('activate').click(); abort.abort(); assert.equal(external.creates[0].options.signal.aborted,true);
const err=harness(); const errRoot=new Host(); let alive=true; const errCleanup=err.api.mountAssistance(errRoot,ctx,{alive:()=>alive}); await flush(); errRoot.at('activate').click(); err.creates[0].gate.reject(new Error('denied')); await flush(); assert.equal(errRoot.at('activate').disabled,false); assert.match(errRoot.at('translation-status').textContent,/시작하지 못했습니다/); errRoot.at('collect').click(); err.requests[0].gate.reject(new Error('offline')); await flush(); assert.match(errRoot.at('fetch-status').textContent,/미확인/); alive=false; errCleanup();
assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie|mymemory|translate_a|gtx/);
// More than 30 source quotes must not leave discovered form labels permanently untranslated.
const many=harness(), manyRoot=new Host();const manyCleanup=many.api.mountAssistance(manyRoot,ctx);await flush();manyRoot.at('activate').click();many.creates[0].gate.resolve({translate:async text=>'訳:'+text,destroy(){}});await flush();
for(let i=0;i<40;i++){const node=new Node();node.textContent='公開項目'+i;node.dataset.sourceText=String(i);manyRoot.sources.push(node);manyRoot.translations.set(String(i),new Node());}
manyRoot.at('translate-sources').click();for(let i=0;i<20;i++)await flush();assert.equal([...manyRoot.translations.values()].filter(node=>node.textContent.startsWith('訳:')).length,40);assert.match(manyRoot.at('translation-status').textContent,/기계 번역 완료/);manyCleanup();
console.log('PASS assistance: safe source rendering, bilingual glossary, phone/kana helpers, actual mount activation/download/cancel/destroy, latest input fencing, source translation, abort/alive cleanup, fetch failures and no-cloud/no-storage boundary');
