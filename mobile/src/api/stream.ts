import type { StreamEvent } from "../../../shared/types";

/** Splits a growing NDJSON buffer into complete events. Keeps the incomplete tail for the next chunk. */
export function drainNdjson(buffer: string): { events: StreamEvent[]; rest: string } {
  const events: StreamEvent[] = [];
  let rest = buffer; let i: number;
  while ((i = rest.indexOf("\n")) >= 0) {
    const line = rest.slice(0, i).trim(); rest = rest.slice(i + 1);
    if (!line) continue;
    try { events.push(JSON.parse(line) as StreamEvent); } catch { /* a corrupt line is skipped rather than ending the reply */ }
  }
  return { events, rest };
}
/** Parses whatever is left once the stream has ended (the server's last line may lack a newline). */
export const flushNdjson = (rest: string): StreamEvent[] => drainNdjson(rest.trim() ? rest + "\n" : "").events;
