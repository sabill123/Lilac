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
