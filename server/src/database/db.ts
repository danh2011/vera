import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS, type DbCaps } from "./migrations.js";

export type Db = Database.Database;
export interface OpenedDb { db: Db; caps: DbCaps; applied: number[] }

export function detectFts5(db: Db): boolean {
  try { db.exec("CREATE VIRTUAL TABLE temp.__fts_probe USING fts5(x); DROP TABLE temp.__fts_probe;"); return true; } catch { return false; }
}

/** Opens (creating if needed) the database and applies pending migrations, each in its own transaction. */
export function openDatabase(file: string, opts: { memory?: boolean } = {}): OpenedDb {
  if (!opts.memory) fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new Database(opts.memory ? ":memory:" : file);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (!opts.memory) db.pragma("journal_mode = WAL"); // see docs/database.md for backup implications
  db.pragma("synchronous = NORMAL");
  const caps: DbCaps = { fts5: detectFts5(db) };
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const done = new Set((db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version));
  const known = new Set(MIGRATIONS.map((m) => m.version));
  for (const v of done) if (!known.has(v)) throw new Error(`Database was created by a newer Vera (migration ${v}). Refusing to start to avoid data loss.`);
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    db.transaction(() => {
      m.up(db, caps);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?,?,?)").run(m.version, m.name, new Date().toISOString());
    })();
    applied.push(m.version);
  }
  return { db, caps, applied };
}

export function hasFts(db: Db): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE name='notes_fts'").get();
}
