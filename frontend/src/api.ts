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

export const api = (path: string, init?: RequestInit) =>
  fetch(path, init ? { headers: { 'content-type': 'application/json' }, ...init } : undefined).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  });

const catalogCache = new Map<string, CatalogTrack | null>();
export async function findCatalog(term: string): Promise<CatalogTrack | null> {
  if (catalogCache.has(term)) return catalogCache.get(term)!;
  try {
    const { tracks } = await api(`/api/catalog/search?term=${encodeURIComponent(term)}&limit=3`);
    const hit = (tracks as CatalogTrack[]).find((t) => t.preview) ?? (tracks as CatalogTrack[])[0] ?? null;
    catalogCache.set(term, hit);
    return hit;
  } catch { return null; }
}
export const artUrl = (t: { artwork?: string } | null, size = 400) =>
  t?.artwork ? t.artwork.replace('400x400', `${size}x${size}`) : '';

// 세션 상태 (모듈 전역)
export let me: User | null = null;
export async function refreshMe() { me = (await api('/api/me').catch(() => ({ user: null }))).user; return me; }
export const esc = (s: string) => String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
export const icon = (id: string, cls = 'ic') => `<svg class="${cls}"><use href="#${id}"/></svg>`;
