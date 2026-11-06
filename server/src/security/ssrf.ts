import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export class SafeFetchError extends Error { constructor(public code: "BLOCKED" | "TIMEOUT" | "TOO_LARGE" | "BAD_URL" | "NETWORK" | "TOO_MANY_REDIRECTS", message: string) { super(message); } }

const bl = new net.BlockList();
for (const [a, p] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]] as const) bl.addSubnet(a, p, "ipv4");
for (const [a, p] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32], ["100::", 64], ["64:ff9b::", 96]] as const) bl.addSubnet(a, p, "ipv6");

export function isBlockedAddress(addr: string): boolean {
  const v = net.isIP(addr); if (!v) return true;
  if (v === 6) {
    const m = addr.toLowerCase().match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/); // mapped / NAT64 IPv4
    if (m) return isBlockedAddress(m[1]!);
    const hex = addr.toLowerCase().match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) { const n = (parseInt(hex[1]!, 16) << 16) | parseInt(hex[2]!, 16); return isBlockedAddress([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".")); }
    return bl.check(addr, "ipv6");
  }
  return bl.check(addr, "ipv4");
}

export function assertPublicUrl(raw: string): URL {
  let u: URL; try { u = new URL(raw); } catch { throw new SafeFetchError("BAD_URL", "That is not a valid URL."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new SafeFetchError("BAD_URL", "Only http and https URLs are allowed.");
  if (u.username || u.password) throw new SafeFetchError("BAD_URL", "URLs with embedded credentials are not allowed.");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal") throw new SafeFetchError("BLOCKED", "Local and internal hostnames are blocked.");
  if (net.isIP(host) && isBlockedAddress(host)) throw new SafeFetchError("BLOCKED", "Private and reserved addresses are blocked.");
  if (u.port && !["80", "443", "8080", "8443"].includes(u.port)) throw new SafeFetchError("BLOCKED", "That port is not allowed.");
  return u;
}

/** DNS lookup that refuses private results. The address validated here is the one used to connect (no rebinding window). */
function guardedLookup(hostname: string, options: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = addrs as dns.LookupAddress[];
    if (!list.length || list.some((a) => isBlockedAddress(a.address))) { const e: NodeJS.ErrnoException = new Error("Blocked address"); e.code = "VERA_BLOCKED"; return cb(e); }
    if (options.all) return cb(null, list);
    cb(null, list[0]!.address, list[0]!.family);
  });
}

export interface SafeResponse { status: number; headers: http.IncomingHttpHeaders; body: Buffer; finalUrl: string; truncated: boolean }
export interface SafeFetchOpts { maxBytes?: number; timeoutMs?: number; maxRedirects?: number; headers?: Record<string, string>; signal?: AbortSignal; lookup?: typeof guardedLookup }

/** Fetches a public web page with SSRF protection, redirect re-validation, size and time limits. */
export async function safeFetch(url: string, opts: SafeFetchOpts = {}): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 1_000_000; const timeoutMs = opts.timeoutMs ?? 10_000; const maxRedirects = opts.maxRedirects ?? 3;
  let current = assertPublicUrl(url).toString();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await once(current, maxBytes, timeoutMs, opts);
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
      current = assertPublicUrl(new URL(String(res.headers.location), current).toString()).toString(); continue;
    }
    return { ...res, finalUrl: current };
  }
  throw new SafeFetchError("TOO_MANY_REDIRECTS", "Too many redirects.");
}

function once(url: string, maxBytes: number, timeoutMs: number, opts: SafeFetchOpts): Promise<Omit<SafeResponse, "finalUrl">> {
  return new Promise((resolve, reject) => {
    const u = new URL(url); const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(u, { method: "GET", lookup: (opts.lookup ?? guardedLookup) as never, headers: { "user-agent": "Vera/2 (+self-hosted assistant)", accept: "text/html,text/plain,application/xhtml+xml,application/json;q=0.8,*/*;q=0.1", "accept-encoding": "identity", ...opts.headers }, timeout: timeoutMs, signal: opts.signal }, (res) => {
      const chunks: Buffer[] = []; let size = 0; let truncated = false;
      res.on("data", (c: Buffer) => { if (truncated) return; size += c.length; if (size > maxBytes) { chunks.push(c.subarray(0, c.length - (size - maxBytes))); truncated = true; res.destroy(); } else chunks.push(c); });
      const done = () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated });
      res.on("end", done); res.on("close", done); res.on("error", () => done());
    });
    req.on("timeout", () => { req.destroy(); reject(new SafeFetchError("TIMEOUT", "The request timed out.")); });
    req.on("error", (e: NodeJS.ErrnoException) => reject(e.code === "VERA_BLOCKED" ? new SafeFetchError("BLOCKED", "That address resolves to a private or reserved network and was blocked.") : e.name === "AbortError" ? new SafeFetchError("TIMEOUT", "Cancelled.") : new SafeFetchError("NETWORK", "Could not reach that site.")));
    req.end();
  });
}

/** Validation for integration endpoint URLs the owner configures (LAN services are allowed; metadata endpoints and credentials are not). */
export function validateServiceUrl(raw: string): { ok: true; url: string } | { ok: false; message: string } {
  let u: URL; try { u = new URL(raw); } catch { return { ok: false, message: "Enter a full URL such as http://192.168.1.10:8123" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, message: "The URL must start with http:// or https://" };
  if (u.username || u.password) return { ok: false, message: "Do not put a username or password in the URL." };
  const h = u.hostname.replace(/^\[|\]$/g, "");
  if (h === "169.254.169.254" || h === "metadata.google.internal" || (net.isIP(h) && h.startsWith("169.254."))) return { ok: false, message: "That address is not allowed." };
  return { ok: true, url: u.toString().replace(/\/+$/, "") };
}

/** Fetch wrapper for configured LAN/cloud services: timeout, no redirects, bounded body. */
export async function serviceFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number; maxBytes?: number; signal?: AbortSignal } = {}): Promise<{ status: number; text: string; body: Buffer }> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), init.timeoutMs ?? 8000);
  init.signal?.addEventListener("abort", () => ctl.abort(), { once: true });
  try {
    const res = await fetch(url, { method: init.method ?? "GET", headers: init.headers, body: init.body, redirect: "manual", signal: ctl.signal });
    const max = init.maxBytes ?? 1_000_000; const reader = res.body?.getReader(); const parts: Uint8Array[] = []; let n = 0;
    while (reader) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > max) { await reader.cancel(); throw new SafeFetchError("TOO_LARGE", "The service response was too large."); } parts.push(value); }
    const body = Buffer.concat(parts); return { status: res.status, text: body.toString("utf8"), body };
  } catch (e) {
    if (e instanceof SafeFetchError) throw e;
    if ((e as Error).name === "AbortError") throw new SafeFetchError("TIMEOUT", "The service did not respond in time.");
    throw new SafeFetchError("NETWORK", "The service could not be reached.");
  } finally { clearTimeout(t); }
}
