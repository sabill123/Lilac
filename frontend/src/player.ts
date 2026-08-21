import { api, esc, icon } from './api';
import type { PlayableTrack } from './api';
import { t } from './i18n';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

let toastTimer: number;
export function toast(msg: string) {
  const el = $('.toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2400);
}

// ---------- 상태 ----------
let audio: HTMLAudioElement;
let queue: PlayableTrack[] = [];
let queueIdx = -1;
let shuffle = false;
let repeat: 'off' | 'all' | 'one' = 'off';
let likeKeys = new Set<string>();
const trackKey = (tr: PlayableTrack) => (tr.title + '|' + (tr.artist || '')).toLowerCase().replace(/\s/g, '');

export const nowPlaying = () => (queueIdx >= 0 ? queue[queueIdx] : null);

export async function loadLikes() {
  const list = await api('/api/likes').catch(() => []);
  likeKeys = new Set(list.map((x: { key: string }) => x.key));
}
const likeKeyOf = (tr: PlayableTrack) => trackKey(tr);
export const isLiked = (tr: PlayableTrack) => likeKeys.has(likeKeyOf(tr));

// ---------- 재생 ----------
function fmt(s: number) { return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }
function setPlayIcon(playing: boolean) { $('#playIcon').innerHTML = `<use href="#${playing ? 'i-pause' : 'i-play'}"/>`; }

function renderNow() {
  const tr = nowPlaying();
  if (!tr) return;
  $('#playerTitle').textContent = tr.title;
  $('#playerArtist').textContent = tr.artist;
  $('#playerArt').style.backgroundImage = tr.artwork ? `url(${tr.artwork})` : '';
  const heart = $('#btnLike');
  heart.classList.toggle('liked', isLiked(tr));
  heart.innerHTML = icon(isLiked(tr) ? 'i-heart-f' : 'i-heart');
  renderQueuePanel();
  document.dispatchEvent(new CustomEvent('lilac:nowplaying'));
}

function playCurrent() {
  const tr = nowPlaying();
  if (!tr) return;
  if (!tr.preview) { toast('미리듣기가 없는 곡입니다'); next(); return; }
  audio.src = tr.preview;
  void audio.play();
  $('#player').classList.add('show');
  document.body.classList.add('has-player');
  setPlayIcon(true);
  renderNow();
  void api('/api/history', { method: 'POST', body: JSON.stringify({ track: { title: tr.title, artist: tr.artist, artwork: tr.artwork, preview: tr.preview } }) }).catch(() => {});
  startLyricsDemo();
}

export function playQueue(list: PlayableTrack[], idx = 0) {
  queue = list.filter((x) => x); queueIdx = Math.min(idx, queue.length - 1);
  playCurrent();
}
export function enqueue(tr: PlayableTrack) {
  queue.push(tr);
  toast(`재생목록에 추가됨: ${tr.title}`);
  renderQueuePanel();
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

// ---------- 큐 패널 ----------
function renderQueuePanel() {
  const body = $('#queueBody');
  if (!body) return;
  if (!queue.length) { body.innerHTML = `<p class="q-empty">${t('browse.hint')}</p>`; return; }
  const row = (tr: PlayableTrack, i: number, now: boolean) => `
    <div class="q-row ${now ? 'now' : ''}" data-i="${i}">
      <div class="q-art" style="background-image:url(${esc(tr.artwork || '')})"></div>
      <div class="q-meta"><div class="q-t">${esc(tr.title)}</div><div class="q-a">${esc(tr.artist)}</div></div>
      ${now ? `<span class="np-eq"><i></i><i></i><i></i></span>` : `<button class="q-x" data-x="${i}" title="제거">${icon('i-close')}</button>`}
    </div>`;
  const cur = nowPlaying();
  body.innerHTML = `
    <p class="q-label">${t('queue.nowPlaying')}</p>
    ${cur ? row(cur, queueIdx, true) : ''}
    ${queue.length > 1 ? `<p class="q-label">${t('queue.next')}</p>` : ''}
    ${queue.map((tr, i) => (i === queueIdx ? '' : row(tr, i, false))).join('')}`;
  body.querySelectorAll<HTMLElement>('.q-row:not(.now)').forEach((el) =>
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.q-x')) return;
      queueIdx = Number(el.dataset.i); playCurrent();
    }));
  body.querySelectorAll<HTMLButtonElement>('.q-x').forEach((btn) =>
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.x);
      queue.splice(i, 1);
      if (i < queueIdx) queueIdx--;
      renderQueuePanel();
    }));
}

// ---------- 가사 (자체 제작 데모 문구) ----------
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

// ---------- 플레이리스트 추가 피커 ----------
export async function openPlaylistPicker(tr: PlayableTrack) {
  const lists = await api('/api/playlists').catch(() => []);
  const box = $('#plPickerBody');
  box.innerHTML = `
    <button class="pp-new" id="ppNew">${icon('i-plus')}${t('lib.newPlaylist')}</button>
    ${lists.map((p: { id: string; name: string; tracks: unknown[] }) => `
      <button class="pp-row" data-id="${p.id}"><span>${esc(p.name)}</span><span class="pp-n">${p.tracks.length}곡</span></button>`).join('')}`;
  $('#plPicker').classList.add('show');
  const payload = { track: { title: tr.title, artist: tr.artist, artwork: tr.artwork, preview: tr.preview } };
  box.querySelectorAll<HTMLButtonElement>('.pp-row').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await api(`/api/playlists/${btn.dataset.id}/tracks`, { method: 'POST', body: JSON.stringify(payload) });
      $('#plPicker').classList.remove('show');
      toast(t('player.addPl') + ' 완료');
    }));
  $('#ppNew').addEventListener('click', async () => {
    const name = prompt(t('lib.newPlaylist'), 'My Mix') || 'My Mix';
    const pl = await api('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) });
    await api(`/api/playlists/${pl.id}/tracks`, { method: 'POST', body: JSON.stringify(payload) });
    $('#plPicker').classList.remove('show');
    toast(`‘${name}’ 생성 및 추가 완료`);
  });
}

// ---------- 유튜브 모달 ----------
export function openYt(videoId: string) {
  $('#ytFrameWrap').innerHTML =
    `<iframe src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="YouTube player"></iframe>`;
  $('#ytModal').classList.add('show');
  audio?.pause(); setPlayIcon(false);
}

// ---------- 초기화 ----------
export function initPlayer() {
  audio = $('#audio') as unknown as HTMLAudioElement;
  audio.volume = 0.7;

  $('#btnPlay').addEventListener('click', () => {
    if (!audio.src) return;
    if (audio.paused) { void audio.play(); setPlayIcon(true); } else { audio.pause(); setPlayIcon(false); }
  });
  $('#btnPrev').addEventListener('click', prev);
  $('#btnNext').addEventListener('click', next);
  $('#btnShuffle').addEventListener('click', () => {
    shuffle = !shuffle;
    $('#btnShuffle').classList.toggle('on', shuffle);
  });
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
  $('#progressBar').addEventListener('click', (e) => {
    const r = $('#progressBar').getBoundingClientRect();
    audio.currentTime = (((e as MouseEvent).clientX - r.left) / r.width) * (audio.duration || 30);
  });
  $('#volBar').addEventListener('click', (e) => {
    const r = $('#volBar').getBoundingClientRect();
    const v = Math.min(1, Math.max(0, ((e as MouseEvent).clientX - r.left) / r.width));
    audio.volume = v;
    $('#volFill').style.width = `${v * 100}%`;
  });
  $('#btnLike').addEventListener('click', async () => {
    const tr = nowPlaying();
    if (!tr) return;
    const list = await api('/api/likes', { method: 'POST', body: JSON.stringify({ track: { title: tr.title, artist: tr.artist, artwork: tr.artwork, preview: tr.preview } }) });
    likeKeys = new Set(list.map((x: { key: string }) => x.key));
    renderNow();
    toast(isLiked(tr) ? '좋아요에 추가됨' : '좋아요 해제됨');
  });
  $('#btnAddPl').addEventListener('click', () => { const tr = nowPlaying(); if (tr) void openPlaylistPicker(tr); });
  $('#btnQueue').addEventListener('click', () => { $('#queuePanel').classList.toggle('show'); $('#lyricsPanel').classList.remove('show'); renderQueuePanel(); });
  $('#queueClose').addEventListener('click', () => $('#queuePanel').classList.remove('show'));
  $('#queueSave').addEventListener('click', async () => {
    if (!queue.length) return;
    const name = prompt(t('queue.saveAsPl'), 'Queue Mix') || 'Queue Mix';
    const pl = await api('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) });
    for (const tr of queue) await api(`/api/playlists/${pl.id}/tracks`, { method: 'POST', body: JSON.stringify({ track: { title: tr.title, artist: tr.artist, artwork: tr.artwork, preview: tr.preview } }) });
    toast(`‘${name}’ 저장 완료 (${queue.length}곡)`);
  });
  $('#btnLyrics').addEventListener('click', () => { $('#lyricsPanel').classList.toggle('show'); $('#queuePanel').classList.remove('show'); });
  $('#lyricsClose').addEventListener('click', () => $('#lyricsPanel').classList.remove('show'));
  $('#ytClose').addEventListener('click', () => { $('#ytModal').classList.remove('show'); $('#ytFrameWrap').innerHTML = ''; });
  $('#ytModal').addEventListener('click', (e) => { if (e.target === $('#ytModal')) { $('#ytModal').classList.remove('show'); $('#ytFrameWrap').innerHTML = ''; } });
  $('#plPicker').addEventListener('click', (e) => { if (e.target === $('#plPicker')) $('#plPicker').classList.remove('show'); });
  $('#plPickerClose').addEventListener('click', () => $('#plPicker').classList.remove('show'));
}
