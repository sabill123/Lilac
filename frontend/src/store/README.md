# Store listing

`renderStore(root, products, artists)` owns the `#/store` listing. The route calls it in both browse and play shells. Product detail, home/artist product cards, and release comparison are separate capabilities and are not restyled by this module.

## Design references

The actual public pages were inspected, rather than recreating a remembered music-service UI:

- [29CM](https://www.29cm.co.kr/): category navigation, image-first product grid, brand → product name → price hierarchy.
- [MUSINSA](https://www.musinsa.com/main/musinsa/recommend): separation of global navigation, shop search and merchandising.
- [Weverse Shop album category](https://shop.weverse.io/en/shop/USD/artists/2/categories/1): uniform album images and compact purchase metadata.

The listing uses a white merchandising surface inside Lilac's existing dark shell. It does not copy discounts, reviews, delivery guarantees, inventory, or ranking labels because the catalog does not supply those facts.

Promotional headlines, banners and duplicate section headings are omitted. Desktop has sidebar facets and a responsive product grid. At 1440px the grid has five columns. Mobile replaces the duplicate global search with in-store search, collapses filters and uses two columns. Filter controls expand in document flow, not in a modal requiring a separate focus trap.

## Ownership

- `model.ts`: independent filter/sort/pagination state, dynamic artist facets, currency comparison.
- `index.ts`: listing markup, root-scoped event handlers, per-render AbortController, accessible controls and estimate disclosures.
- `store.css`: listing-only styling, imported after the shared page styles. Shared `.p-card` and product-detail styles are intentionally untouched.
- `tests/verify-store-ux.mjs`: executes the real model, renderer and Korean/Japanese matcher through the project's TypeScript compiler.

Filter state is retained when navigating to a product and back during the same app session. Reload resets it. Country, album type, artist and submitted search query compose with AND. Changing country clears artist selection; other filter or sort changes reset pagination. Artist options are derived from incoming catalog data, not maintained as a manual list.

## Search and price semantics

Search stays inside the catalog and is not capped by the global search API. ASCII queries use case-insensitive NFKC literal matching so reading aliases do not turn `YOASOBI` into unrelated `You` titles. Korean and Japanese queries use the existing cross-script matcher and artist metadata.

Displayed prices remain the original buyer-currency estimates: Japanese editions in KRW and Korean editions in JPY. Price sorting compares KRW equivalents. Korean products store KRW → JPY in `Product.rate`, so their JPY totals are divided by that rate. Unconvertible/invalid totals sort last in either direction. Sorting does not change displayed totals or order amounts.

Catalog cards link to `#/store/{encoded product id}`; verified retailer comparisons remain at `#/releases` and `#/release/{release id}`. No mapping between unrelated catalog IDs and release IDs is inferred.

## Verification

Run `npm run build` and `npm run test:ui`, or `npm run test:store` for the 20 store regression groups. Browser checks should additionally cover:

- Search, compound filters, empty state, clear/reset and keyboard focus after selection.
- More products, low/high native-currency ordering and return from product detail.
- Comparison navigation and both page shells.
- 320, 390, 768, 1024 and 1440px: no horizontal page overflow, one h1, visible first-row prices, and no player/navigation overlap.

The tests do not create accounts, orders or payments. Commerce transactions are still the existing demo implementation, not a new production checkout.
