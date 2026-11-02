import {api} from '../../api';
import {getLocale} from '../i18n';
import {state} from '../state';
import {esc,params,img,safeHref} from '../ui';
import {assistanceHtml,mountAssistance} from '../assistance';
import type {AssistanceContext} from '../assistance';

export async function renderAssistance(root:HTMLElement,alive:()=>boolean) {
  const ja=getLocale()==='ja',q=params(),artistId=q.get('artistId')||undefined;
  const ctx:AssistanceContext={kind:q.get('kind')==='purchase'?'purchase':'fanclub',artistId,artistName:q.get('artist')||'',title:q.get('title')||'',url:safeHref(q.get('url'),false),image:undefined};
  root.innerHTML='<div class="sk sk-block"></div>';
  let artist:any=null;
  if(artistId) artist=await api(`/api/live/artist?id=${encodeURIComponent(artistId)}&edition=${state.edition}`).catch(()=>null);
  if(!alive())return;
  if(artist) {ctx.artistName=artist.name;ctx.title=artist.fanclub?.facts?.name||artist.fanclub?.name||artist.name;ctx.url=artist.fanclub?.entry||artist.fanclub?.home||'';ctx.image=artist.fanclub?.facts?.image||artist.photo?.picture||artist.artwork||undefined;}
  root.innerHTML=`<header class="assist-page-head"><a href="${artistId?`#/artist/${encodeURIComponent(artistId)}`:'#/goods'}">${ja?'← 情報に戻る':'← 정보로 돌아가기'}</a><h1>${ja?'入会・購入サポート':'가입·구매 도우미'}</h1><p>${ja?'公式ページの原文、入力欄、翻訳を並べて確認できます。個人情報は送信・保存しません。':'공식 원문과 입력 항목, 번역을 나란히 확인하세요. 개인정보를 대신 제출하거나 저장하지 않습니다.'}</p></header>${ctx.title?`<div class="assist-context">${ctx.image?img(ctx.image,'','square',{ratio:'1/1',initial:ctx.artistName}):''}<div><p>${esc(ctx.artistName)}</p><h2>${esc(ctx.title)}</h2>${ctx.url?`<span>${esc(new URL(ctx.url).hostname)}</span>`:''}</div></div>`:''}${assistanceHtml(ctx)}${!ctx.url?'<section id="assistArtistList" class="sec"></section>':''}`;
  mountAssistance(root,ctx,{alive});
  if(!ctx.url){const a=await api(`/api/live/artists?edition=${state.edition}`).catch(()=>({items:[]}));if(!alive())return;const box=root.querySelector('#assistArtistList');if(box)box.innerHTML=`<div class="sec-head"><h2>${ja?'アーティストから探す':'아티스트로 찾아보기'}</h2></div><div class="assist-artists">${(a.items||[]).slice(0,24).map((x:any)=>`<a href="#/assist?kind=fanclub&artistId=${encodeURIComponent(x.id)}">${img(x.photo||x.artwork,'','round',{ratio:'1/1',initial:x.name})}<b>${esc(x.name)}</b></a>`).join('')}</div>`;}
}
