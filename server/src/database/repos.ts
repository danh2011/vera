import { newId } from "../security/crypto.js";
import type { Db } from "./db.js";

const now = () => new Date().toISOString();
export const iso = now;
type Row = Record<string, unknown>;

export interface Page<T> { items: T[]; nextCursor: string | null }

/* ---------------- users & sessions ---------------- */
export interface UserRow { id: string; username: string; passwordHash: string }
export class UsersRepo {
  constructor(private db: Db) {}
  count(): number { return (this.db.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c; }
  create(username: string, passwordHash: string): UserRow {
    const id = newId(), t = now();
    this.db.prepare("INSERT INTO users (id,username,password_hash,role,created_at,updated_at) VALUES (?,?,?,'owner',?,?)").run(id, username, passwordHash, t, t);
    return { id, username, passwordHash };
  }
  private map(r: Row | undefined): UserRow | null { return r ? { id: r.id as string, username: r.username as string, passwordHash: r.password_hash as string } : null; }
  byUsername(u: string) { return this.map(this.db.prepare("SELECT * FROM users WHERE username = ?").get(u) as Row | undefined); }
  byId(id: string) { return this.map(this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined); }
  first() { return this.map(this.db.prepare("SELECT * FROM users ORDER BY created_at LIMIT 1").get() as Row | undefined); }
  setPassword(id: string, hash: string) { this.db.prepare("UPDATE users SET password_hash=?, updated_at=? WHERE id=?").run(hash, now(), id); }
}

export interface SessionRow { id: string; userId: string; csrfToken: string; expiresAt: string; createdAt: string; lastSeenAt: string; userAgent: string | null }
export class SessionsRepo {
  constructor(private db: Db) {}
  create(idHash: string, userId: string, csrf: string, ttlMs: number, ua: string | null) {
    const t = Date.now();
    this.db.prepare("INSERT INTO sessions (id,user_id,csrf_token,created_at,last_seen_at,expires_at,user_agent) VALUES (?,?,?,?,?,?,?)").run(idHash, userId, csrf, new Date(t).toISOString(), new Date(t).toISOString(), new Date(t + ttlMs).toISOString(), ua?.slice(0, 200) ?? null);
  }
  get(idHash: string): SessionRow | null {
    const r = this.db.prepare("SELECT * FROM sessions WHERE id=? AND revoked_at IS NULL AND expires_at > ?").get(idHash, now()) as Row | undefined;
    return r ? { id: r.id as string, userId: r.user_id as string, csrfToken: r.csrf_token as string, expiresAt: r.expires_at as string, createdAt: r.created_at as string, lastSeenAt: r.last_seen_at as string, userAgent: r.user_agent as string | null } : null;
  }
  touch(idHash: string) { this.db.prepare("UPDATE sessions SET last_seen_at=? WHERE id=?").run(now(), idHash); }
  revoke(idHash: string) { this.db.prepare("UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL").run(now(), idHash); }
  revokeOthers(userId: string, keep: string) { return this.db.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=? AND id<>? AND revoked_at IS NULL").run(now(), userId, keep).changes; }
  revokeAll(userId: string) { return this.db.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").run(now(), userId).changes; }
  list(userId: string) { return (this.db.prepare("SELECT id,created_at,last_seen_at,expires_at,user_agent FROM sessions WHERE user_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY last_seen_at DESC LIMIT 50").all(userId, now()) as Row[]).map((r) => ({ id: (r.id as string).slice(0, 12), fullId: r.id as string, createdAt: r.created_at as string, lastSeenAt: r.last_seen_at as string, expiresAt: r.expires_at as string, userAgent: r.user_agent as string | null })); }
  purgeExpired() { this.db.prepare("DELETE FROM sessions WHERE expires_at < ? OR revoked_at < ?").run(now(), new Date(Date.now() - 7 * 864e5).toISOString()); }
}

export class SettingsRepo {
  constructor(private db: Db) {}
  get<T>(key: string, def: T): T { const r = this.db.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined; if (!r) return def; try { return JSON.parse(r.value) as T; } catch { return def; } }
  set(key: string, value: unknown) { this.db.prepare("INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(key, JSON.stringify(value), now()); }
}

/* ---------------- conversations ---------------- */
export interface MessageRow { id: string; conversationId: string; role: "user" | "assistant" | "system"; content: string; status: string; provider: string | null; model: string | null; tool: string | null; metadata: Record<string, unknown> | null; createdAt: string }
const mapMsg = (r: Row): MessageRow => ({ id: r.id as string, conversationId: r.conversation_id as string, role: r.role as MessageRow["role"], content: r.content as string, status: r.status as string, provider: r.provider as string | null, model: r.model as string | null, tool: r.tool_label as string | null, metadata: r.metadata_json ? JSON.parse(r.metadata_json as string) : null, createdAt: r.created_at as string });

export class ConversationsRepo {
  constructor(private db: Db) {}
  list(userId: string, limit = 100, q?: string) {
    const rows = q
      ? this.db.prepare("SELECT id,title,updated_at FROM conversations WHERE user_id=? AND title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?").all(userId, `%${q.replace(/[\\%_]/g, "\\$&")}%`, limit)
      : this.db.prepare("SELECT id,title,updated_at FROM conversations WHERE user_id=? ORDER BY updated_at DESC LIMIT ?").all(userId, limit);
    return (rows as Row[]).map((r) => ({ id: r.id as string, title: r.title as string, updatedAt: r.updated_at as string }));
  }
  get(userId: string, id: string) { const r = this.db.prepare("SELECT * FROM conversations WHERE id=? AND user_id=?").get(id, userId) as Row | undefined; return r ? { id: r.id as string, title: r.title as string, createdAt: r.created_at as string, updatedAt: r.updated_at as string } : null; }
  create(userId: string, title = "New chat") { const id = newId(), t = now(); this.db.prepare("INSERT INTO conversations (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)").run(id, userId, title, t, t); return { id, title, createdAt: t, updatedAt: t }; }
  rename(userId: string, id: string, title: string) { return this.db.prepare("UPDATE conversations SET title=? WHERE id=? AND user_id=?").run(title, id, userId).changes > 0; }
  touch(id: string) { this.db.prepare("UPDATE conversations SET updated_at=? WHERE id=?").run(now(), id); }
  delete(userId: string, id: string) { return this.db.prepare("DELETE FROM conversations WHERE id=? AND user_id=?").run(id, userId).changes > 0; }
  addMessage(m: { conversationId: string; role: MessageRow["role"]; content: string; status?: string; provider?: string | null; model?: string | null; tool?: string | null; metadata?: Record<string, unknown> | null }): MessageRow {
    const id = newId(), t = now();
    this.db.prepare("INSERT INTO messages (id,conversation_id,role,content,status,provider,model,tool_label,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, m.conversationId, m.role, m.content, m.status ?? "complete", m.provider ?? null, m.model ?? null, m.tool ?? null, m.metadata ? JSON.stringify(m.metadata) : null, t);
    this.touch(m.conversationId);
    return { id, conversationId: m.conversationId, role: m.role, content: m.content, status: m.status ?? "complete", provider: m.provider ?? null, model: m.model ?? null, tool: m.tool ?? null, metadata: m.metadata ?? null, createdAt: t };
  }
  messages(conversationId: string, limit = 500): MessageRow[] {
    return (this.db.prepare("SELECT * FROM (SELECT rowid AS rid,* FROM messages WHERE conversation_id=? ORDER BY created_at DESC, rid DESC LIMIT ?) ORDER BY created_at ASC, rid ASC").all(conversationId, limit) as Row[]).map(mapMsg);
  }
  getMessage(id: string) { const r = this.db.prepare("SELECT * FROM messages WHERE id=?").get(id) as Row | undefined; return r ? mapMsg(r) : null; }
  updateMessageMeta(id: string, metadata: Record<string, unknown>) { this.db.prepare("UPDATE messages SET metadata_json=? WHERE id=?").run(JSON.stringify(metadata), id); }
  deleteTrailingAssistant(conversationId: string) {
    const last = this.messages(conversationId, 50);
    for (let i = last.length - 1; i >= 0 && last[i]!.role === "assistant"; i--) this.db.prepare("DELETE FROM messages WHERE id=?").run(last[i]!.id);
  }
  recordToolCall(c: { conversationId?: string | null; messageId?: string | null; tool: string; argsJson: string; status: string; confirm: boolean; resultJson?: string | null; errorCode?: string | null }) {
    const id = newId(), t = now();
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO tool_calls (id,conversation_id,message_id,tool_name,arguments_json,status,requires_confirmation,created_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id, c.conversationId ?? null, c.messageId ?? null, c.tool, c.argsJson.slice(0, 4000), c.status, c.confirm ? 1 : 0, t, t);
      if (c.resultJson !== undefined || c.errorCode) this.db.prepare("INSERT INTO tool_call_results (id,tool_call_id,result_json,error_code,created_at) VALUES (?,?,?,?,?)").run(newId(), id, c.resultJson?.slice(0, 8000) ?? null, c.errorCode ?? null, t);
    })();
    return id;
  }
  toolCalls(userId: string, conversationId: string) {
    return (this.db.prepare("SELECT tc.id,tc.tool_name,tc.status,tc.requires_confirmation,tc.created_at,r.error_code FROM tool_calls tc JOIN conversations c ON c.id=tc.conversation_id LEFT JOIN tool_call_results r ON r.tool_call_id=tc.id WHERE c.user_id=? AND tc.conversation_id=? ORDER BY tc.created_at LIMIT 200").all(userId, conversationId) as Row[]).map((r) => ({ id: r.id as string, tool: r.tool_name as string, status: r.status as string, requiresConfirmation: !!r.requires_confirmation, createdAt: r.created_at as string, errorCode: r.error_code as string | null }));
  }
}

/* ---------------- tasks & reminders ---------------- */
export interface TaskDto { id: string; title: string; description?: string; dueAt?: string; priority: "low" | "medium" | "high"; completed: boolean; createdAt: string; updatedAt: string }
const mapTask = (r: Row): TaskDto => ({ id: r.id as string, title: r.title as string, ...(r.description ? { description: r.description as string } : {}), ...(r.due_at ? { dueAt: r.due_at as string } : {}), priority: r.priority as TaskDto["priority"], completed: !!r.completed, createdAt: r.created_at as string, updatedAt: r.updated_at as string });
export class TasksRepo {
  constructor(private db: Db) {}
  list(userId: string, o: { completed?: boolean; limit?: number; offset?: number } = {}): TaskDto[] {
    const where = o.completed === undefined ? "" : " AND completed=" + (o.completed ? 1 : 0);
    return (this.db.prepare(`SELECT * FROM tasks WHERE user_id=?${where} ORDER BY completed, COALESCE(due_at,'9999'), created_at LIMIT ? OFFSET ?`).all(userId, o.limit ?? 200, o.offset ?? 0) as Row[]).map(mapTask);
  }
  get(userId: string, id: string) { const r = this.db.prepare("SELECT * FROM tasks WHERE id=? AND user_id=?").get(id, userId) as Row | undefined; return r ? mapTask(r) : null; }
  create(userId: string, v: { title: string; description?: string | null; dueAt?: string | null; priority?: string }) {
    const id = newId(), t = now();
    this.db.prepare("INSERT INTO tasks (id,user_id,title,description,due_at,priority,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(id, userId, v.title, v.description ?? null, v.dueAt ?? null, v.priority ?? "medium", t, t);
    return this.get(userId, id)!;
  }
  update(userId: string, id: string, v: { title?: string; description?: string | null; dueAt?: string | null; priority?: string; completed?: boolean }) {
    const cur = this.get(userId, id); if (!cur) return null;
    const completed = v.completed ?? cur.completed;
    this.db.prepare("UPDATE tasks SET title=?,description=?,due_at=?,priority=?,completed=?,completed_at=?,updated_at=? WHERE id=? AND user_id=?").run(
      v.title ?? cur.title, v.description === undefined ? cur.description ?? null : v.description, v.dueAt === undefined ? cur.dueAt ?? null : v.dueAt, v.priority ?? cur.priority, completed ? 1 : 0, completed ? (cur.completed ? now() : now()) : null, now(), id, userId);
    return this.get(userId, id);
  }
  delete(userId: string, id: string) { return this.db.prepare("DELETE FROM tasks WHERE id=? AND user_id=?").run(id, userId).changes > 0; }
}
export interface ReminderRow { id: string; userId: string; title: string; remindAt: string; status: "scheduled" | "sent" | "failed" | "missed" | "cancelled"; delivery: string; deliveryDetail: string | null; deliveredAt: string | null; attempts: number; taskId: string | null; retryAt: string | null }
const mapRem = (r: Row): ReminderRow => ({ id: r.id as string, userId: r.user_id as string, title: r.title as string, remindAt: r.remind_at as string, status: r.status as ReminderRow["status"], delivery: r.delivery as string, deliveryDetail: r.delivery_detail as string | null, deliveredAt: r.delivered_at as string | null, attempts: r.attempts as number, taskId: r.task_id as string | null, retryAt: r.retry_at as string | null });
export class RemindersRepo {
  constructor(private db: Db) {}
  create(userId: string, v: { title: string; remindAt: string; taskId?: string | null }): ReminderRow { const id = newId(), t = now(); this.db.prepare("INSERT INTO reminders (id,user_id,task_id,title,remind_at,created_at) VALUES (?,?,?,?,?,?)").run(id, userId, v.taskId ?? null, v.title, v.remindAt, t); return this.get(userId, id)!; }
  get(userId: string, id: string) { const r = this.db.prepare("SELECT * FROM reminders WHERE id=? AND user_id=?").get(id, userId) as Row | undefined; return r ? mapRem(r) : null; }
  /** Upcoming first, then recent history (cancelled ones are hidden). */
  list(userId: string, limit = 100): ReminderRow[] { return (this.db.prepare("SELECT * FROM reminders WHERE user_id=? AND status<>'cancelled' ORDER BY CASE status WHEN 'scheduled' THEN 0 ELSE 1 END, CASE status WHEN 'scheduled' THEN remind_at END ASC, remind_at DESC LIMIT ?").all(userId, limit) as Row[]).map(mapRem); }
  cancel(userId: string, id: string) { return this.db.prepare("UPDATE reminders SET status='cancelled' WHERE id=? AND user_id=? AND status='scheduled'").run(id, userId).changes > 0; }
  due(nowIso: string, limit = 25): ReminderRow[] { return (this.db.prepare("SELECT * FROM reminders WHERE status='scheduled' AND COALESCE(retry_at, remind_at) <= ? ORDER BY remind_at LIMIT ?").all(nowIso, limit) as Row[]).map(mapRem); }
  nextFutureAt(nowIso: string): string | null { return ((this.db.prepare("SELECT MIN(COALESCE(retry_at, remind_at)) t FROM reminders WHERE status='scheduled' AND COALESCE(retry_at, remind_at) > ?").get(nowIso) as { t: string | null }).t) ?? null; }
  markSent(id: string, detail: string) { this.db.prepare("UPDATE reminders SET status='sent', delivery='accepted', delivery_detail=?, delivered_at=?, retry_at=NULL WHERE id=?").run(detail, now(), id); }
  markFailed(id: string, detail: string) { this.db.prepare("UPDATE reminders SET status='failed', delivery='failed', delivery_detail=?, retry_at=NULL WHERE id=?").run(detail.slice(0, 300), id); }
  markMissed(id: string, detail: string) { this.db.prepare("UPDATE reminders SET status='missed', delivery='not_sent', delivery_detail=?, retry_at=NULL WHERE id=?").run(detail, id); }
  retry(id: string, retryAt: string, attempts: number, detail: string) { this.db.prepare("UPDATE reminders SET retry_at=?, attempts=?, delivery_detail=? WHERE id=?").run(retryAt, attempts, detail.slice(0, 300), id); }
}

/* ---------------- notes & memories ---------------- */
export interface TextItem { id: string; title: string; content: string; category?: "note" | "fact" | "preference"; source?: "user" | "assistant"; createdAt: string; updatedAt: string }
const ftsQuery = (q: string) => q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0).slice(0, 8).map((w) => `"${w}"*`).join(" ");
export class TextRepo {
  constructor(private db: Db, private table: "notes" | "memories", private fts: boolean) {}
  private map = (r: Row): TextItem => ({ id: r.id as string, title: r.title as string, content: r.content as string, ...(this.table === "memories" ? { category: r.category as TextItem["category"], source: r.source as TextItem["source"] } : {}), createdAt: r.created_at as string, updatedAt: r.updated_at as string });
  list(userId: string, limit = 200, offset = 0) { return (this.db.prepare(`SELECT * FROM ${this.table} WHERE user_id=? ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(userId, limit, offset) as Row[]).map(this.map); }
  get(userId: string, id: string) { const r = this.db.prepare(`SELECT * FROM ${this.table} WHERE id=? AND user_id=?`).get(id, userId) as Row | undefined; return r ? this.map(r) : null; }
  create(userId: string, v: { title: string; content: string; category?: string; source?: string }) {
    const id = newId(), t = now();
    if (this.table === "memories") this.db.prepare("INSERT INTO memories (id,user_id,title,content,category,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(id, userId, v.title, v.content, v.category ?? "note", v.source ?? "user", t, t);
    else this.db.prepare("INSERT INTO notes (id,user_id,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(id, userId, v.title, v.content, t, t);
    return this.get(userId, id)!;
  }
  update(userId: string, id: string, v: { title?: string; content?: string; category?: string }) {
    const cur = this.get(userId, id); if (!cur) return null;
    if (this.table === "memories") this.db.prepare("UPDATE memories SET title=?,content=?,category=?,updated_at=? WHERE id=? AND user_id=?").run(v.title ?? cur.title, v.content ?? cur.content, v.category ?? cur.category, now(), id, userId);
    else this.db.prepare("UPDATE notes SET title=?,content=?,updated_at=? WHERE id=? AND user_id=?").run(v.title ?? cur.title, v.content ?? cur.content, now(), id, userId);
    return this.get(userId, id);
  }
  delete(userId: string, id: string) { return this.db.prepare(`DELETE FROM ${this.table} WHERE id=? AND user_id=?`).run(id, userId).changes > 0; }
  search(userId: string, q: string, limit = 20): TextItem[] {
    if (this.fts) {
      const fq = ftsQuery(q); if (!fq) return [];
      try { return (this.db.prepare(`SELECT t.* FROM ${this.table}_fts f JOIN ${this.table} t ON t.rowid=f.rowid WHERE ${this.table}_fts MATCH ? AND t.user_id=? ORDER BY bm25(${this.table}_fts) LIMIT ?`).all(fq, userId, limit) as Row[]).map(this.map); } catch { /* fall through to LIKE */ }
    }
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    return (this.db.prepare(`SELECT * FROM ${this.table} WHERE user_id=? AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT ?`).all(userId, like, like, limit) as Row[]).map(this.map);
  }
}

/* ---------------- audit, usage, privacy ---------------- */
export class AuditRepo {
  constructor(private db: Db) {}
  add(e: { userId?: string | null; action: string; subject?: string | null; outcome: string; metadata?: Record<string, unknown>; requestId?: string }) {
    try { this.db.prepare("INSERT INTO audit_events (id,user_id,action,subject,outcome,metadata_json,request_id,created_at) VALUES (?,?,?,?,?,?,?,?)").run(newId(), e.userId ?? null, e.action, e.subject ?? null, e.outcome, e.metadata ? JSON.stringify(e.metadata).slice(0, 2000) : null, e.requestId ?? null, now()); } catch { /* audit must not break requests */ }
  }
  list(o: { limit?: number; before?: string; action?: string; subject?: string }): Page<Row> {
    const limit = Math.min(o.limit ?? 50, 200); const args: unknown[] = []; let w = "WHERE 1=1";
    if (o.before) { w += " AND created_at < ?"; args.push(o.before); }
    if (o.action) { w += " AND action LIKE ?"; args.push(`${o.action}%`); }
    if (o.subject) { w += " AND subject = ?"; args.push(o.subject); }
    const rows = this.db.prepare(`SELECT id,user_id,action,subject,outcome,metadata_json,request_id,created_at FROM audit_events ${w} ORDER BY created_at DESC LIMIT ?`).all(...args, limit + 1) as Row[];
    const more = rows.length > limit; const items = rows.slice(0, limit).map((r) => ({ id: r.id, action: r.action, subject: r.subject, outcome: r.outcome, metadata: r.metadata_json ? JSON.parse(r.metadata_json as string) : null, requestId: r.request_id, createdAt: r.created_at }));
    return { items, nextCursor: more ? (items[items.length - 1]!.createdAt as string) : null };
  }
  addToolExecution(e: { userId?: string | null; tool: string; integrationId?: string | null; outcome: string; policy?: string; durationMs?: number; correlationId?: string }) {
    try { this.db.prepare("INSERT INTO tool_executions (id,user_id,tool_name,integration_id,outcome,policy_outcome,duration_ms,correlation_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(newId(), e.userId ?? null, e.tool, e.integrationId ?? null, e.outcome, e.policy ?? null, e.durationMs ?? null, e.correlationId ?? null, now()); } catch { /* ignore */ }
  }
  recentToolExecutions(integrationId: string, limit = 10) { return (this.db.prepare("SELECT tool_name,outcome,policy_outcome,duration_ms,created_at FROM tool_executions WHERE integration_id=? ORDER BY created_at DESC LIMIT ?").all(integrationId, limit) as Row[]).map((r) => ({ tool: r.tool_name as string, outcome: r.outcome as string, policy: r.policy_outcome as string | null, durationMs: r.duration_ms as number | null, at: r.created_at as string })); }
  recentPrivacy(limit = 20) { return (this.db.prepare("SELECT direction,source,classification,blocked,categories,created_at FROM privacy_events ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map((r) => ({ source: r.source as string, classification: r.classification as string, blocked: !!r.blocked, categories: String(r.categories).split(",").filter(Boolean), at: r.created_at as string })); }
  privacyCounts(sinceIso: string) { const r = this.db.prepare("SELECT COUNT(*) total, COALESCE(SUM(blocked),0) blocked FROM privacy_events WHERE created_at>=?").get(sinceIso) as { total: number; blocked: number }; return r; }
}

export class UsageRepo {
  constructor(private db: Db) {}
  private bump(provider: string, bucket: string, f: { r?: number; f?: number; i?: number; o?: number }) {
    this.db.prepare("INSERT INTO usage_counters (provider,bucket,requests,failures,input_tokens,output_tokens) VALUES (?,?,?,?,?,?) ON CONFLICT(provider,bucket) DO UPDATE SET requests=requests+excluded.requests, failures=failures+excluded.failures, input_tokens=input_tokens+excluded.input_tokens, output_tokens=output_tokens+excluded.output_tokens").run(provider, bucket, f.r ?? 0, f.f ?? 0, f.i ?? 0, f.o ?? 0);
  }
  record(provider: string, f: { r?: number; f?: number; i?: number; o?: number }, at = new Date()) { this.bump(provider, "d:" + at.toISOString().slice(0, 10), f); this.bump(provider, "m:" + at.toISOString().slice(0, 16), { r: f.r }); }
  day(provider: string, at = new Date()) { return (this.db.prepare("SELECT requests,failures,input_tokens,output_tokens FROM usage_counters WHERE provider=? AND bucket=?").get(provider, "d:" + at.toISOString().slice(0, 10)) as Row | undefined) ?? { requests: 0, failures: 0, input_tokens: 0, output_tokens: 0 }; }
  minute(provider: string, at = new Date()) { return ((this.db.prepare("SELECT requests FROM usage_counters WHERE provider=? AND bucket=?").get(provider, "m:" + at.toISOString().slice(0, 16)) as { requests: number } | undefined)?.requests) ?? 0; }
  history(provider: string, days = 14) { return (this.db.prepare("SELECT bucket,requests,failures,input_tokens,output_tokens FROM usage_counters WHERE provider=? AND bucket LIKE 'd:%' ORDER BY bucket DESC LIMIT ?").all(provider, days) as Row[]).map((r) => ({ day: String(r.bucket).slice(2), requests: r.requests as number, failures: r.failures as number, inputTokens: r.input_tokens as number, outputTokens: r.output_tokens as number })); }
  purgeOld() { this.db.prepare("DELETE FROM usage_counters WHERE bucket LIKE 'm:%' AND bucket < ?").run("m:" + new Date(Date.now() - 36e5).toISOString().slice(0, 16)); }
}

/* ---------------- confirmations & oauth ---------------- */
export interface ConfirmationRow { id: string; token: string; userId: string; conversationId: string | null; tool: string; args: unknown; argsHash: string; summary: string; createdAt: string; expiresAt: string; consumedAt: string | null; outcome: string | null }
export class ConfirmationsRepo {
  constructor(private db: Db) {}
  private map(r: Row): ConfirmationRow { return { id: r.id as string, token: r.token as string, userId: r.user_id as string, conversationId: r.conversation_id as string | null, tool: r.tool_name as string, args: JSON.parse(r.args_json as string), argsHash: r.args_hash as string, summary: r.summary as string, createdAt: r.created_at as string, expiresAt: r.expires_at as string, consumedAt: r.consumed_at as string | null, outcome: r.outcome as string | null }; }
  create(c: { token: string; userId: string; conversationId?: string | null; tool: string; args: unknown; argsHash: string; summary: string; ttlMs: number }) {
    const id = newId(), t = Date.now();
    this.db.prepare("INSERT INTO confirmations (id,token,user_id,conversation_id,tool_name,args_json,args_hash,summary,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, c.token, c.userId, c.conversationId ?? null, c.tool, JSON.stringify(c.args), c.argsHash, c.summary, new Date(t).toISOString(), new Date(t + c.ttlMs).toISOString());
    return this.get(id)!;
  }
  get(id: string) { const r = this.db.prepare("SELECT * FROM confirmations WHERE id=?").get(id) as Row | undefined; return r ? this.map(r) : null; }
  /** Atomically consumes a confirmation; returns false if already consumed (replay). */
  consume(id: string, outcome: string) { return this.db.prepare("UPDATE confirmations SET consumed_at=?, outcome=? WHERE id=? AND consumed_at IS NULL").run(now(), outcome, id).changes === 1; }
  purge() { this.db.prepare("DELETE FROM confirmations WHERE expires_at < ?").run(new Date(Date.now() - 864e5).toISOString()); }
}
export class OAuthStatesRepo {
  constructor(private db: Db) {}
  create(stateHash: string, userId: string, integrationId: string, verifierCt: string, ttlMs = 10 * 60_000) { const t = Date.now(); this.db.prepare("INSERT INTO oauth_states (state_hash,user_id,integration_id,verifier_ciphertext,created_at,expires_at) VALUES (?,?,?,?,?,?)").run(stateHash, userId, integrationId, verifierCt, new Date(t).toISOString(), new Date(t + ttlMs).toISOString()); }
  consume(stateHash: string): { userId: string; integrationId: string; verifierCt: string } | null {
    return this.db.transaction(() => {
      const r = this.db.prepare("SELECT * FROM oauth_states WHERE state_hash=? AND consumed_at IS NULL AND expires_at>?").get(stateHash, now()) as Row | undefined;
      if (!r) return null;
      this.db.prepare("UPDATE oauth_states SET consumed_at=? WHERE state_hash=?").run(now(), stateHash);
      return { userId: r.user_id as string, integrationId: r.integration_id as string, verifierCt: r.verifier_ciphertext as string };
    })();
  }
  purge() { this.db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").run(now()); }
}

/* ---------------- integrations ---------------- */
export interface IntegrationRow { id: string; version: string; installed: boolean; enabled: boolean; installedAt: string | null; enabledAt: string | null; setupStep: number; connection: "untested" | "connected" | "failed"; lastTestAt: string | null; lastSuccessAt: string | null; lastTestCode: string | null; lastTestMessage: string | null }
const mapInt = (r: Row): IntegrationRow => ({ id: r.id as string, version: r.version as string, installed: !!r.installed, enabled: !!r.enabled, installedAt: r.installed_at as string | null, enabledAt: r.enabled_at as string | null, setupStep: r.setup_step as number, connection: r.connection as IntegrationRow["connection"], lastTestAt: r.last_test_at as string | null, lastSuccessAt: r.last_success_at as string | null, lastTestCode: r.last_test_code as string | null, lastTestMessage: r.last_test_message as string | null });
export class IntegrationsRepo {
  constructor(private db: Db) {}
  ensure(id: string, version: string) { this.db.prepare("INSERT INTO integrations (id,version,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version").run(id, version, now()); }
  get(id: string): IntegrationRow | null { const r = this.db.prepare("SELECT * FROM integrations WHERE id=?").get(id) as Row | undefined; return r ? mapInt(r) : null; }
  all(): IntegrationRow[] { return (this.db.prepare("SELECT * FROM integrations").all() as Row[]).map(mapInt); }
  /** Idempotent: installing an installed integration changes nothing. */
  install(id: string): boolean { return this.db.prepare("UPDATE integrations SET installed=1, installed_at=?, updated_at=? WHERE id=? AND installed=0").run(now(), now(), id).changes > 0; }
  setEnabled(id: string, enabled: boolean) { this.db.prepare("UPDATE integrations SET enabled=?, enabled_at=CASE WHEN ?=1 THEN ? ELSE enabled_at END, updated_at=? WHERE id=?").run(enabled ? 1 : 0, enabled ? 1 : 0, now(), now(), id); }
  setStep(id: string, step: number) { this.db.prepare("UPDATE integrations SET setup_step=?, updated_at=? WHERE id=?").run(step, now(), id); }
  setTest(id: string, ok: boolean, code: string, message: string) {
    const t = now();
    this.db.prepare("UPDATE integrations SET connection=?, last_test_at=?, last_success_at=CASE WHEN ?=1 THEN ? ELSE last_success_at END, last_test_code=?, last_test_message=?, updated_at=? WHERE id=?").run(ok ? "connected" : "failed", t, ok ? 1 : 0, t, code, message.slice(0, 300), t, id);
  }
  resetConnection(id: string) { this.db.prepare("UPDATE integrations SET connection='untested', last_test_code=NULL, last_test_message=NULL, updated_at=? WHERE id=?").run(now(), id); }
  settings(id: string): Record<string, string> { return Object.fromEntries((this.db.prepare("SELECT key,value FROM integration_settings WHERE integration_id=?").all(id) as { key: string; value: string }[]).map((r) => [r.key, r.value])); }
  setSetting(id: string, key: string, value: string) { this.db.prepare("INSERT INTO integration_settings (integration_id,key,value,updated_at) VALUES (?,?,?,?) ON CONFLICT(integration_id,key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(id, key, value, now()); }
  deleteSetting(id: string, key: string) { this.db.prepare("DELETE FROM integration_settings WHERE integration_id=? AND key=?").run(id, key); }
  secretKeys(id: string): string[] { return (this.db.prepare("SELECT key FROM integration_secrets WHERE integration_id=?").all(id) as { key: string }[]).map((r) => r.key); }
  getSecretCt(id: string, key: string): string | null { return ((this.db.prepare("SELECT ciphertext FROM integration_secrets WHERE integration_id=? AND key=?").get(id, key) as { ciphertext: string } | undefined)?.ciphertext) ?? null; }
  setSecretCt(id: string, key: string, ct: string) { const t = now(); this.db.prepare("INSERT INTO integration_secrets (integration_id,key,ciphertext,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(integration_id,key) DO UPDATE SET ciphertext=excluded.ciphertext, updated_at=excluded.updated_at").run(id, key, ct, t, t); }
  deleteSecret(id: string, key: string) { this.db.prepare("DELETE FROM integration_secrets WHERE integration_id=? AND key=?").run(id, key); }
  /** Uninstall: remove configuration + credentials; never touches user content tables (tasks, notes, memories, documents). */
  wipeConfig(id: string) {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM integration_settings WHERE integration_id=?").run(id);
      this.db.prepare("DELETE FROM integration_secrets WHERE integration_id=?").run(id);
      this.db.prepare("DELETE FROM integration_permissions WHERE integration_id=?").run(id);
      this.db.prepare("UPDATE integrations SET installed=0, enabled=0, setup_step=0, connection='untested', last_test_at=NULL, last_success_at=NULL, last_test_code=NULL, last_test_message=NULL, updated_at=? WHERE id=?").run(now(), id);
    })();
  }
  permissions(id: string): Record<string, boolean> { return Object.fromEntries((this.db.prepare("SELECT permission,granted FROM integration_permissions WHERE integration_id=?").all(id) as { permission: string; granted: number }[]).map((r) => [r.permission, !!r.granted])); }
  setPermission(id: string, permission: string, granted: boolean) { this.db.prepare("INSERT INTO integration_permissions (integration_id,permission,granted,updated_at) VALUES (?,?,?,?) ON CONFLICT(integration_id,permission) DO UPDATE SET granted=excluded.granted, updated_at=excluded.updated_at").run(id, permission, granted ? 1 : 0, now()); }
}

export interface Repos {
  users: UsersRepo; sessions: SessionsRepo; settings: SettingsRepo; conversations: ConversationsRepo; tasks: TasksRepo; reminders: RemindersRepo;
  notes: TextRepo; memories: TextRepo; audit: AuditRepo; usage: UsageRepo; confirmations: ConfirmationsRepo; oauth: OAuthStatesRepo; integrations: IntegrationsRepo;
}
export function createRepos(db: Db, fts: boolean): Repos {
  return { users: new UsersRepo(db), sessions: new SessionsRepo(db), settings: new SettingsRepo(db), conversations: new ConversationsRepo(db), tasks: new TasksRepo(db), reminders: new RemindersRepo(db), notes: new TextRepo(db, "notes", fts), memories: new TextRepo(db, "memories", fts), audit: new AuditRepo(db), usage: new UsageRepo(db), confirmations: new ConfirmationsRepo(db), oauth: new OAuthStatesRepo(db), integrations: new IntegrationsRepo(db) };
}
