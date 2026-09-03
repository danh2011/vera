# Vera Changelog

## v0.1.1 (September 2026)

### New Features
- **Timezone Capability** — Convert times between timezones, check current time in any IANA timezone, list common timezones (3 actions)
- **Conversation Export** — Export chat history as JSON from `/api/data/conversations/export/:conversationId`
- **Keyboard Shortcuts** — Global shortcuts for faster navigation:
  - `Cmd/Ctrl+K` — New chat
  - `Cmd/Ctrl+,` — Open Settings
  - `Cmd/Ctrl+Enter` — Alternative send message shortcut
- **Database Maintenance API** — View database statistics and optimize via `/api/data/maintenance/stats` and `/api/data/maintenance/vacuum`

### Reliability & Error Handling
- **Startup Health Check** — Server now validates Gemini API connectivity on startup and reports warnings/errors
- **Capability Registration Validation** — Validates all capabilities at startup for missing fields or configuration issues
- **Improved Error Messages** — More specific error guidance when Gemini API fails (auth issues, rate limits, network errors, invalid models)
- **Web Search Fallback** — Automatic DuckDuckGo fallback if Brave Search isn't configured; gracefully handles search provider issues
- **Better Error Recovery** — Caught exceptions now provide actionable guidance rather than generic error messages

### UI/UX Improvements
- **Enhanced Dark Mode** — Better contrast ratios, improved color consistency, smoother transitions
- **Improved Interactions** — Buttons now have hover states, animations, and visual feedback (scale effects, shadows)
- **Better Keyboard Support** — Enhanced placeholder text, tooltips on buttons, keyboard shortcut hints
- **Typing Indicators** — Visual feedback when Vera is thinking (animated dots)
- **Message Styling** — Improved message bubbles with subtle shadows, better visual hierarchy
- **Suggestion Chips** — Better hover states and active feedback

### Configuration
- **Gemini Model Upgrade** — Default model changed from `gemini-1.5-flash-latest` to `gemini-2.5-flash` (cheaper, newer, not deprecated)
- Updated `.env.example` and documentation to reflect new default model

### Technical Improvements
- Keyboard shortcut system (`keyboard.ts`) for centralized shortcut management
- Improved capability registration with validation logic
- Better error handling throughout chat pipeline
- CSS variable system refactored for consistency (`--transition` variable)
- Global error cleanup and specific error classification in chatEngine

### Bug Fixes
- Fixed search provider fallback behavior
- Improved handling of missing environment variables
- Better database error handling

### Known Limitations
- Search fallback (DuckDuckGo) uses limited instant answer API; configure Brave Search for better results
- Timezone conversion uses browser Intl API; may vary slightly on older browsers
- Database maintenance endpoints are read-only; manual file operations required for advanced maintenance

## v0.1.0 (Initial Release)

Initial release with 15 capabilities, security filtering, and local-first architecture.
