import { z } from "zod";
import { v4 as uuid } from "uuid";
import { Capability, CapabilityResult } from "./types.js";

interface TimerState {
  id: string;
  label: string;
  startedAt: number;
  durationMs: number | null; // null = stopwatch (counts up), number = timer (counts down)
  cancelled: boolean;
}

const timers = new Map<string, TimerState>();

function describe(t: TimerState) {
  const elapsedMs = Date.now() - t.startedAt;
  if (t.durationMs === null) {
    return { id: t.id, label: t.label, type: "stopwatch", elapsedSeconds: Math.floor(elapsedMs / 1000) };
  }
  const remainingMs = t.durationMs - elapsedMs;
  return {
    id: t.id,
    label: t.label,
    type: "timer",
    remainingSeconds: Math.max(0, Math.floor(remainingMs / 1000)),
    done: remainingMs <= 0,
  };
}

export const timerCapability: Capability = {
  name: "timer",
  description: "Deterministic timers and stopwatches (never uses the AI for timing).",
  actions: [
    {
      name: "timer_start",
      description: "Start a countdown timer for N seconds, or a stopwatch if no duration is given.",
      permission: "write",
      inputSchema: z.object({ label: z.string().default("Timer"), durationSeconds: z.number().int().positive().optional() }),
      execute: async (input): Promise<CapabilityResult> => {
        const { label, durationSeconds } = input as { label: string; durationSeconds?: number };
        const id = uuid();
        timers.set(id, {
          id,
          label,
          startedAt: Date.now(),
          durationMs: durationSeconds ? durationSeconds * 1000 : null,
          cancelled: false,
        });
        return {
          ok: true,
          summary: durationSeconds
            ? `Started a ${durationSeconds}s timer: "${label}".`
            : `Started stopwatch: "${label}".`,
          data: { id },
        };
      },
    },
    {
      name: "timer_status",
      description: "Get the status of a timer/stopwatch, or all of them if no id given.",
      permission: "read",
      inputSchema: z.object({ id: z.string().optional() }),
      execute: async (input): Promise<CapabilityResult> => {
        const { id } = input as { id?: string };
        if (id) {
          const t = timers.get(id);
          if (!t) return { ok: false, summary: "Timer not found.", error: "not_found" };
          return { ok: true, summary: "Status retrieved.", data: describe(t) };
        }
        const all = Array.from(timers.values())
          .filter((t) => !t.cancelled)
          .map(describe);
        return { ok: true, summary: `${all.length} active timer(s)/stopwatch(es).`, data: all };
      },
    },
    {
      name: "timer_cancel",
      description: "Cancel a timer or stopwatch.",
      permission: "write",
      inputSchema: z.object({ id: z.string() }),
      execute: async (input): Promise<CapabilityResult> => {
        const { id } = input as { id: string };
        const t = timers.get(id);
        if (!t) return { ok: false, summary: "Timer not found.", error: "not_found" };
        timers.delete(id);
        return { ok: true, summary: "Cancelled." };
      },
    },
  ],
};
