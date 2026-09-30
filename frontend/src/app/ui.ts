/* 화면 조각·서식 도우미 */
import { t, getLocale } from './i18n';

export const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const icon = (id: string, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;

/* HTML escaping does not make a URL safe. Preserve in-app fragments and root assets. */
export function safeHref(value: unknown, internal = true): string {
  if (typeof value !== 'string' || !value || /[\u0000-\u0020\u007f\\]/.test(value)) return '';
  if (internal && (value.startsWith('#') || /^\/(?!\/)/.test(value))) return value;
  try { const u = new URL(value); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function safeImage(value: unknown): string {
  if (typeof value === 'string' && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return value;
  const u = safeHref(value);
  return u.startsWith('#') ? '' : u;
}

const WD = { ko: ['일', '월', '화', '수', '목', '금', '토'], ja: ['日', '月', '火', '水', '木', '金', '土'] };

/* 'YYYY-MM-DD' 는 현지(KST/JST 동일) 날짜로 해석 */
function parseDay(d: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const [y, m, dd] = d.split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, dd));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== dd) return null;
  return { y, m, d: dd, wd: new Date(Date.UTC(y, m - 1, dd)).getUTCDay() };
}

export function fmtDay(d: string | null | undefined, { year = false } = {}) {
  if (!d) return '';
  const p = parseDay(d);
  if (!p) return '';
  const w = WD[getLocale()][p.wd];
  const nowY = new Date().getFullYear();
  const y = year || p.y !== nowY ? `${p.y}.` : '';
  return getLocale() === 'ja' ? `${y ? p.y + '/' : ''}${p.m}/${p.d}(${w})` : `${y}${p.m}.${p.d}(${w})`;
}

export function fmtRange(a?: string | null, b?: string | null) {
  if (!a) return '';
  if (!b || b === a) return fmtDay(a);
  return [fmtDay(a), fmtDay(b)].filter(Boolean).join(' – ');
}

/* ISO(+09:00) → 'M.D(요일) HH:mm' (한국·일본 모두 UTC+9) */
export function fmtDateTime(iso?: string | null) {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const k = new Date(ms + 9 * 3600e3);
  const day = `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`;
  const hm = `${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`;
  return `${fmtDay(day)} ${hm}`;
}

/* ISO → 'HH:mm' (일정표처럼 날짜를 따로 보여 줄 때) */
export function fmtTime(iso?: string | null) {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const k = new Date(ms + 9 * 3600e3);
  return `${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`;
}

export function until(iso?: string | null) {
  if (!iso) return '';
  const diff = Date.parse(iso) - Date.now();
  if (!Number.isFinite(diff)) return '';
  const ja = getLocale() === 'ja';
  if (diff <= 0) return t('c.openedAgo');
  const m = Math.round(diff / 60e3);
  if (m < 60) return ja ? `${m}分` : `${m}분`;
  const h = Math.floor(m / 60);
  if (h < 48) return ja ? `${h}時間` : `${h}시간`;
  const d = Math.floor(h / 24);
  return ja ? `${d}日` : `${d}일`;
}

export function ddayOf(day?: string | null) {
  if (!day || !parseDay(day)) return '';
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const utc = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
  const n = Math.round((utc(day) - utc(today)) / 864e5);
  if (n === 0) return t('c.dday.today');
  return n > 0 ? `D-${n}` : '';
}

export function ago(iso?: string | null) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  const ja = getLocale() === 'ja';
  if (!Number.isFinite(s)) return '';
  if (s < 90) return ja ? 'たった今' : '방금';
  const m = Math.round(s / 60);
  if (m < 60) return ja ? `${m}分前` : `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 24) return ja ? `${h}時間前` : `${h}시간 전`;
  const d = Math.round(h / 24);
  if (d < 30) return ja ? `${d}日前` : `${d}일 전`;
  return iso.slice(0, 10);
}

export function money(v: number | null | undefined, cur: string) {
  if (v == null || !Number.isFinite(v)) return '';
  if (cur === 'KRW') return `₩${Math.round(v).toLocaleString('ko-KR')}`;
  if (cur === 'JPY') return `¥${Math.round(v).toLocaleString('ja-JP')}`;
  if (cur === 'USD') return `$${v.toFixed(2)}`;
  return /^[A-Z]{3}$/.test(cur) ? `${v} ${cur}` : String(v);
}

export function convert(v: number | null | undefined, from: string, to: string, fx: { jpyKrw?: number } | null) {
  if (v == null || !fx?.jpyKrw || from === to) return null;
  if (from === 'JPY' && to === 'KRW') return v * fx.jpyKrw;
  if (from === 'KRW' && to === 'JPY') return v / fx.jpyKrw;
  return null;
}

/* 이미지 — 핫링크 차단을 피하려 referrer 없이. 실패하면 이니셜 판으로 바꾼다 */
export function img(src: string | null | undefined, alt: string, cls = '', { ratio = '', initial = '', text = false } = {}) {
  const label = (initial || alt || '·').trim();
  const fallback = text
    ? `<span class="ph ph-text" aria-hidden="true">${esc(label.length > 28 ? label.slice(0, 27) + '…' : label)}</span>`
    : `<span class="ph" aria-hidden="true">${esc(label.slice(0, 1).toUpperCase())}</span>`;
  src = safeImage(src);
  if (!src) return `<span class="media ${cls} is-empty" ${ratio ? `style="aspect-ratio:${ratio}"` : ''}>${fallback}</span>`;
  return `<span class="media ${cls}" ${ratio ? `style="aspect-ratio:${ratio}"` : ''}><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentElement.classList.add('is-empty');this.remove()">${fallback}</span>`;
}

export function skeletonRows(n = 4, cls = 'sk-row') {
  return Array.from({ length: n }, () => `<div class="sk ${cls}"></div>`).join('');
}
export function skeletonCards(n = 6) {
  return `<div class="grid-posters">${Array.from({ length: n }, () => '<div class="sk sk-poster"></div>').join('')}</div>`;
}

export function emptyState(msg: string, action = '') {
  return `<div class="empty"><p>${esc(msg)}</p>${action}</div>`;
}
export function errorState(msg: string) {
  return `<div class="empty is-error"><p>${esc(msg)}</p><button class="btn btn-line" data-retry>${t('retry')}</button></div>`;
}

export function sectionHead(title: string, { href = '', sub = '', extra = '' } = {}) {
  return `<div class="sec-head"><div><h2>${esc(title)}</h2>${sub ? `<p class="sec-sub">${sub}</p>` : ''}</div>${extra}${href ? `<a class="more" href="${esc(safeHref(href))}">${t('more')}${icon('i-chev-r', 'ic xs')}</a>` : ''}</div>`;
}

export function freshness(cache?: { state?: string; updatedAt?: string | null } | null) {
  if (!cache?.updatedAt) return cache?.state === 'pending' ? `<span class="fresh is-pending">${t('updating')}</span>` : '';
  return `<span class="fresh${cache.state === 'stale' ? ' is-stale' : ''}" title="${esc(cache.updatedAt)}">${t('updated', { t: ago(cache.updatedAt) })}</span>`;
}

export function params() {
  const q = location.hash.split('?')[1] || '';
  return new URLSearchParams(q);
}

export function announce(msg: string) {
  const el = document.getElementById('srAnnounce');
  if (el) el.textContent = msg;
}

let toastTimer = 0;
export function toast(msg: string) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 2600);
}

/* 예매처가 쓰는 판매 구분 문구를 화면 언어로 */
const KO2JA: [RegExp, string][] = [
  [/국내\s*페이지\s*/g, ''], [/글로벌\s*페이지\s*/g, 'グローバル '], [/팬클럽\s*선예매/g, 'ファンクラブ先行'], [/아티스트\s*선예매/g, 'アーティスト先行'],
  [/추가\s*티켓\s*오픈/g, '追加販売'], [/선예매/g, '先行予約'], [/일반\s*예매일?/g, '一般発売'], [/티켓\s*오픈일?/g, '発売日'], [/예매\s*오픈/g, '発売'],
  [/단독판매/g, '独占販売'], [/기타\s*오픈/g, 'その他の販売'],
];
const JA2KO: [RegExp, string][] = [
  [/2次プレオーダー受付/g, '2차 프리오더(추첨)'], [/プレオーダー受付/g, '프리오더(추첨)'], [/プレオーダー/g, '프리오더(추첨)'], [/プレリザーブ/g, '프리리저브(추첨)'],
  [/抽選受付中/g, '추첨 접수 중'], [/販売期間中/g, '판매 중'], [/予定枚数終了/g, '매진'], [/発売前/g, '판매 전'], [/より発売/g, '부터 판매'],
  [/一般発売/g, '일반 판매'], [/追加販売/g, '추가 판매'], [/先着/g, '선착순'], [/抽選/g, '추첨'], [/先行/g, '선행'], [/受付/g, '접수'],
  [/【([^】]*)公演】/g, '[$1]'], [/大阪/g, '오사카'], [/東京/g, '도쿄'], [/神戸/g, '고베'], [/福岡/g, '후쿠오카'], [/名古屋/g, '나고야'], [/札幌/g, '삿포로'],
];
export function saleLabel(s?: string | null) {
  if (!s) return '';
  const rules = getLocale() === 'ja' ? KO2JA : JA2KO;
  let out = s;
  for (const [re, to] of rules) out = out.replace(re, to);
  // 일부만 옮겨져 두 언어가 섞이면(親子프리오더) 공식 명칭 그대로 둔다
  if (getLocale() === 'ko' && /[\u3040-\u30ff\u4e00-\u9fff]/.test(out)) return s.trim();
  return out.trim();
}

/* Apple 스토어 장르명(스토어 언어로 적혀 있다)을 화면 언어로 */
const GENRE: Record<string, [string, string]> = {
  'ロック': ['록', 'ロック'], '록': ['록', 'ロック'], 'J-Pop': ['J-Pop', 'J-Pop'], 'K-Pop': ['K-Pop', 'K-Pop'],
  'アニメ': ['애니메이션', 'アニメ'], 'オルタナティブ': ['얼터너티브', 'オルタナティブ'], 'ヒップホップ／ラップ': ['힙합', 'ヒップホップ'], '힙합/랩': ['힙합', 'ヒップホップ'],
  'ジャズ': ['재즈', 'ジャズ'], '歌謡曲': ['가요곡', '歌謡曲'], '演歌': ['엔카', '演歌'], '팝': ['팝', 'ポップ'], 'ポップ': ['팝', 'ポップ'],
  '댄스': ['댄스', 'ダンス'], 'R&B/소울': ['R&B', 'R&B'], '클래식': ['클래식', 'クラシック'], '펑크': ['펑크', 'パンク'], 'OST': ['OST', 'サウンドトラック'],
  '일본 만화 영화': ['애니메이션', 'アニメ'], 'サウンドトラック': ['OST', 'サウンドトラック'],
};
export function genreLabel(g?: string | null) {
  if (!g) return '';
  const m = GENRE[g];
  return m ? m[getLocale() === 'ja' ? 1 : 0] : g;
}
