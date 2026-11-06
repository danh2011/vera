import { describe, expect, it } from "vitest";
import { loadConfig, ConfigError } from "../server/src/config.js";
import { LoginLimiter } from "../server/src/auth/auth.js";
import { PASSWORD, call, makeApp, signedIn } from "./helpers.js";

describe("setup and authentication", () => {
  it("rejects unauthenticated access to every data route", async () => {
    const b = await makeApp();
    for (const [m, u] of [["GET", "/conversations"], ["GET", "/tasks"], ["GET", "/memory"], ["GET", "/notes"], ["GET", "/integrations"], ["GET", "/settings"], ["GET", "/audit"], ["GET", "/system/overview"], ["POST", "/integrations/core-utils/install"], ["GET", "/files"]] as const) {
      const r = await b.app.inject({ method: m, url: `/api/v1${u}` }); expect(r.statusCode, u).toBe(401);
    }
    expect((await b.app.inject({ url: "/api/v1/health" })).statusCode).toBe(200); expect((await b.app.inject({ url: "/api/v1/ready" })).json().ready).toBe(true);
  });
  it("first-run setup needs the setup code, enforces password rules, and can only happen once", async () => {
    const b = await makeApp(); const post = (p: object) => b.app.inject({ method: "POST", url: "/api/v1/setup/owner", payload: p });
    expect((await b.app.inject({ url: "/api/v1/setup/status" })).json()).toEqual({ ownerExists: false, setupTokenRequired: true });
    expect((await post({ username: "owner", password: PASSWORD, setupCode: "wrong-code" })).statusCode).toBe(403);
    expect((await post({ username: "owner", password: "short", setupCode: "setup-token-123456" })).statusCode).toBe(422);
    const ok = await post({ username: "owner", password: PASSWORD, setupCode: "setup-token-123456" }); expect(ok.statusCode).toBe(201);
    const c = ok.cookies[0]!; expect(c.httpOnly).toBe(true); expect(c.sameSite).toBe("Lax");
    expect((await post({ username: "owner2", password: PASSWORD, setupCode: "setup-token-123456" })).statusCode).toBe(409);
    expect(b.deps.repos.users.first()!.passwordHash).toMatch(/^\$argon2id\$/);
  });
  it("accepts passwords of 8+ characters and rejects shorter or trivially weak ones", async () => {
    const post = (b: Awaited<ReturnType<typeof makeApp>>, password: string) => b.app.inject({ method: "POST", url: "/api/v1/setup/owner", payload: { username: "owner", password, setupCode: "setup-token-123456" } });
    const b = await makeApp(); expect((await post(b, "abc1234")).statusCode).toBe(422); expect((await post(b, "aaaaaaaa")).statusCode).toBe(422); expect((await post(b, "owner1234")).statusCode).toBe(422);
    expect((await post(b, "tr0ub4dor")).statusCode).toBe(201);
  });
  it("has no default password and no public registration", async () => { const b = await makeApp(); expect(b.deps.repos.users.count()).toBe(0); expect((await b.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: "admin" } })).statusCode).toBe(401); expect((await b.app.inject({ method: "POST", url: "/api/v1/auth/register", payload: {} })).statusCode).toBeGreaterThanOrEqual(400); });
  it("login, session, logout and revocation work", async () => {
    const c = await signedIn(); const s = await call(c, "GET", "/auth/session"); expect(s.json().authenticated).toBe(true);
    const login = await c.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "OWNER", password: PASSWORD } }); expect(login.statusCode).toBe(200);
    const cookie2 = `${login.cookies[0]!.name}=${login.cookies[0]!.value}`; const csrf2 = login.json().csrfToken;
    expect((await call(c, "GET", "/auth/sessions")).json().sessions).toHaveLength(2);
    expect((await call(c, "POST", "/auth/sessions/revoke-others", {})).json().revoked).toBe(1);
    expect((await c.app.inject({ url: "/api/v1/tasks", headers: { cookie: cookie2 } })).statusCode).toBe(401);
    const out = await call(c, "POST", "/auth/logout", {}); expect(out.statusCode).toBe(200); expect((await call(c, "GET", "/tasks")).statusCode).toBe(401); void csrf2;
  });
  it("wrong credentials give a generic error and repeated failures lock out", async () => {
    const c = await signedIn(); const bad = () => c.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "owner", password: "nope-nope-nope" } });
    for (let i = 0; i < 5; i++) { const r = await bad(); expect(r.statusCode).toBe(401); expect(r.json().error.message).toBe("Incorrect username or password."); }
    const locked = await bad(); expect(locked.statusCode).toBe(429); expect(locked.headers["retry-after"]).toBeDefined();
    expect((await c.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "owner", password: PASSWORD } })).statusCode).toBe(429);
  });
  it("limiter unlocks after the window", () => { let t = 0; const l = new LoginLimiter(2, 1000, () => t); l.fail("k"); l.fail("k"); expect(() => l.check("k")).toThrow(); t = 1500; expect(() => l.check("k")).not.toThrow(); });
  it("sessions expire", async () => { const c = await signedIn(); c.deps.db.prepare("UPDATE sessions SET expires_at=?").run(new Date(Date.now() - 1000).toISOString()); expect((await call(c, "GET", "/tasks")).statusCode).toBe(401); });
  it("enforces CSRF tokens and trusted origins on state-changing requests", async () => {
    const c = await signedIn();
    const noCsrf = await c.app.inject({ method: "POST", url: "/api/v1/tasks", payload: { title: "x" }, headers: { cookie: c.cookie } }); expect(noCsrf.statusCode).toBe(403); expect(noCsrf.json().error.code).toBe("CSRF_FAILED");
    expect((await call(c, "POST", "/tasks", { title: "x" }, { "x-csrf-token": "wrong" })).statusCode).toBe(403);
    expect((await call(c, "POST", "/tasks", { title: "x" }, { origin: "https://evil.example" })).statusCode).toBe(403);
    expect((await call(c, "POST", "/tasks", { title: "x" }, { origin: "http://localhost:5173" })).statusCode).toBe(201);
    expect((await c.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "o", password: "p" }, headers: { origin: "https://evil.example" } })).statusCode).toBe(403);
  });
  it("sends security headers and no CORS allowance", async () => { const b = await makeApp(); const r = await b.app.inject({ url: "/api/v1/health", headers: { origin: "https://evil.example" } }); expect(r.headers["x-content-type-options"]).toBe("nosniff"); expect(r.headers["content-security-policy"]).toContain("default-src 'self'"); expect(r.headers["access-control-allow-origin"]).toBeUndefined(); expect(r.headers["x-request-id"]).toBeDefined(); });
  it("changes the password and revokes other sessions", async () => { const c = await signedIn(); const r = await call(c, "POST", "/auth/password", { currentPassword: "wrong wrong wrong", newPassword: "another long password 1" }); expect(r.statusCode).toBe(403); expect((await call(c, "POST", "/auth/password", { currentPassword: PASSWORD, newPassword: "another long password 1" })).statusCode).toBe(200); expect((await c.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "owner", password: "another long password 1" } })).statusCode).toBe(200); });
});

describe("validation, errors and CRUD", () => {
  it("validates bodies, params and queries without leaking internals", async () => {
    const c = await signedIn();
    const bad = await call(c, "POST", "/tasks", { title: "", priority: "urgent" }); expect(bad.statusCode).toBe(400); expect(bad.json().error.fields).toBeDefined();
    expect((await call(c, "GET", "/tasks/not-a-uuid")).statusCode).toBe(400);
    const malformed = await c.app.inject({ method: "POST", url: "/api/v1/tasks", payload: "{not json", headers: { cookie: c.cookie, "x-csrf-token": c.csrf, "content-type": "application/json" } }); expect(malformed.statusCode).toBe(400); expect(malformed.body).not.toMatch(/at \w+|stack|node_modules/);
    expect((await c.app.inject({ method: "POST", url: "/api/v1/tasks", payload: "x".repeat(600_000), headers: { cookie: c.cookie, "x-csrf-token": c.csrf, "content-type": "application/json" } })).statusCode).toBe(413);
    expect((await call(c, "GET", "/nope")).json().error.code).toBe("NOT_FOUND");
  });
  it("tasks CRUD persists and enforces ownership", async () => {
    const c = await signedIn(); const t = (await call(c, "POST", "/tasks", { title: "Buy milk", priority: "high", dueAt: "2026-11-05T10:00:00Z" })).json();
    expect(t.dueAt).toBe("2026-11-05T10:00:00.000Z"); expect((await call(c, "PATCH", `/tasks/${t.id}`, { completed: true })).json().completed).toBe(true);
    expect((await call(c, "GET", "/tasks")).json().tasks).toHaveLength(1);
    const other = c.deps.repos.users.create("other", "x"); const ot = c.deps.repos.tasks.create(other.id, { title: "secret" });
    expect((await call(c, "GET", `/tasks/${ot.id}`)).statusCode).toBe(404); expect((await call(c, "DELETE", `/tasks/${ot.id}`)).statusCode).toBe(404); expect((await call(c, "GET", "/tasks")).json().tasks).toHaveLength(1);
    expect((await call(c, "DELETE", `/tasks/${t.id}`)).statusCode).toBe(200);
  });
  it("conversations CRUD, notes and memory work", async () => {
    const c = await signedIn(); const conv = (await call(c, "POST", "/conversations")).json(); await call(c, "PATCH", `/conversations/${conv.id}`, { title: "Renamed" });
    expect((await call(c, "GET", "/conversations")).json().conversations[0].title).toBe("Renamed");
    await call(c, "POST", "/notes", { title: "Wifi", content: "the router lives in the hall" }); await call(c, "POST", "/memory", { title: "Pref", content: "likes tea", category: "preference" });
    expect((await call(c, "GET", "/notes?q=router")).json().items).toHaveLength(1); expect((await call(c, "GET", "/memory")).json().items[0].category).toBe("preference");
    expect((await call(c, "POST", "/memory", { title: "x", content: "y", category: "secret" })).statusCode).toBe(400);
    expect((await call(c, "DELETE", `/conversations/${conv.id}`)).statusCode).toBe(200); expect((await call(c, "GET", `/conversations/${conv.id}`)).statusCode).toBe(404);
  });
  it("settings and usage never expose secrets", async () => {
    const c = await signedIn({ GEMINI_ENABLED: "true", GEMINI_API_KEY: "SUPER-SECRET-KEY-12345", GEMINI_MODEL: "m" });
    for (const u of ["/settings", "/usage", "/settings/ai", "/audit"]) expect((await call(c, "GET", u)).body, u).not.toContain("SUPER-SECRET-KEY");
    const s = (await call(c, "GET", "/settings")).json(); expect(s.ai.keyConfigured).toBe(true); expect(s.ai.ready).toBe(false); expect(s.ai.reason).toMatch(/eligibility/);
  });
});

describe("configuration", () => {
  it("applies safe defaults and fails safely on dangerous config", () => {
    const c = loadConfig({ NODE_ENV: "development" } as NodeJS.ProcessEnv); expect(c.host).toBe("127.0.0.1"); expect(c.gemini.enabled).toBe(false); expect(c.trustedProxy).toBe(false); expect(c.machine.readonly).toBe(false);
    expect(() => loadConfig({ VERA_AUTH_REQUIRED: "false" } as NodeJS.ProcessEnv)).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: "99999" } as NodeJS.ProcessEnv)).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: "production", VERA_PUBLIC_URL: "http://vera.example.com" } as NodeJS.ProcessEnv)).toThrow(/https/);
    expect(() => loadConfig({ NODE_ENV: "production", HOST: "0.0.0.0", VERA_PUBLIC_URL: "https://v.example.com" } as NodeJS.ProcessEnv)).toThrow(/not loopback/);
    expect(loadConfig({ NODE_ENV: "production", HOST: "0.0.0.0", VERA_TRUSTED_PROXY: "true", VERA_PUBLIC_URL: "https://v.example.com" } as NodeJS.ProcessEnv).trustedProxy).toEqual(expect.arrayContaining(["192.168.0.0/16"]));
  });
  it("does not trust forwarded headers unless a proxy is configured", async () => {
    const a = await makeApp();
    const ipOf = async (b: Awaited<ReturnType<typeof makeApp>>) => { let ip = ""; b.app.addHook("onRequest", async (req) => { ip = req.ip; }); await b.app.inject({ url: "/api/v1/health", headers: { "x-forwarded-for": "9.9.9.9" }, remoteAddress: "10.0.0.5" }); return ip; };
    expect(await ipOf(a)).toBe("10.0.0.5");
    const t = await makeApp({ VERA_TRUSTED_PROXY: "true" }); expect(await ipOf(t)).toBe("9.9.9.9");
    const u = await makeApp({ VERA_TRUSTED_PROXY: "true", VERA_TRUSTED_PROXY_CIDRS: "172.20.0.0/16" }); expect(await ipOf(u)).toBe("10.0.0.5");
  });
});
