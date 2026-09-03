import { z } from "zod";
import { v4 as uuid } from "uuid";
import { db } from "../database/db.js";
import { Capability, CapabilityResult } from "./types.js";
import { Reminder } from "../../shared/types.js";

function row(r: any): Reminder {
  return { id: r.id, text: r.text, dueAt: r.dueAt, completed: !!r.completed };
}

/**
 * Lightweight server-side scheduler: polls due reminders once a minute and
 * logs them (V0.1 has no push-notification channel yet; the UI surfaces due
 * reminders via the home summary endpoint instead).
 */
export function startReminderScheduler() {
  setInterval(() => {
    const due = db
      .prepare(`SELECT * FROM reminders WHERE completed = 0 AND dueAt <= datetime('now')`)
      .all() as any[];
    for (const r of due) {
      console.log(`[reminders] due: ${r.text} (${r.dueAt})`);
    }
  }, 60_000);
}

export const remindersCapability: Capability = {
  name: "reminders",
  description: "Create, list, complete, and delete reminders.",
  actions: [
    {
      name: "reminders_create",
      description: "Create a reminder for a specific time.",
      permission: "write",
      inputSchema: z.object({ text: z.string().min(1), dueAt: z.string() }),
      execute: async (input): Promise<CapabilityResult> => {
        const { text, dueAt } = input as { text: string; dueAt: string };
        const id = uuid();
        db.prepare(`INSERT INTO reminders (id, text, dueAt) VALUES (?, ?, ?)`).run(id, text, dueAt);
        return { ok: true, summary: `I'll remind you: "${text}".`, data: { id } };
      },
    },
    {
      name: "reminders_list",
      description: "List reminders, optionally including completed ones.",
      permission: "read",
      inputSchema: z.object({ includeCompleted: z.boolean().default(false) }),
      execute: async (input): Promise<CapabilityResult> => {
        const { includeCompleted } = input as { includeCompleted: boolean };
        const rows = db
          .prepare(
            includeCompleted
              ? "SELECT * FROM reminders ORDER BY dueAt ASC"
              : "SELECT * FROM reminders WHERE completed = 0 ORDER BY dueAt ASC",
          )
          .all() as any[];
        const items = rows.map(row);
        return {
          ok: true,
          summary: items.length === 0 ? "No reminders." : `${items.length} reminder(s).`,
          data: items,
        };
      },
    },
    {
      name: "reminders_complete",
      description: "Mark a reminder as complete.",
      permission: "write",
      inputSchema: z.object({ id: z.string() }),
      execute: async (input): Promise<CapabilityResult> => {
        const { id } = input as { id: string };
        const res = db.prepare("UPDATE reminders SET completed = 1 WHERE id = ?").run(id);
        return { ok: res.changes > 0, summary: res.changes > 0 ? "Done." : "I couldn't find that reminder." };
      },
    },
    {
      name: "reminders_delete",
      description: "Delete a reminder.",
      permission: "write",
      inputSchema: z.object({ id: z.string() }),
      execute: async (input): Promise<CapabilityResult> => {
        const { id } = input as { id: string };
        const res = db.prepare("DELETE FROM reminders WHERE id = ?").run(id);
        return { ok: res.changes > 0, summary: res.changes > 0 ? "Reminder deleted." : "I couldn't find that reminder." };
      },
    },
  ],
};
