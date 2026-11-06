import { z } from "zod";
import { SafeFetchError, serviceFetch, validateServiceUrl } from "../../security/ssrf.js";
import { ToolError } from "../../tools/executor.js";
import { defineTool, makeModule, perm } from "../core/helpers.js";
import type { IntegrationContext } from "../core/types.js";
import type { TestCode } from "../../../../shared/types/index.js";

export function globToRegex(g: string): RegExp { return new RegExp("^" + g.trim().toLowerCase().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"); }
export const entityAllowed = (list: string[], id: string) => list.some((g) => globToRegex(g).test(id.toLowerCase()));
const allowList = (ctx: IntegrationContext) => (ctx.config.allowed_entities ?? "").split("\n").map((s) => s.trim()).filter(Boolean);

export function statusToCode(status: number): { code: TestCode; message: string } | null {
  if (status === 401) return { code: "auth_failed", message: "Home Assistant rejected the access token. Create a new long-lived token and paste it again." };
  if (status === 403) return { code: "insufficient_permission", message: "Home Assistant refused the request: the token's user lacks permission." };
  if (status === 429) return { code: "rate_limited", message: "Home Assistant is rate limiting requests." };
  return null;
}
async function ha(ctx: IntegrationContext, path: string, init: { method?: string; body?: unknown } = {}) {
  const base = ctx.config.base_url; const token = ctx.secret("access_token");
  if (!base || !token) throw new ToolError("NOT_CONFIGURED", "Home Assistant is not configured.");
  try {
    const r = await serviceFetch(`${base}${path}`, { method: init.method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: init.body ? JSON.stringify(init.body) : undefined, timeoutMs: 8000, signal: ctx.signal });
    const mapped = statusToCode(r.status); if (mapped) throw new ToolError(mapped.code.toUpperCase(), mapped.message);
    if (r.status === 404) throw new ToolError("NOT_FOUND", "Home Assistant doesn't know that entity or service.");
    if (r.status === 400) { let why = ""; try { why = String((JSON.parse(r.text) as { message?: string }).message ?? "").slice(0, 160); } catch { why = r.text.slice(0, 160); } throw new ToolError("HA_REJECTED", `Home Assistant rejected the request${why ? `: ${why}` : ""}.`); }
    if (r.status >= 400) throw new ToolError("HA_ERROR", `Home Assistant returned HTTP ${r.status}.`);
    return r.text ? JSON.parse(r.text) : null;
  } catch (e) { if (e instanceof SafeFetchError) throw new ToolError(e.code === "TIMEOUT" ? "TIMEOUT" : "UNREACHABLE", e.code === "TIMEOUT" ? "Home Assistant did not respond in time." : "Home Assistant could not be reached."); throw e; }
}
interface State { entity_id: string; state: string; attributes: Record<string, unknown>; last_changed?: string }
const view = (s: State) => ({ entity_id: s.entity_id, state: s.state, name: s.attributes.friendly_name ?? null, unit: s.attributes.unit_of_measurement ?? null, lastChanged: s.last_changed ?? null, attributes: Object.fromEntries(["brightness", "temperature", "current_temperature", "hvac_mode", "device_class", "battery_level"].filter((k) => k in s.attributes).map((k) => [k, s.attributes[k]])) });

/** Whitelisted services per domain; anything else is refused even if the model asks. */
const SERVICES: Record<string, string[]> = {
  light: ["turn_on", "turn_off", "toggle"], switch: ["turn_on", "turn_off", "toggle"], fan: ["turn_on", "turn_off", "toggle", "set_percentage"], input_boolean: ["turn_on", "turn_off", "toggle"],
  cover: ["open_cover", "close_cover", "stop_cover", "set_cover_position"], lock: ["lock", "unlock"], climate: ["set_temperature", "set_hvac_mode", "turn_on", "turn_off"],
  media_player: ["media_play", "media_pause", "media_stop", "volume_set", "turn_on", "turn_off"], alarm_control_panel: ["alarm_arm_home", "alarm_arm_away", "alarm_disarm"], scene: ["turn_on"],
};
const SENSITIVE_DOMAINS = new Set(["lock", "alarm_control_panel", "cover"]);
const DATA_KEYS = new Set(["brightness_pct", "brightness", "color_temp_kelvin", "temperature", "hvac_mode", "volume_level", "percentage", "position", "transition"]);

export default makeModule({
  manifest: {
    id: "home-assistant", name: "Home Assistant", version: "1.0.0", category: "home_automation", icon: "home", contactsExternalServices: true, requiresCredentials: true, authMode: "token",
    externalServices: ["Your Home Assistant server (usually on your own network)"], sendsDataToThirdParty: "No third party. Vera talks only to your Home Assistant. Entities outside your allow-list are never read or controlled.",
    description: "Read the state of your smart-home devices and control the ones you allow. Locks, alarms and covers always ask for your confirmation.",
    capabilities: ["List allowed entities", "Read device state", "Control lights, switches, climate, media and more", "Activate scenes"],
    dataAccess: ["State and attributes of entities on your allow-list"],
    permissions: [perm("read", "Read device state", "To tell you what is on, off or at what temperature.", "read", "State of allow-listed entities"), perm("control", "Control devices", "To switch devices and activate scenes when you ask. Off by default: turn it on when you're ready.", "control", "Allow-listed entities", false)],
    setup: {
      intro: "Vera connects to Home Assistant with a long-lived access token. The token lets Vera act as a Home Assistant user, so create it from a dedicated, limited user if you can.",
      requirements: ["Home Assistant reachable from the Vera server", "A long-lived access token"],
      steps: [
        { id: "token", title: "Create an access token", kind: "info", body: "In Home Assistant, click your profile (bottom-left), open the Security tab, scroll to Long-lived access tokens, press Create token, name it \"Vera\" and copy it. It is shown only once." },
        { id: "settings", title: "Connection details", kind: "form", fields: ["base_url", "access_token", "allowed_entities"], body: "The URL is how this server reaches Home Assistant, e.g. http://homeassistant.local:8123 or http://192.168.1.20:8123. The allow-list limits what Vera can see or control; * matches anything (light.* means every light)." },
        { id: "test", title: "Test the connection", kind: "test", body: "Vera asks Home Assistant's API whether it is running and accepts the token." },
      ],
      troubleshooting: [{ problem: "Service unreachable", fix: "Check the URL and port. From Docker, localhost means the Vera container; use the server's LAN address or the container name on a shared network." }, { problem: "Authentication failed", fix: "The token was mistyped or revoked. Create a new long-lived token." }, { problem: "Controls are refused", fix: "Turn on the \"Control devices\" permission in Manage, and add the entity to the allow-list." }],
    },
    uninstall: { removes: ["Home Assistant URL, token and allow-list"], keeps: [] },
  },
  config: [
    { key: "base_url", label: "Home Assistant URL", type: "url", required: true, placeholder: "http://homeassistant.local:8123", help: "The address of Home Assistant as seen from the Vera server." },
    { key: "access_token", label: "Long-lived access token", type: "secret", required: true, help: "Profile > Security > Long-lived access tokens. Stored encrypted and never shown again." },
    { key: "allowed_entities", label: "Allowed entities", type: "list", required: true, placeholder: "light.*\nscene.*\nsensor.living_room_temperature", help: "One per line. Vera can only see and control entities matching these (use * as a wildcard)." },
  ],
  validate: (c) => { const e: Record<string, string> = {}; if (c.allowed_entities !== undefined && Array.isArray(c.allowed_entities)) for (const g of c.allowed_entities as string[]) if (!/^[a-z0-9_*.]+$/i.test(g) || !g.includes(".")) { e.allowed_entities = `"${g.slice(0, 40)}" isn't a valid entity pattern (example: light.kitchen or light.*).`; break; } return { ok: !Object.keys(e).length, errors: e }; },
  health: async (ctx) => {
    const base = ctx.config.base_url; if (!base || !ctx.secret("access_token")) return { ok: false, code: "missing_config", message: "URL or token is missing." };
    const v = validateServiceUrl(base); if (!v.ok) return { ok: false, code: "missing_config", message: v.message };
    try {
      const r = await serviceFetch(`${base}/api/`, { headers: { Authorization: `Bearer ${ctx.secret("access_token")}` }, timeoutMs: 6000, signal: ctx.signal });
      const m = statusToCode(r.status); if (m) return { ok: false, ...m };
      if (r.status === 200) return { ok: true, code: "ok", message: "Connected. Home Assistant accepted the token." };
      return { ok: false, code: "error", message: `Unexpected response (HTTP ${r.status}). Is this the Home Assistant address?` };
    } catch (e) { const t = e instanceof SafeFetchError && e.code === "TIMEOUT"; return { ok: false, code: t ? "timeout" : "unreachable", message: t ? "Home Assistant did not respond within 6 seconds." : "Could not reach Home Assistant at that address." }; }
  },
  tools: [
    defineTool({ name: "list_home_assistant_entities", title: "List entities", description: "List allow-listed Home Assistant entities, optionally for one domain (light, switch, sensor, scene…).", risk: "low", permission: "read", readOnly: true, external: true, audit: "minimal", timeoutMs: 10_000, maxResultBytes: 40_000,
      args: z.object({ domain: z.string().regex(/^[a-z_]+$/).max(40).optional(), limit: z.number().int().min(1).max(100).default(50) }),
      handler: async (a, c) => { const list = allowList(c.integration); const all = (await ha(c.integration, "/api/states")) as State[]; const out = all.filter((s) => entityAllowed(list, s.entity_id) && (!a.domain || s.entity_id.startsWith(a.domain + "."))); return { total: out.length, entities: out.slice(0, a.limit).map((s) => ({ entity_id: s.entity_id, name: s.attributes.friendly_name ?? null, state: s.state })) }; } }),
    defineTool({ name: "get_home_assistant_state", title: "Get entity state", description: "Get the current state of one allow-listed entity.", risk: "low", permission: "read", readOnly: true, external: true, audit: "minimal", timeoutMs: 10_000, maxResultBytes: 8000,
      args: z.object({ entity_id: z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/) }),
      handler: async (a, c) => { if (!entityAllowed(allowList(c.integration), a.entity_id)) throw new ToolError("ENTITY_NOT_ALLOWED", "That entity is not on the allow-list."); return view((await ha(c.integration, `/api/states/${a.entity_id}`)) as State); } }),
    defineTool({ name: "control_home_assistant_entity", title: "Control entity", description: "Control an allow-listed entity (turn on/off, set brightness or temperature, open/close, lock/unlock). Locks, alarms and covers need the user's confirmation.", risk: "high", permission: "control", readOnly: false, external: true, audit: "always", timeoutMs: 12_000, maxResultBytes: 4000,
      args: z.object({ entity_id: z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/), service: z.string().regex(/^[a-z_]+$/).max(40), data: z.record(z.string(), z.union([z.number(), z.string().max(40)])).default({}) }),
      confirm: (a) => SENSITIVE_DOMAINS.has(a.entity_id.split(".")[0]!),
      summarize: (a) => `${a.service.replace(/_/g, " ")} → ${a.entity_id}${Object.keys(a.data).length ? " " + JSON.stringify(a.data) : ""}`,
      handler: async (a, c) => {
        const domain = a.entity_id.split(".")[0]!; if (!entityAllowed(allowList(c.integration), a.entity_id)) throw new ToolError("ENTITY_NOT_ALLOWED", "That entity is not on the allow-list.");
        if (!SERVICES[domain]?.includes(a.service)) throw new ToolError("SERVICE_NOT_ALLOWED", `"${a.service}" isn't an allowed action for ${domain}.`);
        for (const k of Object.keys(a.data)) if (!DATA_KEYS.has(k)) throw new ToolError("DATA_NOT_ALLOWED", `The option "${k}" isn't allowed.`);
        await ha(c.integration, `/api/services/${domain}/${a.service}`, { method: "POST", body: { entity_id: a.entity_id, ...a.data } });
        return { accepted: true, entity_id: a.entity_id, service: a.service, note: "Home Assistant accepted the command. Check the state to confirm the device responded." };
      } }),
    defineTool({ name: "activate_home_assistant_scene", title: "Activate scene", description: "Activate an allow-listed Home Assistant scene.", risk: "medium", permission: "control", readOnly: false, external: true, audit: "always", timeoutMs: 12_000, maxResultBytes: 2000,
      args: z.object({ scene_id: z.string().regex(/^scene\.[a-z0-9_]+$/) }), summarize: (a) => `Activate scene ${a.scene_id}`,
      handler: async (a, c) => { if (!entityAllowed(allowList(c.integration), a.scene_id)) throw new ToolError("ENTITY_NOT_ALLOWED", "That scene is not on the allow-list."); await ha(c.integration, "/api/services/scene/turn_on", { method: "POST", body: { entity_id: a.scene_id } }); return { accepted: true, scene_id: a.scene_id }; } }),
  ],
});
