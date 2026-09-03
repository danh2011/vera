import { z } from "zod";
import { v4 as uuid } from "uuid";
import { db } from "../database/db.js";
import { Capability, CapabilityResult } from "./types.js";
import { MemoryItem } from "../../shared/types.js";

function row(r: any): MemoryItem {
  return {
    id: r.id,
    category: r.category,
    content: r.content,
    importance: r.importance,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export const memoryCapability: Capability = {
  name: "memory",
  description: "Remembers, recalls, updates, and forgets information about the user.",
  actions: [
    {
      name: "memory_remember",
      description: "Store a new piece of information to remember long-term.",
      permission: "write",
      inputSchema: z.object({
        content: z.string().min(1),
        category: z.string().default("general"),
        importance: z.number().int().min(1).max(5).default(3),
      }),
      execute: async (input): Promise<CapabilityResult> => {
        const { content, category, importance } = input as {
          content: string;
          category: string;
          importance: number;
        };
        const id = uuid();
        db.prepare(
          `INSERT INTO memories (id, category, content, importance) VALUES (?, ?, ?, ?)`,
        ).run(id, category, content, importance);
        return { ok: true, summary: `Remembered: "${content}"`, data: { id } };
      },
    },
    {
      name: "memory_recall",
      description: "Search stored memories, optionally by category or keyword.",
      permission: "read",
      inputSchema: z.object({
        query: z.string().optional(),
        category: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async (input): Promise<CapabilityResult> => {
        const { query, category, limit } = input as {
          query?: string;
          category?: string;
          limit: number;
        };
        let sql = "SELECT * FROM memories WHERE 1=1";
        const params: unknown[] = [];
        if (category) {
          sql += " AND category = ?";
          params.push(category);
        }
        if (query) {
          sql += " AND content LIKE ?";
          params.push(`%${query}%`);
        }
        sql += " ORDER BY importance DESC, updatedAt DESC LIMIT ?";
        params.push(limit);
        const rows = db.prepare(sql).all(...params) as any[];
        const items = rows.map(row);
        return {
          ok: true,
          summary:
            items.length === 0
              ? "I don't have any memories matching that."
              : `Found ${items.length} memor${items.length === 1 ? "y" : "ies"}.`,
          data: items,
        };
      },
    },
    {
      name: "memory_update",
      description: "Update an existing memory's content, category, or importance.",
      permission: "write",
      inputSchema: z.object({
        id: z.string(),
        content: z.string().optional(),
        category: z.string().optional(),
        importance: z.number().int().min(1).max(5).optional(),
      }),
      execute: async (input): Promise<CapabilityResult> => {
        const { id, content, category, importance } = input as {
          id: string;
          content?: string;
          category?: string;
          importance?: number;
        };
        const existing = db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as any;
        if (!existing) return { ok: false, summary: "I couldn't find that memory.", error: "not_found" };
        db.prepare(
          `UPDATE memories SET content = ?, category = ?, importance = ?, updatedAt = datetime('now') WHERE id = ?`,
        ).run(
          content ?? existing.content,
          category ?? existing.category,
          importance ?? existing.importance,
          id,
        );
        return { ok: true, summary: "Memory updated." };
      },
    },
    {
      name: "memory_forget",
      description: "Delete a memory by id, or by a content search term.",
      permission: "write",
      inputSchema: z.object({
        id: z.string().optional(),
        contentMatch: z.string().optional(),
      }),
      execute: async (input): Promise<CapabilityResult> => {
        const { id, contentMatch } = input as { id?: string; contentMatch?: string };
        if (id) {
          const res = db.prepare("DELETE FROM memories WHERE id = ?").run(id);
          return {
            ok: res.changes > 0,
            summary: res.changes > 0 ? "Forgotten." : "I couldn't find that memory.",
          };
        }
        if (contentMatch) {
          const res = db
            .prepare("DELETE FROM memories WHERE content LIKE ?")
            .run(`%${contentMatch}%`);
          return {
            ok: res.changes > 0,
            summary:
              res.changes > 0
                ? `Forgot ${res.changes} matching memor${res.changes === 1 ? "y" : "ies"}.`
                : "I couldn't find a matching memory.",
          };
        }
        return { ok: false, summary: "I need an id or a search term to forget something.", error: "missing_input" };
      },
    },
  ],
};
