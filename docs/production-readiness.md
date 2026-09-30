# Production readiness: build and hosting

Audit: 2026-09-28. This document covers build/hosting only. A passing local build is not authorization to deploy and is not a claim of production readiness. No deployment, commit, real account mutation, or database migration was performed by these checks.

## Release status: local Node candidate available; public release still blocked

1. **The configured deployment backend does not serve the current frontend.** `frontend/index.html` mounts `src/app/main.ts`. That app requests `/api/live/home`, `/api/live/fanclub-list`, and `/api/community/hub`. `vercel.json` sends `/api/*` to `api/index.mjs`, which loads `server/public/handler.mjs`, the legacy protected read-only preview adapter. Executing the real adapter returned HTTP 403 for all three endpoints. `node scripts/verify-production-build.mjs --release` intentionally exits 1 while this mismatch exists. Do not “fix” the check by substituting fixture successes or removing these endpoints. Choose a deployment target for the current backend, with persistent storage and a same-origin reverse proxy, or implement a reviewed current-app read-only adapter and corresponding disabled-write UI.
2. **Persistent backend is not serverless-ready.** The full backend uses `LILAC_DB_DIR` JSON files, atomic rename, process-local coordination, recurring collectors, and long-lived SSE. Atomic rename avoids torn individual files; it does not establish multi-instance transaction safety, cross-collection atomicity, or backup restoration. Provision persistent storage, decide single-writer versus database migration, verify rollback/backup restoration, and test restarts and concurrent writes before launch. Do not upload the private `db/` tree to the static preview.
3. **Build dependency finding resolved by the parent task.** The frontend now declares Vite `^6.4.3`; the rebuilt app passes and the latest full frontend `npm audit` reports zero known vulnerabilities. This supersedes the earlier Vite 5.4.21/high-advisory observation. Development/preview services still must not be exposed as production hosts.
4. **Rights and operational controls are not yet release evidence.** The existing protected-preview guide says award imagery is prototype material, not a distribution license. Public asset/music rights review, real TLS/reverse-proxy configuration, production origin/session settings, monitoring/alerts, load tests, recovery exercises, and final security review remain release gates. A full enforcing CSP has not been deployed or tested; the UI still contains inline styles/handlers and third-party assets. Security headers below do not constitute a CSP.

## Concrete changes in this audit

- `scripts/serve-dist.mjs` remains a **local verification server**, now bound to `127.0.0.1` unless explicitly overridden. The server factory is importable for offline tests.
- Missing assets no longer return HTML with HTTP 200. SPA fallback applies only to HTML navigation. Invalid percent encoding returns 400 instead of escaping the handler; decoded traversal, dotfiles, private roots and symlinks outside the build root are denied.
- Only GET/HEAD serve static files. HEAD has no body. Hashed Vite assets receive immutable caching, while the HTML entry revalidates.
- Proxying preserves response status, redirects, multiple `Set-Cookie` values, request cookies and request bodies. Responses stream, including SSE. Previously the implementation buffered complete SSE streams and discarded all upstream headers except content type, breaking live updates and login sessions in built-bundle verification.
- Proxied bodies are bounded to 1 MiB; upstream response-header waiting is bounded to 15 seconds. Browser disconnects close upstream requests. Proxy errors do not expose internal error details.
- `nosniff`, frame denial, referrer policy and permissions policy are applied by the verification server. Vite development/preview adds the first three, binds loopback, fails rather than silently changing occupied ports, and explicitly uses the same API proxy. Source maps are explicitly disabled for production build.

## Verification performed

```sh
npm --prefix frontend run build
node scripts/verify-production-build.mjs
node scripts/verify-production-build.mjs --release
npm audit --omit=dev --json
npm --prefix frontend audit --omit=dev --json
npm --prefix frontend audit --json
```

Results:

- TypeScript and Vite production build completed.
- **28 behavioral/build assertions passed**, using temporary fixture files, loopback test servers and the real proxy module. Fixture servers/files are removed in `finally`. No live Lilac user store is read or mutated by these assertions.
- `--target=vercel --release` returns **exit 1 as designed** on the Vercel/current-app mismatch. `--target=node --release` passes **40 assertions**, including isolated startup of the actual long-running backend, built frontend, clean signal shutdown, and sibling cleanup after backend exit. Vercel incompatibility remains visible as a separate preview limitation; the node target does not use that adapter.
- Root and nested frontend production-dependency audits (`--omit=dev`) reported **0 known vulnerabilities** at observation time. This is not a whole-system security guarantee.
- After the Vite upgrade, full frontend audit reported **0 known vulnerabilities**.
- The optional Three.js lifecycle bundle remains roughly **552 kB uncompressed / 141 kB gzip** and emits a Vite chunk-size warning. It is not fixed by increasing the warning threshold. Verify on-demand loading and real-device memory/frame-time behavior; no mobile performance budget certification was performed here.

## Which tests support the current app?

| Test | Scope and caveat |
|---|---|
| `verify-v6-app.mjs` | Current `src/app` entry and many static source contracts. Helpful guardrails, not a browser functional pass. |
| `verify-community.mjs` | Executes real community code against an isolated memory store. Relevant behavioral tests, not persistent-store or end-to-end HTTP certification. |
| `verify-production-build.mjs` | Current built entry, actual local static/proxy behavior, and actual configured preview API mismatch. Relevant bounded release checks. |
| `verify-fanclub.mjs`, `verify-detail.mjs`, `verify-realtime.mjs` | Targeted helpers/contracts. Their pass counts must not be described as full live source coverage. |
| `verify-route-lifecycle.mjs` | Extracts router functions from **legacy `frontend/src/main.ts`**, not current `src/app/main.ts`. Does not prove current-router lifecycle correctness. |
| Legacy player/store/discovery/landing/preview checks in `test:ui` | Several target modules used by the former app. They may still protect reusable code but need an explicit dependency/entry mapping before being counted as current-app acceptance. |
| `verify-public-api.mjs`, `verify-public-deploy.mjs` | Protected legacy snapshot-preview checks. A green result cannot prove the current live frontend works with that adapter. |
| `scripts/smoke.mjs` | Live backend integration checks. Inspect mutation/setup behavior and run against an isolated store for release automation; do not equate HTTP success with semantic correctness or run an unfamiliar smoke script against production user data. |

The parent QC report owns current-app browser, backend auth, data accuracy and interaction coverage. This document intentionally does not invent results for those separate tracks.

## Local single-node production candidate

This is an explicit alternative to the unchanged protected Vercel preview, **not an Internet deployment**. It supervises the built frontend and actual long-running backend with a separately provisioned persistent DB. Both listeners are constrained to IPv4 loopback. The existing backend has no host option; the dedicated backend subprocess constrains Node TCP `listen` to `127.0.0.1` before loading the backend. This guard affects listeners, not outgoing clients.

Required environment, supplied through a local secret manager or untracked environment file:

- `NODE_ENV=production`
- `LILAC_DB_DIR`: absolute path to an existing readable/writable separately provisioned persistent directory. The checkout's `db/` is rejected. The launcher never copies or provisions production data.
- `LILAC_ALLOWED_ORIGINS`: comma-separated exact HTTPS origins, or HTTP loopback origins for local acceptance. Wildcards, paths, URL credentials and non-loopback plaintext origins are rejected.
- `LILAC_ADMIN_TOKEN`: supplied secret of at least 32 non-whitespace characters. Never generated or printed by this launcher.
- Optional `LILAC_PROD_PORT` (5241), `LILAC_BACKEND_PORT` (4640), distinct unprivileged ports.
- Optional `LILAC_DISABLE_BACKGROUND=1` for local acceptance without collectors. `--smoke` always disables collectors; ordinary launch otherwise runs the existing background work.

After installing the locked frontend and backend dependencies and building:

```sh
node scripts/start-production.mjs --check
node scripts/verify-production-build.mjs --target=node --release
node scripts/start-production.mjs --smoke
node scripts/start-production.mjs
```

`--check` is read-only and starts no processes. The verification suite creates an isolated temporary fixture store, never the working user DB. `--smoke` starts/stops real processes and can write housekeeping files to the explicit store; use a disposable store if unwanted. Normal launch intentionally runs collectors against the separately provisioned store.

The supervisor acquires `.production.lock`, rejects a recently active backend instance, checks port availability, and waits up to 20 seconds for backend health through the frontend proxy. SIGINT/SIGTERM stops both children. Any unexpected child exit stops its sibling and returns failure. The backend has 12 seconds to drain before forced termination, which is treated as failure. The lock is released only after children terminate. A hard-killed supervisor may leave a stale lock: establish that no writer remains before removing it. This is a single-machine safeguard, not distributed locking.

The Node target's green check establishes bounded local startup/build/proxy behavior, **not** live source accuracy, capacity, migration correctness, account deliverability, TLS, DNS, backup restoration, licensed assets or public launch readiness. External release gates remain explicit.

### Additional backend dependency audit

`npm --prefix backend audit --omit=dev` was also run after adding the candidate path. It reports **3 moderate findings** (0 high/critical). The earlier zero-runtime-audit statement covered only root and frontend manifests, not this separate backend package. Review/fix the backend dependency chain before public release; the launcher does not modify manifests or lockfiles.
