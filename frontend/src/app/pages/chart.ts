import { api } from '../../api';
import { state, musicCountries } from '../state';
import { t } from '../i18n';
import { esc, img, icon, skeletonRows, errorState, emptyState, ago } from '../ui';
import { chartRow } from '../cards';
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
  const labels: Record<string, string> = { combined: state.edition === 'jp' ? 'Lilac統合' : 'Lilac 통합', ...(d.sourceLabels || {}), apple: 'Apple Music', appleRss: state.edition === 'jp' ? 'Apple 公式フィード' : 'Apple 공식 피드', youtube: 'YouTube MV' };
  const short: Record<string, string> = { billboard: 'Billboard', oricon: 'Oricon', melon: 'Melon', genie: 'Genie', apple: 'Apple', appleRss: 'Apple RSS', youtube: 'YouTube' };
  root.querySelector('#chTools')!.innerHTML = `<div class="chips">${['combined', ...d.sources].map((s) => `<a class="chip ${s === source ? 'on' : ''}" href="#/chart/${country}/${encodeURIComponent(s)}">${esc(labels[s] || s)}</a>`).join('')}</div>
    <span class="fresh">${d.live ? 'LIVE · ' : ''}${esc(t('updated', { t: ago(d.updated) }))}</span>`;
  const list = d.list || [];
  root.querySelector('#chList')!.innerHTML = list.length ? list.map((e, i) => chartRow(e, i, { sourceLabels: short })).join('') : `<li>${emptyState(t('empty.generic'))}</li>`;
  const tracks: Track[] = list.map((e) => ({ title: e.title, artist: e.artist, artwork: e.artwork, appleUrl: e.appleUrl }));
  root.querySelectorAll<HTMLElement>('#chList [data-play]').forEach((b) => b.addEventListener('click', () => playList(tracks, Number(b.dataset.play))));
  root.querySelector('#chMethod')!.textContent = source === 'combined' ? t('ch.method') : d.method || '';
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
