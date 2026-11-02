import { artistMarqueeHtml, mountArtistMarquee } from '../artist-marquee';
/* 홈 — 아티스트 단위 팬덤 서비스의 첫 화면.
 *  주 기능 다섯 가지(아티스트 커뮤니티 · 팬클럽 가입 · 공연 · 발매 · 굿즈 구매)로 바로 이어지게 구성한다.
 *  1) 아티스트별 현재 공식 프로필 2초 → 같은 아티스트 앨범·공연 이미지 2초
 *  2) 아티스트 이름으로 이어지는 탐색과 실제 가입·구매 도움
 *  3) 티켓 오픈·팬클럽 선행 마감 안내판
 *  4) 다가오는 공연 격자
 *  5) 팬클럽 가입(회비·해외 가입·한국어 화면·접수 중 선행)
 *  6) 새 앨범·싱글 → 판매처·특전 비교
 *  7) 커뮤니티(인기 글 · 활발한 아티스트 커뮤니티)
 *  8) 소식 · 차트 / 페스티벌 · 현지 공연 / 음악상
 *  크기는 고정하지 않는다(v2.css·home-v2.css 의 clamp/auto-fill). */
import { api } from '../../api';
import { state } from '../state';
import { t, getLocale } from '../i18n';
import { esc, icon, img, errorState, emptyState, money, fmtDay, safeImage, safeHref } from '../ui';
import { festCard, posterCard, chartRow, artistName, releaseCard } from '../cards';
import { ct } from '../cm-i18n';
import { when } from '../social';
import type { Concert, News, Release, ArtistLite, ChartEntry } from '../cards';
import { playList } from '../player';
import type { Track } from '../player';
import { homeAwardsHtml, mountHomeAwards } from '../../awards';
import { awardsUpdatesHtml, mountAwardsUpdates } from '../../awards/live';
import '../../awards/awards.css';
import { sharedServerClock, mountServerClock, ticketBoundaries, SERVER_CLOCK_LABELS } from '../server-clock';
import { homeTicketHtml, plannedTickets, updateTicketCountdowns } from '../home-tickets';
import { upcomingHomeEvents } from '../home-planning';
import { homeNewsHtml, mountHomeNews } from '../home-news';
import '../home-priorities.css';
import { homeCoverHtml, mountHomeCover, coverCandidateIds, coverSlides } from './home-cover';
import '../home-v2.css';

interface HomeData {
  edition: string;
  tickets: Concert[]; ticketsTotal: number;
  fanclub: Concert[]; fanclubTotal: number;
  visiting: Concert[]; visitingTotal: number;
  abroad: Concert[]; abroadTotal: number;
  festivals?: Concert[]; festivalsTotal?: number;
  news: News[]; newsTotal: number; newsCache: { state: string; updatedAt: string | null } | null;
  chart: { country: 'jp' | 'kr'; items: ChartEntry[] }[];
  releases: Release[]; coverReleases?:Release[]; coverConcerts?:Concert[]; artists: ArtistLite[]; coverArtists?: ArtistLite[]; portraitsPending?:boolean;
  classifying: number;
}
type Money = { v: number; cur: string } | null;
interface FanclubItem {
  artistId: string; artist: string; artistLatin?: string | null; artistKo?: string | null; photo?: string | null; image?: string | null;
  found: boolean; name: string | null; checkedAt?: string | null; platform?: string | null; overseas?: string; languages?: string[];
  fees?: { annual: number | null; monthly: number | null; currency: string; overseasAnnualUsd?: number | null; free?: boolean } | null;
  residence?: { jp?: { annual: Money; monthly: Money } | null; overseas?: { annual: Money; monthly: Money } | null } | null;
}

let lastHomeData:HomeData|null=null;
let calendarClockReady = false;
let homeAbort: AbortController | null = null;
let secAbort: AbortController | null = null;
let coverAbort: AbortController | null = null;
const ja = () => getLocale() === 'ja';
const L = (ko: string, jp: string) => (ja() ? jp : ko);

/* ---------- 섹션 공통 ---------- */
function head(title: string, href = '', more = t('more')) {
  return `<div class="sec-head"><h2>${esc(title)}</h2>${href ? `<a class="more" href="${href}">${esc(more)}</a>` : ''}</div>`;
}

/* 아티스트 홈 바로가기 — 원형 사진 + 배지(선행 접수 중 / 내한·来日 예정) */
function artistRow(d: HomeData) { return artistMarqueeHtml(d.artists); }

/* 팬클럽 가입 카드 — 나라 설정(에디션)에 맞는 회비, 해외 가입·한국어 화면, 지금 열린 선행 수 */
function feeOf(f: FanclubItem) {
  const ed = state.edition;
  const r = ed === 'jp' ? f.residence?.jp : f.residence?.overseas || f.residence?.jp;
  const a = r?.annual || (f.fees?.annual ? { v: f.fees.annual, cur: f.fees.currency } : null);
  const m = r?.monthly || (f.fees?.monthly ? { v: f.fees.monthly, cur: f.fees.currency } : null);
  if (f.fees?.free) return L('무료', '無料');
  if (a) return `${money(a.v, a.cur)}<small>/${L('년', '年')}</small>`;
  if (m) return `${money(m.v, m.cur)}<small>/${L('월', '月')}</small>`;
  return L('회비 미확인', '会費未確認');
}
function fanclubCard(f: FanclubItem, open: number) {
  const overseas = f.overseas === 'yes';
  const overseasLabel = overseas ? L('해외 가입 가능 안내', '海外入会の案内あり') : f.overseas === 'no' ? L('해외 가입 제한 안내', '海外入会制限の案内あり') : L('해외 조건 미확인', '海外条件は未確認');
  const koUi = (f.languages || []).includes('한국어');
  const fee = feeOf(f);
  return `<li><a class="h-fc" href="#/fanclub/${encodeURIComponent(f.artistId)}">
    ${img(f.image || f.photo, '', 'square', { ratio: '4/3', initial: f.artist })}
    <span class="h-fc-body">
      <span class="h-fc-artist">${esc(artistName({ name: f.artist, nameOriginal: f.artistLatin || null }))}</span>
      <b class="h-fc-name">${esc(f.name || L('공식 팬클럽', '公式ファンクラブ'))}</b>
      <span class="h-fc-tags"><span class="v2-tag${overseas ? ' is-accent' : ''}">${overseasLabel}</span>${koUi ? `<span class="v2-tag">${L('한국어 화면', '韓国語あり')}</span>` : ''}${open ? `<span class="v2-tag is-hot">${L(`선행 접수 ${open}`, `先行受付 ${open}`)}</span>` : ''}</span>
      ${f.checkedAt ? `<small class="h-fc-checked">${L('원문 수집','原文取得')} ${esc(fmtDay(f.checkedAt.slice(0,10),{year:true}))}</small>` : ''}
    </span>
    <span class="h-fc-side">${fee ? `<span class="h-fc-fee">${fee}</span>` : ''}<span class="h-fc-go">${L('조건·입력 도움', '条件・入力サポート')}${icon('i-chev-r', 'ic xs')}</span></span>
  </a></li>`;
}

/* 전면 무대의 몰입감은 유지하고 실제 실행 도움은 바로 아래에 연결한다. */
function supportNavHtml() {
  const paths = [
    {url:'#/fanclub', icon:'i-heart', title:L('팬클럽 가입','ファンクラブ入会'), sub:L('아티스트별 조건·회비·입력 도움','アーティスト別の条件・会費・入力サポート')},
    {url:'#/goods', icon:'i-bag', title:L('앨범·굿즈 구매','アルバム・グッズ購入'), sub:L('상품 사진부터 판매처별 구매 절차까지','商品写真から販売店ごとの購入手順まで')},
    {url:'#/assist', icon:'i-globe', title:L('한일 번역·입력 도움','日韓翻訳・入力サポート'), sub:L('공개 원문 번역·국가번호·가나 형식','公開原文の翻訳・国番号・カナ形式')},
    {url:'#/community', icon:'i-users', title:L('아티스트 커뮤니티','アーティストコミュニティ'), sub:L('같은 아티스트를 좋아하는 팬들과','同じアーティストを好きなファンと')},
  ];
  return '<nav class="h-shortcuts" aria-label="'+L('팬 활동 바로가기','ファン活動へのショートカット')+'">'+paths.map(p=>'<a href="'+p.url+'">'+icon(p.icon)+'<span><b>'+p.title+'</b><small>'+p.sub+'</small></span>'+icon('i-chev-r','ic xs')+'</a>').join('')+'</nav>';
}

function sectionsHtml(d: HomeData) {
  const ed = state.edition, now = sharedServerClock().now();
  // No device-clock filtering: pending discovery is recomputed on the first server sync.
  const events = (rows:Concert[]) => now === null ? rows : upcomingHomeEvents(rows,now);
  const visList = events(d.visiting.filter(x => !x.unconfirmed));
  const festivals = events(d.festivals || []);
  const abroad = events(d.abroad);
  const ch = d.chart.find(c=>c.country==='jp') || d.chart[0];
  const opens = plannedTickets([...d.fanclub, ...d.tickets]);
  return `
    <section class="sec h-ticket-priority" id="secTickets">${head(L('티켓 오픈 · 팬클럽 선행','チケット発売・FC先行'),'#/concerts/tickets')}
      <div class="home-ticket-clock"></div><p class="home-ticket-method">${L('Lilac 서버 KST 기준. 남은 시간은 접수 일정이며, 매진·실제 접수 여부는 예매처에서 확인하세요.','LilacサーバーKST基準。残り時間は受付予定です。完売・実際の受付状況は販売サイトでご確認ください。')}</p>
      <div class="home-ticket-board">${homeTicketHtml(opens,now)}</div><p class="home-ticket-refresh" role="status"></p>
    </section>
    <section class="sec" id="secVisiting">${head(t(`home.visiting.${ed}`), '#/concerts/visiting')}
      ${visList.length ? `<ul class="v2-grid h-posters" style="--min:clamp(148px,13vw,210px)">${visList.slice(0, 6).map(c => `<li>${posterCard(c)}</li>`).join('')}</ul>` : emptyState(d.classifying ? t('c.classifying', { n: d.classifying }) : t('empty.generic'))}
    </section>
    ${festivals.length ? `<section class="sec" id="secFest">${head(L('한국·일본 음악 페스티벌', '韓国・日本の音楽フェス'), '#/concerts/festivals')}<ul class="v2-rail" style="--col:clamp(150px,19vw,240px)">${festivals.slice(0, 8).map(c => `<li>${festCard(c)}</li>`).join('')}</ul></section>` : ''}
    ${abroad.length ? `<section class="sec" id="secAbroad">${head(t(`home.abroad.${ed}`), '#/concerts/abroad')}<ul class="v2-rail" style="--col:clamp(150px,19vw,240px)">${abroad.slice(0, 8).map(c => `<li>${posterCard(c)}</li>`).join('')}</ul></section>` : ''}
    <div class="h-discovery-row">
      <section class="sec" id="secNews">${head(t('home.news'),'#/news')}${homeNewsHtml()}</section>
      <aside class="sec h-chart" id="secChart" aria-label="${ch?.country==='kr'?L('한국 차트 TOP 10','韓国チャート TOP 10'):L('일본 차트 TOP 10','日本チャート TOP 10')}">${head(ch?.country==='kr'?L('한국 차트 TOP 10','韓国チャート TOP 10'):L('일본 차트 TOP 10','日本チャート TOP 10'),'#/chart/'+(ch?.country||'jp'))}${ch?.items.length?`<ol class="clist compact">${ch.items.slice(0,10).map((e,i)=>chartRow(e,i,{compact:true})).join('')}</ol>`:emptyState(t('empty.generic'))}</aside>
    </div>
    <section class="sec h-fcs" id="secFanclub">${head(L('팬클럽 가입', 'ファンクラブ入会'), '#/fanclub', L('팬클럽 전체', 'すべて見る'))}
      <p class="h-fc-intro">${L('아티스트별로 조건과 회비, 실제 원문과 입력 도움을 확인하세요.','アーティストごとの条件・会費と、原文・入力サポートを確認。')}</p><ul class="h-fc-list" aria-busy="true"><li class="sk sk-line"></li></ul>
    </section>
    ${d.releases.length ? `<section class="sec" id="secReleases">${head(t('home.releases'), '#/goods')}<p class="h-release-note">${L('앨범 커버를 둘러보고, 상세에서 판매처별 상품 사진과 구매 절차를 확인하세요.','カバーを見て、詳細から販売店の商品写真と購入手順を確認。')}</p><div class="v2-grid h-releases" style="--min:clamp(132px,13vw,190px)">${d.releases.slice(0, 6).map(releaseCard).join('')}</div></section>` : ''}
    <div class="h-split" id="secTalkWrap"><section class="sec" id="secTalk">${head(ct('home.talk'), '#/community')}<div class="talk-body">${'<div class="sk sk-line"></div>'.repeat(5)}</div></section><section class="sec" id="secGals">${head(ct('home.gals'), '#/community/list')}<ol class="gal-rank">${'<li class="sk sk-line"></li>'.repeat(5)}</ol></section></div>
    ${supportNavHtml()}
    <form class="h-goods-search" role="search" action="#/goods"><label for="hGoodsQ">${L('굿즈·앨범 판매처 찾기', 'グッズ・CDの販売店を探す')}</label><div>${icon('i-search')}<input id="hGoodsQ" name="q" type="search" maxlength="80" placeholder="${L('아티스트·앨범명으로 판매처·가격 비교', 'アーティスト・作品名で販売店を比較')}" autocomplete="off"><button type="submit" class="v2-btn is-dark">${L('비교하기', '比較する')}</button></div></form>
    ${artistRow(d)}<div class="awards-wrap">${awardsUpdatesHtml()}${homeAwardsHtml()}</div>`;
}

export async function renderHome(root: HTMLElement, alive: () => boolean) {
  homeAbort?.abort();
  coverAbort?.abort();
  const ctrl = new AbortController();
  homeAbort = ctrl;
  const ed = state.edition;
  root.innerHTML = `<div class="cover-loading" aria-busy="true" aria-label="${L('메인 정보를 불러오는 중','メイン情報を読み込み中')}">Lilac</div>`;
  let d: HomeData;
  try {
    d = await api(`/api/live/home?edition=${ed}`);
  } catch {
    if (!alive() || ctrl.signal.aborted || homeAbort !== ctrl) return;
    root.innerHTML = errorState(t('err.generic'));
    root.querySelector('[data-retry]')?.addEventListener('click', () => renderHome(root, alive));
    return;
  }
  if (!alive() || ctrl.signal.aborted) return;
  calendarClockReady = sharedServerClock().now() !== null;
  d.portraitsPending = coverCandidateIds(d).length > 0;
  const stage = homeCoverHtml(d);
  root.innerHTML = stage + sectionsHtml(d);
  lastHomeData=d;
  secAbort?.abort();
  secAbort = new AbortController();
  bindSections(root, d, alive, secAbort.signal);
  mountCover(root,d,ctrl);
  void hydrateCover(root,d,ctrl,alive);
}

function mountCover(root:HTMLElement,d:HomeData,parent:AbortController) {
  coverAbort?.abort(); const own=new AbortController(); coverAbort=own;
  parent.signal.addEventListener('abort',()=>own.abort(),{once:true});
  mountHomeCover(root,d,own.signal);
}
async function hydrateCover(root:HTMLElement,d:HomeData,parent:AbortController,alive:()=>boolean) {
  const ids=coverCandidateIds(d); if(!ids.length)return;
  const before=JSON.stringify(coverSlides(d));
  const rows=[...d.artists,...(d.coverArtists||[])];
  const missing=ids.filter(id=>!rows.some(a=>{const p=a.portrait,age=Date.now()-Date.parse(p?.checkedAt||'');return a.id===id&&p?.artistId===id&&p.status==='verified'&&p.method==='official-profile'&&safeImage(p.imageUrl)&&safeHref(p.sourceUrl,false)&&age>=-60000&&age<86400000;}));
  if(!missing.length){d.portraitsPending=false;const empty=root.querySelector<HTMLElement>('.cover-empty');if(empty)empty.outerHTML=homeCoverHtml(d);return;}
  const chunks=Array.from({length:Math.ceil(missing.length/12)},(_,i)=>missing.slice(i*12,i*12+12));
  const responses:{items?:{id:string;portrait?:ArtistLite['portrait']}[]}[]=new Array(chunks.length);
  let cursor=0;
  const worker=async()=>{while(cursor<chunks.length&&!parent.signal.aborted){const at=cursor++;try{responses[at]=await api('/api/live/portraits?ids='+chunks[at].map(encodeURIComponent).join(','),{signal:parent.signal});}catch{responses[at]={items:[]};}}};
  await Promise.all(Array.from({length:Math.min(3,chunks.length)},()=>worker()));
  const result={items:responses.flatMap(r=>r?.items||[])};
  if(!alive()||parent.signal.aborted||homeAbort!==parent)return;
  const updates=new Map((result.items||[]).filter(x=>ids.includes(x.id)&&x.portrait?.artistId===x.id).map(x=>[x.id,x.portrait]));
  const merge=(a:ArtistLite)=>updates.has(a.id)?{...a,portrait:updates.get(a.id)}:a;
  d.artists=d.artists.map(merge);d.coverArtists=d.coverArtists?.map(merge);d.portraitsPending=false;
  if(before===JSON.stringify(coverSlides(d))&&root.querySelector('.home-cover'))return;
  const old=root.querySelector<HTMLElement>('.home-cover,.cover-empty');if(!old)return;
  const paused=old.querySelector('[data-cover-motion]')?.getAttribute('aria-pressed')==='true';
  coverAbort?.abort();old.outerHTML=homeCoverHtml(d);mountCover(root,d,parent);
  if(paused)root.querySelector<HTMLButtonElement>('[data-cover-motion]')?.click();
}

/* 실시간 반영: 히어로는 그대로 두고 아래 섹션만 바꿔 끼운다 */
export async function refreshHome(root: HTMLElement, alive: () => boolean) {
  const ctrl = homeAbort;
  if (!ctrl || ctrl.signal.aborted) return;
  let d: HomeData;
  try { d = await api(`/api/live/home?edition=${state.edition}`); } catch { return; }
  if (!alive() || homeAbort !== ctrl || ctrl.signal.aborted) return;
  const previousCover=lastHomeData?JSON.stringify(coverSlides(lastHomeData)):null;
  if(previousCover!==JSON.stringify(coverSlides(d))){
    const old=root.querySelector<HTMLElement>('.home-cover,.cover-empty');
    if(old){const paused=old.querySelector('[data-cover-motion]')?.getAttribute('aria-pressed')==='true';coverAbort?.abort();old.outerHTML=homeCoverHtml(d);mountCover(root,d,ctrl);if(paused)root.querySelector<HTMLButtonElement>('[data-cover-motion]')?.click();}
  }
  lastHomeData=d;
  const box = document.createElement('div');
  box.innerHTML = sectionsHtml(d);
  secAbort?.abort();
  secAbort = new AbortController();
  Array.from(root.children).forEach((el) => { if (!el.classList.contains('home-cover') && !el.classList.contains('cover-empty') && !el.classList.contains('sr-only')) el.remove(); });
  root.append(...Array.from(box.childNodes));
  bindSections(root, d, alive, secAbort.signal);
}

function bindSections(root: HTMLElement, d: HomeData, alive: () => boolean, signal: AbortSignal) {
  mountArtistMarquee(root,signal);
  const ch = d.chart.find(c=>c.country==='jp') || d.chart[0];
  if (ch) {
    const tracks: Track[] = ch.items.map((e) => ({ title: e.title, artist: e.artist, artwork: e.artwork, appleUrl: e.appleUrl }));
    root.querySelector('#secChart')?.querySelectorAll<HTMLElement>('[data-play]').forEach((b) => b.addEventListener('click', () => playList(tracks, Number(b.dataset.play)), { signal }));
  }
  const live = () => alive() && !signal.aborted;
  void paintTalk(root, state.edition, live);
  void paintFanclubs(root, d, live);
  const form = root.querySelector<HTMLFormElement>('.h-goods-search');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = (form.querySelector('input') as HTMLInputElement).value.trim();
    location.hash = q ? `#/goods?q=${encodeURIComponent(q)}` : '#/goods';
  }, { signal });
  const newsHost = root.querySelector<HTMLElement>('#secNews');
  if(newsHost)mountHomeNews(newsHost,d.news,d.artists,signal,live);
  const clock=sharedServerClock(),board=root.querySelector<HTMLElement>('.home-ticket-board');
  const clockHost=root.querySelector<HTMLElement>('.home-ticket-clock');
  if(clockHost)mountServerClock(clockHost,clock,{signal,labels:SERVER_CLOCK_LABELS[ja()?'ja':'ko']});
  let ticketItems=plannedTickets([...d.fanclub,...d.tickets]),unwatch=()=>{},pending=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const paint=()=>{if(live()&&board)board.innerHTML=homeTicketHtml(ticketItems,clock.now(),clock.state().uncertaintyMs||0);};
  const arm=()=>{unwatch();unwatch=clock.watch(ticketBoundaries(ticketItems),()=>{paint();void revalidate();},{signal});};
  const revalidate=async()=>{if(pending||!live())return;pending=true;
    const status=root.querySelector<HTMLElement>('.home-ticket-refresh');if(status)status.textContent=L('티켓 원문 수집 정보를 다시 확인하는 중','チケットの取得情報を再確認中');
    try{const r=await api('/api/live/tickets?edition='+d.edition,{signal});if(!live())return;if(!Array.isArray(r.items))throw Error('invalid ticket response');ticketItems=plannedTickets(r.items);paint();arm();if(status)status.textContent=L('일정 갱신 완료 · 좌석·접수 여부는 예매처 확인','予定を更新しました。空席・受付状況は販売サイトでご確認ください。');}
    catch{if(live()&&status)status.textContent=L('최신 정보 조회 실패 · 표시된 일정과 원문을 확인하세요.','最新情報の取得に失敗しました。表示済みの予定と原文をご確認ください。');}
    finally{pending=false;}
  };
  let tickPhase='';
  const tick=()=>{if(timer)clearTimeout(timer);if(!live()||document.visibilityState==='hidden')return;updateTicketCountdowns(board!,ticketItems,clock.now(),clock.state().uncertaintyMs||0);timer=setTimeout(tick,1000-((clock.now()??0)%1000)+5);};
  const refreshClock=()=>{const phase=clock.now()===null?'unknown':'known';if(phase!==tickPhase){tickPhase=phase;paint();if(phase==='known'&&!calendarClockReady){calendarClockReady=true;void refreshHome(root,alive);}}tick();};
  if(board){paint();arm();clock.onChange(refreshClock,{signal});clock.onDayChange(()=>{void refreshHome(root,alive);},{signal});refreshClock();document.addEventListener('visibilitychange',refreshClock,{signal});}
  signal.addEventListener('abort',()=>{if(timer)clearTimeout(timer);unwatch();},{once:true});
  const aw = root.querySelector<HTMLElement>('.awards-wrap');
  if (aw) { mountHomeAwards(aw, signal); mountAwardsUpdates(aw, signal); }
}

/* 팬클럽 가입 — 가입 정보가 확인된 팬클럽만. 해외 가입 가능 → 선행 접수 중 → 한국어 화면 순 */
async function paintFanclubs(root: HTMLElement, d: HomeData, alive: () => boolean) {
  const r = (await api(`/api/live/fanclub-list?edition=${state.edition}`).catch(() => null)) as { items: FanclubItem[] } | null;
  if (!alive()) return;
  const sec = root.querySelector<HTMLElement>('#secFanclub');
  const box = sec?.querySelector('.h-fc-list');
  if (!sec || !box) return;
  const openBy = new Map<string, number>();
  for (const c of d.fanclub) if (c.artistId) openBy.set(c.artistId, (openBy.get(c.artistId) || 0) + 1);
  const score = (f: FanclubItem) => (f.overseas === 'yes' ? 4 : 0) + (openBy.get(f.artistId) ? 2 : 0) + ((f.languages || []).includes('한국어') ? 1 : 0);
  const list = (r?.items || []).filter((f) => f.found).sort((a, b) => score(b) - score(a)).slice(0, 6);
  box.setAttribute('aria-busy','false');
  if (!list.length) { box.innerHTML = `<li class="h-fc-unavailable">${L('가입 정보를 불러오지 못했습니다. 팬클럽 검색에서 다시 확인하세요.','入会情報を取得できませんでした。ファンクラブ検索から確認してください。')}</li>`; return; }
  box.innerHTML = list.map((f) => fanclubCard(f, openBy.get(f.artistId) || 0)).join('');
  sec.hidden = false;
}

/* 커뮤니티 — 개념글이 있으면 개념글, 없으면 새 글. 옆에는 활발한 아티스트 커뮤니티 */
async function paintTalk(root: HTMLElement, ed: string, alive: () => boolean) {
  const [hub, gals] = await Promise.all([
    api(`/api/community/hub?edition=${ed}`).catch(() => null),
    api(`/api/community/galleries?edition=${ed}`).catch(() => null),
  ]);
  if (!alive()) return;
  const box = root.querySelector('#secTalk .talk-body');
  const rank = root.querySelector('#secGals .gal-rank');
  if (!box || !rank) return;
  type R = { board: string; no: number; head: string; title: string; cmt: number; up: number; at: string; gallery?: { id: string; kind: string; artist?: { name: string; nameOriginal?: string | null } } };
  const best: R[] = hub?.best || [];
  const rows: R[] = (best.length >= 3 ? best : hub?.recent || []).slice(0, 6);
  if (best.length >= 3) root.querySelector('#secTalk h2')!.textContent = ct('home.talkBest');
  const gname = (g: R['gallery']) => (!g ? '' : g.kind === 'general' ? ct(`g.${g.id}` as never) : artistName(g.artist as { name: string }));
  box.innerHTML = rows.length
    ? `<ul class="mini-list">${rows.map((x) => `<li><a href="#/community/${encodeURIComponent(x.board)}/${x.no}"><span class="mh">${esc(gname(x.gallery))}</span><span class="mt">${esc(x.title)}</span>${x.cmt ? `<em class="rc">[${x.cmt}]</em>` : ''}</a><span class="mu">${x.up ? `${icon('i-up', 'ic xs')}${x.up}` : ''}</span><time>${esc(when(x.at))}</time></li>`).join('')}</ul>`
    : `<div class="h-talk-empty"><p>${esc(ct('home.talkEmpty'))}</p><a class="v2-btn is-primary" href="#/community">${L('커뮤니티 둘러보기', 'コミュニティへ')}</a></div>`;
  const top: { id: string; artist: { name: string; nameOriginal?: string | null; photo?: string | null; artwork?: string | null }; posts: number; week: number }[] = (gals?.items || []).slice(0, 6);
  rank.innerHTML = top.map((g, i) => `<li><span class="rk">${i + 1}</span><a href="#/community/${encodeURIComponent(g.id)}">${img(g.artist.photo || g.artist.artwork, '', 'round', { ratio: '1/1', initial: g.artist.name })}<b>${esc(artistName(g.artist))}</b></a><em>${g.posts ? esc(ct('gal.posts', { n: g.posts })) : ''}</em></li>`).join('');
}

export function leaveHome() {
  homeAbort?.abort();
  homeAbort = null;
  lastHomeData=null;
  secAbort?.abort();
  secAbort = null;
  coverAbort?.abort();
  coverAbort = null;
}
