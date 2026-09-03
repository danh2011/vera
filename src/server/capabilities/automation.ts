import { z } from "zod";
import { v4 as uuid } from "uuid";
import cron, { ScheduledTask } from "node-cron";
import { db } from "../database/db.js";
import { Capability, CapabilityResult } from "./types.js";
import { AutomationItem } from "../../shared/types.js";
import { runChatTurn } from "../ai/chatEngine.js";

function row(r: any): AutomationItem {
  return { id: r.id, name: r.name, cron: r.cron, prompt: r.prompt, enabled: !!r.enabled };
}

const scheduledTasks = new Map<string, ScheduledTask>();

async function runAutomation(automation: AutomationItem) {
  console.log(`[automation] running "${automation.name}"`);
  try {
    await runChatTurn({ conversationId: null, userText: automation.prompt, isAutomation: true });
    db.prepare("UPDATE automations SET lastRunAt = datetime('now') WHERE id = ?").run(automation.id);
  } catch (err) {
    console.error(`[automation] "${automation.name}" failed:`, err);
  }
}

function scheduleOne(automation: AutomationItem) {
  const existing = scheduledTasks.get(automation.id);
  if (existing) existing.stop();
  if (!automation.enabled) return;
  if (!cron.validate(automation.cron)) {
    console.warn(`[automation] invalid cron for "${automation.name}": ${automation.cron}`);
    return;
  }
  const task = cron.schedule(automation.cron, () => runAutomation(automation));
  scheduledTasks.set(automation.id, task);
}

export function loadAutomationsOnStartup() {
  const rows = db.prepare("SELECT * FROM automations WHERE enabled = 1").all() as any[];
  for (const r of rows) scheduleOne(row(r));
  console.log(`[automation] scheduled ${rows.length} automation(s)`);
}

export const automationCapability: Capability = {
  name: "automation",
  description: "Basic scheduled automations: run a prompt through Vera on a cron schedule.",
  actions: [
    {
      name: "automation_create",
      description: "Create a scheduled automation using a cron expression, e.g. '0 18 * * 0' for Sunday 18:00.",
      permission: "write",
      inputSchema: z.object({ name: z.string().min(1), cron: z.string().min(1), prompt: z.string().min(1) }),
      execute: async (input): Promise<CapabilityResult> => {
        const { name, cron: cronExpr, prompt } = input as { name: string; cron: string; prompt: string };
        if (!cron.validate(cronExpr)) {
          return { ok: false, summary: `"${cronExpr}" isn't a valid cron expression.`, error: "bad_cron" };
        }
        const id = uuid();
        db.prepare(`INSERT INTO automations (id, name, cron, prompt, enabled) VALUES (?, ?, ?, ?, 1)`).run(
          id,
          name,
          cronExpr,
          prompt,
        );
        scheduleOne({ id, name, cron: cronExpr, prompt, enabled: true });
        return { ok: true, summary: `Scheduled "${name}".`, data: { id } };
      },
    },
    {
      name: "automation_list",
      description: "List all automations.",
      permission: "read",
      inputSchema: z.object({}),
      execute: async (): Promise<CapabilityResult> => {
        const rows = db.prepare("SELECT * FROM automations ORDER BY name").all() as any[];
        const items = rows.map(row);
        return { ok: true, summary: `${items.length} automation(s).`, data: items };
      },
    },
    {
      name: "automation_toggle",
      description: "Enable or disable an automation.",
      permission: "write",
      inputSchema: z.object({ id: z.string(), enabled: z.boolean() }),
      execute: async (input): Promise<CapabilityResult> => {
        const { id, enabled } = input as { id: string; enabled: boolean };
        const existing = db.prepare("SELECT * FROM automations WHERE id = ?").get(id) as any;
        if (!existing) return { ok: false, summary: "Automation not found.", error: "not_found" };
        db.prepare("UPDATE automations SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
        scheduleOne({ ...row(existing), enabled });
        return { ok: true, summary: enabled ? "Enabled." : "Disabled." };
      },
    },
    {
      name: "automation_delete",
      description: "Delete an automation.",
      permission: "write",
      inputSchema: z.object({ id: z.string() }),
      execute: async (input): Promise<CapabilityResult> => {
        const { id } = input as { id: string };
        const task = scheduledTasks.get(id);
        if (task) {
          task.stop();
          scheduledTasks.delete(id);
        }
        const res = db.prepare("DELETE FROM automations WHERE id = ?").run(id);
        return { ok: res.changes > 0, summary: res.changes > 0 ? "Automation deleted." : "Automation not found." };
      },
    },
  ],
};
