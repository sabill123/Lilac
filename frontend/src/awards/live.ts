import { api } from '../api';
import { isJa } from './i18n';
import { safeUrl } from './model';
import { escapeHtml as esc } from './view';
export interface AwardNotice { id: string; series: string; seriesName: string; country: string; title: string; url: string; source: string; sourceUrl?: string; publishedAt: string | null; publishedAtSource?: string; kind: string; kinds?: string[]; editionYear: number | null; provider?: string; stale?: boolean }
export interface AwardFeed { series?: {id: string; name: string; officialUrl: string}[]; kinds?: string[]; categories?: string[]; items: AwardNotice[]; sources: {provider: string; ok: boolean; count?: number; error?: string}[]; checkedAt?: string; cache?: {state?: string; updatedAt?: string | null; checkedAt?: string; lastError?: string | null}; pending?: boolean }
const labels: Record<string, [string,string]> = {lineup:['출연 발표','出演発表'],nominees:['후보 발표','候補発表'],results:['수상 결과','受賞結果'],schedule:['일정·예매','日程・チケット'],news:['관련 소식','関連ニュース'],appearance:['VTR·게스트·진행','VTR・ゲスト・司会']};
const text = (ko: string, ja: string) => isJa() ? ja : ko;
const kindLabel = (kind: string) => Object.hasOwn(labels,kind) ? labels[kind][isJa()?1:0] : kind;
// Backend facets are authoritative, but arbitrary IDs must not invent UI categories.
const noticeKinds = (notice: AwardNotice): string[] => {
  const kinds = [...new Set((notice.kinds || []).filter(kind=>Object.hasOwn(labels,kind)))];
  return kinds.length ? kinds : [notice.kind];
};
const date = (value: string | null | undefined, dayOnly = false) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(isJa() ? 'ja-JP' : 'ko-KR', {year:'numeric',month:'2-digit',day:'2-digit',...(dayOnly || /^\d{4}-\d{2}-\d{2}$/.test(value) ? {} : {hour:'2-digit' as const,minute:'2-digit' as const}),timeZone:isJa()?'Asia/Tokyo':'Asia/Seoul'}).format(new Date(value)) : text('발표일 미확인','発表日未確認');
export interface AwardFilters { series: string; kind: string; source: string }
// Filters belong to the hash router's query, not the document query. Preserve both.
export function awardFiltersFromUrl(href: string): AwardFilters {
  const hash = new URL(href).hash, query = new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?')+1) : '');
  const source = query.get('awardSource') || '';
  return {series:query.get('awardSeries') || '',kind:query.get('awardKind') || '',source:['official','press'].includes(source)?source:''};
}
export function awardFiltersUrl(href: string, filters: AwardFilters): string {
  const url = new URL(href), split = url.hash.indexOf('?'), route = split < 0 ? url.hash : url.hash.slice(0,split);
  const query = new URLSearchParams(split < 0 ? '' : url.hash.slice(split+1));
  for (const [key,value] of [['awardSeries',filters.series],['awardKind',filters.kind],['awardSource',filters.source]]) {
    if (value) query.set(key,value); else query.delete(key);
  }
  url.hash = (route || (query.size ? '#/' : '')) + (query.size ? `?${query}` : '');
  return url.href;
}
export function awardsUpdatesHtml() {
  return `<section class="award-updates" aria-labelledby="award-updates-title"><header><div><p>${text('AWARDS · 한국과 일본','AWARDS · 韓国と日本')}</p><h2 id="award-updates-title">${text('어워즈 최신 발표','アワード最新発表')}</h2></div><span>${text('발표일 최신순','発表日が新しい順')}</span></header><p class="award-updates-method">${text('공식 공지·보도를 10분 주기로 확인합니다. 매체 반영·서버 대기로 지연될 수 있습니다. 출연·VTR·진행자 구분과 전체 명단은 원문을 확인하세요.','公式発表・報道を10分間隔で確認します。配信・サーバー待機による遅延があります。出演・VTR・司会の区分と全名簿は原文をご確認ください。')}</p><div data-award-updates-body><p role="status">${text('최신 발표 확인 중…','最新発表を確認中…')}</p></div></section>`;
}
function noticeContent(x: AwardNotice) {
  return `<span class="award-notice-meta"><b>${esc(x.seriesName)}${x.editionYear ? ` ${x.editionYear}` : ''}</b><span>${noticeKinds(x).map(kind=>esc(kindLabel(kind))).join(' / ')}</span></span><strong>${esc(x.title)}</strong><span class="award-notice-source">${x.provider?.startsWith('official:') ? `${text('공식','公式')} · ` : `${text('보도','報道')} · `}${esc(x.source || text('출처','出典'))} · ${esc(date(x.publishedAt, x.publishedAtSource === 'official-url-date'))}${x.stale ? ` · ${text('갱신 실패 · 이전 정보','更新失敗・過去の情報')}` : ''}</span>`;
}
const publicationTime = (value: string | null) => Date.parse(value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+09:00` : value || '') || 0;
const ordered = (items: AwardNotice[]) => [...items].sort((a,b) => publicationTime(b.publishedAt) - publicationTime(a.publishedAt) || a.id.localeCompare(b.id));
export function awardNoticeRows(items: AwardNotice[]) {
  return ordered(items).map(x => `<li><a href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener noreferrer">${noticeContent(x)}</a></li>`).join('');
}
export function mountAwardsUpdates(root: HTMLElement, signal: AbortSignal) {
  const box = root.querySelector<HTMLElement>('[data-award-updates-body]');
  if (!box || signal.aborted) return;
  let data: AwardFeed | null = null, filters = awardFiltersFromUrl(window.location.href), more = false, loading = false, failed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // This shell is mounted once. Polling never replaces select/button nodes.
  box.innerHTML = `<div class="award-notice-controls">${[['series',text('시상식','アワード')],['kind',text('발표 종류','発表の種類')],['source',text('출처','出典')]].map(([key,label])=>`<label>${label}<select data-award-${key} aria-describedby="award-result-count"></select></label>`).join('')}</div><p class="award-result-count" id="award-result-count" tabindex="-1" role="status" aria-live="polite" aria-atomic="true"></p><p class="award-updates-method" data-award-checked></p><p class="award-update-warning" data-award-status role="status" aria-live="polite" aria-atomic="true"></p><ul class="award-notice-list" id="award-notice-results" aria-label="${text('최신 발표 목록','最新発表一覧')}"></ul><button class="award-more" type="button" data-award-more aria-controls="award-notice-results" hidden></button><button class="award-retry" type="button" data-award-retry hidden>${text('다시 확인','再試行')}</button><nav class="award-official-links" data-award-official aria-label="${text('시상식 공식 사이트','アワード公式サイト')}"></nav><p class="award-updates-method">${text('보도 날짜는 RSS 기준이며 행사 개최일이 아닙니다. 아래 수상·출연 기록은 별도로 확인한 편집 기록입니다.','報道の日付はRSS基準で、開催日ではありません。下の受賞・出演記録は別途確認した編集記録です。')}</p>`;
  const find = <T extends HTMLElement>(selector: string) => box.querySelector<T>(selector)!;
  const seriesSelect = find<HTMLSelectElement>('[data-award-series]'), kindSelect = find<HTMLSelectElement>('[data-award-kind]'), sourceSelect = find<HTMLSelectElement>('[data-award-source]');
  const count = find('#award-result-count'), status = find('[data-award-status]'), checked = find('[data-award-checked]'), list = find<HTMLUListElement>('.award-notice-list'), moreButton = find<HTMLButtonElement>('[data-award-more]'), retry = find<HTMLButtonElement>('[data-award-retry]'), official = find('[data-award-official]');
  const options = (select: HTMLSelectElement, values: Map<string,string>, selected: string) => {
    if (selected && !values.has(selected)) values.set(selected,selected);
    const html = `<option value="">${text('전체','すべて')}</option>` + [...values].map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join('');
    if (select.dataset.options !== html) { select.innerHTML = html; select.dataset.options = html; }
    select.value = selected;
  };
  const nodes = new Map<string, HTMLLIElement>();
  const paint = () => {
    if (signal.aborted) return;
    const items = data?.items || [], seriesMap = new Map((data?.series || []).map(x=>[x.id,x.name]));
    for (const item of items) seriesMap.set(item.series,item.seriesName);
    options(seriesSelect,seriesMap,filters.series);
    options(kindSelect,new Map(Object.keys(labels).map(k=>[k,kindLabel(k)])),filters.kind);
    options(sourceSelect,new Map([['official',text('공식만','公式のみ')],['press',text('보도만','報道のみ')]]),filters.source);
    const rows = ordered(items.filter(x=>(!filters.series || x.series===filters.series) && (!filters.kind || noticeKinds(x).includes(filters.kind)) && (!filters.source || (x.provider?.startsWith('official:') ? 'official':'press')===filters.source)));
    const active = document.activeElement as HTMLElement | null;
    const focusedKey = [...nodes].find(([,li])=>li.firstElementChild===active)?.[0];
    const occurrences = new Map<string,number>();
    // No fuzzy deduplication: distinct articles and source notices remain distinct.
    const keyedRows = rows.map(item=>{
      const identity = `${item.id}\0${item.url}`, occurrence = occurrences.get(identity) || 0;
      occurrences.set(identity,occurrence+1);
      return {item,key:`${identity}\0${occurrence}`};
    });
    const visible = more ? keyedRows : keyedRows.slice(0,8);
    const focusedRow = focusedKey ? keyedRows.find(row=>row.key===focusedKey) : undefined;
    // Keep the article being read even if new notices push it below the first
    // eight. Once focus leaves it, the next paint can collapse normally.
    if (!more && focusedRow && !visible.some(row=>row.key===focusedKey)) visible.push(focusedRow);
    const keys = new Set<string>();
    visible.forEach(({item,key},index)=>{
      keys.add(key);
      let li = nodes.get(key);
      if (!li) { li=document.createElement('li'); const a=document.createElement('a'); a.target='_blank'; a.rel='noopener noreferrer'; li.append(a); nodes.set(key,li); }
      const a = li.firstElementChild as HTMLAnchorElement, content = noticeContent(item);
      a.setAttribute('href',safeUrl(item.url));
      if (a.innerHTML !== content) a.innerHTML = content;
      if (list.children[index] !== li) list.insertBefore(li,list.children[index] || null);
    });
    for (const [key,li] of nodes) if (!keys.has(key)) { li.remove(); nodes.delete(key); }
    if (active?.isConnected && document.activeElement !== active) active.focus({preventScroll:true});
    const total = data ? text(`조건에 맞는 발표 ${rows.length}건 · 전체 ${items.length}건 · ${visible.length}건 표시`, `該当 ${rows.length}件・全 ${items.length}件・${visible.length}件表示`) : failed ? text('발표를 불러오지 못했습니다','発表を取得できませんでした') : text('발표 확인 중','発表を確認中');
    if (count.textContent !== total) count.textContent = total;
    const warnings: string[] = [];
    if (focusedKey && !focusedRow) {
      count.focus({preventScroll:true});
      warnings.push(text('읽던 발표가 최신 목록에서 제외되어 결과 건수로 이동했습니다.','閲覧中の発表が最新一覧から外れたため、結果件数に移動しました。'));
    }
    if (failed) warnings.push(data ? text('최신 발표를 갱신하지 못했습니다. 마지막으로 받은 정보를 표시합니다.','更新できませんでした。最後に取得した情報を表示しています。') : text('최신 발표를 불러오지 못했습니다. 자동으로 다시 확인합니다.','最新発表を取得できませんでした。自動で再確認します。'));
    if (data && (data.sources.some(x=>!x.ok) || data.cache?.lastError || data.cache?.state==='error')) warnings.push(text('일부 발표 출처를 갱신하지 못했습니다. 이전 정보나 누락이 있을 수 있습니다.','一部の発表元を更新できませんでした。過去の情報や未掲載の発表がある場合があります。'));
    if (data?.cache?.state==='stale' || items.some(x=>x.stale)) warnings.push(text('이전 수집 정보가 포함되어 있습니다.','過去の取得情報が含まれています。'));
    if (loading || data?.pending) warnings.push(text('최신 발표 확인 중…','最新発表を確認中…'));
    if (data && !rows.length && !data.pending) warnings.push(items.length ? text('현재 필터에 맞는 발표가 없습니다. 필터를 전체로 바꿔 보세요.','現在の条件に合う発表はありません。フィルターをすべてに変更してください。') : text('확인된 발표가 없습니다. 아직 발표되지 않았다는 뜻은 아닙니다.','確認できた発表がありません。未発表であることを意味しません。'));
    const message = warnings.join(' '); if (status.textContent !== message) status.textContent = message; status.hidden = !message;
    checked.textContent = data ? `${text('최근 조회','最終取得')} ${date(data.cache?.checkedAt || data.checkedAt || data.cache?.updatedAt)}` : '';
    moreButton.hidden = rows.length <= 8; moreButton.setAttribute('aria-expanded',String(more));
    moreButton.textContent = more ? text('접기','閉じる') : text(`발표 ${rows.length}건 모두 보기`,`${rows.length}件の発表を表示`);
    retry.hidden = !failed; retry.disabled = loading;
    const links = (data?.series || []).filter(x=>!filters.series || x.id===filters.series).map(x=>`<a href="${esc(safeUrl(x.officialUrl))}" target="_blank" rel="noopener noreferrer">${esc(x.name)} ${text('공식','公式')} ↗</a>`).join('');
    if (official.innerHTML !== links) official.innerHTML = links;
  };
  const load = async () => {
    if (signal.aborted || loading) return;
    clearTimeout(timer); loading=true; paint();
    try {
      const next: AwardFeed = await api('/api/live/awards',{signal});
      if (signal.aborted) return;
      if (!next || !Array.isArray(next.items) || !Array.isArray(next.sources)) throw new Error('Invalid awards feed');
      data=next; failed=false;
    } catch { if (signal.aborted) return; failed=true; }
    finally { loading=false; }
    if (signal.aborted) return;
    paint(); timer=setTimeout(()=>void load(),data?.pending && !failed ? 5000:60000);
  };
  const change = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const key = target===seriesSelect?'series':target===kindSelect?'kind':target===sourceSelect?'source':null;
    if (!key) return;
    filters={...filters,[key]:target.value}; more=false;
    try { window.history.replaceState(window.history.state,'',awardFiltersUrl(window.location.href,filters)); } catch { /* Filtering still works if history writes are blocked. */ }
    paint();
  };
  box.addEventListener('change',change,{signal});
  box.addEventListener('click',event=>{const target=event.target as HTMLElement; if(target.closest('[data-award-more]')){more=!more;paint();} else if(target.closest('[data-award-retry]')) void load();},{signal});
  signal.addEventListener('abort',()=>clearTimeout(timer),{once:true});
  void load();
}
