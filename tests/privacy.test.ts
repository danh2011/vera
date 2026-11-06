import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { ibanValid, luhn, PrivacyGateway } from "../server/src/security/privacy.js";
import { FakeProvider, aiReadyCtx, call } from "./helpers.js";

const g = new PrivacyGateway();
const cls = (t: string) => g.classify(t).cls;

describe("privacy classification", () => {
  it("validates Luhn and IBAN checksums", () => { expect(luhn("4111111111111111")).toBe(true); expect(luhn("4111111111111112")).toBe(false); expect(ibanValid("GB82 WEST 1234 5698 7654 32")).toBe(true); expect(ibanValid("GB82 WEST 1234 5698 7654 33")).toBe(false); });
  it.each([
    ["card", "my card is 4111 1111 1111 1111 thanks", "FINANCIAL"], ["card dashes", "pay with 5500-0000-0000-0004", "FINANCIAL"], ["iban", "send it to GB82 WEST 1234 5698 7654 32", "FINANCIAL"],
    ["sort code", "sort code 12-34-56 account 12345678", "FINANCIAL"], ["labelled account", "account number: 12345678", "FINANCIAL"], ["banking intent", "what is my bank balance", "FINANCIAL"], ["transactions", "list my bank transactions", "FINANCIAL"],
    ["google key", "key AIzaSyA1234567890abcdefghijklmnopqrstuv", "CREDENTIAL"], ["bearer", "Authorization: Bearer abcdefghijklmnop1234567890", "CREDENTIAL"], ["private key", "-----BEGIN RSA PRIVATE KEY-----\nMIIE", "CREDENTIAL"],
    ["password assign", "password = hunter2hunter2", "CREDENTIAL"], ["password phrase", "my password is Tr0ub4dor&3", "CREDENTIAL"], ["github", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "CREDENTIAL"], ["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r", "CREDENTIAL"], ["url creds", "postgres://admin:s3cr3t@db.local/app", "CREDENTIAL"],
    ["ni number", "my NI is AB 12 34 56 C", "SENSITIVE_PERSONAL"], ["ssn", "ssn 123-45-6789", "SENSITIVE_PERSONAL"], ["medical", "here are my test results", "SENSITIVE_PERSONAL"],
    ["email", "mail bob@example.com", "PERSONAL"], ["unknown token", "token x9Fq2LmZp8Rt4VbN7yKc1WsD6hGj3AeU0xP", "UNKNOWN"],
  ])("flags %s", (_n, text, expected) => { expect(cls(text)).toBe(expected); });
  it.each([
    "what is a credit card and how does it work", "the meeting is at 12:30 on 2026-11-05", "call order number 1234567", "unix time 1700000000000", "the year 2026 had 365 days",
    "I need to reset my password, how do I do that?", "see https://example.com/a/b/c/d/e/f/g/h/i/j/k/l", "version 1.2.3-beta+build.20260101", "my phone is fine", "set a timer for 20 minutes",
  ])("does not flag %s", (text) => { expect(["PUBLIC", "PERSONAL"]).toContain(cls(text)); });
  it("never mistakes random identifiers for card numbers", () => { for (let i = 0; i < 3000; i++) expect(["PUBLIC", "PERSONAL"], crypto.randomUUID()).toContain(cls(JSON.stringify({ id: crypto.randomUUID(), at: new Date().toISOString() }))); });
  it("honest limits: card digits written as words are not detected", () => { expect(cls("four one one one one one one one one one one one one one one one")).toBe("PUBLIC"); });
  it("redacts without leaking the original", () => { const c = g.classify("card 4111 1111 1111 1111 ok"); const out = g.redact("card 4111 1111 1111 1111 ok", c.findings); expect(out).not.toMatch(/4111/); expect(out).toContain("[REDACTED:"); });
  it("supports configurable patterns and ignores unsafe ones", () => { const p = new PrivacyGateway(null, [{ name: "project", pattern: "PROJECT-ATLAS", cls: "SENSITIVE_PERSONAL" }, { name: "huge", pattern: "a".repeat(500), cls: "FINANCIAL" }]); expect(p.classify("about project-atlas").cls).toBe("SENSITIVE_PERSONAL"); expect(p.classify("a".repeat(500)).cls).toBe("PUBLIC"); });
  it("outbound check blocks, redacts or passes by class and records only metadata", () => {
    const o = g.checkOutbound("pay 4111111111111111", { source: "t" }); expect(o.allowed).toBe(false); expect(o.text).not.toContain("4111111111111111");
    expect(g.checkOutbound("hello bob@example.com", { source: "t" }).allowed).toBe(true); expect(g.checkOutbound("token x9Fq2LmZp8Rt4VbN7yKc1WsD6hGj3AeU0xP", { source: "t" }).text).toContain("[REDACTED");
  });
  it("sanitises tool results deeply", () => { const r = g.sanitizeForModel({ a: ["fine", { b: "IBAN GB82 WEST 1234 5698 7654 32" }] }, { source: "t" }); expect(JSON.stringify(r.value)).not.toContain("GB82"); expect(r.withheld).toBe(1); });
});

describe("privacy gateway in the chat pipeline: provider is never invoked for blocked content", () => {
  const blocked = ["my card number is 4111 1111 1111 1111", "here is my IBAN GB82 WEST 1234 5698 7654 32", "api_key = sk-live-abcdefghijklmnopqrstuvwxyz", "Bearer abcdefghijklmnop1234567890", "what's my bank balance?"];
  it.each(blocked)("blocks %s", async (text) => {
    const p = new FakeProvider(); const c = await aiReadyCtx(p);
    const conv = (await call(c, "POST", "/conversations")).json().id; const r = await call(c, "POST", `/conversations/${conv}/messages`, { content: text });
    expect(r.statusCode).toBe(200); expect(p.calls).toHaveLength(0);
    const m = r.json().message; expect(m.policy.blocked).toBe(true); expect(m.content).toMatch(/didn't send that/);
    const stored = JSON.stringify(c.deps.db.prepare("SELECT content FROM messages").all()); expect(stored).not.toMatch(/4111 1111|GB82 WEST|sk-live|abcdefghijklmnop1234567890/);
    const events = c.deps.db.prepare("SELECT * FROM privacy_events").all() as Record<string, unknown>[]; expect(events.length).toBeGreaterThan(0); expect(JSON.stringify(events)).not.toMatch(/4111|GB82/);
    const logged = c.deps.logRing.tail(100).join(""); expect(logged).not.toMatch(/4111|GB82/);
  });
  it("withholds sensitive earlier messages and sensitive tool arguments from the provider", async () => {
    const p = new FakeProvider(); const c = await aiReadyCtx(p); const conv = (await call(c, "POST", "/conversations")).json().id;
    c.deps.repos.conversations.addMessage({ conversationId: conv, role: "user", content: "old msg with 4111 1111 1111 1111" });
    await call(c, "POST", `/conversations/${conv}/messages`, { content: "tell me a joke" });
    expect(JSON.stringify(p.calls[0])).not.toContain("4111"); expect(JSON.stringify(p.calls[0])).toContain("withheld");
  });
  it("sends clean text to the provider", async () => { const p = new FakeProvider(); const c = await aiReadyCtx(p); const conv = (await call(c, "POST", "/conversations")).json().id; const r = await call(c, "POST", `/conversations/${conv}/messages`, { content: "tell me a joke about cats" }); expect(p.calls).toHaveLength(1); expect(r.json().message.content).toBe("ok"); });
});
