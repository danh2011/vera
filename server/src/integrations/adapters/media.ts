import crypto from "node:crypto";
import { z } from "zod";
import { SafeFetchError, serviceFetch, validateServiceUrl } from "../../security/ssrf.js";
import { ToolError } from "../../tools/executor.js";
import { defineTool, makeModule, perm } from "../core/helpers.js";
import type { IntegrationContext } from "../core/types.js";
import type { TestCode } from "../../../../shared/types/index.js";

type Svc = "jellyfin" | "radarr" | "sonarr";
const cfg = (c: IntegrationContext, s: Svc) => { const url = c.config[`${s}_url`]; const key = c.secret(`${s}_api_key`); return url && key ? { url, key } : null; };
async function call(c: IntegrationContext, s: Svc, path: string) {
  const x = cfg(c, s); if (!x) throw new ToolError("NOT_CONFIGURED", `${s} is not configured.`);
  try {
    const r = await serviceFetch(`${x.url}${path}`, { headers: s === "jellyfin" ? { "X-Emby-Token": x.key, Accept: "application/json" } : { "X-Api-Key": x.key, Accept: "application/json" }, timeoutMs: 8000, signal: c.signal });
    if (r.status === 401) throw new ToolError("AUTH_FAILED", `${s} rejected the API key.`);
    if (r.status === 403) throw new ToolError("INSUFFICIENT_PERMISSION", `${s} says this key lacks permission.`);
    if (r.status === 429) throw new ToolError("RATE_LIMITED", `${s} is rate limiting requests.`);
    if (r.status >= 400) throw new ToolError("SERVICE_ERROR", `${s} returned HTTP ${r.status}.`);
    return JSON.parse(r.text);
  } catch (e) { if (e instanceof SafeFetchError) throw new ToolError(e.code === "TIMEOUT" ? "TIMEOUT" : "UNREACHABLE", `${s} ${e.code === "TIMEOUT" ? "did not respond in time" : "could not be reached"}.`); throw e; }
}
/** Navidrome speaks the Subsonic API: token auth = md5(password + salt). md5 here is protocol-mandated, not a Vera security choice. */
const hasNav = (c: IntegrationContext) => !!(c.config.navidrome_url && c.config.navidrome_username && c.secret("navidrome_password"));
async function nav(c: IntegrationContext, endpoint: string, params: Record<string, string> = {}) {
  if (!hasNav(c)) throw new ToolError("NOT_CONFIGURED", "Navidrome is not configured.");
  const salt = crypto.randomBytes(8).toString("hex"); const token = crypto.createHash("md5").update(c.secret("navidrome_password")! + salt).digest("hex");
  const qs = new URLSearchParams({ u: c.config.navidrome_username!, t: token, s: salt, v: "1.16.1", c: "vera", f: "json", ...params });
  try {
    const r = await serviceFetch(`${c.config.navidrome_url}/rest/${endpoint}.view?${qs}`, { timeoutMs: 8000, signal: c.signal });
    if (r.status === 429) throw new ToolError("RATE_LIMITED", "Navidrome is rate limiting requests.");
    if (r.status >= 400) throw new ToolError("SERVICE_ERROR", `Navidrome returned HTTP ${r.status}.`);
    const body = (JSON.parse(r.text) as { "subsonic-response"?: { status?: string; error?: { code?: number; message?: string } } & Record<string, unknown> })["subsonic-response"];
    if (!body) throw new ToolError("SERVICE_ERROR", "That address didn't answer like Navidrome. Check the URL.");
    if (body.status !== "ok") { const code = body.error?.code; throw new ToolError(code === 40 || code === 41 ? "AUTH_FAILED" : code === 50 ? "INSUFFICIENT_PERMISSION" : "SERVICE_ERROR", code === 40 || code === 41 ? "Navidrome rejected the username or password." : `Navidrome: ${body.error?.message ?? "request failed"}`); }
    return body;
  } catch (e) { if (e instanceof SafeFetchError) throw new ToolError(e.code === "TIMEOUT" ? "TIMEOUT" : "UNREACHABLE", `Navidrome ${e.code === "TIMEOUT" ? "did not respond in time" : "could not be reached"}.`); if (e instanceof SyntaxError) throw new ToolError("SERVICE_ERROR", "That address didn't answer like Navidrome. Check the URL."); throw e; }
}
const common = { risk: "low" as const, permission: "read", readOnly: true, external: true, audit: "minimal" as const, timeoutMs: 15_000, maxResultBytes: 30_000 };
const codeMap: Record<string, TestCode> = { AUTH_FAILED: "auth_failed", INSUFFICIENT_PERMISSION: "insufficient_permission", RATE_LIMITED: "rate_limited", TIMEOUT: "timeout", UNREACHABLE: "unreachable" };

export default makeModule({
  manifest: {
    id: "media", name: "Media and download services", version: "1.0.0", category: "media", icon: "film", contactsExternalServices: true, requiresCredentials: true, authMode: "token",
    externalServices: ["Your Navidrome, Jellyfin, Radarr and/or Sonarr servers"], sendsDataToThirdParty: "No third party. Vera only talks to the media services you configure.",
    description: "Check your Navidrome or Jellyfin server, search your music and video libraries, and see Radarr/Sonarr download queues. Strictly read-only: Vera cannot delete, download or change anything.",
    capabilities: ["Navidrome server status and library scan", "Jellyfin server status", "Music and video library search", "Radarr and Sonarr queue and health"],
    dataAccess: ["Library titles, artists and years", "Download queue titles and progress", "Server version and health"],
    permissions: [perm("read", "Read media information", "To answer questions about your library and downloads.", "read", "Titles, queue and server status")],
    setup: {
      intro: "Configure at least one service. Each needs its address and an API key.",
      requirements: ["One or more of Navidrome, Jellyfin, Radarr, Sonarr reachable from the Vera server"],
      steps: [
        { id: "keys", title: "Find your API keys", kind: "info", body: "Navidrome: use a normal Navidrome username and password (a dedicated user with no admin rights is best). Vera stores the password encrypted.\nJellyfin: Dashboard > API Keys > + to create one named Vera.\nRadarr/Sonarr: Settings > General > Security > API Key." },
        { id: "settings", title: "Connection details", kind: "form", fields: ["navidrome_url", "navidrome_username", "navidrome_password", "jellyfin_url", "jellyfin_api_key", "radarr_url", "radarr_api_key", "sonarr_url", "sonarr_api_key"], body: "Fill in the services you use and leave the others blank. Addresses look like http://jellyfin:8096 (use container names on a shared Docker network, or the server's LAN address)." },
        { id: "test", title: "Test", kind: "test", body: "Vera contacts each configured service." },
      ],
      troubleshooting: [{ problem: "Unreachable", fix: "From Docker, use the container name on a shared network or the host's LAN IP, not localhost." }, { problem: "Authentication failed", fix: "Re-create the API key and paste it again." }],
    },
    uninstall: { removes: ["Service addresses and API keys"], keeps: [] },
  },
  config: [
    { key: "navidrome_url", label: "Navidrome address", type: "url", placeholder: "http://navidrome:4533" }, { key: "navidrome_username", label: "Navidrome username", type: "string" }, { key: "navidrome_password", label: "Navidrome password", type: "secret", help: "Used only to talk to your Navidrome. Stored encrypted and never shown again." },
    { key: "jellyfin_url", label: "Jellyfin address", type: "url", placeholder: "http://jellyfin:8096" }, { key: "jellyfin_api_key", label: "Jellyfin API key", type: "secret" },
    { key: "radarr_url", label: "Radarr address", type: "url", placeholder: "http://radarr:7878" }, { key: "radarr_api_key", label: "Radarr API key", type: "secret" },
    { key: "sonarr_url", label: "Sonarr address", type: "url", placeholder: "http://sonarr:8989" }, { key: "sonarr_api_key", label: "Sonarr API key", type: "secret" },
  ],
  requireAny: [["navidrome_url", "navidrome_username", "navidrome_password"], ["jellyfin_url", "jellyfin_api_key"], ["radarr_url", "radarr_api_key"], ["sonarr_url", "sonarr_api_key"]],
  validate: (c) => { const e: Record<string, string> = {}; for (const s of ["navidrome", "jellyfin", "radarr", "sonarr"]) { const u = c[`${s}_url`]; if (u && !validateServiceUrl(String(u)).ok) e[`${s}_url`] = "Enter a full URL such as http://host:port"; } return { ok: !Object.keys(e).length, errors: e }; },
  health: async (c) => {
    const found = (["jellyfin", "radarr", "sonarr"] as Svc[]).filter((s) => cfg(c, s)); const navOn = hasNav(c); if (!found.length && !navOn) return { ok: false, code: "missing_config", message: "No service has all its connection details yet." };
    const details: Record<string, string> = {}; let failure: { code: TestCode; message: string } | null = null;
    const note = (name: string, e: unknown) => { const code = (e as ToolError).code; details[name] = code; failure ??= { code: codeMap[code] ?? "error", message: `${name}: ${(e as Error).message}` }; };
    if (navOn) { try { await nav(c, "ping"); details.navidrome = "ok"; } catch (e) { note("navidrome", e); } }
    for (const s of found) { try { await call(c, s, s === "jellyfin" ? "/System/Info" : "/api/v3/system/status"); details[s] = "ok"; } catch (e) { note(s, e); } }
    return failure ? { ok: false, ...(failure as { code: TestCode; message: string }), details } : { ok: true, code: "ok", message: `Connected to ${[...(navOn ? ["navidrome"] : []), ...found].join(", ")}.`, details };
  },
  tools: [
    defineTool({ ...common, name: "get_media_server_status", title: "Media server status", description: "Status of your music/video servers: Navidrome (version, library scan) and/or Jellyfin (version, active sessions). Omit `server` to check every configured one.",
      args: z.object({ server: z.enum(["navidrome", "jellyfin"]).optional() }),
      handler: async (a, c) => {
        const want = a.server ? [a.server] : (["navidrome", "jellyfin"] as const).filter((x) => (x === "navidrome" ? hasNav(c.integration) : !!cfg(c.integration, "jellyfin"))); const out: Record<string, unknown> = {};
        if (!want.length) throw new ToolError("NOT_CONFIGURED", "Neither Navidrome nor Jellyfin is configured.");
        for (const w of want) {
          if (w === "navidrome") { const p = await nav(c.integration, "ping"); const sc = await nav(c.integration, "getScanStatus").catch(() => null) as { scanStatus?: { scanning?: boolean; count?: number; lastScan?: string } } | null; out.navidrome = { up: true, serverType: p.type ?? "navidrome", apiVersion: p.version, serverVersion: p.serverVersion ?? null, libraryScanning: sc?.scanStatus?.scanning ?? null, itemsInLibrary: sc?.scanStatus?.count ?? null, lastScan: sc?.scanStatus?.lastScan ?? null }; }
          else { if (!cfg(c.integration, "jellyfin")) throw new ToolError("NOT_CONFIGURED", "Jellyfin is not configured."); const i = await call(c.integration, "jellyfin", "/System/Info"); const s = await call(c.integration, "jellyfin", "/Sessions"); out.jellyfin = { up: true, serverName: i.ServerName, version: i.Version, operatingSystem: i.OperatingSystem ?? null, activeSessions: Array.isArray(s) ? s.filter((x: { NowPlayingItem?: unknown }) => x.NowPlayingItem).length : 0, pendingRestart: !!i.HasPendingRestart }; }
        }
        return out;
      } }),
    defineTool({ ...common, name: "search_media_library", title: "Search media library", description: "Search Navidrome (artists, albums, songs) and/or Jellyfin (movies, series, episodes) by title. Omit `server` to search every configured one.",
      args: z.object({ query: z.string().trim().min(1).max(100), server: z.enum(["navidrome", "jellyfin"]).optional(), type: z.enum(["Movie", "Series", "Episode", "Audio", "MusicAlbum"]).optional(), limit: z.number().int().min(1).max(25).default(10) }),
      handler: async (a, c) => {
        const want = a.server ? [a.server] : (["navidrome", "jellyfin"] as const).filter((x) => (x === "navidrome" ? hasNav(c.integration) : !!cfg(c.integration, "jellyfin"))); const results: { source: string; title: string; type: string; year?: number | null; artist?: string | null }[] = [];
        if (!want.length) throw new ToolError("NOT_CONFIGURED", "Neither Navidrome nor Jellyfin is configured.");
        for (const w of want) {
          if (w === "navidrome") { const r = await nav(c.integration, "search3", { query: a.query, artistCount: String(Math.ceil(a.limit / 3)), albumCount: String(Math.ceil(a.limit / 3)), songCount: String(a.limit) }) as { searchResult3?: { artist?: { name: string }[]; album?: { name: string; artist?: string; year?: number }[]; song?: { title: string; artist?: string; year?: number }[] } }; const x = r.searchResult3 ?? {}; for (const i of x.artist ?? []) results.push({ source: "navidrome", title: i.name, type: "Artist" }); for (const i of x.album ?? []) results.push({ source: "navidrome", title: i.name, type: "Album", artist: i.artist ?? null, year: i.year ?? null }); for (const i of x.song ?? []) results.push({ source: "navidrome", title: i.title, type: "Song", artist: i.artist ?? null, year: i.year ?? null }); }
          else { const j = await call(c.integration, "jellyfin", `/Items?${new URLSearchParams({ searchTerm: a.query, Recursive: "true", Limit: String(a.limit), ...(a.type ? { IncludeItemTypes: a.type } : {}), Fields: "ProductionYear" })}`); for (const i of (j.Items ?? []) as { Name: string; Type: string; ProductionYear?: number; SeriesName?: string }[]) results.push({ source: "jellyfin", title: i.Name, type: i.Type, year: i.ProductionYear ?? null, artist: i.SeriesName ?? null }); }
        }
        return { results: results.slice(0, a.limit * 2) };
      } }),
    defineTool({ ...common, name: "get_download_service_status", title: "Download service status", description: "Radarr and/or Sonarr version, health warnings and current download queue.", needsConfig: [],
      args: z.object({ service: z.enum(["radarr", "sonarr", "both"]).default("both") }),
      handler: async (a, c) => {
        const names = (a.service === "both" ? ["radarr", "sonarr"] : [a.service]) as Svc[]; const out: Record<string, unknown> = {};
        for (const s of names) {
          if (!cfg(c.integration, s)) { out[s] = { configured: false }; continue; }
          const [st, health, q] = await Promise.all([call(c.integration, s, "/api/v3/system/status"), call(c.integration, s, "/api/v3/health"), call(c.integration, s, "/api/v3/queue?pageSize=15")]);
          out[s] = { configured: true, version: st.version, health: (health as { type: string; message: string }[]).slice(0, 10).map((h) => ({ level: h.type, message: String(h.message).slice(0, 200) })), queueTotal: q.totalRecords ?? 0, queue: (q.records ?? []).slice(0, 15).map((r: { title?: string; status?: string; sizeleft?: number; size?: number; timeleft?: string }) => ({ title: String(r.title ?? "").slice(0, 120), status: r.status, percent: r.size ? Math.round((1 - (r.sizeleft ?? 0) / r.size) * 100) : null, timeLeft: r.timeleft ?? null })) };
        }
        return out;
      } }),
  ],
});
