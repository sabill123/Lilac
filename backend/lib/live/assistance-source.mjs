/** Choose only URLs already collected for this membership. Never expand a short URL here. */
export function fanclubAssistanceSource(fc){
 if(!fc?.found)return null;
 const fallback=fc.entry||fc.facts?.url||fc.home||null;
 try{const entry=new URL(fc.entry),facts=new URL(fc.facts?.url);
   if(entry.protocol==='https:'&&entry.hostname==='go.weverse.io'&&facts.protocol==='https:'&&facts.hostname==='shop.weverse.io'&&!facts.username&&!facts.password&&!facts.port){
    const hit=facts.pathname.match(/^\/(?:[a-z]{2}\/)?shop\/[A-Z]{3}\/artists\/(\d+)\/sales\/\d+\/?$/);
    if(hit&&(!fc.facts.shopArtistId||String(fc.facts.shopArtistId)===hit[1]))return facts.href;
   }
 }catch{}
 return fallback;
}
export function offerHasSource(offer,url){return typeof url==='string'&&[offer?.url,...Object.values(offer?.editionUrls||{})].some(v=>typeof v==='string'&&v===url);}
