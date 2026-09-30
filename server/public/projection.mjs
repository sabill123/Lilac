// Explicit public DTO boundary. Unknown/nested fields are never copied implicitly.
// Metadata accepts only its declared scalar type; never coerce containers.
const timestamp = v => typeof v === 'string' && v ? v : null;
export const sourceTimestamp = v => timestamp(v?.updated) || timestamp(v?.builtAt) || timestamp(v?.collectedAt);
const scalar = v => v === null || ['string','number','boolean'].includes(typeof v);
export const pick = (v, fields) => Object.fromEntries(fields.split(' ').filter(k => scalar(v?.[k])).map(k => [k,v[k]]));
const strings = v => Array.isArray(v) ? v.filter(x=>typeof x==='string') : [];
const list = (v,fn) => Array.isArray(v) ? v.map(fn) : [];
const map = (v,fn) => Object.fromEntries(Object.entries(v||{}).filter(([k])=>!['__proto__','constructor','prototype'].includes(k)).map(([k,x])=>[k,fn(x)]));
export const track = x => ({...pick(x,'id title artist artistId album albumId releaseDate artwork preview appleUrl durationMs genre disc no searchTerm tag youtubeId'),stores:strings(x?.stores)});
const edition = x=>({...pick(x,'id label labelJa catalogNo listPrice feeKind bonusVideo amount real digital note exclusiveTo'),includes:strings(x.includes),goods:strings(x.goods),pricing:pick(x.pricing,'localAmount localCurrency rate base feeRate fee shipping total buyerCurrency')});
const source = x=>pick(x,'name url collectedAt auto');
const link = x=>pick(x,'url source');
export function project(name,v) {
 switch(name) {
 case 'artists':return list(v,x=>({...pick(x,'id name nameOriginal nameJa country genre appleGenre searchTerm appleArtistId artwork official operator chartHits bestRank mbid linksSource linksCheckedAt debutDate debutYear debutSource'),aliases:strings(x.aliases),links:map(Object.fromEntries(['official','youtube','x','instagram','facebook','tiktok','weverse','tower','hmv','amazonJp','shop','appleMusic','spotify','fanpage'].filter(k=>x.links?.[k]).map(k=>[k,x.links[k]])),link)}));
 case 'tracks':return list(v,track);
 case 'events':return list(v,x=>pick(x,'id type title artist artistId country date venue artwork appleUrl trackCount isDemo source url endDate'));
 case 'products':return list(v,x=>({...pick(x,'id name brand artistId origin originLabel routeLabel genre size sizeLabel badge price priceCurrency rate rateDate releaseDate trackCount artwork appleUrl digitalLocal operator officialUrl shopUrl shopLabel searchTerm desc'),rateLive:false,editions:list(x.editions,edition)}));
 case 'releases':return list(v,x=>({...pick(x,'id tier artistId artist artistKo title titleKo country type releaseDate currency artwork artworkStatus appleUrl appleReleaseDate trackCount albumArtist note'),source:source(x.source),campaign:x.campaign?{...pick(x.campaign,'name kind desc storeOpensAt storeClosesAt onlineOpensAt'),eligibleEditions:strings(x.campaign.eligibleEditions)}:null,editions:list(x.editions,edition),offers:list(x.offers,o=>({...pick(o,'id store storeKo country url bonus bonusJa greenCode shipsToKorea verified note'),editions:strings(o.editions)})),searchHints:list(x.searchHints,h=>pick(h,'store storeKo searchUrl'))}));
 case 'fx':return {...pick(v,'date source jpyKrw krwJpy collectedAt'),live:false};
 case 'aliases':return {artists:map(v.artists,x=>typeof x==='string'?x:''),tracks:map(v.tracks,x=>typeof x==='string'?x:'')};
 case 'search-index':return {builtAt:timestamp(v.builtAt),entries:list(v.entries,x=>({...pick(x,'ja type artist'),readings:strings(x.readings),keys:strings(x.keys)}))};
 case 'catalog':return {builtAt:timestamp(v.builtAt),artists:map(v.artists,x=>({...pick(x,'name appleArtistId fetchedAt capped partial count'),tracks:list(x.tracks,track)}))};
 case 'charts':return {updated:timestamp(v.updated),limit:Number.isFinite(v.limit)?v.limit:undefined,countries:Object.fromEntries(['jp','kr'].filter(k=>v.countries?.[k]).map(k=>{const c=v.countries[k]; const names=['apple','appleRss','youtube','billboard','oricon','melon','genie','combined'];return [k,{label:typeof c.label==='string'?c.label:undefined,weights:pick(c.weights,names.join(' ')),sourceLabels:pick(c.sourceLabels,names.join(' ')),...Object.fromEntries(names.filter(n=>Array.isArray(c[n])).map(n=>[n,c[n].map(x=>({...pick(x,'rank title artist artwork appleUrl youtubeId ytViews score move lastRank'),ranks:pick(x.ranks,names.join(' ')),sources:strings(x.sources)}))]))}]}))};
 default:throw new Error('Unapproved public collection');
 }
}
