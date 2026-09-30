# Protected read-only Vercel preview

This adapter is not a backend migration or a production service. Enable Vercel Deployment Protection before exposing the preview. Do not add a public production domain. `noindex` is not authentication. Existing awards images remain included because they are part of the requested UI, but local-prototype image permissions are not a public-distribution license. Public launch requires a separate asset/music rights audit and replacement or permission where needed.

## Build and artifact

Use Node 22+ (configure Node 22 in the Vercel project). No new runtime dependency is needed. `vercel.json` installs the nested locked frontend with `npm ci --prefix frontend`, builds `frontend/dist`, and uses `api/index.mjs` as the same-origin Node function. No original database is uploaded or accessed at runtime.

Before an authorized deploy, locally run:

```sh
node scripts/export-public-demo.mjs
node scripts/export-public-demo.mjs --check
node tests/verify-public-api.mjs
```

Exporter reads only ten explicitly named public JSON files and projects explicit DTO fields, including nested allowlists. It does not copy a database tree. Source timestamps remain source timestamps; missing timestamps are null rather than export dates. `server/public/data/snapshot.json` and `manifest.json` are immutable deploy inputs with a verified SHA-256. Add `/server/public/data/` to Git ignore before committing (parent-owned change). Git-connected deploys require these generated assets supplied by an approved artifact step; remote builds deliberately cannot re-export from db.

Suggested root package scripts (not edited by this implementation):

- `export:public`: `node scripts/export-public-demo.mjs`
- `test:public`: `node tests/verify-public-api.mjs`
- `smoke:public`: `node scripts/verify-public-deploy.mjs`

The upload allowlist includes current frontend source/public assets, two reviewed pure existing helpers (`pricing.mjs`, `ko-ja.mjs`), the function, handler, sanitized data, and config. It excludes all original db, backend startup/collectors, credentials, environments, screenshots, logs, dependencies, and unrelated directories. Inspect Vercel's actual file trace/upload list before deployment. Do not weaken exclusions to fix a missing module.

## Contract and limitations

Only approved GET routes and the semantically read-only catalog batch POST are accepted. All other paths/methods return JSON 403/405. Private account, contact, order, group-buy, AI, sync, rebuild and administrative functionality is absent. No account cookie is read; `/api/me` always returns `user:null`. Unknown API paths cannot fall through to the SPA.

Music catalog and chart browsing uses exported snapshots. Searches use the existing pure phonetic helpers plus the exported generated readings index, not just manual aliases. iTunes lookups are snapshot-first, at most three query candidates per term, batch 40 terms, 16 KiB body, 160 characters per term, three concurrent batch workers, 2.2-second upstream timeout and 7.5-second request budget. Numeric exact song IDs never substitute another song. Queries and playback previews remain subject to storefront availability. Outages yield empty search hits or null batch hits, not invented songs. Snapshot preview URLs can expire; snapshots are not auto-refreshed. No YouTube scraping occurs.

Charts retain actual collection timestamps and are explicitly `live:false`. Combined chart method remains a Lilac weighted aggregate, not an official chart. YouTube artist totals are unavailable (`null`), never made-up counts. Artist tracks/albums are available; the `popular` ranking is deliberately empty rather than labeling newest catalog tracks as popular. Fandom returns public channel links but not inferred membership mechanics. Focus mixes/AI are unavailable. Plans are display-only.

Store releases/details retain source metadata and editions. Purchase and comparison quotes are unavailable; comparisons have empty rows and an explicit unavailable explanation. Existing product estimates are historical demo values, not executable purchase quotes. Frankfurter FX fetch has a bounded timeout and falls back to one real snapshot point, never a fabricated time series.

## Verification and release operations

`node tests/verify-public-api.mjs` invokes the actual handler against approved fixtures and controlled fetch. It verifies shapes, country filtering, alias search, playback IDs, missing-ID fallback, batch limits/concurrency, private/traversal/mutation blocks and no runtime IO/scheduler imports. The exporter `--check` confirms deterministic bytes against the current approved sources. Existing backend tests and smoke collectors are not run.

After deployment, run `node scripts/verify-public-deploy.mjs https://YOUR-PREVIEW`. This issues GET probes only, including blocked private API and static file paths. Protected login responses are not successful app verification. Use an authorized preview session to verify behind protection; never disable protection just to get a green smoke test. Vercel packaging, protected browser rendering, live upstream behavior and actual deployment are not verified by fixture tests alone.

Rollback means redeploying a previously verified immutable artifact, including its matching manifest. Do not alter production databases or run collectors as part of release/rollback.
