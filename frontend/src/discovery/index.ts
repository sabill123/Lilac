import { homeAwardsHtml, mountHomeAwards } from '../awards';
import { homeRecordControls, bindHomeRecords } from './home-hero';
import { api, artUrl, esc, icon, findCatalog, needsLogin } from '../api';
import type { Artist, Product, PlayableTrack } from '../api';
import { playQueue, enqueue, openYt, toast } from '../player';
import { can3D, disposeScene, mountHero3D, mountChart3D, setSceneMotionPaused } from '../three';
import { trackKey, sourceFamilies, rankMovement, risingTracks, newEntryTracks, spotlightTracks, selectArtists, rookieEvidence, chartFreshness } from './model';
import type { DiscoveryTrack, ChartSnapshot } from './model';
import { DEBUT_EVIDENCE } from './debuts';

interface Context { artists: Artist[]; products: Product[]; }
const LABELS: Record<string, string> = { combined: '통합', billboard: 'Billboard JAPAN', oricon: '오리콘', melon: '멜론', genie: '지니', apple: 'Apple Music', appleRss: 'Apple 공식 피드', youtube: 'YouTube' };
const PRIORITY = ['billboard', 'oricon', 'melon', 'genie', 'apple', 'appleRss', 'youtube'];
let generation = 0;
let currentAbort: AbortController | undefined;
let playbackRequest = 0;
export function disposeDiscovery() { generation++; playbackRequest++; currentAbort?.abort(); currentAbort = undefined; }
const storedCountry = () => localStorage.getItem('lilac.chartCountry') === 'kr' ? 'kr' : 'jp';
const countryName = (country: string) => country === 'kr' ? '한국' : '일본';
const cover = (row: { artwork?: string | null }, size = 320) => row.artwork ? `<img src="${esc(artUrl({ artwork: row.artwork }, size))}" alt="" loading="lazy" decoding="async">` : `<span class="md-art-placeholder">${icon('i-lib')}</span>`;
const searchHref = (artist: string, title = '') => '#/search?q=' + encodeURIComponent(`${artist} ${title}`.trim());
const countryControl = (country: string) => `<div class="md-country" role="group" aria-label="차트 국가">${['jp','kr'].map(c => `<button type="button" data-md-country="${c}" aria-pressed="${country === c}">${countryName(c)}</button>`).join('')}</div>`;
const motionControl = () => `<button type="button" class="md-motion" data-md-motion aria-pressed="false">모션</button>`;
const sourceInfo = (data: ChartSnapshot | null) => {
  if (!data) return '차트를 불러오지 못했습니다';
  const status = chartFreshness(data);
  const time = status.kind === 'unknown' ? status.label : new Intl.DateTimeFormat('ko-KR', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Seoul'}).format(new Date(data.updated!)) + ' KST 수집' + (status.kind === 'stale' ? ' · 수집 지연' : '');
  return `${countryName(data.country || storedCountry())} · ${LABELS[data.source || 'combined'] || data.source} · ${time}`;
};
const safeList = (data: ChartSnapshot | null) => Array.isArray(data?.list) ? data.list.filter(r => r && typeof r.title === 'string' && typeof r.artist === 'string' && r.title.trim() && r.artist.trim() && Number.isInteger(r.rank) && r.rank > 0).map(r => ({...r, source:data.source})) : [];
function withArtwork(rows: DiscoveryTrack[], catalog: DiscoveryTrack[]): DiscoveryTrack[] {
  const byKey=new Map(catalog.map(row=>[trackKey(row),row]));
  return rows.map(row=>{const match=byKey.get(trackKey(row));return {...row,artwork:row.artwork||match?.artwork,appleUrl:row.appleUrl||match?.appleUrl};});
}
async function chart(country: string, source: string): Promise<ChartSnapshot | null> {
  return api(`/api/charts?country=${country}&source=${encodeURIComponent(source)}`).catch(() => null);
}

function start(root: HTMLElement) {
  const token = ++generation;
  playbackRequest++;
  currentAbort?.abort(); currentAbort = new AbortController(); disposeScene();
  root.innerHTML = '<div class="music-discovery md-loading" role="status"><h1>음악</h1><div class="md-loading-art"></div><p>음악을 불러오는 중</p></div>';
  return { token, signal: currentAbort.signal };
}

function movement(row: DiscoveryTrack) {
  const move = rankMovement(row);
  if (move.kind === 'new') return '<span class="md-change new" title="출처 차트가 제공한 신규 진입">NEW</span>';
  if (move.kind === 'up' || move.kind === 'down') return `<span class="md-change ${move.kind}" title="출처 차트 전회 대비 ${move.delta}계단 ${move.kind === 'up' ? '상승' : '하락'}">${move.kind === 'up' ? '↑' : '↓'} ${move.delta}</span>`;
  return `<span class="md-change unknown" title="${move.kind === 'same' ? '전회와 같은 순위' : '이전 순위 정보 없음'}">${move.kind === 'same' ? '유지' : '·'}</span>`;
}

function appleTrackId(url?: string | null): string | null {
  try { const u=new URL(url||''); if(u.hostname!=='music.apple.com')return null;
    const id=u.searchParams.get('i') || (u.pathname.includes('/song/')?u.pathname.split('/').pop():null);
    return id && /^\d+$/.test(id)?id:null;
  } catch { return null; }
}
function matchesTrack(row: DiscoveryTrack, hit: {id?:number;title?:string;artist?:string} | null): boolean {
  if(!hit)return false;
  const expected=appleTrackId(row.appleUrl);
  if(expected)return String(hit.id)===expected;
  return Boolean(trackKey(row)) && trackKey(row)===trackKey(hit);
}
async function resolveTrack(row: DiscoveryTrack): Promise<PlayableTrack | null> {
  const term=`${row.artist} ${row.title}`;
  let hit = await findCatalog(term).catch(() => null);
  if (!matchesTrack(row,hit) || !hit?.preview) {
    const candidates=await api(`/api/catalog/search?country=${storedCountry()}&entity=song&limit=12&term=${encodeURIComponent(term)}`).catch(()=>null);
    hit=Array.isArray(candidates?.tracks)?candidates.tracks.find(candidate=>candidate.preview&&matchesTrack(row,candidate))||null:null;
  }
  if(hit?.preview && matchesTrack(row,hit)) return {title:hit.title,artist:hit.artist,album:hit.album,artwork:artUrl(hit,300),preview:hit.preview,durationMs:hit.durationMs,youtubeId:row.youtubeId};
  return null;
}
async function playTracks(rows: DiscoveryTrack[], button?: HTMLButtonElement) {
  if (!rows.length) return;
  const request = ++playbackRequest;
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  try {
    // Resolve only the selected track / eight-track preview queue, never the full chart.
    const result = await Promise.all(rows.slice(0, 8).map(resolveTrack));
    if (request !== playbackRequest) return;
    const available = result.filter(Boolean) as PlayableTrack[];
    if (available.length) playQueue(available, 0, `discovery:${storedCountry()}`);
    else toast('이 곡은 미리듣기가 없습니다. 곡 정보에서 원곡을 확인해 주세요.');
  } finally { if (button?.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); } }
}

function artistSelections(context: Context, tracks: DiscoveryTrack[]) {
  const chosen = selectArtists(context.artists, tracks, 80);
  const seen = new Set<string>();
  return chosen.filter(entry => { const key = String(entry.artist.appleArtistId || entry.artist.name.normalize('NFKC').toLowerCase()); if (seen.has(key)) return false; seen.add(key); return true; });
}

function trackCard(row: DiscoveryTrack, key: string, badge = '') {
  return `<article class="md-card"><button type="button" class="md-card-cover" data-md-play="${key}" aria-label="${esc(row.title + ' · ' + row.artist)} 미리듣기">${cover(row)}<span class="md-card-play">${icon('i-play')}</span>${badge ? `<span class="md-card-badge">${badge}</span>` : ''}</button><a class="md-card-title" href="${searchHref(row.artist,row.title)}">${esc(row.title)}</a><span class="md-card-artist">${esc(row.artist)}</span></article>`;
}
function section(title: string, id: string, content: string, meta = '', action = '') {
  return `<section class="md-section" id="${id}" data-md-section="${id}"><div class="md-section-head"><div><h2>${title}</h2>${meta ? `<p>${meta}</p>` : ''}</div>${action}</div>${content}</section>`;
}
function artistCard(entry: ReturnType<typeof selectArtists>[number], rookieOnly = false) {
  const a = entry.artist, debut = rookieEvidence(a.id, DEBUT_EVIDENCE);
  return `<article class="md-artist-card"><a href="#/artist/${encodeURIComponent(a.id)}" class="md-artist-cover" aria-label="${esc(a.name)} 아티스트 보기">${cover(a,240)}</a><a class="md-card-title" href="#/artist/${encodeURIComponent(a.id)}">${esc(a.name)}</a><span class="md-card-artist">${rookieOnly && debut ? `${debut.date.replaceAll('-','.')} 정식 데뷔` : `${new Set(entry.tracks.map(t=>t.title?.normalize('NFKC').trim().toLowerCase())).size}곡 차트 진입 · 최고 ${entry.bestRank}위`}</span>${debut ? `<a class="md-rookie-tag" href="${esc(debut.sourceUrl)}" target="_blank" rel="noopener noreferrer" title="${esc(debut.sourceLabel)} · ${debut.date} 공식 데뷔">신인 ${icon('i-ext','ic s')}</a>` : ''}</article>`;
}

function bindCommon(host: HTMLElement, tracks: Map<string, DiscoveryTrack>, signal: AbortSignal, rerender: () => void) {
  const menus='.md-row-menu[open], .md-track-evidence details[open]';
  const fitMenu=(menu: HTMLDetailsElement)=>{
    const panel=menu.querySelector<HTMLElement>(':scope > div'), doc=menu.ownerDocument, win=doc.defaultView;
    if(!panel||!win)return;
    const anchor=menu.getBoundingClientRect(), player=doc.querySelector('#player')?.getBoundingClientRect(), header=doc.querySelector('.topbar')?.getBoundingClientRect();
    const bottom=Math.min(win.innerHeight-8,player?.height?player.top-8:win.innerHeight-8), top=header?.height?header.bottom+8:8;
    const below=Math.max(0,bottom-anchor.bottom-7), above=Math.max(0,anchor.top-top-7), up=below<panel.scrollHeight&&above>below;
    menu.dataset.placement=up?'up':'down';panel.style.maxHeight=String(up?above:below)+'px';
  };
  host.addEventListener('toggle',event=>{
    const menu=event.target as HTMLDetailsElement;
    if(!menu.matches?.('.md-row-menu, .md-track-evidence details')||!menu.open)return;
    host.querySelectorAll<HTMLDetailsElement>(menus).forEach(other=>{if(other!==menu)other.open=false;});fitMenu(menu);
  },{capture:true,signal});
  host.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    const menu=(event.target as Element).closest<HTMLDetailsElement>('.md-row-menu[open], .md-track-evidence details[open]');
    if(menu){menu.open=false;menu.querySelector<HTMLElement>('summary')?.focus();}
  },{signal});
  const refit=()=>host.querySelectorAll<HTMLDetailsElement>(menus).forEach(fitMenu);
  host.ownerDocument?.addEventListener('scroll',refit,{capture:true,passive:true,signal});
  host.ownerDocument?.defaultView?.addEventListener('resize',refit,{passive:true,signal});
  host.addEventListener('click', async event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.mdCountry) {
      localStorage.setItem('lilac.chartCountry', button.dataset.mdCountry); rerender(); return;
    }
    const key = button.dataset.mdPlay || button.dataset.mdQueue || button.dataset.mdLike;
    const row = key ? tracks.get(key) : null;
    if (row && button.hasAttribute('data-md-play')) await playTracks([row],button);
    if (row && button.hasAttribute('data-md-queue')) {
      button.disabled = true;
      try { const track = await resolveTrack(row); if(signal.aborted)return; if (track) { enqueue(track); toast('대기열에 추가했습니다'); } else toast('이 곡은 미리듣기가 없습니다'); }
      finally { if (button.isConnected) button.disabled = false; }
    }
    if (row && button.hasAttribute('data-md-like')) {
      if (needsLogin('좋아요')) return;
      button.disabled = true;
      try { const result = await api('/api/likes', { method:'POST', body:JSON.stringify({track:{title:row.title,artist:row.artist,artwork:row.artwork}}) });
        if (result) { button.setAttribute('aria-pressed', String(result.liked ?? true)); toast('좋아요 목록을 업데이트했습니다'); }
      } catch { toast('좋아요를 저장하지 못했습니다'); }
      finally { if (button.isConnected) button.disabled = false; }
    }
    if (button.dataset.mdMv) openYt(button.dataset.mdMv);
  }, {signal});
  host.addEventListener('error', event => { if (event.target instanceof HTMLImageElement) { event.target.hidden = true; event.target.parentElement?.classList.add('md-missing-art'); } }, {capture:true,signal});
}

async function bindVisual(host: HTMLElement, rows: DiscoveryTrack[], kind: 'home'|'chart', signal: AbortSignal) {
  const stage = host.querySelector<HTMLElement>('.md-scene');
  const toggle = host.querySelector<HTMLButtonElement>('[data-md-motion]');
  if (!toggle) return;
  if (!stage) { toggle.hidden=true;return; }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let enabled = localStorage.getItem('lilac.discovery.motion') !== 'off';
  const supported = rows.some(r=>r.artwork) && can3D();
  const paint = () => {
    if(signal.aborted || !host.isConnected)return;
    const available = supported && stage.dataset.scene3d !== 'fallback';
    const active = enabled && !reduced.matches && available;
    setSceneMotionPaused(!active);
    host.dataset.motion = active ? 'on' : 'off';
    toggle.setAttribute('aria-pressed', String(active));
    toggle.textContent = !available ? '정적 아트워크' : reduced.matches ? '모션 줄임' : active ? '모션 끄기' : '모션 켜기';
    toggle.disabled = reduced.matches || !available;
  };
  toggle.addEventListener('click',()=>{ enabled=!enabled;localStorage.setItem('lilac.discovery.motion',enabled?'on':'off');paint(); },{signal});
  reduced.addEventListener('change',paint,{signal});
  const observer = typeof MutationObserver === 'function' ? new MutationObserver(paint) : undefined;
  observer?.observe(stage,{attributes:true,attributeFilter:['data-scene3d']});
  signal.addEventListener('abort',()=>{observer?.disconnect();disposeScene();},{once:true});
  paint();
  if (!supported) { stage.dataset.scene3d='fallback'; return; }
  if (kind === 'home') await mountHero3D(stage, rows.filter(r=>r.artwork).slice(0,3).map(r=>({title:r.title,artist:r.artist,artwork:r.artwork!,href:searchHref(r.artist,r.title)})));
  else await mountChart3D(stage,rows.slice(0,1).map(r=>({rank:r.rank,title:r.title,artist:r.artist,artwork:r.artwork,onPick:()=>void playTracks([r])})));
  paint();
}

function visual(rows: DiscoveryTrack[]) {
  return `<div class="md-visual"><div class="md-scene" aria-hidden="true"></div><div class="md-static-art" aria-hidden="true">${rows.filter(r=>r.artwork).slice(0,3).map((r,i)=>`<div class="md-jacket md-jacket-${i}">${cover(r,500)}</div>`).join('')}</div></div>`;
}

export async function renderMusicHome(root: HTMLElement, context: Context) {
  const {token,signal}=start(root), country=storedCountry();
  const [data, changes] = await Promise.all([chart(country,'combined'),country==='jp'?chart(country,'billboard'):Promise.resolve(null)]);
  if (token!==generation || signal.aborted || !root.isConnected) return;
  const rows=safeList(data), changesList=withArtwork(safeList(changes),rows), rising=risingTracks(changesList,6), fresh=newEntryTracks(changesList,6), spotlight=spotlightTracks(rows.filter(r=>r.rank>10),6);
  const selections=artistSelections(context,rows), rookies=selections.filter(a=>rookieEvidence(a.artist.id,DEBUT_EVIDENCE)).slice(0,8);
  const tracks=new Map<string,DiscoveryTrack>();
  const key=(row:DiscoveryTrack)=>{const k=String(tracks.size);tracks.set(k,row);return k;};
  const top=rows[0];
  const initialPlayKey=top?key(top):'';
  const heroRecords=rows.filter(r=>r.artwork).slice(0,3).map(track=>({track,playKey:track===top?initialPlayKey:key(track)}));
  const recordLinks=homeRecordControls(heroRecords,top);
  const latest=context.products.filter(p=>p.origin===country && p.releaseDate && Date.parse(p.releaseDate)<=Date.now()).sort((a,b)=>(b.releaseDate||'').localeCompare(a.releaseDate||'')).slice(0,6);
  root.innerHTML=`<div class="music-discovery md-home">
    <section class="li-home-hero" aria-label="Lilac 음악 탐색">
      <div class="li-home-topline"><h1 class="li-home-wordmark" aria-label="Lilac 음악">음악</h1><div class="md-head-tools">${countryControl(country)}${motionControl()}</div></div>
      <div class="li-home-stage">
        ${top?visual(rows):'<div class="li-home-unavailable"><p>차트를 불러오지 못했습니다.</p><button type="button" data-md-retry>다시 시도</button></div>'}
        ${top?`<div class="li-home-now"><p class="li-home-rank">${countryName(country)} 통합 차트 <span data-home-rank>${top.rank}위</span></p><div class="li-home-track" aria-live="polite" aria-atomic="true"><h2 data-home-title>${esc(top.title)}</h2><p data-home-artist>${esc(top.artist)}</p></div><div class="li-home-actions"><button type="button" class="li-home-play" data-md-play="${initialPlayKey}" aria-label="${esc(top.title+' · '+top.artist)} 30초 미리듣기">${icon('i-play')}<span>미리듣기</span><small>30초</small></button><a data-home-info href="${searchHref(top.artist,top.title)}" aria-label="${esc(top.title+' · '+top.artist)} 곡 찾기">곡 찾기 ${icon('i-chev-r','ic s')}</a></div></div>`:'<a class="li-home-search" href="#/search">음악 검색</a>'}
      </div>
      ${recordLinks}
      <div class="li-home-bottom"><p class="li-home-disclosure">Lilac 통합 집계 · 공식 단일 차트 아님</p><nav class="li-home-jumps" aria-label="홈 영역 이동"><button type="button" data-home-jump="homeAwards">음악상 · 연말무대 <span aria-hidden="true">↘</span></button><button type="button" data-home-jump="homeMusic">음악 둘러보기 <span aria-hidden="true">↘</span></button></nav></div>
    </section>
    ${homeAwardsHtml()}
    <div class="li-home-music" id="homeMusic" tabindex="-1">
    <div class="li-home-music-head"><h2>음악</h2><a href="#/chart">차트 보기 <span aria-hidden="true">↗</span></a></div>
    <nav class="md-discover-nav" aria-label="음악 둘러보기">${[['all','전체'],['popular','인기'],['rising','상승'],['spotlight','주목'],['rookies','신인'],['releases','새 음악']].map(([id,label])=>`<button type="button" data-md-browse="${id}" aria-pressed="${id==='all'}">${label}</button>`).join('')}</nav>
    ${section('인기 TOP 10','popular',`<div class="md-top-grid">${rows.slice(0,10).map(r=>`<div class="md-compact-row"><span class="md-compact-rank">${r.rank}</span><button type="button" data-md-play="${key(r)}" class="md-compact-play" aria-label="${esc(r.title+' · '+r.artist)} 미리듣기"><span class="md-compact-art">${cover(r,100)}</span><span><strong>${esc(r.title)}</strong><small>${esc(r.artist)}</small></span><span class="md-inline-play">${icon('i-play','ic s')}</span></button></div>`).join('')}</div>`,esc(sourceInfo(data)),`<a href="#/chart">전체 차트 ${icon('i-chev-r','ic s')}</a>`)}
    ${section('상승','rising',rising.length?`<div class="md-shelf">${rising.map(r=>trackCard(r,key(r),movement(r))).join('')}</div>`:'<div class="md-empty"><p>이 차트는 이전 순위 정보를 제공하지 않습니다.</p></div>',rising.length?'Billboard JAPAN · 전회 대비 상승폭순 · 최근 수집본':'순위 변동을 확인할 수 있는 곡만 표시합니다.',`<a href="${country==='jp'?'#/chart/billboard':'#/chart'}">${country==='jp'?'Billboard 차트':'전체 차트'} ${icon('i-chev-r','ic s')}</a>`)}
    ${fresh.length?section('새로 진입한 곡','new-entry',`<div class="md-shelf">${fresh.map(r=>trackCard(r,key(r),'NEW')).join('')}</div>`,'Billboard JAPAN 신규 진입 · 신인 아티스트 분류와 다릅니다.'):''}
    ${section('주목','spotlight',spotlight.length?`<div class="md-shelf">${spotlight.map(r=>trackCard(r,key(r),`${sourceFamilies(r).length}개 차트`)).join('')}</div>`:'<div class="md-empty"><p>두 개 이상 출처에서 확인된 곡을 기다리고 있습니다.</p></div>',`TOP 10 밖 · 여러 차트에서 확인한 ${spotlight.length}곡`)}
    ${section('신인','rookies',rookies.length?`<div class="md-artist-shelf">${rookies.map(a=>artistCard(a,true)).join('')}</div>`:'<div class="md-empty"><p>현재 차트에서 공식 데뷔일을 확인한 신인이 없습니다.</p></div>','공식 데뷔 2년 이내 · 데뷔일과 출처를 확인한 아티스트')}
    ${section('아티스트','artists',`<div class="md-artist-shelf">${selections.slice(0,8).map(a=>artistCard(a)).join('')}</div>`,'현재 차트 진입곡 기준',`<a href="#/artists">전체 보기 ${icon('i-chev-r','ic s')}</a>`)}
    ${section('최근 발매','releases',`<div class="md-shelf">${latest.map(p=>`<article class="md-card"><a class="md-card-cover" href="${searchHref(p.brand,p.name)}" aria-label="${esc(p.brand+' · '+p.name)} 곡 찾기">${cover(p)}<span class="md-card-play">${icon('i-search')}</span></a><a class="md-card-title" href="${searchHref(p.brand,p.name)}">${esc(p.name)}</a><span class="md-card-artist">${esc(p.brand)} · ${esc(p.releaseDate?.replaceAll('-','.')||'')}</span><a class="md-album-link" href="#/store/${encodeURIComponent(p.id)}">앨범 정보 ${icon('i-chev-r','ic s')}</a></article>`).join('')}</div>`,'Apple Music 앨범 카탈로그',`<a href="#/store">스토어 ${icon('i-chev-r','ic s')}</a>`)}
    <div class="md-utility-links"><a href="#/library">${icon('i-lib')} 보관함 ${icon('i-chev-r','ic s')}</a><a href="#/work">${icon('i-clock')} 워크 모드 ${icon('i-chev-r','ic s')}</a><a href="#/schedule">${icon('i-cal')} 일정 ${icon('i-chev-r','ic s')}</a><a href="#/releases">${icon('i-bag')} 발매·특전 비교 ${icon('i-chev-r','ic s')}</a></div>
    </div>
  </div>`;
  const host=root.querySelector<HTMLElement>('.music-discovery')!;
  bindCommon(host,tracks,signal,()=>void renderMusicHome(root,context));
  mountHomeAwards(host,signal);
  bindHomeRecords(host,heroRecords,signal,()=>{playbackRequest++;});
  host.querySelectorAll<HTMLButtonElement>('[data-home-jump]').forEach(button=>button.addEventListener('click',()=>{
    const target=host.querySelector<HTMLElement>('#'+button.dataset.homeJump);
    if(!target)return;
    target.tabIndex=-1;
    target.focus({preventScroll:true});
    target.scrollIntoView({behavior:host.dataset.motion==='on'?'smooth':'auto',block:'start'});
  },{signal}));
  host.querySelector('[data-md-retry]')?.addEventListener('click',()=>void renderMusicHome(root,context),{signal});
  host.querySelectorAll<HTMLButtonElement>('[data-md-browse]').forEach(button=>button.addEventListener('click',()=>{
    const selected=button.dataset.mdBrowse!;
    host.querySelectorAll<HTMLElement>('[data-md-section]').forEach(section=>section.hidden=selected!=='all'&&section.dataset.mdSection!==selected);
    host.querySelector<HTMLElement>('.md-utility-links')?.toggleAttribute('hidden',selected!=='all');
    host.querySelectorAll('[data-md-browse]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  },{signal}));
  void bindVisual(host,rows,'home',signal);
}

export async function renderMusicChart(root: HTMLElement, context: Context, requested='combined') {
  const {token,signal}=start(root),country=storedCountry();
  const source=!Object.hasOwn(LABELS,requested)||country==='kr' && ['billboard','oricon'].includes(requested) || country==='jp'&&['melon','genie'].includes(requested) ? 'combined' : requested;
  if(source!==requested&&location.hash.startsWith('#/chart')) history.replaceState(null,'',location.pathname+location.search+'#/chart/'+source);
  const [data, assets]=await Promise.all([chart(country,source),source==='combined'?Promise.resolve(null):chart(country,'combined')]);
  if(token!==generation||signal.aborted||!root.isConnected)return;
  const rows=withArtwork(safeList(data),safeList(assets)),selectedArtists=artistSelections(context,rows);
  const rookieKeys=new Set(selectedArtists.filter(a=>rookieEvidence(a.artist.id,DEBUT_EVIDENCE)).flatMap(a=>a.tracks.map(trackKey)));
  const spotKeys=new Set(spotlightTracks(rows.filter(r=>r.rank>10),6).map(trackKey));
  const tracks=new Map(rows.map((r,i)=>[String(i),r]));
  const top=rows[0];
  const available=['combined',...(Array.isArray(data?.sources)?data.sources:country==='jp'?['billboard','oricon','apple','appleRss','youtube']:['melon','genie','apple','appleRss','youtube'])].filter((s,i,a)=>a.indexOf(s)===i).sort((a,b)=>a==='combined'?-1:b==='combined'?1:PRIORITY.indexOf(a)-PRIORITY.indexOf(b));
  const hasChanges=rows.some(r=>rankMovement(r).kind!=='unknown');
  const hasCrossSource=rows.some(r=>sourceFamilies(r).length>0);
  root.innerHTML=`<div class="music-discovery md-chart">
    <header class="md-page-head"><h1>차트</h1><div class="md-head-tools"><span class="md-preview-label">30초 미리듣기</span>${countryControl(country)}${motionControl()}</div></header>
    <nav class="md-source-tabs" aria-label="차트 출처">${available.map(s=>`<a href="#/chart/${s}" ${source===s?'aria-current="page"':''}>${esc(LABELS[s]||s)}</a>`).join('')}</nav>
    <p class="md-chart-date">${esc(sourceInfo(data))}</p>
    ${top?`<div class="md-chart-feature"><section class="md-chart-lead" aria-label="차트 ${top.rank}위"><div class="md-chart-lead-copy"><div class="md-hero-label"><span>${top.rank}위</span>${esc(LABELS[source]||source)}</div><h2>${esc(top.title)}</h2><p>${esc(top.artist)}</p><div class="md-chart-change">${rankMovement(top).kind==='unknown'?'':movement(top)}</div><button type="button" class="md-primary" data-md-play="0">${icon('i-play')} 미리듣기</button></div>${visual([top])}</section><div class="md-chart-runners">${rows.slice(1,3).map((r,i)=>`<button type="button" class="md-runner" data-md-play="${i+1}" aria-label="${r.rank}위 ${esc(r.title)} 미리듣기"><span class="md-runner-rank">${r.rank}</span><span class="md-runner-art">${cover(r,200)}</span><span class="md-runner-info"><strong>${esc(r.title)}</strong><small>${esc(r.artist)}</small>${movement(r)}</span><span class="md-inline-play">${icon('i-play','ic s')}</span></button>`).join('')}</div></div>`:''}
    <section class="md-chart-list" aria-label="차트 곡 목록"><div class="md-chart-toolbar"><button type="button" class="md-primary" id="mdPlayChart" aria-label="현재 목록 상위 8곡 미리듣기" ${rows.length?'':'disabled'}>${icon('i-play')} <span class="md-desktop-text">상위 8곡 미리듣기</span><span class="md-mobile-text">8곡 듣기</span></button><button type="button" class="md-shuffle" id="mdShuffle" aria-label="현재 목록 셔플 미리듣기" ${rows.length?'':'disabled'}>${icon('i-shuffle')}</button><label class="md-chart-search">${icon('i-search','ic s')}<input type="search" id="mdChartSearch" aria-label="차트에서 곡·아티스트 찾기" placeholder="곡, 아티스트 검색"></label></div>
      <div class="md-filter-bar" role="group" aria-label="차트 필터">${[['all','전체',rows.length],['up','상승',hasChanges?risingTracks(rows,100).length:null],['new','신규 진입',hasChanges?newEntryTracks(rows,100).length:null],['spotlight','주목',hasCrossSource?spotKeys.size:null],['rookie','신인',rookieKeys.size]].map(([id,label,count])=>`<button type="button" data-md-filter="${id}" aria-pressed="${id==='all'}">${label}<span>${count===null?'정보 없음':count}</span></button>`).join('')}</div>
      <div class="md-list-caption"><span id="mdChartCount" role="status" aria-live="polite"></span><span>변동은 출처 차트 전회 대비</span></div><div id="mdChartRows"></div>
    </section>
    <details class="md-chart-method"><summary>집계·표시 기준 ${icon('i-chev-r','ic s')}</summary><div><p>${esc(data?.method||'차트 수집 정보를 확인할 수 없습니다.')}</p><p>수집 시각은 원본 차트의 발표 시각과 다를 수 있습니다. 상승·하락·신규 진입은 출처가 제공한 비교 정보가 있을 때만 표시합니다. YouTube 조회수는 누적값입니다.</p><p>주목은 현재 차트 TOP 10 밖에서 서로 다른 차트 2곳 이상 진입한 곡 중 출처 수가 많은 최대 6곡입니다. 동률이면 현재 순위순입니다. Apple Music과 Apple 공식 피드는 한 출처로 계산하며, 같은 곡 풀의 누적 조회수로 만든 YouTube 순위는 교차 출처 수에서 제외합니다.</p><p>신인은 공식 데뷔 2년 이내로, 데뷔일을 확인한 아티스트만 표시합니다. 신규 진입과는 다른 분류입니다.</p>${selectedArtists.filter(a=>rookieEvidence(a.artist.id,DEBUT_EVIDENCE)).map(a=>{const d=rookieEvidence(a.artist.id,DEBUT_EVIDENCE)!;return `<a href="${esc(d.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(a.artist.name)} · ${d.date} 정식 데뷔 · ${esc(d.sourceLabel)} ${icon('i-ext','ic s')}</a>`;}).join('')}</div></details>
  </div>`;
  const host=root.querySelector<HTMLElement>('.music-discovery')!;
  let filter='all',query='',visible=rows;
  function renderRows(){
    visible=rows.filter(r=>filter==='all'||filter==='up'&&rankMovement(r).kind==='up'||filter==='new'&&rankMovement(r).kind==='new'||filter==='spotlight'&&spotKeys.has(trackKey(r))||filter==='rookie'&&rookieKeys.has(trackKey(r))).filter(r=>`${r.title} ${r.artist}`.normalize('NFKC').toLowerCase().includes(query.normalize('NFKC').toLowerCase()));
    host.querySelector('#mdChartCount')!.textContent=`${visible.length}곡`;
    host.querySelector('#mdChartRows')!.innerHTML=visible.length?visible.map(r=>{
      const key=String(rows.indexOf(r));
      const ranks=Object.entries(r.ranks||{}).filter(([,rank])=>Number.isFinite(rank)&&Number(rank)>0);
      return `<div class="md-track-row"><span class="md-rank">${r.rank}${movement(r)}</span><button type="button" class="md-track-main" data-md-play="${key}" aria-label="${esc(r.title+' · '+r.artist)} 미리듣기"><span class="md-track-art">${cover(r,120)}<span>${icon('i-play','ic s')}</span></span><span class="md-track-copy"><strong>${esc(r.title)}</strong><small>${esc(r.artist)}</small><span class="md-track-tags">${rookieKeys.has(trackKey(r))?'<i class="md-tag rookie">신인</i>':''}${spotKeys.has(trackKey(r))?'<i class="md-tag">주목</i>':''}</span></span></button><div class="md-track-evidence">${ranks.length?`<details><summary>${ranks.length}개 출처</summary><div>${ranks.map(([s,n])=>`<span>${esc(LABELS[s]||s)} <b>${n}위</b></span>`).join('')}</div></details>`:''}${r.ytViews?`<small>YouTube 누적 ${new Intl.NumberFormat('ko',{notation:'compact',maximumFractionDigits:1}).format(r.ytViews)}회</small>`:''}</div><button type="button" class="md-row-queue" data-md-queue="${key}" aria-label="${esc(r.title)} 대기열에 추가">${icon('i-plus','ic s')}</button><details class="md-row-menu"><summary aria-label="${esc(r.title)} 더 보기">···</summary><div><button type="button" data-md-like="${key}" aria-pressed="false">${icon('i-heart','ic s')} 좋아요</button>${r.youtubeId?`<button type="button" data-md-mv="${esc(r.youtubeId)}">${icon('i-ext','ic s')} 뮤직비디오</button>`:''}<a href="${searchHref(r.artist,r.title)}">${icon('i-search','ic s')} 곡 정보</a>${ranks.length?`<div class="md-menu-evidence">${ranks.map(([s,n])=>`<span>${esc(LABELS[s]||s)} ${n}위</span>`).join('')}</div>`:''}</div></details></div>`;
    }).join(''):`<div class="md-empty"><p>${!data?'차트를 불러오지 못했습니다.':!hasChanges&&['up','new'].includes(filter)?'이 차트는 이전 순위 정보를 제공하지 않습니다.':filter==='spotlight'&&!hasCrossSource?'이 차트는 교차 출처 순위를 제공하지 않습니다.':'조건에 맞는 곡이 없습니다.'}</p><button type="button" data-md-clear>필터 초기화</button></div>`;
    host.querySelector<HTMLButtonElement>('#mdPlayChart')!.disabled=!visible.length;
    host.querySelector<HTMLButtonElement>('#mdShuffle')!.disabled=!visible.length;
  }
  renderRows();bindCommon(host,tracks,signal,()=>void renderMusicChart(root,context,source));
  host.addEventListener('click',event=>{const button=(event.target as Element).closest<HTMLButtonElement>('button');if(!button)return;
    if(button.dataset.mdFilter){filter=button.dataset.mdFilter;host.querySelectorAll('[data-md-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderRows();}
    if(button.hasAttribute('data-md-clear')){filter='all';query='';host.querySelector<HTMLInputElement>('#mdChartSearch')!.value='';host.querySelectorAll<HTMLElement>('[data-md-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mdFilter==='all')));renderRows();}
  },{signal});
  host.querySelector<HTMLInputElement>('#mdChartSearch')!.addEventListener('input',event=>{query=(event.target as HTMLInputElement).value.trim();renderRows();},{signal});
  host.querySelector<HTMLButtonElement>('#mdPlayChart')!.addEventListener('click',event=>void playTracks(visible,event.currentTarget as HTMLButtonElement),{signal});
  host.querySelector<HTMLButtonElement>('#mdShuffle')!.addEventListener('click',event=>{const shuffled=[...visible];for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}void playTracks(shuffled,event.currentTarget as HTMLButtonElement);},{signal});
  void bindVisual(host,rows,'chart',signal);
}
