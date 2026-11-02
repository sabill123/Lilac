import { nameReading, venueReading } from './name-reading';
/** Public catalogue text only. Source records, URLs, identities and user-entered content are never rewritten or transmitted. */
export type ContentLanguage='ko'|'ja';
export type SourceLanguage=ContentLanguage|'en';
export interface DeviceTranslator{translate(text:string):Promise<string>;destroy():void}
interface Factory{availability(pair:{sourceLanguage:SourceLanguage;targetLanguage:ContentLanguage}):Promise<string>;create(pair:{sourceLanguage:SourceLanguage;targetLanguage:ContentLanguage}):Promise<DeviceTranslator>}
export interface DisplayArtist{id:string;name:string;nameOriginal?:string|null;nameKo?:string|null;nameJa?:string|null;venue?:boolean;readingKana?:string|null;readingSourceUrl?:string|null}
export const CONTENT_LOCALIZATION_VERSION=11;
/** Song/release/award work titles are shown verbatim ("노래제목은 원문그대로"). Text inside a marked work is never
 *  translated, transliterated or registered as an artist; an element marked with ORIGINAL_LABEL keeps its alt/aria-label exact
 *  (the UI-chrome word in it, e.g. 미리듣기/試聴, is already localized by i18n when the markup is built). */
export const ORIGINAL_WORK='data-content-original-work',ORIGINAL_LABEL='data-content-original-label';
// Unmarked legacy song-row/release-card titles (e.g. an artist page's track list) get the same protection.
const WORK_SELECTOR='[data-content-original-work],.crow-main>b,.rcard-title',LABEL_SELECTOR='[data-content-original-label],.crow-art,.shelf-art';
/** Distinct titles of a work field: "怪獣 · 新宝島" names two songs, each protected on its own. */
export function workTitles(value:string):string[]{const whole=value.trim();if(!whole)return[];return [...new Set([whole,...whole.split(/\s+[·・/／]\s+/).map(x=>x.trim())])].filter(x=>x.length>=2);}
const JA=/[\u3040-\u30ff\u3400-\u9fff]/,KO=/[가-힣]/;
// Domain terminology, not event/artist dictionaries. Novel prose is handled by the device model.
const TERMS:[string,string][]=[['初回生産限定BOX','초회생산한정BOX'],['初回生産限定盤','초회생산한정반'],['初回限定盤','초회한정반'],['通常盤','통상반'],['抽選応募券','추첨 응모권'],['特典共通','특전 공통'],['公式ヘルプ','공식 Help'],['海外送料','해외 배송비'],['海外配送','해외 배송'],['輸入関税・税金・手数料','수입 관세·세금·수수료'],['公式ファンクラブ','공식 팬클럽'],['公式ファンクラブ','공식팬클럽'],['一般発売','일반예매'],['一般発売','일반 예매'],['メンバーシップ先行購入','멤버십 선구매'],['メンバーシップ先行','멤버십 선예매'],['先行購入','선구매'],['全会員＋CD購入者限定先行','전 회원 + CD 구매자 대상 선예매'],['全会員+CD購入者限定先行','전 회원 + CD 구매자 대상 선예매'],['全会員先行','전 회원 선예매'],['OFFICIAL FAN CLUB','공식 팬클럽'],['既存購入者向け先行販売','기존 예매자 선예매'],['ファンクラブ会員先行','팬클럽 회원 선예매'],['先行受付','선예매 접수'],['限定先行','한정 선예매'],['一般発売','일반 판매'],['抽選受付','추첨 접수'],['先着','선착순 접수'],['抽選','추첨'],['受付終了','접수 종료'],['受付開始','접수 시작'],['全会員','전 회원'],['CD購入者','CD 구매자'],['先行','선예매'],['既存購入者','기존 예매자'],['公演','공연']];
export function sourceLanguageFor(text:string,target:ContentLanguage):SourceLanguage|null{
 if(target==='ko'&&JA.test(text)&&(/[\u3040-\u30ff]/.test(text)||!KO.test(text)||(text.match(/[\u3400-\u9fff]/g)||[]).length>(text.match(/[가-힣]/g)||[]).length))return 'ja';if(target==='ja'&&KO.test(text))return 'ko';
 // Latin official names/work names remain recognizable. Translate descriptive multi-word English only.
 if(!JA.test(text)&&!KO.test(text)&&/[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(text))return 'en';
 return null;
}
export function localizeTerms(text:string,target:ContentLanguage){let result=text;if(target==='ja')result=result.replace(/일반\s*예매일?/g,'一般発売').replace(/티켓\s*오픈일?/g,'発売日');const pairs=TERMS.map(([ja,ko])=>target==='ko'?[ja,ko]:[ko,ja]).sort((a,b)=>b[0].length-a[0].length);for(const[from,to]of pairs)result=result.split(from).join(to);return result;}
/** Quoted work spans (「…」, 『…』, “…”, ‘…’, "…") are kept verbatim, conservatively: 1–40 chars, no line break, no nested quotes and no
 *  sentence punctuation (。、，,), no edge whitespace, and ‘…’/"…" not glued to Latin letters (rock’n’roll, 5" x 7"). New titles
 *  need no dictionary: the quote marks are the signal. */
const QUOTE_INNER=(()=>{const no='“”"‘’「」『』。、，,<>\\n\\r';return `[^\\s${no}](?:[^${no}]{0,38}[^\\s${no}])?`;})();
const QUOTED_WORK_SOURCE=`「${QUOTE_INNER}」|『${QUOTE_INNER}』|“${QUOTE_INNER}”|(?<![A-Za-z0-9])‘${QUOTE_INNER}’(?![A-Za-z0-9])|(?<![A-Za-z0-9"])"${QUOTE_INNER}"(?![A-Za-z0-9"])`;
/** A CJK-magnitude quantity (3億回, 1万5000円, 3억 5000만 원, 2,000万人) is one literal: splitting the digits from 億/만 lets the
 *  model re-scale the number ("3" + "億回" → "3100만"). Counters attach only directly after a magnitude. */
const MAGNITUDE='[万億兆千만억조천]',COUNTER='[回円人枚本件曲位倍票台個名組点회원엔명장권건곡위배표대개점번]';
const CJK_QUANTITY_SOURCE=`[¥￥₩$€]?\\d[\\d,.]*\\s?${MAGNITUDE}(?:(?:\\s?\\d[\\d,.]*)?${MAGNITUDE})*(?:\\d[\\d,.]*)?(?:\\s?(?:${COUNTER}|JPY|KRW|USD))?`;
/** Inner texts of quoted work spans, so names/terms never rewrite inside a quoted (possibly brand-new) title. */
export function quotedWorks(text:string):string[]{return [...new Set((text.match(new RegExp(QUOTED_WORK_SOURCE,'g'))||[]).map(q=>q.slice(1,-1)))].filter(x=>x.length>=2);}
// Existing URL/email/catalogue/brand/Latin-quote and date/price literals are unchanged; the CJK quantity runs before the plain number.
const LITERAL_HEAD=/(?:https?:\/\/|www\.)[^\s<>"'「」()（）]+|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\b(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z]{2,}[0-9]+(?:-[A-Z0-9]+)*\b|\b[A-Z]{2,}-\d+\b|\b[A-Z]{2,}(?:[-:&/][A-Z0-9]+)*\b|[“「『][A-Za-z0-9][A-Za-z0-9 .!?'’:\-+&/]*[”」』]/,PLAIN_NUMBER=/[¥￥₩$€]?\d[\d,.]*(?:[-/:]\d[\d,.]*)*(?:\s*(?:JPY|KRW|USD|円|엔|원|%|％|時|分|초|분|시간))?/;
const literalPattern=new RegExp([QUOTED_WORK_SOURCE,LITERAL_HEAD.source,CJK_QUANTITY_SOURCE,PLAIN_NUMBER.source].join('|'),'g');
export function protectContent(text:string,target:ContentLanguage,identities:string[]=[]){
 const literals:string[]=[];const token=(s:string)=>{const i=literals.push(s)-1;return `ZXQ${i}QXZ`;};
 // Protect target-language runs too: translation must not paraphrase already-localized eligibility/conditions.
 let prepared=text.replace(literalPattern,token);
 const identitySet=[...new Set(identities)].filter(x=>x.length>=2).sort((a,b)=>b.length-a.length);
 for(const name of identitySet)if(prepared.includes(name)&&!/ZXQ\d+QXZ/.test(name))prepared=prepared.split(name).join(token(name));
 prepared=prepared.replace(target==='ko'?/[가-힣][가-힣\s·+]*(?:[가-힣])?/g:/[\u3040-\u30ff\u3400-\u9fff][\u3040-\u30ff\u3400-\u9fff\s・＋]*(?:[\u3040-\u30ff\u3400-\u9fff])?/g,token);
 return{prepared,literals};
}
export function restoreContent(text:string,literals:string[]):string|null{
 let out=text;for(let i=0;i<literals.length;i++){const re=new RegExp(`Z\\s*X\\s*Q\\s*${i}\\s*Q\\s*X\\s*Z`,'gi');const found=out.match(re);if(found?.length!==1)return null;out=out.replace(re,()=>literals[i]);}if(/ZXQ\d+QXZ/i.test(out))return null;return out;
}
/** Runs fn with every known work title hidden behind an opaque private-use marker, then restores the titles byte-for-byte.
 *  A text that is exactly an artist identity is left visible so a self-titled work never blocks artist localization. */
export function shieldWorks(text:string,works:string[],artists:DisplayArtist[],fn:(shielded:string)=>string):string{
 const forms=new Set(artists.flatMap(a=>[a.name,a.nameOriginal,a.nameKo,a.nameJa]).filter(Boolean));if(forms.has(text.trim()))return fn(text);const hidden:string[]=[];
 const shielded=[...new Set(works)].filter(w=>w.length>=2&&!forms.has(w)&&![...forms].some(f=>f.includes(w))).sort((a,b)=>b.length-a.length).reduce((acc,w)=>acc.includes(w)?acc.split(w).join('\uE000'+String.fromCharCode(0xE100+hidden.push(w)-1)+'\uE001'):acc,text);
 return fn(shielded).replace(/\uE000([\uE100-\uF8FF])\uE001/g,(_,c:string)=>hidden[c.charCodeAt(0)-0xE100]);
}
export function resolveNames(text:string,target:ContentLanguage,artists:DisplayArtist[],works:string[]=[]){
 // A work title is not an artist: never rewrite inside it, even when an artist name is a substring (or the whole) of it.
 return shieldWorks(text,works,artists,shielded=>{let out=shielded;const substitutions=artists.flatMap(a=>{const desired=(target==='ko'?a.nameKo:a.nameJa||(!KO.test(a.nameOriginal||'')?a.nameOriginal:null))||(target==='ja'&&a.venue?venueReading(a.name):nameReading(target==='ko'&&a.readingKana?a.readingKana:a.name,target));return desired?[a.name,a.nameOriginal,a.nameKo,a.nameJa].filter((x):x is string=>!!x&&x!==desired).map(source=>({source,desired})):[];}).sort((a,b)=>b.source.length-a.source.length);
 for(const {source,desired}of substitutions){const escaped=source.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const re=/^[A-Za-z0-9 ]+$/.test(source)?new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`,'g'):new RegExp(escaped,'g');out=out.replace(re,()=>desired);const d=desired.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');out=out.replace(new RegExp('('+d+')\\s+\\1','g'),'$1');}return out;});
}
export async function translateContent(text:string,target:ContentLanguage,translatorFor:(source:SourceLanguage)=>Promise<DeviceTranslator|null>,artists:DisplayArtist[]=[],works:string[]=[]):Promise<{text:string;method:'names'|'terms'|'device'|'original'}>{
 works=[...works,...quotedWorks(text)];
 const named=resolveNames(text,target,artists,works),terms=shieldWorks(named,works,artists,x=>localizeTerms(x,target)),source=sourceLanguageFor(terms,target);
 const exactIdentity=artists.find(a=>[a.name,a.nameOriginal,a.nameKo,a.nameJa].includes(text.trim()));
 // Do not translate a Latin official brand or a verified target name again.
 if(exactIdentity)return{text:terms,method:terms!==text?'names':'original'};
 if(!source)return{text:terms,method:terms!==text?'terms':'original'};
 const identities=artists.flatMap(a=>{const targetName=(target==='ko'?a.nameKo:a.nameJa)||nameReading(a.name,target);return [targetName||a.name,...[a.name,a.nameOriginal].filter(x=>x&&/^[\x20-\x7e]+$/.test(x))].filter((x):x is string=>!!x);});
 const protectedText=protectContent(terms,target,[...identities,...works]),translator=await translatorFor(source);if(!translator)return{text:terms,method:terms!==text?'terms':'original'};
 // The model NEVER sees literal placeholders. Reassemble protected values ourselves,
 // so even a model that deletes/duplicates/reorders tokens cannot corrupt prices, dates or brands.
 const parts=protectedText.prepared.split(/(ZXQ\d+QXZ)/g),out:string[]=[];let translated=false;
 for(const part of parts){const marker=part.match(/^ZXQ(\d+)QXZ$/);if(marker){out.push(protectedText.literals[Number(marker[1])]);continue;}
  if(!part||!sourceLanguageFor(part,target)){out.push(part);continue;}const leading=part.match(/^\s*/)?.[0]||'',trailing=part.match(/\s*$/)?.[0]||'';
  const value=await translator.translate(part.trim());if(!value?.trim())return{text:terms,method:terms!==text?'terms':'original'};out.push(leading+value.trim()+trailing);translated=true;
 }
 const result=out.join('');return{text:result,method:translated?'device':result!==text?'terms':'original'};
}
const ROUTES=new Set(['','concerts','concert','news','goods','release','artists','artist','chart','fanclub','guide','track']);
const EXCLUDE='script,style,svg,canvas,textarea,input,code,pre,kbd,time,[contenteditable],.sr-only,.blind,[aria-hidden="true"],[data-content-original],[data-content-original-work],.crow-main>b,.rcard-title,.lc-server-clock,[data-ticket-countdown],[data-until],.ph-text,.ph-cover,.datebox,.assist-local,.assist-tools,#pdpAssist,#pdpCheck details,[data-source-text],[data-source-translation],[data-content-reading-note],.cmt-list,.cmt-form,.qna-list,.mini-list';
const STORE='lilac.public-content.v9';
export function installContentLocalization(options:{locale:()=>ContentLanguage;root:HTMLElement;controls:()=>HTMLElement|null;identities?:()=>DisplayArtist[];fetch?:typeof fetch;factory?:Factory;storage?:Storage|null}){
 const owner=Symbol.for('lilac.content-localization');const controlledRoot=options.root as HTMLElement&{[key:symbol]:{destroy:()=>void}|undefined};controlledRoot[owner]?.destroy();
 const request=options.fetch||fetch,factory=options.factory||(globalThis as unknown as{Translator?:Factory}).Translator;
 const cache=new Map<string,string>(),records=new WeakMap<Text,{source:string;shown:string;locale:string;busy:boolean;revision:number}>(),activeNodes=new Set<Text>();
 const models=new Map<string,Promise<DeviceTranslator|null>>();let artists:DisplayArtist[]=[],locale=options.locale(),revision=0,originalMode=false,dead=false,queued=false,running=0,waiting=0,failed=0,available=false,needsDownload=false;
 const downloadSources=new Set<SourceLanguage>();const works=new Set<string>();let namesUnavailable=false;const rosterIds=new Set<string>();const localIdentities=new Map<string,DisplayArtist>();
 const attributeRecords=new Map<Element,Map<string,{source:string;shown:string;locale:string}>>();let attributesBusy=false,attributeWorkPending=false,preparing=false;
 const queue:Text[]=[],nameFlights=new Set<string>(),nameDone=new Set<string>();let saveTimer:ReturnType<typeof setTimeout>|undefined;
 let storage:Storage|null=null;try{storage=options.storage===undefined?globalThis.localStorage:options.storage;}catch{}
 const misses=new Set<Text>();let hardErrors=0;
 try{const saved=JSON.parse(storage?.getItem(STORE)||'[]');if(Array.isArray(saved))for(const row of saved.slice(-800))if(Array.isArray(row)&&row.length===2&&row.every(x=>typeof x==='string'&&x.length<6000))cache.set(row[0],row[1]);}catch{}
 const routeAllowed=()=>ROUTES.has((location.hash.replace(/^#\/?/,'').split(/[/?]/)[0]||''))&&!document.body.classList.contains('site-mode');
 const eligible=(node:Text)=>{const p=node.parentElement;return !!p&&options.root.contains(p)&&!p.closest(EXCLUDE)&&!!node.data.trim()&&node.data.length<2200&&!p.closest('details:not([open])')&&!p.closest('.talk-body');};
 const key=(s:string)=>{let signature=2166136261;for(const a of artists)if([a.name,a.nameOriginal,a.nameKo,a.nameJa].some(x=>x&&s.includes(x))){const binding=a.id+'|'+(locale==='ko'?a.nameKo:a.nameJa)+'|'+(a.readingKana||'')+'|'+a.name;for(let i=0;i<binding.length;i++)signature=Math.imul(signature^binding.charCodeAt(i),16777619);}for(const w of works)if(s.includes(w))for(let i=0;i<w.length;i++)signature=Math.imul(signature^w.charCodeAt(i),16777619);return CONTENT_LOCALIZATION_VERSION+'|'+locale+'|'+(signature>>>0).toString(36)+'|'+s;};
 function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{while(cache.size>800)cache.delete(cache.keys().next().value!);const rows=[...cache].reverse();const bounded:typeof rows=[];let chars=0;for(const row of rows){chars+=row[0].length+row[1].length;if(chars>350000)break;bounded.push(row);}storage?.setItem(STORE,JSON.stringify(bounded.reverse()));}catch{}},700);}
 const L=(k:string,j:string)=>locale==='ja'?j:k;
 function controls(){
  for(const n of misses)if(!n.isConnected||!eligible(n)||!sourceLanguageFor(n.data,locale)||exactLatinIdentity(n.data))misses.delete(n);
  failed=misses.size+hardErrors;const host=options.controls();if(!host)return;
  const state=!routeAllowed()?'private':originalMode?'original':preparing?'preparing':running||waiting||attributeWorkPending?'translating':needsDownload?'download':!factory?'unsupported':failed?'partial':'ready';
  if(host.dataset.state===state&&host.dataset.locale===locale)return;host.dataset.state=state;host.dataset.locale=locale;host.hidden=state==='private';if(host.hidden)return;
  let label=host.querySelector<HTMLElement>('.content-language-status');if(!label){label=document.createElement('span');label.className='content-language-status';host.append(label);}
  label.textContent=state==='original'?L('수집정보 원문 표시 중','収集情報を原文で表示中'):state==='preparing'?L('기기 내 번역 언어팩 준비 중','端末内の翻訳言語を準備中'):state==='translating'?L('수집정보 자동번역 중','収集情報を自動翻訳中'):state==='unsupported'?L('기기 내 자동번역 미지원 · 원문 표시','端末内自動翻訳は未対応・原文表示'):state==='download'?L('본문 번역 준비 필요','本文翻訳の準備が必要'):state==='partial'?L('일부 번역 미완료 · 원문 확인','一部未翻訳・原文をご確認ください'):L('수집정보 자동번역 · 원문 대조 가능','収集情報を自動翻訳・原文確認可');
  let toggle=host.querySelector<HTMLButtonElement>('.content-original-toggle');if(!toggle){toggle=document.createElement('button');toggle.type='button';toggle.className='content-original-toggle';host.append(toggle);
   toggle.onclick=()=>{originalMode=!originalMode;revision++;options.root.querySelectorAll('[data-content-reading-note]').forEach(n=>n.remove());for(const n of activeNodes){const r=records.get(n);if(r&&n.isConnected){r.shown=r.source;n.data=r.source;r.busy=false;r.locale='';}}for(const [el,attrs]of attributeRecords)for(const [name,r]of attrs)if(el.isConnected){r.shown=r.source;r.locale='';el.setAttribute(name,r.source);}schedule();host.dataset.state='';controls();};
  }
  toggle.textContent=originalMode?L('번역 보기','翻訳を表示'):L('원문 보기','原文を表示');toggle.setAttribute('aria-pressed',String(originalMode));
  let prepare=host.querySelector<HTMLButtonElement>('.content-pack-prepare');if(!prepare){prepare=document.createElement('button');prepare.type='button';prepare.className='content-pack-prepare';host.append(prepare);
   prepare.onclick=()=>{preparing=true;host.dataset.state='';controls();const target=locale;const sources=downloadSources.size?[...downloadSources]:[target==='ko'?'ja':'ko'] as SourceLanguage[];const promises=sources.map(source=>{const p=factory!.create({sourceLanguage:source,targetLanguage:target});models.set(source+'|'+target,p);return p;});Promise.all(promises).then(()=>{preparing=false;downloadSources.clear();needsDownload=false;hardErrors=0;misses.clear();for(const n of activeNodes){const r=records.get(n);if(r)r.locale='';}schedule();host.dataset.state='';controls();}).catch(()=>{preparing=false;hardErrors++;host.dataset.state='';controls();});};
  }
  prepare.hidden=!needsDownload||originalMode;prepare.disabled=preparing;prepare.textContent=preparing?L('준비 중','準備中'):L('번역 언어팩 준비','翻訳言語を準備');
 }
 async function translatorFor(source:SourceLanguage){const mk=source+'|'+locale;if(!factory)return null;if(!models.has(mk)){const target=locale;models.set(mk,(async()=>{try{const a=await factory.availability({sourceLanguage:source,targetLanguage:target});if(a!=='available'){if(a==='downloadable'||a==='downloading'){needsDownload=true;downloadSources.add(source);}return null;}available=true;return await factory.create({sourceLanguage:source,targetLanguage:target});}catch{return null;}})());}return models.get(mk)!;}
 function decorate(node:Text,source:string,translated:string){const p=node.parentElement;if(!p)return;if(source!==translated){p.dataset.contentLocalized='true';p.setAttribute('title',L('번역/읽기 보조 · 원문: ','翻訳・読みの補助／原文: ')+source.trim());const reading=artists.find(a=>locale==='ko'&&!a.nameKo&&!!nameReading(a.readingKana||a.name,'ko')&&[a.name,a.nameOriginal].some(x=>x&&source.includes(x)));
 if(reading){p.dataset.contentNameMethod='phonetic';if(reading.readingSourceUrl)p.dataset.contentReadingSource=reading.readingSourceUrl;p.setAttribute('title',L('음역 · 원문: ','読みの補助・原文: ')+source.trim()+(reading.readingSourceUrl?' · '+reading.readingSourceUrl:''));if(source.trim()===reading.name&&p.tagName!=='OPTION'&&!p.querySelector('[data-content-reading-note]')){const note=document.createElement('small');note.dataset.contentReadingNote='true';note.className='content-name-reading-mark';note.textContent=L('음역','読み');p.append(note);}}
 else{delete p.dataset.contentNameMethod;delete p.dataset.contentReadingSource;p.querySelectorAll('[data-content-reading-note]').forEach(n=>n.remove());}}else if(p.dataset.contentLocalized){delete p.dataset.contentLocalized;p.removeAttribute('title');}}
 async function consume(node:Text){const rec=records.get(node);if(!rec)return;misses.delete(node);const version=revision,source=rec.source,target=locale;rec.busy=true;running++;controls();try{const cached=cache.get(key(source));const value=cached?{text:cached,method:'device'}:await translateContent(source,target,translatorFor,artists,[...works]);if(dead||version!==revision||!eligible(node)||!node.isConnected||node.data!==rec.shown)return;if(value.method!=='original'){rec.shown=value.text;rec.locale=locale;node.data=value.text;decorate(node,source,value.text);cache.set(key(source),value.text);save();}else rec.locale=locale;if(value.method==='original'&&sourceLanguageFor(source,target)&&!exactLatinIdentity(source))misses.add(node);}catch{if(version===revision)misses.add(node);}finally{rec.busy=false;running--;controls();pump();if(version!==revision)schedule();}}
 function exactLatinIdentity(text:string){return artists.some(a=>[a.name,a.nameOriginal].some(n=>n?.trim()===text.trim()&&/^[\x20-\x7e]+$/.test(n)));}
 function pump(){if(dead||originalMode)return;while(running<2&&queue.length){const node=queue.shift()!;waiting=queue.length;if(node.isConnected&&eligible(node))void consume(node);}controls();}
 function scan(){queued=false;if(dead)return;const next=options.locale();if(next!==locale){locale=next;revision++;originalMode=false;misses.clear();hardErrors=0;failed=0;needsDownload=false;for(const node of activeNodes){const r=records.get(node);if(r&&node.isConnected){r.shown=r.source;node.data=r.source;r.busy=false;r.locale='';}}}
 if(!routeAllowed()){controls();return;}
 for(const a of options.identities?.()||[])if(a.name&&!/^(?:공식\s*팬클럽|公式ファンクラブ|OFFICIAL\s*FAN\s*CLUB)$/i.test(a.name)&&!artists.some(x=>[x.name,x.nameOriginal].includes(a.name)))localIdentities.set(a.name,a);
 works.clear();for(const el of Array.from(options.root.querySelectorAll<HTMLElement>(WORK_SELECTOR)))for(const w of workTitles(el.textContent||''))works.add(w);
 const publicNames='.h-fc-name,.fct-name,.detail-fanclub .pdp-title,[data-public-name],a[href^="#/artist/name/"]';
 for(const el of Array.from(options.root.querySelectorAll<HTMLElement>(publicNames))){if(el.closest(WORK_SELECTOR))continue;let name='';const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n:Node|null;while((n=walk.nextNode()))if(!(n as Text).parentElement?.closest('[data-content-reading-note]'))name+=(records.get(n as Text)?.source||(n as Text).data);name=name.trim();if(works.has(name))continue;if(name&&name.length<180&&!/^(?:공식\s*팬클럽|公式ファンクラブ|OFFICIAL\s*FAN\s*CLUB)$/i.test(name)&&!artists.some(a=>[a.name,a.nameOriginal].includes(name)))localIdentities.set(name,{id:'public:'+name,name});}
 for(const a of localIdentities.values())if(!artists.some(x=>x.name===a.name))artists.push(a);
 for(const n of activeNodes)if(!n.isConnected)activeNodes.delete(n);
 const walker=document.createTreeWalker(options.root,NodeFilter.SHOW_TEXT);let raw:Node|null;while((raw=walker.nextNode())){const n=raw as Text;if(!eligible(n))continue;let r=records.get(n);if(!r||n.data!==r.shown){r={source:n.data,shown:n.data,locale:'',busy:false,revision};records.set(n,r);activeNodes.add(n);}if(originalMode){if(n.data!==r.source){r.shown=r.source;n.data=r.source;}continue;}if(r.busy||r.locale===locale||queue.includes(n)||exactLatinIdentity(r.source))continue;const named=resolveNames(r.source,locale,artists,[...works]);if(!sourceLanguageFor(named,locale)&&shieldWorks(named,[...works],artists,x=>localizeTerms(x,locale))===r.source)continue;queue.push(n);}
 waiting=queue.length;pump();controls();void hydrateNames();void translateAttributes();}
 function schedule(){if(queued||dead)return;queued=true;queueMicrotask(scan);}
 function onNavigation(){revision++;misses.clear();hardErrors=0;queue.length=0;waiting=0;schedule();}
 async function translateAttributes(){
  if(attributesBusy||dead||originalMode||!routeAllowed())return;attributesBusy=true;const version=revision,target=locale;controls();
  try{for(const el of Array.from(options.root.querySelectorAll<HTMLElement>('img[alt],[aria-label]'))){
   if(dead||version!==revision||originalMode)return;if(el.closest(EXCLUDE)||el.closest('.talk-body')||el.matches(LABEL_SELECTOR))continue;
   let recordsFor=attributeRecords.get(el);if(!recordsFor){recordsFor=new Map();attributeRecords.set(el,recordsFor);}
   for(const attr of ['alt','aria-label']){const raw=el.getAttribute(attr);if(!raw?.trim()||raw.length>1500)continue;let r=recordsFor.get(attr);if(!r||raw!==r.shown){r={source:raw,shown:raw,locale:''};recordsFor.set(attr,r);}if(r.locale===target||exactLatinIdentity(r.source))continue;
    const named=resolveNames(r.source,target,artists,[...works]);if(!sourceLanguageFor(named,target)&&shieldWorks(named,[...works],artists,x=>localizeTerms(x,target))===r.source)continue;
    attributeWorkPending=true;controls();const cached=cache.get(key(r.source));const value=cached?{text:cached}:await translateContent(r.source,target,translatorFor,artists,[...works]);
    if(dead||version!==revision||!el.isConnected||el.getAttribute(attr)!==r.shown)return;r.shown=value.text;r.locale=target;el.setAttribute(attr,value.text);if(value.text!==r.source){cache.set(key(r.source),value.text);save();}
   }
  }}catch{hardErrors++;}finally{attributesBusy=false;attributeWorkPending=false;for(const el of attributeRecords.keys())if(!el.isConnected)attributeRecords.delete(el);controls();if(version!==revision)schedule();}
 }
 async function hydrateNames(){if(namesUnavailable||!artists.length||dead||!routeAllowed())return;const publicText=options.root.textContent||'';const ids=artists.filter(a=>rosterIds.has(a.id)&&!(locale==='ko'?a.nameKo:a.nameJa)&&[a.name,a.nameOriginal].some(s=>s&&publicText.includes(s))).map(a=>a.id).filter(id=>!nameDone.has(locale+'|'+id)&&!nameFlights.has(locale+'|'+id)).slice(0,20);if(!ids.length)return;const target=locale;for(const id of ids)nameFlights.add(target+'|'+id);
 try{const response=await request('/api/live/display-names?locale='+target+'&ids='+ids.map(encodeURIComponent).join(','),{credentials:'same-origin'});if(!response.ok){namesUnavailable=true;return;}const body=await response.json();let upgraded=false;for(const row of body.items||[]){const a=artists.find(a=>a.id===row.id);if(a&&target==='ko'&&row.readingMethod==='ja-wikipedia-lead'&&typeof row.readingKana==='string'&&/^[ぁ-ゖァ-ヶー・\s]+$/.test(row.readingKana)&&typeof row.readingSourceUrl==='string'&&row.readingSourceUrl.startsWith('https://ja.wikipedia.org/wiki/')){upgraded ||= a.readingKana!==row.readingKana;a.readingKana=row.readingKana;a.readingSourceUrl=row.readingSourceUrl;}if(a&&typeof row.name==='string'&&row.locale===target&&['roster','wikipedia-langlink'].includes(row.method)){if(target==='ko'){upgraded ||= a.nameKo!==row.name;a.nameKo=row.name;}else{upgraded ||= a.nameJa!==row.name;a.nameJa=row.name;}nameDone.add(target+'|'+a.id);}}for(const id of ids)if(!body.pending)nameDone.add(target+'|'+id);
 if(upgraded){revision++;for(const attrs of attributeRecords.values())for(const r of attrs.values())r.locale='';for(const n of activeNodes){const r=records.get(n);if(r){cache.delete(key(r.source));r.locale='';}}schedule();}if(body.pending)setTimeout(schedule,5000);
 }catch{}finally{for(const id of ids)nameFlights.delete(target+'|'+id);}}
 void request('/api/live/artists?edition=all',{credentials:'same-origin'}).then(r=>r.ok?r.json():{items:[]}).then(r=>{artists=(r.items||[]).filter((a:DisplayArtist)=>typeof a.id==='string'&&typeof a.name==='string');revision++;for(const attrs of attributeRecords.values())for(const r of attrs.values())r.locale='';for(const a of artists)rosterIds.add(a.id);for(const a of localIdentities.values())if(!artists.some(x=>x.name===a.name))artists.push(a);for(const n of activeNodes){const x=records.get(n);if(x&&!x.busy){cache.delete(key(x.source));x.locale='';}}schedule();}).catch(()=>{});
 const observer=new MutationObserver(schedule);observer.observe(options.root,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['open','alt','aria-label']});const langObserver=new MutationObserver(schedule);langObserver.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});window.addEventListener('hashchange',onNavigation);document.addEventListener('visibilitychange',schedule);schedule();
 const controller={refresh:schedule,destroy(){if(dead)return;dead=true;revision++;observer.disconnect();langObserver.disconnect();window.removeEventListener('hashchange',onNavigation);document.removeEventListener('visibilitychange',schedule);clearTimeout(saveTimer);for(const p of models.values())void p.then(t=>t?.destroy());},status:()=>({waiting,running,failed,available,needsDownload,locale})};controlledRoot[owner]=controller;return controller;
}
