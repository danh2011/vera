import type { VeraApi } from "./api";
import type * as T from "../types";
import { storage } from "./storage";

const now = () => new Date().toISOString();
const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (o: Record<string, unknown>, k: string) => typeof o[k] === "string";
const isConv = (v: unknown): v is T.Conversation => isObj(v) && str(v, "id") && str(v, "title") && str(v, "updatedAt") && Array.isArray(v.messages);
const isTask = (v: unknown): v is T.Task => isObj(v) && str(v, "id") && str(v, "title") && typeof v.completed === "boolean" && ["low", "medium", "high"].includes(String(v.priority));
const isMem = (v: unknown): v is T.MemoryItem => isObj(v) && str(v, "id") && str(v, "title") && str(v, "content") && ["note", "fact", "preference"].includes(String(v.category));

const day = (n: number, h = 9) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d.toISOString(); };
function seed() {
  const t = now();
  const tasks: T.Task[] = [
    { id: uid(), title: "Sample: Plan the week", priority: "medium", completed: false, dueAt: day(1), createdAt: t, updatedAt: t },
    { id: uid(), title: "Sample: Review overdue item", priority: "high", completed: false, dueAt: day(-1), createdAt: t, updatedAt: t },
  ];
  const memories: T.MemoryItem[] = [
    { id: uid(), title: "Sample note", content: "This is example data. Edit or delete it.", category: "note", createdAt: t, updatedAt: t },
    { id: uid(), title: "Example preference", content: "Prefers concise answers (example assistant preference, not applied by any AI).", category: "preference", createdAt: t, updatedAt: t },
  ];
  storage.write("tasks", tasks); storage.write("memories", memories); storage.write("conversations", []); storage.markSeeded();
}
function load<X>(key: string, guard: (v: unknown) => v is X): X[] {
  if (!storage.isSeeded()) seed();
  const raw = storage.read(key);
  return Array.isArray(raw) ? raw.filter(guard) : [];
}
const sample = (): T.SystemsOverview => {
  const c = now();
  return { isSample: true, cards: [
    { id: "overall", title: "Overall status", state: "warn", summary: "1 of 6 sample services needs attention", lastCheck: c, metrics: [{ label: "Services", value: "6" }, { label: "Healthy", value: "5" }] },
    { id: "server", title: "Server", state: "ok", summary: "Sample host, running normally", lastCheck: c, metrics: [{ label: "CPU", value: "18%" }, { label: "Memory", value: "2.1 / 4 GB" }, { label: "Disk", value: "61%" }] },
    { id: "docker", title: "Docker services", state: "warn", summary: "5 running, 1 stopped (sample)", lastCheck: c, metrics: [{ label: "Running", value: "5" }], services: [
      { name: "Jellyfin", state: "ok", detail: "Up 12d" }, { name: "Pi-hole", state: "ok", detail: "Up 12d" }, { name: "Navidrome", state: "ok", detail: "Up 3d" },
      { name: "Radarr", state: "ok", detail: "Up 3d" }, { name: "Sonarr", state: "ok", detail: "Up 3d" }, { name: "Example backup job", state: "down", detail: "Stopped" } ] },
    { id: "ha", title: "Home Assistant", state: "ok", summary: "Sample integration", lastCheck: c, metrics: [{ label: "Devices", value: "24" }] },
    { id: "net", title: "Internet", state: "ok", summary: "Sample connectivity", lastCheck: c, metrics: [{ label: "Latency", value: "14 ms" }, { label: "Down", value: "320 Mbps" }] },
    { id: "integrations", title: "Integrations", state: "down", summary: "None connected in this build", lastCheck: c, metrics: [{ label: "Connected", value: "0" }] },
  ] };
};

function reply(text: string, tasks: T.Task[], mems: T.MemoryItem[]): { content: string; tool?: string } {
  const q = text.toLowerCase();
  const tag = "**Demo mode:** no AI model is connected, so this is a scripted response.\n\n";
  if (/task|remind|week|todo|organi/.test(q)) {
    const open = tasks.filter((t) => !t.completed);
    return { tool: "Tasks (local)", content: `${tag}You have **${open.length} open task(s)** saved locally on this device.\n${open.slice(0, 3).map((t) => `- ${t.title}`).join("\n")}\n\nOpen the **Tasks** page to add or edit tasks. Reminders are stored only; nothing will notify you yet.` };
  }
  if (/memory|note|remember|find/.test(q)) {
    const words = q.split(/\W+/).filter((w) => w.length > 3);
    const hits = mems.filter((m) => words.some((w) => `${m.title} ${m.content}`.toLowerCase().includes(w))).slice(0, 3);
    return { tool: "Memory (local)", content: `${tag}${hits.length ? "Matching saved items:\n" + hits.map((m) => `- **${m.title}**: ${m.content}`).join("\n") : "I found no matching saved items."}\n\nManage saved items on the **Memory** page.` };
  }
  if (/server|status|docker|home|system/.test(q)) {
    return { tool: "Systems (sample data)", content: `${tag}The Systems page shows **sample data only**: 5 of 6 example services healthy. No real server has been checked.` };
  }
  return { content: `${tag}I can't answer general questions until a real AI provider is connected (planned for a later milestone). For now, try asking about tasks, memory or systems.` };
}

export class MockVeraApi implements VeraApi {
  readonly kind = "mock" as const;
  constructor(private delayMs = 600) {}
  private wait(signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
      const t = setTimeout(resolve, this.delayMs);
      signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    });
  }
  private convs() { return load("conversations", isConv); }
  private save(c: T.Conversation[]) { if (!storage.write("conversations", c)) throw new Error("Could not save to local storage."); }

  async listConversations() { return this.convs().map(({ id, title, updatedAt }) => ({ id, title, updatedAt })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async getConversation(id: string) { return this.convs().find((c) => c.id === id) ?? null; }
  async createConversation() { const t = now(); const c: T.Conversation = { id: uid(), title: "New chat", createdAt: t, updatedAt: t, messages: [] }; this.save([...this.convs(), c]); return c; }
  async renameConversation(id: string, title: string) { const name = title.trim(); if (!name) throw new Error("Title cannot be empty."); this.save(this.convs().map((c) => (c.id === id ? { ...c, title: name.slice(0, 80) } : c))); }
  async deleteConversation(id: string) { this.save(this.convs().filter((c) => c.id !== id)); }

  async sendMessage(id: string, input: T.SendMessageInput, signal?: AbortSignal) {
    const text = input.content.trim();
    if (!text) throw new Error("Message is empty.");
    const stamp = (c: T.Conversation, m: T.Message[], title?: string): T.Conversation => ({ ...c, title: title ?? c.title, messages: m, updatedAt: now() });
    let all = this.convs(); const conv = all.find((c) => c.id === id);
    if (!conv) throw new Error("Conversation not found.");
    let msgs = conv.messages;
    if (input.regenerate) { while (msgs.length && msgs[msgs.length - 1]?.role === "assistant") msgs = msgs.slice(0, -1); }
    else msgs = [...msgs, { id: uid(), conversationId: id, role: "user", content: text, createdAt: now(), status: "complete" }];
    this.save(all.map((c) => (c.id === id ? stamp(c, msgs, c.title === "New chat" ? text.slice(0, 40) : c.title) : c)));
    await this.wait(signal);
    const r = reply(text, load("tasks", isTask), load("memories", isMem));
    const message: T.Message = { id: uid(), conversationId: id, role: "assistant", content: r.content, createdAt: now(), status: "complete", tool: r.tool };
    all = this.convs();
    if (!all.some((c) => c.id === id)) throw new Error("Conversation was deleted."); // never write into a deleted conversation
    this.save(all.map((c) => (c.id === id ? stamp(c, [...c.messages, message]) : c)));
    return { message };
  }

  async listTasks() { return load("tasks", isTask); }
  async createTask(input: T.CreateTaskInput) { const t = now(); const task: T.Task = { ...input, id: uid(), completed: false, createdAt: t, updatedAt: t }; storage.write("tasks", [...load("tasks", isTask), task]); return task; }
  async updateTask(id: string, input: T.UpdateTaskInput) {
    let out: T.Task | undefined;
    storage.write("tasks", load("tasks", isTask).map((x) => (x.id === id ? (out = { ...x, ...input, updatedAt: now() }) : x)));
    if (!out) throw new Error("Task not found."); return out;
  }
  async deleteTask(id: string) { storage.write("tasks", load("tasks", isTask).filter((x) => x.id !== id)); }

  async listMemories() { return load("memories", isMem); }
  async createMemory(input: T.CreateMemoryInput) { const t = now(); const m: T.MemoryItem = { ...input, id: uid(), createdAt: t, updatedAt: t }; storage.write("memories", [...load("memories", isMem), m]); return m; }
  async updateMemory(id: string, input: T.UpdateMemoryInput) {
    let out: T.MemoryItem | undefined;
    storage.write("memories", load("memories", isMem).map((x) => (x.id === id ? (out = { ...x, ...input, updatedAt: now() }) : x)));
    if (!out) throw new Error("Memory not found."); return out;
  }
  async deleteMemory(id: string) { storage.write("memories", load("memories", isMem).filter((x) => x.id !== id)); }
  async getSystemsOverview() { return sample(); }
  /* ---- demo-only stubs: there is no server in mock mode, so nothing server-side is simulated ---- */
  async getSetupStatus() { return { ownerExists: true, setupTokenRequired: false }; }
  async getSession() { return { authenticated: true, username: "demo" }; }
  async createOwner() { return { authenticated: true, username: "demo" }; }
  async login() { return { authenticated: true, username: "demo" }; }
  async logout() { /* nothing to end */ }
  async resolveConfirmation(): Promise<T.Message> { throw new Error("Confirmations need the Vera backend."); }
  async listNotes() { return load("notes", isMem); }
  async createNote(i: { title: string; content: string }) { const t = now(); const m: T.MemoryItem = { ...i, category: "note", id: uid(), createdAt: t, updatedAt: t }; storage.write("notes", [...load("notes", isMem), m]); return m; }
  async updateNote(id: string, i: { title?: string; content?: string }) { let out: T.MemoryItem | undefined; storage.write("notes", load("notes", isMem).map((x) => (x.id === id ? (out = { ...x, ...i, updatedAt: now() }) : x))); if (!out) throw new Error("Note not found."); return out; }
  async deleteNote(id: string) { storage.write("notes", load("notes", isMem).filter((x) => x.id !== id)); }
  async listReminders() { return { reminders: [], channel: { ready: false, status: "unavailable", statusLabel: "Demo", detail: "Demo mode has no server, so reminders can't be delivered.", installed: false, integrationId: "notifications" } }; }
  async createReminder(): Promise<never> { throw new Error("Reminders need the Vera backend."); }
  async cancelReminder(): Promise<void> { throw new Error("Reminders need the Vera backend."); }
  async getServerSettings() { return null; }
  async updateAi() { throw new Error("Demo mode has no server."); }
  async acknowledgeAi() { throw new Error("Demo mode has no server."); }
  async listSessions() { return []; }
  async revokeOtherSessions() { return 0; }
  async changePassword(): Promise<void> { throw new Error("Demo mode has no accounts."); }
  async listAudit() { return []; }
  readonly integrations: VeraApi["integrations"] = (() => { const no = async (): Promise<never> => { throw new Error("Integrations need the Vera backend. Demo mode has no server, so no integration state is simulated."); }; return { catalogue: no, detail: no, install: no, uninstall: no, enable: no, disable: no, configure: no, test: no, setPermission: no, startOAuth: no, options: no, action: no }; })();
}
