import type {Concert} from './cards';
import {concertRegistry,providerName} from './cards';
import {esc,img,fmtDateTime} from './ui';
import {getLocale} from './i18n';
import {parseAbsoluteInstant,ticketSaleState} from './server-clock';
const L=(ko:string,ja:string)=>getLocale()==='ja'?ja:ko;
export type PlannedTicket={concert:Concert;opensAt:string|null;closesAt:string|null;label:string;key:string};
export function plannedTickets(list:Concert[]):PlannedTicket[]{
 const seen=new Set<string>(),out:PlannedTicket[]=[];
 for(const c of list){const windows=c.windows?.length?c.windows.map(w=>({opensAt:w.opensAt,closesAt:w.closesAt,label:w.label||c.saleType||''})):c.openSchedule?.length?c.openSchedule.map(w=>({opensAt:w.at,closesAt:w.endAt||c.closesAt||null,label:w.label||c.saleType||''})):[{opensAt:c.ticketOpenAt||null,closesAt:c.closesAt||null,label:c.saleType||c.ticketOpenLabel||''}];
 for(const w of windows){const key=[c.id,w.opensAt||'',w.closesAt||'',w.label].join('|');if(seen.has(key))continue;seen.add(key);out.push({concert:c,...w,key});}}
 return out;
}
export function homeTicketOrder(list:PlannedTicket[],now:number|null):PlannedTicket[]{
 const at=(x:PlannedTicket)=>{const a=parseAbsoluteInstant(x.opensAt),b=parseAbsoluteInstant(x.closesAt);return now===null?a??b??Infinity:a!==null&&a>now?a:b!==null&&b>now?b:a??Infinity;};
 return [...list].filter(x=>{if(now===null)return true;const end=parseAbsoluteInstant(x.closesAt);return end===null||end>now;}).sort((a,b)=>at(a)-at(b));
}
const left=(ms:number)=>{const n=Math.max(0,Math.ceil(ms/1000)),h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;return h>99?L(`${Math.floor(h/24)}일 남음`,`${Math.floor(h/24)}日後`):[h,m,s].map(x=>String(x).padStart(2,'0')).join(':');};
export function homeTicketHtml(items:PlannedTicket[],now:number|null,uncertaintyMs=0):string {
 const rows=homeTicketOrder(items,now).slice(0,6);if(!rows.length)return '<p class="home-ticket-empty">'+L('예정된 오픈·마감 일정을 찾지 못했습니다. 전체 티켓에서 확인하세요.','発売・締切予定が見つかりません。チケット一覧をご確認ください。')+'</p>';
 return '<ol class="home-ticket-list">'+rows.map(x=>{const c=x.concert;concertRegistry.set(c.id,c);const st=ticketSaleState(x,now,{uncertaintyMs}),target=st.phase==='upcoming'?x.opensAt:x.closesAt||x.opensAt;
 const label=st.reason==='open_time_unknown'?L('마감 예정','締切予定'):st.phase==='upcoming'?L('오픈까지','発売まで'):st.phase==='closed'?L('접수 마감 시각 지남','受付締切時刻を経過'):st.phase==='open'?L('오픈 시각 지남','発売時刻を経過'):L('시각 확인 필요','日時は要確認');
 const time=st.reason==='open_time_unknown'?L('마감까지 ','締切まで ')+left(st.msUntilClose||0):st.phase==='upcoming'?left(st.msUntilOpen||0):st.phase==='open'&&st.msUntilClose!==null?L('마감까지 ','締切まで ')+left(st.msUntilClose):st.reason==='clock_unsynced'?L('서버 동기화 중','サーバー同期中'):st.phase==='unknown'?L('정확한 시각 원문 확인','正確な日時は原文で確認'):L('실제 접수는 원문 확인','受付状況は原文で確認');
 return '<li data-ticket-key="'+esc(x.key)+'"><button type="button" data-open-concert="'+esc(c.id)+'">'+img(c.poster,'','home-ticket-image',{ratio:'3/4',initial:c.performer||c.title})+'<span class="home-ticket-info"><b>'+esc(c.title)+'</b><span>'+esc([x.label,providerName(c)].filter(Boolean).join(' · '))+'</span><time>'+esc(parseAbsoluteInstant(target)!==null?fmtDateTime(target)+' KST':L('정확한 일시 미확인','正確な日時は未確認'))+'</time></span><span class="home-ticket-state"><span>'+label+'</span><strong data-ticket-countdown="'+esc(x.key)+'">'+esc(time)+'</strong></span></button></li>';
 }).join('')+'</ol>';
}
export function updateTicketCountdowns(host:HTMLElement,items:PlannedTicket[],now:number|null,uncertaintyMs=0){const byKey=new Map(items.map(x=>[x.key,x]));host.querySelectorAll<HTMLElement>('[data-ticket-countdown]').forEach(el=>{const x=byKey.get(el.dataset.ticketCountdown||'');if(!x)return;const s=ticketSaleState(x,now,{uncertaintyMs});el.textContent=s.reason==='open_time_unknown'?L('마감까지 ','締切まで ')+left(s.msUntilClose||0):s.phase==='upcoming'?left(s.msUntilOpen||0):s.phase==='open'&&s.msUntilClose!==null?L('마감까지 ','締切まで ')+left(s.msUntilClose):s.reason==='clock_unsynced'?L('서버 동기화 중','サーバー同期中'):s.phase==='unknown'?L('정확한 시각 원문 확인','正確な日時は原文で確認'):L('실제 접수는 원문 확인','受付状況は原文で確認');});}
