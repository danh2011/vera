import type Database from "better-sqlite3";

export interface DbCaps { fts5: boolean }
export interface Migration { version: number; name: string; up: (db: Database.Database, caps: DbCaps) => void }

const m1 = `
CREATE TABLE users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id, revoked_at);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_conv_user_updated ON conversations(user_id, updated_at DESC);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')), content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete','pending','error')),
  provider TEXT, model TEXT, tool_label TEXT, metadata_json TEXT, created_at TEXT NOT NULL
);
CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at);
CREATE TABLE message_attachments (
  id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  name TEXT NOT NULL, mime TEXT, size INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL, tool_name TEXT NOT NULL,
  arguments_json TEXT NOT NULL, status TEXT NOT NULL, requires_confirmation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, finished_at TEXT
);
CREATE INDEX idx_tool_calls_conv ON tool_calls(conversation_id, created_at);
CREATE TABLE tool_call_results (
  id TEXT PRIMARY KEY, tool_call_id TEXT NOT NULL REFERENCES tool_calls(id) ON DELETE CASCADE,
  result_json TEXT, error_code TEXT, created_at TEXT NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT, due_at TEXT, priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1)), completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_tasks_user ON tasks(user_id, completed, due_at);
CREATE TABLE reminders (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, title TEXT NOT NULL, remind_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'stored' CHECK (status IN ('stored','cancelled')),
  delivery TEXT NOT NULL DEFAULT 'not_delivered', created_at TEXT NOT NULL
);
CREATE INDEX idx_reminders_user ON reminders(user_id, remind_at);

CREATE TABLE memories (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, content TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'note' CHECK (category IN ('note','fact','preference')),
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','assistant')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_memories_user ON memories(user_id, updated_at DESC);
CREATE TABLE notes (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_notes_user ON notes(user_id, updated_at DESC);
CREATE TABLE documents (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  path TEXT NOT NULL, name TEXT NOT NULL, mime TEXT, size INTEGER, indexed_at TEXT NOT NULL, UNIQUE(user_id, path)
);

CREATE TABLE integrations (
  id TEXT PRIMARY KEY, version TEXT NOT NULL, installed INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 0,
  installed_at TEXT, enabled_at TEXT, setup_step INTEGER NOT NULL DEFAULT 0,
  connection TEXT NOT NULL DEFAULT 'untested' CHECK (connection IN ('untested','connected','failed')),
  last_test_at TEXT, last_success_at TEXT, last_test_code TEXT, last_test_message TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE integration_settings (
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (integration_id, key)
);
CREATE TABLE integration_secrets (
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE, key TEXT NOT NULL,
  ciphertext TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (integration_id, key)
);
CREATE TABLE integration_permissions (
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE, permission TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, PRIMARY KEY (integration_id, permission)
);
CREATE TABLE tool_executions (
  id TEXT PRIMARY KEY, user_id TEXT, tool_name TEXT NOT NULL, integration_id TEXT, outcome TEXT NOT NULL,
  policy_outcome TEXT, duration_ms INTEGER, correlation_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX idx_tool_exec ON tool_executions(created_at DESC);
CREATE INDEX idx_tool_exec_int ON tool_executions(integration_id, created_at DESC);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, subject TEXT, outcome TEXT NOT NULL,
  metadata_json TEXT, request_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_events(created_at DESC);

CREATE TABLE ai_provider_settings (provider TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, model TEXT, updated_at TEXT NOT NULL);
CREATE TABLE usage_counters (
  provider TEXT NOT NULL, bucket TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (provider, bucket)
);
CREATE TABLE request_limits (
  provider TEXT PRIMARY KEY, per_minute INTEGER, per_day INTEGER, max_tool_rounds INTEGER, max_input_chars INTEGER, max_output_tokens INTEGER, updated_at TEXT NOT NULL
);
CREATE TABLE privacy_events (
  id TEXT PRIMARY KEY, user_id TEXT, direction TEXT NOT NULL, source TEXT NOT NULL, classification TEXT NOT NULL,
  blocked INTEGER NOT NULL, categories TEXT NOT NULL, request_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX idx_privacy_created ON privacy_events(created_at DESC);

CREATE TABLE confirmations (
  id TEXT PRIMARY KEY, token TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT, tool_name TEXT NOT NULL, args_json TEXT NOT NULL, args_hash TEXT NOT NULL, summary TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, outcome TEXT
);
CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, integration_id TEXT NOT NULL,
  verifier_ciphertext TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT
);
`;

const fts = `
CREATE VIRTUAL TABLE notes_fts USING fts5(title, content, content='notes', content_rowid='rowid');
CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN INSERT INTO notes_fts(rowid,title,content) VALUES (new.rowid,new.title,new.content); END;
CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN INSERT INTO notes_fts(notes_fts,rowid,title,content) VALUES('delete',old.rowid,old.title,old.content); END;
CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN INSERT INTO notes_fts(notes_fts,rowid,title,content) VALUES('delete',old.rowid,old.title,old.content); INSERT INTO notes_fts(rowid,title,content) VALUES (new.rowid,new.title,new.content); END;
CREATE VIRTUAL TABLE memories_fts USING fts5(title, content, content='memories', content_rowid='rowid');
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN INSERT INTO memories_fts(rowid,title,content) VALUES (new.rowid,new.title,new.content); END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN INSERT INTO memories_fts(memories_fts,rowid,title,content) VALUES('delete',old.rowid,old.title,old.content); END;
CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN INSERT INTO memories_fts(memories_fts,rowid,title,content) VALUES('delete',old.rowid,old.title,old.content); INSERT INTO memories_fts(rowid,title,content) VALUES (new.rowid,new.title,new.content); END;
INSERT INTO notes_fts(rowid,title,content) SELECT rowid,title,content FROM notes;
INSERT INTO memories_fts(rowid,title,content) SELECT rowid,title,content FROM memories;
`;

const m3 = `
CREATE TABLE reminders_new (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL, remind_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sent','failed','missed','cancelled')),
  delivery TEXT NOT NULL DEFAULT 'pending', delivery_detail TEXT, attempts INTEGER NOT NULL DEFAULT 0, retry_at TEXT, delivered_at TEXT, created_at TEXT NOT NULL
);
INSERT INTO reminders_new (id,user_id,task_id,title,remind_at,status,delivery,created_at)
  SELECT id,user_id,task_id,title,remind_at, CASE status WHEN 'cancelled' THEN 'cancelled' ELSE 'scheduled' END, 'pending', created_at FROM reminders;
DROP TABLE reminders;
ALTER TABLE reminders_new RENAME TO reminders;
CREATE INDEX idx_reminders_user ON reminders(user_id, remind_at);
CREATE INDEX idx_reminders_due ON reminders(status, remind_at);
`;

/** Migrations are append-only. Never edit a shipped migration; add a new one. None of them delete user data. */
export const MIGRATIONS: Migration[] = [
  { version: 1, name: "initial_schema", up: (db) => { db.exec(m1); } },
  { version: 2, name: "fts5_search", up: (db, caps) => { if (caps.fts5) db.exec(fts); } },
  { version: 3, name: "reminder_delivery", up: (db) => { db.exec(m3); } },
];
