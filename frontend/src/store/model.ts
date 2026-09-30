import type { Product } from '../api';
import { smartMatch } from '../koja';

export type StoreState = {
  origin: 'all' | 'jp' | 'kr';
  size: 'all' | Product['size'];
  artist: string;
  query: string;
  sort: 'new' | 'low' | 'high' | 'name';
  page: number;
};
export const PAGE_SIZE = 24;
export const initialStoreState = (): StoreState => ({ origin: 'all', size: 'all', artist: 'all', query: '', sort: 'new', page: 1 });
export const productOrigin = (p: Product) => p.origin || 'jp';
export const productCurrency = (p: Product) => p.priceCurrency || (productOrigin(p) === 'kr' ? 'JPY' : 'KRW');

/** Product.rate is local -> buyer currency. Korean products carry KRW -> JPY,
 * so their JPY total is divided by that rate for cross-currency comparison.
 * This only orders cards; the displayed and charged native total stays unchanged. */
export function comparablePrice(p: Product): number | null {
  if (!Number.isFinite(p.price) || p.price < 0) return null;
  if (productCurrency(p) === 'KRW') return p.price;
  return Number.isFinite(p.rate) && p.rate > 0 ? p.price / p.rate : null;
}
export function filterProducts(products: Product[], state: StoreState, aliases: ReadonlyMap<string, string> = new Map()): Product[] {
  const query = state.query.trim();
  // Roman artist names must not expand into loosely related reading aliases.
  // Keep the existing cross-script matcher for Korean/Japanese queries only.
  const literal = /^[\x00-\x7F]*$/.test(query);
  const matches = (text: string) => literal
    ? text.normalize('NFKC').toLowerCase().includes(query.normalize('NFKC').toLowerCase())
    : smartMatch(text, query);
  const list = products.filter(p =>
    (state.origin === 'all' || productOrigin(p) === state.origin) &&
    (state.size === 'all' || p.size === state.size) &&
    (state.artist === 'all' || p.brand === state.artist) &&
    (!query || [p.name, p.brand, p.searchTerm || '', aliases.get(p.artistId) || ''].some(matches))
  );
  return list.sort((a, b) => {
    if (state.sort === 'low' || state.sort === 'high') {
      const ap = comparablePrice(a), bp = comparablePrice(b);
      if (ap === null || bp === null) return ap === bp ? a.id.localeCompare(b.id) : ap === null ? 1 : -1;
      const diff = state.sort === 'low' ? ap - bp : bp - ap;
      if (diff) return diff;
    } else if (state.sort === 'name') return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    return (b.releaseDate || '').localeCompare(a.releaseDate || '') || a.id.localeCompare(b.id);
  });
}
export function updateStoreState(state: StoreState, patch: Partial<Omit<StoreState, 'page'>>): StoreState {
  return { ...state, ...patch, ...(patch.origin !== undefined && patch.origin !== state.origin ? { artist: 'all' } : {}), page: 1 };
}
export function artistFacets(products: Product[], origin: StoreState['origin']) {
  const counts = new Map<string, number>();
  for (const p of products) if (origin === 'all' || productOrigin(p) === origin) counts.set(p.brand, (counts.get(p.brand) || 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b));
}
export function visibleProducts(products: Product[], state: StoreState) {
  return products.slice(0, Math.max(1, state.page) * PAGE_SIZE);
}
