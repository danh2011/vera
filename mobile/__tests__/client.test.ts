import { NativeVeraApi, probeServer } from "../src/api/client";
import { ApiError, ConnectionError } from "../src/api/errors";

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));

type Call = { url: string; init: Record<string, any> };
const json = (body: unknown, init: { status?: number; setCookie?: string } = {}) => ({
  ok: (init.status ?? 200) < 400, status: init.status ?? 200,
  headers: { get: (k: string) => (k.toLowerCase() === "set-cookie" ? init.setCookie ?? null : null) },
  json: async () => body, text: async () => JSON.stringify(body),
}) as unknown as Response;

function make(responses: Response[], opts: Partial<ConstructorParameters<typeof NativeVeraApi>[0]> = {}) {
  const calls: Call[] = []; let i = 0;
  const fetchImpl = async (url: string, init?: Record<string, unknown>) => { calls.push({ url, init: init ?? {} }); const r = responses[Math.min(i++, responses.length - 1)]; if (r instanceof Error) throw r; return r!; };
  return { api: new NativeVeraApi({ baseUrl: "http://192.168.1.20:3001/", fetchImpl, ...opts }), calls };
}

describe("NativeVeraApi session handling", () => {
  it("captures the session cookie on login and sends it, plus the CSRF token, afterwards", async () => {
    const saved: (string | null)[] = [];
    const { api, calls } = make([
      json({ authenticated: true, username: "dan", csrfToken: "csrf-1" }, { setCookie: "vera_session=SESSION1; Path=/; HttpOnly" }),
      json({ tasks: [] }), json({ id: "t1" }),
    ], { onCookie: (t) => saved.push(t) });
    await api.login({ username: "dan", password: "pw" });
    expect(saved).toEqual(["SESSION1"]);
    await api.listTasks(); await api.createTask({ title: "x", priority: "low" });
    expect(calls[0]!.url).toBe("http://192.168.1.20:3001/api/v1/auth/login");
    expect(calls[1]!.init.headers.Cookie).toBe("vera_session=SESSION1");
    expect(calls[1]!.init.headers["X-CSRF-Token"]).toBeUndefined();   // GETs don't need it
    expect(calls[2]!.init.headers["X-CSRF-Token"]).toBe("csrf-1");   // writes do
    expect(calls[2]!.init.credentials).toBe("omit");                  // explicit cookie, not the platform jar
  });
  it("falls back to the platform cookie jar when no token could be read", async () => {
    const { api, calls } = make([json({ tasks: [] })]);
    await api.listTasks();
    expect(calls[0]!.init.credentials).toBe("include"); expect(calls[0]!.init.headers.Cookie).toBeUndefined();
  });
  it("restores a stored token", async () => {
    const { api, calls } = make([json({ authenticated: true, username: "dan", csrfToken: "c" })], { cookie: "STORED" });
    await api.getSession(); expect(calls[0]!.init.headers.Cookie).toBe("vera_session=STORED");
  });
  it("forgets the token on logout even if the request fails", async () => {
    const saved: (string | null)[] = [];
    const { api } = make([new TypeError("Network request failed") as unknown as Response], { cookie: "S", onCookie: (t) => saved.push(t) });
    await expect(api.logout()).rejects.toBeInstanceOf(ConnectionError); expect(saved).toEqual([null]);
  });
  it("signals the app when the server says the session is gone", async () => {
    const gone = jest.fn();
    const { api } = make([json({ error: { code: "UNAUTHENTICATED", message: "Sign in" } }, { status: 401 })], { onUnauthenticated: gone });
    await expect(api.listTasks()).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" }); expect(gone).toHaveBeenCalled();
  });
});

describe("NativeVeraApi errors", () => {
  it("surfaces server validation messages", async () => {
    const { api } = make([json({ error: { code: "VALIDATION", message: "Bad", fields: { title: "Required" } } }, { status: 400 })]);
    const e = await api.createTask({ title: "", priority: "low" }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError); expect(e.fields).toEqual({ title: "Required" });
  });
  it("explains an unreachable server in plain words", async () => {
    const { api } = make([new TypeError("Network request failed") as unknown as Response]);
    await expect(api.listTasks()).rejects.toThrow(/Can't reach the Vera server at 192\.168\.1\.20:3001/);
  });
  it("maps a missing conversation to null", async () => {
    const { api } = make([json({ error: { code: "NOT_FOUND", message: "no" } }, { status: 404 })]);
    expect(await api.getConversation("x")).toBeNull();
  });
});

describe("NativeVeraApi chat streaming", () => {
  const streamOf = (chunks: string[]) => { const enc = new TextEncoder(); let i = 0; return { ok: true, status: 200, headers: { get: () => null }, body: { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true, value: undefined }) }) } } as unknown as Response; };
  it("reads steps and the final message across chunk boundaries", async () => {
    const steps: string[] = [];
    const { api } = make([streamOf(['{"type":"step","step":{"id":"a","label":"Thinking","state":"running"}}\n{"type":"mess', 'age","message":{"id":"m1","role":"assistant","content":"Hi"}}'])]);
    const r = await api.sendMessage("c1", { content: "hello" }, undefined, (s) => steps.push(s.id));
    expect(steps).toEqual(["a"]); expect(r.message.content).toBe("Hi");
  });
  it("turns a server-side stream error into an ApiError", async () => {
    const { api } = make([streamOf(['{"type":"error","code":"AI_DOWN","message":"Gemini is unavailable"}\n'])]);
    await expect(api.sendMessage("c1", { content: "x" })).rejects.toMatchObject({ code: "AI_DOWN" });
  });
  it("reports a stream that ends without an answer", async () => {
    const { api } = make([streamOf([])]);
    await expect(api.sendMessage("c1", { content: "x" })).rejects.toMatchObject({ code: "INCOMPLETE" });
  });
});

describe("probeServer", () => {
  it("accepts a Vera server and rejects anything else", async () => {
    expect(await probeServer("http://h", (async () => json({ ownerExists: true })) as never)).toMatchObject({ ok: true });
    expect(await probeServer("http://h", (async () => json({ hello: "world" })) as never)).toMatchObject({ ok: false });
    expect(await probeServer("http://h", (async () => json({}, { status: 404 })) as never)).toMatchObject({ ok: false });
    expect(await probeServer("http://h", (async () => { throw new TypeError("x"); }) as never)).toMatchObject({ ok: false });
  });
});
