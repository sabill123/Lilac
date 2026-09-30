/* 앱 전역 상태 — 에디션·언어·로그인·팔로우 */
import { api, refreshMe, setToken } from '../api';
import type { User } from '../api';
import { setLocale, getLocale } from './i18n';
import type { Locale } from './i18n';

export type Edition = 'kr' | 'jp' | 'all';
const EK = 'lilac.edition';
const LK = 'lilac.locale';

function read(k: string) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function write(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* 프라이빗 모드 */ }
}

function guessEdition(): Edition {
  const langs = (navigator.languages || [navigator.language || '']).join(',').toLowerCase();
  return /\bja\b|ja-/.test(langs) && !/\bko\b|ko-/.test(langs) ? 'jp' : 'kr';
}

export const state = {
  edition: ((): Edition => {
    const v = read(EK);
    return v === 'kr' || v === 'jp' || v === 'all' ? v : guessEdition();
  })(),
  me: null as User | null,
  follows: [] as { artistId: string; name: string; at?: string }[],
};

const initialLocale = ((): Locale => {
  const v = read(LK);
  if (v === 'ko' || v === 'ja') return v;
  return state.edition === 'jp' ? 'ja' : 'ko';
})();
setLocale(initialLocale);

type Listener = (what: 'edition' | 'locale' | 'auth' | 'follows') => void;
const listeners = new Set<Listener>();
export const onChange = (fn: Listener) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (w: Parameters<Listener>[0]) => listeners.forEach((fn) => fn(w));

export function setEdition(e: Edition) {
  if (state.edition === e) return;
  state.edition = e;
  write(EK, e);
  document.documentElement.dataset.edition = e;
  // 에디션이 곧 사용자의 나라다 — 언어도 따라간다 (전체는 현재 언어 유지)
  if (e === 'kr' && getLocale() !== 'ko') setLang('ko', false);
  if (e === 'jp' && getLocale() !== 'ja') setLang('ja', false);
  emit('edition');
}

export function setLang(l: Locale, notify = true) {
  setLocale(l);
  write(LK, l);
  if (notify) emit('locale');
}

/* 이 에디션에서 "음악을 보는 나라"(차트·발매) */
export const musicCountries = (e: Edition = state.edition): ('jp' | 'kr')[] => (e === 'kr' ? ['jp'] : e === 'jp' ? ['kr'] : ['jp', 'kr']);
/* 구매자 통화 */
export const buyerCurrency = (e: Edition = state.edition): 'KRW' | 'JPY' => (e === 'jp' ? 'JPY' : e === 'kr' ? 'KRW' : getLocale() === 'ja' ? 'JPY' : 'KRW');
/* 굿즈 검색 시장: kr = 한국 팬이 일본반을 산다, jp = 일본 팬이 한국반을 산다 */
export const goodsMarket = (e: Edition = state.edition): 'kr' | 'jp' | 'all' => e;

/* 첫 세션 확인이 끝났는지 — 로그인 여부로 화면이 갈리는 곳(글쓰기·댓글·내 갤러리)은 이걸 기다린다 */
let readyResolve: () => void = () => {};
export const sessionReady: Promise<void> = new Promise((r) => { readyResolve = r; });

export async function loadSession() {
  state.me = await refreshMe().catch(() => null);
  readyResolve();
  await loadFollows();
  emit('auth');
}

export async function loadFollows() {
  if (!state.me) { state.follows = []; return; }
  state.follows = await api('/api/oshi').catch(() => []);
  emit('follows');
}

export const isFollowing = (id: string) => state.follows.some((f) => f.artistId === id);

export async function toggleFollow(id: string, name: string): Promise<boolean | null> {
  if (!state.me) {
    location.hash = `#/login?next=${encodeURIComponent(location.hash.slice(1) || '/')}`;
    return null;
  }
  state.follows = await api('/api/oshi', { method: 'POST', body: JSON.stringify({ artistId: id, name }) });
  emit('follows');
  return isFollowing(id);
}

export async function login(email: string, password: string) {
  const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  setToken(r.token);
  await loadSession();
}
export async function signup(email: string, password: string, name: string) {
  const r = await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, name }) });
  setToken(r.token);
  await loadSession();
}
/* 탈퇴 뒤에는 서버 세션이 이미 없다 — 이 기기의 로그인 정보만 지운다 */
export function forgetSession() {
  setToken(null);
  state.me = null;
  state.follows = [];
  emit('auth');
}
export async function refreshMe2() { state.me = await refreshMe().catch(() => state.me); emit('auth'); }

export async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  setToken(null);
  state.me = null;
  state.follows = [];
  emit('auth');
}

document.documentElement.dataset.edition = state.edition;
