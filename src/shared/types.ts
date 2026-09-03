// Shared types between server and client.

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  toolName?: string | null;
  createdAt: string;
}

export interface CapabilityCallSummary {
  name: string;
  action: string;
  durationMs: number;
  ok: boolean;
}

export interface ChatResponse {
  conversationId: string;
  message: ChatMessage;
  capabilityCalls: CapabilityCallSummary[];
  blocked?: boolean;
  devInfo?: DevInfo;
}

export interface DevInfo {
  model: string;
  intentNotes?: string;
  capabilitiesConsidered: string[];
  responseTimeMs: number;
  contextApproxTokens: number;
  contextMessageCount: number;
}

export interface HealthStatus {
  status: "ok" | "degraded" | "error";
  checks: {
    application: boolean;
    database: boolean;
    gemini: { configured: boolean; ok: boolean | null };
    workspace: boolean;
  };
  version: string;
}

export interface MemoryItem {
  id: string;
  category: string;
  content: string;
  importance: number;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  notes: string | null;
}

export interface Reminder {
  id: string;
  text: string;
  dueAt: string;
  completed: boolean;
}

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high";
  dueDate: string | null;
  status: "open" | "done";
}

export interface AutomationItem {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  enabled: boolean;
}

export interface AppSettings {
  theme: "light" | "dark" | "system";
  autoSpeak?: boolean;
  developerMode: boolean;
}
