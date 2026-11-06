import { fetch as expoFetch } from "expo/fetch";
import type * as T from "./types";
import type { ReminderChannel, ReminderDto, ServerSettings, SessionInfo, SessionRowInfo, AuditEvent, SetupStatus } from "../../../shared/types";
import type { IntegrationsApi, VeraApi } from "./api";
import { ApiError, ConnectionError, isAbort } from "./errors";
import { parseSessionCookie, COOKIE_NAME } from "./cookies";
import { drainNdjson, flushNdjson } from "./stream";

type FetchFn = (url: string, init?: Record<string, unknown>) => Promise<Response>;
export interface ClientOptions {
  baseUrl: string;
  /** Session token restored from secure storage. */
  cookie?: string | null;
  /** Called whenever the session token changes (login, logout) so it can be persisted. */
  onCookie?: (token: string | null) => void;
  /** Called when the server says the session is gone. */
  onUnauthenticated?: () => void;
  fetchImpl?: FetchFn;
  timeoutMs?: number;
}

/**
 * The phone's HTTP client for the Vera backend.
 *
 * - No browser, so no cookie jar to lean on: the session token is kept in secure storage and sent explicitly.
 *   (If a server hides Set-Cookie from the app, the platform cookie jar is used instead.)
 * - Replies stream as NDJSON through expo/fetch, which supports real response streams on Android.
 * - Never invents data: failures surface as errors.
 */
export class NativeVeraApi implements VeraApi {
  readonly baseUrl: string;
  private api: string;
  private host: string;
  private csrf = "";
  private cookie: string | null;
  private fetchImpl: FetchFn;
  private timeoutMs: number;
  constructor(private opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.api = `${this.baseUrl}/api/v1`;
    this.host = this.baseUrl.replace(/^https?:\/\//, "");
    this.cookie = opts.cookie || null;
    this.fetchImpl = opts.fetchImpl ?? (expoFetch as unknown as FetchFn);
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  /* ------------------------------------------------------------------ transport */
  private async raw(method: string, path: string, body?: unknown, signal?: AbortSignal, timeout = this.timeoutMs): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.csrf && method !== "GET") headers["X-CSRF-Token"] = this.csrf;
    if (this.cookie) headers.Cookie = `${COOKIE_NAME}=${this.cookie}`;
    const ctl = new AbortController(); let timedOut = false;
    const timer = timeout > 0 ? setTimeout(() => { timedOut = true; ctl.abort(); }, timeout) : null;
    const onAbort = () => ctl.abort(); signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) ctl.abort();
    try {
      const res = await this.fetchImpl(`${this.api}${path}`, { method, headers, credentials: this.cookie ? "omit" : "include", body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
      this.captureCookie(res);
      return res;
    } catch (e) {
      if (timedOut) throw new ConnectionError(this.host, "timeout");
      if (isAbort(e)) throw e;
      throw new ConnectionError(this.host);
    } finally { if (timer) clearTimeout(timer); signal?.removeEventListener("abort", onAbort); }
  }
  private captureCookie(res: Response) {
    const t = parseSessionCookie(res.headers?.get?.("set-cookie"));
    if (t === null) return;
    this.cookie = t || null; this.opts.onCookie?.(this.cookie);
  }
  private async fail(res: Response): Promise<never> {
    let code = "ERROR", message = `The server answered ${res.status}.`, fields: Record<string, string> | undefined;
    try { const j = await res.json(); if (j?.error) { code = j.error.code ?? code; message = j.error.message ?? message; fields = j.error.fields; } } catch { /* not JSON */ }
    if (res.status === 401 && code === "UNAUTHENTICATED") this.opts.onUnauthenticated?.();
    throw new ApiError(res.status, code, message, fields);
  }
  private async req<R>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<R> {
    const res = await this.raw(method, path, body, signal); if (!res.ok) return this.fail(res);
    try { return (await res.json()) as R; } catch { throw new ApiError(502, "BAD_RESPONSE", "The server sent something Vera couldn't read. Is this really a Vera server?"); }
  }
  private remember(s: SessionInfo) { if (s.csrfToken) this.csrf = s.csrfToken; return s; }

  /* ------------------------------------------------------------------ session */
  getSetupStatus() { return this.req<SetupStatus>("GET", "/setup/status"); }
  async getSession() { return this.remember(await this.req<SessionInfo>("GET", "/auth/session")); }
  async createOwner(i: { username: string; password: string; setupCode: string }) { return this.remember(await this.req<SessionInfo>("POST", "/setup/owner", i)); }
  async login(i: { username: string; password: string }) { return this.remember(await this.req<SessionInfo>("POST", "/auth/login", i)); }
  async logout() { try { await this.req("POST", "/auth/logout", {}); } finally { this.csrf = ""; this.cookie = null; this.opts.onCookie?.(null); } }

  /* ------------------------------------------------------------------ chat */
  async listConversations() { return (await this.req<{ conversations: T.ConversationSummary[] }>("GET", "/conversations")).conversations; }
  async getConversation(id: string) { try { return await this.req<T.Conversation>("GET", `/conversations/${id}`); } catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; } }
  createConversation() { return this.req<T.Conversation>("POST", "/conversations", {}); }
  async renameConversation(id: string, title: string) { await this.req("PATCH", `/conversations/${id}`, { title }); }
  async deleteConversation(id: string) { await this.req("DELETE", `/conversations/${id}`); }
  async sendMessage(id: string, input: T.SendMessageInput, signal?: AbortSignal, onStep?: (s: T.ChatStep) => void): Promise<T.AssistantResponse> {
    const res = await this.raw("POST", `/conversations/${id}/messages?stream=1`, { content: input.content, regenerate: input.regenerate }, signal, 0);
    if (!res.ok) return this.fail(res);
    let final: T.Message | null = null;
    const handle = (ev: ReturnType<typeof drainNdjson>["events"][number]) => {
      if (ev.type === "step") onStep?.(ev.step);
      else if (ev.type === "message") final = ev.message as T.Message;
      else if (ev.type === "error") throw new ApiError(500, ev.code, ev.message);
    };
    const dec = new TextDecoder(); let buf = "";
    try {
      if (res.body && typeof res.body.getReader === "function") {
        const reader = res.body.getReader();
        for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const d = drainNdjson(buf); buf = d.rest; d.events.forEach(handle); }
      } else buf = await res.text().then((t) => { const d = drainNdjson(t); d.events.forEach(handle); return d.rest; });
      flushNdjson(buf).forEach(handle);
    } catch (e) {
      if (e instanceof ApiError || isAbort(e)) throw e;
      throw new ApiError(502, "INCOMPLETE", "The connection dropped before Vera finished. Try again.");
    }
    if (!final) throw new ApiError(502, "INCOMPLETE", "The connection ended before Vera finished. Try again.");
    return { message: final };
  }
  async resolveConfirmation(id: string, token: string, action: "approve" | "cancel") { return (await this.req<{ message: T.Message }>("POST", `/confirmations/${id}/${action}`, { token })).message; }

  /* ------------------------------------------------------------------ tasks, memory, notes, reminders */
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
  listReminders() { return this.req<{ reminders: ReminderDto[]; channel: ReminderChannel }>("GET", "/reminders"); }
  createReminder(i: { title: string; remindAt: string; taskId?: string }) { return this.req<ReminderDto>("POST", "/reminders", i); }
  async cancelReminder(id: string) { await this.req("DELETE", `/reminders/${id}`); }

  /* ------------------------------------------------------------------ systems, settings, account */
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

/** Quick, unauthenticated check used on the connect screen: is this address really a Vera server? */
export async function probeServer(baseUrl: string, fetchImpl: FetchFn = expoFetch as unknown as FetchFn, timeoutMs = 8000): Promise<{ ok: true; status: SetupStatus } | { ok: false; message: string }> {
  const host = baseUrl.replace(/^https?:\/\//, "");
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}/api/v1/setup/status`, { method: "GET", headers: { Accept: "application/json" }, credentials: "omit", signal: ctl.signal });
    if (!res.ok) return { ok: false, message: res.status === 404 ? "Something answered, but it doesn't look like a Vera server. Check the address and port." : `The server answered ${res.status}. Check the address and that Vera is running.` };
    const j = await res.json().catch(() => null) as SetupStatus | null;
    if (!j || typeof j.ownerExists !== "boolean") return { ok: false, message: "Something answered, but it doesn't look like a Vera server. Check the address and port." };
    return { ok: true, status: j };
  } catch (e) {
    return { ok: false, message: isAbort(e) ? `${host} didn't answer in time. Is the server on, and are you on the same network (or VPN)?` : `Can't reach ${host}. Check the address, that Vera is running, and that this phone can reach it.` };
  } finally { clearTimeout(timer); }
}
