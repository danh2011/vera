# Gemini

Vera uses the official `@google/genai` SDK behind an `AIProvider` interface (`server/src/ai/provider.ts`) so other providers can be added without touching tools. Automatic function calling is **disabled**; Vera's own executor decides what runs.

## Setting it up

1. Get an API key from Google AI Studio and put it in the server's `.env` as `GEMINI_API_KEY` (never in the browser or Git).
2. Pick a model from Google's **current** model list and set `GEMINI_MODEL`. Vera ships **no default model** on purpose: model names change, and Vera must never switch you to a different (possibly paid) model by itself. If the name is wrong, the UI says "Gemini doesn't recognise the configured model".
3. Set `GEMINI_ENABLED=true` and restart.
4. In **Settings → AI provider**, tick the two confirmations (account eligibility; quota/billing checked) and press *Confirm and allow Gemini*. Until then Vera makes no Gemini request at all.

Vera cannot verify that your account is eligible for the API or what your quota is, so it does not pretend to. Check Google's current terms and the age/region requirements for your account; never use a key you aren't entitled to use.

## What protects your bill

* Explicit enable at three levels: `GEMINI_ENABLED`, owner acknowledgement, runtime toggle.
* Limits: requests/minute, requests/day (each tool round trip counts), tool rounds per message, max input characters, max output tokens, request timeout. Server environment values are ceilings; Settings can only lower them.
* Bounded retries (2) with backoff for transient failures; a circuit breaker pauses requests for 60 s after 3 consecutive failures; quota/rate/auth errors are shown as such and are not retried.
* Usage counters (requests, failures, input/output tokens as reported by the provider) in *Settings*.
* Local deterministic handling answers simple requests (time, maths, units, tasks, disk/CPU) without any model call.
* Only relevant, enabled tools are sent (max 10), and only a bounded, screened slice of history.
* Vera shows **no monetary estimate** because it holds no verified pricing data, and it never invents free-tier quotas.

## Behaviour when disabled or unavailable

The chat says why (`not configured`, `not acknowledged`, `turned off`, `quota`, `rate limit`, `circuit open`, `timeout`…) and keeps serving local tools. Nothing falls back to fake answers.

## Testing

Automated tests mock the SDK; CI never makes a paid request. An optional live smoke test is skipped unless you run it explicitly: `VERA_LIVE_GEMINI_TEST=1 GEMINI_API_KEY=… GEMINI_MODEL=… npx vitest run tests/gemini.test.ts`. **Live Gemini behaviour has not been verified in this repository's test runs.**
