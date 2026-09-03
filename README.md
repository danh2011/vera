# Vera

Vera is a private, personal AI assistant. V0.1.1 is a stable, polished release
with enhanced reliability, better error recovery, and improved UX. A single
Node.js web application you can run with one command, with **17 built-in
capabilities** (including new Timezone support) and a dedicated security layer
that blocks sensitive information before it ever reaches the AI provider.

Vera is **local-first, not fully local**: your data (conversations, memory,
notes, tasks, calendar, files) lives in a local SQLite database and a local
workspace folder on your own machine or server. To actually understand and
respond to you, Vera sends the relevant parts of your request to **Google's
Gemini API** — that part is cloud-based. See [Privacy](#privacy) below.

## What Vera can do

Ask Vera things like:

- "What's on my calendar tomorrow?"
- "Remember that I prefer AMD CPUs."
- "Search the web for the latest Ryzen 5 7600 prices."
- "Remind me at 6pm to work on Vera."
- "Set a 10 minute timer."
- "What's (3 + 4) * 2 / 7?"
- "How's the server doing?"
- "What time is it in Tokyo?"
- "Convert 3pm EST to London time."

Vera decides which capability (if any) it needs and uses it automatically —
you don't pick tools from a menu.

## Requirements

- Node.js 20+
- npm
- A Google Gemini API key ([get one here](https://aistudio.google.com/app/apikey))

No Python, no Docker, and no separate database server are required for
development.

## Installation

```bash
git clone <your-repo-url> vera
cd vera
npm install
cp .env.example .env
```

Open `.env` and set at least:

```
GEMINI_API_KEY=your-key-here
```

## Running Vera

```bash
npm run dev
```

That's it — one command starts both the API server and the web frontend.
Open the URL it prints (defaults to `http://localhost:5173`) in your browser.
It works well on both desktop and mobile browsers.

### Production

```bash
npm run build
npm start
```

This builds the React frontend and compiles the TypeScript server, then
serves everything from a single Node process on `PORT` (default `3001`).

## Configuration

All configuration lives in `.env` (see `.env.example` for the full list and
defaults):

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Your Gemini API key. Required for AI responses. |
| `GEMINI_MODEL` | Gemini model name. Defaults to `gemini-2.5-flash`. |
| `PORT` | Port the server listens on. |
| `DATABASE_PATH` | Where the SQLite database file lives. |
| `WORKSPACE_PATH` | Sandboxed folder the Files/Notes/Code capabilities can access. |
| `SEARCH_PROVIDER`, `SEARCH_API_KEY` | Web search provider (currently: `brave`). Optional. |
| `WEATHER_PROVIDER`, `WEATHER_API_KEY`, `WEATHER_DEFAULT_LOCATION` | Weather source. Defaults to the free Open-Meteo API if unset. |
| `UPDATE_REPO` | `owner/repo` on GitHub to check for/install updates from. |
| `DEV_MODE` | Set `true` to expose the developer/debug panel in the UI. |

Without `GEMINI_API_KEY` set, Vera still runs — the chat, database, and
capability endpoints all work — but it will tell you AI responses aren't
available yet instead of erroring.

## The 17 built-in capabilities

Memory · Calendar · Reminders · Web Search · Files · Notes · Tasks ·
Weather · Timer/Stopwatch · Calculator/Unit Conversion · Timezone Conversion · System Monitor ·
Docker/Process Control (read-only, with a strict restart whitelist) ·
Network · Code Assistant (never executes code) · Automation (cron-scheduled
prompts).

Each capability is a small, self-contained module in
`src/server/capabilities/`, registered through a common interface so more
can be added later without touching the core chat pipeline.

## How Vera protects sensitive information

This is the part of Vera that is **non-negotiable**: sensitive information
must never reach Gemini, and the AI itself is never trusted to enforce this.

```
User Input
   ↓
Security Filter   ← blocks secrets before ANY AI call
   ↓
Capability Processing
   ↓
Context Filter    ← re-scans capability output before it goes back to Gemini
   ↓
Gemini
```

The filter (`src/server/security/sensitiveFilter.ts`) is pure pattern
matching — regex and structural checks, not an LLM judgment call — and runs
in two places: on every incoming user message, and again on every capability
result before it's handed back to Gemini. It looks for:

- **Banking/financial info**: account numbers, IBANs, sort codes, card
  numbers (validated with a Luhn checksum to cut down on false positives),
  crypto wallet seed phrases
- **Authentication material**: passwords, API keys (including known formats
  for OpenAI/Anthropic/GitHub/Slack/AWS/Google), JWTs, private key blocks,
  OAuth secrets, recovery codes, OTP/2FA codes, PINs

It matches both structured syntax (`password: xyz`) and natural language
("my password is xyz"). When something is blocked, Vera tells you plainly —
*"I can't send that sensitive information to the AI provider."* — without
ever echoing the sensitive value back, including in logs.

Content from outside Vera (web pages, files, notes) is treated as untrusted
data, never as instructions — even if it contains phrases like "ignore
previous instructions."

This logic is covered by an automated test suite in `tests/sensitiveFilter.test.ts`.

## Privacy

- Normal application data (conversations, memory, notes, tasks, calendar,
  files) is stored **locally** in SQLite and on disk — nothing is synced
  anywhere by default.
- When you send a message, the relevant conversation context is sent to
  **Google's Gemini API** so it can understand and respond to you. This is
  visible in Settings under "Data sent externally."
- Vera is not able to send sensitive information (see above) to Gemini even
  if you ask it to.

## Database

SQLite, via `better-sqlite3`, at the path set in `DATABASE_PATH` (default
`./data/vera.db`). Tables: `conversations`, `messages`, `memories`,
`calendar_events`, `reminders`, `notes`, `tasks`, `automations`, `settings`.
A lightweight migration runner (`src/server/database/db.ts`) applies schema
changes once and tracks what's been applied — your data survives updates.

## Workspace

The Files, Notes-adjacent, and Code Assistant capabilities operate inside a
single sandboxed directory (`WORKSPACE_PATH`, default `./data/workspace`).
All paths are resolved and checked against this root before any read/write —
`../../etc/passwd`-style traversal is rejected outright
(`src/server/security/workspace.ts`, covered by `tests/workspace.test.ts`).

## Updating

If you set `UPDATE_REPO=owner/repo` in `.env`, Vera can check
(`GET /api/version`) and apply (`npm run update`) new releases published via
GitHub Releases. The update script always backs up the current build first,
and only keeps the update if the new version starts up successfully —
otherwise it rolls back automatically. It never touches your `data/`
directory.

## Development

```bash
npm run dev      # start server + client together
npm test         # run the test suite (vitest)
npm run lint     # eslint
npm run format   # prettier
npm run build    # production build
```

### Developer mode

Set `DEV_MODE=true` (or toggle it in Settings) to see a debug panel under AI
responses: the model used, which capabilities were considered, response
time, and an approximate context size.

## Project structure

```
vera/
├── src/
│   ├── server/
│   │   ├── ai/            # Gemini wrapper, chat engine, context manager
│   │   ├── capabilities/  # the 17 built-in capabilities
│   │   ├── database/      # SQLite connection + migrations
│   │   ├── routes/        # Express routes
│   │   └── security/      # sensitive-info filter, workspace sandboxing
│   ├── client/             # React frontend (Vite)
│   └── shared/             # types shared between server and client
├── tests/                  # vitest test suite
├── scripts/update.mjs      # safe self-update script
├── .github/workflows/      # CI + release automation
└── data/                   # SQLite db + workspace (gitignored, created at runtime)
```

## Roadmap (not in V0.1)

Future versions may add a redesigned Android client, voice/TTS, Android
Auto, richer memory and personal context, external calendar/email
connectors, an OAuth-based connector architecture, and limited proactive
automation. V0.1 intentionally keeps the architecture simple so these can be
layered on without a rewrite.
