import { normalizeServerUrl, isPrivateHost } from "../src/api/url";

describe("normalizeServerUrl", () => {
  it("uses http for LAN addresses and https for public hosts when no scheme is typed", () => {
    expect(normalizeServerUrl("192.168.1.20:3001")).toMatchObject({ ok: true, url: "http://192.168.1.20:3001", cleartext: true, privateHost: true });
    expect(normalizeServerUrl("vera.home.arpa")).toMatchObject({ ok: true, url: "http://vera.home.arpa", privateHost: true });
    expect(normalizeServerUrl("vera.example.com")).toMatchObject({ ok: true, url: "https://vera.example.com", cleartext: false });
  });
  it("treats Tailscale (CGNAT) addresses as private", () => {
    expect(normalizeServerUrl("100.101.5.9:3001")).toMatchObject({ ok: true, privateHost: true });
  });
  it("flags plain http to a public host so the UI can warn", () => {
    expect(normalizeServerUrl("http://example.com")).toMatchObject({ ok: true, cleartext: true, privateHost: false });
  });
  it("strips trailing slashes and a pasted /api/v1", () => {
    expect(normalizeServerUrl("https://vera.example.com/")).toMatchObject({ url: "https://vera.example.com" });
    expect(normalizeServerUrl("https://vera.example.com/api/v1/")).toMatchObject({ url: "https://vera.example.com" });
  });
  it("keeps a sub-path for reverse proxies", () => {
    expect(normalizeServerUrl("https://home.example.com/vera")).toMatchObject({ url: "https://home.example.com/vera" });
  });
  it("rejects empty, spaced and non-http input", () => {
    expect(normalizeServerUrl("  ")).toMatchObject({ ok: false });
    expect(normalizeServerUrl("my server")).toMatchObject({ ok: false });
    expect(normalizeServerUrl("ftp://host")).toMatchObject({ ok: false });
  });
  it("classifies private hosts", () => {
    for (const h of ["localhost", "10.0.0.5", "172.16.4.1", "172.31.0.1", "192.168.0.1", "nas.local"]) expect(isPrivateHost(h)).toBe(true);
    for (const h of ["172.32.0.1", "8.8.8.8", "example.com"]) expect(isPrivateHost(h)).toBe(false);
  });
});
