import { parseSessionCookie } from "../src/api/cookies";
import { drainNdjson, flushNdjson } from "../src/api/stream";

describe("parseSessionCookie", () => {
  it("reads the token from a Set-Cookie header", () => {
    expect(parseSessionCookie("vera_session=abc123; Path=/; HttpOnly; SameSite=Lax")).toBe("abc123");
  });
  it("finds it among several comma-joined cookies", () => {
    expect(parseSessionCookie("other=1; Path=/, vera_session=tok.en-9; Max-Age=3600; Path=/")).toBe("tok.en-9");
  });
  it("returns empty string when cleared and null when absent", () => {
    expect(parseSessionCookie("vera_session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT")).toBe("");
    expect(parseSessionCookie("theme=dark")).toBeNull();
    expect(parseSessionCookie(null)).toBeNull();
  });
});

describe("drainNdjson", () => {
  it("emits complete lines and keeps the partial tail", () => {
    const a = drainNdjson('{"type":"step","step":{"id":"1"}}\n{"type":"mess');
    expect(a.events).toHaveLength(1); expect(a.rest).toBe('{"type":"mess');
    const b = drainNdjson(a.rest + 'age","message":{"id":"m"}}\n');
    expect(b.events[0]).toMatchObject({ type: "message" }); expect(b.rest).toBe("");
  });
  it("skips corrupt lines instead of failing the reply", () => {
    expect(drainNdjson('not json\n{"type":"error","code":"X","message":"m"}\n').events).toHaveLength(1);
  });
  it("flushes a last line that has no newline", () => {
    expect(flushNdjson('{"type":"message","message":{"id":"z"}}')).toHaveLength(1);
    expect(flushNdjson("   ")).toHaveLength(0);
  });
});
