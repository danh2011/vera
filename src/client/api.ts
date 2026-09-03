import { ChatResponse, Conversation, ChatMessage, HealthStatus } from "@shared/types.js";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  sendMessage: (conversationId: string | null, message: string) =>
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, message }),
    }).then((r) => json<ChatResponse>(r)),

  listConversations: () => fetch("/api/conversations").then((r) => json<Conversation[]>(r)),

  getMessages: (conversationId: string) =>
    fetch(`/api/conversations/${conversationId}/messages`).then((r) => json<ChatMessage[]>(r)),

  renameConversation: (id: string, title: string) =>
    fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).then((r) => json<{ ok: boolean }>(r)),

  deleteConversation: (id: string) =>
    fetch(`/api/conversations/${id}`, { method: "DELETE" }).then((r) => json<{ ok: boolean }>(r)),

  getHealth: () => fetch("/health").then((r) => json<HealthStatus>(r)),

  getSettings: () => fetch("/api/settings").then((r) => json<any>(r)),
  updateSettings: (settings: Record<string, unknown>) =>
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }).then((r) => json<{ ok: boolean }>(r)),

  getVersion: () => fetch("/api/version").then((r) => json<any>(r)),

  getData: (kind: "memories" | "calendar" | "reminders" | "notes" | "tasks" | "automations") =>
    fetch(`/api/data/${kind}`).then((r) => json<any[]>(r)),
};
