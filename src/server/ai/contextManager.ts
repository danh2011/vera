import { db } from "../database/db.js";
import { ChatMessage } from "../../shared/types.js";

/**
 * V0.1 context budgeting: a straightforward message-count + rough
 * character-based token estimate. Not sophisticated summarization yet -
 * designed so that can be added later without changing the call sites.
 */

const MAX_RECENT_MESSAGES = 20;
const MAX_APPROX_TOKENS = 6000;
const CHARS_PER_TOKEN_ESTIMATE = 4;

export function approxTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

export interface BuiltContext {
  messages: ChatMessage[];
  approxTokenCount: number;
}

export function buildRecentContext(conversationId: string): BuiltContext {
  const rows = db
    .prepare(
      `SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt DESC LIMIT ?`,
    )
    .all(conversationId, MAX_RECENT_MESSAGES) as any[];

  const chronological: ChatMessage[] = rows
    .reverse()
    .map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      role: r.role,
      content: r.content,
      toolName: r.toolName,
      createdAt: r.createdAt,
    }));

  // Trim from the oldest end until we're under the approximate token budget.
  let total = chronological.reduce((sum, m) => sum + approxTokens(m.content), 0);
  const trimmed = [...chronological];
  while (trimmed.length > 2 && total > MAX_APPROX_TOKENS) {
    const removed = trimmed.shift();
    if (removed) total -= approxTokens(removed.content);
  }

  return { messages: trimmed, approxTokenCount: total };
}

export function relevantMemorySnippets(limit = 10): string[] {
  const rows = db
    .prepare(`SELECT content FROM memories ORDER BY importance DESC, updatedAt DESC LIMIT ?`)
    .all(limit) as { content: string }[];
  return rows.map((r) => r.content);
}
