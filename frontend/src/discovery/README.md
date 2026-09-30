# Music discovery

The home and chart routes share this feature in browse and play shells. Listening is the entry experience; album information and the store are secondary destinations after discovery. The commerce listing remains a separate feature.

## Ownership

- `index.ts`: public home/chart renderers, catalog playback resolution, country/source navigation, filters and artwork integration.
- `model.ts`: pure, nullable-safe chart identity, provider movement, cross-source selection, artist matching, collection-age and debut eligibility.
- `debuts.ts`: verified music-debut evidence. It is not a manually assigned permanent rookie list.
- `discovery.css`: bounded home/chart styles. The older `styles/home.css` is no longer imported.
- `../three/`: lazy artwork scenes and their GPU/observer lifecycle. See its README for the complete integration contract.

`main.ts` calls `disposeDiscovery()` before route replacement. This cancels stale rendering and playback results. Never remove this call when changing the router: an earlier lookup must not replace a newer screen or queue.

## Display rules

The public `/api/charts` snapshots supply rankings; no seeded tracks fill missing charts. Country controls persist the chart market, not a genre filter. A Japanese chart can therefore contain Korean artists. An unavailable country/source combination returns to the combined route with the URL updated.

- **인기**: reported chart order, up to ten tracks on home. Hero badges display the actual supplied rank, not an assumed first place.
- **상승 / 신규 진입**: source-reported Billboard JAPAN previous-rank fields only. Contradictory or missing comparisons remain unknown. Collection time does not prove the chart issue is current, so no real-time-growth claim is made.
- **주목**: outside the selected chart's TOP 10, at least two independent chart families, up to six tracks ordered by family count then reported rank. Apple and its RSS feed count once. The app's YouTube ranking reorders the same song pool by cumulative views, so it is excluded as independent corroboration.
- **신인**: verified formal music debut within 24 calendar months. The date and evidence link are visible. New chart entry, formation, earliest catalog recording and low rank never qualify an artist. Unknown artists remain unclassified rather than incorrectly labeled veterans.

Artist identity uses complete registered names/aliases. A bilingual `X (Y)` label is accepted only when both halves are registered and share exactly one artist ID. Ambiguous names such as 키키 remain unresolved without further identity evidence. Displayed track counts deduplicate titles only after artist identity has been established.

The first evidence records cover HANA, Hearts2Hearts, CORTIS and KiiiKiii. The registry is intentionally incomplete and must be extended with verified sources, not guesses. KiiiKiii uses its March 24 formal debut, distinct from its February 24 pre-debut/anniversary; its source label preserves that distinction. New verified records automatically expire from eligibility after two years.

Collection timestamps are shown in KST with a stale/unknown state. They can differ from original source publication times, and the backend may preserve an earlier source snapshot when collection fails. Upstream ranking merge/matching quality is not repaired by the UI.

## Playback and artwork

Preview buttons resolve only the selected song or an eight-track queue. A supplied Apple song ID is binding; otherwise artist and complete title must match. An unrelated first search hit is rejected and a bounded catalog search tries exact candidates. If no matching preview exists, show the unavailable message. MV-only entries do not enter the audio queue; MV actions remain explicit.

For providers without artwork, the renderer joins artwork/catalog links from the same country's combined snapshot using the full artist-and-title key. It never borrows rank, movement or corroboration metrics. Static artwork stays present while Three loads and when WebGL/Data Saver/texture loading prevents enhancement. Audio controls do not depend on a canvas.

The motion toggle pauses actual scene animation and persists its preference locally. OS reduced-motion overrides it. Scenes pause outside the viewport and in hidden tabs; route changes dispose their GPU resources. CSS card depth is also disabled with reduced motion or the local off preference.

On mobile, the chart's duplicated second/third-place hero cards are omitted because those tracks are immediately available in the list. The main artwork, play controls, search and ranking list remain. Provider details, likes and MV actions are accessible through each row's more menu.

## Verification

- `npm run build`: TypeScript and production bundles.
- `npm run test:discovery`: actual model and renderer behavior with controlled provider/DOM fixtures.
- `npm run test:three`: actual scene/lifecycle code with controlled DOM/GPU adapters, including context loss, reduced motion, offscreen pausing and late texture cleanup.
- `npm run test:ui`: all of the above plus service, route lifecycle, player, store and home awards regressions. No account/order/payment creation.

Browser QA should additionally verify both countries, provider/filter/search changes, keyboard preview playback, queue actions, chart-to-home navigation, both shells, motion on/off and 320/390/768/1024/1440px layouts. Mocked GPU tests do not replace checking real canvas rendering. Full-track Apple Music authorization and real-device iOS/Android behavior are separate checks.


## Immersive home ownership

home-immersive.css owns the warm full-width home only; the chart remains dark and the store keeps its separate light surface. A full-screen-sized record hero precedes the inline awards section and existing music lists. The three visible record destinations also have ordinary text links. A real scene failure disables the motion button and leaves artwork and playback usable. The observer disconnects when the render aborts. Standalone specials routes are intentionally absent.
