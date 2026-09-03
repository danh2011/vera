import { z } from "zod";
import { v4 as uuid } from "uuid";
import { db } from "../database/db.js";
import { Capability, CapabilityResult } from "./types.js";
import { NoteItem } from "../../shared/types.js";

function row(r: any): NoteItem {
  return { id: r.id, title: r.title, content: r.content, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

export const notesCapability: Capability = {
  name: "notes",
  description: "Create, read, search, update, and delete notes (separate from long-term memory).",
  actions: [
    {
      name: "notes_create",
      description: "Create a new note.",
      permission: "write",
      inputSchema: z.object({ title: z.string().min(1), content: z.string().default("") }),
      execute: async (input): Promise<CapabilityResult> => {
        const { title, content } = input as { title: string; content: string };
        const id = uuid();
        db.prepare(`INSERT INTO notes (id, title, content) VALUES (?, ?, ?)`).run(id, title, content);
        return { ok: true, summary: `Created note "${title}".`, data: { id } };
      },
    },
    {
      name: "notes_read",
      description: "Read a single note by id.",
      permission: "read",
      inputSchema: z.object({ id: z.string() }),
      execute: async (input): Promise<CapabilityResult> => {
        const { id } = input as { id: string };
        const r = db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as any;
        if (!r) return { ok: false, summary: "Note not found.", error: "not_found" };
        return { ok: true, summary: r.title, data: row(r) };
      },
    },
    {
      name: "notes_search",
      description: "Search notes by title or content.",
      permission: "read",
      inputSchema: z.object({ query: z.string().min(1) }),
      execute: async (input): Promise<CapabilityResult> => {
        const { query } = input as { query: string };
        const rows = db
          .prepare("SELECT * FROM notes WHERE title LIKE ? OR content LIKE ? ORDER BY updatedAt DESC")
          .all(`%${query}%`, `%${query}%`) as any[];
        const items = rows.map(row);
        return { ok: true, summary: `${items.length} note(s) found.`, data: items };
      },
    },
    {
      name: "notes_update",
      description: "Update a note's title and/or content.",
      permission: "write",
      inputSchema: z.object({ id: z.string(), title: z.string().optional(), content: z.string().optional() }),
      execute: async (input): Promise<CapabilityResult> => {
        const { id, title, content } = input as { id: string; title?: string; content?: string };
        const existing = db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as any;
        if (!existing) return { ok: false, summary: "Note not found.", error: "not_found" };
        db.prepare(`UPDATE notes SET title=?, content=?, updatedAt=datetime('now') WHERE id=?`).run(
          title ?? existing.title,
          content ?? existing.content,
          id,
        );
        return { ok: true, summary: "Note updated." };
      },
    },
    {
      name: "notes_delete",
      description: "Delete a note.",
      permission: "write",
      inputSchema: z.object({ id: z.string() }),
      execute: async (input): Promise<CapabilityResult> => {
        const { id } = input as { id: string };
        const res = db.prepare("DELETE FROM notes WHERE id = ?").run(id);
        return { ok: res.changes > 0, summary: res.changes > 0 ? "Note deleted." : "Note not found." };
      },
    },
  ],
};
