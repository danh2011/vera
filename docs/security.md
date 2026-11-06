# Security

Vera is a **single-owner** application. The schema leaves room for more users, but this is not a multi-tenant security model and should not be presented as one.

## Authentication and sessions

* First-run setup creates the owner. It requires a **setup code** (printed in the server log at start-up, or your own `VERA_SETUP_TOKEN`) so nobody who reaches an un-set-up instance can claim it. There is no default password and no public registration.
* Passwords: Argon2id (19 MiB, 2 passes: the OWASP minimum, sized for a 4 GB host), at least 8 characters.
* Sessions are random 256-bit tokens; only their SHA-256 hash is stored. Cookie: `HttpOnly`, `SameSite=Lax`, `Secure` when `VERA_PUBLIC_URL` is https, 7-day absolute expiry, server-side revocation, logout, "sign out other devices", and automatic revocation of other sessions when the password changes. (`Lax` rather than `Strict` is required so the OAuth redirect back from Google carries the session; state-changing requests do not rely on it, see CSRF.)
* **CSRF:** every non-GET request needs the per-session `X-CSRF-Token` header (held in memory by the frontend, never in `localStorage`) and, if the browser sends an `Origin`, it must be in the trusted list (`VERA_PUBLIC_URL` plus `VERA_ALLOWED_ORIGINS`). CORS is not enabled.
* **Brute force:** 5 failures per client address and per username lock that key for 15 minutes; login, setup and password-change endpoints also have route rate limits; a global limit applies to everything.
* The login path does the same amount of hashing work for unknown usernames (no username oracle).
* Recovery: `npm run reset-password` on the server (needs shell access).

## Reverse proxy

`VERA_TRUSTED_PROXY=false` by default: `X-Forwarded-*` headers are ignored and the socket address is used. Set it to `true` only behind Nginx Proxy Manager, and list the proxy network in `VERA_TRUSTED_PROXY_CIDRS` (default: private ranges). Do not expose port 3001 directly to the internet.

Headers sent: CSP (`default-src 'self'`, no inline scripts), `X-Content-Type-Options`, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`, HSTS when https, `Cache-Control: no-store` on the API.

## Input handling

Every route validates params, query and body with Zod; unknown fields in integration config are rejected; bodies are limited to 512 KB; malformed JSON returns a clean 400. Errors carry an id and never a stack trace or internal message. Logs are structured, carry a request id, redact `authorization`/`cookie`/body fields, and never contain prompts, tool arguments, secrets or blocked payloads.

## Privacy gateway and the financial hard block

Implemented in `server/src/security/privacy.ts` and applied to: user messages, conversation history, memories, tool arguments (model-originated or cloud-bound), tool results before they re-enter model context, and the model's own output.

| Class | Examples detected | Default policy |
|---|---|---|
| `FINANCIAL` | Luhn-valid card numbers, mod-97-valid IBANs, sort code + account number, "account number: …", routing/CVV/PIN with digits, "my bank balance/transactions/statement" | **Blocked.** Never sent to a cloud AI or cloud-bound tool |
| `CREDENTIAL` | private keys, Google/GitHub/Slack/AWS/`sk-…` keys, JWTs, bearer tokens, `password=`/`api_key=` assignments, "my password is …", URLs with embedded credentials | **Blocked** |
| `SENSITIVE_PERSONAL` | NI/SSN numbers, passport numbers, date of birth, "my test results/prescription" | **Blocked** by default |
| `UNKNOWN` | long high-entropy tokens matching no known pattern | **Redacted**, then allowed |
| `PERSONAL` | email addresses, phone numbers | Allowed |
| `PUBLIC` | everything else | Allowed |

Owners can add patterns (stored in settings; length-limited and compiled defensively). When content is blocked: the provider is not called (tests use a spy to prove this), cloud tools are not run, the raw payload is neither logged nor stored (a redacted copy is), the user sees an explanation and a "use redacted text" action, and only classification/category/source metadata is recorded. No integration exposes bank balances, transactions, card data or banking credentials. Gmail search additionally withholds any message whose sender/subject/snippet looks financial.

**This is defence in depth, not a guarantee.** It is deterministic pattern matching: it can miss obfuscated data (for example digits spelled out as words; a test documents this) and can over-block. It never asks a second cloud model to judge safety.

## Secrets

* `GEMINI_API_KEY` and server secrets are read only by the backend, never returned by any route and never logged.
* Integration credentials and OAuth tokens: AES-256-GCM, AAD bound to `integration:key`, stored as ciphertext in `integration_secrets`. The key comes from `VERA_SECRET_KEY` or a `0600` key file. Losing it makes stored credentials unrecoverable (re-enter them); see `docs/database.md`.
* The setup UI never repopulates a saved secret. It shows "Credential saved", supports replace and remove, and a blank secret field means "keep the current value".
* Secrets are never put in URLs, `localStorage` or Vite variables.

## Host and file access

No arbitrary shell, no `child_process`, no Docker socket. Diagnostics use Node's `os`/`fs.statfs`. Service checks are limited to services the owner lists (HTTP, TCP, or Docker container state through an optional **read-only socket proxy** you run yourself). Log excerpts are redacted and capped at 200 lines. File tools only see `VERA_ALLOWED_FILE_ROOTS`; paths are resolved with `realpath` and must stay inside a root (traversal and symlink escapes rejected), key/credential/database/`.env` files are refused, files over 1 MB or binary are refused. Restart/administration is deliberately not implemented; if added later it needs its own allow-listed adapter, confirmation, timeouts and audit.

## Network safety

Public web tools (`safeFetch`): http/https only, ports 80/443/8080/8443, no embedded credentials, `localhost`/`.local`/`.internal` rejected, private/loopback/link-local/metadata/NAT64 addresses blocked, DNS is resolved once and the connection uses the validated address (no rebinding window), redirects are followed manually and re-validated at every hop, size and time are capped. Web content is wrapped as untrusted data and scanned for instruction-like text. Owner-configured LAN services (Home Assistant, Jellyfin…) may be private addresses but never credentials-in-URL or `169.254.*`.

## Tool confirmations

A confirmation is bound to the user, the tool, the exact validated arguments (canonical hash), a one-time token and a 5-minute expiry; it is consumed atomically before execution. Approve executes the *stored* arguments. A model statement such as "the user approved" has no effect.
