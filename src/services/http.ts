import type * as T from "../types";
import type { AuditEvent, ServerSettings, SessionInfo, SessionRowInfo, SetupStatus, StreamEvent } from "../../shared/types";
import type { IntegrationsApi, VeraApi } from "./api";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>) { super(message); this.name = "ApiError"; }
}
export class ConnectionError extends Error {
  constructor() { super("Can't reach the Vera server. Check that it is running and that you're on the right address."); this.name = "ConnectionError"; }
}
export const UNAUTH_EVENT = "vera:unauthenticated";

/** The only production implementation. It never invents data: failures surface as errors. */
export class HttpVeraApi implements VeraApi {
  readonly kind = "http" as const;
  private csrf = "";
  constructor(private base = "/api/v1") {}

  private async raw(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.csrf && method !== "GET") headers["X-CSRF-Token"] = this.csrf;
    try { return await fetch(`${this.base}${path}`, { method, headers, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body), signal }); }
    catch (e) { if ((e as Error).name === "AbortError") throw e; throw new ConnectionError(); }
  }
  private async fail(res: Response): Promise<never> {
    let code = "ERROR", message = `The server answered ${res.status}.`, fields: Record<string, string> | undefined;
    try { const j = await res.json(); if (j?.error) { code = j.error.code ?? code; message = j.error.message ?? message; fields = j.error.fields; } } catch { /* not JSON */ }
    if (res.status === 401 && code === "UNAUTHENTICATED") window.dispatchEvent(new Event(UNAUTH_EVENT));
    throw new ApiError(res.status, code, message, fields);
  }
  private async req<R>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<R> {
    const res = await this.raw(method, path, body, signal); if (!res.ok) return this.fail(res);
    return (await res.json()) as R;
  }
  private remember(s: SessionInfo) { if (s.csrfToken) this.csrf = s.csrfToken; return s; }

  /* ---- session ---- */
  getSetupStatus() { return this.req<SetupStatus>("GET", "/setup/status"); }
  async getSession() { return this.remember(await this.req<SessionInfo>("GET", "/auth/session")); }
  async createOwner(i: { username: string; password: string; setupCode: string }) { return this.remember(await this.req<SessionInfo>("POST", "/setup/owner", i)); }
  async login(i: { username: string; password: string }) { return this.remember(await this.req<SessionInfo>("POST", "/auth/login", i)); }
  async logout() { await this.req("POST", "/auth/logout", {}); this.csrf = ""; }

  /* ---- chat ---- */
  async listConversations() { return (await this.req<{ conversations: T.ConversationSummary[] }>("GET", "/conversations")).conversations; }
  async getConversation(id: string) { try { return await this.req<T.Conversation>("GET", `/conversations/${id}`); } catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; } }
  createConversation() { return this.req<T.Conversation>("POST", "/conversations", {}); }
  async renameConversation(id: string, title: string) { await this.req("PATCH", `/conversations/${id}`, { title }); }
  async deleteConversation(id: string) { await this.req("DELETE", `/conversations/${id}`); }
  async sendMessage(id: string, input: T.SendMessageInput, signal?: AbortSignal, onStep?: (s: T.ChatStep) => void): Promise<T.AssistantResponse> {
    const res = await this.raw("POST", `/conversations/${id}/messages?stream=1`, { content: input.content, regenerate: input.regenerate }, signal);
    if (!res.ok) return this.fail(res);
    if (!res.body) throw new ApiError(502, "NO_BODY", "The server sent an empty reply.");
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ""; let final: T.Message | null = null;
    const handle = (line: string) => {
      if (!line.trim()) return; const ev = JSON.parse(line) as StreamEvent;
      if (ev.type === "step") onStep?.(ev.step); else if (ev.type === "message") final = ev.message as T.Message; else if (ev.type === "error") throw new ApiError(500, ev.code, ev.message);
    };
    for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i: number; while ((i = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); } }
    handle(buf);
    if (!final) throw new ApiError(502, "INCOMPLETE", "The connection ended before Vera finished. Try again.");
    return { message: final };
  }
  async resolveConfirmation(id: string, token: string, action: "approve" | "cancel") { return (await this.req<{ message: T.Message }>("POST", `/confirmations/${id}/${action}`, { token })).message; }

  /* ---- tasks, memory, notes ---- */
  async listTasks() { return (await this.req<{ tasks: T.Task[] }>("GET", "/tasks")).tasks; }
  createTask(i: T.CreateTaskInput) { return this.req<T.Task>("POST", "/tasks", i); }
  updateTask(id: string, i: T.UpdateTaskInput) { return this.req<T.Task>("PATCH", `/tasks/${id}`, { ...i, description: i.description ?? undefined }); }
  async deleteTask(id: string) { await this.req("DELETE", `/tasks/${id}`); }
  async listMemories() { return (await this.req<{ items: T.MemoryItem[] }>("GET", "/memory")).items; }
  createMemory(i: T.CreateMemoryInput) { return this.req<T.MemoryItem>("POST", "/memory", i); }
  updateMemory(id: string, i: T.UpdateMemoryInput) { return this.req<T.MemoryItem>("PATCH", `/memory/${id}`, i); }
  async deleteMemory(id: string) { await this.req("DELETE", `/memory/${id}`); }
  async listNotes() { return (await this.req<{ items: T.MemoryItem[] }>("GET", "/notes")).items.map((n) => ({ ...n, category: "note" as const })); }
  createNote(i: { title: string; content: string }) { return this.req<T.MemoryItem>("POST", "/notes", i); }
  updateNote(id: string, i: { title?: string; content?: string }) { return this.req<T.MemoryItem>("PATCH", `/notes/${id}`, i); }
  async deleteNote(id: string) { await this.req("DELETE", `/notes/${id}`); }

  listReminders() { return this.req<{ reminders: import("../../shared/types").ReminderDto[]; channel: import("../../shared/types").ReminderChannel }>("GET", "/reminders"); }
  createReminder(i: { title: string; remindAt: string; taskId?: string }) { return this.req<import("../../shared/types").ReminderDto>("POST", "/reminders", i); }
  async cancelReminder(id: string) { await this.req("DELETE", `/reminders/${id}`); }

  /* ---- systems, settings ---- */
  getSystemsOverview() { return this.req<T.SystemsOverview>("GET", "/system/overview"); }
  getServerSettings() { return this.req<ServerSettings>("GET", "/settings"); }
  async updateAi(patch: Parameters<VeraApi["updateAi"]>[0]) { await this.req("PATCH", "/settings/ai", patch); }
  async acknowledgeAi() { await this.req("POST", "/settings/ai/acknowledge", { eligibilityChecked: true, quotaChecked: true }); }
  async listSessions() { return (await this.req<{ sessions: SessionRowInfo[] }>("GET", "/auth/sessions")).sessions; }
  async revokeOtherSessions() { return (await this.req<{ revoked: number }>("POST", "/auth/sessions/revoke-others", {})).revoked; }
  async changePassword(currentPassword: string, newPassword: string) { await this.req("POST", "/auth/password", { currentPassword, newPassword }); }
  async listAudit(limit = 30) { return (await this.req<{ items: AuditEvent[] }>("GET", `/audit?limit=${limit}`)).items; }

  readonly integrations: IntegrationsApi = {
    catalogue: () => this.req("GET", "/integrations"),
    detail: (id) => this.req("GET", `/integrations/${id}`),
    install: (id) => this.req("POST", `/integrations/${id}/install`, {}),
    uninstall: (id) => this.req("POST", `/integrations/${id}/uninstall`, { acknowledge: true }),
    enable: async (id) => (await this.req<{ detail: never }>("POST", `/integrations/${id}/enable`, {})).detail,
    disable: async (id) => (await this.req<{ detail: never }>("POST", `/integrations/${id}/disable`, {})).detail,
    configure: (id, input) => this.req("POST", `/integrations/${id}/configure`, input),
    test: (id) => this.req("POST", `/integrations/${id}/test-connection`, {}),
    setPermission: (id, permission, granted) => this.req("PATCH", `/integrations/${id}/permissions/${permission}`, { granted }),
    startOAuth: (id) => this.req("POST", `/integrations/${id}/oauth/start`, {}),
    options: (id, key) => this.req("GET", `/integrations/${id}/options/${key}`),
    action: (id, action) => this.req("POST", `/integrations/${id}/actions/${action}`, {}),
  };
}
