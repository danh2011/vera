export const DAY = 864e5;
export type Group = "Today" | "Yesterday" | "Previous 7 days" | "Older";
export const GROUPS: Group[] = ["Today", "Yesterday", "Previous 7 days", "Older"];
export function groupOf(iso: string, now = Date.now()): Group {
  const d = (now - new Date(iso).getTime()) / DAY;
  return d < 1 ? "Today" : d < 2 ? "Yesterday" : d < 7 ? "Previous 7 days" : "Older";
}
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { dateStyle: "medium" });
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.max(1, Math.round(ms))} ms`);
export const isOverdue = (t: { completed: boolean; dueAt?: string }, now = Date.now()) => !t.completed && !!t.dueAt && new Date(t.dueAt).getTime() < now;
