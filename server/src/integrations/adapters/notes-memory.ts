import { z } from "zod";
import { ToolError } from "../../tools/executor.js";
import { defineTool, makeModule, perm } from "../core/helpers.js";

const common = { risk: "low" as const, audit: "minimal" as const, timeoutMs: 5000, maxResultBytes: 30_000 };
const trim = (s: string, n = 600) => (s.length > n ? s.slice(0, n) + "…" : s);

export default makeModule({
  manifest: {
    id: "notes-memory", name: "Notes and memory", version: "1.0.0", category: "memory", icon: "brain", defaultInstalled: true,
    description: "Save, search and edit notes, and keep long-term memories you can inspect and edit on the Memory page. The assistant must ask you before saving a memory.",
    capabilities: ["Save and search notes", "Edit and delete notes", "Remember facts and preferences (with your approval)", "Full-text search (SQLite FTS5)"],
    dataAccess: ["Your notes and memories in Vera's database"],
    permissions: [perm("read", "Read notes and memory", "So answers can use what you've saved.", "read", "Notes and memories"), perm("write", "Create and change notes and memory", "So the assistant can save things you ask it to.", "write", "Notes and memories")],
    setup: { intro: "Nothing to set up. Notes and memories live in Vera's local database.", requirements: [] },
    uninstall: { removes: ["Assistant access to notes and memory"], keeps: ["All notes and memories stay in the database and on the Memory page"] },
  },
  tools: [
    defineTool({ ...common, name: "save_note", title: "Save note", description: "Save a note with a title and content.", permission: "write", readOnly: false,
      args: z.object({ title: z.string().trim().min(1).max(120), content: z.string().trim().min(1).max(20_000) }), handler: async (a, c) => c.deps.repos.notes.create(c.userId, a) }),
    defineTool({ ...common, name: "search_notes", title: "Search notes", description: "Search saved notes by keyword (full-text).", permission: "read", readOnly: true,
      args: z.object({ query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(20).default(8) }),
      handler: async (a, c) => ({ notes: c.deps.repos.notes.search(c.userId, a.query, a.limit).map((n) => ({ id: n.id, title: n.title, content: trim(n.content), updatedAt: n.updatedAt })) }) }),
    defineTool({ ...common, name: "update_note", title: "Update note", description: "Change a note's title or content.", permission: "write", readOnly: false,
      args: z.object({ id: z.string().uuid(), title: z.string().trim().min(1).max(120).optional(), content: z.string().trim().min(1).max(20_000).optional() }),
      handler: async (a, c) => { const n = c.deps.repos.notes.update(c.userId, a.id, a); if (!n) throw new ToolError("NOT_FOUND", "Note not found."); return n; } }),
    defineTool({ ...common, name: "delete_note", title: "Delete note", description: "Permanently delete a note. Requires the user's confirmation.", risk: "medium", permission: "write", readOnly: false, confirm: true,
      args: z.object({ id: z.string().uuid() }), summarize: (a) => `Delete note ${a.id}`,
      handler: async (a, c) => { if (!c.deps.repos.notes.delete(c.userId, a.id)) throw new ToolError("NOT_FOUND", "Note not found."); return { deleted: true, id: a.id }; } }),
    defineTool({ ...common, name: "save_memory", title: "Save memory", description: "Propose saving a long-term memory (a fact or preference about the user). The user must approve it first. Never save passwords, financial or health details.", permission: "write", readOnly: false, confirm: true,
      args: z.object({ title: z.string().trim().min(1).max(120), content: z.string().trim().min(1).max(2000), category: z.enum(["fact", "preference", "note"]).default("fact") }),
      summarize: (a) => `Remember (${a.category}): "${a.title}" — ${trim(a.content, 160)}`,
      handler: async (a, c) => c.deps.repos.memories.create(c.userId, { ...a, source: "assistant" }) }),
    defineTool({ ...common, name: "search_memory", title: "Search memory", description: "Search long-term memories (facts and preferences) by keyword.", permission: "read", readOnly: true,
      args: z.object({ query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(20).default(8) }),
      handler: async (a, c) => ({ memories: c.deps.repos.memories.search(c.userId, a.query, a.limit).map((m) => ({ id: m.id, title: m.title, content: trim(m.content), category: m.category })) }) }),
  ],
});
