/** Read-time enrichment only. An album cover is never called an edition/product photo. */
const norm = s => String(s || '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const image = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && !/\.(?:svg)(?:$|\?)/i.test(u.pathname) ? u.href : null; } catch { return null; } };
export function withReleaseImages(release, {catalog} = {}) {
  const out = {...release, editions:(release.editions || []).map(e => ({...e}))};
  if (image(release.artwork)) return {...out,artwork:image(release.artwork),artworkKind:'album-cover',artworkSource:release.artworkSource || release.source || null};
  out.artwork = null;
  const artist = release.artistId && catalog?.artists?.[release.artistId];
  if (!artist || !norm(release.title)) return out;
  const matches = (artist.tracks || []).filter(t => norm(t.album) === norm(release.title) && t.albumId && image(t.artwork));
  const albums = new Map();
  for (const t of matches) {const id=String(t.albumId);if (!albums.has(id))albums.set(id,t);}
  // Identically named different editions cannot be silently conflated.
  if (albums.size !== 1) return out;
  const t = [...albums.values()][0];
  return {...out, artwork:image(t.artwork),artworkKind:'album-cover',artworkSource:{type:'catalog-exact',artistId:release.artistId,albumId:t.albumId,sourceUrl:t.appleUrl || null,collectedAt:artist.fetchedAt || catalog.builtAt || null}};
}

/** Only source-observed, same-store product URLs with an exact catalog-number token. */
export function deriveEditionSources(release, report) {
  const out=[];let base;try{base=new URL(report.url);}catch{return out;}
  for(const ed of release.editions||[]){
    if(typeof ed.catalogNo!=='string'||!/^[A-Z0-9 -]{4,30}$/i.test(ed.catalogNo))continue;
    const token=ed.catalogNo.split(/[ -]+/).map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[-_]?');
    const code=new RegExp('(?:^|[^a-z0-9])'+token+'(?![a-z0-9])','i');
    const matches=(report.guides||[]).filter(g=>{try{const u=new URL(g.url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.origin===base.origin&&/\/products?\//i.test(u.pathname)&&code.test(decodeURIComponent(u.pathname))&&(report.sources||[]).some(s=>s.sourceUrl===g.sourceUrl);}catch{return false;}});
    const urls=[...new Set(matches.map(g=>g.url))];
    if(urls.length===1)out.push({editionId:ed.id,catalogNo:ed.catalogNo,url:urls[0],sourceUrl:matches[0].sourceUrl,fetchedAt:matches[0].fetchedAt||report.fetchedAt});
  }
  return out;
}
