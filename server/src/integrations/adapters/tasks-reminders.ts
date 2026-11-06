import { z } from "zod";
import { ToolError } from "../../tools/executor.js";
import { defineTool, makeModule, perm } from "../core/helpers.js";

const iso = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/)).transform((s) => new Date(s).toISOString());
const priority = z.enum(["low", "medium", "high"]);
const common = { risk: "low" as const, audit: "minimal" as const, timeoutMs: 5000, maxResultBytes: 30_000 };

export default makeModule({
  manifest: {
    id: "tasks-reminders", name: "Tasks and reminders", version: "1.0.0", category: "productivity", icon: "check-square", defaultInstalled: true,
    description: "Create and manage tasks and set reminders. Reminders reach you as a push notification through Home Assistant once the Notifications integration is set up; until then they are only stored.",
    capabilities: ["Create tasks", "List and update tasks", "Complete tasks", "Delete tasks (with confirmation)", "Reminders delivered through Notifications"],
    dataAccess: ["Your tasks and reminders in Vera's database"],
    permissions: [perm("read", "Read tasks and reminders", "So the assistant can answer what's on your list.", "read", "Task titles, due dates, reminders"), perm("write", "Create and change tasks", "So the assistant can add and update tasks you ask for.", "write", "Task titles, due dates, reminders")],
    setup: { intro: "Nothing to set up. Tasks live in Vera's local database.", requirements: [] },
    uninstall: { removes: ["Assistant access to tasks"], keeps: ["All tasks and reminders you created stay in the database and on the Tasks page"] },
  },
  tools: [
    defineTool({ ...common, name: "create_task", title: "Create task", description: "Create a task with an optional due date and priority.", permission: "write", readOnly: false,
      args: z.object({ title: z.string().trim().min(1).max(120), description: z.string().max(2000).optional(), due_at: iso.optional(), priority: priority.optional() }),
      handler: async (a, c) => c.deps.repos.tasks.create(c.userId, { title: a.title, description: a.description, dueAt: a.due_at, priority: a.priority }) }),
    defineTool({ ...common, name: "list_tasks", title: "List tasks", description: "List tasks, optionally only open or completed ones.", permission: "read", readOnly: true,
      args: z.object({ status: z.enum(["open", "completed", "all"]).default("open"), limit: z.number().int().min(1).max(100).default(30) }),
      handler: async (a, c) => ({ tasks: c.deps.repos.tasks.list(c.userId, { completed: a.status === "all" ? undefined : a.status === "completed", limit: a.limit }) }) }),
    defineTool({ ...common, name: "update_task", title: "Update task", description: "Change a task's title, description, due date or priority.", permission: "write", readOnly: false,
      args: z.object({ id: z.string().uuid(), title: z.string().trim().min(1).max(120).optional(), description: z.string().max(2000).nullable().optional(), due_at: iso.nullable().optional(), priority: priority.optional() }),
      handler: async (a, c) => { const t = c.deps.repos.tasks.update(c.userId, a.id, { title: a.title, description: a.description, dueAt: a.due_at, priority: a.priority }); if (!t) throw new ToolError("NOT_FOUND", "Task not found."); return t; } }),
    defineTool({ ...common, name: "complete_task", title: "Complete task", description: "Mark a task as completed (or reopen it with completed=false).", permission: "write", readOnly: false,
      args: z.object({ id: z.string().uuid(), completed: z.boolean().default(true) }),
      handler: async (a, c) => { const t = c.deps.repos.tasks.update(c.userId, a.id, { completed: a.completed }); if (!t) throw new ToolError("NOT_FOUND", "Task not found."); return t; } }),
    defineTool({ ...common, name: "delete_task", title: "Delete task", description: "Permanently delete a task. Requires the user's confirmation.", risk: "medium", permission: "write", readOnly: false, confirm: true,
      args: z.object({ id: z.string().uuid() }),
      summarize: (a) => `Delete task ${a.id}`,
      handler: async (a, c) => { if (!c.deps.repos.tasks.delete(c.userId, a.id)) throw new ToolError("NOT_FOUND", "Task not found."); return { deleted: true, id: a.id }; } }),
    defineTool({ ...common, name: "create_reminder", title: "Create reminder", description: "Set a reminder for a date and time. It is delivered as a push notification if Notifications is set up; otherwise it is only stored and the tool result says so.", permission: "write", readOnly: false,
      args: z.object({ title: z.string().trim().min(1).max(200), remind_at: iso, task_id: z.string().uuid().optional() }),
      handler: async (a, c) => {
        if (Date.parse(a.remind_at) < Date.now() - 60_000) throw new ToolError("IN_THE_PAST", "That time has already passed.");
        const r = c.deps.repos.reminders.create(c.userId, { title: a.title, remindAt: a.remind_at, taskId: a.task_id }); c.deps.reminders?.poke(); const ch = c.deps.reminders?.channelReady();
        return { id: r.id, title: r.title, remindAt: r.remindAt, status: r.status, delivery: ch?.ready ? "will be sent through Home Assistant" : "stored only", note: ch?.ready ? "Scheduled. Vera will send a notification through Home Assistant at that time." : `Stored, but Vera can't alert you yet. ${ch?.detail ?? "Notifications isn't set up."} Set up Notifications in Integrations.` };
      } }),
    defineTool({ ...common, name: "list_reminders", title: "List reminders", description: "List upcoming reminders and what happened to recent ones (sent, failed, missed).", permission: "read", readOnly: true,
      args: z.object({ limit: z.number().int().min(1).max(100).default(30) }), handler: async (a, c) => ({ reminders: c.deps.repos.reminders.list(c.userId, a.limit).map((r) => ({ id: r.id, title: r.title, remindAt: r.remindAt, status: r.status, delivery: r.deliveryDetail ?? r.delivery })), channel: c.deps.reminders?.channelReady().detail ?? null }) }),
  ],
});
