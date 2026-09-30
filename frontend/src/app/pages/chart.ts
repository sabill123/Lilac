import { api } from '../../api';
import { state, musicCountries } from '../state';
import { t, getLocale } from '../i18n';
import { esc, img, icon, skeletonRows, errorState, emptyState, ago } from '../ui';
import { chartRow, artistName } from '../cards';

let jaNamesP: Promise<Map<string, string>> | null = null;
const nk = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s.·・()（）'’-]/g, '');
function jaArtistNames() {
  jaNamesP ||= api('/api/live/artists?edition=all').then((r: { items: { name: string; nameOriginal?: string | null; nameJa?: string | null; nameKo?: string | null }[] }) => {
    const m = new Map<string, string>();
    for (const a of r.items || []) {
      const show = artistName(a);
      if (/[가-힣]/.test(show)) continue;
      for (const n of [a.name, a.nameKo, a.nameOriginal]) if (n) m.set(nk(n), show);
    }
    return m;
  }).catch(() => new Map());
  return jaNamesP;
}
/* "RESCENE (리센느)" "화사 (HWASA)"처럼 두 표기가 붙은 이름은 한글이 아닌 쪽 */
function jaArtist(name: string, m: Map<string, string>) {
  if (!/[가-힣]/.test(name)) return name;
  const hit = m.get(nk(name));
  if (hit) return hit;
  const pair = name.match(/^(.+?)\s*[(（]([^)）]+)[)）]\s*$/);
  if (pair) { const [a, b] = [pair[1].trim(), pair[2].trim()]; if (!/[가-힣]/.test(a)) return a; if (!/[가-힣]/.test(b)) return b; return m.get(nk(a)) || name; }
  return name;
}
import type { ChartEntry } from '../cards';
import { playList, markPlaying } from '../player';
import { bindSocial } from '../social';
import type { Track } from '../player';

export async function renderChart(root: HTMLElement, alive: () => boolean, sub?: string, sourceArg?: string) {
  const allowed = musicCountries();
  const country: 'jp' | 'kr' = sub === 'kr' || sub === 'jp' ? (state.edition === 'all' || allowed.includes(sub) ? sub : allowed[0]) : allowed[0];
  const source = sourceArg || 'combined';
  root.innerHTML = `
    <section class="page-head"><h1>${t('ch.title')}</h1></section>
    ${state.edition === 'all' ? `<nav class="tabs">${(['jp', 'kr'] as const).map((c) => `<a href="#/chart/${c}" class="${c === country ? 'on' : ''}">${t(`ch.${c}`)}</a>`).join('')}</nav>` : ''}
    <div id="chMoves"></div>
    <div class="toolbar" id="chTools"></div>
    <ol class="clist" id="chList">${skeletonRows(12, 'sk-line')}</ol>
    <p class="method" id="chMethod"></p>`;
  let d: { list: ChartEntry[]; sources: string[]; sourceLabels: Record<string, string> | null; updated: string; live: boolean; method: string };
  try {
    d = await api(`/api/charts?country=${country}&source=${encodeURIComponent(source)}&limit=100`);
  } catch {
    if (!alive()) return;
    root.querySelector('#chList')!.innerHTML = errorState(t('err.generic'));
    root.querySelector('[data-retry]')?.addEventListener('click', () => renderChart(root, alive, sub, sourceArg));
    return;
  }
  if (!alive()) return;
  const labels: Record<string, string> = { combined: getLocale() === 'ja' ? 'Lilac統合' : 'Lilac 통합', ...(d.sourceLabels || {}), ...(getLocale() === 'ja' ? { oricon: 'オリコン週間シングル', melon: 'Melon TOP100', genie: 'genie チャート' } : {}), apple: 'Apple Music', appleRss: getLocale() === 'ja' ? 'Apple 公式フィード' : 'Apple 공식 피드', youtube: 'YouTube MV' };
  const ja = getLocale() === 'ja';
  const short: Record<string, string> = ja
    ? { billboard: 'Billboard', oricon: 'オリコン', melon: 'Melon', genie: 'genie', apple: 'Apple Music', appleRss: 'Apple 公式フィード', youtube: 'YouTube' }
    : { billboard: '빌보드', oricon: '오리콘', melon: '멜론', genie: '지니', apple: 'Apple Music', appleRss: 'Apple 공식 피드', youtube: 'YouTube' };
  root.querySelector('#chTools')!.innerHTML = `<div class="chips">${['combined', ...d.sources].map((s) => `<a class="chip ${s === source ? 'on' : ''}" href="#/chart/${country}/${encodeURIComponent(s)}">${esc(labels[s] || s)}</a>`).join('')}</div>
    <span class="fresh">${d.live ? 'LIVE · ' : ''}${esc(t('updated', { t: ago(d.updated) }))}</span>`;
  let list = d.list || [];
  /* 일본어 화면: 한국 차트의 한글 아티스트명을 로스터의 일본어·로마자 표기로(아이유 → IU, 한로로 → HANRORO) */
  if (ja && list.some((e) => /[가-힣]/.test(e.artist))) {
    const names = await jaArtistNames();
    if (!alive()) return;
    list = list.map((e) => ({ ...e, artist: jaArtist(e.artist, names) }));
  }
  root.querySelector('#chList')!.innerHTML = list.length ? list.map((e, i) => chartRow(e, i, { sourceLabels: short })).join('') : `<li>${emptyState(t('empty.generic'))}</li>`;
  const tracks: Track[] = list.map((e) => ({ title: e.title, artist: e.artist, artwork: e.artwork, appleUrl: e.appleUrl }));
  root.querySelectorAll<HTMLElement>('#chList [data-play]').forEach((b) => b.addEventListener('click', () => playList(tracks, Number(b.dataset.play))));
  const mk = `ch.m.${source}`;
  root.querySelector('#chMethod')!.textContent = source === 'combined' ? t('ch.method') : t(mk) !== mk ? t(mk) : d.method || '';
  markPlaying();
  void bindSocial(root.querySelector<HTMLElement>('#chList')!);
  void paintMoves(root, country, alive);
}

interface Move { rank: number; lastRank: number | null; move: string | null; title: string; artist: string; artwork: string | null; appleUrl: string | null }

/* 이전 홈의 발견 선반(상승·새로 진입)을 차트 화면으로. 이전 순위를 주는 차트가 있을 때만 그린다. */
async function paintMoves(root: HTMLElement, country: 'jp' | 'kr', alive: () => boolean) {
  const box = root.querySelector<HTMLElement>('#chMoves');
  if (!box) return;
  let m: { source: string | null; sourceLabel?: string; rising: Move[]; entries: Move[] };
  try { m = await api(`/api/live/chart-moves?country=${country}`); } catch { return; }
  if (!alive() || !m.source || (!m.rising.length && !m.entries.length)) return;
  const card = (e: Move, i: number, kind: 'up' | 'new') => `<li class="shelf-card">
      <button class="shelf-art" data-shelf="${kind}" data-i="${i}" aria-label="${esc(e.title)} ${t('ch.play')}">${img(e.artwork, '', 'square', { ratio: '1/1', initial: e.artist })}<span class="crow-play">${icon('i-play', 'ic')}</span></button>
      <p class="shelf-move">${kind === 'up' && e.lastRank ? esc(t('ch.moveUp', { from: e.lastRank, to: e.rank })) : esc(t('ch.moveNew', { r: e.rank }))}</p>
      <b>${esc(e.title)}</b><a href="#/artist/name/${encodeURIComponent(e.artist)}">${esc(e.artist)}</a>
    </li>`;
  const shelf = (title: string, list: Move[], kind: 'up' | 'new') => list.length ? `<section class="shelf-sec"><h2 class="shelf-h">${esc(title)}</h2><ul class="shelf">${list.map((e, i) => card(e, i, kind)).join('')}</ul></section>` : '';
  box.innerHTML = `<div class="shelves">${shelf(t('ch.rising'), m.rising, 'up')}${shelf(t('ch.new'), m.entries, 'new')}</div><p class="method small">${esc(t('ch.movesSrc', { s: m.sourceLabel || m.source }))}</p>`;
  const tr = (l: Move[]): Track[] => l.map((e) => ({ title: e.title, artist: e.artist, artwork: e.artwork, appleUrl: e.appleUrl }));
  box.querySelectorAll<HTMLElement>('[data-shelf]').forEach((b) => b.addEventListener('click', () => playList(tr(b.dataset.shelf === 'up' ? m.rising : m.entries), Number(b.dataset.i))));
}
