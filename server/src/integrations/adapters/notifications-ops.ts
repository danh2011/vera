import { z } from "zod";
import { SafeFetchError, serviceFetch } from "../../security/ssrf.js";
import { ToolError } from "../../tools/executor.js";
import { defineTool, makeModule, perm } from "../core/helpers.js";
import type { IntegrationContext } from "../core/types.js";

/** Everything goes through the Home Assistant integration's own connection; Notifications keeps no credentials of its own. */
function ha(c: IntegrationContext) { const hc = c.deps.integrations!.context("home-assistant", c.signal); const token = hc.secret("access_token"); if (!hc.config.base_url || !token) throw new ToolError("HA_NOT_READY", "Home Assistant isn't set up."); return { base: hc.config.base_url, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }; }
function haMessage(text: string): string { try { const j = JSON.parse(text) as { message?: string }; if (j.message) return String(j.message).slice(0, 200); } catch { /* plain text */ } return text.slice(0, 200); }

async function listNotifyServices(c: IntegrationContext): Promise<string[]> {
  const { base, headers } = ha(c); const r = await serviceFetch(`${base}/api/services`, { headers, timeoutMs: 8000, signal: c.signal });
  if (r.status === 401) throw new ToolError("AUTH_FAILED", "Home Assistant rejected its access token. Fix it in the Home Assistant integration.");
  if (r.status >= 400) throw new ToolError("HA_ERROR", `Home Assistant answered HTTP ${r.status} when listing services.`);
  const all = JSON.parse(r.text) as { domain: string; services: Record<string, unknown> }[];
  return Object.keys(all.find((d) => d.domain === "notify")?.services ?? {}).filter((n) => n !== "persistent_notification").sort((a, b) => Number(b.startsWith("mobile_app_")) - Number(a.startsWith("mobile_app_")) || a.localeCompare(b));
}

async function sendViaHA(c: IntegrationContext, title: string | undefined, message: string) {
  const service = (c.config.notify_service ?? "").replace(/^notify\./, ""); if (!service) throw new ToolError("NOT_CONFIGURED", "Choose which Home Assistant notify service to use.");
  const { base, headers } = ha(c);
  try {
    const r = await serviceFetch(`${base}/api/services/notify/${encodeURIComponent(service)}`, { method: "POST", headers, body: JSON.stringify({ message, ...(title ? { title } : {}) }), timeoutMs: 10_000, signal: c.signal });
    if (r.status === 401) throw new ToolError("AUTH_FAILED", "Home Assistant rejected its access token.");
    if (r.status === 404) throw new ToolError("NOT_FOUND", `Home Assistant has no notify service called notify.${service}.`);
    if (r.status === 400) { const why = haMessage(r.text); throw new ToolError("HA_REJECTED", `Home Assistant refused the notification: ${why || "bad request"}. ${/not found|unknown|service/i.test(why) || !why ? `Check the service name; for a phone it is usually notify.mobile_app_<device name>. Pick it from the list in Notifications > Reconfigure.` : ""}`.trim()); }
    if (r.status >= 400) throw new ToolError("HA_ERROR", `Home Assistant answered HTTP ${r.status}.`);
  } catch (e) { if (e instanceof SafeFetchError) throw new ToolError(e.code === "TIMEOUT" ? "TIMEOUT" : "UNREACHABLE", e.code === "TIMEOUT" ? "Home Assistant didn't answer in time." : "Home Assistant couldn't be reached."); throw e; }
}

export const notifications = makeModule({
  manifest: {
    id: "notifications", name: "Notifications", version: "2.0.0", category: "notifications", icon: "bell", contactsExternalServices: true, requiresCredentials: false,
    requires: [{ id: "home-assistant", reason: "Notifications are sent through your Home Assistant (for example to the Home Assistant app on your phone), so Home Assistant must be set up and connected first." }],
    externalServices: ["Your Home Assistant server"], sendsDataToThirdParty: "No third party. The text goes to your own Home Assistant, which forwards it to your phone through its own app. Text that looks like banking, credentials or sensitive IDs is blocked first.",
    description: "Send yourself push notifications through Home Assistant. This is also how task reminders reach you. Vera reports that Home Assistant accepted the message; it can't see whether your phone showed it.",
    capabilities: ["Send a notification to your own phone", "Deliver task reminders"], dataAccess: ["The notification text you or the assistant send"],
    permissions: [perm("send", "Send notifications to you", "To notify your own device when you ask, and to deliver reminders you set.", "write", "Notification title and message")],
    actions: [{ id: "send_test", label: "Send a test notification", help: "Sends one short notification now so you can see it arrive on your device." }],
    setup: {
      intro: "Notifications go through Home Assistant, so there is only one thing to connect. Pick which of your Home Assistant notify services should receive them (usually your phone).",
      requirements: ["The Home Assistant integration set up and showing Connected", "The Home Assistant companion app signed in on your phone (it creates a notify.mobile_app_… service)"],
      steps: [
        { id: "settings", title: "Choose where notifications go", kind: "form", fields: ["notify_service"], body: "Pick your phone from the list. The list comes live from your Home Assistant, so the name is always exactly right." },
        { id: "test", title: "Test", kind: "test", body: "Vera checks that Home Assistant has that service. Then send yourself a test notification to see it arrive." },
      ],
      troubleshooting: [{ problem: "My phone isn't in the list", fix: "Open the Home Assistant app on the phone, sign in, and allow notifications. A notify.mobile_app_… service appears after the first sign-in. Press Refresh." }, { problem: "Home Assistant refused the notification (400)", fix: "The service name usually isn't right. Choose it from the list instead of typing it. Names look like notify.mobile_app_dans_phone." }, { problem: "Accepted, but nothing arrived", fix: "Home Assistant accepted it but the phone didn't show it. Check the app's notification permission and that the phone is online." }],
    },
    uninstall: { removes: ["The chosen notify service"], keeps: ["Reminders you created stay stored, but nothing will alert you until Notifications is set up again"] },
  },
  config: [{ key: "notify_service", label: "Send notifications to", type: "select", required: true, dynamicOptions: true, options: [], help: "A Home Assistant notify service, usually notify.mobile_app_<your phone>." }],
  validate: (c) => { const e: Record<string, string> = {}; if (c.notify_service !== undefined && !/^notify\.[a-z0-9_]+$/.test(String(c.notify_service))) e.notify_service = "Choose one from the list (it looks like notify.mobile_app_dans_phone)."; return { ok: !Object.keys(e).length, errors: e }; },
  dynamicOptions: async (c) => (await listNotifyServices(c)).map((n) => ({ value: `notify.${n}`, label: n.startsWith("mobile_app_") ? `${n.replace(/^mobile_app_/, "").replace(/_/g, " ")} (phone app)` : `notify.${n}` })),
  health: async (c) => {
    const dep = c.deps.integrations!.dependencies(c.deps.integrations!.module("notifications")).find((d) => !d.satisfied); if (dep) return { ok: false, code: "missing_config", message: dep.problem };
    const svc = (c.config.notify_service ?? "").replace(/^notify\./, ""); if (!svc) return { ok: false, code: "missing_config", message: "No notify service chosen." };
    try { const names = await listNotifyServices(c); return names.includes(svc) ? { ok: true, code: "ok", message: `Home Assistant has notify.${svc}. No message was sent: use "Send a test notification" to see one arrive.` } : { ok: false, code: "error", message: `Home Assistant has no notify service called notify.${svc}. Available: ${names.slice(0, 8).map((n) => "notify." + n).join(", ") || "none"}.` }; }
    catch (e) { const code = (e as ToolError).code; return { ok: false, code: code === "AUTH_FAILED" ? "auth_failed" : code === "TIMEOUT" ? "timeout" : code === "UNREACHABLE" ? "unreachable" : "error", message: (e as Error).message }; }
  },
  actions: { send_test: async (c) => { try { await sendViaHA(c, "Vera", "This is a test notification from Vera."); return { ok: true, message: "Home Assistant accepted the test notification. If it doesn't appear on your phone in a few seconds, check the Home Assistant app's notification permission." }; } catch (e) { return { ok: false, message: (e as Error).message }; } } },
  tools: [
    defineTool({ name: "send_notification", title: "Send notification", description: "Send a push notification to the user's own phone through Home Assistant. Reports 'accepted' by Home Assistant, not 'delivered'.", risk: "medium", permission: "send", readOnly: false, external: true, audit: "always", timeoutMs: 15_000, maxResultBytes: 2000,
      args: z.object({ title: z.string().trim().max(100).optional(), message: z.string().trim().min(1).max(1000) }),
      handler: async (a, c) => { await sendViaHA(c.integration, a.title, a.message); return { channel: "home_assistant", accepted: true, delivered: "unknown", note: "Home Assistant accepted the request. It does not confirm that the phone displayed it." }; } }),
  ],
});

export const operations = makeModule({
  manifest: {
    id: "operations", name: "Operations", version: "1.0.0", category: "operations", icon: "activity", defaultInstalled: true, required: true,
    description: "Lets the assistant report on the real status of Vera's integrations: what is installed, enabled, configured and connected.",
    capabilities: ["Integration health report"], dataAccess: ["Integration states (never credentials)"],
    permissions: [perm("read", "Read integration status", "To explain what is and isn't working.", "read", "Status only, no secrets")],
    setup: { intro: "Nothing to set up.", requirements: [] }, uninstall: { removes: [], keeps: [] },
  },
  tools: [
    defineTool({ name: "get_integration_health", title: "Integration health", description: "Report the real installation, configuration and connection state of every integration (and the last test time).", risk: "low", permission: "read", readOnly: true, audit: "minimal", timeoutMs: 5000, maxResultBytes: 20_000,
      args: z.object({ integration: z.string().max(60).optional() }),
      handler: async (a, c) => { const all = c.deps.integrations!.healthReport(); const rows = a.integration ? all.filter((x) => x.id === a.integration) : all; if (a.integration && !rows.length) throw new ToolError("NOT_FOUND", "No such integration."); return { integrations: rows, note: "Statuses come from the last real test. 'ready' means configured but not tested." }; } }),
  ],
});
