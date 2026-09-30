import { PLANS } from '../../backend/lib/pricing.mjs';
import { phoneticKey, expandQuery } from '../../backend/lib/ko-ja.mjs';
const error=(status,message,code='READ_ONLY_PREVIEW')=>Object.assign(new Error(message),{status,code});
const norm=x=>String(x||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const num=(v,d,max)=>Math.max(0,Math.min(max,Number.isFinite(Number(v))&&v!==null?Math.floor(Number(v)):d));
const LIMIT_BODY=16384;
const LIMIT_UPSTREAM=1024*1024;
// Only fixed service origins and the endpoint paths used below may be fetched.
export function isAllowedUpstreamURL(value){
 try {
  const url=new URL(value);
  if(url.username||url.password||url.hash)return false;
  return (url.origin==='https://itunes.apple.com'&&['/search','/lookup'].includes(url.pathname))||
   (url.origin==='https://api.frankfurter.dev'&&/^\/v1\/\d{4}-\d{2}-\d{2}\.\.$/.test(url.pathname));
 }catch{return false}
}
async function upstreamJSON(response){
 if(Number(response.headers?.get?.('content-length'))>LIMIT_UPSTREAM){await response.body?.cancel?.();return null}
 if(response.body?.getReader){
  const reader=response.body.getReader(),chunks=[];let size=0,done=false;
  try {
   while(true){const part=await reader.read();if(part.done){done=true;break}size+=part.value.byteLength;if(size>LIMIT_UPSTREAM)return null;chunks.push(Buffer.from(part.value));}
   return JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
  }finally{if(!done)await reader.cancel().catch(()=>{});reader.releaseLock();}
 }
 // Lightweight injected test clients may expose only json(); real fetch uses the bounded stream above.
 const value=await response.json();return Buffer.byteLength(JSON.stringify(value))<=LIMIT_UPSTREAM?value:null;
}
export function createPublicHandler({data,manifest={},fetchImpl=globalThis.fetch,now=()=>Date.now()}) {
 const artists=data.artists||[],catalog=data.catalog?.artists||{},aliases={...data.aliases?.artists,...data.aliases?.tracks};
 const tracks=Object.entries(catalog).flatMap(([artistId,a])=>(a.tracks||[]).map(t=>({...t,artist:a.name,artistId})));
 const readings=Object.create(null);
 for(const e of data['search-index']?.entries||[]) for(const k of e.keys||[]) if(k.length>=2)(readings[k]||=[]).push(e.ja);
 for(const [k,v] of Object.entries(aliases)) (readings[phoneticKey(k)]||=[]).push(v);
 function queries(q){return [...new Set([...(readings[phoneticKey(q)]||[]),...expandQuery(q,aliases),q])].slice(0,3)}
 function match(t,qs){const value=norm(t);return qs.some(q=>value.includes(norm(q)))}
 function local(qs,country){return tracks.filter(t=>(!t.stores?.length||t.stores.includes(country))&& (qs.some(s=>String(t.id)===s)||match(t.title,qs)||match(t.artist,qs)||match(`${t.artist} ${t.title}`,qs)));}
 async function upstream(url,deadline){if(now()>deadline||!isAllowedUpstreamURL(url)) return null;try {const r=await fetchImpl(url,{signal:AbortSignal.timeout(Math.max(1,Math.min(2200,deadline-now()))),redirect:'error',headers:{accept:'application/json'}});return r.ok&&!r.redirected?await upstreamJSON(r):null}catch{return null}}
 const fromApple=t=>({id:t.trackId,title:t.trackName,artist:t.artistName,album:t.collectionName,albumId:t.collectionId,artwork:(t.artworkUrl100||'').replace('100x100','400x400'),preview:t.previewUrl||null,appleUrl:t.trackViewUrl,genre:t.primaryGenreName,durationMs:t.trackTimeMillis||0,releaseDate:t.releaseDate});
 async function songs(q,country,limit,deadline,qs=queries(q)){const saved=local(qs,country);if(saved.length)return saved.slice(0,limit);const found=[];for(const cand of qs){const u=new URL(/^\d+$/.test(cand)?'https://itunes.apple.com/lookup':'https://itunes.apple.com/search');u.search=new URLSearchParams({country,media:'music',entity:'song',limit:String(limit),[/^\d+$/.test(cand)?'id':'term']:cand});const r=await upstream(u,deadline);for(const t of r?.results||[])if(t.trackId&&t.trackName&&(!/^\d+$/.test(cand)||String(t.trackId)===cand))found.push(fromApple(t));if(found.length||now()>deadline)break}return [...new Map(found.map(t=>[t.id,t])).values()].slice(0,limit)}
 async function batchHit(q,country,deadline){
  const candidates=await songs(q,country,8,deadline);const exact=candidates.find(t=>String(t.id)===q||norm(`${t.artist} ${t.title}`)===norm(q)||norm(t.title)===norm(q));
  // Never turn an exact Apple song identity into a different search hit.
  if(/^\d+$/.test(q))return exact||null;
  return exact||candidates[0]||null;
 }
 return async function handler(req,res){
  const send=(status,value)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');res.setHeader('Cache-Control','private, no-store');res.end(JSON.stringify(value));};
  try {
   const raw=req.url||'/'; let decoded;try{decoded=decodeURIComponent(raw.split('?')[0])}catch{throw error(403,'Invalid path')}
   if(/(?:^|\/)\.\.?($|\/)|\\|\0|%|\/\//.test(decoded))throw error(403,'Path not allowed');
   const url=new URL(raw,'http://preview.local'),p=url.pathname,s=url.searchParams;
   const exact=new Set(['/api/health','/api/me','/api/charts','/api/catalog/search','/api/catalog/albums','/api/search','/api/readings','/api/index/status','/api/store/releases','/api/focus/mixes','/api/plans','/api/fx/series','/api/status']);
   const allowed=exact.has(p)||/^\/api\/db\/(artists|tracks|events|products)$/.test(p)||/^\/api\/artist\/[^/]+\/(tracks|stats|fandom)$/.test(p)||/^\/api\/store\/releases\/[^/]+$/.test(p)||p==='/api/catalog/batch';
   if(!allowed)throw error(403,'Endpoint unavailable in read-only preview');
   if(req.method!=='GET'&&!(req.method==='POST'&&p==='/api/catalog/batch'))throw error(405,'Method not allowed');
   if(p==='/api/catalog/batch'&&req.method!=='POST')throw error(405,'Use POST for read-only batch lookup');
   const country=s.get('country')||'jp';if(!['jp','kr'].includes(country))throw error(400,'Unsupported country','INVALID_INPUT');
   const limit=num(s.get('limit'),25,500)||1,offset=num(s.get('offset'),0,100000),deadline=now()+7500;
   const term=(key='term')=>{const v=s.get(key)?.trim();if(!v||v.length>160)throw error(400,'Search term must contain 1–160 characters','INVALID_INPUT');return v};
   let result;
   if(p==='/api/health')result={ok:true,service:'lilac-public-preview',readOnly:true,sha256:manifest.sha256};
   else if(p==='/api/me')result={user:null};
   else if(p.startsWith('/api/db/')){const rows=data[p.split('/').at(-1)]||[];result=s.has('limit')?{items:rows.slice(offset,offset+limit),total:rows.length,limit,offset,hasMore:offset+limit<rows.length}:rows;}
   else if(p==='/api/charts'){const c=data.charts?.countries?.[country];const source=s.get('source')||'combined';if(!c||!Array.isArray(c[source]))throw error(404,'Chart source unavailable','NOT_FOUND');const counts=Object.fromEntries(Object.entries(c).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length]));result={country,countryLabel:c.label,source,updated:data.charts.updated,live:false,limit:Math.min(s.has('limit')?limit:100,300),total:c[source].length,counts,sources:Object.keys(counts).filter(k=>k!=='combined'),sourceLabels:c.sourceLabels,weights:c.weights,method:source==='combined'?'Lilac weighted snapshot, not an official chart.':'Collected source snapshot; not live.',list:c[source].slice(0,Math.min(s.has('limit')?limit:100,300))};}
   else if(p==='/api/readings')result=readings;
   else if(p==='/api/index/status'){const builtAt=data['search-index']?.builtAt||null;result={count:data['search-index']?.entries?.length||0,builtAt,ageHours:builtAt?(now()-Date.parse(builtAt))/36e5:null,maxAgeHours:24};}
   else if(p==='/api/catalog/batch'){
    if(Number(req.headers?.['content-length'])>LIMIT_BODY)throw error(413,'Batch body too large');
    let body=req.body;if(body===undefined){let buf='';for await(const chunk of req){buf+=chunk;if(Buffer.byteLength(buf)>LIMIT_BODY)throw error(413,'Batch body too large')}body=buf;}
    if(Buffer.byteLength(typeof body==='string'?body:JSON.stringify(body))>LIMIT_BODY)throw error(413,'Batch body too large');
    if(typeof body==='string')try{body=JSON.parse(body)}catch{throw error(400,'Invalid JSON','INVALID_INPUT')}
    if(!body||Object.keys(body).some(k=>k!=='terms')||!Array.isArray(body.terms)||body.terms.length>40||body.terms.some(t=>typeof t!=='string'||!t.trim()||t.length>160))throw error(400,'Expected up to 40 search terms','INVALID_INPUT');
    const pending=[...new Set(body.terms)],results=Object.create(null);let cursor=0;
    await Promise.all(Array.from({length:Math.min(3,pending.length)},async()=>{while(cursor<pending.length){const q=pending[cursor++];results[q]=await batchHit(q,country,deadline)}}));result={results};
   }
   else if(p==='/api/catalog/search'||p==='/api/catalog/albums'){
    const q=term(),qs=queries(q),entity=p.endsWith('albums')?'album':s.get('entity')||'song';if(!['song','album','artist'].includes(entity))throw error(400,'Unsupported entity','INVALID_INPUT');
    result={term:q,country,tracks:[],albums:[],artists:[]};
    if(entity==='song')result.tracks=await songs(q,country,Math.min(limit,25),deadline,qs);
    else if(entity==='artist')result.artists=artists.filter(a=>match(`${a.name} ${a.searchTerm} ${a.aliases?.join(' ')}`,qs)).slice(0,limit).map(a=>({id:a.appleArtistId,name:a.name,genre:a.genre,appleUrl:a.official}));
    else {const ts=local(qs,country);result.albums=[...new Map(ts.map(t=>[t.albumId,{id:t.albumId,title:t.album,artist:t.artist,artwork:t.artwork,year:t.releaseDate?.slice(0,4),appleUrl:t.appleUrl}])).values()].slice(0,limit);if(!result.albums.length){const r=await upstream(`https://itunes.apple.com/search?media=music&entity=album&country=${country}&limit=12&term=${encodeURIComponent(qs[0])}`,deadline);result.albums=(r?.results||[]).filter(a=>a.collectionId).map(a=>({id:a.collectionId,title:a.collectionName,artist:a.artistName,artwork:a.artworkUrl100,year:a.releaseDate?.slice(0,4),trackCount:a.trackCount,appleUrl:a.collectionViewUrl}));}}
   }
   else if(p==='/api/search'){const q=term('q'),qs=queries(q);result={q,queries:qs,translated:qs[0]===q?null:qs[0],tracks:await songs(q,country,15,deadline,qs),artists:artists.filter(a=>match(`${a.name} ${a.searchTerm} ${a.aliases?.join(' ')}`,qs)),products:(data.products||[]).filter(a=>match(`${a.name} ${a.brand}`,qs)).slice(0,12),events:(data.events||[]).filter(a=>match(`${a.title} ${a.artist}`,qs)).slice(0,8),seedTracks:(data.tracks||[]).filter(a=>match(`${a.title} ${a.artist}`,qs)).slice(0,8)};result.counts=Object.fromEntries(['tracks','artists','products','events'].map(k=>[k,result[k].length]));}
   else if(p.startsWith('/api/artist/')){const [, , ,encoded,kind]=p.split('/'),id=decodeURIComponent(encoded),a=artists.find(a=>a.id===id),entry=catalog[id];if(!a)throw error(404,'Artist unavailable','NOT_FOUND');if(kind==='stats')result={totalViews:null,trackCount:entry?.tracks?.length||0,live:false,available:false,source:'YouTube statistics unavailable in protected preview'};else if(kind==='fandom')result={links:a.links||{},linksSource:a.linksSource||null,basis:['Public channel snapshot only'],platform:null,mechanics:[]};else {if(!entry)throw error(404,'Artist catalog unavailable','NOT_FOUND');const qs=s.has('q')?queries(term('q')):null;const ts=(entry.tracks||[]).map(t=>({...t,artist:a.name})).filter(t=>!qs||match(`${t.title} ${t.album}`,qs));result={artistId:id,count:ts.length,capped:!!entry.capped,partial:!!entry.partial,fetchedAt:entry.fetchedAt,source:'Apple Music catalog snapshot',popular:[],albums:[...new Map(ts.map(t=>[t.albumId,{id:t.albumId,title:t.album,artwork:t.artwork,releaseDate:t.releaseDate}])).values()],tracks:ts.slice(0,s.has('limit')?limit:500)};}}
   else if(p.startsWith('/api/store/releases')){let rows=data.releases||[];if(p==='/api/store/releases'){for(const k of ['tier','country','artistId'])if(s.has(k))rows=rows.filter(r=>(r[k]||(k==='tier'?'curated':null))===s.get(k));result={total:rows.length,offset,limit,hasMore:offset+limit<rows.length,releases:rows.slice(offset,offset+limit).map(r=>({...r,tier:r.tier||'curated',editionCount:r.editions.length,offerCount:r.offers.length,hasCampaign:!!r.campaign}))};}else {const r=rows.find(r=>r.id===decodeURIComponent(p.split('/').at(-1)));if(!r)throw error(404,'Release unavailable','NOT_FOUND');result={release:r,comparison:{rate:data.fx?.jpyKrw||null,buyerCountry:s.get('buyer')==='jp'?'jp':'kr',planTier:'free',rows:[],byEdition:[],priceFixed:false,decisiveFactors:['판매처 비교·견적은 읽기 전용 미리보기에서 제공하지 않습니다.'],fx:{date:data.fx?.date,source:data.fx?.source},available:false}};}}
   else if(p==='/api/plans')result={plans:Object.values(PLANS),purchasable:false};
   else if(p==='/api/focus/mixes')result={mixes:[],aiConfigured:false,model:null,available:false};
   else if(p==='/api/fx/series'){const days=Math.max(14,num(s.get('days'),90,365)),start=new Date(now()-days*864e5).toISOString().slice(0,10),r=await upstream(`https://api.frankfurter.dev/v1/${start}..?from=JPY&to=KRW`,deadline);let points=Object.entries(r?.rates||{}).sort().map(([date,v])=>({date,jpyKrw:v.KRW})).filter(v=>Number.isFinite(v.jpyKrw));const live=!!points.length;if(!live&&data.fx?.jpyKrw)points=[{date:data.fx.date,jpyKrw:data.fx.jpyKrw}];result={source:live?'frankfurter.dev':data.fx?.source||'unavailable',live,base:'JPY',quote:'KRW',days,points,min:points.length?Math.min(...points.map(p=>p.jpyKrw)):null,max:points.length?Math.max(...points.map(p=>p.jpyKrw)):null,latest:points.at(-1)||null};}
   else if(p==='/api/status')result={healthy:false,now:new Date(now()).toISOString(),uptimeSec:Math.floor(process.uptime()),readOnly:true,services:[{name:'Protected snapshot preview',kind:'스냅샷',ok:true,ageHours:data.charts?.updated?(now()-Date.parse(data.charts.updated))/36e5:null,detail:'No collectors, accounts, orders, AI or synchronization. Chart timestamp is source time.'}],sha256:manifest.sha256};
   send(200,result);
  }catch(e){send(e.status||500,{error:e.status?e.message:'Public preview unavailable',code:e.code||'PUBLIC_API_ERROR'});}
 };
}
