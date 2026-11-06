// @vitest-environment jsdom
/**
 * End-to-end UI tests: the real React app, the real HttpVeraApi, and the real backend (Fastify + SQLite) wired
 * together through a fetch bridge. Nothing here is mocked except the network transport and a fake Home Assistant.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { Providers } from "../src/context";
import { filterIntegrations } from "../src/pages/integrations/util";
import { HttpVeraApi } from "../src/services/http";
import { FakeProvider, PASSWORD, makeApp } from "./helpers";

const ha = http.createServer((req, res) => { res.setHeader("content-type", "application/json"); if (req.headers.authorization !== "Bearer GOOD-TOKEN-123456") { res.writeHead(401); return res.end("{}"); } res.end(req.url === "/api/" ? '{"message":"API running."}' : "[]"); });
const haUrl = await new Promise<string>((r) => ha.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(ha.address() as AddressInfo).port}`)));
afterAll(() => ha.close());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { localStorage.clear(); localStorage.setItem("vera:v1:settings", JSON.stringify({ onboarded: true })); });

type Built = Awaited<ReturnType<typeof makeApp>>;
function bridge(b: Built, opts: { failNext?: { n: number; match?: string } } = {}) {
  const realFetch = globalThis.fetch; let cookie = ""; const log: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    if (/^https?:/.test(url)) return realFetch(url, init); // calls from the server to other services (fake Home Assistant) are real
    if (opts.failNext && opts.failNext.n > 0 && (!opts.failNext.match || url.includes(opts.failNext.match))) { opts.failNext.n--; throw new TypeError("Failed to fetch"); }
    const method = (init.method ?? "GET") as "GET"; log.push(`${method} ${url}`);
    const r = await b.app.inject({ method, url, payload: init.body as string | undefined, headers: { ...(init.headers as Record<string, string>), ...(cookie ? { cookie } : {}) } });
    for (const c of r.cookies) cookie = c.value ? `${c.name}=${c.value}` : "";
    return new Response(r.rawPayload, { status: r.statusCode, headers: { "content-type": String(r.headers["content-type"] ?? "application/json") } });
  });
  return { log, setCookie: (c: string) => { cookie = c; } };
}
const mount = (path = "/integrations") => render(<Providers api={new HttpVeraApi()}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></Providers>);
async function signIn(b: Built) {
  const r = await b.app.inject({ method: "POST", url: "/api/v1/setup/owner", payload: { username: "owner", password: PASSWORD, setupCode: "setup-token-123456" } });
  return `${r.cookies[0]!.name}=${r.cookies[0]!.value}`;
}
const card = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}:`) }).closest("li") as HTMLElement;

describe("first run and sign-in", () => {
  it("creates the owner through the UI with the setup code, then shows the app", async () => {
    const b = await makeApp(); bridge(b); mount("/chat");
    expect(await screen.findByRole("heading", { name: "Create the owner account" })).toBeInTheDocument();
    const u = userEvent.setup(); await u.type(screen.getByLabelText(/Setup code/), "nope-wrong"); await u.type(screen.getByLabelText(/^Username/), "dan"); await u.type(screen.getByLabelText(/^Password/), PASSWORD); await u.type(screen.getByLabelText("Confirm password"), PASSWORD);
    await u.click(screen.getByRole("button", { name: "Create account" })); expect(await screen.findByText(/setup code is not correct/i)).toBeInTheDocument();
    await u.clear(screen.getByLabelText(/Setup code/)); await u.type(screen.getByLabelText(/Setup code/), "setup-token-123456"); await u.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("heading", { name: "Welcome to Vera" })).toBeInTheDocument(); expect(b.deps.repos.users.count()).toBe(1); // onboarding runs right after the owner is created
  });
  it("shows a login form for an existing owner and rejects a wrong password", async () => {
    const b = await makeApp(); await signIn(b); bridge(b); mount("/chat"); const u = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument(); await u.type(screen.getByLabelText("Username"), "owner"); await u.type(screen.getByLabelText("Password"), "wrong-password-123"); await u.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Incorrect username or password.")).toBeInTheDocument(); await u.clear(screen.getByLabelText("Password")); await u.type(screen.getByLabelText("Password"), PASSWORD); await u.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/What can I help you with/)).toBeInTheDocument();
  });
  it("shows a clear connection error with retry, never fake data", async () => {
    const b = await makeApp(); await signIn(b); const fail = { n: 1 }; const t = bridge(b, { failNext: fail }); mount("/chat");
    expect(await screen.findByText(/Can't reach the Vera server/)).toBeInTheDocument(); expect(screen.queryByText(/What can I help you with/)).toBeNull(); t.setCookie("");
    await userEvent.click(screen.getByRole("button", { name: "Try again" })); expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});

describe("Integrations Store (real backend)", () => {
  it("lists the catalogue from the backend with accurate states, search and filters", async () => {
    const b = await makeApp(); const cookie = await signIn(b); bridge(b).setCookie(cookie); mount(); const u = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Integrations" })).toBeInTheDocument(); await screen.findByText("Home Assistant");
    const ids = b.integrations.catalogue().integrations.map((i) => i.name); for (const n of ids) expect(screen.getAllByText(n).length).toBeGreaterThan(0);
    expect(within(card("Core utilities")).getByText("Enabled")).toBeInTheDocument(); expect(within(card("Home Assistant")).getByText("Not installed")).toBeInTheDocument();
    expect(within(card("Home Assistant")).getByRole("button", { name: "Install Home Assistant" })).toBeInTheDocument(); expect(within(card("Core utilities")).getByRole("button", { name: "Use in chat Core utilities" })).toBeInTheDocument();
    await u.type(screen.getByRole("searchbox", { name: "Search integrations" }), "smart home"); expect(screen.getByRole("heading", { name: /1 result/ })).toBeInTheDocument(); expect(screen.getByRole("button", { name: /^Home Assistant:/ })).toBeInTheDocument(); expect(screen.queryByRole("button", { name: /^Media and download services:/ })).toBeNull();
    await u.clear(screen.getByRole("searchbox", { name: "Search integrations" })); await u.type(screen.getByRole("searchbox", { name: "Search integrations" }), "zzzzqq"); expect(await screen.findByText("No integrations match.")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Clear search and filters" })); await u.click(screen.getByRole("button", { name: /^Errors/ })); expect(screen.getByText("No integrations match.")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /^Installed/ })); expect(screen.getByRole("button", { name: /^Core utilities:/ })).toBeInTheDocument(); expect(screen.queryByRole("button", { name: /^Home Assistant:/ })).toBeNull();
    await u.click(screen.getByRole("button", { name: /^Home server/ })); // category chips come from real metadata
  });
  it("one-click install of a local integration persists in the backend and is idempotent", async () => {
    const b = await makeApp(); const cookie = await signIn(b); bridge(b).setCookie(cookie); b.integrations.uninstall("tasks-reminders", b.deps.repos.users.first()!.id); mount(); const u = userEvent.setup();
    const c = await waitFor(() => card("Tasks and reminders")); expect(within(c).getByText("Not installed")).toBeInTheDocument();
    await u.click(within(c).getByRole("button", { name: "Install Tasks and reminders" })); await waitFor(() => expect(within(card("Tasks and reminders")).getByText("Enabled")).toBeInTheDocument());
    expect(b.integrations.summary("tasks-reminders")).toMatchObject({ installed: true, enabled: true }); expect(await screen.findByText(/installed and ready/)).toBeInTheDocument();
    expect(within(card("Tasks and reminders")).getByRole("button", { name: "Open Tasks and reminders" })).toBeInTheDocument();
  });
  it("walks through the Home Assistant setup wizard with validation, a real connection test and Turn on", async () => {
    const b = await makeApp(); const cookie = await signIn(b); bridge(b).setCookie(cookie); mount(); const u = userEvent.setup();
    await u.click(within(await waitFor(() => card("Home Assistant"))).getByRole("button", { name: "Install Home Assistant" }));
    const dlg = await screen.findByRole("dialog", { name: /Set up Home Assistant/ }); expect(within(dlg).getByText(/Step 1 of/)).toBeInTheDocument(); expect(within(dlg).getByText(/long-lived access token/i, { selector: "p" })).toBeInTheDocument(); expect(within(dlg).getByText(/What do these terms mean/)).toBeInTheDocument();
    expect(b.integrations.summary("home-assistant")).toMatchObject({ installed: true, enabled: false, status: "needs_setup" });
    await u.click(within(dlg).getByRole("button", { name: "Continue" })); expect(await within(dlg).findByText(/Security tab/)).toBeInTheDocument(); await u.click(within(dlg).getByRole("button", { name: "Continue" }));
    // required-field validation next to each field
    await u.click(within(dlg).getByRole("button", { name: "Save and continue" })); expect(await within(dlg).findByText("Home Assistant URL is required.")).toBeInTheDocument(); expect(within(dlg).getByText("Long-lived access token is required.")).toBeInTheDocument(); expect(within(dlg).getByLabelText(/Home Assistant URL/)).toHaveAttribute("aria-invalid", "true");
    await u.type(within(dlg).getByLabelText(/Home Assistant URL/), "ftp://nope"); await u.type(within(dlg).getByLabelText(/Long-lived access token/), "WRONG-TOKEN-xxxx"); await u.type(within(dlg).getByLabelText(/Allowed entities/), "light.*"); await u.click(within(dlg).getByRole("button", { name: "Save and continue" }));
    expect(await within(dlg).findByText(/Enter a full URL such as/)).toBeInTheDocument(); expect(b.deps.repos.integrations.secretKeys("home-assistant")).toEqual([]);
    await u.clear(within(dlg).getByLabelText(/Home Assistant URL/)); await u.type(within(dlg).getByLabelText(/Home Assistant URL/), haUrl); await u.click(within(dlg).getByRole("button", { name: "Save and continue" }));
    expect(await within(dlg).findByText(/Things Vera may do|These are the things Vera may do/i)).toBeInTheDocument(); expect(within(dlg).getByLabelText(/Control devices/)).not.toBeChecked(); await u.click(within(dlg).getByRole("button", { name: "Continue" }));
    // a genuine failed test (the token is wrong), then fix the credential and retest
    await u.click(await within(dlg).findByRole("button", { name: "Test connection" })); expect(await within(dlg).findByText("Authentication failed", { selector: "strong" })).toBeInTheDocument(); expect(b.integrations.summary("home-assistant").connection).toBe("failed");
    await u.click(within(dlg).getByRole("button", { name: "Back" })); await u.click(within(dlg).getByRole("button", { name: "Back" }));
    const tok = within(dlg).getByLabelText(/Long-lived access token/) as HTMLInputElement; expect(tok.value).toBe(""); expect(within(dlg).getByText(/Credential saved/)).toBeInTheDocument(); expect(tok).toHaveAttribute("type", "password");
    await u.type(tok, "GOOD-TOKEN-123456"); await u.click(within(dlg).getByRole("button", { name: "Save and continue" })); await u.click(await within(dlg).findByRole("button", { name: "Continue" }));
    await u.click(await within(dlg).findByRole("button", { name: /^Test (connection|again)$/ })); expect(await within(dlg).findByText("Connection successful", { selector: "strong" })).toBeInTheDocument(); expect(b.integrations.summary("home-assistant").connection).toBe("connected");
    await u.click(within(dlg).getByRole("button", { name: "Continue" })); expect(await within(dlg).findByText("Setup complete")).toBeInTheDocument();
    await u.click(within(dlg).getByRole("button", { name: "Turn on and finish" })); await waitFor(() => expect(screen.queryByRole("dialog", { name: /Set up/ })).toBeNull());
    await waitFor(() => expect(within(card("Home Assistant")).getByText("Connected")).toBeInTheDocument()); expect(b.integrations.summary("home-assistant")).toMatchObject({ enabled: true, status: "connected" });
    expect(document.body.innerHTML).not.toContain("GOOD-TOKEN-123456"); expect(JSON.stringify(localStorage)).not.toContain("GOOD-TOKEN");
  });
  it("detail view shows honest tool availability, permissions, disable/enable and a guarded uninstall", async () => {
    const b = await makeApp(); const cookie = await signIn(b); bridge(b).setCookie(cookie); const uid = b.deps.repos.users.first()!.id;
    b.integrations.install("home-assistant", uid); await b.integrations.configure("home-assistant", { values: { base_url: haUrl, access_token: "GOOD-TOKEN-123456", allowed_entities: ["light.*"] } }, uid); b.integrations.enable("home-assistant", uid);
    mount("/integrations/home-assistant"); const u = userEvent.setup(); const sheet = await screen.findByRole("dialog", { name: "Home Assistant details" });
    expect(await within(sheet).findByText("Privacy and data")).toBeInTheDocument(); expect(within(sheet).getByText("control_home_assistant_entity")).toBeInTheDocument(); expect(within(sheet).getByText(/Credential saved/)).toBeInTheDocument();
    expect(within(sheet).getAllByText("Permission off").length).toBeGreaterThan(0); // control permission is off by default
    await u.click(within(sheet).getByLabelText(/Control devices/)); await waitFor(() => expect(b.deps.repos.integrations.permissions("home-assistant").control).toBe(true));
    await u.click(within(sheet).getByRole("button", { name: "Test connection" })); expect(await within(sheet).findByText("Connection successful")).toBeInTheDocument();
    await u.click(within(sheet).getByLabelText(/On: the assistant can use its tools/)); await waitFor(() => expect(b.integrations.summary("home-assistant").enabled).toBe(false)); expect(await within(sheet).findByText(/Off: no tools can run/)).toBeInTheDocument();
    expect(await b.executor.execute({ tool: "list_home_assistant_entities", args: {}, userId: uid, requestId: "x", source: "model" })).toMatchObject({ code: "NEEDS_ENABLE" });
    b.deps.repos.tasks.create(uid, { title: "keep me" });
    await u.click(within(sheet).getByRole("button", { name: "Uninstall Home Assistant" })); const ask = await screen.findByRole("alertdialog"); expect(within(ask).getByText(/Will be removed/)).toBeInTheDocument(); expect(within(ask).getByText(/stored credentials/)).toBeInTheDocument();
    await u.click(within(ask).getByRole("button", { name: "Cancel" })); expect(b.integrations.summary("home-assistant").installed).toBe(true);
    await u.click(within(sheet).getByRole("button", { name: "Uninstall Home Assistant" })); await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Uninstall" }));
    await waitFor(() => expect(b.integrations.summary("home-assistant").installed).toBe(false)); expect(b.deps.repos.integrations.secretKeys("home-assistant")).toEqual([]); expect(b.deps.repos.tasks.list(uid)).toHaveLength(1);
  });
  it("shows an unavailable integration honestly and offers retry when the catalogue cannot load", async () => {
    const b = await makeApp({ VERA_ENABLE_MACHINE_READONLY: "false" }); const cookie = await signIn(b); const fail: { n: number; match?: string } = { n: 0, match: "/integrations" }; const t = bridge(b, { failNext: fail }); t.setCookie(cookie); mount();
    expect(within(await waitFor(() => card("Home server diagnostics"))).getByText("Unavailable")).toBeInTheDocument(); expect(within(card("Home server diagnostics")).queryByRole("button", { name: /Install/ })).toBeNull();
    cleanup(); fail.n = 1; mount(); expect(await screen.findByText(/Couldn't load integrations/)).toBeInTheDocument(); await userEvent.click(screen.getByRole("button", { name: "Retry" })); expect(await screen.findByText("Core utilities")).toBeInTheDocument();
  });
  it("search and filter logic runs on catalogue metadata", async () => {
    const b = await makeApp(); const list = b.integrations.catalogue().integrations;
    expect(filterIntegrations(list, { q: "notification", filter: "all", category: "all" }).map((s) => s.id)).toContain("notifications"); expect(filterIntegrations(list, { q: "", filter: "enabled", category: "all" }).every((s) => s.enabled)).toBe(true);
    expect(filterIntegrations(list, { q: "", filter: "available", category: "media" }).map((s) => s.id)).toEqual(["media"]); expect(filterIntegrations(list, { q: "calendar gmail", filter: "all", category: "all" }).map((s) => s.id)).toEqual(["calendar-email"]);
  });
});

describe("background replies and requirements", () => {
  it("keeps a reply running when you leave the chat, shows an indicator, and never shows a blank page on return", async () => {
    const p = new FakeProvider(); const real = p.generateResponse.bind(p); p.generateResponse = async (r) => { await new Promise((x) => setTimeout(x, 1500)); return real(r); }; p.script = [() => ({ text: "Here is the slow answer." })];
    const b = await makeApp({ GEMINI_ENABLED: "true", GEMINI_API_KEY: "k", GEMINI_MODEL: "m" }, { provider: p }); b.guard.acknowledge(true); const cookie = await signIn(b); bridge(b).setCookie(cookie); mount("/chat"); const u = userEvent.setup();
    await u.type(await screen.findByLabelText("Message"), "tell me something slow and interesting{Enter}");
    expect(await screen.findByText(/Starting|Asking Gemini/, {}, { timeout: 3000 })).toBeInTheDocument(); // (the test transport buffers the stream, so only the first line is visible here; live streaming is verified over a real socket in gemini.test.ts)
    await u.click(screen.getByRole("link", { name: /^Tasks/ }));
    expect(await screen.findByRole("heading", { name: "Tasks" })).toBeInTheDocument(); expect(screen.getAllByRole("status", { name: /Vera is (working on a reply|replying in this chat)/ }).length).toBeGreaterThan(0);
    await u.click((await screen.findAllByRole("link", { name: /tell me something slow|New chat/ }, { timeout: 3000 }))[0]!); // back into the running conversation
    expect(screen.getByText("tell me something slow and interesting")).toBeInTheDocument(); // the question is visible immediately, not a blank page
    expect(await screen.findByText("Here is the slow answer.", {}, { timeout: 5000 })).toBeInTheDocument();
    const line = await screen.findByRole("button", { name: /Worked for .* steps/ }); expect(line).toHaveAttribute("aria-expanded", "false"); // collapsed one-liner by default
    await u.click(line); expect(line).toHaveAttribute("aria-expanded", "true"); expect(await screen.findByText("Gemini answered")).toBeInTheDocument(); await u.click(line); expect(screen.queryByText("Gemini answered")).toBeNull();
  });
  it("installing Notifications without Home Assistant opens setup at the requirement, and the fix leads into Home Assistant's own wizard", async () => {
    const b = await makeApp(); const cookie = await signIn(b); bridge(b).setCookie(cookie); mount(); const u = userEvent.setup();
    expect(within(await waitFor(() => card("Notifications"))).getByText("Needs Home Assistant")).toBeInTheDocument();
    await u.click(within(card("Notifications")).getByRole("button", { name: "Install Notifications" }));
    const dlg = await screen.findByRole("dialog", { name: /Set up Notifications/ }); expect(await within(dlg).findByText(/Requirements/)).toBeInTheDocument();
    expect(within(dlg).getByText(/Home Assistant isn't installed yet/)).toBeInTheDocument(); expect(b.integrations.summary("notifications")).toMatchObject({ installed: true, enabled: false, status: "needs_dependency" });
    await u.click(within(dlg).getByRole("button", { name: "Continue" })); expect(await within(dlg).findByText(/Finish the requirement above first/)).toBeInTheDocument();
    await u.click(within(dlg).getByRole("button", { name: "Install Home Assistant" }));
    expect(await screen.findByRole("dialog", { name: /Set up Home Assistant/ })).toBeInTheDocument(); expect(b.integrations.summary("home-assistant").installed).toBe(true);
  });
  it("Tasks shows a call to action when reminders can't be delivered, and it leads into setup", async () => {
    const b = await makeApp(); const cookie = await signIn(b); bridge(b).setCookie(cookie); mount("/tasks"); const u = userEvent.setup();
    expect(await screen.findByText("Reminders can't alert you yet")).toBeInTheDocument(); await u.click(screen.getByRole("button", { name: "Set up reminders" }));
    expect(await screen.findByRole("dialog", { name: /Set up Notifications/ })).toBeInTheDocument(); expect(b.integrations.summary("notifications").installed).toBe(true);
  });
});

describe("persistence through the real backend", () => {
  it("a message and a task created in the UI survive a full reload", async () => {
    const b = await makeApp(); const cookie = await signIn(b); const t = bridge(b); t.setCookie(cookie); mount("/chat"); const u = userEvent.setup();
    await u.type(await screen.findByLabelText("Message"), "add task buy oat milk{Enter}"); expect(await screen.findByText(/Added task: "buy oat milk"/, {}, { timeout: 4000 })).toBeInTheDocument();
    cleanup(); mount("/tasks"); expect(await screen.findByText("buy oat milk")).toBeInTheDocument(); expect(b.deps.repos.tasks.list(b.deps.repos.users.first()!.id)).toHaveLength(1);
    cleanup(); mount("/chat"); await u.click((await screen.findAllByText(/add task buy oat milk/i))[0]!); expect(await screen.findByText(/Added task: "buy oat milk"/)).toBeInTheDocument();
    expect(t.log.some((l) => l.includes("/api/v1/"))).toBe(true);
  });
  it("shows the real steps Vera took under each answer", async () => {
    const b = await makeApp(); const cookie = await signIn(b); bridge(b).setCookie(cookie); mount("/chat"); const u = userEvent.setup();
    await u.type(await screen.findByLabelText("Message"), "12 * 7{Enter}"); expect(await screen.findByText("12 * 7 = 84", {}, { timeout: 4000 })).toBeInTheDocument();
    const sum = await screen.findByText(/Answered on this server/); expect(screen.queryByText("Checked the privacy policy")).toBeNull(); /* collapsed by default */ await u.click(sum); expect(await screen.findByText("Checked the privacy policy")).toBeInTheDocument(); expect(screen.getByText("Answered locally with calculate")).toBeInTheDocument(); expect(screen.getByText("No AI request was made")).toBeInTheDocument();
  });
  it("shows a policy notice instead of sending banking details to any AI", async () => {
    const b = await makeApp(); const cookie = await signIn(b); bridge(b).setCookie(cookie); mount("/chat"); const u = userEvent.setup();
    await u.type(await screen.findByLabelText("Message"), "my card is 4111 1111 1111 1111{Enter}"); expect(await screen.findByText(/Held back by the privacy policy/, {}, { timeout: 4000 })).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Use redacted text" })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("4111 1111 1111 1111");
  });
  it("systems page shows real diagnostics, not samples", async () => {
    const b = await makeApp(); const cookie = await signIn(b); bridge(b).setCookie(cookie); mount("/systems"); expect(await screen.findByText(/Memory/)).toBeInTheDocument(); expect(screen.queryByText(/Sample/)).toBeNull(); expect(await screen.findByText(/Full-text search/)).toBeInTheDocument();
  });
  it("settings explain the AI state and never reveal keys", async () => {
    const b = await makeApp({ GEMINI_ENABLED: "true", GEMINI_API_KEY: "SUPER-SECRET-KEY-12345", GEMINI_MODEL: "m" }); const cookie = await signIn(b); bridge(b).setCookie(cookie); mount("/settings");
    expect(await screen.findByText(/Gemini access depends on your Google account/)).toBeInTheDocument(); expect(screen.getByText(/Configured on the server \(never shown\)/)).toBeInTheDocument(); expect(document.body.innerHTML).not.toContain("SUPER-SECRET");
    expect(screen.getByRole("button", { name: "Confirm and allow Gemini" })).toBeDisabled();
  });
});
