import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../server/src/database/db.js";
import { MIGRATIONS } from "../server/src/database/migrations.js";
import { createRepos } from "../server/src/database/repos.js";
import { tmp } from "./helpers.js";

describe("database", () => {
  it("creates the schema with all required entities and applies migrations once", () => {
    const file = path.join(tmp(), "v.db"); const { db, applied } = openDatabase(file);
    expect(applied).toEqual(MIGRATIONS.map((m) => m.version));
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    for (const t of ["users", "sessions", "settings", "schema_migrations", "conversations", "messages", "message_attachments", "tool_calls", "tool_call_results", "tasks", "reminders", "memories", "notes", "documents", "integrations", "integration_settings", "integration_permissions", "integration_secrets", "tool_executions", "audit_events", "ai_provider_settings", "usage_counters", "request_limits", "privacy_events"]) expect(names).toContain(t);
    db.close(); const again = openDatabase(file); expect(again.applied).toEqual([]); again.db.close();
  });
  it("persists across restart", () => {
    const file = path.join(tmp(), "v.db"); let o = openDatabase(file); let r = createRepos(o.db, o.caps.fts5);
    const u = r.users.create("a", "hash"); r.tasks.create(u.id, { title: "survives" }); o.db.close();
    o = openDatabase(file); r = createRepos(o.db, o.caps.fts5);
    expect(r.tasks.list(u.id).map((t) => t.title)).toEqual(["survives"]); o.db.close();
  });
  it("enforces foreign keys, constraints and cascades", () => {
    const { db, caps } = openDatabase(":memory:", { memory: true }); const r = createRepos(db, caps.fts5);
    expect(() => r.tasks.create("missing-user", { title: "x" })).toThrow();
    const u = r.users.create("a", "h"); expect(() => r.tasks.create(u.id, { title: "x", priority: "urgent" })).toThrow();
    const c = r.conversations.create(u.id); r.conversations.addMessage({ conversationId: c.id, role: "user", content: "hi" });
    r.conversations.delete(u.id, c.id); expect((db.prepare("SELECT COUNT(*) n FROM messages").get() as { n: number }).n).toBe(0);
  });
  it("rolls back a failed migration without recording it", () => {
    const { db } = openDatabase(":memory:", { memory: true });
    expect(() => db.transaction(() => { db.exec("CREATE TABLE t1(x)"); db.exec("CREATE TABLE users(x)"); db.prepare("INSERT INTO schema_migrations VALUES (99,'bad','now')").run(); })()).toThrow();
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name='t1'").get()).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM schema_migrations WHERE version=99").get()).toBeUndefined();
  });
  it("refuses to open a database from a newer Vera", () => {
    const file = path.join(tmp(), "v.db"); const o = openDatabase(file); o.db.prepare("INSERT INTO schema_migrations VALUES (999,'future','now')").run(); o.db.close();
    expect(() => openDatabase(file)).toThrow(/newer Vera/);
  });
  it("full-text search finds notes and handles hostile query syntax, and the LIKE fallback works", () => {
    const o = openDatabase(":memory:", { memory: true }); expect(o.caps.fts5).toBe(true);
    const u = createRepos(o.db, true).users.create("a", "h"); const fts = createRepos(o.db, true); const like = createRepos(o.db, false);
    fts.notes.create(u.id, { title: "Boiler service", content: "Annual boiler check is due in March" }); fts.notes.create(u.id, { title: "Other", content: "nothing" });
    expect(fts.notes.search(u.id, "boil").map((n) => n.title)).toEqual(["Boiler service"]);
    expect(fts.notes.search(u.id, '"; DROP TABLE notes; -- NEAR(')).toEqual([]);
    expect(like.notes.search(u.id, "march").map((n) => n.title)).toEqual(["Boiler service"]);
    fts.notes.update(u.id, fts.notes.list(u.id).find((n) => n.title === "Other")!.id, { content: "fresh boiler words" }); expect(fts.notes.search(u.id, "boiler")).toHaveLength(2);
  });
  it("upgrades an existing database without losing reminders (migration 3 rebuilds the table)", async () => {
    const { default: Database } = await import("better-sqlite3"); const file = path.join(tmp(), "old.db"); const old = new Database(file); old.pragma("foreign_keys = ON");
    old.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    for (const m of MIGRATIONS.slice(0, 2)) { m.up(old, { fts5: true }); old.prepare("INSERT INTO schema_migrations VALUES (?,?,?)").run(m.version, m.name, "then"); }
    old.prepare("INSERT INTO users VALUES ('u1','dan','h','owner','t','t')").run(); old.prepare("INSERT INTO tasks (id,user_id,title,created_at,updated_at) VALUES ('t1','u1','Task','t','t')").run();
    old.prepare("INSERT INTO reminders (id,user_id,task_id,title,remind_at,status,delivery,created_at) VALUES ('r1','u1','t1','Call Sam','2026-11-06T09:00:00.000Z','stored','not_delivered','t')").run();
    old.prepare("INSERT INTO reminders (id,user_id,title,remind_at,status,delivery,created_at) VALUES ('r2','u1','Old','2026-11-07T09:00:00.000Z','cancelled','not_delivered','t')").run(); old.close();
    const { db, applied } = openDatabase(file); expect(applied).toEqual([3]);
    expect(db.prepare("SELECT id,title,task_id,status,delivery,attempts FROM reminders ORDER BY id").all()).toEqual([{ id: "r1", title: "Call Sam", task_id: "t1", status: "scheduled", delivery: "pending", attempts: 0 }, { id: "r2", title: "Old", task_id: null, status: "cancelled", delivery: "pending", attempts: 0 }].map((r) => (r.id === "r2" ? { ...r, task_id: null } : r)));
    expect(db.pragma("foreign_key_check")).toEqual([]); db.close();
  });
  it("never stores credentials in plain settings tables", () => {
    const { db } = openDatabase(":memory:", { memory: true }); const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols("integration_secrets")).toContain("ciphertext"); expect(cols("integration_settings")).not.toContain("ciphertext"); expect(cols("users")).not.toContain("password");
  });
});
