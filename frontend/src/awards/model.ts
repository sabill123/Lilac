export type AwardSource = { id: string; label: string; url: string; kind: 'official' | 'report'; checkedAt: string };
export type AwardEntry = { category: string; recipient: string; work?: string; group: string; sourceId: string; highlight?: boolean; searchTerms?: string[] };
export type AwardEdition = {
  id: string; series: string; name: string; shortName: string; nativeName?: string;
  year: number; date: string; endDate?: string; edition?: string; country: 'kr' | 'jp';
  kind: 'awards' | 'broadcast'; tone: string; scope: string; result?: string; resultSourceId?: string;
  sources: AwardSource[]; entries: AwardEntry[];
};
export const safeUrl = (value: string) => { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
export function musicHref(entry: AwardEntry, query?: string) {
  return '#/search?q='+encodeURIComponent(query || entry.searchTerms?.[0] || [entry.recipient,entry.work].filter(Boolean).join(' '));
}
export function validateEditions(editions: readonly AwardEdition[], now = new Date()) {
  const issues:string[]=[], ids=new Set<string>();
  const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  for(const e of editions){
    if(!/^[a-z0-9-]+$/.test(e.id)||ids.has(e.id))issues.push('Invalid/duplicate ID: '+e.id);ids.add(e.id);
    if(!e.name||!e.shortName||!e.series||!e.scope)issues.push('Missing metadata: '+e.id);
    if(!validDate(e.date)||e.endDate&&!validDate(e.endDate)||Date.parse(e.endDate||e.date)>now.getTime())issues.push('Uncompleted/invalid date: '+e.id);
    if(Number(e.date.slice(0,4))!==e.year)issues.push('Edition year mismatch: '+e.id);
    if(e.endDate&&e.endDate<e.date)issues.push('Invalid range: '+e.id);
    if(!['kr','jp'].includes(e.country)||!['awards','broadcast'].includes(e.kind))issues.push('Invalid classification: '+e.id);
    if(!e.entries.length||!e.sources.length)issues.push('Missing records: '+e.id);
    const sourceIds=new Set(e.sources.map(s=>s.id));
    if(e.result&&!sourceIds.has(e.resultSourceId||''))issues.push('Uncited broadcast result: '+e.id);
    if(sourceIds.size!==e.sources.length)issues.push('Duplicate sources: '+e.id);
    for(const source of e.sources)if(!source.id||!source.label||!safeUrl(source.url)||!validDate(source.checkedAt)||Date.parse(source.checkedAt)>now.getTime()||!['official','report'].includes(source.kind))issues.push('Invalid source: '+e.id);
    for(const r of e.entries)if(!r.category||!r.recipient||!r.group||!sourceIds.has(r.sourceId))issues.push('Uncited/empty record: '+e.id);
    if(e.kind==='broadcast'&&e.entries.some(r=>r.group!=='출연곡'))issues.push('Broadcast misclassified as award: '+e.id);
  }
  return issues;
}
