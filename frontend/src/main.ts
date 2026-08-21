import './style.css';
import { initMusicKitIfConfigured } from './musickit';

// ---------- 타입 ----------
interface Artist { id: string; name: string; nameJa: string; genre: string; searchTerm: string; }
interface SeedTrack { id: string; title: string; artist: string; tag: string; youtubeId: string | null; searchTerm: string; }
interface CatalogTrack { id: number; title: string; artist: string; album: string; artwork: string; preview: string; appleUrl: string; }
interface Ev { id: string; type: string; title: string; artist: string; date: string; venue: string; note: string; }
interface Product { id: string; name: string; brand: string; price: number; badge: string; searchTerm: string; }

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const api = (path: string) => fetch(path).then((r) => r.json());
const esc = (s: string) => s.replace(/"/g, '&quot;').replace(/</g, '&lt;');
const icon = (id: string, cls = 'ic') => `<svg class="${cls}"><use href="#${id}"/></svg>`;

// ---------- 카탈로그 캐시 ----------
const catalogCache = new Map<string, CatalogTrack | null>();
async function findCatalog(term: string): Promise<CatalogTrack | null> {
  if (catalogCache.has(term)) return catalogCache.get(term)!;
  try {
    const { tracks } = await api(`/api/catalog/search?term=${encodeURIComponent(term)}&limit=3`);
    const hit = (tracks as CatalogTrack[]).find((t) => t.preview) ?? (tracks as CatalogTrack[])[0] ?? null;
    catalogCache.set(term, hit);
    return hit;
  } catch { return null; }
}
const artUrl = (t: CatalogTrack | null, size = 400) =>
  t?.artwork ? t.artwork.replace('400x400', `${size}x${size}`) : '';

// ---------- 토스트 ----------
const toastEl = document.createElement('div');
toastEl.className = 'toast';
document.body.appendChild(toastEl);
let toastTimer: number;
function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// ---------- 플레이어 ----------
const audio = $('#audio') as unknown as HTMLAudioElement;
audio.volume = 0.7;
let nowRow: HTMLElement | null = null;
let queue: { title: string; artist: string; artwork?: string; preview?: string; el?: HTMLElement }[] = [];
let queueIdx = -1;

function setPlayIcon(playing: boolean) {
  $('#playIcon').innerHTML = `<use href="#${playing ? 'i-pause' : 'i-play'}"/>`;
}
function markNowPlaying(el?: HTMLElement | null) {
  nowRow?.classList.remove('playing');
  nowRow?.querySelector('.np-eq')?.remove();
  nowRow = el ?? null;
  if (nowRow) {
    nowRow.classList.add('playing');
    const rank = nowRow.querySelector('.rank');
    if (rank) rank.innerHTML = `<span class="np-eq"><i></i><i></i><i></i></span>`;
  }
}
function play(t: { title: string; artist: string; artwork?: string; preview?: string; el?: HTMLElement }) {
  if (!t.preview) { toast('미리듣기를 제공하지 않는 곡입니다'); return; }
  audio.src = t.preview;
  void audio.play();
  $('#player').classList.add('show');
  $('#playerTitle').textContent = t.title;
  $('#playerArtist').textContent = t.artist;
  ($('#playerArt')).style.backgroundImage = t.artwork ? `url(${t.artwork})` : '';
  setPlayIcon(true);
  markNowPlaying(t.el);
  startLyricsDemo();
}
function playQueue(list: typeof queue, idx: number) {
  queue = list; queueIdx = idx;
  play(queue[idx]);
}
$('#btnPlay').addEventListener('click', () => {
  if (!audio.src) return;
  if (audio.paused) { void audio.play(); setPlayIcon(true); }
  else { audio.pause(); setPlayIcon(false); }
});
$('#btnPrev').addEventListener('click', () => { if (queueIdx > 0) playQueue(queue, queueIdx - 1); });
$('#btnNext').addEventListener('click', () => { if (queueIdx >= 0 && queueIdx < queue.length - 1) playQueue(queue, queueIdx + 1); });
audio.addEventListener('timeupdate', () => {
  const d = audio.duration || 30;
  ($('#progressFill')).style.width = `${(audio.currentTime / d) * 100}%`;
  const f = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  $('#tCur').textContent = f(audio.currentTime);
  $('#tDur').textContent = f(d);
});
audio.addEventListener('ended', () => {
  if (queueIdx >= 0 && queueIdx < queue.length - 1) playQueue(queue, queueIdx + 1);
  else { setPlayIcon(false); markNowPlaying(null); }
});
$('#progressBar').addEventListener('click', (e) => {
  const r = $('#progressBar').getBoundingClientRect();
  audio.currentTime = (((e as MouseEvent).clientX - r.left) / r.width) * (audio.duration || 30);
});
$('#volBar').addEventListener('click', (e) => {
  const r = $('#volBar').getBoundingClientRect();
  const v = Math.min(1, Math.max(0, ((e as MouseEvent).clientX - r.left) / r.width));
  audio.volume = v;
  ($('#volFill')).style.width = `${v * 100}%`;
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
    <div class="ly-line" data-i="${i}">
      <div class="jp">${l.jp}</div>
      <div class="romaji">${l.romaji}</div>
      <div class="ko">${l.ko}</div>
    </div>`).join('');
  clearInterval(lyricTimer);
  let idx = 0;
  const tick = () => {
    body.querySelectorAll('.ly-line').forEach((el) => el.classList.remove('now'));
    body.querySelector(`[data-i="${idx % DEMO_LINES.length}"]`)?.classList.add('now');
    idx++;
  };
  tick();
  lyricTimer = window.setInterval(tick, 3200);
}
$('#btnLyrics').addEventListener('click', () => $('#lyricsPanel').classList.toggle('show'));
$('#lyricsClose').addEventListener('click', () => $('#lyricsPanel').classList.remove('show'));

// ---------- 유튜브 모달 ----------
function openYt(videoId: string) {
  $('#ytFrameWrap').innerHTML =
    `<iframe src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="YouTube player"></iframe>`;
  $('#ytModal').classList.add('show');
  audio.pause(); setPlayIcon(false);
}
function closeYt() { $('#ytModal').classList.remove('show'); $('#ytFrameWrap').innerHTML = ''; }
$('#ytClose').addEventListener('click', closeYt);
$('#ytModal').addEventListener('click', (e) => { if (e.target === $('#ytModal')) closeYt(); });

// ---------- Apple Music 연동 ----------
$('#connectApple').addEventListener('click', async () => {
  const kit = await initMusicKitIfConfigured();
  if (kit) { toast('MusicKit 인증 완료'); $('#connectApple').classList.add('connected'); }
  else $('#appleModal').classList.add('show');
});
$('#appleClose').addEventListener('click', () => $('#appleModal').classList.remove('show'));
$('#appleDemoOk').addEventListener('click', () => {
  $('#appleModal').classList.remove('show');
  $('#connectApple').classList.add('connected');
  $('#connectApple').textContent = '연동됨 · 데모';
  toast('데모 모드: 30초 미리듣기로 재생됩니다');
});

// ---------- 렌더 ----------
async function main() {
  const [artists, seeds, events, products, oshiSaved]: [Artist[], SeedTrack[], Ev[], Product[], { artistId: string }[]] =
    await Promise.all([api('/api/db/artists'), api('/api/db/tracks'), api('/api/db/events'), api('/api/db/products'), api('/api/oshi')]);

  // --- 빌보드: 대표곡 아트워크 백드롭 ---
  const feat = seeds.find((s) => s.id === 't5') ?? seeds[0]; // ライラック
  findCatalog(feat.searchTerm).then((hit) => {
    if (hit) ($('#bbBackdrop')).style.backgroundImage = `url(${artUrl(hit, 1200)})`;
  });
  $('#heroPlay').addEventListener('click', async () => {
    const hit = await findCatalog(feat.searchTerm);
    if (hit) play({ title: hit.title, artist: hit.artist, artwork: artUrl(hit, 200), preview: hit.preview });
  });
  $('#heroMv').addEventListener('click', () => { if (feat.youtubeId) openYt(feat.youtubeId); });

  // --- 아티스트 서클 카드 ---
  const followSet = new Set(oshiSaved.map((o) => o.artistId));
  $('#artistShelf').innerHTML = artists.map((a) => `
    <button class="card round reveal ${followSet.has(a.id) ? 'following' : ''}" data-id="${a.id}" data-name="${esc(a.name)}" data-term="${esc(a.searchTerm)}">
      <span class="follow-state">${icon('i-check')}</span>
      <div class="cover"><div class="ph">${a.name[0]}</div></div>
      <div class="c-title">${a.name}</div>
      <div class="c-sub">아티스트</div>
    </button>`).join('');
  document.querySelectorAll<HTMLElement>('#artistShelf .card').forEach((el) => {
    // 아바타 = 대표곡 아트워크
    findCatalog(el.dataset.term!).then((hit) => {
      if (hit) el.querySelector('.cover')!.innerHTML = `<img src="${artUrl(hit, 300)}" alt="${el.dataset.name}" loading="lazy" />`;
    });
    el.addEventListener('click', async () => {
      const list = await fetch('/api/oshi', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artistId: el.dataset.id, name: el.dataset.name }),
      }).then((r) => r.json());
      const on = list.some((o: { artistId: string }) => o.artistId === el.dataset.id);
      el.classList.toggle('following', on);
      toast(on ? `${el.dataset.name} 팔로우 — db/user/oshi.json에 저장됨` : `${el.dataset.name} 팔로우 해제`);
    });
  });

  // --- 차트 리스트 ---
  const chartEl = $('#chartList');
  chartEl.innerHTML = seeds.map((s, i) => `
    <li class="chart-row reveal" id="row-${s.id}" data-term="${esc(s.searchTerm)}">
      <span class="rank">${i + 1}</span>
      <div class="art"><div class="overlay">${icon('i-play')}</div></div>
      <div class="meta">
        <div class="t">${s.title}</div>
        <div class="a">${s.artist}</div>
      </div>
      <div class="side">
        <span class="tagchip">${s.tag}</span>
        ${s.youtubeId ? `<button class="mv-link" data-yt="${s.youtubeId}" title="뮤직비디오">${icon('i-ext')}</button>` : ''}
      </div>
    </li>`).join('');

  const chartTracks: typeof queue = [];
  await Promise.all(seeds.map(async (s, i) => {
    const hit = await findCatalog(s.searchTerm);
    const row = $(`#row-${s.id}`);
    if (hit) {
      row.querySelector('.art')!.insertAdjacentHTML('afterbegin', `<img src="${artUrl(hit, 100)}" alt="" loading="lazy" />`);
      chartTracks[i] = { title: hit.title, artist: hit.artist, artwork: artUrl(hit, 200), preview: hit.preview, el: row };
    }
  }));
  chartEl.querySelectorAll<HTMLElement>('.chart-row').forEach((row, i) =>
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.mv-link')) return;
      if (chartTracks[i]) playQueue(chartTracks.filter(Boolean), chartTracks.filter(Boolean).indexOf(chartTracks[i]));
    }));
  chartEl.querySelectorAll<HTMLButtonElement>('.mv-link').forEach((btn) =>
    btn.addEventListener('click', () => openYt(btn.dataset.yt!)));

  // --- 둘러보기: 시드곡 스포티파이 카드 ---
  function renderShelf(tracks: CatalogTrack[], metaBy?: Map<number, string>) {
    const list: typeof queue = tracks.map((t) => ({ title: t.title, artist: t.artist, artwork: artUrl(t, 200), preview: t.preview }));
    $('#browseShelf').innerHTML = tracks.map((t, i) => `
      <div class="card" data-i="${i}">
        <div class="cover">
          <img src="${artUrl(t, 300)}" alt="" loading="lazy" />
          <button class="hover-play" title="미리듣기">${icon('i-play')}</button>
        </div>
        <div class="c-title">${esc(t.title)}</div>
        <div class="c-sub">${esc(metaBy?.get(t.id) ?? t.artist)}</div>
      </div>`).join('');
    document.querySelectorAll<HTMLElement>('#browseShelf .card').forEach((el) =>
      el.addEventListener('click', () => {
        const i = Number(el.dataset.i);
        playQueue(list.map((q, j) => ({ ...q, el: undefined })), i);
      }));
  }
  const browseSeed = (await Promise.all(seeds.map((s) => findCatalog(s.searchTerm)))).filter(Boolean) as CatalogTrack[];
  renderShelf(browseSeed);

  // --- 검색 ---
  const input = $('#searchInput') as HTMLInputElement;
  let debounce: number;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) {
        $('#browseTitle').textContent = '둘러보기';
        $('#browseSub').textContent = '검색하면 이 영역에 결과가 표시됩니다';
        renderShelf(browseSeed);
        return;
      }
      const { tracks } = await api(`/api/catalog/search?term=${encodeURIComponent(q)}&limit=10`);
      $('#browseTitle').textContent = `‘${q}’ 검색 결과`;
      $('#browseSub').textContent = `Apple Music 카탈로그 · ${tracks.length}곡`;
      renderShelf(tracks);
      document.getElementById('browse')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 420);
  });

  // --- 본진 이벤트 ---
  const today = new Date();
  $('#eventGrid').innerHTML = events.map((ev) => {
    const d = Math.ceil((new Date(ev.date).getTime() - today.getTime()) / 86400000);
    const dtxt = d > 0 ? `D-${d}` : d === 0 ? 'D-DAY' : '종료';
    return `
    <div class="ev-card reveal" data-artist="${esc(ev.artist)}">
      <div class="ev-bg"></div>
      <div class="ev-scrim"></div>
      <span class="ev-type">${ev.type}</span>
      <span class="ev-dday ${d >= 0 && d <= 14 ? 'urgent' : ''}">${dtxt}</span>
      <div class="ev-body">
        <div class="ev-title">${ev.title}</div>
        <div class="ev-info">${ev.date} · ${ev.venue}</div>
      </div>
    </div>`;
  }).join('');
  document.querySelectorAll<HTMLElement>('.ev-card').forEach((el) => {
    const a = artists.find((x) => x.name === el.dataset.artist);
    if (a) findCatalog(a.searchTerm).then((hit) => {
      if (hit) (el.querySelector('.ev-bg') as HTMLElement).style.backgroundImage = `url(${artUrl(hit, 600)})`;
    });
    el.addEventListener('click', () => toast('일정 상세는 데모에서 제공되지 않습니다'));
  });

  // --- 스토어 ---
  $('#storeGrid').innerHTML = products.map((p) => `
    <div class="p-card reveal" data-term="${esc(p.searchTerm)}">
      <div class="p-img"><span class="p-badge">${p.badge}</span></div>
      <div class="p-brand">${esc(p.brand)}</div>
      <div class="p-name">${esc(p.name)}</div>
      <div class="p-price">₩${p.price.toLocaleString()}</div>
    </div>`).join('');
  document.querySelectorAll<HTMLElement>('.p-card').forEach((el) => {
    findCatalog(el.dataset.term!).then((hit) => {
      if (hit) el.querySelector('.p-img')!.insertAdjacentHTML('beforeend', `<img src="${artUrl(hit, 400)}" alt="" loading="lazy" />`);
    });
    el.addEventListener('click', () => toast('결제는 데모에서 제공되지 않습니다'));
  });

  observeReveals();
}

// ---------- 스크롤 리빌 ----------
let observer: IntersectionObserver | null = null;
function observeReveals() {
  observer ??= new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('on'); observer!.unobserve(en.target); } });
  }, { threshold: 0.1 });
  document.querySelectorAll('.reveal:not(.on)').forEach((el) => observer!.observe(el));
}

main().catch((e) => {
  console.error(e);
  toast('백엔드 연결 실패 — npm run dev로 실행해 주세요');
});
