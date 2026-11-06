# API (`/api/v1`)

JSON over HTTPS. Authentication is a session cookie; every non-GET request also needs `X-CSRF-Token` (from `GET /auth/session` or the login/setup response). Errors:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "id": "<request id>", "fields": { "base_url": "…" } } }
```

Status codes: 400 validation/bad JSON · 401 `UNAUTHENTICATED` · 403 `CSRF_FAILED`/`BAD_ORIGIN`/privacy block · 404 · 409 state conflict (`NEEDS_SETUP`, `NOT_INSTALLED`, `BUSY`) · 413 · 422 semantic validation · 429 (`Retry-After` when relevant) · 499 cancelled · 500 never contains internals. Every response carries `X-Request-Id`.

| Area | Routes |
|---|---|
| Health | `GET /health`, `GET /ready` (public, minimal) |
| Setup | `GET /setup/status`, `POST /setup/owner {username,password,setupCode}` |
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/session`, `GET /auth/sessions`, `POST /auth/sessions/revoke-others`, `POST /auth/password` |
| Chat | `GET/POST /conversations`, `GET/PATCH/DELETE /conversations/:id`, `POST /conversations/:id/messages[?stream=1]` `{content, regenerate?}`, `POST /conversations/:id/cancel`, `GET /conversations/:id/tool-calls`, `POST /confirmations/:id/approve {token}`, `POST /confirmations/:id/cancel` |
| Tasks | `GET/POST /tasks`, `GET/PATCH/DELETE /tasks/:id`, `POST /tasks/:id/complete`, `GET/POST /reminders` |
| Notes / memory | `GET/POST /notes`, `PATCH/DELETE /notes/:id` (same for `/memory`); `GET …?q=` searches |
| Files | `GET /files?path=`, `GET /files/search?q=&contents=`, `GET /files/read?path=` (same policies and executor as the assistant) |
| Systems | `GET /system/overview` |
| Integrations | `GET /integrations`, `GET /integrations/:id`, `POST …/install`, `POST …/uninstall {acknowledge:true}`, `POST …/enable`, `POST …/disable`, `GET …/status`, `GET …/config-schema`, `POST …/configure {values, clearSecrets?, step?}`, `POST …/validate-config`, `POST …/test-connection`, `GET …/tools`, `GET …/permissions`, `PATCH …/permissions/:permission {granted}`, `POST …/oauth/start`, `GET /oauth/callback` |
| Settings | `GET /settings`, `GET/PATCH /settings/ai`, `POST /settings/ai/acknowledge`, `GET /usage`, `GET /audit?limit&before&action` |

**Streaming** (`?stream=1`) returns `application/x-ndjson`: `{"type":"status","label":"…"}` lines, then `{"type":"message",…}` or `{"type":"error",…}`. Disconnecting aborts the request.

**Configure semantics:** a blank secret keeps the stored one; `clearSecrets` removes; responses never include secret values (`secretsSaved` booleans only). Invalid values → 422 with per-field messages and nothing saved.
