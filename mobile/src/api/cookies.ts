export const COOKIE_NAME = "vera_session";
/** Reads the session token out of a (possibly comma-joined) Set-Cookie header. Returns "" when the cookie was cleared, null when absent. */
export function parseSessionCookie(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = new RegExp(`(?:^|[,;\\s])${COOKIE_NAME}=([^;,\\s]*)`).exec(header);
  return m ? (m[1] ?? "") : null;
}
