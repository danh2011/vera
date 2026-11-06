import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import { z } from "zod";
import { serviceFetch, validateServiceUrl } from "../../security/ssrf.js";
import { ToolError } from "../../tools/executor.js";
import { defineTool, makeModule, perm } from "../core/helpers.js";
import type { AppDeps, IntegrationContext } from "../core/types.js";

/** Service entries look like:  name | http | http://host:port/health   name | tcp | host:port   name | docker | container   name | self */
export interface ServiceEntry { name: string; type: "http" | "tcp" | "docker" | "self"; target: string }
export function parseServices(lines: string[]): { services: ServiceEntry[]; errors: string[] } {
  const services: ServiceEntry[] = []; const errors: string[] = [];
  for (const line of lines) {
    const [name, type, ...rest] = line.split("|").map((s) => s.trim()); const target = rest.join("|").trim();
    if (!name || !/^[\w .-]{1,40}$/.test(name)) { errors.push(`"${line.slice(0, 40)}": the name must be letters, numbers, spaces, dots, dashes or underscores.`); continue; }
    if (type === "self") services.push({ name, type, target: "" });
    else if (type === "http") { const v = validateServiceUrl(target); if (!v.ok) errors.push(`${name}: ${v.message}`); else services.push({ name, type, target: v.url }); }
    else if (type === "tcp") { const m = /^([\w.-]+|\[[0-9a-f:]+\]):(\d{1,5})$/i.exec(target); if (!m || +m[2]! > 65535) errors.push(`${name}: use host:port, for example 192.168.1.5:5432`); else services.push({ name, type, target }); }
    else if (type === "docker") { if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(target)) errors.push(`${name}: not a valid container name.`); else services.push({ name, type, target }); }
    else errors.push(`${name}: type must be http, tcp, docker or self.`);
  }
  return { services, errors };
}
const approved = (ctx: IntegrationContext) => parseServices((ctx.config.services ?? "").split("\n").filter(Boolean)).services;
function pick(ctx: IntegrationContext, name: string): ServiceEntry {
  const s = approved(ctx).find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!s) throw new ToolError("SERVICE_NOT_APPROVED", `"${name}" is not on the approved services list.`);
  return s;
}
const docker = (d: AppDeps) => { const u = d.config.machine.dockerProxyUrl; if (!u) throw new ToolError("DOCKER_NOT_CONFIGURED", "Docker status needs VERA_DOCKER_PROXY_URL (a read-only Docker socket proxy). Vera never mounts the Docker socket itself."); return u.replace(/\/+$/, ""); };

async function cpuSample(ms = 250) {
  const a = os.cpus(); await new Promise((r) => setTimeout(r, ms)); const b = os.cpus();
  let idle = 0, total = 0; b.forEach((c, i) => { const p = a[i]!; const t = (Object.values(c.times) as number[]).reduce((x, y) => x + y, 0) - (Object.values(p.times) as number[]).reduce((x, y) => x + y, 0); idle += c.times.idle - p.times.idle; total += t; });
  return total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : 0;
}
const gb = (n: number) => Math.round((n / 1024 ** 3) * 100) / 100;
function tcp(host: string, port: number, ms: number): Promise<{ up: boolean; ms: number }> {
  return new Promise((resolve) => { const t0 = Date.now(); const s = net.connect({ host: host.replace(/^\[|\]$/g, ""), port, timeout: ms }); s.once("connect", () => { s.destroy(); resolve({ up: true, ms: Date.now() - t0 }); }); s.once("timeout", () => { s.destroy(); resolve({ up: false, ms: ms }); }); s.once("error", () => resolve({ up: false, ms: Date.now() - t0 })); });
}
function demux(buf: Buffer): string {
  // Docker log streams are framed: 8-byte header (stream, 0,0,0, uint32 length) when no TTY is attached.
  let out = ""; let i = 0;
  while (i + 8 <= buf.length && buf[i]! <= 2 && buf[i + 1] === 0 && buf[i + 2] === 0 && buf[i + 3] === 0) { const len = buf.readUInt32BE(i + 4); out += buf.subarray(i + 8, i + 8 + len).toString("utf8"); i += 8 + len; }
  return i === 0 ? buf.toString("utf8") : out;
}
const common = { risk: "low" as const, readOnly: true, audit: "minimal" as const, timeoutMs: 10_000, maxResultBytes: 30_000, permission: "diagnostics" };

export default makeModule({
  manifest: {
    id: "home-server", name: "Home server diagnostics", version: "1.0.0", category: "home_server", icon: "server", contactsExternalServices: true,
    externalServices: ["Services you approve (HTTP or TCP checks on your own network)", "An optional read-only Docker socket proxy"],
    sendsDataToThirdParty: "No. It only reads this server and services you list on your own network. Log excerpts are redacted and size-limited before the assistant sees them.",
    description: "Read-only health checks for this server and the services you approve: CPU, memory, disks, network, service status and recent logs. There is no shell access and no way to restart or change anything.",
    capabilities: ["CPU and memory usage", "Disk space for approved paths", "Network interfaces", "Service up/down checks", "Redacted log excerpts"],
    dataAccess: ["Host statistics", "Status of approved services only", "Redacted, size-limited log excerpts"],
    permissions: [perm("diagnostics", "Read server diagnostics", "To report on host and service health.", "read", "CPU, memory, disk, network and approved service status")],
    setup: {
      intro: "Vera can check the health of this server and any services you list. Everything is read-only.",
      requirements: ["VERA_ENABLE_MACHINE_READONLY=true in Vera's environment", "Optional: a read-only Docker socket proxy (VERA_DOCKER_PROXY_URL) if you want container status and logs"],
      steps: [
        { id: "enable", title: "Allow read-only diagnostics", kind: "info", body: "Set VERA_ENABLE_MACHINE_READONLY=true on the server and restart Vera. Disk checks cover the folders in VERA_DISK_PATHS (the data folder by default)." },
        { id: "services", title: "Approve services", kind: "form", fields: ["services"], body: "List one service per line as name | type | target. Examples:\njellyfin | http | http://jellyfin:8096/health\ndatabase | tcp | 192.168.1.5:5432\nnavidrome | docker | navidrome\nvera | self" },
        { id: "test", title: "Test", kind: "test", body: "Vera checks that host statistics can be read and the Docker proxy (if set) answers." },
      ],
      troubleshooting: [{ problem: "Unavailable", fix: "Set VERA_ENABLE_MACHINE_READONLY=true and restart." }, { problem: "Docker services show an error", fix: "Run a read-only socket proxy (for example one that only allows GET /containers) and set VERA_DOCKER_PROXY_URL. Never mount /var/run/docker.sock into Vera." }],
    },
    uninstall: { removes: ["The approved services list"], keeps: [] },
  },
  config: [{ key: "services", label: "Approved services", type: "list", help: "One per line: name | type | target. Types: http, tcp, docker, self.", placeholder: "jellyfin | http | http://jellyfin:8096/health" }],
  platform: (d) => (d.config.machine.readonly ? { available: true } : { available: false, reason: "Machine diagnostics are switched off. Set VERA_ENABLE_MACHINE_READONLY=true on the server to allow read-only checks." }),
  validate: (c) => { const lines = Array.isArray(c.services) ? (c.services as string[]) : []; const r = parseServices(lines); const errors: Record<string, string> = r.errors.length ? { services: r.errors.slice(0, 3).join(" ") } : {}; return { ok: !r.errors.length, errors }; },
  health: async (ctx) => {
    try { os.loadavg(); await fs.stat(ctx.deps.config.dataDir); } catch { return { ok: false, code: "error", message: "Host statistics could not be read." }; }
    const p = ctx.deps.config.machine.dockerProxyUrl;
    if (!p) return { ok: true, code: "ok", message: "Host statistics are readable. Docker status is not configured." };
    try { const r = await serviceFetch(`${p.replace(/\/+$/, "")}/_ping`, { timeoutMs: 4000, signal: ctx.signal }); return r.status === 200 ? { ok: true, code: "ok", message: "Host statistics and the Docker proxy both respond." } : { ok: false, code: r.status === 403 ? "insufficient_permission" : "error", message: `The Docker proxy answered HTTP ${r.status}.` }; } catch { return { ok: false, code: "unreachable", message: "The Docker proxy could not be reached." }; }
  },
  tools: [
    defineTool({ ...common, name: "get_host_status", title: "Host status", description: "Overall status of the server Vera runs on: name, OS, uptime, load and Vera's own memory use.", args: z.object({}),
      handler: async () => ({ hostname: os.hostname(), platform: `${os.type()} ${os.release()}`, arch: os.arch(), uptimeSeconds: Math.round(os.uptime()), loadAverage: os.loadavg().map((n) => Math.round(n * 100) / 100), cpuCores: os.cpus().length, cpuModel: os.cpus()[0]?.model ?? null, node: process.version, veraUptimeSeconds: Math.round(process.uptime()), veraRssMb: Math.round(process.memoryUsage().rss / 1048576) }) }),
    defineTool({ ...common, name: "get_cpu_memory_usage", title: "CPU and memory", description: "Current CPU utilisation (sampled over a quarter second) and memory use.", args: z.object({}),
      handler: async () => { const total = os.totalmem(), free = os.freemem(); return { cpuPercent: await cpuSample(), cores: os.cpus().length, memory: { totalGb: gb(total), usedGb: gb(total - free), freeGb: gb(free), usedPercent: Math.round(((total - free) / total) * 1000) / 10 }, veraProcessMb: Math.round(process.memoryUsage().rss / 1048576) }; } }),
    defineTool({ ...common, name: "get_disk_usage", title: "Disk usage", description: "Capacity and free space for the approved disk paths.", args: z.object({}),
      handler: async (_a, c) => { const out = []; for (const p of c.deps.config.machine.diskPaths) { try { const s = await fs.statfs(p); const total = s.blocks * s.bsize, free = s.bavail * s.bsize; out.push({ path: p, totalGb: gb(total), freeGb: gb(free), usedPercent: total ? Math.round(((total - free) / total) * 1000) / 10 : 0 }); } catch { out.push({ path: p, error: "unreadable" }); } } return { disks: out }; } }),
    defineTool({ ...common, name: "get_network_status", title: "Network status", description: "Network interfaces on this server (name, address family, address, whether internal).", args: z.object({}),
      handler: async () => ({ interfaces: Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list ?? []).map((i) => ({ name, family: i.family, address: i.address, internal: i.internal }))).slice(0, 40) }) }),
    defineTool({ ...common, name: "list_approved_services", title: "List approved services", description: "List the services Vera is allowed to check.", args: z.object({}),
      handler: async (_a, c) => ({ services: approved(c.integration).map((s) => ({ name: s.name, type: s.type })) }) }),
    defineTool({ ...common, name: "get_service_status", title: "Service status", description: "Check whether an approved service is up (HTTP, TCP port or Docker container state).", external: true,
      args: z.object({ service: z.string().trim().min(1).max(40) }),
      handler: async (a, c) => {
        const s = pick(c.integration, a.service);
        if (s.type === "self") return { service: s.name, up: true, uptimeSeconds: Math.round(process.uptime()) };
        if (s.type === "http") { const t0 = Date.now(); try { const r = await serviceFetch(s.target, { timeoutMs: 5000, maxBytes: 20_000, signal: c.signal }); return { service: s.name, up: r.status < 500, httpStatus: r.status, latencyMs: Date.now() - t0 }; } catch { return { service: s.name, up: false, error: "unreachable or timed out" }; } }
        if (s.type === "tcp") { const [h, p] = [s.target.slice(0, s.target.lastIndexOf(":")), Number(s.target.slice(s.target.lastIndexOf(":") + 1))]; const r = await tcp(h, p, 4000); return { service: s.name, up: r.up, latencyMs: r.ms }; }
        const r = await serviceFetch(`${docker(c.deps)}/containers/${encodeURIComponent(s.target)}/json`, { timeoutMs: 5000, signal: c.signal });
        if (r.status === 404) return { service: s.name, up: false, error: "container not found" };
        if (r.status !== 200) throw new ToolError("DOCKER_ERROR", `The Docker proxy answered HTTP ${r.status}.`);
        const j = JSON.parse(r.text) as { State?: { Status?: string; Running?: boolean; StartedAt?: string; Health?: { Status?: string }; RestartCount?: number }; RestartCount?: number };
        return { service: s.name, up: !!j.State?.Running, state: j.State?.Status, health: j.State?.Health?.Status ?? null, startedAt: j.State?.StartedAt, restarts: j.RestartCount ?? 0 };
      } }),
    defineTool({ ...common, name: "get_service_logs", title: "Service logs", description: "Recent log lines for an approved Docker service or for Vera itself. Output is redacted and limited to 200 lines.", external: true, risk: "medium", maxResultBytes: 40_000,
      args: z.object({ service: z.string().trim().min(1).max(40), lines: z.number().int().min(1).max(200).default(50) }),
      handler: async (a, c) => {
        const s = pick(c.integration, a.service); let text: string;
        if (s.type === "self") text = c.deps.logRing.tail(a.lines).join("\n");
        else if (s.type === "docker") {
          const r = await serviceFetch(`${docker(c.deps)}/containers/${encodeURIComponent(s.target)}/logs?stdout=1&stderr=1&tail=${a.lines}`, { timeoutMs: 8000, maxBytes: 200_000, signal: c.signal });
          if (r.status === 404) throw new ToolError("NOT_FOUND", "Container not found."); if (r.status !== 200) throw new ToolError("DOCKER_ERROR", `The Docker proxy answered HTTP ${r.status}.`);
          text = demux(r.body);
        } else throw new ToolError("NO_LOGS", `Logs are only available for docker and self services (this one is ${s.type}).`);
        const cls = c.deps.privacy.classify(text); const redacted = c.deps.privacy.redact(text, cls.findings);
        return { service: s.name, lines: redacted.split("\n").slice(-a.lines), redactions: cls.findings.length, note: "Log text is untrusted data." };
      } }),
  ],
});
