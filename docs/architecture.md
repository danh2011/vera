# Architecture

Vera is a **modular monolith**: one Node.js process serves the React frontend and a versioned JSON API (`/api/v1`) and talks to one SQLite file. There are no microservices, queues, vector databases or local models.

```
Browser (React, Vite build)  ──HTTPS──▶  Nginx Proxy Manager  ──▶  Vera (Fastify)
                                                                     │
        ┌───────────────┬──────────────┬───────────────┬─────────────┴──────────┐
        ▼               ▼              ▼               ▼                        ▼
     auth/session   chat orchestrator  tool executor  integration service   privacy gateway
        │               │   ▲            │   ▲            │                      │
        │               ▼   │            ▼   │            ▼                      │
        │          AI guard + Gemini   built-in adapters (11 modules, 50 tools)  │
        └──────────────▶ repositories ──▶ SQLite (WAL, FTS5)  ◀── secrets (AES-GCM, key outside DB)
```

## Source layout

| Path | Purpose |
|---|---|
| `src/` | React frontend (unchanged design system; new Integrations Store under `src/pages/integrations/`, auth gate in `src/Auth.tsx`, `HttpVeraApi` in `src/services/http.ts`) |
| `shared/types/` | Type-only DTOs shared by frontend and backend |
| `server/src/config.ts` | Validated environment configuration; fails closed on dangerous settings |
| `server/src/database/` | Migrations, connection set-up, repositories (all SQL lives here) |
| `server/src/auth/` | Argon2id passwords, sessions, login limiter |
| `server/src/security/` | Privacy gateway, secret box, SSRF-safe fetch, safe path resolution |
| `server/src/ai/` | Provider interface, Gemini adapter, cost guard, chat orchestrator |
| `server/src/tools/executor.ts` | The single gate every tool call passes through |
| `server/src/integrations/core/` | Module contract, helpers, lifecycle service |
| `server/src/integrations/adapters/` | The 11 bundled integrations |
| `server/src/app.ts` | HTTP surface, hooks, error handling, static hosting |
| `tests/` | Backend, security and end-to-end UI tests |

## Request flow for a chat message

1. Authenticate (session cookie) and check CSRF + origin.
2. Enforce the input size limit.
3. **Privacy gateway**: financial, credential and sensitive-personal content is blocked *before anything else*. The raw text is not stored, not logged and not sent anywhere; the conversation records a redacted copy and a policy notice.
4. **Deterministic local router**: time, arithmetic, unit conversion, "list my tasks", "add task …", disk/CPU status, integration health. These never touch a cloud model and cost nothing.
5. If a provider is ready, build a bounded context (recent history and relevant memories, each re-screened by the gateway) and offer only the few enabled tools that look relevant (max 10).
6. Call Gemini through the AI guard (explicit enable, owner acknowledgement, rate limits, daily limit, retries, circuit breaker, usage counters).
7. For each requested tool call, the **executor** decides: tool exists → integration installed, configured, authorised and enabled → arguments valid → permission granted → privacy policy on arguments → confirmation if required → concurrency and timeout → run → bound result size → redact before the result re-enters model context → audit. The model is never trusted to authorise itself, and may only call tools it was offered for this request.
8. Round limit enforced; final text screened for credential/financial echoes; message and tool-call metadata persisted (never chain-of-thought).

Each answer records the real steps taken (privacy check, local shortcut, context, tools offered, each AI call with token counts, each tool run with duration and outcome). They stream live as `step` events and are saved with the message (labels, tool names and timings only, never content, arguments or secrets); the chat shows them as one collapsed line above the answer ("Worked for 2.3 s · 5 steps", click to expand). A reply keeps running on the server and in the browser's run store when you leave the chat page; the sidebar shows a spinner while it works and a dot when a reply is ready, and returning shows the question and the live line, never a blank page.

The model may only call tools it was offered for that message (the prompt lists them by name, plus which integrations aren't ready). Anything else is refused with a message listing the valid names, is shown as a refused step, and is never counted as a tool used.

Streaming uses newline-delimited JSON over `POST …/messages?stream=1`. The status labels in the UI ("Thinking", "Checking tasks", "Waiting for confirmation") are emitted only when that work really happens. Closing the browser aborts the provider call and any running tool.

## Integration platform

Each integration is a typed module (`IntegrationModule`): manifest, config schema, tools, `validateConfig`, `healthCheck`. Modules are **bundled and reviewed**; installing one records state in SQLite. Nothing is downloaded or executed at install time (a test scans the source for `eval`, `child_process`, dynamic `import()` and friends).

State is stored and computed consistently on the server; the frontend renders the catalogue endpoint and never holds a second list.

| Concept | Meaning | Where it comes from |
|---|---|---|
| Available | Bundled, not installed | `integrations.installed = 0` |
| Installed | Registered; config/credentials can be saved | `installed = 1` |
| Configured | All required settings present | computed from schema + stored settings/secrets |
| Authorised | OAuth token present (OAuth integrations) | encrypted secret exists |
| Enabled | Its tools may run (subject to permissions) | `enabled = 1` |
| Connected | Last real test succeeded | `connection = 'connected'` after `test-connection` |
| Tool availability | per tool: available / needs install / needs enable / needs configuration / needs authorisation / permission denied / unavailable | computed per request |

## Resource profile

One process, one SQLite connection, bounded tool concurrency (4 running, 8 queued), bounded caches and ring buffers, no polling loops. Measured on the compiled build (Node 22, this development machine): ~116 MB RSS idle, ~200 MB peak after 300 concurrent catalogue requests plus 100 chat requests, ~0 CPU at idle. These are measurements, not guarantees; re-measure on the N5000 (see `docs/development.md`).
