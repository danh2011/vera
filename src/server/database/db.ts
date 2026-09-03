import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "../env.js";

const dbDir = path.dirname(env.DATABASE_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(env.DATABASE_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// --- Migrations -----------------------------------------------------------
// Simple, ordered, idempotent migrations. Each migration runs once, tracked
// in the `migrations` table. This is intentionally lightweight for V0.1.

db.exec(`
  CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    appliedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

interface Migration {
  name: string;
  up: () => void;
}

const migrations: Migration[] = [
  {
    name: "0001_init",
    up: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT 'New conversation',
          createdAt TEXT NOT NULL DEFAULT (datetime('now')),
          updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          toolName TEXT,
          createdAt TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversationId, createdAt);

        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          category TEXT NOT NULL DEFAULT 'general',
          content TEXT NOT NULL,
          importance INTEGER NOT NULL DEFAULT 3,
          createdAt TEXT NOT NULL DEFAULT (datetime('now')),
          updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS calendar_events (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          startsAt TEXT NOT NULL,
          endsAt TEXT,
          notes TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_events_start ON calendar_events(startsAt);

        CREATE TABLE IF NOT EXISTS reminders (
          id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          dueAt TEXT NOT NULL,
          completed INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(dueAt);

        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          createdAt TEXT NOT NULL DEFAULT (datetime('now')),
          updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          priority TEXT NOT NULL DEFAULT 'medium',
          dueDate TEXT,
          status TEXT NOT NULL DEFAULT 'open'
        );

        CREATE TABLE IF NOT EXISTS automations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          cron TEXT NOT NULL,
          prompt TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          lastRunAt TEXT
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
];

const applied = new Set(
  (db.prepare("SELECT name FROM migrations").all() as { name: string }[]).map((r) => r.name),
);

const insertMigration = db.prepare("INSERT INTO migrations (name) VALUES (?)");

for (const migration of migrations) {
  if (!applied.has(migration.name)) {
    const run = db.transaction(() => {
      migration.up();
      insertMigration.run(migration.name);
    });
    run();
    console.log(`[db] applied migration ${migration.name}`);
  }
}
