import { z } from "zod";
import { v4 as uuid } from "uuid";
import { db } from "../database/db.js";
import { Capability, CapabilityResult } from "./types.js";
import { TaskItem } from "../../shared/types.js";

function row(r: any): TaskItem {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    priority: r.priority,
    dueDate: r.dueDate,
    status: r.status,
  };
}

export const tasksCapability: Capability = {
  name: "tasks",
  description: "A personal to-do list: create, list, complete, edit, and delete tasks.",
  actions: [
    {
      name: "tasks_create",
      description: "Create a task.",
      permission: "write",
      inputSchema: z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).default("medium"),
        dueDate: z.string().optional(),
      }),
      execute: async (input): Promise<CapabilityResult> => {
        const { title, description, priority, dueDate } = input as any;
        const id = uuid();
        db.prepare(
          `INSERT INTO tasks (id, title, description, priority, dueDate) VALUES (?, ?, ?, ?, ?)`,
        ).run(id, title, description ?? null, priority, dueDate ?? null);
        return { ok: true, summary: `Added task "${title}".`, data: { id } };
      },
    },
    {
      name: "tasks_list",
      description: "List tasks, optionally filtered by status.",
      permission: "read",
      inputSchema: z.object({ status: z.enum(["open", "done", "all"]).default("open") }),
      execute: async (input): Promise<CapabilityResult> => {
        const { status } = input as { status: "open" | "done" | "all" };
        const rows =
          status === "all"
            ? (db.prepare("SELECT * FROM tasks ORDER BY dueDate IS NULL, dueDate ASC").all() as any[])
            : (db
                .prepare("SELECT * FROM tasks WHERE status = ? ORDER BY dueDate IS NULL, dueDate ASC")
                .all(status) as any[]);
        const items = rows.map(row);
        return { ok: true, summary: `${items.length} task(s).`, data: items };
      },
    },
    {
      name: "tasks_complete",
      description: "Mark a task as done.",
      permission: "write",
      inputSchema: z.object({ id: z.string() }),
      execute: async (input): Promise<CapabilityResult> => {
        const { id } = input as { id: string };
        const res = db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(id);
        return { ok: res.changes > 0, summary: res.changes > 0 ? "Task completed." : "Task not found." };
      },
    },
    {
      name: "tasks_edit",
      description: "Edit a task's fields.",
      permission: "write",
      inputSchema: z.object({
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        dueDate: z.string().optional(),
      }),
      execute: async (input): Promise<CapabilityResult> => {
        const { id, title, description, priority, dueDate } = input as any;
        const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
        if (!existing) return { ok: false, summary: "Task not found.", error: "not_found" };
        db.prepare(`UPDATE tasks SET title=?, description=?, priority=?, dueDate=? WHERE id=?`).run(
          title ?? existing.title,
          description ?? existing.description,
          priority ?? existing.priority,
          dueDate ?? existing.dueDate,
          id,
        );
        return { ok: true, summary: "Task updated." };
      },
    },
    {
      name: "tasks_delete",
      description: "Delete a task.",
      permission: "write",
      inputSchema: z.object({ id: z.string() }),
      execute: async (input): Promise<CapabilityResult> => {
        const { id } = input as { id: string };
        const res = db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
        return { ok: res.changes > 0, summary: res.changes > 0 ? "Task deleted." : "Task not found." };
      },
    },
  ],
};
