/** Public discovery selections only. No account mutation and no name-based identity guesses. */
import type { ArtistLite, Concert, News } from './cards';
export function kstDay(now:number) { return new Date(now+9*3600_000).toISOString().slice(0,10); }
export function upcomingHomeEvents<T extends Pick<Concert,'id'|'startDate'|'endDate'>>(items:T[],now:number):T[] {
  const today=kstDay(now),seen=new Set<string>();
  return items.filter(c=>{const end=c.endDate||c.startDate;return (!end||!/^\d{4}-\d{2}-\d{2}$/.test(end)||end>=today)&&!seen.has(c.id)&&!!seen.add(c.id);})
    .sort((a,b)=>(a.startDate||'9999').localeCompare(b.startDate||'9999'));
}
export function newsForArtists(items:News[],ids:Iterable<string>):News[] {
  const wanted=new Set(ids),seen=new Set<string>();
  return items.filter(n=>!seen.has(n.id)&&!!seen.add(n.id)&&(!wanted.size||n.artistIds?.some(id=>wanted.has(id))))
    .sort((a,b)=>(b.publishedAt||'').localeCompare(a.publishedAt||''));
}
export function exactFollowIds(follows:{artistId:string}[],artists:ArtistLite[]):string[] {
  const valid=new Set(artists.map(a=>a.id));return [...new Set(follows.map(f=>f.artistId).filter(id=>valid.has(id)))];
}
export function newsArtistOptions(items:News[],artists:ArtistLite[],selected:Iterable<string>):ArtistLite[] {
  const wanted=new Set(selected),mentioned=new Set(items.flatMap(n=>n.artistIds||[]));
  return artists.filter(a=>wanted.has(a.id)||mentioned.has(a.id));
}
