import './style.css';
import { initMusicKitIfConfigured } from './musickit';

// ---------- 타입 ----------
interface Artist { id: string; name: string; nameJa: string; genre: string; emoji: string; color: string; searchTerm: string; tags: string[]; }
interface SeedTrack { id: string; title: string; artist: string; tag: string; youtubeId: string | null; searchTerm: string; grad: string; }
interface CatalogTrack { id: number; title: string; artist: string; album: string; artwork: string; preview: string; appleUrl: string; }
interface Ev { id: string; type: string; title: string; artist: string; date: string; venue: string; note: string; }
interface Product { id: string; name: string; brand: string; price: number; badge: string; grad: string; }

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const api = (path: string) => fetch(path).then((r) => r.json());

// ---------- 토스트 ----------
const toastEl = document.createElement('div');
toastEl.className = 'toast';
document.body.appendChild(toastEl);
let toastTimer: number;
function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2400);
}

// ---------- 플레이어 (Apple Music 30초 프리뷰 인앱 재생) ----------
const audio = $('#audio') as unknown as HTMLAudioElement;
const player = $('#player');
const eq = $('#eq');
let currentCard: HTMLElement | null = null;

function playPreview(t: { title: string; artist: string; artwork?: string; preview?: string }, card?: HTMLElement) {
  if (!t.preview) { toast('이 곡은 프리뷰가 제공되지 않아요'); return; }
  audio.src = t.preview;
  audio.play();
  player.classList.add('show');
  eq.classList.add('on');
  $('#playerTitle').textContent = t.title;
  $('#playerArtist').textContent = `${t.artist} · Apple Music 프리뷰`;
  const art = $('#playerArt');
  art.style.backgroundImage = t.artwork ? `url(${t.artwork})` : '';
  ($('#btnPlay') as HTMLButtonElement).textContent = '❚❚';
  currentCard?.classList.remove('playing');
  currentCard = card ?? null;
  currentCard?.classList.add('playing');
  startLyricsDemo();
}

$('#btnPlay').addEventListener('click', () => {
  if (audio.paused) { audio.play(); ($('#btnPlay') as HTMLButtonElement).textContent = '❚❚'; eq.classList.add('on'); }
  else { audio.pause(); ($('#btnPlay') as HTMLButtonElement).textContent = '▶'; eq.classList.remove('on'); }
});
audio.addEventListener('timeupdate', () => {
  const d = audio.duration || 30;
  ($('#progressFill') as HTMLElement).style.width = `${(audio.currentTime / d) * 100}%`;
  const f = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  $('#ptime').textContent = `${f(audio.currentTime)} / ${f(d)}`;
});
audio.addEventListener('ended', () => { ($('#btnPlay') as HTMLButtonElement).textContent = '▶'; eq.classList.remove('on'); currentCard?.classList.remove('playing'); });
$('#progressBar').addEventListener('click', (e) => {
  const r = ($('#progressBar')).getBoundingClientRect();
  audio.currentTime = ((e as MouseEvent).clientX - r.left) / r.width * (audio.duration || 30);
});

// ---------- 가사 패널 (자체 제작 데모 문구 — 실제 가사 아님) ----------
const DEMO_LINES = [
  { jp: 'ここは Lilac のデモ画面', romaji: 'koko wa lilac no demo gamen', ko: '여기는 라일락 데모 화면' },
  { jp: '歌詞はライセンス契約の後で', romaji: 'kashi wa raisensu keiyaku no ato de', ko: '가사는 라이선스 계약 후에' },
  { jp: '原文・読み・翻訳の三段表示', romaji: 'genbun yomi honyaku no sandan hyouji', ko: '원문·독음·번역 3단 표시' },
  { jp: '推しに届く、一番近い道', romaji: 'oshi ni todoku ichiban chikai michi', ko: '오시에게 닿는 가장 가까운 길' },
];
let lyricTimer: number | undefined;
function startLyricsDemo() {
  const body = $('#lyricsBody');
  body.innerHTML = DEMO_LINES.map((l, i) => `
    <div class="lyric-line" data-i="${i}">
      <div class="jp">${l.jp}</div>
      <div class="romaji">${l.romaji}</div>
      <div class="ko">${l.ko}</div>
    </div>`).join('');
  clearInterval(lyricTimer);
  let idx = 0;
  const tick = () => {
    body.querySelectorAll('.lyric-line').forEach((el) => el.classList.remove('now'));
    body.querySelector(`[data-i="${idx % DEMO_LINES.length}"]`)?.classList.add('now');
    idx++;
  };
  tick();
  lyricTimer = window.setInterval(tick, 3200);
}
$('#btnLyrics').addEventListener('click', () => $('#lyricsPanel').classList.toggle('show'));
$('#lyricsClose').addEventListener('click', () => $('#lyricsPanel').classList.remove('show'));

// ---------- 유튜브 모달 (공식 임베드) ----------
function openYt(videoId: string) {
  $('#ytFrameWrap').innerHTML =
    `<iframe src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="YouTube player"></iframe>`;
  $('#ytModal').classList.add('show');
  audio.pause(); ($('#btnPlay') as HTMLButtonElement).textContent = '▶'; eq.classList.remove('on');
}
function closeYt() { $('#ytModal').classList.remove('show'); $('#ytFrameWrap').innerHTML = ''; }
$('#ytClose').addEventListener('click', closeYt);
$('#ytModal').addEventListener('click', (e) => { if (e.target === $('#ytModal')) closeYt(); });

// ---------- 애플뮤직 연동 모달 ----------
$('#connectApple').addEventListener('click', async () => {
  const kit = await initMusicKitIfConfigured();
  if (kit) { toast('MusicKit 인증 완료! 풀트랙 재생 가능'); ($('#connectApple')).classList.add('connected'); }
  else $('#appleModal').classList.add('show');
});
$('#appleClose').addEventListener('click', () => $('#appleModal').classList.remove('show'));
$('#appleDemoOk').addEventListener('click', () => {
  $('#appleModal').classList.remove('show');
  ($('#connectApple')).classList.add('connected');
  ($('#connectApple')).textContent = '🍎 데모 모드 (30초 프리뷰)';
  toast('데모 모드: 모든 ▶ 버튼이 30초 프리뷰로 재생됩니다');
});

// ---------- 데이터 로드 & 렌더 ----------
async function main() {
  const [artists, seeds, events, products, oshiSaved]: [Artist[], SeedTrack[], Ev[], Product[], { artistId: string }[]] =
    await Promise.all([api('/api/db/artists'), api('/api/db/tracks'), api('/api/db/events'), api('/api/db/products'), api('/api/oshi')]);

  // 마퀴
  $('#marquee').innerHTML = [...seeds, ...seeds].map((t) => `<span>♪ ${t.title} — <b>${t.artist}</b></span>`).join('');

  // 오시 링
  const savedSet = new Set(oshiSaved.map((o) => o.artistId));
  $('#oshiRow').innerHTML = artists.map((a) => `
    <button class="oshi ${savedSet.has(a.id) ? 'active' : ''}" data-id="${a.id}" data-name="${a.name}">
      <div class="ring"><div class="face">${a.emoji}</div></div>
      <div class="nm">${a.name}</div>
    </button>`).join('');
  document.querySelectorAll<HTMLElement>('.oshi').forEach((el) =>
    el.addEventListener('click', async () => {
      const list = await fetch('/api/oshi', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artistId: el.dataset.id, name: el.dataset.name }),
      }).then((r) => r.json());
      const on = list.some((o: { artistId: string }) => o.artistId === el.dataset.id);
      el.classList.toggle('active', on);
      toast(on ? `${el.dataset.name} 오시 등록! (db/user/oshi.json 저장됨)` : `${el.dataset.name} 오시 해제`);
    }));

  // 차트 카드: 시드 곡을 Apple Music 카탈로그에서 실데이터로 보강
  const row = $('#trackRow');
  row.innerHTML = seeds.map((s, i) => `
    <div class="tcard reveal" id="card-${s.id}" style="transition-delay:${i * 60}ms">
      <div class="art" style="background-image:${s.grad}"><span class="rank">${String(i + 1).padStart(2, '0')}</span></div>
      <div class="t">${s.title}</div>
      <div class="a">${s.artist}</div>
      <span class="tag-chip">${s.tag}</span>
      <div class="actions">
        <button class="play-mini preview" data-id="${s.id}">▶ 프리뷰</button>
        ${s.youtubeId ? `<button class="play-mini mv" data-yt="${s.youtubeId}">▷ MV</button>` : ''}
      </div>
    </div>`).join('');
  observeReveals();

  const catalogCache = new Map<string, CatalogTrack | null>();
  async function resolveCatalog(s: SeedTrack): Promise<CatalogTrack | null> {
    if (catalogCache.has(s.id)) return catalogCache.get(s.id)!;
    try {
      const { tracks } = await api(`/api/catalog/search?term=${encodeURIComponent(s.searchTerm)}&limit=3`);
      const hit = (tracks as CatalogTrack[]).find((t) => t.preview) ?? null;
      catalogCache.set(s.id, hit);
      return hit;
    } catch { return null; }
  }
  // 아트워크 미리 채우기
  seeds.forEach(async (s) => {
    const hit = await resolveCatalog(s);
    if (hit?.artwork) {
      const art = document.querySelector(`#card-${s.id} .art`) as HTMLElement;
      if (art) art.style.backgroundImage = `url(${hit.artwork})`;
    }
  });

  row.querySelectorAll<HTMLButtonElement>('.play-mini.preview').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const seed = seeds.find((s) => s.id === btn.dataset.id)!;
      btn.textContent = '…';
      const hit = await resolveCatalog(seed);
      btn.textContent = '▶ 프리뷰';
      if (hit) playPreview(hit, $(`#card-${seed.id}`));
      else toast('카탈로그에서 곡을 찾지 못했어요');
    }));
  row.querySelectorAll<HTMLButtonElement>('.play-mini.mv').forEach((btn) =>
    btn.addEventListener('click', () => openYt(btn.dataset.yt!)));

  // 히어로 재생 = 1위 곡
  $('#heroPlay').addEventListener('click', async () => {
    const hit = await resolveCatalog(seeds[0]);
    if (hit) playPreview(hit, $(`#card-${seeds[0].id}`));
  });

  // 본진 이벤트
  const today = new Date();
  $('#eventGrid').innerHTML = events.map((ev, i) => {
    const d = Math.ceil((new Date(ev.date).getTime() - today.getTime()) / 86400000);
    const dtxt = d > 0 ? `D-${d}` : d === 0 ? 'D-DAY' : `종료`;
    return `
    <div class="ecard reveal" style="transition-delay:${i * 70}ms">
      <div class="etype">${ev.type}</div>
      <div class="dday ${d <= 14 && d >= 0 ? 'soon' : ''}">${dtxt}</div>
      <div class="et">${ev.title}</div>
      <div class="ev">${ev.date} · ${ev.venue}</div>
      <div class="en">${ev.note}</div>
    </div>`;
  }).join('');

  // 굿즈
  const emojis = ['💿', '🧸', '📖', '🧣', '🃏', '🎞'];
  $('#goodsGrid').innerHTML = products.map((p, i) => `
    <div class="gcard reveal" style="transition-delay:${i * 60}ms">
      <div class="gimg" style="background:${p.grad}">
        <span class="gbadge">${p.badge}</span>
        <span class="gemoji">${emojis[i % emojis.length]}</span>
      </div>
      <div class="gname">${p.name}</div>
      <div class="gbrand">${p.brand}</div>
      <div class="gprice">₩${p.price.toLocaleString()}</div>
    </div>`).join('');
  document.querySelectorAll('.gcard').forEach((el) =>
    el.addEventListener('click', () => toast('커머스는 데모입니다 — 실서비스에서 예약 공구로 연결')));
  observeReveals();

  // 검색 → 디스커버리 (Apple Music 카탈로그 실시간)
  const input = $('#searchInput') as HTMLInputElement;
  let debounce: number;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(async () => {
      const q = input.value.trim();
      const grid = $('#discoverGrid');
      if (q.length < 2) { grid.innerHTML = `<div class="discover-empty">검색어를 입력하면 Apple Music 카탈로그에서 실시간으로 찾아옵니다 (JP 스토어)</div>`; return; }
      grid.innerHTML = `<div class="discover-empty">검색 중…</div>`;
      const { tracks } = await api(`/api/catalog/search?term=${encodeURIComponent(q)}&limit=9`);
      if (!tracks?.length) { grid.innerHTML = `<div class="discover-empty">결과가 없어요</div>`; return; }
      grid.innerHTML = (tracks as CatalogTrack[]).map((t) => `
        <div class="drow" data-preview="${t.preview ?? ''}" data-title="${t.title.replace(/"/g, '&quot;')}" data-artist="${t.artist.replace(/"/g, '&quot;')}" data-art="${t.artwork}">
          <div class="cover" style="background-image:url(${t.artwork})"></div>
          <div class="meta"><div class="t">${t.title}</div><div class="a">${t.artist} · ${t.album ?? ''}</div></div>
          <span class="go">▶</span>
        </div>`).join('');
      grid.querySelectorAll<HTMLElement>('.drow').forEach((el) =>
        el.addEventListener('click', () => playPreview({ title: el.dataset.title!, artist: el.dataset.artist!, artwork: el.dataset.art, preview: el.dataset.preview || undefined })));
      document.getElementById('discover')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 450);
  });
  $('#discoverGrid').innerHTML = `<div class="discover-empty">검색어를 입력하면 Apple Music 카탈로그에서 실시간으로 찾아옵니다 (JP 스토어)</div>`;
}

// ---------- 스크롤 리빌 ----------
let observer: IntersectionObserver | null = null;
function observeReveals() {
  observer ??= new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('on'); observer!.unobserve(en.target); } });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal:not(.on)').forEach((el) => observer!.observe(el));
}
observeReveals();

main().catch((e) => {
  console.error(e);
  toast('백엔드가 꺼져 있나요? `npm run dev`로 BE+FE를 함께 실행하세요');
});
