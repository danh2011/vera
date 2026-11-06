import dns from "node:dns";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { BUILTIN_MODULES } from "../server/src/integrations/adapters/index.js";
import { calc, convert, parseDate, zonedToUtc } from "../server/src/integrations/adapters/core-utils.js";
import { defineTool, makeModule } from "../server/src/integrations/core/helpers.js";
import { assertPublicUrl, isBlockedAddress, safeFetch, SafeFetchError } from "../server/src/security/ssrf.js";
import { argsHash, ToolError } from "../server/src/tools/executor.js";
import { signedIn, tmp, type Ctx } from "./helpers.js";

const run = (c: Ctx, tool: string, args: unknown, extra: Partial<Parameters<Ctx["executor"]["execute"]>[0]> = {}) => c.executor.execute({ tool, args, userId: c.userId, requestId: "t", source: "user", ...extra });
const installEnable = (c: Ctx, id: string) => { c.integrations.install(id, c.userId); if (!c.integrations.summary(id).enabled) c.integrations.enable(id, c.userId); };
afterEach(() => vi.restoreAllMocks());

describe("deterministic core tools", () => {
  it("calculates safely and rejects code", () => {
    expect(calc("2+3*4")).toBe(14); expect(calc("(2+3)*4")).toBe(20); expect(calc("2^10")).toBe(1024); expect(calc("sqrt(16)+abs(-3)")).toBe(7); expect(calc("50%")).toBe(0.5); expect(calc("-3^2")).toBe(-9); expect(calc("10 % 4")).toBe(2);
    for (const bad of ["process.exit()", "require('fs')", "constructor", "1/0", "2+", "(((", "alert(1)", "1;2", "`x`"]) expect(() => calc(bad), bad).toThrow(ToolError);
    expect(() => calc("(".repeat(200) + "1" + ")".repeat(200))).toThrow();
  });
  it("converts units and temperatures", () => { expect(convert(1, "km", "m").value).toBe(1000); expect(convert(100, "c", "f").value).toBeCloseTo(212); expect(convert(1, "mi", "km").value).toBeCloseTo(1.609344); expect(() => convert(1, "kg", "m")).toThrow(/Cannot convert/); expect(() => convert(1, "parsec", "m")).toThrow(/don't know/); });
  it("handles time zones including DST", () => {
    expect(new Date(zonedToUtc(2026, 7, 1, 12, 0, 0, "Europe/London")).toISOString()).toBe("2026-07-01T11:00:00.000Z"); expect(new Date(zonedToUtc(2026, 1, 1, 12, 0, 0, "Europe/London")).toISOString()).toBe("2026-01-01T12:00:00.000Z"); expect(new Date(zonedToUtc(2026, 11, 5, 9, 0, 0, "America/New_York")).toISOString()).toBe("2026-11-05T14:00:00.000Z");
  });
  it("parses natural dates relative to a reference", () => {
    const ref = Date.parse("2026-10-27T10:00:00Z"); // a Tuesday
    const iso = (t: string) => { const r = parseDate(t, "UTC", ref); return r && new Date(r.ts).toISOString(); };
    expect(iso("tomorrow 3pm")).toBe("2026-10-28T15:00:00.000Z"); expect(iso("next friday")).toBe("2026-10-30T00:00:00.000Z"); expect(iso("in 3 days")).toBe("2026-10-30T00:00:00.000Z"); expect(iso("5 Nov 2026 14:30")).toBe("2026-11-05T14:30:00.000Z"); expect(iso("05/11/2026")).toBe("2026-11-05T00:00:00.000Z"); expect(iso("2026-12-25")).toBe("2026-12-25T00:00:00.000Z"); expect(iso("in 2 hours")).toBe("2026-10-27T12:00:00.000Z"); expect(iso("gibberish")).toBeNull();
  });
  it("runs through the executor without any AI", async () => {
    const c = await signedIn(); const r = await run(c, "calculate", { expression: "12*7" }); expect(r).toMatchObject({ status: "ok", result: { result: 84 } });
    expect(await run(c, "format_text", { text: "hello big world", operation: "title" })).toMatchObject({ result: { result: "Hello Big World" } });
    expect(await run(c, "get_current_time", { timezone: "Asia/Tokyo" })).toMatchObject({ status: "ok" }); expect(await run(c, "get_current_time", { timezone: "Mars/Base" })).toMatchObject({ status: "error", code: "BAD_TIMEZONE" });
  });
});

describe("tool executor policy", () => {
  it("rejects unknown tools, bad arguments and tools of uninstalled/disabled/unconfigured integrations", async () => {
    const c = await signedIn();
    expect(await run(c, "rm_rf", {})).toMatchObject({ status: "error", code: "UNKNOWN_TOOL" });
    const inv = await run(c, "calculate", { expression: 5 }); expect(inv).toMatchObject({ status: "error", code: "INVALID_ARGUMENTS" }); expect(JSON.stringify(inv)).not.toContain("5,");
    expect(await run(c, "get_home_assistant_state", { entity_id: "light.x" })).toMatchObject({ status: "error", code: "NEEDS_INSTALL" });
    c.integrations.install("home-assistant", c.userId); expect(await run(c, "get_home_assistant_state", { entity_id: "light.x" })).toMatchObject({ code: "NEEDS_CONFIGURATION" });
    c.integrations.disable("tasks-reminders", c.userId); expect(await run(c, "list_tasks", {})).toMatchObject({ status: "error", code: "NEEDS_ENABLE" });
    c.integrations.enable("tasks-reminders", c.userId); expect(await run(c, "list_tasks", {})).toMatchObject({ status: "ok" });
    expect(() => c.integrations.disable("core-utils", c.userId)).toThrow(/core part/);
  });
  it("enforces timeouts, result limits and cancellation", async () => {
    const mod = makeModule({ manifest: { id: "probe", name: "Probe", version: "1", category: "utilities", description: "t", defaultInstalled: true }, tools: [
      defineTool({ name: "slow", title: "s", description: "s", risk: "low", permission: "p", readOnly: true, audit: "minimal", timeoutMs: 80, maxResultBytes: 1000, args: z.object({}), handler: async (_a, ctx) => new Promise((res, rej) => { const t = setTimeout(() => res("late"), 2000); ctx.signal.addEventListener("abort", () => { clearTimeout(t); rej(new Error("x")); }); }) }),
      defineTool({ name: "big", title: "b", description: "b", risk: "low", permission: "p", readOnly: true, audit: "minimal", timeoutMs: 1000, maxResultBytes: 500, args: z.object({}), handler: async () => ({ blob: "x".repeat(5000) }) }),
      defineTool({ name: "boom", title: "b", description: "b", risk: "low", permission: "p", readOnly: true, audit: "minimal", timeoutMs: 1000, maxResultBytes: 500, args: z.object({}), handler: async () => { throw new Error("secret internal path /etc/passwd"); } }),
    ] });
    mod.getManifest().permissions.push({ id: "p", label: "p", reason: "p", access: "read", dataAccessed: "p", defaultGranted: true });
    const c = await signedIn({}, { modules: [...BUILTIN_MODULES, mod] });
    expect(await run(c, "slow", {})).toMatchObject({ status: "error", code: "TIMEOUT" });
    const big = await run(c, "big", {}); expect(big).toMatchObject({ status: "ok", truncated: true }); expect(JSON.stringify(big).length).toBeLessThan(1200);
    const boom = await run(c, "boom", {}); expect(boom).toMatchObject({ status: "error", code: "TOOL_FAILED" }); expect(JSON.stringify(boom)).not.toContain("passwd");
    const ctl = new AbortController(); const p = run(c, "slow", {}, { signal: ctl.signal }); setTimeout(() => ctl.abort(), 10); expect(await p).toMatchObject({ code: "CANCELLED" });
  });
  it("audits executions without payloads", async () => { const c = await signedIn(); await run(c, "calculate", { expression: "1+1" }); const rows = c.deps.db.prepare("SELECT * FROM tool_executions").all() as Record<string, unknown>[]; expect(rows[0]).toMatchObject({ tool_name: "calculate", outcome: "ok", integration_id: "core-utils" }); expect(JSON.stringify(rows)).not.toContain("1+1"); });
  it("blocks model-originated writes and external tools that carry sensitive data", async () => {
    const c = await signedIn();
    const r = await run(c, "save_note", { title: "card", content: "my card is 4111 1111 1111 1111" }, { source: "model" }); expect(r).toMatchObject({ status: "blocked", code: "PRIVACY_BLOCKED" });
    expect(c.deps.repos.notes.list(c.userId)).toHaveLength(0);
    installEnable(c, "web-research"); expect(await run(c, "fetch_public_page", { url: "https://example.com/?q=4111111111111111" }, { source: "user" })).toMatchObject({ status: "blocked" });
  });
  it("redacts sensitive text in results before it can reach the model", async () => {
    const c = await signedIn(); c.deps.repos.notes.create(c.userId, { title: "bank", content: "my IBAN is GB82 WEST 1234 5698 7654 32" });
    const r = await run(c, "search_notes", { query: "IBAN" }, { source: "model" }); expect(r).toMatchObject({ status: "ok", withheld: 1 }); expect(JSON.stringify(r)).not.toContain("GB82");
    expect(JSON.stringify(await run(c, "search_notes", { query: "IBAN" }, { source: "user" }))).toContain("GB82");
  });
});

describe("confirmation workflow", () => {
  const setup = async () => { const c = await signedIn(); const t = c.deps.repos.tasks.create(c.userId, { title: "doomed" }); const conv = c.deps.repos.conversations.create(c.userId); const r = await run(c, "delete_task", { id: t.id }, { source: "model", conversationId: conv.id }); if (r.status !== "confirmation_required") throw new Error("expected confirmation"); return { c, t, conf: r.confirmation }; };
  it("requires approval, executes once, and binds the token to the exact arguments", async () => {
    const { c, t, conf } = await setup(); expect(c.deps.repos.tasks.get(c.userId, t.id)).not.toBeNull();
    expect(await c.executor.approve(conf.id, "wrong-token", c.userId, "t")).toMatchObject({ status: "error", code: "CONFIRMATION_INVALID" });
    expect(await run(c, "delete_task", { id: "00000000-0000-4000-8000-000000000000" }, { confirmation: { id: conf.id, token: conf.token } })).toMatchObject({ status: "error", code: "CONFIRMATION_INVALID" }); // changed arguments
    expect(c.deps.repos.tasks.get(c.userId, t.id)).not.toBeNull();
    expect(await c.executor.approve(conf.id, conf.token, c.userId, "t")).toMatchObject({ status: "ok" }); expect(c.deps.repos.tasks.get(c.userId, t.id)).toBeNull();
    expect(await c.executor.approve(conf.id, conf.token, c.userId, "t")).toMatchObject({ status: "error" }); // reuse
  });
  it("expires and belongs to one user, and the model's say-so is not approval", async () => {
    const { c, conf } = await setup(); c.deps.db.prepare("UPDATE confirmations SET expires_at=?").run(new Date(Date.now() - 1000).toISOString());
    expect(await c.executor.approve(conf.id, conf.token, c.userId, "t")).toMatchObject({ code: "CONFIRMATION_INVALID", message: expect.stringMatching(/expired/) });
    const s = await setup(); const other = s.c.deps.repos.users.create("o2", "x"); expect(await s.c.executor.approve(s.conf.id, s.conf.token, other.id, "t")).toMatchObject({ status: "error" });
    const t = s.c.deps.repos.tasks.create(s.c.userId, { title: "keep" }); const m = await run(s.c, "delete_task", { id: t.id, confirmed: true, user_approved: "yes" }, { source: "model" }); expect(m.status === "confirmation_required" || m.status === "error").toBe(true); expect(s.c.deps.repos.tasks.get(s.c.userId, t.id)).not.toBeNull();
  });
  it("cancel consumes the confirmation; hash is stable across key order", async () => { const { c, conf } = await setup(); expect(c.executor.cancel(conf.id, c.userId)).toBe(true); expect(await c.executor.approve(conf.id, conf.token, c.userId, "t")).toMatchObject({ status: "error" }); expect(argsHash("u", "t", { a: 1, b: 2 })).toBe(argsHash("u", "t", { b: 2, a: 1 })); });
  it("approve and cancel work over the API with CSRF", async () => {
    const { c, conf } = await setup(); const bad = await c.app.inject({ method: "POST", url: `/api/v1/confirmations/${conf.id}/approve`, payload: { token: conf.token }, headers: { cookie: c.cookie } }); expect(bad.statusCode).toBe(403);
    const ok = await c.app.inject({ method: "POST", url: `/api/v1/confirmations/${conf.id}/approve`, payload: { token: conf.token }, headers: { cookie: c.cookie, "x-csrf-token": c.csrf } }); expect(ok.statusCode).toBe(200); expect(ok.json().message.content).toMatch(/^Done/);
  });
});

describe("files tool safety", () => {
  it("is unavailable without approved roots and confines access to them", async () => {
    const none = await signedIn({ VERA_ALLOWED_FILE_ROOTS: "" }); expect(none.integrations.summary("files").status).toBe("unavailable");
    const c = await signedIn(); installEnable(c, "files"); fs.writeFileSync(path.join(c.filesDir, "note.txt"), "Hello there. This is a useful sentence about boilers and heating systems. Another sentence follows it here.");
    const outside = tmp(); fs.writeFileSync(path.join(outside, "secret.txt"), "top secret"); fs.symlinkSync(outside, path.join(c.filesDir, "link")); fs.symlinkSync(path.join(outside, "secret.txt"), path.join(c.filesDir, "file-link.txt"));
    expect(await run(c, "read_allowed_file", { path: "note.txt" })).toMatchObject({ status: "ok", result: { content: expect.stringContaining("Hello") } });
    for (const p of ["../../etc/passwd", "/etc/passwd", path.join(outside, "secret.txt"), "link/secret.txt", "file-link.txt", "note.txt\0.png", "..%2f..%2fetc/passwd"]) expect(await run(c, "read_allowed_file", { path: p }), p).toMatchObject({ status: "error" });
    expect(await run(c, "list_allowed_files", { path: "link" })).toMatchObject({ status: "error" });
    expect(await run(c, "search_files", { query: "secret", search_contents: true })).toMatchObject({ status: "ok", result: { results: [] } });
  });
  it("refuses credential/key/database files, big and binary files, and summarises locally", async () => {
    const c = await signedIn(); installEnable(c, "files");
    for (const n of [".env", "id_rsa", "server.pem", "secret.key", "vera.db", "credentials.json"]) { fs.writeFileSync(path.join(c.filesDir, n), "x"); expect(await run(c, "read_allowed_file", { path: n }), n).toMatchObject({ status: "error", code: "FILE_BLOCKED" }); }
    fs.writeFileSync(path.join(c.filesDir, "big.txt"), "a".repeat(1_100_000)); expect(await run(c, "read_allowed_file", { path: "big.txt" })).toMatchObject({ code: "TOO_LARGE" });
    fs.writeFileSync(path.join(c.filesDir, "bin.txt"), Buffer.from([1, 2, 0, 3])); expect(await run(c, "read_allowed_file", { path: "bin.txt" })).toMatchObject({ code: "BINARY_FILE" });
    fs.writeFileSync(path.join(c.filesDir, "doc.md"), "# Title\n" + "Boilers need a yearly service to stay safe and efficient. ".repeat(3) + "Unrelated filler sentence that is rather long indeed. ");
    const s = await run(c, "summarise_document", { path: "doc.md", sentences: 2 }); expect(s).toMatchObject({ status: "ok", result: { method: "extractive", headings: ["Title"] } });
    expect(await run(c, "get_document_metadata", { path: "doc.md" })).toMatchObject({ result: { extension: ".md", mime: "text/markdown" } });
  });
});

describe("SSRF protection", () => {
  it("blocks private, loopback, link-local, metadata and mapped addresses", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "224.0.0.1", "not-an-ip"]) expect(isBlockedAddress(a), a).toBe(true);
    for (const a of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) expect(isBlockedAddress(a), a).toBe(false);
  });
  it("rejects dangerous URLs before connecting", () => {
    for (const u of ["http://localhost/", "http://127.0.0.1/", "http://2130706433/", "http://0x7f.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data", "http://metadata.google.internal/", "http://nas.local/", "http://svc.internal/", "file:///etc/passwd", "ftp://example.com/", "http://user:pw@example.com/", "http://example.com:22/", "http://10.0.0.1:8080/"]) expect(() => assertPublicUrl(u), u).toThrow(SafeFetchError);
    expect(() => assertPublicUrl("https://example.com/path?q=1")).not.toThrow();
  });
  it("blocks DNS rebinding: a public name that resolves to a private address", async () => {
    vi.spyOn(dns, "lookup").mockImplementation(((_h: string, o: unknown, cb: (...a: unknown[]) => void) => { (typeof o === "function" ? (o as typeof cb) : cb)(null, [{ address: "127.0.0.1", family: 4 }]); }) as never);
    await expect(safeFetch("http://rebind.example/")).rejects.toMatchObject({ code: "BLOCKED" });
    vi.restoreAllMocks(); vi.spyOn(dns, "lookup").mockImplementation(((_h: string, o: unknown, cb: (...a: unknown[]) => void) => { (typeof o === "function" ? (o as typeof cb) : cb)(null, [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.7", family: 4 }]); }) as never);
    await expect(safeFetch("http://mixed.example/")).rejects.toMatchObject({ code: "BLOCKED" });
  });
  it("re-validates every redirect hop and bounds response size", async () => {
    const srv = http.createServer((req, res) => { if (req.url === "/redir") { res.writeHead(302, { location: "http://169.254.169.254/latest" }); res.end(); } else if (req.url === "/big") { res.writeHead(200, { "content-type": "text/plain" }); res.end("x".repeat(100_000)); } else { res.end("hi"); } });
    const listening = await new Promise<boolean>((r) => { srv.once("error", () => r(false)); srv.listen(8080, "127.0.0.1", () => r(true)); });
    if (!listening) return; // port 8080 busy on this machine: skip
    const lookup = ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) => (o?.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4))) as never;
    try {
      await expect(safeFetch("http://pub.example:8080/redir", { lookup })).rejects.toMatchObject({ code: "BLOCKED" });
      const big = await safeFetch("http://pub.example:8080/big", { lookup, maxBytes: 5000 }); expect(big.truncated).toBe(true); expect(big.body.length).toBe(5000);
    } finally { srv.close(); }
  });
});

describe("no arbitrary execution", () => {
  it("contains no shell, eval or dynamic code paths in the server", () => {
    const files: string[] = []; const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".ts")) files.push(p); } }; walk("server/src");
    const src = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
    for (const bad of [/child_process/, /\bexecSync\b/, /\bspawn\s*\(/, /\beval\s*\(/, /new Function\s*\(/, /\bvm\.run/, /require\s*\(\s*[^'")\s]/, /socketPath/, /import\s*\(\s*[^'"]/]) expect(src, String(bad)).not.toMatch(bad);
  });
  it("downloads no code when installing", async () => { const c = await signedIn(); const spy = vi.spyOn(globalThis, "fetch"); for (const id of ["files", "web-research", "media"]) c.integrations.install(id, c.userId); expect(spy).not.toHaveBeenCalled(); });
});
