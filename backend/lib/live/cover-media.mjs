import {withReleaseImages} from '../release-images.mjs';
const image=s=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port?u.href:null}catch{return null}};
const wanted=edition=>edition==='kr'?'jp':edition==='jp'?'kr':null;
export function artistIdentityIndex(artists){
 const map=new Map();
 for(const a of artists||[])for(const id of [a.id,...(a.mergedIds||[])]){if(!id)continue;const prior=map.get(id);map.set(id,map.has(id)&&prior?.id!==a.id?null:a);}
 return map;
}
export function editionReleaseRows({artists,releases,catalog,edition}){
 const own=artistIdentityIndex(artists),origin=wanted(edition);
 return (releases||[]).flatMap(r=>{
  const a=own.get(r.artistId);if(!a||!['jp','kr'].includes(a.origin)||(origin&&a.origin!==origin))return [];
  const row=withReleaseImages(r,{catalog});
  return [{...row,artistId:a.id,sourceArtistId:r.artistId,country:r.country||a.origin,artistOrigin:a.origin}];
 });
}
export function buildCoverMedia({artists,releases=[],catalog,concerts=[],edition='kr'}){
 const index=artistIdentityIndex(artists),origin=wanted(edition);
 const selected=(artists||[]).filter(a=>['jp','kr'].includes(a.origin)&&(!origin||a.origin===origin));
 const own=new Map(selected.map(a=>[a.id,a]));
 const rows=editionReleaseRows({artists,releases,catalog,edition});
 const covers=rows.filter(r=>image(r.artwork)).map(r=>({id:r.id,tier:r.tier,artistId:r.artistId,artist:r.artist,title:r.title,country:r.country,artistOrigin:r.artistOrigin,type:r.type,releaseDate:r.releaseDate||'',artwork:r.artwork,artworkKind:'album-cover',artworkSource:r.artworkSource||r.source||null,appleUrl:r.appleUrl||null}));
 // Catalog covers remain album covers, never fabricated product editions/releases.
 for(const [sourceId,entry] of Object.entries(catalog?.artists||{})){
  const a=index.get(sourceId);if(!a||!own.has(a.id)||(a.appleArtistId&&entry.appleArtistId&&String(a.appleArtistId)!==String(entry.appleArtistId)))continue;
  if(covers.some(r=>r.artistId===a.id))continue;
  const albums=new Map();
  for(const t of entry.tracks||[]){
   if(!t.albumId||!t.album||!image(t.artwork))continue;
   const key=String(t.albumId),had=albums.get(key);
   if(had&&had.title!==t.album){had.conflict=true;continue;}
   if(!had)albums.set(key,{albumId:t.albumId,title:t.album,image:image(t.artwork),url:t.appleUrl||null,sort:String(t.releaseDate||''),conflict:false});
   else if(String(t.releaseDate||'')>had.sort)had.sort=String(t.releaseDate||'');
  }
  const album=[...albums.values()].filter(x=>!x.conflict).sort((a,b)=>b.sort.localeCompare(a.sort))[0];if(!album)continue;
  covers.push({id:'catalog-album:'+a.id+':'+album.albumId,tier:'catalog',artistId:a.id,artist:a.name,title:album.title,country:a.origin,type:'album',releaseDate:'',artwork:album.image,artworkKind:'album-cover',appleUrl:album.url,artworkSource:{type:'catalog-album',artistId:a.id,sourceArtistId:sourceId,albumId:album.albumId,sourceUrl:album.url,collectedAt:entry.fetchedAt||catalog.builtAt||null}});
 }
 const shows=concerts.flatMap(c=>{const a=index.get(c.artistId);return a&&own.has(a.id)&&!c.unconfirmed?[{...c,artistId:a.id,sourceArtistId:c.artistId,origin:a.origin}]:[]});
 return {coverArtists:selected,coverReleases:covers,coverConcerts:shows};
}
