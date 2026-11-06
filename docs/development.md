# Development

Requirements: Node.js 22 LTS (the repo is tested on 22). Passwords use a WebAssembly Argon2id (`hash-wasm`), so there is no native dependency for them. `better-sqlite3` is the only native module; it ships prebuilt binaries for common platforms (if install fails on yours, run `npm rebuild better-sqlite3`, which needs Xcode Command Line Tools on macOS or build-essential on Linux).

```bash
npm install
cp .env.example .env            # for development set VERA_PUBLIC_URL=http://localhost:5173
npm run dev                     # API on :3001 (tsx watch) + Vite on :5173 (proxies /api)
```

Open http://localhost:5173. On first run the terminal prints a **setup code**; enter it with your chosen username/password. Local features work with no Gemini key.

| Command | What it does |
|---|---|
| `npm run dev` / `dev:server` / `dev:web` | Development servers |
| `npm run lint` | ESLint over `src server shared tests` |
| `npm run typecheck` | Frontend and backend `tsc --noEmit` |
| `npm test` | Vitest: **web** project (jsdom component tests) and **server** project (backend, security and end-to-end UI-over-real-backend tests) |
| `npm run build` | Frontend into `dist/`, backend into `dist-server/` |
| `npm start` | Run the compiled server (serves `dist/` too); set `NODE_ENV=production` |
| `npm run reset-password` | Owner recovery (needs shell access) |
| `npm run reset-data` | **Wipe everything** (database, WAL files, encryption key) to test first-run again. Stop the server first; it refuses if the database is in use. `--yes` skips the question, `--keep-key` keeps `secret.key` |

## Mock mode (development and tests only)

`VITE_VERA_API=mock npm run dev:web` runs the frontend against an in-memory demo API with no server. It simulates chat and tasks only; the Integrations Store, notes sync, accounts and settings report that they need the backend, and **no integration state is ever simulated**. Production builds throw if mock mode is requested, and the default is always the real HTTP client.

## Tests

* `tests/database.test.ts` migrations, persistence across restart, constraints, FTS.
* `tests/privacy.test.ts` classification (positives, false-positive guards, honest limits) and proof via a provider spy that blocked content never reaches the provider.
* `tests/api.test.ts` setup/login/limits/expiry/CSRF/origin/headers/validation/ownership/config safety.
* `tests/tools.test.ts` calculator, units, time zones, executor policy, timeouts, confirmations (reuse/expiry/changed args), files (traversal, symlinks), SSRF (incl. DNS rebinding and redirects), no shell/eval.
* `tests/integrations.test.ts` catalogue from the real registry (50 tools), lifecycle/idempotence, secrets never exposed, genuine connection tests against a fake Home Assistant, OAuth state/CSRF, uninstall retention, web/search/notification/diagnostics adapters.
* `tests/gemini.test.ts` SDK mapped with a mock client; limits, circuit breaker, quota/auth/timeouts, malformed and un-offered tool calls, prompt injection, cancellation, streaming. No paid request is ever required; an optional live smoke test needs `VERA_LIVE_GEMINI_TEST=1`.
* `tests/ui.test.tsx` the real React app + real `HttpVeraApi` + real backend (fetch bridged to `app.inject`): first-run setup, login, connection-error state, store search/filters, one-click install, the full Home Assistant wizard (validation, failed then successful test, Turn on), permissions, disable, guarded uninstall, persistence across reload, privacy notice.

## Measuring resource use

```bash
npm run build
NODE_ENV=production VERA_DATA_DIR=/tmp/v VERA_SETUP_TOKEN=some-long-token PORT=3011 node dist-server/server/src/index.js &
grep -E 'VmRSS|VmHWM' /proc/$!/status      # idle and peak resident memory
```

Recorded on the build machine (Node 22): idle ≈ 116 MB, peak ≈ 200 MB after 300 concurrent catalogue requests + 100 chat requests, ≈ 0 CPU at idle. Re-measure on the target N5000 before relying on it.

## Android

The Android app is a native Expo app in `mobile/`, built into an APK by GitHub Actions. See [mobile.md](mobile.md) for how it connects, how to get an APK, signing, and local development.

## Starting from scratch for testing

```bash
# 1. stop the dev server (Ctrl+C), then:
npm run reset-data            # type "wipe" to confirm
npm run dev                   # prints a NEW setup code
```

Open the app: you get the setup screen, then the welcome tour. (The tour flag lives in the browser; creating the owner re-arms it automatically. To also reset appearance settings and any demo data, clear the site's storage: DevTools → Application → Local Storage → delete, or run `localStorage.clear()` in the console.)

In Docker: `docker compose down && rm -rf ./data && docker compose up -d`.
