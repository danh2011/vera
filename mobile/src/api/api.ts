import type * as T from "./types";
import type { ActionResult, AuditEvent, ConfigureResult, IntegrationDetail, IntegrationsCatalogue, ReminderChannel, ReminderDto, ServerSettings, SessionInfo, SessionRowInfo, SetupStatus, TestResult } from "../../../shared/types";

export interface IntegrationsApi {
  catalogue(): Promise<IntegrationsCatalogue>;
  detail(id: string): Promise<IntegrationDetail>;
  install(id: string): Promise<{ changed: boolean; detail: IntegrationDetail }>;
  uninstall(id: string): Promise<{ detail: IntegrationDetail; kept: string[] }>;
  enable(id: string): Promise<IntegrationDetail>;
  disable(id: string): Promise<IntegrationDetail>;
  configure(id: string, input: { values: Record<string, unknown>; clearSecrets?: string[]; step?: number }): Promise<{ result: ConfigureResult; detail: IntegrationDetail }>;
  test(id: string): Promise<{ result: TestResult; detail: IntegrationDetail }>;
  setPermission(id: string, permission: string, granted: boolean): Promise<IntegrationDetail>;
  startOAuth(id: string): Promise<{ authUrl: string; redirectUri: string }>;
  options(id: string, key: string): Promise<{ options: { value: string; label: string }[]; error?: string }>;
  action(id: string, action: string): Promise<{ result: ActionResult; detail: IntegrationDetail }>;
}

/** Same contract as the web app's VeraApi, so both clients talk to the backend identically. */
export interface VeraApi {
  readonly baseUrl: string;
  getSetupStatus(): Promise<SetupStatus>;
  getSession(): Promise<SessionInfo>;
  createOwner(input: { username: string; password: string; setupCode: string }): Promise<SessionInfo>;
  login(input: { username: string; password: string }): Promise<SessionInfo>;
  logout(): Promise<void>;
  listConversations(): Promise<T.ConversationSummary[]>;
  getConversation(id: string): Promise<T.Conversation | null>;
  createConversation(): Promise<T.Conversation>;
  renameConversation(id: string, title: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  sendMessage(conversationId: string, input: T.SendMessageInput, signal?: AbortSignal, onStep?: (step: T.ChatStep) => void): Promise<T.AssistantResponse>;
  resolveConfirmation(id: string, token: string, action: "approve" | "cancel"): Promise<T.Message>;
  listTasks(): Promise<T.Task[]>;
  createTask(input: T.CreateTaskInput): Promise<T.Task>;
  updateTask(id: string, input: T.UpdateTaskInput): Promise<T.Task>;
  deleteTask(id: string): Promise<void>;
  listMemories(): Promise<T.MemoryItem[]>;
  createMemory(input: T.CreateMemoryInput): Promise<T.MemoryItem>;
  updateMemory(id: string, input: T.UpdateMemoryInput): Promise<T.MemoryItem>;
  deleteMemory(id: string): Promise<void>;
  listNotes(): Promise<T.MemoryItem[]>;
  createNote(input: Pick<T.MemoryItem, "title" | "content">): Promise<T.MemoryItem>;
  updateNote(id: string, input: Partial<Pick<T.MemoryItem, "title" | "content">>): Promise<T.MemoryItem>;
  deleteNote(id: string): Promise<void>;
  listReminders(): Promise<{ reminders: ReminderDto[]; channel: ReminderChannel }>;
  createReminder(input: { title: string; remindAt: string; taskId?: string }): Promise<ReminderDto>;
  cancelReminder(id: string): Promise<void>;
  getSystemsOverview(): Promise<T.SystemsOverview>;
  getServerSettings(): Promise<ServerSettings>;
  updateAi(patch: { enabled?: boolean; limits?: Partial<{ perMinute: number; perDay: number; toolRounds: number; outputTokens: number }> }): Promise<void>;
  acknowledgeAi(): Promise<void>;
  listSessions(): Promise<SessionRowInfo[]>;
  revokeOtherSessions(): Promise<number>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  listAudit(limit?: number): Promise<AuditEvent[]>;
  readonly integrations: IntegrationsApi;
}
