# Database

SQLite via `better-sqlite3`. Foreign keys on, `busy_timeout` 5 s, WAL journal, `synchronous=NORMAL`. The file lives at `VERA_DATABASE_PATH` (default `$VERA_DATA_DIR/vera.db`); in Docker that is the mounted `/data` volume, never the container layer.

Migrations are append-only SQL in `server/src/database/migrations.ts`, each applied in its own transaction and recorded in `schema_migrations`. Startup refuses to open a database written by a *newer* Vera (to avoid damaging it). No migration deletes user data.

## Tables

| Group | Tables |
|---|---|
| App/auth | `users` (single owner, extensible), `sessions` (hashed ids, CSRF token, expiry, revocation), `settings`, `schema_migrations` |
| Conversations | `conversations`, `messages`, `message_attachments`, `tool_calls`, `tool_call_results` |
| Tasks | `tasks`, `reminders` (status `scheduled/sent/failed/missed/cancelled`, delivery detail, attempts, retry time; migration 3 rebuilt this table and copied every existing row). `scheduled_jobs` is intentionally absent: reminders carry their own schedule and one in-process timer delivers them |
| Knowledge | `memories`, `notes`, `documents` (metadata only), FTS5 indexes `notes_fts`, `memories_fts`. `document_chunks` is not needed: files are read on demand |
| Integrations | `integrations` (install/enable/connection state; this is the installation record), `integration_settings` (non-secret), `integration_secrets` (**ciphertext only**), `integration_permissions`, `oauth_states` |
| Operations | `tool_executions`, `audit_events`, `confirmations`, `ai_provider_settings`, `usage_counters`, `request_limits`, `privacy_events` |

`privacy_events` and `audit_events` store classifications, categories, tool names, outcomes and opaque request ids, never message content, arguments or secrets.

Indexes cover the frequent paths (per-user lists by update time, task filters, message order, audit time, tool execution per integration). Lists are paginated or capped.

## Full-text search

Notes and memories use FTS5 external-content tables kept in sync by triggers. Queries are tokenised and quoted before reaching `MATCH`, so user input cannot inject FTS syntax. If the SQLite build lacks FTS5, migration 2 is skipped and search falls back to escaped `LIKE` (slower, no ranking). The startup log and *Settings* show which mode is active.

## Backup and restore

The database is in WAL mode, so copying only `vera.db` while the app runs can miss recent writes. Use one of:

```bash
# Online, consistent snapshot (recommended). Works while Vera is running.
docker exec vera node -e "const D=require('better-sqlite3');new D('/data/vera.db').backup('/data/backup-'+Date.now()+'.db').then(()=>console.log('ok'))"
# or stop the container, then copy vera.db, vera.db-wal and vera.db-shm together
```

**The encryption key matters.** Stored integration credentials and OAuth tokens are encrypted with `VERA_SECRET_KEY` or `$VERA_DATA_DIR/secret.key`. A database backup *without* that key restores everything except the credentials: you will be asked to re-enter them (nothing else is lost). A backup *with* the key in the same place gives an attacker who steals the backup both halves, so for real separation set `VERA_SECRET_KEY` from your secret store and back the key up separately.

**Restore:** stop Vera, replace `vera.db` (delete any stale `-wal`/`-shm`), restore the key, start Vera. Migrations run forward automatically; restoring a backup from a newer version onto an older Vera is refused.

## Owner recovery

If you lose the password, on the server run `npm run reset-password` (or `docker exec -it vera node dist-server/server/src/cli/reset-password.js`). It needs shell access to the data directory, sets a new password and signs out every session.
