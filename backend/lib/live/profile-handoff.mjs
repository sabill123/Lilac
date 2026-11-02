import {readPublicHtml} from './assistance.mjs';
import {unescapeHtml} from './http.mjs';
const compact=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
/** Only an observed meta-refresh from a server-owned official site to an
 * artist-specific PROFILE page. Never follows generic cross-site homepages. */
export async function officialProfileHandoff(officialUrl,names,{read=readPublicHtml}={}){
 const page=await read(officialUrl,{timeoutMs:4000,maxBytes:256*1024});
 const matches=[];
 for(const tag of String(page.html||'').match(/<meta\b[^>]{0,4000}>/gi)||[]){
  const attrs=Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1].toLowerCase(),unescapeHtml(m[2]??m[3]??'')]));
  if(!/^refresh$/i.test(attrs['http-equiv']||''))continue;
  const target=(attrs.content||'').match(/^\s*\d+(?:\.\d+)?\s*;\s*url\s*=\s*["']?([^"']+)["']?\s*$/i)?.[1];if(!target)continue;
  try{
   const u=new URL(target.trim(),page.url||officialUrl);if(u.protocol!=='https:'||u.username||u.password||u.port||u.href.length>2048)continue;
   const parts=decodeURIComponent(u.pathname).split('/').filter(Boolean),tokens=parts.map(compact);
   if(!tokens.some(t=>['profile','biography','introduce'].includes(t))||!tokens.some(t=>['artist','artists'].includes(t)))continue;
   if(!names.some(n=>compact(n).length>=3&&tokens.includes(compact(n))))continue;
   if([...u.searchParams].some(([k,v])=>!['lang','locale'].includes(k)||!/^[a-z_-]{2,16}$/i.test(v)))continue;
   u.hash='';matches.push(u.href);
  }catch{/* Unknown/encoded/credentialed handoffs remain unavailable. */}
 }
 const urls=[...new Set(matches)];return urls.length===1?{url:urls[0],sourceUrl:page.url||officialUrl,method:'observed-official-meta-refresh'}:null;
}
