export type MessageRole = "user" | "assistant" | "system";
import type { ChatStep, PendingConfirmation, PolicyNotice } from "../shared/types";
export type { ChatStep, PendingConfirmation, PolicyNotice };
export interface Message { id: string; conversationId: string; role: MessageRole; content: string; createdAt: string; status?: "complete" | "pending" | "error"; tool?: string; confirmation?: PendingConfirmation; policy?: PolicyNotice; steps?: ChatStep[] }
export interface ConversationSummary { id: string; title: string; updatedAt: string }
export interface Conversation extends ConversationSummary { createdAt: string; messages: Message[] }
export interface SendMessageInput { content: string; regenerate?: boolean }
export interface AssistantResponse { message: Message }
export type Priority = "low" | "medium" | "high";
export interface Task { id: string; title: string; description?: string; dueAt?: string; priority: Priority; completed: boolean; createdAt: string; updatedAt: string }
export type CreateTaskInput = Pick<Task, "title" | "priority"> & Partial<Pick<Task, "description" | "dueAt">>;
export type UpdateTaskInput = Partial<Omit<Task, "id" | "createdAt" | "updatedAt">>;
export type MemoryCategory = "note" | "fact" | "preference";
export interface MemoryItem { id: string; title: string; content: string; category: MemoryCategory; createdAt: string; updatedAt: string ; source?: "user" | "assistant" }
export type CreateMemoryInput = Pick<MemoryItem, "title" | "content" | "category">;
export type UpdateMemoryInput = Partial<CreateMemoryInput>;
export type ServiceState = "ok" | "warn" | "down";
export interface ServiceInfo { name: string; state: ServiceState; detail: string }
export interface SystemCard { id: string; title: string; state: ServiceState; summary: string; lastCheck: string; metrics: { label: string; value: string }[]; services?: ServiceInfo[] }
export interface SystemsOverview { isSample: boolean; notice?: string; cards: SystemCard[] }
export type Accent = "neutral" | "blue" | "teal" | "green" | "amber" | "orange";
export interface Settings { name: string; interests: string[]; accent: Accent; onboarded: boolean; allowFiles: boolean; allowTools: boolean; theme: "dark" | "light" | "system"; compact: boolean; reduceMotion: boolean; enterToSend: boolean; speakReplies: boolean }
export const DEFAULT_SETTINGS: Settings = { name: "", interests: [], accent: "neutral", onboarded: false, allowFiles: false, allowTools: false, theme: "dark", compact: false, reduceMotion: false, enterToSend: true, speakReplies: false };
