/** Turns whatever a person types into a base URL, and reports how risky it is to use. */
export type UrlCheck = { ok: true; url: string; host: string; cleartext: boolean; privateHost: boolean } | { ok: false; message: string };

const PRIVATE_V4 = /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/;
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".home.arpa") || PRIVATE_V4.test(h) || h === "::1" || /^f[cd][0-9a-f]{2}:/.test(h) || !h.includes(".");
}
/** Tailscale / CGNAT range 100.64.0.0/10: private in practice, and encrypted by the tunnel. */
export const isCgnat = (host: string) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host);

export function normalizeServerUrl(input: string): UrlCheck {
  let s = input.trim();
  if (!s) return { ok: false, message: "Enter the address of your Vera server." };
  if (/\s/.test(s)) return { ok: false, message: "The address can't contain spaces." };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    const host = s.split(/[/:?#]/)[0] ?? "";
    s = `${isPrivateHost(host) || isCgnat(host) ? "http" : "https"}://${s}`;
  }
  let u: URL;
  try { u = new URL(s); } catch { return { ok: false, message: "That doesn't look like a valid address. Try something like https://vera.example.com or 192.168.1.20:3001." }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, message: "Use an http:// or https:// address." };
  if (!u.hostname) return { ok: false, message: "The address needs a host name or IP." };
  const base = `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`.replace(/\/api\/v1$/, "");
  const privateHost = isPrivateHost(u.hostname) || isCgnat(u.hostname);
  return { ok: true, url: base, host: u.host, cleartext: u.protocol === "http:", privateHost };
}
