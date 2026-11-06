import type { ReminderChannel } from "../../../shared/types/index.js";
import type { ReminderRow } from "../database/repos.js";
import type { AppDeps } from "../integrations/core/types.js";
import type { ToolExecutor } from "../tools/executor.js";

const GRACE_MS = 24 * 3600_000; const RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000]; const MAX_TIMER = 6 * 3600_000;

/**
 * Delivers due reminders through the Notifications integration (Home Assistant).
 * No polling loop: one timer is armed for the next future reminder, and integration changes "poke" it.
 * Reminders that come due while Notifications isn't ready simply wait (up to 24 h) and go out once it is.
 */
export class ReminderScheduler {
  private timer: NodeJS.Timeout | null = null; private running = false; private again = false;
  constructor(private deps: AppDeps, private executor: ToolExecutor, private clock: () => number = Date.now) {}

  start() { this.deps.integrations?.onChange(() => this.poke()); this.poke(); }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  poke() { void this.tick(); }

  channelReady(): ReminderChannel {
    const svc = this.deps.integrations!; const s = svc.summary("notifications");
    const ready = s.installed && s.enabled && (s.status === "connected" || s.status === "ready") && s.dependencies.every((d) => d.satisfied);
    const detail = ready ? "Reminders are delivered through Home Assistant." : !s.installed ? "Install Notifications (it uses Home Assistant) so Vera can alert you." : s.status === "needs_dependency" ? (s.statusDetail ?? "Home Assistant needs to be set up first.") : s.status === "needs_setup" ? "Choose where notifications should go." : !s.enabled ? "Notifications is turned off." : s.statusDetail ?? "Notifications isn't working yet.";
    return { ready, status: s.status, statusLabel: s.statusLabel, detail, installed: s.installed, integrationId: "notifications" };
  }

  async tick(): Promise<void> {
    if (this.running) { this.again = true; return; } this.running = true;
    try {
      do {
        this.again = false; const nowMs = this.clock(); const ready = this.channelReady().ready;
        for (const r of this.deps.repos.reminders.due(new Date(nowMs).toISOString())) {
          if (!ready) { if (nowMs - Date.parse(r.remindAt) > GRACE_MS) this.deps.repos.reminders.markMissed(r.id, "It came due while Notifications wasn't set up, and it was too late to send."); continue; }
          if (nowMs - Date.parse(r.remindAt) > GRACE_MS && !r.retryAt) { this.deps.repos.reminders.markMissed(r.id, "It came due more than a day before Notifications was ready."); continue; }
          if (!(await this.deliver(r))) break;
        }
      } while (this.again);
    } finally { this.running = false; this.arm(); }
  }

  /** Returns false when delivery can't continue right now (channel went away). */
  private async deliver(r: ReminderRow): Promise<boolean> {
    const out = await this.executor.execute({ tool: "send_notification", args: { title: "Reminder", message: r.title }, userId: r.userId, requestId: `reminder-${r.id.slice(0, 8)}`, source: "local" });
    const repo = this.deps.repos.reminders;
    if (out.status === "ok") { repo.markSent(r.id, "Accepted by Home Assistant (it can't confirm the phone showed it)"); return true; }
    if (out.status === "blocked") { repo.markFailed(r.id, "Not sent: the text looks like banking, credential or sensitive data."); return true; }
    if (out.status === "error" && /^(NEEDS_|PERMISSION_DENIED|NOT_CONFIGURED|HA_NOT_READY|UNAVAILABLE)/.test(out.code)) return false; // the channel vanished: wait for the next poke
    const message = out.status === "error" ? out.message : "It could not be sent."; const attempts = r.attempts + 1;
    if (attempts >= RETRY_MS.length) repo.markFailed(r.id, `${message} (gave up after ${attempts} tries)`); else repo.retry(r.id, new Date(this.clock() + RETRY_MS[attempts - 1]!).toISOString(), attempts, `${message} Retrying.`);
    return true;
  }

  private arm() {
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    const next = this.deps.repos.reminders.nextFutureAt(new Date(this.clock()).toISOString()); if (!next) return;
    this.timer = setTimeout(() => void this.tick(), Math.max(1000, Math.min(Date.parse(next) - this.clock() + 250, MAX_TIMER))); this.timer.unref();
  }
}
