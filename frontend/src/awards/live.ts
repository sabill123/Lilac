import { api } from '../api';
import { isJa } from './i18n';
import { safeUrl } from './model';
import { escapeHtml as esc } from './view';
export interface AwardNotice { id: string; series: string; seriesName: string; country: string; title: string; url: string; source: string; sourceUrl?: string; publishedAt: string | null; publishedAtSource?: string; kind: string; editionYear: number | null; provider?: string; stale?: boolean }
export interface AwardFeed { series?: {id: string; name: string; officialUrl: string}[]; items: AwardNotice[]; sources: {provider: string; ok: boolean; count?: number; error?: string}[]; checkedAt?: string; cache?: {state?: string; updatedAt?: string | null; checkedAt?: string; lastError?: string | null}; pending?: boolean }
const labels: Record<string, [string,string]> = {lineup:['출연 발표','出演発表'],nominees:['후보 발표','候補発表'],results:['수상 결과','受賞結果'],schedule:['일정·예매','日程・チケット'],news:['관련 소식','関連ニュース']};
const text = (ko: string, ja: string) => isJa() ? ja : ko;
const date = (value: string | null | undefined, dayOnly = false) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(isJa() ? 'ja-JP' : 'ko-KR', {year:'numeric',month:'2-digit',day:'2-digit',...(dayOnly || /^\d{4}-\d{2}-\d{2}$/.test(value) ? {} : {hour:'2-digit' as const,minute:'2-digit' as const}),timeZone:isJa()?'Asia/Tokyo':'Asia/Seoul'}).format(new Date(value)) : text('발표일 미확인','発表日未確認');
export function awardsUpdatesHtml() {
  return `<section class="award-updates" aria-labelledby="award-updates-title"><header><div><p>${text('AWARDS · 한국과 일본','AWARDS · 韓国と日本')}</p><h2 id="award-updates-title">${text('어워즈 최신 발표','アワード最新発表')}</h2></div><span>${text('발표일 최신순','発表日が新しい順')}</span></header><p class="award-updates-method">${text('공식 공지·보도를 10분 주기로 확인합니다. 매체 반영·서버 대기로 지연될 수 있습니다. 출연·VTR·진행자 구분과 전체 명단은 원문을 확인하세요.','公式発表・報道を10分間隔で確認します。配信・サーバー待機による遅延があります。出演・VTR・司会の区分と全名簿は原文をご確認ください。')}</p><div data-award-updates-body aria-live="polite"><p>${text('최신 발표 확인 중…','最新発表を確認中…')}</p></div></section>`;
}
export function awardNoticeRows(items: AwardNotice[]) {
  const ordered = [...items].sort((a,b) => (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0) || a.id.localeCompare(b.id));
  return ordered.map(x => `<li><a href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener noreferrer"><span class="award-notice-meta"><b>${esc(x.seriesName)}${x.editionYear ? ` ${x.editionYear}` : ''}</b><span>${esc((labels[x.kind] || labels.news)[isJa()?1:0])}</span></span><strong>${esc(x.title)}</strong><span class="award-notice-source">${x.provider?.startsWith('official:') ? `${text('공식','公式')} · ` : ''}${esc(x.source || text('출처','出典'))} · ${esc(date(x.publishedAt, x.publishedAtSource === 'official-url-date'))}${x.stale ? ` · ${text('갱신 실패 · 이전 정보','更新失敗・過去の情報')}` : ''}</span></a></li>`).join('');
}
export function mountAwardsUpdates(root: HTMLElement, signal: AbortSignal) {
  const box = root.querySelector<HTMLElement>('[data-award-updates-body]');
  if (!box || signal.aborted) return;
  let data: AwardFeed | null = null, series = '', kind = '', more = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const paint = () => {
    if (!data || signal.aborted) return;
    const seriesMap = new Map((data.series || []).map(x => [x.id,x.name]));
    for (const x of data.items) seriesMap.set(x.series,x.seriesName);
    const rows = data.items.filter(x => (!series || x.series === series) && (!kind || x.kind === kind));
    const failed = data.sources.filter(x => !x.ok).length;
    const warn = failed || data.cache?.lastError || data.cache?.state === 'error';
    box.innerHTML = `<div class="award-notice-controls"><label>${text('시상식','アワード')}<select data-award-series><option value="">${text('전체','すべて')}</option>${[...seriesMap].map(([id,name])=>`<option value="${esc(id)}"${id===series?' selected':''}>${esc(name)}</option>`).join('')}</select></label><label>${text('발표 종류','発表の種類')}<select data-award-kind><option value="">${text('전체','すべて')}</option>${Object.entries(labels).map(([id,name])=>`<option value="${id}"${id===kind?' selected':''}>${name[isJa()?1:0]}</option>`).join('')}</select></label><span>${text('최근 조회','最終取得')} ${esc(date(data.cache?.checkedAt || data.checkedAt || data.cache?.updatedAt))}</span></div>${warn ? `<p class="award-update-warning" role="status">${text('일부 발표 출처를 갱신하지 못했습니다. 이전 정보가 표시되거나 발표가 누락될 수 있습니다.','一部の発表元を更新できませんでした。過去の情報や未掲載の発表がある場合があります。')}</p>` : ''}${data.cache?.state==='stale' ? `<p class="award-update-warning">${text('이전 수집 정보 · 다시 확인 중','過去の取得情報・更新中')}</p>` : ''}${rows.length ? `<ul class="award-notice-list">${awardNoticeRows(more ? rows : rows.slice(0,8))}</ul>${rows.length>8 ? `<button class="award-more" type="button" data-award-more>${more ? text('접기','閉じる') : text(`발표 ${rows.length}건 모두 보기`,`${rows.length}件の発表を表示`)}</button>` : ''}` : `<p class="award-notice-empty">${data.pending ? text('공식 공지·보도를 수집하고 있습니다. 잠시 후 자동으로 표시됩니다.','公式発表・報道を取得中です。まもなく自動表示します。') : text('확인된 발표가 없습니다. 아직 발표되지 않았다는 뜻은 아닙니다.','確認できた発表がありません。未発表であることを意味しません。')}</p>`}<nav class="award-official-links" aria-label="${text('시상식 공식 사이트','アワード公式サイト')}">${(data.series || []).filter(x => !series || x.id === series).map(x => `<a href="${esc(safeUrl(x.officialUrl))}" target="_blank" rel="noopener noreferrer">${esc(x.name)} ${text('공식','公式')} ↗</a>`).join('')}</nav><p class="award-updates-method">${text('보도 날짜는 RSS 기준이며 행사 개최일이 아닙니다. 아래 수상·출연 기록은 별도로 확인한 편집 기록입니다.','報道の日付はRSS基準で、開催日ではありません。下の受賞・出演記録は別途確認した編集記録です。')}</p>`;
  };
  const change = (event: Event) => { const el=event.target as HTMLSelectElement; if(el.matches('[data-award-series]')){series=el.value;more=false;paint();}else if(el.matches('[data-award-kind]')){kind=el.value;more=false;paint();} };
  const click = (event: Event) => {if((event.target as HTMLElement).closest('[data-award-more]')){more=!more;paint();}};
  box.addEventListener('change',change,{signal});box.addEventListener('click',click,{signal});
  const load = async () => {
    try {const next: AwardFeed=await api('/api/live/awards',{signal});if(signal.aborted)return;data=next;paint();}
    catch {if(signal.aborted)return;if(!data)box.innerHTML=`<p class="award-update-warning">${text('최신 발표를 불러오지 못했습니다. 잠시 후 자동으로 다시 확인합니다.','最新発表を取得できませんでした。まもなく再確認します。')}</p>`;}
    if(!signal.aborted)timer=setTimeout(()=>void load(),data?.pending?5000:60000);
  };
  signal.addEventListener('abort',()=>clearTimeout(timer),{once:true});void load();
}
