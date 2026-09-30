# Home awards

Integration API: `homeAwardsHtml(): string` and `mountHomeAwards(root: HTMLElement, signal: AbortSignal): void` from `index.ts`. Place after the home music hero, before music lists. Import `awards.css` in the parent's pages cascade layer. No independent route or autoplay. Exactly one mounted home section is expected.

Seven explicit visual compositions share only the inline record/source disclosure. Arrow Left/Right wrap, Home/End select, native tabs retain roving focus. Current event and each disclosure survive in module memory when leaving home. The root AbortSignal removes every listener; no observers, timers, storage or global listeners are used.

`data.ts` preserves every verified record, source and editorial scope from the prior dataset without changing values. `model.ts` retains date, source, classification and record validation while removing hub filtering/routing. Tests use a fixed 2026-09-06 audit date, not an assumption that future results exist.

## Rights and provenance

**Local prototype only. Do not publish these reference images until all image, photograph, sponsor logo and trademark permissions have been cleared.** Public availability is not permission. The exact original URL, dimensions, local file and transformation are recorded in `public/awards/asset-provenance.json` and exposed through the source disclosure, not visible overlay badges. KMA GIF is a static frame converted with macOS `sips`. Photos use JPEG quality 75 and max 1920 longest edge. Wide wordmarks and TBS's 16:9 host image are contained without cropping. Golden Disc's original background filename includes 2025 but depicts the official 40th edition in 2026. NHK imagery is expressly excluded because of its republication prohibition; its red/white/gold typography is original and links to the official visual. The watermarked Record Awards winner photo is not used.

Run `node tests/verify-home-awards.mjs` from repository root. The VM DOM harness checks behavior, not browser layout. No live source re-audit is claimed by these offline tests.
