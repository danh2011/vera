import crypto from "node:crypto";
import { z } from "zod";
import { SafeFetchError, serviceFetch } from "../../security/ssrf.js";
import { ToolError } from "../../tools/executor.js";
import { defineTool, makeModule, perm } from "../core/helpers.js";
import type { IntegrationContext } from "../core/types.js";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth"; const TOKEN = "https://oauth2.googleapis.com/token";
const CAL = "https://www.googleapis.com/calendar/v3"; const GMAIL = "https://gmail.googleapis.com/gmail/v1";
export const SCOPES = { calendar: "https://www.googleapis.com/auth/calendar.events", mailRead: "https://www.googleapis.com/auth/gmail.readonly", mailCompose: "https://www.googleapis.com/auth/gmail.compose" };

const clientId = (c: IntegrationContext) => c.config.client_id || null;
const clientSecret = (c: IntegrationContext) => c.secret("client_secret") || null;
const wantsMail = (c: IntegrationContext) => (c.config.access ?? "calendar_only") === "calendar_and_email";
const cache = new Map<string, { token: string; exp: number }>();

async function accessToken(c: IntegrationContext): Promise<string> {
  const hit = cache.get(c.id); if (hit && hit.exp > Date.now() + 30_000) return hit.token;
  const refresh = c.secret("oauth_refresh_token"); const id = clientId(c), sec = clientSecret(c);
  if (!refresh) throw new ToolError("NEEDS_AUTHORISATION", "Connect your Google account first.");
  if (!id || !sec) throw new ToolError("NOT_CONFIGURED", "Google client ID or secret is missing.");
  const r = await serviceFetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: id, client_secret: sec, refresh_token: refresh, grant_type: "refresh_token" }).toString(), timeoutMs: 8000, signal: c.signal });
  if (r.status === 400 || r.status === 401) throw new ToolError("AUTH_FAILED", "Google no longer accepts the saved sign-in. Reconnect your account.");
  if (r.status !== 200) throw new ToolError("GOOGLE_ERROR", `Google returned HTTP ${r.status}.`);
  const j = JSON.parse(r.text) as { access_token: string; expires_in: number }; cache.set(c.id, { token: j.access_token, exp: Date.now() + j.expires_in * 1000 }); return j.access_token;
}
async function g(c: IntegrationContext, url: string, init: { method?: string; body?: unknown } = {}) {
  try {
    const t = await accessToken(c);
    const r = await serviceFetch(url, { method: init.method, headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: init.body ? JSON.stringify(init.body) : undefined, timeoutMs: 10_000, signal: c.signal });
    if (r.status === 401) { cache.delete(c.id); throw new ToolError("AUTH_FAILED", "Google rejected the access. Reconnect your account."); }
    if (r.status === 403) throw new ToolError("INSUFFICIENT_PERMISSION", "Google says this account hasn't granted that permission (or the API isn't enabled in your Google Cloud project).");
    if (r.status === 429) throw new ToolError("RATE_LIMITED", "Google rate limit reached. Try again later.");
    if (r.status === 404) throw new ToolError("NOT_FOUND", "Google couldn't find that item.");
    if (r.status >= 400) throw new ToolError("GOOGLE_ERROR", `Google returned HTTP ${r.status}.`);
    return r.text ? JSON.parse(r.text) : null;
  } catch (e) { if (e instanceof SafeFetchError) throw new ToolError(e.code === "TIMEOUT" ? "TIMEOUT" : "UNREACHABLE", "Google could not be reached."); throw e; }
}
const needMail = (c: IntegrationContext) => { if (!wantsMail(c)) throw new ToolError("EMAIL_NOT_ENABLED", "Email access was not chosen during setup. Reconfigure and choose \"Calendar and email\"."); };
const cal = (c: IntegrationContext) => encodeURIComponent(c.config.calendar_id || "primary");
const FIN_MAIL = /\b(bank|statement|transaction|iban|sort code|account (number|balance)|card ending|payment (received|confirmation)|direct debit|overdraft|credit score|mortgage|loan)\b/i;
const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Use an ISO date/time such as 2026-11-05T15:30:00+00:00");
const hdr = z.string().max(300).refine((s) => !/[\r\n]/.test(s), "Line breaks are not allowed here.");
const eventView = (e: Record<string, any>) => ({ id: e.id, title: e.summary ?? "(no title)", start: e.start?.dateTime ?? e.start?.date, end: e.end?.dateTime ?? e.end?.date, location: e.location ?? null, description: e.description ? String(e.description).slice(0, 500) : null, attendeeCount: Array.isArray(e.attendees) ? e.attendees.length : 0, link: e.htmlLink ?? null }); // eslint-disable-line @typescript-eslint/no-explicit-any
const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");

export default makeModule({
  manifest: {
    id: "calendar-email", name: "Google Calendar and Gmail", version: "1.0.0", category: "calendar_email", icon: "calendar", contactsExternalServices: true, requiresCredentials: true, authMode: "oauth",
    externalServices: ["Google Calendar API", "Gmail API (optional)"],
    sendsDataToThirdParty: "Vera talks to Google using your own sign-in. Event and email text returned to the assistant is screened first: anything that looks financial, credential-like or sensitive is withheld from the cloud AI.",
    description: "See and add Google Calendar events, and optionally search Gmail and create email drafts. Vera never sends email: drafts are left in your Drafts folder for you to review.",
    capabilities: ["List calendar events", "Create and update events (with confirmation)", "Search email (optional)", "Create email drafts (with confirmation, never sends)"],
    dataAccess: ["Events on the chosen calendar", "Email headers and snippets when email access is chosen (messages that look financial are withheld)"],
    permissions: [perm("calendar_read", "Read calendar events", "To tell you what's coming up.", "read", "Event titles, times, locations"), perm("calendar_write", "Create and change events", "To add or move events you ask for (always confirmed first).", "write", "Calendar events", false), perm("mail_read", "Search email", "To find messages you ask about.", "read", "Sender, subject, date, snippet", false), perm("mail_draft", "Create drafts", "To prepare email drafts for you. Vera can't send.", "write", "Your Drafts folder", false)],
    setup: {
      intro: "Vera uses Google's official sign-in (OAuth). Because Vera is self-hosted, you create your own small Google \"app\" once so your data never passes through anyone else's server.",
      requirements: ["A Google account", "A Google Cloud project with the Calendar API (and Gmail API if you want email) enabled", "An OAuth client of type \"Web application\" whose redirect URI is shown in step 2"],
      steps: [
        { id: "google", title: "Create your Google app", kind: "info", body: "1. Open console.cloud.google.com and create (or pick) a project.\n2. APIs & Services > Library: enable Google Calendar API (and Gmail API for email).\n3. APIs & Services > OAuth consent screen: choose External, add yourself as a test user.\n4. Credentials > Create credentials > OAuth client ID > Web application. Under Authorised redirect URIs add the address shown in the next step.\n5. Copy the Client ID and Client secret." },
        { id: "settings", title: "App details", kind: "form", fields: ["client_id", "client_secret", "access", "calendar_id"], body: "Paste the client details. Choose \"Calendar only\" unless you want email search and drafts too: it asks Google for less access." },
        { id: "authorise", title: "Sign in with Google", kind: "oauth", body: "You'll be sent to Google to approve access, then returned here." },
        { id: "test", title: "Test the connection", kind: "test", body: "Vera makes a real request to Google to confirm access." },
      ],
      troubleshooting: [{ problem: "Google shows redirect_uri_mismatch", fix: "The redirect URI in your Google client must exactly match the one shown in setup, including http/https." }, { problem: "\"Access blocked\" or app not verified", fix: "Add your Google account as a test user on the OAuth consent screen. For personal use you can stay in Testing mode (tokens may expire after 7 days; reconnect when asked)." }, { problem: "Permission insufficient", fix: "Enable the Calendar/Gmail API in your project and reconnect so Google asks for the permissions again." }],
    },
    uninstall: { removes: ["Saved Google sign-in and client secret (also revoke access at myaccount.google.com/permissions)"], keeps: ["Anything in your Google account is untouched"] },
  },
  config: [
    { key: "client_id", label: "Google client ID", type: "string", required: true, help: "From your Google Cloud OAuth client (Credentials > OAuth client ID)." },
    { key: "client_secret", label: "Google client secret", type: "secret", required: true, help: "Stored encrypted and never shown again." },
    { key: "access", label: "What may Vera access?", type: "select", required: true, default: "calendar_only", options: [{ value: "calendar_only", label: "Calendar only" }, { value: "calendar_and_email", label: "Calendar and email (search + drafts)" }] },
    { key: "calendar_id", label: "Calendar", type: "string", default: "primary", placeholder: "primary", help: "Leave as primary for your main calendar." },
  ],
  validate: (c) => { const e: Record<string, string> = {}; if (c.access && !["calendar_only", "calendar_and_email"].includes(String(c.access))) e.access = "Choose an option."; return { ok: !Object.keys(e).length, errors: e }; },
  oauth: {
    scopes: (c) => [SCOPES.calendar, ...(wantsMail(c) ? [SCOPES.mailRead, SCOPES.mailCompose] : [])],
    buildAuthUrl: (c, p) => { const id = clientId(c); if (!id) throw new ToolError("NOT_CONFIGURED", "Add your Google client ID first."); return `${AUTH}?${new URLSearchParams({ client_id: id, redirect_uri: p.redirectUri, response_type: "code", scope: [SCOPES.calendar, ...(wantsMail(c) ? [SCOPES.mailRead, SCOPES.mailCompose] : [])].join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "false", state: p.state, code_challenge: p.challenge, code_challenge_method: "S256" })}`; },
    exchange: async (c, p) => {
      const id = clientId(c), sec = clientSecret(c); if (!id || !sec) throw new ToolError("NOT_CONFIGURED", "Client ID or secret missing.");
      const r = await serviceFetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: p.code, client_id: id, client_secret: sec, redirect_uri: p.redirectUri, grant_type: "authorization_code", code_verifier: p.verifier }).toString(), timeoutMs: 8000 });
      if (r.status !== 200) throw new ToolError("AUTH_FAILED", "Google did not accept the sign-in code.");
      const j = JSON.parse(r.text) as { refresh_token?: string; access_token: string; expires_in: number };
      if (!j.refresh_token) throw new ToolError("NO_REFRESH_TOKEN", "Google didn't return a long-lived sign-in. Remove Vera at myaccount.google.com/permissions and try again.");
      c.setSecret("oauth_refresh_token", j.refresh_token); cache.set(c.id, { token: j.access_token, exp: Date.now() + j.expires_in * 1000 });
    },
  },
  health: async (c) => {
    if (!clientId(c) || !clientSecret(c)) return { ok: false, code: "missing_config", message: "Google client ID or secret is missing." };
    if (!c.secret("oauth_refresh_token")) return { ok: false, code: "auth_failed", message: "Not signed in to Google yet." };
    try { await g(c, `${CAL}/calendars/${cal(c)}`); return { ok: true, code: "ok", message: "Connected. Google Calendar answered." }; }
    catch (e) { const code = (e as ToolError).code; const map: Record<string, "auth_failed" | "insufficient_permission" | "rate_limited" | "timeout" | "unreachable" | "error"> = { AUTH_FAILED: "auth_failed", NEEDS_AUTHORISATION: "auth_failed", INSUFFICIENT_PERMISSION: "insufficient_permission", RATE_LIMITED: "rate_limited", TIMEOUT: "timeout", UNREACHABLE: "unreachable" }; return { ok: false, code: map[code] ?? "error", message: (e as Error).message }; }
  },
  tools: [
    defineTool({ name: "list_calendar_events", title: "List calendar events", description: "List upcoming calendar events between two ISO times (defaults to the next 7 days).", risk: "low", permission: "calendar_read", readOnly: true, external: true, audit: "minimal", timeoutMs: 15_000, maxResultBytes: 30_000,
      args: z.object({ from: iso.optional(), to: iso.optional(), limit: z.number().int().min(1).max(50).default(15) }),
      handler: async (a, c) => { const from = a.from ? new Date(a.from) : new Date(); const to = a.to ? new Date(a.to) : new Date(from.getTime() + 7 * 864e5); const j = await g(c.integration, `${CAL}/calendars/${cal(c.integration)}/events?${new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: String(a.limit) })}`); return { events: (j.items ?? []).map(eventView) }; } }),
    defineTool({ name: "create_calendar_event", title: "Create calendar event", description: "Create a calendar event. The user must confirm before it is created.", risk: "medium", permission: "calendar_write", readOnly: false, external: true, confirm: true, audit: "always", timeoutMs: 15_000, maxResultBytes: 4000,
      args: z.object({ title: z.string().trim().min(1).max(200), start: iso, end: iso, location: z.string().max(200).optional(), description: z.string().max(2000).optional(), timezone: z.string().max(64).optional() }),
      summarize: (a) => `Create event "${a.title}" from ${a.start} to ${a.end}${a.location ? ` at ${a.location}` : ""}`,
      handler: async (a, c) => { if (Date.parse(a.end) <= Date.parse(a.start)) throw new ToolError("BAD_TIMES", "The event must end after it starts."); const e = await g(c.integration, `${CAL}/calendars/${cal(c.integration)}/events`, { method: "POST", body: { summary: a.title, location: a.location, description: a.description, start: { dateTime: new Date(a.start).toISOString(), ...(a.timezone ? { timeZone: a.timezone } : {}) }, end: { dateTime: new Date(a.end).toISOString(), ...(a.timezone ? { timeZone: a.timezone } : {}) } } }); return eventView(e); } }),
    defineTool({ name: "update_calendar_event", title: "Update calendar event", description: "Change the title, time, location or description of an existing event. The user must confirm first.", risk: "medium", permission: "calendar_write", readOnly: false, external: true, confirm: true, audit: "always", timeoutMs: 15_000, maxResultBytes: 4000,
      args: z.object({ event_id: z.string().regex(/^[A-Za-z0-9_-]{5,1024}$/), title: z.string().trim().min(1).max(200).optional(), start: iso.optional(), end: iso.optional(), location: z.string().max(200).optional(), description: z.string().max(2000).optional() }),
      summarize: (a) => `Update event ${a.event_id}: ${[a.title && `title "${a.title}"`, a.start && `start ${a.start}`, a.end && `end ${a.end}`, a.location && `location ${a.location}`].filter(Boolean).join(", ") || "no changes"}`,
      handler: async (a, c) => { const body: Record<string, unknown> = {}; if (a.title) body.summary = a.title; if (a.location !== undefined) body.location = a.location; if (a.description !== undefined) body.description = a.description; if (a.start) body.start = { dateTime: new Date(a.start).toISOString() }; if (a.end) body.end = { dateTime: new Date(a.end).toISOString() }; if (!Object.keys(body).length) throw new ToolError("NO_CHANGES", "Nothing to change."); return eventView(await g(c.integration, `${CAL}/calendars/${cal(c.integration)}/events/${a.event_id}`, { method: "PATCH", body })); } }),
    defineTool({ name: "search_emails", title: "Search email", description: "Search Gmail with Gmail search syntax and return sender, subject, date and a short snippet. Messages that look financial are withheld.", risk: "medium", permission: "mail_read", readOnly: true, external: true, audit: "always", timeoutMs: 20_000, maxResultBytes: 30_000,
      args: z.object({ query: z.string().trim().min(1).max(300), limit: z.number().int().min(1).max(10).default(5) }),
      handler: async (a, c) => {
        needMail(c.integration); const list = await g(c.integration, `${GMAIL}/users/me/messages?${new URLSearchParams({ q: a.query, maxResults: String(a.limit) })}`); const out = []; let withheld = 0;
        for (const m of (list?.messages ?? []).slice(0, a.limit) as { id: string }[]) {
          const d = await g(c.integration, `${GMAIL}/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
          const h = Object.fromEntries((d.payload?.headers ?? []).map((x: { name: string; value: string }) => [x.name.toLowerCase(), x.value])) as Record<string, string>;
          const text = `${h.from ?? ""} ${h.subject ?? ""} ${d.snippet ?? ""}`;
          if (FIN_MAIL.test(text) || ["FINANCIAL", "CREDENTIAL"].includes(c.deps.privacy.classify(text).cls)) { withheld++; out.push({ id: m.id, withheld: true, reason: "Looks financial or credential-related; not shown to the assistant." }); continue; }
          out.push({ id: m.id, from: h.from, subject: h.subject, date: h.date, snippet: String(d.snippet ?? "").slice(0, 200) });
        }
        return { untrustedEmailContent: true, messages: out, withheld };
      } }),
    defineTool({ name: "create_email_draft", title: "Create email draft", description: "Create a draft email in the user's Drafts folder. Vera NEVER sends email. The user must confirm before the draft is created.", risk: "medium", permission: "mail_draft", readOnly: false, external: true, confirm: true, audit: "always", timeoutMs: 15_000, maxResultBytes: 2000,
      args: z.object({ to: z.array(z.string().email().max(200).refine((s) => !/[\r\n]/.test(s))).min(1).max(10), cc: z.array(z.string().email().max(200)).max(10).optional(), subject: hdr, body: z.string().max(20_000) }),
      summarize: (a) => `Create a draft to ${a.to.join(", ")} with subject "${a.subject}" (it will NOT be sent)`,
      handler: async (a, c) => {
        needMail(c.integration);
        const raw = [`To: ${a.to.join(", ")}`, ...(a.cc?.length ? [`Cc: ${a.cc.join(", ")}`] : []), `Subject: =?UTF-8?B?${Buffer.from(a.subject).toString("base64")}?=`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: 8bit", "", a.body].join("\r\n");
        const d = await g(c.integration, `${GMAIL}/users/me/drafts`, { method: "POST", body: { message: { raw: b64u(raw) } } });
        return { draftId: d.id, sent: false, note: "Draft saved in Gmail. Vera did not send it; review and send it yourself." };
      } }),
  ],
});
export const pkce = () => { const verifier = crypto.randomBytes(48).toString("base64url"); return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") }; };
