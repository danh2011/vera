import { Activity, Bell, Brain, Calculator, Calendar, CheckSquare, Film, Folder, Globe, Home, Puzzle, Server, type LucideIcon } from "lucide-react-native";
import type { IntegrationDetail, IntegrationStatus, IntegrationSummary, TestCode } from "../../../../shared/types";

const ICONS: Record<string, LucideIcon> = { calculator: Calculator, "check-square": CheckSquare, brain: Brain, folder: Folder, globe: Globe, server: Server, home: Home, calendar: Calendar, film: Film, bell: Bell, activity: Activity, puzzle: Puzzle };
export const iconFor = (name: string): LucideIcon => ICONS[name] ?? Puzzle;

export type Filter = "all" | "installed" | "enabled" | "needs_setup" | "available" | "errors";
export const FILTERS: { id: Filter; label: string }[] = [{ id: "all", label: "All" }, { id: "installed", label: "Installed" }, { id: "enabled", label: "Enabled" }, { id: "needs_setup", label: "Needs setup" }, { id: "available", label: "Available" }, { id: "errors", label: "Errors" }];

const matches: Record<Filter, (s: IntegrationSummary) => boolean> = {
  all: () => true, installed: (s) => s.installed, enabled: (s) => s.enabled,
  needs_setup: (s) => s.installed && (s.status === "needs_setup" || s.status === "needs_authorisation" || s.status === "needs_dependency"),
  available: (s) => !s.installed && s.status !== "unavailable", errors: (s) => s.status === "error" || s.status === "degraded",
};
export const filterCounts = (list: IntegrationSummary[]) => Object.fromEntries(FILTERS.map((f) => [f.id, list.filter(matches[f.id]).length])) as Record<Filter, number>;

/** Search covers name, description, category and capabilities. Every word typed must match somewhere. */
export function filterIntegrations(list: IntegrationSummary[], o: { q: string; filter: Filter; category: string; categoryLabels?: Record<string, string> }): IntegrationSummary[] {
  const words = o.q.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((s) => {
    if (!matches[o.filter](s)) return false; if (o.category !== "all" && s.category !== o.category) return false;
    const hay = `${s.name} ${s.description} ${s.category} ${o.categoryLabels?.[s.category] ?? ""} ${s.capabilities.join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export const TONE: Record<IntegrationStatus, "ok" | "warn" | "danger" | "muted"> = { available: "muted", installed: "muted", disabled: "muted", unavailable: "muted", ready: "ok", connected: "ok", needs_dependency: "warn", needs_setup: "warn", needs_authorisation: "warn", degraded: "warn", error: "danger" };
export const ACTION_LABEL = { install: "Install", configure: "Set up", connect: "Connect", enable: "Enable", open: "Open", none: "" } as const;
/** Integrations that have a screen of their own in the app. */
export const OPEN_ROUTE: Record<string, string> = { "tasks-reminders": "/tasks", "notes-memory": "/memory", "home-server": "/systems", operations: "/settings" };

export const TEST_COPY: Record<TestCode, { title: string; tone: "ok" | "warn" | "danger"; hint: string }> = {
  ok: { title: "Connection successful", tone: "ok", hint: "" },
  auth_failed: { title: "Authentication failed", tone: "danger", hint: "The service rejected the credential. Re-enter it (or sign in again) and retest." },
  missing_config: { title: "Missing configuration", tone: "warn", hint: "Go back and fill in the missing details." },
  unreachable: { title: "Service unreachable", tone: "danger", hint: "Check the address and port, and that the service is running. From Docker, \"localhost\" means Vera's own container." },
  insufficient_permission: { title: "Permission insufficient", tone: "danger", hint: "The account or key works but isn't allowed to do this. Grant more access in the service, then retest." },
  rate_limited: { title: "Provider rate limit", tone: "warn", hint: "The service is limiting requests. Wait a little and test again." },
  timeout: { title: "Timed out", tone: "warn", hint: "The service didn't answer in time. It may be busy or the address may be wrong." },
  not_supported: { title: "Nothing to test", tone: "warn", hint: "This integration has no connection to check." },
  error: { title: "The check failed", tone: "danger", hint: "Something unexpected went wrong. See the message above." },
};
export const DEP_ACTION: Record<string, string> = { install: "Install", configure: "Set up", connect: "Sign in", test: "Test connection", enable: "Turn on", none: "" };
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "never");

/** After installing, a person must be led into setup whenever the integration can't be used yet. Only self-contained ones just switch on. */
export function needsWizard(d: Pick<IntegrationDetail, "enabled" | "manifest" | "dependencies" | "configured" | "authorised">): boolean {
  if (d.dependencies.some((x) => !x.satisfied)) return true;
  if (d.enabled) return false;
  return !d.configured || !d.authorised || d.manifest.setup.steps.some((s) => s.kind === "form" || s.kind === "oauth");
}
