import { publicPreview, previewBlocksRequest, PREVIEW_NOTICE } from './public-preview';
export interface CatalogTrack { id: number; title: string; artist: string; album: string; artwork: string; preview: string; appleUrl: string; durationMs?: number; releaseDate?: string; }
export interface Artist {
  id: string; name: string;
  nameJa: string | null;
  /** 로마자·원표기 (K-POP 팀은 한글명이 대표) */
  nameOriginal?: string;
  country?: 'jp' | 'kr';
  genre: string; appleGenre?: string;
  searchTerm: string;
  operator: string | null; official: string | null;
  /* 운영사를 어디서 받았는지. 사람이 확인한 값은 이 필드가 없고,
     MusicBrainz 자동 수집분은 'musicbrainz' 다. 화면에서 구분해 표시한다. */
  operatorSource?: string | null; operatorMbid?: string | null;
  appleArtistId?: number; artwork?: string | null;
  chartHits?: number; bestRank?: number | null;
  aliases?: string[];
}
export interface SeedTrack { id: string; title: string; artist: string; artistId: string; tag: string; youtubeId: string | null; ytViews: number; searchTerm: string; }
export interface Ev {
  id: string; type: string; title: string; artist: string;
  artistId?: string; country?: 'jp' | 'kr';
  date: string; venue: string; note?: string;
  artwork?: string; appleUrl?: string; trackCount?: number;
  /** 실제 발매일(false)인지 예시 공연 일정(true)인지 */
  isDemo?: boolean; source?: string;
}
export interface Edition {
  id: string; label: string; feeKind: string; real: boolean; digital?: boolean;
  /** 현지 통화 기준 정가 (구버전 데이터는 jpy 필드를 쓴다) */
  amount?: number; jpy?: number;
  localCurrency?: 'KRW' | 'JPY';
  pricing: {
    localAmount?: number; localCurrency?: string; jpy?: number;
    rate: number; base: number; feeRate: number; fee: number; shipping: number; total: number;
    buyerCurrency?: 'KRW' | 'JPY';
  };
}
export interface Product {
  id: string; name: string; brand: string; artistId: string;
  /** 원산지 — 일본반(jp)은 한국으로, 한국반(kr)은 일본으로 보낸다 */
  origin?: 'jp' | 'kr';
  originLabel?: string; routeLabel?: string; genre?: string;
  size: 'single' | 'mini' | 'album'; sizeLabel: string; badge: string;
  price: number;
  /** 구매자가 지불하는 통화 (일본반→KRW, 한국반→JPY) */
  priceCurrency?: 'KRW' | 'JPY';
  editions: Edition[];
  rate: number; rateDate: string; rateLive: boolean;
  releaseDate: string; trackCount: number; artwork: string; appleUrl: string;
  digitalJpy?: number | null; digitalLocal?: number | null;
  operator: string | null; officialUrl: string | null;
  towerUrl?: string; shopUrl?: string; shopLabel?: string;
  searchTerm: string; stock: number; desc: string;
}
export interface PlayableTrack { title: string; artist: string; album?: string; artwork?: string; preview?: string; youtubeId?: string | null; addedAt?: string; durationMs?: number; }
export interface User { id: string; email: string; name: string; language: string; plan: { tier: string; name: string; renewsAt: string | null }; credits: number; createdAt: string; paymentMethods: { id: string; brand: string; last4: string }[]; }

/* ---------- 세션 토큰 ----------
   예전엔 서버가 세션 파일 하나로 "현재 사용자"를 전역 관리했고, 프론트는
   토큰을 받아놓고 쓰지 않았다. 그래서 나중에 로그인한 사람이 앞사람의 세션을
   덮어쓰고, 모든 계정이 같은 보관함·주문을 봤다.
   이제 토큰을 저장해 요청마다 실어 보낸다. */
const TOKEN_KEY = 'lilac.token';

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* 프라이빗 모드 등 — 토큰 없이도 공개 기능은 돌아간다 */ }
  // 쿠키에도 심는다. 헤더를 못 붙이는 경로(문서 이동 등)를 위한 폴백이다.
  try {
    document.cookie = t
      ? `lilac_token=${encodeURIComponent(t)}; path=/; max-age=${30 * 864e2}; samesite=lax`
      : 'lilac_token=; path=/; max-age=0';
  } catch { /* noop */ }
};

/** 서버가 주는 오류 코드까지 붙여 던진다 — 화면이 상황별로 다르게 반응할 수 있게 */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const api = async (path: string, init?: RequestInit) => {
  if (previewBlocksRequest(path, init?.method)) throw new ApiError(PREVIEW_NOTICE,403,'READ_ONLY_PREVIEW');
  const token = publicPreview ? null : getToken();
  const headers: Record<string, string> = init ? { 'content-type': 'application/json' } : {};
  const provided = init?.headers;
  if (provided && !Array.isArray(provided) && typeof (provided as Headers).forEach === 'function') {
    (provided as Headers).forEach((value, name) => { headers[name.toLowerCase()] = value; });
  } else {
    for (const [name, value] of (Array.isArray(provided) ? provided : Object.entries(provided || {}))) headers[name.toLowerCase()] = value;
  }
  if (publicPreview) { delete headers.authorization; delete headers.cookie; }
  if (token) headers.authorization = `Bearer ${token}`;

  // Vercel's same-origin gateway cookie is required; Lilac application credentials are not.
  const r = await fetch(path, { ...init, headers, ...(publicPreview ? { credentials: 'same-origin' as RequestCredentials } : {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && !publicPreview) {
      // 토큰이 죽었으면 들고 있어봐야 계속 401 이 난다. 지운다.
      setToken(null);
      /* 인증 필요를 한 곳에서 알린다.
         이걸 안 하면 각 호출부가 개별로 처리해야 하는데, 실제로 아무도 안 해서
         좋아요·팔로우·플리추가가 비로그인에서 "눌러도 아무 일 없음"이 됐다.

         ⚠️ 단, 조회(GET)에는 알리지 않는다.
         화면을 그리려고 배경에서 부르는 GET 이 많고(보관함 요약, 오시 목록 등)
         그것까지 로그인 유도로 처리하면 아티스트 목록 같은 공개 화면이
         로그인으로 튕긴다 — 실제로 그 회귀를 냈다.
         쓰기(POST/PATCH/PUT/DELETE)는 언제나 사용자가 누른 결과다. */
      const method = (init?.method || 'GET').toUpperCase();
      if (method !== 'GET') {
        document.dispatchEvent(new CustomEvent('lilac:auth-required', { detail: { path } }));
      }
    }
    throw new ApiError(j.error || `HTTP ${r.status}`, r.status, j.code);
  }
  return j;
};

/** 로그인이 필요한 동작 앞에 세우는 가드.
 *  서버까지 갔다 와서 실패하는 것보다 즉시 알려주는 편이 낫다. */
export function needsLogin(action = '이 기능'): boolean {
  if (me) return false;
  document.dispatchEvent(new CustomEvent('lilac:auth-required', { detail: { action } }));
  return true;
}

const catalogCache = new Map<string, CatalogTrack | null>();
/* 아트워크 조회 배칭
   한 화면에서 수십 개 카드가 각자 요청을 보내면 요청 수 자체가 병목이 된다.
   같은 틱에 들어온 요청을 모아 한 번에 보낸다. */
let batchQueue: { term: string; resolve: (v: CatalogTrack | null) => void }[] = [];
let batchTimer: number | null = null;

async function flushBatch() {
  const queue = batchQueue;
  batchQueue = [];
  batchTimer = null;
  if (!queue.length) return;

  const terms = [...new Set(queue.map((q) => q.term))];
  try {
    const r = await fetch('/api/catalog/batch', {
      ...(publicPreview ? { credentials: 'same-origin' as RequestCredentials } : {}),
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ terms }),
    });
    const { results } = await r.json();
    queue.forEach((q) => {
      const hit = (results?.[q.term] ?? null) as CatalogTrack | null;
      catalogCache.set(q.term, hit);
      q.resolve(hit);
    });
  } catch {
    queue.forEach((q) => q.resolve(null));
  }
}

export function findCatalog(term: string): Promise<CatalogTrack | null> {
  if (catalogCache.has(term)) return Promise.resolve(catalogCache.get(term)!);
  return new Promise((resolve) => {
    batchQueue.push({ term, resolve });
    // 40개가 모이면 즉시, 아니면 다음 프레임에 전송
    if (batchQueue.length >= 40) flushBatch();
    else if (batchTimer === null) batchTimer = window.setTimeout(flushBatch, 16);
  });
}
/** 표시 크기에 맞는 아트워크 URL — Apple CDN은 임의 크기를 지원한다.
 *  원본(600px)을 썸네일에 쓰면 대역폭과 디코딩 비용이 그대로 낭비된다. */
export const artUrl = (t: { artwork?: string } | null, size = 400) => {
  if (!t?.artwork) return '';
  // 고밀도 화면에서도 2배를 넘기지 않는다 (그 이상은 육안 차이가 없다)
  const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
  const px = Math.min(Math.round(size * dpr), 1200);
  return t.artwork.replace(/\/\d+x\d+bb\.(jpg|png|webp)/, `/${px}x${px}bb.$1`);
};

// 세션 상태 (모듈 전역)
export let me: User | null = null;
export async function refreshMe() { me = (await api('/api/me').catch(() => ({ user: null }))).user; return me; }
export const esc = (s: string) => String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
export const icon = (id: string, cls = 'ic') => `<svg class="${cls}"><use href="#${id}"/></svg>`;
