export interface CatalogTrack { id: number; title: string; artist: string; album: string; artwork: string; preview: string; appleUrl: string; }
export interface Artist { id: string; name: string; nameJa: string; genre: string; searchTerm: string; operator: string; official: string; }
export interface SeedTrack { id: string; title: string; artist: string; artistId: string; tag: string; youtubeId: string | null; ytViews: number; searchTerm: string; }
export interface Ev { id: string; type: string; title: string; artist: string; date: string; venue: string; note: string; }
export interface Product { id: string; name: string; brand: string; price: number; badge: string; searchTerm: string; operator: string; officialUrl: string; towerUrl: string; desc: string; options: string[]; stock: number; }
export interface PlayableTrack { title: string; artist: string; album?: string; artwork?: string; preview?: string; youtubeId?: string | null; addedAt?: string; }
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
