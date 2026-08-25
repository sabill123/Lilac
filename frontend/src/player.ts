import { api, esc, icon } from './api';
import type { PlayableTrack } from './api';
import { t } from './i18n';
import { applyMarquee, bindDragReorder, openContextMenu } from './interactions';
import { applyTone } from './colors';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function postNative(message: Record<string, unknown>) {
  const bridge = (window as unknown as { webkit?: { messageHandlers?: { lilac?: { postMessage: (v: unknown) => void } } } }).webkit;
  bridge?.messageHandlers?.lilac?.postMessage(message);
}

let toastTimer: number;
export function toast(msg: string) {
  const el = $('.toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2400);
}

let audio: HTMLAudioElement;
let queue: PlayableTrack[] = [];
let queueIdx = -1;
let shuffle = false;
let repeat: 'off' | 'all' | 'one' = 'off';
let likeKeys = new Set<string>();
const keyOf = (tr: PlayableTrack) => (tr.title + '|' + (tr.artist || '')).toLowerCase().replace(/\s/g, '');

export const nowPlaying = () => (queueIdx >= 0 ? queue[queueIdx] : null);
export async function loadLikes() {
  const list = await api('/api/likes').catch(() => []);
  likeKeys = new Set(list.map((x: { key: string }) => x.key));
}
export const isLiked = (tr: PlayableTrack) => likeKeys.has(keyOf(tr));

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function setPlayIcon(playing: boolean) {
  $('#playIcon').innerHTML = `<use href="#${playing ? 'i-pause' : 'i-play'}"/>`;
  document.body.classList.toggle('playing', playing);
  const tr = nowPlaying();
  if (tr) postNative({ type: 'nowPlaying', title: tr.title, artist: tr.artist, playing });
}

function renderNow() {
  const tr = nowPlaying();
  if (!tr) return;
  $('#playerTitle').textContent = tr.title;
  $('#playerArtist').textContent = tr.artist;
  applyMarquee($('#playerTitle'));
  const art = tr.artwork || '';
  $('#playerArt').style.backgroundImage = art ? `url(${art})` : '';
  $('#vinyl').style.backgroundImage = art ? `url(${art})` : '';
  $('#npCover').style.backgroundImage = art ? `url(${art})` : '';
  $('#npTitle').textContent = tr.title;
  $('#npArtist').textContent = tr.artist;
  if (art) void applyTone($('#npFull'), art);
  const heart = $('#btnLike');
  heart.classList.toggle('liked', isLiked(tr));
  heart.innerHTML = icon(isLiked(tr) ? 'i-heart-f' : 'i-heart');
  renderQueuePanel();
}

function playCurrent() {
  const tr = nowPlaying();
  if (!tr) return;
  if (!tr.preview) { toast('미리듣기가 없는 곡입니다'); next(); return; }
  audio.src = tr.preview;
  audio.play().catch(() => {});
  $('#player').classList.add('show');
  $('#player').classList.remove('idle');
  document.body.classList.add('has-player');
  setPlayIcon(true);
  renderNow();
  void api('/api/history', { method: 'POST', body: JSON.stringify({ track: { title: tr.title, artist: tr.artist, album: tr.album, artwork: tr.artwork, preview: tr.preview } }) }).catch(() => {});
  startLyricsDemo();
}
let queueContext = '';   // 재생을 시작한 출처 (playlist:<id> / likes / chart 등)
export const getQueueContext = () => queueContext;
export function playQueue(list: PlayableTrack[], idx = 0, context = '') {
  queue = list.filter(Boolean); queueIdx = Math.min(idx, queue.length - 1);
  queueContext = context;
  document.dispatchEvent(new CustomEvent('lilac:context', { detail: context }));
  playCurrent();
}
export function enqueue(tr: PlayableTrack) {
  queue.push(tr); toast(`대기열에 추가됨: ${tr.title}`); renderQueuePanel();
  if (queueIdx < 0) { queueIdx = 0; playCurrent(); }
}
function next() {
  if (!queue.length) return;
  if (repeat === 'one') { playCurrent(); return; }
  if (shuffle) queueIdx = Math.floor(Math.random() * queue.length);
  else if (queueIdx < queue.length - 1) queueIdx++;
  else if (repeat === 'all') queueIdx = 0;
  else { setPlayIcon(false); return; }
  playCurrent();
}
function prev() {
  if (!queue.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  queueIdx = queueIdx > 0 ? queueIdx - 1 : (repeat === 'all' ? queue.length - 1 : 0);
  playCurrent();
}
export const playerActions = {
  toggle: () => { if (!audio?.src) return; if (audio.paused) { audio.play().catch(() => {}); } else { audio.pause(); } },
  next, prev,
  seek: (d: number) => { if (audio?.src) audio.currentTime = Math.max(0, Math.min((audio.duration || 30), audio.currentTime + d)); },
};

/* ---------- 대기열 ---------- */
function renderQueuePanel() {
  const body = $('#queueBody');
  if (!body) return;
  if (!queue.length) { body.innerHTML = `<div class="empty-box sm">${icon('i-queue', 'ic eb')}<p>대기열이 비어 있습니다</p></div>`; return; }
  const row = (tr: PlayableTrack, i: number, now: boolean) => `
    <div class="q-row ${now ? 'now' : ''}" data-i="${i}">
      <span class="q-grip">${icon('i-grip', 'ic s')}</span>
      <div class="q-art" style="background-image:url(${esc(tr.artwork || '')})">${now ? '' : `<span class="q-hover-play">${icon('i-play')}</span>`}</div>
      <div class="q-meta"><div class="q-t">${esc(tr.title)}</div><div class="q-a">${esc(tr.artist)}</div></div>
      ${now ? `<span class="np-eq"><i></i><i></i><i></i></span>` : `<button class="q-x" data-x="${i}" title="제거">${icon('i-close')}</button>`}
    </div>`;
  const cur = nowPlaying();
  body.innerHTML = `
    <p class="q-label">${t('queue.nowPlaying')}</p>
    ${cur ? row(cur, queueIdx, true) : ''}
    ${queue.length > 1 ? `<p class="q-label">${t('queue.next')}</p>` : ''}
    ${queue.map((tr, i) => (i === queueIdx ? '' : row(tr, i, false))).join('')}`;

  body.querySelectorAll<HTMLElement>('.q-row:not(.now)').forEach((el) => {
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.q-x')) return;
      queueIdx = Number(el.dataset.i); playCurrent();
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const i = Number(el.dataset.i);
      const tr = queue[i];
      openContextMenu(e.clientX, e.clientY, [
        { label: '지금 재생', icon: 'i-play', run: () => { queueIdx = i; playCurrent(); } },
        { label: t('player.addPl'), icon: 'i-plus', run: () => void openPlaylistPicker(tr) },
        { label: '대기열에서 제거', icon: 'i-close', danger: true, run: () => { queue.splice(i, 1); if (i < queueIdx) queueIdx--; renderQueuePanel(); } },
      ]);
    });
  });
  body.querySelectorAll<HTMLButtonElement>('.q-x').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = Number(btn.dataset.x);
      queue.splice(i, 1); if (i < queueIdx) queueIdx--;
      renderQueuePanel();
    }));
  bindDragReorder(body, (from, to) => {
    const [moved] = queue.splice(from, 1);
    queue.splice(to, 0, moved);
    const cur2 = nowPlaying();
    queueIdx = cur2 ? queue.indexOf(cur2) : queueIdx;
    renderQueuePanel();
    toast('대기열 순서를 변경했습니다');
  });
}

/* ---------- 가사 (자체 제작 데모 문구) ---------- */
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
    <div class="ly-line" data-i="${i}"><div class="jp">${l.jp}</div><div class="romaji">${l.romaji}</div><div class="ko">${l.ko}</div></div>`).join('');
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

/* ---------- 플레이리스트 피커 ---------- */
/**
 * 이름 입력 모달
 * prompt() 는 브라우저·환경에 따라 차단되거나(iframe, 자동화, 일부 브라우저 설정)
 * 스타일도 제어할 수 없다. 접근성 있는 인라인 모달로 대체한다.
 */
export function askName(title: string, defaultValue = ''): Promise<string | null> {
  return new Promise((resolve) => {
    document.getElementById('nameModal')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'nameModal';
    wrap.className = 'modal show name-modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = `
      <div class="modal-card nm-card">
        <h3 class="nm-title"></h3>
        <input class="nm-input" type="text" maxlength="40" />
        <div class="nm-actions">
          <button class="btn-out nm-cancel" type="button">취소</button>
          <button class="btn-pill nm-ok" type="button">확인</button>
        </div>
      </div>`;
    wrap.querySelector('.nm-title')!.textContent = title;
    const input = wrap.querySelector('.nm-input') as HTMLInputElement;
    input.value = defaultValue;
    document.body.appendChild(wrap);

    const done = (v: string | null) => { wrap.remove(); resolve(v); };
    wrap.querySelector('.nm-ok')!.addEventListener('click', () => done(input.value.trim() || null));
    wrap.querySelector('.nm-cancel')!.addEventListener('click', () => done(null));
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(null); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value.trim() || null);
      if (e.key === 'Escape') done(null);
    });
    requestAnimationFrame(() => { input.focus(); input.select(); });
  });
}

export async function openPlaylistPicker(tr: PlayableTrack) {
  const lists = await api('/api/playlists').catch(() => []);
  const box = $('#plPickerBody');
  box.innerHTML = `
    <button class="pp-new" id="ppNew">${icon('i-plus')}${t('lib.newPlaylist')}</button>
    ${lists.map((p: { id: string; name: string; tracks: unknown[] }) => `
      <button class="pp-row" data-id="${p.id}"><span>${esc(p.name)}</span><span class="pp-n">${p.tracks.length}곡</span></button>`).join('')}`;
  $('#plPicker').classList.add('show');
  const payload = { track: { title: tr.title, artist: tr.artist, album: tr.album, artwork: tr.artwork, preview: tr.preview } };
  box.querySelectorAll<HTMLButtonElement>('.pp-row').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await api(`/api/playlists/${btn.dataset.id}/tracks`, { method: 'POST', body: JSON.stringify(payload) });
      $('#plPicker').classList.remove('show');
      document.dispatchEvent(new CustomEvent('lilac:playlists'));
      toast('플레이리스트에 추가했습니다');
    }));
  $('#ppNew').addEventListener('click', async () => {
    const name = await askName(t('lib.newPlaylist'), 'My Mix');
    if (!name) return;
    const pl = await api('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) });
    await api(`/api/playlists/${pl.id}/tracks`, { method: 'POST', body: JSON.stringify(payload) });
    $('#plPicker').classList.remove('show');
    document.dispatchEvent(new CustomEvent('lilac:playlists'));
    toast(`‘${name}’ 생성 및 추가 완료`);
  });
}

export function openYt(videoId: string) {
  $('#ytFrameWrap').innerHTML =
    `<iframe src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="YouTube player"></iframe>`;
  $('#ytModal').classList.add('show');
  audio?.pause(); setPlayIcon(false);
}

/* ---------- 초기화 ---------- */
export function initPlayer() {
  audio = $('#audio') as unknown as HTMLAudioElement;
  audio.volume = 0.7;
  // 플레이어 바는 항상 표시 (스포티파이 동일) — 빈 상태로 시작
  $('#player').classList.add('show', 'idle');
  document.body.classList.add('has-player');
  $('#playerTitle').textContent = '재생 중이 아님';
  $('#playerArtist').textContent = '곡을 선택해 주세요';
  renderQueuePanel();

  $('#btnPlay').addEventListener('click', () => playerActions.toggle());
  $('#btnPrev').addEventListener('click', prev);
  $('#btnNext').addEventListener('click', next);
  $('#btnShuffle').addEventListener('click', () => { shuffle = !shuffle; $('#btnShuffle').classList.toggle('on', shuffle); toast(shuffle ? '셔플 켜짐' : '셔플 꺼짐'); });
  $('#btnRepeat').addEventListener('click', () => {
    repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
    $('#btnRepeat').classList.toggle('on', repeat !== 'off');
    $('#repeatOne').style.display = repeat === 'one' ? 'block' : 'none';
  });
  audio.addEventListener('timeupdate', () => {
    const d = audio.duration || 30;
    $('#progressFill').style.width = `${(audio.currentTime / d) * 100}%`;
    $('#tCur').textContent = fmt(audio.currentTime);
    $('#tDur').textContent = fmt(d);
  });
  audio.addEventListener('ended', next);
  audio.addEventListener('play', () => setPlayIcon(true));
  audio.addEventListener('pause', () => setPlayIcon(false));

  const scrub = (e: MouseEvent) => {
    const r = $('#progressBar').getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (audio.duration || 30);
  };
  $('#progressBar').addEventListener('pointerdown', (e) => {
    scrub(e as MouseEvent);
    const move = (ev: PointerEvent) => scrub(ev as unknown as MouseEvent);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });
  const setVol = (e: MouseEvent) => {
    const r = $('#volBar').getBoundingClientRect();
    const v = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    audio.volume = v; $('#volFill').style.width = `${v * 100}%`;
  };
  $('#volBar').addEventListener('pointerdown', (e) => {
    setVol(e as MouseEvent);
    const move = (ev: PointerEvent) => setVol(ev as unknown as MouseEvent);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });

  $('#btnLike').addEventListener('click', async () => {
    const tr = nowPlaying();
    if (!tr) return;
    const list = await api('/api/likes', { method: 'POST', body: JSON.stringify({ track: { title: tr.title, artist: tr.artist, album: tr.album, artwork: tr.artwork, preview: tr.preview } }) });
    likeKeys = new Set(list.map((x: { key: string }) => x.key));
    renderNow();
    $('#btnLike').classList.add('pulse');
    setTimeout(() => $('#btnLike').classList.remove('pulse'), 500);
    document.dispatchEvent(new CustomEvent('lilac:playlists'));
    toast(isLiked(tr) ? '좋아요에 추가됨' : '좋아요 해제됨');
  });
  $('#btnAddPl').addEventListener('click', () => { const tr = nowPlaying(); if (tr) void openPlaylistPicker(tr); });

  const syncDock = () => document.body.classList.toggle('dock-open', !!document.querySelector('.right-dock.show'));
  $('#btnQueue').addEventListener('click', () => {
    const on = $('#queuePanel').classList.toggle('show');
    $('#lyricsPanel').classList.remove('show');
    $('#btnQueue').classList.toggle('on', on); $('#btnLyrics').classList.remove('on');
    renderQueuePanel(); syncDock();
  });
  $('#queueClose').addEventListener('click', () => { $('#queuePanel').classList.remove('show'); $('#btnQueue').classList.remove('on'); syncDock(); });
  $('#btnLyrics').addEventListener('click', () => {
    const on = $('#lyricsPanel').classList.toggle('show');
    $('#queuePanel').classList.remove('show');
    $('#btnLyrics').classList.toggle('on', on); $('#btnQueue').classList.remove('on');
    syncDock();
  });
  $('#lyricsClose').addEventListener('click', () => { $('#lyricsPanel').classList.remove('show'); $('#btnLyrics').classList.remove('on'); syncDock(); });
  $('#queueSave').addEventListener('click', async () => {
    if (!queue.length) return;
    const name = await askName(t('queue.saveAsPl'), 'Queue Mix');
    if (!name) return;
    const pl = await api('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) });
    for (const tr of queue) await api(`/api/playlists/${pl.id}/tracks`, { method: 'POST', body: JSON.stringify({ track: { title: tr.title, artist: tr.artist, album: tr.album, artwork: tr.artwork, preview: tr.preview } }) });
    document.dispatchEvent(new CustomEvent('lilac:playlists'));
    toast(`‘${name}’ 저장 완료 (${queue.length}곡)`);
  });

  // 전체화면 나우플레잉
  $('#btnExpand').addEventListener('click', () => { if (nowPlaying()) $('#npFull').classList.add('show'); });
  $('#npClose').addEventListener('click', () => $('#npFull').classList.remove('show'));

  $('#ytClose').addEventListener('click', () => { $('#ytModal').classList.remove('show'); $('#ytFrameWrap').innerHTML = ''; });
  $('#ytModal').addEventListener('click', (e) => { if (e.target === $('#ytModal')) { $('#ytModal').classList.remove('show'); $('#ytFrameWrap').innerHTML = ''; } });
  $('#plPicker').addEventListener('click', (e) => { if (e.target === $('#plPicker')) $('#plPicker').classList.remove('show'); });
  $('#plPickerClose').addEventListener('click', () => $('#plPicker').classList.remove('show'));

  // macOS 메뉴바 셸에서 전달하는 공통 명령. Focus Desk의 YouTube 명령은
  // pages.ts가 같은 이벤트를 받아 별도로 처리한다.
  window.addEventListener('lilac:native-command', (event) => {
    const command = String((event as CustomEvent<string>).detail || '');
    const focusRoute = location.hash.startsWith('#/focus');
    if (!focusRoute && command === 'toggle') playerActions.toggle();
    else if (!focusRoute && command === 'pause') audio?.pause();
    else if (!focusRoute && command === 'prev') playerActions.prev();
    else if (!focusRoute && command === 'next') playerActions.next();
    else if (command.startsWith('duck:') && audio) audio.volume = Math.max(0, Math.min(1, (Number(command.split(':')[1]) || 18) / 100));
    else if (command === 'restore' && audio) audio.volume = 0.7;
  });
}
