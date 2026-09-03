import { z } from "zod";
import { v4 as uuid } from "uuid";
import { db } from "../database/db.js";
import { Capability, CapabilityResult } from "./types.js";
import { CalendarEvent } from "../../shared/types.js";

function row(r: any): CalendarEvent {
  return { id: r.id, title: r.title, startsAt: r.startsAt, endsAt: r.endsAt, notes: r.notes };
}

export const calendarCapability: Capability = {
  name: "calendar",
  description: "A simple local calendar: create, update, delete, and list events.",
  actions: [
    {
      name: "calendar_create_event",
      description: "Create a calendar event.",
      permission: "write",
      inputSchema: z.object({
        title: z.string().min(1),
        startsAt: z.string(),
        endsAt: z.string().optional(),
        notes: z.string().optional(),
      }),
      execute: async (input): Promise<CapabilityResult> => {
        const { title, startsAt, endsAt, notes } = input as {
          title: string;
          startsAt: string;
          endsAt?: string;
          notes?: string;
        };
        const id = uuid();
        db.prepare(
          `INSERT INTO calendar_events (id, title, startsAt, endsAt, notes) VALUES (?, ?, ?, ?, ?)`,
        ).run(id, title, startsAt, endsAt ?? null, notes ?? null);
        return { ok: true, summary: `Added "${title}" to your calendar.`, data: { id } };
      },
    },
    {
      name: "calendar_update_event",
      description: "Update an existing calendar event.",
      permission: "write",
      inputSchema: z.object({
        id: z.string(),
        title: z.string().optional(),
        startsAt: z.string().optional(),
        endsAt: z.string().optional(),
        notes: z.string().optional(),
      }),
      execute: async (input): Promise<CapabilityResult> => {
        const { id, title, startsAt, endsAt, notes } = input as any;
        const existing = db.prepare("SELECT * FROM calendar_events WHERE id = ?").get(id) as any;
        if (!existing) return { ok: false, summary: "I couldn't find that event.", error: "not_found" };
        db.prepare(
          `UPDATE calendar_events SET title=?, startsAt=?, endsAt=?, notes=? WHERE id=?`,
        ).run(
          title ?? existing.title,
          startsAt ?? existing.startsAt,
          endsAt ?? existing.endsAt,
          notes ?? existing.notes,
          id,
        );
        return { ok: true, summary: "Event updated." };
      },
    },
    {
      name: "calendar_delete_event",
      description: "Delete a calendar event by id.",
      permission: "write",
      inputSchema: z.object({ id: z.string() }),
      execute: async (input): Promise<CapabilityResult> => {
        const { id } = input as { id: string };
        const res = db.prepare("DELETE FROM calendar_events WHERE id = ?").run(id);
        return { ok: res.changes > 0, summary: res.changes > 0 ? "Event deleted." : "I couldn't find that event." };
      },
    },
    {
      name: "calendar_list_events",
      description: "List calendar events, optionally within a date range.",
      permission: "read",
      inputSchema: z.object({
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
      execute: async (input): Promise<CapabilityResult> => {
        const { from, to, limit } = input as { from?: string; to?: string; limit: number };
        let sql = "SELECT * FROM calendar_events WHERE 1=1";
        const params: unknown[] = [];
        if (from) {
          sql += " AND startsAt >= ?";
          params.push(from);
        }
        if (to) {
          sql += " AND startsAt <= ?";
          params.push(to);
        }
        sql += " ORDER BY startsAt ASC LIMIT ?";
        params.push(limit);
        const rows = db.prepare(sql).all(...params) as any[];
        const items = rows.map(row);
        return {
          ok: true,
          summary: items.length === 0 ? "No events found." : `${items.length} event(s) found.`,
          data: items,
        };
      },
    },
  ],
};
