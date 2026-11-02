import {api} from '../api';
import {state,onChange} from './state';
import {getLocale} from './i18n';
import {esc} from './ui';
import {artistName,newsRow} from './cards';
import type {ArtistLite,News} from './cards';
import {exactFollowIds,newsForArtists,newsArtistOptions} from './home-planning';
const sessions=new Map<string,{mode:'all'|'preferred';picked:Set<string>}>();
const L=(ko:string,ja:string)=>getLocale()==='ja'?ja:ko;
export function homeNewsHtml(){return `<div class="home-news-toolbar" role="group" aria-label="${L('소식 범위','ニュースの範囲')}"><button type="button" data-home-news="all" aria-pressed="true">${L('전체 소식','すべてのニュース')}</button><button type="button" data-home-news="preferred" aria-pressed="false">${L('선호 아티스트','好きなアーティスト')}</button></div><div class="home-news-choices" hidden><label for="homeNewsArtist">${L('이 화면에서 볼 아티스트','この画面で見るアーティスト')}</label><div><select id="homeNewsArtist"><option value="">${L('아티스트 선택','アーティストを選ぶ')}</option></select><button type="button" data-news-add>${L('추가','追加')}</button></div><div class="home-news-selected"></div><p class="home-news-scope"></p></div><p class="home-news-status" role="status" aria-live="polite">${L('소식을 불러오는 중','ニュースを取得中')}</p><ul class="nlist home-news-list"></ul>`;}
export function mountHomeNews(host:HTMLElement,initial:News[],initialArtists:ArtistLite[],signal:AbortSignal,alive:()=>boolean){
 const edition=state.edition;
 let config=sessions.get(edition);if(!config){config={mode:'all',picked:new Set()};sessions.set(edition,config);}const prefs=config;
 let items=initial,artists=initialArtists,failed=false,complete=false;
 const valid=()=>!signal.aborted&&alive()&&host.isConnected;
 const choose=host.querySelector<HTMLElement>('.home-news-choices')!,select=host.querySelector<HTMLSelectElement>('#homeNewsArtist')!,list=host.querySelector<HTMLElement>('.home-news-list')!,status=host.querySelector<HTMLElement>('.home-news-status')!,selected=host.querySelector<HTMLElement>('.home-news-selected')!;
 const ids=()=>new Set([...exactFollowIds(state.follows||[],artists),...prefs.picked]);
 const paint=()=>{if(!valid())return;const preferred=prefs.mode==='preferred',wanted=ids();choose.hidden=!preferred;
 host.querySelectorAll<HTMLButtonElement>('[data-home-news]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.homeNews===prefs.mode)));
 const options=new Map(newsArtistOptions(items,artists,wanted).map(a=>[a.id,a]));for(const a of artists)if(!options.has(a.id))options.set(a.id,a);
 const before=select.value;select.innerHTML='<option value="">'+L('아티스트 선택','アーティストを選ぶ')+'</option>'+[...options.values()].map(a=>'<option value="'+esc(a.id)+'">'+esc(artistName(a))+'</option>').join('');if(options.has(before))select.value=before;
 selected.replaceChildren();for(const id of wanted){const a=artists.find(x=>x.id===id),b=document.createElement('button');b.type='button';b.textContent=(a?artistName(a):id)+' ×';b.setAttribute('aria-label',L('제외: ','外す: ')+(a?artistName(a):id));if(!prefs.picked.has(id)){b.disabled=true;b.title=L('팔로우한 아티스트입니다. MY에서 관리하세요.','フォロー中です。マイページで変更できます。');}else b.addEventListener('click',()=>{prefs.picked.delete(id);paint();},{signal});selected.append(b);}
 const rows=preferred&&!wanted.size?[]:newsForArtists(items,preferred?wanted:[]);
 status.textContent=failed?L('추가 소식 조회에 실패했습니다. 먼저 받은 소식만 표시합니다.','追加取得に失敗しました。先に取得したニュースのみ表示します。'):preferred&&!wanted.size?L('선호 아티스트를 선택하면 해당 소식만 표시합니다.','好きなアーティストを選ぶと、そのニュースだけ表示します。'):L(`${rows.length}건 중 ${Math.min(rows.length,5)}건 표시`,`${rows.length}件中 ${Math.min(rows.length,5)}件を表示`)+(complete?'':L(' · 추가 확인 중',' · 追加確認中'));
 host.querySelector<HTMLElement>('.home-news-scope')!.textContent=state.me?L('팔로우한 아티스트와 이 화면에서 추가한 아티스트를 함께 봅니다.','フォロー中と、この画面で追加したアーティストを表示します。'):L('로그인 없이 선택할 수 있습니다. 이 화면의 임시 선택이며 계정에 저장하지 않습니다.','ログインなしで選べます。この画面の一時選択で、アカウントには保存しません。');
 list.innerHTML=rows.length?rows.slice(0,5).map(newsRow).join(''):'<li class="home-news-empty">'+(preferred&&!wanted.size?L('위에서 아티스트를 선택해 추가하세요.','上でアーティストを選んで追加してください。'):preferred?L('수집된 기사에서 해당 아티스트의 소식을 찾지 못했습니다. 선택을 바꾸거나 전체 소식을 확인하세요.','収集済みの記事に該当するニュースがありません。選択を変えるか、すべてのニュースをご確認ください。'):L('아직 표시할 소식이 없습니다.','まだ表示できるニュースはありません。'))+'</li>';
 };
 host.querySelectorAll<HTMLButtonElement>('[data-home-news]').forEach(b=>b.addEventListener('click',()=>{prefs.mode=b.dataset.homeNews==='preferred'?'preferred':'all';paint();},{signal}));
 host.querySelector('[data-news-add]')?.addEventListener('click',()=>{if(select.value&&artists.some(a=>a.id===select.value)){prefs.picked.add(select.value);prefs.mode='preferred';paint();}},{signal});
 const offState=onChange(what=>{if(what==='follows'||what==='auth')paint();});signal.addEventListener('abort',offState,{once:true});
 paint();void Promise.all([api(`/api/live/news?edition=${edition}`,{signal}),api(`/api/live/artists?edition=${edition}`,{signal})]).then(([n,a])=>{if(!valid())return;items=Array.isArray(n.items)?n.items:initial;artists=Array.isArray(a.items)?a.items:initialArtists;complete=true;paint();}).catch(()=>{if(!valid())return;failed=true;complete=true;paint();});
 return {refresh:paint};
}
