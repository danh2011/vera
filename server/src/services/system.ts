import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import type { AppDeps } from "../integrations/core/types.js";
import type { ToolExecutor } from "../tools/executor.js";

type State = "ok" | "warn" | "down";
export interface SystemCard { id: string; title: string; state: State; summary: string; lastCheck: string; metrics: { label: string; value: string }[]; services?: { name: string; state: State; detail: string }[] }
export interface SystemsOverview { isSample: false; notice?: string; cards: SystemCard[] }
const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
export const VERSION = "2.0.0";

async function cpu(ms = 250) {
  const a = os.cpus(); await new Promise((r) => setTimeout(r, ms)); const b = os.cpus(); let idle = 0, tot = 0;
  b.forEach((c, i) => { const p = a[i]!; tot += (Object.values(c.times) as number[]).reduce((x, y) => x + y, 0) - (Object.values(p.times) as number[]).reduce((x, y) => x + y, 0); idle += c.times.idle - p.times.idle; });
  return tot > 0 ? Math.round((1 - idle / tot) * 100) : 0;
}

export async function systemsOverview(deps: AppDeps, executor: ToolExecutor, userId: string, requestId: string, aiReady: boolean): Promise<SystemsOverview> {
  const now = new Date().toISOString(); const cards: SystemCard[] = []; let notice: string | undefined;
  if (deps.config.machine.readonly) {
    const c = await cpu(); const total = os.totalmem(), free = os.freemem(); const memPct = Math.round(((total - free) / total) * 100);
    cards.push({ id: "host", title: "Server", state: c > 90 || memPct > 92 ? "warn" : "ok", summary: `${os.hostname()} · up ${Math.floor(os.uptime() / 3600)} h`, lastCheck: now, metrics: [{ label: "CPU", value: `${c}%` }, { label: "Memory", value: `${gb(total - free)} of ${gb(total)} (${memPct}%)` }, { label: "Load (1/5/15 min)", value: os.loadavg().map((n) => n.toFixed(2)).join(" / ") }, { label: "Cores", value: String(os.cpus().length) }] });
    const disks = []; let worst: State = "ok";
    for (const p of deps.config.machine.diskPaths) { try { const s = await fsp.statfs(p); const t = s.blocks * s.bsize, f = s.bavail * s.bsize; const pct = t ? Math.round(((t - f) / t) * 100) : 0; if (pct > 95) worst = "down"; else if (pct > 85 && worst === "ok") worst = "warn"; disks.push({ label: p, value: `${gb(f)} free of ${gb(t)} (${pct}% used)` }); } catch { disks.push({ label: p, value: "unreadable" }); worst = worst === "ok" ? "warn" : worst; } }
    cards.push({ id: "storage", title: "Storage", state: worst, summary: `${disks.length} approved path${disks.length === 1 ? "" : "s"}`, lastCheck: now, metrics: disks });
    const nets = Object.entries(os.networkInterfaces()).flatMap(([n, l]) => (l ?? []).filter((i) => !i.internal && i.family === "IPv4").map((i) => ({ label: n, value: i.address })));
    cards.push({ id: "network", title: "Network", state: nets.length ? "ok" : "warn", summary: nets.length ? `${nets.length} active interface${nets.length === 1 ? "" : "s"}` : "No external interface found", lastCheck: now, metrics: nets });
    const home = deps.integrations!.summary("home-server");
    if (home.enabled && home.configured) {
      const list = await executor.execute({ tool: "list_approved_services", args: {}, userId, requestId, source: "user" });
      if (list.status === "ok") {
        const names = (list.result as { services: { name: string }[] }).services.map((s) => s.name); const out: NonNullable<SystemCard["services"]> = [];
        await Promise.all(names.slice(0, 20).map(async (name) => { const r = await executor.execute({ tool: "get_service_status", args: { service: name }, userId, requestId, source: "user" }); if (r.status === "ok") { const v = r.result as { up: boolean; httpStatus?: number; state?: string; latencyMs?: number }; out.push({ name, state: v.up ? "ok" : "down", detail: v.up ? (v.state ?? (v.httpStatus ? `HTTP ${v.httpStatus}` : "up")) + (v.latencyMs ? ` · ${v.latencyMs} ms` : "") : "not responding" }); } else out.push({ name, state: "warn", detail: r.status === "error" ? r.message : "check failed" }); }));
        out.sort((a, b) => a.name.localeCompare(b.name));
        cards.push({ id: "services", title: "Approved services", state: out.some((s) => s.state === "down") ? "down" : out.some((s) => s.state === "warn") ? "warn" : "ok", summary: out.length ? `${out.filter((s) => s.state === "ok").length} of ${out.length} up` : "No services approved yet", lastCheck: now, metrics: [], services: out });
      }
    }
  } else notice = "Server diagnostics are switched off. Set VERA_ENABLE_MACHINE_READONLY=true on the server to see CPU, memory, disk and network here.";
  let dbSize = "unknown"; try { dbSize = `${(fs.statSync(deps.config.databasePath).size / 1048576).toFixed(1)} MB`; } catch { /* in-memory or unreadable */ }
  const cat = deps.integrations!.catalogue();
  cards.push({ id: "vera", title: "Vera", state: "ok", summary: `Version ${VERSION} · up ${Math.floor(process.uptime() / 60)} min`, lastCheck: now, metrics: [{ label: "Process memory", value: `${Math.round(process.memoryUsage().rss / 1048576)} MB` }, { label: "Database", value: dbSize }, { label: "Full-text search", value: deps.fts ? "FTS5" : "fallback (LIKE)" }, { label: "AI provider", value: aiReady ? "Gemini ready" : "not active" }, { label: "Integrations", value: `${cat.counts.enabled} on · ${cat.counts.needsAttention} need attention` }] });
  return { isSample: false, ...(notice ? { notice } : {}), cards };
}
