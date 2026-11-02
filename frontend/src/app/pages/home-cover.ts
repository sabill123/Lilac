import { getLocale, t } from '../i18n';
import { esc, icon, safeImage, safeHref } from '../ui';
import { concertRegistry, whenOf, placeOf, providerName, artistName } from '../cards';
import type { Concert, ArtistLite, Release } from '../cards';

export interface CoverArtist extends ArtistLite { photoLarge?: string | null }
export interface CoverData { edition?:string; coverConcerts?:Concert[]; coverReleases?:Release[]; visiting:Concert[]; abroad:Concert[]; artists:CoverArtist[]; coverArtists?:CoverArtist[]; releases?:Release[]; portraitsPending?:boolean }
export interface CoverMedia { image:string; kind:'album'|'concert'; title:string; sourceUrl:string }
export interface CoverSlide { key:string; name:string; artistId:string; image:string; photo:true; concert:Concert|null; secondary:CoverMedia; portraitSource:string; portraitCheckedAt:string; release:Release|null }
export const COVER_FRAME_MS=2000;
const L = (ko:string,ja:string) => getLocale()==='ja'?ja:ko;
function ownedCandidates(d:CoverData) {
  const wanted=d.edition==='kr'?'jp':d.edition==='jp'?'kr':null;
  const artists=new Map<string,CoverArtist>();
  const fresh=(a:CoverArtist)=>{const p=a.portrait,age=Date.now()-Date.parse(p?.checkedAt||'');return !!p&&p.artistId===a.id&&p.status==='verified'&&p.method==='official-profile'&&!!safeImage(p.imageUrl)&&!!safeHref(p.sourceUrl,false)&&age>=-60000&&age<86400000;};
  for(const a of [...d.artists,...(d.coverArtists||[])].filter(a=>!wanted||a.origin===wanted)){
    const previous=artists.get(a.id);
    const portrait=previous&&fresh(previous)&&(!fresh(a)||Date.parse(previous.portrait!.checkedAt)>Date.parse(a.portrait!.checkedAt))?previous.portrait:a.portrait;
    artists.set(a.id,{...previous,...a,portrait});
  }
  const concerts=[...(d.coverConcerts||[]),...d.abroad,...d.visiting].filter(c=>!c.unconfirmed&&c.artistId&&artists.has(c.artistId));
  const releases=[...(d.coverReleases||[]),...(d.releases||[])].filter(r=>r.artistId&&artists.has(r.artistId)&&safeImage(r.artwork)&&r.artworkKind==='album-cover').sort((a,b)=>String(b.releaseDate||'').localeCompare(String(a.releaseDate||'')));
  const eligible=new Set([...concerts.map(c=>c.artistId!),...releases.map(r=>r.artistId!)]);
  const ids=[...artists.keys()].filter(id=>eligible.has(id));
  return ids.map(id=>{
    const artist=artists.get(id)!, concert=concerts.find(c=>c.artistId===id)||null, release=releases.find(r=>r.artistId===id)||null;
    const poster=concerts.find(c=>c.artistId===id&&['official','event'].includes(c.posterKind||'')&&safeImage(c.poster));
    const source=release?.artworkSource?.sourceUrl||release?.artworkSource?.url||release?.appleUrl||'';
    const secondary:CoverMedia|null=release?{image:safeImage(release.artwork),kind:'album',title:release.title,sourceUrl:safeHref(source,false)}:poster?{image:safeImage(poster.poster),kind:'concert',title:poster.title,sourceUrl:safeHref(poster.url,false)}:null;
    return {artist,concert,release,secondary};
  }).filter(row=>!!row.secondary);
}
export function coverCandidateIds(d:CoverData):string[] { return ownedCandidates(d).slice(0,60).map(row=>row.artist.id); }
/** Each exposed artist has a current official portrait AND their own album/event visual. */
export function coverSlides(d:CoverData):CoverSlide[] {
  const usedImages=new Set<string>();
  return ownedCandidates(d).flatMap(({artist:a,concert,release,secondary})=>{
    const p=a.portrait, age=Date.now()-Date.parse(p?.checkedAt||'');
    const image=safeImage(p?.imageUrl), source=safeHref(p?.sourceUrl,false);
    if(!p||p.status!=='verified'||p.method!=='official-profile'||p.artistId!==a.id||!image||!source||!Number.isFinite(age)||age< -60000||age>=86400000||!secondary||secondary.image===image||usedImages.has(image)||usedImages.has(secondary.image))return [];
    usedImages.add(image);usedImages.add(secondary.image);
    return [{key:'artist:'+a.id,name:artistName(a),artistId:a.id,image,photo:true as const,concert,secondary,release,portraitSource:source,portraitCheckedAt:p.checkedAt}];
  }).slice(0,12);
}
export function coverVisual(s: CoverSlide, phase:0|1=0): string {
  const c=s.concert;
  const status=c?t('st.'+c.status):'';
  const media=phase?s.secondary:null;
  const title=media?.title||c?.title||'';
  const tour=media?.kind==='album'?title:title === s.name ? '' : title.startsWith(s.name+' ') ? title.slice(s.name.length).trim() : title;
  return `<img class="cover-photo${phase?' is-poster':''}" src="${esc(media?.image||s.image)}" alt="${esc(s.name)} · ${esc(media?L(media.kind==='album'?'앨범 커버':'공연 이미지',media.kind==='album'?'アルバムカバー':'公演画像'):L('현재 공식 프로필 사진','現在の公式プロフィール写真'))}" decoding="async" fetchpriority="high" referrerpolicy="no-referrer">
    <div class="cover-shade" aria-hidden="true"></div><div class="cover-copy">
      ${c?`<div class="cover-context"><span>${esc(c.country==='JP'?L('일본 현지','日本公演'):L('한국 공연','韓国公演'))}${status?' · '+esc(status):''}</span></div>`:''}
      <h2 class="cover-name">${esc(s.name)}</h2>${tour?`<p class="cover-tour"${media?.kind==='album'?' data-content-original-work translate="no"':''}>${esc(tour)}</p>`:''}
      <a class="cover-community" href="#/community/${encodeURIComponent(s.artistId)}">${L('아티스트 커뮤니티','アーティスト・コミュニティ')}${icon('i-chev-r')}</a>
    </div><p class="cover-image-error" hidden>${L('이미지를 불러오지 못했습니다. 아래에서 아티스트 정보를 확인하세요.','画像を取得できませんでした。下からアーティスト情報を確認できます。')}</p>`;
}
export function coverBelt(s: CoverSlide): string {
  const c=s.concert;
  if(c) concertRegistry.set(c.id,c);
  const official=safeHref(c?.url,false), source=c?providerName(c):'';
  const artist=s.artistId?'#/artist/'+encodeURIComponent(s.artistId):'';
  const membership=s.artistId?'#/assist?kind=fanclub&artistId='+encodeURIComponent(s.artistId):'#/fanclub';
  return `<div class="cover-event">${c?`<p class="cover-event-date">${esc(whenOf(c)||L('일정 확인 필요','日程は要確認'))}</p><p class="cover-event-place">${esc(placeOf(c)||L('장소 확인 필요','会場は要確認'))}</p>`:`<p class="cover-event-date">${L('좋아하는 아티스트의 다음 순간','好きなアーティストの次の瞬間')}</p><p class="cover-event-place">${L('팬클럽·발매·공연 정보를 확인하세요.','ファンクラブ・リリース・公演情報を確認。')}</p>`}</div>
    <div class="cover-actions">${c?`<button class="cover-primary" type="button" data-open-concert="${esc(c.id)}">${L('공연 자세히','公演詳細')}${icon('i-chev-r')}</button>`:artist?`<a class="cover-primary" href="${artist}">${L('아티스트 보기','アーティストを見る')}${icon('i-chev-r')}</a>`:''}<a class="cover-member" href="${membership}">${L('팬클럽·가입 도움','ファンクラブ・入会サポート')}${icon('i-chev-r','ic xs')}</a></div>
    <details class="cover-sources"><summary>${L('이미지·정보 출처','画像・情報の出典')}</summary><p class="cover-provenance"><a href="${esc(s.portraitSource)}" target="_blank" rel="noopener noreferrer">${L('프로필 원문','プロフィール原文')}${icon('i-ext','ic xs')}</a>${s.secondary.sourceUrl?`<a href="${esc(s.secondary.sourceUrl)}" target="_blank" rel="noopener noreferrer">${L(s.secondary.kind==='album'?'앨범 원문':'공연 이미지 원문',s.secondary.kind==='album'?'アルバム原文':'公演画像の原文')}${icon('i-ext','ic xs')}</a>`:''}${official?`<a href="${esc(official)}" target="_blank" rel="noopener noreferrer">${esc(source)}${icon('i-ext','ic xs')}</a>`:L('가입·결제는 해당 공식 사이트에서 진행합니다.','入会・決済は各公式サイトで行います。')}${artist&&c?`<a href="${artist}">${L('아티스트 홈','アーティスト')}</a>`:''}</p></details>`;
}
const coverPageHeading=()=>'<h1 class="sr-only">Lilac</h1>';
export function homeCoverHtml(d: CoverData): string {
  const slides=coverSlides(d);
  if(!slides.length) return `<header class="cover-empty">${coverPageHeading()}<div class="cover-empty-state" role="status"><p>${d.portraitsPending?L('공식 프로필과 같은 아티스트의 앨범·공연 이미지를 확인하고 있어요.','公式プロフィールと同じアーティストのアルバム・公演画像を確認しています。'):L('현재 공식 프로필과 앨범·공연 이미지를 함께 확인한 아티스트를 준비하고 있어요.','現在の公式プロフィールとアルバム・公演画像を確認できたアーティストを準備しています。')}</p><a href="#/artists">${L('아티스트 목록 보기','アーティスト一覧を見る')}${icon('i-chev-r')}</a></div></header>`;
  return `<section class="home-cover" aria-roledescription="carousel" aria-label="${L('아티스트 스포트라이트','アーティスト・スポットライト')}">
    ${coverPageHeading()}
    <div class="cover-visual" data-cover-kind="profile" id="coverView" role="tabpanel" aria-labelledby="coverTab0">${coverVisual(slides[0])}</div>
    <div class="cover-navigation"><div class="cover-tabs" role="tablist" aria-label="${L('다른 아티스트','ほかのアーティスト')}">${slides.map((s,i)=>`<button type="button" role="tab" id="coverTab${i}" aria-controls="coverView" data-cover-to="${i}" aria-selected="${i===0}" tabindex="${i===0?0:-1}">${esc(s.name)}</button>`).join('')}</div><div class="cover-arrows"><span class="cover-count" aria-hidden="true">1 / ${slides.length}</span><button type="button" data-cover-go="-1" aria-label="${L('이전 아티스트','前のアーティスト')}">${icon('i-chev-l')}</button><button type="button" data-cover-go="1" aria-label="${L('다음 아티스트','次のアーティスト')}">${icon('i-chev-r')}</button><button type="button" data-cover-motion aria-pressed="false" aria-label="${L('자동 넘김 정지','自動再生を停止')}">${icon('i-pause')}</button></div></div>
    <div class="cover-belt">${coverBelt(slides[0])}</div>
  </section>`;
}

export function mountHomeCover(root:HTMLElement,d:CoverData,signal:AbortSignal):void {
  const host=root.querySelector<HTMLElement>('.home-cover'),slides=coverSlides(d);
  if(!host||!slides.length||signal.aborted)return;
  const visual=host.querySelector<HTMLElement>('.cover-visual')!,belt=host.querySelector<HTMLElement>('.cover-belt')!;
  const tabs=Array.from(host.querySelectorAll<HTMLButtonElement>('[data-cover-to]')),motion=host.querySelector<HTMLButtonElement>('[data-cover-motion]')!;
  const reduce=matchMedia('(prefers-reduced-motion: reduce)');
  let heroScene:{setImage:(image:HTMLImageElement,mode:'profile'|'album'|'concert')=>void;destroy:()=>void}|null=null;
  if(typeof WebGL2RenderingContext!=='undefined')void import('../hero-scene').then(({mountHeroScene})=>{if(signal.aborted||!host.isConnected)return;heroScene=mountHeroScene(visual,{signal});const image=visual.querySelector<HTMLImageElement>('.cover-photo');if(image)heroScene.setImage(image,phase?slides[index].secondary.kind:'profile');}).catch(()=>{});
  let index=0,phase:0|1=0,paused=false,inView=true,frame=0,timer=0,request=0,down:{x:number;y:number}|null=null,hover=false,ready=false,pending=false,pendingAutomatic=false;
  const loaders=new Map<string,HTMLImageElement>();
  const live=()=>!signal.aborted&&host.isConnected;
  const nextStep=()=>phase===0?{index,phase:1 as const}:{index:(index+1)%slides.length,phase:0 as const};
  const srcFor=(i:number,p:0|1)=>p?slides[i].secondary.image:slides[i].image;
  const preload=(src:string)=>{
    let img=loaders.get(src);if(img)return img;
    img=new Image();img.referrerPolicy='no-referrer';img.decoding='async';img.src=src;loaders.set(src,img);return img;
  };
  const restart=()=>{
    clearInterval(timer);timer=0;
    if(paused||reduce.matches||!ready||pending||!live())return;
    const next=nextStep();preload(srcFor(next.index,next.phase));
    timer=window.setInterval(()=>{if(live()&&inView&&!document.hidden&&!hover&&!host.contains(document.activeElement)){clearInterval(timer);timer=0;go(next.index,next.phase,true);}},COVER_FRAME_MS);
  };
  const paintImage=()=>{
    ready=false;clearInterval(timer);timer=0;
    const image=visual.querySelector<HTMLImageElement>('.cover-photo');if(!image)return;heroScene?.setImage(image,phase?slides[index].secondary.kind:'profile');
    const loaded=()=>{if(!live()||!visual.contains(image))return;ready=true;restart();};
    image.addEventListener('load',loaded,{once:true,signal});
    image.addEventListener('error',()=>{if(!live()||!visual.contains(image))return;ready=false;clearInterval(timer);image.hidden=true;visual.classList.add('has-image-error');const msg=visual.querySelector<HTMLElement>('.cover-image-error');if(msg)msg.hidden=false;},{once:true,signal});
    if(image.complete){if(image.naturalWidth)loaded();else image.dispatchEvent(new Event('error'));}
  };
  const commit=(next:number,nextPhase:0|1)=>{
    if(!live())return;pending=false;pendingAutomatic=false;index=((next%slides.length)+slides.length)%slides.length;phase=nextPhase;
    visual.classList.remove('has-image-error');visual.setAttribute('aria-busy','false');visual.setAttribute('data-cover-kind',phase?slides[index].secondary.kind:'profile');visual.setAttribute('aria-labelledby','coverTab'+index);
    visual.innerHTML=coverVisual(slides[index],phase);belt.innerHTML=coverBelt(slides[index]);host.querySelector('.cover-count')!.textContent=`${index+1} / ${slides.length}`;
    tabs.forEach((b,i)=>{b.setAttribute('aria-selected',String(i===index));b.tabIndex=i===index?0:-1});paintImage();
  };
  const go=(next:number,nextPhase:0|1=0,automatic=false)=>{
    if(!live())return;const target=((next%slides.length)+slides.length)%slides.length,token=++request;
    clearInterval(timer);timer=0;pending=true;pendingAutomatic=automatic;const image=preload(srcFor(target,nextPhase));
    const apply=()=>{if(!live()||request!==token)return;if(automatic&&(paused||reduce.matches||!inView||document.hidden||hover||host.contains(document.activeElement))){pending=false;visual.setAttribute('aria-busy','false');restart();return;}commit(target,nextPhase);};
    const fail=()=>{if(!live()||request!==token)return;pending=false;visual.setAttribute('aria-busy','false');const msg=visual.querySelector<HTMLElement>('.cover-image-error');if(msg){msg.textContent=L('다음 이미지를 불러오지 못했습니다. 다시 넘기거나 원문을 확인하세요.','次の画像を取得できませんでした。もう一度切り替えるか原文をご確認ください。');msg.hidden=false;}};
    if(image.complete){if(image.naturalWidth)apply();else fail();return;}
    // Keep the old image AND its matching labels until the next image is ready.
    visual.setAttribute('aria-busy','true');
    image.addEventListener('load',apply,{once:true,signal});
    image.addEventListener('error',fail,{once:true,signal});
  };
  const sync=()=>{motion.disabled=reduce.matches;motion.setAttribute('aria-pressed',String(paused||reduce.matches));motion.setAttribute('aria-label',reduce.matches?L('모션 줄이기 설정 적용 중','モーション軽減設定を適用中'):paused?L('자동 넘김 재개','自動再生を再開'):L('자동 넘김 정지','自動再生を停止'));motion.innerHTML=icon(paused||reduce.matches?'i-play':'i-pause');};
  tabs.forEach((b,i)=>b.addEventListener('click',()=>go(i,0),{signal}));
  host.querySelectorAll<HTMLButtonElement>('[data-cover-go]').forEach(b=>b.addEventListener('click',()=>go(index+Number(b.dataset.coverGo),0),{signal}));
  motion.addEventListener('click',()=>{paused=!paused;if(paused&&pending&&pendingAutomatic){request++;pending=false;pendingAutomatic=false;visual.setAttribute('aria-busy','false');}sync();restart();},{signal});
  host.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)||(e.target as HTMLElement).matches('input,textarea,select'))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?slides.length-1:index+(e.key==='ArrowRight'?1:-1);go(next,0);tabs[((next%slides.length)+slides.length)%slides.length].focus();},{signal});
  host.addEventListener('pointerenter',()=>{hover=true},{signal});host.addEventListener('pointerleave',()=>{hover=false;visual.style.setProperty('--px','0px');visual.style.setProperty('--py','0px')},{signal});
  visual.addEventListener('pointermove',e=>{if(e.pointerType!=='mouse'||reduce.matches||paused||frame||!inView)return;const r=visual.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;frame=requestAnimationFrame(()=>{frame=0;if(live()){visual.style.setProperty('--px',`${x*14}px`);visual.style.setProperty('--py',`${y*10}px`)}});},{signal});
  visual.addEventListener('pointerdown',e=>{if((e.target as Element).closest?.('a,button')){down=null;return;}if(e.pointerType==='touch')down={x:e.clientX,y:e.clientY}},{signal});
  visual.addEventListener('pointerup',e=>{if(!down)return;const dx=e.clientX-down.x,dy=e.clientY-down.y;down=null;if(Math.abs(dx)>48&&Math.abs(dx)>Math.abs(dy)*1.4)go(index+(dx<0?1:-1),0);},{signal});
  visual.addEventListener('pointercancel',()=>{down=null},{signal});reduce.addEventListener('change',()=>{if(reduce.matches&&pending&&pendingAutomatic){request++;pending=false;pendingAutomatic=false;visual.setAttribute('aria-busy','false');}sync();restart();},{signal});
  const observer=new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;});observer.observe(host);
  signal.addEventListener('abort',()=>{request++;clearInterval(timer);cancelAnimationFrame(frame);observer.disconnect();down=null;for(const image of loaders.values()){image.removeAttribute('src');}loaders.clear();},{once:true});
  paintImage();sync();
}
